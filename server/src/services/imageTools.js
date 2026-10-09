'use strict'

/**
 * Pixel work behind the canvas tool nodes: slice, collage, watermark, fit and
 * multi-platform export. Pure functions from buffers to buffers - no HTTP, no
 * storage - all done locally with sharp, no model involved.
 */
const sharp = require('sharp')

/** Output pixel cap: collages and padding can enlarge the canvas a lot. */
const MAX_OUT_PIXELS = 40 * 1000 * 1000
/** Input pixel cap, so a decompression bomb is rejected before decoding. */
const MAX_IN_PIXELS = 120 * 1000 * 1000
const MAX_CELL_EDGE = 2048

const RATIOS = {
  '1:1': [1, 1], '3:4': [3, 4], '4:3': [4, 3], '4:5': [4, 5], '5:4': [5, 4],
  '9:16': [9, 16], '16:9': [16, 9], '2:3': [2, 3], '3:2': [3, 2],
}
const ANCHORS = new Set(['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'])
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

class ToolError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ToolError'
    this.userFacing = true
    this.status = 400
  }
}

const open = (buf) => sharp(buf, { limitInputPixels: MAX_IN_PIXELS, failOn: 'none' })

/** "#rgb" / "#rrggbb" -> sharp colour; anything else is white. */
function parseColor(v) {
  const s = String(v || '').trim()
  let m = /^#?([0-9a-f]{6})$/i.exec(s)
  if (m) {
    const n = parseInt(m[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, alpha: 1 }
  }
  m = /^#?([0-9a-f]{3})$/i.exec(s)
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16))
    return { r, g, b, alpha: 1 }
  }
  return { ...WHITE }
}

/**
 * Cut positions for splitting `total` pixels into `parts`.
 * Rounded cumulative boundaries rather than a fixed floor(total/parts) cell:
 * the cells then add up to exactly `total`, so no edge pixels are lost when
 * the size does not divide evenly.
 */
function cuts(total, parts) {
  const out = []
  for (let i = 0; i <= parts; i++) out.push(Math.round((i * total) / parts))
  return out
}

async function readMeta(buf, what = '图片') {
  let m
  try { m = await open(buf).metadata() } catch { throw new ToolError(`${what}无法解析`) }
  if (!m.width || !m.height) throw new ToolError(`${what}读取失败`)
  return m
}

/** Bake EXIF orientation into the pixels so every later step sees the upright image. */
async function upright(buf) {
  const m = await readMeta(buf)
  if (!m.orientation || m.orientation === 1) return buf
  return open(buf).rotate().toBuffer()
}

/** PNG when there is transparency to keep, JPEG otherwise (much smaller). */
async function encode(pipeline, hasAlpha, quality = 92) {
  if (hasAlpha) return { buffer: await pipeline.png().toBuffer(), mime: 'image/png' }
  return { buffer: await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer(), mime: 'image/jpeg' }
}

/** Split an image into a cols x rows grid of equal cells. */
async function slice(source, { cols, rows }) {
  if (cols * rows < 2) throw new ToolError('至少要切成两块')
  if (cols * rows > 16) throw new ToolError('一次最多切 16 块')
  const src = await upright(source)
  const m = await readMeta(src)
  if (m.width < cols || m.height < rows) throw new ToolError('图片太小，无法按该行列数切片')
  const xs = cuts(m.width, cols)
  const ys = cuts(m.height, rows)
  const items = []
  // One cell at a time: decoding a 4K image sixteen times in parallel is not worth the memory.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const width = xs[c + 1] - xs[c]
      const height = ys[r + 1] - ys[r]
      const out = await encode(open(src).extract({ left: xs[c], top: ys[r], width, height }), !!m.hasAlpha)
      items.push({ key: `r${r + 1}c${c + 1}`, index: r * cols + c + 1, width, height, ...out })
    }
  }
  return items
}

/**
 * Lay images out on a grid. Each cell is filled with `cover` (edges may be
 * cropped): a collage reads as tidy because the cells line up.
 */
async function collage(sources, { cols, rows, gap = 0, bg, ratio }) {
  if (sources.length < 2) throw new ToolError('至少要接两张图才能拼')
  const used = sources.slice(0, cols * rows)
  const first = await readMeta(used[0], '第一张图')
  const r = RATIOS[ratio] || null

  let cellW = Math.min(first.width, MAX_CELL_EDGE)
  let cellH = Math.min(MAX_CELL_EDGE, Math.round(r ? (cellW * r[1]) / r[0] : (cellW * first.height) / first.width))
  let outW = cols * cellW + (cols - 1) * gap
  let outH = rows * cellH + (rows - 1) * gap
  if (outW * outH > MAX_OUT_PIXELS) {
    const k = Math.sqrt(MAX_OUT_PIXELS / (outW * outH))
    cellW = Math.max(64, Math.floor(cellW * k))
    cellH = Math.max(64, Math.floor(cellH * k))
    outW = cols * cellW + (cols - 1) * gap
    outH = rows * cellH + (rows - 1) * gap
  }

  const layers = []
  for (let i = 0; i < used.length; i++) {
    const cell = await open(used[i]).rotate().resize(cellW, cellH, { fit: 'cover', position: 'centre' }).toBuffer()
    layers.push({ input: cell, left: (i % cols) * (cellW + gap), top: Math.floor(i / cols) * (cellH + gap) })
  }
  const canvas = sharp({ create: { width: outW, height: outH, channels: 4, background: parseColor(bg) } }).composite(layers)
  const out = await encode(canvas, false)
  return { ...out, width: outW, height: outH, used: used.length }
}

/** Stamp `mark` onto `base` at one of nine anchor positions. */
async function watermark(baseInput, markInput, { position = 'br', scalePct = 20, opacity = 70, marginPct = 3 }) {
  const base = await upright(baseInput)
  const bm = await readMeta(base, '底图')
  await readMeta(markInput, '水印图')

  let markBuf = await open(markInput).rotate().ensureAlpha()
    .resize({ width: Math.max(16, Math.round((bm.width * scalePct) / 100)) }).png().toBuffer()
  let mm = await readMeta(markBuf, '水印图')
  // A tall mark scaled by width could tower over the image; cap it at half the height.
  if (mm.height > bm.height / 2) {
    markBuf = await open(markInput).rotate().ensureAlpha()
      .resize({ height: Math.max(8, Math.round(bm.height / 2)) }).png().toBuffer()
    mm = await readMeta(markBuf, '水印图')
  }
  if (opacity < 100) {
    // sharp has no opacity knob: multiply the mark's alpha by tiling a
    // one-pixel translucent image over it with dest-in.
    markBuf = await sharp(markBuf).composite([{
      input: Buffer.from([255, 255, 255, Math.round((opacity * 255) / 100)]),
      raw: { width: 1, height: 1, channels: 4 },
      tile: true,
      blend: 'dest-in',
    }]).png().toBuffer()
  }

  const margin = Math.round((bm.width * marginPct) / 100)
  const [v, h] = ANCHORS.has(position) ? position : 'br'
  const top = v === 't' ? margin : v === 'm' ? Math.round((bm.height - mm.height) / 2) : bm.height - mm.height - margin
  const left = h === 'l' ? margin : h === 'c' ? Math.round((bm.width - mm.width) / 2) : bm.width - mm.width - margin
  const clamp = (n, max) => Math.max(0, Math.min(n, Math.max(0, max)))

  const out = await encode(open(base).composite([{
    input: markBuf,
    top: clamp(top, bm.height - mm.height),
    left: clamp(left, bm.width - mm.width),
  }]), !!bm.hasAlpha)
  return { ...out, width: bm.width, height: bm.height }
}

/**
 * Change aspect ratio by padding (never cropping), convert format, and
 * optionally squeeze under a size limit.
 */
async function fit(source, { ratio, bg, format = 'auto', quality = 88, maxKb = 0 }) {
  const src = await upright(source)
  const m = await readMeta(src)
  const r = RATIOS[ratio] || null
  const background = parseColor(bg)

  let outW = m.width
  let outH = m.height
  if (r) {
    const target = r[0] / r[1]
    if (m.width / m.height > target) outH = Math.round(m.width / target)
    else outW = Math.round(m.height * target)
    if (outW * outH > MAX_OUT_PIXELS) {
      const k = Math.sqrt(MAX_OUT_PIXELS / (outW * outH))
      outW = Math.max(1, Math.floor(outW * k))
      outH = Math.max(1, Math.floor(outH * k))
    }
  }

  const asPng = format === 'png' || (format === 'auto' && !!m.hasAlpha)
  const render = (w, h, q) => {
    let p = open(src)
    if (r || w !== m.width || h !== m.height) {
      p = p.resize(w, h, { fit: 'contain', background: asPng ? { ...background, alpha: 0 } : background })
    }
    if (asPng) return { p: p.png(), mime: 'image/png' }
    // JPEG/WebP-from-alpha: put the chosen colour behind transparent areas.
    p = p.flatten({ background })
    if (format === 'webp') return { p: p.webp({ quality: q }), mime: 'image/webp' }
    return { p: p.jpeg({ quality: q, mozjpeg: true }), mime: 'image/jpeg' }
  }

  let w = outW
  let h = outH
  let { p, mime } = render(w, h, quality)
  let buffer = await p.toBuffer()
  const limit = maxKb * 1024

  // Under a size limit: lower the quality first, then shrink, a few bounded
  // steps each. If it still does not fit, the caller is told (overLimit).
  if (limit > 0 && buffer.length > limit) {
    for (const q of [80, 70, 60, 50, 40]) {
      if (q >= quality) continue
      buffer = await render(w, h, q).p.toBuffer()
      if (buffer.length <= limit) break
    }
    for (let step = 0; buffer.length > limit && step < 3 && w > 320; step++) {
      w = Math.round(w * 0.8)
      h = Math.round(h * 0.8)
      buffer = await render(w, h, Math.min(quality, 60)).p.toBuffer()
    }
  }
  return { buffer, mime, width: w, height: h, overLimit: limit > 0 && buffer.length > limit }
}

/* ------------------------------------------------------ platform export */

/** Target sizes for marketplace listing images. */
const PLATFORM_SIZES = {
  domestic: {
    taobao: { width: 1200, height: 1200, fit: 'cover', label: '淘宝主图 1:1' },
    whiteBg: { width: 1200, height: 1200, fit: 'contain', label: '白底主图 1:1' },
    xhs: { width: 1242, height: 1656, fit: 'cover', label: '小红书 3:4' },
    douyin: { width: 1080, height: 1920, fit: 'cover', label: '抖音 9:16' },
  },
  overseas: {
    whiteBg: { width: 1200, height: 1200, fit: 'contain', label: 'White background 1:1' },
    amazon: { width: 1200, height: 1200, fit: 'cover', label: 'Amazon 1:1' },
    shopify: { width: 1200, height: 1500, fit: 'cover', label: 'Shopify 4:5' },
    tiktok: { width: 1080, height: 1920, fit: 'cover', label: 'TikTok 9:16' },
  },
}

/** Push near-white pixels (all channels >= threshold) to pure white. */
async function whiten(buffer, threshold = 236) {
  const { data, info } = await sharp(buffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] >= threshold && data[i + 1] >= threshold && data[i + 2] >= threshold) {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
    }
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg({ quality: 92 }).toBuffer()
}

/**
 * Is the border of the image pure white? Samples a 6% band along each edge of
 * a 200x200 downscale; marketplaces that demand a white background check the
 * same region. Returns { pure, score } with score in 0..1.
 */
async function checkWhiteBackground(buffer, { threshold = 250, tolerance = 0.9 } = {}) {
  try {
    const { data, info } = await sharp(buffer).resize(200, 200, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const { width, height, channels } = info
    const bandX = Math.max(2, Math.round(width * 0.06))
    const bandY = Math.max(2, Math.round(height * 0.06))
    let white = 0
    let total = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!(x < bandX || x >= width - bandX || y < bandY || y >= height - bandY)) continue
        const o = (y * width + x) * channels
        total++
        if (data[o] >= threshold && data[o + 1] >= threshold && data[o + 2] >= threshold) white++
      }
    }
    const score = total ? white / total : 0
    return { pure: score >= tolerance, score: Math.round(score * 1000) / 1000 }
  } catch {
    return { pure: false, score: null }
  }
}

/** One source image -> every size of a platform group. */
async function platformExport(source, group) {
  const sizes = PLATFORM_SIZES[group] || PLATFORM_SIZES.domestic
  const src = await upright(source)
  await readMeta(src, '源图')
  const items = []
  let whiteBg = null
  for (const [key, spec] of Object.entries(sizes)) {
    let buffer = await open(src)
      .resize(spec.width, spec.height, spec.fit === 'contain' ? { fit: 'contain', background: WHITE } : { fit: 'cover', position: 'centre' })
      .flatten({ background: WHITE })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer()
    if (key === 'whiteBg') {
      // Only the padded white-background version is whitened; doing it to the
      // others would bleach skies and highlights in ordinary scene photos.
      buffer = await whiten(buffer)
      whiteBg = await checkWhiteBackground(buffer)
    }
    items.push({ key, label: spec.label, width: spec.width, height: spec.height, buffer, mime: 'image/jpeg' })
  }
  return { items, whiteBg }
}

module.exports = { slice, collage, watermark, fit, platformExport, checkWhiteBackground, parseColor, cuts, ToolError, RATIOS, ANCHORS, PLATFORM_SIZES }
