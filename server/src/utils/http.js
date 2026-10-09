'use strict'

/** Response envelope, error type and async route wrapper shared by all routes. */
const { LocalizedError, t } = require('../i18n')

class ApiError extends LocalizedError {
  /**
   * @param {number} status HTTP status
   * @param {string|{code:string,params?:object}} key catalog key (or message) shown to the user
   * @param {object} [params] placeholders of the message
   * @param {number} [result] non-zero envelope code, defaults to -1
   */
  constructor(status, key, params = {}, result = -1) {
    super(key, params)
    this.name = 'ApiError'
    this.status = status
    this.result = result
    this.code = this.i18n.code
    this.params = this.i18n.params
  }
}

const badRequest = (key, params) => new ApiError(400, key, params)
const notFound = (key = 'common.not_found', params) => new ApiError(404, key, params)

/** Success envelope. `key` is an optional catalog key for a message worth showing. */
function ok(res, data = null, key = '', params) {
  res.json({ result: 0, message: key ? t(res.req.locale, key, params) : 'ok', data })
}

/** Forward rejections of an async handler to the error middleware. */
function wrap(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

module.exports = { ApiError, badRequest, notFound, ok, wrap }
