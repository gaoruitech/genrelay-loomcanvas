import { describe, expect, it } from 'vitest'
import { applyChanges, applyLocks, countsMatch, latestChange, mergeList, sameCard } from '../src/components/canvaslist/useCanvasLocks'
import type { WorkflowSummary } from '../src/utils/api'

/**
 * 画布列表隔几秒问一次的那份回答（GET /workflow/locks?since=…）怎么合到手上的列表上：
 * 别人改的名字、新建 / 删掉 / 恢复的画布就地出现，没变的卡片还是原来的对象（不重绘、不闪）。
 */
const person = (id: string) => ({ id, username: id, name: id.toUpperCase(), left: false, deleted: false, state: 'active' })
const card = (id: string, over: Partial<WorkflowSummary> = {}): WorkflowSummary => ({
  id, name: 'Canvas ' + id, thumbnail: '', thumbnailType: '', visibility: 'team_edit', revision: 1, metaRevision: 0,
  createdBy: person('ann') as any, lastEditedBy: null, lastEditedAt: null, lock: null,
  createdAt: '2026-10-13T08:00:00.000Z', updatedAt: '2026-10-13T08:00:00.000Z', ...over,
})
const lock = (by: string) => ({ by: person(by), at: 'a', expiresAt: 'e', mine: false, sameUser: false }) as any
const byCreated = (a: WorkflowSummary, b: WorkflowSummary) => Date.parse(b.createdAt) - Date.parse(a.createdAt)

describe('canvas list poll', () => {
  it('nothing moved: the very same array, so nothing re-renders', () => {
    const list = [card('a'), card('b')]
    expect(applyChanges(list, [], [])).toBe(list)
    expect(applyChanges(list)).toBe(list)
    // the server lists a canvas again inside its two-second overlap: the same row changes nothing
    expect(applyChanges(list, [card('a')], [])).toBe(list)
    // an id this list never had
    expect(applyChanges(list, [], ['zzz'])).toBe(list)
  })

  it("somebody else's rename replaces that one card; the others keep their objects", () => {
    const list = [card('a'), card('b'), card('c')]
    const next = applyChanges(list, [card('b', { name: 'Renamed', metaRevision: 1, updatedAt: '2026-10-13T08:05:00.000Z' })])
    expect(next).not.toBe(list)
    expect(next.map((w) => w.name)).toEqual(['Canvas a', 'Renamed', 'Canvas c'])
    expect(next[0]).toBe(list[0])
    expect(next[2]).toBe(list[2])
    expect(next[1]).not.toBe(list[1])
    expect(next[1].metaRevision).toBe(1)
  })

  it('the lock of a changed card is left to the lock pass of the same answer', () => {
    const list = [card('a', { lock: lock('al') })]
    const changed = [card('a', { name: 'Renamed', lock: null })]
    const merged = applyChanges(list, changed)
    expect(merged[0].lock).toBe(list[0].lock)
    expect(applyLocks(merged, [])[0].lock).toBeNull()
    expect(applyLocks(merged, [{ id: 'a', lock: lock('al') }])[0]).toBe(merged[0])
  })

  it('a card that carries more than the list row (the answer of a rename) is compared on what the row has', () => {
    const have = { ...card('a'), nodes: [], viewport: { x: 0, y: 0, zoom: 1 } } as WorkflowSummary
    expect(sameCard(have, card('a'))).toBe(true)
    expect(sameCard(have, card('a', { name: 'x' }))).toBe(false)
    // only the lock differs: not this function's business
    expect(sameCard(have, card('a', { lock: lock('al') }))).toBe(true)
    expect(applyChanges([have], [card('a')])[0]).toBe(have)
  })

  it('new and restored canvases come in, deleted ones go, in the order the list keeps', () => {
    const list = [card('b', { createdAt: '2026-10-13T08:02:00.000Z' }), card('a', { createdAt: '2026-10-13T08:01:00.000Z' })]
    const fresh = card('c', { createdAt: '2026-10-13T08:03:00.000Z' })
    const old = card('z', { createdAt: '2026-10-12T08:00:00.000Z' })
    const next = applyChanges(list, [fresh, old], ['a'], byCreated)
    expect(next.map((w) => w.id)).toEqual(['c', 'b', 'z'])
    expect(next[1]).toBe(list[0])
    // saved and deleted within one answer: gone
    expect(applyChanges(list, [card('a', { name: 'Saved' })], ['a']).map((w) => w.id)).toEqual(['b'])
    // without an order a new card goes to the end
    expect(applyChanges(list, [fresh]).map((w) => w.id)).toEqual(['b', 'a', 'c'])
  })

  it('a list sorted by "recently changed" moves the renamed canvas to the front', () => {
    const byRecent = (a: WorkflowSummary, b: WorkflowSummary) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
    const list = [card('a', { updatedAt: '2026-10-13T08:02:00.000Z' }), card('b', { updatedAt: '2026-10-13T08:01:00.000Z' })]
    const next = applyChanges(list, [card('b', { name: 'Renamed', updatedAt: '2026-10-13T08:09:00.000Z' })], [], byRecent)
    expect(next.map((w) => w.id)).toEqual(['b', 'a'])
  })

  it('the counts tell whether the list is still the one the server would give', () => {
    const list = [card('a'), card('b', { visibility: 'team_view' }), card('c', { visibility: 'private' })]
    expect(countsMatch(list, { total: 3, private: 1, team_view: 1, team_edit: 1 })).toBe(true)
    // one became private for somebody else: it is no longer theirs to see
    expect(countsMatch(list, { total: 2, private: 1, team_view: 1, team_edit: 0 })).toBe(false)
    // one switched between "view" and "edit": same total, different split
    expect(countsMatch(list, { total: 3, private: 1, team_view: 2, team_edit: 0 })).toBe(false)
    expect(countsMatch([], { total: 0, private: 0, team_view: 0, team_edit: 0 })).toBe(true)
  })

  it('asks from the newest change on the list (server time), or from nowhere for an empty list', () => {
    expect(latestChange([])).toBeUndefined()
    expect(latestChange([card('a'), card('b', { updatedAt: '2026-10-13T09:30:00.000Z' })])).toBe('2026-10-13T09:30:00.000Z')
  })

  it('a full reload keeps the objects of the cards that did not change', () => {
    const list = [card('a'), card('b', { lock: lock('al') }), card('c')]
    // the same answer again: the same array
    expect(mergeList(list, [card('a'), card('b', { lock: { ...lock('al'), expiresAt: 'later' } }), card('c')])).toBe(list)
    expect(list[1].lock!.expiresAt).toBe('later')
    // one changed, one gone, one new
    const next = mergeList(list, [card('d'), card('a'), card('b', { name: 'Renamed', lock: lock('al') })])
    expect(next.map((w) => w.id)).toEqual(['d', 'a', 'b'])
    expect(next[1]).toBe(list[0])
    expect(next[2]).not.toBe(list[1])
    // only the order changed: a new array of the same objects
    const swapped = mergeList(list, [card('c'), card('a'), card('b', { lock: lock('al') })])
    expect(swapped).not.toBe(list)
    expect(swapped[0]).toBe(list[2])
    // a lock that changed hands replaces the card
    expect(mergeList(list, [card('a'), card('b', { lock: lock('cam') }), card('c')])[1]).not.toBe(list[1])
  })
})
