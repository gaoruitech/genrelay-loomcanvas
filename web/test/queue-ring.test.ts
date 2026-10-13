import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, shallowRef, type App } from 'vue'
import type { Node } from '@vue-flow/core'
import { i18n, setLocale } from '../src/locales'
import { installTip } from '../src/directives/tip'
import QueuePanel from '../src/components/canvas/QueuePanel.vue'

/**
 * 生成队列的圆钮：
 *  - 进度环画的是「这一批」的整体进度，只往前走 —— 一个任务结束、中途又加了一个，都不会让它往回退；
 *    一批结束（回到空闲）才清零，下一批从头来；
 *  - 一个数都还没有（没有任务报进度，也还没有任务结束）就转弧，不编数字；
 *  - 连点两下只是开了又关：没有「双击复位」。
 */
let app: App | null = null
let host: HTMLElement
const nodes = shallowRef<Node[]>([])

const node = (id: string, status: string, progress = 0, extra: Record<string, unknown> = {}): Node =>
  ({ id, type: 'image-gen', position: { x: 0, y: 0 }, data: { status, progress, ...extra } })
const set = async (list: Node[]) => { nodes.value = list; await nextTick(); await nextTick() }

beforeEach(async () => {
  setLocale('en', false)
  nodes.value = []
  host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(QueuePanel, { nodes: nodes.value, workflowId: 'w1', titleOf: (t: string) => t, cancelNode: async () => {} }) })
  app.use(i18n)
  installTip(app)
  app.config.globalProperties.$lcPortal = 'body'
  app.config.globalProperties.$src = (u: string) => u
  app.mount(host)
  await nextTick()
})
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = '' })

const ringEl = () => host.querySelector<HTMLElement>('.qf-ring')!
const ring = () => ({
  p: Number(ringEl().style.getPropertyValue('--lc-qf-p') || 0),
  on: ringEl().classList.contains('on'),
  spin: ringEl().classList.contains('spin'),
  // what the button says for itself (the number in the middle rolls in through a transition)
  says: host.querySelector('.qf-btn')!.getAttribute('aria-label') || '',
})

describe('the ring on the queue button', () => {
  it('is off when nothing runs, and spins until there is a number to show', async () => {
    expect(ring()).toMatchObject({ on: false, spin: false })
    expect(ring().says).toContain('Idle')
    await set([node('a', 'running', 0)])
    expect(ring()).toMatchObject({ on: true, spin: true })
    expect(ring().says).toContain('1 running')
    await set([node('a', 'running', 30)])
    expect(ring()).toMatchObject({ on: true, spin: false, p: 30 })
  })

  it('shows the batch as a whole and never runs backwards while runs finish and others join', async () => {
    const seen: number[] = []
    const step = async (list: Node[]) => { await set(list); seen.push(ring().p) }
    await step([node('a', 'running', 80), node('b', 'running', 40)]) // (80 + 40) / 2
    expect(ring().p).toBe(60)
    // a finishes: the average of what is still running would drop to 40
    await step([node('a', 'done', 100), node('b', 'running', 40)]) // (100 + 40) / 2
    expect(ring().p).toBe(70)
    // a third run joins at 0, and one more waits: more work, but the ring holds its ground
    await step([node('a', 'done', 100), node('b', 'running', 40), node('c', 'running', 0), node('d', 'queued')])
    expect(ring().p).toBe(70)
    expect(ring().says).toContain('2 running · 1 queued')
    await step([node('a', 'done', 100), node('b', 'done', 100), node('c', 'running', 20), node('d', 'queued')]) // (200 + 20) / 4 = 55
    expect(ring().p).toBe(70)
    await step([node('a', 'done', 100), node('b', 'done', 100), node('c', 'running', 90), node('d', 'running', 10)]) // (200 + 100) / 4
    expect(ring().p).toBe(75)
    // one fails: it is over all the same
    await step([node('a', 'done', 100), node('b', 'done', 100), node('c', 'error', 0, { errorMsg: 'no' }), node('d', 'running', 60)]) // (300 + 60) / 4
    expect(ring().p).toBe(90)
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true)
    // a run that only went back to waiting (for an upstream node) has not ended
    await set([node('a', 'done', 100), node('b', 'done', 100), node('c', 'error', 0, { errorMsg: 'no' }), node('d', 'queued')])
    expect(ring().on).toBe(false) // nothing is running: the dashed "waiting" look, no arc
    await set([node('a', 'done', 100), node('b', 'done', 100), node('c', 'error', 0, { errorMsg: 'no' }), node('d', 'running', 70)]) // (300 + 70) / 4
    expect(ring().p).toBe(93)
  })

  it('starts over with the next batch', async () => {
    await set([node('a', 'running', 90)])
    expect(ring().p).toBe(90)
    await set([node('a', 'done', 100)])
    expect(ring()).toMatchObject({ on: false, p: 0 })
    await set([node('a', 'done', 100), node('b', 'running', 10)])
    expect(ring()).toMatchObject({ on: true, p: 10 })
    expect(ring().says).toContain('1 running')
  })
})

describe('the queue button itself', () => {
  it('two quick clicks open and close the list - nothing resets, and there is no double-click handler', async () => {
    const btn = host.querySelector<HTMLButtonElement>('.qf-btn')!
    const down = (type: string) => { const e = new Event(type, { bubbles: true, cancelable: true }); Object.assign(e, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 }); btn.dispatchEvent(e) }
    const click = async () => { down('pointerdown'); down('pointerup'); await nextTick() }
    await click()
    expect(document.querySelector('.qp')).not.toBeNull()
    await click()
    await nextTick()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    btn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    await nextTick()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    // an icon-only button with a name, and no native title
    expect(btn.getAttribute('aria-label')).toContain('Queue')
    expect(btn.hasAttribute('title')).toBe(false)
  })
})
