// The smallest React integration: the snippet printed in docs/integration.md ("React"), as a file that runs.
import { useEffect, useRef } from 'react'
import { mountEditor, createMemoryAdapter } from 'loomcanvas-web/standalone/editor'
import type { CanvasDocument } from 'loomcanvas-web/standalone/editor'
import 'loomcanvas-web/editor.css'

// Outside the component: one adapter object for the whole life of the page.
const adapter = createMemoryAdapter()

export function Canvas({ document, onChange }: { document: CanvasDocument; onChange: (doc: CanvasDocument) => void }) {
  const el = useRef<HTMLDivElement>(null)
  // The newest props, without making them dependencies of the effect.
  const latest = useRef({ document, onChange })
  latest.current = { document, onChange }

  useEffect(() => {
    const editor = mountEditor(el.current!, {
      adapter,
      // The INITIAL document: the editor is uncontrolled, changes come back through onChange.
      document: latest.current.document,
      onChange: (doc) => latest.current.onChange(doc),
    })
    // unmount() removes everything the editor added, so React's StrictMode (mount, unmount, mount) is fine.
    return () => editor.unmount()
  }, [])

  // The editor fills this element: give it a size.
  return <div ref={el} style={{ height: 640 }} />
}
