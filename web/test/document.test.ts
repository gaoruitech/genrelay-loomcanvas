// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CANVAS_SCHEMA_VERSION, CANVAS_NODE_TYPES, CanvasDocumentError, createEmptyDocument, migrateDocument,
} from '../src/embed/document'

describe('canvas document', () => {
  it('the schema version matches the stock server', async () => {
    const { createRequire } = await import('node:module')
    const server = createRequire(import.meta.url)('../../server/src/utils/workflowSchema.js')
    expect(CANVAS_SCHEMA_VERSION).toBe(server.CURRENT_SCHEMA_VERSION)
  })

  it('an empty document is current and passes through unchanged', () => {
    const doc = createEmptyDocument('A')
    expect(doc.schemaVersion).toBe(CANVAS_SCHEMA_VERSION)
    expect(migrateDocument(doc)).toEqual(doc)
  })

  it('fills in what an unversioned document lacks, without touching the input', () => {
    const input = { name: 'Old', nodes: [{ id: 'a', type: 'text', data: { text: 'x' } }] }
    const frozen = JSON.stringify(input)
    const doc = migrateDocument(input)
    expect(JSON.stringify(input)).toBe(frozen)
    expect(doc).toMatchObject({
      schemaVersion: CANVAS_SCHEMA_VERSION, name: 'Old', edges: [], viewport: { x: 0, y: 0, zoom: 1 }, settings: {}, brandKitId: '',
    })
    expect(doc.nodes[0].position).toEqual({ x: 0, y: 0 })
  })

  it('version 1 -> 2 flags an old layout only when there is something to overlap', () => {
    const two = { schemaVersion: 1, nodes: [{ id: 'a', type: 'text', position: { x: 0, y: 0 }, data: {} }, { id: 'b', type: 'text', position: { x: 0, y: 0 }, data: {} }] }
    expect(migrateDocument(two).legacyLayout).toBe(true)
    expect(migrateDocument({ schemaVersion: 1, nodes: [two.nodes[0]] }).legacyLayout).toBeUndefined()
  })

  it('version 2 -> 3 moves a shared brand kit to the canvas', () => {
    const gen = (id: string, kit?: string) => ({ id, type: 'image-gen', position: { x: 0, y: 0 }, data: { prompt: '', ...(kit === undefined ? {} : { brandKitId: kit }) } })
    const shared = migrateDocument({ schemaVersion: 2, nodes: [gen('a', 'k1'), gen('b', 'k1')] })
    expect(shared.brandKitId).toBe('k1')
    expect(shared.nodes.every((n) => !('brandKitId' in n.data) && !('brandKitOverride' in n.data))).toBe(true)

    const mixed = migrateDocument({ schemaVersion: 2, nodes: [gen('a', 'k1'), gen('b', ''), gen('c')] })
    expect(mixed.brandKitId).toBe('')
    expect(mixed.nodes.map((n) => (n.data as any).brandKitOverride)).toEqual(['k1', undefined, undefined])
  })

  it('agrees with the stock server on the version 2 -> 3 migration', async () => {
    const { createRequire } = await import('node:module')
    const server = createRequire(import.meta.url)('../../server/src/utils/workflowSchema.js')
    const gen = (id: string, kit: string) => ({ id, type: 'video-gen', position: { x: 1, y: 2 }, data: { prompt: 'p', brandKitId: kit } })
    for (const kits of [['k1', 'k1'], ['k1', 'k2'], ['', 'k2'], ['', '']]) {
      const input = { schemaVersion: 2, name: 'n', nodes: kits.map((k, i) => gen(`n${i}`, k)), edges: [], viewport: { x: 0, y: 0, zoom: 1 }, settings: {} }
      const theirs = server.migrateWorkflow(JSON.parse(JSON.stringify(input))).doc
      const ours = migrateDocument(input)
      expect([ours.brandKitId, ours.nodes.map((n) => n.data)]).toEqual([theirs.brandKitId || '', theirs.nodes.map((n: any) => n.data)])
    }
  })

  it('drops edges whose ends are gone and clamps the zoom', () => {
    const doc = migrateDocument({
      schemaVersion: 3,
      nodes: [{ id: 'a', type: 'text', position: { x: 1, y: 1 }, data: {} }],
      edges: [{ id: 'e', source: 'a', target: 'ghost' }],
      viewport: { x: 0, y: 0, zoom: 999 },
    })
    expect(doc.edges).toEqual([])
    expect(doc.viewport.zoom).toBe(10)
  })

  it('refuses what it cannot read', () => {
    expect(() => migrateDocument(null)).toThrow(CanvasDocumentError)
    expect(() => migrateDocument([])).toThrow(/object/)
    try { migrateDocument({ schemaVersion: CANVAS_SCHEMA_VERSION + 1 }); throw new Error('should have thrown') } catch (e: any) { expect(e.code).toBe('newer_version') }
    expect(() => migrateDocument({ schemaVersion: 3, nodes: [{ id: 'a', type: 'text' }, { id: 'a', type: 'text' }] })).toThrow(/unique/)
  })

  it('names the node types the editor renders', () => {
    expect([...CANVAS_NODE_TYPES]).toMatchInlineSnapshot(`
      [
        "text",
        "image",
        "video",
        "image-collection",
        "image-gen",
        "image-edit",
        "video-gen",
        "video-edit",
        "video-analysis",
        "llm",
        "output",
        "platform-export",
        "slice",
        "collage",
        "watermark",
        "fit-size",
        "frame",
      ]
    `)
  })
})
