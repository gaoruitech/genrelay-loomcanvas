'use strict'

/**
 * /api/workflow - canvases: list, create, read, save, delete, duplicate, zip export.
 * Every query carries the caller's id: another account's canvas is a 404.
 */
const { Transform } = require('stream')
const express = require('express')
const archiver = require('archiver')
const Workflow = require('../models/Workflow')
const BrandKit = require('../models/BrandKit')
const { pickThumbnail, collectNodeMedia } = require('../services/canvasGraph')
const { openStream } = require('../services/media')
const { migrateWorkflow, normalizeNodeKits, isKitRef, CURRENT_SCHEMA_VERSION } = require('../utils/workflowSchema')
const { ok, wrap, badRequest, notFound } = require('../utils/http')
const { requireObjectId, isPlainObject, isMediaUrl } = require('../utils/validate')
const { sniffMime, kindOfMime } = require('../utils/sniff')
const { t, messageOf } = require('../i18n')

const router = express.Router()

const MAX_NAME_LEN = 80
const ZIP_ITEM_MAX_BYTES = 1024 * 1024 * 1024
const MAX_NODES = 500
const MAX_EDGES = 2000
const MAX_LIST = 200
const defaultName = (req) => t(req.locale, 'canvas.untitled')
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }

function serialize(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    nodes: doc.nodes || [],
    edges: doc.edges || [],
    viewport: doc.viewport || DEFAULT_VIEWPORT,
    settings: doc.settings || {},
    brandKitId: doc.brandKitId || '',
    thumbnail: doc.thumbnail || '',
    thumbnailType: doc.thumbnailType || '',
    schemaVersion: doc.schemaVersion || CURRENT_SCHEMA_VERSION,
    legacyLayout: !!doc.legacyLayout,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

function parseViewport(v) {
  if (!isPlainObject(v)) throw badRequest('validation.object', { field: 'viewport' })
  const num = (x, dft) => (typeof x === 'number' && Number.isFinite(x) ? x : dft)
  return { x: num(v.x, 0), y: num(v.y, 0), zoom: Math.min(10, Math.max(0.01, num(v.zoom, 1))) }
}

/** Shape-check the writable fields; returns only those present in the body. */
function parseBody(body) {
  if (!isPlainObject(body)) throw badRequest('validation.body_object')
  const out = {}
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw badRequest('common.name_required')
    if (body.name.length > MAX_NAME_LEN) throw badRequest('validation.max_length', { field: 'name', max: MAX_NAME_LEN })
    out.name = body.name.trim()
  }
  if (body.nodes !== undefined) {
    if (!Array.isArray(body.nodes)) throw badRequest('validation.array', { field: 'nodes' })
    if (body.nodes.length > MAX_NODES) throw badRequest('canvas.max_nodes', { max: MAX_NODES })
    if (!body.nodes.every(isPlainObject)) throw badRequest('canvas.bad_node')
    out.nodes = body.nodes
  }
  if (body.edges !== undefined) {
    if (!Array.isArray(body.edges)) throw badRequest('validation.array', { field: 'edges' })
    if (body.edges.length > MAX_EDGES) throw badRequest('canvas.max_edges', { max: MAX_EDGES })
    if (!body.edges.every(isPlainObject)) throw badRequest('canvas.bad_edge')
    out.edges = body.edges
  }
  if (body.viewport !== undefined) out.viewport = parseViewport(body.viewport)
  if (body.settings !== undefined) {
    if (!isPlainObject(body.settings)) throw badRequest('validation.object', { field: 'settings' })
    out.settings = body.settings
  }
  // The canvas's brand kit: '' or a kit id. Whose kit it is is not checked here - a kit is
  // only ever looked up among the caller's own, so an id from elsewhere means "no kit".
  if (body.brandKitId !== undefined) {
    if (!isKitRef(body.brandKitId)) throw badRequest('validation.invalid', { field: 'brandKitId' })
    out.brandKitId = body.brandKitId
  }
  // The editor's "I have checked this old layout" - the flag can be cleared, never set, from outside.
  if (body.legacyLayout !== undefined) {
    if (body.legacyLayout !== false) throw badRequest('validation.invalid', { field: 'legacyLayout' })
    out.legacyLayout = false
  }
  return out
}

/**
 * Load one workflow as a plain object at the current schema version,
 * persisting the upgrade when an older document is read.
 */
async function loadWorkflow(userId, id) {
  requireObjectId(id)
  const raw = await Workflow.findOne({ _id: id, userId, isDeleted: false }).lean()
  if (!raw) throw notFound('canvas.not_found')
  const { doc, changed } = migrateWorkflow(raw)
  if (changed) {
    await Workflow.updateOne({ _id: raw._id, userId }, {
      $set: {
        nodes: doc.nodes, edges: doc.edges, viewport: doc.viewport, settings: doc.settings,
        brandKitId: doc.brandKitId || '',
        schemaVersion: doc.schemaVersion, legacyLayout: !!doc.legacyLayout,
      },
    }, { timestamps: false })
  }
  return doc
}

/** GET /api/workflow/list */
router.get('/list', wrap(async (req, res) => {
  const list = await Workflow.find(
    { userId: req.userId, isDeleted: false },
    { name: 1, thumbnail: 1, thumbnailType: 1, createdAt: 1, updatedAt: 1 }
  ).sort({ createdAt: -1 }).limit(MAX_LIST).lean()
  ok(res, list.map((w) => ({
    id: String(w._id),
    name: w.name,
    thumbnail: w.thumbnail || '',
    thumbnailType: w.thumbnailType || '',
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  })))
}))

/**
 * POST /api/workflow/download { url, filename } - download proxy.
 * A browser cannot always fetch a result itself (cross-origin storage without
 * CORS), so the server streams it as an attachment. Our own files are read
 * from storage; anything else goes through the SSRF guard. Only media comes
 * back out: the response type is taken from the content, not from the upstream.
 */
router.post('/download', wrap(async (req, res) => {
  const { url, filename } = req.body || {}
  if (!isMediaUrl(url)) throw badRequest('validation.required', { field: 'url' })
  const abort = new AbortController()
  res.on('close', () => { if (!res.writableEnded) abort.abort(new Error('client closed')) })
  let stream
  try {
    stream = (await openStream(url, { maxBytes: ZIP_ITEM_MAX_BYTES, signal: abort.signal, timeoutMs: 10 * 60 * 1000 })).stream
  } catch (err) {
    throw badRequest((err && err.name === 'SafeFetchError' && err.i18n) || messageOf(err) || 'fetch.failed')
  }
  // Look at the first bytes before committing to a response.
  const head = await new Promise((resolve) => {
    stream.once('error', () => resolve(null))
    stream.once('end', () => resolve(null))
    stream.once('readable', () => {
      const chunk = stream.read()
      if (chunk) stream.unshift(chunk)
      resolve(chunk)
    })
  })
  const mime = head ? sniffMime(head) : null
  if (!kindOfMime(mime)) {
    stream.destroy()
    throw badRequest('file.not_media_url')
  }
  const safeName = String(filename || 'download').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 120) || 'download'
  res.setHeader('Content-Type', mime)
  res.setHeader('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(safeName)}`)
  stream.on('error', () => res.destroy())
  stream.pipe(res)
}))

/** POST /api/workflow */
router.post('/', wrap(async (req, res) => {
  const { legacyLayout: _ignored, ...data } = parseBody(req.body || {})
  const nodes = data.nodes || []
  // A new canvas starts with the account's default brand kit unless the caller says otherwise.
  let brandKitId = data.brandKitId
  if (brandKitId === undefined) {
    const dft = await BrandKit.findOne({ userId: req.userId, isDeleted: false, isDefault: true }, { _id: 1 }).lean()
    brandKitId = dft ? String(dft._id) : ''
  }
  const doc = await Workflow.create({
    userId: req.userId,
    name: data.name || defaultName(req),
    nodes: normalizeNodeKits(nodes, brandKitId),
    edges: data.edges || [],
    viewport: data.viewport || DEFAULT_VIEWPORT,
    settings: data.settings || {},
    brandKitId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...pickThumbnail(nodes),
  })
  ok(res, serialize(doc.toObject()))
}))

/** GET /api/workflow/:id */
router.get('/:id', wrap(async (req, res) => {
  ok(res, serialize(await loadWorkflow(req.userId, req.params.id)))
}))

/**
 * PUT /api/workflow/:id - partial save.
 * An atomic $set (last write wins), not load-modify-save: the canvas
 * auto-saves every few seconds and overlapping saves must not conflict.
 */
router.put('/:id', wrap(async (req, res) => {
  requireObjectId(req.params.id)
  const data = parseBody(req.body || {})
  const set = { ...data }
  if (data.nodes) {
    Object.assign(set, pickThumbnail(data.nodes))
    // The client always writes the current shape.
    set.schemaVersion = CURRENT_SCHEMA_VERSION
  }
  // Panning and zooming are not edits: a save of nothing but the viewport leaves updatedAt alone,
  // so looking at a canvas does not move it to the top of "recently edited".
  const viewportOnly = Object.keys(set).length > 0 && Object.keys(set).every((k) => k === 'viewport' || k === 'legacyLayout')
  // Writing nodes stamps the document as current, so an older one is brought up to date
  // first: otherwise its nodes' kits would never be folded into the canvas's. Nodes that
  // arrive in the earlier shape are folded against the kit the canvas will have.
  if (data.nodes) {
    const current = await loadWorkflow(req.userId, req.params.id)
    set.nodes = normalizeNodeKits(data.nodes, data.brandKitId !== undefined ? data.brandKitId : current.brandKitId)
  }
  const doc = await Workflow.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId, isDeleted: false },
    { $set: set },
    { new: true, timestamps: !viewportOnly }
  ).lean()
  if (!doc) throw notFound('canvas.not_found')
  ok(res, serialize(doc))
}))

/**
 * POST /api/workflow/:id/duplicate { name? } - media is shared by reference, not copied.
 * The client may name the copy (it knows the UI language); otherwise a default is used.
 */
router.post('/:id/duplicate', wrap(async (req, res) => {
  const src = await loadWorkflow(req.userId, req.params.id)
  const wanted = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : ''
  const doc = await Workflow.create({
    userId: req.userId,
    name: (wanted || t(req.locale, 'canvas.copy_name', { name: src.name || defaultName(req) })).slice(0, MAX_NAME_LEN),
    nodes: src.nodes || [],
    edges: src.edges || [],
    viewport: src.viewport || DEFAULT_VIEWPORT,
    settings: src.settings || {},
    brandKitId: src.brandKitId || '',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // A copy of a canvas whose old layout has not been checked yet has the same old layout.
    legacyLayout: !!src.legacyLayout,
    thumbnail: src.thumbnail || '',
    thumbnailType: src.thumbnailType || '',
  })
  ok(res, serialize(doc.toObject()))
}))

/** DELETE /api/workflow/:id - soft delete */
router.delete('/:id', wrap(async (req, res) => {
  requireObjectId(req.params.id)
  const doc = await Workflow.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId, isDeleted: false },
    { $set: { isDeleted: true } },
    { new: true }
  ).lean()
  if (!doc) throw notFound('canvas.not_found')
  ok(res, { id: String(doc._id) })
}))

/* ------------------------------------------------------------ zip export */

const MAX_ZIP_ITEMS = 100
/** Cap on one archive as a whole; the per-item cap alone would allow 100 x 1 GB. */
const limits = { zipTotalBytes: 4 * 1024 * 1024 * 1024 }
const ZIP_ITEM_TIMEOUT_MS = 120 * 1000
const ZIP_TOTAL_TIMEOUT_MS = 10 * 60 * 1000

/** Entry names carry the node type as it is (image-gen, slice, ...): the same in every UI language. */
function zipLabel(node) {
  const type = node && typeof node.type === 'string' ? node.type : ''
  return /^[a-z][a-z-]{0,30}$/.test(type) ? type : 'node'
}

function zipExt(url, kind) {
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(String(url).split(/[?#]/)[0])
  const ext = m ? m[1].toLowerCase() : ''
  // Only well-known media extensions make it into the archive.
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'mp4', 'mov', 'webm', 'mkv'].includes(ext)) return ext
  return kind === 'video' ? 'mp4' : 'png'
}

/**
 * POST /api/workflow/:id/download-zip { urls?: string[] }
 *
 * The candidates always come from the stored workflow; `urls` only narrows
 * them down. A caller therefore cannot make the server fetch an address that
 * is not already on the canvas - and those fetches still go through the SSRF
 * guard.
 */
router.post('/:id/download-zip', wrap(async (req, res) => {
  const doc = await loadWorkflow(req.userId, req.params.id)
  const urls = req.body && req.body.urls
  if (urls !== undefined && urls !== null && !Array.isArray(urls)) throw badRequest('validation.array', { field: 'urls' })
  const wanted = Array.isArray(urls) && urls.length ? new Set(urls.filter((u) => typeof u === 'string')) : null

  const items = []
  const seen = new Set()
  for (const node of doc.nodes || []) {
    const label = zipLabel(node)
    for (const m of collectNodeMedia(node)) {
      if (seen.has(m.url) || (wanted && !wanted.has(m.url))) continue
      seen.add(m.url)
      items.push({ ...m, label })
    }
  }
  if (!items.length) throw notFound('canvas.nothing_to_download')
  if (items.length > MAX_ZIP_ITEMS) {
    throw badRequest('canvas.zip_max', { max: MAX_ZIP_ITEMS, count: items.length })
  }

  const baseName = String(doc.name || defaultName(req)).replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').slice(0, 60)
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="canvas.zip"; filename*=UTF-8''${encodeURIComponent(baseName + '.zip')}`)

  // The client going away or the overall budget running out stops the work.
  const abort = new AbortController()
  const budget = setTimeout(() => abort.abort(new Error('zip timeout')), ZIP_TOTAL_TIMEOUT_MS)
  res.on('close', () => { if (!res.writableEnded) abort.abort(new Error('client closed')) })

  // Store without compressing: images and videos are already compressed.
  const archive = archiver('zip', { zlib: { level: 0 } })
  archive.on('warning', () => {})
  archive.on('error', (err) => {
    console.error('[workflow/download-zip] archive error:', err.message)
    res.destroy()
  })
  archive.pipe(res)

  let room = limits.zipTotalBytes
  try {
    for (let i = 0; i < items.length && !abort.signal.aborted; i++) {
      const it = items[i]
      const no = String(i + 1).padStart(2, '0')
      try {
        // A file whose size is not known up front may use what is left and no more.
        const { stream, size } = await openStream(it.url, { maxBytes: Math.min(ZIP_ITEM_MAX_BYTES, Math.max(1, room)), signal: abort.signal, timeoutMs: ZIP_ITEM_TIMEOUT_MS })
        if (size !== null && size > room) {
          stream.destroy()
          archive.append(`Skipped, the archive would exceed its size limit: ${it.url}\n`, { name: `${no}-${it.label}-skipped.txt` })
          continue
        }
        // Append one entry at a time and wait for it, so only one download is open.
        await new Promise((resolve, reject) => {
          // Counts what goes in. Running over the limit in the middle of an entry
          // (only possible when the size was not known) ends the whole archive.
          const counted = new Transform({
            transform(chunk, _enc, done) {
              room -= chunk.length
              if (room < 0) abort.abort(new Error('zip size limit'))
              done(room < 0 ? new Error('zip size limit') : null, chunk)
            },
          })
          stream.once('error', (err) => counted.destroy(err))
          counted.once('error', reject)
          archive.once('entry', resolve)
          archive.append(stream.pipe(counted), { name: `${no}-${it.label}.${zipExt(it.url, it.kind)}` })
        })
      } catch (err) {
        if (abort.signal.aborted) break
        // One missing file should not ruin the archive: leave a note in its place.
        archive.append(`Download failed: ${it.url}\n`, { name: `${no}-${it.label}-failed.txt` })
      }
    }
    if (abort.signal.aborted) { archive.abort(); res.destroy(); return }
    await archive.finalize()
  } finally {
    clearTimeout(budget)
  }
}))

/**
 * Bring every stored canvas up to the current schema at start-up, so that queries which
 * look inside the documents (which canvases use a brand kit) see one shape. Reading a
 * canvas still upgrades it too; this only makes sure none is left behind.
 */
async function migrateStoredWorkflows() {
  let migrated = 0
  const stale = { $or: [{ schemaVersion: { $lt: CURRENT_SCHEMA_VERSION } }, { schemaVersion: { $exists: false } }] }
  for await (const raw of Workflow.find(stale).lean().cursor()) {
    const { doc, changed } = migrateWorkflow(raw)
    if (!changed) continue
    // Guarded by the version it was read at: a canvas saved in the meantime is left alone.
    const readAt = raw.schemaVersion === undefined ? { $exists: false } : raw.schemaVersion
    const res = await Workflow.updateOne({ _id: raw._id, schemaVersion: readAt }, {
      $set: {
        nodes: doc.nodes, edges: doc.edges, viewport: doc.viewport, settings: doc.settings,
        brandKitId: doc.brandKitId || '',
        schemaVersion: doc.schemaVersion, legacyLayout: !!doc.legacyLayout,
      },
    }, { timestamps: false })
    migrated += res.modifiedCount || 0
  }
  return migrated
}

module.exports = router
module.exports.limits = limits
module.exports.migrateStoredWorkflows = migrateStoredWorkflows
