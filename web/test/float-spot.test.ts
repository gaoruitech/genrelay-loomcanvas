import { describe, expect, it } from 'vitest'
import { fitInArea, isFree, nearestFree, overlapArea, placeNear, type Rect } from '../src/utils/floatSpot'

/**
 * 画布上的悬浮块互相让位：
 *  - 输入条贴着选中的节点、多选工具条贴着选区（placeNear）：先下后上再左右，压着工具面板 / 队列圆钮 / 小地图 /
 *    标题块 / 底部工具条就沿边滑开或换边；节点自己的端口绝不盖；别的节点能不压就不压；
 *  - 工具面板、圆钮被挤时挪到最近的空地（nearestFree）。
 */
const BOX = { w: 1376, h: 844 }
const COMPOSER = { w: 480, h: 150 }
const palette: Rect = { l: 16, t: 76, r: 64, b: 512 }
const tools: Rect = { l: 444, t: 776, r: 932, b: 824 }
const minimap: Rect = { l: 16, t: 720, r: 186, b: 824 }
const queue: Rect = { l: 1304, t: 772, r: 1356, b: 824 }
const title: Rect = { l: 16, t: 16, r: 396, b: 60 }
const CHROME = [palette, tools, minimap, queue, title]
const at = (s: { x: number; y: number }, size = COMPOSER): Rect => ({ l: s.x, t: s.y, r: s.x + size.w, b: s.y + size.h })
const hits = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
const inside = (r: Rect) => r.l >= 8 && r.t >= 8 && r.r <= BOX.w - 8 && r.b <= BOX.h - 8

describe('isFree / overlapArea', () => {
  it('counts the gap around the block', () => {
    expect(isFree(100, 100, { w: 50, h: 50 }, [{ l: 155, t: 100, r: 200, b: 150 }], 10)).toBe(false)
    expect(isFree(100, 100, { w: 50, h: 50 }, [{ l: 161, t: 100, r: 200, b: 150 }], 10)).toBe(true)
    expect(overlapArea(0, 0, { w: 10, h: 10 }, { l: 5, t: 5, r: 20, b: 20 })).toBe(25)
    expect(overlapArea(0, 0, { w: 10, h: 10 }, { l: 10, t: 0, r: 20, b: 10 })).toBe(0)
  })
})

describe('placeNear: the composer next to its node', () => {
  it('goes below the node, centred, when there is room', () => {
    const node: Rect = { l: 500, t: 120, r: 772, b: 392 }
    const s = placeNear(node, COMPOSER, BOX, CHROME, { order: ['below', 'above', 'right', 'left'], gap: 12 })
    expect(s).toMatchObject({ side: 'below', clear: true, y: 404 })
    expect(s.x).toBe(Math.round((500 + 772) / 2 - 240))
  })
  it('flips above when the bottom toolbar is in the way', () => {
    const node: Rect = { l: 560, t: 420, r: 832, b: 692 }
    const s = placeNear(node, COMPOSER, BOX, CHROME, { order: ['below', 'above', 'right', 'left'], gap: 12 })
    expect(s.side).toBe('above')
    expect(s.clear).toBe(true)
    for (const c of CHROME) expect(hits(at(s), c)).toBe(false)
  })
  it('slides sideways along the node edge to clear the palette, staying attached', () => {
    // 节点紧挨着左边的工具面板：正下方居中会压着面板
    const node: Rect = { l: 80, t: 120, r: 352, b: 392 }
    const s = placeNear(node, COMPOSER, BOX, CHROME, { order: ['below', 'above', 'right', 'left'], gap: 12, attach: 96 })
    expect(s.side).toBe('below')
    expect(s.x).toBeGreaterThanOrEqual(palette.r + 8)
    expect(Math.min(s.x + COMPOSER.w, node.r) - Math.max(s.x, node.l)).toBeGreaterThanOrEqual(96)
    for (const c of CHROME) expect(hits(at(s), c)).toBe(false)
  })
  it('avoids a palette the user dragged anywhere, vertical or horizontal', () => {
    const node: Rect = { l: 500, t: 120, r: 772, b: 392 }
    for (const pal of [
      { l: 600, t: 400, r: 648, b: 836 },   // 竖排，正好在节点下方
      { l: 420, t: 410, r: 860, b: 458 },   // 横排，横在节点下方
      { l: 420, t: 60, r: 860, b: 108 },    // 横排，在节点上方
    ]) {
      const s = placeNear(node, COMPOSER, BOX, [pal, tools, minimap, queue, title], { order: ['below', 'above', 'right', 'left'], gap: 12, sideGap: 20, attach: 96 })
      expect(s.clear).toBe(true)
      expect(hits(at(s), pal)).toBe(false)
      expect(inside(at(s))).toBe(true)
    }
  })
  it('never covers the node\'s own ports, even when nothing fits cleanly', () => {
    // 很矮的编辑区：上下都放不下，左右也不够宽
    const box = { w: 1036, h: 504 }
    const node: Rect = { l: 464, t: 111, r: 681, b: 382 }
    const ports: Rect[] = [{ l: 456, t: 227, r: 472, b: 243 }, { l: 456, t: 253, r: 472, b: 269 }, { l: 673, t: 240, r: 689, b: 256 }]
    const chrome = [{ l: 16, t: 76, r: 56, b: 330 }, { l: 274, t: 436, r: 762, b: 484 }, { l: 16, t: 378, r: 186, b: 484 }, { l: 16, t: 16, r: 396, b: 60 }]
    const s = placeNear(node, COMPOSER, box, chrome, { order: ['below', 'above', 'right', 'left'], gap: 12, sideGap: 20, keep: ports, attach: 96 })
    for (const p of ports) expect(hits(at(s), p)).toBe(false)
    expect(s.x).toBeGreaterThanOrEqual(8)
    expect(s.y).toBeGreaterThanOrEqual(8)
    expect(s.x + COMPOSER.w).toBeLessThanOrEqual(box.w - 8)
    expect(s.y + COMPOSER.h).toBeLessThanOrEqual(box.h - 8)
  })
  it('prefers a spot that does not sit on another node, and falls back to covering one when there is none', () => {
    const node: Rect = { l: 500, t: 120, r: 772, b: 392 }
    const below: Rect = { l: 500, t: 420, r: 772, b: 692 }
    const s = placeNear(node, COMPOSER, BOX, CHROME, { order: ['below', 'above', 'right', 'left'], gap: 12, sideGap: 20, soft: [below], attach: 96 })
    expect(hits(at(s), below)).toBe(false)
    expect(s.clear).toBe(true)
    // 四面都是节点：还是得放（压着别的节点，调用方把它画得更实），但不压固定的悬浮块
    const ring: Rect[] = [below, { l: 500, t: -180, r: 772, b: 92 }, { l: 800, t: 120, r: 1072, b: 392 }, { l: 200, t: 120, r: 472, b: 392 }]
    const s2 = placeNear(node, COMPOSER, BOX, CHROME, { order: ['below', 'above', 'right', 'left'], gap: 12, sideGap: 20, soft: ring, attach: 96 })
    expect(s2.clear).toBe(true)
    expect(s2.side).toBe('below')
    for (const c of CHROME) expect(hits(at(s2), c)).toBe(false)
  })
})

describe('placeNear: the multi-select toolbar next to the selection', () => {
  const BAR = { w: 360, h: 40 }
  it('sits above the selection, below when the title block is in the way', () => {
    const sel: Rect = { l: 500, t: 200, r: 1000, b: 500 }
    expect(placeNear(sel, BAR, BOX, CHROME, { order: ['above', 'below'], gap: 12, attach: 64 })).toMatchObject({ side: 'above', y: 148, clear: true })
    // 选区顶到了编辑区上沿：上方放不下，换到下方
    const high: Rect = { l: 100, t: 20, r: 420, b: 300 }
    const s = placeNear(high, BAR, BOX, CHROME, { order: ['above', 'below'], gap: 12, attach: 64 })
    expect(s.side).toBe('below')
    for (const c of CHROME) expect(hits(at(s, BAR), c)).toBe(false)
  })
  it('slides clear of the palette and the queue button', () => {
    const left: Rect = { l: 20, t: 300, r: 300, b: 560 }
    const s = placeNear(left, BAR, BOX, CHROME, { order: ['above', 'below'], gap: 12, attach: 64 })
    expect(hits(at(s, BAR), palette)).toBe(false)
    expect(s.clear).toBe(true)
  })
  it('a selection bigger than the view still gets a toolbar inside the view, off the fixed blocks', () => {
    const huge: Rect = { l: -400, t: -300, r: 2000, b: 1400 }
    const s = placeNear(huge, BAR, BOX, CHROME, { order: ['above', 'below'], gap: 12, attach: 64 })
    expect(s.clear).toBe(false)
    expect(inside(at(s, BAR))).toBe(true)
    for (const c of CHROME) expect(hits(at(s, BAR), c)).toBe(false)
  })
})

describe('nearestFree', () => {
  const range = { minX: 8, minY: 8, maxX: 1300, maxY: 780 }
  it('keeps the wanted spot when it is free', () => {
    expect(nearestFree({ x: 600, y: 300 }, { w: 48, h: 200 }, range, CHROME)).toEqual({ x: 600, y: 300 })
  })
  it('moves to the closest free spot otherwise, or only up / down with lockX', () => {
    const size = { w: 52, h: 52 }
    const moved = nearestFree({ x: 1304, y: 772 }, size, range, [queue])
    expect(isFree(moved.x, moved.y, size, [queue], 10)).toBe(true)
    const locked = nearestFree({ x: 460, y: 772 }, size, range, [tools], { lockX: true })
    expect(locked.x).toBe(460)
    expect(isFree(locked.x, locked.y, size, [tools], 10)).toBe(true)
  })
  it('stays put when there is no free spot at all', () => {
    expect(nearestFree({ x: 100, y: 100 }, { w: 48, h: 48 }, range, [{ l: -10, t: -10, r: 2000, b: 2000 }])).toEqual({ x: 100, y: 100 })
  })
})

/**
 * 输入条 / 属性面板是贴底的抽屉时（手机宽度，或桌面上放不下），选中的节点要摆进抽屉上面剩下的那一块（fitInArea）；
 * 生成队列圆钮把抽屉当成占着的一块，挪到它上面去（nearestFree + lockX）。
 */
describe('fitInArea: the selected node above a bottom sheet', () => {
  // 手机：编辑区 390×788，顶上标题块和工具面板到 102，抽屉从 520 起
  const area: Rect = { l: 8, t: 110, r: 382, b: 508 }
  const inside = (r: { x: number; y: number; scale: number }, w: number, h: number) =>
    r.x >= area.l - 0.5 && r.y >= area.t - 0.5 && r.x + w * r.scale <= area.r + 0.5 && r.y + h * r.scale <= area.b + 0.5

  it('does nothing when the node is already inside and clear of everything', () => {
    expect(fitInArea({ l: 40, t: 140, r: 312, b: 480 }, area)).toBeNull()
  })
  it('moves a node that is under the sheet up, by as little as it takes', () => {
    const r = fitInArea({ l: 40, t: 360, r: 312, b: 700 }, area)!
    expect(r.scale).toBe(1)
    expect(r.x).toBe(40)
    expect(r.y).toBe(area.b - 340)
  })
  it('steps aside from the queue button that moved above the sheet', () => {
    const queue: Rect = { l: 318, t: 448, r: 370, b: 500 }
    const node: Rect = { l: 100, t: 180, r: 372, b: 500 }
    const r = fitInArea(node, area, [queue])!
    expect(inside(r, 272, 320)).toBe(true)
    expect(isFree(r.x, r.y, { w: 272, h: 320 }, [queue], 7.5)).toBe(true)
  })
  it('cannot step aside (not enough room beside or above the queue button): shrinks into the biggest free part instead of staying on it', () => {
    // 390 宽的手机：圆钮在抽屉上面的右下角，节点连端口旁的名字有 316 宽、307 高 —— 圆钮左边只有 310，上面只有 305
    const tight: Rect = { l: 8, t: 110, r: 382, b: 473 }
    const queue: Rect = { l: 326, t: 423, r: 378, b: 475 }
    const node: Rect = { l: 46, t: 166, r: 362, b: 473 }
    const r = fitInArea(node, tight, [queue])!
    expect(r.scale).toBeLessThan(1)
    expect(r.scale).toBeGreaterThan(0.9)
    const w = 316 * r.scale, h = 307 * r.scale
    expect(isFree(r.x, r.y, { w, h }, [queue], 7.5)).toBe(true)
    expect(r.x).toBeGreaterThanOrEqual(tight.l - 0.5)
    expect(r.y).toBeGreaterThanOrEqual(tight.t - 0.5)
    expect(r.x + w).toBeLessThanOrEqual(tight.r + 0.5)
    expect(r.y + h).toBeLessThanOrEqual(tight.b + 0.5)
  })
  it('shrinks a node that is taller than what is left, so the whole node (ports included) is above the sheet', () => {
    const short: Rect = { l: 8, t: 110, r: 382, b: 300 }
    const r = fitInArea({ l: 40, t: 200, r: 312, b: 544 }, short)!
    expect(r.scale).toBeCloseTo(190 / 344, 5)
    expect(r.x + 272 * r.scale).toBeLessThanOrEqual(short.r + 0.5)
    expect(r.y).toBe(short.t)
    expect(r.y + 344 * r.scale).toBeLessThanOrEqual(short.b + 0.5)
  })
  it('also shrinks for width (node plus its port labels wider than the pane)', () => {
    const r = fitInArea({ l: -60, t: 150, r: 420, b: 400 }, area)!
    expect(r.scale).toBeCloseTo(374 / 480, 5)
    expect(inside(r, 480, 250)).toBe(true)
  })
  it('never zooms below the minimum: then the head of the node shows', () => {
    const tiny: Rect = { l: 8, t: 110, r: 382, b: 150 }
    const r = fitInArea({ l: 40, t: 200, r: 312, b: 544 }, tiny, [], { minScale: 0.5 })!
    expect(r.scale).toBe(0.5)
    expect(r.x).toBe(tiny.l)
    expect(r.y).toBe(tiny.t)
  })
  it('an empty area or an empty node asks for nothing', () => {
    expect(fitInArea({ l: 0, t: 0, r: 0, b: 0 }, area)).toBeNull()
    expect(fitInArea({ l: 0, t: 0, r: 10, b: 10 }, { l: 0, t: 100, r: 300, b: 100 })).toBeNull()
  })
})

describe('the queue button and a bottom sheet', () => {
  const size = { w: 52, h: 52 }
  it('a full-width sheet (phone): the button sits just above it, on its own edge', () => {
    const box = { w: 390, h: 788 }
    const sheet: Rect = { l: 0, t: 520, r: 390, b: 788 }
    const x = box.w - 52 - 12
    const at = nearestFree({ x, y: box.h - 52 - 12 }, size, { minX: x, maxX: x, minY: 12, maxY: box.h - 52 - 12 }, [sheet], { lockX: true })
    expect(at.x).toBe(x)
    expect(at.y).toBe(sheet.t - 52 - 10)
    expect(isFree(at.x, at.y, size, [sheet])).toBe(true)
  })
  it('a centred sheet on a desktop width: the corner is still free, the button stays; a wider sheet pushes it up', () => {
    const box = { w: 900, h: 620 }
    const x = box.w - 52 - 20, y = box.h - 52 - 20
    const range = { minX: x, maxX: x, minY: 20, maxY: y }
    const narrow: Rect = { l: 170, t: 440, r: 730, b: 620 }
    expect(nearestFree({ x, y }, size, range, [narrow], { lockX: true })).toEqual({ x, y })
    // 760 宽：抽屉的右边缘离圆钮不到 10px —— 以前就这么贴着
    const touching: Rect = { l: 276, t: 440, r: 836, b: 620 }
    const moved = nearestFree({ x, y }, size, range, [touching], { lockX: true })
    expect(moved.y).toBe(touching.t - 52 - 10)
    expect(isFree(moved.x, moved.y, size, [touching])).toBe(true)
  })
})
