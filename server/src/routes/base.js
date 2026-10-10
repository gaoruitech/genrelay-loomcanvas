'use strict'

/** Public entry point: what the frontend needs before anything else. */
const express = require('express')
const Provider = require('../models/Provider')
const settings = require('../services/settings')
const accounts = require('../services/accounts')
const { getConfig } = require('../config')
const { newFilesReachable } = require('../services/media')
const { ok, wrap } = require('../utils/http')
const { identify } = require('../middleware/auth')
const { version } = require('../../package.json')

const router = express.Router()

/**
 * GET /api/bootstrap (also answered at /api/app/bootstrap, its earlier path).
 * Public. Anonymous callers learn the site's name and look, whether they can
 * register, and nothing about anybody's data.
 */
router.get(['/bootstrap', '/app/bootstrap'], wrap(async (req, res) => {
  const s = settings.getAll()
  const who = await identify(req)
  const user = who ? who.user : null
  ok(res, {
    // May a visitor create an account (a plain user)? The administrator's setting.
    auth: { registrationOpen: s.registrationOpen },
    user: user ? accounts.serializeUser(user) : null,
    site: {
      name: s.siteName,
      logoUrl: s.logoUrl,
      defaultLocale: s.defaultLocale,
    },
    // The caller's own providers; anonymous callers get false.
    hasProvider: user ? !!(await Provider.exists({ userId: String(user._id), enabled: true })) : false,
    // So the browser can refuse a file that is too large before uploading it.
    limits: { maxUploadMb: Math.floor(getConfig().maxUploadBytes / (1024 * 1024)) },
    // Can an upstream load a stored file by URL (public PUBLIC_URL, or a bucket reachable from outside)?
    // When it cannot, the canvas warns before a run that needs to hand over a reference by URL.
    media: { upstreamByUrl: user ? await newFilesReachable() : false },
    version,
  })
}))

module.exports = router
