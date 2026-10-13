'use strict'

/**
 * /api/workflow - canvases: list, create, read, save, delete and restore,
 * duplicate, copy to another space, zip export; and for team canvases who may
 * see and edit them, the edit lock and the save-conflict check.
 *
 * Every query carries the id of the space the request acts in (req.spaceId):
 * a canvas of another space is a 404. Inside a team a canvas the caller may
 * not see is a 404 too; one they may see but not change answers 403.
 *
 * Two people never edit one canvas at the same time, and nothing is merged:
 *
 *  - the edit lock (POST/DELETE /:id/lock) lets one editing session - one
 *    browser tab, named by the `sessionId` it sends - edit a team canvas at a
 *    time. It lasts EDIT_LOCK.TTL_MS past the holder's last heartbeat or save;
 *    somebody else who may edit the canvas can take it over, and so can the
 *    same person from another tab;
 *  - every content save names the revision it started from (`baseRevision`).
 *    When the canvas has moved on, the save is refused with 409
 *    `canvas.conflict` and nothing is written. This check does not depend on
 *    the lock: it is what holds when a lock expired or was taken over.
 *
 * Content and metadata are two things:
 *
 *  - content is `nodes`, `edges`, `settings`, `brandKitId`: what the editor
 *    draws. Saving it needs the lock (in a team) and moves `revision`;
 *  - metadata is `name`, `viewport`, `legacyLayout`: saving it needs the right
 *    to edit the canvas and nothing else - no lock, no `baseRevision` - and
 *    never moves `revision`. A change of name (or of the layout flag) moves
 *    `metaRevision` instead, which every lock and save answer carries, so the
 *    editor that holds the lock follows a rename made elsewhere.
 */
const crypto = require('crypto')
const { Transform } = require('stream')
const express = require('express')
const archiver = require('archiver')
const Workflow = require('../models/Workflow')
const BrandKit = require('../models/BrandKit')
const { pickThumbnail, collectNodeMedia } = require('../services/canvasGraph')
const { openStream } = require('../services/media')
const spaces = require('../services/spaces')
const permissions = require('../services/permissions')
const activity = require('../services/activity')
const { createCopier } = require('../services/spaceCopy')
const { migrateWorkflow, normalizeNodeKits, isKitRef, CURRENT_SCHEMA_VERSION } = require('../utils/workflowSchema')
const { ok, wrap, badRequest, notFound, ApiError } = require('../utils/http')
const { requireObjectId, isPlainObject, isMediaUrl } = require('../utils/validate')
const { sniffMime, kindOfMime } = require('../utils/sniff')
const { t, msg, messageOf } = require('../i18n')
const { getConfig } = require('../config')
const { VISIBILITY, EDIT_LOCK } = require('../constants')

const router = express.Router()

const MAX_NAME_LEN = 80
const ZIP_ITEM_MAX_BYTES = 1024 * 1024 * 1024
const MAX_NODES = 500
const MAX_EDGES = 2000
const MAX_LIST = 200
/** What a list card is made of: everything `summary()` reads, and never the nodes. */
const SUMMARY_FIELDS = { name: 1, thumbnail: 1, thumbnailType: 1, createdAt: 1, updatedAt: 1, userId: 1, createdBy: 1, inheritedFrom: 1, visibility: 1, revision: 1, metaRevision: 1, lock: 1, lastEditedBy: 1, lastEditedAt: 1 }
/** GET /locks?since=: at most this many changed (or removed) canvases are itemised; past it the client is told to load the list again. */
const LIST_CHANGES_MAX = 50
/** GET /locks?since=: how far before `since` a change still counts (a write stamped before the last answer and stored after it). */
const LIST_CHANGES_OVERLAP_MS = 2000
const defaultName = (req) => t(req.locale, 'canvas.untitled')
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 }

/**
 * The edit lock. A lock is live until LOCK_TTL_MS after it was last renewed;
 * the editor renews it every LOCK_HEARTBEAT_MS (and every content save renews
 * it too). Why these numbers: see EDIT_LOCK in constants.js.
 */
const LOCK_TTL_MS = EDIT_LOCK.TTL_MS
const LOCK_HEARTBEAT_MS = EDIT_LOCK.HEARTBEAT_MS
/** How long a deleted canvas can be restored. */
const RESTORE_DAYS = 30
const NO_LOCK = { by: '', session: '', at: null, expiresAt: null, prevBy: '', prevSession: '', prevHow: '' }
/** What the editor draws. Saving any of it is a content save: lock, `baseRevision`, `revision` + 1. */
const CONTENT_FIELDS = ['nodes', 'edges', 'settings', 'brandKitId']
/** What a canvas is called and how it is looked at. Saving only these needs neither the lock nor a revision. */
const META_FIELDS = ['name', 'viewport', 'legacyLayout']
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/
const RELEASE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

/** The lock on a canvas if somebody holds it right now, else null. */
function liveLock(doc, now = Date.now()) {
  const lock = doc && doc.lock
  if (!lock || !lock.by || !lock.expiresAt || new Date(lock.expiresAt).getTime() <= now) return null
  return lock
}

/**
 * The editing session a request speaks for: `sessionId`, a random id the
 * client makes up once per tab - in the JSON body of POST / PUT / PATCH, in the
 * query string of GET and DELETE. A body field rather than a header, so that
 * a cross-origin deployment needs no extra allowed header. Absent = '': the
 * one implicit session of an account whose client sends none.
 */
function sessionOf(req) {
  if (req._editSession !== undefined) return req._editSession
  const fromBody = isPlainObject(req.body) ? req.body.sessionId : undefined
  const raw = fromBody !== undefined && fromBody !== null && fromBody !== '' ? fromBody : req.query.sessionId
  let session = ''
  if (raw !== undefined && raw !== null && raw !== '') {
    if (typeof raw !== 'string' || !SESSION_RE.test(raw)) throw badRequest('validation.invalid', { field: 'sessionId' })
    session = raw
  }
  req._editSession = session
  return session
}

/** Is this lock held by this account in this session? */
const holds = (lock, userId, session) => !!lock && lock.by === userId && (lock.session || '') === session
/** Filter matching a stored session id ('' is also how a lock from before sessions reads). */
const sessionIs = (session) => (session ? session : { $in: ['', null] })
/** Filter: nobody holds the lock at `now`. */
const lockFree = (now) => [{ 'lock.by': { $in: ['', null] } }, { 'lock.expiresAt': { $lte: new Date(now) } }, { 'lock.expiresAt': null }]

/**
 * What lets a lock be given back by a request that cannot carry the session
 * token: `navigator.sendBeacon` on pagehide has no Authorization header. It is
 * an HMAC over exactly this lock (canvas, holder, session, the moment it was
 * taken), so it frees this one lock and nothing else, cannot be guessed, and
 * stops meaning anything once the lock has changed hands.
 */
function releaseTokenOf(id, lock) {
  const at = lock && lock.at ? new Date(lock.at).getTime() : 0
  return crypto.createHmac('sha256', getConfig().secretKey)
    .update(`edit-lock-release:${id}:${lock.by}:${lock.session || ''}:${at}`)
    .digest('base64url')
}

/** A lock as a new holder writes it, remembering whom it was taken from. */
function newLock(req, session, now, from, how) {
  const taken = from && from.by && !holds(from, req.userId, session)
  return {
    by: req.userId,
    session,
    at: new Date(now),
    expiresAt: new Date(now + LOCK_TTL_MS),
    prevBy: taken ? from.by : '',
    prevSession: taken ? from.session || '' : '',
    prevHow: taken ? how : '',
  }
}

/**
 * A lock as it is left when its holder gives it back: free, and remembering which session
 * left and when. A content save of that session that was still on its way when its page
 * closed (the editor saves and sends the release beacon in the same instant, and the small
 * beacon often arrives first) is then written without taking the lock again - otherwise the
 * canvas of a tab that no longer exists would read "being edited" for a whole TTL.
 */
const releasedLock = (lock, now = Date.now()) => ({ ...NO_LOCK, at: new Date(now), prevBy: lock.by, prevSession: lock.session || '', prevHow: 'released' })
const RELEASED_GRACE_MS = 30 * 1000
function releasedBy(lock, userId, session, now) {
  return !!lock && !lock.by && lock.prevHow === 'released' && lock.prevBy === userId && (lock.prevSession || '') === session
    && !!lock.at && now - new Date(lock.at).getTime() < RELEASED_GRACE_MS
}

/**
 * What a content save does to the lock, given the lock it saw: `where` narrows the write to
 * "still as seen", `lock` is what to store (undefined: leave it alone).
 */
function lockForSave(req, session, seen, now) {
  const expiresAt = new Date(now + LOCK_TTL_MS)
  // This session's own lock - live, or run out and not taken by anybody since: carried on, as a
  // heartbeat would ("reacquired"); the same lock, so the same release token.
  if (holds(seen, req.userId, session)) {
    return { where: { 'lock.by': req.userId, 'lock.session': sessionIs(session) }, lock: { ...NO_LOCK, ...seen, expiresAt } }
  }
  // This session gave the lock back a moment ago: its last save is written, the canvas stays free.
  if (releasedBy(seen, req.userId, session, now)) return { where: { $or: lockFree(now) }, lock: undefined }
  return { where: { $or: lockFree(now) }, lock: newLock(req, session, now, seen, 'expired') }
}

const idsIn = (doc) => [permissions.creatorOf(doc), doc.lastEditedBy, doc.lock && doc.lock.by, doc.inheritedFrom, doc.deletedBy]

/** Who the accounts mentioned by these canvases are. In a personal space that is one person: no lookup. */
async function namesFor(req, docs) {
  if (!spaces.isTeam(req)) {
    const me = { id: req.userId, username: req.user.username, name: req.user.username, left: false, deleted: false }
    return new Map([[req.userId, me]])
  }
  return spaces.people(docs.flatMap(idsIn), req.spaceId)
}

/** What every canvas answer says about whose it is, who can do what, and who is editing. */
function sharing(req, doc, names) {
  const lock = liveLock(doc)
  const team = spaces.isTeam(req)
  return {
    spaceId: team ? req.spaceId : spaces.PERSONAL,
    // '' in a personal space; private | team_view | team_edit in a team.
    visibility: team ? (doc.visibility || VISIBILITY.PRIVATE) : '',
    createdBy: spaces.personOf(names, team ? permissions.creatorOf(doc) : req.userId),
    revision: doc.revision || 0,
    metaRevision: doc.metaRevision || 0,
    lastEditedBy: doc.lastEditedBy ? spaces.personOf(names, doc.lastEditedBy) : null,
    lastEditedAt: doc.lastEditedAt || null,
    lock: lock ? lockView(req, doc, lock, names) : null,
    access: permissions.canvasAccess(req.space, doc),
  }
}

/**
 * A lock as a client is told about it. `mine`: this very session holds it (the
 * request named it with `sessionId`). `sameUser`: the holder is the caller's
 * account - with `mine: false` that is "you, in another tab". The holder's
 * session id never leaves the server; the release token goes to the holder only.
 */
function lockView(req, doc, lock, names) {
  const mine = holds(lock, req.userId, sessionOf(req))
  return {
    by: spaces.personOf(names, lock.by),
    at: lock.at,
    expiresAt: lock.expiresAt,
    mine,
    sameUser: lock.by === req.userId,
    ...(mine ? { releaseToken: releaseTokenOf(String(doc._id), lock) } : {}),
  }
}

function serialize(req, doc, names) {
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
    ...sharing(req, doc, names),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

const one = async (req, doc) => serialize(req, doc, await namesFor(req, [doc]))

function summary(req, w, names) {
  return {
    id: String(w._id),
    name: w.name,
    thumbnail: w.thumbnail || '',
    thumbnailType: w.thumbnailType || '',
    ...sharing(req, w, names),
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }
}

function parseViewport(v) {
  if (!isPlainObject(v)) throw badRequest('validation.object', { field: 'viewport' })
  const num = (x, dft) => (typeof x === 'number' && Number.isFinite(x) ? x : dft)
  return { x: num(v.x, 0), y: num(v.y, 0), zoom: Math.min(10, Math.max(0.01, num(v.zoom, 1))) }
}

function parseVisibility(v) {
  if (!Object.values(VISIBILITY).includes(v)) throw badRequest('validation.one_of', { field: 'visibility', values: Object.values(VISIBILITY).join(' / ') })
  return v
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
  // only ever looked up among the space's own, so an id from elsewhere means "no kit".
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
 * Load one canvas of the request's space as a plain object at the current
 * schema version, persisting the upgrade when an older document is read.
 * `need`: 'view' (404 when the caller may not see it) or 'edit' (also 403
 * `team.forbidden` when they may see but not change it).
 * Resolves { doc, access }.
 */
async function loadWorkflow(req, id, need = 'view') {
  requireObjectId(id)
  const raw = await Workflow.findOne({ _id: id, userId: req.spaceId, isDeleted: false }).lean()
  if (!raw) throw notFound('canvas.not_found')
  const access = permissions.canvasAccess(req.space, raw)
  // A canvas the caller may not see does not exist as far as they can tell.
  if (!access.canView) throw notFound('canvas.not_found')
  if (need === 'edit' && !access.canEdit) throw new ApiError(403, 'team.forbidden')
  const { doc, changed } = migrateWorkflow(raw)
  if (changed) {
    await Workflow.updateOne({ _id: raw._id, userId: req.spaceId }, {
      $set: {
        nodes: doc.nodes, edges: doc.edges, viewport: doc.viewport, settings: doc.settings,
        brandKitId: doc.brandKitId || '',
        schemaVersion: doc.schemaVersion, legacyLayout: !!doc.legacyLayout,
      },
    }, { timestamps: false })
  }
  return { doc, access }
}

const canvasTarget = (doc) => ({ type: 'canvas', id: doc._id, name: doc.name })

function logActivity(req, type, doc, detail) {
  if (!spaces.isTeam(req)) return null
  return activity.record(req.spaceId, { id: req.userId, name: req.user.username }, type, canvasTarget(doc), detail)
}

/**
 * 423 with who holds the lock, so the editor can say so and offer to take over.
 * `data.lost` tells a session that used to hold this lock how it lost it:
 * 'taken_over' (somebody took it on purpose), 'expired' (it ran out - a tab in
 * the background, a connection that was gone - and somebody else then started
 * editing); null for a session that never held it. `data.lock.sameUser`: the
 * holder is the caller's own account in another tab.
 */
async function lockedError(req, doc) {
  const lock = liveLock(doc)
  // Freed again between the write that failed and this look: nothing to name. The caller tries once more.
  if (!lock) return new ApiError(409, 'canvas.lock_busy')
  const names = await namesFor(req, [doc])
  const session = sessionOf(req)
  const sameUser = lock.by === req.userId
  const wasMine = !!lock.prevBy && lock.prevBy === req.userId && (lock.prevSession || '') === session
  const lost = wasMine ? (lock.prevHow === 'takeover' ? 'taken_over' : 'expired') : null
  const name = spaces.personOf(names, lock.by).name
  // One code for clients to branch on, four sentences for people to read.
  const detail = sameUser
    ? msg(lost === 'taken_over' ? 'canvas.lock_taken_self' : 'canvas.locked_self')
    : msg(lost === 'taken_over' ? 'canvas.lock_taken' : lost === 'expired' ? 'canvas.lock_expired' : 'canvas.locked_other', { name })
  return new ApiError(423, 'canvas.locked', { name, detail }, -1, {
    lock: { by: spaces.personOf(names, lock.by), at: lock.at, expiresAt: lock.expiresAt, mine: false, sameUser },
    canTakeOver: permissions.canvasAccess(req.space, doc).canTakeOver,
    lost,
    ttlMs: LOCK_TTL_MS,
    heartbeatMs: LOCK_HEARTBEAT_MS,
    pollMs: EDIT_LOCK.WAIT_POLL_MS,
  })
}

/**
 * GET /api/workflow/list[?mine=1][&visibility=private|team_view|team_edit][&member=<account id>]
 * The canvases of the space the caller may see, newest first. The filters only
 * narrow that down (they matter in a team; in a personal space every canvas is the caller's).
 */
router.get('/list', wrap(async (req, res) => {
  const filter = { userId: req.spaceId, isDeleted: false }
  const and = []
  const visible = permissions.visibleCanvasFilter(req.space)
  if (visible.$or) and.push(visible)
  if (spaces.isTeam(req)) {
    if (req.query.mine === '1' || req.query.mine === 'true') and.push({ createdBy: req.userId })
    else if (req.query.member !== undefined && req.query.member !== '') and.push({ createdBy: requireObjectId(req.query.member, 'member') })
    if (req.query.visibility !== undefined && req.query.visibility !== '') and.push({ visibility: parseVisibility(req.query.visibility) })
  }
  if (and.length) filter.$and = and
  const list = await Workflow.find(filter, SUMMARY_FIELDS).sort({ createdAt: -1 }).limit(MAX_LIST).lean()
  const names = await namesFor(req, list)
  ok(res, list.map((w) => summary(req, w, names)))
}))

/** `since` of GET /locks: an ISO time or epoch milliseconds - the `now` of the answer before. Absent = undefined. */
function parseSince(v) {
  if (v === undefined || v === null || v === '') return undefined
  const at = typeof v === 'string' && /^\d{1,16}$/.test(v) ? new Date(Number(v)) : new Date(typeof v === 'string' ? v : NaN)
  if (Number.isNaN(at.getTime())) throw badRequest('validation.invalid', { field: 'since' })
  return at
}

/**
 * GET /api/workflow/locks[?since=<time>]
 *   -> { locks: [{ id, lock }], pollMs, now, counts, changed?, removed?, reload? }
 *
 * What a canvas list asks every `pollMs` while it is on screen, instead of
 * loading the whole list again: who is editing what right now (`locks`: the
 * live locks on the canvases of the space the caller may see), and - with
 * `since`, the `now` of the answer before - what else moved on the list since
 * then, so that somebody else's rename, new canvas or deletion shows without a
 * reload:
 *
 *  - `changed`: the canvases the caller may see that were created, renamed,
 *    saved or restored since, as the list gives them (no nodes);
 *  - `removed`: the ids of those that were deleted since;
 *  - `counts`: how many canvases the list would give the caller right now, in
 *    all and per visibility. A change of visibility is not itemised (a canvas
 *    that became private must not be named to those who lost it): a client
 *    whose list disagrees with `counts` after `changed` and `removed` loads
 *    the list again, and so does one that is told `reload: true` (more than
 *    LIST_CHANGES_MAX canvases moved; `changed` and `removed` are left out).
 *
 * One read of the space's canvases with the projection of the list - never
 * their nodes - plus, with `since`, one of the ids deleted since. Bounded by
 * MAX_LIST and LIST_CHANGES_MAX. A personal space has no locks and nobody
 * else: `{ locks: [], pollMs }`.
 */
router.get('/locks', wrap(async (req, res) => {
  if (!spaces.isTeam(req)) return ok(res, { locks: [], pollMs: EDIT_LOCK.LIST_POLL_MS })
  const since = parseSince(req.query.since)
  const now = new Date()
  const filter = { userId: req.spaceId, isDeleted: false }
  const visible = permissions.visibleCanvasFilter(req.space)
  if (visible.$or) filter.$and = [visible]
  // The same canvases, in the same order and under the same cap, as GET /list answers with.
  const list = await Workflow.find(filter, SUMMARY_FIELDS).sort({ createdAt: -1 }).limit(MAX_LIST).lean()
  const counts = { total: list.length, [VISIBILITY.PRIVATE]: 0, [VISIBILITY.TEAM_VIEW]: 0, [VISIBILITY.TEAM_EDIT]: 0 }
  for (const w of list) counts[w.visibility || VISIBILITY.PRIVATE] += 1
  const locked = list.filter((w) => liveLock(w, now.getTime()))

  let moved = []
  let gone = []
  let reload = false
  if (since) {
    // A write stamped just before the answer the client has, but stored just after it was read, must not be lost.
    const from = new Date(since.getTime() - LIST_CHANGES_OVERLAP_MS)
    moved = list.filter((w) => w.updatedAt && new Date(w.updatedAt) > from)
    const deleted = { userId: req.spaceId, isDeleted: true, deletedAt: { $gt: from } }
    if (visible.$or) deleted.$and = [visible]
    gone = await Workflow.find(deleted, { _id: 1 }).limit(LIST_CHANGES_MAX + 1).lean()
    reload = moved.length > LIST_CHANGES_MAX || gone.length > LIST_CHANGES_MAX
    if (reload) { moved = []; gone = [] }
  }
  const who = [...locked.map((w) => w.lock.by), ...moved.flatMap(idsIn)]
  const names = who.length ? await spaces.people(who, req.spaceId) : new Map()
  ok(res, {
    locks: locked.map((w) => ({ id: String(w._id), lock: lockView(req, w, w.lock, names) })),
    pollMs: EDIT_LOCK.LIST_POLL_MS,
    now,
    counts,
    ...(since && !reload ? { changed: moved.map((w) => summary(req, w, names)), removed: gone.map((w) => String(w._id)) } : {}),
    ...(reload ? { reload: true } : {}),
  })
}))

/**
 * GET /api/workflow/trash - canvases deleted in the last RESTORE_DAYS days that the caller may restore.
 * In a team: the owner and admins (an admin sees what they could see before it was deleted).
 */
router.get('/trash', wrap(async (req, res) => {
  spaces.assertCan(req, 'canvas:restore')
  const filter = { userId: req.spaceId, isDeleted: true, deletedAt: { $gt: new Date(Date.now() - RESTORE_DAYS * 24 * 3600 * 1000) } }
  const visible = permissions.visibleCanvasFilter(req.space)
  if (visible.$or) filter.$and = [visible]
  const list = await Workflow.find(filter, { nodes: 0, edges: 0, settings: 0 }).sort({ deletedAt: -1 }).limit(MAX_LIST).lean()
  const names = await namesFor(req, list)
  ok(res, list.map((w) => ({
    ...summary(req, w, names),
    deletedAt: w.deletedAt,
    deletedBy: w.deletedBy ? spaces.personOf(names, w.deletedBy) : null,
    restorableUntil: new Date(new Date(w.deletedAt).getTime() + RESTORE_DAYS * 24 * 3600 * 1000),
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

/** POST /api/workflow { name?, nodes?, edges?, viewport?, settings?, brandKitId?, visibility? } */
router.post('/', wrap(async (req, res) => {
  const body = req.body || {}
  const { legacyLayout: _ignored, ...data } = parseBody(body)
  const nodes = data.nodes || []
  const team = spaces.isTeam(req) ? req.space.team : null
  // A team canvas starts with the visibility its creator names, else with the team's default.
  let visibility = ''
  if (team) {
    visibility = body.visibility === undefined || body.visibility === ''
      ? ((team.settings && team.settings.defaultVisibility) || VISIBILITY.TEAM_VIEW)
      : parseVisibility(body.visibility)
  }
  // A new canvas starts with the space's default brand kit unless the caller says otherwise.
  let brandKitId = data.brandKitId
  if (brandKitId === undefined) {
    const dft = await BrandKit.findOne({ userId: req.spaceId, isDeleted: false, isDefault: true }, { _id: 1 }).lean()
    brandKitId = dft ? String(dft._id) : ''
  }
  const doc = await Workflow.create({
    userId: req.spaceId,
    createdBy: req.userId,
    visibility,
    name: data.name || defaultName(req),
    nodes: normalizeNodeKits(nodes, brandKitId),
    edges: data.edges || [],
    viewport: data.viewport || DEFAULT_VIEWPORT,
    settings: data.settings || {},
    brandKitId,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    ...pickThumbnail(nodes),
  })
  ok(res, await one(req, doc.toObject()))
}))

/** GET /api/workflow/:id */
router.get('/:id', wrap(async (req, res) => {
  const { doc } = await loadWorkflow(req, req.params.id)
  ok(res, await one(req, doc))
}))

/** A revision from a request body: a whole number, or undefined when absent. */
function parseRevision(v) {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) throw badRequest('validation.invalid', { field: 'baseRevision' })
  return v
}

/**
 * PUT /api/workflow/:id { ...fields, baseRevision?, force?, sessionId? } - partial save.
 *
 * What the body carries decides what kind of save it is:
 *
 * A CONTENT save carries any of `nodes`, `edges`, `settings`, `brandKitId`.
 * It raises the canvas's `revision` by one and answers with the new value.
 * With `baseRevision` - the revision the client's copy started from - it only
 * goes through while the canvas is still at that revision; otherwise nothing
 * is written and the answer is 409 `canvas.conflict` with, in `data`, the
 * current revision, who saved it and when, and whether this caller may
 * overwrite (`force: true` skips the check for those who may).
 *
 *  - In a team space a content save MUST carry `baseRevision`, and is refused
 *    with 423 `canvas.locked` while another editing session holds the edit
 *    lock - somebody else, or the same account in another tab. A save that
 *    goes through takes or renews the lock for the caller's session.
 *  - In a personal space `baseRevision` is optional: without it the save is
 *    the last-write-wins it always was, which is what the stand-alone editor
 *    adapter relies on.
 *
 * A client must not have two content saves of one canvas in flight: the
 * second would name a revision the first is about to replace.
 *
 * A METADATA save carries only `name`, `viewport`, `legacyLayout`. It needs
 * the right to edit the canvas and nothing else: no lock is asked for or
 * taken, `baseRevision` is not looked at, `revision` stays - so a canvas can
 * be renamed while somebody is editing it, and that editor's next save is not
 * a conflict because of it. A new name (or a cleared layout flag) raises
 * `metaRevision`; the viewport raises nothing and leaves `updatedAt` alone,
 * so looking at a canvas does not move it to the top of "recently edited".
 *
 * A save that carries both is a content save whose metadata goes along.
 * Editors should not send `name` with their content saves unless the name was
 * changed in that very editor: the stored name may be newer than theirs.
 */
async function saveCanvas(req, res, { metaOnly = false } = {}) {
  requireObjectId(req.params.id)
  const body = req.body || {}
  const data = parseBody(body)
  const isContent = CONTENT_FIELDS.some((k) => data[k] !== undefined)
  if (metaOnly && isContent) throw badRequest('canvas.meta_only', { fields: META_FIELDS.join(', ') })
  const baseRevision = parseRevision(body.baseRevision)
  const force = body.force === true
  const team = spaces.isTeam(req)
  const session = sessionOf(req)
  const { doc: current, access } = await loadWorkflow(req, req.params.id, 'edit')
  const now = Date.now()

  const held = liveLock(current, now)
  if (isContent) {
    if (team && held && !holds(held, req.userId, session)) throw await lockedError(req, current)
    if (team && baseRevision === undefined && !force) throw badRequest('canvas.base_revision_required')
  }
  if (force && !access.canOverwrite) throw new ApiError(403, 'team.forbidden')

  const set = { ...data }
  if (data.nodes) {
    Object.assign(set, pickThumbnail(data.nodes))
    // The client always writes the current shape.
    set.schemaVersion = CURRENT_SCHEMA_VERSION
    // Writing nodes stamps the document as current; `current` was brought up to date by
    // loadWorkflow, so nodes that arrive in the earlier shape are folded against the kit
    // the canvas will have.
    set.nodes = normalizeNodeKits(data.nodes, data.brandKitId !== undefined ? data.brandKitId : current.brandKitId)
  }
  // Nothing to write: answer with the canvas as it is.
  if (!Object.keys(set).length) return ok(res, await one(req, current))

  const renamed = data.name !== undefined && data.name !== current.name
  const metaChanged = renamed || (data.legacyLayout === false && !!current.legacyLayout)
  const filter = { _id: req.params.id, userId: req.spaceId, isDeleted: false }
  const update = { $set: set }
  const inc = {}
  if (metaChanged) inc.metaRevision = 1
  if (isContent) {
    if (baseRevision !== undefined && !force) filter.revision = baseRevision === 0 ? { $in: [0, null] } : baseRevision
    inc.revision = 1
    set.lastEditedBy = req.userId
    set.lastEditedAt = new Date(now)
  }
  if (Object.keys(inc).length) update.$inc = inc

  // Panning, zooming and ticking off the old layout are not edits: they leave updatedAt alone.
  const write = (seenLock) => {
    const where = { ...filter }
    const fields = { ...set }
    if (team && isContent) {
      // No other session may have taken the lock between the look and this write.
      const plan = lockForSave(req, session, seenLock, Date.now())
      Object.assign(where, plan.where)
      if (plan.lock) fields.lock = plan.lock
    }
    return Workflow.findOneAndUpdate(where, { ...update, $set: fields }, { new: true, timestamps: isContent || renamed }).lean()
  }
  let doc = await write(current.lock)
  if (!doc) {
    // Something changed under this save. Say what: gone, locked by another session, or moved on.
    const latest = await Workflow.findOne({ _id: req.params.id, userId: req.spaceId, isDeleted: false }).lean()
    if (!latest) throw notFound('canvas.not_found')
    const other = liveLock(latest)
    if (team && isContent && other && !holds(other, req.userId, session)) throw await lockedError(req, latest)
    // Only the lock moved, and not to somebody else (this session's page closed and gave it
    // back, most of all): once more, with the lock as it is now. A revision that moved misses again.
    if (team && isContent) doc = await write(latest.lock)
  }
  if (!doc) {
    const latest = await Workflow.findOne({ _id: req.params.id, userId: req.spaceId, isDeleted: false }).lean()
    if (!latest) throw notFound('canvas.not_found')
    const names = await namesFor(req, [latest])
    throw new ApiError(409, 'canvas.conflict', {}, -1, {
      revision: latest.revision || 0,
      baseRevision,
      updatedAt: latest.updatedAt,
      lastEditedAt: latest.lastEditedAt || latest.updatedAt,
      lastEditedBy: latest.lastEditedBy ? spaces.personOf(names, latest.lastEditedBy) : null,
      canOverwrite: permissions.canvasAccess(req.space, latest).canOverwrite,
    })
  }
  if (force && isContent && baseRevision !== (current.revision || 0)) {
    await logActivity(req, 'canvas:overwritten', doc, { revision: doc.revision })
  }
  ok(res, await one(req, doc))
}

router.put('/:id', wrap((req, res) => saveCanvas(req, res)))

/**
 * PATCH /api/workflow/:id/meta { name?, viewport?, legacyLayout? } - a metadata save and
 * nothing else: the same as PUT with only these fields, except that content fields are
 * refused (400 `canvas.meta_only`) instead of turning the call into a content save.
 * What a canvas list uses to rename.
 */
router.patch('/:id/meta', wrap((req, res) => saveCanvas(req, res, { metaOnly: true })))

/**
 * PATCH /api/workflow/:id/access { visibility } - who else in the team sees or edits this canvas.
 * Team canvases only. Not a content change: the revision stays.
 */
router.patch('/:id/access', wrap(async (req, res) => {
  const { doc: current } = await loadWorkflow(req, req.params.id)
  if (!spaces.isTeam(req)) throw badRequest('canvas.personal_no_visibility')
  const visibility = parseVisibility((req.body || {}).visibility)
  spaces.assertCan(req, 'canvas:set_visibility', { canvas: current })
  const before = current.visibility || VISIBILITY.PRIVATE
  const doc = await Workflow.findOneAndUpdate(
    { _id: current._id, userId: req.spaceId, isDeleted: false },
    { $set: { visibility } },
    { new: true, timestamps: false }
  ).lean()
  if (!doc) throw notFound('canvas.not_found')
  if (before !== visibility) await logActivity(req, 'canvas:visibility_changed', doc, { from: before, to: visibility })
  ok(res, await one(req, doc))
}))

/**
 * POST /api/workflow/:id/lock { sessionId, takeover? } - take the edit lock, or renew it (the heartbeat).
 *
 *   -> { lock: { by, at, expiresAt, mine: true, sameUser: true, releaseToken },
 *        state, revision, metaRevision, name, ttlMs, heartbeatMs, ttlSeconds, heartbeatSeconds }
 *
 * `sessionId` names the editing session: a random id the client makes up once
 * per tab ([A-Za-z0-9_-]{8,64}). The lock belongs to that session, not to the
 * account: the same person in a second tab is told `canvas.locked` like
 * anybody else (with `data.lock.sameUser: true`) and takes over the same way.
 *
 * Call it when a canvas is opened for editing and then every `heartbeatMs`.
 * `state` says what the call did:
 *   'acquired'    the canvas was free (or its lock had run out) and is now this session's;
 *   'renewed'     this session held it and still does;
 *   'reacquired'  this session's own lock had run out and nobody took the canvas
 *                 in between - carry on (compare `revision` to be sure);
 *   'taken_over'  taken from the session that held it.
 * `revision`, `metaRevision` and `name` are the canvas's current ones: a
 * heartbeat is how an open editor learns that the canvas was renamed.
 *
 * While another session holds the lock the answer is 423 `canvas.locked` with
 * that lock in `data` - also for the session it was taken from, which is how
 * it learns of it (`data.lost`). `takeover: true` takes it (whoever may edit
 * the canvas may; taking it from somebody else is written to the activity log).
 *
 * In a personal space there is nobody to lock out: the call succeeds with
 * `lock: null`, so an editor can call it without asking which kind of space it is in.
 */
router.post('/:id/lock', wrap(async (req, res) => {
  const session = sessionOf(req)
  const { doc: current, access } = await loadWorkflow(req, req.params.id, 'edit')
  const timing = { ttlMs: LOCK_TTL_MS, heartbeatMs: LOCK_HEARTBEAT_MS, pollMs: EDIT_LOCK.WAIT_POLL_MS, ttlSeconds: LOCK_TTL_MS / 1000, heartbeatSeconds: LOCK_HEARTBEAT_MS / 1000 }
  const about = (doc) => ({ revision: doc.revision || 0, metaRevision: doc.metaRevision || 0, name: doc.name })
  if (!spaces.isTeam(req)) return ok(res, { lock: null, state: 'none', ...about(current), ...timing })
  const now = Date.now()
  const expiresAt = new Date(now + LOCK_TTL_MS)
  const base = { _id: current._id, userId: req.spaceId, isDeleted: false }
  const mineFilter = { 'lock.by': req.userId, 'lock.session': sessionIs(session) }
  const takeover = !!(req.body && req.body.takeover === true)
  const write = (filter, lock) => Workflow.findOneAndUpdate(filter, { $set: { lock } }, { new: true, timestamps: false }).lean()

  // Renew my own lock, keeping the moment I took it.
  let state = 'renewed'
  let doc = await Workflow.findOneAndUpdate(
    { ...base, ...mineFilter, 'lock.expiresAt': { $gt: new Date(now) } },
    { $set: { 'lock.expiresAt': expiresAt } },
    { new: true, timestamps: false }
  ).lean()
  // Or take a lock nobody holds. A lock of mine that ran out and that nobody took since is simply mine again.
  if (!doc) {
    const seen = current.lock
    state = seen && seen.by && holds(seen, req.userId, session) ? 'reacquired' : 'acquired'
    doc = await write(
      state === 'reacquired' ? { ...base, ...mineFilter, 'lock.expiresAt': { $lte: new Date(now) } } : { ...base, $or: lockFree(now) },
      state === 'reacquired' ? { ...NO_LOCK, ...seen, expiresAt } : newLock(req, session, now, seen, 'expired')
    )
  }
  if (!doc) {
    const latest = await Workflow.findOne(base).lean()
    if (!latest) throw notFound('canvas.not_found')
    const other = liveLock(latest)
    if (other && !holds(other, req.userId, session)) {
      if (!takeover || !access.canTakeOver) throw await lockedError(req, latest)
      // Taken from exactly the holder that was seen: of two takeovers at once, one wins.
      doc = await write({ ...base, 'lock.by': other.by, 'lock.session': sessionIs(other.session || '') }, newLock(req, session, now, other, 'takeover'))
      if (!doc) throw await lockedError(req, (await Workflow.findOne(base).lean()) || latest)
      state = 'taken_over'
      // From oneself in another tab: nothing the team needs to read about.
      if (other.by !== req.userId) {
        const names = await spaces.people([other.by], req.spaceId)
        await logActivity(req, 'canvas:taken_over', doc, { fromId: other.by, fromName: spaces.personOf(names, other.by).name })
      }
    } else {
      // The lock was freed, or is mine after all, in the meantime: one more try settles it.
      state = 'acquired'
      doc = await write({ ...base, $or: [mineFilter, ...lockFree(Date.now())] }, newLock(req, session, now, null, ''))
      if (!doc) {
        const again = await Workflow.findOne(base).lean()
        if (!again) throw notFound('canvas.not_found')
        throw await lockedError(req, again)
      }
    }
  }
  const names = await namesFor(req, [doc])
  ok(res, { lock: lockView(req, doc, doc.lock, names), state, ...about(doc), ...timing })
}))

/**
 * GET /api/workflow/:id/lock[?sessionId=...] - look at the lock without touching it.
 *
 *   -> { lock, revision, metaRevision, name, canEdit, canTakeOver, ttlMs, heartbeatMs, pollMs }
 *
 * What a read-only editor asks every `pollMs` while it is on screen: is the
 * canvas free now (`lock: null`), was it renamed, was it saved. Whoever may see
 * the canvas may ask; the nodes are not read.
 */
router.get('/:id/lock', wrap(async (req, res) => {
  requireObjectId(req.params.id)
  const doc = await Workflow.findOne(
    { _id: req.params.id, userId: req.spaceId, isDeleted: false },
    { name: 1, revision: 1, metaRevision: 1, lock: 1, userId: 1, createdBy: 1, inheritedFrom: 1, visibility: 1 }
  ).lean()
  if (!doc) throw notFound('canvas.not_found')
  const access = permissions.canvasAccess(req.space, doc)
  if (!access.canView) throw notFound('canvas.not_found')
  const lock = spaces.isTeam(req) ? liveLock(doc) : null
  const names = lock ? await spaces.people([lock.by], req.spaceId) : new Map()
  ok(res, {
    lock: lock ? lockView(req, doc, lock, names) : null,
    revision: doc.revision || 0,
    metaRevision: doc.metaRevision || 0,
    name: doc.name,
    canEdit: access.canEdit,
    canTakeOver: access.canTakeOver,
    ttlMs: LOCK_TTL_MS,
    heartbeatMs: LOCK_HEARTBEAT_MS,
    pollMs: EDIT_LOCK.WAIT_POLL_MS,
  })
}))

/**
 * DELETE /api/workflow/:id/lock?sessionId=... - give the lock back (leaving the editor
 * inside the app). Only the caller's own lock, held by that session, is released.
 */
router.delete('/:id/lock', wrap(async (req, res) => {
  requireObjectId(req.params.id)
  const r = await Workflow.updateOne(
    { _id: req.params.id, userId: req.spaceId, 'lock.by': req.userId, 'lock.session': sessionIs(sessionOf(req)) },
    { $set: { lock: releasedLock({ by: req.userId, session: sessionOf(req) }) } },
    { timestamps: false }
  )
  ok(res, { released: r.modifiedCount > 0 })
}))

/**
 * POST /api/workflow/:id/lock/release { releaseToken } - give the lock back
 * when the page goes away. PUBLIC: no Authorization header is needed, because
 * the request a closing page can still send - `navigator.sendBeacon`, which
 * outlives the page where `fetch` may not - cannot carry one. The release
 * token (handed to the holder with its lock) is the permission: it names one
 * lock of one session and frees exactly that. The body is JSON, sent as
 * `text/plain` (what sendBeacon does with a string, and what needs no CORS
 * preflight) or as `application/json`.
 *
 *   -> { released }   false for a token that names no lock held right now - never an error,
 *                     so the answer tells a guesser nothing.
 */
const publicRouter = express.Router()
/**
 * The token cannot be guessed (256 bits), so nothing has to slow a guesser down.
 * This only keeps an anonymous caller from making the database work: past
 * RELEASE_LIMIT calls a minute from one address the answer is `released: false`
 * without a look. A real tab sends one beacon when it closes; a lock that was
 * not released this way still runs out by itself.
 */
const RELEASE_LIMIT = { max: 120, windowMs: 60 * 1000, maxAddresses: 20000 }
const releaseCalls = new Map() // address -> { count, resetAt }
function releaseAllowed(ip, now = Date.now()) {
  const key = String(ip || '')
  let entry = releaseCalls.get(key)
  if (!entry || entry.resetAt <= now) {
    if (releaseCalls.size >= RELEASE_LIMIT.maxAddresses) {
      for (const [k, v] of releaseCalls) if (v.resetAt <= now) releaseCalls.delete(k)
      if (releaseCalls.size >= RELEASE_LIMIT.maxAddresses) return false
    }
    entry = { count: 0, resetAt: now + RELEASE_LIMIT.windowMs }
    releaseCalls.set(key, entry)
  }
  entry.count += 1
  return entry.count <= RELEASE_LIMIT.max
}
publicRouter.post('/:id/lock/release', express.text({ type: ['text/plain', 'application/json'], limit: '2kb' }), wrap(async (req, res) => {
  if (!releaseAllowed(req.ip)) return ok(res, { released: false })
  let body = req.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch { body = null }
  }
  const token = isPlainObject(body) ? body.releaseToken : ''
  const id = req.params.id
  if (!/^[0-9a-f]{24}$/i.test(id) || typeof token !== 'string' || !RELEASE_TOKEN_RE.test(token)) return ok(res, { released: false })
  const doc = await Workflow.findOne({ _id: id }, { lock: 1 }).lean()
  const lock = doc && doc.lock
  if (!lock || !lock.by) return ok(res, { released: false })
  const want = Buffer.from(releaseTokenOf(id, lock))
  const got = Buffer.from(token)
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return ok(res, { released: false })
  // Exactly the lock the token was made for: one that changed hands in the meantime stays.
  const r = await Workflow.updateOne(
    { _id: id, 'lock.by': lock.by, 'lock.session': sessionIs(lock.session || ''), 'lock.at': lock.at },
    { $set: { lock: releasedLock(lock) } },
    { timestamps: false }
  )
  ok(res, { released: r.modifiedCount > 0 })
}))

/**
 * POST /api/workflow/:id/duplicate { name? } - a copy in the same space; media is shared by reference, not copied.
 * The client may name the copy (it knows the UI language); otherwise a default is used.
 * In a team the copy is the caller's and starts as "only me".
 */
router.post('/:id/duplicate', wrap(async (req, res) => {
  const { doc: src } = await loadWorkflow(req, req.params.id)
  const wanted = req.body && typeof req.body.name === 'string' ? req.body.name.trim() : ''
  const doc = await Workflow.create({
    userId: req.spaceId,
    createdBy: req.userId,
    visibility: spaces.isTeam(req) ? VISIBILITY.PRIVATE : '',
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
  ok(res, await one(req, doc.toObject()))
}))

/**
 * POST /api/workflow/:id/copy { toSpace: 'personal' | <team id>, name? }
 * Copy a canvas the caller can see into another space they are in - a personal
 * canvas into a team, or a team canvas into their personal space (unless the
 * team's owner switched that off) or another team.
 *
 * The files go along: every stored file the canvas refers to is duplicated
 * under the target space, so the copy does not break when the source space is
 * removed. Brand kits and model ids are the source space's and are not
 * carried over: the copy starts without a kit, and a node whose model the
 * target space does not have simply asks for one.
 *
 *   -> { workflowId, spaceId, files }
 */
router.post('/:id/copy', wrap(async (req, res) => {
  const body = req.body || {}
  const { doc: src } = await loadWorkflow(req, req.params.id)
  const target = await spaces.resolve(req.userId, body.toSpace === undefined ? spaces.PERSONAL : body.toSpace)
  if (target.id === req.spaceId) throw badRequest('space.same_space')
  if (spaces.isTeam(req) && target.kind !== 'team') {
    const allowed = req.space.role === 'owner' || !req.space.team.settings || req.space.team.settings.copyToPersonal !== false
    if (!allowed) throw new ApiError(403, 'space.copy_out_disabled')
  }
  const copier = createCopier(target.id)
  const nodes = (await copier.copy(src.nodes || [])).map((n) => {
    // A node's own brand kit names a kit of the source space.
    if (n && n.data && typeof n.data === 'object' && n.data.brandKitOverride) delete n.data.brandKitOverride
    return n
  })
  const wanted = typeof body.name === 'string' ? body.name.trim() : ''
  const doc = await Workflow.create({
    userId: target.id,
    createdBy: req.userId,
    visibility: target.kind === 'team' ? VISIBILITY.PRIVATE : '',
    name: (wanted || src.name || defaultName(req)).slice(0, MAX_NAME_LEN),
    nodes,
    edges: src.edges || [],
    viewport: src.viewport || DEFAULT_VIEWPORT,
    settings: await copier.copy(src.settings || {}),
    brandKitId: '',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    legacyLayout: !!src.legacyLayout,
    ...pickThumbnail(nodes),
  })
  ok(res, { workflowId: String(doc._id), spaceId: target.kind === 'team' ? target.id : spaces.PERSONAL, files: copier.stats().files })
}))

/**
 * DELETE /api/workflow/:id - soft delete. The canvas can be brought back for
 * RESTORE_DAYS days (POST /:id/restore): by its owner in a personal space, by
 * the team's owner and admins in a team.
 */
router.delete('/:id', wrap(async (req, res) => {
  const { doc: current, access } = await loadWorkflow(req, req.params.id)
  if (!access.canDelete) throw new ApiError(403, 'team.forbidden')
  const doc = await Workflow.findOneAndUpdate(
    { _id: current._id, userId: req.spaceId, isDeleted: false },
    { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.userId, lock: NO_LOCK } },
    { new: true }
  ).lean()
  if (!doc) throw notFound('canvas.not_found')
  await logActivity(req, 'canvas:deleted', doc)
  ok(res, { id: String(doc._id) })
}))

/** POST /api/workflow/:id/restore - bring back a canvas deleted in the last RESTORE_DAYS days. */
router.post('/:id/restore', wrap(async (req, res) => {
  requireObjectId(req.params.id)
  spaces.assertCan(req, 'canvas:restore')
  const filter = { _id: req.params.id, userId: req.spaceId, isDeleted: true, deletedAt: { $gt: new Date(Date.now() - RESTORE_DAYS * 24 * 3600 * 1000) } }
  const visible = permissions.visibleCanvasFilter(req.space)
  if (visible.$or) filter.$and = [visible]
  const doc = await Workflow.findOneAndUpdate(filter, { $set: { isDeleted: false, deletedAt: null, deletedBy: '' } }, { new: true }).lean()
  if (!doc) throw notFound('canvas.not_found')
  await logActivity(req, 'canvas:restored', doc)
  ok(res, await one(req, doc))
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
  const { doc } = await loadWorkflow(req, req.params.id)
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
module.exports.publicRouter = publicRouter
module.exports.limits = limits
module.exports.migrateStoredWorkflows = migrateStoredWorkflows
module.exports.RELEASE_LIMIT = RELEASE_LIMIT
module.exports.resetReleaseLimit = () => releaseCalls.clear()
module.exports.LOCK_TTL_MS = LOCK_TTL_MS
module.exports.LOCK_HEARTBEAT_MS = LOCK_HEARTBEAT_MS
module.exports.RESTORE_DAYS = RESTORE_DAYS
module.exports.LIST_CHANGES_MAX = LIST_CHANGES_MAX
