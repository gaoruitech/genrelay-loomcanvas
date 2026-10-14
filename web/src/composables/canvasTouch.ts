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
 */

export interface TouchLike { identifier: number; clientX: number; clientY: number; pageX?: number; pageY?: number; target: EventTarget | null }

export interface PinchRouterOptions {
  /** d3-zoom 挂着的那个元素（.vue-flow__viewport）；还没渲染出来就返回 null */
  viewport: () => HTMLElement | null
  /** 正在做别的单指手势、不该被双指打断（从端口拉线） */
  busy?: () => boolean
}

const FORWARDED = '__lcForwarded'

function forward(target: EventTarget, type: string, touches: TouchLike[], changed: TouchLike[]) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries({ touches, targetTouches: touches, changedTouches: changed, [FORWARDED]: true })) {
    Object.defineProperty(e, k, { value: v, enumerable: true })
  }
  target.dispatchEvent(e)
}

const list = (l: ArrayLike<TouchLike> | undefined | null): TouchLike[] => (l ? Array.from(l) : [])

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
  let routing = false

  const inViewport = (t: TouchLike, vp: HTMLElement) => t.target instanceof Node && vp.contains(t.target)

  function onStart(ev: Event) {
    if ((ev as any)[FORWARDED]) return
    const e = ev as TouchEvent
    const touches = list(e.touches as any), changed = list(e.changedTouches as any)
    for (const t of changed) origin.set(t.identifier, { x: t.clientX, y: t.clientY })
    if (routing) { stop(e); return } // 第三根手指：不参与，也不往下传
    const vp = opts.viewport()
    if (touches.length < 2) {
      // 单指落在节点里能滚的框上：让浏览器滚它，d3-zoom / d3-drag 都不接
      if (vp && touches.length === 1 && inViewport(touches[0], vp) && inScrollableBox(e.target, vp)) e.stopPropagation()
      return
    }
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
    if (!routing || (ev as any)[FORWARDED]) return
    const e = ev as TouchEvent
    stop(e)
    const vp = opts.viewport()
    if (vp) forward(vp, 'touchmove', list(e.touches as any), list(e.changedTouches as any))
  }

  function onEnd(ev: Event) {
    if ((ev as any)[FORWARDED]) return
    const e = ev as TouchEvent
    const touches = list(e.touches as any), changed = list(e.changedTouches as any)
    for (const t of changed) origin.delete(t.identifier)
    if (!routing) return
    stop(e)
    const vp = opts.viewport()
    if (vp) forward(vp, 'touchend', touches, changed)
    if (!touches.length) { routing = false; origin.clear() }
  }

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
  return () => {
    root.removeEventListener('touchstart', onStart, o)
    root.removeEventListener('touchmove', onMove, o)
    root.removeEventListener('touchend', onEnd, o)
    root.removeEventListener('touchcancel', onEnd, o)
  }
}

/** 主要的指点设备是手指（手机、平板）。带触屏的笔记本主设备是鼠标，这里是 false，行为和纯鼠标一样 */
export function coarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
}
