import { lcSession } from '@/utils/storage'
import { createRouter, createWebHistory, createWebHashHistory, createMemoryHistory, type RouteRecordRaw, type Router, isNavigationFailure, NavigationFailureType } from 'vue-router'
import type { Pinia } from 'pinia'
import type { EmbedContext } from '@/embed/context'
import { fallbackPage, isPageOpen, pageOfRoute, routeOfPage } from '@/embed/options'
import { useAppStore } from '@/stores/app'
import { useSpaceStore, SPACE_PARAM_RE, spaceOfParam, spaceParam } from '@/stores/space'
import { resolveSettingsSection } from '@/components/settings/sections'
import { isSettingsOpen } from '@/embed/links'
import { resolveTeamTab } from '@/components/team/tabs'

declare module 'vue-router' {
  interface RouteMeta {
    /** 不登录也能看（落地页、登录、注册、分享只读页） */
    public?: boolean
    /** 只给没登录的人看；已登录的直接送去工作台 */
    guestOnly?: boolean
    /** 外壳形态：full 带文字侧栏（默认）、mini 图标侧栏（画布编辑器）、none 不要外壳 */
    shell?: 'full' | 'mini' | 'none'
    /** 侧栏里哪一项算「当前」 */
    nav?: 'home' | 'canvases' | 'assets' | 'models' | 'history' | 'team' | 'settings'
    /** 这一页是在某个空间里看的：地址可以带 /t-<团队 id> 前缀，不带就是个人空间 */
    spaced?: boolean
    /** 只有团队空间里才有的页面 */
    teamOnly?: boolean
  }
}

/**
 * 空间写在地址的最前面：/t-<团队 id>/canvases 是团队里的画布列表，/canvases 是个人空间的。
 * 这一段是可选的，所以路由的名字不分空间：代码里照旧 push({ name: 'canvas', params: { id } })，
 * 守卫会把当前空间补到地址上（见下面 beforeEach 里「空间」那一段）。
 */
const S = `/:space(${SPACE_PARAM_RE})?`

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'landing', component: () => import('@/views/Landing.vue'), meta: { public: true, guestOnly: true } },
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { public: true, guestOnly: true } },
  { path: '/register', name: 'register', component: () => import('@/views/Register.vue'), meta: { public: true, guestOnly: true } },

  { path: `${S}/app`, name: 'home', component: () => import('@/views/Workbench.vue'), meta: { nav: 'home', spaced: true } },
  { path: `${S}/canvases`, name: 'canvas-list', component: () => import('@/views/CanvasList.vue'), meta: { nav: 'canvases', spaced: true } },
  { path: `${S}/canvas/:id`, name: 'canvas', component: () => import('@/views/Canvas.vue'), meta: { nav: 'canvases', shell: 'mini', spaced: true } },
  { path: `${S}/assets`, name: 'assets', component: () => import('@/views/Assets.vue'), meta: { nav: 'assets', spaced: true } },
  // 素材库的第二个页签：品牌包（建、改、删都在这里；给哪张画布用是在画布顶栏上选的）
  { path: `${S}/assets/brand-kits`, name: 'brand-kits', component: () => import('@/views/BrandKits.vue'), meta: { nav: 'assets', spaced: true } },
  { path: `${S}/models`, name: 'models', component: () => import('@/views/Models.vue'), meta: { nav: 'models', spaced: true } },
  { path: `${S}/history`, name: 'history', component: () => import('@/views/History.vue'), meta: { nav: 'history', spaced: true } },
  // 团队：成员、用量、动态、团队设置四个页签，页签写在地址里。只有团队空间里有
  { path: `${S}/team/:tab?`, name: 'team', component: () => import('@/views/Team.vue'), meta: { nav: 'team', spaced: true, teamOnly: true } },
  // 一次只看一个分区，分区写在地址里：/settings/account、/settings/storage……不带分区的由守卫补上
  // （设置是账号和站点的，不是空间的；带着空间前缀只是为了看设置的时候不离开当前空间）
  { path: `${S}/settings/:section?`, name: 'settings', component: () => import('@/views/Settings.vue'), meta: { nav: 'settings', spaced: true } },
  { path: `${S}/setup`, name: 'setup', component: () => import('@/views/Setup.vue'), meta: { shell: 'none', spaced: true } },
  // 邀请链接。不登录也能看到是哪个团队在邀请；登录后在这一页点「加入」
  { path: '/join/:token', name: 'join', component: () => import('@/views/Join.vue'), meta: { public: true, shell: 'none' } },
  // 还在用临时密码的账号唯一能待的地方；见下面的守卫
  { path: '/password', name: 'change-password', component: () => import('@/views/ChangePassword.vue'), meta: { shell: 'none' } },

  {
    path: '/share/:token',
    name: 'share',
    component: () => import('@/views/CanvasShareView.vue'),
    meta: { public: true, shell: 'none' },
  },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFound.vue'), meta: { public: true } },
]


const SKIP_KEY = 'loomcanvas-setup-skipped'

/** 用户在引导页点了「先跳过」：本次会话内不再强制带回引导页 */
export function skipSetup() {
  try { lcSession.setItem(SKIP_KEY, '1') } catch { /* 存不了就算了，下次导航会再提示一次 */ }
}

function setupSkipped(): boolean {
  try { return lcSession.getItem(SKIP_KEY) === '1' } catch { return false }
}

/** 没有服务商也照样能进的页面：引导页本身，以及能手动配置的那两页 */
const NO_SETUP_NEEDED = new Set(['setup', 'settings', 'models', 'team'])

/** 登录后要回去的地址：只认站内路径，防止 ?redirect=//evil.example 这种跳到站外 */
export function safeRedirect(v: unknown): string {
  const s = typeof v === 'string' ? v : ''
  return /^\/(?![/\\])/.test(s) ? s : ''
}

/** 设置页以前有「服务商 / 模型 / 用量」三个页签，现在各自是独立页面；老链接接过去 */
const OLD_SETTINGS_TABS: Record<string, string> = { providers: 'models', models: 'models', usage: 'history' }

export interface AppRouterOptions {
  /** history：真实路径；hash：#/canvases；memory：不碰地址栏（嵌入时由宿主自己同步） */
  mode: 'history' | 'hash' | 'memory'
  /** 应用挂在宿主的哪个子路径下 */
  base?: string
  pinia: Pinia
  embed: EmbedContext
}

/**
 * 建路由。独立应用（main.ts）和整站嵌入（embed/app.ts）都从这里建：
 * 一个页面上可以有不止一份应用，各有各的路由和守卫。
 */
export function createAppRouter(opts: AppRouterOptions): Router {
  const { embed } = opts
  // 浏览器的前进 / 后退：地址说在哪个空间就是哪个空间，不沿用当前的（见守卫里「空间」那一段）。
  // 这个监听要抢在 vue-router 自己的 popstate 监听之前登记，才能在守卫跑之前把记号打上。
  let popping = false
  const onPop = () => { popping = true }
  if (opts.mode !== 'memory' && typeof window !== 'undefined') window.addEventListener('popstate', onPop)
  const history = opts.mode === 'hash' ? createWebHashHistory(opts.base) : opts.mode === 'memory' ? createMemoryHistory(opts.base) : createWebHistory(opts.base)
  const router = createRouter({ history, routes })
  let started = false
  /** 「回首页」：开放的页面里第一个能落脚的（集成方没列的、所属功能被关掉的都不算，见 embed/options.ts 的 isPageOpen） */
  const home = () => ({ name: routeOfPage(fallbackPage(embed.pages, embed.features)) })
  const open = (name: unknown) => isPageOpen(embed, pageOfRoute(name))

  router.beforeEach(async (to, from) => {
    const app = useAppStore(opts.pinia)
    const space = useSpaceStore(opts.pinia)
    const firstNavigation = !started
    // 连不上服务端时 App.vue 整页换成提示，这里不跳
    if (!app.bootstrap) return true
    // ---- 嵌进别人产品里时的两条限制（独立应用两条都不生效） ----
    // 宿主自己管登录：落地页 / 登录 / 注册 / 设置新密码这几页不存在
    // 人已经在某一页上：这次导航作废，原地不动；从地址直接进来的送去第一个开放的页面
    const stay = () => {
      if (pageOfRoute(from.name) && open(from.name)) return false
      // 一个能落脚的页面都没有（页面清单里只有带参数的页面，或者它们的功能都关了）：停在原地，不来回重定向
      const h = home()
      if (h.name === to.name) return false
      // 地址上写着的空间带过去（/t-<团队 id>/team 进不去时落到那个团队的首页，而不是个人空间）
      return to.params.space ? { ...h, params: { space: to.params.space } } : h
    }
    if (embed.hostAuth && (to.meta.guestOnly || to.name === 'change-password')) return stay()
    // 这一页在这次挂载里不存在：集成方没把它列进 pages，或者它所属的功能被关了（素材库、品牌包、模型管理、团队管理）。
    // 从里面点过去的原地不动，从地址直接进来的送回第一个开放的页面
    if (pageOfRoute(to.name)) {
      if (!open(to.name)) return stay()
    } else if (embed.pages) {
      // 只开放了一部分页面：不认识的地址到不了；登录 / 注册这几页只在本产品自己管登录时才有
      const isAccountRoute = to.name !== 'not-found'
      if (!(isAccountRoute && !embed.hostAuth)) return stay()
    } else if (embed.embedded && to.name === 'not-found') {
      return stay()
    }
    if (to.name === 'settings') {
      const moved = OLD_SETTINGS_TABS[String(to.query.tab || '')]
      if (moved) return { name: moved }
    }
    // 还在用临时密码：除了「设置新密码」哪儿也不让去（公开页面也一样，接口那头反正只放行改密码）。
    // 原本要去的地址带在 redirect 里，改完接着去。
    if (app.authed && app.mustChangePassword) {
      if (to.name === 'change-password') return true
      const wanted = to.meta.guestOnly ? safeRedirect(to.query.redirect) : to.fullPath
      return { name: 'change-password', query: wanted && wanted !== '/app' ? { redirect: wanted } : {} }
    }
    if (to.name === 'change-password' && app.authed) return safeRedirect(to.query.redirect) || { name: 'home' }
    if (to.meta.public) {
      if (app.authed && to.meta.guestOnly) return safeRedirect(to.query.redirect) || { name: 'home' }
      return true
    }
    if (!app.authed) return { name: 'login', query: { redirect: to.fullPath } }

    // ---- 空间 ----
    // 地址是准的：/t-<团队 id>/… 是那个团队，不带前缀是个人空间。
    // 例外只有一种：应用里按名字跳转（push({ name: 'canvas-list' })）时地址上没有前缀，
    // 这时沿用当前空间，由这里把前缀补上，所以页面代码不用到处带着空间。
    // 前进 / 后退、直接打开的地址、从切换器里选的（它总是把空间写在地址上，个人空间带 ?space=personal）不沿用。
    if (to.meta.spaced) {
      const inUrl = spaceOfParam(to.params.space)
      const explicitPersonal = !inUrl && to.query.space === 'personal'
      let target = inUrl
      if (space.fixed !== null) target = space.fixed
      else if (!space.teamsEnabled) target = ''
      else if (!inUrl && !explicitPersonal) {
        if (firstNavigation) target = to.name === 'home' ? space.remembered() : ''
        else if (!popping) target = space.currentId
      }
      if (target !== space.currentId || !space.fresh) {
        const ok = await space.enter(target)
        // 进不去（不是成员、团队关闭了）：人已经在个人空间，原因在 space.notice 里。
        // 画布这种带 id 的页面在个人空间里没有意义，回首页；别的页面换成个人空间的同一页
        if (!ok) return to.name === 'canvas' || to.meta.teamOnly ? { name: 'home', replace: true } : { name: to.name!, params: { ...to.params, space: '' }, query: stripSpace(to.query), hash: to.hash, replace: true }
      }
      const want = spaceParam(space.currentId)
      if ((to.params.space || '') !== want || explicitPersonal) {
        // 地址明说了要个人空间（?space=personal）：把「上次在哪个团队」忘掉。不然去掉这个记号再走一遍守卫时，
        // 直接打开的首页（首次导航）又会被带回记着的那个团队 —— 新标签页里打开「个人空间」的首页就进不去了
        if (explicitPersonal && !space.currentId) space.remember('')
        return { name: to.name!, params: { ...to.params, space: want }, query: stripSpace(to.query), hash: to.hash, replace: firstNavigation || undefined }
      }
      // 团队页只在团队空间里有（集成方关了团队管理的情况上面已经拦掉了）
      if (to.meta.teamOnly && !space.isTeam) return { name: 'home', params: { space: spaceParam(space.currentId) }, replace: true }
      if (to.name === 'team') {
        const tab = resolveTeamTab(space, to.params.tab)
        if (to.params.tab !== tab) return { name: 'team', params: { ...to.params, tab }, replace: true }
      }
    }
    // 引导页不在开放的页面里（或者集成方关了模型管理）：不往那儿带
    const setupOffered = isPageOpen(embed, 'setup')
    // 还没有添加任何服务商：先带去引导页。团队里只有能配服务商的人才带（成员配不了，带过去也没用）
    if (setupOffered && !app.hasProvider && !setupSkipped() && !NO_SETUP_NEEDED.has(String(to.name)) && space.can('provider:manage')) {
      // 空间明写在地址上：直接打开团队地址（第一次导航）时不带的话会被当成个人空间
      return { name: 'setup', params: { space: spaceParam(space.currentId) } }
    }
    if (to.name === 'settings') {
      // 这个人在设置页里一个能看的分区都没有（宿主管登录、语言 / 主题 / 节点布局三个开关又都关了）：这一页对他不存在
      if (!isSettingsOpen(embed, app.isOwner)) return stay()
      // /settings、老的 /settings#account、?section=、不认识或没权限看的分区：都落到一个确定的分区地址上
      const section = resolveSettingsSection(app.isOwner, to.params.section, to.hash, to.query.section)
      if (to.params.section !== section) return { name: 'settings', params: { ...to.params, section }, replace: true }
    }
    return true
  })

  router.afterEach((_to, _from, failure) => {
    started = true
    popping = false
    // 换空间期间外壳里不放页面；导航走完（成功或失败）再放出来。
    // 被更新的一次导航顶掉的不算走完（切换空间还没落地就又点了侧栏）：后面那次还在路上，地址还是旧的，
    // 这时放出来就是旧地址上的页面取着新空间的数据。等顶掉它的那次导航走完，由它来放。
    if (isNavigationFailure(failure, NavigationFailureType.cancelled)) return
    useSpaceStore(opts.pinia).settled()
  })
  // 导航中途抛了错（守卫里的请求失败、页面的代码块取不到）：afterEach 不会来，页面也要放出来，不能一直转圈
  router.onError(() => { useSpaceStore(opts.pinia).settled() })

  return router
}

/** 去掉 ?space=personal 这个只给守卫看的记号 */
function stripSpace(query: Record<string, any>): Record<string, any> {
  if (!('space' in query)) return query
  const { space: _space, ...rest } = query
  return rest
}
