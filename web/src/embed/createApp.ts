/**
 * Builds and starts one instance of the whole application. The stand-alone app (main.ts) and the
 * embed entry (embed/app.ts) both go through here, so there is a single start-up sequence.
 * Internal module: not part of the public API.
 */
import { createApp as createVueApp, type App as VueApp } from 'vue'
import { createPinia, type Pinia } from 'pinia'
import type { Router } from 'vue-router'
import App from '@/App.vue'
import { createAppRouter } from '@/router'
import { useAppStore } from '@/stores/app'
import { loadModels } from '@/utils/canvasModels'
import { installCommon } from './mount'
import { guardedLink } from './links'
import type { EmbedContext } from './context'

export interface LoomApp {
  app: VueApp
  pinia: Pinia
  router: Router
  store: ReturnType<typeof useAppStore>
  /** Resolves once the first page is on screen (or the "cannot reach the server" notice is). */
  ready: Promise<void>
  /** Unmount without disposing the shared i18n instance (other instances on the page keep using it). */
  unmount(): void
}

export interface LoomAppOptions {
  el: HTMLElement | string
  ctx: EmbedContext
  routerMode: 'history' | 'hash' | 'memory'
  basePath?: string
  /** First location in memory mode: an in-app path or a named route. */
  initial?: string | { name: string; params?: Record<string, string> }
  /** Runs after the bootstrap call and before the first navigation (the embed entry resolves the host user here). */
  beforeStart?: (store: ReturnType<typeof useAppStore>) => void | Promise<void>
}

export function createLoomApp(opts: LoomAppOptions): LoomApp {
  const { ctx } = opts
  ctx.routerMode = opts.routerMode
  const app = createVueApp(App)
  // vue-i18n wraps app.unmount to dispose the (page-wide) i18n instance; keep the original.
  const rawUnmount = app.unmount.bind(app)
  const pinia = createPinia()
  app.use(pinia)
  installCommon(app, ctx)

  const store = useAppStore(pinia)
  const router = createAppRouter({ mode: opts.routerMode, base: opts.basePath, pinia, embed: ctx })

  // 启动信息拿到之后再装路由：守卫要靠它判断「登录了没有」「有没有接入服务商」。
  // 模型清单是按账号的，登录了才取；之后登录状态变化时由 App.vue 重取。
  const ready = store.loadBootstrap()
    .then(() => opts.beforeStart?.(store))
    // 还在用临时密码的账号，接口只放行改密码：模型清单等改完再取（App.vue 看着）
    .then(() => (store.bootstrap && store.authed && !store.mustChangePassword ? loadModels().catch(() => undefined) : undefined))
    .catch(() => undefined)
    .then(async () => {
      if (opts.routerMode === 'memory') await router.replace(opts.initial || '/').catch(() => undefined)
      app.use(router)
      if (ctx.embedded) app.component('RouterLink', guardedLink(ctx, router))
      app.mount(opts.el)
      await router.isReady().catch(() => undefined)
    })

  return { app, pinia, router, store, ready, unmount: rawUnmount }
}
