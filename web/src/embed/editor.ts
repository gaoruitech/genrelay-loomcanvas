/**
 * Integration entry 2: only the canvas editor.
 *
 *   import { mountEditor, createHttpAdapter } from 'loomcanvas-web/editor'
 *   import 'loomcanvas-web/editor.css'
 *
 *   const editor = mountEditor(document.getElementById('editor')!, {
 *     adapter: createHttpAdapter({ apiBase: '/api', getAuth: () => ({ Authorization: `Bearer ${token}` }) }),
 *     canvasId: 'abc',
 *   })
 *
 * A Vue host can use the `<LoomCanvasEditor>` component instead; any page can use the
 * `<loom-canvas-editor>` custom element after calling `defineLoomCanvasEditorElement()`.
 * See docs/integration.md. Everything exported here is public API.
 */
import './styles'
import {
  createApp, defineComponent, h, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, type PropType,
} from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import Canvas from '@/views/Canvas.vue'
import EditorRoot from './EditorRoot.vue'
import { configureRuntime, runtime } from './runtime'
import { createEditorHost, createEmbedContext } from './context'
import { applyCommonOptions, createEmitter, createMountRoot, hostSetTheme, installCommon } from './mount'
import { EDITOR_EVENT_KEYS, resolveFeatures, resolveNodeTypes, validateAdapter } from './options'
import { createEmptyDocument, migrateDocument, type CanvasDocument } from './document'
import { useAppStore } from '@/stores/app'
import { loadModels } from '@/utils/canvasModels'
import { loadBackendCapabilities } from '@/utils/canvasBackend'
import { normalizeLocale } from '@/locales'
import { normalizeNodeLayout } from '@/composables/nodeLayout'
import type {
  EditorAdapter, LoomCanvasEditorEvents, LoomCanvasEditorHandle, LoomCanvasEditorOptions, LoomCanvasFeatures,
  LoomCanvasLocale, LoomCanvasNodeLayout, LoomCanvasTheme, MessageOverrides, StoredCanvas, CanvasNodeType,
} from './types'

export type * from './types'
export {
  CANVAS_SCHEMA_VERSION, CANVAS_NODE_TYPES, MEDIA_RUN_NODE_TYPES, TEXT_RUN_NODE_TYPES, TOOL_NODE_TYPES,
  migrateDocument, createEmptyDocument, CanvasDocumentError,
} from './document'
export { createHttpAdapter } from './httpAdapter'
export { createMemoryAdapter } from './memoryAdapter'

/** Version of the integration API (the package version). */
export const VERSION: string = __LC_VERSION__

/** Id the editor uses for a document that was passed in directly (`document` option). */
const LOCAL_ID = 'local'

/**
 * `document` mode: the host owns storage. Loading returns the document it gave us, saving goes
 * nowhere (the host hears about changes through `change` / `onChange`); everything else is the
 * host's adapter untouched.
 */
function withLocalDocument(adapter: EditorAdapter, state: { doc: CanvasDocument; updatedAt: string }): EditorAdapter {
  const local: Pick<EditorAdapter, 'loadCanvas' | 'saveCanvas'> = {
    async loadCanvas(id): Promise<StoredCanvas> {
      return { id, document: JSON.parse(JSON.stringify(state.doc)), updatedAt: state.updatedAt }
    },
    async saveCanvas(_id, patch) {
      const { legacyLayout, ...rest } = patch
      state.doc = { ...state.doc, ...JSON.parse(JSON.stringify(rest)) }
      if (legacyLayout === false) delete state.doc.legacyLayout
      if (Object.keys(rest).some((k) => k !== 'viewport')) state.updatedAt = new Date().toISOString()
      return { updatedAt: state.updatedAt }
    },
  }
  // A proxy rather than a spread: the host's adapter may be a class instance with prototype methods.
  return new Proxy(adapter, {
    get(target, key, receiver) {
      if (key === 'loadCanvas' || key === 'saveCanvas') return local[key]
      const v = Reflect.get(target, key, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}

export function mountEditor(el: HTMLElement, options: LoomCanvasEditorOptions): LoomCanvasEditorHandle {
  if (!options || typeof options !== 'object') throw new TypeError('LoomCanvas: mountEditor(el, options) needs options')
  validateAdapter(options.adapter)
  if (runtime.adapter && runtime.roots.size > 0 && runtime.adapter !== options.adapter) {
    console.warn('[loomcanvas] another LoomCanvas view on this page uses a different adapter. One page shares one adapter: the one passed last is now used by all of them.')
  }

  configureRuntime({ storagePrefix: options.storagePrefix })
  const emitter = createEmitter()
  const mount = createMountRoot(el, 'editor', options)
  applyCommonOptions(options)

  const documentMode = !!options.document
  const local = { doc: documentMode ? migrateDocument(options.document) : createEmptyDocument(), updatedAt: new Date().toISOString() }
  const adapter = documentMode ? withLocalDocument(options.adapter, local) : options.adapter
  runtime.adapter = adapter

  const host = createEditorHost({
    canvasId: ref(documentMode ? LOCAL_ID : String(options.canvasId || '')),
    readOnly: ref(!!options.readOnly),
    nodeLayout: ref(normalizeNodeLayout(options.nodeLayout)),
    nodeTypes: ref(resolveNodeTypes(options.nodeTypes, options.adapter)),
    changeDebounceMs: Math.max(0, Number(options.changeDebounceMs ?? 1500) || 0),
    onBack: options.onBack || null,
    api: shallowRef(null),
  })
  const features = reactive(resolveFeatures(
    { ...options.features, ...(options.onBack && options.features?.backButton === undefined ? { backButton: true } : {}) },
    { mode: 'editor', adapter: options.adapter },
  ))
  const ctx = createEmbedContext({
    mode: 'editor',
    embedded: true,
    root: mount.root,
    portal: mount.portal,
    shell: 'none',
    hostAuth: true,
    features,
    defaultNodeLayout: host.nodeLayout.value,
    themeControlled: true,
    localeControlled: true,
    editor: host,
    emit: (event, payload) => {
      if (!(EDITOR_EVENT_KEYS as readonly string[]).includes(event)) return
      // `document` mode stores nothing through the adapter: there is no "saved", only "change".
      if (documentMode && event === 'saved') return
      if (event === 'change') options.onChange?.((payload as LoomCanvasEditorEvents['change']).document)
      emitter.emit(event, payload)
    },
  })

  const app = createApp(EditorRoot)
  // vue-i18n wraps app.unmount to dispose the (page-wide) i18n instance; keep the original.
  const rawUnmount = app.unmount.bind(app)
  const pinia = createPinia()
  app.use(pinia)
  installCommon(app, ctx)
  const store = useAppStore(pinia)
  const locale = normalizeLocale(options.locale)
  if (locale) store.setLocale(locale, false)
  // The editor is one screen; the router exists so that components written for the app
  // (links, leave guards) keep working. The address bar is never touched.
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:all(.*)*', name: 'canvas', component: Canvas }] })
  app.use(router)

  let alive = true
  // Models and backend limits first: a node created before the model list arrives would have no default model.
  const ready = Promise.all([
    loadModels().catch((err) => emitter.emit('error', { scope: 'adapter', message: err?.message || 'listModels failed', cause: err })),
    loadBackendCapabilities(),
    router.replace('/'),
  ]).then(() => { if (alive) app.mount(mount.appEl) })

  const api = () => {
    const a = host.api.value
    if (!a) throw new Error('LoomCanvas: the editor is not ready yet (wait for the "ready" event)')
    return a
  }

  return {
    unmount() {
      if (!alive) return
      alive = false
      try { rawUnmount() } finally {
        mount.destroy()
        emitter.clear()
        if (runtime.adapter === adapter && runtime.roots.size === 0) runtime.adapter = null
      }
    },
    getDocument: () => api().getDocument(),
    setDocument(doc) {
      const next = migrateDocument(doc)
      if (documentMode) { local.doc = next; local.updatedAt = new Date().toISOString() }
      api().setDocument(next)
    },
    async setCanvasId(id) {
      if (documentMode) throw new Error('LoomCanvas: this editor was mounted with `document`; use setDocument()')
      await ready
      host.canvasId.value = String(id)
    },
    save: () => api().save(),
    fitView: () => api().fitView(),
    runAll: () => api().runAll(),
    runNode: (id) => api().runNode(id),
    addNode: (type, data, position) => api().addNode(type, data, position),
    undo: () => api().undo(),
    redo: () => api().redo(),
    setTheme(theme) { hostSetTheme(theme) },
    setLocale(code) {
      const next = normalizeLocale(code)
      if (next) store.setLocale(next, false)
    },
    setNodeLayout(layout) { host.nodeLayout.value = normalizeNodeLayout(layout) },
    setReadOnly(v) { host.readOnly.value = !!v },
    on(event, handler) { return emitter.on(event, handler as any) },
  }
}

/* ------------------------------------------------------------------ */
/* Vue component                                                        */
/* ------------------------------------------------------------------ */

/**
 * `<LoomCanvasEditor>` for Vue 3 hosts. A thin wrapper around `mountEditor`: the editor runs as its
 * own Vue application inside the element, so it needs nothing installed on the host app (no Pinia,
 * no vue-i18n, no router) and cannot clash with the host's.
 *
 * Reactive props: `canvasId`, `theme`, `locale`, `nodeLayout`, `readOnly`. The others are read once
 * at mount; change `:key` to remount with new ones. `document` is the INITIAL document (uncontrolled):
 * listen to `change` and keep your own copy, or call `setDocument()` on the exposed handle.
 */
export const LoomCanvasEditor = defineComponent({
  name: 'LoomCanvasEditor',
  props: {
    adapter: { type: Object as PropType<EditorAdapter>, required: true },
    canvasId: { type: String, default: undefined },
    document: { type: Object as PropType<CanvasDocument>, default: undefined },
    readOnly: { type: Boolean, default: false },
    theme: { type: String as PropType<LoomCanvasTheme>, default: undefined },
    locale: { type: String as PropType<LoomCanvasLocale>, default: undefined },
    nodeLayout: { type: String as PropType<LoomCanvasNodeLayout>, default: undefined },
    features: { type: Object as PropType<Partial<LoomCanvasFeatures>>, default: undefined },
    nodeTypes: { type: Array as PropType<CanvasNodeType[]>, default: undefined },
    messages: { type: Object as PropType<MessageOverrides>, default: undefined },
    storagePrefix: { type: String, default: undefined },
    changeDebounceMs: { type: Number, default: undefined },
    zIndex: { type: Number, default: undefined },
    /** Shows the back button and is called when it is pressed. */
    onBack: { type: Function as PropType<() => void>, default: undefined },
  },
  emits: {
    ready: (_p: LoomCanvasEditorEvents['ready']) => true,
    change: (_p: LoomCanvasEditorEvents['change']) => true,
    saved: (_p: LoomCanvasEditorEvents['saved']) => true,
    'run:started': (_p: LoomCanvasEditorEvents['run:started']) => true,
    'run:finished': (_p: LoomCanvasEditorEvents['run:finished']) => true,
    'run:failed': (_p: LoomCanvasEditorEvents['run:failed']) => true,
    result: (_p: LoomCanvasEditorEvents['result']) => true,
    selection: (_p: LoomCanvasEditorEvents['selection']) => true,
    error: (_p: LoomCanvasEditorEvents['error']) => true,
  },
  setup(props, { emit, expose }) {
    const el = ref<HTMLElement | null>(null)
    const handle = shallowRef<LoomCanvasEditorHandle | null>(null)
    onMounted(() => {
      const h2 = mountEditor(el.value!, {
        adapter: props.adapter,
        canvasId: props.canvasId,
        document: props.document,
        readOnly: props.readOnly,
        theme: props.theme,
        locale: props.locale,
        nodeLayout: props.nodeLayout,
        features: props.features,
        nodeTypes: props.nodeTypes,
        messages: props.messages,
        storagePrefix: props.storagePrefix,
        changeDebounceMs: props.changeDebounceMs,
        zIndex: props.zIndex,
        onBack: props.onBack,
      })
      for (const name of EDITOR_EVENT_KEYS) h2.on(name, (payload) => emit(name as any, payload as any))
      handle.value = h2
    })
    onBeforeUnmount(() => { handle.value?.unmount(); handle.value = null })
    watch(() => props.canvasId, (id) => { if (id && !props.document) void handle.value?.setCanvasId(id) })
    watch(() => props.theme, (v) => { if (v) handle.value?.setTheme(v) })
    watch(() => props.locale, (v) => { if (v) handle.value?.setLocale(v) })
    watch(() => props.nodeLayout, (v) => { if (v) handle.value?.setNodeLayout(v) })
    watch(() => props.readOnly, (v) => handle.value?.setReadOnly(v))
    // The imperative methods, for `ref="editor"` in the host: editor.value.getDocument() ...
    expose({
      getDocument: () => handle.value!.getDocument(),
      setDocument: (doc: CanvasDocument) => handle.value!.setDocument(doc),
      save: () => handle.value!.save(),
      fitView: () => handle.value!.fitView(),
      runAll: () => handle.value!.runAll(),
      runNode: (id: string) => handle.value!.runNode(id),
      addNode: (type: CanvasNodeType, data?: Record<string, unknown>, position?: { x: number; y: number }) => handle.value!.addNode(type, data, position),
      undo: () => handle.value!.undo(),
      redo: () => handle.value!.redo(),
      handle,
    })
    // The wrapper fills its parent; the parent decides the size.
    return () => h('div', { ref: el, class: 'lc-editor-host', style: { width: '100%', height: '100%' } })
  },
})

/* ------------------------------------------------------------------ */
/* Custom element                                                       */
/* ------------------------------------------------------------------ */

/**
 * Registers `<loom-canvas-editor>` (light DOM, no shadow root: the stylesheet of the page applies).
 * Set the `options` PROPERTY (not an attribute) to mount; the attributes `canvas-id`, `theme`,
 * `locale`, `node-layout` and `read-only` update a mounted editor. Events are DOM CustomEvents with
 * the same names and the payload in `detail`. The handle is on the `editor` property.
 */
export function defineLoomCanvasEditorElement(tag = 'loom-canvas-editor'): void {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return
  class LoomCanvasEditorElement extends HTMLElement {
    static observedAttributes = ['canvas-id', 'theme', 'locale', 'node-layout', 'read-only']
    editor: LoomCanvasEditorHandle | null = null
    private _options: LoomCanvasEditorOptions | null = null

    get options() { return this._options }
    set options(v: LoomCanvasEditorOptions | null) {
      this._options = v
      if (this.isConnected) this.remount()
    }
    connectedCallback() {
      if (!this.style.display) this.style.display = 'block'
      this.remount()
    }
    disconnectedCallback() { this.editor?.unmount(); this.editor = null }
    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
      const ed = this.editor
      if (!ed) return
      if (name === 'canvas-id' && value) void ed.setCanvasId(value)
      else if (name === 'theme' && value) ed.setTheme(value as LoomCanvasTheme)
      else if (name === 'locale' && value) ed.setLocale(value as LoomCanvasLocale)
      else if (name === 'node-layout' && value) ed.setNodeLayout(value as LoomCanvasNodeLayout)
      else if (name === 'read-only') ed.setReadOnly(value !== null && value !== 'false')
    }
    private remount() {
      this.editor?.unmount()
      this.editor = null
      const o = this._options
      if (!o) return
      const attr = (n: string) => this.getAttribute(n) || undefined
      const ed = mountEditor(this, {
        ...o,
        canvasId: o.canvasId ?? attr('canvas-id'),
        theme: o.theme ?? (attr('theme') as LoomCanvasTheme | undefined),
        locale: o.locale ?? (attr('locale') as LoomCanvasLocale | undefined),
        nodeLayout: o.nodeLayout ?? (attr('node-layout') as LoomCanvasNodeLayout | undefined),
        readOnly: o.readOnly ?? (this.hasAttribute('read-only') && this.getAttribute('read-only') !== 'false'),
      })
      for (const name of EDITOR_EVENT_KEYS) ed.on(name, (detail) => this.dispatchEvent(new CustomEvent(name, { detail })))
      this.editor = ed
    }
  }
  customElements.define(tag, LoomCanvasEditorElement)
}
