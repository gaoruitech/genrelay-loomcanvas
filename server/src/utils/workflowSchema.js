'use strict'

/**
 * Workflow document schema versioning.
 *
 * Every stored workflow carries `schemaVersion`. When the shape of nodes/edges
 * changes, bump CURRENT_SCHEMA_VERSION and add a step to MIGRATIONS keyed by
 * the version it upgrades FROM. Steps run in order until the document is
 * current, so a document can jump several versions in one read.
 */

const CURRENT_SCHEMA_VERSION = 1

/** version N -> function that returns the document at version N + 1 */
const MIGRATIONS = {
  // Documents written before versioning existed have no schemaVersion (treated as 0).
  0: (doc) => ({
    ...doc,
    nodes: Array.isArray(doc.nodes) ? doc.nodes : [],
    edges: Array.isArray(doc.edges) ? doc.edges : [],
    viewport: doc.viewport && typeof doc.viewport === 'object' ? doc.viewport : { x: 0, y: 0, zoom: 1 },
    settings: doc.settings && typeof doc.settings === 'object' ? doc.settings : {},
  }),
}

/**
 * Bring a plain workflow object up to the current schema.
 * Pure: returns { doc, changed } and never mutates its input.
 * A document from a NEWER schema than this server knows is returned untouched
 * (changed=false) rather than being downgraded.
 */
function migrateWorkflow(input, migrations = MIGRATIONS, target = CURRENT_SCHEMA_VERSION) {
  if (!input || typeof input !== 'object') throw new TypeError('migrateWorkflow expects an object')
  let version = Number.isInteger(input.schemaVersion) && input.schemaVersion >= 0 ? input.schemaVersion : 0
  if (version >= target) return { doc: input, changed: false }
  let doc = { ...input }
  while (version < target) {
    const step = migrations[version]
    if (typeof step !== 'function') throw new Error(`no workflow migration from schema version ${version}`)
    doc = step(doc)
    version += 1
    doc.schemaVersion = version
  }
  return { doc, changed: true }
}

module.exports = { CURRENT_SCHEMA_VERSION, MIGRATIONS, migrateWorkflow }
