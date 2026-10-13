/**
 * The editor's rules for taking turns on one canvas (edit lock, revision-checked saves, conflicts),
 * exercised against a scripted adapter: no server, no DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runtime } from '../src/embed/runtime'
import { createSerialQueue, useCanvasCollab } from '../src/composables/useCanvasCollab'
import type { EditorAdapter } from '../src/embed/types'

const locked = (name: string, canTakeOver = true, more: Record<string, unknown> = {}) => Object.assign(new Error(`${name} is editing`), {
  status: 423, code: 'canvas.locked', data: { lock: { by: { id: 'u2', name }, mine: false, sameUser: false }, canTakeOver, ...more },
})
/** The caller's own account in another tab. */
const lockedBySelf = (lost: string | null = null) => Object.assign(new Error('open in another tab'), {
  status: 423, code: 'canvas.locked', data: { lock: { by: { id: 'u1', name: 'me' }, mine: false, sameUser: true }, canTakeOver: true, lost },
})
const mine = { by: { id: 'u1', name: 'me' }, mine: true, sameUser: true }
const HB = 12_000

function setup(adapter: Partial<EditorAdapter>, over: { unsaved?: boolean } = {}) {
  runtime.adapter = adapter as EditorAdapter
  const calls = { reload: 0, quietReload: 0, editable: 0, lost: 0, renamed: [] as string[] }
  const state = { unsaved: !!over.unsaved }
  const collab = useCanvasCollab({
    canvasId: () => 'c1',
    reload: async (o) => { if (o?.quiet) calls.quietReload++; else calls.reload++; return 9 },
    hasUnsaved: () => state.unsaved,
    onEditable: () => { calls.editable++ },
    onLost: () => { calls.lost++ },
    onRenamed: (name) => { calls.renamed.push(name) },
  })
  return { collab, calls, state }
}

/** A stand-in for `document`: the tab can be sent to the background and brought back. */
function fakeDocument() {
  const listeners = new Set<() => void>()
  const doc = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: (type: string, fn: () => void) => { if (type === 'visibilitychange') listeners.add(fn) },
    removeEventListener: (type: string, fn: () => void) => { if (type === 'visibilitychange') listeners.delete(fn) },
  }
  ;(globalThis as any).document = doc
  return {
    listeners,
    async show(state: 'visible' | 'hidden') {
      doc.visibilityState = state
      for (const fn of [...listeners]) fn()
      await vi.advanceTimersByTimeAsync(0)
    },
  }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); runtime.adapter = null; delete (globalThis as any).document })

describe('serial queue', () => {
  it('runs one task at a time, in order, and keeps going after a failure', async () => {
    vi.useRealTimers()
    const q = createSerialQueue()
    const log: string[] = []
    let active = 0
    let maxActive = 0
    const task = (name: string, fail = false) => async () => {
      active++; maxActive = Math.max(maxActive, active)
      log.push('start ' + name)
      await new Promise((r) => setTimeout(r, 5))
      log.push('end ' + name)
      active--
      if (fail) throw new Error(name)
      return name
    }
    const a = q.run(task('a'))
    const b = q.run(task('b', true))
    const c = q.run(task('c'))
    expect(q.busy).toBe(true)
    await expect(a).resolves.toBe('a')
    await expect(b).rejects.toThrow('b')
    await expect(c).resolves.toBe('c')
    expect(maxActive).toBe(1)
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
    await Promise.resolve()
    expect(q.busy).toBe(false)
  })

  it('an idle queue starts its task at once: the parting save reaches the adapter before the editor is gone', async () => {
    vi.useRealTimers()
    const q = createSerialQueue()
    const log: string[] = []
    const first = q.run(async () => { log.push('first started'); await new Promise((r) => setTimeout(r, 5)); log.push('first done') })
    // synchronously, before any await: this is what "leave the canvas -> save now" relies on
    expect(log).toEqual(['first started'])
    // behind a task that is still running the next one waits its turn
    const second = q.run(async () => { log.push('second started') })
    expect(log).toEqual(['first started'])
    await first
    await second
    expect(log).toEqual(['first started', 'first done', 'second started'])
    // a task that throws synchronously rejects its promise and does not stop the queue
    await expect(q.run(() => { throw new Error('sync') })).rejects.toThrow('sync')
    await Promise.resolve()
    expect(q.busy).toBe(false)
    await expect(q.run(async () => 'ok')).resolves.toBe('ok')
  })
})

describe('edit lock', () => {
  it('an adapter without acquireLock never locks: editable, as before teams', async () => {
    const { collab } = setup({})
    await collab.begin({ revision: undefined })
    expect(collab.mode.value).toBe('off')
    expect(collab.readOnly.value).toBe(false)
    expect(collab.saveOptions()).toBeUndefined()
  })

  it('a canvas in the personal space is not locked', async () => {
    const acquireLock = vi.fn()
    const { collab } = setup({ acquireLock })
    await collab.begin({ revision: 3, spaceId: 'personal' })
    expect(acquireLock).not.toHaveBeenCalled()
    expect(collab.mode.value).toBe('off')
    // ...but its saves still carry the revision, so a second tab cannot silently overwrite the first
    expect(collab.saveOptions()).toEqual({ baseRevision: 3 })
  })

  it('without edit rights the editor is read-only and never asks for the lock', async () => {
    const acquireLock = vi.fn()
    const { collab } = setup({ acquireLock })
    await collab.begin({ revision: 3, spaceId: 't1', access: { canEdit: false }, lock: { by: { id: 'u2', name: 'zhou' }, mine: false } })
    expect(acquireLock).not.toHaveBeenCalled()
    expect(collab.mode.value).toBe('view')
    expect(collab.readOnly.value).toBe(true)
    expect(collab.holder.value?.by.name).toBe('zhou')
  })

  it('takes the lock on open and renews it every heartbeatMs', async () => {
    const acquireLock = vi.fn(async () => ({ lock: mine, revision: 3, heartbeatMs: HB }))
    const { collab, calls } = setup({ acquireLock })
    await collab.begin({ revision: 3, spaceId: 't1', access: { canEdit: true } })
    expect(collab.mode.value).toBe('mine')
    expect(collab.readOnly.value).toBe(false)
    expect(calls.editable).toBe(1)
    expect(calls.reload).toBe(0)
    await vi.advanceTimersByTimeAsync(HB)
    await vi.advanceTimersByTimeAsync(HB)
    expect(acquireLock).toHaveBeenCalledTimes(3)
    expect(acquireLock).toHaveBeenLastCalledWith('c1', undefined)
    collab.end()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(acquireLock).toHaveBeenCalledTimes(3)
  })

  it('an adapter that only says heartbeatSeconds is still listened to; one that says nothing gets 12 s', async () => {
    const seconds = vi.fn(async () => ({ lock: mine, revision: 3, heartbeatSeconds: 30 }))
    const a = setup({ acquireLock: seconds })
    await a.collab.begin({ revision: 3, spaceId: 't1' })
    await vi.advanceTimersByTimeAsync(29_000)
    expect(seconds).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(seconds).toHaveBeenCalledTimes(2)
    a.collab.end()
    const silent = vi.fn(async () => ({ lock: mine, revision: 3 }))
    const b = setup({ acquireLock: silent })
    await b.collab.begin({ revision: 3, spaceId: 't1' })
    await vi.advanceTimersByTimeAsync(12_000)
    expect(silent).toHaveBeenCalledTimes(2)
    b.collab.end()
  })

  it('reloads when the canvas changed between loading it and getting the lock', async () => {
    const { collab, calls } = setup({ acquireLock: async () => ({ lock: mine, revision: 5 }) })
    await collab.begin({ revision: 3, spaceId: 't1' })
    expect(calls.reload).toBe(1)
    expect(collab.revision.value).toBe(9)
  })

  it('somebody else is editing: read-only, with who it is and whether taking over is allowed', async () => {
    const acquireLock = vi.fn(async (_id: string, o?: { takeover?: boolean }) => {
      if (!o?.takeover) throw locked('zhou')
      return { lock: mine, revision: 4 }
    })
    const { collab, calls } = setup({ acquireLock })
    await collab.begin({ revision: 3, spaceId: 't1' })
    expect(collab.mode.value).toBe('held')
    expect(collab.readOnly.value).toBe(true)
    expect(collab.holder.value?.by.name).toBe('zhou')
    expect(collab.holder.value?.sameUser).toBe(false)
    expect(collab.canTakeOver.value).toBe(true)
    expect(calls.editable).toBe(0)

    // taking over: the lock is mine, and the content the other person saved meanwhile is loaded
    await expect(collab.takeOver()).resolves.toBe(true)
    expect(acquireLock).toHaveBeenLastCalledWith('c1', { takeover: true })
    expect(collab.mode.value).toBe('mine')
    expect(calls.reload).toBe(1)
    expect(calls.editable).toBe(1)
    collab.end()
  })

  it('a canvas that loads with somebody on it opens read-only without asking for the lock at all', async () => {
    const acquireLock = vi.fn(async () => ({ lock: mine, revision: 3 }))
    const { collab } = setup({ acquireLock, peekLock: async () => ({ lock: { by: { id: 'u2', name: 'zhou' }, mine: false } }) })
    await collab.begin({ revision: 3, spaceId: 't1', access: { canEdit: true, canTakeOver: true }, lock: { by: { id: 'u2', name: 'zhou' }, mine: false } })
    expect(collab.mode.value).toBe('held')
    expect(collab.canTakeOver.value).toBe(true)
    expect(acquireLock).not.toHaveBeenCalled()
    collab.end()
  })

  it('the same person in a second tab: read-only like anybody else, told that it is their own tab, and may take over', async () => {
    const acquireLock = vi.fn(async (_id: string, o?: { takeover?: boolean }) => {
      if (!o?.takeover) throw lockedBySelf()
      return { lock: mine, revision: 3 }
    })
    // seen at load time...
    const a = setup({ acquireLock, peekLock: async () => ({ lock: { by: { id: 'u1', name: 'me' }, mine: false, sameUser: true } }) })
    await a.collab.begin({ revision: 3, spaceId: 't1', access: { canEdit: true, canTakeOver: true }, lock: { by: { id: 'u1', name: 'me' }, mine: false, sameUser: true } })
    expect([a.collab.mode.value, a.collab.holder.value?.sameUser, a.collab.canTakeOver.value]).toEqual(['held', true, true])
    a.collab.end()
    // ...or only when the lock is asked for
    const b = setup({ acquireLock })
    await b.collab.begin({ revision: 3, spaceId: 't1' })
    expect([b.collab.mode.value, b.collab.holder.value?.sameUser, b.collab.readOnly.value]).toEqual(['held', true, true])
    await expect(b.collab.takeOver()).resolves.toBe(true)
    expect(b.collab.mode.value).toBe('mine')
    expect(b.collab.holder.value).toBeNull()
    b.collab.end()
  })

  it('a heartbeat that finds the lock taken over turns the editor read-only at once, and says how it was lost', async () => {
    let taken: 'no' | 'other' | 'self' = 'no'
    const acquireLock = vi.fn(async () => {
      if (taken === 'other') throw locked('zhou', true, { lost: 'taken_over' })
      if (taken === 'self') throw lockedBySelf('taken_over')
      return { lock: mine, revision: 3, heartbeatMs: HB }
    })
    const { collab, calls } = setup({ acquireLock })
    await collab.begin({ revision: 3, spaceId: 't1' })
    taken = 'other'
    await vi.advanceTimersByTimeAsync(HB)
    expect(collab.mode.value).toBe('lost')
    expect(collab.lostHow.value).toBe('taken_over')
    expect(collab.readOnly.value).toBe(true)
    expect(collab.holder.value?.by.name).toBe('zhou')
    expect(calls.lost).toBe(1)
    // no more heartbeats, no retry
    await vi.advanceTimersByTimeAsync(60_000)
    expect(acquireLock).toHaveBeenCalledTimes(2)
    collab.end()

    // taken over from the person's own other tab
    taken = 'no'
    const b = setup({ acquireLock })
    await b.collab.begin({ revision: 3, spaceId: 't1' })
    taken = 'self'
    await vi.advanceTimersByTimeAsync(HB)
    expect([b.collab.mode.value, b.collab.lostHow.value, b.collab.holder.value?.sameUser]).toEqual(['lost', 'taken_over', true])
    b.collab.end()
  })

  it('a heartbeat that merely fails (network) does not drop the lock', async () => {
    let down = false
    const acquireLock = vi.fn(async () => { if (down) throw new Error('network'); return { lock: mine, revision: 3, heartbeatMs: HB } })
    const { collab, calls } = setup({ acquireLock })
    await collab.begin({ revision: 3, spaceId: 't1' })
    down = true
    await vi.advanceTimersByTimeAsync(HB)
    expect(collab.mode.value).toBe('mine')
    expect(calls.lost).toBe(0)
    // and the heartbeat goes on
    down = false
    await vi.advanceTimersByTimeAsync(HB)
    expect(acquireLock).toHaveBeenCalledTimes(3)
    collab.end()
  })

  it('taking the lock back with unsaved changes does not reload over them', async () => {
    let taken = false
    const acquireLock = vi.fn(async (_id: string, o?: { takeover?: boolean }) => {
      if (o?.takeover) return { lock: mine, revision: 7 }
      if (taken) throw locked('zhou')
      return { lock: mine, revision: 3, heartbeatMs: HB }
    })
    const { collab, calls } = setup({ acquireLock }, { unsaved: true })
    await collab.begin({ revision: 3, spaceId: 't1' })
    taken = true
    await vi.advanceTimersByTimeAsync(HB)
    expect(collab.mode.value).toBe('lost')
    await collab.takeOver()
    expect(collab.mode.value).toBe('mine')
    expect(calls.reload).toBe(0)
    // the base revision stays what the unsaved changes were made on: the next save reports the conflict
    expect(collab.saveOptions()).toEqual({ baseRevision: 3 })
    collab.end()
  })

  it('failing to get the lock for another reason leaves the editor read-only with a retry', async () => {
    let fail = true
    const { collab } = setup({ acquireLock: async () => { if (fail) throw new Error('boom'); return { lock: mine, revision: 3 } } })
    await collab.begin({ revision: 3, spaceId: 't1' })
    expect(collab.mode.value).toBe('error')
    expect(collab.readOnly.value).toBe(true)
    expect(collab.errorMessage.value).toBe('boom')
    fail = false
    await expect(collab.retry()).resolves.toBe(true)
    expect(collab.mode.value).toBe('mine')
    collab.end()
  })

  it('gives the lock back when the editor closes - and says so when it is the page itself that goes away', async () => {
    const releaseLock = vi.fn(async () => undefined)
    const a = setup({ acquireLock: async () => ({ lock: mine, revision: 3 }), releaseLock })
    await a.collab.begin({ revision: 3, spaceId: 't1' })
    a.collab.end()
    expect(releaseLock).toHaveBeenLastCalledWith('c1', undefined)
    const b = setup({ acquireLock: async () => ({ lock: mine, revision: 3 }), releaseLock })
    await b.collab.begin({ revision: 3, spaceId: 't1' })
    b.collab.end({ unloading: true })
    expect(releaseLock).toHaveBeenLastCalledWith('c1', { unloading: true })
    // a read-only editor has nothing to give back
    const c = setup({ acquireLock: async () => { throw locked('zhou') }, releaseLock })
    await c.collab.begin({ revision: 3, spaceId: 't1' })
    c.collab.end({ unloading: true })
    expect(releaseLock).toHaveBeenCalledTimes(2)
  })
})

describe('a tab in the background', () => {
  it('coming back sends a heartbeat at once: the lock ran out and nobody took the canvas - carry on', async () => {
    const tab = fakeDocument()
    let state = 'acquired'
    const acquireLock = vi.fn(async () => ({ lock: mine, revision: 3, heartbeatMs: HB, state }))
    const { collab, calls } = setup({ acquireLock })
    await collab.begin({ revision: 3, spaceId: 't1' })
    expect(tab.listeners.size).toBe(1)
    await tab.show('hidden')
    expect(acquireLock).toHaveBeenCalledTimes(1)
    // five minutes in the background: the browser ran the timer once a minute at best. Nothing here depends on it.
    state = 'reacquired'
    await tab.show('visible')
    expect(acquireLock).toHaveBeenCalledTimes(2)
    expect(collab.mode.value).toBe('mine')
    expect(calls.reload).toBe(0)
    expect(calls.lost).toBe(0)
    expect(calls.editable).toBe(1)
    collab.end()
    expect(tab.listeners.size).toBe(0)
  })

  it('coming back to a canvas somebody else started editing meanwhile: read-only, told that the lock ran out', async () => {
    const tab = fakeDocument()
    let gone = false
    const acquireLock = vi.fn(async () => { if (gone) throw locked('zhou', true, { lost: 'expired' }); return { lock: mine, revision: 3, heartbeatMs: HB } })
    const { collab, calls } = setup({ acquireLock })
    await collab.begin({ revision: 3, spaceId: 't1' })
    await tab.show('hidden')
    gone = true
    await tab.show('visible')
    expect([collab.mode.value, collab.lostHow.value, collab.holder.value?.by.name]).toEqual(['lost', 'expired', 'zhou'])
    expect(calls.lost).toBe(1)
    collab.end()
  })

  it('coming back after somebody edited and left: the lock is this tab\'s again and the newer content is loaded', async () => {
    const tab = fakeDocument()
    let revision = 3
    const { collab, calls, state } = setup({ acquireLock: async () => ({ lock: mine, revision, heartbeatMs: HB, state: 'acquired' }) })
    await collab.begin({ revision: 3, spaceId: 't1' })
    await tab.show('hidden')
    revision = 6
    await tab.show('visible')
    expect(collab.mode.value).toBe('mine')
    expect(calls.reload).toBe(1)
    expect(collab.revision.value).toBe(9)
    // ...unless this tab has changes of its own: then nothing is reloaded and the next save reports the conflict
    await tab.show('hidden')
    revision = 12
    state.unsaved = true
    await tab.show('visible')
    expect(calls.reload).toBe(1)
    expect(collab.saveOptions()).toEqual({ baseRevision: 9 })
    collab.end()
  })

  it('two heartbeats never overlap (the timer and the tab becoming visible at the same moment)', async () => {
    const tab = fakeDocument()
    let release: (() => void) | null = null
    let calls = 0
    const acquireLock = vi.fn(async () => {
      calls++
      if (calls > 1) await new Promise<void>((r) => { release = r })
      return { lock: mine, revision: 3, heartbeatMs: HB }
    })
    const { collab } = setup({ acquireLock })
    await collab.begin({ revision: 3, spaceId: 't1' })
    await vi.advanceTimersByTimeAsync(HB) // heartbeat in flight
    await tab.show('hidden')
    await tab.show('visible')
    expect(acquireLock).toHaveBeenCalledTimes(2)
    release!()
    await vi.advanceTimersByTimeAsync(0)
    collab.end()
  })
})

describe('renamed elsewhere', () => {
  it('the editor that holds the lock learns the new name from its heartbeat - once', async () => {
    let name = 'Storyboard'
    let metaRevision = 2
    const { collab, calls } = setup({ acquireLock: async () => ({ lock: mine, revision: 3, heartbeatMs: HB, name, metaRevision }) })
    await collab.begin({ revision: 3, metaRevision: 2, spaceId: 't1' })
    await vi.advanceTimersByTimeAsync(HB)
    expect(calls.renamed).toEqual([])
    name = 'Storyboard v2'; metaRevision = 3
    await vi.advanceTimersByTimeAsync(HB)
    await vi.advanceTimersByTimeAsync(HB)
    expect(calls.renamed).toEqual(['Storyboard v2'])
    // a rename is not an edit: nothing is reloaded, the lock stays, the save revision stays
    expect(calls.reload).toBe(0)
    expect(collab.mode.value).toBe('mine')
    expect(collab.saveOptions()).toEqual({ baseRevision: 3 })
    collab.end()
  })

  it('a backend that keeps no rename counter never reports one', async () => {
    const { collab, calls } = setup({ acquireLock: async () => ({ lock: mine, revision: 3, heartbeatMs: HB, name: 'Whatever' }) })
    await collab.begin({ revision: 3, spaceId: 't1' })
    await vi.advanceTimersByTimeAsync(HB * 2)
    expect(calls.renamed).toEqual([])
    collab.end()
  })
})

describe('waiting read-only', () => {
  const zhou = { by: { id: 'u2', name: 'zhou' }, mine: false }

  it('learns that the holder has left within one poll, and starts editing only on request', async () => {
    fakeDocument()
    let held = true
    const acquireLock = vi.fn(async () => { if (held) throw locked('zhou'); return { lock: mine, revision: 3 } })
    const peekLock = vi.fn(async () => ({ lock: held ? zhou : null, revision: 3, pollMs: 5000 }))
    const { collab, calls } = setup({ acquireLock, peekLock })
    await collab.begin({ revision: 3, spaceId: 't1' })
    expect(collab.mode.value).toBe('held')
    await vi.advanceTimersByTimeAsync(5000)
    expect(peekLock).toHaveBeenCalledTimes(1)
    expect(collab.mode.value).toBe('held')
    held = false
    await vi.advanceTimersByTimeAsync(5000)
    expect(collab.mode.value).toBe('free')
    expect(collab.readOnly.value).toBe(true)
    // the bar still says who left
    expect(collab.holder.value?.by.name).toBe('zhou')
    // looking does not take the lock
    expect(acquireLock).toHaveBeenCalledTimes(1)
    // ...and somebody else may be quicker
    held = true
    await vi.advanceTimersByTimeAsync(5000)
    expect(collab.mode.value).toBe('held')
    held = false
    await vi.advanceTimersByTimeAsync(5000)
    await collab.retry()
    expect(collab.mode.value).toBe('mine')
    expect(calls.editable).toBe(1)
    // an editor does not poll
    const before = peekLock.mock.calls.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(peekLock).toHaveBeenCalledTimes(before)
    collab.end()
  })

  it('does not poll while the tab is hidden, and looks at once when it is shown again', async () => {
    const tab = fakeDocument()
    let held = true
    const peekLock = vi.fn(async () => ({ lock: held ? zhou : null, revision: 3, pollMs: 5000 }))
    const { collab } = setup({ acquireLock: async () => { throw locked('zhou') }, peekLock })
    await collab.begin({ revision: 3, spaceId: 't1' })
    await tab.show('hidden')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(peekLock).not.toHaveBeenCalled()
    held = false
    await tab.show('visible')
    expect(peekLock).toHaveBeenCalledTimes(1)
    expect(collab.mode.value).toBe('free')
    collab.end()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(peekLock).toHaveBeenCalledTimes(1)
  })

  it('follows a rename and what the holder saves, without touching the viewer\'s own unsaved work', async () => {
    fakeDocument()
    let answer: Record<string, unknown> = { lock: zhou, revision: 3, name: 'A', metaRevision: 1, pollMs: 5000 }
    const { collab, calls, state } = setup({ acquireLock: async () => { throw locked('zhou') }, peekLock: async () => answer as any })
    await collab.begin({ revision: 3, metaRevision: 1, spaceId: 't1' })
    await vi.advanceTimersByTimeAsync(5000)
    expect([calls.renamed, calls.quietReload]).toEqual([[], 0])
    answer = { ...answer, name: 'B', metaRevision: 2, revision: 4 }
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.renamed).toEqual(['B'])
    expect(calls.quietReload).toBe(1)
    expect(calls.reload).toBe(0)
    expect(collab.revision.value).toBe(9)
    // a lost editor that still has unsaved changes keeps them
    state.unsaved = true
    answer = { ...answer, revision: 20 }
    await vi.advanceTimersByTimeAsync(5000)
    expect(calls.quietReload).toBe(1)
    collab.end()
  })

  it('a viewer who is given edit rights is offered to edit; an editor who loses them is told', async () => {
    fakeDocument()
    let answer: Record<string, unknown> = { lock: null, revision: 3, canEdit: false, canTakeOver: false, pollMs: 5000 }
    const acquireLock = vi.fn(async () => ({ lock: mine, revision: 3 }))
    const { collab } = setup({ acquireLock, peekLock: async () => answer as any })
    await collab.begin({ revision: 3, spaceId: 't1', access: { canEdit: false } })
    await vi.advanceTimersByTimeAsync(5000)
    expect(collab.mode.value).toBe('view')
    answer = { ...answer, canEdit: true, canTakeOver: true }
    await vi.advanceTimersByTimeAsync(5000)
    expect(collab.mode.value).toBe('free')
    expect(acquireLock).not.toHaveBeenCalled()
    answer = { ...answer, lock: zhou }
    await vi.advanceTimersByTimeAsync(5000)
    expect([collab.mode.value, collab.canTakeOver.value]).toEqual(['held', true])
    answer = { ...answer, canEdit: false, canTakeOver: false }
    await vi.advanceTimersByTimeAsync(5000)
    expect([collab.mode.value, collab.canTakeOver.value, collab.holder.value?.by.name]).toEqual(['view', false, 'zhou'])
    collab.end()
  })

  it('an adapter without peekLock is asked for the whole canvas instead, less often', async () => {
    fakeDocument()
    let held = true
    const loadCanvas = vi.fn(async () => ({ id: 'c1', document: { name: 'A' } as any, revision: 3, lock: held ? zhou : null }))
    const { collab } = setup({ acquireLock: async () => { throw locked('zhou') }, loadCanvas })
    await collab.begin({ revision: 3, spaceId: 't1' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(loadCanvas).not.toHaveBeenCalled()
    held = false
    await vi.advanceTimersByTimeAsync(15_000)
    expect(loadCanvas).toHaveBeenCalledTimes(1)
    expect(collab.mode.value).toBe('free')
    collab.end()
  })
})

describe('revision-checked saves', () => {
  it('sends the revision it is based on and adopts the one the save returns', async () => {
    const { collab } = setup({ acquireLock: async () => ({ lock: mine, revision: 3 }) })
    await collab.begin({ revision: 3, spaceId: 't1' })
    expect(collab.saveOptions()).toEqual({ baseRevision: 3 })
    collab.saved({ revision: 4 })
    expect(collab.saveOptions()).toEqual({ baseRevision: 4 })
    expect(collab.saveOptions(true)).toEqual({ baseRevision: 4, force: true })
  })

  it('a conflict stops saving until the user decided', async () => {
    const { collab } = setup({ acquireLock: async () => ({ lock: mine, revision: 3 }) })
    await collab.begin({ revision: 3, spaceId: 't1' })
    const err = Object.assign(new Error('conflict'), {
      response: { status: 409, data: { code: 'canvas.conflict', message: 'changed', data: { revision: 6, lastEditedBy: { id: 'u2', name: 'zhou' }, lastEditedAt: '2026-10-12T06:32:00.000Z', canOverwrite: false } } },
    })
    expect(collab.saveFailed(err)).toBe('conflict')
    expect(collab.blocked.value).toBe(true)
    expect(collab.conflict.value).toMatchObject({ by: { name: 'zhou' }, revision: 6, canOverwrite: false })
    // still the editor's turn: a conflict is not a lost lock
    expect(collab.mode.value).toBe('mine')
    collab.saved({ revision: 7 })
    expect(collab.blocked.value).toBe(false)
  })

  it('a save refused because somebody took over turns the editor read-only', async () => {
    const { collab, calls } = setup({ acquireLock: async () => ({ lock: mine, revision: 3 }) })
    await collab.begin({ revision: 3, spaceId: 't1' })
    expect(collab.saveFailed(locked('zhou', false))).toBe('locked')
    expect(collab.mode.value).toBe('lost')
    expect(collab.canTakeOver.value).toBe(false)
    expect(calls.lost).toBe(1)
  })

  it('other failures are not its business', async () => {
    const { collab } = setup({})
    await collab.begin({})
    expect(collab.saveFailed(new Error('payload too large'))).toBe('')
    expect(collab.mode.value).toBe('off')
  })
})
