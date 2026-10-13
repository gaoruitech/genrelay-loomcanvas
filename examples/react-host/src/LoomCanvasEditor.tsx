// The LoomCanvas editor as a React component: `mountEditor` in an effect, `unmount()` in its clean-up.
//
// `loomcanvas-web/standalone/editor` has Vue inside, so a React project needs no Vue of its own.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { mountEditor } from 'loomcanvas-web/standalone/editor'
import type {
  CanvasDocument, CanvasNodeType, EditorAdapter, LoomCanvasEditorEvents, LoomCanvasEditorHandle,
  LoomCanvasFeatures, LoomCanvasLocale, LoomCanvasNodeLayout, LoomCanvasTheme,
} from 'loomcanvas-web/standalone/editor'

/** One optional handler per editor event: `{ ready, change, saved, created, 'run:started', … }`. */
export type EditorEventHandlers = { [K in keyof LoomCanvasEditorEvents]?: (payload: LoomCanvasEditorEvents[K]) => void }

const EVENTS = [
  'ready', 'change', 'saved', 'created', 'run:started', 'run:finished', 'run:failed', 'result', 'selection', 'error',
] as const satisfies readonly (keyof LoomCanvasEditorEvents)[]

export interface LoomCanvasEditorProps {
  /** Read at mount. A different adapter object mounts the editor again: keep it stable (module scope, useMemo). */
  adapter: EditorAdapter
  /**
   * Canvas to load through the adapter. Live: a new id loads that canvas in the mounted editor (`setCanvasId`).
   * `ready` is announced once per mount, not once per canvas: give the component `key={canvasId}` instead
   * when you need a "loaded" signal for every canvas.
   */
  canvasId?: string
  /** The INITIAL document (the editor is uncontrolled). Keep your own copy from `on.change`, or call `setDocument()` on the ref. */
  document?: CanvasDocument
  /** Live. */
  theme?: LoomCanvasTheme
  /** Live. */
  locale?: LoomCanvasLocale
  /** Live. */
  nodeLayout?: LoomCanvasNodeLayout
  /** Live. */
  readOnly?: boolean
  /** Read at mount. Compared by value: a different set of switches mounts the editor again. */
  features?: Partial<LoomCanvasFeatures>
  /** Read at mount. */
  changeDebounceMs?: number
  /** Read at mount. */
  storagePrefix?: string
  /** Event handlers. They may be new functions on every render: the newest ones are called, nothing is remounted. */
  on?: EditorEventHandlers
}

/** What the component ref gives you. Every method throws before the `ready` event. */
export type LoomCanvasEditorRef = Pick<
  LoomCanvasEditorHandle,
  'getDocument' | 'setDocument' | 'save' | 'fitView' | 'runAll' | 'runNode' | 'addNode' | 'undo' | 'redo'
>

export const LoomCanvasEditor = forwardRef<LoomCanvasEditorRef, LoomCanvasEditorProps>(function LoomCanvasEditor(props, ref) {
  const { adapter, canvasId, document, theme, locale, nodeLayout, readOnly, features, changeDebounceMs, storagePrefix, on } = props
  const el = useRef<HTMLDivElement>(null)
  const handle = useRef<LoomCanvasEditorHandle | null>(null)

  // The newest handlers and the newest values of the mount-time options, without making them effect dependencies.
  const handlers = useRef(on)
  handlers.current = on
  const initial = useRef({ canvasId, document })
  initial.current = { canvasId, document }

  const documentMode = !!document
  const featuresKey = JSON.stringify(features || {})

  // Mount and unmount. Runs again only when something that is read at mount changed.
  useEffect(() => {
    const editor = mountEditor(el.current!, {
      adapter,
      ...(documentMode ? { document: initial.current.document } : { canvasId: initial.current.canvasId }),
      theme,
      locale,
      nodeLayout,
      readOnly,
      features: JSON.parse(featuresKey),
      changeDebounceMs,
      storagePrefix,
    })
    for (const name of EVENTS) editor.on(name, (payload) => handlers.current?.[name]?.(payload as never))
    handle.current = editor
    // StrictMode runs this clean-up right after the first mount: `unmount()` removes everything
    // the editor added to the element, and the second mount starts from an empty element.
    return () => {
      editor.unmount()
      handle.current = null
    }
    // theme, locale, nodeLayout and readOnly are deliberately left out: the effects below update the mounted editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, documentMode, featuresKey, changeDebounceMs, storagePrefix])

  // Props that update a mounted editor.
  useEffect(() => { if (canvasId && !documentMode) void handle.current?.setCanvasId(canvasId) }, [canvasId, documentMode])
  useEffect(() => { if (theme) handle.current?.setTheme(theme) }, [theme])
  useEffect(() => { if (locale) handle.current?.setLocale(locale) }, [locale])
  useEffect(() => { if (nodeLayout) handle.current?.setNodeLayout(nodeLayout) }, [nodeLayout])
  useEffect(() => { handle.current?.setReadOnly(!!readOnly) }, [readOnly])

  useImperativeHandle(ref, () => {
    const editor = () => {
      if (!handle.current) throw new Error('The editor is not mounted')
      return handle.current
    }
    return {
      getDocument: () => editor().getDocument(),
      setDocument: (doc: CanvasDocument) => editor().setDocument(doc),
      save: () => editor().save(),
      fitView: () => editor().fitView(),
      runAll: () => editor().runAll(),
      runNode: (id: string) => editor().runNode(id),
      addNode: (type: CanvasNodeType, data?: Record<string, unknown>, position?: { x: number; y: number }) => editor().addNode(type, data, position),
      undo: () => editor().undo(),
      redo: () => editor().redo(),
    }
  }, [])

  // The editor fills this element; the parent decides the size.
  return <div ref={el} style={{ width: '100%', height: '100%' }} />
})
