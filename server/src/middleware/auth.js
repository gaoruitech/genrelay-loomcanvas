'use strict'

/**
 * Single-user access control.
 *
 * ACCESS_PASSWORD empty  -> the instance is open, every request passes.
 * ACCESS_PASSWORD set    -> POST /api/auth/login exchanges it for a JWT, and
 *                           every API route except the public ones needs it.
 */
const jwt = require('jsonwebtoken')
const { getConfig } = require('../config')
const { deriveKey, safeEqual } = require('../utils/crypto')
const { ApiError } = require('../utils/http')
const { LOCAL_USER } = require('../constants')

const TOKEN_TTL = '30d'
const ALGORITHM = 'HS256'

function signingKey() {
  return deriveKey(getConfig().secretKey, 'auth-jwt')
}

/**
 * Tokens are bound to the password they were issued for: changing
 * ACCESS_PASSWORD invalidates every outstanding token.
 */
function passwordStamp() {
  return deriveKey(getConfig().secretKey, `auth-password:${getConfig().accessPassword}`).toString('base64url').slice(0, 16)
}

function authRequired() {
  return getConfig().accessPassword !== ''
}

function checkPassword(candidate) {
  return typeof candidate === 'string' && safeEqual(candidate, getConfig().accessPassword)
}

function issueToken() {
  return jwt.sign({ sub: LOCAL_USER, ps: passwordStamp() }, signingKey(), { algorithm: ALGORITHM, expiresIn: TOKEN_TTL })
}

function bearerToken(req) {
  const h = req.headers.authorization
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

/** True when the request carries a valid token (or no login is required). */
function isAuthed(req) {
  if (!authRequired()) return true
  const token = bearerToken(req)
  if (!token) return false
  try {
    const payload = jwt.verify(token, signingKey(), { algorithms: [ALGORITHM] })
    return payload.sub === LOCAL_USER && payload.ps === passwordStamp()
  } catch {
    return false
  }
}

function requireAuth(req, _res, next) {
  if (isAuthed(req)) {
    req.userId = LOCAL_USER
    return next()
  }
  next(new ApiError(401, '请先登录', 401))
}

/* ---- login rate limit: in memory, per client address ---- */

const WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 10
const attempts = new Map() // ip -> { count, resetAt }

function loginRateLimit(req, _res, next) {
  const now = Date.now()
  if (attempts.size > 5000) {
    for (const [ip, a] of attempts) if (a.resetAt <= now) attempts.delete(ip)
  }
  const ip = req.ip || 'unknown'
  let entry = attempts.get(ip)
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + WINDOW_MS }
    attempts.set(ip, entry)
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return next(new ApiError(429, '尝试次数过多，请稍后再试', 429))
  }
  // Counted before the check, so parallel guesses cannot outrun the limit.
  entry.count += 1
  req.loginSucceeded = () => attempts.delete(ip)
  next()
}

module.exports = { authRequired, checkPassword, issueToken, isAuthed, requireAuth, loginRateLimit }
