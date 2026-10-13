import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createEmbedContext, setCurrentEmbed, type EmbedContext } from '../src/embed/context'
import { useAppStore } from '../src/stores/app'
import LcLogo from '../src/components/LcLogo.vue'

/**
 * 站点名称写不写在 Logo 旁边（外观 → 站点品牌 →「在 Logo 旁显示站点名称」，后端的 showSiteName）：
 * 有 Logo 而且关掉了才不写；没有 Logo 时名称总在。名称不写时它是 Logo 的替代文字。
 */
let app: App | null = null
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = '' })

async function mount(site: { name?: string; logoUrl?: string; showName?: boolean }, embed: Partial<EmbedContext> = {}) {
  setCurrentEmbed(createEmbedContext(embed))
  const pinia = createPinia()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const stub = { render: () => h('div') }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: stub }] })
  app = createApp({ render: () => h(LcLogo) })
  app.use(pinia).use(router)
  useAppStore(pinia).bootstrap = { auth: { registrationOpen: true }, user: null, site, hasProvider: false }
  app.mount(host)
  await nextTick()
  return {
    name: host.querySelector('.lc-logo-name')?.textContent ?? null,
    img: host.querySelector<HTMLImageElement>('.lc-logo-img'),
    mark: host.querySelector('.lc-logo-mark'),
    store: useAppStore(pinia),
  }
}

describe('LcLogo: the site name next to the logo', () => {
  it('default mark: the name is always there, whatever the setting says', async () => {
    for (const showName of [undefined, true, false]) {
      const r = await mount({ name: '高瑞创作', showName })
      expect([!!r.mark, r.img, r.name]).toEqual([true, null, '高瑞创作'])
      app!.unmount(); app = null
    }
  })

  it('a logo with the name next to it (the default; also what an older server that does not send the field means)', async () => {
    for (const showName of [undefined, true]) {
      const r = await mount({ name: '高瑞创作', logoUrl: '/files/logo.png', showName })
      expect(r.name).toBe('高瑞创作')
      expect(r.img!.getAttribute('alt')).toBe('')
      expect(r.store.showSiteName).toBe(true)
      app!.unmount(); app = null
    }
  })

  it('a logo that stands alone: no name beside it, and the name becomes its text alternative', async () => {
    const r = await mount({ name: '高瑞创作', logoUrl: '/files/logo.png', showName: false })
    expect(r.name).toBeNull()
    expect(r.img!.getAttribute('alt')).toBe('高瑞创作')
    expect(r.store.showSiteName).toBe(false)
    // 浏览器标签用的还是这个名字
    expect(r.store.siteName).toBe('高瑞创作')
  })

  it('a brand given by the integrator decides for itself: `showName: false` leaves the host logo alone, with the name as its text alternative', async () => {
    const brand = { name: 'Host', logoUrl: 'https://host.example/wordmark.svg', showName: false }
    const r = await mount({ name: 'Site', logoUrl: '/files/logo.png', showName: true }, { brand })
    expect(r.name).toBeNull()
    expect(r.img!.getAttribute('src')).toBe('https://host.example/wordmark.svg')
    expect(r.img!.getAttribute('alt')).toBe('Host')
    app!.unmount(); app = null
    // without a logo of its own the name is always written, as with the site setting
    const bare = await mount({ name: 'Site' }, { brand: { name: 'Host', showName: false } })
    expect([!!bare.mark, bare.name]).toEqual([true, 'Host'])
    expect(bare.mark!.getAttribute('aria-hidden')).toBe('true')
  })

  it('a brand given by the integrator is not affected by the site setting', async () => {
    const r = await mount({ name: 'Site', logoUrl: '/files/logo.png', showName: false }, { brand: { name: 'Host', logoUrl: 'https://host.example/logo.svg' } })
    expect(r.name).toBe('Host')
    expect(r.img!.getAttribute('src')).toBe('https://host.example/logo.svg')
  })
})
