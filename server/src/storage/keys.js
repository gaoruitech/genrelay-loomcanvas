'use strict'

/**
 * Storage keys are always generated here. A key never contains anything the
 * user typed (file names, URLs): only a fixed prefix, the date and random hex.
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

/** Example: uploads/2025/01/<32 hex chars>.png */
function newKey(prefix, mime) {
  if (!PREFIXES.has(prefix)) throw new Error(`unknown storage prefix: ${prefix}`)
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  return `${prefix}/${yyyy}/${mm}/${crypto.randomBytes(16).toString('hex')}.${extForMime(mime)}`
}

/** Shape check for keys that arrive from outside (URL paths). */
function isValidKey(key) {
  return typeof key === 'string' && key.length <= 200 && KEY_RE.test(key) && !key.includes('..')
}

module.exports = { newKey, isValidKey, extForMime, mimeForKey, MIME_EXT }
