'use strict'

/**
 * Asset libraries.
 *   /api/user-asset    the user's own library (editable)
 *   /api/canvas-asset  the read-only stock library (empty unless imported)
 * Response shapes follow the original canvas frontend.
 */
const express = require('express')
const { UserAsset, CanvasAsset, USER_ASSET_KINDS } = require('../models/Asset')
const { ok, wrap, badRequest, notFound } = require('../utils/http')
const { requireObjectId, pageParams, isMediaUrl, escapeRegExp, text } = require('../utils/validate')
const { LOCAL_USER } = require('../constants')
const sharp = require('sharp')
const { loadImage } = require('../services/media')

/** Fill in width/height/aspectRatio for an image registered without them. Best effort. */
async function withDimensions(fields) {
  if (fields.nodeType !== 'IMAGE' || (fields.width && fields.height)) return fields
  try {
    const { buffer } = await loadImage(fields.mediaUrl, { timeoutMs: 15000 })
    const m = await sharp(buffer).metadata()
    const rotated = m.orientation && m.orientation >= 5
    const width = (rotated ? m.height : m.width) || 0
    const height = (rotated ? m.width : m.height) || 0
    if (width && height) {
      const gcd = (a, b) => (b ? gcd(b, a % b) : a)
      const g = gcd(width, height)
      const ratio = width / g <= 32 && height / g <= 32 ? `${width / g}:${height / g}` : ''
      return { ...fields, width, height, aspectRatio: fields.aspectRatio || ratio }
    }
  } catch { /* unknown dimensions are fine */ }
  return fields
}

/** Per-kind cap, to keep one runaway script from filling the library. */
const LIMIT_PER_KIND = 5000

const live = { userId: LOCAL_USER, isDeleted: false }

function tagsOf(v) {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((t) => typeof t === 'string').map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20)
}

/** Both id spellings and both timestamp spellings: old and new clients read the same object. */
function serializeUserAsset(d) {
  return {
    id: String(d._id),
    _id: String(d._id),
    userId: d.userId,
    scope: 'personal',
    kind: d.kind,
    nodeType: d.nodeType,
    name: d.name || '',
    folder: d.folder || '',
    tags: d.tags || [],
    mediaUrl: d.mediaUrl,
    thumbnailUrl: d.thumbnailUrl || d.mediaUrl,
    width: d.width || 0,
    height: d.height || 0,
    aspectRatio: d.aspectRatio || '',
    source: d.source,
    fromFlowId: d.fromFlowId || '',
    fromProduct: d.fromProduct || '',
    mine: true,
    canManage: true,
    uploaderName: '',
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  }
}

function mediaFields(b) {
  const mediaUrl = typeof b.mediaUrl === 'string' ? b.mediaUrl.trim() : ''
  if (!isMediaUrl(mediaUrl)) throw badRequest('缺少有效的媒体地址')
  const thumb = typeof b.thumbnailUrl === 'string' ? b.thumbnailUrl.trim() : ''
  if (thumb && !isMediaUrl(thumb)) throw badRequest('缩略图地址无效')
  const dim = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.min(100000, Math.round(Number(v))) : 0)
  return {
    mediaUrl,
    thumbnailUrl: thumb || mediaUrl,
    nodeType: b.nodeType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    width: dim(b.width),
    height: dim(b.height),
    aspectRatio: text(b.aspectRatio, 20),
    folder: text(b.folder, 120),
    tags: tagsOf(b.tags),
  }
}

async function assertRoom(kind) {
  if ((await UserAsset.countDocuments({ ...live, kind })) >= LIMIT_PER_KIND) {
    throw badRequest(`该分类已达上限（${LIMIT_PER_KIND} 项），请先清理`)
  }
}

function userAssetRouter() {
  const router = express.Router()

  /** GET /api/user-asset/list?kind&folder&tag&search&page&pageSize */
  router.get('/list', wrap(async (req, res) => {
    const { page, pageSize, skip } = pageParams(req.query, { defaultSize: 60, maxSize: 200 })
    const q = req.query
    const kind = USER_ASSET_KINDS.includes(q.kind) ? q.kind : null
    const query = { ...live }
    if (kind) query.kind = kind
    if (typeof q.folder === 'string' && q.folder) query.folder = q.folder.slice(0, 120)
    if (typeof q.tag === 'string' && q.tag) query.tags = q.tag.slice(0, 40)
    if (typeof q.search === 'string' && q.search.trim()) {
      query.name = new RegExp(escapeRegExp(q.search.trim().slice(0, 60)), 'i')
    }
    const [total, docs, folders, kindCount] = await Promise.all([
      UserAsset.countDocuments(query),
      UserAsset.find(query).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      UserAsset.distinct('folder', { ...live, folder: { $ne: '' } }),
      UserAsset.countDocuments({ ...live, kind: kind || 'product' }),
    ])
    ok(res, {
      list: docs.map(serializeUserAsset),
      folders: folders.sort(),
      kindCount,
      limit: LIMIT_PER_KIND,
      isTeamManager: false,
      pagination: { total, page, pageSize },
    })
  }))

  /** POST /api/user-asset - register an uploaded file (metadata only) */
  router.post('/', wrap(async (req, res) => {
    const b = req.body || {}
    const kind = USER_ASSET_KINDS.includes(b.kind) ? b.kind : 'product'
    const fields = await withDimensions(mediaFields(b))
    await assertRoom(kind)
    const doc = await UserAsset.create({ userId: LOCAL_USER, kind, name: text(b.name, 300), source: 'upload', ...fields })
    ok(res, serializeUserAsset(doc.toObject()))
  }))

  /** POST /api/user-asset/register-output - save a generated result to the library */
  router.post('/register-output', wrap(async (req, res) => {
    const b = req.body || {}
    const fields = await withDimensions(mediaFields(b))
    await assertRoom('output')
    const doc = await UserAsset.create({
      userId: LOCAL_USER,
      kind: 'output',
      name: text(b.name, 300) || '成品',
      source: 'generated',
      fromFlowId: text(b.fromFlowId, 100),
      fromProduct: text(b.fromProduct, 100),
      ...fields,
    })
    ok(res, serializeUserAsset(doc.toObject()))
  }))

  /** POST /api/user-asset/folder/delete { name } - dissolve a folder, keep its assets */
  router.post('/folder/delete', wrap(async (req, res) => {
    const name = text(req.body && req.body.name, 120)
    if (!name) throw badRequest('缺少分组名')
    const r = await UserAsset.updateMany({ ...live, folder: name }, { $set: { folder: '' } })
    ok(res, { moved: r.modifiedCount || 0 })
  }))

  /** PUT /api/user-asset/:id - rename / move / retag / change kind */
  router.put('/:id', wrap(async (req, res) => {
    requireObjectId(req.params.id)
    const b = req.body || {}
    const set = {}
    if (typeof b.name === 'string') set.name = b.name.trim().slice(0, 300)
    if (typeof b.folder === 'string') set.folder = b.folder.trim().slice(0, 120)
    if (Array.isArray(b.tags)) set.tags = tagsOf(b.tags)
    if (USER_ASSET_KINDS.includes(b.kind)) set.kind = b.kind
    const doc = await UserAsset.findOneAndUpdate({ _id: req.params.id, ...live }, { $set: set }, { new: true }).lean()
    if (!doc) throw notFound('资产不存在')
    ok(res, serializeUserAsset(doc))
  }))

  /** DELETE /api/user-asset/:id - soft delete; the file itself is kept (canvases may still use it) */
  router.delete('/:id', wrap(async (req, res) => {
    requireObjectId(req.params.id)
    const doc = await UserAsset.findOneAndUpdate({ _id: req.params.id, ...live }, { $set: { isDeleted: true } }).lean()
    if (!doc) throw notFound('资产不存在')
    ok(res, { id: String(doc._id) })
  }))

  return router
}

function canvasAssetRouter() {
  const router = express.Router()
  const published = { isDeleted: false, isPublished: true }

  /** GET /api/canvas-asset/categories -> [{ code, name, count }] */
  router.get('/categories', wrap(async (_req, res) => {
    const rows = await CanvasAsset.aggregate([
      { $match: published },
      { $group: { _id: '$code', name: { $first: '$categoryName' }, count: { $sum: 1 }, order: { $min: '$order' } } },
      { $sort: { order: 1, _id: 1 } },
    ])
    ok(res, rows.map((r) => ({ code: r._id || '', name: r.name || r._id || '', count: r.count })))
  }))

  /** GET /api/canvas-asset/list?code&nodeType&page&pageSize */
  router.get('/list', wrap(async (req, res) => {
    const { page, pageSize, skip } = pageParams(req.query, { defaultSize: 20, maxSize: 50 })
    const filter = { ...published }
    if (typeof req.query.code === 'string' && req.query.code) filter.code = req.query.code.slice(0, 60)
    if (['IMAGE', 'VIDEO'].includes(req.query.nodeType)) filter.nodeType = req.query.nodeType
    const [total, list] = await Promise.all([
      CanvasAsset.countDocuments(filter),
      CanvasAsset.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    ])
    ok(res, {
      list: list.map((d) => ({
        id: String(d._id),
        name: d.name || '',
        code: d.code || '',
        categoryName: d.categoryName || '',
        nodeType: d.nodeType || 'IMAGE',
        mediaUrl: d.mediaUrl || '',
        thumbnailUrl: d.thumbnailUrl || '',
        width: d.width || 0,
        height: d.height || 0,
        aspectRatio: d.aspectRatio || '',
      })),
      total,
      page,
      pageSize,
    })
  }))

  return router
}

module.exports = { userAssetRouter, canvasAssetRouter }
