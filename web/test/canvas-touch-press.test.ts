// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { installPinchRouter, quietUncancelable, LONG_PRESS_MS, type TouchLike, type LongPressAt } from '../src/composables/canvasTouch'
import { useTouchMultiSelect } from '../src/composables/useTouchMultiSelect'

/**
 * 长按开菜单（自己计时，不靠浏览器的 contextmenu）：按住不动 → 开；挪开、第二根手指、抬起、滚动 → 不开；
 * 开了之后这根手指的拖动就地收尾，抬起时不补发 click（不然会点在画布上把菜单关掉）；触摸引起的 contextmenu 一律拦下。
 */
let wrap: HTMLElement, viewport: HTMLElement, pane: HTMLElement, node: HTMLElement, btn: HTMLElement
let stop: () => void
let opened: LongPressAt[]
let answer = true
let seenByNode: string[]

const T = (identifier: number, target: EventTarget, clientX: number, clientY: number): TouchLike => ({ identifier, target, clientX, clientY })
function fire(type: string, on: EventTarget, touches: TouchLike[], changed: TouchLike[], cancelable = true) {
  const e = new Event(type, { bubbles: true, cancelable })
  Object.defineProperty(e, 'touches', { value: touches })
  Object.defineProperty(e, 'changedTouches', { value: changed })
  on.dispatchEvent(e)
  return e
}

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = '<div id="wrap"><div class="vue-flow__viewport"><div id="pane" class="vue-flow__pane"><div id="node" class="vue-flow__node"><button id="btn">run</button></div></div></div></div>'
  wrap = document.getElementById('wrap')!
  viewport = wrap.querySelector('.vue-flow__viewport')!
  pane = document.getElementById('pane')!
  node = document.getElementById('node')!
  btn = document.getElementById('btn')!
  opened = []; answer = true; seenByNode = []
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) node.addEventListener(type, (e) => seenByNode.push(e.type))
  stop = installPinchRouter(wrap, { viewport: () => viewport, longPress: (at) => { opened.push(at); return answer } })
})
afterEach(() => { stop(); vi.useRealTimers() })

describe('long press', () => {
  it('holding still opens the menu at the finger, ends the drag in place and swallows the lift (no click)', () => {
    const a = T(1, node, 120, 200)
    fire('touchstart', node, [a], [a])
    vi.advanceTimersByTime(LONG_PRESS_MS - 10)
    fire('touchmove', node, [T(1, node, 123, 202)], [T(1, node, 123, 202)]) // 抖一下，没超过
    expect(opened).toEqual([])
    vi.advanceTimersByTime(20)
    expect(opened).toEqual([{ x: 120, y: 200, target: node }])
    expect(seenByNode).toEqual(['touchstart', 'touchmove', 'touchcancel'])
    const mv = fire('touchmove', node, [T(1, node, 150, 260)], [T(1, node, 150, 260)])
    const up = fire('touchend', node, [], [T(1, node, 150, 260)])
    expect(seenByNode).toEqual(['touchstart', 'touchmove', 'touchcancel'])
    expect(mv.defaultPrevented && up.defaultPrevented).toBe(true)
    // 下一次触摸恢复原样
    fire('touchstart', node, [T(2, node, 10, 10)], [T(2, node, 10, 10)])
    expect(seenByNode[seenByNode.length - 1]).toBe('touchstart')
  })

  it('works on the empty canvas too', () => {
    fire('touchstart', pane, [T(1, pane, 300, 400)], [T(1, pane, 300, 400)])
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(opened).toEqual([{ x: 300, y: 400, target: pane }])
  })

  it('is cancelled by moving, by a second finger, by lifting early and by a scroll', () => {
    fire('touchstart', pane, [T(1, pane, 300, 400)], [T(1, pane, 300, 400)])
    fire('touchmove', pane, [T(1, pane, 310, 400)], [T(1, pane, 310, 400)])
    vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    fire('touchend', pane, [], [T(1, pane, 310, 400)])

    fire('touchstart', pane, [T(2, pane, 300, 400)], [T(2, pane, 300, 400)])
    fire('touchstart', pane, [T(2, pane, 300, 400), T(3, pane, 200, 400)], [T(3, pane, 200, 400)])
    vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    fire('touchend', pane, [], [T(2, pane, 300, 400), T(3, pane, 200, 400)])

    fire('touchstart', pane, [T(4, pane, 300, 400)], [T(4, pane, 300, 400)])
    vi.advanceTimersByTime(200)
    fire('touchend', pane, [], [T(4, pane, 300, 400)])
    vi.advanceTimersByTime(LONG_PRESS_MS)

    fire('touchstart', pane, [T(5, pane, 300, 400)], [T(5, pane, 300, 400)])
    pane.dispatchEvent(new Event('scroll'))
    vi.advanceTimersByTime(LONG_PRESS_MS)
    expect(opened).toEqual([])
  })

  it('leaves buttons alone (their long press shows the tooltip)', () => {
    fire('touchstart', btn, [T(1, btn, 10, 10)], [T(1, btn, 10, 10)])
    vi.advanceTimersByTime(LONG_PRESS_MS * 2)
    expect(opened).toEqual([])
  })

  it('when nothing opened, the touch carries on untouched', () => {
    answer = false
    fire('touchstart', node, [T(1, node, 10, 10)], [T(1, node, 10, 10)])
    vi.advanceTimersByTime(LONG_PRESS_MS)
    const up = fire('touchend', node, [], [T(1, node, 10, 10)])
    expect(opened.length).toBe(1)
    expect(seenByNode).toEqual(['touchstart', 'touchend'])
    expect(up.defaultPrevented).toBe(false)
  })

  it("blocks the browser's own contextmenu from a touch (Android), not the mouse's", () => {
    fire('touchstart', node, [T(1, node, 10, 10)], [T(1, node, 10, 10)])
    const fromTouch = new Event('contextmenu', { bubbles: true, cancelable: true })
    Object.defineProperty(fromTouch, 'pointerType', { value: 'touch' })
    let reached = false
    node.addEventListener('contextmenu', () => { reached = true })
    node.dispatchEvent(fromTouch)
    expect(fromTouch.defaultPrevented).toBe(true)
    expect(reached).toBe(false)
    const fromMouse = new Event('contextmenu', { bubbles: true, cancelable: true })
    Object.defineProperty(fromMouse, 'pointerType', { value: 'mouse' })
    node.dispatchEvent(fromMouse)
    expect(reached).toBe(true)
  })
})

describe('quietUncancelable', () => {
  it('only touches events that cannot be cancelled anyway', () => {
    const hard = new Event('touchmove', { cancelable: false })
    const soft = new Event('touchmove', { cancelable: true })
    quietUncancelable(hard); quietUncancelable(soft)
    expect(hard.preventDefault).not.toBe(Event.prototype.preventDefault)
    expect(soft.preventDefault).toBe(Event.prototype.preventDefault)
    hard.preventDefault() // 不抛、不报
  })
})

describe('useTouchMultiSelect', () => {
  it('holds the multi-selection key while on, and ends itself on done, on an emptied selection and when it stops being allowed', async () => {
    const active = ref(false), count = ref(0), enabled = ref(true)
    const m = useTouchMultiSelect({ enabled: () => enabled.value, count: () => count.value, active })
    m.toggle(); await nextTick()
    expect(m.on.value).toBe(true); expect(active.value).toBe(true)
    active.value = false; await nextTick() // vue-flow 松开 Ctrl 时写回 false
    expect(active.value).toBe(true)
    count.value = 2; await nextTick()
    m.done(); await nextTick()
    expect(m.on.value).toBe(false); expect(active.value).toBe(false)

    m.toggle(); await nextTick()
    count.value = 0; await nextTick() // 点空白处清掉了选择
    expect(m.on.value).toBe(false)

    m.toggle(); await nextTick()
    enabled.value = false; await nextTick() // 变成只读
    expect(m.on.value).toBe(false)
    m.toggle(); await nextTick()
    expect(m.on.value).toBe(false) // 不允许时开不起来
  })
})
