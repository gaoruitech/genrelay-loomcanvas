'use strict'

/** Public entry points: bootstrap info and login. */
const express = require('express')
const Provider = require('../models/Provider')
const settings = require('../services/settings')
const { getConfig } = require('../config')
const { ok, wrap, ApiError, badRequest } = require('../utils/http')
const { authRequired, isAuthed, checkPassword, issueToken, loginRateLimit } = require('../middleware/auth')
const { LOCAL_USER } = require('../constants')
const { version } = require('../../package.json')

const router = express.Router()

/** GET /api/app/bootstrap - what the frontend needs before anything else. */
router.get('/app/bootstrap', wrap(async (req, res) => {
  const s = settings.getAll()
  const authed = isAuthed(req)
  ok(res, {
    authRequired: authRequired(),
    authed,
    site: {
      name: s.siteName,
      logoUrl: s.logoUrl,
      defaultTheme: s.defaultTheme,
      defaultLocale: s.defaultLocale,
    },
    // Only meaningful to someone who is allowed in; anonymous callers get false.
    hasProvider: authed ? !!(await Provider.exists({ userId: LOCAL_USER, enabled: true })) : false,
    // So the browser can refuse a file that is too large before uploading it.
    limits: { maxUploadMb: Math.floor(getConfig().maxUploadBytes / (1024 * 1024)) },
    version,
  })
}))

/** POST /api/auth/login { password } -> { token } */
router.post('/auth/login', loginRateLimit, wrap(async (req, res) => {
  if (!authRequired()) return ok(res, { token: '' }, 'auth.not_enabled')
  const password = req.body && req.body.password
  if (typeof password !== 'string' || !password) throw badRequest('auth.password_required')
  if (password.length > 200 || !checkPassword(password)) throw new ApiError(401, 'auth.wrong_password', {}, 401)
  req.loginSucceeded()
  ok(res, { token: issueToken() })
}))

module.exports = router
