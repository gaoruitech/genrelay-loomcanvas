// The custom element `<loom-canvas-editor>` used from JSX.
//
// - `options` is a PROPERTY (an object, it cannot be an attribute): set it through a ref.
// - `canvas-id`, `theme`, `locale`, `node-layout`, `read-only` are attributes and update a mounted editor.
// - Events are DOM CustomEvents (`ready`, `change`, `run:started`, …) with the payload in `detail`;
//   they do not bubble, so listen on the element itself.
// - The handle is the element's `editor` property.
import { useEffect, useRef, type Ref } from 'react'
import { defineLoomCanvasEditorElement } from 'loomcanvas-web/standalone/editor'
import type {
  LoomCanvasEditorEvents, LoomCanvasEditorHandle, LoomCanvasEditorOptions, LoomCanvasLocale, LoomCanvasNodeLayout, LoomCanvasTheme,
} from 'loomcanvas-web/standalone/editor'
import type { EditorEventHandlers } from './LoomCanvasEditor'

/** The element as TypeScript should see it. */
export interface LoomCanvasEditorElement extends HTMLElement {
  /** Setting it mounts the editor (again); `null` unmounts it. */
  options: LoomCanvasEditorOptions | null
  /** The handle of the mounted editor. */
  readonly editor: LoomCanvasEditorHandle | null
}

// Teach JSX the tag and its attributes.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'loom-canvas-editor': DetailedHTMLProps<HTMLAttributes<LoomCanvasEditorElement>, LoomCanvasEditorElement> & {
        'canvas-id'?: string
        theme?: LoomCanvasTheme
        locale?: LoomCanvasLocale
        'node-layout'?: LoomCanvasNodeLayout
        /** Present (`''`) = read-only; leave it out (`undefined`) for an editable canvas. */
        'read-only'?: '' | 'true' | 'false'
      }
    }
  }
}

// Once per page. A second call is a no-op.
defineLoomCanvasEditorElement()

const EVENTS = [
  'ready', 'change', 'saved', 'created', 'run:started', 'run:finished', 'run:failed', 'result', 'selection', 'error',
] as const satisfies readonly (keyof LoomCanvasEditorEvents)[]

export interface LoomCanvasElementProps {
  /**
   * Everything that is read at mount (adapter, document or canvasId, features, …). A NEW object mounts
   * the editor again, so keep it stable with useMemo. Leave theme, locale, nodeLayout and readOnly out
   * of it: what is in `options` wins over the attributes when the editor mounts.
   */
  options: LoomCanvasEditorOptions
  theme?: LoomCanvasTheme
  locale?: LoomCanvasLocale
  nodeLayout?: LoomCanvasNodeLayout
  readOnly?: boolean
  on?: EditorEventHandlers
  /** The element itself, e.g. for `elementRef.current.editor.addNode(…)`. */
  elementRef?: Ref<LoomCanvasEditorElement>
}

export function LoomCanvasElement({ options, theme, locale, nodeLayout, readOnly, on, elementRef }: LoomCanvasElementProps) {
  const el = useRef<LoomCanvasEditorElement | null>(null)
  const handlers = useRef(on)
  handlers.current = on

  // Events: plain DOM listeners.
  useEffect(() => {
    const node = el.current!
    const off = EVENTS.map((name) => {
      const listener = (e: Event) => handlers.current?.[name]?.((e as CustomEvent).detail as never)
      node.addEventListener(name, listener)
      return () => node.removeEventListener(name, listener)
    })
    return () => off.forEach((fn) => fn())
  }, [])

  // The property. Clearing it in the clean-up unmounts the editor (StrictMode, a new `options` object, leaving the page).
  useEffect(() => {
    const node = el.current!
    node.options = options
    return () => { node.options = null }
  }, [options])

  return (
    <loom-canvas-editor
      ref={(node) => {
        el.current = node
        if (typeof elementRef === 'function') elementRef(node)
        else if (elementRef) elementRef.current = node
      }}
      theme={theme}
      locale={locale}
      node-layout={nodeLayout}
      read-only={readOnly ? '' : undefined}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  )
}
