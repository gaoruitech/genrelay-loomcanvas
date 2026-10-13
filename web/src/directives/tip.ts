/**
 * v-tip：全站的悬停提示，替掉原生 title。
 *
 *   <button v-tip="text">                               文字（过 t() 的那一句）；空串 / undefined = 没有提示
 *   <button v-tip="{ text, placement: 'left' }">        指定朝向：top（默认）| bottom | left | right
 *   <span v-tip="{ text, clipped: true }">              只在这个元素自己的内容被截断（省略号 / 限行）时才出：
 *                                                       用来给截断的文字看全文，没截断就不重复一遍
 *
 * 原生 title 的毛病：要等一秒多才出来、样式是系统的（两套皮肤都不认）、触屏上根本不出、键盘聚焦也不出。
 * 这里整页（每个挂载根）只有一个浮层元素，挂在 Teleport 的去处（独立应用是 body，嵌进别人页面时是根元素里的
 * .lc-portal），所以嵌入时也画在根元素里面、跟着根元素的主题走。
 *
 *   鼠标悬停      停 350ms 出现；移开、按下、滚动、Esc 收起
 *   键盘聚焦      立刻出现（只认 :focus-visible —— 鼠标点出来的焦点不算）；失焦收起
 *   触屏 / 手写笔  按住 450ms 出现，这一次松手不算点击；松手后留一会儿，或者点别处收起
 *
 * 无障碍：浮层是 role="tooltip"，显示期间宿主元素的 aria-describedby 指向它；宿主元素要是自己没有名字
 * （没有 aria-label / aria-labelledby，里面也没有文字 —— 纯图标按钮），提示文字同时写进它的 aria-label。
 * 不写原生 title。位置用 CSSOM 设（el.style.left = …），不拼 style 属性字符串。
 */
import type { App, Directive } from 'vue'
import { frameOf } from '@/utils/frame'

export type TipPlacement = 'top' | 'bottom' | 'left' | 'right'
export type TipValue = string | null | undefined | { text?: string | null; placement?: TipPlacement; clipped?: boolean }

/** 鼠标停多久才出现 */
export const TIP_HOVER_MS = 350
/** 触屏按住多久算「长按看提示」；自己处理 pointerup 的控件（不靠 click）用同一个数判断这次松手还算不算点击 */
export const TIP_HOLD_MS = 450
/** 长按松手后提示再留多久 */
const TIP_LINGER_MS = 1500
/** 按住期间手指挪过这么远就不算长按（是在拖 / 在滚） */
const HOLD_SLOP = 8
const GAP = 8
const EDGE = 6

interface Bound {
  text: string
  placement: TipPlacement
  /** 只在宿主的内容被截断时才出 */
  clipped: boolean
  /** aria-label 是这里代写的（宿主自己没有名字） */
  ownLabel: boolean
  off: () => void
}

const bound = new WeakMap<HTMLElement, Bound>()
/** 每个挂载点一个浮层元素，以及有多少个宿主在用它 */
const layers = new Map<HTMLElement, { tip: HTMLElement; users: number }>()

let uid = 0
let cur: HTMLElement | null = null
let curTip: HTMLElement | null = null
let showTimer: number | null = null
let hideTimer: number | null = null
let lastDownAt = 0
let globalsOn = false

function norm(v: TipValue): { text: string; placement: TipPlacement; clipped: boolean } {
  if (v && typeof v === 'object') {
    const p = v.placement
    return { text: String(v.text ?? '').trim(), placement: p === 'bottom' || p === 'left' || p === 'right' ? p : 'top', clipped: v.clipped === true }
  }
  return { text: typeof v === 'string' ? v.trim() : '', placement: 'top', clipped: false }
}

/** 元素自己的内容有没有被截断（单行省略号看宽度，限行看高度） */
function isClipped(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1
}

/** 浮层挂在哪：嵌入时是所在根元素的 .lc-portal，否则是 body */
function hostOf(el: HTMLElement): HTMLElement {
  const root = el.closest('.lc-root')
  if (root && root !== document.documentElement) {
    for (const c of Array.from(root.children)) if (c.classList.contains('lc-portal')) return c as HTMLElement
  }
  return document.body
}

function layerFor(el: HTMLElement): HTMLElement {
  const host = hostOf(el)
  let rec = layers.get(host)
  if (!rec || !rec.tip.isConnected) {
    const tip = document.createElement('div')
    tip.className = 'lc-tip'
    tip.id = `lc-tip-${++uid}`
    tip.setAttribute('role', 'tooltip')
    host.appendChild(tip)
    rec = { tip, users: rec?.users || 0 }
    layers.set(host, rec)
  }
  return rec.tip
}

function clearTimers() {
  if (showTimer !== null) { clearTimeout(showTimer); showTimer = null }
  if (hideTimer !== null) { clearTimeout(hideTimer); hideTimer = null }
}

function describedBy(el: HTMLElement, id: string, on: boolean) {
  const ids = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter((x) => x && x !== id)
  if (on) ids.push(id)
  if (ids.length) el.setAttribute('aria-describedby', ids.join(' '))
  else el.removeAttribute('aria-describedby')
}

/** 摆位置：先按想要的朝向，放不下翻到对面，再不行就夹在画框里 */
function place(el: HTMLElement, tip: HTMLElement, want: TipPlacement) {
  const f = frameOf(el)
  const r = el.getBoundingClientRect()
  const a = { l: r.left - f.x, t: r.top - f.y, r: r.right - f.x, b: r.bottom - f.y }
  const w = tip.offsetWidth, h = tip.offsetHeight
  const room: Record<TipPlacement, number> = {
    top: a.t - GAP - EDGE - h,
    bottom: f.h - a.b - GAP - EDGE - h,
    left: a.l - GAP - EDGE - w,
    right: f.w - a.r - GAP - EDGE - w,
  }
  const opposite: Record<TipPlacement, TipPlacement> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }
  let p = want
  if (room[p] < 0) {
    if (room[opposite[p]] >= 0) p = opposite[p]
    else {
      // 这一条轴上两头都放不下（很宽的元素、很矮的窗口）：换到地方最大的那一边
      const best = (Object.keys(room) as TipPlacement[]).sort((x, y) => room[y] - room[x])[0]
      if (room[best] > room[p]) p = best
    }
  }
  let x: number, y: number
  if (p === 'top' || p === 'bottom') {
    x = (a.l + a.r) / 2 - w / 2
    y = p === 'top' ? a.t - GAP - h : a.b + GAP
  } else {
    x = p === 'left' ? a.l - GAP - w : a.r + GAP
    y = (a.t + a.b) / 2 - h / 2
  }
  x = Math.max(EDGE, Math.min(x, f.w - w - EDGE))
  y = Math.max(EDGE, Math.min(y, f.h - h - EDGE))
  tip.style.left = `${Math.round(x)}px`
  tip.style.top = `${Math.round(y)}px`
  tip.dataset.placement = p
}

function show(el: HTMLElement) {
  const b = bound.get(el)
  if (!b || !b.text || !el.isConnected) return
  if (b.clipped && !isClipped(el)) return
  clearTimers()
  if (cur && cur !== el) hide()
  const tip = layerFor(el)
  tip.textContent = b.text
  tip.classList.add('on')
  cur = el
  curTip = tip
  describedBy(el, tip.id, true)
  place(el, tip, b.placement)
}

function hide() {
  clearTimers()
  if (cur && curTip) describedBy(cur, curTip.id, false)
  if (curTip) { curTip.classList.remove('on'); curTip.textContent = '' }
  cur = null
  curTip = null
}

/** 整页只挂一份：按下、滚动、Esc、窗口变化都收起 */
function ensureGlobals() {
  if (globalsOn || typeof window === 'undefined') return
  globalsOn = true
  window.addEventListener('pointerdown', () => { lastDownAt = Date.now(); if (cur) hide(); else clearTimers() }, true)
  window.addEventListener('scroll', () => { if (cur) hide() }, true)
  window.addEventListener('wheel', () => { if (cur) hide() }, { capture: true, passive: true })
  window.addEventListener('resize', () => { if (cur) hide() })
  window.addEventListener('blur', () => { if (cur) hide() })
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur) hide() }, true)
}

function focusVisible(el: Element | null): boolean {
  if (!el) return false
  try { return el.matches(':focus-visible') } catch { return true }
}

function attach(el: HTMLElement): () => void {
  let hold: { id: number; x: number; y: number; timer: number | null; shown: boolean } | null = null
  let eatClick = false
  let eatTimer: number | null = null

  const onEnter = (e: PointerEvent) => {
    // 触屏点一下也会有 pointerenter：那不是悬停
    if (e.pointerType && e.pointerType !== 'mouse') return
    if (cur === el) return
    clearTimers()
    showTimer = window.setTimeout(() => { showTimer = null; show(el) }, TIP_HOVER_MS)
  }
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType && e.pointerType !== 'mouse') return
    if (cur === el) hide()
    else clearTimers()
  }
  const onFocusIn = (e: FocusEvent) => {
    // 鼠标 / 手指点出来的焦点不算（输入框被点中时 :focus-visible 也成立，靠按下的时间挡掉）
    if (Date.now() - lastDownAt < 250) return
    if (focusVisible(e.target as Element)) show(el)
  }
  const onFocusOut = () => { if (cur === el) hide() }

  const endHold = () => {
    if (hold?.timer != null) clearTimeout(hold.timer)
    hold = null
  }
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || !e.pointerType) return
    endHold()
    const h = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: null as number | null, shown: false }
    h.timer = window.setTimeout(() => {
      h.timer = null
      if (hold !== h) return
      h.shown = true
      eatClick = true
      show(el)
    }, TIP_HOLD_MS)
    hold = h
  }
  const onMove = (e: PointerEvent) => {
    if (!hold || e.pointerId !== hold.id || hold.shown) return
    if (Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > HOLD_SLOP) endHold()
  }
  const onUp = (e: PointerEvent) => {
    if (!hold || e.pointerId !== hold.id) return
    const shown = hold.shown
    endHold()
    if (!shown) return
    // 这次松手不算点击；click 没来的话（有的浏览器长按之后不发）过一会儿自己解除
    if (eatTimer !== null) clearTimeout(eatTimer)
    eatTimer = window.setTimeout(() => { eatClick = false; eatTimer = null }, 400)
    if (cur === el) { clearTimers(); hideTimer = window.setTimeout(() => { hideTimer = null; if (cur === el) hide() }, TIP_LINGER_MS) }
  }
  const onCancel = (e: PointerEvent) => {
    if (!hold || e.pointerId !== hold.id) return
    const shown = hold.shown
    endHold()
    eatClick = false
    if (shown && cur === el) hide()
  }
  const onClick = (e: MouseEvent) => {
    if (!eatClick) return
    eatClick = false
    e.preventDefault()
    e.stopImmediatePropagation()
  }
  // 长按在安卓上还会弹系统的上下文菜单：提示已经出来了，就不要它
  const onMenu = (e: Event) => { if (hold?.shown || eatClick) e.preventDefault() }

  el.addEventListener('pointerenter', onEnter)
  el.addEventListener('pointerleave', onLeave)
  el.addEventListener('focusin', onFocusIn)
  el.addEventListener('focusout', onFocusOut)
  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onCancel)
  el.addEventListener('click', onClick, true)
  el.addEventListener('contextmenu', onMenu)
  return () => {
    endHold()
    if (eatTimer !== null) clearTimeout(eatTimer)
    el.removeEventListener('pointerenter', onEnter)
    el.removeEventListener('pointerleave', onLeave)
    el.removeEventListener('focusin', onFocusIn)
    el.removeEventListener('focusout', onFocusOut)
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onCancel)
    el.removeEventListener('click', onClick, true)
    el.removeEventListener('contextmenu', onMenu)
  }
}

/** 宿主自己有没有名字：有 aria-label / aria-labelledby，或者里面有看得见的文字 */
function hasName(el: HTMLElement): boolean {
  if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return true
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true
  return !!(el.textContent || '').trim()
}

function apply(el: HTMLElement, value: TipValue) {
  const { text, placement, clipped } = norm(value)
  let b = bound.get(el)
  if (!text) {
    if (b) release(el)
    return
  }
  if (!b) {
    ensureGlobals()
    b = { text, placement, clipped, ownLabel: false, off: attach(el) }
    bound.set(el, b)
    const host = hostOf(el)
    const rec = layers.get(host)
    if (rec) rec.users++
    else { layerFor(el); layers.get(host)!.users = 1 }
    hosts.set(el, host)
    // 「截断了才出」的提示是正文的全文，不是这个元素的名字
    if (!clipped && !hasName(el)) b.ownLabel = true
  }
  b.text = text
  b.placement = placement
  b.clipped = clipped
  if (b.ownLabel) el.setAttribute('aria-label', text)
  // 正显示着：文字跟着换，位置重摆
  if (cur === el && curTip) { curTip.textContent = text; place(el, curTip, placement) }
}

/** 宿主 → 它登记在哪个挂载点上（卸载时元素已经不在文档里，查不出来了） */
const hosts = new WeakMap<HTMLElement, HTMLElement>()

function release(el: HTMLElement) {
  const b = bound.get(el)
  if (!b) return
  if (cur === el) hide()
  b.off()
  if (b.ownLabel) el.removeAttribute('aria-label')
  bound.delete(el)
  const host = hosts.get(el)
  hosts.delete(el)
  const rec = host && layers.get(host)
  if (host && rec && --rec.users <= 0) {
    // 这个挂载点上最后一个用提示的元素也走了：浮层元素不留在页面里
    if (curTip === rec.tip) hide()
    rec.tip.remove()
    layers.delete(host)
  }
}

export const vTip: Directive<HTMLElement, TipValue> = {
  mounted(el, binding) { apply(el, binding.value) },
  updated(el, binding) { apply(el, binding.value) },
  beforeUnmount(el) { release(el) },
}

export function installTip(app: App): void {
  app.directive('tip', vTip)
}

declare module 'vue' {
  interface GlobalDirectives {
    vTip: typeof vTip
  }
}
