'use strict'

/**
 * /api/canvas-share - read-only share links.
 *
 * Publishing snapshots a canvas and returns a link addressed by a long random
 * token. Links can expire and be revoked. Reading a link is the only public
 * operation; everything else belongs to the owner.
 *
 * Paths follow the original canvas frontend (plaza / mine / publish / :id /
 * :id/copy / DELETE :id). There is no public gallery in a single-user
 * install, so `plaza` lists the owner's own active links.
 */
const express = require('express')
const Workflow = require('../models/Workflow')
const Share = require('../models/Share')
const { pickThumbnail, cleanNodes } = require('../services/canvasGraph')
const { CURRENT_SCHEMA_VERSION } = require('../utils/workflowSchema')
const { randomToken } = require('../utils/crypto')
const { requireAuth, isAuthed } = require('../middleware/auth')
const { ok, wrap, badRequest, notFound } = require('../utils/http')
const { requireObjectId, isObjectId, pageParams, text } = require('../utils/validate')
const { t } = require('../i18n')
const { LOCAL_USER } = require('../constants')

const router = express.Router()

const MAX_NODES = 500
const MAX_SHARES = 500
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/
const GONE = 'share.gone'

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
    userId: LOCAL_USER,
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
router.get('/mine', requireAuth, wrap(async (_req, res) => {
  const list = await Share.find({ userId: LOCAL_USER, isDeleted: false })
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
  const wf = await Workflow.findOne({ _id: body.workflowId, userId: LOCAL_USER, isDeleted: false }).lean()
  if (!wf) throw notFound('canvas.not_found')
  const rawNodes = Array.isArray(wf.nodes) ? wf.nodes : []
  if (!rawNodes.length) throw badRequest('share.empty_canvas')
  if (rawNodes.length > MAX_NODES) throw badRequest('canvas.max_nodes', { max: MAX_NODES })

  const nodes = cleanNodes(rawNodes)
  const snapshot = {
    nodes,
    edges: structuredClone(Array.isArray(wf.edges) ? wf.edges : []),
    viewport: wf.viewport || { x: 0, y: 0, zoom: 1 },
    settings: wf.settings && typeof wf.settings === 'object' ? structuredClone(wf.settings) : {},
  }
  const fields = {
    title: text(body.title, 80) || wf.name || t(req.locale, 'canvas.untitled'),
    description: text(body.description, 500),
    snapshot,
    nodeCount: nodes.length,
    ...pickThumbnail(nodes),
  }
  const expiry = parseExpiry(body)

  let doc = await Share.findOne({ userId: LOCAL_USER, sourceWorkflowId: wf._id, isDeleted: false })
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
    if ((await Share.countDocuments({ userId: LOCAL_USER, isDeleted: false })) >= MAX_SHARES) {
      throw badRequest('share.max', { max: MAX_SHARES })
    }
    doc = await Share.create({
      userId: LOCAL_USER,
      token: randomToken(),
      sourceWorkflowId: wf._id,
      expiresAt: expiry === undefined ? null : expiry,
      ...fields,
    })
  }
  ok(res, { id: String(doc._id), token: doc.token, updated, expiresAt: doc.expiresAt || null })
}))

/**
 * Find a share by link token. The database id is accepted too, but only from
 * the owner, so ids seen elsewhere never work as public links.
 */
async function findReadable(req) {
  const ref = String(req.params.ref || '')
  if (TOKEN_RE.test(ref)) {
    const doc = await Share.findOne({ token: ref }).lean()
    if (doc && isActive(doc)) return { doc, owner: false }
  }
  if (isObjectId(ref) && isAuthed(req)) {
    const doc = await Share.findOne({ _id: ref, userId: LOCAL_USER, isDeleted: false }).lean()
    if (doc) return { doc, owner: true }
  }
  // One message for every failure: do not reveal whether a link ever existed.
  throw notFound(GONE)
}

/** GET /api/canvas-share/:token - PUBLIC, read-only snapshot */
router.get('/:ref', wrap(async (req, res) => {
  const { doc, owner } = await findReadable(req)
  if (!owner) Share.updateOne({ _id: doc._id }, { $inc: { 'stats.viewCount': 1 } }, { timestamps: false }).catch(() => {})
  const snap = doc.snapshot || {}
  ok(res, {
    ...summary(doc, { owner }),
    description: doc.description || '',
    nodes: snap.nodes || [],
    edges: snap.edges || [],
    viewport: snap.viewport || { x: 0, y: 0, zoom: 1 },
    settings: snap.settings || {},
  })
}))

/** POST /api/canvas-share/:token/copy { name? } - copy the snapshot into a new canvas of mine */
router.post('/:ref/copy', requireAuth, wrap(async (req, res) => {
  const { doc } = await findReadable(req)
  const snap = doc.snapshot || {}
  const nodes = cleanNodes(snap.nodes)
  const wf = await Workflow.create({
    userId: LOCAL_USER,
    name: (text(req.body && req.body.name, 80) || t(req.locale, 'share.copy_name', { name: doc.title || t(req.locale, 'canvas.untitled') })).slice(0, 80),
    nodes,
    edges: structuredClone(Array.isArray(snap.edges) ? snap.edges : []),
    viewport: snap.viewport || { x: 0, y: 0, zoom: 1 },
    settings: snap.settings && typeof snap.settings === 'object' ? structuredClone(snap.settings) : {},
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...pickThumbnail(nodes),
  })
  ok(res, { workflowId: String(wf._id), isOwn: true })
}))

async function findOwned(id) {
  requireObjectId(id)
  const doc = await Share.findOne({ _id: id, userId: LOCAL_USER, isDeleted: false })
  if (!doc) throw notFound('share.not_found')
  return doc
}

/** PUT /api/canvas-share/:id { title?, description?, expiresAt? | expiresInDays?, revoked? } */
router.put('/:id', requireAuth, wrap(async (req, res) => {
  const doc = await findOwned(req.params.id)
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
  const doc = await findOwned(req.params.id)
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
  const doc = await findOwned(req.params.id)
  if (doc.revoked) doc.isDeleted = true
  doc.revoked = true
  await doc.save()
  ok(res, { id: String(doc._id), revoked: true, removed: doc.isDeleted })
}))

module.exports = router
