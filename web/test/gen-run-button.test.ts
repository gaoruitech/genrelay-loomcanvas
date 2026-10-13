import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, reactive, nextTick, type App } from 'vue'
import { i18n } from '../src/locales'
import { installTip } from '../src/directives/tip'
import { GEN_NODE_KEY, type GenNodeState } from '../src/composables/useGenNode'
import GenRunButton from '../src/components/canvas/gen/GenRunButton.vue'

/**
 * 运行钮上的字只有一个来源（g.runLabel）：有结果之后三种布局都写「重新运行」。
 * 以前节点里那一颗（md，布局 c）为了省地方永远写「运行」，和另外两种布局说法不一样。
 */
let app: App | null = null
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = '' })

function mount(variant: 'lg' | 'md' | 'bar' | 'icon' | 'chip', state: Record<string, unknown>) {
  const g = reactive({ isRunning: false, canCancel: false, status: 'idle', progress: 0, runLabel: 'Run', runningLabel: 'Generating', modelLabel: 'M', run: () => {}, cancel: () => {}, ...state })
  const host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(GenRunButton, { variant }) })
  app.use(i18n)
  installTip(app)
  app.provide(GEN_NODE_KEY, g as unknown as GenNodeState)
  app.mount(host)
  return { host, g }
}

describe('GenRunButton', () => {
  it.each(['lg', 'md', 'chip'] as const)('%s shows the full label, also when re-running', async (variant) => {
    const { host, g } = mount(variant, { runLabel: 'Run' })
    const btn = host.querySelector<HTMLElement>('[data-testid="gen-run"]')!
    expect(btn.textContent!.trim()).toBe('Run')
    g.runLabel = 'Re-run'
    await nextTick()
    expect(btn.textContent!.trim()).toBe('Re-run')
  })

  // 布局 c 的那一行（md）只有字：以前「放得下才带三角」，同一张画布上有的节点带、有的不带
  it('md never carries the play icon; lg and chip always do', async () => {
    for (const label of ['Run', 'Re-run']) {
      const md = mount('md', { runLabel: label })
      expect(md.host.querySelector('[data-testid="gen-run"] svg')).toBeNull()
      expect(md.host.querySelector('[data-testid="gen-run"]')!.textContent!.trim()).toBe(label)
      app!.unmount(); app = null; document.body.innerHTML = ''
    }
    for (const variant of ['lg', 'chip'] as const) {
      const m = mount(variant, { runLabel: 'Re-run' })
      expect(m.host.querySelector('[data-testid="gen-run"] svg')).toBeTruthy()
      app!.unmount(); app = null; document.body.innerHTML = ''
    }
  })

  it('icon: no text, the label is its accessible name', () => {
    const { host } = mount('icon', { runLabel: 'Re-run' })
    const btn = host.querySelector<HTMLElement>('[data-testid="gen-run"]')!
    expect(btn.textContent!.trim()).toBe('')
    expect(btn.getAttribute('aria-label')).toBe('Re-run')
    expect(btn.hasAttribute('title')).toBe(false)
  })

  it('running: progress with cancel instead of the run button', () => {
    const { host } = mount('bar', { isRunning: true, canCancel: true, status: 'running', progress: 40, runningLabel: 'Generating 40%' })
    expect(host.querySelector('[data-testid="gen-run"]')).toBeNull()
    expect(host.querySelector('[data-testid="gen-progress"]')!.textContent).toContain('Generating 40% · M')
    expect(host.querySelector('[data-testid="gen-cancel"]')).toBeTruthy()
  })
})

/**
 * 只读（别人正在编辑、只有查看权、丢了锁）：没有运行这回事 —— 按钮不出现，不是摆一颗点不动的。
 * 是活的：丢了锁的那一刻按钮消失，接管之后回来。
 */
describe('GenRunButton · read-only', () => {
  it.each(['lg', 'md', 'chip', 'icon'] as const)('%s: no run button; it comes back when the canvas is editable again', async (variant) => {
    const { host, g } = mount(variant, { viewOnly: true })
    expect(host.querySelector('[data-testid="gen-run"]')).toBeNull()
    expect(host.querySelector('button')).toBeNull()
    ;(g as { viewOnly?: boolean }).viewOnly = false
    await nextTick()
    expect(host.querySelector('[data-testid="gen-run"]')).toBeTruthy()
    ;(g as { viewOnly?: boolean }).viewOnly = true
    await nextTick()
    expect(host.querySelector('[data-testid="gen-run"]')).toBeNull()
  })

  it('a run in progress still shows its progress, without "cancel"; the small icon button (cancel only) is gone', () => {
    const bar = mount('bar', { viewOnly: true, isRunning: true, canCancel: false, status: 'running', progress: 40, runningLabel: 'Generating 40%' })
    expect(bar.host.querySelector('[data-testid="gen-progress"]')!.textContent).toContain('Generating 40%')
    expect(bar.host.querySelector('[data-testid="gen-cancel"]')).toBeNull()
    app!.unmount(); app = null
    const icon = mount('icon', { viewOnly: true, isRunning: true, canCancel: false, status: 'running' })
    expect(icon.host.querySelector('button')).toBeNull()
  })
})
