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

const MAX_IMAGE_BYTES = 30 * 1024 * 1024
const MAX_INLINE_BYTES = 20 * 1024 * 1024

class MediaError extends ApiError {
  constructor(message) {
    super(400, message)
    this.name = 'MediaError'
    this.userFacing = true
  }
}

function ownKey(url) {
  return getStorage().keyFromUrl(url)
}

/** Load a media URL fully into memory. Resolves { buffer, mime }. */
async function loadBuffer(url, { maxBytes = MAX_IMAGE_BYTES, signal, timeoutMs = 60000, what = '文件' } = {}) {
  if (typeof url !== 'string' || !url) throw new MediaError(`缺少${what}地址`)
  const key = ownKey(url)
  let buffer
  if (key) {
    try { buffer = await getStorage().getBuffer(key) } catch { throw new MediaError(`${what}不存在或已被删除`) }
    if (buffer.length > maxBytes) throw new MediaError(`${what}超过 ${Math.round(maxBytes / 1048576)}MB 上限`)
  } else {
    if (url.startsWith('/')) throw new MediaError(`${what}地址无效`)
    try {
      buffer = (await safeFetch(url, { maxBytes, signal, timeoutMs })).buffer
    } catch (err) {
      if (signal && signal.aborted) throw signal.reason
      throw new MediaError(err.code === 'E2BIG'
        ? `${what}超过 ${Math.round(maxBytes / 1048576)}MB 上限`
        : `读取${what}失败：${err.message}`)
    }
  }
  return { buffer, mime: sniffMime(buffer) || 'application/octet-stream' }
}

/** Load an image and insist that it really is one. */
async function loadImage(url, opts = {}) {
  const what = opts.what || '图片'
  const out = await loadBuffer(url, { ...opts, what })
  if (!out.mime.startsWith('image/')) throw new MediaError(`${what}不是可识别的图片格式`)
  return out
}

/** Open a media URL as a stream (zip export). Resolves { stream, mime }. */
async function openStream(url, { maxBytes, signal, timeoutMs } = {}) {
  const key = ownKey(url)
  if (key) return { stream: await getStorage().getStream(key), mime: mimeForKey(key) }
  if (typeof url !== 'string' || url.startsWith('/')) throw new MediaError('文件地址无效')
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
      const { buffer, mime } = await loadImage(url, { maxBytes: MAX_INLINE_BYTES, signal, what: '参考图' })
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
    async toPublicUrl(url, what = '素材') {
      const abs = absoluteUrl(url)
      if (abs && isPubliclyReachable(abs)) return abs
      throw new MediaError(`${what}需要公网可访问的地址：请配置 PUBLIC_URL（公网域名）或改用对象存储`)
    },
  }
}

module.exports = { loadBuffer, loadImage, openStream, createMediaHelpers, isPubliclyReachable, absoluteUrl, ownKey, MediaError, MAX_IMAGE_BYTES }
