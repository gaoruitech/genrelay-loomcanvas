'use strict'

/**
 * Super admin only: the accounts of this instance and whether new ones may be
 * created. The super admin manages accounts, not their contents - nothing here
 * returns a canvas, a key or a file of another account, only how many there are.
 */
const express = require('express')
const User = require('../models/User')
const Workflow = require('../models/Workflow')
const accounts = require('../services/accounts')
const settings = require('../services/settings')
const teams = require('../services/teams')
const { getRunner } = require('../runner')
const { ok, wrap, badRequest, notFound } = require('../utils/http')
const { isObjectId, isPlainObject } = require('../utils/validate')
const { ROLES } = require('../constants')

const router = express.Router()

const MAX_LISTED = 1000

/**
 * The account an owner action is about. The owner cannot disable, delete or
 * reset themself here (their own password goes through /api/auth/password), and
 * an owner account is never a target: without it nobody could manage the site.
 */
async function target(req) {
  if (!isObjectId(req.params.id)) throw notFound('auth.user_not_found')
  const user = await User.findById(req.params.id)
  if (!user) throw notFound('auth.user_not_found')
  if (String(user._id) === req.userId) throw badRequest('auth.cannot_modify_self')
  if (user.role === ROLES.OWNER) throw badRequest('auth.cannot_modify_owner')
  return user
}

const serialize = (u, counts, teamCounts) => ({
  ...accounts.serializeUser(u),
  disabled: !!u.disabled,
  lastLoginAt: u.lastLoginAt || null,
  // May this account create teams? The super admin always may; everybody else by this grant.
  canCreateTeams: u.role === ROLES.OWNER || !!u.canCreateTeams,
  counts: counts.get(String(u._id)) || { workflows: 0, runs: 0 },
  // How many teams the account is in, and how many of those it owns.
  teams: (teamCounts && teamCounts.get(String(u._id))) || { member: 0, owned: 0 },
})

const allCounts = () => Promise.all([accounts.countsByUser(), accounts.teamCountsByUser()])

/** GET /api/admin/users -> [{ ...User, disabled, lastLoginAt, canCreateTeams, counts: { workflows, runs }, teams: { member, owned } }] */
router.get('/users', wrap(async (_req, res) => {
  const [users, [counts, teamCounts]] = await Promise.all([
    User.find({}).sort({ createdAt: 1 }).limit(MAX_LISTED).lean(),
    allCounts(),
  ])
  ok(res, users.map((u) => serialize(u, counts, teamCounts)))
}))

/**
 * PATCH /api/admin/users/:id { disabled?, canCreateTeams? }
 *   disabled        a disabled account is signed out at once and cannot sign in. Its teams
 *                   and memberships stay; for a team it owns, a new owner can be appointed
 *                   (POST /api/admin/teams/:id/owner). What it had waiting in the queue - in
 *                   its own space and in every team - is canceled, exactly as for a member who
 *                   is removed (`runsCanceled` in the answer says how many); a run that already
 *                   started is left to finish.
 *   canCreateTeams  the authorisation to create teams. Taking it back stops new teams;
 *                   the ones the account created stay.
 */
router.patch('/users/:id', wrap(async (req, res) => {
  const user = await target(req)
  const body = isPlainObject(req.body) ? req.body : {}
  if (body.canCreateTeams !== undefined && typeof body.canCreateTeams !== 'boolean') throw badRequest('validation.boolean', { field: 'canCreateTeams' })
  if (typeof body.disabled !== 'boolean' && body.canCreateTeams === undefined) throw badRequest('validation.boolean', { field: 'disabled' })
  if (typeof body.disabled === 'boolean') user.disabled = body.disabled
  if (body.canCreateTeams !== undefined) user.canCreateTeams = body.canCreateTeams
  await user.save()
  let runsCanceled = 0
  if (typeof body.disabled === 'boolean' && user.disabled) {
    await accounts.revokeSessions(user._id)
    // An account that cannot act any more starts nothing new either: its queued runs go the
    // way a removed member's do (teams.cancelQueued). The one submitted in this very instant
    // is caught where runs are sent (runner resolveRun: `run.account_disabled`).
    const uid = String(user._id)
    runsCanceled = await teams.cancelQueued({ $or: [{ createdBy: uid }, { userId: uid }] }, 'account_disabled')
    // Nor does it go on holding canvases: the edit locks it had are given back at once, so
    // nobody waits out the lock's lifetime for somebody who cannot come back to it.
    await Workflow.updateMany({ 'lock.by': uid }, { $set: { lock: { by: '', at: null, expiresAt: null } } }, { timestamps: false })
  }
  ok(res, { ...serialize(user.toObject(), ...(await allCounts())), runsCanceled })
}))

/**
 * DELETE /api/admin/users/:id?confirm=<username>
 * Removes the account, everything it owns and its files. Not reversible, hence
 * the username in the query.
 */
router.delete('/users/:id', wrap(async (req, res) => {
  const user = await target(req)
  if (req.query.confirm !== user.username) throw badRequest('auth.confirm_mismatch')
  const out = await accounts.deleteAccount(user._id, { cancelRun: (id) => getRunner().cancel(id) })
  if (out.filesError) console.error(`[users] files of deleted account ${user._id} could not all be removed: ${out.filesError}`)
  ok(res, { id: String(user._id), removed: out.removed, files: out.files, filesRemoved: !out.filesError })
}))

/**
 * POST /api/admin/users/:id/reset-password -> { temporaryPassword }
 * Shown once. The account is signed out everywhere and has to choose its own
 * password at the next sign-in (mustChangePassword).
 */
router.post('/users/:id/reset-password', wrap(async (req, res) => {
  const user = await target(req)
  ok(res, { temporaryPassword: await accounts.resetPassword(user._id) })
}))

/** GET /api/admin/site -> { registrationOpen } */
router.get('/site', wrap(async (_req, res) => {
  ok(res, { registrationOpen: settings.get('registrationOpen') })
}))

/** PUT /api/admin/site { registrationOpen } */
router.put('/site', wrap(async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {}
  if (typeof body.registrationOpen !== 'boolean') throw badRequest('validation.boolean', { field: 'registrationOpen' })
  const all = await settings.update({ registrationOpen: body.registrationOpen })
  ok(res, { registrationOpen: all.registrationOpen })
}))

module.exports = router
