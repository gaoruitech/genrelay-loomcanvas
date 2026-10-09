'use strict'

/** Response headers and CORS, without pulling in extra dependencies. */

function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  next()
}

/** API responses are per-user JSON: never cache them. */
function noStore(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store')
  next()
}

/**
 * CORS for the API. By default no cross-origin access is granted (the built
 * frontend is served from the same origin). CORS_ORIGIN lists extra origins,
 * e.g. the Vite dev server.
 */
function cors(allowedOrigins) {
  const allowed = new Set(allowedOrigins)
  return (req, res, next) => {
    const origin = req.headers.origin
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
      res.setHeader('Access-Control-Max-Age', '600')
    }
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  }
}

module.exports = { securityHeaders, noStore, cors }
