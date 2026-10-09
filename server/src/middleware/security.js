'use strict'

/** Response headers and CORS, without pulling in extra dependencies. */
const crypto = require('crypto')

/**
 * CSP source expressions ('sha256-...') for the inline scripts of a page. The
 * built index.html sets the theme in an inline script before anything paints;
 * allowing exactly that script by hash keeps 'unsafe-inline' out of the policy.
 */
function inlineScriptHashes(html) {
  const out = []
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(String(html || '')))) {
    if (/\ssrc\s*=/i.test(m[1] || '') || !m[2].trim()) continue
    out.push(`'sha256-${crypto.createHash('sha256').update(m[2], 'utf8').digest('base64')}'`)
  }
  return out
}

/**
 * Policy for the web app. Scripts: our own files and the hashed inline ones,
 * nothing else - that is the part that stops injected markup from running.
 * Images, media and fetches stay open to any http(s) origin on purpose: a
 * canvas shows results from object storage, upstream CDNs and links the user
 * pasted, and downloads them in the browser. Styles need 'unsafe-inline' for
 * the style attributes the UI libraries set.
 */
function buildContentSecurityPolicy({ scriptHashes = [] } = {}) {
  const anywhere = "'self' data: blob: https: http:"
  return [
    "default-src 'self'",
    ["script-src 'self'", ...scriptHashes].join(' '),
    "style-src 'self' 'unsafe-inline'",
    `img-src ${anywhere}`,
    `media-src ${anywhere}`,
    `connect-src ${anywhere}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ')
}

/** Headers of every response. `csp` is the policy for pages (see above). */
function securityHeaders(csp) {
  return (_req, res, next) => {
    res.setHeader('Content-Security-Policy', csp)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('X-DNS-Prefetch-Control', 'off')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
    next()
  }
}

/** API responses are per-user JSON: never cached, and never anything a browser should render or run. */
function noStore(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
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
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Locale')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition')
      res.setHeader('Access-Control-Max-Age', '600')
    }
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  }
}

module.exports = { securityHeaders, noStore, cors, buildContentSecurityPolicy, inlineScriptHashes }
