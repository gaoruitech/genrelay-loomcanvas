'use strict'

/**
 * Reading media by URL, wherever it lives.
 *
 * A URL the canvas hands us is either a file in our own storage (read
 * directly, no HTTP) or an external address (fetched through the SSRF guard).
 * This is the single entry point for both, used by the canvas tools, the zip
 * export and by providers that need reference images.
 */
const { getStorage, mimeForKey } = require('../storage')
const { getConfig } = require('../config')
const { safeFetch, safeFetchStream, assertPublicUrl } = require('../utils/safeFetch')
const { sniffMime } = require('../utils/sniff')
const { ApiError } = require('../utils/http')
const { msg } = require('../i18n')

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_INLINE_BYTES = 20 * 1024 * 1024

/** `what` in the messages below names the media (a `noun.*` message). */
class MediaError extends ApiError {
  constructor(key, params) {
    super(400, key, params)
    this.name = 'MediaError'
  }
}

function ownKey(url) {
  return getStorage().keyFromUrl(url)
}

/** Load a media URL fully into memory. Resolves { buffer, mime }. */
async function loadBuffer(url, { maxBytes = MAX_IMAGE_BYTES, signal, timeoutMs = 60000, what = msg('noun.file') } = {}) {
  if (typeof url !== 'string' || !url) throw new MediaError('media.url_missing', { what })
  const key = ownKey(url)
  let buffer
  if (key) {
    try { buffer = await getStorage().getBuffer(key) } catch { throw new MediaError('media.gone', { what }) }
    if (buffer.length > maxBytes) throw new MediaError('media.too_large', { what, mb: Math.round(maxBytes / 1048576) })
  } else {
    if (url.startsWith('/')) throw new MediaError('media.bad_url', { what })
    try {
      buffer = (await safeFetch(url, { maxBytes, signal, timeoutMs })).buffer
    } catch (err) {
      if (signal && signal.aborted) throw signal.reason
      if (err.code === 'E2BIG') throw new MediaError('media.too_large', { what, mb: Math.round(maxBytes / 1048576) })
      throw new MediaError('media.read_failed', { what, detail: err.i18n || err.message })
    }
  }
  return { buffer, mime: sniffMime(buffer) || 'application/octet-stream' }
}

/** Load an image and insist that it really is one. */
async function loadImage(url, opts = {}) {
  const what = opts.what || msg('noun.image')
  const out = await loadBuffer(url, { ...opts, what })
  if (!out.mime.startsWith('image/')) throw new MediaError('media.not_image', { what })
  return out
}

/** Open a media URL as a stream (zip export). Resolves { stream, mime }. */
async function openStream(url, { maxBytes, signal, timeoutMs } = {}) {
  const key = ownKey(url)
  if (key) return { stream: await getStorage().getStream(key), mime: mimeForKey(key) }
  if (typeof url !== 'string' || url.startsWith('/')) throw new MediaError('media.bad_url', { what: msg('noun.file') })
  const res = await safeFetchStream(url, { maxBytes, signal, timeoutMs })
  return { stream: res.stream, mime: res.contentType }
}

/** Can a third-party service on the internet load this URL? */
function isPubliclyReachable(url) {
  // Static check only (scheme, localhost names, literal private addresses).
  try { assertPublicUrl(url); return true } catch { return false }
}

/** Absolute form of a storage URL, or '' when this deployment has no public address. */
function absoluteUrl(url) {
  if (/^https?:\/\//i.test(url)) return url
  const { publicUrl } = getConfig()
  return publicUrl && url.startsWith('/') ? publicUrl + url : ''
}

/**
 * Helpers handed to providers for one request. Reference media on the canvas
 * may sit in local storage that the upstream cannot reach; these turn a canvas
 * URL into something the upstream can actually consume.
 */
function createMediaHelpers(signal) {
  return {
    /** { mime, data } with data base64-encoded - for APIs that take inline bytes. */
    async toBase64(url) {
      const { buffer, mime } = await loadImage(url, { maxBytes: MAX_INLINE_BYTES, signal, what: msg('noun.reference_image') })
      return { mime, data: buffer.toString('base64') }
    },

    /**
     * A public URL when one exists, otherwise a base64 data URI - for APIs
     * that accept either in the same field.
     */
    async toRef(url) {
      const abs = absoluteUrl(url)
      if (abs && isPubliclyReachable(abs)) return abs
      const { mime, data } = await this.toBase64(url)
      return `data:${mime};base64,${data}`
    },

    /** A public URL or an error - for APIs that only take URLs (and for video). */
    async toPublicUrl(url, what = msg('noun.asset')) {
      const abs = absoluteUrl(url)
      if (abs && isPubliclyReachable(abs)) return abs
      throw new MediaError('media.needs_public_url', { what })
    },
  }
}

module.exports = { loadBuffer, loadImage, openStream, createMediaHelpers, isPubliclyReachable, absoluteUrl, ownKey, MediaError, MAX_IMAGE_BYTES }
