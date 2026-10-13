import { describe, expect, it } from 'vitest'
import { PAL_CROSS, PAL_METRICS, PAL_NEAR, PAL_OVERFLOW, budgetSize, fitPalette, freeSpan, palFloor, palLength, planBudget, type PalPart } from '../src/composables/usePaletteDock'
import { isFree, nearestFree, type Rect } from '../src/utils/floatSpot'

/**
 * 画布工具面板在放不下时怎么收紧：
 *  - 放得下就原样；不够先换小一号；还不够按 fold 从大到小收进「更多工具」：
 *    工具 → 对话 → 视频 → 图片 → 文本 → 素材库 → 分享（各类节点在「+」里都有，先收；素材库和分享最后）；
 *  - 「+」和「更多」（没有 fold）永远留在面板上；
 *  - planBudget：整条在它该待的地方旁边有空位就不收（横排贴上边压着标题块 → 往下让一行；竖排差几个像素 → 往上靠），
 *    结果不取决于面板眼下多大；横排有个下限（palFloor）；
 *  - freeSpan 量出面板该待的那一段有多长：从默认位置往下到小地图为止，不把面板挤到别处去。
 */
const GROUPS: PalPart[][] = [
  [{ key: 'grip', kind: 'grip' }, { key: 'turn', kind: 'turn' }],
  [{ key: 'all' }],
  [{ key: 'text', fold: 3 }, { key: 'image', fold: 4 }, { key: 'video', fold: 5 }, { key: 'chat', fold: 6 }, { key: 'tools', fold: 7 }],
  [{ key: 'lib', fold: 2 }],
  [{ key: 'share', fold: 1 }, { key: 'more' }],
]
const FULL = palLength(GROUPS, false)
const COMPACT = palLength(GROUPS, true)
/** 收掉这些之后（类别那一组末尾多一颗展开钮）小一号有多长 */
const lengthWithout = (folded: string[]) => {
  const gone = new Set(folded)
  return palLength(GROUPS.map((g, i) => {
    const keep = g.filter((p) => !gone.has(p.key))
    return i === 2 && folded.length ? [...keep, { key: PAL_OVERFLOW }] : keep
  }), true)
}

describe('palLength', () => {
  it('adds up buttons, the grip, the orientation switch, separators and gaps', () => {
    const m = PAL_METRICS.normal
    // 9 颗按钮 + 把手 + 方向开关，5 组之间 4 条分隔线：一共 15 件，14 个间隙
    expect(FULL).toBe(m.pad * 2 + 2 + 9 * m.btn + m.grip + m.turn + 4 * m.hr + 14 * m.gap)
    expect(COMPACT).toBeLessThan(FULL)
  })
  it('skips empty groups together with their separator', () => {
    const noLib = GROUPS.map((g, i) => (i === 3 ? [] : g))
    const m = PAL_METRICS.normal
    expect(palLength(noLib, false)).toBe(FULL - m.btn - m.hr - 2 * m.gap)
  })
})

describe('fitPalette', () => {
  it('keeps the full palette when it fits (or when nothing was measured yet)', () => {
    expect(fitPalette(GROUPS, FULL)).toEqual({ compact: false, folded: [] })
    expect(fitPalette(GROUPS, Infinity)).toEqual({ compact: false, folded: [] })
    expect(fitPalette(GROUPS, 0)).toEqual({ compact: false, folded: [] })
    expect(fitPalette(GROUPS, Number.NaN)).toEqual({ compact: false, folded: [] })
  })
  it('first switches to the smaller buttons', () => {
    expect(fitPalette(GROUPS, FULL - 1)).toEqual({ compact: true, folded: [] })
    expect(fitPalette(GROUPS, COMPACT)).toEqual({ compact: true, folded: [] })
  })
  it('then folds tools away, highest fold first, never a single one', () => {
    const fit = fitPalette(GROUPS, COMPACT - 1)
    expect(fit.compact).toBe(true)
    // 只收一颗没有意义（省下的位置被展开钮占掉）：至少两颗，先收「工具」「对话」
    expect(fit.folded).toEqual(['tools', 'chat'])
    expect(lengthWithout(fit.folded)).toBeLessThanOrEqual(COMPACT - 1)
  })
  it('folds only as many as needed for the room there is', () => {
    for (let budget = COMPACT - 1; budget > 120; budget -= 7) {
      const fit = fitPalette(GROUPS, budget)
      const order = ['tools', 'chat', 'video', 'image', 'text', 'lib', 'share']
      expect(fit.folded).toEqual(order.slice(0, fit.folded.length))
      // 放得下；或者已经收到没得收了
      expect(lengthWithout(fit.folded) <= budget || fit.folded.length === order.length).toBe(true)
      // 少收一颗就放不下（收两颗是下限）
      if (fit.folded.length > 2) expect(lengthWithout(fit.folded.slice(0, -1))).toBeGreaterThan(budget)
    }
  })
  it('never folds the add button, "more", the grip or the orientation switch', () => {
    const fit = fitPalette(GROUPS, 10)
    expect(fit.folded).toEqual(['tools', 'chat', 'video', 'image', 'text', 'lib', 'share'])
    for (const key of ['all', 'more', 'grip', 'turn']) expect(fit.folded).not.toContain(key)
  })
  it('the library and share are the last to go: every node category folds before either of them', () => {
    // all five categories folded, the library and share still on the palette
    const cats = lengthWithout(['tools', 'chat', 'video', 'image', 'text'])
    expect(fitPalette(GROUPS, cats).folded).toEqual(['tools', 'chat', 'video', 'image', 'text'])
    // one pixel less: the library goes, share is still there
    expect(fitPalette(GROUPS, cats - 1).folded).toEqual(['tools', 'chat', 'video', 'image', 'text', 'lib'])
    for (let budget = COMPACT - 1; budget >= cats; budget--) {
      const { folded } = fitPalette(GROUPS, budget)
      expect(folded).not.toContain('lib')
      expect(folded).not.toContain('share')
    }
  })
  it('a read-only palette (nothing foldable but the library and share) still compacts', () => {
    const ro: PalPart[][] = [[{ key: 'grip', kind: 'grip' }, { key: 'turn', kind: 'turn' }], [{ key: 'ro' }], [], [{ key: 'lib', fold: 2 }], [{ key: 'share', fold: 1 }, { key: 'more' }]]
    expect(fitPalette(ro, palLength(ro, false))).toEqual({ compact: false, folded: [] })
    expect(fitPalette(ro, palLength(ro, false) - 1)).toEqual({ compact: true, folded: [] })
  })
})

describe('freeSpan', () => {
  const box = { w: 1376, h: 544 }
  const minimap = { l: 16, t: 418, r: 186, b: 524 }
  const title = { l: 16, t: 16, r: 396, b: 60 }
  it('from the home spot down to the minimap (start anchored)', () => {
    // 面板在 x 16..64，从 y=76 往下；小地图从 418 开始，四周留 10
    expect(freeSpan('v', { x: 16, y: 76 }, 48, 400, box, [title, minimap], 'start')).toBe(418 - 10 - 76)
  })
  it('down to the bottom edge when nothing is in the way', () => {
    expect(freeSpan('v', { x: 16, y: 76 }, 48, 400, box, [title], 'start')).toBe(box.h - 8 - 76)
    // 不在这一列上的障碍不算
    expect(freeSpan('v', { x: 600, y: 76 }, 48, 400, box, [title, minimap], 'start')).toBe(box.h - 8 - 76)
  })
  it('docked to the bottom / right edge it measures back to the previous obstacle (end anchored)', () => {
    const tools = { l: 440, t: 480, r: 930, b: 528 }
    // 竖排贴右边：这一列上没有障碍，从上边缘到自己的底
    expect(freeSpan('v', { x: 1312, y: 128 }, 48, 400, box, [title, tools], 'end')).toBe(128 + 400 - 8)
    // 横排贴底边、在工具条左边：从左边缘到自己的右端（工具条在它右边，不挡）
    expect(freeSpan('h', { x: 16, y: 480 }, 48, 300, box, [tools], 'end')).toBe(16 + 300 - 8)
  })
  it('floating in the middle it gets the whole gap it sits in', () => {
    const above = { l: 500, t: 100, r: 700, b: 140 }, below = { l: 500, t: 400, r: 700, b: 440 }
    expect(freeSpan('v', { x: 560, y: 200 }, 48, 120, box, [above, below], 'free')).toBe((400 - 10) - (140 + 10))
  })
  it('returns 0 when the whole band is taken', () => {
    expect(freeSpan('v', { x: 16, y: 76 }, 48, 400, box, [{ l: 0, t: 0, r: 200, b: 600 }], 'start')).toBe(0)
  })
})

describe('budgetSize: what the palette counts as when measuring how long it may be', () => {
  it('is never thinner than the normal size, whichever way it runs', () => {
    expect(PAL_CROSS).toBe(48)
    expect(budgetSize('v', { w: 40, h: 352 })).toEqual({ w: 48, h: 352 })
    expect(budgetSize('v', { w: 48, h: 436 })).toEqual({ w: 48, h: 436 })
    expect(budgetSize('h', { w: 352, h: 40 })).toEqual({ w: 352, h: 48 })
  })
  it('gives the same answer for the small and the normal size, so the two cannot keep swapping', () => {
    // 760-wide window, composer docked as a bottom sheet (68…628), palette on the right edge 16px from it:
    // the small palette (40 wide) clears the sheet by 12px, the normal one (48 wide) is 4px from it — inside the 10px gap.
    const box = { w: 696, h: 504 }
    const sheet = { l: 68, t: 222, r: 628, b: 504 }
    const at = (w: number) => ({ x: box.w - w - 16, y: 49 })
    // measured naively the two disagree: that was the loop
    expect(freeSpan('v', at(40), 40, 352, box, [sheet], 'free')).toBe(box.h - 16)
    expect(freeSpan('v', at(48), 48, 436, box, [sheet], 'free')).toBe(222 - 10 - 8)
    // measured the way the palette does it, both say "only the part above the sheet"
    const small = budgetSize('v', { w: 40, h: 352 }), normal = budgetSize('v', { w: 48, h: 436 })
    expect(freeSpan('v', at(small.w), small.w, small.h, box, [sheet], 'free')).toBe(222 - 10 - 8)
    expect(freeSpan('v', at(normal.w), normal.w, normal.h, box, [sheet], 'free')).toBe(222 - 10 - 8)
  })
})

describe('planBudget: how long the palette may be where it is meant to sit', () => {
  // the editor at a 1440-wide window (measured): title block top left, minimap bottom left, toolbar bottom centre
  const scene = (H: number, W = 1376) => {
    const box = { w: W, h: H }
    const title: Rect = { l: 16, t: 16, r: 550, b: 60 }
    const minimap: Rect = { l: 16, t: H - 126, r: 186, b: H - 20 }
    const tools: Rect = { l: W / 2 - 307, t: H - 68, r: W / 2 + 307, b: H - 20 }
    return { box, title, minimap, tools, obstacles: [title, minimap, tools] }
  }
  const HOME = { x: 16, y: 76 }
  const home = (H: number) => {
    const s = scene(H)
    return planBudget({ orient: 'v', box: s.box, obstacles: s.obstacles, anchor: 'start', want: () => HOME, full: FULL, compact: COMPACT })
  }
  /** where the palette of that size ends up (what layout() does with it) */
  const settle = (H: number, len: number, cross: number) => {
    const s = scene(H)
    const size = { w: cross, h: len }
    const at = nearestFree(HOME, size, { minX: 8, minY: 8, maxX: s.box.w - cross - 8, maxY: s.box.h - len - 8 }, s.obstacles)
    return { at, free: isFree(at.x, at.y, size, s.obstacles) }
  }

  it('at the home spot the full palette stays whole as long as it fits between the title block and the minimap', () => {
    // 1440×900 window (editor 844 high): plenty of room
    expect(home(844)).toBe(FULL)
    // 1440×700 (editor 644): from y=76 it would end 6px above the minimap — closer than the 10px every floating block keeps.
    // It still fits the gap: 4px higher (12px under the title block) there is room, so it is not made smaller…
    expect(home(644)).toBe(FULL)
    expect(fitPalette(GROUPS, home(644))).toEqual({ compact: false, folded: [] })
    // …and that is where it settles
    expect(settle(644, FULL, 48)).toEqual({ at: { x: 16, y: 72 }, free: true })
    // the shortest editor the full palette fits: title block (60) + 10 + 436 + 10 + minimap strip (126)
    expect(home(642)).toBe(FULL)
    expect(home(641)).toBe(COMPACT)
  })
  it('too short for the full one: smaller buttons, nothing folded, and no jump to the column beside the minimap', () => {
    // 1440×620 (editor 564): 378px between the title block and the minimap, the full palette is 436
    expect(home(564)).toBe(COMPACT)
    expect(fitPalette(GROUPS, home(564))).toEqual({ compact: true, folded: [] })
    expect(settle(564, COMPACT, 40)).toEqual({ at: HOME, free: true })
    // the full palette's nearest free spot is right of the minimap, 180px away: further than PAL_NEAR, so it is not taken
    const far = settle(564, FULL, 48)
    expect(far.at.x).toBeGreaterThan(HOME.x + PAL_NEAR)
    // the small one keeps everything down to editor height 558 (it too may slide up to 10px under the title block);
    // one pixel less and the first two categories fold
    expect(fitPalette(GROUPS, home(558))).toEqual({ compact: true, folded: [] })
    expect(fitPalette(GROUPS, home(557)).folded).toEqual(['tools', 'chat'])
  })
  it('a 520-high window keeps the library and share on the palette', () => {
    const fit = fitPalette(GROUPS, home(464))
    expect(fit.folded).toEqual(['tools', 'chat', 'video', 'image', 'text'])
    expect(lengthWithout(fit.folded)).toBeLessThanOrEqual(home(464))
  })
  it('horizontal, docked to the top edge on the title block: it drops one row and stays whole', () => {
    for (const W of [1376, 836, 696, 596]) {
      const s = scene(744, W)
      // centred along the top edge (rx 0.5), 16px from it
      const want = (sz: { w: number; h: number }) => ({ x: 8 + 0.5 * Math.max(0, W - sz.w - 16), y: 16 })
      const budget = planBudget({ orient: 'h', box: s.box, obstacles: s.obstacles, anchor: 'free', want, full: FULL, compact: COMPACT })
      expect(budget).toBe(FULL)
      // …where the row under the title block is free
      const size = { w: FULL, h: 48 }
      const at = nearestFree(want(size), size, { minX: 8, minY: 8, maxX: W - FULL - 8, maxY: 744 - 48 - 8 }, s.obstacles)
      expect(at.y).toBe(70)
      expect(isFree(at.x, at.y, size, s.obstacles)).toBe(true)
    }
  })
  it('horizontal, docked to the bottom edge on the toolbar: it steps above the toolbar and stays whole', () => {
    const s = scene(744, 836)
    const want = (sz: { w: number; h: number }) => ({ x: 8 + 0.5 * (836 - sz.w - 16), y: 744 - sz.h - 16 })
    expect(planBudget({ orient: 'h', box: s.box, obstacles: s.obstacles, anchor: 'free', want, full: FULL, compact: COMPACT })).toBe(FULL)
  })
  it('takes no input about how big the palette is right now: with neither unfolded size fitting, it is the free stretch below the home spot', () => {
    // home spot (76) down to 10px above the minimap, minus the 1px of slack
    expect(home(464)).toBe(464 - 126 - 10 - 76 - 1)
    expect(home(400)).toBe(400 - 126 - 10 - 76 - 1)
  })
  it('an editor smaller than the palette itself never counts as fitting', () => {
    const s = scene(300, 300)
    const budget = planBudget({ orient: 'v', box: s.box, obstacles: [], anchor: 'start', want: () => HOME, full: FULL, compact: COMPACT })
    expect(budget).toBeLessThan(COMPACT)
  })
})

describe('palFloor: the shortest a horizontal palette is asked to be', () => {
  it('only the last two node categories folded; everything else stays in the row', () => {
    expect(palFloor(GROUPS)).toBe(lengthWithout(['tools', 'chat']))
    expect(fitPalette(GROUPS, palFloor(GROUPS)).folded).toEqual(['tools', 'chat'])
  })
  it('a read-only palette has no categories: nothing folds in a row', () => {
    const ro: PalPart[][] = [[{ key: 'grip', kind: 'grip' }, { key: 'turn', kind: 'turn' }], [{ key: 'ro' }], [], [{ key: 'lib', fold: 2 }], [{ key: 'share', fold: 1 }, { key: 'more' }]]
    expect(palFloor(ro)).toBe(palLength(ro, true))
    expect(fitPalette(ro, palFloor(ro))).toEqual({ compact: true, folded: [] })
  })
})
