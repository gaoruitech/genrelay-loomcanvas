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
const { getStorage, newKey } = require('../storage')
const { safeFetch, safeFetchStream } = require('../utils/safeFetch')
const { sniffMime, kindOfMime } = require('../utils/sniff')
const { RunError } = require('./core')

const MAX_IMAGE_BYTES = 60 * 1024 * 1024
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024
const THUMB_EDGE = 512

async function makeThumbnail(buffer) {
  return sharp(buffer, { failOn: 'none' })
    .rotate()
    .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer()
}

async function storeImage(buffer) {
  const mime = sniffMime(buffer)
  if (kindOfMime(mime) !== 'image') throw new RunError('BAD_RESULT', '上游返回的不是图片文件')
  const storage = getStorage()
  let width = 0
  let height = 0
  let thumb = null
  try {
    const meta = await sharp(buffer, { failOn: 'none' }).metadata()
    width = meta.width || 0
    height = meta.height || 0
    thumb = await makeThumbnail(buffer)
  } catch {
    // A format sharp cannot decode still gets stored; it just has no thumbnail.
  }
  const main = await storage.put(newKey('outputs', mime), buffer, { contentType: mime })
  const out = { type: 'image', url: main.url, key: main.key, thumbnailUrl: '', thumbKey: '', width, height }
  if (thumb) {
    const t = await storage.put(newKey('thumbs', 'image/webp'), thumb, { contentType: 'image/webp' })
    out.thumbnailUrl = t.url
    out.thumbKey = t.key
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
      throw new RunError('BAD_RESULT', type === 'video' ? '上游返回的不是视频文件' : '上游返回的文件格式不正确')
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
  if (!m || !m[2]) throw new RunError('BAD_RESULT', '上游返回的内联数据无法解析')
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
      if (type !== 'image') throw new RunError('BAD_RESULT', '不支持的内联结果类型')
      return await storeImage(Buffer.from(String(output.b64), 'base64'))
    }
    const url = String(output.url || '')
    if (!url) throw new RunError('BAD_RESULT', '上游结果缺少地址')
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
      throw new RunError('DOWNLOAD_FAILED', `结果${err.message.startsWith('下载') ? '' : '下载失败：'}${err.message}`)
    }
    throw err
  }
}

module.exports = { transferOutput, makeThumbnail, storeImage }
