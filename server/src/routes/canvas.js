'use strict'

/**
 * /api/canvas - templates, text templates, tool nodes and platform export.
 * The tool endpoints are local pixel processing: no model, no cost.
 */
const express = require('express')
const Template = require('../models/Template')
const TextTemplate = require('../models/TextTemplate')
const tools = require('../services/imageTools')
const { loadImage } = require('../services/media')
const { getStorage, newKey } = require('../storage')
const { ok, wrap, badRequest, notFound, ApiError } = require('../utils/http')
const { clampInt, isMediaUrl, isPlainObject, isObjectId, text } = require('../utils/validate')
const crypto = require('crypto')
const spaces = require('../services/spaces')
const permissions = require('../services/permissions')
const { t, msg } = require('../i18n')

const router = express.Router()

const MAX_SOURCE_BYTES = 20 * 1024 * 1024

function imageUrlOf(v, what) {
  if (!isMediaUrl(v)) throw badRequest('media.url_missing', { what })
  return v
}

async function fetchImage(url, what) {
  const { buffer } = await loadImage(imageUrlOf(url, what), { maxBytes: MAX_SOURCE_BYTES, what })
  return buffer
}

async function save(req, buffer, mime) {
  const saved = await getStorage().put(newKey('tools', mime, req.spaceId), buffer, { contentType: mime })
  return saved.url
}

/* ------------------------------------------------------------ templates */

/** Built-in entries are the site's and shown to everyone; any other entry only inside the space that owns it. */
const visibleTo = (req) => ({ $or: [{ builtin: true }, { userId: req.spaceId }] })

const MAX_SAVED = 200
const MAX_TEMPLATE_NODES = 200
/** One's own entries, and in a team those of others for the owner and admins. Built-in ones: nobody. */
const canRemove = (req, doc) => !doc.builtin && (permissions.creatorOf(doc) === req.userId || permissions.can(req.space, 'asset:manage_all'))

/**
 * Who saved the entries of a list (built-in ones have no author): spaces.people() for their
 * creators - in a team as the team sees them, display name and whether they are still in it.
 */
function authorsOf(req, docs) {
  return spaces.people(docs.filter((d) => !d.builtin).map(permissions.creatorOf), spaces.isTeam(req) ? req.spaceId : '')
}

/** What every saved template and snippet says about whose it is. Built-in: nobody's. */
function authorship(req, doc, names) {
  if (doc.builtin) return { createdBy: null, mine: false, createdAt: null }
  const creator = permissions.creatorOf(doc)
  return { createdBy: spaces.personOf(names, creator), mine: creator === req.userId, createdAt: doc.createdAt || null }
}

function serializeTemplate(req, t, names) {
  return {
    key: t.key,
    title: t.title,
    description: t.description || '',
    cover: t.cover || '',
    graph: t.graph || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
    builtin: !!t.builtin,
    canDelete: canRemove(req, t),
    ...authorship(req, t, names),
  }
}

function serializeTextTemplate(req, t, names) {
  return {
    id: String(t._id),
    title: t.title,
    content: t.content || '',
    category: t.category || '',
    lang: t.lang || 'zh',
    builtin: !!t.builtin,
    canDelete: canRemove(req, t),
    ...authorship(req, t, names),
  }
}

/** GET /api/canvas/templates - each with `createdBy` (who saved it; null for a built-in one), `mine`, `createdAt` */
router.get('/templates', wrap(async (req, res) => {
  const list = await Template.find({ isActive: true, ...visibleTo(req) }).sort({ order: 1, createdAt: 1 }).limit(200).lean()
  const names = await authorsOf(req, list)
  ok(res, list.map((t) => serializeTemplate(req, t, names)))
}))

/**
 * POST /api/canvas/templates { title, description?, cover?, graph: { nodes, edges, viewport?, group? } }
 * Save a piece of a canvas as a template of this space. In a team every member may.
 */
router.post('/templates', wrap(async (req, res) => {
  const b = isPlainObject(req.body) ? req.body : {}
  const title = text(b.title, 80)
  if (!title) throw badRequest('common.name_required')
  const g = isPlainObject(b.graph) ? b.graph : {}
  if (!Array.isArray(g.nodes) || !g.nodes.length || !g.nodes.every(isPlainObject)) throw badRequest('validation.array', { field: 'graph.nodes' })
  if (g.nodes.length > MAX_TEMPLATE_NODES) throw badRequest('canvas.max_nodes', { max: MAX_TEMPLATE_NODES })
  const edges = Array.isArray(g.edges) ? g.edges.filter(isPlainObject).slice(0, 1000) : []
  const cover = typeof b.cover === 'string' && b.cover ? b.cover : ''
  if (cover && !isMediaUrl(cover)) throw badRequest('validation.bad_url', { field: 'cover' })
  if ((await Template.countDocuments({ userId: req.spaceId, builtin: { $ne: true } })) >= MAX_SAVED) throw badRequest('template.max', { max: MAX_SAVED })
  const doc = await Template.create({
    userId: req.spaceId,
    createdBy: req.userId,
    key: `u-${crypto.randomBytes(8).toString('hex')}`,
    title,
    description: text(b.description, 500),
    cover,
    builtin: false,
    graph: { nodes: g.nodes, edges, viewport: isPlainObject(g.viewport) ? g.viewport : { x: 0, y: 0, zoom: 1 }, group: g.group === true },
  })
  const saved = doc.toObject()
  ok(res, serializeTemplate(req, saved, await authorsOf(req, [saved])))
}))

/** DELETE /api/canvas/templates/:key - one's own; in a team also the owner and admins. Built-in templates stay. */
router.delete('/templates/:key', wrap(async (req, res) => {
  const doc = await Template.findOne({ userId: req.spaceId, key: String(req.params.key).slice(0, 60), builtin: { $ne: true } }).lean()
  if (!doc) throw notFound('template.not_found')
  if (!canRemove(req, doc)) throw new ApiError(403, 'team.forbidden')
  await Template.deleteOne({ _id: doc._id })
  ok(res, { key: doc.key })
}))

/** GET /api/canvas/text-templates?lang=zh|en */
router.get('/text-templates', wrap(async (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : 'zh'
  const list = await TextTemplate.find({ isActive: true, lang, ...visibleTo(req) }).sort({ category: 1, order: 1, createdAt: 1 }).limit(500).lean()
  const names = await authorsOf(req, list)
  ok(res, list.map((t) => serializeTextTemplate(req, t, names)))
}))

/** POST /api/canvas/text-templates { title, content, category?, lang? } - save a prompt snippet in this space */
router.post('/text-templates', wrap(async (req, res) => {
  const b = isPlainObject(req.body) ? req.body : {}
  const title = text(b.title, 80)
  if (!title) throw badRequest('common.name_required')
  const content = typeof b.content === 'string' ? b.content.slice(0, 5000) : ''
  if (!content.trim()) throw badRequest('validation.required', { field: 'content' })
  if ((await TextTemplate.countDocuments({ userId: req.spaceId, builtin: { $ne: true } })) >= MAX_SAVED) throw badRequest('template.max', { max: MAX_SAVED })
  const doc = await TextTemplate.create({
    userId: req.spaceId,
    createdBy: req.userId,
    title,
    content,
    category: text(b.category, 40),
    lang: b.lang === 'en' ? 'en' : 'zh',
    builtin: false,
  })
  const saved = doc.toObject()
  ok(res, serializeTextTemplate(req, saved, await authorsOf(req, [saved])))
}))

/** DELETE /api/canvas/text-templates/:id */
router.delete('/text-templates/:id', wrap(async (req, res) => {
  const doc = isObjectId(req.params.id) ? await TextTemplate.findOne({ _id: req.params.id, userId: req.spaceId, builtin: { $ne: true } }).lean() : null
  if (!doc) throw notFound('template.not_found')
  if (!canRemove(req, doc)) throw new ApiError(403, 'team.forbidden')
  await TextTemplate.deleteOne({ _id: doc._id })
  ok(res, { id: String(doc._id) })
}))

/* ----------------------------------------------------------- tool nodes */

/** POST /api/canvas/tool/slice { imageUrl, cols, rows } */
router.post('/tool/slice', wrap(async (req, res) => {
  const b = req.body || {}
  const cols = clampInt(b.cols, 1, 6, 3)
  const rows = clampInt(b.rows, 1, 6, 3)
  const cells = await tools.slice(await fetchImage(b.imageUrl, msg('noun.source_image')), { cols, rows })
  const items = []
  for (const cell of cells) {
    items.push({
      key: cell.key,
      label: t(req.locale, 'tool.slice_cell', { n: cell.index }),
      url: await save(req, cell.buffer, cell.mime),
      width: cell.width,
      height: cell.height,
    })
  }
  ok(res, { cols, rows, items })
}))

/** POST /api/canvas/tool/collage { imageUrls[], cols, rows, gap, bg, ratio } */
router.post('/tool/collage', wrap(async (req, res) => {
  const b = req.body || {}
  const urls = Array.isArray(b.imageUrls) ? b.imageUrls.filter(Boolean) : []
  if (urls.length < 2) throw badRequest('tool.collage_min')
  if (urls.length > 64) throw badRequest('tool.collage_max')
  const cols = clampInt(b.cols, 1, 4, 2)
  const rows = clampInt(b.rows, 1, 4, 2)
  const used = urls.slice(0, cols * rows)
  const buffers = []
  for (let i = 0; i < used.length; i++) buffers.push(await fetchImage(used[i], msg('noun.nth_image', { n: i + 1 })))
  const out = await tools.collage(buffers, { cols, rows, gap: clampInt(b.gap, 0, 80, 0), bg: b.bg, ratio: String(b.ratio || '') })
  ok(res, {
    url: await save(req, out.buffer, out.mime),
    width: out.width,
    height: out.height,
    cols,
    rows,
    used: out.used,
    skipped: urls.length - out.used,
  })
}))

/** POST /api/canvas/tool/watermark { imageUrl, markUrl, position, scalePct, opacity, marginPct } */
router.post('/tool/watermark', wrap(async (req, res) => {
  const b = req.body || {}
  const base = await fetchImage(b.imageUrl, msg('noun.base_image'))
  const mark = await fetchImage(b.markUrl, msg('noun.watermark_image'))
  const out = await tools.watermark(base, mark, {
    position: tools.ANCHORS.has(String(b.position)) ? String(b.position) : 'br',
    scalePct: clampInt(b.scalePct, 5, 60, 20),
    opacity: clampInt(b.opacity, 10, 100, 70),
    marginPct: clampInt(b.marginPct, 0, 20, 3),
  })
  ok(res, { url: await save(req, out.buffer, out.mime), width: out.width, height: out.height })
}))

/** POST /api/canvas/tool/fit { imageUrl, ratio, bg, format, quality, maxKb } */
router.post('/tool/fit', wrap(async (req, res) => {
  const b = req.body || {}
  const out = await tools.fit(await fetchImage(b.imageUrl, msg('noun.source_image')), {
    ratio: String(b.ratio || ''),
    bg: b.bg,
    format: ['jpg', 'png', 'webp'].includes(String(b.format)) ? String(b.format) : 'auto',
    quality: clampInt(b.quality, 40, 95, 88),
    maxKb: clampInt(b.maxKb, 0, 20480, 0),
  })
  ok(res, {
    url: await save(req, out.buffer, out.mime),
    width: out.width,
    height: out.height,
    bytes: out.buffer.length,
    overLimit: out.overLimit,
  })
}))

/** POST /api/canvas/platform-export { imageUrl, group: 'domestic' | 'overseas' } */
router.post('/platform-export', wrap(async (req, res) => {
  const b = req.body || {}
  const group = b.group === 'overseas' ? 'overseas' : 'domestic'
  const out = await tools.platformExport(await fetchImage(b.imageUrl, msg('noun.source_image')), group)
  const items = []
  for (const it of out.items) {
    items.push({ key: it.key, label: t(req.locale, `export.${it.key}`), url: await save(req, it.buffer, it.mime), width: it.width, height: it.height })
  }
  ok(res, { group, items, whiteBg: out.whiteBg })
}))

module.exports = router
