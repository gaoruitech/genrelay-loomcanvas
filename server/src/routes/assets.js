'use strict'

/**
 * Asset libraries.
 *   /api/user-asset    the library of the space the request acts in: the caller's own in
 *                      a personal space; in a team the team's, which every member sees,
 *                      uses and adds to (each edits or deletes what they added, the
 *                      owner and admins anything)
 *   /api/canvas-asset  the read-only stock library of the site (empty unless imported)
 * Response shapes follow the original canvas frontend.
 */
const express = require('express')
const { UserAsset, UserAssetFolder, CanvasAsset, USER_ASSET_KINDS } = require('../models/Asset')
const { ok, wrap, badRequest, notFound } = require('../utils/http')
const { requireObjectId, pageParams, isMediaUrl, escapeRegExp, text } = require('../utils/validate')
const { t } = require('../i18n')
const sharp = require('sharp')
const { loadImage } = require('../services/media')
const spaces = require('../services/spaces')
const permissions = require('../services/permissions')
const { createCopier } = require('../services/spaceCopy')
const { ApiError } = require('../utils/http')

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
/** How many folders one library may have. */
const MAX_FOLDERS = 500

// Folders belong to their space like everything else in the library: removing an account or
// a team walks accounts.OWNED, so the folders are entered there. (Done from here because the
// list lives in a file this one does not own; the entry belongs in the list itself.)
{
  const { OWNED } = require('../services/accounts')
  if (!OWNED.some((entry) => entry.model === UserAssetFolder)) OWNED.push({ model: UserAssetFolder })
}

/** The space's assets that are not deleted: the base of every query below. */
const live = (req) => ({ userId: req.spaceId, isDeleted: false })
/** May the caller edit or delete this asset? Their own always; in a team the managers any. */
const canManage = (req, d) => !spaces.isTeam(req) || permissions.creatorOf(d) === req.userId || permissions.can(req.space, 'asset:manage_all')

function tagsOf(v) {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((t) => typeof t === 'string').map((t) => t.trim().slice(0, 40)).filter(Boolean))].slice(0, 20)
}

/** Both id spellings and both timestamp spellings: old and new clients read the same object. */
function serializeUserAsset(req, d, names) {
  const team = spaces.isTeam(req)
  const uploader = team && names ? spaces.personOf(names, permissions.creatorOf(d)) : null
  return {
    id: String(d._id),
    _id: String(d._id),
    userId: d.userId,
    scope: team ? 'team' : 'personal',
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
    mine: !team || permissions.creatorOf(d) === req.userId,
    canManage: canManage(req, d),
    uploaderName: uploader ? uploader.name : '',
    // In a team: who added it ({ id, name, username, left, deleted }).
    createdBy: uploader,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  }
}

/* ------------------------------------------------------------- folders */

/*
 * An asset says which folder it is in (`folder`); a folder exists from the
 * moment it is created or first named by an asset until it is deleted - also
 * while nothing is in it. UserAssetFolder holds the folders as such; folders
 * from before it existed are entered the first time the library is listed.
 */

function folderName(v) {
  const name = text(v, 120)
  if (!name) throw badRequest('asset.folder_required')
  return name
}

/** Make sure the folder an asset was just put into exists by itself. Never fails the request it belongs to. */
async function ensureFolder(req, name) {
  if (!name) return
  try {
    await UserAssetFolder.updateOne({ userId: req.spaceId, name }, { $setOnInsert: { createdBy: req.userId } }, { upsert: true })
  } catch (err) {
    if (!err || err.code !== 11000) console.error('[assets] folder could not be recorded:', err && err.message)
  }
}

/** Who may delete a folder: anybody in their own space; in a team the owner and admins, and whoever created it. */
const canDeleteFolder = (req, row) => !spaces.isTeam(req) || permissions.can(req.space, 'asset:manage_all') || (!!row && !!row.createdBy && row.createdBy === req.userId)

/**
 * The folders of the space, by name: [{ name, count, empty, canDelete }].
 * `count`: the assets in it, of every kind. `canDelete`: the caller may delete
 * it AND it is empty - what DELETE /folder would answer.
 */
async function listFolders(req) {
  const [rows, used] = await Promise.all([
    UserAssetFolder.find({ userId: req.spaceId }).select('name createdBy').lean(),
    UserAsset.aggregate([{ $match: { ...live(req), folder: { $ne: '' } } }, { $group: { _id: '$folder', n: { $sum: 1 } } }]),
  ])
  const byName = new Map(rows.map((r) => [r.name, r]))
  // Folders from before they were kept by themselves: entered now, so they too stay when they are emptied.
  const missing = used.filter((u) => u._id && !byName.has(u._id))
  if (missing.length) {
    await UserAssetFolder.insertMany(missing.map((u) => ({ userId: req.spaceId, name: u._id, createdBy: '' })), { ordered: false }).catch(() => {})
    for (const u of missing) byName.set(u._id, { name: u._id, createdBy: '' })
  }
  const counts = new Map(used.map((u) => [u._id, u.n]))
  return [...byName.values()]
    .map((row) => {
      const count = counts.get(row.name) || 0
      return { name: row.name, count, empty: count === 0, canDelete: count === 0 && canDeleteFolder(req, row) }
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

function mediaFields(b) {
  const mediaUrl = typeof b.mediaUrl === 'string' ? b.mediaUrl.trim() : ''
  if (!isMediaUrl(mediaUrl)) throw badRequest('asset.media_url_required')
  const thumb = typeof b.thumbnailUrl === 'string' ? b.thumbnailUrl.trim() : ''
  if (thumb && !isMediaUrl(thumb)) throw badRequest('asset.bad_thumbnail')
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

async function assertRoom(req, kind) {
  if ((await UserAsset.countDocuments({ ...live(req), kind })) >= LIMIT_PER_KIND) {
    throw badRequest('asset.kind_full', { max: LIMIT_PER_KIND })
  }
}

/** One asset as the API returns it, with who added it when the space is a team. */
async function one(req, d) {
  const names = spaces.isTeam(req) ? await spaces.people([permissions.creatorOf(d)], req.spaceId) : null
  return serializeUserAsset(req, d, names)
}

/** The asset in the path, if the caller may change it: 404 when it is not in this space, 403 when it is somebody else's. */
async function findManageable(req) {
  requireObjectId(req.params.id)
  const doc = await UserAsset.findOne({ _id: req.params.id, ...live(req) }).lean()
  if (!doc) throw notFound('asset.not_found')
  if (!canManage(req, doc)) throw new ApiError(403, 'team.forbidden')
  return doc
}

function userAssetRouter() {
  const router = express.Router()

  /** GET /api/user-asset/list?kind&folder&tag&search&page&pageSize */
  router.get('/list', wrap(async (req, res) => {
    const { page, pageSize, skip } = pageParams(req.query, { defaultSize: 60, maxSize: 200 })
    const q = req.query
    const kind = USER_ASSET_KINDS.includes(q.kind) ? q.kind : null
    const query = { ...live(req) }
    if (kind) query.kind = kind
    if (typeof q.folder === 'string' && q.folder) query.folder = q.folder.slice(0, 120)
    if (typeof q.tag === 'string' && q.tag) query.tags = q.tag.slice(0, 40)
    if (typeof q.search === 'string' && q.search.trim()) {
      query.name = new RegExp(escapeRegExp(q.search.trim().slice(0, 60)), 'i')
    }
    const [total, docs, folderList, kindCount] = await Promise.all([
      UserAsset.countDocuments(query),
      UserAsset.find(query).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      listFolders(req),
      UserAsset.countDocuments({ ...live(req), kind: kind || 'product' }),
    ])
    const names = spaces.isTeam(req) ? await spaces.people(docs.map(permissions.creatorOf), req.spaceId) : null
    ok(res, {
      list: docs.map((d) => serializeUserAsset(req, d, names)),
      // Every folder of the library by name, empty ones included; `folderList` says how full each is.
      folders: folderList.map((f) => f.name),
      folderList,
      kindCount,
      limit: LIMIT_PER_KIND,
      isTeamManager: spaces.isTeam(req) && spaces.isManager(req.space),
      pagination: { total, page, pageSize },
    })
  }))

  /** POST /api/user-asset - register an uploaded file (metadata only) */
  router.post('/', wrap(async (req, res) => {
    const b = req.body || {}
    const kind = USER_ASSET_KINDS.includes(b.kind) ? b.kind : 'product'
    const fields = await withDimensions(mediaFields(b))
    await assertRoom(req, kind)
    const doc = await UserAsset.create({ userId: req.spaceId, createdBy: req.userId, kind, name: text(b.name, 300), source: 'upload', ...fields })
    await ensureFolder(req, doc.folder)
    ok(res, await one(req, doc.toObject()))
  }))

  /** POST /api/user-asset/register-output - save a generated result to the library */
  router.post('/register-output', wrap(async (req, res) => {
    const b = req.body || {}
    const fields = await withDimensions(mediaFields(b))
    await assertRoom(req, 'output')
    const doc = await UserAsset.create({
      userId: req.spaceId,
      createdBy: req.userId,
      kind: 'output',
      name: text(b.name, 300) || t(req.locale, 'asset.default_output_name'),
      source: 'generated',
      fromFlowId: text(b.fromFlowId, 100),
      fromProduct: text(b.fromProduct, 100),
      ...fields,
    })
    await ensureFolder(req, doc.folder)
    ok(res, await one(req, doc.toObject()))
  }))

  /**
   * POST /api/user-asset/folder { name } -> { name, count, empty, canDelete, existed }
   * Create a folder with nothing in it yet. Every member of a team may. A folder of that name
   * that is already there is answered as it is (`existed: true`), not refused.
   */
  router.post('/folder', wrap(async (req, res) => {
    const name = folderName(req.body && req.body.name)
    const before = (await listFolders(req)).find((f) => f.name === name)
    if (before) return ok(res, { ...before, existed: true })
    if ((await UserAssetFolder.countDocuments({ userId: req.spaceId })) >= MAX_FOLDERS) throw badRequest('asset.folder_max', { max: MAX_FOLDERS })
    await ensureFolder(req, name)
    ok(res, { name, count: 0, empty: true, canDelete: true, existed: false })
  }))

  /**
   * DELETE /api/user-asset/folder?name=<folder> -> { name, deleted: true }
   * Delete an EMPTY folder. A folder that still holds assets is refused with 409
   * `asset.folder_not_empty` (`data.count` says how many): move or delete them first, or
   * dissolve the folder (POST /folder/delete), which keeps them. In a team: the owner and
   * admins, and the member who created the folder (403 `team.forbidden` otherwise).
   */
  router.delete('/folder', wrap(async (req, res) => {
    const name = folderName(req.query.name)
    const [row, count] = await Promise.all([
      UserAssetFolder.findOne({ userId: req.spaceId, name }).lean(),
      UserAsset.countDocuments({ ...live(req), folder: name }),
    ])
    if (!row && !count) throw notFound('asset.folder_not_found')
    if (!canDeleteFolder(req, row)) throw new ApiError(403, 'team.forbidden')
    if (count) throw new ApiError(409, 'asset.folder_not_empty', { name, count }, -1, { name, count })
    await UserAssetFolder.deleteOne({ userId: req.spaceId, name })
    // An asset that was put into it between the count and the delete keeps its folder, and the
    // folder with it: it is entered again the next time the library is listed.
    ok(res, { name, deleted: true })
  }))

  /**
   * POST /api/user-asset/folder/delete { name } -> { moved }
   * Dissolve a folder: the folder goes, its assets stay (outside any folder). In a team: the owner and admins.
   */
  router.post('/folder/delete', spaces.requireCan('asset:manage_all'), wrap(async (req, res) => {
    const name = folderName(req.body && req.body.name)
    const r = await UserAsset.updateMany({ ...live(req), folder: name }, { $set: { folder: '' } })
    await UserAssetFolder.deleteOne({ userId: req.spaceId, name })
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
    await findManageable(req)
    const doc = await UserAsset.findOneAndUpdate({ _id: req.params.id, ...live(req) }, { $set: set }, { new: true }).lean()
    if (!doc) throw notFound('asset.not_found')
    if (set.folder) await ensureFolder(req, set.folder)
    ok(res, await one(req, doc))
  }))

  /**
   * POST /api/user-asset/:id/copy { toSpace: 'personal' | <team id> } - copy an asset into another
   * space the caller is in. The file is duplicated under the target space, not referenced.
   */
  router.post('/:id/copy', wrap(async (req, res) => {
    requireObjectId(req.params.id)
    const src = await UserAsset.findOne({ _id: req.params.id, ...live(req) }).lean()
    if (!src) throw notFound('asset.not_found')
    const body = req.body || {}
    const target = await spaces.resolve(req.userId, body.toSpace === undefined ? spaces.PERSONAL : body.toSpace)
    if (target.id === req.spaceId) throw badRequest('space.same_space')
    if (spaces.isTeam(req) && target.kind !== 'team') {
      const allowed = req.space.role === 'owner' || !req.space.team.settings || req.space.team.settings.copyToPersonal !== false
      if (!allowed) throw new ApiError(403, 'space.copy_out_disabled')
    }
    if ((await UserAsset.countDocuments({ userId: target.id, isDeleted: false, kind: src.kind })) >= LIMIT_PER_KIND) {
      throw badRequest('asset.kind_full', { max: LIMIT_PER_KIND })
    }
    const copier = createCopier(target.id)
    const mediaUrl = await copier.copy(src.mediaUrl)
    const thumbnailUrl = src.thumbnailUrl && src.thumbnailUrl !== src.mediaUrl ? await copier.copy(src.thumbnailUrl) : mediaUrl
    const doc = await UserAsset.create({
      userId: target.id,
      createdBy: req.userId,
      kind: src.kind,
      nodeType: src.nodeType,
      name: src.name || '',
      folder: src.folder || '',
      tags: src.tags || [],
      mediaUrl,
      thumbnailUrl,
      width: src.width || 0,
      height: src.height || 0,
      aspectRatio: src.aspectRatio || '',
      source: src.source,
    })
    // The copy keeps its folder's name; in the target space that folder is the copier's.
    if (doc.folder) {
      await UserAssetFolder.updateOne({ userId: target.id, name: doc.folder }, { $setOnInsert: { createdBy: req.userId } }, { upsert: true }).catch(() => {})
    }
    ok(res, { id: String(doc._id), spaceId: target.kind === 'team' ? target.id : spaces.PERSONAL, mediaUrl, thumbnailUrl })
  }))

  /** DELETE /api/user-asset/:id - soft delete; the file itself is kept (canvases may still use it) */
  router.delete('/:id', wrap(async (req, res) => {
    requireObjectId(req.params.id)
    await findManageable(req)
    const doc = await UserAsset.findOneAndUpdate({ _id: req.params.id, ...live(req) }, { $set: { isDeleted: true } }).lean()
    if (!doc) throw notFound('asset.not_found')
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
