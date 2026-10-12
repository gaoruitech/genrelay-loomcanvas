/**
 * Page-level runtime configuration.
 *
 * One page holds ONE LoomCanvas runtime: where the API lives, how requests are authenticated,
 * which adapter the editor talks to, the storage-key prefix, the UI language and the theme.
 * Several views may be mounted on a page (each with its own router, store, DOM root and canvas),
 * but they share what is in here. The stand-alone app never touches the defaults.
 *
 * Internal module: not part of the public API.
 */
import type { EditorAdapter, GetAuth } from './types'

export interface Runtime {
  /** false: the stand-alone app that owns the document. true: mounted inside a host page. */
  embedded: boolean
  apiBase: string
  /** Origin serving `/files/<key>`; '' = the page's own origin. */
  fileBase: string
  /** Host-supplied request headers. null: LoomCanvas' own session token. */
  getAuth: GetAuth | null
  onAuthRequired: (() => void) | null
  /** Prefix of storage keys when embedded (see utils/storage.ts). */
  storagePrefix: string
  /** The editor's backend. Set by the entries before anything is mounted. */
  adapter: EditorAdapter | null
  /** Mount roots: the elements that carry the theme attributes. */
  roots: Set<HTMLElement>
  /** Root the user interacted with last; toasts and dialogs opened from non-component code go there. */
  activeRoot: HTMLElement | null
  /** Where Teleports and TDesign popups of the active root go. */
  activePortal: HTMLElement | null
}

export const DEFAULT_STORAGE_PREFIX = 'loomcanvas-'

export const runtime: Runtime = {
  embedded: false,
  apiBase: '/api',
  fileBase: '',
  getAuth: null,
  onAuthRequired: null,
  storagePrefix: DEFAULT_STORAGE_PREFIX,
  adapter: null,
  roots: new Set(),
  activeRoot: null,
  activePortal: null,
}

/** Origin part of an API base; '' when it is relative (same origin). */
export function originOf(base: string): string {
  if (!/^https?:\/\//i.test(base)) return ''
  try { return new URL(base).origin } catch { return '' }
}

export interface RuntimeConfig {
  apiBase?: string
  fileBase?: string
  getAuth?: GetAuth
  onAuthRequired?: () => void
  storagePrefix?: string
}

/** Apply host options. Called by the embed entries; a second mount on the same page overrides the first. */
export function configureRuntime(cfg: RuntimeConfig): void {
  runtime.embedded = true
  if (cfg.apiBase !== undefined) runtime.apiBase = String(cfg.apiBase || '/api').replace(/\/+$/, '') || '/api'
  runtime.fileBase = cfg.fileBase !== undefined ? String(cfg.fileBase || '').replace(/\/+$/, '') : originOf(runtime.apiBase)
  if (cfg.getAuth !== undefined) runtime.getAuth = cfg.getAuth || null
  if (cfg.onAuthRequired !== undefined) runtime.onAuthRequired = cfg.onAuthRequired || null
  if (cfg.storagePrefix !== undefined) runtime.storagePrefix = cfg.storagePrefix || DEFAULT_STORAGE_PREFIX
}

/** Root the theme / tokens should be read from right now. */
export function currentRoot(): HTMLElement {
  if (runtime.activeRoot && runtime.activeRoot.isConnected) return runtime.activeRoot
  for (const r of runtime.roots) if (r.isConnected) return r
  return document.documentElement
}

/** Where a popup opened from non-component code should be attached. */
export function currentPortal(): HTMLElement {
  if (runtime.activePortal && runtime.activePortal.isConnected) return runtime.activePortal
  return document.body
}
