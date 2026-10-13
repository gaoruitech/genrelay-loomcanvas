import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createEmbedContext, setCurrentEmbed } from '../src/embed/context'
import { appApi, authApi } from '../src/utils/api'
import { useAppStore } from '../src/stores/app'
import { setThemePref, setThemePending, themePref, resolvedTheme } from '../src/composables/useTheme'
import type { BootstrapInfo, User } from '../src/types'

/**
 * 登录那一下的主题：账号上的主题和这台浏览器上的不一样时，不能在登录页上先换一次色（闪一下），
 * 要拿在手里，等路由换到下一页的那一刻（App.vue 的 afterEach 调 applyHeldTheme）再上色。
 * 启动时（还没有任何页面画出来）则立刻对齐。没登录时在这台浏览器上选的主题优先，并存到账号上。
 */
// 跑测试的 Node 自带的 localStorage 不一定可用（没给存储文件时是个空壳）：这里用内存里的一份，两种环境结果一样
function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size },
  } as Storage
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(globalThis, name, { value: memoryStorage(), configurable: true, writable: true })
}
// index.html 里 <html> 上写死的起始主题
document.documentElement.setAttribute('data-theme', 'dark')

const user = (theme?: string, over: Partial<User> = {}): User => ({
  id: 'u1', username: 'linzhou', email: 'linzhou@example.com', role: 'user', mustChangePassword: false,
  prefs: theme ? { theme: theme as 'dark' | 'light' | 'system' } : {}, createdAt: '2026-01-01T00:00:00.000Z', ...over,
})
const info = (u: User | null): BootstrapInfo => ({ auth: { registrationOpen: true }, user: u, site: {}, hasProvider: true })
const wrap = <T>(data: T) => ({ data: { result: 0, message: 'ok', data } }) as never
const painted = () => document.documentElement.getAttribute('data-theme')
const stored = () => localStorage.getItem('loomcanvas-theme')

let prefsSaved: unknown[] = []

function signedOutBrowser(local: 'dark' | 'light', pending = false) {
  localStorage.clear()
  sessionStorage.clear()
  setThemePref(local, { animate: false })
  setThemePending(pending)
}

beforeEach(() => {
  vi.restoreAllMocks()
  prefsSaved = []
  setCurrentEmbed(createEmbedContext())
  setActivePinia(createPinia())
})

function mockServer(account: User) {
  vi.spyOn(authApi, 'login').mockResolvedValue(wrap({ user: account, token: 'tok-1' }))
  vi.spyOn(appApi, 'bootstrap').mockResolvedValue(wrap(info(account)))
  vi.spyOn(authApi, 'updatePrefs').mockImplementation(async (patch) => {
    prefsSaved.push(patch)
    return wrap({ user: { ...account, prefs: { ...account.prefs, ...patch } } })
  })
}

describe('theme at sign-in', () => {
  it('holds the account theme while the sign-in page is still on screen, and applies it with the navigation', async () => {
    signedOutBrowser('dark')
    mockServer(user('light'))
    const app = useAppStore()

    await app.login('linzhou', 'pw', true)
    // 账号已经在了，但登录页还是原来的颜色：没有换色，本机记着的也还没动
    expect(app.user?.prefs?.theme).toBe('light')
    expect(themePref.value).toBe('dark')
    expect(painted()).toBe('dark')
    expect(stored()).toBe('dark')

    // 路由换到外壳的那一刻
    app.applyHeldTheme()
    expect(themePref.value).toBe('light')
    expect(resolvedTheme.value).toBe('light')
    expect(painted()).toBe('light')
    // 这台浏览器从此记着账号的主题：下次打开首帧就是它（theme-boot.js 读的是同一个键）
    expect(stored()).toBe('light')
    // 账号上的本来就是浅色：不用再存一次
    expect(prefsSaved).toEqual([])

    // 再调一次什么都不发生
    setThemePref('dark', { animate: false })
    app.applyHeldTheme()
    expect(themePref.value).toBe('dark')
  })

  it('works the other way round too (a light browser, a dark account)', async () => {
    signedOutBrowser('light')
    mockServer(user('dark'))
    const app = useAppStore()
    await app.login('linzhou', 'pw', true)
    expect(painted()).toBe('light')
    app.applyHeldTheme()
    expect(painted()).toBe('dark')
    expect(stored()).toBe('dark')
  })

  it('an account that never chose a theme counts as dark', async () => {
    signedOutBrowser('light')
    mockServer(user())
    const app = useAppStore()
    await app.login('linzhou', 'pw', true)
    app.applyHeldTheme()
    expect(painted()).toBe('dark')
  })

  it('nothing is held when the two already agree', async () => {
    signedOutBrowser('light')
    mockServer(user('light'))
    const app = useAppStore()
    await app.login('linzhou', 'pw', true)
    expect(painted()).toBe('light')
    setThemePref('dark', { animate: false })
    app.applyHeldTheme()
    expect(themePref.value).toBe('dark')
  })

  it('a theme picked on this browser before signing in wins, and is saved to the account', async () => {
    signedOutBrowser('light', true)
    mockServer(user('dark'))
    const app = useAppStore()
    await app.login('linzhou', 'pw', true)
    await Promise.resolve()
    expect(painted()).toBe('light')
    expect(prefsSaved).toEqual([{ theme: 'light' }])
    app.applyHeldTheme()
    expect(painted()).toBe('light')
    expect(themePref.value).toBe('light')
  })

  it('signing out (or a dead session) drops a theme that was still held', async () => {
    signedOutBrowser('dark')
    mockServer(user('light'))
    vi.spyOn(authApi, 'logout').mockResolvedValue(wrap(null))
    const app = useAppStore()
    await app.login('linzhou', 'pw', true)
    vi.spyOn(appApi, 'bootstrap').mockResolvedValue(wrap(info(null)))
    await app.logout()
    app.applyHeldTheme()
    expect(painted()).toBe('dark')
    expect(themePref.value).toBe('dark')
  })
})

describe('theme at start-up', () => {
  it('follows the account at once: nothing of the app has been painted yet (it mounts after the bootstrap answer)', async () => {
    signedOutBrowser('dark')
    localStorage.setItem('loomcanvas-token', 'tok-1')
    mockServer(user('light'))
    const app = useAppStore()
    await app.loadBootstrap()
    expect(painted()).toBe('light')
    expect(stored()).toBe('light')
    expect(themePref.value).toBe('light')
  })
})

describe('theme changed on another device', () => {
  // 账号每次从服务端取回来都对一下：跟过去，并记到这台浏览器上，下次打开首帧就是对的
  async function signedIn(theme: 'dark' | 'light') {
    signedOutBrowser(theme)
    localStorage.setItem('loomcanvas-token', 'tok-1')
    mockServer(user(theme))
    const app = useAppStore()
    await app.loadBootstrap()
    return app
  }

  it('an answer to saving another preference carries the new theme: this browser follows and remembers it', async () => {
    const app = await signedIn('dark')
    vi.spyOn(authApi, 'updatePrefs').mockResolvedValue(wrap({ user: user('light', { prefs: { theme: 'light', nodeLayout: 'b' } }) }))
    await app.setPrefs({ nodeLayout: 'b' })
    expect(app.user?.prefs?.theme).toBe('light')
    expect(themePref.value).toBe('light')
    expect(painted()).toBe('light')
    expect(stored()).toBe('light')
  })

  it('so does a profile update', async () => {
    const app = await signedIn('light')
    app.setUser(user('dark', { username: 'renamed' }))
    expect(app.user?.username).toBe('renamed')
    expect(painted()).toBe('dark')
    expect(stored()).toBe('dark')
  })

  it('the next start-up paints it from the first frame: what theme-boot.js reads is already the account theme', async () => {
    const app = await signedIn('dark')
    app.setUser(user('system'))
    expect(stored()).toBe('system')
  })

  it('does not override a choice made on this browser that is still being saved', async () => {
    const app = await signedIn('dark')
    let answer: (v: unknown) => void = () => undefined
    vi.spyOn(authApi, 'updatePrefs').mockImplementation(() => new Promise((r) => { answer = r }) as never)
    const saving = app.setTheme('light')
    expect(painted()).toBe('light')
    // 这时别的请求带回来的账号还是旧主题：不能把刚选的盖回去
    app.setUser(user('dark', { username: 'renamed' }))
    expect(painted()).toBe('light')
    answer(wrap({ user: user('light') }))
    await saving
    expect(painted()).toBe('light')
    expect(stored()).toBe('light')
  })

  it('nor a choice made before signing in that has not reached the account yet', async () => {
    const app = await signedIn('dark')
    setThemePref('light', { animate: false })
    setThemePending(true)
    app.setUser(user('dark', { username: 'renamed' }))
    expect(painted()).toBe('light')
  })
})
