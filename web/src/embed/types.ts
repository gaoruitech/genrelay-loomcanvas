/**
 * Public types of the two integration entries (`loomcanvas-web/app` and `loomcanvas-web/editor`).
 *
 * Everything exported from this file is public API: names and shapes follow semantic versioning
 * (see docs/integration.md, "Compatibility"). The guard test in test/public-api.test.ts fails when
 * an option, method, event or adapter member is added, renamed or removed without the snapshot
 * being updated on purpose.
 *
 * This file must stay free of imports from application internals other than plain type modules.
 */
import type { CostEstimate, LlmTask, ModelSpec, Run, RunRequest, UploadedFile } from '../types'
import type { CanvasDocument, CanvasNodeType } from './document'

export type { CostEstimate, LlmTask, ModelSpec, Run, RunRequest, UploadedFile } from '../types'
export type { ModelKind, ModelPricing, RunOutput, RunStatus, Cost } from '../types'
export type * from './document'

export type LoomCanvasLocale = 'zh-CN' | 'en'
export type LoomCanvasTheme = 'dark' | 'light' | 'system'
export type LoomCanvasNodeLayout = 'a' | 'b' | 'c'

/** Request headers the host adds to every API call. May be async (e.g. to refresh a token). */
export type GetAuth = () => Record<string, string> | Promise<Record<string, string>>

/** Nested message overrides per locale, same key paths as the built-in catalogue (e.g. `{ en: { canvas: { untitled: 'New board' } } }`). */
export type MessageOverrides = Partial<Record<LoomCanvasLocale, Record<string, unknown>>>

/* ------------------------------------------------------------------ */
/* Feature flags                                                        */
/* ------------------------------------------------------------------ */

/**
 * Switches for parts of the UI. A flag that is off hides every entry point of that feature
 * (buttons, menu items, pages' links); it is a UI switch, not an access control.
 *
 * Defaults differ per entry: the whole app (`mountLoomCanvas`) starts with everything on,
 * the editor (`mountEditor` / `<LoomCanvasEditor>`) starts with only the "editor chrome" group on.
 */
export interface LoomCanvasFeatures {
  // ---- product features ----
  /** Share links: the share button and "my shares". */
  share: boolean
  /** Canvas templates and text snippets. */
  templates: boolean
  /** Brand kits: the chip in the title block, the per-node exception menu, the editor dialog. */
  brandKit: boolean
  /** The asset library dialog and "save to assets". */
  assetLibrary: boolean
  /** Batch run (run one canvas over many inputs). */
  batchRun: boolean
  /** Batch download as a zip. */
  batchDownload: boolean
  /** Cost / usage figures: estimates on nodes, totals in the queue. */
  cost: boolean
  /** Links to model management (the "no models" hint link, the setup guide). */
  modelManagement: boolean
  /** The node-layout switch (a / b / c) in the editor's "more" menu and in settings. */
  nodeLayoutSwitch: boolean
  /** The theme switch. */
  themeSwitch: boolean
  /** The language switch. */
  localeSwitch: boolean
  /** The built-in tutorial and the shortcut sheet. */
  guide: boolean
  /** Switching to / importing from another canvas inside the editor. */
  canvasSwitch: boolean
  /** The "immersive" toggle (only meaningful with `shell: 'full'`). */
  immersive: boolean
  /** Account UI: user menu, sign-out, account settings. */
  account: boolean
  /** Links that leave the product (documentation, source code). */
  externalLinks: boolean
  /**
   * The space switcher in the top bar (personal space / teams, "create a team", "join with an invite").
   * Off: the user stays in the space the app started in (see the `space` option).
   */
  spaceSwitch: boolean
  /** The Team page (members, usage, activity, team settings) and its entry points. Off when the host manages membership itself. */
  teamAdmin: boolean
  // ---- editor chrome ----
  /** The tool palette (add nodes). The context menu on the pane still adds nodes when this is off. */
  palette: boolean
  /** The floating queue button. */
  queue: boolean
  /** The minimap. */
  minimap: boolean
  /** The title block (name, save state). */
  titleBar: boolean
  /** The back button in the title block. */
  backButton: boolean
  /** The canvas appearance panel (background colour and pattern). */
  canvasStyle: boolean
  /** The built-in crop / rotate image editor. */
  imageEditor: boolean
  /** Node search (Ctrl+F). */
  search: boolean
}

/* ------------------------------------------------------------------ */
/* Events                                                               */
/* ------------------------------------------------------------------ */

export interface RunEventPayload {
  /** Id of the canvas the node belongs to. */
  canvasId: string
  nodeId: string
  nodeType: CanvasNodeType | string
  /** Backend run / task ids, when the node went through `submitRun` / `submitLlm`. */
  runIds: string[]
  /** Only on `run:failed`. */
  error?: string
}

export interface ResultEventPayload {
  canvasId: string
  nodeId: string
  nodeType: CanvasNodeType | string
  /** Media results (generated images / videos). */
  outputs: { type: 'image' | 'video'; url: string }[]
  /** Text result (LLM and video-analysis nodes). */
  text?: string
}

export interface ErrorEventPayload {
  /** Where it happened: `load`, `save`, `run`, `auth`, `adapter`, `bootstrap`. */
  scope: string
  message: string
  cause?: unknown
}

/** Events of the whole-app entry. */
export interface LoomCanvasAppEvents {
  ready: {}
  /** After every navigation. `name` is the page name (see `LoomCanvasPage`), `path` the in-app path. */
  route: { name: string; path: string; params: Record<string, string> }
  'canvas:saved': { canvasId: string; updatedAt: string }
  /** The user entered a space: `id` is `'personal'` or a team id; `role` is their role in it (`'owner'` in the personal space). */
  space: { id: string; kind: 'personal' | 'team'; name: string; role: 'owner' | 'admin' | 'member' }
  'run:started': RunEventPayload
  'run:finished': RunEventPayload
  'run:failed': RunEventPayload
  result: ResultEventPayload
  error: ErrorEventPayload
}

/** Events of the editor entry. */
export interface LoomCanvasEditorEvents {
  ready: { canvasId: string }
  /** The document changed (debounced; see `changeDebounceMs`). */
  change: { canvasId: string; document: CanvasDocument }
  /** The document was written through the adapter. */
  saved: { canvasId: string; updatedAt: string }
  /**
   * The editor stored its document as a NEW canvas through `adapter.createCanvas` ("make a copy",
   * "save my version as a copy" after a save conflict or a lost lock). The editor keeps showing
   * `fromCanvasId`; pass `canvasId` to `setCanvasId()` to open the copy.
   */
  created: { canvasId: string; fromCanvasId: string }
  'run:started': RunEventPayload
  'run:finished': RunEventPayload
  'run:failed': RunEventPayload
  result: ResultEventPayload
  selection: { nodeIds: string[]; edgeIds: string[] }
  error: ErrorEventPayload
}

export type Unsubscribe = () => void

/* ------------------------------------------------------------------ */
/* Adapter                                                              */
/* ------------------------------------------------------------------ */

export interface EstimateRequest {
  model: string
  params?: Record<string, unknown>
  count?: number
}

export interface LlmRequest {
  model: string
  prompt: string
  systemPrompt?: string
  imageUrls?: string[]
  videoUrl?: string
}

/** What the editor needs to know about the backend up front. Everything is optional. */
export interface AdapterCapabilities {
  /** Largest upload the backend accepts, in MB. Checked before uploading. */
  maxUploadMb?: number
  /** Whether the model provider can fetch stored files by URL (public address). */
  upstreamByUrl?: boolean
  /**
   * `false` while the backend cannot store new files: uploads and image / video runs would be
   * refused, and the editor says so on those nodes before a run. Leave it out when unknown.
   */
  storageWritable?: boolean
}

/** Somebody the editor shows by name (the holder of an edit lock, the last editor). */
export interface CanvasPerson {
  id: string
  /** Name to show. */
  name: string
}

/**
 * The edit lock of a canvas: one editing session (one open editor - a browser tab) edits at a time,
 * everybody else sees it read-only. That includes the same person in a second tab.
 */
export interface CanvasLockInfo {
  by: CanvasPerson
  /** When the lock was taken, ISO time. */
  at?: string
  expiresAt?: string
  /** This very editor holds it. */
  mine: boolean
  /**
   * The holder is the caller's own account. With `mine: false` that is "you, in another tab": the
   * editor then says so instead of "<name> is editing". Leave it out when your backend locks per account.
   */
  sameUser?: boolean
}

/** What the caller may do with one canvas. A missing field means "allowed" (that is today's behaviour). */
export interface CanvasAccessInfo {
  /** false: the editor opens read-only and never asks for the lock. */
  canEdit?: boolean
  /** Offer "Take over" when somebody else holds the lock. */
  canTakeOver?: boolean
  /** Offer "Overwrite with my version" on a save conflict. */
  canOverwrite?: boolean
  /** Offer the public share link. */
  canShare?: boolean
  /** Offer the "who can see this" choice (team spaces of the stock server). */
  canSetVisibility?: boolean
}

/** A canvas as the adapter stores it: the document plus identity and timestamps. */
export interface StoredCanvas {
  id: string
  document: CanvasDocument
  updatedAt?: string
  createdAt?: string
  /**
   * Version counter of the content. When given, the editor sends it back as `baseRevision` with the
   * next content save, and expects the new value in the answer. Without it saves are "last write wins".
   */
  revision?: number
  /**
   * Counter of renames. Never part of a conflict; it only lets an open editor notice that the name
   * it shows is out of date (see `AcquireLockResult.metaRevision`).
   */
  metaRevision?: number
  /** What the caller may do with this canvas. Without it everything is allowed. */
  access?: CanvasAccessInfo
  /** Who holds the edit lock right now, if anybody. */
  lock?: CanvasLockInfo | null
  /** Stock server, team spaces: `'private'`, `'team_view'` or `'team_edit'`; `''` in a personal space. */
  visibility?: string
  /** Stock server: `'personal'` or the team id the canvas lives in. */
  spaceId?: string
  /** Who saved the content last, and when. */
  lastEditedBy?: CanvasPerson | null
  lastEditedAt?: string | null
}

/** Options of a content save (see `EditorAdapter.saveCanvas`). */
export interface SaveCanvasOptions {
  /** The revision the editor's document is based on. Reject with `code: 'canvas.conflict'` when the stored one is newer. */
  baseRevision?: number
  /** Skip the revision check: the user chose "overwrite with my version". */
  force?: boolean
}

/** Answer of `EditorAdapter.acquireLock`. */
export interface AcquireLockResult {
  /** The lock the caller now holds; `null` when this canvas needs none (single-user storage). */
  lock: CanvasLockInfo | null
  /** Current revision of the content, when the backend keeps one. */
  revision?: number
  /** How often to call `acquireLock` again to keep the lock, in milliseconds. Default 12000. */
  heartbeatMs?: number
  /** The same in seconds, for adapters written before `heartbeatMs`. `heartbeatMs` wins. */
  heartbeatSeconds?: number
  /**
   * What the call did, when the backend says: `'acquired'`, `'renewed'`, `'reacquired'` (this editor's
   * own lock had run out - a tab in the background - and nobody took the canvas in between) or
   * `'taken_over'`. The editor does not branch on it; it compares `revision`.
   */
  state?: string
  /** The canvas's current name and rename counter: how an open editor follows a rename made elsewhere. */
  name?: string
  metaRevision?: number
}

/** Answer of `EditorAdapter.peekLock`: the lock as it is right now, without taking or renewing it. */
export interface LockPeek {
  /** `null`: nobody is editing. */
  lock: CanvasLockInfo | null
  revision?: number
  name?: string
  metaRevision?: number
  /** May the caller edit / take over now (rights can change while the editor is open). */
  canEdit?: boolean
  canTakeOver?: boolean
  /** How often to ask again, in milliseconds. Default 5000. */
  pollMs?: number
}

/**
 * An `Error` an adapter may reject with. Two codes change what the editor does:
 *
 * - `code: 'canvas.locked'` (from `acquireLock` or `saveCanvas`): another editing session holds the edit lock.
 *   `data: { lock: CanvasLockInfo, canTakeOver?: boolean, lost?: 'taken_over' | 'expired' | null }`. The editor
 *   turns read-only and says who is editing - or, with `lock.sameUser`, that the canvas is open in another tab.
 *   `lost` tells an editor that used to hold the lock how it lost it.
 * - `code: 'canvas.conflict'` (from `saveCanvas`): the stored content is newer than `baseRevision`; nothing was
 *   written. `data: { revision, lastEditedBy?: CanvasPerson, lastEditedAt?: string, canOverwrite?: boolean }`.
 *   The editor stops saving and asks the user what to do.
 *
 * The stock HTTP adapter rejects with the HTTP client's error; the editor reads `code` and `data` from
 * either place (`error.code` / `error.data`, or the response body).
 */
export interface AdapterError extends Error {
  /** HTTP-like status: 4xx is shown to the user even for background saves. */
  status?: number
  code?: string
  data?: Record<string, unknown>
}

/**
 * The only way the editor talks to the outside. Implement it against your own backend, or use
 * `createHttpAdapter` (stock LoomCanvas server) / `createMemoryAdapter` (no server at all).
 *
 * Errors: reject with an `Error`; its `message` is shown to the user. An optional numeric `status`
 * property (HTTP-like) lets the editor tell client errors (shown even for background saves) from
 * transient ones.
 */
export interface EditorAdapter {
  /** Load one canvas. Reject when it does not exist. */
  loadCanvas(id: string): Promise<StoredCanvas>
  /**
   * Save a canvas. `document` is partial, and what it carries says what kind of save it is:
   *
   * - a **content** save carries `nodes`, `edges`, `settings`, `brandKitId` (and the viewport along with
   *   them). The editor sends ONE at a time per canvas and passes `options.baseRevision` when `loadCanvas`
   *   gave a `revision`; resolve with the new `revision`. It never carries `name`.
   * - a **metadata** save carries only `name` (a rename), `viewport` (panning is not an edit) or
   *   `legacyLayout: false`. It comes without `options`, must not be refused because of a lock or a
   *   revision, and must not move `revision`: the editor lets people rename a canvas somebody else is editing.
   *
   * Resolve with the new `updatedAt`. An adapter that ignores `options` keeps "last write wins".
   */
  saveCanvas(id: string, document: Partial<CanvasDocument>, options?: SaveCanvasOptions): Promise<{ updatedAt: string; revision?: number }>
  /** Models the user may pick. */
  listModels(): Promise<ModelSpec[]>
  /** Start an image / video run. */
  submitRun(req: RunRequest): Promise<{ runId: string }>
  /** Current state of runs, in any order. Unknown ids may be left out. */
  getRuns(ids: string[]): Promise<Run[]>
  cancelRun(id: string): Promise<void>
  /** Start a text task (LLM node, video-analysis node). */
  submitLlm(req: LlmRequest): Promise<{ taskId: string }>
  getLlm(taskId: string): Promise<LlmTask>
  /** Store a file and return its address. `url` is what ends up in the document. */
  upload(file: File | Blob, opts?: { filename?: string; onProgress?: (pct: number) => void }): Promise<UploadedFile>
  /**
   * Turn an address stored in a document into one the browser can load. The stock server stores
   * site-relative `/files/<key>` addresses; when the API lives on another origin they need its origin.
   */
  resolveFileUrl(url: string): string

  // ---- optional ----
  /**
   * Edit lock: take it (or renew it: the editor calls this again every `heartbeatMs`, and at once when
   * its tab becomes visible again), or take it over from whoever holds it with `{ takeover: true }`.
   * Reject with `code: 'canvas.locked'` (see `AdapterError`) while another editing session holds it.
   * Without this member the editor never locks.
   *
   * The lock belongs to one editor (one tab), not to one account: an adapter instance stands for one
   * editing session. `createHttpAdapter` makes up a session id per instance and sends it by itself.
   */
  acquireLock?(id: string, options?: { takeover?: boolean }): Promise<AcquireLockResult>
  /**
   * Give the lock back. Best effort; errors are ignored. `unloading: true` means the page itself is
   * going away (`pagehide`): an ordinary request may never leave the browser then, so use something
   * that does (`navigator.sendBeacon`, or `fetch` with `keepalive`) and do not wait for an answer.
   */
  releaseLock?(id: string, options?: { unloading?: boolean }): Promise<void>
  /**
   * Look at the lock without taking it. A read-only editor asks every few seconds while its tab is
   * visible, so that it can offer "Start editing" the moment the canvas is free, and follow a rename.
   * Without this member it loads the canvas again instead (`loadCanvas`), less often.
   */
  peekLock?(id: string): Promise<LockPeek>
  /**
   * Store a document as a NEW canvas and return its id. Used for "save my version as a copy" after a
   * save conflict or a lost lock; without it that choice is not offered.
   */
  createCanvas?(document: Partial<CanvasDocument>, options?: { visibility?: string }): Promise<{ id: string }>
  capabilities?(): AdapterCapabilities | Promise<AdapterCapabilities>
  /** Cost estimate for a run. Needed for `features.cost`. */
  estimate?(req: EstimateRequest): Promise<CostEstimate>
  /** Copy a remote file into storage (pasting a link). Without it remote links are used as they are. */
  importRemoteFile?(url: string): Promise<UploadedFile>
  /** Download a file the browser may not read directly (cross-origin without CORS). */
  downloadFile?(url: string, filename: string): Promise<Blob>
  /** Zip of the canvas' results. Needed for `features.batchDownload`. */
  downloadZip?(canvasId: string, urls?: string[]): Promise<Blob>
  /**
   * Server-side image tools behind the tool nodes (`slice`, `collage`, `watermark`, `fit-size`,
   * `platform-export`). Without it those node types are not offered.
   * Resolves with the tool's result object as the stock server returns it.
   */
  runTool?(tool: 'slice' | 'collage' | 'watermark' | 'fit' | 'platform-export', payload: Record<string, unknown>): Promise<unknown>
  /** Other canvases of the user. Needed for `features.canvasSwitch`. */
  listCanvases?(): Promise<{ id: string; name: string; thumbnail?: string; thumbnailType?: string; createdAt?: string; updatedAt?: string }[]>
  /** Brand kits. Needed for `features.brandKit`. Shapes follow the stock server (docs/api.md). */
  brandKits?: {
    list(): Promise<unknown[]>
    create(data: Record<string, unknown>): Promise<unknown>
    update(id: string, data: Record<string, unknown>): Promise<unknown>
    remove(id: string): Promise<unknown>
  }
  /** Templates. Needed for `features.templates`. */
  templates?: {
    listCanvasTemplates(): Promise<unknown[]>
    listTextTemplates(lang: 'zh' | 'en'): Promise<unknown>
    /** Save a group of nodes as a template of the space. Without it "save as template" is not offered. */
    createCanvasTemplate?(data: { title: string; description?: string; cover?: string; graph: Record<string, unknown> }): Promise<unknown>
    /** Delete a saved template (items the stock server marks `canDelete`). */
    removeCanvasTemplate?(key: string): Promise<unknown>
    /** Save a text snippet. Without it "new snippet" is not offered. */
    createTextTemplate?(data: { title: string; content: string; category?: string; lang?: 'zh' | 'en' }): Promise<unknown>
    removeTextTemplate?(id: string): Promise<unknown>
  }
  /** Asset library. Needed for `features.assetLibrary`. Shapes follow the stock server. */
  assets?: {
    categories(): Promise<unknown[]>
    listBuiltin(params: Record<string, unknown>): Promise<unknown>
    listMine(params: Record<string, unknown>): Promise<unknown>
    create(data: Record<string, unknown>): Promise<unknown>
    remove(id: string): Promise<unknown>
    registerOutput(data: Record<string, unknown>): Promise<unknown>
    /** Rename / move an asset. */
    update?(id: string, data: Record<string, unknown>): Promise<unknown>
  }
  /** Share links. Needed for `features.share`. */
  share?: {
    publish(data: { workflowId: string; title?: string; description?: string; expiresInDays?: number }): Promise<{ id: string; token: string; expiresAt?: string | null }>
    mine(): Promise<unknown>
    remove(id: string): Promise<unknown>
    copy(token: string, name?: string): Promise<{ workflowId: string }>
    /** Public address of a share link. Default: `<origin>/share/<token>`. */
    linkFor?(token: string): string
  }
}

export interface HttpAdapterOptions {
  /** Base of the LoomCanvas-compatible API, e.g. `/api` or `https://canvas.example.com/api`. Default `/api`. */
  apiBase?: string
  /** Headers added to every request (your own authentication). */
  getAuth?: GetAuth
  /** Called when the API answers 401. */
  onAuthRequired?: () => void
  /** Origin that serves `/files/<key>`. Default: the origin of `apiBase` (same origin when `apiBase` is relative). */
  fileBase?: string
  /** Language sent as `X-Locale`; the server words errors in it. Default: follows the UI language. */
  locale?: () => LoomCanvasLocale
  /** Request timeout in ms. Default 320000. */
  timeoutMs?: number
  /**
   * The space every request of this adapter acts in: `'personal'` (default) or a team id, sent as the
   * `X-Space` header. In a team the canvases, models, keys, assets and run records are the team's.
   */
  space?: string
}

export interface MemoryAdapterOptions {
  /** Canvases to start with, by id. Loading any other id is rejected; saving one creates it. */
  canvases?: Record<string, CanvasDocument>
  /** Models to offer. Default: one demo image model and one demo chat model. */
  models?: ModelSpec[]
  /** How long a fake run takes, in ms. Default 1200. */
  runMs?: number
  /** Produces the result of a fake run. Default: a generated SVG picture / a sample sentence. */
  resolveRun?: (req: RunRequest) => { type: 'image' | 'video'; url: string }[]
  resolveLlm?: (req: LlmRequest) => string
}

/** The memory adapter, plus a look inside for tests and demos. */
export interface MemoryAdapter extends EditorAdapter {
  /** Canvases as last saved. */
  readonly canvases: Record<string, StoredCanvas>
  /** Every `submitRun` request received. */
  readonly runRequests: RunRequest[]
}

/* ------------------------------------------------------------------ */
/* Shared options                                                       */
/* ------------------------------------------------------------------ */

export interface CommonOptions {
  /** Colour theme. Default `'dark'`. Change later with `setTheme()`. */
  theme?: LoomCanvasTheme
  /** UI language. Default: the browser's, falling back to English. Change later with `setLocale()`. */
  locale?: LoomCanvasLocale
  /** Message overrides, merged over the built-in catalogue. */
  messages?: MessageOverrides
  /**
   * Prefix of every `localStorage` / `sessionStorage` key. Default `'loomcanvas-'` (the stand-alone
   * app's keys). Use your own to keep two products on one origin apart.
   */
  storagePrefix?: string
  /**
   * Stacking order of the mount root inside the host page (`z-index` of the root; popups stay inside it).
   * Default: none (`auto`).
   */
  zIndex?: number
}

/* ------------------------------------------------------------------ */
/* Shape 1: the whole app                                               */
/* ------------------------------------------------------------------ */

/** Page names for `pages`, `navigate()` and the `route` event. */
export type LoomCanvasPage =
  | 'home' | 'canvases' | 'canvas' | 'assets' | 'brand-kits' | 'models' | 'history' | 'team' | 'settings' | 'setup' | 'share' | 'join'

export interface HostUser {
  /** Stable id of the user in your system. Default `'host'`. */
  id?: string
  /** Display name. */
  name: string
  email?: string
  /** Shown instead of the initial when given. */
  avatarUrl?: string
  /** `'owner'` shows the site-management settings sections (they call owner-only endpoints). Default `'user'`. */
  role?: 'owner' | 'user'
}

/** `brand` of `mountLoomCanvas`: your product's name and logo in the shell. */
export interface LoomCanvasBrand {
  /** Product name. Default: the site name of the server's settings, else "LoomCanvas". */
  name?: string
  /** Logo image, shown 28px tall and at most 132px wide. Default: LoomCanvas' own mark. */
  logoUrl?: string
  /**
   * Write the name next to the logo. Default `true`. `false`: the logo stands alone (a wordmark that
   * already spells the name); the name stays its text alternative. Without `logoUrl` the name is
   * always written. The same rule as the site setting "Show the site name next to the logo".
   */
  showName?: boolean
}

export interface LoomCanvasAppOptions extends CommonOptions {
  /** Base of the LoomCanvas-compatible API. Default `/api`. */
  apiBase?: string
  /** Origin that serves `/files/<key>`. Default: the origin of `apiBase`. */
  fileBase?: string
  /**
   * Your own authentication: headers added to every request. When given, LoomCanvas never shows
   * its landing, sign-in, register or password pages and stores no token; a 401 calls `onAuthRequired`.
   */
  getAuth?: GetAuth
  /** Called when the API answers 401 (only with `getAuth`). */
  onAuthRequired?: () => void
  /** The signed-in user as your system knows it; shown in the shell. Replaces the account of `/api/bootstrap`. */
  user?: HostUser
  /** Same, resolved at start-up. */
  getUser?: () => HostUser | Promise<HostUser>
  /**
   * How in-app navigation maps to the address bar.
   * `'history'`: real paths under `basePath`. `'hash'`: `#/canvases`. `'memory'`: the address bar is
   * not touched (default when embedded; use `onNavigate` / `navigate()` to sync with your router).
   */
  routerMode?: 'history' | 'hash' | 'memory'
  /** Sub-path of the host the app lives under (history / hash mode), e.g. `/tools/canvas/`. Default `/`. */
  basePath?: string
  /** Page to open first (memory mode), a page name or an in-app path. Default `'canvases'`. */
  initialPage?: LoomCanvasPage | string
  /** Called after every in-app navigation (same payload as the `route` event). */
  onNavigate?: (route: LoomCanvasAppEvents['route']) => void
  /** `'full'`: LoomCanvas' top bar and sidebar. `'none'`: page content only; you provide the navigation. Default `'full'`. */
  shell?: 'full' | 'none'
  /** Pages that exist. Everything else is unreachable and its entry points are hidden. Default: all. */
  pages?: LoomCanvasPage[]
  /** Feature switches; everything defaults to on, except `account` and `externalLinks` when `getAuth` is given. */
  features?: Partial<LoomCanvasFeatures>
  /** Node layout of generation nodes when the user has no stored preference. Default `'a'`. */
  nodeLayout?: LoomCanvasNodeLayout
  /** Product name and logo shown in the shell. `false`: no brand block. Default: the server's site settings. */
  brand?: LoomCanvasBrand | false
  /**
   * Pin the app to one space: `'personal'` or a team id. The space switcher is not shown and links into
   * other spaces are not followed. Default: the user switches between the personal space and their teams.
   */
  space?: string
}

export interface LoomCanvasAppHandle {
  /** Unmount and remove everything that was added to the page. */
  unmount(): void
  /** Go to a page (`'canvases'`, `'canvas'` with `{ id }`, ...) or to an in-app path (`'/canvas/abc'`). */
  navigate(to: LoomCanvasPage | string, params?: Record<string, string>): Promise<void>
  setTheme(theme: LoomCanvasTheme): void
  setLocale(locale: LoomCanvasLocale): void
  on<K extends keyof LoomCanvasAppEvents>(event: K, handler: (payload: LoomCanvasAppEvents[K]) => void): Unsubscribe
}

/* ------------------------------------------------------------------ */
/* Shape 2: the editor                                                  */
/* ------------------------------------------------------------------ */

export interface LoomCanvasEditorOptions extends CommonOptions {
  /** Backend of the editor. Required. */
  adapter: EditorAdapter
  /** Canvas to load through `adapter.loadCanvas`. Give either this or `document`. */
  canvasId?: string
  /**
   * A document to edit directly. Nothing is loaded or saved through the adapter; changes are
   * reported through `onChange` / the `change` event and you store them.
   */
  document?: CanvasDocument
  /** Called with the changed document (debounced). */
  onChange?: (document: CanvasDocument) => void
  /** Quiet time before a change is saved / reported, in ms. Default 1500. */
  changeDebounceMs?: number
  /** View only: no editing, no running, no saving. */
  readOnly?: boolean
  /** Layout of generation nodes. Default `'a'`. */
  nodeLayout?: LoomCanvasNodeLayout
  /** Feature switches; only the editor-chrome group defaults to on. */
  features?: Partial<LoomCanvasFeatures>
  /** Node types offered in the palette and menus. Default: every type the adapter can serve. */
  nodeTypes?: CanvasNodeType[]
  /** Called when the user presses the back button (`features.backButton`). */
  onBack?: () => void
}

export interface LoomCanvasEditorHandle {
  unmount(): void
  /** The current document (a deep copy). */
  getDocument(): CanvasDocument
  /** Replace the document. Clears the undo history. */
  setDocument(document: CanvasDocument): void
  /** Load another canvas through the adapter. */
  setCanvasId(id: string): Promise<void>
  /** Save now through the adapter (no-op in `document` mode). */
  save(): Promise<boolean>
  fitView(): void
  /** The "Run all" button: runs everything that leads to an Output node, in dependency order. Without an Output node it only shows a hint. */
  runAll(): Promise<void>
  /** Run one node, after the nodes it depends on that have no result yet. */
  runNode(nodeId: string): Promise<void>
  /** Add a node; returns its id. `position` is in canvas coordinates. */
  addNode(type: CanvasNodeType, data?: Record<string, unknown>, position?: { x: number; y: number }): string
  undo(): void
  redo(): void
  setTheme(theme: LoomCanvasTheme): void
  setLocale(locale: LoomCanvasLocale): void
  setNodeLayout(layout: LoomCanvasNodeLayout): void
  setReadOnly(readOnly: boolean): void
  on<K extends keyof LoomCanvasEditorEvents>(event: K, handler: (payload: LoomCanvasEditorEvents[K]) => void): Unsubscribe
}
