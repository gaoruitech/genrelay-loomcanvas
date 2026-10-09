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
