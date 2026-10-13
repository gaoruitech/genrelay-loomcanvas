'use strict'

/** Public entry point: what the frontend needs before anything else. */
const express = require('express')
const Provider = require('../models/Provider')
const settings = require('../services/settings')
const accounts = require('../services/accounts')
const { getConfig } = require('../config')
const { newFilesReachable } = require('../services/media')
const { getStorage } = require('../storage')
const { ok, wrap } = require('../utils/http')
const { identify } = require('../middleware/auth')
const { version } = require('../../package.json')
const spaces = require('../services/spaces')
const teams = require('../services/teams')
const permissions = require('../services/permissions')

const router = express.Router()

/**
 * GET /api/bootstrap (also answered at /api/app/bootstrap, its earlier path).
 * Public. Anonymous callers learn the site's name and look, whether they can
 * register, and nothing about anybody's data.
 *
 * A signed-in caller also learns where they can work: `spaces` (their personal
 * space and the teams they are in), `space` (the one this request acts in -
 * named by the X-Space header, the personal one without it - with their role
 * and what that role may do), and `teams` (whether they may create a team).
 * A header naming a team they are not in does not fail the bootstrap: `space`
 * is then the personal space and `spaceError` says why (`team.not_found`,
 * `team.dissolved`, `team.suspended`), so the client can drop the stale choice.
 */
router.get(['/bootstrap', '/app/bootstrap'], wrap(async (req, res) => {
  const s = settings.getAll()
  const who = await identify(req)
  const user = who ? who.user : null
  // An account that still has to replace its password is told who it is and nothing more.
  const active = user && !user.mustChangePassword ? user : null
  let space = null
  let spaceError = ''
  let teamList = []
  let creation = null
  if (active) {
    const uid = String(active._id)
    try {
      space = await spaces.resolve(uid, req.headers[spaces.HEADER])
    } catch (err) {
      spaceError = (err && err.code) || 'team.not_found'
      space = spaces.personalSpace(uid)
    }
    ;[teamList, creation] = await Promise.all([teams.listFor(uid), teams.creationState(active)])
  }
  const spaceId = space ? space.id : (user ? String(user._id) : '')
  ok(res, {
    // May a visitor create an account (a plain user)? The super admin's setting.
    auth: { registrationOpen: s.registrationOpen },
    user: user ? accounts.serializeUser(user) : null,
    site: {
      name: s.siteName,
      logoUrl: s.logoUrl,
      // Only meaningful with a logo: `false` = the logo stands alone, the name is not written next to it.
      showName: s.showSiteName,
      defaultLocale: s.defaultLocale,
    },
    // Every space the caller can work in: the personal one first, then their teams.
    spaces: active ? [{ id: spaces.PERSONAL, kind: spaces.PERSONAL, name: '', role: 'owner' }, ...teamList] : [],
    // The space this request acts in, the caller's role there and what it may do
    // (services/permissions.js; null = it depends on the canvas or the member).
    space: space
      ? {
        id: space.kind === 'team' ? space.id : spaces.PERSONAL,
        kind: space.kind,
        name: space.team ? space.team.name : '',
        role: space.role,
        permissions: permissions.summary(space),
        settings: space.team ? teams.serializeSettings(space.team) : null,
      }
      : null,
    ...(spaceError ? { spaceError } : {}),
    // May the caller create a team, and where their request for the authorisation stands.
    teams: creation,
    // Providers of the space the request acts in; anonymous callers get false.
    hasProvider: user ? !!(await Provider.exists({ userId: spaceId, enabled: true })) : false,
    // So the browser can refuse a file that is too large before uploading it.
    limits: { maxUploadMb: Math.floor(getConfig().maxUploadBytes / (1024 * 1024)) },
    // Can an upstream load a stored file by URL (public PUBLIC_URL, or a bucket reachable from outside)?
    // When it cannot, the canvas warns before a run that needs to hand over a reference by URL.
    // `writable`: can a new file be stored right now? False while the bucket in use cannot be written to
    // (its saved secret cannot be read): uploads and image / video runs are refused then, and every
    // signed-in client is told up front. Nothing about which storage or why. Anonymous callers: true.
    media: { upstreamByUrl: user ? await newFilesReachable() : false, writable: user ? getStorage().writable : true },
    version,
  })
}))

module.exports = router
