import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAppStore } from '@/stores/app'
import { resolveSettingsSection } from '@/components/settings/sections'

declare module 'vue-router' {
  interface RouteMeta {
    /** 不登录也能看（落地页、登录、注册、分享只读页） */
    public?: boolean
    /** 只给没登录的人看；已登录的直接送去工作台 */
    guestOnly?: boolean
    /** 外壳形态：full 带文字侧栏（默认）、mini 图标侧栏（画布编辑器）、none 不要外壳 */
    shell?: 'full' | 'mini' | 'none'
    /** 侧栏里哪一项算「当前」 */
    nav?: 'home' | 'canvases' | 'assets' | 'models' | 'history' | 'settings'
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'landing', component: () => import('@/views/Landing.vue'), meta: { public: true, guestOnly: true } },
  { path: '/login', name: 'login', component: () => import('@/views/Login.vue'), meta: { public: true, guestOnly: true } },
  { path: '/register', name: 'register', component: () => import('@/views/Register.vue'), meta: { public: true, guestOnly: true } },

  { path: '/app', name: 'home', component: () => import('@/views/Workbench.vue'), meta: { nav: 'home' } },
  { path: '/canvases', name: 'canvas-list', component: () => import('@/views/CanvasList.vue'), meta: { nav: 'canvases' } },
  { path: '/canvas/:id', name: 'canvas', component: () => import('@/views/Canvas.vue'), meta: { nav: 'canvases', shell: 'mini' } },
  { path: '/assets', name: 'assets', component: () => import('@/views/Assets.vue'), meta: { nav: 'assets' } },
  // 素材库的第二个页签：品牌包（建、改、删都在这里；给哪张画布用是在画布顶栏上选的）
  { path: '/assets/brand-kits', name: 'brand-kits', component: () => import('@/views/BrandKits.vue'), meta: { nav: 'assets' } },
  { path: '/models', name: 'models', component: () => import('@/views/Models.vue'), meta: { nav: 'models' } },
  { path: '/history', name: 'history', component: () => import('@/views/History.vue'), meta: { nav: 'history' } },
  // 一次只看一个分区，分区写在地址里：/settings/account、/settings/storage……不带分区的由守卫补上
  { path: '/settings/:section?', name: 'settings', component: () => import('@/views/Settings.vue'), meta: { nav: 'settings' } },
  { path: '/setup', name: 'setup', component: () => import('@/views/Setup.vue'), meta: { shell: 'none' } },
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

const router = createRouter({
  history: createWebHistory(),
  routes,
})

const SKIP_KEY = 'loomcanvas-setup-skipped'

/** 用户在引导页点了「先跳过」：本次会话内不再强制带回引导页 */
export function skipSetup() {
  try { sessionStorage.setItem(SKIP_KEY, '1') } catch { /* 存不了就算了，下次导航会再提示一次 */ }
}

function setupSkipped(): boolean {
  try { return sessionStorage.getItem(SKIP_KEY) === '1' } catch { return false }
}

/** 没有服务商也照样能进的页面：引导页本身，以及能手动配置的那两页 */
const NO_SETUP_NEEDED = new Set(['setup', 'settings', 'models'])

/** 登录后要回去的地址：只认站内路径，防止 ?redirect=//evil.example 这种跳到站外 */
export function safeRedirect(v: unknown): string {
  const s = typeof v === 'string' ? v : ''
  return /^\/(?![/\\])/.test(s) ? s : ''
}

/** 设置页以前有「服务商 / 模型 / 用量」三个页签，现在各自是独立页面；老链接接过去 */
const OLD_SETTINGS_TABS: Record<string, string> = { providers: 'models', models: 'models', usage: 'history' }

router.beforeEach((to) => {
  const app = useAppStore()
  // 连不上服务端时 App.vue 整页换成提示，这里不跳
  if (!app.bootstrap) return true
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
  // 还没有添加任何服务商：先带去引导页
  if (!app.hasProvider && !setupSkipped() && !NO_SETUP_NEEDED.has(String(to.name))) {
    return { name: 'setup' }
  }
  if (to.name === 'settings') {
    // /settings、老的 /settings#account、?section=、不认识或没权限看的分区：都落到一个确定的分区地址上
    const section = resolveSettingsSection(app.isOwner, to.params.section, to.hash, to.query.section)
    if (to.params.section !== section) return { name: 'settings', params: { section }, replace: true }
  }
  return true
})

export default router
