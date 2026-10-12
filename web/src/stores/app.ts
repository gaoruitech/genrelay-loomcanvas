import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { appApi, authApi, unwrap, setUnauthorizedHandler, setPasswordChangeHandler } from '@/utils/api'
import { getToken, setToken, replaceToken, clearToken } from '@/utils/authToken'
import { normalizeLocale, savedLocale, setLocale as applyLocale, currentLocale } from '@/locales'
import type { BootstrapInfo, LocaleCode, User, UserPrefs } from '@/types'
import { normalizeNodeLayout, type NodeLayout } from '@/composables/nodeLayout'
import { themePref, setThemePref, normalizeTheme, themePending, setThemePending, type ThemePref } from '@/composables/useTheme'
import { useEmbed } from '@/embed/context'
import { runtime } from '@/embed/runtime'

/**
 * 应用级状态：启动信息、当前账号、语言、主题。
 */
export const useAppStore = defineStore('app', () => {
  /** 这一次挂载的方式：独立应用 / 整站嵌入 / 只嵌编辑器（见 embed/context.ts） */
  const embed = useEmbed()
  /** 宿主自己管登录（整站嵌入时给了 getAuth），或者只嵌了编辑器：本产品的账号、登录页、令牌都不出场 */
  const hostAuth = embed.hostAuth || embed.mode === 'editor'

  const bootstrap = ref<BootstrapInfo | null>(null)
  const bootstrapError = ref('')
  const token = ref(hostAuth ? '' : getToken())

  /**
   * 宿主管登录、后端又不认识这个人（没有账号可存偏好）时，界面偏好只记在这一次挂载里。
   * 后端认识（宿主把自己的用户映射成了本产品的账号）就照常存到账号上。
   */
  const localPrefs = ref<UserPrefs>({ nodeLayout: embed.defaultNodeLayout })
  const hostUser = ref(embed.hostUser)
  function setHostUser(u: typeof embed.hostUser) { hostUser.value = u }

  const user = computed<User | null>(() => {
    const real = bootstrap.value?.user || null
    if (!hostAuth) return real
    const h = hostUser.value
    return {
      id: h?.id || real?.id || 'host',
      username: h?.name || real?.username || '',
      email: h?.email ?? real?.email ?? '',
      role: h?.role || real?.role || 'user',
      mustChangePassword: false,
      prefs: real?.prefs || localPrefs.value,
      createdAt: real?.createdAt || '',
    }
  })
  /** 宿主给的头像（没有就显示名字的首字母） */
  const avatarUrl = computed(() => (hostAuth ? hostUser.value?.avatarUrl || '' : ''))
  const authed = computed(() => hostAuth || !!user.value)
  const isOwner = computed(() => user.value?.role === 'owner')
  /** 超级管理员是服务端启动时自动建好的，注册出来的都是普通用户；开不开放注册由超级管理员定 */
  const registrationOpen = computed(() => !!bootstrap.value?.auth?.registrationOpen)
  /** 还在用临时密码（启动时生成的 / 被重置出来的）：改掉之前哪儿也去不了，见路由守卫 */
  const mustChangePassword = computed(() => !!user.value?.mustChangePassword)
  /**
   * 刚才登录用的那个临时密码，只放在内存里，给「设置新密码」那一屏当「当前密码」用，
   * 免得让人把一串随机字符再敲一遍。不进任何存储；改完、退出、刷新页面都会没。
   */
  const signInPassword = ref('')
  const hasProvider = computed(() => !!bootstrap.value?.hasProvider)
  const siteName = computed(() => (embed.brand && embed.brand.name) || bootstrap.value?.site?.name || 'LoomCanvas')
  const logoUrl = computed(() => (embed.brand ? embed.brand.logoUrl || '' : bootstrap.value?.site?.logoUrl || ''))

  // ---- 语言 ----
  const locale = ref<LocaleCode>(currentLocale())

  function setLocale(code: LocaleCode, persist = true) {
    locale.value = code
    applyLocale(code, persist)
  }

  // ---- 启动与登录 ----
  async function loadBootstrap(justSignedIn = false, keepLocalTheme = false) {
    bootstrapError.value = ''
    try {
      const info = unwrap(await appApi.bootstrap())
      bootstrap.value = info
      // 带着令牌去取、回来却没有账号：令牌已经失效（过期 / 被下线 / 账号被停用）。
      // 清掉它，免得之后每个请求（包括公开页面的）都带着一个死令牌。
      if (!justSignedIn && token.value && !info.user) { token.value = ''; clearToken() }
      syncTheme(info.user, keepLocalTheme)
      // 用户自己没选过语言，才跟站点默认值走
      const siteLocale = normalizeLocale(info.site?.defaultLocale)
      if (!savedLocale() && siteLocale && !embed.localeControlled) setLocale(siteLocale, false)
      // 标题栏是宿主页面的：嵌进别人的页面时不碰
      if (!embed.embedded) document.title = info.site?.name || 'LoomCanvas'
    } catch (err: any) {
      bootstrapError.value = err?.response?.data?.message || err?.message || 'bootstrap failed'
      embed.emit('error', { scope: 'bootstrap', message: bootstrapError.value, cause: err })
    }
  }

  /** 登录 / 注册成功后：记下令牌，再整份重取启动信息（hasProvider 之类是按账号算的） */
  async function adopt(data: { user: User; token: string }, remember: boolean, keepLocalTheme = false) {
    token.value = data.token
    setToken(data.token, remember)
    await loadBootstrap(true, keepLocalTheme)
    // 启动信息没取回来（网络抖了一下）也先让人进去，账号以登录接口返回的为准
    if (bootstrap.value && !bootstrap.value.user) bootstrap.value = { ...bootstrap.value, user: data.user }
  }

  async function login(account: string, password: string, remember: boolean) {
    const data = unwrap(await authApi.login({ account, password, remember }))
    signInPassword.value = data.user?.mustChangePassword ? password : ''
    await adopt(data, remember)
  }

  /**
   * 换掉临时密码。服务端同时换发令牌并清掉 mustChangePassword；
   * 这里接上新令牌、把账号状态改过来，之后的导航就不再被拦。
   */
  async function replaceTemporaryPassword(currentPassword: string, newPassword: string) {
    const out = unwrap(await authApi.changePassword({ currentPassword, newPassword }))
    swapToken(out?.token || '')
    signInPassword.value = ''
    if (bootstrap.value?.user) bootstrap.value = { ...bootstrap.value, user: { ...bootstrap.value.user, mustChangePassword: false } }
    // 用临时密码登录期间接口只放行改密码，登录页上选的主题那时存不上账号：现在补上
    syncTheme(bootstrap.value?.user, false)
  }

  /** 注册完直接算登录；注册表单没有「记住我」，按记住处理 */
  async function register(username: string, email: string, password: string) {
    // 新账号还没有自己的主题：注册之前在这台浏览器上选的那个，带到账号上
    await adopt(unwrap(await authApi.register({ username, email, password })), true, true)
  }

  /**
   * 改完密码服务端把这个账号的会话全部作废（包括发请求的这一个），同时换发一个新令牌：
   * 改密码之前被抄走的令牌从此没用。这里把新的接上，用户不会被登出。
   */
  function swapToken(next: string) {
    if (!next) return
    token.value = next
    replaceToken(next)
  }

  function dropSession() {
    token.value = ''
    signInPassword.value = ''
    clearToken()
    if (bootstrap.value?.user) bootstrap.value = { ...bootstrap.value, user: null, hasProvider: false }
  }

  /** 用户自己点的退出（区别于令牌失效）：App.vue 据此回落地页，而不是带着 redirect 去登录页 */
  const leaving = ref(false)

  async function logout() {
    leaving.value = true
    try { await authApi.logout() } catch { /* 服务端那头失败也要把本机的令牌清掉 */ }
    dropSession()
    // 注册开关可能变了
    await loadBootstrap()
  }

  /** 改了用户名 / 邮箱之后同步到顶栏 */
  function setUser(u: User) {
    if (bootstrap.value) bootstrap.value = { ...bootstrap.value, user: u }
  }

  // ---- 界面偏好（跟着账号存在服务端） ----
  /** 画布上生成节点用哪种布局；没登录（分享页）时是默认的 a */
  const nodeLayout = computed<NodeLayout>(() => (embed.editor ? embed.editor.nodeLayout.value : normalizeNodeLayout(user.value?.prefs?.nodeLayout ?? embed.defaultNodeLayout)))

  /**
   * 改一项偏好：先改本地（选了就生效，不等请求），再存到服务端；没存上就改回去并把错误抛给调用方。
   */
  async function setPrefs(patch: UserPrefs) {
    // 只嵌编辑器：布局是宿主给的选项，这里改的就是那一个；没有账号可存
    if (embed.editor) {
      if (patch.nodeLayout) embed.editor.nodeLayout.value = patch.nodeLayout
      return
    }
    // 宿主管登录、后端不认识这个人：只记在这一次挂载里
    if (hostAuth && !bootstrap.value?.user) {
      localPrefs.value = { ...localPrefs.value, ...patch }
      return
    }
    const before = bootstrap.value?.user
    if (!before) return
    setUser({ ...before, prefs: { ...before.prefs, ...patch } })
    try {
      const out = unwrap(await authApi.updatePrefs(patch))
      // 只接偏好这一项：请求在路上时账号的别的字段可能已经变了（改了名字、被要求改密码）
      const cur = bootstrap.value?.user
      if (cur && out?.user?.prefs) setUser({ ...cur, prefs: out.user.prefs })
    } catch (err) {
      const cur = bootstrap.value?.user
      if (cur) setUser({ ...cur, prefs: before.prefs })
      throw err
    }
  }
  const setNodeLayout = (v: NodeLayout) => setPrefs({ nodeLayout: v })

  // ---- 主题 ----
  /**
   * 主题的选择（深色 / 浅色 / 跟随系统）。它有两份：
   *   账号上的一份（users.prefs.theme）是准的，换浏览器登录也跟着走；
   *   这台浏览器上的一份（localStorage，见 composables/useTheme.ts）是它的镜像，
   *   没登录的页面（落地页 / 登录页 / 分享页）和每次打开时的首帧都用它。
   */
  const theme = computed<ThemePref>(() => themePref.value)

  /**
   * 启动信息里带着账号时，把两份对齐：
   *   一般情况以账号上的为准，本机跟过去；
   *   本机的选择还没存到任何账号上（没登录时在落地页 / 登录页换的，或者这是刚注册的新账号）就反过来，
   *   以本机的为准并存到账号上。没存上（比如还在用临时密码，接口只放行改密码）就留着记号，下次再存。
   */
  function syncTheme(u: User | null | undefined, keepLocal: boolean) {
    // 主题由宿主定（挂载时给了 theme，之后用 setTheme 改）：不拿账号上的那一份去盖它
    if (!u || embed.themeControlled) return
    const mine = normalizeTheme(u.prefs?.theme)
    const local = themePref.value
    if (keepLocal || themePending()) {
      if (mine === local) { setThemePending(false); return }
      setThemePending(true)
      // 还在用临时密码：接口只放行改密码，这会儿存不上，等改完密码再存（replaceTemporaryPassword 里会再来一次）
      if (u.mustChangePassword) return
      void setPrefs({ theme: local }).then(() => setThemePending(false)).catch(() => undefined)
      return
    }
    if (mine !== local) setThemePref(mine, { animate: false })
  }

  /**
   * 换主题：立刻生效并记在这台浏览器上；登录着就同时存到账号上。
   * 没存上就改回去并把错误抛给调用方（否则下次打开会被账号上的旧值盖回去，等于白选）。
   */
  async function setTheme(v: ThemePref) {
    const before = themePref.value
    if (v === before) return
    setThemePref(v)
    // 没登录：先记在这台浏览器上，并留个记号，登录之后存到那个账号上
    if (embed.themeControlled || embed.editor) return
    if (!bootstrap.value?.user) { if (!hostAuth) setThemePending(true); return }
    try {
      await setPrefs({ theme: v })
      setThemePending(false)
    } catch (err) {
      setThemePref(before)
      throw err
    }
  }

  // 任意接口返回 401：令牌失效。这里只清状态，跳去登录页由 App.vue 看着 authed 做。
  // （宿主管登录时 401 不到这里：utils/api.ts 直接交给宿主的 onAuthRequired）
  if (!runtime.getAuth) setUnauthorizedHandler(dropSession)
  // 任意接口返回 403 auth.password_change_required：账号被要求先改密码（比如开着页面时被超级管理员重置了）。
  // 这里只改状态，跳去「设置新密码」由 App.vue 看着 mustChangePassword 做。
  setPasswordChangeHandler(() => {
    const u = bootstrap.value?.user
    if (u && !u.mustChangePassword) bootstrap.value = { ...bootstrap.value!, user: { ...u, mustChangePassword: true } }
  })

  /** 沉浸式：画布编辑页里把外壳（顶栏 + 侧栏）整个收起来，离开编辑页时复位 */
  const immersive = ref(false)
  function setImmersive(v: boolean) { immersive.value = v }
  function toggleImmersive() { immersive.value = !immersive.value }

  return {
    bootstrap, bootstrapError, token, user, authed, isOwner, registrationOpen, hostAuth, avatarUrl, setHostUser,
    mustChangePassword, signInPassword, replaceTemporaryPassword,
    hasProvider, siteName, logoUrl,
    locale, setLocale,
    loadBootstrap, login, register, logout, setUser, swapToken, leaving,
    nodeLayout, setPrefs, setNodeLayout,
    theme, setTheme,
    immersive, setImmersive, toggleImmersive,
  }
})
