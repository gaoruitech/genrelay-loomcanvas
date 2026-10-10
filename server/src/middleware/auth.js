'use strict'

/**
 * Who is calling, and the limits on guessing passwords.
 *
 * The browser sends the token it got at sign-in as `Authorization: Bearer
 * <token>`. The token is opaque; the session it names lives in the database
 * (services/accounts.js), so it can be ended from the server side.
 */
const net = require('net')
const accounts = require('../services/accounts')
const { ApiError } = require('../utils/http')
const { ROLES } = require('../constants')

function bearerToken(req) {
  const h = req.headers.authorization
  return typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : ''
}

/**
 * The account and session behind a request, or null. Looked up once per
 * request, whoever asks (the bootstrap route, a guard, a second guard).
 */
function identify(req) {
  if (!req._identity) {
    const token = bearerToken(req)
    req._identity = token ? accounts.resolveToken(token) : Promise.resolve(null)
  }
  return req._identity
}

/** 401 `auth.required` unless the request carries a live session. Sets req.user, req.userId, req.session. */
function requireAuth(req, _res, next) {
  identify(req).then((who) => {
    if (!who) return next(new ApiError(401, 'auth.required', {}, 401))
    req.user = who.user
    // Every per-account query is scoped with this string.
    req.userId = String(who.user._id)
    req.session = who.session
    next()
  }, next)
}

/** After requireAuth: 403 `auth.forbidden` unless the caller is the owner. */
function requireOwner(req, _res, next) {
  if (req.user && req.user.role === ROLES.OWNER) return next()
  next(new ApiError(403, 'auth.forbidden'))
}

/* ---- rate limits: in memory ---- */

/**
 * Sign-in attempts per window. The point of the shape: guessing must get slow,
 * but wrong guesses by a stranger must not lock the holder of an account out.
 *
 *  - `perPair`    one account name from one address. This is what a person who
 *                 mistypes their password runs into, and it is theirs alone:
 *                 nobody else's guesses count against it.
 *  - `perClient`  one address across all account names.
 *  - `perAccount` one account name across all addresses - what bounds a run of
 *                 guesses spread over many addresses. Deliberately far above
 *                 perPair, and it does NOT apply to an address the account is
 *                 known at (below), so reaching it stops the strangers and not
 *                 the holder.
 *  - `global`     everybody together; bounds guessing from many addresses at
 *                 many names, and the size of the tables. Known addresses are
 *                 exempt from it too.
 *
 * An account is "known at" an address when a sign-in to it succeeded from
 * there within KNOWN_ADDRESS_MS (remembered in memory), or one of its live
 * sessions was opened from there (looked up only once a ceiling is reached).
 * Only somebody who already has the password can make an address known.
 */
const LOGIN_LIMITS = Object.freeze({ windowMs: 10 * 60 * 1000, perPair: 10, perClient: 30, perAccount: 100, global: 3000 })
/** New accounts one address may create. */
const REGISTER_LIMITS = Object.freeze({ windowMs: 60 * 60 * 1000, perClient: 20 })
/** Profile changes per account: each answer says whether a name or an email is taken. */
const PROFILE_LIMITS = Object.freeze({ windowMs: 60 * 60 * 1000, perAccount: 20 })
const KNOWN_ADDRESS_MS = 30 * 24 * 3600 * 1000
const MAX_KNOWN = 50000
const MAX_ADDRESSES = 100000

const attempts = new Map() // client -> { count, resetAt }
const pairAttempts = new Map() // account name + client -> { count, resetAt }
const accountAttempts = new Map() // account name, lowercased -> { count, resetAt }
const knownAddresses = new Map() // account name + client -> expires at (ms)
const registrations = new Map() // client -> { count, resetAt }
const profileChanges = new Map() // account id -> { count, resetAt }
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

/** 429 with how long to wait, in the body (`data.retryAfterSeconds`) and as Retry-After. */
function tooMany(res, resetAt) {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
  if (res && typeof res.setHeader === 'function') res.setHeader('Retry-After', String(retryAfterSeconds))
  return new ApiError(429, 'auth.too_many_attempts', {}, 429, { retryAfterSeconds })
}

function sweep(map, now) {
  for (const [key, a] of map) if (a.resetAt <= now) map.delete(key)
}

function bucket(map, key, windowMs, now) {
  let entry = map.get(key)
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs }
    map.set(key, entry)
  }
  return entry
}

function rollWindow(now) {
  if (everyone.resetAt > now) return
  everyone.count = 0
  everyone.resetAt = now + LOGIN_LIMITS.windowMs
  sweep(attempts, now)
  sweep(pairAttempts, now)
  sweep(accountAttempts, now)
  for (const [key, until] of knownAddresses) if (until <= now) knownAddresses.delete(key)
}

/** Per address, whatever the request says. The per-account limits need the body: countAccountAttempt. */
function loginRateLimit(req, res, next) {
  const now = Date.now()
  rollWindow(now)
  const key = clientKey(req.ip)
  // The table cannot be grown without bound by a flood of made-up addresses.
  if (!attempts.has(key) && attempts.size >= MAX_ADDRESSES) return next(tooMany(res, everyone.resetAt))
  const entry = bucket(attempts, key, LOGIN_LIMITS.windowMs, now)
  if (entry.count >= LOGIN_LIMITS.perClient) return next(tooMany(res, entry.resetAt))
  // Counted before the check, so parallel guesses cannot outrun the limit.
  entry.count += 1
  next()
}

const accountKey = (account) => String(account || '').trim().toLowerCase().slice(0, 254)

/**
 * Count one password attempt at an account name from the caller's address (the
 * name need not exist: the limits must not reveal which names do). Rejects
 * with 429 past a limit; resolves to a function to call after a correct
 * password, which clears this caller's own count and remembers the address.
 */
async function countAccountAttempt(req, res, account) {
  const now = Date.now()
  rollWindow(now)
  const name = accountKey(account)
  const client = clientKey(req.ip)
  const pairKey = `${name}\n${client}`

  const pair = bucket(pairAttempts, pairKey, LOGIN_LIMITS.windowMs, now)
  if (pair.count >= LOGIN_LIMITS.perPair) throw tooMany(res, pair.resetAt)
  const all = bucket(accountAttempts, name, LOGIN_LIMITS.windowMs, now)
  const overAccount = all.count >= LOGIN_LIMITS.perAccount
  const overGlobal = everyone.count >= LOGIN_LIMITS.global
  // Counted before anything is awaited, so parallel guesses cannot outrun the limits.
  pair.count += 1
  if (overAccount || overGlobal) {
    let known = (knownAddresses.get(pairKey) || 0) > now
    // The same two queries whether or not the name exists.
    if (!known) known = await accounts.hasSessionFrom(name, (ip) => clientKey(ip) === client).catch(() => false)
    if (!known) {
      pair.count -= 1
      throw tooMany(res, overAccount ? all.resetAt : everyone.resetAt)
    }
  }
  all.count += 1
  everyone.count += 1

  return () => {
    // This caller's own wrong tries are forgiven; other people's guesses at the name stay counted.
    const mine = attempts.get(client)
    if (mine) mine.count = Math.max(0, mine.count - pair.count)
    pairAttempts.delete(pairKey)
    knownAddresses.delete(pairKey)
    if (knownAddresses.size >= MAX_KNOWN) knownAddresses.delete(knownAddresses.keys().next().value)
    knownAddresses.set(pairKey, Date.now() + KNOWN_ADDRESS_MS)
  }
}

function registerRateLimit(req, res, next) {
  const now = Date.now()
  if (registrations.size > 10000) sweep(registrations, now)
  const entry = bucket(registrations, clientKey(req.ip), REGISTER_LIMITS.windowMs, now)
  if (entry.count >= REGISTER_LIMITS.perClient) return next(tooMany(res, entry.resetAt))
  entry.count += 1
  next()
}

/** After requireAuth. A taken name or email is reported as such, so the number of tries is bounded. */
function profileRateLimit(req, res, next) {
  const now = Date.now()
  if (profileChanges.size > 10000) sweep(profileChanges, now)
  const entry = bucket(profileChanges, req.userId, PROFILE_LIMITS.windowMs, now)
  if (entry.count >= PROFILE_LIMITS.perAccount) return next(tooMany(res, entry.resetAt))
  entry.count += 1
  next()
}

/** Test helper: forget every counted attempt (and, unless told otherwise, every known address). */
function resetRateLimits({ keepKnown = false } = {}) {
  attempts.clear()
  pairAttempts.clear()
  accountAttempts.clear()
  registrations.clear()
  profileChanges.clear()
  if (!keepKnown) knownAddresses.clear()
  everyone.count = 0
  everyone.resetAt = 0
}

module.exports = {
  identify,
  requireAuth,
  requireOwner,
  loginRateLimit,
  countAccountAttempt,
  registerRateLimit,
  profileRateLimit,
  resetRateLimits,
  clientKey,
  LOGIN_LIMITS,
  REGISTER_LIMITS,
  PROFILE_LIMITS,
}
