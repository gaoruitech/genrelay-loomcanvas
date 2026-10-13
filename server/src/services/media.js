'use strict'

/**
 * Reading media by URL, wherever it lives.
 *
 * A URL the canvas hands us is either a file in our own storage (read
 * directly, no HTTP) or an external address (fetched through the SSRF guard).
 * This is the single entry point for both, used by the canvas tools, the zip
 * export and by providers that need reference images.
 */
const { getStorage, mimeForKey, isUnavailable } = require('../storage')
const { getConfig } = require('../config')
const { safeFetch, safeFetchStream } = require('../utils/safeFetch')
const { isPubliclyReachable } = require('../utils/reachability')
const { sniffMime } = require('../utils/sniff')
const { ApiError } = require('../utils/http')
const { msg } = require('../i18n')

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_INLINE_BYTES = 20 * 1024 * 1024
/** Lifetime of a signed address given to an upstream: long enough for a queued video job to start. */
const SIGNED_URL_TTL_SEC = 3600

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
    try {
      buffer = await getStorage().getBuffer(key)
    } catch (err) {
      // The storage that may hold it cannot be asked right now: that is not "deleted".
      if (isUnavailable(err)) throw err
      throw new MediaError('media.gone', { what })
    }
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

/**
 * Open a media URL as a stream (zip export, download proxy).
 * Resolves { stream, mime, size } - size is null when it is not known up front.
 */
async function openStream(url, { maxBytes, signal, timeoutMs } = {}) {
  const key = ownKey(url)
  if (key) {
    const storage = getStorage()
    return { stream: await storage.getStream(key), mime: mimeForKey(key), size: await storage.size(key) }
  }
  if (typeof url !== 'string' || url.startsWith('/')) throw new MediaError('media.bad_url', { what: msg('noun.file') })
  const res = await safeFetchStream(url, { maxBytes, signal, timeoutMs })
  return { stream: res.stream, mime: res.contentType, size: res.contentLength }
}

/** Absolute form of a storage URL, or '' when this deployment has no public address. */
function absoluteUrl(url) {
  if (/^https?:\/\//i.test(url)) return url
  const { publicUrl } = getConfig()
  return publicUrl && url.startsWith('/') ? publicUrl + url : ''
}

/**
 * Is a way of loading a file straight from its bucket (storage.externalAccess)
 * any use to an upstream on the internet? The bucket's public domain is judged
 * by its address. A signed address is judged by the endpoint it is made for,
 * not by the address itself: with virtual-hosted addressing the bucket name is
 * put in front of the host, and "<bucket>.minio" would pass for a domain.
 */
function reachableFromOutside(way) {
  if (way.via === 'public_base') return isPubliclyReachable(way.url)
  return !way.endpoint || isPubliclyReachable(way.endpoint)
}

/**
 * An address an upstream on the internet can fetch a canvas URL from, or ''.
 * A file in a bucket is handed over straight from there when the bucket can be
 * reached from outside - its public domain when files are delivered from it,
 * otherwise a signed address that expires - so the upstream does not depend on
 * this app being reachable. A bucket whose endpoint is internal ("minio", a
 * private address) is never given out: such a file, like one on the local
 * disk, goes through PUBLIC_URL. The result is for the upstream request only;
 * it is never stored.
 */
async function upstreamUrl(url) {
  const key = ownKey(url)
  if (key) {
    for (const way of await getStorage().externalAccess(key, { expiresIn: SIGNED_URL_TTL_SEC })) {
      if (reachableFromOutside(way)) return way.via === 'signed' ? way.sign() : way.url
    }
  }
  const abs = absoluteUrl(url)
  return abs && isPubliclyReachable(abs) ? abs : ''
}

/**
 * How a file stored now would be handed to an upstream on the internet:
 *   'public_base'  from the public domain of the bucket in use
 *   'signed'       by a signed address of the bucket in use
 *   'app'          through this app, as PUBLIC_URL + /files/<key>
 *   'inline'       not by address at all: images are sent inline to providers that
 *                  take them, and an input that has to be a URL is refused
 * The same rule upstreamUrl() applies to a file that exists; nothing is contacted.
 */
function newFilesHandover() {
  const way = getStorage().newFileAccess().find(reachableFromOutside)
  if (way) return way.via
  const { publicUrl } = getConfig()
  return publicUrl && isPubliclyReachable(`${publicUrl}/files/x`) ? 'app' : 'inline'
}

/**
 * Would a file stored now be loadable by an upstream on the internet? True
 * with a public PUBLIC_URL, or when new files go to a bucket that can be
 * reached from outside. The canvas uses it to say, before a run, that a model
 * which only takes URLs cannot be given a reference image.
 */
async function newFilesReachable() {
  return newFilesHandover() !== 'inline'
}

/**
 * Helpers handed to providers for one request. Reference media on the canvas
 * may sit in storage that the upstream cannot reach (the local disk without a
 * public address); these turn a canvas URL into something the upstream can
 * actually consume.
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
      const direct = await upstreamUrl(url)
      if (direct) return direct
      const { mime, data } = await this.toBase64(url)
      return `data:${mime};base64,${data}`
    },

    /** A public URL or an error - for APIs that only take URLs (and for video). */
    async toPublicUrl(url, what = msg('noun.asset')) {
      const direct = await upstreamUrl(url)
      if (direct) return direct
      throw new MediaError('media.needs_public_url', { what })
    },
  }
}

module.exports = { loadBuffer, loadImage, openStream, createMediaHelpers, isPubliclyReachable, absoluteUrl, upstreamUrl, newFilesHandover, newFilesReachable, ownKey, MediaError, MAX_IMAGE_BYTES }
