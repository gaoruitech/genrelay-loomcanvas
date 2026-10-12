'use strict'

/**
 * /api/auth - registering, signing in and out, the caller's own account and
 * sessions. Register and login are public; everything else needs a session.
 * `me`, `password` and `logout` are all an account with a temporary password
 * may use (requireSession); the rest is closed to it until it has chosen its own.
 */
const express = require('express')
const accounts = require('../services/accounts')
const { ok, wrap, badRequest, notFound } = require('../utils/http')
const { isObjectId, isPlainObject } = require('../utils/validate')
const { requireSession, requireAuth, loginRateLimit, registerRateLimit, profileRateLimit, countAccountAttempt } = require('../middleware/auth')

const router = express.Router()

const meta = (req) => ({ userAgent: req.headers['user-agent'], ip: req.ip })

/** POST /api/auth/register { username, email, password } -> { user, token }; always a plain user */
router.post('/register', registerRateLimit, wrap(async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {}
  const user = await accounts.register(body)
  const { token } = await accounts.createSession(user, meta(req))
  ok(res, { user: accounts.serializeUser(user), token })
}))

/** POST /api/auth/login { account, password, remember? } -> { user, token }; `account` is a username or an email */
router.post('/login', loginRateLimit, wrap(async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {}
  if (typeof body.account !== 'string' || !body.account.trim() || typeof body.password !== 'string' || !body.password) {
    throw badRequest('auth.credentials_required')
  }
  const succeeded = await countAccountAttempt(req, res, body.account)
  const user = await accounts.checkCredentials(body.account, body.password)
  succeeded()
  const { token } = await accounts.createSession(user, { ...meta(req), remember: body.remember === true })
  ok(res, { user: accounts.serializeUser(user), token })
}))

/** POST /api/auth/logout - ends the session this request came with */
router.post('/logout', requireSession, wrap(async (req, res) => {
  await accounts.revokeSession(req.userId, req.session._id)
  ok(res, null)
}))

/** GET /api/auth/me -> { user } */
router.get('/me', requireSession, wrap(async (req, res) => {
  ok(res, { user: accounts.serializeUser(req.user) })
}))

/**
 * PUT /api/auth/password { currentPassword, newPassword } -> { revokedSessions, token }
 * Every session of the account ends, the one that made this request included:
 * the caller gets a fresh token in its place, so a token that was copied
 * before the change is worthless afterwards. `revokedSessions` counts the others.
 * This is also how a temporary password is replaced: it clears `mustChangePassword`.
 */
router.put('/password', requireSession, wrap(async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {}
  // A stolen session must not become a way to guess the password without limit.
  const succeeded = await countAccountAttempt(req, res, req.user.usernameLower)
  try {
    await accounts.checkCredentials(req.user.usernameLower, body.currentPassword)
  } catch (err) {
    // Not a 401: the session is fine, and the web client reads 401 as "signed out".
    if (err && err.code === 'auth.invalid_credentials') throw badRequest('auth.wrong_current_password')
    throw err
  }
  succeeded()
  // Keeping the password is not changing it - and a temporary one must not survive this call.
  if (body.newPassword === body.currentPassword) throw badRequest('auth.same_password')
  const { token, revoked } = await accounts.changePassword(req.user, body.newPassword, req.session, meta(req))
  ok(res, { revokedSessions: revoked, token })
}))

/** PUT /api/auth/profile { username?, email? } -> { user } */
router.put('/profile', requireAuth, profileRateLimit, wrap(async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {}
  const user = await accounts.updateProfile(req.user, { username: body.username, email: body.email })
  ok(res, { user: accounts.serializeUser(user) })
}))

/**
 * PUT /api/auth/prefs { nodeLayout?: 'a'|'b'|'c', theme?: 'dark'|'light'|'system' } -> { user }
 * Preferences of the web app, kept with the account so they follow it to every
 * browser. Only the keys sent are changed; an unknown key or value is refused.
 */
router.put('/prefs', requireAuth, wrap(async (req, res) => {
  const user = await accounts.updatePrefs(req.user, req.body)
  ok(res, { user: accounts.serializeUser(user) })
}))

/** GET /api/auth/sessions -> [{ id, current, createdAt, lastSeenAt, userAgent, ip }] */
router.get('/sessions', requireAuth, wrap(async (req, res) => {
  ok(res, await accounts.listSessions(req.userId, req.session._id))
}))

/** DELETE /api/auth/sessions - sign out everywhere else */
router.delete('/sessions', requireAuth, wrap(async (req, res) => {
  ok(res, { revoked: await accounts.revokeSessions(req.userId, { except: req.session._id }) })
}))

/** DELETE /api/auth/sessions/:id - end one session of mine (the current one included) */
router.delete('/sessions/:id', requireAuth, wrap(async (req, res) => {
  // Somebody else's session id is simply "not found", like an id that never existed.
  if (!isObjectId(req.params.id) || !(await accounts.revokeSession(req.userId, req.params.id))) throw notFound('auth.session_not_found')
  ok(res, { id: req.params.id })
}))

module.exports = router
