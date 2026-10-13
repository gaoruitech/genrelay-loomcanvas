import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, reactive, nextTick, type App } from 'vue'
import { i18n } from '../src/locales'
import { installTip } from '../src/directives/tip'
import { GEN_NODE_KEY, type GenNodeState } from '../src/composables/useGenNode'
import type { NodeLayout } from '../src/composables/nodeLayout'
import GenMedia from '../src/components/canvas/gen/GenMedia.vue'

/**
 * 节点上的结果区在几种状态下的结构 —— 样式靠这些结构和类名说话：
 *  - 文本类节点的结果是「输出」：一块不带底色的面，上面一行小字写明它是结果（也是文字框的无障碍名字），
 *    清空 / 字数 / 放大在这一行里、在文字框外面（压在文字框上时，长文滚到中间，字会从它底下透出来）；
 *    还没有结果时带 empty（虚线框，和出图节点的占位同一种说法）；
 *  - 没有结果时运行：结果区同时带 is-empty 和 is-run，样式据此不压暗、把占位里的图标和那句话让给进度环。
 */
let app: App | null = null
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = '' })

function mount(layout: NodeLayout, state: Record<string, unknown>) {
  const g = reactive({
    id: 'n1', media: 'image', isText: false, readonly: false, icon: 'image',
    mediaUrl: '', mediaList: [] as string[], versions: [] as unknown[], aspectRatio: '',
    text: '', placeholder: 'Result goes here', runningPlain: 'Generating', effectivePrompt: '',
    isRunning: false, canCancel: false, status: 'idle', progress: 0, displayError: '',
    runLabel: 'Run', runningLabel: 'Generating', modelLabel: 'M',
    run: () => {}, cancel: () => {}, selectMedia: () => {}, selectVersion: () => {},
    ...state,
  })
  const host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(GenMedia, { layout, selected: false }) })
  app.use(i18n)
  installTip(app)
  app.config.globalProperties.$src = (u: string) => u
  app.provide(GEN_NODE_KEY, g as unknown as GenNodeState)
  app.mount(host)
  return { host, g, media: host.querySelector<HTMLElement>('.gn-media')! }
}

describe('GenMedia · text result', () => {
  it.each(['a', 'c'] as const)('layout %s: a labelled output panel, the tools row sits above the text box, not over it', (layout) => {
    const { host, media } = mount(layout, { kind: 'llm', media: 'text', isText: true, text: 'hello' })
    expect(media.classList.contains('m-text')).toBe(true)
    const box = host.querySelector<HTMLElement>('[data-testid="gen-result"]')!
    const head = box.querySelector<HTMLElement>('.gn-text-h')!
    const ta = box.querySelector<HTMLTextAreaElement>('textarea[data-testid="gen-text"]')!
    expect(head.parentElement).toBe(box)
    expect(ta.parentElement).toBe(box)
    expect(head.nextElementSibling).toBe(ta)
    expect(box.classList.contains('empty')).toBe(false)
    // 那一行小字就是文字框的名字（读屏）；放大按钮有名字、不用原生 title
    const label = head.querySelector<HTMLElement>('.gn-text-l')!
    expect(label.textContent!.trim()).toBe(i18n.global.t('nodeui.llm.result'))
    expect(ta.getAttribute('aria-labelledby')).toBe(label.id)
    expect(head.querySelector('.gf-count')!.textContent).toContain('5 /')
    const expand = head.querySelector<HTMLElement>('[data-testid="gen-text-expand"]')!
    expect(expand.getAttribute('aria-label')).toBeTruthy()
    expect(expand.hasAttribute('title')).toBe(false)
  })

  it('video analysis is labelled as an analysis result', () => {
    const { host } = mount('c', { kind: 'video-analysis', media: 'text', isText: true, text: 'x' })
    expect(host.querySelector('.gn-text-l')!.textContent!.trim()).toBe(i18n.global.t('nodeui.analysis.result'))
  })

  it('no result yet: marked empty, no clear / count noise; clear appears with text and empties it', async () => {
    const { host, g } = mount('c', { kind: 'llm', media: 'text', isText: true, text: '' })
    const box = host.querySelector<HTMLElement>('[data-testid="gen-result"]')!
    expect(box.classList.contains('empty')).toBe(true)
    expect(host.querySelector('[data-testid="gen-text-clear"]')).toBeNull()
    expect(host.querySelector('.gn-text-h .gf-count')).toBeNull()
    expect(host.querySelector('[data-testid="gen-text-expand"]')).toBeTruthy()
    g.text = 'hello'
    await nextTick()
    expect(box.classList.contains('empty')).toBe(false)
    host.querySelector<HTMLButtonElement>('[data-testid="gen-text-clear"]')!.click()
    await nextTick()
    expect(g.text).toBe('')
    expect(box.classList.contains('empty')).toBe(true)
  })

  it('running: the box is marked busy and the text box is disabled', () => {
    const { host, media } = mount('c', { media: 'text', isText: true, text: 'old', isRunning: true, status: 'running' })
    expect(media.classList.contains('is-run')).toBe(true)
    expect(host.querySelector('.gn-tbox')!.classList.contains('busy')).toBe(true)
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.disabled).toBe(true)
    expect(host.querySelector('.gn-rov')).toBeTruthy()
  })

  it('layout b: a read-only preview, no text box', () => {
    const { host } = mount('b', { media: 'text', isText: true, text: '' })
    expect(host.querySelector('textarea')).toBeNull()
    expect(host.querySelector('.gn-tbox')).toBeNull()
    expect(host.querySelector('.gn-text.ro.ph')).toBeTruthy()
  })
})

describe('GenMedia · no result yet', () => {
  it('idle: a placeholder, no overlay', () => {
    const { host, media } = mount('c', {})
    expect(media.classList.contains('is-empty')).toBe(true)
    expect(media.classList.contains('is-run')).toBe(false)
    expect(host.querySelector('[data-testid="gen-empty"]')).toBeTruthy()
    expect(host.querySelector('.gn-rov')).toBeNull()
  })

  it('running: is-empty and is-run together, with the progress ring', async () => {
    const { host, media, g } = mount('c', { isRunning: true, status: 'running', progress: 0 })
    expect(media.classList.contains('is-empty')).toBe(true)
    expect(media.classList.contains('is-run')).toBe(true)
    const ring = host.querySelector<HTMLElement>('.gn-rov .gn-ring')!
    expect(ring.classList.contains('indet')).toBe(true)
    g.progress = 42
    await nextTick()
    expect(ring.classList.contains('indet')).toBe(false)
    expect(ring.textContent).toContain('42%')
  })

  it('with a result the overlay sits on the picture: not marked empty', () => {
    const { media } = mount('c', { mediaUrl: '/files/a.png', mediaList: ['/files/a.png'], isRunning: true, status: 'running' })
    expect(media.classList.contains('is-empty')).toBe(false)
    expect(media.classList.contains('is-run')).toBe(true)
  })
})

/**
 * 只读（别人正在编辑、只有查看权）：结果照样看 —— 文字能选中复制（readonly，不是 disabled）、能放大；改的入口不出现。
 */
describe('GenMedia · read-only', () => {
  it.each(['a', 'c'] as const)('layout %s text result: the box stays, read-only and not disabled; no "clear"; expand says "to read"', async (layout) => {
    const { host, g } = mount(layout, { kind: 'llm', media: 'text', isText: true, text: 'hello', viewOnly: true })
    const ta = host.querySelector<HTMLTextAreaElement>('textarea[data-testid="gen-text"]')!
    expect(ta.readOnly).toBe(true)
    expect(ta.disabled).toBe(false)
    expect(host.querySelector('[data-testid="gen-text-clear"]')).toBeNull()
    expect(host.querySelector<HTMLElement>('[data-testid="gen-text-expand"]')!.getAttribute('aria-label')).toBe(i18n.global.t('nodeui.ro.expand'))
    // 接管之后：同一个框变回可编辑，清空回来
    ;(g as { viewOnly?: boolean }).viewOnly = false
    await nextTick()
    expect(ta.readOnly).toBe(false)
    expect(host.querySelector('[data-testid="gen-text-clear"]')).toBeTruthy()
    expect(host.querySelector<HTMLElement>('[data-testid="gen-text-expand"]')!.getAttribute('aria-label')).toBe(i18n.global.t('nodes.action.expand'))
  })

  it('a running text node stays selectable for a viewer (not disabled)', () => {
    const { host } = mount('a', { kind: 'llm', media: 'text', isText: true, text: 'partial', viewOnly: true, isRunning: true, status: 'running' })
    const ta = host.querySelector<HTMLTextAreaElement>('textarea[data-testid="gen-text"]')!
    expect(ta.disabled).toBe(false)
    expect(ta.readOnly).toBe(true)
  })

  it('media result: no hover "re-run"; details and version chips stay; an empty node does not say "run"', () => {
    const { host } = mount('a', { mediaUrl: '/files/a.png', mediaList: ['/files/a.png', '/files/b.png'], viewOnly: true })
    expect(host.querySelector('[data-testid="gen-run"]')).toBeNull()
    expect(host.querySelector('[data-testid="gen-detail"]')).toBeTruthy()
    expect(host.querySelectorAll('.gn-strip button').length).toBe(2)
    app!.unmount(); app = null
    const empty = mount('a', { viewOnly: true })
    expect(empty.host.querySelector('[data-testid="gen-run"]')).toBeNull()
    expect(empty.host.querySelector('[data-testid="gen-empty"]')!.textContent).toContain(i18n.global.t('nodeui.share.noResult'))
  })
})
