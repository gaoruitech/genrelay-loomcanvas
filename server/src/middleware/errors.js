'use strict'

/** 404 for unknown API routes and the single place errors become responses. */
const { ApiError } = require('../utils/http')

function apiNotFound(_req, _res, next) {
  next(new ApiError(404, '接口不存在', 404))
}

function classify(err) {
  if (err instanceof ApiError) return { status: err.status, message: err.message, result: err.result }
  // Errors raised by our own services that are safe to show (provider/media/registry).
  if (err && err.userFacing && err.message) {
    // An upstream's own 401/403/429 must not masquerade as ours: the frontend
    // treats a 401 from this server as "logged out".
    const status = [400, 404, 409, 413, 422].includes(err.status) ? err.status : 400
    return { status, message: String(err.message).slice(0, 500) }
  }
  // body-parser
  if (err && err.type === 'entity.too.large') return { status: 413, message: '请求体过大' }
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) return { status: 400, message: '请求体不是合法的 JSON' }
  // multer
  if (err && err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') return { status: 413, message: '文件超过大小上限' }
    return { status: 400, message: '上传的表单格式不正确' }
  }
  // mongoose
  if (err && err.name === 'CastError') return { status: 400, message: '参数格式不正确' }
  if (err && err.name === 'ValidationError') {
    const first = err.errors && Object.values(err.errors)[0]
    return { status: 400, message: (first && first.message) || '数据校验失败' }
  }
  if (err && err.code === 11000) return { status: 409, message: '已存在相同的记录' }
  return null
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const known = classify(err)
  if (!known) {
    // Unexpected: log everything server-side, tell the client nothing specific.
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err)
  }
  const { status, message, result } = known || { status: 500, message: '服务器内部错误' }
  if (res.headersSent) return res.end()
  res.status(status).json({ result: result || -1, message, data: null })
}

module.exports = { apiNotFound, errorHandler }
