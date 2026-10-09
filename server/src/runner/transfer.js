'use strict'

/**
 * Result transfer: copy what a provider produced into our own storage, so a
 * canvas never depends on an upstream link that expires. Images also get a
 * small webp thumbnail.
 *
 * A provider output is one of:
 *   { type, url, headers? }   remote file (headers e.g. for an authenticated download)
 *   { type, b64, mime? }      inline base64
 */
const sharp = require('sharp')
const { getStorage, newKey, thumbKeyFor } = require('../storage')
const { safeFetch, safeFetchStream } = require('../utils/safeFetch')
const { sniffMime, kindOfMime } = require('../utils/sniff')
const { RunError } = require('./core')

const MAX_IMAGE_BYTES = 60 * 1024 * 1024
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024
const THUMB_EDGE = 512

const THUMB_MAX_PIXELS = 120 * 1000 * 1000
const THUMB_MAX_SOURCE_BYTES = 60 * 1024 * 1024

async function makeThumbnail(buffer) {
  return sharp(buffer, { failOn: 'none', limitInputPixels: THUMB_MAX_PIXELS })
    .rotate()
    .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()
}

/**
 * Write the thumbnail of a stored image at its derived key (see thumbKeyFor).
 * Resolves the thumbnail's { key, url }, or null when the image gets none.
 */
async function storeThumbnail(sourceKey, buffer) {
  const key = thumbKeyFor(sourceKey)
  if (!key) return null
  const thumb = await makeThumbnail(buffer)
  return getStorage().put(key, thumb, { contentType: 'image/webp' })
}

const pendingThumbs = new Map()

/**
 * Make sure the derived thumbnail `thumbKey` exists, generating it from its
 * source image when it does not (files stored before thumbnails had derived
 * keys, tool outputs). Resolves 'ok', 'missing' (no such source image) or
 * 'unsupported' (the source exists but cannot be thumbnailed).
 */
function ensureThumbnail(thumbKey, sourceKey) {
  const running = pendingThumbs.get(thumbKey)
  if (running) return running
  const job = (async () => {
    const storage = getStorage()
    if (await storage.exists(thumbKey)) return 'ok'
    if (!(await storage.exists(sourceKey))) return 'missing'
    try {
      const buffer = await storage.getBuffer(sourceKey)
      if (buffer.length > THUMB_MAX_SOURCE_BYTES || kindOfMime(sniffMime(buffer)) !== 'image') return 'unsupported'
      await storage.put(thumbKey, await makeThumbnail(buffer), { contentType: 'image/webp' })
      return 'ok'
    } catch {
      return 'unsupported'
    }
  })().finally(() => pendingThumbs.delete(thumbKey))
  pendingThumbs.set(thumbKey, job)
  return job
}

async function storeImage(buffer) {
  const mime = sniffMime(buffer)
  if (kindOfMime(mime) !== 'image') throw new RunError('BAD_RESULT', 'upstream.not_image_file')
  const storage = getStorage()
  let width = 0
  let height = 0
  try {
    const meta = await sharp(buffer, { failOn: 'none' }).metadata()
    width = meta.width || 0
    height = meta.height || 0
  } catch {
    // A format sharp cannot decode still gets stored; it just has no thumbnail.
  }
  const main = await storage.put(newKey('outputs', mime), buffer, { contentType: mime })
  const out = { type: 'image', url: main.url, key: main.key, thumbnailUrl: '', thumbKey: '', width, height }
  const thumb = width ? await storeThumbnail(main.key, buffer).catch(() => null) : null
  if (thumb) {
    out.thumbnailUrl = thumb.url
    out.thumbKey = thumb.key
  }
  return out
}

/** Read the first chunk of a stream, then put it back so the stream can be piped whole. */
function peek(stream) {
  return new Promise((resolve, reject) => {
    const onError = (err) => { cleanup(); reject(err) }
    const onEnd = () => { cleanup(); resolve(Buffer.alloc(0)) }
    const onReadable = () => {
      const chunk = stream.read()
      if (chunk === null) return
      cleanup()
      stream.unshift(chunk)
      resolve(chunk)
    }
    const cleanup = () => {
      stream.off('error', onError)
      stream.off('end', onEnd)
      stream.off('readable', onReadable)
    }
    stream.on('error', onError)
    stream.on('end', onEnd)
    stream.on('readable', onReadable)
  })
}

async function storeStream(type, url, headers, signal, timeoutMs) {
  const { stream } = await safeFetchStream(url, { headers, signal, timeoutMs, maxBytes: MAX_VIDEO_BYTES })
  try {
    const head = await peek(stream)
    const mime = sniffMime(head)
    if (kindOfMime(mime) !== type) {
      throw new RunError('BAD_RESULT', type === 'video' ? 'upstream.not_video_file' : 'upstream.bad_file')
    }
    const saved = await getStorage().put(newKey('outputs', mime), stream, { contentType: mime })
    return { type, url: saved.url, key: saved.key, thumbnailUrl: '', thumbKey: '', width: 0, height: 0 }
  } catch (err) {
    stream.destroy()
    throw err
  }
}

function fromDataUri(uri) {
  const m = /^data:([\w/+.-]+)?(;base64)?,(.*)$/s.exec(uri)
  if (!m || !m[2]) throw new RunError('BAD_RESULT', 'upstream.bad_inline_data')
  return Buffer.from(m[3], 'base64')
}

/**
 * @param {object} output  provider output (see above)
 * @param {{ signal: AbortSignal, timeoutMs?: number }} opts
 */
async function transferOutput(output, { signal, timeoutMs = 300000 } = {}) {
  const type = ['image', 'video', 'audio'].includes(output && output.type) ? output.type : 'image'
  try {
    if (output.b64) {
      if (type !== 'image') throw new RunError('BAD_RESULT', 'upstream.bad_inline_type')
      return await storeImage(Buffer.from(String(output.b64), 'base64'))
    }
    const url = String(output.url || '')
    if (!url) throw new RunError('BAD_RESULT', 'upstream.no_result_url')
    if (url.startsWith('data:')) return await storeImage(fromDataUri(url))

    // Already ours (a provider echoing an input back): reference it, do not copy.
    const own = getStorage().keyFromUrl(url)
    if (own) return { type, url, key: '', thumbnailUrl: type === 'image' ? url : '', thumbKey: '', width: 0, height: 0 }

    if (type === 'image') {
      const { buffer } = await safeFetch(url, { headers: output.headers, signal, timeoutMs, maxBytes: MAX_IMAGE_BYTES })
      return await storeImage(buffer)
    }
    return await storeStream(type, url, output.headers, signal, timeoutMs)
  } catch (err) {
    if (signal && signal.aborted) throw signal.reason
    if (err && err.name === 'SafeFetchError') {
      throw new RunError('DOWNLOAD_FAILED', 'run.download_failed', { detail: err.i18n })
    }
    throw err
  }
}

module.exports = { transferOutput, makeThumbnail, storeThumbnail, ensureThumbnail, storeImage }
