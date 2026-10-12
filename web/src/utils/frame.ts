import { runtime, currentRoot } from '@/embed/runtime'

/**
 * 「画框」：position: fixed 的东西相对谁定位、能用多大一块地方。
 *
 * 独立应用里就是视口：原点 (0, 0)，宽高是 window.innerWidth / innerHeight。
 * 嵌进别人的页面时是本产品的根元素（它是 fixed 元素的包含块，见 base.css 的 .lc-embedded）：
 * 原点是它在视口里的左上角，宽高是它自己的。
 *
 * 所有「拿鼠标 / 元素的视口坐标去摆一个 fixed 浮层」的地方都要过一下这里：
 *   const f = frameOf(el)
 *   left = clientX - f.x            // 视口坐标 → 画框坐标
 *   maxLeft = f.w - 菜单宽 - 边距    // 原来写 window.innerWidth 的地方
 */
export interface Frame { x: number; y: number; w: number; h: number }

function viewportFrame(): Frame {
  return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }
}

/** el 所在的那个根的画框；不给 el（或它不在任何根里）就用当前活动的根 */
export function frameOf(el?: Element | null): Frame {
  if (!runtime.embedded) return viewportFrame()
  const root = (el && el.closest('.lc-root')) || currentRoot()
  if (!root || root === document.documentElement) return viewportFrame()
  const r = root.getBoundingClientRect()
  return { x: r.left, y: r.top, w: (root as HTMLElement).clientWidth || r.width, h: (root as HTMLElement).clientHeight || r.height }
}

/**
 * 键盘事件归不归这一个根管。
 * 独立应用：都归。嵌入：事件出在根里面，或者焦点不在任何输入位置上（落在 body 上）而用户最后操作的是这个根。
 * 这样宿主页面自己的输入框、别的嵌入实例里的按键，都不会被画布的快捷键截走。
 */
export function ownsKeyEvent(e: Event, root: HTMLElement | null | undefined): boolean {
  if (!runtime.embedded) return true
  if (!root) return false
  const target = e.target as Node | null
  if (target && root.contains(target)) return true
  const onPage = !target || target === document.body || target === document.documentElement || target === document || target === (window as unknown)
  return onPage && runtime.activeRoot === root
}
