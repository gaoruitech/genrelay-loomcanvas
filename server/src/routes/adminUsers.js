'use strict'

/**
 * Super admin only: the accounts of this instance and whether new ones may be
 * created. The super admin manages accounts, not their contents - nothing here
 * returns a canvas, a key or a file of another account, only how many there are.
 */
const express = require('express')
const User = require('../models/User')
const accounts = require('../services/accounts')
const settings = require('../services/settings')
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

const serialize = (u, counts) => ({
  ...accounts.serializeUser(u),
  disabled: !!u.disabled,
  lastLoginAt: u.lastLoginAt || null,
  counts: counts.get(String(u._id)) || { workflows: 0, runs: 0 },
})

/** GET /api/admin/users -> [{ ...User, disabled, lastLoginAt, counts: { workflows, runs } }] */
router.get('/users', wrap(async (_req, res) => {
  const [users, counts] = await Promise.all([
    User.find({}).sort({ createdAt: 1 }).limit(MAX_LISTED).lean(),
    accounts.countsByUser(),
  ])
  ok(res, users.map((u) => serialize(u, counts)))
}))

/** PATCH /api/admin/users/:id { disabled } - a disabled account is signed out at once and cannot sign in */
router.patch('/users/:id', wrap(async (req, res) => {
  const user = await target(req)
  const body = isPlainObject(req.body) ? req.body : {}
  if (typeof body.disabled !== 'boolean') throw badRequest('validation.boolean', { field: 'disabled' })
  user.disabled = body.disabled
  await user.save()
  if (user.disabled) await accounts.revokeSessions(user._id)
  ok(res, serialize(user.toObject(), await accounts.countsByUser()))
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
