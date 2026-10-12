/**
 * What both embed entries share: the mount root, the event emitter, plugin installation.
 * Internal module: not part of the public API.
 */
import type { App } from 'vue'
import { runtime } from './runtime'
import { EMBED_KEY, setCurrentEmbed, type EmbedContext } from './context'
import { i18n, mergeMessages, normalizeLocale, savedLocale, setLocale } from '@/locales'
import { initEmbeddedTheme, paintRoot, setThemePref, normalizeTheme } from '@/composables/useTheme'
import { mediaSrc } from '@/utils/mediaUrl'
import type { CommonOptions, LoomCanvasTheme, Unsubscribe } from './types'

export interface Emitter {
  on(event: string, handler: (payload: any) => void): Unsubscribe
  emit(event: string, payload: unknown): void
  clear(): void
}

export function createEmitter(): Emitter {
  const map = new Map<string, Set<(payload: any) => void>>()
  return {
    on(event, handler) {
      if (typeof handler !== 'function') return () => undefined
      let set = map.get(event)
      if (!set) map.set(event, (set = new Set()))
      set.add(handler)
      return () => { set!.delete(handler) }
    },
    emit(event, payload) {
      for (const fn of [...(map.get(event) || [])]) {
        // A host handler that throws must not break the editor.
        try { fn(payload) } catch (err) { console.error(`[loomcanvas] "${event}" handler threw`, err) }
      }
    },
    clear() { map.clear() },
  }
}

export interface MountRoot {
  /** `.lc-root.lc-embedded`: carries the theme attributes, is the containing block of every popup. */
  root: HTMLElement
  /** Where the Vue app is mounted. */
  appEl: HTMLElement
  /** Teleport / popup target. */
  portal: HTMLElement
  destroy(): void
}

/**
 * Build the mount root inside the host's element. Nothing outside `el` is touched: no attribute
 * on <html> / <body>, no element appended to <body>.
 */
export function createMountRoot(el: HTMLElement, mode: 'app' | 'editor', options: CommonOptions): MountRoot {
  if (!el || el.nodeType !== 1) throw new TypeError('LoomCanvas: the mount target must be an element')
  const root = document.createElement('div')
  root.className = `lc-root lc-embedded lc-mode-${mode}`
  if (typeof options.zIndex === 'number') root.style.zIndex = String(options.zIndex)
  const appEl = document.createElement('div')
  appEl.className = 'lc-app'
  const portal = document.createElement('div')
  portal.className = 'lc-portal'
  root.append(appEl, portal)
  el.appendChild(root)

  const activate = () => { runtime.activeRoot = root; runtime.activePortal = portal }
  root.addEventListener('pointerdown', activate, true)
  root.addEventListener('focusin', activate, true)
  runtime.roots.add(root)
  activate()
  paintRoot(root)

  // The root sizes itself from the host's element (it is a size container): a host element without a
  // height would leave nothing to see. Say so instead of rendering an empty box silently.
  requestAnimationFrame(() => {
    if (root.isConnected && root.clientHeight === 0) {
      console.warn('[loomcanvas] the mount element has no height. Give it one (e.g. height: 640px, or a flex / grid cell): LoomCanvas fills its container and does not size itself from its content.')
    }
  })

  return {
    root, appEl, portal,
    destroy() {
      root.removeEventListener('pointerdown', activate, true)
      root.removeEventListener('focusin', activate, true)
      runtime.roots.delete(root)
      if (runtime.activeRoot === root) { runtime.activeRoot = null; runtime.activePortal = null }
      root.remove()
    },
  }
}

/** Theme, language and message overrides from the host's options. Call after `configureRuntime`. */
export function applyCommonOptions(options: CommonOptions): void {
  mergeMessages(options.messages)
  initEmbeddedTheme(options.theme)
  const locale = normalizeLocale(options.locale) || savedLocale()
  if (locale) setLocale(locale, false)
}

export function installCommon(app: App, ctx: EmbedContext): void {
  app.use(i18n)
  app.provide(EMBED_KEY, ctx)
  app.config.globalProperties.$lcPortal = ctx.portal
  app.config.globalProperties.$src = mediaSrc
  app.config.globalProperties.$feat = ctx.features
  setCurrentEmbed(ctx)
}

/** `setTheme()` of both handles: the host's choice is not written to storage. */
export function hostSetTheme(theme: LoomCanvasTheme): void {
  setThemePref(normalizeTheme(theme), { persist: false })
}
