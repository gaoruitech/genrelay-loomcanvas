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
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, type Ref } from 'vue'
import { clampNum, nearestFree, rectsIn, type Rect } from '@/utils/floatSpot'

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
/** 找空位时要绕开的固定悬浮块 */
const FIXED = '.ed-title, .ed-tools, .ed-hint, .vue-flow__minimap'

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
  /** 开始拖动：把开着的菜单收掉 */
  onDragStart: () => void
  /** 在把手上点了一下（没拖动） */
  onGripTap: () => void
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
  const range = () => ({ minX: EDGE, minY: EDGE, maxX: Math.max(EDGE, box.w - size.w - EDGE), maxY: Math.max(EDGE, box.h - size.h - EDGE) })
  function resolve(p: PalPos | null): { x: number; y: number } {
    if (!p) return { ...HOME }
    const g = range()
    return {
      x: p.dx === 'l' ? M : p.dx === 'r' ? box.w - size.w - M : g.minX + p.rx * (g.maxX - g.minX),
      y: p.dy === 't' ? M : p.dy === 'b' ? box.h - size.h - M : g.minY + p.ry * (g.maxY - g.minY),
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

  /** 按记下的位置重新摆一次（窗口变了、方向换了、别的悬浮块出现 / 消失之后） */
  function layout() {
    if (dragging.value || !measure()) return
    if (phone.value) {
      // 手机：位置由样式定，这里只把它量出来给「适应屏幕」和圆钮用
      const el = opts.el.value!
      xy.x = el.offsetLeft; xy.y = el.offsetTop
      return
    }
    const at = settle(resolve(pos.value), false)
    xy.x = Math.round(at.x); xy.y = Math.round(at.y)
  }

  // ---- 拖动：把手和面板的空白处都能拖；按钮上按下不算。挪过一小段才算拖，否则是点击 ----
  let grab: { id: number; sx: number; sy: number; ox: number; oy: number; moved: boolean; grip: boolean } | null = null
  function onDown(e: PointerEvent) {
    if (phone.value || (e.pointerType === 'mouse' && e.button !== 0)) return
    const target = e.target as HTMLElement
    const grip = !!target.closest('.pal-grip')
    if (!grip && target.closest('button')) return
    grab = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: xy.x, oy: xy.y, moved: false, grip }
    try { opts.el.value?.setPointerCapture(e.pointerId) } catch { /* 抓不住指针也能拖，只是出了面板就断 */ }
  }
  function onMove(e: PointerEvent) {
    if (!grab || e.pointerId !== grab.id) return
    const dx = e.clientX - grab.sx, dy = e.clientY - grab.sy
    if (!grab.moved) {
      if (Math.hypot(dx, dy) < DRAG_START) return
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
    const { moved, grip } = grab
    grab = null
    try { opts.el.value?.releasePointerCapture(e.pointerId) } catch { /* 已经放开了 */ }
    if (!moved) {
      if (released && grip) opts.onGripTap()
      return
    }
    dragging.value = false
    place({ x: xy.x, y: xy.y })
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
  onBeforeUnmount(() => {
    ro?.disconnect()
    mq?.removeEventListener('change', onMq)
    window.removeEventListener('resize', layout)
    if (timer !== null) clearTimeout(timer)
  })

  return { xy, size, box, rect, orient, phone, ready, dragging, isDefault, layout, onDown, onMove, onUp, nudge, toggleOrient, reset }
}
