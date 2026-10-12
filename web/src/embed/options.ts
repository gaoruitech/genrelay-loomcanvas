/**
 * Pure option handling shared by both entries: defaults, feature resolution, the page allow-list.
 * No DOM, no Vue: unit-tested in test/options.test.ts.
 *
 * Internal module, except for the `*_KEYS` lists, which the public-API guard test snapshots.
 */
import type {
  EditorAdapter, LoomCanvasAppOptions, LoomCanvasEditorOptions, LoomCanvasFeatures, LoomCanvasPage,
  LoomCanvasAppHandle, LoomCanvasEditorHandle, LoomCanvasAppEvents, LoomCanvasEditorEvents,
} from './types'
import { CANVAS_NODE_TYPES, TOOL_NODE_TYPES, type CanvasNodeType } from './document'

/** A list that names every key of T exactly once; a missing key is a compile error. */
function keysOf<T>() {
  return <const K extends readonly (keyof T)[]>(keys: K & ([keyof T] extends [K[number]] ? unknown : never)): K => keys
}

export const FEATURE_KEYS = keysOf<LoomCanvasFeatures>()([
  'share', 'templates', 'brandKit', 'assetLibrary', 'batchRun', 'batchDownload', 'cost', 'modelManagement',
  'nodeLayoutSwitch', 'themeSwitch', 'localeSwitch', 'guide', 'canvasSwitch', 'immersive', 'account', 'externalLinks',
  'palette', 'queue', 'minimap', 'titleBar', 'backButton', 'canvasStyle', 'imageEditor', 'search',
])

export const APP_OPTION_KEYS = keysOf<Required<LoomCanvasAppOptions>>()([
  'apiBase', 'fileBase', 'getAuth', 'onAuthRequired', 'user', 'getUser', 'routerMode', 'basePath', 'initialPage',
  'onNavigate', 'shell', 'pages', 'features', 'nodeLayout', 'brand',
  'theme', 'locale', 'messages', 'storagePrefix', 'zIndex',
])

export const EDITOR_OPTION_KEYS = keysOf<Required<LoomCanvasEditorOptions>>()([
  'adapter', 'canvasId', 'document', 'onChange', 'changeDebounceMs', 'readOnly', 'nodeLayout', 'features', 'nodeTypes', 'onBack',
  'theme', 'locale', 'messages', 'storagePrefix', 'zIndex',
])

export const APP_HANDLE_KEYS = keysOf<LoomCanvasAppHandle>()(['unmount', 'navigate', 'setTheme', 'setLocale', 'on'])

export const EDITOR_HANDLE_KEYS = keysOf<LoomCanvasEditorHandle>()([
  'unmount', 'getDocument', 'setDocument', 'setCanvasId', 'save', 'fitView', 'runAll', 'runNode', 'addNode', 'undo', 'redo',
  'setTheme', 'setLocale', 'setNodeLayout', 'setReadOnly', 'on',
])

export const APP_EVENT_KEYS = keysOf<LoomCanvasAppEvents>()([
  'ready', 'route', 'canvas:saved', 'run:started', 'run:finished', 'run:failed', 'result', 'error',
])

export const EDITOR_EVENT_KEYS = keysOf<LoomCanvasEditorEvents>()([
  'ready', 'change', 'saved', 'run:started', 'run:finished', 'run:failed', 'result', 'selection', 'error',
])

export const ADAPTER_REQUIRED_KEYS = [
  'loadCanvas', 'saveCanvas', 'listModels', 'submitRun', 'getRuns', 'cancelRun', 'submitLlm', 'getLlm', 'upload', 'resolveFileUrl',
] as const satisfies readonly (keyof EditorAdapter)[]

export const ADAPTER_OPTIONAL_KEYS = [
  'capabilities', 'estimate', 'importRemoteFile', 'downloadFile', 'downloadZip', 'runTool', 'listCanvases',
  'brandKits', 'templates', 'assets', 'share',
] as const satisfies readonly (keyof EditorAdapter)[]

export const PAGE_KEYS: readonly LoomCanvasPage[] = [
  'home', 'canvases', 'canvas', 'assets', 'brand-kits', 'models', 'history', 'settings', 'setup', 'share',
]

/** Features that belong to the editor's own chrome; on by default in both entries. */
const EDITOR_CHROME: readonly (keyof LoomCanvasFeatures)[] = ['palette', 'queue', 'minimap', 'titleBar', 'canvasStyle', 'imageEditor', 'search']

/** What each feature needs from the adapter. A feature without its backend stays off, whatever was asked for. */
const FEATURE_NEEDS: Partial<Record<keyof LoomCanvasFeatures, (a: EditorAdapter) => boolean>> = {
  share: (a) => !!a.share,
  templates: (a) => !!a.templates,
  brandKit: (a) => !!a.brandKits,
  assetLibrary: (a) => !!a.assets,
  batchDownload: (a) => !!a.downloadZip,
  cost: (a) => !!a.estimate,
  canvasSwitch: (a) => !!a.listCanvases,
}

export type FeatureMode = 'standalone' | 'app' | 'editor'

export interface FeatureContext {
  mode: FeatureMode
  /** The host supplies authentication (Shape 1 with `getAuth`). */
  hostAuth?: boolean
  /** Shape 1 without LoomCanvas' shell. */
  shell?: 'full' | 'none'
  adapter?: EditorAdapter | null
}

export function resolveFeatures(input: Partial<LoomCanvasFeatures> | undefined, ctx: FeatureContext): LoomCanvasFeatures {
  const out = {} as LoomCanvasFeatures
  for (const key of FEATURE_KEYS) {
    // The editor entry starts with its own chrome only; the app starts with everything.
    let on = ctx.mode === 'editor' ? EDITOR_CHROME.includes(key) : true
    // The host owns sign-in: no account menu, and no links out of the host's product unless asked for.
    if (ctx.mode === 'app' && ctx.hostAuth && (key === 'account' || key === 'externalLinks')) on = false
    if (input && typeof input[key] === 'boolean') on = input[key] as boolean
    // Immersive hides a shell; without one there is nothing to hide.
    if (key === 'immersive' && (ctx.mode === 'editor' || ctx.shell === 'none')) on = false
    if (key === 'account' && ctx.mode === 'editor') on = false
    const need = FEATURE_NEEDS[key]
    if (on && need && ctx.adapter && !need(ctx.adapter)) on = false
    out[key] = on
  }
  return out
}

/** Node types the editor may offer: what was asked for, minus what the adapter cannot run. */
export function resolveNodeTypes(asked: readonly CanvasNodeType[] | undefined, adapter?: EditorAdapter | null): CanvasNodeType[] {
  const known = new Set<string>(CANVAS_NODE_TYPES)
  const base = (asked && asked.length ? asked : CANVAS_NODE_TYPES).filter((t) => known.has(t))
  const noTools = !!adapter && !adapter.runTool
  return [...new Set(base)].filter((t) => !(noTools && TOOL_NODE_TYPES.includes(t)))
}

/** Route name (router/index.ts) -> public page name. Routes that are not pages (sign-in, landing) map to ''. */
const ROUTE_PAGE: Record<string, LoomCanvasPage> = {
  home: 'home', 'canvas-list': 'canvases', canvas: 'canvas', assets: 'assets', 'brand-kits': 'brand-kits',
  models: 'models', history: 'history', settings: 'settings', setup: 'setup', share: 'share',
}
const PAGE_ROUTE: Record<LoomCanvasPage, string> = {
  home: 'home', canvases: 'canvas-list', canvas: 'canvas', assets: 'assets', 'brand-kits': 'brand-kits',
  models: 'models', history: 'history', settings: 'settings', setup: 'setup', share: 'share',
}

export function pageOfRoute(routeName: unknown): LoomCanvasPage | '' {
  return ROUTE_PAGE[String(routeName || '')] || ''
}
export function routeOfPage(page: string): string {
  return PAGE_ROUTE[page as LoomCanvasPage] || ''
}

/** null = no restriction. Unknown names are dropped; an empty result means "nothing but the canvas list". */
export function resolvePages(pages: readonly string[] | undefined): Set<LoomCanvasPage> | null {
  if (!Array.isArray(pages)) return null
  const out = new Set<LoomCanvasPage>()
  for (const p of pages) if ((PAGE_KEYS as readonly string[]).includes(p)) out.add(p as LoomCanvasPage)
  if (!out.size) out.add('canvases')
  return out
}

export function isPageAllowed(pages: Set<LoomCanvasPage> | null, page: LoomCanvasPage | ''): boolean {
  if (!pages) return true
  return !!page && pages.has(page)
}

/** Where to send somebody who asked for a page that is not allowed: the first allowed "landing" page. */
export function fallbackPage(pages: Set<LoomCanvasPage> | null): LoomCanvasPage {
  if (!pages) return 'home'
  for (const p of ['home', 'canvases', 'assets', 'models', 'history', 'settings'] as const) if (pages.has(p)) return p
  return 'canvases'
}

export function validateAdapter(adapter: unknown): asserts adapter is EditorAdapter {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('LoomCanvas: `adapter` is required')
  const missing = ADAPTER_REQUIRED_KEYS.filter((k) => typeof (adapter as any)[k] !== 'function')
  if (missing.length) throw new TypeError(`LoomCanvas: the adapter is missing ${missing.join(', ')}`)
}
