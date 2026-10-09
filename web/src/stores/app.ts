import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { appApi, authApi, unwrap, setUnauthorizedHandler } from '@/utils/api'
import { getToken, setToken, clearToken } from '@/utils/authToken'
import { normalizeLocale, savedLocale, setLocale as applyLocale, currentLocale } from '@/locales'
import type { BootstrapInfo, ThemeMode, LocaleCode } from '@/types'

const THEME_KEY = 'loomcanvas-theme'

function readTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch { /* 隐私模式下 localStorage 会抛，忽略即可 */ }
  return null
}

/**
 * 应用级状态：启动信息、登录令牌、主题、语言。
 *
 * 主题第一次写到 <html> 上是在 index.html 的内联脚本里（在样式之前执行，避免闪烁），
 * 这里负责后续切换与持久化。两处的逻辑必须一致，改一处记得改另一处。
 */
export const useAppStore = defineStore('app', () => {
  const bootstrap = ref<BootstrapInfo | null>(null)
  const bootstrapError = ref('')
  const token = ref(getToken())

  const authRequired = computed(() => !!bootstrap.value?.authRequired)
  const authed = computed(() => !authRequired.value || !!bootstrap.value?.authed)
  const hasProvider = computed(() => !!bootstrap.value?.hasProvider)
  const siteName = computed(() => bootstrap.value?.site?.name || 'LoomCanvas')
  const logoUrl = computed(() => bootstrap.value?.site?.logoUrl || '')

  // ---- 主题 ----
  const themeMode = ref<ThemeMode>(readTheme() || 'dark')
  const systemLight = ref(!!window.matchMedia?.('(prefers-color-scheme: light)').matches)

  /** system 解析成实际生效的那一个 */
  const resolvedTheme = computed<'dark' | 'light'>(() => {
    if (themeMode.value !== 'system') return themeMode.value
    return systemLight.value ? 'light' : 'dark'
  })

  function applyTheme() {
    const el = document.documentElement
    el.setAttribute('data-theme', resolvedTheme.value)
    el.setAttribute('theme-mode', resolvedTheme.value) // TDesign 组件认这个
  }

  function setTheme(v: ThemeMode, persist = true) {
    themeMode.value = v
    if (persist) {
      try { localStorage.setItem(THEME_KEY, v) } catch { /* 同上 */ }
    }
    applyTheme()
  }

  /** 顶栏那个按钮：只在深浅之间来回，不经过 system */
  function toggleTheme() {
    setTheme(resolvedTheme.value === 'dark' ? 'light' : 'dark')
  }

  function initTheme() {
    applyTheme()
    window.matchMedia?.('(prefers-color-scheme: light)')
      .addEventListener?.('change', (e) => {
        systemLight.value = e.matches
        if (themeMode.value === 'system') applyTheme()
      })
  }

  // ---- 语言 ----
  const locale = ref<LocaleCode>(currentLocale())

  function setLocale(code: LocaleCode, persist = true) {
    locale.value = code
    applyLocale(code, persist)
  }

  // ---- 启动与登录 ----
  async function loadBootstrap() {
    bootstrapError.value = ''
    try {
      const info = unwrap(await appApi.bootstrap())
      bootstrap.value = info
      // 用户自己没选过，才跟站点默认值走
      if (!readTheme() && info.site?.defaultTheme) setTheme(info.site.defaultTheme, false)
      const siteLocale = normalizeLocale(info.site?.defaultLocale)
      if (!savedLocale() && siteLocale) setLocale(siteLocale, false)
      document.title = info.site?.name || 'LoomCanvas'
    } catch (err: any) {
      bootstrapError.value = err?.response?.data?.message || err?.message || 'bootstrap failed'
    }
  }

  async function login(password: string) {
    const data = unwrap(await authApi.login(password))
    token.value = data.token
    setToken(data.token)
    await loadBootstrap()
  }

  function logout() {
    token.value = ''
    clearToken()
    if (bootstrap.value) bootstrap.value = { ...bootstrap.value, authed: false }
  }

  // 任意接口返回 401：令牌失效，退回口令页
  setUnauthorizedHandler(() => {
    token.value = ''
    if (bootstrap.value?.authRequired) bootstrap.value = { ...bootstrap.value, authed: false }
  })

  /**
   * 沉浸式：隐藏顶栏，让画布占满全屏。进入画布编辑页默认开启，离开时复位。
   */
  const immersive = ref(false)
  function setImmersive(v: boolean) { immersive.value = v }
  function toggleImmersive() { immersive.value = !immersive.value }

  return {
    bootstrap, bootstrapError, token, authRequired, authed, hasProvider, siteName, logoUrl,
    themeMode, resolvedTheme, setTheme, toggleTheme, initTheme,
    locale, setLocale,
    loadBootstrap, login, logout,
    immersive, setImmersive, toggleImmersive,
  }
})
