'use strict'

/**
 * /api/teams - teams as their members manage them: creating one (with the
 * super admin's authorisation), the team itself and its settings, members and
 * roles, invite links, monthly limits, usage, the activity log, handing the
 * team over, dissolving and restoring it.
 *
 * These routes name the team in the path, so they do not need the X-Space
 * header: `/api/teams/:id/...` acts in team :id, whatever the header says.
 * Membership is checked on every call exactly as for the header (see
 * services/spaces.js): a team the caller is not in is 404 `team.not_found`.
 * What a role may do is services/permissions.js; a refusal is 403 `team.forbidden`.
 *
 * What belongs to a team - canvases, assets, providers, runs - is reached
 * through the ordinary routes with `X-Space: <team id>`.
 */
const express = require('express')
const Team = require('../models/Team')
const TeamMember = require('../models/TeamMember')
const TeamActivity = require('../models/TeamActivity')
const Provider = require('../models/Provider')
const Workflow = require('../models/Workflow')
const registry = require('../providers')
const teams = require('../services/teams')
const spaces = require('../services/spaces')
const permissions = require('../services/permissions')
const activity = require('../services/activity')
const budget = require('../services/budget')
const admin = require('./admin')
const { ok, wrap, badRequest, ApiError } = require('../utils/http')
const { isPlainObject, isObjectId, pageParams, parseTimeZone, parseDayOrInstant } = require('../utils/validate')
const { TEAM_ROLES, VISIBILITY } = require('../constants')

const router = express.Router()

/** The path of the one setting that is changed with the limits rather than with the other settings. */
const BLOCK_UNPRICED = ['settings', 'blockUnpriced'].join('.')

const inTeam = spaces.teamFromPath()
/** Also for a team that is suspended or dissolved: the routes that show its state and bring it back. */
const inTeamEvenClosed = spaces.teamFromPath({ allowClosed: true })
const actor = (req) => teams.actorOf(req.user)
const need = (action) => [inTeam, spaces.requireCan(action)]

/* ------------------------------------------------- creating, and my teams */

/** GET /api/teams -> { teams: [Team], creation } - the teams I am in, and whether I may create one */
router.get('/', wrap(async (req, res) => {
  const [list, creation] = await Promise.all([teams.listFor(req.userId), teams.creationState(req.user)])
  ok(res, { teams: list, creation })
}))

/** POST /api/teams { name, avatar?, timezone? } - needs the super admin's authorisation (403 `team.not_authorised`) */
router.post('/', wrap(async (req, res) => {
  const team = await teams.createTeam(req.user, req.body)
  ok(res, teams.serializeTeam(team, { role: TEAM_ROLES.OWNER, members: 1 }))
}))

/** GET /api/teams/creation -> { authorised, canCreate, held, max, maxMembers, request } */
router.get('/creation', wrap(async (req, res) => {
  ok(res, await teams.creationState(req.user))
}))

/** POST /api/teams/creation-request { note? } - ask the super admin for the authorisation; one pending request at a time */
router.post('/creation-request', wrap(async (req, res) => {
  const request = await teams.requestCreation(req.user, isPlainObject(req.body) ? req.body.note : '')
  ok(res, { ...(await teams.creationState(req.user)), request })
}))

/** DELETE /api/teams/creation-request - take a pending request back */
router.delete('/creation-request', wrap(async (req, res) => {
  const withdrawn = await teams.withdrawRequest(req.user)
  ok(res, { withdrawn, ...(await teams.creationState(req.user)) })
}))

/* ------------------------------------------------------------- one team */

/** What a member is told about the limits: their own always; the team's and everybody's only with `usage.view_all`. */
async function limitsFor(req, { members = false, models = null } = {}) {
  const { team, member } = req.space
  // One definition of "used" for every number in it: see services/budget.js.
  return budget.limitsView(team, member, { all: permissions.can(req.space, 'usage:view_all'), members, models })
}

async function detail(req) {
  const { team, member, role } = req.space
  const teamId = String(team._id)
  const [members, hasProvider, hasCanvas] = await Promise.all([
    TeamMember.countDocuments({ teamId }),
    Provider.exists({ userId: teamId, enabled: true }),
    Workflow.exists({ userId: teamId, isDeleted: false }),
  ])
  return {
    ...teams.serializeTeam(team, { role, members }),
    settings: teams.serializeSettings(team),
    me: { id: req.userId, role, displayName: member.displayName || '', joinedAt: member.joinedAt },
    permissions: permissions.summary(req.space),
    // The three steps a new team is walked through; all true = nothing left to show.
    onboarding: { hasProvider: !!hasProvider, hasMembers: members > 1, hasCanvas: !!hasCanvas },
    // How many of the team's runs may be in flight at the same time: the cap the queue enforces
    // (the team's own when the super admin set one, else the site default).
    concurrency: teams.concurrencyOf(teamId),
    limits: team.status === 'active' ? await limitsFor(req) : null,
  }
}

/** GET /api/teams/:id - the team, my role and permissions in it, its settings, my limits. Also while it is closed. */
router.get('/:id', inTeamEvenClosed, wrap(async (req, res) => {
  // A closed team shows itself to its owner only: for everybody else it is as closed as any other door.
  if (req.space.team.status !== 'active' && req.space.role !== TEAM_ROLES.OWNER) {
    throw new ApiError(403, req.space.team.status === 'dissolved' ? 'team.dissolved' : 'team.suspended')
  }
  ok(res, await detail(req))
}))

const SETTING_PARSERS = {
  defaultVisibility: (v) => {
    if (!Object.values(VISIBILITY).includes(v)) throw badRequest('validation.one_of', { field: 'defaultVisibility', values: Object.values(VISIBILITY).join(' / ') })
    return v
  },
  publicShare: (v) => {
    if (!['editors', 'managers'].includes(v)) throw badRequest('validation.one_of', { field: 'publicShare', values: 'editors / managers' })
    return v
  },
  adminsSeeAll: (v) => bool(v, 'adminsSeeAll'),
  copyToPersonal: (v) => bool(v, 'copyToPersonal'),
  blockUnpriced: (v) => bool(v, 'blockUnpriced'),
}

function bool(v, field) {
  if (typeof v !== 'boolean') throw badRequest('validation.boolean', { field })
  return v
}

/**
 * PATCH /api/teams/:id { name?, avatar?, timezone?, settings?: { defaultVisibility?, publicShare?, adminsSeeAll?, copyToPersonal?, blockUnpriced? } }
 * Name and avatar: the owner and admins. Time zone and settings: the owner alone -
 * they decide who sees what and where the month of the limits begins.
 */
router.patch('/:id', inTeam, wrap(async (req, res) => {
  const b = isPlainObject(req.body) ? req.body : {}
  const { team } = req.space
  const set = {}
  const events = []
  if (b.name !== undefined || b.avatar !== undefined) {
    spaces.assertCan(req, 'team:rename')
    if (b.name !== undefined) {
      set.name = teams.parseName(b.name)
      if (set.name !== team.name) events.push(['team:renamed', { from: team.name, to: set.name }])
    }
    if (b.avatar !== undefined) {
      set.avatar = teams.parseAvatar(b.avatar)
      if (set.avatar !== (team.avatar || '')) events.push(['team:avatar_changed', { removed: !set.avatar }])
    }
  }
  const changed = []
  if (b.timezone !== undefined) {
    spaces.assertCan(req, 'team:settings')
    if (typeof b.timezone !== 'string' || !b.timezone) throw badRequest('validation.invalid', { field: 'timezone' })
    set.timezone = parseTimeZone(b.timezone, 'timezone')
    if (set.timezone !== team.timezone) changed.push('timezone')
  }
  if (b.settings !== undefined) {
    spaces.assertCan(req, 'team:settings')
    if (!isPlainObject(b.settings)) throw badRequest('validation.object', { field: 'settings' })
    const current = teams.serializeSettings(team)
    for (const [key, value] of Object.entries(b.settings)) {
      if (!Object.hasOwn(SETTING_PARSERS, key)) throw badRequest('settings.unknown_key', { key: String(key).slice(0, 40) })
      set[`settings.${key}`] = SETTING_PARSERS[key](value)
      if (current[key] !== set[`settings.${key}`]) changed.push(key)
    }
  }
  if (!Object.keys(set).length) throw badRequest('common.nothing_to_update')
  if (changed.length) {
    // What each changed setting was and is, keyed by its name (`timezone` included).
    const was = { ...teams.serializeSettings(team), timezone: team.timezone || 'UTC' }
    const now = (key) => (key === 'timezone' ? set.timezone : set[`settings.${key}`])
    events.push(['team:settings_changed', {
      changed,
      before: Object.fromEntries(changed.map((key) => [key, was[key]])),
      after: Object.fromEntries(changed.map((key) => [key, now(key)])),
    }])
  }
  const saved = await Team.findOneAndUpdate({ _id: team._id }, { $set: set }, { new: true }).lean()
  for (const [type, d] of events) await activity.record(team._id, actor(req), type, { type: 'team', id: team._id, name: saved.name }, d)
  req.space.team = saved
  ok(res, await detail(req))
}))

/** Typing the team's name is the confirmation for what cannot be taken back lightly. */
function confirmName(req, given) {
  if (given !== req.space.team.name) throw badRequest('team.confirm_mismatch')
}

/**
 * DELETE /api/teams/:id?confirm=<team name> - dissolve. The team closes at once and
 * can be restored for 7 days; then it is removed with everything in it.
 */
router.delete('/:id', need('team:dissolve'), wrap(async (req, res) => {
  confirmName(req, req.query.confirm)
  const team = await teams.dissolve(req.space.team, req.user)
  ok(res, teams.serializeTeam(team, { role: req.space.role }))
}))

/** POST /api/teams/:id/restore - undo a dissolution within its 7 days (the owner) */
router.post('/:id/restore', inTeamEvenClosed, spaces.requireCan('team:dissolve'), wrap(async (req, res) => {
  const team = await teams.restore(req.params.id, req.user)
  ok(res, teams.serializeTeam(team, { role: req.space.role }))
}))

/** POST /api/teams/:id/transfer { userId, confirm: <team name> } - hand the team to another member; the old owner becomes an admin */
router.post('/:id/transfer', need('team:transfer'), wrap(async (req, res) => {
  const b = isPlainObject(req.body) ? req.body : {}
  confirmName(req, b.confirm)
  const team = await teams.transfer(req.space.team, req.user, b.userId)
  ok(res, teams.serializeTeam(team, { role: TEAM_ROLES.ADMIN }))
}))

/** POST /api/teams/:id/leave - the owner cannot: hand the team over or dissolve it first (409 `team.owner_cannot_leave`) */
router.post('/:id/leave', inTeam, wrap(async (req, res) => {
  const out = await teams.removeMember(req.space.team, req.userId, { actor: actor(req), type: 'member:left' })
  ok(res, { left: true, canvasesInherited: out.canvasesInherited, runsCanceled: out.runsCanceled })
}))

/* ---------------------------------------------------------------- members */

/** GET /api/teams/:id/members - who is in the team. With `usage.view_all`: also each member's month and limits. */
router.get('/:id/members', inTeam, wrap(async (req, res) => {
  const withUsage = permissions.can(req.space, 'usage:view_all')
  ok(res, {
    members: await teams.listMembers(req.space.team, { withUsage }),
    maxMembers: teams.maxMembersOf(req.space.team),
    withUsage,
  })
}))

/**
 * PATCH /api/teams/:id/members/:userId { role?, displayName?, limits? }
 *   role: 'admin' | 'member'          the owner only
 *   limits: { runs?, amount? }        the owner only; null = follow the team's default
 *   displayName                       oneself, or the owner and admins for anybody
 */
router.patch('/:id/members/:userId', inTeam, wrap(async (req, res) => {
  const b = isPlainObject(req.body) ? req.body : {}
  const patch = {}
  if (b.role !== undefined) { spaces.assertCan(req, 'member:set_role'); patch.role = b.role }
  if (b.limits !== undefined) { spaces.assertCan(req, 'limits:manage'); patch.limits = b.limits }
  if (b.displayName !== undefined) {
    if (req.params.userId !== req.userId && !spaces.isManager(req.space)) throw new ApiError(403, 'team.forbidden')
    patch.displayName = b.displayName
  }
  if (!Object.keys(patch).length) throw badRequest('common.nothing_to_update')
  await teams.updateMember(req.space.team, actor(req), req.params.userId, patch)
  const withUsage = permissions.can(req.space, 'usage:view_all')
  const list = await teams.listMembers(req.space.team, { withUsage })
  ok(res, list.find((m) => m.id === req.params.userId))
}))

/**
 * DELETE /api/teams/:id/members/:userId - remove somebody. The owner anybody else; an admin plain members.
 * -> { removed, canvasesInherited, runsCanceled, keysSet } - `keysSet`: providers whose key
 * the removed admin entered, as a reminder to replace those keys at the upstream.
 */
router.delete('/:id/members/:userId', inTeam, wrap(async (req, res) => {
  if (req.params.userId === req.userId) throw badRequest('team.use_leave')
  const target = await teams.findMember(req.space.team, req.params.userId)
  spaces.assertCan(req, 'member:remove', { target: { role: spaces.roleIn(req.space.team, target) } })
  const out = await teams.removeMember(req.space.team, req.params.userId, { actor: actor(req) })
  ok(res, { removed: true, canvasesInherited: out.canvasesInherited, runsCanceled: out.runsCanceled, keysSet: out.keysSet })
}))

/* ------------------------------------------------------------ invitations */

/** GET /api/teams/:id/invitations - every invite link of the team, with its token (the owner and admins) */
router.get('/:id/invitations', need('invite:manage'), wrap(async (req, res) => {
  ok(res, await teams.listInvitations(req.space.team))
}))

/** POST /api/teams/:id/invitations { expiresInDays?: 1..90 (7), maxUses?: 0..1000 (10; 0 = unlimited) } */
router.post('/:id/invitations', need('invite:manage'), wrap(async (req, res) => {
  ok(res, await teams.createInvitation(req.space.team, req.user, req.body))
}))

/** DELETE /api/teams/:id/invitations/:invitationId - the link stops working at once */
router.delete('/:id/invitations/:invitationId', need('invite:manage'), wrap(async (req, res) => {
  ok(res, await teams.revokeInvitation(req.space.team, req.user, req.params.invitationId))
}))

/* ------------------------------------------------------- usage and limits */

/**
 * GET /api/teams/:id/usage?from&to&groupBy=member|model|day[&member][&tz]
 * GET /api/teams/:id/usage/records?page&pageSize&from&to&kind&status&model[&member]
 * The same answers as /api/admin/usage with `X-Space: <team id>`. Whose records: see `usage.view_all`.
 */
router.get('/:id/usage', inTeam, wrap(admin.usageSummary))
router.get('/:id/usage/records', inTeam, wrap(admin.usageRecords))
/** GET /api/teams/:id/usage/records/:recordId - one record in full (the whole prompt and text answer); the same as /api/admin/usage/records/:recordId. */
router.get('/:id/usage/records/:recordId', inTeam, wrap((req, res) => admin.usageRecord(req, res)))

/**
 * Enabled models whose cost the limits cannot count - no price, or a price in another
 * currency - and what that means right now: { uncountable, unpriced } (budget.uncountableView).
 */
const enabledModels = (team) => registry.listModels({ userId: String(team._id) })

/**
 * The limits answer in full: this month for the caller, what the caller cannot run because of
 * prices (`cannotRun`), and - for the owner and admins - `uncountable` and `unpriced`.
 */
async function limitsAnswer(req, { members = false } = {}) {
  const models = await enabledModels(req.space.team)
  const out = await limitsFor(req, { members, models })
  if (spaces.isManager(req.space)) Object.assign(out, await budget.uncountableView(req.space.team, models))
  return out
}

/**
 * GET /api/teams/:id/limits[?members=1] - this month for the caller; with `usage.view_all` also
 * for the team, and with `members=1` for every member. Everybody gets `managers` (who to ask)
 * and `cannotRun` (the models the caller cannot run because their cost cannot be counted); the
 * owner and admins also get `uncountable` and `unpriced`: those models for the team as a whole,
 * and the consequence.
 */
router.get('/:id/limits', inTeam, wrap(async (req, res) => {
  ok(res, await limitsAnswer(req, { members: req.query.members === '1' || req.query.members === 'true' }))
}))

/**
 * PUT /api/teams/:id/limits { team?: { runs?, amount? }, memberDefault?: { runs?, amount? }, currency?, blockUnpriced? }
 * The owner only. A number sets a limit, null removes it. Takes effect on the next run.
 * One member's own limits: PATCH /api/teams/:id/members/:userId { limits }.
 */
router.put('/:id/limits', need('limits:manage'), wrap(async (req, res) => {
  const b = isPlainObject(req.body) ? req.body : {}
  const { team } = req.space
  const set = {}
  if (b.team !== undefined) Object.assign(set, teams.limitPatch(b.team, 'limits.team'))
  if (b.memberDefault !== undefined) Object.assign(set, teams.limitPatch(b.memberDefault, 'limits.memberDefault'))
  if (b.currency !== undefined) {
    if (typeof b.currency !== 'string' || !/^[A-Za-z]{2,8}$/.test(b.currency.trim())) throw badRequest('validation.invalid', { field: 'currency' })
    set['limits.currency'] = b.currency.trim().toUpperCase()
  }
  if (b.blockUnpriced !== undefined) set[BLOCK_UNPRICED] = bool(b.blockUnpriced, 'blockUnpriced')
  if (!Object.keys(set).length) throw badRequest('common.nothing_to_update')
  const view = (t) => ({
    team: budget.teamLimits(t),
    memberDefault: { runs: budget.memberLimits(t, null).runs, amount: budget.memberLimits(t, null).amount },
    currency: (t.limits && t.limits.currency) || 'CNY',
    blockUnpriced: !t.settings || t.settings.blockUnpriced !== false,
  })
  const saved = await Team.findOneAndUpdate({ _id: team._id }, { $set: set }, { new: true }).lean()
  await activity.record(team._id, actor(req), 'limits:team_changed', { type: 'team', id: team._id, name: saved.name }, { before: view(team), after: view(saved) })
  req.space.team = saved
  ok(res, await limitsAnswer(req))
}))

/* --------------------------------------------------------------- activity */

/**
 * GET /api/teams/:id/activity?category&actor&from&to&page&pageSize[&tz]
 * The team's activity log, newest first (the owner and admins). Read only: no route changes or removes an entry.
 */
router.get('/:id/activity', need('activity:view'), wrap(async (req, res) => {
  const { page, pageSize, skip } = pageParams(req.query, { defaultSize: 50, maxSize: 200 })
  const { team } = req.space
  const filter = { teamId: String(team._id) }
  const q = req.query
  if (q.category !== undefined && q.category !== '') {
    if (!activity.CATEGORIES.includes(q.category)) throw badRequest('validation.one_of', { field: 'category', values: activity.CATEGORIES.join(' / ') })
    filter.category = q.category
  }
  if (q.actor !== undefined && q.actor !== '') {
    if (!isObjectId(q.actor)) throw badRequest('validation.bad_format', { field: 'actor' })
    filter.actorId = q.actor
  }
  const tz = parseTimeZone(q.tz === undefined ? team.timezone : q.tz)
  const from = parseDayOrInstant(q.from, 'from', tz)
  const to = parseDayOrInstant(q.to, 'to', tz, 1)
  if (from || to) {
    filter.createdAt = {}
    if (from) filter.createdAt.$gte = from.date
    if (to) filter.createdAt.$lt = to.date
  }
  const [total, rows] = await Promise.all([
    TeamActivity.countDocuments(filter),
    TeamActivity.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(pageSize).lean(),
  ])
  // The people of an entry are shown as they are in the team today: its display names, and who has left since.
  const names = await spaces.people(activity.peopleIds(rows), team._id)
  ok(res, { list: rows.map((r) => activity.serialize(r, req.locale, names)), categories: activity.CATEGORIES, total, page, pageSize })
}))

module.exports = router
