'use strict'

/**
 * Super admin only: the teams of this instance - that they exist, how large
 * they may be, and who may create them. As with accounts, the super admin
 * manages the container and not its contents: nothing here returns a canvas,
 * a key, a prompt or a file of a team, only names and numbers.
 *
 *  - who may create teams: the per-account authorisation (PATCH
 *    /api/admin/users/:id { canCreateTeams }) and the requests for it, below;
 *    how many and how large is in the site settings (teamMaxPerUser,
 *    teamMaxMembers, teamConcurrency, teamActivityDays);
 *  - a team's own limits (members, runs in flight), closing and reopening it,
 *    removing it for good;
 *  - naming a new owner when the current one's account cannot be used.
 */
const express = require('express')
const Team = require('../models/Team')
const TeamRequest = require('../models/TeamRequest')
const User = require('../models/User')
const Workflow = require('../models/Workflow')
const Run = require('../models/Run')
const teams = require('../services/teams')
const settings = require('../services/settings')
const { getRunner } = require('../runner')
const { ok, wrap, badRequest, notFound } = require('../utils/http')
const { isObjectId, isPlainObject, pageParams } = require('../utils/validate')

const router = express.Router()

const MAX_LISTED = 1000

async function countBy(model, field, match) {
  const rows = await model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, n: { $sum: 1 } } }])
  return new Map(rows.map((r) => [String(r._id), r.n]))
}

/** Teams as the super admin sees them: who owns them and how big they are. */
async function describe(list) {
  const ids = list.map((t) => String(t._id))
  const [members, workflows, runs, owners] = await Promise.all([
    teams.memberCounts(ids),
    countBy(Workflow, 'userId', { userId: { $in: ids }, isDeleted: false }),
    countBy(Run, 'teamId', { teamId: { $in: ids } }),
    User.find({ _id: { $in: list.map((t) => t.ownerId) } }).select('username disabled').lean(),
  ])
  const ownerById = new Map(owners.map((u) => [String(u._id), u]))
  return list.map((t) => {
    const id = String(t._id)
    const owner = ownerById.get(String(t.ownerId))
    return {
      id,
      name: t.name,
      // '' when the team has none; the client then draws the initial of the name.
      avatar: t.avatar || '',
      status: t.status,
      // `usable: false` - the account is disabled or gone - is when a new owner can be appointed.
      owner: { id: String(t.ownerId), username: owner ? owner.username : '', usable: !!owner && !owner.disabled },
      counts: { members: members.get(id) || 0, workflows: workflows.get(id) || 0, runs: runs.get(id) || 0 },
      // null = the site default applies (given next to it).
      maxMembers: Number.isInteger(t.maxMembers) ? t.maxMembers : null,
      concurrency: Number.isInteger(t.concurrency) ? t.concurrency : null,
      effective: { maxMembers: teams.maxMembersOf(t), concurrency: teams.concurrencyOf(id) },
      dissolvedAt: t.dissolvedAt || null,
      purgeAt: t.status === 'dissolved' ? t.purgeAt || null : null,
      createdAt: t.createdAt,
    }
  })
}

async function one(id) {
  const team = isObjectId(id) ? await Team.findById(id).lean() : null
  if (!team) throw notFound('team.not_found')
  return team
}

/** GET /api/admin/teams -> { teams, defaults: { teamMaxPerUser, teamMaxMembers, teamConcurrency, teamActivityDays } } */
router.get('/teams', wrap(async (_req, res) => {
  const list = await Team.find({}).sort({ createdAt: 1 }).limit(MAX_LISTED).lean()
  const s = settings.getAll()
  ok(res, {
    teams: await describe(list),
    defaults: { teamMaxPerUser: s.teamMaxPerUser, teamMaxMembers: s.teamMaxMembers, teamConcurrency: s.teamConcurrency, teamActivityDays: s.teamActivityDays },
  })
}))

function limit(v, field, max) {
  if (v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > max) throw badRequest('validation.int_range', { field, min: 1, max })
  return v
}

/**
 * PATCH /api/admin/teams/:id { maxMembers?, concurrency?, status? }
 *   maxMembers 1..1000, concurrency 1..32: this team's own limits; null = back to the site default
 *   status 'suspended' | 'active': close the team (nobody gets in, queued runs are canceled,
 *   share links stop; nothing is removed) or open it again
 */
router.patch('/teams/:id', wrap(async (req, res) => {
  let team = await one(req.params.id)
  const b = isPlainObject(req.body) ? req.body : {}
  const set = {}
  if (b.maxMembers !== undefined) set.maxMembers = limit(b.maxMembers, 'maxMembers', 1000)
  if (b.concurrency !== undefined) set.concurrency = limit(b.concurrency, 'concurrency', 32)
  if (b.status !== undefined && !['active', 'suspended'].includes(b.status)) throw badRequest('validation.one_of', { field: 'status', values: 'active / suspended' })
  if (!Object.keys(set).length && b.status === undefined) throw badRequest('common.nothing_to_update')
  if (Object.keys(set).length) {
    team = await Team.findOneAndUpdate({ _id: team._id }, { $set: set }, { new: true }).lean()
    if (set.concurrency !== undefined) {
      teams.setConcurrency(team._id, set.concurrency)
      // A raised cap takes effect without waiting for the next run.
      getRunner().kick()
    }
  }
  if (b.status !== undefined) team = await teams.setSuspended(team._id, b.status === 'suspended')
  ok(res, (await describe([team]))[0])
}))

/**
 * POST /api/admin/teams/:id/owner { userId } - name a new owner. Only while the current
 * owner's account is disabled or gone (409 `team.owner_usable` otherwise); the new owner
 * has to be a member of the team with a usable account. The old owner becomes an admin.
 */
router.post('/teams/:id/owner', wrap(async (req, res) => {
  const b = isPlainObject(req.body) ? req.body : {}
  const team = await teams.appointOwner(req.params.id, b.userId)
  ok(res, (await describe([team]))[0])
}))

/**
 * GET /api/admin/teams/:id/members -> [{ id, username, role, disabled }]
 * Who can be named the new owner. Names and roles only.
 */
router.get('/teams/:id/members', wrap(async (req, res) => {
  const team = await one(req.params.id)
  const members = await teams.listMembers(team)
  ok(res, members.map((m) => ({ id: m.id, username: m.username, role: m.role, disabled: m.disabled })))
}))

/** POST /api/admin/teams/:id/restore - undo a dissolution while the team is still there */
router.post('/teams/:id/restore', wrap(async (req, res) => {
  const team = await teams.restore(req.params.id, null)
  ok(res, (await describe([team]))[0])
}))

/**
 * DELETE /api/admin/teams/:id?confirm=<team name>
 * Remove a team for good, now: everything in it and its files. Only a team that is
 * already closed - suspended, or dissolved by its owner - can be removed (409
 * `team.still_active`), and the name in the query is the confirmation.
 *
 * -> { id, name, counts, filesRemoved, removed, files }
 * `counts` is everything that went, every kind present (0 when there was none):
 * { members, invitations, activity, canvases, shares, assets, brandKits, providers,
 *   modelOverrides, runs, templates, textTemplates, files }.
 * `removed` (per collection, absent when 0) and `files` are the older form of the same.
 */
router.delete('/teams/:id', wrap(async (req, res) => {
  const team = await one(req.params.id)
  if (req.query.confirm !== team.name) throw badRequest('team.confirm_mismatch')
  const out = await teams.purge(team._id)
  // Removed by somebody else between the two reads: there is nothing left to report.
  if (!out) throw notFound('team.not_found')
  if (out.filesError) console.error(`[teams] files of removed team ${out.id} could not all be removed: ${out.filesError}`)
  ok(res, { id: out.id, name: out.name, counts: out.counts, removed: out.removed, files: out.files, filesRemoved: !out.filesError })
}))

/* ---------------------------------------- requests for the authorisation */

/** GET /api/admin/team-requests?status=pending|approved|rejected&page&pageSize -> { list, total, pending } */
router.get('/team-requests', wrap(async (req, res) => {
  const { page, pageSize, skip } = pageParams(req.query, { defaultSize: 50, maxSize: 200 })
  const status = req.query.status === undefined || req.query.status === '' ? 'pending' : req.query.status
  if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw badRequest('validation.one_of', { field: 'status', values: 'pending / approved / rejected / all' })
  const filter = status === 'all' ? {} : { status }
  const [total, pending, rows] = await Promise.all([
    TeamRequest.countDocuments(filter),
    TeamRequest.countDocuments({ status: 'pending' }),
    TeamRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
  ])
  const users = await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select('username email disabled canCreateTeams').lean()
  const byId = new Map(users.map((u) => [String(u._id), u]))
  ok(res, {
    list: rows.map((r) => {
      const u = byId.get(r.userId)
      return {
        ...teams.serializeRequest(r),
        user: { id: r.userId, username: u ? u.username : '', email: u ? u.email || '' : '', disabled: !u || !!u.disabled, canCreateTeams: !!(u && u.canCreateTeams) },
      }
    }),
    total,
    pending,
    page,
    pageSize,
  })
}))

/** POST /api/admin/team-requests/:id/approve - grants the account the authorisation to create teams */
router.post('/team-requests/:id/approve', wrap(async (req, res) => {
  ok(res, teams.serializeRequest(await teams.decideRequest(req.user, req.params.id, { approve: true })))
}))

/** POST /api/admin/team-requests/:id/reject { reason? } - the account sees the reason and may ask again */
router.post('/team-requests/:id/reject', wrap(async (req, res) => {
  const b = isPlainObject(req.body) ? req.body : {}
  ok(res, teams.serializeRequest(await teams.decideRequest(req.user, req.params.id, { approve: false, reason: b.reason })))
}))

module.exports = router
