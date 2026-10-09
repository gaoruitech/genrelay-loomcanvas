'use strict'

/**
 * File intake: direct upload and "fetch this URL for me".
 * Both end in the same place - type sniffed from content, a server-generated
 * storage key, and (for images) dimensions read with sharp.
 */
const { pipeline } = require('stream')
const express = require('express')
const multer = require('multer')
const sharp = require('sharp')
const { getConfig } = require('../config')
const { getStorage, newKey, isValidKey, mimeForKey, thumbSourceKey } = require('../storage')
const { safeFetch } = require('../utils/safeFetch')
const { sniffMime, kindOfMime } = require('../utils/sniff')
const { ok, wrap, badRequest, ApiError } = require('../utils/http')
const { storeThumbnail, ensureThumbnail } = require('../runner/transfer')

/** Images larger than this get a separate webp thumbnail; smaller ones are their own thumbnail. */
const THUMB_MIN_EDGE = 512

const MAX_IMAGE_PIXELS = 120 * 1000 * 1000

/** Validate a buffer, store it, describe it. */
async function ingest(buffer, { allow = ['image', 'video', 'audio'] } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw badRequest('file.empty')
  const mime = sniffMime(buffer)
  const kind = kindOfMime(mime)
  if (!kind || !allow.includes(kind)) throw badRequest(allow.length === 1 && allow[0] === 'image' ? 'file.image_only' : 'file.unsupported_type')

  const out = { size: buffer.length, mime }
  if (kind === 'image') {
    try {
      const meta = await sharp(buffer, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata()
      // EXIF orientations 5-8 mean the stored pixels are rotated a quarter turn.
      const rotated = meta.orientation && meta.orientation >= 5
      out.width = (rotated ? meta.height : meta.width) || 0
      out.height = (rotated ? meta.width : meta.height) || 0
    } catch {
      throw badRequest('file.image_corrupt')
    }
  }
  const saved = await getStorage().put(newKey('uploads', mime), buffer, { contentType: mime })
  if (kind === 'image') {
    out.thumbnailUrl = saved.url
    if (Math.max(out.width, out.height) > THUMB_MIN_EDGE) {
      // On failure, or for a format without thumbnails, the original doubles as its thumbnail.
      const thumb = await storeThumbnail(saved.key, buffer).catch(() => null)
      if (thumb) out.thumbnailUrl = thumb.url
    }
  }
  return { url: saved.url, key: saved.key, ...out }
}

function apiRouter() {
  const router = express.Router()
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: getConfig().maxUploadBytes, files: 1, fields: 10, parts: 12 },
  })

  /** POST /api/files/upload  multipart, field "file" */
  router.post('/upload', upload.single('file'), wrap(async (req, res) => {
    if (!req.file) throw badRequest('file.missing')
    ok(res, await ingest(req.file.buffer))
  }))

  /** POST /api/files/fetch { url } - download a remote image into storage */
  router.post('/fetch', wrap(async (req, res) => {
    const url = req.body && req.body.url
    if (typeof url !== 'string' || !url || url.length > 2048) throw badRequest('validation.required', { field: 'url' })
    // Already ours: nothing to fetch.
    const own = getStorage().keyFromUrl(url)
    if (own) {
      // Images only, like the remote case - and a stored video is not read into memory to say so.
      if (!mimeForKey(own).startsWith('image/')) throw badRequest('file.image_only')
      if (!(await getStorage().exists(own))) throw new ApiError(404, 'file.not_found')
      const buffer = await getStorage().getBuffer(own)
      const mime = sniffMime(buffer) || mimeForKey(own)
      const out = { url: getStorage().urlFor(own), key: own, size: buffer.length, mime }
      if (mime.startsWith('image/')) {
        out.thumbnailUrl = out.url
        const meta = await sharp(buffer).metadata().catch(() => ({}))
        out.width = meta.width || 0
        out.height = meta.height || 0
      }
      return ok(res, out)
    }
    let fetched
    try {
      fetched = await safeFetch(url, { maxBytes: getConfig().maxUploadBytes, timeoutMs: 60000 })
    } catch (err) {
      throw badRequest(err.name === 'SafeFetchError' ? err.i18n : 'fetch.failed')
    }
    ok(res, await ingest(fetched.buffer, { allow: ['image'] }))
  }))

  return router
}

const ONE_YEAR = 365 * 24 * 3600 * 1000
/** How long a browser may remember where a file was redirected to: short, the target changes with the storage settings. */
const REDIRECT_MAX_AGE_SEC = 300

/** Headers of every stored file, whichever backend it comes from. */
function fileHeaders(key) {
  const type = mimeForKey(key)
  return {
    // The type comes from the extension we chose at write time, and the
    // browser is told not to second-guess it or run anything from here.
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    // Whatever is not an image, a video or audio is downloaded, never displayed.
    ...(/^(image|video|audio)\//.test(type) ? {} : { 'Content-Disposition': 'attachment' }),
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  }
}

function sendLocal(backend, key, res) {
  res.sendFile(key, {
    root: backend.root,
    dotfiles: 'deny',
    maxAge: ONE_YEAR,
    immutable: true,
    acceptRanges: true, // video seeking
    headers: fileHeaders(key),
  }, (err) => {
    if (!err) return
    if (res.headersSent) return res.end()
    res.status(err.status === 416 ? 416 : 404).end()
  })
}

/** The file is not where it was last seen (removed from the bucket by hand): look again next time. */
function gone(key, res) {
  getStorage().forget(key)
  res.status(404).end()
}

/**
 * Stream an object out of a bucket. Range and If-None-Match go to the storage
 * service and its answer (206, 304, 416) is passed on, so a video is never
 * read further than the player asked for and nothing is buffered here.
 */
async function sendObject(backend, key, req, res) {
  res.set(fileHeaders(key))
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR / 1000}, immutable`)
  const describe = (info) => {
    if (info.etag) res.setHeader('ETag', info.etag)
    if (info.lastModified) res.setHeader('Last-Modified', new Date(info.lastModified).toUTCString())
  }
  if (req.method === 'HEAD') {
    const info = await backend.head(key)
    if (!info) return gone(key, res)
    describe(info)
    res.setHeader('Content-Length', info.size)
    return res.status(200).end()
  }
  // One plain range; anything fancier gets the whole file, which is always a valid answer.
  const range = /^bytes=\d*-\d*$/.test(req.headers.range || '') ? req.headers.range : undefined
  const ifNoneMatch = String(req.headers['if-none-match'] || '').slice(0, 300) || undefined
  const object = await backend.open(key, { range, ifNoneMatch })
  if (!object) return gone(key, res)
  describe(object)
  if (object.status === 304 || object.status === 416) return res.status(object.status).end()
  res.status(object.status)
  res.setHeader('Content-Length', object.size)
  if (object.contentRange) res.setHeader('Content-Range', object.contentRange)
  // pipeline tears the bucket stream down when the browser goes away mid-file.
  pipeline(object.stream, res, () => {})
}

/**
 * GET /files/<key>: the one address of a stored file. Public by design: share
 * links and upstream providers need to load these, and keys are unguessable
 * (128 random bits).
 *
 * The file is looked up in the storage layer and answered according to where
 * it is: read from the disk, streamed out of a bucket, or - when that bucket
 * delivers from a public domain - redirected there.
 */
function staticRouter() {
  const router = express.Router()
  router.get('/*', async (req, res) => {
    const key = req.params[0]
    if (!isValidKey(key)) return res.status(404).end()
    try {
      // Derived thumbnails (thumbs/of/...) are generated on first request and
      // then served like any other file.
      const sourceKey = thumbSourceKey(key)
      if (sourceKey) {
        const state = await ensureThumbnail(key, sourceKey).catch(() => 'unsupported')
        if (state === 'missing') return res.status(404).end()
        // Not thumbnailable: the browser gets the image itself instead of a broken picture.
        if (state !== 'ok') return res.redirect(302, `/files/${sourceKey}`)
      }
      const backend = await getStorage().locate(key)
      if (!backend) return res.status(404).end()
      if (backend.driver === 'local') return sendLocal(backend, key, res)
      if (backend.delivery === 'redirect') {
        res.setHeader('Cache-Control', `public, max-age=${REDIRECT_MAX_AGE_SEC}`)
        res.setHeader('Access-Control-Allow-Origin', '*')
        return res.redirect(302, backend.publicUrl(key))
      }
      await sendObject(backend, key, req, res)
    } catch (err) {
      // The storage service could not be asked. Not a 404: the file may well exist.
      console.error(`[files] ${key}: ${(err && (err.name || err.code)) || 'error'}`)
      if (!res.headersSent) res.status(502).end()
      else res.destroy()
    }
  })
  return router
}

module.exports = { apiRouter, staticRouter, ingest }
