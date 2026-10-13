import { CANVAS_SCHEMA_VERSION } from 'loomcanvas-web/standalone/editor'
import type { CanvasDocument } from 'loomcanvas-web/standalone/editor'

/** A document in the public format (docs/integration.md, "The document format"). */
export const sample: CanvasDocument = {
  schemaVersion: CANVAS_SCHEMA_VERSION,
  name: 'Sample from the React host',
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
