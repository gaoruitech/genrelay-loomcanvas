/**
 * Per-instance context: what one mounted view (the stand-alone app, an embedded app, an embedded
 * editor) knows about how it was mounted. Provided on the Vue app; components read it with
 * `useEmbed()`. Code outside components uses `currentEmbed()` (the instance mounted / used last).
 *
 * Internal module: not part of the public API.
 */
import { hasInjectionContext, inject, reactive, ref, shallowRef, type InjectionKey, type Ref, type ShallowRef } from 'vue'
import type {
  HostUser, LoomCanvasFeatures, LoomCanvasNodeLayout, LoomCanvasPage, CanvasDocument, CanvasNodeType,
} from './types'
import { resolveFeatures, type FeatureMode } from './options'
import { CANVAS_NODE_TYPES } from './document'

/** What Canvas.vue hands back so the entry can offer imperative methods. */
export interface EditorApi {
  getDocument(): CanvasDocument
  setDocument(doc: CanvasDocument): void
  save(): Promise<boolean>
  fitView(): void
  runAll(): Promise<void>
  runNode(id: string): Promise<void>
  addNode(type: CanvasNodeType, data?: Record<string, unknown>, position?: { x: number; y: number }): string
  undo(): void
  redo(): void
}

/** Only in the editor entry: the canvas is driven by options instead of the router. */
export interface EditorHost {
  canvasId: Ref<string>
  readOnly: Ref<boolean>
  nodeLayout: Ref<LoomCanvasNodeLayout>
  nodeTypes: Ref<CanvasNodeType[]>
  /** Quiet time before a change is saved, ms. */
  changeDebounceMs: number
  onBack: (() => void) | null
  api: ShallowRef<EditorApi | null>
}

export interface EmbedContext {
  mode: FeatureMode
  embedded: boolean
  /** The element carrying `.lc-root` and the theme attributes (`<html>` in the stand-alone app). */
  root: HTMLElement
  /** Teleport / popup target: 'body' in the stand-alone app, a layer inside the root when embedded. */
  portal: HTMLElement | 'body'
  shell: 'full' | 'none'
  /** The host signs users in; LoomCanvas' own account pages do not exist. */
  hostAuth: boolean
  hostUser: HostUser | null
  /** null: every page. */
  pages: Set<LoomCanvasPage> | null
  /** The host pinned the app to one space: 'personal' or a team id. null: the user switches. */
  space: string | null
  features: LoomCanvasFeatures
  /** undefined: follow the server's site settings; false: no brand block. `showName: false`: a logo that stands alone. */
  brand: { name?: string; logoUrl?: string; showName?: boolean } | false | undefined
  defaultNodeLayout: LoomCanvasNodeLayout
  /** The host passed `theme` / `locale`: account and site defaults must not override them. */
  themeControlled: boolean
  localeControlled: boolean
  /**
   * How in-app navigation shows in the address bar. `'memory'`: not at all, so an in-app address
   * means nothing to the browser: a link cannot be opened in a new tab, it has to navigate in place.
   */
  routerMode: 'history' | 'hash' | 'memory'
  emit(event: string, payload: unknown): void
  editor: EditorHost | null
}

export const EMBED_KEY: InjectionKey<EmbedContext> = Symbol('lc-embed')

export function createEmbedContext(over: Partial<EmbedContext> = {}): EmbedContext {
  const mode = over.mode || 'standalone'
  return {
    mode,
    embedded: mode !== 'standalone',
    root: typeof document !== 'undefined' ? document.documentElement : (null as unknown as HTMLElement),
    portal: 'body',
    shell: 'full',
    hostAuth: false,
    hostUser: null,
    pages: null,
    space: null,
    features: reactive(resolveFeatures(undefined, { mode })),
    brand: undefined,
    defaultNodeLayout: 'a',
    themeControlled: false,
    localeControlled: false,
    routerMode: mode === 'editor' ? 'memory' : 'history',
    emit: () => undefined,
    editor: null,
    ...over,
  }
}

export function createEditorHost(over: Partial<EditorHost> = {}): EditorHost {
  return {
    canvasId: ref(''),
    readOnly: ref(false),
    nodeLayout: ref<LoomCanvasNodeLayout>('a'),
    nodeTypes: ref([...CANVAS_NODE_TYPES]) as Ref<CanvasNodeType[]>,
    changeDebounceMs: 1500,
    onBack: null,
    api: shallowRef(null),
    ...over,
  }
}

let standalone: EmbedContext | null = null
let current: EmbedContext | null = null

/** The context of the stand-alone app; also what a component sees when nothing was provided. */
function standaloneContext(): EmbedContext {
  return (standalone ||= createEmbedContext())
}

export function setCurrentEmbed(ctx: EmbedContext | null): void {
  current = ctx
}

/** For code outside components. */
export function currentEmbed(): EmbedContext {
  return current || standaloneContext()
}

/** For components and stores (call during setup); falls back to the current instance elsewhere. */
export function useEmbed(): EmbedContext {
  return (hasInjectionContext() ? inject(EMBED_KEY, null) : null) || currentEmbed()
}
