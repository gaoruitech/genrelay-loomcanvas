'use strict'

/**
 * Secrets at rest and key derivation.
 *
 * One master secret (SECRET_KEY) feeds every purpose through HKDF with a
 * distinct label, so keys for different purposes are unrelated even though
 * they share a root. Today there is one purpose: encrypting stored credentials
 * (provider API keys, the S3 secret). Passwords and sessions do not use it:
 * passwords are hashed (utils/password.js) and session tokens are random.
 */
const crypto = require('crypto')

const VERSION = 'v1'
const SALT = Buffer.from('loomcanvas/key-derivation/v1')

const derivedCache = new Map()

/** Derive a 32-byte key for a named purpose. */
function deriveKey(secret, purpose) {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('secret must be a string of at least 16 characters')
  }
  const cacheKey = crypto.createHash('sha256').update(secret).update('\0').update(purpose).digest('hex')
  let key = derivedCache.get(cacheKey)
  if (!key) {
    key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), SALT, Buffer.from(purpose, 'utf8'), 32))
    derivedCache.set(cacheKey, key)
  }
  return key
}

/**
 * AES-256-GCM. Output: "v1.<iv>.<tag>.<ciphertext>", each part base64url.
 * A fresh random 96-bit IV per message.
 */
function encrypt(plain, secret) {
  if (typeof plain !== 'string') throw new Error('encrypt expects a string')
  const key = deriveKey(secret, 'provider-credentials')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), body.toString('base64url')].join('.')
}

function decrypt(payload, secret) {
  const parts = String(payload || '').split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('unrecognised ciphertext format')
  const key = deriveKey(secret, 'provider-credentials')
  const iv = Buffer.from(parts[1], 'base64url')
  const tag = Buffer.from(parts[2], 'base64url')
  if (iv.length !== 12 || tag.length !== 16) throw new Error('malformed ciphertext')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  // Throws when the key is wrong or the data was tampered with.
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8')
}

/** Compare two strings without leaking where they differ or how long they are. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

/** URL-safe random token. 32 bytes = 256 bits by default. */
function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

/** Last four characters of a key, for display next to "hasKey". */
function keyTail(key) {
  const s = String(key || '')
  return s.length >= 8 ? s.slice(-4) : ''
}

module.exports = { deriveKey, encrypt, decrypt, safeEqual, randomToken, keyTail }
