'use strict'

/**
 * File intake: direct upload and "fetch this URL for me".
 * Both end in the same place - type sniffed from content, a server-generated
 * storage key, and (for images) dimensions read with sharp.
 */
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

/**
 * GET /files/<key> for the local storage driver. Public by design: share
 * links and upstream providers need to load these, and keys are unguessable
 * (128 random bits).
 */
function staticRouter() {
  const router = express.Router()
  router.get('/*', async (req, res, next) => {
    const storage = getStorage()
    if (storage.driver !== 'local') return next()
    const key = req.params[0]
    if (!isValidKey(key)) return res.status(404).end()
    // Derived thumbnails (thumbs/of/...) are generated on first request and
    // then served from disk like any other file.
    const sourceKey = thumbSourceKey(key)
    if (sourceKey) {
      const state = await ensureThumbnail(key, sourceKey).catch(() => 'unsupported')
      if (state === 'missing') return res.status(404).end()
      // Not thumbnailable: the browser gets the image itself instead of a broken picture.
      if (state !== 'ok') return res.redirect(302, `/files/${sourceKey}`)
    }
    res.sendFile(key, {
      root: storage.root,
      dotfiles: 'deny',
      maxAge: ONE_YEAR,
      immutable: true,
      acceptRanges: true, // video seeking
      headers: {
        // The type comes from the extension we chose at write time, and the
        // browser is told not to second-guess it or run anything from here.
        'Content-Type': mimeForKey(key),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    }, (err) => {
      if (!err) return
      if (res.headersSent) return res.end()
      res.status(err.status === 416 ? 416 : 404).end()
    })
  })
  return router
}

module.exports = { apiRouter, staticRouter, ingest }
