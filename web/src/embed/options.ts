/**
 * Pure option handling shared by both entries: defaults, feature resolution, the page allow-list.
 * No DOM, no Vue: unit-tested in test/options.test.ts.
 *
 * Internal module, except for the `*_KEYS` lists, which the public-API guard test snapshots.
 */
import type {
  EditorAdapter, LoomCanvasAppOptions, LoomCanvasBrand, LoomCanvasEditorOptions, LoomCanvasFeatures, LoomCanvasPage,
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
  'spaceSwitch', 'teamAdmin',
  'palette', 'queue', 'minimap', 'titleBar', 'backButton', 'canvasStyle', 'imageEditor', 'search',
])

export const APP_OPTION_KEYS = keysOf<Required<LoomCanvasAppOptions>>()([
  'apiBase', 'fileBase', 'getAuth', 'onAuthRequired', 'user', 'getUser', 'routerMode', 'basePath', 'initialPage',
  'onNavigate', 'shell', 'pages', 'features', 'nodeLayout', 'brand', 'space',
  'theme', 'locale', 'messages', 'storagePrefix', 'zIndex',
])

/** The members of `brand` (mountLoomCanvas). */
export const BRAND_KEYS = keysOf<Required<LoomCanvasBrand>>()(['name', 'logoUrl', 'showName'])

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
  'ready', 'route', 'canvas:saved', 'space', 'run:started', 'run:finished', 'run:failed', 'result', 'error',
])

export const EDITOR_EVENT_KEYS = keysOf<LoomCanvasEditorEvents>()([
  'ready', 'change', 'saved', 'created', 'run:started', 'run:finished', 'run:failed', 'result', 'selection', 'error',
])

export const ADAPTER_REQUIRED_KEYS = [
  'loadCanvas', 'saveCanvas', 'listModels', 'submitRun', 'getRuns', 'cancelRun', 'submitLlm', 'getLlm', 'upload', 'resolveFileUrl',
] as const satisfies readonly (keyof EditorAdapter)[]

export const ADAPTER_OPTIONAL_KEYS = [
  'acquireLock', 'releaseLock', 'peekLock', 'createCanvas',
  'capabilities', 'estimate', 'importRemoteFile', 'downloadFile', 'downloadZip', 'runTool', 'listCanvases',
  'brandKits', 'templates', 'assets', 'share',
] as const satisfies readonly (keyof EditorAdapter)[]

export const PAGE_KEYS: readonly LoomCanvasPage[] = [
  'home', 'canvases', 'canvas', 'assets', 'brand-kits', 'models', 'history', 'team', 'settings', 'setup', 'share', 'join',
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
    // Spaces and teams belong to the whole app: the editor entry gets its space from the adapter.
    if ((key === 'spaceSwitch' || key === 'teamAdmin') && ctx.mode === 'editor') on = false
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
  models: 'models', history: 'history', team: 'team', settings: 'settings', setup: 'setup', share: 'share', join: 'join',
}
const PAGE_ROUTE: Record<LoomCanvasPage, string> = {
  home: 'home', canvases: 'canvas-list', canvas: 'canvas', assets: 'assets', 'brand-kits': 'brand-kits',
  models: 'models', history: 'history', team: 'team', settings: 'settings', setup: 'setup', share: 'share', join: 'join',
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

/**
 * Pages that ARE a feature: with the switch off the page does not exist, exactly as if it had been
 * left out of `pages`. That is what makes "no entry point is left" true for these features: the
 * sidebar item, every link to the page and the address itself all go through `isPageOpen`.
 */
export const PAGE_FEATURE: Partial<Record<LoomCanvasPage, keyof LoomCanvasFeatures>> = {
  assets: 'assetLibrary',
  'brand-kits': 'brandKit',
  models: 'modelManagement',
  setup: 'modelManagement',
  team: 'teamAdmin',
}

/** What `isPageOpen` needs to know about one mounted view (an `EmbedContext` fits). */
export interface PageScope {
  mode?: FeatureMode
  pages: Set<LoomCanvasPage> | null
  features: LoomCanvasFeatures
}

/**
 * Does this page exist in this mounted view? It must be in `pages` (when the host gave a list) and
 * the feature it belongs to must be on. The editor entry has no pages at all: it is one screen.
 */
export function isPageOpen(scope: PageScope, page: LoomCanvasPage | ''): boolean {
  if (scope.mode === 'editor') return false
  if (!isPageAllowed(scope.pages, page)) return false
  const feature = page ? PAGE_FEATURE[page] : undefined
  return !feature || !!scope.features[feature]
}

/**
 * Where to send somebody who asked for a page that is not open: the first open "landing" page.
 * With `features`, a page whose feature is off is skipped as well.
 */
export function fallbackPage(pages: Set<LoomCanvasPage> | null, features?: LoomCanvasFeatures): LoomCanvasPage {
  const open = (p: LoomCanvasPage) => (features ? isPageOpen({ pages, features }, p) : isPageAllowed(pages, p))
  for (const p of ['home', 'canvases', 'assets', 'models', 'history', 'settings'] as const) if (open(p)) return p
  return 'canvases'
}

/** `brand` as the app uses it: strings trimmed, `showName` a boolean. */
export interface ResolvedBrand { name?: string; logoUrl?: string; showName: boolean }

/**
 * The host's `brand` option. `false`: no brand block. An object: the host's own name and logo, with
 * `showName` on unless it is exactly `false`. Anything else (absent, a string, ...): undefined, which
 * means "follow the site settings of the server". Empty or non-string `name` / `logoUrl` count as not given.
 */
export function resolveBrand(input: unknown): ResolvedBrand | false | undefined {
  if (input === false) return false
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const b = input as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  return { name: text(b.name), logoUrl: text(b.logoUrl), showName: b.showName !== false }
}

export function validateAdapter(adapter: unknown): asserts adapter is EditorAdapter {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('LoomCanvas: `adapter` is required')
  const missing = ADAPTER_REQUIRED_KEYS.filter((k) => typeof (adapter as any)[k] !== 'function')
  if (missing.length) throw new TypeError(`LoomCanvas: the adapter is missing ${missing.join(', ')}`)
}
