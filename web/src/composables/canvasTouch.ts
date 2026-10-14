/**
 * 触屏上的画布手势：两根手指落在画布上，不管落在哪儿，都是「缩放 / 平移画布」。
 *
 * vue-flow 的画布手势是 d3-zoom 挂在视口元素上的 touch 监听；每个可拖动的节点另有自己的 d3-drag，
 * 手指一落在节点上，d3-drag 就把这次 touchstart 截住（stopImmediatePropagation），d3-zoom 根本不知道有这根手指。
 * 于是：两指都按在节点上 → 画布不缩放，节点被拖走；一指在空白、一指在节点 → 只平移、同时拖走节点。
 * 手机上节点占了大半屏，双指几乎总有一根落在节点上 —— 等于不能缩放。
 *
 * 这里在画布外层的捕获阶段接管：第二根手指落下的那一刻，
 *   1. 给已经按着的手指各补一个 touchcancel（坐标用它按下时的），让节点拖动 / 画布平移就地收尾 ——
 *      坐标不变，vue-flow 不会把它当成一次点击，也不会留下「拖了一半」的状态；
 *   2. 把这一下拦住，不再往下传（节点收不到第二根手指）；
 *   3. 以所有手指为准，直接在视口元素上给 d3-zoom 派一个 touchstart，之后的 touchmove / touchend 同样转过去，
 *      直到手指全部抬起。中途抬起一根，剩下那根接着平移画布，不会突然改成拖节点。
 * 转发用的是普通 Event 加上 touches / changedTouches 两个属性（d3 只读这两个）：TouchEvent 的构造函数不是哪儿都有。
 *
 * 不接管的情况：有手指按在画布之外（悬浮的工具条、面板）、正在从端口拉线（opts.busy）。
 *
 * 另管一件单指的事：手指落在节点里一个真能滚的框上（长文本、列表 —— 带 nowheel 的那些），这一下是滚它，不是平移画布。
 * 可编辑时本来就是这样（节点带 nopan，d3-zoom 不接）；只读时节点不可拖、不带 nopan，d3-zoom 会把这一下当成平移并拦掉滚动，
 * 长文本在手机上就读不完。这里把这次 touchstart 拦在画布之外（不 preventDefault），浏览器照常滚那个框。
 *
 * 还有长按：单指按住不动 LONG_PRESS_MS，开和右键一样的菜单（opts.longPress）。不靠浏览器的 contextmenu —— iOS Safari 长按不发它。
 * 挪开超过 LONG_PRESS_SLOP、落下第二根手指、手指抬起、有东西在滚，都取消。菜单开了之后这根手指的事件全部拦下，抬起时不补发 click。
 */

export interface TouchLike { identifier: number; clientX: number; clientY: number; pageX?: number; pageY?: number; target: EventTarget | null }

export interface LongPressAt { x: number; y: number; target: Element }

export interface PinchRouterOptions {
  /** d3-zoom 挂着的那个元素（.vue-flow__viewport）；还没渲染出来就返回 null */
  viewport: () => HTMLElement | null
  /** 正在做别的单指手势、不该被双指打断（从端口拉线） */
  busy?: () => boolean
  /**
   * 长按（单指按住 LONG_PRESS_MS 不动）：打开菜单，打开了返回 true。
   * 给了它，画布上由触摸引起的 contextmenu 一律拦掉 —— 菜单只从这里开：iOS Safari 长按根本不发 contextmenu，
   * 安卓 Chrome 发，两条路都开就会开两遍。没给就不管长按，contextmenu 照旧。
   */
  longPress?: (at: LongPressAt) => boolean
}

/** 按住多久算长按（和安卓的长按差不多） */
export const LONG_PRESS_MS = 500
/** 按住期间手指挪开超过这么多就不算长按了（和触屏上节点开始拖动的距离一致） */
export const LONG_PRESS_SLOP = 6
/** 长按不在这些东西上起作用：它们自己的长按有用（输入框里选字、按钮上的说明、端口上拉线、视频控件） */
const NO_LONG_PRESS = 'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], video, audio, .vue-flow__handle, .vue-flow__edge'

const FORWARDED = '__lcForwarded'

function forward(target: EventTarget, type: string, touches: TouchLike[], changed: TouchLike[]) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries({ touches, targetTouches: touches, changedTouches: changed, [FORWARDED]: true })) {
    Object.defineProperty(e, k, { value: v, enumerable: true })
  }
  target.dispatchEvent(e)
}

const list = (l: ArrayLike<TouchLike> | undefined | null): TouchLike[] => (l ? Array.from(l) : [])
const noop = () => {}

/**
 * 拿不掉的 touchmove（cancelable 为 false）：把它的 preventDefault 换成空的。
 * 画布是 touch-action: none，Chrome 知道浏览器自己不会滚，就把 touchmove 当成不可取消的发；d3 照样每次都 preventDefault，
 * Chrome 于是每一下都在控制台报「Ignored attempt to cancel a touchmove event with cancelable=false」。
 * 本来就取消不了，换掉它什么行为都不变，只是不再刷屏。在捕获阶段做，d3 的监听（冒泡阶段）拿到的就是换过的。
 */
export function quietUncancelable(e: Event) {
  if (!e.cancelable && e.preventDefault !== noop) Object.defineProperty(e, 'preventDefault', { value: noop, configurable: true })
}

/** target 在不在一个眼下真能滚的 .nowheel 框里（只看 root 以内） */
export function inScrollableBox(target: EventTarget | null, root: HTMLElement): boolean {
  let el = target instanceof Element ? target.closest('.nowheel') : null
  while (el && root.contains(el)) {
    const cs = getComputedStyle(el)
    if ((el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(cs.overflowY)) || (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(cs.overflowX))) return true
    el = el.parentElement ? el.parentElement.closest('.nowheel') : null
  }
  return false
}

/** 装到画布外层上；返回卸载函数 */
export function installPinchRouter(root: HTMLElement, opts: PinchRouterOptions): () => void {
  /** 每根手指按下时的位置：补 touchcancel 时用 */
  const origin = new Map<number, { x: number; y: number }>()
  /** 两指手势：所有触摸转给 d3-zoom */
  let routing = false
  /** 长按开了菜单：这根手指接下来的事件谁也不给（抬起时也不能补发 click —— 那会点在画布上把菜单关掉） */
  let swallowing = false
  /** 等着的长按 */
  let press: { id: number; x: number; y: number; target: Element; timer: ReturnType<typeof setTimeout> } | null = null
  /** 最近一次手指在画布上：这之后一会儿里来的 contextmenu 算是触摸引起的 */
  let touchedAt = -Infinity

  const inViewport = (t: TouchLike, vp: HTMLElement) => t.target instanceof Node && vp.contains(t.target)
  const cancelPress = () => { if (press) { clearTimeout(press.timer); press = null } }

  function firePress() {
    const p = press
    press = null
    if (!p || routing || !opts.longPress) return
    if (!opts.longPress({ x: p.x, y: p.y, target: p.target })) return
    // 菜单开了：这根手指按下时开始的节点拖动 / 画布平移就地收尾（坐标用按下时的：不算点击、不算拖过）
    forward(p.target, 'touchcancel', [], [{ identifier: p.id, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y, target: p.target }])
    swallowing = true
  }

  function onStart(ev: Event) {
    if ((ev as any)[FORWARDED]) return
    const e = ev as TouchEvent
    const touches = list(e.touches as any), changed = list(e.changedTouches as any)
    touchedAt = Date.now()
    for (const t of changed) origin.set(t.identifier, { x: t.clientX, y: t.clientY })
    if (swallowing || routing) { stop(e); return } // 菜单开着时又落下的手指 / 第三根手指：不参与，也不往下传
    const vp = opts.viewport()
    if (touches.length < 2) {
      if (!vp || touches.length !== 1 || !inViewport(touches[0], vp)) return
      // 单指落在节点里能滚的框上：让浏览器滚它，d3-zoom / d3-drag 都不接，也不算长按
      if (inScrollableBox(e.target, vp)) { e.stopPropagation(); return }
      const t = touches[0], target = e.target
      if (opts.longPress && target instanceof Element && !target.closest(NO_LONG_PRESS)) {
        cancelPress()
        press = { id: t.identifier, x: t.clientX, y: t.clientY, target, timer: setTimeout(firePress, LONG_PRESS_MS) }
      }
      return
    }
    cancelPress() // 第二根手指：是缩放，不是长按
    if (!vp || opts.busy?.() || !touches.every((t) => inViewport(t, vp))) return
    routing = true
    // 1. 已经按着的手指：各自就地收尾（节点的 d3-drag 在它自己身上，画布的 d3-zoom 在视口上，冒泡都能到）
    const fresh = new Set(changed.map((t) => t.identifier))
    for (const t of touches) {
      if (fresh.has(t.identifier) || !t.target) continue
      const o = origin.get(t.identifier) || { x: t.clientX, y: t.clientY }
      forward(t.target, 'touchcancel', [], [{ identifier: t.identifier, clientX: o.x, clientY: o.y, pageX: o.x, pageY: o.y, target: t.target }])
    }
    // 2. 这一下不往下传  3. 交给 d3-zoom
    stop(e)
    forward(vp, 'touchstart', touches, touches)
  }

  function onMove(ev: Event) {
    if ((ev as any)[FORWARDED]) return
    quietUncancelable(ev)
    const e = ev as TouchEvent
    if (press) {
      const id = press.id
      const t = list(e.changedTouches as any).find((x) => x.identifier === id)
      if (t && Math.hypot(t.clientX - press.x, t.clientY - press.y) > LONG_PRESS_SLOP) cancelPress()
    }
    if (swallowing) { stop(e); return }
    if (!routing) return
    stop(e)
    const vp = opts.viewport()
    if (vp) forward(vp, 'touchmove', list(e.touches as any), list(e.changedTouches as any))
  }

  function onEnd(ev: Event) {
    if ((ev as any)[FORWARDED]) return
    const e = ev as TouchEvent
    const touches = list(e.touches as any), changed = list(e.changedTouches as any)
    touchedAt = Date.now()
    for (const t of changed) origin.delete(t.identifier)
    if (press) { const id = press.id; if (changed.some((t) => t.identifier === id)) cancelPress() }
    if (swallowing) {
      stop(e)
      if (!touches.length) { swallowing = false; origin.clear() }
      return
    }
    if (!routing) return
    stop(e)
    const vp = opts.viewport()
    if (vp) forward(vp, 'touchend', touches, changed)
    if (!touches.length) { routing = false; origin.clear() }
  }

  /** 触摸引起的 contextmenu（安卓长按）：菜单由上面的计时器开，这一下不让 vue-flow 和浏览器再开一遍 */
  function onContextMenu(e: Event) {
    if (!opts.longPress) return
    const pe = e as PointerEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }
    if (pe.pointerType === 'mouse' || pe.pointerType === 'pen') return
    const fromTouch = pe.pointerType === 'touch' || !!pe.sourceCapabilities?.firesTouchEvents || Date.now() - touchedAt < 800
    if (!fromTouch) return
    e.preventDefault()
    e.stopPropagation()
  }

  /** 按着的时候有东西在滚（节点里的长文本被手指带着滚了）：也不算长按 */
  const onScroll = () => cancelPress()

  function stop(e: Event) {
    e.stopPropagation()
    // 同时拦掉浏览器自己的双指缩放，以及手指抬起后补发的那次 click
    if (e.cancelable) e.preventDefault()
  }

  const o = { capture: true, passive: false } as const
  root.addEventListener('touchstart', onStart, o)
  root.addEventListener('touchmove', onMove, o)
  root.addEventListener('touchend', onEnd, o)
  root.addEventListener('touchcancel', onEnd, o)
  root.addEventListener('contextmenu', onContextMenu, true)
  root.addEventListener('scroll', onScroll, true)
  return () => {
    cancelPress()
    root.removeEventListener('touchstart', onStart, o)
    root.removeEventListener('touchmove', onMove, o)
    root.removeEventListener('touchend', onEnd, o)
    root.removeEventListener('touchcancel', onEnd, o)
    root.removeEventListener('contextmenu', onContextMenu, true)
    root.removeEventListener('scroll', onScroll, true)
  }
}

/** 只要「别刷屏」那一条（分享页：节点不能拖，双指本来就归画布） */
export function installQuietTouchmoves(root: HTMLElement): () => void {
  const o = { capture: true, passive: true } as const
  root.addEventListener('touchmove', quietUncancelable, o)
  return () => root.removeEventListener('touchmove', quietUncancelable, o)
}

/** 主要的指点设备是手指（手机、平板）。带触屏的笔记本主设备是鼠标，这里是 false，行为和纯鼠标一样 */
export function coarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}
