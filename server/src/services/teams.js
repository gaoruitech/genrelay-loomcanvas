'use strict'

/**
 * Teams: creating one, who is in it, invite links, handing it over, closing
 * it and removing it for good.
 *
 * A team is a space (see services/spaces.js): everything that belongs to it
 * carries the team's id where a personal document carries an account's id.
 * What that buys is stated in docs/architecture.md; what it asks of this file
 * is that a team's id is never also an account's id (newTeamId) and that
 * removing a team walks the same list of collections as removing an account
 * (accounts.OWNED).
 *
 * Creating a team needs the super admin's authorisation: the account's
 * `canCreateTeams` flag, set in user management or by approving a request
 * (TeamRequest). The site's super admin is always authorised.
 */
const crypto = require('crypto')
const mongoose = require('mongoose')
const Team = require('../models/Team')
const TeamMember = require('../models/TeamMember')
const TeamFormerMember = require('../models/TeamFormerMember')
const TeamInvitation = require('../models/TeamInvitation')
const TeamActivity = require('../models/TeamActivity')
const TeamRequest = require('../models/TeamRequest')
const User = require('../models/User')
const Workflow = require('../models/Workflow')
const Provider = require('../models/Provider')
const Run = require('../models/Run')
const settings = require('./settings')
const activity = require('./activity')
const budget = require('./budget')
const spaces = require('./spaces')
const storageCleanup = require('./storageCleanup')
const { getConfig } = require('../config')
const { encrypt, decrypt, randomToken } = require('../utils/crypto')
const { ApiError, badRequest, notFound } = require('../utils/http')
const { isObjectId, isPlainObject, isMediaUrl, parseTimeZone, text } = require('../utils/validate')
const { ROLES, TEAM_ROLES, VISIBILITY } = require('../constants')
const { msg } = require('../i18n')

/** How long a dissolved team can still be restored. After that it is removed with its data and files. */
const DISSOLVE_GRACE_DAYS = 7
const DAY_MS = 24 * 3600 * 1000
const INVITE_DEFAULTS = Object.freeze({ days: 7, maxUses: 10 })
const INVITE_MAX_DAYS = 90
const INVITE_MAX_USES = 1000
const MAX_LIVE_INVITES = 50
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/
const NAME_MAX = 40
const UNFINISHED = ['queued', 'running', 'archiving']

const conflict = (key, params) => new ApiError(409, key, params)
const refuse = (key, params) => new ApiError(403, key, params)
const actorOf = (user) => ({ id: String(user._id), name: user.username })
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex')
const runner = () => require('../runner').getRunner()

/* ------------------------------------------------------------- creation */

const authorised = (user) => !!user && (user.role === ROLES.OWNER || !!user.canCreateTeams)

/** Teams this account created or owns: what `teamMaxPerUser` is counted against. */
function countHeld(userId) {
  const id = String(userId)
  return Team.countDocuments({ $or: [{ createdBy: id }, { ownerId: id }] })
}

function serializeRequest(r) {
  if (!r) return null
  return { id: String(r._id), status: r.status, note: r.note || '', reason: r.reason || '', createdAt: r.createdAt, decidedAt: r.decidedAt || null }
}

/**
 * Whether this account may create a team right now, and why not:
 * { authorised, canCreate, held, max, maxMembers, request }. `request` is the
 * account's latest request for the authorisation (pending, approved or
 * rejected), or null when it never asked.
 */
async function creationState(user) {
  const [held, request] = await Promise.all([
    countHeld(user._id),
    TeamRequest.findOne({ userId: String(user._id) }).sort({ createdAt: -1 }).lean(),
  ])
  const max = settings.get('teamMaxPerUser')
  const ok = authorised(user)
  return { authorised: ok, canCreate: ok && held < max, held, max, maxMembers: settings.get('teamMaxMembers'), request: serializeRequest(request) }
}

/** Ask the super admin for the authorisation. One pending request per account. */
async function requestCreation(user, note) {
  if (authorised(user)) throw conflict('team.already_authorised')
  await TeamRequest.init()
  try {
    const doc = await TeamRequest.create({ userId: String(user._id), note: text(note, 500) })
    return serializeRequest(doc)
  } catch (err) {
    if (err && err.code === 11000) throw conflict('team.request_pending')
    throw err
  }
}

/** Take a pending request back. False when there was none. */
async function withdrawRequest(user) {
  const r = await TeamRequest.deleteOne({ userId: String(user._id), status: 'pending' })
  return r.deletedCount > 0
}

/** The super admin decides a pending request. Approving it is granting the authorisation. */
async function decideRequest(admin, requestId, { approve, reason }) {
  if (!isObjectId(requestId)) throw notFound('team.request_not_found')
  const doc = await TeamRequest.findOneAndUpdate(
    { _id: requestId, status: 'pending' },
    { $set: { status: approve ? 'approved' : 'rejected', decidedBy: String(admin._id), decidedAt: new Date(), reason: approve ? '' : text(reason, 500) } },
    { new: true }
  ).lean()
  if (!doc) throw notFound('team.request_not_found')
  if (approve) await User.updateOne({ _id: doc.userId }, { $set: { canCreateTeams: true } })
  return doc
}

function parseName(v) {
  const name = text(v, 200)
  if (!name) throw badRequest('common.name_required')
  if (name.length > NAME_MAX) throw badRequest('validation.max_length', { field: 'name', max: NAME_MAX })
  return name
}

function parseAvatar(v) {
  if (v === undefined || v === null || v === '') return ''
  if (!isMediaUrl(v)) throw badRequest('validation.bad_url', { field: 'avatar' })
  return v
}

/** An id for a new team that no account has: `userId` in the per-space collections must name one space. */
async function newTeamId() {
  for (;;) {
    const id = new mongoose.Types.ObjectId()
    if (!(await User.exists({ _id: id }))) return id
  }
}

async function createTeam(user, body) {
  const b = isPlainObject(body) ? body : {}
  const name = parseName(b.name)
  const avatar = parseAvatar(b.avatar)
  const timezone = parseTimeZone(b.timezone, 'timezone')
  if (!authorised(user)) throw refuse('team.not_authorised')
  const uid = String(user._id)
  // One at a time per account, so two parallel requests cannot both be "the last one allowed".
  return budget.withLock(`team-create:${uid}`, async () => {
    const max = settings.get('teamMaxPerUser')
    if ((await countHeld(uid)) >= max) throw refuse('team.max_owned', { max })
    await TeamMember.init()
    const team = await Team.create({ _id: await newTeamId(), name, avatar, timezone, ownerId: uid, createdBy: uid })
    await TeamMember.create({ teamId: String(team._id), userId: uid, role: TEAM_ROLES.ADMIN })
    await activity.record(team._id, actorOf(user), 'team:created', { type: 'team', id: team._id, name })
    return team.toObject()
  })
}

/* ---------------------------------------------------------------- reading */

const maxMembersOf = (team) => (Number.isInteger(team.maxMembers) ? team.maxMembers : settings.get('teamMaxMembers'))

function serializeTeam(team, { role, members } = {}) {
  return {
    id: String(team._id),
    kind: 'team',
    name: team.name,
    avatar: team.avatar || '',
    ownerId: String(team.ownerId),
    status: team.status,
    ...(role ? { role } : {}),
    ...(members === undefined ? {} : { members, maxMembers: maxMembersOf(team) }),
    timezone: team.timezone || 'UTC',
    dissolvedAt: team.dissolvedAt || null,
    purgeAt: team.status === 'dissolved' ? team.purgeAt || null : null,
    createdAt: team.createdAt,
  }
}

async function memberCounts(teamIds) {
  const rows = await TeamMember.aggregate([{ $match: { teamId: { $in: teamIds.map(String) } } }, { $group: { _id: '$teamId', n: { $sum: 1 } } }])
  return new Map(rows.map((r) => [r._id, r.n]))
}

/**
 * The teams an account is in, as its space switcher shows them. A closed team
 * (suspended, or dissolved and waiting to be removed) is listed for its owner
 * only - who is the one that can do something about it.
 */
async function listFor(userId) {
  const uid = String(userId)
  const rows = await TeamMember.find({ userId: uid }).sort({ joinedAt: 1 }).lean()
  if (!rows.length) return []
  const teams = await Team.find({ _id: { $in: rows.map((r) => r.teamId) } }).lean()
  const byId = new Map(teams.map((t) => [String(t._id), t]))
  const counts = await memberCounts(teams.map((t) => t._id))
  const out = []
  for (const row of rows) {
    const team = byId.get(row.teamId)
    if (!team) continue
    const role = spaces.roleIn(team, row)
    if (team.status !== 'active' && role !== TEAM_ROLES.OWNER) continue
    out.push(serializeTeam(team, { role, members: counts.get(String(team._id)) || 0 }))
  }
  return out
}

function serializeSettings(team) {
  const s = team.settings || {}
  return {
    defaultVisibility: s.defaultVisibility || VISIBILITY.TEAM_VIEW,
    publicShare: s.publicShare === 'managers' ? 'managers' : 'editors',
    adminsSeeAll: !!s.adminsSeeAll,
    copyToPersonal: s.copyToPersonal !== false,
    blockUnpriced: s.blockUnpriced !== false,
  }
}

/* ---------------------------------------------------------------- members */

/**
 * The member list. Everybody in the team sees who is in it and as what;
 * `withUsage` (the owner, and admins the owner let) adds each member's month.
 */
async function listMembers(team, { withUsage = false } = {}) {
  const rows = await TeamMember.find({ teamId: String(team._id) }).sort({ joinedAt: 1 }).lean()
  const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select('username disabled').lean()
  const byId = new Map(users.map((u) => [String(u._id), u]))
  const snap = withUsage ? await budget.snapshot(team, null) : null
  const rank = { owner: 0, admin: 1, member: 2 }
  return rows.map((row) => {
    const user = byId.get(row.userId)
    const role = spaces.roleIn(team, row)
    const out = {
      id: row.userId,
      username: user ? user.username : '',
      displayName: row.displayName || '',
      name: row.displayName || (user ? user.username : ''),
      role,
      joinedAt: row.joinedAt,
      // The account cannot sign in at the moment (disabled by the super admin), or is gone.
      disabled: !user || !!user.disabled,
    }
    if (snap) {
      // The member's month in the very numbers their limits are checked against (services/budget.js):
      // used = succeeded + in progress, the breakdown behind it, and `effective` ready to show.
      const side = budget.memberSide(team, row, snap)
      out.usage = { runs: side.runs.used, amount: side.amount.used, uncounted: side.uncounted, currency: snap.currency, breakdown: side.breakdown }
      out.limits = { runs: side.runs.limit, amount: side.amount.limit, custom: side.custom }
      out.effective = side.effective
    }
    return out
  }).sort((a, b) => rank[a.role] - rank[b.role])
}

async function findMember(team, userId) {
  const row = isObjectId(userId) ? await TeamMember.findOne({ teamId: String(team._id), userId: String(userId) }) : null
  if (!row) throw notFound('team.member_not_found')
  return row
}

async function nameIn(team, userId) {
  const who = spaces.personOf(await spaces.people([userId], team._id), userId)
  return who.name
}

/** A limit from a request: null (none), or a number of that kind. */
function parseLimit(v, field, { integer }) {
  if (v === null) return null
  const n = Number(v)
  if (typeof v !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e9 || (integer && !Number.isInteger(n))) {
    throw badRequest(integer ? 'validation.int_range' : 'validation.range', { field, min: 0, max: 1e9 })
  }
  return integer ? n : Math.round(n * 1e6) / 1e6
}

/** `{ runs?, amount? }` from a request -> the fields to set, under `prefix`. */
function limitPatch(input, prefix) {
  if (!isPlainObject(input)) throw badRequest('validation.object', { field: prefix })
  const set = {}
  if (input.runs !== undefined) set[`${prefix}.runs`] = parseLimit(input.runs, `${prefix}.runs`, { integer: true })
  if (input.amount !== undefined) set[`${prefix}.amount`] = parseLimit(input.amount, `${prefix}.amount`, { integer: false })
  return set
}

/**
 * Change one member: `role` ('admin' | 'member'), `displayName`, `limits`
 * ({ runs?, amount? }, null = follow the team's default). Who may change what
 * is the caller's business (routes/teams.js); this only refuses what no one may.
 */
async function updateMember(team, actor, userId, patch) {
  const row = await findMember(team, userId)
  const isOwner = String(team.ownerId) === row.userId
  const set = {}
  const events = []
  if (patch.role !== undefined) {
    if (![TEAM_ROLES.ADMIN, TEAM_ROLES.MEMBER].includes(patch.role)) throw badRequest('validation.one_of', { field: 'role', values: 'admin / member' })
    if (isOwner) throw conflict('team.owner_role_fixed')
    if (patch.role !== row.role) {
      set.role = patch.role
      events.push([patch.role === TEAM_ROLES.ADMIN ? 'member:promoted' : 'member:demoted', { from: row.role, to: patch.role }])
    }
  }
  if (patch.displayName !== undefined) {
    if (typeof patch.displayName !== 'string') throw badRequest('validation.string', { field: 'displayName' })
    set.displayName = patch.displayName.trim().slice(0, 40)
    // '' on either side means "the username is shown"; `username` lets the entry say whose name it is.
    if (set.displayName !== (row.displayName || '')) {
      const account = await User.findById(row.userId).select('username').lean()
      events.push(['member:renamed', { from: row.displayName || '', to: set.displayName, username: account ? account.username : '' }])
    }
  }
  if (patch.limits !== undefined) {
    const before = { runs: row.limits ? row.limits.runs : null, amount: row.limits ? row.limits.amount : null }
    const changes = limitPatch(patch.limits, 'limits')
    Object.assign(set, changes)
    const after = { ...before }
    for (const [k, v] of Object.entries(changes)) after[k.split('.')[1]] = v
    if (before.runs !== after.runs || before.amount !== after.amount) events.push(['limits:member_changed', { before, after }])
  }
  if (!Object.keys(set).length && !events.length) return row.toObject()
  const saved = await TeamMember.findOneAndUpdate({ _id: row._id }, { $set: set }, { new: true }).lean()
  const target = { type: 'member', id: row.userId, name: await nameIn(team, row.userId) }
  for (const [type, detail] of events) await activity.record(team._id, actor, type, target, detail)
  return saved
}

/**
 * Take an account out of a team - it left, was removed, or its account is
 * being deleted. The member row goes first: from that moment every request of
 * theirs to this team is refused. Then what they left behind is settled:
 *
 *  - what they made stays with the team; their "only me" canvases pass to the
 *    team's owner (nobody else could reach them);
 *  - an edit lock they hold is released;
 *  - their runs that are still waiting in the queue are canceled; a run that
 *    already started is left to finish (the upstream has it, and the result
 *    belongs to the team);
 *  - invite links they created stop working.
 *
 * Resolves { canvasesInherited, runsCanceled, wasAdmin, keysSet: [{ id, name }] }
 * - `keysSet`: the providers whose key this person entered, for the reminder
 * to replace those keys at the upstream.
 */
async function removeMember(team, userId, { actor, type = 'member:removed', accountDeleted = false } = {}) {
  const teamId = String(team._id)
  const uid = String(userId)
  if (String(team.ownerId) === uid) throw conflict('team.owner_cannot_leave')
  const who = await nameIn(team, uid)
  const row = await TeamMember.findOneAndDelete({ teamId, userId: uid }).lean()
  if (!row) throw notFound('team.member_not_found')
  await rememberFormer(teamId, row, accountDeleted ? 'deleted' : type === 'member:left' ? 'left' : 'removed')

  await Workflow.updateMany({ userId: teamId, 'lock.by': uid }, { $set: { lock: { by: '', at: null, expiresAt: null } } }, { timestamps: false })
  const inherited = await Workflow.updateMany(
    { userId: teamId, createdBy: uid, visibility: VISIBILITY.PRIVATE },
    { $set: { createdBy: String(team.ownerId), inheritedFrom: uid } },
    { timestamps: false }
  )
  const runsCanceled = await cancelQueued({ teamId, createdBy: uid }, 'member_removed')
  await TeamInvitation.updateMany({ teamId, createdBy: uid, revoked: false }, { $set: { revoked: true, revokedBy: (actor && actor.id) || '' } })
  const keysSet = row.role === TEAM_ROLES.ADMIN
    ? (await Provider.find({ userId: teamId, keySetBy: uid, hasKey: true }).select('name').lean()).map((p) => ({ id: String(p._id), name: p.name }))
    : []

  const out = { canvasesInherited: inherited.modifiedCount || 0, runsCanceled, wasAdmin: row.role === TEAM_ROLES.ADMIN, keysSet }
  await activity.record(teamId, actor || { id: uid, name: who }, type, { type: 'member', id: uid, name: who }, { ...out, role: row.role, accountDeleted })
  return out
}

/**
 * Keep the name somebody went by in a team after their member row is gone, so
 * that what they made - canvases, assets, runs, log entries - still says whose
 * it was (spaces.people reads it). Never fails the removal it belongs to.
 */
async function rememberFormer(teamId, row, reason) {
  try {
    const account = await User.findById(row.userId).select('username').lean()
    await TeamFormerMember.updateOne(
      { teamId: String(teamId), userId: row.userId },
      { $set: { username: account ? account.username : '', displayName: row.displayName || '', role: row.role, reason, leftAt: new Date() } },
      { upsert: true }
    )
  } catch (err) {
    console.error(`[teams] the name of former member ${row.userId} of team ${teamId} could not be kept:`, err && err.message)
  }
}

/**
 * Why a run that nobody canceled by hand did not run: kept with the run in place of the plain
 * "Canceled", and shown wherever the run is (the queue, the history, a usage record).
 */
const CANCEL_REASONS = Object.freeze({
  member_removed: 'run.canceled_member_removed',
  account_disabled: 'run.canceled_account_disabled',
  team_closed: 'run.canceled_team_closed',
})

/**
 * Cancel the runs matching `filter` that have not started; `why` is one of CANCEL_REASONS'
 * keys. Returns how many were canceled. A run that is in flight - in this process or in
 * another one - is left alone: only a record that still says `queued` is touched.
 */
async function cancelQueued(filter, why) {
  const waiting = await Run.find({ ...filter, status: 'queued' }).select('_id').lean()
  const reason = CANCEL_REASONS[why] ? msg(CANCEL_REASONS[why]) : null
  let n = 0
  for (const run of waiting) {
    const after = await runner().cancelIfQueued(String(run._id), reason).catch(() => null)
    if (after && after.status === 'canceled') n++
  }
  return n
}

/* ------------------------------------------------------------ invitations */

function inviteState(inv, team, memberCount, now = Date.now()) {
  if (!team || team.status !== 'active') return 'team_unavailable'
  if (inv.revoked) return 'revoked'
  if (new Date(inv.expiresAt).getTime() <= now) return 'expired'
  if (inv.maxUses > 0 && inv.usedCount >= inv.maxUses) return 'used_up'
  if (memberCount >= maxMembersOf(team)) return 'team_full'
  return 'valid'
}

/** How many more times an invite link can be used: a number, or null when it has no limit of its own. */
function remainingUses(inv) {
  return inv.maxUses > 0 ? Math.max(0, inv.maxUses - (inv.usedCount || 0)) : null
}

/** The states in which a link is dead for good: nothing "remains" of it, whatever its counter says. */
const INVITE_DEAD = ['revoked', 'expired', 'team_unavailable']

function serializeInvitation(inv, team, memberCount, names) {
  const state = inviteState(inv, team, memberCount)
  let token = ''
  if (inv.tokenEnc) {
    try { token = decrypt(inv.tokenEnc, getConfig().secretKey) } catch { /* SECRET_KEY changed: the link cannot be shown again, only revoked */ }
  }
  return {
    id: String(inv._id),
    // The last part of the invite link: <site>/join/<token>.
    token,
    createdBy: spaces.personOf(names, inv.createdBy),
    maxUses: inv.maxUses,
    usedCount: inv.usedCount,
    // How many more people may use it: null = no limit on that, or the link is revoked / expired
    // (it has no uses left to speak of - `state` says which); 0 when it is used up.
    remainingUses: INVITE_DEAD.includes(state) ? null : remainingUses(inv),
    expiresAt: inv.expiresAt,
    revoked: !!inv.revoked,
    state,
    createdAt: inv.createdAt,
  }
}

async function listInvitations(team) {
  const teamId = String(team._id)
  const [rows, count] = await Promise.all([
    TeamInvitation.find({ teamId }).select('+tokenEnc').sort({ createdAt: -1 }).limit(200).lean(),
    TeamMember.countDocuments({ teamId }),
  ])
  const names = await spaces.people(rows.map((r) => r.createdBy), teamId)
  return rows.map((r) => serializeInvitation(r, team, count, names))
}

/** POST body: { expiresInDays?: 1..90 (7), maxUses?: 0..1000 (10; 0 = no limit) }. Whoever uses it joins as a member. */
async function createInvitation(team, user, body) {
  const b = isPlainObject(body) ? body : {}
  const int = (v, field, min, max, dft) => {
    if (v === undefined || v === null || v === '') return dft
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw badRequest('validation.int_range', { field, min, max })
    return v
  }
  const days = int(b.expiresInDays, 'expiresInDays', 1, INVITE_MAX_DAYS, INVITE_DEFAULTS.days)
  const maxUses = int(b.maxUses, 'maxUses', 0, INVITE_MAX_USES, INVITE_DEFAULTS.maxUses)
  const teamId = String(team._id)
  if ((await TeamInvitation.countDocuments({ teamId, revoked: false, expiresAt: { $gt: new Date() } })) >= MAX_LIVE_INVITES) {
    throw badRequest('invite.max', { max: MAX_LIVE_INVITES })
  }
  const token = randomToken()
  const inv = await TeamInvitation.create({
    teamId,
    tokenHash: hashToken(token),
    tokenEnc: encrypt(token, getConfig().secretKey),
    createdBy: String(user._id),
    maxUses,
    expiresAt: new Date(Date.now() + days * DAY_MS),
  })
  await activity.record(teamId, actorOf(user), 'invite:created', { type: 'invite', id: inv._id, name: '' }, { maxUses, expiresAt: inv.expiresAt, expiresInDays: days })
  const names = await spaces.people([inv.createdBy], teamId)
  return serializeInvitation({ ...inv.toObject(), tokenEnc: encrypt(token, getConfig().secretKey) }, team, await TeamMember.countDocuments({ teamId }), names)
}

async function revokeInvitation(team, user, invitationId) {
  const inv = isObjectId(invitationId)
    ? await TeamInvitation.findOneAndUpdate({ _id: invitationId, teamId: String(team._id) }, { $set: { revoked: true, revokedBy: String(user._id) } }).lean()
    : null
  if (!inv) throw notFound('invite.not_found')
  if (!inv.revoked) {
    const names = await spaces.people([inv.createdBy], team._id)
    const by = spaces.personOf(names, inv.createdBy)
    await activity.record(team._id, actorOf(user), 'invite:revoked', { type: 'invite', id: inv._id, name: '' },
      { maxUses: inv.maxUses, usedCount: inv.usedCount || 0, expiresAt: inv.expiresAt, createdById: inv.createdBy, createdByName: by ? by.name : '' })
  }
  return { id: String(inv._id), revoked: true }
}

async function findInvitation(token) {
  const inv = typeof token === 'string' && TOKEN_RE.test(token) ? await TeamInvitation.findOne({ tokenHash: hashToken(token) }).lean() : null
  if (!inv) throw notFound('invite.not_found')
  return inv
}

/**
 * What somebody holding an invite link is shown before joining - signed in or
 * not. The team's name, who invited, how many people are in it; nothing of
 * what is inside. `state` says whether the link can still be used.
 */
async function previewInvitation(token, viewerId = '') {
  const inv = await findInvitation(token)
  const team = await Team.findById(inv.teamId).lean()
  const count = team ? await TeamMember.countDocuments({ teamId: inv.teamId }) : 0
  const state = inviteState(inv, team, count)
  const names = team ? await spaces.people([inv.createdBy, team.ownerId], inv.teamId) : new Map()
  const member = team && viewerId ? !!(await TeamMember.exists({ teamId: inv.teamId, userId: String(viewerId) })) : false
  const open = !!team && team.status === 'active'
  // Who to ask for a new link: whoever made this one, while they can still make another (still in the
  // team, as its owner or an admin); otherwise the team's owner. Somebody who has left, was removed,
  // was made a plain member again or whose account is gone is not who to send people to.
  let contactName = ''
  if (open) {
    const inviterRow = String(inv.createdBy) === String(team.ownerId) ? null : await TeamMember.findOne({ teamId: inv.teamId, userId: String(inv.createdBy) }).select('role').lean()
    const inviterCan = String(inv.createdBy) === String(team.ownerId) || (!!inviterRow && inviterRow.role === TEAM_ROLES.ADMIN)
    contactName = spaces.personOf(names, inviterCan ? inv.createdBy : team.ownerId).name
  }
  return {
    state,
    // Only while the team is there to be joined: a closed team shows nothing of itself.
    team: open
      ? { id: String(team._id), name: team.name, avatar: team.avatar || '', members: count, maxMembers: maxMembersOf(team), ownerName: spaces.personOf(names, team.ownerId).name }
      : null,
    // Who made the link (the name they went by in the team, also after they left it).
    inviterName: open ? spaces.personOf(names, inv.createdBy).name : '',
    // Who can make a new one now; '' when the team is closed (then there is nobody to ask).
    contactName,
    expiresAt: inv.expiresAt,
    // "N uses left", and only that: a number while the link works and has a limit of its own, null
    // when it has none or cannot be used. Not how many it started with, and not who used it.
    remainingUses: state === 'valid' ? remainingUses(inv) : null,
    alreadyMember: member,
    // An invite link is not a way around closed registration: without an account, and with
    // registration closed, the link cannot be used until the super admin opens registration.
    registrationOpen: settings.get('registrationOpen'),
  }
}

const INVITE_ERRORS = {
  team_unavailable: [404, 'invite.not_found'],
  revoked: [410, 'invite.revoked'],
  expired: [410, 'invite.expired'],
  used_up: [410, 'invite.used_up'],
  team_full: [409, 'invite.team_full'],
}

/** A signed-in account uses an invite link: it becomes a member. Resolves { team, role, already }. */
async function acceptInvitation(user, token) {
  const inv = await findInvitation(token)
  const uid = String(user._id)
  return budget.withLock(`team-members:${inv.teamId}`, async () => {
    const team = await Team.findById(inv.teamId).lean()
    const existing = team ? await TeamMember.findOne({ teamId: inv.teamId, userId: uid }).lean() : null
    if (team && team.status === 'active' && existing) {
      return { team: serializeTeam(team, { role: spaces.roleIn(team, existing) }), already: true }
    }
    const count = team ? await TeamMember.countDocuments({ teamId: inv.teamId }) : 0
    const state = inviteState(inv, team, count)
    if (state !== 'valid') throw new ApiError(...INVITE_ERRORS[state])
    // Take one use, only if one is left and the link is still good at this instant.
    const taken = await TeamInvitation.findOneAndUpdate(
      {
        _id: inv._id,
        revoked: false,
        expiresAt: { $gt: new Date() },
        $expr: { $or: [{ $eq: ['$maxUses', 0] }, { $lt: ['$usedCount', '$maxUses'] }] },
      },
      { $inc: { usedCount: 1 } },
      { new: true }
    ).lean()
    if (!taken) throw new ApiError(...INVITE_ERRORS.used_up)
    await TeamMember.init()
    const row = await TeamMember.create({ teamId: inv.teamId, userId: uid, role: TEAM_ROLES.MEMBER, invitationId: String(inv._id) })
    const inviter = spaces.personOf(await spaces.people([inv.createdBy], inv.teamId), inv.createdBy)
    await activity.record(inv.teamId, actorOf(user), 'member:joined', { type: 'member', id: uid, name: user.username },
      { inviterId: inv.createdBy, inviterName: inviter ? inviter.name : '', invitationId: String(inv._id) })
    return { team: serializeTeam(team, { role: spaces.roleIn(team, row), members: count + 1 }), already: false }
  })
}

/* --------------------------------------------- hand over, close, remove */

/** The owner hands the team to another member and becomes an admin. */
async function transfer(team, user, toUserId) {
  const teamId = String(team._id)
  const row = await findMember(team, toUserId)
  if (row.userId === String(team.ownerId)) throw badRequest('team.already_owner')
  const account = await User.findById(row.userId).select('disabled').lean()
  if (!account || account.disabled) throw conflict('team.new_owner_unusable')
  // Guarded by the owner it is taken from: of two transfers at once, one wins.
  const r = await Team.updateOne({ _id: team._id, ownerId: team.ownerId }, { $set: { ownerId: row.userId } })
  if (!r.modifiedCount) throw conflict('team.changed')
  await TeamMember.updateOne({ teamId, userId: String(team.ownerId) }, { $set: { role: TEAM_ROLES.ADMIN } })
  await activity.record(teamId, user ? actorOf(user) : { id: '', name: '' }, user ? 'team:transferred' : 'team:owner_appointed',
    { type: 'member', id: row.userId, name: await nameIn(team, row.userId) },
    { fromId: String(team.ownerId), fromName: await nameIn(team, team.ownerId) })
  return Team.findById(team._id).lean()
}

/**
 * The super admin names a new owner - only when the current one cannot act:
 * the account is disabled or no longer exists. Nothing of the team is shown
 * to the super admin by this.
 */
async function appointOwner(teamId, toUserId) {
  const team = isObjectId(String(teamId)) ? await Team.findById(String(teamId)).lean() : null
  if (!team) throw notFound('team.not_found')
  const current = await User.findById(team.ownerId).select('disabled').lean()
  if (current && !current.disabled) throw conflict('team.owner_usable')
  return transfer(team, null, toUserId)
}

/** Stop a team's waiting runs and free its edit locks: what closing it means for work in progress. */
async function freeze(teamId) {
  await Workflow.updateMany({ userId: String(teamId), 'lock.by': { $gt: '' } }, { $set: { lock: { by: '', at: null, expiresAt: null } } }, { timestamps: false })
  return cancelQueued({ teamId: String(teamId) }, 'team_closed')
}

/**
 * Dissolve: the team closes at once for everybody - no member gets in, its
 * share links stop working, what waits in the queue is canceled - and stays
 * restorable for DISSOLVE_GRACE_DAYS. After that sweep() removes it for good.
 */
async function dissolve(team, user) {
  const now = Date.now()
  const purgeAt = new Date(now + DISSOLVE_GRACE_DAYS * DAY_MS)
  const r = await Team.updateOne({ _id: team._id, status: { $ne: 'dissolved' } }, { $set: { status: 'dissolved', dissolvedAt: new Date(now), dissolvedBy: String(user._id), purgeAt } })
  if (!r.modifiedCount) throw conflict('team.changed')
  await freeze(team._id)
  await activity.record(team._id, actorOf(user), 'team:dissolved', { type: 'team', id: team._id, name: team.name }, { purgeAt })
  return Team.findById(team._id).lean()
}

/** Undo a dissolution while the team is still there. `user` null: the super admin. */
async function restore(teamId, user) {
  const team = isObjectId(String(teamId)) ? await Team.findById(String(teamId)).lean() : null
  if (!team) throw notFound('team.not_found')
  if (team.status !== 'dissolved') throw conflict('team.not_dissolved')
  const r = await Team.updateOne({ _id: team._id, status: 'dissolved' }, { $set: { status: 'active', dissolvedAt: null, dissolvedBy: '', purgeAt: null } })
  if (!r.modifiedCount) throw conflict('team.changed')
  await activity.record(team._id, user ? actorOf(user) : { id: '', name: '' }, 'team:restored', { type: 'team', id: team._id, name: team.name })
  return Team.findById(team._id).lean()
}

/** The super admin closes a team (no end date, nothing removed) or opens it again. */
async function setSuspended(teamId, suspended) {
  const team = isObjectId(String(teamId)) ? await Team.findById(String(teamId)).lean() : null
  if (!team) throw notFound('team.not_found')
  if (team.status === 'dissolved') throw conflict('team.is_dissolved')
  if ((team.status === 'suspended') === suspended) return team
  await Team.updateOne({ _id: team._id }, { $set: { status: suspended ? 'suspended' : 'active' } })
  if (suspended) await freeze(team._id)
  await activity.record(team._id, { id: '', name: '' }, suspended ? 'team:suspended' : 'team:resumed', { type: 'team', id: team._id, name: team.name })
  return Team.findById(team._id).lean()
}

/**
 * Remove a team for good: everything that carries its id, its files, its
 * members, invitations and log, and last the team itself - so a removal that
 * was interrupted is simply run again. Only a team that is already closed
 * (dissolved or suspended) is ever removed.
 */
async function purge(teamId) {
  const id = String(teamId)
  const team = await Team.findById(id).lean()
  if (!team) return null
  if (team.status === 'active') throw conflict('team.still_active')
  const unfinished = await Run.find({ teamId: id, status: { $in: UNFINISHED } }).select('_id').lean()
  for (const run of unfinished) await runner().cancel(String(run._id)).catch(() => {})
  const removed = {}
  for (const { model, filter } of require('./accounts').OWNED) {
    const r = await model.deleteMany({ userId: id, ...(filter || {}) })
    if (r.deletedCount) removed[model.collection.collectionName] = r.deletedCount
  }
  let files = 0
  let filesError = ''
  try {
    // Waits a few seconds at most; the rest goes in the background (services/storageCleanup.js).
    const cleanup = await storageCleanup.removeOwnerFiles(id)
    files = cleanup.removed
    filesError = cleanup.error
  } catch (err) {
    filesError = (err && (err.name || err.code)) || 'error'
  }
  const gone = async (model) => (await model.deleteMany({ teamId: id })).deletedCount || 0
  const members = await gone(TeamMember)
  const invitations = await gone(TeamInvitation)
  const activityEntries = await gone(TeamActivity)
  await gone(TeamFormerMember)
  await budget.forgetTeam(id)
  await Team.deleteOne({ _id: id })
  concurrency.delete(id)
  // Everything that went, under names a person reads; a kind of which there was none is 0, not absent.
  const counts = { members, invitations, activity: activityEntries, files }
  for (const [collection, key] of Object.entries(PURGE_COUNT_KEYS)) counts[key] = removed[collection] || 0
  return { id, name: team.name, removed, counts, files, filesError }
}

/** Collection -> its name in the `counts` of a removal. Every collection of accounts.OWNED has one. */
const PURGE_COUNT_KEYS = {
  workflows: 'canvases',
  shares: 'shares',
  userassets: 'assets',
  userassetfolders: 'assetFolders',
  brandkits: 'brandKits',
  providers: 'providers',
  modeloverrides: 'modelOverrides',
  runs: 'runs',
  templates: 'templates',
  texttemplates: 'textTemplates',
}

/* ----------------------------------------------- accounts going away */

/** An account that owns a team cannot be deleted: hand the team over, or remove it, first. */
async function assertAccountDeletable(userId) {
  const owned = await Team.find({ ownerId: String(userId) }).select('name').limit(5).lean()
  if (owned.length) throw conflict('team.account_owns_teams', { teams: owned.map((t) => t.name).join(', ') })
}

/** Part of deleting an account: it leaves every team it is in, and its requests go with it. */
async function forgetAccount(userId, { actor } = {}) {
  const uid = String(userId)
  const rows = await TeamMember.find({ userId: uid }).lean()
  for (const row of rows) {
    const team = await Team.findById(row.teamId).lean()
    if (!team) { await TeamMember.deleteOne({ _id: row._id }); continue }
    await removeMember(team, uid, { actor, accountDeleted: true }).catch(() => {})
  }
  await TeamRequest.deleteMany({ userId: uid })
  return rows.length
}

/* ---------------------------------------------- the per-team run cap */

/** teamId -> the cap the super admin set for that team. Teams without one use the site default. */
const concurrency = new Map()

async function loadConcurrency() {
  const rows = await Team.find({ concurrency: { $ne: null } }).select('concurrency').lean()
  concurrency.clear()
  for (const t of rows) if (Number.isInteger(t.concurrency)) concurrency.set(String(t._id), t.concurrency)
}

/** How many runs of one team may be in flight at the same time. Synchronous: the queue asks on every pick. */
function concurrencyOf(teamId) {
  const own = concurrency.get(String(teamId))
  return Number.isInteger(own) ? own : settings.get('teamConcurrency')
}

function setConcurrency(teamId, value) {
  if (Number.isInteger(value)) concurrency.set(String(teamId), value)
  else concurrency.delete(String(teamId))
}

/* ------------------------------------------------------------ housekeeping */

const SWEEP_INTERVAL_MS = 3600 * 1000
let timer = null

/** Remove the dissolved teams whose time is up, and the activity entries past their age. */
async function sweep(now = Date.now()) {
  const due = await Team.find({ status: 'dissolved', purgeAt: { $lte: new Date(now) } }).select('_id').lean()
  const purged = []
  for (const t of due) {
    const out = await purge(t._id).catch((err) => { console.error(`[teams] team ${t._id} could not be removed:`, err && err.message); return null })
    if (out) {
      purged.push(out.id)
      if (out.filesError) console.error(`[teams] files of removed team ${out.id} could not all be removed: ${out.filesError}`)
    }
  }
  const entries = await activity.sweep(settings.get('teamActivityDays'), now)
  return { purged, entries }
}

async function start() {
  await Promise.all([Team.init(), TeamMember.init(), TeamFormerMember.init(), TeamInvitation.init(), TeamActivity.init(), TeamRequest.init()])
  await loadConcurrency()
  if (timer) return
  const tick = () => sweep()
    .then((r) => { if (r.purged.length) console.log(`[teams] removed ${r.purged.length} dissolved team(s) whose ${DISSOLVE_GRACE_DAYS} days were up`) })
    .catch((err) => console.error('[teams] sweep failed:', err.message))
  timer = setInterval(tick, SWEEP_INTERVAL_MS)
  timer.unref()
  setTimeout(tick, 90 * 1000).unref()
}

function stop() {
  if (timer) clearInterval(timer)
  timer = null
}

module.exports = {
  DISSOLVE_GRACE_DAYS,
  INVITE_DEFAULTS,
  authorised,
  creationState,
  requestCreation,
  withdrawRequest,
  decideRequest,
  serializeRequest,
  createTeam,
  parseName,
  parseAvatar,
  serializeTeam,
  serializeSettings,
  maxMembersOf,
  memberCounts,
  listFor,
  listMembers,
  findMember,
  updateMember,
  removeMember,
  cancelQueued,
  limitPatch,
  listInvitations,
  createInvitation,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
  transfer,
  appointOwner,
  dissolve,
  restore,
  setSuspended,
  purge,
  assertAccountDeletable,
  forgetAccount,
  loadConcurrency,
  concurrencyOf,
  setConcurrency,
  sweep,
  start,
  stop,
  actorOf,
  remainingUses,
  PURGE_COUNT_KEYS,
}
