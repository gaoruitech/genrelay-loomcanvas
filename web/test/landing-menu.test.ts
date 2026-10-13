import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { i18n, setLocale } from '../src/locales'
import { createEmbedContext, setCurrentEmbed } from '../src/embed/context'
import LandingMenu, { type LandingMenuLink } from '../src/components/landing/LandingMenu.vue'

/**
 * 落地页窄屏的菜单：页头在 ≤820px 收起来的入口（包括「集成」）都得在这里面，
 * 键盘进得去、出得来，点某一节会关掉并告诉页面滚到哪儿。
 */
const LINKS: LandingMenuLink[] = [
  { key: 'features', label: '功能', icon: 'bolt', anchor: 'features' },
  { key: 'integration', label: '集成', icon: 'panel', anchor: 'integration' },
  { key: 'open', label: '开源', icon: 'shield', anchor: 'open-source' },
  { key: 'docs', label: '文档', icon: 'book', href: 'https://example.com/docs' },
]

let app: App | null = null
let went: string[] = []
const tick = async () => { await nextTick(); await nextTick() }

async function mount() {
  setCurrentEmbed(createEmbedContext())
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stub = { render: () => h('div') }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: stub }, { path: '/login', component: stub }, { path: '/register', component: stub }] })
  app = createApp({ render: () => h(LandingMenu, { links: LINKS, onGo: (a: string) => went.push(a) }) })
  app.use(createPinia()).use(i18n).use(router)
  app.config.globalProperties.$lcPortal = 'body'
  await router.push('/')
  await router.isReady()
  app.mount(host)
  const btn = host.querySelector<HTMLButtonElement>('[data-act="landing-menu"]')!
  return { host, btn, router }
}
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')

beforeEach(() => { went = []; setLocale('zh-CN', false) })
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = '' })

describe('LandingMenu', () => {
  it('is a labelled button that opens a modal sheet with every entry, theme, language and sign in', async () => {
    const { btn } = await mount()
    expect(btn.getAttribute('aria-label')).toBe('打开菜单')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(dialog()).toBeNull()

    btn.focus()
    btn.click()
    await tick()
    const d = dialog()!
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(btn.getAttribute('aria-controls')).toBe(d.id)
    expect([...d.querySelectorAll<HTMLElement>('.lm-nav [data-nav]')].map((a) => a.dataset.nav)).toEqual(['features', 'integration', 'open', 'docs'])
    expect(d.querySelector('[data-nav="integration"]')!.textContent).toContain('集成')
    expect(d.querySelectorAll('[role="radiogroup"]').length).toBe(2)
    expect(d.querySelectorAll('[data-theme-opt]').length).toBe(3)
    expect(d.querySelectorAll('[data-locale-opt]').length).toBe(2)
    expect(d.querySelector('[data-nav="login"]')).toBeTruthy()
    // 站外链接：新标签页，并且读得出来
    const docs = d.querySelector<HTMLAnchorElement>('[data-nav="docs"]')!
    expect(docs.target).toBe('_blank')
    expect(docs.getAttribute('aria-label')).toContain('新标签页')
    // 焦点进了面板，落在第一项上
    expect((document.activeElement as HTMLElement).dataset.nav).toBe('features')
  })

  it('Esc closes it and gives the focus back to the button', async () => {
    const { btn } = await mount()
    btn.focus()
    btn.click()
    await tick()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await tick()
    expect(dialog()).toBeNull()
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(btn)
  })

  it('Tab wraps around inside the sheet', async () => {
    const { btn } = await mount()
    btn.focus()
    btn.click()
    await tick()
    const d = dialog()!
    const last = d.querySelector<HTMLElement>('[data-nav="login"]')!
    last.focus()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(d.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(last)
  })

  it('picking a section closes the sheet and tells the page where to scroll', async () => {
    const { btn } = await mount()
    btn.click()
    await tick()
    dialog()!.querySelector<HTMLElement>('[data-nav="integration"]')!.click()
    await tick()
    expect(dialog()).toBeNull()
    expect(went).toEqual(['integration'])
  })

  it('the scrim and the close button close it; the language switch works inside it', async () => {
    const { btn } = await mount()
    btn.click()
    await tick()
    dialog()!.querySelector<HTMLElement>('[data-locale-opt="en"]')!.click()
    await tick()
    expect(i18n.global.locale.value).toBe('en')
    expect(dialog()!.getAttribute('aria-label')).toBe('Menu')
    dialog()!.querySelector<HTMLElement>('[data-act="landing-menu-close"]')!.click()
    await tick()
    expect(dialog()).toBeNull()

    btn.click()
    await tick()
    document.querySelector<HTMLElement>('[data-role="landing-menu-mask"]')!.click()
    await tick()
    expect(dialog()).toBeNull()
  })

  it('signing in from the sheet navigates and closes it', async () => {
    const { btn, router } = await mount()
    btn.click()
    await tick()
    dialog()!.querySelector<HTMLElement>('[data-nav="login"]')!.click()
    await tick()
    await new Promise((r) => setTimeout(r, 20))
    expect(dialog()).toBeNull()
    expect(router.currentRoute.value.path).toBe('/login')
  })
})
