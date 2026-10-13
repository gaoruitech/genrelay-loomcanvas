/**
 * How the stock HTTP adapter speaks the edit-lock and metadata parts of the server API
 * (docs/api.md, "The edit lock", "Saving and conflicts"), against a scripted API: no server.
 *
 *  - one editing session per adapter: a random id, sent with every call that concerns the lock, never stored;
 *  - a save of nothing but name / viewport / legacyLayout goes to PATCH .../meta - no revision, no force;
 *  - the release token of this session's lock is remembered from every answer that shows it, and is what
 *    a closing page sends (sendBeacon); inside the app the lock is given back with DELETE.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpAdapterOver, newEditSessionId } from '../src/embed/httpAdapterCore'
import { applyLocks, sameLock } from '../src/components/canvaslist/useCanvasLocks'
import type { ApiGroups } from '../src/utils/api'

const envelope = <T>(data: T) => ({ data: { result: 0, data } })
const person = { id: 'u1', username: 'lin', name: 'Lin' }
const myLock = (releaseToken: string) => ({ by: person, at: '2026-10-13T08:00:00.000Z', expiresAt: '2026-10-13T08:00:36.000Z', mine: true, sameUser: true, releaseToken })

function scripted() {
  const calls: { op: string; args: unknown[] }[] = []
  const rec = (op: string, out: unknown) => vi.fn(async (...args: unknown[]) => { calls.push({ op, args }); return envelope(typeof out === 'function' ? (out as any)(...args) : out) })
  const canvas = { id: 'c1', name: 'A', nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, revision: 4, metaRevision: 2, updatedAt: 't1', lock: null as any, spaceId: 'team', visibility: 'team_edit' }
  const workflowApi = {
    detail: rec('detail', () => canvas),
    update: rec('update', () => ({ ...canvas, revision: 5, updatedAt: 't2', lock: myLock('tok-save') })),
    saveMeta: rec('saveMeta', () => ({ ...canvas, updatedAt: 't3' })),
    lock: rec('lock', () => ({ lock: myLock('tok-lock'), state: 'acquired', revision: 4, metaRevision: 2, name: 'A', heartbeatMs: 12000, heartbeatSeconds: 12, pollMs: 5000 })),
    unlock: rec('unlock', { released: true }),
    peekLock: rec('peekLock', { lock: { by: { id: 'u2', username: 'zhou', name: 'Zhou' }, at: 'x', expiresAt: 'y', mine: false, sameUser: false }, revision: 4, metaRevision: 3, name: 'B', canEdit: true, canTakeOver: true, pollMs: 5000 }),
    releaseOnUnload: vi.fn((...args: unknown[]) => { calls.push({ op: 'releaseOnUnload', args }); return true }),
  }
  const adapter = httpAdapterOver({ workflowApi } as unknown as ApiGroups, () => '')
  return { adapter, calls, canvas, workflowApi }
}

afterEach(() => { vi.restoreAllMocks() })

describe('editing session', () => {
  it('ids are random, long enough for the server and different per adapter', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newEditSessionId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    const a = scripted(), b = scripted()
    void a.adapter.acquireLock!('c1'); void b.adapter.acquireLock!('c1')
    expect(a.calls[0].args[1]).not.toBe(b.calls[0].args[1])
  })

  it('the same id goes with the load, the lock, the save and the release - and is never kept in storage', async () => {
    const setItem = vi.fn()
    ;(globalThis as any).localStorage = { setItem, getItem: () => null }
    ;(globalThis as any).sessionStorage = { setItem, getItem: () => null }
    try {
      const { adapter, calls } = scripted()
      await adapter.loadCanvas('c1')
      await adapter.acquireLock!('c1')
      await adapter.acquireLock!('c1', { takeover: true })
      await adapter.saveCanvas('c1', { nodes: [] }, { baseRevision: 4 })
      await adapter.peekLock!('c1')
      await adapter.releaseLock!('c1')
      const sid = calls[0].args[1] as string
      expect(sid).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
      expect(calls.map((c) => c.op)).toEqual(['detail', 'lock', 'lock', 'update', 'peekLock', 'unlock'])
      expect(calls[1].args).toEqual(['c1', sid, false])
      expect(calls[2].args).toEqual(['c1', sid, true])
      expect(calls[3].args[1]).toEqual({ nodes: [], sessionId: sid, baseRevision: 4 })
      expect(calls[4].args).toEqual(['c1', sid])
      expect(calls[5].args).toEqual(['c1', sid])
      expect(setItem).not.toHaveBeenCalled()
    } finally {
      delete (globalThis as any).localStorage
      delete (globalThis as any).sessionStorage
    }
  })
})

describe('content and metadata', () => {
  it('a rename, a viewport and the old-layout flag are metadata saves: PATCH .../meta, no revision, no force', async () => {
    const { adapter, calls } = scripted()
    await adapter.saveCanvas('c1', { name: 'Renamed' })
    await adapter.saveCanvas('c1', { viewport: { x: 1, y: 2, zoom: 1 } })
    await adapter.saveCanvas('c1', { legacyLayout: false } as any)
    // options are not looked at: nothing about a metadata save can conflict
    await adapter.saveCanvas('c1', { name: 'Again' }, { baseRevision: 1, force: true })
    expect(calls.map((c) => c.op)).toEqual(['saveMeta', 'saveMeta', 'saveMeta', 'saveMeta'])
    const bodies = calls.map((c) => c.args[1] as Record<string, unknown>)
    expect(bodies.map((b) => Object.keys(b).filter((k) => k !== 'sessionId'))).toEqual([['name'], ['viewport'], ['legacyLayout'], ['name']])
    for (const b of bodies) { expect(b).not.toHaveProperty('baseRevision'); expect(b).not.toHaveProperty('force') }
  })

  it('anything the editor draws makes it a content save: PUT with the revision, metadata along with it', async () => {
    const { adapter, calls } = scripted()
    const out = await adapter.saveCanvas('c1', { nodes: [], edges: [], settings: {}, brandKitId: '', viewport: { x: 0, y: 0, zoom: 1 } }, { baseRevision: 4 })
    expect(out).toEqual({ updatedAt: 't2', revision: 5 })
    expect(calls.map((c) => c.op)).toEqual(['update'])
    expect(calls[0].args[1]).toMatchObject({ nodes: [], viewport: { x: 0, y: 0, zoom: 1 }, baseRevision: 4 })
    expect(calls[0].args[1]).not.toHaveProperty('force')
    await adapter.saveCanvas('c1', { brandKitId: 'k' }, { baseRevision: 5, force: true })
    expect(calls[1].args[1]).toMatchObject({ brandKitId: 'k', baseRevision: 5, force: true })
  })

  it('what the lock answer says about the canvas reaches the editor: state, name, rename counter, heartbeat', async () => {
    const { adapter } = scripted()
    const got = await adapter.acquireLock!('c1')
    expect(got).toEqual({ lock: { by: { id: 'u1', name: 'Lin' }, at: '2026-10-13T08:00:00.000Z', expiresAt: '2026-10-13T08:00:36.000Z', mine: true, sameUser: true }, revision: 4, state: 'acquired', name: 'A', metaRevision: 2, heartbeatMs: 12000 })
    // the release token stays inside the adapter
    expect(JSON.stringify(got)).not.toContain('tok-lock')
    const peek = await adapter.peekLock!('c1')
    expect(peek).toEqual({ lock: { by: { id: 'u2', name: 'Zhou' }, at: 'x', expiresAt: 'y', mine: false, sameUser: false }, revision: 4, name: 'B', metaRevision: 3, canEdit: true, canTakeOver: true, pollMs: 5000 })
    const loaded = await adapter.loadCanvas('c1')
    expect([loaded.revision, loaded.metaRevision, loaded.lock]).toEqual([4, 2, null])
  })
})

describe('giving the lock back', () => {
  it('inside the app: DELETE with the session; when the page goes away: a beacon with the latest release token', async () => {
    const { adapter, calls, workflowApi } = scripted()
    await adapter.acquireLock!('c1')
    await adapter.releaseLock!('c1')
    expect(calls.at(-1)!.op).toBe('unlock')
    expect(workflowApi.releaseOnUnload).not.toHaveBeenCalled()

    await adapter.acquireLock!('c1')
    await adapter.releaseLock!('c1', { unloading: true })
    expect(workflowApi.releaseOnUnload).toHaveBeenLastCalledWith('c1', 'tok-lock')
    expect(workflowApi.unlock).toHaveBeenCalledTimes(1)

    // a save answer carries the lock too (a save may have taken a new one): its token is the one to use
    await adapter.acquireLock!('c1')
    await adapter.saveCanvas('c1', { nodes: [] }, { baseRevision: 4 })
    await adapter.releaseLock!('c1', { unloading: true })
    expect(workflowApi.releaseOnUnload).toHaveBeenLastCalledWith('c1', 'tok-save')
  })

  it('a page that holds no lock sends no beacon; a token is used once', async () => {
    const { adapter, workflowApi } = scripted()
    await adapter.loadCanvas('c1')
    await adapter.releaseLock!('c1', { unloading: true })
    expect(workflowApi.releaseOnUnload).not.toHaveBeenCalled()
    await adapter.acquireLock!('c1')
    await adapter.releaseLock!('c1', { unloading: true })
    await adapter.releaseLock!('c1', { unloading: true })
    expect(workflowApi.releaseOnUnload).toHaveBeenCalledTimes(1)
    // learning that somebody else holds the canvas now forgets the token
    await adapter.acquireLock!('c1')
    await adapter.peekLock!('c1')
    await adapter.releaseLock!('c1', { unloading: true })
    expect(workflowApi.releaseOnUnload).toHaveBeenCalledTimes(1)
  })
})

describe('who is editing, on the canvas cards', () => {
  const lock = (id: string, at = 'a', over: Record<string, unknown> = {}) => ({ by: { id, username: id, name: id }, at, expiresAt: 'e1', mine: false, sameUser: false, ...over })
  const card = (id: string, l: any = null) => ({ id, name: id, createdAt: '', updatedAt: '', lock: l })

  it('only cards whose lock changed are replaced; an unchanged list stays the very same array', () => {
    const list = [card('a', lock('u1')), card('b'), card('c', lock('u2'))]
    const same = applyLocks(list as any, [{ id: 'a', lock: lock('u1', 'a', { expiresAt: 'e2' }) as any }, { id: 'c', lock: lock('u2') as any }])
    expect(same).toBe(list)
    // the same lock, renewed: the expiry moves along without a redraw
    expect(list[0].lock.expiresAt).toBe('e2')

    const next = applyLocks(list as any, [{ id: 'b', lock: lock('u3') as any }, { id: 'c', lock: lock('u2') as any }])
    expect(next).not.toBe(list)
    expect(next[0]).not.toBe(list[0])
    expect(next[0].lock).toBeNull()
    expect(next[1].lock?.by.id).toBe('u3')
    expect(next[2]).toBe(list[2])
  })

  it('a lock that changed hands, or is the same person in another session, is a different lock', () => {
    expect(sameLock(lock('u1') as any, lock('u1') as any)).toBe(true)
    expect(sameLock(lock('u1') as any, lock('u2') as any)).toBe(false)
    expect(sameLock(lock('u1', 'a') as any, lock('u1', 'b') as any)).toBe(false)
    expect(sameLock(lock('u1') as any, lock('u1', 'a', { sameUser: true }) as any)).toBe(false)
    expect(sameLock(null, null)).toBe(true)
    expect(sameLock(null, lock('u1') as any)).toBe(false)
  })
})
