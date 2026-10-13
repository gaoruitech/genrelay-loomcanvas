import { describe, expect, it } from 'vitest'
import { createRowFit, rowFitDelay, ROW_FIT_DELAYS } from '../src/components/canvas/gen/rowFit'

/**
 * 布局 c 节点底下那一行的「放不下就一档一档收紧」：必须停得下来。
 *  - 量一遍至多 max + 1 步，只往上走；
 *  - 量的时候又被要求：这一遍不延长，走完之后只补一遍，而且排到宏任务里（不在同一串微任务里转圈）；
 *  - 量这个动作自己会引出下一次要求（不该有的反馈）时：间隔成倍拉长，封顶一秒。
 */
function rig(need: (level: number) => number, room = 272) {
  const log: number[] = []
  const queue: { run: () => void; ms: number }[] = []
  let level = -1
  let onApply: (() => void) | null = null
  const fit = createRowFit({
    max: 4,
    apply: async (l) => { level = l; log.push(l); onApply?.(); await Promise.resolve() },
    fits: () => need(level) <= room,
    defer: (run, ms) => { queue.push({ run, ms }) },
  })
  return { fit, log, queue, level: () => level, hook: (fn: (() => void) | null) => { onApply = fn } }
}
/** let every pending microtask run */
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }

describe('createRowFit', () => {
  it('stops at the lowest level that fits', async () => {
    const r = rig((l) => [300, 290, 280, 268, 240][l])
    await r.fit.request()
    expect(r.log).toEqual([0, 1, 2, 3])
    expect(r.level()).toBe(3)
    expect(r.queue).toHaveLength(0)
    expect(r.fit.pending).toBe(false)
  })

  it('stays at level 0 when everything fits, and when there is nothing to measure', async () => {
    const r = rig(() => 100)
    await r.fit.request()
    expect(r.log).toEqual([0])
    const gone = rig(() => 0, 0)
    await gone.fit.request()
    expect(gone.log).toEqual([0])
  })

  it('takes at most max + 1 steps when nothing ever fits, and ends on the tightest level', async () => {
    const r = rig(() => 9999)
    await r.fit.request()
    expect(r.log).toEqual([0, 1, 2, 3, 4])
    expect(r.level()).toBe(4)
  })

  it('at the boundary width (one pixel short, then exactly enough) it does not swing back and forth', async () => {
    // 272 wide: level 1 needs 273 (one too many), level 2 needs exactly 272
    const r = rig((l) => [281, 273, 272, 250, 230][l])
    await r.fit.request()
    expect(r.log).toEqual([0, 1, 2])
    // asked again with nothing changed: the same walk, the same answer, no extra steps
    await r.fit.request()
    expect(r.log).toEqual([0, 1, 2, 0, 1, 2])
    expect(r.queue).toHaveLength(0)
  })

  it('a level that would fit again above one that does not is never reached by going back', async () => {
    // not monotonic on purpose (a longer label at level 3): the walk only goes up and stops at the first fit
    const r = rig((l) => [300, 272, 300, 272, 300][l])
    await r.fit.request()
    expect(r.log).toEqual([0, 1])
  })

  it('requests made while measuring do not extend the walk: one follow-up, on a later task', async () => {
    const r = rig((l) => [300, 290, 280, 268, 240][l])
    let asked = 0
    r.hook(() => { if (asked < 3) { asked++; void r.fit.request() } })
    await r.fit.request()
    // the walk in progress was not restarted and took no extra step
    expect(r.log).toEqual([0, 1, 2, 3])
    // three requests collapsed into one follow-up, handed to defer (a macrotask), not run in the same microtask chain
    expect(r.queue).toHaveLength(1)
    expect(r.queue[0].ms).toBe(ROW_FIT_DELAYS.first)
    await settle()
    expect(r.log).toEqual([0, 1, 2, 3])
    expect(r.fit.pending).toBe(true)
    r.hook(null)
    r.queue.shift()!.run()
    await settle()
    expect(r.log).toEqual([0, 1, 2, 3, 0, 1, 2, 3])
    expect(r.queue).toHaveLength(0)
    expect(r.fit.pending).toBe(false)
  })

  it('a feedback loop (measuring asks for another measurement every time) cannot spin: it backs off to once a second', async () => {
    const r = rig(() => 9999)
    r.hook(() => { void r.fit.request() })
    await r.fit.request()
    // the first call returned: nothing loops inside microtasks
    expect(r.log).toHaveLength(5)
    const delays: number[] = []
    for (let i = 0; i < 12; i++) {
      expect(r.queue).toHaveLength(1)
      const job = r.queue.shift()!
      delays.push(job.ms)
      job.run()
      await settle()
    }
    // one walk (five steps) per deferred task, never more
    expect(r.log).toHaveLength(5 * 13)
    expect(delays.slice(0, 7)).toEqual([16, 32, 64, 128, 256, 512, 1000])
    expect(delays.every((d) => d <= ROW_FIT_DELAYS.max)).toBe(true)
    // the feedback stops: the next walk ends without a new request and the delay goes back to the shortest
    r.hook(null)
    r.queue.shift()!.run()
    await settle()
    expect(r.queue).toHaveLength(0)
    r.hook(() => { void r.fit.request() })
    await r.fit.request()
    expect(r.queue[0].ms).toBe(ROW_FIT_DELAYS.first)
  })

  it('requests that arrive while a follow-up is waiting do not queue a second one', async () => {
    const r = rig(() => 100)
    let once = true
    r.hook(() => { if (once) { once = false; void r.fit.request() } })
    await r.fit.request()
    expect(r.queue).toHaveLength(1)
    await r.fit.request()
    await r.fit.request()
    expect(r.queue).toHaveLength(1)
    expect(r.log).toEqual([0])
  })

  it('stop() ends the walk at the next step and drops the waiting follow-up', async () => {
    const r = rig(() => 9999)
    r.hook(() => { if (r.log.length === 2) r.fit.stop() })
    await r.fit.request()
    expect(r.log).toEqual([0, 1])
    await r.fit.request()
    expect(r.log).toEqual([0, 1])
    expect(r.queue).toHaveLength(0)
  })

  it('the delay doubles from one frame and is capped', () => {
    expect(rowFitDelay(0)).toBe(16)
    expect(rowFitDelay(3)).toBe(128)
    expect(rowFitDelay(40)).toBe(1000)
  })
})
