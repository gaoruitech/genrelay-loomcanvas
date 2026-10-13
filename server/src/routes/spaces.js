'use strict'

/**
 * /api/spaces - questions about the spaces of the caller that are not about one of them.
 *
 *   GET /copy-targets?kind=canvas|asset[&assetKind=product|brand|reference|output]
 *
 * Where could something of the space this request acts in (X-Space) be copied
 * to? Every space the caller is in is listed - the personal one and each team,
 * closed teams included - and each says whether it can take the copy and, when
 * it cannot, why (`reason`, with `message` in the reader's language). The copy
 * routes (POST /api/workflow/:id/copy, POST /api/user-asset/:id/copy) refuse
 * for the same reasons with the errors named in REASONS; this is the same
 * check, asked ahead of time, so a dialog can explain instead of failing.
 */
const express = require('express')
const Team = require('../models/Team')
const TeamMember = require('../models/TeamMember')
const { UserAsset, USER_ASSET_KINDS } = require('../models/Asset')
const spaces = require('../services/spaces')
const permissions = require('../services/permissions')
const { ok, wrap, badRequest } = require('../utils/http')
const { t } = require('../i18n')
const { TEAM_ROLES } = require('../constants')

const router = express.Router()

/** Kept in step with routes/assets.js. */
const ASSET_LIMIT_PER_KIND = 5000

/** reason -> the catalog key of its sentence (the same key the copy route answers with where there is one). */
const REASONS = {
  same_space: 'space.same_space',
  copy_out_disabled: 'space.copy_out_disabled',
  team_suspended: 'team.suspended',
  team_dissolved: 'team.dissolved',
  no_permission: 'team.forbidden',
  asset_kind_full: 'asset.kind_full',
}

/** What is needed in the target to receive a copy of that kind. */
const NEEDS = { canvas: 'canvas:create', asset: 'asset:use' }

router.get('/copy-targets', wrap(async (req, res) => {
  const kind = req.query.kind === undefined || req.query.kind === '' ? 'canvas' : req.query.kind
  if (!Object.hasOwn(NEEDS, kind)) throw badRequest('validation.one_of', { field: 'kind', values: Object.keys(NEEDS).join(' / ') })
  let assetKind = ''
  if (kind === 'asset' && req.query.assetKind !== undefined && req.query.assetKind !== '') {
    if (!USER_ASSET_KINDS.includes(req.query.assetKind)) throw badRequest('validation.one_of', { field: 'assetKind', values: USER_ASSET_KINDS.join(' / ') })
    assetKind = req.query.assetKind
  }

  const rows = await TeamMember.find({ userId: req.userId }).sort({ joinedAt: 1 }).lean()
  const teams = rows.length ? await Team.find({ _id: { $in: rows.map((r) => r.teamId) } }).lean() : []
  const teamById = new Map(teams.map((team) => [String(team._id), team]))

  const candidates = [{ id: spaces.PERSONAL, spaceId: req.userId, kind: spaces.PERSONAL, name: '', avatar: '', role: TEAM_ROLES.OWNER, space: spaces.personalSpace(req.userId), status: 'active' }]
  for (const row of rows) {
    const team = teamById.get(row.teamId)
    if (!team) continue
    const role = spaces.roleIn(team, row)
    candidates.push({
      id: String(team._id), spaceId: String(team._id), kind: 'team', name: team.name, avatar: team.avatar || '', role, status: team.status,
      space: { id: String(team._id), kind: 'team', role, team, member: row, userId: req.userId },
    })
  }

  const source = req.space
  const copyOut = source.kind !== 'team' || source.role === TEAM_ROLES.OWNER || !source.team.settings || source.team.settings.copyToPersonal !== false
  const full = assetKind
    ? new Set((await UserAsset.aggregate([
      { $match: { userId: { $in: candidates.map((c) => c.spaceId) }, isDeleted: false, kind: assetKind } },
      { $group: { _id: '$userId', n: { $sum: 1 } } },
    ])).filter((r) => r.n >= ASSET_LIMIT_PER_KIND).map((r) => r._id))
    : new Set()

  const targets = candidates.map((c) => {
    let reason = ''
    let params = {}
    if (c.spaceId === req.spaceId) reason = 'same_space'
    else if (c.status === 'suspended') reason = 'team_suspended'
    else if (c.status === 'dissolved') reason = 'team_dissolved'
    else if (c.kind !== 'team' && !copyOut) reason = 'copy_out_disabled'
    else if (!permissions.can(c.space, NEEDS[kind])) reason = 'no_permission'
    else if (full.has(c.spaceId)) { reason = 'asset_kind_full'; params = { max: ASSET_LIMIT_PER_KIND } }
    return {
      // What to send as `toSpace`: 'personal' or the team's id.
      id: c.id,
      kind: c.kind,
      name: c.name,
      avatar: c.avatar,
      role: c.role,
      status: c.status,
      current: c.spaceId === req.spaceId,
      available: !reason,
      reason,
      message: reason ? t(req.locale, REASONS[reason], params) : '',
    }
  })
  ok(res, { kind, from: { id: source.kind === 'team' ? source.id : spaces.PERSONAL, kind: source.kind }, targets })
}))

module.exports = router
module.exports.REASONS = REASONS
