import { runtime } from '@/embed/runtime'
import { frameOf } from '@/utils/frame'
import { lcLocal } from '@/utils/storage'
/**
 * 画布工具面板的位置与方向：可以拖到编辑区里任何地方，可以在竖排 / 横排之间切换。
 *
 * 位置记的是「贴哪条边，或者在可用范围里的比例」，不是像素 —— 窗口变大变小、侧栏收起展开、
 * 进出沉浸式之后还在同一个相对位置上。null = 默认位置（左边、标题块下面）。方向单独记。
 * 两样都只存在这个浏览器里。
 *
 * 放下时：离某条边或默认位置 12px 以内就吸过去；压着别的固定悬浮块（标题、底部工具条、
 * 小地图、属性面板、提示条、生成队列圆钮）就挪到离得最近的空地。方向只由开关改，
 * 拖到上边 / 下边不会自己转。
 *
 * 手机宽度下面板是固定的一横条（样式里写死），这里只负责量出它占的矩形。
 *
 * 编辑区很矮（笔记本上开着开发者工具、嵌在别人页面的一小块里）时，整条面板在它该待的那一段里放不下。
 * 以前的结果是被「找最近的空地」挤到小地图旁边去；现在先算出它能有多长（budget，见 planBudget），调用方按这个数把
 * 面板收紧 —— 先换小一号的按钮，还不够就把几类节点收进「更多工具」（fitPalette）。
 * 只在真放不下的时候才收：整条面板在它该待的地方旁边（挪开不超过自己一条的宽度）有空位，就原样摆过去。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch, type Ref } from 'vue'
import { clampNum, isFree, nearestFree, rectsIn, type Rect } from '@/utils/floatSpot'
import { TIP_HOLD_MS } from '@/directives/tip'

export type PalOrient = 'v' | 'h'
/** dx / dy：贴着哪条边；null = 不贴边，按 rx / ry（0–1）在可用范围里取 */
interface PalPos { dx: 'l' | 'r' | null; dy: 't' | 'b' | null; rx: number; ry: number }

const POS_KEY = 'lc-pal-pos'
const ORIENT_KEY = 'lc-pal-orient'
/** 贴边时离边的距离（和标题块、小地图同一个边距） */
const M = 16
/** 不贴边时最少离边这么远 */
const EDGE = 8
/** 默认位置：左边，标题块下面 */
const HOME = { x: 16, y: 76 }
const SNAP = 12
const DRAG_START = 5
/** 手指 / 手写笔点一下本来就会晃几个像素：挪过这么远才算拖 */
const DRAG_START_TOUCH = 10
/** 把手上连点两下复位的间隔（只认鼠标：触屏上点开菜单再点一下收起太容易凑成「双击」） */
const DOUBLE_TAP_MS = 350
/** 找空位时要绕开的固定悬浮块 */
const FIXED = '.ed-title, .clb, .ed-tools, .ed-hint, .vue-flow__minimap'

/* ---------- 面板放不下时怎么收紧（纯函数，web/test/palette-fit.test.ts 里有测） ---------- */

/** 面板上的一颗按钮。fold：放不下时可以收进「更多工具」，数字大的先收；不写 = 永远留在面板上 */
export interface PalPart { key: string; kind?: 'grip' | 'turn'; fold?: number }
export interface PalFit {
  /** 小一号的按钮和间距 */
  compact: boolean
  /** 收进「更多工具」的那些按钮的 key（面板上换成一颗展开钮） */
  folded: string[]
}
/** 两档尺寸，和 Canvas.vue 里 .ed-pal / .ed-pal.compact 的样式是同一组数（改一边要改另一边） */
export const PAL_METRICS = {
  normal: { pad: 6, gap: 4, btn: 34, grip: 16, turn: 24, hr: 5 },
  compact: { pad: 4, gap: 2, btn: 30, grip: 12, turn: 20, hr: 3 },
} as const
/** 「更多工具」那颗展开钮在分组里的 key */
export const PAL_OVERFLOW = 'over'
/** 正常那一档的面板有多粗（垂直于排布方向，含边框） */
export const PAL_CROSS = PAL_METRICS.normal.pad * 2 + PAL_METRICS.normal.btn + 2
/**
 * 量「这个位置上能用多长」时面板按多大算：粗细至少是正常那一档，不按眼下的。
 * 小一号的面板窄 8px，旁边的障碍（贴底的抽屉、底部工具条的一头）离得正好的时候，窄的那档量出来「整段都空着」→ 换回
 * 正常一档 → 宽了 8px 又碰着障碍 →「只剩一小段」→ 又换小一号……来回翻，停在哪一步算哪一步（760 宽、抽屉开着、面板
 * 贴右边时停在了「正常一档的尺寸 + 小一号的位置」：伸出编辑区下沿）。量的结果不能取决于量完之后会变的东西。
 */
export function budgetSize(orient: PalOrient, size: { w: number; h: number }): { w: number; h: number } {
  return orient === 'v' ? { w: Math.max(size.w, PAL_CROSS), h: size.h } : { w: size.w, h: Math.max(size.h, PAL_CROSS) }
}

/** 这样分组、这一档尺寸，面板沿排布方向有多长（含自己的边框）。组与组之间有一条分隔线 */
export function palLength(groups: PalPart[][], compact: boolean): number {
  const m = PAL_METRICS[compact ? 'compact' : 'normal']
  const live = groups.filter((g) => g.length)
  const parts = live.reduce((n, g) => n + g.length, 0) + Math.max(0, live.length - 1)
  const items = live.reduce((sum, g) => sum + g.reduce((s, p) => s + (p.kind === 'grip' ? m.grip : p.kind === 'turn' ? m.turn : m.btn), 0), 0)
  return m.pad * 2 + 2 + items + Math.max(0, live.length - 1) * m.hr + Math.max(0, parts - 1) * m.gap
}

/**
 * 在 budget 这么长的一段里，面板该怎么排：能原样放下就原样；否则换小一号；还不够就按 fold 从大到小
 * 一颗颗收进「更多工具」（收了任何一颗，overflowAt 那一组末尾就多出一颗展开钮）。
 * 先收哪颗由调用方的 fold 定（Canvas.vue 的 PAL_FOLD）：先是各类节点 —— 「+」里本来就有全部节点，收掉的只是捷径；
 * 素材库和分享是各自唯一的入口，留到最后。
 * 收到没得收还是放不下时返回最紧的那一种 —— 剩下的交给面板自己找空地。
 */
export function fitPalette(groups: PalPart[][], budget: number, overflowAt = 2): PalFit {
  if (!(budget > 0) || !Number.isFinite(budget) || palLength(groups, false) <= budget) return { compact: false, folded: [] }
  if (palLength(groups, true) <= budget) return { compact: true, folded: [] }
  const order = groups.flat().filter((p) => p.fold != null).sort((a, b) => (b.fold as number) - (a.fold as number))
  const folded: string[] = []
  for (const p of order) {
    folded.push(p.key)
    // 只收一颗没有意义：省下的位置正好被展开钮占掉
    if (folded.length < 2 && order.length > 1) continue
    const gone = new Set(folded)
    const left = groups.map((g, i) => {
      const keep = g.filter((x) => !gone.has(x.key))
      return i === overflowAt ? [...keep, { key: PAL_OVERFLOW }] : keep
    })
    if (palLength(left, true) <= budget) break
  }
  return { compact: true, folded }
}

/**
 * 一条 cross 宽的带子从 at 开始沿 axis 方向摆，在不压障碍的前提下能用多长。
 *   anchor = start  起点钉在 at（默认位置、贴上边 / 左边）：从 at 到下一个障碍
 *   anchor = end    终点钉在 at + len（贴下边 / 右边）：从上一个障碍到终点
 *   anchor = free   不贴边：at 所在的那一整段空档
 * at 正好落在障碍里时，取离它最近的那段空档。
 */
export function freeSpan(
  axis: PalOrient, at: { x: number; y: number }, cross: number, len: number,
  box: { w: number; h: number }, obstacles: Rect[], anchor: 'start' | 'end' | 'free', gap = 10, edge = EDGE,
): number {
  const v = axis === 'v'
  const band = v ? [at.x, at.x + cross] : [at.y, at.y + cross]
  const lo = edge, hi = (v ? box.h : box.w) - edge
  const blocks = obstacles
    .filter((r) => (v ? r.r > band[0] - gap && r.l < band[1] + gap : r.b > band[0] - gap && r.t < band[1] + gap))
    .map((r) => (v ? [r.t - gap, r.b + gap] : [r.l - gap, r.r + gap]))
    .sort((a, b) => a[0] - b[0])
  const free: number[][] = []
  let cur = lo
  for (const [s, e] of blocks) {
    if (s > cur) free.push([cur, Math.min(s, hi)])
    cur = Math.max(cur, e)
    if (cur >= hi) break
  }
  if (cur < hi) free.push([cur, hi])
  if (!free.length) return 0
  const start = v ? at.y : at.x
  const p = anchor === 'start' ? start : anchor === 'end' ? start + len : start + len / 2
  const dist = (f: number[]) => (p < f[0] ? f[0] - p : p > f[1] ? p - f[1] : 0)
  const seg = free.reduce((a, b) => (dist(b) < dist(a) ? b : a))
  if (dist(seg) > 0) return seg[1] - seg[0]
  return anchor === 'start' ? seg[1] - p : anchor === 'end' ? p - seg[0] : seg[1] - seg[0]
}

/** 面板为了让开障碍最多挪这么远还算「在原地」：自己一条的宽度，加上两边的留白。再远就是跳到别处去了 */
export const PAL_NEAR = PAL_CROSS + 20

/** 面板沿排布方向 len 这么长时占多大（cross：垂直于排布方向的粗细） */
const palSize = (orient: PalOrient, len: number, cross: number) => (orient === 'v' ? { w: cross, h: len } : { w: len, h: cross })

/**
 * 面板在它该待的地方能有多长。结果只取决于「想放哪、编辑区多大、障碍在哪、整条有多长」，不取决于面板眼下的尺寸 ——
 * 量的结果要是跟着量完之后会变的东西走，收紧 → 变短 → 又量出放得下 → 展开 → 又放不下……就停不下来。
 *
 *  1. 整条（正常那一档）在想放的位置旁边有空位（让开障碍挪不超过 PAL_NEAR）：原样，返回 full。
 *     横排贴在上边、正好压着标题块：往下让一行就是整行空地，不该为了挤在标题块右边那一小段里把按钮收掉；
 *     竖排在默认位置、离小地图只差几个像素：往上靠一点（标题块下面还有留白）就放下了。
 *  2. 整条放不下、小一号的那一档（一颗不收）放得下：返回 compact。
 *  3. 都不行：想放的那个位置上、沿排布方向空着的那一段有多长（freeSpan），调用方照这个数往「更多工具」里收。
 *     竖排在默认位置上放不下时不会跳到小地图右边去 —— 那是另一列了，离人放它的地方太远。
 *
 * want(size)：这么大的面板想放在哪（贴右 / 下边、按比例摆时，位置跟着尺寸变）。
 */
export function planBudget(o: {
  orient: PalOrient
  box: { w: number; h: number }
  obstacles: Rect[]
  anchor: 'start' | 'end' | 'free'
  want: (size: { w: number; h: number }) => { x: number; y: number }
  /** 正常一档、小一号一档各有多长（一颗不收） */
  full: number
  compact: number
}): number {
  const fits = (len: number, cross: number) => {
    const sz = palSize(o.orient, len, cross)
    const range = { minX: EDGE, minY: EDGE, maxX: o.box.w - sz.w - EDGE, maxY: o.box.h - sz.h - EDGE }
    if (range.maxX < range.minX || range.maxY < range.minY) return false
    const at = o.want(sz)
    const to = nearestFree(at, sz, range, o.obstacles)
    return isFree(to.x, to.y, sz, o.obstacles) && Math.hypot(to.x - at.x, to.y - at.y) <= PAL_NEAR
  }
  if (fits(o.full, PAL_CROSS)) return o.full
  const small = PAL_METRICS.compact.pad * 2 + PAL_METRICS.compact.btn + 2
  if (fits(o.compact, small)) return o.compact
  // 按小一号那一档的长度定位、按正常一档的粗细量（见 budgetSize）
  const sz = budgetSize(o.orient, palSize(o.orient, o.compact, small))
  const v = o.orient === 'v'
  const span = freeSpan(o.orient, o.want(sz), v ? sz.w : sz.h, v ? sz.h : sz.w, o.box, o.obstacles, o.anchor)
  // 贴边时离边是 M 不是 EDGE：把多算的那一截扣掉
  return Math.floor(span - (o.anchor === 'end' ? M - EDGE : 0)) - 1
}

/**
 * 横排最短收到哪：只把最靠后的两类节点（工具、对话）收进「更多工具」，别的都留着。
 * 横排的面板一行就那么高，再短下去省不出什么地方，只剩三四颗按钮挤成一小段反而难用；这个长度还放不下时，
 * 它自己去找最近的空地（一行总比一列好找）。只读的面板没有节点类别：一颗不收。
 */
export function palFloor(groups: PalPart[][], overflowAt = 2): number {
  const first = (groups[overflowAt] || []).filter((p) => p.fold != null).sort((a, b) => (b.fold as number) - (a.fold as number)).slice(0, 2)
  if (first.length < 2) return palLength(groups, true)
  const gone = new Set(first.map((p) => p.key))
  return palLength(groups.map((g, i) => {
    const keep = g.filter((x) => !gone.has(x.key))
    return i === overflowAt ? [...keep, { key: PAL_OVERFLOW }] : keep
  }), true)
}

function loadPos(): PalPos | null {
  try {
    const v = JSON.parse(lcLocal.getItem(POS_KEY) || 'null')
    if (!v || !Number.isFinite(v.rx) || !Number.isFinite(v.ry)) return null
    return {
      dx: v.dx === 'l' || v.dx === 'r' ? v.dx : null,
      dy: v.dy === 't' || v.dy === 'b' ? v.dy : null,
      rx: clampNum(Number(v.rx), 0, 1),
      ry: clampNum(Number(v.ry), 0, 1),
    }
  } catch { return null }
}
function loadOrient(): PalOrient {
  try { return lcLocal.getItem(ORIENT_KEY) === 'h' ? 'h' : 'v' } catch { return 'v' }
}

export function usePaletteDock(opts: {
  host: Ref<HTMLElement | null>
  el: Ref<HTMLElement | null>
  /** 不在 DOM 里量的障碍（属性面板带入场动画，量出来是偏的，由调用方按数算） */
  extraObstacles: () => Rect[]
  /** 眼下这些按钮一颗不收时面板有多长：正常一档、小一号一档；横排最短收到多长（见 planBudget / palFloor） */
  lengths: () => { full: number; compact: number; floor: number }
  /** 开始拖动：把开着的菜单收掉 */
  onDragStart: () => void
  /** 在把手上点了一下（没拖动） */
  onGripTap: () => void
  /** 用鼠标在把手上连点了两下 */
  onGripDouble: () => void
}) {
  const pos = ref<PalPos | null>(loadPos())
  const savedOrient = ref<PalOrient>(loadOrient())
  const phone = ref(false)
  /** 实际排布方向：手机上固定横排 */
  const orient = computed<PalOrient>(() => (phone.value ? 'h' : savedOrient.value))
  const xy = reactive({ x: HOME.x, y: HOME.y })
  const size = reactive({ w: 48, h: 400 })
  const box = reactive({ w: 0, h: 0 })
  const ready = ref(false)
  const dragging = ref(false)
  /** 沿排布方向、眼下该待的那个位置上能用多长；还没量过（或手机上）是 Infinity */
  const budget = ref(Infinity)

  /** 面板眼下占的矩形（相对编辑区）。还没量过时是 null */
  const rect = computed<Rect | null>(() => (box.w ? { l: xy.x, t: xy.y, r: xy.x + size.w, b: xy.y + size.h } : null))

  function save() {
    try {
      if (pos.value) lcLocal.setItem(POS_KEY, JSON.stringify(pos.value))
      else lcLocal.removeItem(POS_KEY)
      if (savedOrient.value === 'h') lcLocal.setItem(ORIENT_KEY, 'h')
      else lcLocal.removeItem(ORIENT_KEY)
    } catch { /* 存不上就只在这次有效 */ }
  }

  function measure(): boolean {
    const host = opts.host.value, el = opts.el.value
    if (!host || !el) return false
    box.w = host.clientWidth; box.h = host.clientHeight
    size.w = el.offsetWidth; size.h = el.offsetHeight
    return box.w > 0 && box.h > 0
  }
  const range = (sz: { w: number; h: number } = size) => ({ minX: EDGE, minY: EDGE, maxX: Math.max(EDGE, box.w - sz.w - EDGE), maxY: Math.max(EDGE, box.h - sz.h - EDGE) })
  function resolve(p: PalPos | null, sz: { w: number; h: number } = size): { x: number; y: number } {
    if (!p) return { ...HOME }
    const g = range(sz)
    return {
      x: p.dx === 'l' ? M : p.dx === 'r' ? box.w - sz.w - M : g.minX + p.rx * (g.maxX - g.minX),
      y: p.dy === 't' ? M : p.dy === 'b' ? box.h - sz.h - M : g.minY + p.ry * (g.maxY - g.minY),
    }
  }
  function encode(at: { x: number; y: number }): PalPos | null {
    if (Math.abs(at.x - HOME.x) < 1 && Math.abs(at.y - HOME.y) < 1) return null
    const g = range()
    const right = box.w - size.w - M, bottom = box.h - size.h - M
    return {
      dx: Math.abs(at.x - M) < 1 ? 'l' : Math.abs(at.x - right) < 1 ? 'r' : null,
      dy: Math.abs(at.y - M) < 1 ? 't' : Math.abs(at.y - bottom) < 1 ? 'b' : null,
      rx: g.maxX > g.minX ? clampNum((at.x - g.minX) / (g.maxX - g.minX), 0, 1) : 0,
      ry: g.maxY > g.minY ? clampNum((at.y - g.minY) / (g.maxY - g.minY), 0, 1) : 0,
    }
  }
  function settle(want: { x: number; y: number }, withQueue: boolean): { x: number; y: number } {
    const obs = [...rectsIn(opts.host.value, withQueue ? FIXED + ', .qf' : FIXED), ...opts.extraObstacles()]
    return nearestFree(want, size, range(), obs)
  }

  /**
   * 算一下该待的位置上面板能有多长（调用方据此收紧面板；面板的尺寸一变会再回到 layout）。
   * 不看面板眼下多大（见 planBudget）：收紧 / 展开之后再算一遍还是同一个数，不会来回翻。
   */
  function measureBudget() {
    if (phone.value || !box.w || !box.h) { budget.value = Infinity; return }
    const v = orient.value === 'v'
    const p = pos.value
    const dock = v ? p?.dy : p?.dx
    const anchor = !p || dock === 't' || dock === 'l' ? 'start' : dock ? 'end' : 'free'
    const obstacles = [...rectsIn(opts.host.value, FIXED), ...opts.extraObstacles()]
    const len = opts.lengths()
    let next = planBudget({ orient: orient.value, box, obstacles, anchor, want: (sz) => resolve(p, sz), full: len.full, compact: len.compact })
    // 横排有个下限：再短就不收了，放不下由它自己找空地
    if (!v) next = Math.max(next, len.floor)
    if (next !== budget.value) budget.value = next
  }

  /** 按记下的位置重新摆一次（窗口变了、方向换了、别的悬浮块出现 / 消失之后） */
  function layout() {
    if (dragging.value || !measure()) return
    if (phone.value) {
      // 手机：位置由样式定，这里只把它量出来给「适应屏幕」和圆钮用
      const el = opts.el.value!
      xy.x = el.offsetLeft; xy.y = el.offsetTop
      budget.value = Infinity
      return
    }
    measureBudget()
    const at = settle(resolve(pos.value), false)
    xy.x = Math.round(at.x); xy.y = Math.round(at.y)
  }

  // ---- 拖动：把手和面板的空白处都能拖；按钮上按下不算。挪过一小段才算拖，否则是点击 ----
  let grab: { id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean; grip: boolean; at: number; touch: boolean; holder: HTMLElement | null } | null = null
  let gripTapAt = 0
  function onDown(e: PointerEvent) {
    if (phone.value || (e.pointerType === 'mouse' && e.button !== 0)) return
    const target = e.target as HTMLElement
    const gripEl = target.closest<HTMLElement>('.pal-grip')
    const grip = !!gripEl
    if (!grip && target.closest('button')) return
    // 指针抓在按下的那个元素上（把手，或面板自己）：事件照样冒泡到面板。抓在面板上的话，把手就收不到后面的
    // 移动 / 松手 —— 它身上「按住看提示」的计时停不下来，手指拖完了提示才冒出来、还不走
    const holder = gripEl || opts.el.value
    grab = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: xy.x, oy: xy.y, moved: false, grip, at: Date.now(), touch: e.pointerType !== 'mouse', holder }
    try { holder?.setPointerCapture(e.pointerId) } catch { /* 抓不住指针也能拖，只是出了面板就断 */ }
  }
  function onMove(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return
    const dx = e.clientX - grab.sx, dy = e.clientY - grab.sy
    if (!grab.moved) {
      if (Math.hypot(dx, dy) < (grab.touch ? DRAG_START_TOUCH : DRAG_START)) return
      grab.moved = true
      measure()
      dragging.value = true
      opts.onDragStart()
    }
    const g = range()
    xy.x = clampNum(grab.ox + dx, g.minX, g.maxX)
    xy.y = clampNum(grab.oy + dy, g.minY, g.maxY)
  }
  function onUp(e: PointerEvent, released: boolean) {
    if (!grab || e.pointerId !== grab.id) return
    const { moved, grip, at, touch, holder } = grab
    grab = null
    try { holder?.releasePointerCapture(e.pointerId) } catch { /* 已经放开了 */ }
    if (!moved) {
      if (!released || !grip) return
      // 触屏上按住不动是在看提示（v-tip），松手不算点
      if (touch && Date.now() - at >= TIP_HOLD_MS) return
      // 鼠标紧接着再点一下 = 双击复位；触屏不认双击（点开菜单再点一下收起，太容易凑成一次）
      const now = Date.now()
      if (!touch && now - gripTapAt < DOUBLE_TAP_MS) { gripTapAt = 0; opts.onGripDouble(); return }
      gripTapAt = now
      opts.onGripTap()
      return
    }
    dragging.value = false
    if (released) place({ x: xy.x, y: xy.y })
    // 拖到一半被系统打断（来电、手势、切了应用）：不算放下，回到拖之前记着的位置
    else layout()
  }
  /** 放在 at：吸边 / 吸回默认位置，绕开别的悬浮块，然后记下来 */
  function place(at: { x: number; y: number }) {
    measure()
    const g = range()
    let { x, y } = at
    if (Math.abs(x - HOME.x) <= SNAP && Math.abs(y - HOME.y) <= SNAP) {
      x = HOME.x; y = HOME.y
    } else {
      const right = box.w - size.w - M, bottom = box.h - size.h - M
      if (x <= M + SNAP) x = M
      else if (x >= right - SNAP) x = right
      if (y <= M + SNAP) y = M
      else if (y >= bottom - SNAP) y = bottom
    }
    const to = settle({ x: clampNum(x, g.minX, g.maxX), y: clampNum(y, g.minY, g.maxY) }, true)
    xy.x = Math.round(to.x); xy.y = Math.round(to.y)
    pos.value = encode(xy)
    save()
    // 新位置上能用的长度可能不一样（从挤的地方拖到宽敞处会展开，反过来会收紧）：重量一次，尺寸变了再摆一遍
    const before = budget.value
    measureBudget()
    if (budget.value !== before) void nextTick(() => nextTick(layout))
  }
  /** 键盘挪动（把手上按 Shift + 方向键） */
  function nudge(dx: number, dy: number) {
    if (phone.value) return
    place({ x: xy.x + dx, y: xy.y + dy })
  }

  function toggleOrient() {
    if (phone.value) return
    savedOrient.value = savedOrient.value === 'v' ? 'h' : 'v'
    save()
    // 换了方向尺寸就变了：等它排好再夹回编辑区里
    void nextTick(layout)
  }
  /** 回到默认：左边、竖排 */
  function reset() {
    pos.value = null
    savedOrient.value = 'v'
    save()
    void nextTick(layout)
  }
  const isDefault = computed(() => !pos.value && savedOrient.value === 'v')

  let ro: ResizeObserver | null = null
  let mq: MediaQueryList | null = null
  let timer: number | null = null
  // 「手机宽度」：独立应用看浏览器窗口；嵌进别人的页面时看编辑区自己有多宽（和样式里的 @container 是同一个判断）
  const isPhone = () => (runtime.embedded ? frameOf(opts.host.value).w <= 640 : !!mq?.matches)
  const onMq = () => { phone.value = isPhone(); void nextTick(layout) }
  onMounted(() => {
    mq = window.matchMedia('(max-width: 640px)')
    phone.value = isPhone()
    mq.addEventListener('change', onMq)
    void nextTick(layout)
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { if (runtime.embedded && phone.value !== isPhone()) onMq(); else layout() })
      if (opts.host.value) ro.observe(opts.host.value)
      if (opts.el.value) ro.observe(opts.el.value)
    }
    window.addEventListener('resize', layout)
    // 标题块、底部工具条的宽度要等字体和文案就位才定；定下来之后再摆一次，然后才开过渡动画
    timer = window.setTimeout(() => { layout(); ready.value = true; timer = null }, 350)
  })
  /**
   * 面板这个元素会被换掉：团队画布拿编辑锁的那一下、只读和可编辑之间来回切，模板里的 v-if 都会把它卸掉再挂一个新的。
   * 尺寸观察器要跟到新元素上 —— 以前它一直盯着最早的那个（已经不在页面上了），之后面板再怎么变高变矮（收进「更多工具」、
   * 展开回来）都没人重新量、重新摆：记着的还是旧尺寸，于是压着底部工具条、生成队列圆钮也以为它还是原来那么矮。
   */
  watch(opts.el, (el, old) => {
    if (ro) {
      if (old) ro.unobserve(old)
      if (el) ro.observe(el)
    }
    if (el) void nextTick(layout)
  }, { flush: 'post' })
  onBeforeUnmount(() => {
    ro?.disconnect()
    mq?.removeEventListener('change', onMq)
    window.removeEventListener('resize', layout)
    if (timer !== null) clearTimeout(timer)
  })

  return { xy, size, box, rect, orient, phone, ready, dragging, isDefault, budget, layout, onDown, onMove, onUp, nudge, toggleOrient, reset }
}
