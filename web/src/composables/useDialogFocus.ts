import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

/**
 * 弹窗的键盘与焦点：全站的弹窗 / 贴底面板共用这一份（共用壳 components/team/TeamDialog.vue 已经接好；
 * 用不了那个壳的弹窗自己调 useDialogFocus）。
 *
 *  - 打开时焦点进弹窗：带 data-autofocus / autofocus 的元素，没有就第一个输入控件，再没有就弹窗自己；
 *  - Tab / Shift+Tab 只在弹窗里循环；焦点被别的代码挪到弹窗外面时拉回来；
 *  - Esc 关掉最上面那一层（busy 时不关）。属于弹窗的弹出层（LcSelect 的列表、「更多」菜单、确认气泡、
 *    TDesign 的日历）还开着时，这一下 Esc 是给那个弹出层的，弹窗不动；
 *  - 关掉后焦点还给打开它的那个元素；它已经不在了就给 fallbackFocus。还的那一下没落上（元素还灰着），
 *    或者刚还完那个元素就被拿掉了，等这一轮界面更新完会再还一次，焦点不会掉回页面开头；
 *  - 弹窗摞弹窗：只有最上面一层管键盘，关掉以后下面一层接着管。
 *
 * 滚动：页面本身（.lc-root）不滚，滚的是外壳里的 .lc-page；弹窗都 Teleport 到了 $lcPortal，滚轮不会串到页面上，
 * 所以这里不需要再锁滚动（遮罩上的 overscroll-behavior 由壳的样式管）。
 */

const TABBABLE = [
  'a[href]', 'area[href]', 'button', 'input', 'select', 'textarea', 'summary', 'iframe', 'audio[controls]', 'video[controls]',
  '[tabindex]', '[contenteditable=""]', '[contenteditable="true"]',
].join(',')
/** 打开时优先落脚的「输入控件」 */
const FIELD = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select, [role="combobox"], [contenteditable=""], [contenteditable="true"]'
/**
 * 浮在弹窗上面、但 DOM 上不在弹窗里面的东西：焦点进到这些里面不算「跑到外面」。
 * 别的弹窗（包括还没接上这份逻辑的老弹窗）也算：它们自己管自己。
 */
const FLOATING = '.lc-menu, .cp-pop, .t-popup, [role="menu"], [role="listbox"], [role="tooltip"], [data-lc-popup], .lc-mask, [role="dialog"], [role="alertdialog"]'
/** 开着的时候 Esc 归它们的弹出层 */
const POPUP = '.lc-menu, .cp-pop, .t-popup, [data-lc-popup]'

function visible(el: Element): boolean {
  const anyEl = el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean }
  if (typeof anyEl.checkVisibility === 'function') return anyEl.checkVisibility({ visibilityProperty: true })
  // 没有排版引擎的环境（单元测试）里谁都没有尺寸：一律算看得见
  if (!el.ownerDocument.body.getClientRects().length) return true
  return el.getClientRects().length > 0
}

function tabbable(el: HTMLElement): boolean {
  const ti = el.getAttribute('tabindex')
  if (ti !== null && Number(ti) < 0) return false
  if ((el as HTMLButtonElement).disabled) return false
  if (el instanceof HTMLInputElement && el.type === 'hidden') return false
  if (el.closest('[hidden], [inert]')) return false
  return visible(el)
}

/** root 里按 Tab 能走到的元素，按文档顺序 */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter(tabbable)
}

/**
 * 在弹窗里按了一下 Tab：该把焦点放到哪儿。返回 null = 交给浏览器（焦点在中间，照常走下一个）。
 *  - 焦点在最后一个上按 Tab → 第一个；在第一个（或弹窗自己）上按 Shift+Tab → 最后一个；
 *  - 焦点不在弹窗里（在 Teleport 出去的菜单里，或者丢了）→ 从 last（上一次在弹窗里的位置）接着走；
 *  - 弹窗里没有能停的元素 → 弹窗自己。
 */
export function nextTabStop(root: HTMLElement, active: Element | null, backwards: boolean, last: HTMLElement | null = null): HTMLElement | null {
  const list = tabbables(root)
  if (!list.length) return root
  const first = list[0]
  const end = list[list.length - 1]
  if (!active || !root.contains(active)) {
    const i = last ? list.indexOf(last) : -1
    if (i < 0) return backwards ? end : first
    return list[(i + (backwards ? -1 : 1) + list.length) % list.length]
  }
  if (backwards) return active === first || active === root ? end : null
  return active === end ? first : null
}

/** 打开时焦点落在哪儿 */
export function initialFocusTarget(root: HTMLElement): HTMLElement {
  const usable = (el: HTMLElement | null) => !!el && !(el as HTMLButtonElement).disabled && visible(el)
  const marked = root.querySelector<HTMLElement>('[data-autofocus], [autofocus]')
  if (usable(marked)) return marked!
  const field = Array.from(root.querySelectorAll<HTMLElement>(FIELD)).find(el => usable(el) && !(el as HTMLInputElement).readOnly)
  return field || root
}

export interface DialogFocusOptions {
  /** 在最上面一层按了 Esc（busy 时不会调） */
  onEscape?: () => void
  /** 正在提交：Esc 不关 */
  busy?: () => boolean
  /** 打开时焦点放哪儿；不给就按 data-autofocus → 第一个输入控件 → 弹窗自己 */
  initialFocus?: () => HTMLElement | null | undefined
  /** 关掉后焦点还给谁；不给就是打开时焦点所在的元素。那个元素已经不在了（比如那一行被删了）时用 fallbackFocus */
  returnFocus?: boolean
  fallbackFocus?: () => HTMLElement | null | undefined
  /**
   * false = 不挡住页面的弹出面板（贴着按钮弹的那种，点外面就收起）：Tab 照样在里面循环、Esc 照样关，
   * 但焦点去了别处不往回拉；收起时只有焦点还在面板里（或者已经丢了）才还给打开它的按钮——
   * 人是点了别处才收起的，焦点就该留在他点的地方。
   */
  modal?: boolean
}

export interface DialogFocus {
  /** 开始管：记下打开它的元素、把焦点放进去 */
  activate(): void
  /** 不管了：焦点还回去 */
  deactivate(): void
  /** 重新把焦点放到初始位置（内容换了一屏之后用） */
  focusFirst(): void
  readonly active: boolean
}

interface Layer {
  el: () => HTMLElement | null
  opts: DialogFocusOptions
  opener: HTMLElement | null
  /** 上一次焦点在弹窗里的位置 */
  last: HTMLElement | null
}

/** 开着的弹窗，后开的在后面；只有最后一个管键盘 */
const stack: Layer[] = []

const usableTarget = (el: HTMLElement | null | undefined): el is HTMLElement => !!el && el.isConnected && el !== el.ownerDocument.body

function popupOpen(doc: Document, root: HTMLElement): boolean {
  return Array.from(doc.querySelectorAll(POPUP)).some(p => !root.contains(p) && !p.contains(root) && visible(p))
}

function onKeydown(e: KeyboardEvent) {
  const top = stack[stack.length - 1]
  const root = top?.el()
  if (!top || !root) return
  if (e.key === 'Tab') {
    // 不挡页面的面板：焦点已经不在面板里了（人点了别处），这一下 Tab 不归它管
    if (top.opts.modal === false && !root.contains(root.ownerDocument.activeElement)) return
    const to = nextTabStop(root, root.ownerDocument.activeElement, e.shiftKey, top.last)
    if (to) { e.preventDefault(); to.focus() }
    return
  }
  if (e.key !== 'Escape' || e.defaultPrevented) return
  if (popupOpen(root.ownerDocument, root)) return
  if (top.opts.modal === false && !top.opts.onEscape) return
  // 这一下 Esc 到此为止：下面一层弹窗、页面上监听 window 的那些都不该再收到
  e.stopPropagation()
  e.preventDefault()
  if (top.opts.busy?.()) return
  top.opts.onEscape?.()
}

function onFocusIn(e: FocusEvent) {
  const top = stack[stack.length - 1]
  const root = top?.el()
  const t = e.target as HTMLElement | null
  if (!top || !root || !t || typeof t.closest !== 'function') return
  if (root.contains(t)) { top.last = t; return }
  if (top.opts.modal === false || t.closest(FLOATING)) return
  ;(top.last && root.contains(top.last) ? top.last : initialFocusTarget(root)).focus({ preventScroll: true })
}

function listen(on: boolean) {
  if (typeof document === 'undefined') return
  if (on) {
    document.addEventListener('keydown', onKeydown)
    document.addEventListener('focusin', onFocusIn, true)
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.removeEventListener('focusin', onFocusIn, true)
  }
}

/** 不依赖 Vue 的那一份：自己决定什么时候 activate / deactivate */
export function createDialogFocus(el: () => HTMLElement | null, opts: DialogFocusOptions = {}): DialogFocus {
  const layer: Layer = { el, opts, opener: null, last: null }

  function focusFirst() {
    const root = el()
    if (!root) return
    if (!root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
    const to = opts.initialFocus?.() || initialFocusTarget(root)
    to.focus({ preventScroll: true })
    layer.last = to === root ? null : to
  }

  function activate() {
    if (stack.includes(layer)) return
    const cur = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null
    layer.opener = usableTarget(cur) ? cur : null
    layer.last = null
    if (!stack.length) listen(true)
    stack.push(layer)
    focusFirst()
  }

  function deactivate() {
    const i = stack.indexOf(layer)
    if (i < 0) return
    stack.splice(i, 1)
    if (!stack.length) listen(false)
    const root = el()
    const above = stack[i]
    // 一个弹窗关掉的同时另一个接着开（确认 → 结果）：后一个是从前一个里面开出来的，它关掉时焦点该回到最初的那个元素
    if (above && (!usableTarget(above.opener) || (root && root.contains(above.opener)))) {
      above.opener = layer.opener
      layer.opener = null
      return
    }
    const now = typeof document !== 'undefined' ? document.activeElement : null
    const elsewhere = opts.modal === false && !!now && now !== document.body && !(root && root.contains(now))
    if (opts.returnFocus !== false && !above && !elsewhere) {
      const opener = layer.opener
      /** 焦点放到 to 上；返回有没有真的落上去（灰着的元素 focus() 不起作用） */
      const land = (to: HTMLElement | null | undefined): boolean => {
        if (!usableTarget(to)) return false
        to.focus({ preventScroll: true })
        return to.ownerDocument.activeElement === to
      }
      const openerUsable = () => usableTarget(opener) && visible(opener)
      // 打开它的元素还在、看得见就还给它，否则给 fallbackFocus
      land(openerUsable() ? opener : opts.fallbackFocus?.())
      // 弹窗多半是在一轮界面更新的半路上被卸掉的：要还的那个元素这时可能还灰着（正在保存，focus() 不起作用），
      // 也可能紧接着就被拿掉（那一行删了、那颗按钮不该再出现了）——两种情况焦点都会掉回页面开头。
      // 等这一轮更新完再看一眼：真掉了就再还一次（灰着的这时已经放开；没了的、还灰着的换成 fallbackFocus）。
      // 这期间人自己把焦点挪到了别处、或者又开了一个弹窗，就不动。
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          const doc = (root || opener)?.ownerDocument || document
          const at = doc.activeElement
          if (stack.length || (at && at !== doc.body)) return
          if (!(openerUsable() && land(opener))) land(opts.fallbackFocus?.())
        }, 0)
      }
    }
    layer.opener = null
  }

  return { activate, deactivate, focusFirst, get active() { return stack.includes(layer) } }
}

export interface UseDialogFocusOptions extends DialogFocusOptions {
  /** 弹窗开没开。不给 = 组件挂着就是开着（用 v-if 挂 / 卸整个弹窗组件的写法） */
  active?: Ref<boolean> | (() => boolean)
}

/**
 * 组件里用：el 是弹窗那个盒子（role="dialog" 的元素）。
 *   const box = ref<HTMLElement | null>(null)
 *   useDialogFocus(box, { onEscape: () => emit('close'), busy: () => props.busy })
 * 弹窗写在父组件模板里、用一个开关控制显示的，把开关传给 active。
 */
export function useDialogFocus(el: Ref<HTMLElement | null>, opts: UseDialogFocusOptions = {}): DialogFocus {
  const focus = createDialogFocus(() => el.value, opts)
  if (opts.active === undefined) {
    onMounted(focus.activate)
  } else {
    const on = opts.active
    const isOn = () => (typeof on === 'function' ? on() : on.value)
    onMounted(() => { if (isOn()) focus.activate() })
    // post：开的时候盒子已经挂上；此刻 document.activeElement 还是打开它的那个按钮
    watch(on, (v) => { if (v) focus.activate(); else focus.deactivate() }, { flush: 'post' })
  }
  onBeforeUnmount(focus.deactivate)
  return focus
}
