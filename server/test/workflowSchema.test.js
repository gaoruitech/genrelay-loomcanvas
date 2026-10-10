'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { migrateWorkflow, CURRENT_SCHEMA_VERSION, MIGRATIONS } = require('../src/utils/workflowSchema')

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
  assert.deepEqual([fromV1.changed, fromV1.doc.schemaVersion, fromV1.doc.legacyLayout], [true, 2, true])
  assert.deepEqual(fromV1.doc.nodes, two, 'positions are not touched on the server: only the browser knows the node sizes')
  // An unversioned document goes through both steps.
  assert.deepEqual([migrateWorkflow({ nodes: two }).doc.schemaVersion, migrateWorkflow({ nodes: two }).doc.legacyLayout], [2, true])
  // Nothing to overlap: no check needed.
  for (const nodes of [[], [two[0]], null]) assert.equal(migrateWorkflow({ schemaVersion: 1, nodes }).doc.legacyLayout, false)
  // A canvas already at version 2 is never flagged again, whatever its flag says.
  for (const legacyLayout of [false, true, undefined]) {
    const current = { schemaVersion: 2, nodes: two, legacyLayout }
    const out = migrateWorkflow(current)
    assert.deepEqual([out.changed, out.doc], [false, current])
  }
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
