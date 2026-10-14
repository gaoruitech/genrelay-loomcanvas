// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installPinchRouter, inScrollableBox, type TouchLike } from '../src/composables/canvasTouch'

/**
 * 两根手指落在画布上就是缩放画布，落在节点上也一样：
 * 节点（d3-drag）不该再收到第二根手指，画布（d3-zoom，挂在视口元素上）要收到带着全部手指的 touchstart / touchmove / touchend。
 * 这里不装 d3：节点和视口上各挂一个普通监听，记下它们各自收到了什么。
 */
let wrap: HTMLElement, viewport: HTMLElement, pane: HTMLElement, node: HTMLElement, chrome: HTMLElement
let stop: () => void
let busy = false
let seenByNode: string[], seenByZoom: string[]

const T = (identifier: number, target: EventTarget, clientX: number, clientY: number): TouchLike => ({ identifier, target, clientX, clientY })
/** 真实浏览器里的一次触摸事件：派在这根手指当初按下的元素上 */
function fire(type: string, on: EventTarget, touches: TouchLike[], changed: TouchLike[]) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: touches })
  Object.defineProperty(e, 'changedTouches', { value: changed })
  on.dispatchEvent(e)
  return e
}
const ids = (l: TouchLike[]) => l.map((t) => t.identifier).join('+')
const tag = (e: any) => `${e.type}[${ids(e.touches)}|${ids(e.changedTouches)}]`

beforeEach(() => {
  document.body.innerHTML = '<div id="chrome"></div><div id="wrap"><div class="vue-flow__viewport"><div id="pane"><div id="node"></div></div></div></div>'
  wrap = document.getElementById('wrap')!
  viewport = wrap.querySelector('.vue-flow__viewport')!
  pane = document.getElementById('pane')!
  node = document.getElementById('node')!
  chrome = document.getElementById('chrome')!
  seenByNode = []; seenByZoom = []; busy = false
  for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    // d3-drag：在节点上，收到就截住（和真的一样）
    node.addEventListener(type, (e) => { seenByNode.push(tag(e)); e.stopImmediatePropagation() })
    viewport.addEventListener(type, (e) => { seenByZoom.push(tag(e)) })
  }
  stop = installPinchRouter(wrap, { viewport: () => viewport, busy: () => busy })
})
afterEach(() => stop())

describe('installPinchRouter', () => {
  it('leaves a single finger alone: on a node it reaches the node only, on the pane it reaches the zoom', () => {
    const a = T(1, node, 50, 50)
    fire('touchstart', node, [a], [a]); fire('touchmove', node, [a], [a]); fire('touchend', node, [], [a])
    expect(seenByNode).toEqual(['touchstart[1|1]', 'touchmove[1|1]', 'touchend[|1]'])
    expect(seenByZoom).toEqual([])
    const b = T(2, pane, 300, 300)
    fire('touchstart', pane, [b], [b]); fire('touchend', pane, [], [b])
    expect(seenByZoom).toEqual(['touchstart[2|2]', 'touchend[|2]'])
  })

  it('both fingers on a node: the node drag is cancelled where it began, the zoom gets both fingers, the node never sees the second', () => {
    const a = T(1, node, 50, 50)
    fire('touchstart', node, [a], [a])
    const a2 = T(1, node, 53, 51) // 第一根手指抖了几个像素
    const b = T(2, node, 90, 50)
    const second = fire('touchstart', node, [a2, b], [b])
    expect(second.defaultPrevented).toBe(true)
    // 节点：自己的 touchstart，然后一个 touchcancel —— 坐标是按下时的（不算点击、不算拖过）
    expect(seenByNode).toEqual(['touchstart[1|1]', 'touchcancel[|1]'])
    expect(seenByZoom).toEqual(['touchstart[1+2|1+2]'])
    // 之后的移动、抬起全归画布
    fire('touchmove', node, [T(1, node, 30, 50), T(2, node, 120, 50)], [T(1, node, 30, 50), T(2, node, 120, 50)])
    fire('touchend', node, [T(2, node, 120, 50)], [T(1, node, 30, 50)])
    fire('touchmove', node, [T(2, node, 130, 60)], [T(2, node, 130, 60)]) // 剩下的那根接着平移画布，而不是拖节点
    fire('touchend', node, [], [T(2, node, 130, 60)])
    expect(seenByNode).toEqual(['touchstart[1|1]', 'touchcancel[|1]'])
    expect(seenByZoom).toEqual(['touchstart[1+2|1+2]', 'touchmove[1+2|1+2]', 'touchend[2|1]', 'touchmove[2|2]', 'touchend[|2]'])
    // 手指全抬起之后恢复原样
    const c = T(3, node, 50, 50)
    fire('touchstart', node, [c], [c])
    expect(seenByNode[seenByNode.length - 1]).toBe('touchstart[3|3]')
  })

  it('the cancel carries the position the finger went down at', () => {
    let cancelAt: number[] = []
    node.addEventListener('touchcancel', (e: any) => { cancelAt = [e.changedTouches[0].clientX, e.changedTouches[0].clientY] }, true)
    const a = T(1, node, 50, 50)
    fire('touchstart', node, [a], [a])
    fire('touchstart', pane, [T(1, node, 58, 44), T(2, pane, 300, 300)], [T(2, pane, 300, 300)])
    expect(cancelAt).toEqual([50, 50])
  })

  it('first finger on the pane, second on a node: the zoom is restarted with both, the node sees nothing', () => {
    const a = T(1, pane, 300, 300)
    fire('touchstart', pane, [a], [a])
    const b = T(2, node, 50, 50)
    fire('touchstart', node, [a, b], [b])
    expect(seenByNode).toEqual([])
    expect(seenByZoom).toEqual(['touchstart[1|1]', 'touchcancel[|1]', 'touchstart[1+2|1+2]'])
  })

  it('a third finger is ignored and not passed down', () => {
    const a = T(1, pane, 300, 300), b = T(2, pane, 200, 300), c = T(3, node, 50, 50)
    fire('touchstart', pane, [a], [a]); fire('touchstart', pane, [a, b], [b])
    const n = seenByZoom.length
    fire('touchstart', node, [a, b, c], [c])
    expect(seenByNode).toEqual([])
    expect(seenByZoom.length).toBe(n)
  })

  it('stays out of it while a wire is being dragged, or when a finger is outside the canvas', () => {
    busy = true
    const a = T(1, pane, 300, 300), b = T(2, node, 50, 50)
    fire('touchstart', pane, [a], [a]); fire('touchstart', node, [a, b], [b])
    expect(seenByNode).toEqual(['touchstart[1+2|2]'])
    fire('touchend', node, [a], [b]); fire('touchend', pane, [], [a])
    busy = false; seenByNode = []; seenByZoom = []
    const x = T(4, chrome, 10, 10), y = T(5, node, 50, 50)
    fire('touchstart', chrome, [x], [x]); fire('touchstart', node, [x, y], [y])
    expect(seenByNode).toEqual(['touchstart[4+5|5]'])
    expect(seenByZoom).toEqual([])
  })

  it('a finger on a box that really scrolls is left to the browser: neither the node nor the zoom gets the touchstart', () => {
    node.innerHTML = '<div class="nodrag nowheel" id="box"><p id="line">text</p></div><div class="nodrag nowheel" id="short"></div>'
    const box = document.getElementById('box')!, line = document.getElementById('line')!, short = document.getElementById('short')!
    box.style.overflowY = 'auto'; short.style.overflowY = 'auto'
    Object.defineProperty(box, 'scrollHeight', { value: 900 }); Object.defineProperty(box, 'clientHeight', { value: 120 })
    Object.defineProperty(short, 'scrollHeight', { value: 120 }); Object.defineProperty(short, 'clientHeight', { value: 120 })
    expect(inScrollableBox(line, viewport)).toBe(true)
    expect(inScrollableBox(short, viewport)).toBe(false) // 没有可滚的内容：照常拖节点 / 平移
    expect(inScrollableBox(node, viewport)).toBe(false)
    const a = T(1, line, 50, 50)
    const e = fire('touchstart', line, [a], [a])
    expect(e.defaultPrevented).toBe(false) // 不能拦默认行为，滚动要靠它
    expect(seenByNode).toEqual([]); expect(seenByZoom).toEqual([])
    fire('touchend', line, [], [a])
    const b = T(2, short, 50, 50)
    fire('touchstart', short, [b], [b])
    expect(seenByNode).toEqual(['touchend[|1]', 'touchstart[2|2]'])
  })

  it('uninstalls', () => {
    stop()
    const a = T(1, node, 50, 50), b = T(2, node, 90, 50)
    fire('touchstart', node, [a], [a]); fire('touchstart', node, [a, b], [b])
    expect(seenByNode).toEqual(['touchstart[1|1]', 'touchstart[1+2|2]'])
  })
})
