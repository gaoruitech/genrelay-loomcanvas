/**
 * The canvas document: the public data contract of the editor.
 *
 * A document is plain JSON. It is what `EditorAdapter.loadCanvas` returns, what `saveCanvas`
 * receives, what `getDocument()` / `setDocument()` exchange, and what the stock server stores
 * (`GET /api/workflow/:id`). See docs/integration.md, "The document format".
 *
 * Versioning: `schemaVersion` is bumped whenever the shape of nodes or edges changes in a way an
 * older reader would misread. `migrateDocument()` brings any older document to the current
 * version; the editor runs it on every load, so hosts may keep documents of any past version.
 * A document with a HIGHER version than this build knows is refused instead of being damaged.
 *
 * This file imports nothing: it is safe to use in a host's backend or tests.
 */

/** Version written by this build. The stock server uses the same number (server/src/utils/workflowSchema.js). */
export const CANVAS_SCHEMA_VERSION = 3

export const CANVAS_NODE_TYPES = [
  'text', 'image', 'video', 'image-collection',
  'image-gen', 'image-edit', 'video-gen', 'video-edit', 'video-analysis', 'llm',
  'output', 'platform-export', 'slice', 'collage', 'watermark', 'fit-size', 'frame',
] as const
export type CanvasNodeType = typeof CANVAS_NODE_TYPES[number]

/** Node types whose run goes through `submitRun` (image / video models). */
export const MEDIA_RUN_NODE_TYPES: readonly CanvasNodeType[] = ['image-gen', 'image-edit', 'video-gen', 'video-edit']
/** Node types whose run goes through `submitLlm` (chat models). */
export const TEXT_RUN_NODE_TYPES: readonly CanvasNodeType[] = ['llm', 'video-analysis']
/** Node types that need `adapter.runTool` (server-side image processing). */
export const TOOL_NODE_TYPES: readonly CanvasNodeType[] = ['slice', 'collage', 'watermark', 'fit-size', 'platform-export']

/** Connection points. An edge joins an `*-out` handle to the `*-in` handle of the same data type. */
export type CanvasHandle = 'text-in' | 'text-out' | 'image-in' | 'image-out' | 'video-in' | 'video-out' | 'image-last-in' | (string & {})

export interface CanvasViewport { x: number; y: number; zoom: number }

/** Fields every runnable node may carry once it has run. Hosts should treat them as read-only. */
export interface CanvasRunState {
  /** Result image. */
  imageUrl?: string
  /** All result images when the run produced several. */
  imageUrls?: string[]
  /** Result video. */
  videoUrl?: string
  /** Result text (llm, video-analysis). */
  text?: string
  /** Backend run / task id of a run that has not finished; lets the editor resume polling after a reload. */
  taskId?: string
  taskIds?: string[]
  /** Reason of the last failed run, in the UI language of that moment. */
  errorMsg?: string
  /** Id of the failed run, used to re-fetch the reason in the current language. */
  errorRunId?: string
  [key: string]: unknown
}

/** `data` of each node type. Unknown extra keys are preserved by the editor. */
export interface CanvasNodeDataMap {
  /** A piece of text; feeds prompts. */
  text: { text: string; [key: string]: unknown }
  /** An uploaded or pasted image. */
  image: { imageUrl: string; [key: string]: unknown }
  /** An uploaded video. */
  video: { videoUrl: string; [key: string]: unknown }
  /** Several images as one input. */
  'image-collection': { imageUrls: string[]; [key: string]: unknown }
  /** Text to image. `model` is a model id from `listModels()`; the remaining keys are that model's parameters. */
  'image-gen': CanvasRunState & { prompt: string; model?: string; aspectRatio?: string; resolution?: string; count?: number; brandKitOverride?: string }
  /** Image editing by instruction. */
  'image-edit': CanvasRunState & { instruction: string; model?: string; aspectRatio?: string; resolution?: string; brandKitOverride?: string }
  /** Text / image to video. */
  'video-gen': CanvasRunState & { prompt: string; model?: string; aspectRatio?: string; resolution?: string; duration?: number; brandKitOverride?: string }
  /** Video editing. */
  'video-edit': CanvasRunState & { prompt: string; model?: string; aspectRatio?: string; brandKitOverride?: string }
  /** A chat model describing a video. The answer is in `text`. */
  'video-analysis': CanvasRunState & { text: string; model?: string; prompt?: string }
  /** A chat model. The answer is in `text`. */
  llm: CanvasRunState & { text: string; model?: string; prompt?: string; systemPrompt?: string }
  /** Collects finished results. */
  output: CanvasRunState & { imageUrl: string; videoUrl: string }
  'platform-export': CanvasRunState & { group: 'domestic' | 'overseas' }
  slice: CanvasRunState & { cols: number; rows: number }
  collage: CanvasRunState & { cols: number; rows: number; gap: number; bg: string; ratio: string }
  watermark: CanvasRunState & { markUrl: string; position: string; scalePct: number; opacity: number; marginPct: number }
  'fit-size': CanvasRunState & { ratio: string; bg: string; format: string; quality: number; maxKb: number }
  /** A group box. Children point at it through `parentNode`. */
  frame: { label: string; w: number; h: number; [key: string]: unknown }
}

export interface CanvasNode<T extends CanvasNodeType = CanvasNodeType> {
  /** Unique within the document. Any non-empty string. */
  id: string
  type: T
  /** Top-left corner in canvas coordinates; relative to the parent frame when `parentNode` is set. */
  position: { x: number; y: number }
  data: CanvasNodeDataMap[T]
  /** Id of the frame node this node sits in. */
  parentNode?: string
  extent?: 'parent' | string
  /** Measured size, written by the editor. */
  dimensions?: { width: number; height: number }
  style?: Record<string, unknown>
  selectable?: boolean
}

export interface CanvasEdge {
  id: string
  /** Always `'glow'` once written by the editor. */
  type?: string
  /** Node id the data comes from, and its `*-out` handle. */
  source: string
  sourceHandle?: CanvasHandle | null
  /** Node id the data goes to, and its `*-in` handle. */
  target: string
  targetHandle?: CanvasHandle | null
}

export interface CanvasSettings {
  /** Canvas background (colour, pattern, grid density). */
  bg?: Record<string, unknown>
  /** Node layout the positions were arranged for. Not the layout to display with. */
  nodeLayout?: 'a' | 'b' | 'c'
  [key: string]: unknown
}

export interface CanvasDocument {
  schemaVersion: number
  name: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  viewport: CanvasViewport
  settings: CanvasSettings
  /** Brand kit applied to the whole canvas; `''` for none. */
  brandKitId: string
  /**
   * Set by the version 1 -> 2 migration: node positions predate the taller generation nodes and
   * have not been checked for overlaps yet. The editor checks once and clears it.
   */
  legacyLayout?: boolean
}

export class CanvasDocumentError extends Error {
  code: 'not_an_object' | 'newer_version' | 'invalid'
  constructor(code: CanvasDocumentError['code'], message: string) {
    super(message)
    this.name = 'CanvasDocumentError'
    this.code = code
  }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

const KIT_NONE = 'none'
const KIT_NODE_TYPES = new Set<string>(MEDIA_RUN_NODE_TYPES)

/** Version 2 -> 3: brand kits moved from each generation node (`data.brandKitId`) to the canvas (`brandKitId`), nodes keep only an exception. */
function kitsToCanvas(doc: Record<string, any>): Record<string, any> {
  const nodes: any[] = Array.isArray(doc.nodes) ? doc.nodes : []
  const isGen = (n: any) => isObj(n) && KIT_NODE_TYPES.has(n.type)
  const hasOwn = (n: any) => isObj(n) && isObj(n.data) && 'brandKitId' in n.data
  const used = nodes.filter(isGen).map((n) => (hasOwn(n) && typeof n.data.brandKitId === 'string' ? n.data.brandKitId : ''))
  const shared = used.length > 0 && used[0] && used.every((id) => id === used[0]) ? used[0] : ''
  return {
    ...doc,
    brandKitId: shared,
    nodes: nodes.map((n) => {
      if (!hasOwn(n)) return n
      const { brandKitId: raw, ...data } = n.data
      const own = typeof raw === 'string' ? raw : ''
      if (isGen(n) && data.brandKitOverride === undefined && own !== shared) data.brandKitOverride = own || KIT_NONE
      return { ...n, data }
    }),
  }
}

/** version N -> the document at version N + 1. Mirrors the stock server's migrations. */
const MIGRATIONS: Record<number, (doc: Record<string, any>) => Record<string, any>> = {
  0: (doc) => doc,
  1: (doc) => ({ ...doc, legacyLayout: Array.isArray(doc.nodes) && doc.nodes.length > 1 }),
  2: kitsToCanvas,
}

/**
 * Bring any document to the current schema version and fill in what is missing.
 * Never mutates its argument. Throws `CanvasDocumentError` when the input is not a document or
 * was written by a newer version.
 */
export function migrateDocument(input: unknown): CanvasDocument {
  if (!isObj(input)) throw new CanvasDocumentError('not_an_object', 'A canvas document must be an object')
  let version = Number.isInteger(input.schemaVersion) && input.schemaVersion >= 0 ? (input.schemaVersion as number) : 0
  if (version > CANVAS_SCHEMA_VERSION) {
    throw new CanvasDocumentError('newer_version', `Canvas document version ${version} is newer than this editor understands (${CANVAS_SCHEMA_VERSION})`)
  }
  let doc: Record<string, any> = { ...input }
  while (version < CANVAS_SCHEMA_VERSION) {
    doc = MIGRATIONS[version](doc)
    version += 1
  }
  const vp = isObj(doc.viewport) ? doc.viewport : {}
  const num = (v: unknown, dft: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dft)
  const nodes = (Array.isArray(doc.nodes) ? doc.nodes : []).filter((n: any) => isObj(n) && typeof n.id === 'string' && n.id && typeof n.type === 'string')
  const ids = new Set(nodes.map((n: any) => n.id))
  if (ids.size !== nodes.length) throw new CanvasDocumentError('invalid', 'Node ids must be unique')
  const out: CanvasDocument = {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    name: typeof doc.name === 'string' ? doc.name : '',
    nodes: nodes.map((n: any) => ({
      ...n,
      position: { x: num(n.position?.x, 0), y: num(n.position?.y, 0) },
      data: isObj(n.data) ? n.data : {},
    })),
    // An edge whose end is gone cannot be drawn; drop it rather than fail the whole document.
    edges: (Array.isArray(doc.edges) ? doc.edges : []).filter((e: any) => isObj(e) && ids.has(e.source) && ids.has(e.target)),
    viewport: { x: num(vp.x, 0), y: num(vp.y, 0), zoom: Math.min(10, Math.max(0.01, num(vp.zoom, 1))) },
    settings: isObj(doc.settings) ? doc.settings : {},
    brandKitId: typeof doc.brandKitId === 'string' ? doc.brandKitId : '',
  }
  if (doc.legacyLayout) out.legacyLayout = true
  return out
}

/** An empty document at the current version. */
export function createEmptyDocument(name = ''): CanvasDocument {
  return { schemaVersion: CANVAS_SCHEMA_VERSION, name, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, brandKitId: '' }
}
