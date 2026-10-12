import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { appApi, authApi, unwrap, setUnauthorizedHandler, setPasswordChangeHandler } from '@/utils/api'
import { getToken, setToken, replaceToken, clearToken } from '@/utils/authToken'
import { normalizeLocale, savedLocale, setLocale as applyLocale, currentLocale } from '@/locales'
import type { BootstrapInfo, LocaleCode, User, UserPrefs } from '@/types'
import { normalizeNodeLayout, type NodeLayout } from '@/composables/nodeLayout'

/**
 * 应用级状态：启动信息、当前账号、语言。
 * 界面只有一套霓虹深色主题，所以这里没有主题相关的状态。
 */
export const useAppStore = defineStore('app', () => {
  const bootstrap = ref<BootstrapInfo | null>(null)
  const bootstrapError = ref('')
  const token = ref(getToken())

  const user = computed<User | null>(() => bootstrap.value?.user || null)
  const authed = computed(() => !!user.value)
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
  const siteName = computed(() => bootstrap.value?.site?.name || 'LoomCanvas')
  const logoUrl = computed(() => bootstrap.value?.site?.logoUrl || '')

  // ---- 语言 ----
  const locale = ref<LocaleCode>(currentLocale())

  function setLocale(code: LocaleCode, persist = true) {
    locale.value = code
    applyLocale(code, persist)
  }

  // ---- 启动与登录 ----
  async function loadBootstrap(justSignedIn = false) {
    bootstrapError.value = ''
    try {
      const info = unwrap(await appApi.bootstrap())
      bootstrap.value = info
      // 带着令牌去取、回来却没有账号：令牌已经失效（过期 / 被下线 / 账号被停用）。
      // 清掉它，免得之后每个请求（包括公开页面的）都带着一个死令牌。
      if (!justSignedIn && token.value && !info.user) { token.value = ''; clearToken() }
      // 用户自己没选过语言，才跟站点默认值走
      const siteLocale = normalizeLocale(info.site?.defaultLocale)
      if (!savedLocale() && siteLocale) setLocale(siteLocale, false)
      document.title = info.site?.name || 'LoomCanvas'
    } catch (err: any) {
      bootstrapError.value = err?.response?.data?.message || err?.message || 'bootstrap failed'
    }
  }

  /** 登录 / 注册成功后：记下令牌，再整份重取启动信息（hasProvider 之类是按账号算的） */
  async function adopt(data: { user: User; token: string }, remember: boolean) {
    token.value = data.token
    setToken(data.token, remember)
    await loadBootstrap(true)
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
  }

  /** 注册完直接算登录；注册表单没有「记住我」，按记住处理 */
  async function register(username: string, email: string, password: string) {
    await adopt(unwrap(await authApi.register({ username, email, password })), true)
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
  const nodeLayout = computed<NodeLayout>(() => normalizeNodeLayout(user.value?.prefs?.nodeLayout))

  /**
   * 改一项偏好：先改本地（选了就生效，不等请求），再存到服务端；没存上就改回去并把错误抛给调用方。
   */
  async function setPrefs(patch: UserPrefs) {
    const before = user.value
    if (!before) return
    setUser({ ...before, prefs: { ...before.prefs, ...patch } })
    try {
      const out = unwrap(await authApi.updatePrefs(patch))
      // 只接偏好这一项：请求在路上时账号的别的字段可能已经变了（改了名字、被要求改密码）
      if (user.value && out?.user?.prefs) setUser({ ...user.value, prefs: out.user.prefs })
    } catch (err) {
      if (user.value) setUser({ ...user.value, prefs: before.prefs })
      throw err
    }
  }
  const setNodeLayout = (v: NodeLayout) => setPrefs({ nodeLayout: v })

  // 任意接口返回 401：令牌失效。这里只清状态，跳去登录页由 App.vue 看着 authed 做。
  setUnauthorizedHandler(dropSession)
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
    bootstrap, bootstrapError, token, user, authed, isOwner, registrationOpen,
    mustChangePassword, signInPassword, replaceTemporaryPassword,
    hasProvider, siteName, logoUrl,
    locale, setLocale,
    loadBootstrap, login, register, logout, setUser, swapToken, leaving,
    nodeLayout, setPrefs, setNodeLayout,
    immersive, setImmersive, toggleImmersive,
  }
})
