'use strict'

/** Response envelope, error type and async route wrapper shared by all routes. */

class ApiError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} message shown to the user as-is
   * @param {number} [result] non-zero envelope code, defaults to -1
   */
  constructor(status, message, result = -1) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.result = result
  }
}

const badRequest = (msg) => new ApiError(400, msg)
const notFound = (msg = '资源不存在') => new ApiError(404, msg)

function ok(res, data = null, message = 'ok') {
  res.json({ result: 0, message, data })
}

/** Forward rejections of an async handler to the error middleware. */
function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

module.exports = { ApiError, badRequest, notFound, ok, wrap }
