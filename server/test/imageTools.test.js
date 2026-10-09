'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const tools = require('../src/services/imageTools')
const { sniffMime, kindOfMime } = require('../src/utils/sniff')
const { pickThumbnail, collectNodeMedia, cleanNodes } = require('../src/services/canvasGraph')
const { newKey, isValidKey, mimeForKey } = require('../src/storage/keys')

const solid = (width, height, color, alpha = false) =>
  sharp({ create: { width, height, channels: alpha ? 4 : 3, background: color } }).png().toBuffer()

const size = async (buf) => { const m = await sharp(buf).metadata(); return [m.width, m.height] }

test('cuts never lose edge pixels', () => {
  assert.deepEqual(tools.cuts(1001, 3), [0, 334, 667, 1001])
  assert.deepEqual(tools.cuts(10, 1), [0, 10])
  for (const [total, parts] of [[1001, 3], [7, 6], [1920, 5], [333, 4]]) {
    const c = tools.cuts(total, parts)
    assert.equal(c.at(-1), total)
    assert.ok(c.every((v, i) => i === 0 || v > c[i - 1]))
  }
})

test('slice: cells tile the source exactly', async () => {
  const src = await solid(1001, 500, { r: 10, g: 200, b: 30 })
  const cells = await tools.slice(src, { cols: 3, rows: 2 })
  assert.equal(cells.length, 6)
  assert.deepEqual(cells.map((c) => c.key), ['r1c1', 'r1c2', 'r1c3', 'r2c1', 'r2c2', 'r2c3'])
  assert.equal(cells.slice(0, 3).reduce((s, c) => s + c.width, 0), 1001)
  assert.equal(cells[0].height + cells[3].height, 500)
  assert.deepEqual(await size(cells[0].buffer), [cells[0].width, cells[0].height])
  assert.equal(cells[0].mime, 'image/jpeg')
  await assert.rejects(tools.slice(src, { cols: 1, rows: 1 }), (e) => e.i18n.code === 'tool.slice_min')
  await assert.rejects(tools.slice(src, { cols: 6, rows: 6 }), (e) => e.i18n.code === 'tool.slice_max')
  await assert.rejects(tools.slice(Buffer.from('not an image'), { cols: 2, rows: 2 }), (e) => e.userFacing)
})

test('slice keeps transparency as png', async () => {
  const src = await solid(100, 100, { r: 0, g: 0, b: 0, alpha: 0.5 }, true)
  const cells = await tools.slice(src, { cols: 2, rows: 1 })
  assert.equal(cells[0].mime, 'image/png')
})

test('collage: grid size with gaps', async () => {
  const a = await solid(400, 300, '#ff0000')
  const b = await solid(200, 800, '#00ff00')
  const out = await tools.collage([a, b, a], { cols: 2, rows: 2, gap: 10, bg: '#000' })
  assert.deepEqual([out.width, out.height], [810, 610])
  assert.deepEqual(await size(out.buffer), [810, 610])
  assert.equal(out.used, 3)
  const squared = await tools.collage([a, b], { cols: 2, rows: 1, ratio: '1:1' })
  assert.deepEqual([squared.width, squared.height], [800, 400])
  await assert.rejects(tools.collage([a], { cols: 2, rows: 2 }), (e) => e.i18n.code === 'tool.collage_min')
})

test('watermark keeps the base size', async () => {
  const base = await solid(800, 600, '#ffffff')
  const mark = await solid(100, 40, { r: 0, g: 0, b: 0, alpha: 1 }, true)
  for (const position of ['tl', 'mc', 'br']) {
    const out = await tools.watermark(base, mark, { position, scalePct: 20, opacity: 50, marginPct: 3 })
    assert.deepEqual(await size(out.buffer), [800, 600])
  }
  // The bottom-right mark actually darkened that corner, and only that corner.
  const out = await tools.watermark(base, mark, { position: 'br', scalePct: 20, opacity: 100, marginPct: 0 })
  const { data, info } = await sharp(out.buffer).raw().toBuffer({ resolveWithObject: true })
  const px = (x, y) => data[(y * info.width + x) * info.channels]
  assert.ok(px(790, 590) < 60, 'corner is dark')
  assert.ok(px(10, 10) > 240, 'opposite corner untouched')
})

test('fit pads to the target ratio without cropping, converts format, honours size limits', async () => {
  const src = await solid(640, 480, '#3366cc')
  const wide = await tools.fit(src, { ratio: '16:9', format: 'webp' })
  assert.deepEqual([wide.width, wide.height], [853, 480])
  assert.equal(wide.mime, 'image/webp')
  assert.equal(sniffMime(wide.buffer), 'image/webp')

  const tall = await tools.fit(src, { ratio: '9:16', format: 'jpg' })
  assert.deepEqual([tall.width, tall.height], [640, 1138])

  const same = await tools.fit(src, { ratio: '', format: 'png' })
  assert.deepEqual([same.width, same.height], [640, 480])
  assert.equal(same.mime, 'image/png')

  // Noise does not compress, so the limit forces quality and size reductions.
  const noise = await sharp(Buffer.from(Array.from({ length: 600 * 600 * 3 }, (_, i) => (i * 2654435761) % 251)), { raw: { width: 600, height: 600, channels: 3 } }).png().toBuffer()
  const free = await tools.fit(noise, { format: 'jpg', quality: 90 })
  const limited = await tools.fit(noise, { format: 'jpg', quality: 90, maxKb: 20 })
  assert.ok(limited.buffer.length < free.buffer.length)
  assert.equal(limited.overLimit, limited.buffer.length > 20 * 1024)
})

test('platform export produces every size; white background check tells white from colour', async () => {
  const src = await solid(900, 600, '#ffffff')
  const out = await tools.platformExport(src, 'domestic')
  assert.deepEqual(out.items.map((i) => i.key), ['taobao', 'whiteBg', 'xhs', 'douyin'])
  for (const it of out.items) assert.deepEqual(await size(it.buffer), [it.width, it.height])
  assert.equal(out.whiteBg.pure, true)

  const overseas = await tools.platformExport(src, 'overseas')
  assert.deepEqual(overseas.items.map((i) => i.key), ['whiteBg', 'amazon', 'shopify', 'tiktok'])

  assert.equal((await tools.checkWhiteBackground(await solid(300, 300, '#cc2222'))).pure, false)
  assert.deepEqual(await tools.checkWhiteBackground(Buffer.from('junk')), { pure: false, score: null })
})

test('parseColor', () => {
  assert.deepEqual(tools.parseColor('#ff8000'), { r: 255, g: 128, b: 0, alpha: 1 })
  assert.deepEqual(tools.parseColor('0f0'), { r: 0, g: 255, b: 0, alpha: 1 })
  assert.deepEqual(tools.parseColor('url(javascript:1)'), { r: 255, g: 255, b: 255, alpha: 1 })
})

test('sniffMime recognises media by content and nothing else', async () => {
  assert.equal(sniffMime(await solid(4, 4, '#fff')), 'image/png')
  assert.equal(sniffMime(await sharp(await solid(4, 4, '#fff')).jpeg().toBuffer()), 'image/jpeg')
  assert.equal(sniffMime(await sharp(await solid(4, 4, '#fff')).webp().toBuffer()), 'image/webp')
  assert.equal(sniffMime(await sharp(await solid(4, 4, '#fff')).gif().toBuffer()), 'image/gif')
  const ftyp = (brand) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftyp' + brand), Buffer.alloc(12)])
  assert.equal(sniffMime(ftyp('isom')), 'video/mp4')
  assert.equal(sniffMime(ftyp('qt  ')), 'video/quicktime')
  assert.equal(sniffMime(ftyp('avif')), 'image/avif')
  assert.equal(sniffMime(ftyp('M4A ')), 'audio/mp4')
  assert.equal(sniffMime(Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('....webm....')])), 'video/webm')
  assert.equal(sniffMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt ')])), 'audio/wav')
  assert.equal(sniffMime(Buffer.from('ID3\x03\x00\x00\x00')), 'audio/mpeg')
  for (const notMedia of ['<html><script>alert(1)</script>', '<svg xmlns="http://www.w3.org/2000/svg">', '#!/bin/sh\nrm -rf /', '{"a":1}', 'MZ\x90\x00', '%PDF-1.7', 'PK\x03\x04']) {
    assert.equal(sniffMime(Buffer.from(notMedia, 'latin1')), null, notMedia.slice(0, 12))
  }
  assert.equal(sniffMime(Buffer.alloc(0)), null)
  assert.equal(kindOfMime('video/mp4'), 'video')
  assert.equal(kindOfMime('text/html'), null)
})

test('storage keys are generated, never derived from user input', () => {
  const key = newKey('uploads', 'image/png')
  assert.match(key, /^uploads\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/)
  assert.notEqual(key, newKey('uploads', 'image/png'))
  assert.match(newKey('outputs', 'text/html'), /\.bin$/, 'unknown types get a neutral extension')
  assert.throws(() => newKey('../etc', 'image/png'))
  assert.equal(isValidKey(key), true)
  for (const bad of ['../x.png', 'uploads/../../etc/passwd', '/abs/a.png', 'uploads\\a.png', 'uploads/a', 'uploads/.env', 'a.png', 'uploads/a b.png', 'uploads/%2e%2e/a.png', '', null, 'uploads/' + 'a'.repeat(300) + '.png']) {
    assert.equal(isValidKey(bad), false, String(bad))
  }
  assert.equal(mimeForKey('outputs/2025/01/abc.mp4'), 'video/mp4')
  assert.equal(mimeForKey('outputs/2025/01/abc.html'), 'application/octet-stream')
})

test('canvas graph helpers', () => {
  const nodes = [
    { id: '1', type: 'image', data: { imageUrl: '/files/uploads/a.png' } },
    { id: '2', type: 'image-gen', data: { imageUrl: 'https://x/gen.png', imageUrls: ['https://x/gen.png', 'https://x/gen2.png'], status: 'done', taskId: 't', prompt: 'p' } },
    { id: '3', type: 'video-gen', data: { videoUrl: 'https://x/v.mp4' } },
    { id: '4', type: 'text', data: { text: 'hello', imageUrl: 'data:image/png;base64,AAAA' } },
    null,
    { id: '5', type: 'output' },
  ]
  assert.deepEqual(pickThumbnail(nodes), { thumbnail: 'https://x/gen.png', thumbnailType: 'image' }, 'generated beats uploaded')
  assert.deepEqual(pickThumbnail([nodes[2]]), { thumbnail: 'https://x/v.mp4', thumbnailType: 'video' })
  assert.deepEqual(pickThumbnail([nodes[3]]), { thumbnail: '', thumbnailType: '' })
  assert.deepEqual(pickThumbnail('nope'), { thumbnail: '', thumbnailType: '' })

  assert.deepEqual(collectNodeMedia(nodes[1]), [{ url: 'https://x/gen.png', kind: 'image' }, { url: 'https://x/gen2.png', kind: 'image' }])
  assert.deepEqual(collectNodeMedia(nodes[3]), [], 'data URIs are not media references')
  assert.deepEqual(collectNodeMedia(null), [])

  const cleaned = cleanNodes(nodes.filter(Boolean))
  assert.deepEqual(cleaned[1].data, { imageUrl: 'https://x/gen.png', imageUrls: ['https://x/gen.png', 'https://x/gen2.png'], prompt: 'p' })
  cleaned[1].data.imageUrls.push('mutated')
  assert.equal(nodes[1].data.imageUrls.length, 2, 'deep copy')
  assert.equal(nodes[1].data.status, 'done', 'source untouched')

  // What a published canvas must not carry: run ids, what the runs cost, failure details.
  const [shared] = cleanNodes([{
    id: 'g', type: 'image-gen',
    data: {
      model: 'acme:img-1', prompt: 'p', imageUrl: 'https://x/a.png',
      taskId: 'a'.repeat(24), taskIds: ['a'.repeat(24)], runPending: true, generatedCount: 3, errorMsg: 'boom', errorRunId: 'b'.repeat(24),
      cost: { amount: 1.5, currency: 'CNY', unknown: false }, estimatedCost: { amount: 1.5, currency: 'CNY', unknown: false },
      results: [{ id: 'r1', at: 1, urls: ['https://x/a.png'], cost: { amount: 1.5, currency: 'CNY' }, model: 'acme:img-1', prompt: 'p' }, 'junk', null],
    },
  }])
  assert.deepEqual(shared.data, {
    model: 'acme:img-1', prompt: 'p', imageUrl: 'https://x/a.png',
    results: [{ id: 'r1', at: 1, urls: ['https://x/a.png'], model: 'acme:img-1', prompt: 'p' }, 'junk', null],
  })
})
