'use strict'

/** 404 for unknown API routes and the single place errors become responses. */
const { ApiError } = require('../utils/http')
const { FALLBACK_LOCALE, RAW, msg, has, messageOf, render } = require('../i18n')

function apiNotFound(_req, _res, next) {
  next(new ApiError(404, 'common.route_not_found', {}, 404))
}

function classify(err) {
  if (err instanceof ApiError) return { status: err.status, message: err.i18n, result: err.result, data: err.data }
  // Errors raised by our own services that are safe to show (provider/media/registry).
  const shown = messageOf(err)
  if (shown) {
    // An upstream's own 401/403/429 must not masquerade as ours: the frontend
    // treats a 401 from this server as "logged out".
    const status = [400, 404, 409, 413, 422].includes(err.status) ? err.status : 400
    return { status, message: shown }
  }
  // body-parser
  if (err && err.type === 'entity.too.large') return { status: 413, message: msg('common.body_too_large') }
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) return { status: 400, message: msg('common.body_not_json') }
  // multer
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return { status: 413, message: msg('file.too_large') }
    return { status: 400, message: msg('file.bad_form') }
  }
  // mongoose
  if (err && err.name === 'CastError') return { status: 400, message: msg('validation.bad_param') }
  if (err && err.name === 'ValidationError') {
    // Our own schema validators use a catalog key as their message.
    const first = err.errors && Object.values(err.errors)[0]
    const key = first && first.properties && first.properties.message
    return { status: 400, message: has(key) ? msg(key, first.properties) : msg('validation.failed') }
  }
  if (err && err.code === 11000) return { status: 409, message: msg('common.duplicate') }
  // Anything else Express or the body parser refused about the request itself
  // (bad percent-encoding in the path, an unsupported charset or encoding...).
  if (err && (err.expose === true || err instanceof URIError) && err.status >= 400 && err.status < 500) {
    return { status: err.status, message: msg('common.bad_request') }
  }
  return null
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const known = classify(err)
  if (!known) {
    // Unexpected: log everything server-side, tell the client nothing specific.
    // A share link's token is the permission to read it: keep it out of the log.
    const where = String(req.originalUrl || '').replace(/(\/canvas-share\/)[A-Za-z0-9_-]{32,64}/, '$1***')
    console.error(`[error] ${req.method} ${where}:`, err)
  }
  const { status, message, result, data } = known || { status: 500, message: msg('common.internal') }
  if (res.headersSent) return res.end()
  res.status(status).json({
    result: result || -1,
    message: render(req.locale || FALLBACK_LOCALE, message).slice(0, 500),
    // Stable identifier of the message, for clients that branch on it.
    code: message.code === RAW ? '' : message.code,
    data: data === undefined ? null : data,
  })
}

module.exports = { apiNotFound, errorHandler }
