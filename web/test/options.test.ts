import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia } from 'pinia'
import {
  FEATURE_KEYS, fallbackPage, isPageAllowed, pageOfRoute, resolveFeatures, resolveNodeTypes, resolvePages, routeOfPage,
} from '../src/embed/options'
import { createEmbedContext, setCurrentEmbed } from '../src/embed/context'
import { createMemoryAdapter } from '../src/embed/memoryAdapter'
import { createAppRouter } from '../src/router'
import { useAppStore } from '../src/stores/app'
import { reactive } from 'vue'

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
})

describe('router guard', () => {
  const BOOT = { site: {}, hasProvider: true, user: null, auth: { registrationOpen: true } }

  function setup(over: Parameters<typeof createEmbedContext>[0], boot: any = BOOT) {
    const ctx = createEmbedContext({ ...over, features: reactive(resolveFeatures(undefined, { mode: over?.mode || 'standalone', hostAuth: over?.hostAuth, shell: over?.shell })) })
    setCurrentEmbed(ctx)
    const pinia = createPinia()
    const store = useAppStore(pinia)
    store.bootstrap = boot
    const router = createAppRouter({ mode: 'memory', pinia, embed: ctx })
    return { router, store }
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
})
