'use strict'

/**
 * Single-user access control.
 *
 * ACCESS_PASSWORD empty  -> the instance is open, every request passes.
 * ACCESS_PASSWORD set    -> POST /api/auth/login exchanges it for a JWT, and
 *                           every API route except the public ones needs it.
 */
const net = require('net')
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
  next(new ApiError(401, 'auth.login_required', {}, 401))
}

/* ---- login rate limit: in memory ---- */

/**
 * Attempts per window: `perClient` for one client, `global` for everybody
 * together. The global ceiling is what bounds guessing from many addresses at
 * once; reaching it locks new logins out for the rest of the window (sessions
 * that are already signed in keep working).
 */
const LOGIN_LIMITS = Object.freeze({ windowMs: 10 * 60 * 1000, perClient: 10, global: 300 })
const attempts = new Map() // client -> { count, resetAt }
const everyone = { count: 0, resetAt: 0 }

/**
 * Who an address counts as. IPv6 is cut to its /64: a single host is routinely
 * handed a whole /64, so per-address counting would give it 2^64 tries.
 */
function clientKey(ip) {
  const addr = String(ip || '').split('%')[0].toLowerCase()
  if (net.isIP(addr) === 4) return addr
  if (net.isIP(addr) !== 6) return 'unknown'
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr)
  if (mapped) return mapped[1]
  const [head, tail = ''] = addr.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = addr.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`
}

function loginRateLimit(req, _res, next) {
  const now = Date.now()
  if (everyone.resetAt <= now) {
    everyone.count = 0
    everyone.resetAt = now + LOGIN_LIMITS.windowMs
    for (const [key, a] of attempts) if (a.resetAt <= now) attempts.delete(key)
  }
  const tooMany = () => next(new ApiError(429, 'auth.too_many_attempts', {}, 429))
  // Checked first, so the table below cannot grow past the global ceiling either.
  if (everyone.count >= LOGIN_LIMITS.global) return tooMany()
  const key = clientKey(req.ip)
  let entry = attempts.get(key)
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + LOGIN_LIMITS.windowMs }
    attempts.set(key, entry)
  }
  if (entry.count >= LOGIN_LIMITS.perClient) return tooMany()
  // Counted before the check, so parallel guesses cannot outrun the limit.
  entry.count += 1
  everyone.count += 1
  req.loginSucceeded = () => {
    everyone.count = Math.max(0, everyone.count - entry.count)
    attempts.delete(key)
  }
  next()
}

module.exports = { authRequired, checkPassword, issueToken, isAuthed, requireAuth, loginRateLimit, clientKey, LOGIN_LIMITS }
