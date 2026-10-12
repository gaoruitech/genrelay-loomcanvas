'use strict'

/**
 * Workflow document schema versioning.
 *
 * Every stored workflow carries `schemaVersion`. When the shape of nodes/edges
 * changes, bump CURRENT_SCHEMA_VERSION and add a step to MIGRATIONS keyed by
 * the version it upgrades FROM. Steps run in order until the document is
 * current, so a document can jump several versions in one read.
 */

const CURRENT_SCHEMA_VERSION = 3

/** The node types a brand kit applies to. */
const GEN_NODE_TYPES = new Set(['image-gen', 'image-edit', 'video-gen', 'video-edit'])
/** A node's `data.brandKitOverride` when the node opts out of the canvas's kit. */
const KIT_NONE = 'none'
const KIT_ID_RE = /^[a-f0-9]{24}$/i

const isGenNode = (n) => !!n && typeof n === 'object' && GEN_NODE_TYPES.has(n.type)
const hasOwnKit = (n) => !!n && typeof n === 'object' && !!n.data && typeof n.data === 'object' && 'brandKitId' in n.data

/**
 * Drop a node's `data.brandKitId` (the kit it used before version 3: an id, or '' for none).
 * Where that differs from the canvas's kit it becomes the node's own exception, so the
 * node keeps running with the same kit.
 */
function withoutOwnKit(n, canvasKitId) {
  if (!hasOwnKit(n)) return n
  const { brandKitId: raw, ...data } = n.data
  const own = typeof raw === 'string' ? raw : ''
  if (isGenNode(n) && data.brandKitOverride === undefined && own !== canvasKitId) data.brandKitOverride = own || KIT_NONE
  return { ...n, data }
}

/**
 * Version 3: a brand kit is chosen per canvas (`doc.brandKitId`), and a node only says
 * something when it differs (`data.brandKitOverride`: a kit id, or 'none'). Before that
 * every generation node carried its own `data.brandKitId` ('' or missing = no kit).
 *
 * - every generation node uses the same kit: it becomes the canvas's kit and the nodes follow it
 * - anything else (no kit anywhere, or a mix): the canvas has no kit, and each node that had
 *   one keeps it as its own exception; nodes without one follow the canvas, i.e. stay without
 * Either way every node runs with exactly the kit it ran with before.
 */
function kitsToCanvas(doc) {
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : []
  const used = nodes.filter(isGenNode).map((n) => (hasOwnKit(n) && typeof n.data.brandKitId === 'string' ? n.data.brandKitId : ''))
  const shared = used.length > 0 && used[0] && used.every((id) => id === used[0]) ? used[0] : ''
  return { ...doc, brandKitId: shared, nodes: nodes.map((n) => withoutOwnKit(n, shared)) }
}

/**
 * Nodes as a client sends them, in the current shape. A browser tab that was open across
 * the upgrade to version 3 still writes `data.brandKitId`; what it says is folded against
 * the canvas's kit instead of being stored as a field nothing reads. Returns the same array
 * when there is nothing to change.
 */
function normalizeNodeKits(nodes, canvasKitId = '') {
  if (!Array.isArray(nodes) || !nodes.some(hasOwnKit)) return nodes
  return nodes.map((n) => withoutOwnKit(n, canvasKitId || ''))
}

/** '' (no kit) or a kit id. Anything else is not a value the field can hold. */
const isKitRef = (v) => v === '' || (typeof v === 'string' && KIT_ID_RE.test(v))

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
  // Version 2 came with the redesigned editor, whose generation nodes are about twice as
  // tall. A canvas laid out before that may now have nodes on top of each other. Only the
  // browser knows the real node sizes, so the server just flags the document; the editor
  // checks it once on open, re-arranges it if the nodes do overlap, and clears the flag
  // (PUT { legacyLayout: false }). A single node, or none, cannot overlap anything.
  1: (doc) => ({ ...doc, legacyLayout: Array.isArray(doc.nodes) && doc.nodes.length > 1 }),
  2: kitsToCanvas,
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

module.exports = { CURRENT_SCHEMA_VERSION, MIGRATIONS, migrateWorkflow, normalizeNodeKits, isKitRef, GEN_NODE_TYPES, KIT_NONE }
