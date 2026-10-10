'use strict'

/**
 * Password hashing with scrypt (node:crypto). The stored form carries its own
 * parameters and salt, so they can be raised later without breaking old hashes:
 *
 *   scrypt$N=32768,r=8,p=1$<salt, base64url>$<hash, base64url>
 */
const crypto = require('crypto')

const PARAMS = Object.freeze({ N: 32768, r: 8, p: 1 })
const KEY_LENGTH = 32
const SALT_BYTES = 16
/** Upper bounds accepted from a stored hash, so a tampered row cannot make verification eat the machine. */
const MAX = Object.freeze({ N: 1 << 20, r: 16, p: 4 })

function derive(password, salt, { N, r, p }, length) {
  return new Promise((resolve, reject) => {
    // scrypt needs 128 * N * r bytes; Node's default ceiling (32 MiB) is exactly too low for N=32768.
    crypto.scrypt(password, salt, length, { N, r, p, maxmem: 256 * N * r }, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

async function hashPassword(password) {
  if (typeof password !== 'string' || !password) throw new Error('password must be a non-empty string')
  const salt = crypto.randomBytes(SALT_BYTES)
  const key = await derive(password, salt, PARAMS, KEY_LENGTH)
  return `scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

function parse(stored) {
  const parts = String(stored || '').split('$')
  if (parts.length !== 4 || parts[0] !== 'scrypt') return null
  const m = /^N=(\d+),r=(\d+),p=(\d+)$/.exec(parts[1])
  if (!m) return null
  const [N, r, p] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (!(N >= 2 && N <= MAX.N && (N & (N - 1)) === 0) || !(r >= 1 && r <= MAX.r) || !(p >= 1 && p <= MAX.p)) return null
  const salt = Buffer.from(parts[2], 'base64url')
  const hash = Buffer.from(parts[3], 'base64url')
  if (!salt.length || hash.length < 16 || hash.length > 128) return null
  return { params: { N, r, p }, salt, hash }
}

/** True when `password` matches the stored hash. Constant-time comparison; never throws. */
async function verifyPassword(password, stored) {
  const parsed = parse(stored)
  if (!parsed || typeof password !== 'string') return false
  try {
    const key = await derive(password, parsed.salt, parsed.params, parsed.hash.length)
    return crypto.timingSafeEqual(key, parsed.hash)
  } catch {
    return false
  }
}

let dummy = null
/**
 * Spend the time a real verification takes. Called when the account does not
 * exist, so the answer arrives no sooner than for a wrong password.
 */
async function burnVerification(password) {
  if (!dummy) dummy = hashPassword(crypto.randomBytes(16).toString('hex'))
  await verifyPassword(typeof password === 'string' ? password : '', await dummy)
}

/** A password a person can read off a terminal and type once. About 95 bits. */
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  let out = ''
  for (let i = 0; i < 16; i++) out += alphabet[crypto.randomInt(alphabet.length)]
  return out
}

module.exports = { hashPassword, verifyPassword, burnVerification, temporaryPassword, PARAMS }
