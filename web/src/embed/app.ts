/**
 * Integration entry 1: the whole single-page application, mounted inside a host page.
 *
 *   import { mountLoomCanvas } from 'loomcanvas-web/app'
 *   import 'loomcanvas-web/app.css'
 *
 *   const lc = mountLoomCanvas(document.getElementById('canvas')!, {
 *     apiBase: 'https://canvas.example.com/api',
 *     getAuth: () => ({ Authorization: `Bearer ${myToken()}` }),
 *     shell: 'none',
 *     pages: ['canvases', 'canvas'],
 *   })
 *
 * See docs/integration.md. Everything exported here is public API.
 */
import './styles'
import { reactive } from 'vue'
import { configureRuntime, runtime } from './runtime'
import { createEmbedContext } from './context'
import { applyCommonOptions, createEmitter, createMountRoot, hostSetTheme } from './mount'
import { createLoomApp } from './createApp'
import { fallbackPage, resolveBrand, resolveFeatures, resolvePages, routeOfPage, PAGE_KEYS } from './options'
import { normalizeLocale } from '@/locales'
import { normalizeNodeLayout } from '@/composables/nodeLayout'
import type { HostUser, LoomCanvasAppHandle, LoomCanvasAppOptions, LoomCanvasPage } from './types'

export type * from './types'
export { CANVAS_SCHEMA_VERSION, CANVAS_NODE_TYPES, migrateDocument, createEmptyDocument, CanvasDocumentError } from './document'

/** Version of the integration API (the package version). */
export const VERSION: string = __LC_VERSION__

function pathOf(to: string, params: Record<string, string> | undefined): string | { name: string; params?: Record<string, string> } {
  if (to.startsWith('/')) return to
  const name = routeOfPage(to)
  if (!name) throw new Error(`LoomCanvas: unknown page "${to}". Pages: ${PAGE_KEYS.join(', ')}`)
  return params && Object.keys(params).length ? { name, params } : { name }
}

export function mountLoomCanvas(el: HTMLElement, options: LoomCanvasAppOptions = {}): LoomCanvasAppHandle {
  // The whole app talks to the stock server through the built-in adapter. An editor that was mounted
  // on this page before (and is gone) leaves its adapter behind for its last save: drop it now.
  // While an editor IS mounted the two views share its adapter, as before (one runtime per page).
  if (![...runtime.roots].some((r) => r.isConnected && r.classList.contains('lc-mode-editor'))) runtime.adapter = null
  configureRuntime({
    apiBase: options.apiBase,
    fileBase: options.fileBase,
    getAuth: options.getAuth,
    onAuthRequired: options.onAuthRequired,
    storagePrefix: options.storagePrefix,
  })
  const hostAuth = typeof options.getAuth === 'function'
  const shell = options.shell === 'none' ? 'none' : 'full'
  const pages = resolvePages(options.pages)
  const emitter = createEmitter()
  const mount = createMountRoot(el, 'app', options)
  applyCommonOptions(options)

  const ctx = createEmbedContext({
    mode: 'app',
    embedded: true,
    root: mount.root,
    portal: mount.portal,
    shell,
    hostAuth,
    hostUser: options.user || null,
    pages,
    space: typeof options.space === 'string' && options.space ? options.space : null,
    features: reactive(resolveFeatures(options.features, { mode: 'app', hostAuth, shell })),
    brand: resolveBrand(options.brand),
    defaultNodeLayout: normalizeNodeLayout(options.nodeLayout),
    themeControlled: !!options.theme,
    localeControlled: !!options.locale,
    emit: (event, payload) => {
      // Inside the app the events of the canvas are named as the editor names them.
      const name = event === 'saved' ? 'canvas:saved' : event
      if (name === 'route') options.onNavigate?.(payload as any)
      emitter.emit(name, payload)
    },
  })

  // Memory mode is the default when embedded: the address bar belongs to the host.
  const routerMode = options.routerMode === 'history' || options.routerMode === 'hash' ? options.routerMode : 'memory'
  const first = options.initialPage || fallbackPage(pages, ctx.features)

  const lc = createLoomApp({
    el: mount.appEl,
    ctx,
    routerMode,
    basePath: options.basePath,
    initial: pathOf(first, undefined),
    async beforeStart(store) {
      const locale = normalizeLocale(options.locale)
      if (locale) store.setLocale(locale, false)
      if (options.getUser) {
        try { store.setHostUser((await options.getUser()) as HostUser) } catch (err: any) {
          emitter.emit('error', { scope: 'auth', message: err?.message || 'getUser failed', cause: err })
        }
      }
    },
  })

  let alive = true
  lc.ready.then(() => {
    if (!alive) return
    emitter.emit('ready', {})
  })

  return {
    unmount() {
      if (!alive) return
      alive = false
      try { lc.unmount() } finally { mount.destroy(); emitter.clear() }
    },
    async navigate(to: LoomCanvasPage | string, params?: Record<string, string>) {
      await lc.ready
      await lc.router.push(pathOf(String(to), params) as any)
    },
    setTheme(theme) { hostSetTheme(theme) },
    setLocale(locale) {
      const code = normalizeLocale(locale)
      if (code) lc.store.setLocale(code, false)
    },
    on(event, handler) { return emitter.on(event, handler as any) },
  }
}
