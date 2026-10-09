'use strict'

/** Express application: middleware order, route mounting, static frontend. */
const fs = require('fs')
const path = require('path')
const express = require('express')
const { getConfig } = require('./config')
const { securityHeaders, noStore, cors } = require('./middleware/security')
const { requireAuth } = require('./middleware/auth')
const { apiNotFound, errorHandler } = require('./middleware/errors')
const files = require('./routes/files')
const assets = require('./routes/assets')

function createApp() {
  const config = getConfig()
  const app = express()
  app.disable('x-powered-by')
  app.set('etag', false)
  if (config.trustProxy) {
    // Needed behind a reverse proxy so req.ip (login rate limit) is the client's address.
    const n = Number(config.trustProxy)
    app.set('trust proxy', Number.isInteger(n) ? n : config.trustProxy)
  }

  app.use(securityHeaders)

  // Stored files (local driver). Public: share links and upstream models load them.
  app.use('/files', files.staticRouter())

  const api = express.Router()
  api.use(cors(config.corsOrigins))
  api.use(noStore)
  // Canvas saves carry the whole graph; everything else is small.
  api.use('/workflow', express.json({ limit: '6mb' }))
  api.use(express.json({ limit: '1mb' }))

  // --- public ---
  api.use(require('./routes/base')) // bootstrap, login
  api.use('/canvas-share', require('./routes/canvasShare')) // public read; the rest guards itself

  // --- everything below needs a token when ACCESS_PASSWORD is set ---
  api.use(requireAuth)
  api.use('/files', files.apiRouter())
  api.use(require('./routes/runs')) // models, runs, llm tasks
  api.use('/admin', require('./routes/admin'))
  api.use('/workflow', require('./routes/workflow'))
  api.use('/canvas-asset', assets.canvasAssetRouter())
  api.use('/user-asset', assets.userAssetRouter())
  api.use('/canvas', require('./routes/canvas'))
  api.use('/brand-kits', require('./routes/brandKit'))
  api.use(apiNotFound)

  app.use('/api', api)

  // Optional: serve the built frontend, with SPA fallback for client-side routes.
  if (config.webDist) {
    const indexHtml = path.join(config.webDist, 'index.html')
    if (!fs.existsSync(indexHtml)) {
      throw new Error(`WEB_DIST is set to ${config.webDist} but there is no index.html in it`)
    }
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
