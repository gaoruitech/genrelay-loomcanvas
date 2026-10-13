import { describe, expect, it, beforeEach, onTestFinished, vi } from 'vitest'
import { createPinia } from 'pinia'
import {
  FEATURE_KEYS, PAGE_FEATURE, PAGE_KEYS, fallbackPage, isPageAllowed, isPageOpen, pageOfRoute, resolveBrand, resolveFeatures, resolveNodeTypes, resolvePages, routeOfPage,
} from '../src/embed/options'
import { isRouteOpen, isSettingsOpen } from '../src/embed/links'
import {
  GUIDE_ITEM_NEEDS, GUIDE_SECTION_ANY, GUIDE_SECTION_IDS, GUIDE_SECTION_NEEDS, guideItemIndexes, guideSectionVisible,
} from '../src/components/canvas/guideSections'
import libraryMessages from '../src/locales/modules/library'
import settingsMessages from '../src/locales/modules/settings'
import { hasPersonalAppearance, settingsGroups, settingsLeadKey } from '../src/components/settings/sections'
import { joinSentences } from '../src/components/settings/sentences'
import AppearanceSection from '../src/components/settings/AppearanceSection.vue'
import { installCommon } from '../src/embed/mount'
import { setLocale } from '../src/locales'
import type { LoomCanvasFeatures } from '../src/embed/types'
import { createEmbedContext, setCurrentEmbed } from '../src/embed/context'
import { createMemoryAdapter } from '../src/embed/memoryAdapter'
import { createAppRouter } from '../src/router'
import { useAppStore } from '../src/stores/app'
import { useSpaceStore } from '../src/stores/space'
import { createApp, h, nextTick, reactive } from 'vue'

describe('features', () => {
  it('the stand-alone app and the embedded app start with everything on', () => {
    for (const mode of ['standalone', 'app'] as const) {
      const f = resolveFeatures(undefined, { mode })
      expect(FEATURE_KEYS.filter((k) => !f[k])).toEqual([])
    }
  })

  it('host authentication switches off the account UI and the links out, unless asked for', () => {
    const f = resolveFeatures(undefined, { mode: 'app', hostAuth: true })
    expect(FEATURE_KEYS.filter((k) => !f[k])).toEqual(['account', 'externalLinks'])
    expect(resolveFeatures({ externalLinks: true }, { mode: 'app', hostAuth: true }).externalLinks).toBe(true)
  })

  it('without a shell there is nothing to make immersive', () => {
    expect(resolveFeatures({ immersive: true }, { mode: 'app', shell: 'none' }).immersive).toBe(false)
  })

  it('the editor starts with its own chrome only', () => {
    const f = resolveFeatures(undefined, { mode: 'editor' })
    expect(FEATURE_KEYS.filter((k) => f[k])).toEqual(['palette', 'queue', 'minimap', 'titleBar', 'canvasStyle', 'imageEditor', 'search'])
  })

  it('a feature without its backend stays off, whatever was asked for', () => {
    const bare = createMemoryAdapter()
    const asked = { share: true, templates: true, brandKit: true, assetLibrary: true, batchDownload: true, canvasSwitch: true, cost: true, batchRun: true }
    const f = resolveFeatures(asked, { mode: 'editor', adapter: bare })
    // The memory adapter estimates (cost) and batch run needs nothing extra; the rest need adapter parts it lacks.
    expect(Object.keys(asked).filter((k) => f[k as keyof typeof f])).toEqual(['cost', 'batchRun'])
    const full = { ...bare, share: {} as any, templates: {} as any, brandKits: {} as any, assets: {} as any, downloadZip: async () => new Blob(), listCanvases: async () => [] }
    const g = resolveFeatures(asked, { mode: 'editor', adapter: full })
    expect(Object.keys(asked).filter((k) => !g[k as keyof typeof g])).toEqual([])
  })

  it('explicit switches win over defaults in both directions', () => {
    expect(resolveFeatures({ minimap: false, queue: false }, { mode: 'editor' })).toMatchObject({ minimap: false, queue: false, palette: true })
    expect(resolveFeatures({ share: false, themeSwitch: false }, { mode: 'app' })).toMatchObject({ share: false, themeSwitch: false, templates: true })
    // The editor has no account, whatever is asked.
    expect(resolveFeatures({ account: true }, { mode: 'editor' }).account).toBe(false)
  })
})

describe('brand', () => {
  it('absent or not an object: follow the site settings; false: no brand block', () => {
    for (const v of [undefined, null, true, 'Acme', 7, []]) expect(resolveBrand(v), String(v)).toBeUndefined()
    expect(resolveBrand(false)).toBe(false)
  })

  it('the name is written next to the logo unless `showName` is exactly false', () => {
    expect(resolveBrand({ name: 'Acme', logoUrl: 'https://acme.example/logo.svg' })).toEqual({ name: 'Acme', logoUrl: 'https://acme.example/logo.svg', showName: true })
    expect(resolveBrand({ name: 'Acme', logoUrl: '/logo.svg', showName: false })).toEqual({ name: 'Acme', logoUrl: '/logo.svg', showName: false })
    for (const v of [undefined, null, 0, '', 'false', 'no']) expect(resolveBrand({ showName: v })!, String(v)).toMatchObject({ showName: true })
  })

  it('empty or non-string name and logo count as not given', () => {
    expect(resolveBrand({ name: '  Acme  ', logoUrl: '   ' })).toEqual({ name: 'Acme', logoUrl: undefined, showName: true })
    expect(resolveBrand({ name: 42, logoUrl: {} })).toEqual({ name: undefined, logoUrl: undefined, showName: true })
    expect(resolveBrand({})).toEqual({ name: undefined, logoUrl: undefined, showName: true })
  })

  it('the shell follows it: a host logo alone, with the same rule as the site setting (no logo, no hiding)', () => {
    const boot = { site: { name: 'Site', logoUrl: '/files/site.png', showName: true }, hasProvider: true, user: null, auth: { registrationOpen: true } }
    const store = (brand: unknown) => {
      setCurrentEmbed(createEmbedContext({ mode: 'app', brand: resolveBrand(brand) }))
      const s = useAppStore(createPinia())
      s.bootstrap = boot as any
      return [s.siteName, s.logoUrl, s.showSiteName]
    }
    expect(store({ name: 'Acme', logoUrl: '/acme.svg' })).toEqual(['Acme', '/acme.svg', true])
    expect(store({ name: 'Acme', logoUrl: '/acme.svg', showName: false })).toEqual(['Acme', '/acme.svg', false])
    // no host logo: the default mark alone would say nothing, so the name stays
    expect(store({ name: 'Acme', showName: false })).toEqual(['Acme', '', true])
    // a brand without a name takes the site's name; the site's own "show the name" switch is not consulted
    expect(store({ logoUrl: '/acme.svg' })).toEqual(['Site', '/acme.svg', true])
    // no brand given: the site settings decide
    expect(store(undefined)).toEqual(['Site', '/files/site.png', true])
    setCurrentEmbed(null)
  })
})

describe('node types', () => {
  it('tool nodes need the adapter to run tools', () => {
    const bare = createMemoryAdapter()
    expect(resolveNodeTypes(undefined, bare)).not.toContain('slice')
    expect(resolveNodeTypes(undefined, { ...bare, runTool: async () => ({}) })).toContain('slice')
    expect(resolveNodeTypes(undefined, null)).toContain('platform-export')
  })
  it('keeps the order asked for and drops unknown or duplicate names', () => {
    expect(resolveNodeTypes(['llm', 'text', 'nope' as any, 'text'], null)).toEqual(['llm', 'text'])
  })
})

describe('pages', () => {
  it('no list means no restriction', () => {
    expect(resolvePages(undefined)).toBeNull()
    expect(isPageAllowed(null, 'models')).toBe(true)
    expect(fallbackPage(null)).toBe('home')
  })
  it('only named pages are reachable', () => {
    const pages = resolvePages(['canvases', 'canvas', 'bogus'])
    expect([...pages!]).toEqual(['canvases', 'canvas'])
    expect(isPageAllowed(pages, 'canvas')).toBe(true)
    expect(isPageAllowed(pages, 'models')).toBe(false)
    expect(isPageAllowed(pages, '')).toBe(false)
    expect(fallbackPage(pages)).toBe('canvases')
    expect([...resolvePages([])!]).toEqual(['canvases'])
  })
  it('maps page names to routes and back', () => {
    expect(routeOfPage('canvases')).toBe('canvas-list')
    expect(pageOfRoute('canvas-list')).toBe('canvases')
    expect(pageOfRoute('login')).toBe('')
    expect(routeOfPage('nope')).toBe('')
  })

  it('a page that belongs to a switched-off feature does not exist', () => {
    const all = resolveFeatures(undefined, { mode: 'app' })
    for (const page of PAGE_KEYS) expect(isPageOpen({ pages: null, features: all }, page)).toBe(true)
    // one switch off at a time: exactly its pages close
    for (const key of FEATURE_KEYS) {
      const features = resolveFeatures({ [key]: false }, { mode: 'app' })
      const closed = PAGE_KEYS.filter((p) => !isPageOpen({ pages: null, features }, p))
      expect(closed, key).toEqual(PAGE_KEYS.filter((p) => PAGE_FEATURE[p] === key))
    }
    expect(PAGE_FEATURE).toEqual({ assets: 'assetLibrary', 'brand-kits': 'brandKit', models: 'modelManagement', setup: 'modelManagement', team: 'teamAdmin' })
    // the page list still applies on top
    const pages = resolvePages(['canvases', 'canvas', 'assets'])
    expect(isPageOpen({ pages, features: all }, 'assets')).toBe(true)
    expect(isPageOpen({ pages, features: all }, 'models')).toBe(false)
    expect(isPageOpen({ pages, features: resolveFeatures({ assetLibrary: false }, { mode: 'app' }) }, 'assets')).toBe(false)
    // the editor entry is one screen: it has no pages at all
    expect(PAGE_KEYS.filter((p) => isPageOpen({ mode: 'editor', pages: null, features: all }, p))).toEqual([])
  })

  it('the landing fallback skips pages whose feature is off', () => {
    const off = resolveFeatures({ assetLibrary: false, modelManagement: false }, { mode: 'app' })
    expect(fallbackPage(resolvePages(['assets', 'models', 'history']), off)).toBe('history')
    expect(fallbackPage(resolvePages(['assets', 'models', 'history']))).toBe('assets')
    expect(fallbackPage(null, off)).toBe('home')
  })
})

describe('router guard', () => {
  const BOOT = { site: {}, hasProvider: true, user: null, auth: { registrationOpen: true } }

  function setup(over: Parameters<typeof createEmbedContext>[0], boot: any = BOOT, features?: Partial<LoomCanvasFeatures>) {
    const ctx = createEmbedContext({ ...over, features: reactive(resolveFeatures(features, { mode: over?.mode || 'standalone', hostAuth: over?.hostAuth, shell: over?.shell })) })
    setCurrentEmbed(ctx)
    const pinia = createPinia()
    const store = useAppStore(pinia)
    store.bootstrap = boot
    const router = createAppRouter({ mode: 'memory', pinia, embed: ctx })
    return { router, store, ctx }
  }
  const go = async (router: ReturnType<typeof setup>['router'], to: string) => {
    await router.push(to).catch(() => undefined)
    return String(router.currentRoute.value.name)
  }

  beforeEach(() => setCurrentEmbed(null))

  it('stand-alone: a visitor is sent to sign in, with the way back', async () => {
    const { router } = setup({})
    expect(await go(router, '/canvases')).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/canvases')
    expect(await go(router, '/')).toBe('landing')
  })

  it('host authentication: no landing, sign-in, register or password page', async () => {
    const { router, store } = setup({ mode: 'app', hostAuth: true })
    expect(store.authed).toBe(true)
    for (const path of ['/', '/login', '/register', '/password']) expect(await go(router, path)).toBe('home')
    expect(await go(router, '/canvases')).toBe('canvas-list')
    // an unknown address from inside: the navigation is cancelled
    expect(await go(router, '/no/such/page')).toBe('canvas-list')
  })

  it('host authentication without a provider does not force the setup guide when it is not offered', async () => {
    const boot = { ...BOOT, hasProvider: false }
    const withSetup = setup({ mode: 'app', hostAuth: true }, boot)
    expect(await go(withSetup.router, '/canvases')).toBe('setup')
    const without = setup({ mode: 'app', hostAuth: true, pages: resolvePages(['canvases', 'canvas']) }, boot)
    expect(await go(without.router, '/canvases')).toBe('canvas-list')
  })

  it('a page outside the allow-list is unreachable by address and by navigation', async () => {
    const { router } = setup({ mode: 'app', hostAuth: true, pages: resolvePages(['canvases', 'canvas']) })
    // by address: sent to the first allowed page
    expect(await go(router, '/models')).toBe('canvas-list')
    expect(await go(router, '/canvas/abc')).toBe('canvas')
    // from inside: the navigation is cancelled, the user stays where they are
    for (const path of ['/models', '/settings', '/history', '/assets', '/app', '/share/tok', '/setup', '/login', '/nowhere']) {
      expect(await go(router, path)).toBe('canvas')
    }
    expect(router.currentRoute.value.params.id).toBe('abc')
  })

  it('an allow-list with LoomCanvas sign-in keeps the sign-in pages', async () => {
    const { router } = setup({ mode: 'app', pages: resolvePages(['canvases', 'canvas']) })
    expect(await go(router, '/canvases')).toBe('login')
    expect(await go(router, '/models')).toBe('login')
  })

  it('the host user replaces the account in the shell', () => {
    const { store } = setup({ mode: 'app', hostAuth: true, hostUser: { name: 'Ada', role: 'owner', avatarUrl: 'https://x/a.png' } })
    expect(store.user).toMatchObject({ username: 'Ada', role: 'owner', mustChangePassword: false })
    expect(store.isOwner).toBe(true)
    expect(store.avatarUrl).toBe('https://x/a.png')
    store.setHostUser({ name: 'Bob' })
    expect(store.user).toMatchObject({ username: 'Bob', role: 'user' })
  })

  it('preferences of a host user the server does not know stay in the page', async () => {
    const { store } = setup({ mode: 'app', hostAuth: true, defaultNodeLayout: 'b' })
    expect(store.nodeLayout).toBe('b')
    await store.setNodeLayout('c')
    expect(store.nodeLayout).toBe('c')
  })

  it('a page of a switched-off feature is unreachable by address and by navigation', async () => {
    const { router, ctx } = setup({ mode: 'app', hostAuth: true }, BOOT, { assetLibrary: false, modelManagement: false })
    // by address (first navigation): sent to the first open page
    expect(await go(router, '/assets')).toBe('home')
    // from inside: the navigation is cancelled, the user stays where they are
    expect(await go(router, '/canvases')).toBe('canvas-list')
    for (const path of ['/assets', '/models', '/setup']) expect(await go(router, path)).toBe('canvas-list')
    // brand kits are their own switch: the second tab of the library is still there
    expect(await go(router, '/assets/brand-kits')).toBe('brand-kits')
    // links ask the same question
    expect(isRouteOpen(ctx, router, '/assets')).toBe(false)
    expect(isRouteOpen(ctx, router, { name: 'models' })).toBe(false)
    expect(isRouteOpen(ctx, router, { name: 'brand-kits' })).toBe(true)
    expect(isRouteOpen(ctx, router, '/history')).toBe(true)
  })

  it('model management off: nobody is taken to the "add a provider" guide', async () => {
    const boot = { ...BOOT, hasProvider: false }
    const { router } = setup({ mode: 'app', hostAuth: true }, boot, { modelManagement: false })
    expect(await go(router, '/canvases')).toBe('canvas-list')
    expect(await go(router, '/setup')).toBe('canvas-list')
  })

  it('brand kits off: the brand-kit page is gone, the asset library stays', async () => {
    const { router } = setup({ mode: 'app', hostAuth: true }, BOOT, { brandKit: false })
    expect(await go(router, '/assets')).toBe('assets')
    expect(await go(router, '/assets/brand-kits')).toBe('assets')
  })

  it('a page list without a landing page does not redirect in circles', async () => {
    const { router } = setup({ mode: 'app', hostAuth: true, pages: resolvePages(['canvas']) })
    await router.push('/models').catch(() => undefined)
    expect(router.currentRoute.value.matched.length).toBe(0)
    expect(await go(router, '/canvas/abc')).toBe('canvas')
  })

  it('settings exists only when there is something on it for this person', async () => {
    const off = { localeSwitch: false, themeSwitch: false, nodeLayoutSwitch: false }
    // the host signs users in (no account section) and the three appearance switches are off
    const bare = setup({ mode: 'app', hostAuth: true }, BOOT, off)
    expect(isSettingsOpen(bare.ctx, false)).toBe(false)
    expect(await go(bare.router, '/canvases')).toBe('canvas-list')
    expect(await go(bare.router, '/settings')).toBe('canvas-list')
    // one switch is enough
    const one = setup({ mode: 'app', hostAuth: true }, BOOT, { ...off, themeSwitch: true })
    expect(isSettingsOpen(one.ctx, false)).toBe(true)
    expect(await go(one.router, '/settings')).toBe('settings')
    // whoever runs the site has the site sections
    const owner = setup({ mode: 'app', hostAuth: true, hostUser: { name: 'Ada', role: 'owner' } }, BOOT, off)
    expect(isSettingsOpen(owner.ctx, true)).toBe(true)
    expect(await go(owner.router, '/settings')).toBe('settings')
    // left out of the page list: closed whatever the switches say
    expect(isSettingsOpen(setup({ mode: 'app', hostAuth: true, pages: resolvePages(['canvases']) }).ctx, true)).toBe(false)
  })

  it('an address that says "personal space" opens the personal space, also in a new tab of somebody whose last space was a team', async () => {
    const TEAM = '6acdfb038b1f445a2616f07e'
    const personal = { id: 'personal', kind: 'personal', name: '', role: 'owner', permissions: {}, settings: null }
    const boot = {
      ...BOOT,
      user: { id: 'u1', username: 'ann', email: '', role: 'user', mustChangePassword: false, prefs: {}, createdAt: '' },
      spaces: [{ id: 'personal', kind: 'personal', name: '' }, { id: TEAM, kind: 'team', name: 'Alpha', role: 'owner', status: 'active', members: 3 }],
      space: personal,
    }
    // the Node that runs the tests may have a localStorage that stores nothing: an in-memory one for this test
    const kept = new Map<string, string>()
    const own = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true, writable: true,
      value: { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, String(v)) }, removeItem: (k: string) => { kept.delete(k) } },
    })
    onTestFinished(() => { if (own) Object.defineProperty(globalThis, 'localStorage', own); else delete (globalThis as any).localStorage })
    const { router, store } = setup({}, boot)
    // nothing here may need the network: the personal space is where a fresh page already is
    const load = vi.fn(async () => undefined)
    store.loadBootstrap = load as any
    const space = useSpaceStore()
    space.remember(TEAM)
    expect(space.remembered()).toBe(TEAM)
    expect(await go(router, '/app?space=personal')).toBe('home')
    expect(router.currentRoute.value.fullPath).toBe('/app')
    expect(space.currentId).toBe('')
    expect(space.remembered()).toBe('')
    expect(load).not.toHaveBeenCalled()
  })

  it('links: sign-in pages exist unless the host signs users in; the editor entry has no pages', () => {
    const own = setup({ mode: 'app', pages: resolvePages(['canvases', 'canvas']) })
    expect(isRouteOpen(own.ctx, own.router, '/login')).toBe(true)
    expect(isRouteOpen(own.ctx, own.router, { name: 'register' })).toBe(true)
    expect(isRouteOpen(own.ctx, own.router, '/models')).toBe(false)
    const host = setup({ mode: 'app', hostAuth: true })
    expect(isRouteOpen(host.ctx, host.router, '/login')).toBe(false)
    expect(isRouteOpen(host.ctx, host.router, '/')).toBe(false)
    expect(isRouteOpen(host.ctx, host.router, '/no/such/page')).toBe(false)
    expect(isRouteOpen(host.ctx, host.router, { name: 'no-such-route' })).toBe(false)
    expect(isRouteOpen(host.ctx, host.router, null)).toBe(false)
    const editor = setup({ mode: 'editor' })
    for (const to of ['/models', '/canvases', { name: 'brand-kits' }, { name: 'team', params: { tab: 'settings' } }]) {
      expect(isRouteOpen(editor.ctx, editor.router, to)).toBe(false)
    }
    // the stand-alone app: everything, including the not-found page
    const alone = setup({})
    expect(isRouteOpen(alone.ctx, alone.router, '/no/such/page')).toBe(true)
    expect(isRouteOpen(alone.ctx, alone.router, '/models')).toBe(true)
  })
})

describe('settings: a switched-off feature is not named', () => {
  const en = (settingsMessages as any).en
  const zh = (settingsMessages as any)['zh-CN']
  const f = (over: Partial<LoomCanvasFeatures> = {}, ctx: { hostAuth?: boolean } = {}) => resolveFeatures(over, { mode: 'app', ...ctx })
  const LOOK_OFF = { localeSwitch: false, themeSwitch: false, nodeLayoutSwitch: false }
  const ids = (isOwner: boolean, features: LoomCanvasFeatures) => settingsGroups(isOwner, features).flatMap((g) => g.items.map((i) => i.id))

  it('"Appearance" is listed only for somebody who has something on it', () => {
    expect(ids(false, f())).toEqual(['account', 'appearance'])
    // one switch is enough
    for (const key of Object.keys(LOOK_OFF)) expect(ids(false, f({ ...LOOK_OFF, [key]: true })), key).toEqual(['account', 'appearance'])
    expect(ids(false, f(LOOK_OFF))).toEqual(['account'])
    // the host signs users in and the three switches are off: nothing is left, the page is closed (isSettingsOpen)
    expect(ids(false, f(LOOK_OFF, { hostAuth: true }))).toEqual([])
    // whoever runs the site keeps it: the site branding lives there
    expect(ids(true, f(LOOK_OFF, { hostAuth: true }))).toEqual(['appearance', 'site', 'users', 'teams', 'storage', 'limits'])
    expect(hasPersonalAppearance(f(LOOK_OFF))).toBe(false)
  })

  it('the sentence under "Settings" names the account and the interface only when they are there', () => {
    expect(settingsLeadKey(false, f())).toBe('accountLook')
    expect(settingsLeadKey(false, f(LOOK_OFF))).toBe('account')
    expect(settingsLeadKey(false, f({}, { hostAuth: true }))).toBe('look')
    expect(settingsLeadKey(true, f())).toBe('ownerAccount')
    expect(settingsLeadKey(true, f({}, { hostAuth: true }))).toBe('owner')
    for (const lang of [en, zh]) {
      // no sentence names the interface language (it may be switched off on its own), and only one names Models
      for (const [key, text] of Object.entries(lang.lead as Record<string, string>)) {
        expect(/language|语言/i.test(text), key).toBe(false)
        expect(/\bModels\b|模型/.test(text), key).toBe(key === 'models')
      }
      for (const key of ['owner', 'look']) expect(/account|sign-in|账号|登录/i.test(lang.lead[key]), key).toBe(false)
      expect(/interface|界面/i.test(lang.lead.account)).toBe(false)
    }
  })

  it('sentences are joined the way each language writes them', () => {
    expect(joinSentences(['One.', false, '', undefined, 'Two.'], 'en')).toBe('One. Two.')
    expect(joinSentences(['第一句。', null, '第二句。'], 'zh-CN')).toBe('第一句。第二句。')
    expect(joinSentences([false, ''], 'en')).toBe('')
  })

  it('"Please fill in ..." reads as a sentence around any field name', () => {
    expect(zh.storage.required).toBe('请填写「{field}」')
    expect(en.storage.required).toBe('{field} is required')
  })

  // What the Appearance section says, in English, with these switches.
  async function appearance(features: Partial<LoomCanvasFeatures>, over: Parameters<typeof createEmbedContext>[0] = {}, owner = false) {
    const ctx = createEmbedContext({ mode: 'app', ...over, features: reactive(resolveFeatures(features, { mode: 'app', hostAuth: over.hostAuth, shell: over.shell })) })
    setCurrentEmbed(ctx)
    setLocale('en', false)
    const pinia = createPinia()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = createApp({ render: () => h(AppearanceSection) })
    app.use(pinia)
    installCommon(app, ctx)
    const store = useAppStore(pinia)
    store.bootstrap = { auth: { registrationOpen: true }, site: {}, hasProvider: true, user: { id: 'u1', username: 'ann', email: '', role: owner ? 'owner' : 'user', mustChangePassword: false, prefs: {}, createdAt: '' } } as any
    app.mount(host)
    await nextTick()
    const text = (host.textContent || '').replace(/\s+/g, ' ')
    const personal = !!host.querySelector('[data-testid="appearance-personal"]')
    app.unmount()
    host.remove()
    setCurrentEmbed(null)
    return { text, personal }
  }

  // What the section calls each thing. With the switch off, none of these words may be left.
  const NAMES: Partial<Record<keyof LoomCanvasFeatures, RegExp>> = {
    localeSwitch: /language|english|中文/i,
    themeSwitch: /theme|\bdark\b|\blight\b|system/i,
    nodeLayoutSwitch: /node layout|result first|side panel|everything on the node/i,
    share: /shared canvas/i,
    account: /account|sign-in|sign in/i,
  }

  it('Appearance: with everything on, every one of those is named', async () => {
    const { text, personal } = await appearance({})
    expect(personal).toBe(true)
    for (const [key, re] of Object.entries(NAMES)) expect(re!.test(text), `${key}: ${text}`).toBe(true)
    expect(text).toMatch(/icon in the top bar/)
  })

  it('Appearance: a switched-off feature is not mentioned any more', async () => {
    for (const key of ['localeSwitch', 'themeSwitch', 'nodeLayoutSwitch', 'share'] as const) {
      const { text } = await appearance({ [key]: false })
      expect(NAMES[key]!.test(text), `${key} is off but the section still says: ${text}`).toBe(false)
    }
    // the host signs users in: no account to keep anything with, no sign-in page to theme
    const host = await appearance({}, { hostAuth: true, hostUser: { name: 'Ada' } })
    expect(NAMES.account!.test(host.text), host.text).toBe(false)
    expect(host.text).toMatch(/shared canvases use the same theme/)
    // no shell: no top bar whose icon could switch the theme
    expect((await appearance({}, { shell: 'none' })).text).not.toMatch(/top bar/)
    // the share page left out of `pages`: not named either
    expect((await appearance({}, { pages: resolvePages(['canvases', 'canvas', 'settings']) })).text).not.toMatch(/shared canvas/i)
  })

  it('Appearance: the three personal switches off leaves the site owner the branding card only', async () => {
    const { text, personal } = await appearance({ localeSwitch: false, themeSwitch: false, nodeLayoutSwitch: false }, {}, true)
    expect(personal).toBe(false)
    expect(text).not.toMatch(/Personal|theme|node layout/i)
    expect(text).toMatch(/The site name, logo and default language apply to everyone/)
  })
})

describe('the built-in guide follows the feature switches', () => {
  const en = (libraryMessages as any).en.guide.sections as Record<string, { title: string; intro?: string; items: string[]; tip?: string }>
  const zh = (libraryMessages as any)['zh-CN'].guide.sections as typeof en
  const ALL = resolveFeatures(undefined, { mode: 'app' })

  /** Everything the guide says with these switches, in English, one piece of text per line. */
  function guideLines(features: Partial<LoomCanvasFeatures>): string[] {
    const out: string[] = []
    for (const id of GUIDE_SECTION_IDS) {
      if (!guideSectionVisible(id, features)) continue
      const sec = en[id]
      const items = guideItemIndexes(id, sec.items.length, features).map((i) => sec.items[i])
      if (!items.length && !sec.intro) continue
      out.push(sec.title, sec.intro || '', ...items, sec.tip || '')
    }
    return out.filter(Boolean)
  }

  it('both languages have the same sections with the same number of items', () => {
    expect(Object.keys(en)).toEqual([...GUIDE_SECTION_IDS])
    expect(Object.keys(zh)).toEqual([...GUIDE_SECTION_IDS])
    for (const id of GUIDE_SECTION_IDS) expect(zh[id].items.length, id).toBe(en[id].items.length)
  })

  it('every requirement names an existing section, item and feature', () => {
    const known = new Set<string>(FEATURE_KEYS)
    for (const [id, needs] of Object.entries({ ...GUIDE_SECTION_NEEDS, ...GUIDE_SECTION_ANY })) {
      expect(en[id], id).toBeTruthy()
      for (const k of needs!) expect(known.has(k), `${id}: ${k}`).toBe(true)
    }
    for (const [id, items] of Object.entries(GUIDE_ITEM_NEEDS)) {
      for (const [index, needs] of Object.entries(items!)) {
        expect(en[id].items[Number(index)], `${id}[${index}]`).toBeTypeOf('string')
        for (const k of needs) expect(known.has(k), `${id}[${index}]: ${k}`).toBe(true)
      }
    }
  })

  it('with everything on, nothing is left out', () => {
    for (const id of GUIDE_SECTION_IDS) {
      expect(guideSectionVisible(id, ALL), id).toBe(true)
      expect(guideItemIndexes(id, en[id].items.length, ALL).length, id).toBe(en[id].items.length)
    }
  })

  // What the guide calls each feature. With the switch off, none of these words may be left.
  const NAMES: Partial<Record<keyof LoomCanvasFeatures, RegExp>> = {
    share: /share links?|a read-only link/i,
    templates: /template|snippet/i,
    brandKit: /brand kit|\bkit\b/i,
    assetLibrary: /my assets|stock assets|asset library/i,
    batchRun: /batch run/i,
    batchDownload: /batch download/i,
    modelManagement: /models page|open models|add a provider/i,
    immersive: /immersive/i,
    minimap: /minimap/i,
    queue: /queue button/i,
    search: /ctrl\+f|find nodes/i,
    canvasStyle: /canvas appearance/i,
    imageEditor: /cropped and rotated/i,
    cost: /≈|cost unknown|estimated cost|actual cost|spend less/i,
  }

  it('names every one of those features while it is on', () => {
    const text = guideLines(ALL).join('\n')
    for (const [key, re] of Object.entries(NAMES)) expect(re!.test(text), key).toBe(true)
  })

  it('a switched-off feature is not mentioned any more', () => {
    for (const [key, re] of Object.entries(NAMES)) {
      const hit = guideLines({ ...ALL, [key]: false }).find((line) => re!.test(line))
      expect(hit, `${key} is off but the guide still says: ${hit}`).toBeUndefined()
    }
  })

  it('the editor entry with its defaults gets a guide without the product features', () => {
    const text = guideLines(resolveFeatures({ guide: true }, { mode: 'editor' })).join('\n')
    for (const key of ['share', 'templates', 'brandKit', 'assetLibrary', 'batchRun', 'batchDownload', 'modelManagement', 'cost'] as const) {
      expect(NAMES[key]!.test(text), key).toBe(false)
    }
    // what is left is the editor itself
    expect(text).toMatch(/Wiring rules/)
    expect(text).toMatch(/Ctrl\+Z/)
  })
})
