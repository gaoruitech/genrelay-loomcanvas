import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, reactive, ref, type App } from 'vue'
import { i18n, setLocale } from '../src/locales'
import { installTip } from '../src/directives/tip'
import { composeBrandKit, kitRunState, resolveNodeKit, KIT_NONE, type BrandKit, type BrandKitEffect } from '../src/composables/useBrandKits'
import { CANVAS_BRAND_KIT_KEY } from '../src/composables/canvasBrandKitKey'
import { CANVAS_EXECUTOR_KEY } from '../src/composables/canvasExecutorKey'
import NodeBrandKit from '../src/components/canvas/NodeBrandKit.vue'
import { EMBED_KEY, createEmbedContext } from '../src/embed/context'
import { resolveFeatures } from '../src/embed/options'

/**
 * 节点上的品牌包标记说的是不是实话。
 *
 * 「选了品牌包」和「品牌包起了作用」是两回事：首尾帧模式、不接收参考图的模型下参考图发不出去，
 * 只有参考图的品牌包这时一个字、一张图都加不上 —— 界面不能还写「已套用」。
 */

const kit = (over: Partial<BrandKit> = {}): BrandKit => ({
  id: 'k1', name: 'Studio', refImages: ['/k/a.png', '/k/b.png'], promptPrefix: 'white seamless background', negativePrompt: 'watermark', isDefault: false, ...over,
})
const run = (k: BrandKit, input: { own?: string[]; maxRefs: number; framesMode?: boolean }): BrandKitEffect =>
  composeBrandKit(k, { prompt: 'a shoe', imageUrls: input.own || [], maxRefs: input.maxRefs, framesMode: input.framesMode })
const chosen = (k: BrandKit) => ({ kit: k, own: false, missing: false })

describe('kitRunState', () => {
  it('no kit, or a node-level exception', () => {
    expect(kitRunState({ kit: null, own: false, missing: false }, null)).toBe('none')
    expect(kitRunState({ kit: null, own: true, missing: false }, null)).toBe('off')
    expect(kitRunState({ kit: null, own: true, missing: true }, null)).toBe('missing')
  })

  it('everything in the kit is sent', () => {
    const k = kit()
    expect(kitRunState(chosen(k), run(k, { maxRefs: 8 }))).toBe('applied')
    // 只有文字的品牌包在首尾帧模式下照样是「已套用」：它没有图可跳过
    const textOnlyKit = kit({ refImages: [] })
    expect(kitRunState(chosen(textOnlyKit), run(textOnlyKit, { maxRefs: 3, framesMode: true }))).toBe('applied')
  })

  it('first/last-frame mode: text goes out, reference images do not', () => {
    const k = kit()
    const e = run(k, { own: ['/first.png', '/last.png'], maxRefs: 3, framesMode: true })
    expect(e.imageUrls).toEqual(['/first.png', '/last.png'])
    expect(e.skipReason).toBe('frames')
    expect(kitRunState(chosen(k), e)).toBe('textOnly')
  })

  it('a model that takes no reference image', () => {
    const k = kit()
    const e = run(k, { maxRefs: 0 })
    expect(e.skipReason).toBe('noRefs')
    expect(e.addedImages).toEqual([])
    expect(kitRunState(chosen(k), e)).toBe('textOnly')
    // 只有参考图的品牌包：这次运行什么都加不上
    const imagesOnly = kit({ promptPrefix: '', negativePrompt: '' })
    const e2 = run(imagesOnly, { maxRefs: 0 })
    expect(e2.prompt).toBe('a shoe')
    expect(kitRunState(chosen(imagesOnly), e2)).toBe('noEffect')
    expect(kitRunState(chosen(imagesOnly), run(imagesOnly, { own: ['/f.png', '/l.png'], maxRefs: 3, framesMode: true }))).toBe('noEffect')
  })

  it('the model has room for only some of the kit images', () => {
    const k = kit({ refImages: ['/k/a.png', '/k/b.png', '/k/c.png'] })
    const some = run(k, { own: ['/own.png'], maxRefs: 3 })
    expect(some.addedImages).toEqual(['/k/a.png', '/k/b.png'])
    expect(kitRunState(chosen(k), some)).toBe('partial')
    const full = run(k, { own: ['/1.png', '/2.png', '/3.png'], maxRefs: 3 })
    expect(full.addedImages).toEqual([])
    expect(full.skipReason).toBe('full')
    expect(kitRunState(chosen(k), full)).toBe('textOnly')
  })

  it('an empty kit', () => {
    const k = kit({ refImages: [], promptPrefix: ' ', negativePrompt: '' })
    expect(kitRunState(chosen(k), run(k, { maxRefs: 8 }))).toBe('empty')
  })

  it('without the executor nothing is claimed beyond "chosen"', () => {
    expect(kitRunState(chosen(kit()), null)).toBe('applied')
  })
})

/* ── 组件：标记上写的字 ── */
let app: App | null = null
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ''; setLocale('zh-CN', false) })

async function mountMark(opts: { kits: BrandKit[]; canvasKitId?: string; data?: Record<string, unknown>; effect?: (k: BrandKit) => BrandKitEffect; entry?: boolean; mark?: boolean; readOnly?: boolean; features?: Record<string, boolean> }) {
  const list = ref(opts.kits)
  const canvasKitId = ref(opts.canvasKitId || '')
  const data = ref<Record<string, unknown>>(opts.data || {})
  const host = document.createElement('div')
  document.body.appendChild(host)
  app = createApp({ render: () => h(NodeBrandKit, { nodeId: 'n1', data: data.value, mark: opts.mark !== false, entry: !!opts.entry, readOnly: !!opts.readOnly }) })
  app.use(i18n)
  // 集成方关掉了哪些功能（embed 的 features）：不给就是独立应用的默认值
  if (opts.features) app.provide(EMBED_KEY, createEmbedContext({ features: reactive({ ...resolveFeatures(undefined, { mode: 'standalone' }), ...opts.features }) as never }))
  installTip(app)
  app.config.globalProperties.$lcPortal = 'body'
  app.provide(CANVAS_BRAND_KIT_KEY, {
    list, canvasKitId,
    resolve: (d: unknown) => resolveNodeKit(list.value, canvasKitId.value, d),
    setNodeOverride: (_id: string, v: string) => { data.value = { ...data.value, brandKitOverride: v } },
  })
  app.provide(CANVAS_EXECUTOR_KEY, {
    brandKitEffect: () => {
      const c = resolveNodeKit(list.value, canvasKitId.value, data.value)
      return c.kit && opts.effect ? { kit: c.kit, effect: opts.effect(c.kit) } : null
    },
  } as never)
  app.mount(host)
  await nextTick()
  const btn = host.querySelector<HTMLElement>('[data-testid="kit-mark"]')
  const visible = !!btn && (btn.parentElement as HTMLElement).style.display !== 'none'
  return { host, btn, visible, data }
}

describe('NodeBrandKit mark', () => {
  it('names the kit whenever one applies, in both languages', async () => {
    const k = kit()
    let m = await mountMark({ kits: [k], canvasKitId: 'k1', effect: (x) => run(x, { maxRefs: 8 }) })
    expect(m.visible).toBe(true)
    expect(m.btn!.dataset.state).toBe('applied')
    expect(m.btn!.getAttribute('aria-label')).toBe('品牌包：Studio')
    app!.unmount(); app = null
    setLocale('en', false)
    m = await mountMark({ kits: [k], canvasKitId: 'k1', effect: (x) => run(x, { maxRefs: 8 }) })
    expect(m.btn!.getAttribute('aria-label')).toBe('Brand kit: Studio')
  })

  it('first/last-frame mode says the reference images are not sent', async () => {
    const m = await mountMark({ kits: [kit()], canvasKitId: 'k1', effect: (x) => run(x, { own: ['/f.png', '/l.png'], maxRefs: 3, framesMode: true }) })
    expect(m.btn!.dataset.state).toBe('textOnly')
    expect(m.btn!.getAttribute('aria-label')).toContain('首尾帧模式只发首帧和尾帧')
    expect(m.btn!.getAttribute('aria-label')).toContain('2 张参考图不会发出')
  })

  it('a no-reference model with an images-only kit is not reported as applied', async () => {
    const m = await mountMark({ kits: [kit({ promptPrefix: '', negativePrompt: '' })], canvasKitId: 'k1', effect: (x) => run(x, { maxRefs: 0 }) })
    expect(m.btn!.dataset.state).toBe('noEffect')
    const label = m.btn!.getAttribute('aria-label') || ''
    expect(label).toContain('这次运行不起作用')
    expect(label).toContain('不接收参考图')
    expect(label).not.toContain('已套用')
  })

  it('no kit: hidden, unless the node is the only place to choose one (entry)', async () => {
    let m = await mountMark({ kits: [kit()] })
    expect(m.visible).toBe(false)
    app!.unmount(); app = null
    m = await mountMark({ kits: [kit()], entry: true })
    expect(m.visible).toBe(true)
    expect(m.btn!.dataset.state).toBe('none')
    app!.unmount(); app = null
    // 一个品牌包都没有：入口也不出现
    m = await mountMark({ kits: [], entry: true })
    expect(m.visible).toBe(false)
  })

  it('node-level exceptions', async () => {
    let m = await mountMark({ kits: [kit()], canvasKitId: 'k1', data: { brandKitOverride: KIT_NONE }, effect: (x) => run(x, { maxRefs: 8 }) })
    expect(m.btn!.dataset.state).toBe('off')
    expect(m.btn!.getAttribute('aria-label')).toBe('此节点不套用品牌包')
    app!.unmount(); app = null
    m = await mountMark({ kits: [kit()], canvasKitId: 'k1', data: { brandKitOverride: 'gone' }, effect: (x) => run(x, { maxRefs: 8 }) })
    expect(m.btn!.dataset.state).toBe('missing')
  })

  it('opens a panel with the choices and what is added; choosing writes the node override', async () => {
    const m = await mountMark({ kits: [kit()], canvasKitId: 'k1', effect: (x) => run(x, { maxRefs: 8 }) })
    m.btn!.click()
    await nextTick(); await nextTick()
    const pop = document.querySelector<HTMLElement>('[data-testid="kit-pop"]')!
    expect(pop).toBeTruthy()
    expect(m.btn!.getAttribute('aria-expanded')).toBe('true')
    expect(pop.querySelectorAll('[role="radio"]').length).toBe(3)
    expect(pop.querySelector('[data-part="prefix"]')!.textContent).toBe('white seamless background')
    expect(pop.querySelectorAll('[data-part="images"] img').length).toBe(2)
    pop.querySelector<HTMLElement>('[data-value="none"]')!.click()
    await nextTick()
    expect(m.data.value.brandKitOverride).toBe(KIT_NONE)
    expect(m.btn!.dataset.state).toBe('off')
  })
})

describe('NodeBrandKit line (composer / inspector)', () => {
  it('shows why reference images are skipped without opening the preview', async () => {
    const m = await mountMark({ mark: false, kits: [kit({ promptPrefix: '', negativePrompt: '' })], canvasKitId: 'k1', effect: (x) => run(x, { maxRefs: 0 }) })
    const line = m.host.querySelector<HTMLElement>('[data-testid="kit-line"]')!
    expect(line.dataset.state).toBe('noEffect')
    expect(line.textContent).toContain('这次不起作用')
    expect(line.querySelector('[data-testid="kit-note"]')!.textContent).toContain('不接收参考图')
    expect(line.textContent).not.toContain('已套用品牌包')
  })
})

/**
 * 两种「不该出现」：
 *  - 集成方关掉了品牌包（features.brandKit: false）：标记、那一行、入口都不画 —— 不能留一颗点开全是品牌包字样的按钮；
 *  - 画布只读（别人正在编辑、只有查看权）：套的是哪个、会加什么照样看得到，但没有「换一个」的入口，写也写不进去。
 */
describe('NodeBrandKit: feature off / read-only', () => {
  it('features.brandKit off: nothing is rendered, neither the mark nor the line', async () => {
    const k = kit()
    let m = await mountMark({ kits: [k], canvasKitId: 'k1', entry: true, effect: (x) => run(x, { maxRefs: 8 }), features: { brandKit: false } })
    expect(m.visible).toBe(false)
    // 连一颗藏着的按钮都不留（读屏、按文字找入口的检查都会数到它）
    expect(m.btn).toBeNull()
    expect(m.host.querySelector('button')).toBeNull()
    app!.unmount(); app = null
    m = await mountMark({ mark: false, kits: [k], canvasKitId: 'k1', data: { brandKitOverride: KIT_NONE }, effect: (x) => run(x, { maxRefs: 8 }), features: { brandKit: false } })
    expect(m.host.querySelector('[data-testid="kit-line"]')).toBeNull()
    expect(m.host.textContent!.trim()).toBe('')
    app!.unmount(); app = null
    // 开着的时候同样的数据是有东西的（对照）
    m = await mountMark({ mark: false, kits: [k], canvasKitId: 'k1', effect: (x) => run(x, { maxRefs: 8 }), features: { brandKit: true } })
    expect(m.host.querySelector('[data-testid="kit-line"]')).toBeTruthy()
  })

  it('read-only: the mark still tells which kit applies, the panel has no choices', async () => {
    const m = await mountMark({ kits: [kit()], canvasKitId: 'k1', readOnly: true, effect: (x) => run(x, { maxRefs: 8 }) })
    expect(m.visible).toBe(true)
    expect(m.btn!.dataset.state).toBe('applied')
    m.btn!.click()
    await nextTick(); await nextTick()
    const pop = document.querySelector<HTMLElement>('[data-testid="kit-pop"]')!
    expect(pop).toBeTruthy()
    expect(pop.querySelectorAll('[role="radio"]').length).toBe(0)
    expect(pop.querySelector('[data-part="prefix"]')!.textContent).toBe('white seamless background')
  })

  it('read-only: no quiet "choose a kit for this node" entry, and no line when nothing applies', async () => {
    let m = await mountMark({ kits: [kit()], entry: true, readOnly: true })
    expect(m.visible).toBe(false)
    app!.unmount(); app = null
    m = await mountMark({ mark: false, kits: [kit()], readOnly: true })
    expect(m.host.querySelector('[data-testid="kit-line"]')).toBeNull()
  })

  it('read-only: the line shows what applies without the per-node dropdown, and nothing can be written', async () => {
    const m = await mountMark({ mark: false, kits: [kit()], canvasKitId: 'k1', readOnly: true, effect: (x) => run(x, { maxRefs: 8 }) })
    const line = m.host.querySelector<HTMLElement>('[data-testid="kit-line"]')!
    expect(line).toBeTruthy()
    expect(line.querySelector('.chip-select')).toBeNull()
    expect(line.textContent).toContain('Studio')
    expect(m.data.value.brandKitOverride).toBeUndefined()
  })

  it('editable: the options carry keyboard focus (the current one is the first stop)', async () => {
    const m = await mountMark({ kits: [kit()], canvasKitId: 'k1', effect: (x) => run(x, { maxRefs: 8 }) })
    m.btn!.click()
    await nextTick(); await nextTick()
    const pop = document.querySelector<HTMLElement>('[data-testid="kit-pop"]')!
    const current = pop.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')!
    expect(current.hasAttribute('data-autofocus')).toBe(true)
    expect(document.activeElement).toBe(current)
    current.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect((document.activeElement as HTMLElement).dataset.value).toBe('none')
  })
})
