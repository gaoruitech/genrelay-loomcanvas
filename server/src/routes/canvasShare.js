'use strict'

/**
 * /api/canvas-share - read-only share links.
 *
 * Publishing snapshots a canvas and returns a link addressed by a long random
 * token. Links can expire and be revoked. Reading a link is the only public
 * operation; everything else belongs to the account that published the link,
 * and every such query carries that account's id.
 *
 * Paths follow the original canvas frontend (plaza / mine / publish / :id /
 * :id/copy / DELETE :id). There is no public gallery, so `plaza` lists the
 * caller's own active links.
 */
const express = require('express')
const Workflow = require('../models/Workflow')
const Share = require('../models/Share')
const { pickThumbnail, cleanNodes } = require('../services/canvasGraph')
const { CURRENT_SCHEMA_VERSION } = require('../utils/workflowSchema')
const { listModels } = require('../providers')
const { randomToken } = require('../utils/crypto')
const { requireAuth } = require('../middleware/auth')
const { ok, wrap, badRequest, notFound } = require('../utils/http')
const { requireObjectId, pageParams, text } = require('../utils/validate')
const { t } = require('../i18n')

const router = express.Router()

const MAX_NODES = 500
const MAX_SHARES = 500
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/
const GONE = 'share.gone'

/**
 * A viewer of a share link has none of the publisher's providers, so a node's
 * model id ("gaorui:nano-banana-2.1") means nothing to them and cannot be
 * looked up. Write the display name the publisher sees next to it
 * (`data.modelLabel`). `onlyMissing` leaves labels that are already there:
 * used when an older snapshot, published without them, is read.
 * A model the publisher no longer has gets no label; the page then shows a
 * neutral one instead of the id.
 */
async function labelModels(nodes, userId, { onlyMissing = false } = {}) {
  const wanted = nodes.filter((n) => n && n.data && typeof n.data === 'object' && typeof n.data.model === 'string' && n.data.model
    && !(onlyMissing && typeof n.data.modelLabel === 'string' && n.data.modelLabel))
  if (!wanted.length) return nodes
  let labels = new Map()
  try {
    labels = new Map((await listModels({ userId, includeDisabled: true })).map((m) => [m.id, m.label]))
  } catch { /* an account without usable providers: no labels */ }
  for (const node of wanted) {
    const label = labels.get(node.data.model)
    if (typeof label === 'string' && label) node.data.modelLabel = label.slice(0, 120)
    else delete node.data.modelLabel
  }
  return nodes
}

/** The copy is resolved against the copier's own providers; the publisher's name for the model does not belong in it. */
function dropModelLabels(nodes) {
  for (const node of nodes) if (node && node.data && typeof node.data === 'object') delete node.data.modelLabel
  return nodes
}

function isActive(doc, now = Date.now()) {
  return !doc.isDeleted && !doc.revoked && (!doc.expiresAt || new Date(doc.expiresAt).getTime() > now)
}

function summary(doc, { owner }) {
  const out = {
    id: owner ? String(doc._id) : doc.token,
    token: doc.token,
    ...(owner ? { workflowId: doc.sourceWorkflowId ? String(doc.sourceWorkflowId) : '' } : {}),
    title: doc.title,
    authorName: '',
    authorAvatar: '',
    thumbnail: doc.thumbnail || '',
    thumbnailType: doc.thumbnailType || '',
    nodeCount: doc.nodeCount || 0,
    stats: { viewCount: (doc.stats && doc.stats.viewCount) || 0, copyCount: (doc.stats && doc.stats.copyCount) || 0, likeCount: 0 },
    expiresAt: doc.expiresAt || null,
    createdAt: doc.createdAt,
  }
  if (owner) {
    out.userId = doc.userId
    out.revoked = !!doc.revoked
    out.active = isActive(doc)
    out.isPublished = out.active
    out.reviewStatus = 'approved'
    out.sourceWorkflowId = doc.sourceWorkflowId ? String(doc.sourceWorkflowId) : ''
    out.updatedAt = doc.updatedAt
  }
  return out
}

/**
 * Expiry from the request: `expiresAt` (date) or `expiresInDays` (number).
 * Returns undefined when neither was sent, null for "never".
 */
function parseExpiry(body) {
  if (body.expiresInDays !== undefined && body.expiresInDays !== null && body.expiresInDays !== '') {
    const days = Number(body.expiresInDays)
    if (!Number.isFinite(days) || days < 0 || days > 3650) throw badRequest('validation.range', { field: 'expiresInDays', min: 0, max: 3650 })
    return days === 0 ? null : new Date(Date.now() + days * 24 * 3600 * 1000)
  }
  if (body.expiresAt === undefined) return undefined
  if (body.expiresAt === null || body.expiresAt === '') return null
  const d = new Date(body.expiresAt)
  if (Number.isNaN(d.getTime())) throw badRequest('validation.bad_date', { field: 'expiresAt' })
  if (d.getTime() <= Date.now()) throw badRequest('share.expires_in_past')
  return d
}

/** GET /api/canvas-share/plaza?page&pageSize - the owner's active links */
router.get('/plaza', requireAuth, wrap(async (req, res) => {
  const { page, pageSize, skip } = pageParams(req.query, { defaultSize: 24, maxSize: 60 })
  const filter = {
    userId: req.userId,
    isDeleted: false,
    revoked: false,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }
  const sort = req.query.sort === 'hot' ? { 'stats.copyCount': -1, 'stats.viewCount': -1, createdAt: -1 } : { createdAt: -1 }
  const [total, list] = await Promise.all([
    Share.countDocuments(filter),
    Share.find(filter).select('-snapshot').sort(sort).skip(skip).limit(pageSize).lean(),
  ])
  ok(res, { list: list.map((d) => summary(d, { owner: true })), total, page, pageSize })
}))

/** GET /api/canvas-share/mine - every link incl. expired and revoked */
router.get('/mine', requireAuth, wrap(async (req, res) => {
  const list = await Share.find({ userId: req.userId, isDeleted: false })
    .select('-snapshot').sort({ createdAt: -1 }).limit(MAX_SHARES).lean()
  ok(res, { list: list.map((d) => summary(d, { owner: true })) })
}))

/**
 * POST /api/canvas-share/publish { workflowId, title?, description?, expiresAt? | expiresInDays? }
 * Publishing the same canvas again refreshes the snapshot and keeps the link,
 * unless that link was revoked - then a new token is issued.
 */
router.post('/publish', requireAuth, wrap(async (req, res) => {
  const body = req.body || {}
  requireObjectId(body.workflowId, 'workflowId')
  const wf = await Workflow.findOne({ _id: body.workflowId, userId: req.userId, isDeleted: false }).lean()
  if (!wf) throw notFound('canvas.not_found')
  const rawNodes = Array.isArray(wf.nodes) ? wf.nodes : []
  if (!rawNodes.length) throw badRequest('share.empty_canvas')
  if (rawNodes.length > MAX_NODES) throw badRequest('canvas.max_nodes', { max: MAX_NODES })

  const nodes = await labelModels(cleanNodes(rawNodes), req.userId)
  const snapshot = {
    nodes,
    edges: structuredClone(Array.isArray(wf.edges) ? wf.edges : []),
    viewport: wf.viewport || { x: 0, y: 0, zoom: 1 },
    settings: wf.settings && typeof wf.settings === 'object' ? structuredClone(wf.settings) : {},
    // Which node sizes the positions were made for: 2 = the current editor. A snapshot without
    // it (published by an earlier version), or of a canvas still waiting for its layout check,
    // counts as an old layout when somebody copies it.
    layoutVersion: (wf.schemaVersion || 0) >= 2 && !wf.legacyLayout ? 2 : 1,
  }
  const fields = {
    title: text(body.title, 80) || wf.name || t(req.locale, 'canvas.untitled'),
    description: text(body.description, 500),
    snapshot,
    nodeCount: nodes.length,
    ...pickThumbnail(nodes),
  }
  const expiry = parseExpiry(body)

  let doc = await Share.findOne({ userId: req.userId, sourceWorkflowId: wf._id, isDeleted: false })
  const updated = !!doc
  if (doc) {
    Object.assign(doc, fields)
    if (expiry !== undefined) doc.expiresAt = expiry
    else if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) doc.expiresAt = null
    if (doc.revoked) {
      doc.revoked = false
      doc.token = randomToken()
    }
    await doc.save()
  } else {
    if ((await Share.countDocuments({ userId: req.userId, isDeleted: false })) >= MAX_SHARES) {
      throw badRequest('share.max', { max: MAX_SHARES })
    }
    doc = await Share.create({
      userId: req.userId,
      token: randomToken(),
      sourceWorkflowId: wf._id,
      expiresAt: expiry === undefined ? null : expiry,
      ...fields,
    })
  }
  ok(res, { id: String(doc._id), token: doc.token, updated, expiresAt: doc.expiresAt || null })
}))

/**
 * Find an active share by its link token - and by nothing else. Database ids
 * are never a way in, signed in or not. Whose link it is does not matter here:
 * the token is the permission.
 */
async function findReadable(req) {
  const token = String(req.params.token || '')
  const doc = TOKEN_RE.test(token) ? await Share.findOne({ token }).lean() : null
  // One message for every failure: do not reveal whether a link ever existed.
  if (!doc || !isActive(doc)) throw notFound(GONE)
  return doc
}

/** GET /api/canvas-share/:token - PUBLIC, read-only snapshot */
router.get('/:token', wrap(async (req, res) => {
  const doc = await findReadable(req)
  Share.updateOne({ _id: doc._id }, { $inc: { 'stats.viewCount': 1 } }, { timestamps: false }).catch(() => {})
  const snap = doc.snapshot || {}
  ok(res, {
    ...summary(doc, { owner: false }),
    description: doc.description || '',
    // Cleaned again on the way out: snapshots stored by earlier versions kept more,
    // and had no display names for their models.
    nodes: await labelModels(cleanNodes(snap.nodes), doc.userId, { onlyMissing: true }),
    edges: snap.edges || [],
    viewport: snap.viewport || { x: 0, y: 0, zoom: 1 },
    settings: snap.settings || {},
  })
}))

/** POST /api/canvas-share/:token/copy { name? } - copy the snapshot into a new canvas of mine */
router.post('/:token/copy', requireAuth, wrap(async (req, res) => {
  const doc = await findReadable(req)
  const snap = doc.snapshot || {}
  const nodes = dropModelLabels(cleanNodes(snap.nodes))
  const wf = await Workflow.create({
    userId: req.userId,
    name: (text(req.body && req.body.name, 80) || t(req.locale, 'share.copy_name', { name: doc.title || t(req.locale, 'canvas.untitled') })).slice(0, 80),
    nodes,
    edges: structuredClone(Array.isArray(snap.edges) ? snap.edges : []),
    viewport: snap.viewport || { x: 0, y: 0, zoom: 1 },
    settings: snap.settings && typeof snap.settings === 'object' ? structuredClone(snap.settings) : {},
    schemaVersion: CURRENT_SCHEMA_VERSION,
    // Positions from before the redesign: the editor checks them once when the copy is opened.
    legacyLayout: snap.layoutVersion !== 2 && nodes.length > 1,
    ...pickThumbnail(nodes),
  })
  ok(res, { workflowId: String(wf._id), isOwn: true })
}))

async function findOwned(req) {
  requireObjectId(req.params.id)
  const doc = await Share.findOne({ _id: req.params.id, userId: req.userId, isDeleted: false })
  if (!doc) throw notFound('share.not_found')
  return doc
}

/** PUT /api/canvas-share/:id { title?, description?, expiresAt? | expiresInDays?, revoked? } */
router.put('/:id', requireAuth, wrap(async (req, res) => {
  const doc = await findOwned(req)
  const body = req.body || {}
  if (body.title !== undefined) {
    const title = text(body.title, 80)
    if (!title) throw badRequest('share.title_required')
    doc.title = title
  }
  if (body.description !== undefined) doc.description = text(body.description, 500)
  const expiry = parseExpiry(body)
  if (expiry !== undefined) doc.expiresAt = expiry
  if (body.revoked !== undefined) {
    if (typeof body.revoked !== 'boolean') throw badRequest('validation.boolean', { field: 'revoked' })
    // Un-revoking issues a new token: whoever held the old link stays locked out.
    if (doc.revoked && !body.revoked) doc.token = randomToken()
    doc.revoked = body.revoked
  }
  await doc.save()
  ok(res, summary(doc.toObject(), { owner: true }))
}))

/** POST /api/canvas-share/:id/revoke - the link stops working immediately */
router.post('/:id/revoke', requireAuth, wrap(async (req, res) => {
  const doc = await findOwned(req)
  doc.revoked = true
  await doc.save()
  ok(res, summary(doc.toObject(), { owner: true }))
}))

/**
 * DELETE /api/canvas-share/:id
 * First call revokes the link (it stays in "mine", marked revoked, so the
 * owner can see what was shared). Deleting an already revoked link removes it.
 */
router.delete('/:id', requireAuth, wrap(async (req, res) => {
  const doc = await findOwned(req)
  if (doc.revoked) doc.isDeleted = true
  doc.revoked = true
  await doc.save()
  ok(res, { id: String(doc._id), revoked: true, removed: doc.isDeleted })
}))

module.exports = router
