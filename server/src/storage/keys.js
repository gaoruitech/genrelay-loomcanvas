'use strict'

/**
 * Storage keys are always generated here. A key never contains anything the
 * user typed (file names, URLs): only a fixed prefix, the id of the account the
 * file belongs to, the date and random hex.
 *
 *   uploads/<account id>/2025/01/<32 hex chars>.png
 *
 * Files written before accounts existed have no account segment
 * (uploads/2025/01/<hex>.png); those keys stay valid and are served as before.
 * The account segment is what lets an account's files be removed with it. It
 * is not an access check: a file's address is public to whoever has it.
 */
const crypto = require('crypto')

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
}

const EXT_MIME = Object.fromEntries(Object.entries(MIME_EXT).map(([m, e]) => [e, m]))
EXT_MIME.jpeg = 'image/jpeg'

const PREFIXES = new Set(['uploads', 'outputs', 'thumbs', 'tools'])
const KEY_RE = /^[a-z0-9]+(?:\/[a-z0-9][a-z0-9_-]*)*\/[a-z0-9][a-z0-9_-]*\.[a-z0-9]{1,5}$/

function extForMime(mime) {
  return MIME_EXT[String(mime || '').toLowerCase()] || 'bin'
}

function mimeForKey(key) {
  const ext = String(key).split('.').pop().toLowerCase()
  return EXT_MIME[ext] || 'application/octet-stream'
}

const ACCOUNT_ID = /^[0-9a-f]{24}$/

/**
 * Example: uploads/<account id>/2025/01/<32 hex chars>.png. Without an account
 * id (anything that is not one) the account segment is left out.
 */
function newKey(prefix, mime, userId) {
  if (!PREFIXES.has(prefix)) throw new Error(`unknown storage prefix: ${prefix}`)
  const owner = ACCOUNT_ID.test(String(userId || '')) ? `${userId}/` : ''
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${prefix}/${owner}${yyyy}/${mm}/${crypto.randomBytes(16).toString('hex')}.${extForMime(mime)}`
}

const THUMB_PREFIX = 'thumbs/of/'
const THUMB_SOURCE_PREFIXES = ['uploads', 'outputs', 'tools']
const THUMB_SOURCE_EXTS = ['png', 'jpg', 'webp', 'bmp', 'avif']

/**
 * Where the thumbnail of a stored image lives. The key is derived from the
 * image's own key, so anyone holding the image URL can work out the thumbnail
 * URL without asking:
 *   outputs/2025/01/<hex>.png  ->  thumbs/of/outputs/2025/01/<hex>_png.webp
 * Returns null for keys that do not get a thumbnail (videos, animated GIFs,
 * formats sharp may not decode, thumbnails themselves).
 */
function thumbKeyFor(key) {
  const m = /^(.+)\.([a-z0-9]+)$/.exec(String(key || ''))
  if (!m || !isValidKey(key)) return null
  if (!THUMB_SOURCE_PREFIXES.includes(m[1].split('/')[0]) || !THUMB_SOURCE_EXTS.includes(m[2])) return null
  const out = `${THUMB_PREFIX}${m[1]}_${m[2]}.webp`
  return isValidKey(out) ? out : null
}

/** Inverse of thumbKeyFor: the image a derived thumbnail key belongs to, or null. */
function thumbSourceKey(thumbKey) {
  const s = String(thumbKey || '')
  if (!s.startsWith(THUMB_PREFIX)) return null
  const m = /^(.+)_([a-z0-9]+)\.webp$/.exec(s.slice(THUMB_PREFIX.length))
  if (!m) return null
  const key = `${m[1]}.${m[2]}`
  return thumbKeyFor(key) === s ? key : null
}

/** Shape check for keys that arrive from outside (URL paths). */
function isValidKey(key) {
  return typeof key === 'string' && key.length <= 200 && KEY_RE.test(key) && !key.includes('..')
}

/**
 * Every key prefix under which the files of one account live: its uploads,
 * results and tool outputs, and the thumbnails derived from them.
 */
function accountPrefixes(userId) {
  if (!ACCOUNT_ID.test(String(userId || ''))) throw new Error('not an account id')
  return THUMB_SOURCE_PREFIXES.flatMap((p) => [`${p}/${userId}/`, `${THUMB_PREFIX}${p}/${userId}/`])
}

module.exports = { newKey, isValidKey, extForMime, mimeForKey, thumbKeyFor, thumbSourceKey, accountPrefixes, MIME_EXT }
