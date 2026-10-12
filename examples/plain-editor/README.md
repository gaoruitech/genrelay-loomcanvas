# plain-editor: `mountEditor` with no framework and no server

Shape 2 of [docs/integration.md](../../docs/integration.md) in a plain HTML page. It uses `createMemoryAdapter`, so it proves that the editor depends on nothing but its adapter: no LoomCanvas server is contacted, runs are faked with a generated picture.

Run `node examples/serve.mjs` after `npm run build:lib` in `web/`, then open `http://127.0.0.1:4173/plain-editor/`.

What to look at in `main.js`:

- `document: sample`: the host hands the editor a document in the [public format](../../docs/integration.md#the-document-format) and gets changes back through `onChange` (debounced by `changeDebounceMs`). Nothing is loaded or saved by the editor.
- The buttons call the handle: `addNode`, `runAll`, `runNode`, `undo`, `redo`, `fitView`, `getDocument`, `setDocument`, `setReadOnly`, `setTheme`, `setLocale`, `setNodeLayout`, `unmount`.
- The palette offers no tool nodes (slice, collage, …): the memory adapter has no `runTool`, and the editor offers only what the adapter can run.
- "narrow box" shrinks the editor to 440 px.

To connect your own backend, replace the adapter. The required members are `loadCanvas`, `saveCanvas`, `listModels`, `submitRun`, `getRuns`, `cancelRun`, `submitLlm`, `getLlm`, `upload`, `resolveFileUrl`; `web/test/adapterContract.ts` is a test suite you can run against your implementation.

In React the same thing is an effect:

```jsx
import { useEffect, useRef } from 'react'
import { mountEditor, createMemoryAdapter } from 'loomcanvas-web/standalone/editor'
import 'loomcanvas-web/editor.css'

const adapter = createMemoryAdapter()

export function Canvas({ document, onChange }) {
  const el = useRef(null)
  useEffect(() => {
    const editor = mountEditor(el.current, { adapter, document, onChange })
    return () => editor.unmount()
  }, [])
  return <div ref={el} style={{ height: 640 }} />
}
```

(This React snippet has not been run by the project; the plain page above has.)
