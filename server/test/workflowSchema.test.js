'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { migrateWorkflow, normalizeNodeKits, isKitRef, CURRENT_SCHEMA_VERSION, MIGRATIONS } = require('../src/utils/workflowSchema')

test('a current document passes through untouched', () => {
  const doc = { schemaVersion: CURRENT_SCHEMA_VERSION, nodes: [{ id: 'a' }], edges: [] }
  const out = migrateWorkflow(doc)
  assert.equal(out.changed, false)
  assert.equal(out.doc, doc)
})

test('an unversioned legacy document is normalised and stamped', () => {
  const legacy = { name: 'old', nodes: null, edges: 'broken', viewport: undefined }
  const out = migrateWorkflow(legacy)
  assert.equal(out.changed, true)
  assert.equal(out.doc.schemaVersion, CURRENT_SCHEMA_VERSION)
  assert.deepEqual(out.doc.nodes, [])
  assert.deepEqual(out.doc.edges, [])
  assert.deepEqual(out.doc.viewport, { x: 0, y: 0, zoom: 1 })
  assert.deepEqual(out.doc.settings, {})
  assert.equal(out.doc.name, 'old')
  // The input is never mutated.
  assert.equal(legacy.nodes, null)
  assert.equal('schemaVersion' in legacy, false)
})

test('legacy content is preserved', () => {
  const nodes = [{ id: 'n1', type: 'text', data: { text: 'hi' } }]
  const out = migrateWorkflow({ nodes, edges: [{ id: 'e' }], settings: { bg: '#fff' } })
  assert.deepEqual(out.doc.nodes, nodes)
  assert.deepEqual(out.doc.settings, { bg: '#fff' })
})

test('version 2: a canvas laid out before the redesign is flagged for one layout check', () => {
  const two = [{ id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 420, y: 0 } }]
  const fromV1 = migrateWorkflow({ schemaVersion: 1, nodes: two, edges: [], name: 'old' })
  assert.deepEqual([fromV1.changed, fromV1.doc.schemaVersion, fromV1.doc.legacyLayout], [true, CURRENT_SCHEMA_VERSION, true])
  assert.deepEqual(fromV1.doc.nodes, two, 'positions are not touched on the server: only the browser knows the node sizes')
  // An unversioned document goes through both steps.
  assert.deepEqual([migrateWorkflow({ nodes: two }).doc.schemaVersion, migrateWorkflow({ nodes: two }).doc.legacyLayout], [CURRENT_SCHEMA_VERSION, true])
  // Nothing to overlap: no check needed.
  for (const nodes of [[], [two[0]], null]) assert.equal(migrateWorkflow({ schemaVersion: 1, nodes }).doc.legacyLayout, false)
  // A canvas already at version 2 is never flagged again, whatever its flag says.
  for (const legacyLayout of [false, true, undefined]) {
    const out = migrateWorkflow({ schemaVersion: 2, nodes: two, legacyLayout })
    assert.equal(out.doc.legacyLayout, legacyLayout)
  }
})

test('version 3: the brand kit moves from each generation node to the canvas', () => {
  const A = 'a'.repeat(24)
  const B = 'b'.repeat(24)
  const gen = (id, type, data) => ({ id, type, position: { x: 0, y: 0 }, data: { prompt: 'p', ...data } })
  const v2 = (nodes) => ({ schemaVersion: 2, name: 'c', nodes, edges: [] })
  const kits = (doc) => [doc.brandKitId, doc.nodes.map((n) => (n.data || {}).brandKitOverride)]
  const noOldField = (doc) => doc.nodes.every((n) => !n.data || !('brandKitId' in n.data))

  // The same kit on every generation node: the canvas takes it and the nodes follow.
  const same = v2([gen('1', 'image-gen', { brandKitId: A }), gen('2', 'video-edit', { brandKitId: A }), { id: 't', type: 'text', data: { text: 'x' } }])
  const sameOut = migrateWorkflow(same)
  assert.deepEqual([sameOut.changed, sameOut.doc.schemaVersion, ...kits(sameOut.doc)], [true, 3, A, [undefined, undefined, undefined]])
  assert.ok(noOldField(sameOut.doc))
  assert.equal(sameOut.doc.nodes[0].data.prompt, 'p', 'the rest of the node is kept')
  assert.equal(same.nodes[0].data.brandKitId, A, 'the input is not mutated')

  // A mix (two kits, or a kit on some nodes only): the canvas has none, each node keeps its own.
  const mixed = migrateWorkflow(v2([gen('1', 'image-gen', { brandKitId: A }), gen('2', 'image-edit', { brandKitId: B }), gen('3', 'video-gen', { brandKitId: '' }), gen('4', 'video-edit', {})]))
  assert.deepEqual(kits(mixed.doc), ['', [A, B, undefined, undefined]])
  assert.ok(noOldField(mixed.doc))
  const partly = migrateWorkflow(v2([gen('1', 'image-gen', { brandKitId: A }), gen('2', 'image-gen', {})]))
  assert.deepEqual(kits(partly.doc), ['', [A, undefined]])
  // An exception that is already there wins over the old field.
  assert.deepEqual(kits(migrateWorkflow(v2([gen('1', 'image-gen', { brandKitId: A, brandKitOverride: 'none' }), gen('2', 'image-gen', { brandKitId: B })])).doc), ['', ['none', B]])

  // No kit anywhere, no generation node, no nodes at all.
  assert.deepEqual(kits(migrateWorkflow(v2([gen('1', 'image-gen', { brandKitId: '' }), gen('2', 'image-gen', {})])).doc), ['', [undefined, undefined]])
  assert.deepEqual(kits(migrateWorkflow(v2([{ id: 't', type: 'text', data: { text: 'x' } }])).doc), ['', [undefined]])
  assert.deepEqual(kits(migrateWorkflow(v2([])).doc), ['', []])
  assert.equal(migrateWorkflow({ schemaVersion: 2, nodes: null }).doc.brandKitId, '')

  // Only generation nodes count: a stray field on another node type neither votes nor survives.
  const stray = migrateWorkflow(v2([gen('1', 'image-gen', { brandKitId: A }), { id: 't', type: 'text', data: { brandKitId: B } }]))
  assert.deepEqual(kits(stray.doc), [A, [undefined, undefined]])
  assert.ok(noOldField(stray.doc))
  // Malformed nodes do not break it.
  assert.deepEqual(kits(migrateWorkflow(v2([{ id: 'x', type: 'image-gen' }, { id: 'y', type: 'image-gen', data: { brandKitId: 7 } }])).doc), ['', [undefined, undefined]])

  // Idempotent: a migrated document is current, and running the step again changes nothing.
  for (const out of [sameOut, mixed]) {
    assert.equal(migrateWorkflow(out.doc).changed, false)
    assert.deepEqual(MIGRATIONS[2](out.doc).nodes, out.doc.nodes)
  }
  assert.deepEqual(kits(MIGRATIONS[2](mixed.doc)), ['', [A, B, undefined, undefined]])
  // From further back, the kits are folded in the same read.
  assert.deepEqual(kits(migrateWorkflow({ nodes: same.nodes }).doc), [A, [undefined, undefined, undefined]])
})

test('nodes written in the earlier shape are normalised on the way in', () => {
  const A = 'a'.repeat(24)
  const current = [{ id: '1', type: 'image-gen', data: { brandKitOverride: 'none' } }, { id: '2', type: 'text', data: {} }, { id: '3', type: 'frame' }]
  assert.equal(normalizeNodeKits(current), current, 'nothing to do: the same array')
  const out = normalizeNodeKits([
    { id: '1', type: 'image-gen', data: { brandKitId: A, prompt: 'p' } },
    { id: '2', type: 'image-gen', data: { brandKitId: '' } },
    { id: '3', type: 'image-gen', data: { brandKitId: A, brandKitOverride: 'none' } },
    { id: '4', type: 'text', data: { brandKitId: A } },
  ])
  assert.deepEqual(out.map((n) => n.data), [{ prompt: 'p', brandKitOverride: A }, {}, { brandKitOverride: 'none' }, {}], 'a canvas without a kit')
  // Against a canvas that has a kit: the same kit means "follow", '' means "none for this node".
  const B = 'b'.repeat(24)
  const against = normalizeNodeKits([
    { id: '1', type: 'image-gen', data: { brandKitId: A } },
    { id: '2', type: 'image-gen', data: { brandKitId: B } },
    { id: '3', type: 'video-gen', data: { brandKitId: '' } },
    { id: '4', type: 'image-gen', data: {} },
    { id: '5', type: 'text', data: { brandKitId: '' } },
  ], A)
  assert.deepEqual(against.map((n) => n.data), [{}, { brandKitOverride: B }, { brandKitOverride: 'none' }, {}, {}])
  assert.deepEqual(['', A, 'none', 'abc', 5, null, undefined, A + 'a'].map(isKitRef), [true, true, false, false, false, false, false, false])
})

test('migrations chain across several versions, in order', () => {
  const steps = {
    0: (d) => ({ ...d, trail: ['0->1'] }),
    1: (d) => ({ ...d, trail: [...d.trail, '1->2'] }),
    2: (d) => ({ ...d, trail: [...d.trail, '2->3'] }),
  }
  const out = migrateWorkflow({ nodes: [] }, steps, 3)
  assert.deepEqual(out.doc.trail, ['0->1', '1->2', '2->3'])
  assert.equal(out.doc.schemaVersion, 3)

  const partial = migrateWorkflow({ schemaVersion: 2, trail: ['kept'] }, steps, 3)
  assert.deepEqual(partial.doc.trail, ['kept', '2->3'])
})

test('a document from a newer schema is left alone, not downgraded', () => {
  const future = { schemaVersion: CURRENT_SCHEMA_VERSION + 5, nodes: [{ id: 'x' }] }
  const out = migrateWorkflow(future)
  assert.equal(out.changed, false)
  assert.equal(out.doc.schemaVersion, CURRENT_SCHEMA_VERSION + 5)
})

test('a missing migration step is an error, not a silent skip', () => {
  assert.throws(() => migrateWorkflow({ schemaVersion: 1 }, { 0: (d) => d }, 3), /no workflow migration from schema version 1/)
})

test('invalid version values are treated as unversioned', () => {
  for (const v of [-1, 1.5, '1', null, NaN]) {
    assert.equal(migrateWorkflow({ schemaVersion: v, nodes: [] }).doc.schemaVersion, CURRENT_SCHEMA_VERSION)
  }
  assert.throws(() => migrateWorkflow(null), TypeError)
})

test('there is a migration for every version below the current one', () => {
  for (let v = 0; v < CURRENT_SCHEMA_VERSION; v++) assert.equal(typeof MIGRATIONS[v], 'function', `step from ${v}`)
})
