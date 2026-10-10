'use strict'

/** Express application: middleware order, route mounting, static frontend. */
const fs = require('fs')
const path = require('path')
const express = require('express')
const { getConfig } = require('./config')
const { getStorage } = require('./storage')
const { securityHeaders, noStore, cors, buildContentSecurityPolicy, inlineScriptHashes } = require('./middleware/security')
const { requireAuth, requireOwner } = require('./middleware/auth')
const { locale } = require('./middleware/locale')
const { apiNotFound, errorHandler } = require('./middleware/errors')
const files = require('./routes/files')
const assets = require('./routes/assets')

function createApp() {
  const config = getConfig()
  const app = express()
  app.disable('x-powered-by')
  app.set('etag', false)
  // Needed behind a reverse proxy so req.ip (sign-in rate limit, session list) is the client's address.
  if (config.trustProxy) app.set('trust proxy', config.trustProxy)

  const indexHtml = config.webDist ? path.join(config.webDist, 'index.html') : ''
  if (indexHtml && !fs.existsSync(indexHtml)) {
    throw new Error(`WEB_DIST is set to ${config.webDist} but there is no index.html in it`)
  }
  const scriptHashes = indexHtml ? inlineScriptHashes(fs.readFileSync(indexHtml, 'utf8')) : []
  // The policy follows the storage settings: a bucket's public domain is allowed
  // as soon as it is saved, without a restart.
  let policy = { origins: null, text: '' }
  app.use(securityHeaders(() => {
    const origins = getStorage().publicOrigins().join(' ')
    if (origins !== policy.origins) {
      policy = { origins, text: buildContentSecurityPolicy({ scriptHashes, mediaOrigins: origins ? origins.split(' ') : [] }) }
    }
    return policy.text
  }))
  app.use(locale)

  // Stored files, whichever backend holds them. Public: share links and upstream models load them.
  app.use('/files', files.staticRouter())

  const api = express.Router()
  api.use(cors(config.corsOrigins))
  api.use(noStore)

  // --- public ---
  // What anybody may send is small: a name and a password, the fields of a share link.
  api.use(['/auth', '/canvas-share'], express.json({ limit: '64kb' }))
  api.use(require('./routes/base')) // bootstrap
  api.use('/auth', require('./routes/auth')) // register and login are public; the rest guards itself
  api.use('/canvas-share', require('./routes/canvasShare')) // public read; the rest guards itself

  // --- everything below needs a session, and works on the caller's own data only ---
  // Bodies are parsed after this check, so only a signed-in client gets megabytes read and parsed.
  api.use(requireAuth)
  // Canvas saves carry the whole graph; everything else is small.
  api.use('/workflow', express.json({ limit: '6mb' }))
  api.use(express.json({ limit: '1mb' }))
  api.use('/files', files.apiRouter())
  api.use(require('./routes/runs')) // models, runs, llm tasks
  // Per account: providers, models, usage. Owner only: settings and storage (guarded inside).
  api.use('/admin', require('./routes/admin'))
  // Owner only: accounts and registration.
  api.use('/admin', requireOwner, require('./routes/adminUsers'))
  api.use('/workflow', require('./routes/workflow'))
  api.use('/canvas-asset', assets.canvasAssetRouter())
  api.use('/user-asset', assets.userAssetRouter())
  api.use('/canvas', require('./routes/canvas'))
  api.use('/brand-kits', require('./routes/brandKit'))
  api.use(apiNotFound)

  app.use('/api', api)

  // Optional: serve the built frontend, with SPA fallback for client-side routes.
  if (config.webDist) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/files/')) return next()
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(indexHtml)
    })
  }

  app.use((_req, res) => res.status(404).json({ result: 404, message: 'Not Found', data: null }))
  app.use(errorHandler)
  return app
}

module.exports = { createApp }
