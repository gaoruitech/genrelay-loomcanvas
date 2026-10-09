'use strict'

/**
 * /api/canvas - templates, text templates, tool nodes and platform export.
 * The tool endpoints are local pixel processing: no model, no cost.
 */
const express = require('express')
const Template = require('../models/Template')
const TextTemplate = require('../models/TextTemplate')
const tools = require('../services/imageTools')
const { loadImage } = require('../services/media')
const { getStorage, newKey } = require('../storage')
const { ok, wrap, badRequest } = require('../utils/http')
const { clampInt, isMediaUrl } = require('../utils/validate')

const router = express.Router()

const MAX_SOURCE_BYTES = 20 * 1024 * 1024

function imageUrlOf(v, what) {
  if (!isMediaUrl(v)) throw badRequest(`缺少${what}地址`)
  return v
}

async function fetchImage(url, what) {
  const { buffer } = await loadImage(imageUrlOf(url, what), { maxBytes: MAX_SOURCE_BYTES, what })
  return buffer
}

async function save(buffer, mime) {
  const saved = await getStorage().put(newKey('tools', mime), buffer, { contentType: mime })
  return saved.url
}

/* ------------------------------------------------------------ templates */

/** GET /api/canvas/templates */
router.get('/templates', wrap(async (_req, res) => {
  const list = await Template.find({ isActive: true }).sort({ order: 1, createdAt: 1 }).limit(200).lean()
  ok(res, list.map((t) => ({
    key: t.key,
    title: t.title,
    description: t.description || '',
    cover: t.cover || '',
    graph: t.graph || { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  })))
}))

/** GET /api/canvas/text-templates?lang=zh|en */
router.get('/text-templates', wrap(async (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : 'zh'
  const list = await TextTemplate.find({ isActive: true, lang }).sort({ category: 1, order: 1, createdAt: 1 }).limit(500).lean()
  ok(res, list.map((t) => ({
    id: String(t._id),
    title: t.title,
    content: t.content || '',
    category: t.category || '',
    lang: t.lang || 'zh',
  })))
}))

/* ----------------------------------------------------------- tool nodes */

/** POST /api/canvas/tool/slice { imageUrl, cols, rows } */
router.post('/tool/slice', wrap(async (req, res) => {
  const b = req.body || {}
  const cols = clampInt(b.cols, 1, 6, 3)
  const rows = clampInt(b.rows, 1, 6, 3)
  const cells = await tools.slice(await fetchImage(b.imageUrl, '源图'), { cols, rows })
  const items = []
  for (const cell of cells) {
    items.push({
      key: cell.key,
      label: `第 ${cell.index} 格`,
      url: await save(cell.buffer, cell.mime),
      width: cell.width,
      height: cell.height,
    })
  }
  ok(res, { cols, rows, items })
}))

/** POST /api/canvas/tool/collage { imageUrls[], cols, rows, gap, bg, ratio } */
router.post('/tool/collage', wrap(async (req, res) => {
  const b = req.body || {}
  const urls = Array.isArray(b.imageUrls) ? b.imageUrls.filter(Boolean) : []
  if (urls.length < 2) throw badRequest('至少要接两张图才能拼')
  if (urls.length > 64) throw badRequest('图片数量过多')
  const cols = clampInt(b.cols, 1, 4, 2)
  const rows = clampInt(b.rows, 1, 4, 2)
  const used = urls.slice(0, cols * rows)
  const buffers = []
  for (let i = 0; i < used.length; i++) buffers.push(await fetchImage(used[i], `第 ${i + 1} 张图`))
  const out = await tools.collage(buffers, { cols, rows, gap: clampInt(b.gap, 0, 80, 0), bg: b.bg, ratio: String(b.ratio || '') })
  ok(res, {
    url: await save(out.buffer, out.mime),
    width: out.width,
    height: out.height,
    cols,
    rows,
    used: out.used,
    skipped: urls.length - out.used,
  })
}))

/** POST /api/canvas/tool/watermark { imageUrl, markUrl, position, scalePct, opacity, marginPct } */
router.post('/tool/watermark', wrap(async (req, res) => {
  const b = req.body || {}
  const base = await fetchImage(b.imageUrl, '底图')
  const mark = await fetchImage(b.markUrl, '水印图')
  const out = await tools.watermark(base, mark, {
    position: tools.ANCHORS.has(String(b.position)) ? String(b.position) : 'br',
    scalePct: clampInt(b.scalePct, 5, 60, 20),
    opacity: clampInt(b.opacity, 10, 100, 70),
    marginPct: clampInt(b.marginPct, 0, 20, 3),
  })
  ok(res, { url: await save(out.buffer, out.mime), width: out.width, height: out.height })
}))

/** POST /api/canvas/tool/fit { imageUrl, ratio, bg, format, quality, maxKb } */
router.post('/tool/fit', wrap(async (req, res) => {
  const b = req.body || {}
  const out = await tools.fit(await fetchImage(b.imageUrl, '源图'), {
    ratio: String(b.ratio || ''),
    bg: b.bg,
    format: ['jpg', 'png', 'webp'].includes(String(b.format)) ? String(b.format) : 'auto',
    quality: clampInt(b.quality, 40, 95, 88),
    maxKb: clampInt(b.maxKb, 0, 20480, 0),
  })
  ok(res, {
    url: await save(out.buffer, out.mime),
    width: out.width,
    height: out.height,
    bytes: out.buffer.length,
    overLimit: out.overLimit,
  })
}))

/** POST /api/canvas/platform-export { imageUrl, group: 'domestic' | 'overseas' } */
router.post('/platform-export', wrap(async (req, res) => {
  const b = req.body || {}
  const group = b.group === 'overseas' ? 'overseas' : 'domestic'
  const out = await tools.platformExport(await fetchImage(b.imageUrl, '源图'), group)
  const items = []
  for (const it of out.items) {
    items.push({ key: it.key, label: it.label, url: await save(it.buffer, it.mime), width: it.width, height: it.height })
  }
  ok(res, { group, items, whiteBg: out.whiteBg })
}))

module.exports = router
