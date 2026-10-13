'use strict'

/**
 * Spaces: where a request acts.
 *
 * Every account has a personal space; a team is a second kind of space that
 * several accounts share. What belongs to a space carries the space's id in
 * `userId` - the account's id for a personal space, the team's id for a team
 * (see docs/architecture.md, "Spaces"). So one question has to be answered
 * for every request before any query runs: which space, and as what.
 *
 *  - The `X-Space` request header names the space: a team id, or `personal`.
 *    Without it the request acts on the caller's personal space - which is
 *    what every client from before teams does, unchanged.
 *  - Membership is looked up on every request (resolve below). Nothing about
 *    it is cached in the session, so removing a member takes effect on that
 *    member's very next call.
 *  - A team the caller is not in answers exactly like a team that does not
 *    exist: 404 `team.not_found`.
 *
 * Routes read `req.spaceId` (what to scope queries by), `req.userId` (who is
 * acting) and `req.space` ({ id, kind, role, team, member, userId }).
 */
const Team = require('../models/Team')
const TeamMember = require('../models/TeamMember')
const TeamFormerMember = require('../models/TeamFormerMember')
const User = require('../models/User')
const permissions = require('./permissions')
const { ApiError, notFound } = require('../utils/http')
const { isObjectId } = require('../utils/validate')
const { TEAM_ROLES } = require('../constants')

const PERSONAL = 'personal'
const HEADER = 'x-space'

const personalSpace = (userId) => ({ id: String(userId), kind: PERSONAL, role: TEAM_ROLES.OWNER, team: null, member: null, userId: String(userId) })

/** The role a member row gives its account in that team. */
function roleIn(team, member) {
  if (String(team.ownerId) === String(member.userId)) return TEAM_ROLES.OWNER
  return member.role === TEAM_ROLES.ADMIN ? TEAM_ROLES.ADMIN : TEAM_ROLES.MEMBER
}

/**
 * The space `raw` names for this account, or an ApiError.
 * `allowClosed`: also resolve a suspended or dissolved team (the routes that
 * show its state and restore it); everything else is refused there.
 */
async function resolve(userId, raw, { allowClosed = false } = {}) {
  const uid = String(userId)
  const wanted = raw === undefined || raw === null ? '' : String(raw).trim()
  if (!wanted || wanted === PERSONAL) return personalSpace(uid)
  if (!isObjectId(wanted)) throw new ApiError(400, 'team.bad_space')
  const [team, member] = await Promise.all([
    Team.findById(wanted).lean(),
    TeamMember.findOne({ teamId: wanted, userId: uid }).lean(),
  ])
  // Not a member: the same answer as for an id that was never a team.
  if (!team || !member) throw notFound('team.not_found')
  if (team.status !== 'active' && !allowClosed) {
    throw new ApiError(403, team.status === 'dissolved' ? 'team.dissolved' : 'team.suspended')
  }
  return { id: String(team._id), kind: 'team', role: roleIn(team, member), team, member, userId: uid }
}

function attach(req, space) {
  req.space = space
  req.spaceId = space.id
}

/**
 * The super admin's site pages (accounts, teams, settings, storage) act on the
 * site, not in a space. A header that names a team the caller has just lost
 * must not lock them out of those: there the personal space stands in.
 */
const SITE_PATHS = /^\/admin\/(users|site|teams|team-requests|settings|storage)(\/|$)/

/** After requireAuth: sets req.space / req.spaceId from the X-Space header. */
function resolveSpace(req, _res, next) {
  resolve(req.userId, req.headers[HEADER]).then((space) => { attach(req, space); next() }, (err) => {
    if (!SITE_PATHS.test(req.path)) return next(err)
    attach(req, personalSpace(req.userId))
    next()
  })
}

/**
 * For routes addressed by the team's id in the path (/api/teams/:id/...):
 * the path names the space, whatever the header says.
 */
function teamFromPath({ allowClosed = false } = {}) {
  return (req, _res, next) => {
    if (!isObjectId(req.params.id)) return next(notFound('team.not_found'))
    resolve(req.userId, req.params.id, { allowClosed }).then((space) => { attach(req, space); next() }, next)
  }
}

const forbidden = () => new ApiError(403, 'team.forbidden')

/** Throws 403 `team.forbidden` unless the caller may do `action` here (see services/permissions.js). */
function assertCan(req, action, ctx) {
  if (!permissions.can(req.space, action, ctx)) throw forbidden()
}

/** Middleware form of assertCan, for actions that do not depend on a document. */
function requireCan(action) {
  return (req, _res, next) => (permissions.can(req.space, action) ? next() : next(forbidden()))
}

const isTeam = (req) => !!req.space && req.space.kind === 'team'
const isManager = (space) => space.kind !== 'team' || space.role === TEAM_ROLES.OWNER || space.role === TEAM_ROLES.ADMIN

/** The three things a person can be to the space that shows them. */
const PERSON_STATES = Object.freeze({ ACTIVE: 'active', LEFT: 'left', DELETED: 'deleted' })

/**
 * `state` of a person from the two flags, for the objects built by hand
 * elsewhere: 'deleted' (the account is gone) wins over 'left' (the account
 * exists, but is no longer in this team).
 */
const stateOf = (p) => (p.deleted ? PERSON_STATES.DELETED : p.left ? PERSON_STATES.LEFT : PERSON_STATES.ACTIVE)

/**
 * Who the accounts behind a set of ids are, as other members of the space see
 * them - the one Person shape of the API:
 *
 *   { id, username, name, state, left, deleted }
 *
 *  - `state`: 'active' - in the team (or, in a personal space, an existing
 *    account); 'left' - the account exists but is no longer in this team (it
 *    left or was removed); 'deleted' - the account itself is gone.
 *  - `name`: the display name the member chose in this team, else the
 *    username. For somebody who is gone it is the name they went by when they
 *    left (TeamFormerMember), so what they made still says whose it was; ''
 *    only when nothing was kept (they left before names were kept).
 *  - `left` / `deleted`: the same answer as two flags, as older clients read
 *    it: `left` = not in the team (true for 'left' and for 'deleted' in a
 *    team), `deleted` = the account is gone.
 */
async function people(ids, teamId = '') {
  const wanted = [...new Set((ids || []).map((id) => String(id || '')).filter(isObjectId))]
  const out = new Map()
  if (!wanted.length) return out
  const team = teamId ? String(teamId) : ''
  const [users, members] = await Promise.all([
    User.find({ _id: { $in: wanted } }).select('username').lean(),
    team ? TeamMember.find({ teamId: team, userId: { $in: wanted } }).select('userId displayName').lean() : [],
  ])
  const byUser = new Map(users.map((u) => [String(u._id), u]))
  const byMember = new Map(members.map((m) => [m.userId, m]))
  const gone = team ? wanted.filter((id) => !byMember.has(id)) : []
  const former = gone.length ? await TeamFormerMember.find({ teamId: team, userId: { $in: gone } }).select('userId username displayName').lean() : []
  const byFormer = new Map(former.map((f) => [f.userId, f]))
  for (const id of wanted) {
    const user = byUser.get(id)
    const member = byMember.get(id)
    const was = byFormer.get(id)
    const username = user ? user.username : (was && was.username) || ''
    const person = {
      id,
      username,
      name: (member && member.displayName) || (!member && was && was.displayName) || username,
      left: !!team && !member,
      deleted: !user,
    }
    person.state = stateOf(person)
    out.set(id, person)
  }
  return out
}

/** One person out of people(), with a neutral stand-in for an id nobody answers to. */
function personOf(map, id) {
  const key = String(id || '')
  if (!key) return null
  const person = map.get(key) || { id: key, username: '', name: '', left: true, deleted: true }
  // Objects that were put into the map by hand (the one person of a personal space) get their state here.
  if (!person.state) person.state = stateOf(person)
  return person
}

module.exports = { PERSONAL, HEADER, PERSON_STATES, resolve, resolveSpace, teamFromPath, assertCan, requireCan, isTeam, isManager, roleIn, personalSpace, people, personOf, stateOf }
