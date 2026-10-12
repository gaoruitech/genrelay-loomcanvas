// A host without any framework. `standalone/editor.js` has Vue inside: one import is all it takes.
// The editor never touches the network here: the memory adapter keeps canvases in memory and
// "finishes" runs with a generated picture. Replace it with your own adapter to reach your backend.
import { mountEditor, createMemoryAdapter, CANVAS_SCHEMA_VERSION } from '/lib/standalone/editor.js'

const $ = (id) => document.getElementById(id)
const log = (line) => { const el = $('log'); el.textContent += line + '\n'; el.scrollTop = el.scrollHeight }

/** A document in the public format (docs/integration.md, "The document format"). */
const sample = {
  schemaVersion: CANVAS_SCHEMA_VERSION,
  name: 'Sample from the host',
  nodes: [
    { id: 'prompt', type: 'text', position: { x: 40, y: 80 }, data: { text: 'a lighthouse at dusk, oil painting' } },
    { id: 'picture', type: 'image-gen', position: { x: 420, y: 60 }, data: { prompt: '', model: 'demo:image', aspectRatio: '16:9' } },
    // "Run all" runs what leads to an Output node.
    { id: 'result', type: 'output', position: { x: 800, y: 60 }, data: { imageUrl: '', videoUrl: '' } },
  ],
  edges: [
    { id: 'e1', source: 'prompt', sourceHandle: 'text-out', target: 'picture', targetHandle: 'text-in' },
    { id: 'e2', source: 'picture', sourceHandle: 'image-out', target: 'result', targetHandle: 'image-in' },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  settings: {},
  brandKitId: '',
}

const adapter = createMemoryAdapter({ runMs: 1500 })
let readOnly = false
let editor = null

function mount() {
  editor = mountEditor($('editor'), {
    adapter,
    // Edit a document directly: nothing is loaded or saved by the editor, changes come back here.
    document: sample,
    onChange: (doc) => log(`onChange: ${doc.nodes.length} nodes, ${doc.edges.length} edges`),
    changeDebounceMs: 600,
    theme: $('theme').value,
    locale: $('locale').value,
    nodeLayout: $('layout').value,
    readOnly,
    storagePrefix: 'plain-host-',
  })
  for (const name of ['ready', 'saved', 'run:started', 'run:finished', 'run:failed', 'result', 'selection', 'error']) {
    editor.on(name, (payload) => log(`${name} ${JSON.stringify(payload).slice(0, 150)}`))
  }
  window.host = { editor, adapter }
}
mount()

$('add-text').onclick = () => log(`addNode -> ${editor.addNode('text', { text: 'hello from the host' })}`)
$('add-gen').onclick = () => log(`addNode -> ${editor.addNode('image-gen', { prompt: 'a paper boat' }, { x: 420, y: 420 })}`)
$('run').onclick = () => editor.runAll()
$('run-node').onclick = () => editor.runNode('picture')
$('undo').onclick = () => editor.undo()
$('redo').onclick = () => editor.redo()
$('fit').onclick = () => editor.fitView()
$('get').onclick = () => { const d = editor.getDocument(); log(`getDocument -> v${d.schemaVersion} "${d.name}", nodes: ${d.nodes.map((n) => n.type).join(', ')}`) }
$('set').onclick = () => editor.setDocument(sample)
$('readonly').onclick = () => { readOnly = !readOnly; editor.setReadOnly(readOnly); $('readonly').textContent = `readOnly: ${readOnly ? 'on' : 'off'}` }
$('narrow').onclick = () => $('editor').classList.toggle('narrow')
$('theme').onchange = (e) => editor.setTheme(e.target.value)
$('locale').onchange = (e) => editor.setLocale(e.target.value)
$('layout').onchange = (e) => editor.setNodeLayout(e.target.value)
$('remount').onclick = () => { editor.unmount(); mount(); log('remounted') }
