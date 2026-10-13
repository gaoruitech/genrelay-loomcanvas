import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, withDirectives, type App, type Ref } from 'vue'
import { TIP_HOLD_MS, TIP_HOVER_MS, vTip, installTip, type TipValue } from '../src/directives/tip'

/** happy-dom 的 PointerEvent 不一定带 pointerType：自己拼一个 */
function pointer(el: Element | Window, type: string, init: { pointerType?: string; pointerId?: number; clientX?: number; clientY?: number } = {}) {
  const e = new Event(type, { bubbles: !/enter|leave/.test(type), cancelable: true })
  Object.assign(e, { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0, ...init })
  el.dispatchEvent(e)
  return e
}

let app: App | null = null
let box: HTMLElement
const tips = () => Array.from(document.querySelectorAll<HTMLElement>('.lc-tip'))
const shown = () => tips().find((t) => t.classList.contains('on')) || null

function mount(value: Ref<TipValue>, opts: { show?: Ref<boolean>; attrs?: Record<string, string>; label?: string } = {}) {
  const Comp = defineComponent({
    setup: () => () => (opts.show && !opts.show.value
      ? h('div')
      : withDirectives(h('button', { id: 'b', ...(opts.attrs || {}) }, opts.label ?? ''), [[vTip, value.value]])),
  })
  app = createApp(Comp)
  app.mount(box)
  return document.getElementById('b') as HTMLButtonElement
}

beforeEach(() => {
  vi.useFakeTimers()
  box = document.createElement('div')
  document.body.appendChild(box)
})
afterEach(() => {
  app?.unmount()
  app = null
  box.remove()
  vi.useRealTimers()
})

describe('v-tip', () => {
  it('registers as a global directive', () => {
    const a = createApp({ render: () => null })
    installTip(a)
    expect(a.directive('tip')).toBe(vTip)
  })

  it('shows after the hover delay, hides on leave, never writes a native title', () => {
    const btn = mount(ref('Hello'), { label: 'Go' })
    expect(shown()).toBeNull()
    pointer(btn, 'pointerenter')
    vi.advanceTimersByTime(TIP_HOVER_MS - 20)
    expect(shown()).toBeNull()
    vi.advanceTimersByTime(40)
    const tip = shown()!
    expect(tip.textContent).toBe('Hello')
    expect(tip.getAttribute('role')).toBe('tooltip')
    expect(btn.getAttribute('aria-describedby')).toBe(tip.id)
    expect(btn.hasAttribute('title')).toBe(false)
    // the element had its own text: its accessible name is left alone
    expect(btn.hasAttribute('aria-label')).toBe(false)
    pointer(btn, 'pointerleave')
    expect(shown()).toBeNull()
    expect(btn.hasAttribute('aria-describedby')).toBe(false)
  })

  it('leaving before the delay cancels it', () => {
    const btn = mount(ref('Hello'))
    pointer(btn, 'pointerenter')
    vi.advanceTimersByTime(100)
    pointer(btn, 'pointerleave')
    vi.advanceTimersByTime(1000)
    expect(shown()).toBeNull()
  })

  it('names an icon-only element, and keeps an existing aria-label / describedby', async () => {
    const text = ref<TipValue>('Close')
    const btn = mount(text)
    expect(btn.getAttribute('aria-label')).toBe('Close')
    text.value = 'Shut'
    await nextTick()
    expect(btn.getAttribute('aria-label')).toBe('Shut')
    app!.unmount(); app = null

    const b2 = mount(ref('Tip'), { attrs: { 'aria-label': 'Own name', 'aria-describedby': 'other' } })
    expect(b2.getAttribute('aria-label')).toBe('Own name')
    pointer(b2, 'pointerenter')
    vi.advanceTimersByTime(TIP_HOVER_MS + 10)
    expect(b2.getAttribute('aria-describedby')).toBe('other ' + shown()!.id)
    pointer(b2, 'pointerleave')
    expect(b2.getAttribute('aria-describedby')).toBe('other')
  })

  it('empty or missing text means no tooltip; the binding can turn it on and off', async () => {
    const text = ref<TipValue>('')
    const btn = mount(text, { label: 'x' })
    expect(tips().length).toBe(0)
    pointer(btn, 'pointerenter')
    vi.advanceTimersByTime(1000)
    expect(shown()).toBeNull()

    text.value = { text: 'Now', placement: 'left' }
    await nextTick()
    pointer(btn, 'pointerenter')
    vi.advanceTimersByTime(TIP_HOVER_MS + 10)
    expect(shown()!.textContent).toBe('Now')

    // changes while showing
    text.value = { text: 'Later' }
    await nextTick()
    expect(shown()!.textContent).toBe('Later')

    text.value = undefined
    await nextTick()
    expect(shown()).toBeNull()
    expect(tips().length).toBe(0)
  })

  it('shows immediately on keyboard focus and hides on blur; a pointer-made focus does not count', () => {
    const btn = mount(ref('Hello'))
    vi.advanceTimersByTime(5000)
    btn.focus()
    expect(shown()!.textContent).toBe('Hello')
    btn.blur()
    expect(shown()).toBeNull()

    pointer(window, 'pointerdown')
    btn.focus()
    expect(shown()).toBeNull()
  })

  it('hides on Escape, scroll and pointerdown', () => {
    const btn = mount(ref('Hello'))
    // each test restarts the fake clock at the real time: step past the previous test's pointerdown
    vi.advanceTimersByTime(5000)
    const open = () => { btn.blur(); vi.advanceTimersByTime(400); btn.focus(); expect(shown()).not.toBeNull() }
    open()
    const esc = new Event('keydown', { bubbles: true }); Object.assign(esc, { key: 'Escape' })
    window.dispatchEvent(esc)
    expect(shown()).toBeNull()
    open()
    window.dispatchEvent(new Event('scroll'))
    expect(shown()).toBeNull()
    open()
    pointer(window, 'pointerdown')
    expect(shown()).toBeNull()
  })

  it('touch: a hold shows it and swallows the click that follows; a tap does neither', () => {
    const btn = mount(ref('Hello'), { label: 'x' })
    const clicks = vi.fn()
    btn.addEventListener('click', clicks)

    // tap
    pointer(btn, 'pointerdown', { pointerType: 'touch' })
    vi.advanceTimersByTime(120)
    pointer(btn, 'pointerup', { pointerType: 'touch' })
    btn.click()
    expect(shown()).toBeNull()
    expect(clicks).toHaveBeenCalledTimes(1)
    // a touch tap also fires pointerenter: that is not a hover
    pointer(btn, 'pointerenter', { pointerType: 'touch' })
    vi.advanceTimersByTime(1000)
    expect(shown()).toBeNull()

    // hold
    pointer(btn, 'pointerdown', { pointerType: 'touch' })
    vi.advanceTimersByTime(TIP_HOLD_MS + 10)
    expect(shown()!.textContent).toBe('Hello')
    pointer(btn, 'pointerup', { pointerType: 'touch' })
    btn.click()
    expect(clicks).toHaveBeenCalledTimes(1)
    expect(shown()).not.toBeNull()
    vi.advanceTimersByTime(2000)
    expect(shown()).toBeNull()
    // the next tap is a normal click again
    btn.click()
    expect(clicks).toHaveBeenCalledTimes(2)
  })

  it('touch: moving the finger (a drag or a scroll) is not a hold', () => {
    const btn = mount(ref('Hello'), { label: 'x' })
    pointer(btn, 'pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10 })
    vi.advanceTimersByTime(100)
    pointer(btn, 'pointermove', { pointerType: 'touch', clientX: 40, clientY: 10 })
    vi.advanceTimersByTime(1000)
    expect(shown()).toBeNull()
  })

  it('clipped: true shows only while the content of the element is cut off', () => {
    const btn = mount(ref<TipValue>({ text: 'The whole sentence', clipped: true }), { label: 'The whole…' })
    const size = (sw: number, cw: number) => {
      Object.defineProperty(btn, 'scrollWidth', { configurable: true, value: sw })
      Object.defineProperty(btn, 'clientWidth', { configurable: true, value: cw })
    }
    size(100, 100)
    pointer(btn, 'pointerenter')
    vi.advanceTimersByTime(TIP_HOVER_MS + 10)
    expect(shown()).toBeNull()
    pointer(btn, 'pointerleave')
    size(240, 100)
    pointer(btn, 'pointerenter')
    vi.advanceTimersByTime(TIP_HOVER_MS + 10)
    expect(shown()!.textContent).toBe('The whole sentence')
  })

  it('goes away with its element, and the shared layer leaves the page with the last user', async () => {
    const on = ref(true)
    const btn = mount(ref('Hello'), { show: on, label: 'x' })
    pointer(btn, 'pointerenter')
    vi.advanceTimersByTime(TIP_HOVER_MS + 10)
    expect(shown()).not.toBeNull()
    on.value = false
    await nextTick()
    expect(shown()).toBeNull()
    expect(tips().length).toBe(0)
  })

  it('inside an embedded root the layer lives in that root\'s portal', () => {
    const root = document.createElement('div')
    root.className = 'lc-root lc-embedded'
    const appEl = document.createElement('div')
    const portal = document.createElement('div')
    portal.className = 'lc-portal'
    root.append(appEl, portal)
    document.body.appendChild(root)
    const prev = box
    box = appEl
    mount(ref('Hello'), { label: 'x' })
    expect(portal.querySelectorAll('.lc-tip').length).toBe(1)
    expect(document.body.querySelectorAll(':scope > .lc-tip').length).toBe(0)
    app!.unmount(); app = null
    expect(portal.querySelectorAll('.lc-tip').length).toBe(0)
    root.remove()
    box = prev
  })
})
