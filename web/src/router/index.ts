import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAppStore } from '@/stores/app'

declare module 'vue-router' {
  interface RouteMeta {
    /** 不需要口令也能看（分享只读页） */
    public?: boolean
    /** 页面自己占满整屏，不要应用外壳的顶栏 */
    bare?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'canvas-list', component: () => import('@/views/CanvasList.vue') },
  { path: '/canvas/:id', name: 'canvas', component: () => import('@/views/Canvas.vue') },
  {
    path: '/share/:token',
    name: 'share',
    component: () => import('@/views/CanvasShareView.vue'),
    meta: { public: true, bare: true },
  },
  { path: '/settings', name: 'settings', component: () => import('@/views/Settings.vue') },
  { path: '/setup', name: 'setup', component: () => import('@/views/Setup.vue'), meta: { bare: true } },
  { path: '/:pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFound.vue') },
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

router.beforeEach((to) => {
  const app = useAppStore()
  // 没通过口令时由 App.vue 整页换成口令页，这里不做跳转；分享页任何人都能看
  if (to.meta.public || !app.authed || !app.bootstrap) return true
  // 还没有添加任何服务商：先带去引导页。设置页本身不拦，否则没法手动配置
  if (!app.hasProvider && !setupSkipped() && to.name !== 'setup' && to.name !== 'settings') {
    return { name: 'setup' }
  }
  return true
})

/**
 * 守卫只在导航时跑。口令通过 / 重新连上服务端之后当前路由不会变，
 * 得手动补一次「没有接入就去引导页」的判断。
 */
export function ensureSetup() {
  const app = useAppStore()
  const cur = router.currentRoute.value
  if (!app.authed || app.hasProvider || setupSkipped()) return
  if (cur.meta.public || cur.name === 'setup' || cur.name === 'settings') return
  router.replace({ name: 'setup' })
}

export default router
