'use strict'

/**
 * Provider plugins against a local fake upstream. These pin down the request
 * shapes we send and the response shapes we accept; they do not prove the
 * real upstream agrees.
 *
 * The exception is the block of tests named "real service": their fixtures are
 * what https://gaorui.cc answered on 2026-10-10, with ids and file names
 * replaced by placeholders.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const gaorui = require('../src/providers/gaorui')
const openai = require('../src/providers/openai')
const gemini = require('../src/providers/gemini')
const { openaiBase } = require('../src/providers/http')
const { parseModelList } = require('../src/services/providerMigration')

/** Fake upstream: records every request, answers from a route table. */
async function fakeUpstream(routes) {
  const calls = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString()
      let body = null
      try { body = raw ? JSON.parse(raw) : null } catch { body = raw }
      const call = { method: req.method, path: req.url, headers: req.headers, body }
      calls.push(call)
      const handler = routes[`${req.method} ${req.url.split('?')[0]}`]
      const out = handler ? handler(call) : { status: 404, body: { error: { message: 'no such route' } } }
      res.statusCode = out.status || 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(out.body === undefined ? out : out.body))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { calls, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close() } }
}

const media = {
  async toRef(url) { return `ref(${url})` },
  async toBase64(url) { return { mime: 'image/png', data: Buffer.from(url).toString('base64') } },
  async toPublicUrl(url) { return `public(${url})` },
}
const signal = new AbortController().signal

test('gaorui nano-banana: submit and poll follow the documented protocol', async (t) => {
  let status = { status: 'running', progress: 40 }
  const up = await fakeUpstream({
    'POST /v1/nano-banana': () => ({ body: { code: 0, data: { id: 'task-9' } } }),
    'GET /v1/nano-banana/task-9': () => ({ body: { code: 0, data: status } }),
  })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'sk-raw-key' }

  const sub = await gaorui.submit(cfg, {
    kind: 'image', model: 'nano-banana-2.1', prompt: '  a cat  ', imageUrls: ['/files/a.png'],
    params: { resolution: '2K', aspectRatio: '16:9' }, media, signal,
  })
  assert.deepEqual(sub, { externalId: 'task-9' })
  const post = up.calls[0]
  assert.equal(post.headers.authorization, 'sk-raw-key', 'raw key, no Bearer prefix')
  assert.deepEqual(post.body, {
    model: 'nano-banana-2.1', prompt: 'a cat', imageSize: '2K', images: ['public(/files/a.png)'],
    webHook: '-1', shutProgress: false, aspectRatio: '16:9',
  })

  // aspectRatio "auto" is omitted from the body.
  await gaorui.submit(cfg, { kind: 'image', model: 'nano-banana-pro', prompt: 'x', imageUrls: [], params: { aspectRatio: 'auto' }, media, signal })
  assert.equal('aspectRatio' in up.calls[1].body, false)
  assert.equal(up.calls[1].body.imageSize, '1K')

  const req = { kind: 'image', model: 'nano-banana-2.1', externalId: 'task-9', media, signal }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'running', progress: 40 })
  assert.equal(up.calls.at(-1).headers.authorization, 'sk-raw-key')

  for (const [done, field] of [['completed', 'image_url'], ['success', 'imageUrl'], ['finish', 'url'], ['succeeded', 'output']]) {
    status = { status: done, [field]: `https://cdn.example/${field}.png` }
    assert.deepEqual(await gaorui.poll(cfg, req), {
      status: 'succeeded', progress: 100, outputs: [{ type: 'image', url: `https://cdn.example/${field}.png` }],
    })
  }
  status = { status: 'completed' }
  assert.equal((await gaorui.poll(cfg, req)).status, 'failed', 'done without a URL is a failure')
  for (const failed of ['failed', 'error']) {
    status = { status: failed, error: '内容审核未通过' }
    assert.deepEqual(await gaorui.poll(cfg, req), { status: 'failed', error: '内容审核未通过' })
  }
})

test('gaorui nano-banana: upstream errors become user-facing errors', async (t) => {
  const up = await fakeUpstream({
    'POST /v1/nano-banana': (c) => (c.body.prompt === 'unauthorized'
      ? { status: 401, body: { error: { message: 'invalid token' } } }
      : { body: { code: 1001, msg: '余额不足' } }),
  })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'k' }
  const run = (prompt) => ({ kind: 'image', model: 'nano-banana-2', prompt, imageUrls: [], params: {}, media, signal })
  await assert.rejects(gaorui.submit(cfg, run('x')), (e) => e.userFacing && e.i18n.code === 'upstream.submit_failed_detail' && e.i18n.params.detail === '余额不足')
  await assert.rejects(gaorui.submit(cfg, run('unauthorized')), (e) => e.userFacing && e.status === 401 && !e.safeToResubmit && !e.message.includes('sk-'))
  await assert.rejects(gaorui.submit({ baseUrl: up.baseUrl, apiKey: '' }, run('x')), (e) => e.i18n.code === 'provider.api_key_missing')
  await assert.rejects(gaorui.submit(cfg, { ...run('x'), kind: 'video', model: 'not-in-catalog' }), (e) => e.i18n.code === 'provider.model_not_supported')
})

test('gaorui: connection refused is transient and safe to resubmit', async () => {
  const cfg = { baseUrl: 'http://127.0.0.1:9', apiKey: 'k' }
  await assert.rejects(
    gaorui.submit(cfg, { kind: 'image', model: 'nano-banana-2', prompt: 'x', imageUrls: [], params: {}, media, signal }),
    (e) => e.userFacing && e.transient && e.safeToResubmit
  )
})

test('gaorui videos: request body per model', async (t) => {
  const up = await fakeUpstream({ 'POST /v1/videos': () => ({ body: { id: 'vid-1', status: 'queued' } }) })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl + '/v1', apiKey: 'sk-v' }
  const run = (model, extra) => ({ kind: 'video', model, prompt: 'go', imageUrls: [], videoUrls: [], params: {}, media, signal, ...extra })

  assert.deepEqual(await gaorui.submit(cfg, run('omni-flash', { params: { duration: 8, resolution: '1080p', aspectRatio: '9:16' }, imageUrls: ['a', 'b'] })), { externalId: 'vid-1' })
  assert.equal(up.calls[0].headers.authorization, 'Bearer sk-v')
  assert.equal(up.calls[0].path, '/v1/videos', 'a base URL ending in /v1 is not doubled')
  assert.deepEqual(up.calls[0].body, {
    model: 'omni_flash_8s', prompt: 'go', resolution: '1080p', aspect_ratio: '9:16', input_reference: ['ref(a)', 'ref(b)'],
  })

  await gaorui.submit(cfg, run('omni-flash', { params: { duration: 7, resolution: '8k', aspectRatio: '1:1' } }))
  assert.deepEqual(up.calls[1].body, { model: 'omni_flash_8s', prompt: 'go', resolution: '720p', aspect_ratio: '16:9' }, 'invalid options fall back to defaults')
  // 6 s is gone from the catalog (no channel serves omni_flash_6s); a canvas that still stores it gets 8 s.
  await gaorui.submit(cfg, run('omni-flash', { params: { duration: 6 } }))
  assert.equal(up.calls.at(-1).body.model, 'omni_flash_8s')
  up.calls.pop()

  await gaorui.submit(cfg, run('omni-flash', { params: { imgMode: 'frames' }, imageUrls: ['a', 'b', 'c'] }))
  assert.deepEqual(up.calls[2].body.input_reference, ['ref(a)', 'ref(b)'])
  assert.equal(up.calls[2].body.first_last_frame, true)

  await gaorui.submit(cfg, run('omni-flash-edit', { videoUrls: ['/files/v.mp4'], imageUrls: ['r'], params: { resolution: '4k' } }))
  assert.deepEqual(up.calls[3].body, {
    model: 'omni_flash_abra_edit', prompt: 'go', source_video_url: 'public(/files/v.mp4)', aspect_ratio: '16:9', resolution: '4k', input_reference: ['ref(r)'],
  })
  await assert.rejects(gaorui.submit(cfg, run('omni-flash-edit')), (e) => e.i18n.code === 'provider.video_edit_needs_source')

  // Veo 3.1: the upstream model follows from what the run carries.
  await gaorui.submit(cfg, run('veo-3.1', { params: { aspectRatio: '9:16', resolution: '1080p', duration: 8 } }))
  assert.deepEqual(up.calls[4].body, { model: 'veo_3_1', prompt: 'go', resolution: '1080p', aspect_ratio: '9:16' }, 'text only; no duration field, the clip is always 8 s')
  up.calls.pop()
  await gaorui.submit(cfg, run('veo-3.1', { params: { imgMode: 'multi' }, imageUrls: ['a', 'b', 'c', 'd'] }))
  assert.deepEqual(up.calls[4].body, { model: 'veo_3_1-components', prompt: 'go', resolution: 'lite', aspect_ratio: '16:9', images: ['public(a)', 'public(b)', 'public(c)'] }, 'references: at most 3, as public URLs')
  up.calls.pop()
  await gaorui.submit(cfg, run('veo-3.1', { params: { imgMode: 'frames', resolution: '8k', aspectRatio: '1:1' }, imageUrls: ['first', 'last', 'extra'] }))
  assert.deepEqual(up.calls[4].body, { model: 'veo_3_1-fl', prompt: 'go', resolution: 'lite', aspect_ratio: '16:9', images: ['public(first)', 'public(last)'] }, 'first and last frame, in that order')
  up.calls.pop()
  // An image that has no public address is refused before anything is sent.
  const veoLocal = { ...media, async toPublicUrl() { const e = new Error('needs a public URL'); e.code = 'media.needs_public_url'; throw e } }
  await assert.rejects(gaorui.submit(cfg, run('veo-3.1', { imageUrls: ['/files/a.jpg'], media: veoLocal })), (e) => e.code === 'media.needs_public_url')
  await assert.rejects(gaorui.submit(cfg, run('sora-2-openai-12s')), (e) => e.i18n.code === 'provider.model_not_supported', 'removed from the catalog')
  assert.equal(up.calls.length, 4)
  // frames mode without any image is plain text-to-video
  await gaorui.submit(cfg, run('veo-3.1', { params: { imgMode: 'frames' } }))
  assert.equal(up.calls[4].body.model, 'veo_3_1')
  assert.equal('images' in up.calls[4].body, false)

  await gaorui.submit(cfg, run('grok-imagine-video-1.5-preview', { params: { duration: 12, resolution: '720p', aspectRatio: '3:2' }, imageUrls: ['g'] }))
  assert.deepEqual(up.calls[5].body, {
    model: 'grok-imagine-video-1.5-preview', prompt: 'go', size: '1792x1024', seconds: '12', resolution: '720p', image_urls: ['public(g)'],
  })
  await gaorui.submit(cfg, run('grok-imagine-video-1.5-preview', { params: { duration: 99 } }))
  assert.equal(up.calls[6].body.seconds, '15', 'clamped, and sent as a string')
  assert.equal('image_urls' in up.calls[6].body, false)

  await assert.rejects(gaorui.submit(cfg, run('omni-flash', { prompt: '' })), (e) => e.i18n.code === 'run.prompt_required')
})

test('gaorui videos: both response shapes are understood', async (t) => {
  let reply = {}
  const up = await fakeUpstream({
    'POST /v1/videos': () => ({ body: reply }),
    'GET /v1/videos/t1': () => ({ body: reply }),
  })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'sk-v' }
  const req = { kind: 'video', model: 'omni-flash', prompt: 'go', externalId: 't1', imageUrls: [], params: {}, media, signal }

  reply = { code: 'success', data: { task_id: 'wrapped-1', data: { status: 'queued' } } }
  assert.deepEqual(await gaorui.submit(cfg, req), { externalId: 'wrapped-1' })
  reply = { code: 'error', message: '参数错误' }
  await assert.rejects(gaorui.submit(cfg, req), (e) => e.i18n.code === 'upstream.error_detail' && e.i18n.params.detail === '参数错误')
  reply = { status: 'queued' }
  await assert.rejects(gaorui.submit(cfg, req), (e) => e.i18n.code === 'upstream.no_task_id')

  reply = { code: 'success', data: { task_id: 't1', status: 'IN_PROGRESS', progress: '45%' } }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'running', progress: 45 })

  reply = { code: 'success', data: [{ task_id: 't1', status: 'SUCCESS', data: { video_url: 'https://cdn.example/a.mp4' } }] }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'succeeded', progress: 100, outputs: [{ type: 'video', url: 'https://cdn.example/a.mp4' }] })

  reply = { id: 't1', status: 'completed', video_url: '', metadata: { url: 'https://cdn.example/signed.mp4?sig=1' } }
  assert.deepEqual((await gaorui.poll(cfg, req)).outputs, [{ type: 'video', url: 'https://cdn.example/signed.mp4?sig=1' }], 'direct link: no credentials attached')

  reply = { id: 't1', status: 'succeeded' }
  assert.deepEqual((await gaorui.poll(cfg, req)).outputs, [{
    type: 'video', url: `${up.baseUrl}/v1/videos/t1/content`, headers: { Authorization: 'Bearer sk-v' },
  }], 'no link: fall back to the authenticated content endpoint')

  reply = { code: 0, data: { task_id: 't1', status: 'FAILURE', fail_reason: '审核未通过' } }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'failed', error: '审核未通过' })
  reply = { id: 't1', status: 'failed', error: { message: 'bad prompt' } }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'failed', error: 'bad prompt' })
})

/* ---- 高瑞, real service: shapes recorded from https://gaorui.cc on 2026-10-10 (ids and file names are placeholders) ---- */

const REAL_IMG = 'https://media.example.net/media/0000.jpg'
const REAL_VID = 'https://media.example.net/media/0000.mp4'
const REAL_IMG_2 = 'https://media.example.net/media/0001.jpg'

test('gaorui real service: nano-banana task shapes, and reference images that must be URLs', async (t) => {
  let poll = {}
  const up = await fakeUpstream({
    'POST /v1/nano-banana': (c) => ((c.body.images || []).some((u) => !/^https?:\/\//.test(u))
      ? { status: 400, body: { error: { code: 'image_must_be_url', message: '图片/参考图仅支持 http/https URL，不支持 base64 或本地数据，请改用图片/文件 URL', type: 'invalid_request_error' } } }
      : { body: { code: 0, msg: 'success', data: { id: 'task0001', type: c.body.images.length ? 'image2image' : 'text2image' } } }),
    'GET /v1/nano-banana/task0001': () => ({ body: poll }),
  })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'sk-example' }
  const run = (extra) => ({ kind: 'image', model: 'nano-banana-2', prompt: 'a boat', imageUrls: [], params: { resolution: '1K', aspectRatio: '1:1' }, media, signal, ...extra })

  assert.deepEqual(await gaorui.submit(cfg, run()), { externalId: 'task0001' })
  assert.deepEqual(up.calls[0].body, { model: 'nano-banana-2', prompt: 'a boat', imageSize: '1K', images: [], webHook: '-1', shutProgress: false, aspectRatio: '1:1' })

  // The status answer carries the task twice: OpenAI-style at the top, and in `data`, which is what we read.
  const req = run({ externalId: 'task0001' })
  poll = { code: 0, created_at: 1791600108, data: { id: 'task0001', progress: 0, status: 'pending', type: 'text2image', url: '' }, id: 'task0001', model: 'nano-banana-2', msg: 'success', object: 'image', progress: 0, status: 'queued' }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'running', progress: 0 })
  poll = { code: 0, created_at: 1791600108, data: { id: 'task0001', progress: 50, status: 'processing', type: 'text2image', url: '' }, id: 'task0001', model: 'nano-banana-2', msg: 'success', object: 'image', progress: 50, status: 'in_progress' }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'running', progress: 50 })
  poll = {
    code: 0, completed_at: 1791600118, created_at: 1791600108,
    data: { id: 'task0001', progress: 100, status: 'succeeded', type: 'text2image', url: REAL_IMG },
    id: 'task0001', metadata: { url: REAL_IMG, video_url: REAL_IMG }, model: 'nano-banana-2', msg: 'success', object: 'image',
    output_url: REAL_IMG, progress: 100, status: 'completed', url: REAL_IMG, video_url: REAL_IMG,
  }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'succeeded', progress: 100, outputs: [{ type: 'image', url: REAL_IMG }] })

  // A reference image goes in as a public URL...
  await gaorui.submit(cfg, run({ imageUrls: ['/files/a.jpg'], media: { ...media, async toPublicUrl() { return REAL_IMG } } }))
  assert.deepEqual(up.calls.at(-1).body.images, [REAL_IMG])
  // ...and one without a public address is refused before anything is sent: the upstream takes no base64.
  const sent = up.calls.length
  const local = { ...media, async toPublicUrl() { const e = new Error('needs a public URL'); e.code = 'media.needs_public_url'; throw e } }
  await assert.rejects(gaorui.submit(cfg, run({ imageUrls: ['/files/a.jpg'], media: local })), (e) => e.code === 'media.needs_public_url')
  assert.equal(up.calls.length, sent)
  // What the upstream answered when it was sent a data URI (kept so that answer stays readable if it ever comes back).
  const dataUri = { ...media, async toPublicUrl() { return 'data:image/jpeg;base64,AAAA' } }
  await assert.rejects(gaorui.submit(cfg, run({ imageUrls: ['/files/a.jpg'], media: dataUri })), (e) => e.status === 400 && !e.transient && !e.safeToResubmit
    && e.upstreamCode === 'image_must_be_url' && e.i18n.code === 'upstream.http_error_detail' && e.i18n.params.detail.startsWith('图片/参考图仅支持 http/https URL'))
})

test('gaorui real service: video task shapes (flat), result link without credentials', async (t) => {
  let poll = {}
  const up = await fakeUpstream({
    'POST /v1/videos': (c) => ({ body: { id: 'video_0001', object: 'video', model: c.body.model === 'omni_flash_abra_edit' ? c.body.model : '', status: 'queued', progress: 0, created_at: 0 } }),
    'GET /v1/videos/video_0001': () => ({ body: poll }),
  })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'sk-example' }
  const run = (model, extra) => ({ kind: 'video', model, prompt: 'a boat', imageUrls: [], videoUrls: [], params: {}, media, signal, ...extra })

  // Grok Video 1.5, text only: the body the upstream accepted.
  assert.deepEqual(await gaorui.submit(cfg, run('grok-imagine-video-1.5-preview', { params: { duration: 4, resolution: '480p', aspectRatio: '16:9' } })), { externalId: 'video_0001' })
  assert.equal(up.calls[0].headers.authorization, 'Bearer sk-example')
  assert.deepEqual(up.calls[0].body, { model: 'grok-imagine-video-1.5-preview', prompt: 'a boat', size: '1280x720', seconds: '4', resolution: '480p' })
  // Omni Flash Edit: the source video is a URL the upstream fetches itself.
  const publicMedia = { ...media, async toPublicUrl() { return REAL_VID } }
  await gaorui.submit(cfg, run('omni-flash-edit', { videoUrls: [REAL_VID], params: { resolution: '720p', aspectRatio: '16:9' }, media: publicMedia }))
  assert.deepEqual(up.calls[1].body, { model: 'omni_flash_abra_edit', prompt: 'a boat', source_video_url: REAL_VID, aspect_ratio: '16:9', resolution: '720p' })

  const req = run('grok-imagine-video-1.5-preview', { externalId: 'video_0001' })
  poll = { id: 'video_0001', object: 'video', model: '', status: 'queued', progress: 0, created_at: 0 }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'running', progress: 0 })
  poll = { created_at: 1791600212, id: 'video_0001', metadata: { url: '' }, model: 'grok-imagine-video-1.5-preview', object: 'video', progress: 1, status: 'in_progress' }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'running', progress: 1 })
  poll = {
    completed_at: 1791600244, created_at: 1791600212, id: 'video_0001', metadata: { url: REAL_VID, video_url: REAL_VID },
    model: 'grok-imagine-video-1.5-preview', object: 'video', output_url: REAL_VID, progress: 100, status: 'completed', url: REAL_VID, video_url: REAL_VID,
  }
  // A plain public link: downloaded without our key.
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'succeeded', progress: 100, outputs: [{ type: 'video', url: REAL_VID }] })
})

test('gaorui real service: Omni Flash and Veo 3.1, text only and with images given as URLs', async (t) => {
  // The create answer repeats the model sent; the status answers of veo_3_1 name the resolution tier ("veo_3_1-lite").
  let poll = {}
  const up = await fakeUpstream({
    'POST /v1/videos': (c) => ({ body: { id: 'task0001', object: 'video', model: c.body.model, status: 'queued', progress: 0, created_at: 1791601678 } }),
    'GET /v1/videos/task0001': () => ({ body: poll }),
  })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'sk-example' }
  const publicMedia = { ...media, async toRef(url) { return url }, async toPublicUrl(url) { return url } }
  const run = (model, extra) => ({ kind: 'video', model, prompt: 'a boat', imageUrls: [], videoUrls: [], params: {}, media: publicMedia, signal, ...extra })

  // The five bodies the upstream accepted on 2026-10-10.
  assert.deepEqual(await gaorui.submit(cfg, run('omni-flash', { params: { duration: 8, resolution: '720p', aspectRatio: '16:9' } })), { externalId: 'task0001' })
  assert.deepEqual(up.calls.at(-1).body, { model: 'omni_flash_8s', prompt: 'a boat', resolution: '720p', aspect_ratio: '16:9' })
  await gaorui.submit(cfg, run('omni-flash', { params: { duration: 8, resolution: '720p', aspectRatio: '16:9', imgMode: 'multi' }, imageUrls: [REAL_IMG] }))
  assert.deepEqual(up.calls.at(-1).body, { model: 'omni_flash_8s', prompt: 'a boat', resolution: '720p', aspect_ratio: '16:9', input_reference: [REAL_IMG] })
  await gaorui.submit(cfg, run('veo-3.1', { params: { duration: 8, resolution: 'lite', aspectRatio: '16:9' } }))
  assert.deepEqual(up.calls.at(-1).body, { model: 'veo_3_1', prompt: 'a boat', resolution: 'lite', aspect_ratio: '16:9' })
  await gaorui.submit(cfg, run('veo-3.1', { params: { duration: 8, resolution: 'lite', aspectRatio: '16:9', imgMode: 'multi' }, imageUrls: [REAL_IMG] }))
  assert.deepEqual(up.calls.at(-1).body, { model: 'veo_3_1-components', prompt: 'a boat', resolution: 'lite', aspect_ratio: '16:9', images: [REAL_IMG] })
  await gaorui.submit(cfg, run('veo-3.1', { params: { duration: 8, resolution: 'lite', aspectRatio: '16:9', imgMode: 'frames' }, imageUrls: [REAL_IMG, REAL_IMG_2] }))
  assert.deepEqual(up.calls.at(-1).body, { model: 'veo_3_1-fl', prompt: 'a boat', resolution: 'lite', aspect_ratio: '16:9', images: [REAL_IMG, REAL_IMG_2] })
  for (const c of up.calls) assert.equal(c.headers.authorization, 'Bearer sk-example')

  const req = run('veo-3.1', { externalId: 'task0001' })
  poll = { created_at: 1791601678, id: 'task0001', model: 'omni_flash_8s', object: 'video', progress: 0, status: 'queued' }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'running', progress: 0 })
  poll = { created_at: 1791601678, id: 'task0001', metadata: { url: '' }, model: 'veo_3_1-lite', object: 'video', progress: 50, status: 'in_progress' }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'running', progress: 50 })
  poll = {
    completed_at: 1791601753, created_at: 1791601678, id: 'task0001', metadata: { url: REAL_VID, video_url: REAL_VID },
    model: 'veo_3_1-lite', object: 'video', output_url: REAL_VID, progress: 100, status: 'completed', url: REAL_VID, video_url: REAL_VID,
  }
  assert.deepEqual(await gaorui.poll(cfg, req), { status: 'succeeded', progress: 100, outputs: [{ type: 'video', url: REAL_VID }] })
})

test('gaorui real service: "no channel serves this model" is a final answer, in both shapes it arrives in', async (t) => {
  const inner = (model) => ({ error: { code: 'model_not_found', message: `分组 default 下模型 ${model} 无可用渠道（distributor） (request id: 0000)`, type: 'new_api_error' } })
  const up = await fakeUpstream({
    'POST /v1/videos': (c) => {
      // Recorded on 2026-10-10 for omni_flash_6s and sora-2-openai-12s. Neither is in the catalog any more,
      // so the two shapes are replayed here for models that still are.
      // Shape 1: the relay wraps the error body of the service behind it as a JSON string.
      if (c.body.model.startsWith('omni_flash')) return { status: 503, body: { code: 'fail_to_fetch_task', message: JSON.stringify(inner(c.body.model)), data: null } }
      // Shape 2: the relay itself has no channel.
      if (c.body.model === 'veo_3_1') return { status: 503, body: inner(c.body.model) }
      return { status: 503, body: { error: { message: 'overloaded' } } }
    },
  })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'sk-example' }
  const run = (model) => ({ kind: 'video', model, prompt: 'a boat', imageUrls: [], videoUrls: [], params: {}, media, signal })
  for (const [model, upstream] of [['omni-flash', 'omni_flash_8s'], ['veo-3.1', 'veo_3_1']]) {
    await assert.rejects(gaorui.submit(cfg, run(model)), (e) => {
      assert.equal(e.status, 503)
      assert.equal(e.upstreamCode, 'model_not_found')
      // Not repeated by the runner: asking again cannot help.
      assert.equal(e.safeToResubmit, false)
      assert.equal(e.transient, false)
      // The sentence of the upstream, not a JSON string.
      assert.equal(e.i18n.params.detail, `分组 default 下模型 ${upstream} 无可用渠道（distributor） (request id: 0000)`)
      return true
    })
  }
  // Any other 503 is still "not now": the request was not processed and may be repeated.
  await assert.rejects(gaorui.submit(cfg, run('grok-imagine-video-1.5-preview')), (e) => e.status === 503 && e.safeToResubmit && e.transient && e.i18n.params.detail === 'overloaded')
})

test('gaorui real service: chat answers and token usage of the five catalog models', async (t) => {
  // One answer per model, as recorded (ids replaced, reasoning text shortened). Reasoning text is never part of the answer.
  const answers = {
    'deepseek-v4-pro': { choices: [{ finish_reason: 'stop', index: 0, logprobs: null, message: { content: 'pong', reasoning_content: 'thinking...', role: 'assistant' } }], created: 1791600150, id: 'id-0', model: 'deepseek-v4-pro-ga', service_tier: 'default', object: 'chat.completion', usage: { completion_tokens: 30, prompt_tokens: 91, total_tokens: 121, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 27 } } },
    'gpt-5.5': { id: 'resp_0', object: 'chat.completion', created: 1791600152, model: 'gpt-5.5', choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 }, service_tier: 'default' },
    'glm-5.3': { id: 'id-1', object: 'chat.completion', created: 1791600168, model: 'glm-5.3', choices: [{ index: 0, message: { role: 'assistant', content: 'pong', reasoning_content: 'thinking...', tool_calls: null }, logprobs: null, finish_reason: 'stop', matched_stop: 154827 }], usage: { prompt_tokens: 19, total_tokens: 93, completion_tokens: 74, prompt_tokens_details: { cached_tokens: 0 }, completion_tokens_details: { reasoning_tokens: 72 } }, metadata: { weight_version: 'default' } },
    'gpt-6-astra': { id: 'resp_1', object: 'chat.completion', created: 1791600172, model: 'gpt-6-astra', choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 }, service_tier: 'default' },
    // completion_tokens includes the reasoning tokens (87 of 88 here).
    'gemini-3.5-flash-c': { id: 'chatcmpl-0', model: 'gemini-3.5-flash', object: 'chat.completion', created: 1791600174, choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 88, total_tokens: 95, prompt_tokens_details: { cached_tokens: 0, text_tokens: 7, audio_tokens: 0, image_tokens: 0 }, completion_tokens_details: { text_tokens: 0, audio_tokens: 0, reasoning_tokens: 87 }, input_tokens: 0, output_tokens: 0, input_tokens_details: null } },
  }
  const up = await fakeUpstream({ 'POST /v1/chat/completions': (c) => ({ body: answers[c.body.model] }) })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'sk-example' }
  const usage = {}
  for (const model of Object.keys(answers)) {
    const out = await gaorui.chat(cfg, { model, prompt: 'Reply with exactly one word: pong', imageUrls: [], media, signal })
    assert.equal(out.text, 'pong', model)
    usage[model] = [out.usage.inputTokens, out.usage.outputTokens]
  }
  assert.deepEqual(up.calls[0].body, { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }], stream: false })
  assert.deepEqual(usage, { 'deepseek-v4-pro': [91, 30], 'gpt-5.5': [13, 5], 'glm-5.3': [19, 74], 'gpt-6-astra': [13, 5], 'gemini-3.5-flash-c': [7, 88] })
  // An image reaches gpt-6-astra and gemini-3.5-flash-c as a data URI in an image_url part; both read it.
  await gaorui.chat(cfg, { model: 'gpt-6-astra', prompt: 'what number?', imageUrls: ['/files/n.png'], media: { ...media, async toRef() { return 'data:image/png;base64,AAAA' } }, signal })
  assert.deepEqual(up.calls.at(-1).body.messages[0].content, [{ type: 'text', text: 'what number?' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }])
})

test('gaorui: the model list call only proves the key; a custom image model uses the nano-banana task API', async (t) => {
  const up = await fakeUpstream({
    'GET /v1/models': () => ({ body: { data: [{ id: 'gpt-4o-mini' }, { id: 'some-image-model' }, { id: 'veo3.1-fast' }] } }),
    'POST /v1/nano-banana': () => ({ body: { code: 0, data: { id: 'task-c' } } }),
  })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'k' }
  assert.deepEqual(await gaorui.test(cfg), { ok: true }, 'no model count: the upstream list creates nothing')
  assert.equal(up.calls[0].headers.authorization, 'Bearer k')
  assert.equal(gaorui.listModels, undefined, 'a vendor has a catalog, not a discovery call')
  // The chat models are stated in the catalog too; what the upstream lists ("gpt-4o-mini") adds nothing.
  assert.deepEqual(gaorui.catalog.filter((m) => m.kind === 'chat').map((m) => [m.id, m.acceptsImage, m.acceptsVideo]), [
    ['deepseek-v4-pro', false, false], ['gpt-5.5', false, false], ['glm-5.3', false, false], ['gpt-6-astra', true, false], ['gemini-3.5-flash-c', true, true],
  ])

  // Not in the catalog = a custom model. The kind comes with the run, not from the name.
  const custom = { model: 'my-video-chat-thing', prompt: 'a cat', imageUrls: [], params: {}, media, signal }
  assert.deepEqual(await gaorui.submit(cfg, { ...custom, kind: 'image' }), { externalId: 'task-c' })
  assert.equal(up.calls.at(-1).body.model, 'my-video-chat-thing')
  await assert.rejects(gaorui.submit(cfg, { ...custom, kind: 'video' }), (e) => e.i18n.code === 'provider.model_not_supported')
  assert.deepEqual(gaorui.customKinds, ['image', 'chat'])
})

test('gaorui chat: a video goes in as an image_url part with a public URL, after the text and before the images', async (t) => {
  const up = await fakeUpstream({ 'POST /v1/chat/completions': () => ({ body: { choices: [{ message: { content: 'seen' } }] } }) })
  t.after(up.close)
  const cfg = { baseUrl: `${up.baseUrl}/v1`, apiKey: 'sk-g' }
  const req = { model: 'gemini-3.5-flash-c', prompt: 'what happens?', imageUrls: [], media, signal }

  // What the main site sends in production: [text, image_url(video)].
  assert.equal((await gaorui.chat(cfg, { ...req, videoUrl: '/files/clip.mp4' })).text, 'seen')
  assert.equal(up.calls[0].path, '/v1/chat/completions')
  assert.equal(up.calls[0].headers.authorization, 'Bearer sk-g')
  assert.deepEqual(up.calls[0].body, {
    model: 'gemini-3.5-flash-c',
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'what happens?' },
      { type: 'image_url', image_url: { url: 'public(/files/clip.mp4)' } },
    ] }],
    stream: false,
  })
  // With reference images: the video stays right after the text, images follow.
  await gaorui.chat(cfg, { ...req, model: 'my-custom-chat', systemPrompt: 'be brief', videoUrl: '/files/clip.mp4', imageUrls: ['/files/a.png', '/files/b.png'] })
  assert.deepEqual(up.calls[1].body.messages, [
    { role: 'system', content: 'be brief' },
    { role: 'user', content: [
      { type: 'text', text: 'what happens?' },
      { type: 'image_url', image_url: { url: 'public(/files/clip.mp4)' } },
      { type: 'image_url', image_url: { url: 'ref(/files/a.png)' } },
      { type: 'image_url', image_url: { url: 'ref(/files/b.png)' } },
    ] },
  ])
  // No video_url part anywhere: the relay drops it without an error.
  assert.equal(JSON.stringify(up.calls.map((c) => c.body)).includes('video_url'), false)
  // No prompt: the video is the only part.
  await gaorui.chat(cfg, { ...req, prompt: '', videoUrl: '/files/clip.mp4' })
  assert.deepEqual(up.calls[2].body.messages[0].content, [{ type: 'image_url', image_url: { url: 'public(/files/clip.mp4)' } }])

  // A video that has no public address is refused before anything is sent.
  const local = { ...media, async toPublicUrl() { const e = new Error('needs a public URL'); e.code = 'media.needs_public_url'; throw e } }
  await assert.rejects(gaorui.chat(cfg, { ...req, videoUrl: '/files/clip.mp4', media: local }), (e) => e.code === 'media.needs_public_url')
  assert.equal(up.calls.length, 3)

  // The shared helper itself refuses a video unless the vendor says how its upstream takes one.
  const { chatCompletion } = require('../src/providers/openaiShared')
  await assert.rejects(chatCompletion(cfg, { ...req, videoUrl: '/files/clip.mp4' }), (e) => e.i18n.code === 'model.no_video_input')
  assert.equal(up.calls.length, 3)
})

test('openai: chat with vision parts, images as url and b64_json, reference images through /images/edits', async (t) => {
  const up = await fakeUpstream({
    'POST /v1/chat/completions': () => ({ body: { choices: [{ message: { content: 'hello there' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } } }),
    'POST /v1/images/generations': (c) => ({ body: { data: c.body.model === 'b64' ? [{ b64_json: 'QUJD' }] : [{ url: 'https://img.example/1.png' }, { url: 'https://img.example/2.png' }] } }),
    'POST /v1/images/edits': () => ({ body: { data: [{ b64_json: 'RURJVA==' }] } }),
    'GET /v1/models': () => ({ body: { data: [{ id: 'gpt-4o' }, { id: 'gpt-image-1' }, { id: 'text-embedding-3-small' }] } }),
  })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'sk-o' }

  const out = await openai.chat(cfg, { model: 'gpt-4o', prompt: 'describe', systemPrompt: 'be brief', imageUrls: ['/files/x.png'], media, signal })
  assert.deepEqual(out, { text: 'hello there', usage: { inputTokens: 12, outputTokens: 3 } })
  assert.equal(up.calls[0].headers.authorization, 'Bearer sk-o')
  assert.deepEqual(up.calls[0].body, {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: [{ type: 'text', text: 'describe' }, { type: 'image_url', image_url: { url: 'ref(/files/x.png)' } }] },
    ],
    stream: false,
  })
  await openai.chat(cfg, { model: 'gpt-4o', prompt: 'plain', imageUrls: [], media, signal })
  assert.deepEqual(up.calls[1].body.messages, [{ role: 'user', content: 'plain' }])

  const urls = await openai.submit(cfg, { kind: 'image', model: 'gpt-image-1', prompt: 'a dog', params: { aspectRatio: '3:2', count: 2 }, media, signal })
  assert.deepEqual(urls.outputs, [{ type: 'image', url: 'https://img.example/1.png' }, { type: 'image', url: 'https://img.example/2.png' }])
  assert.deepEqual(up.calls[2].body, { model: 'gpt-image-1', prompt: 'a dog', n: 2, size: '1536x1024' })

  const b64 = await openai.submit(cfg, { kind: 'image', model: 'b64', prompt: 'a dog', params: { aspectRatio: 'auto' }, media, signal })
  assert.deepEqual(b64.outputs, [{ type: 'image', b64: 'QUJD' }])
  assert.equal('size' in up.calls[3].body, false)

  // Reference images: the official edit endpoint, multipart, one image[] part per picture.
  const edited = await openai.submit(cfg, {
    kind: 'image', model: 'gpt-image-1', prompt: 'make it night', imageUrls: ['a.png', 'b.png', 'c.png'],
    params: { aspectRatio: '1:1', count: 1 }, spec: { maxReferenceImages: 2 }, media, signal,
  })
  assert.deepEqual(edited.outputs, [{ type: 'image', b64: 'RURJVA==' }])
  const edit = up.calls[4]
  assert.equal(edit.path, '/v1/images/edits')
  assert.match(edit.headers['content-type'], /^multipart\/form-data; boundary=/)
  assert.equal(edit.headers.authorization, 'Bearer sk-o')
  assert.equal(edit.body.split('name="image[]"').length - 1, 2, 'capped at the model limit')
  for (const [name, value] of [['model', 'gpt-image-1'], ['prompt', 'make it night'], ['n', '1'], ['size', '1024x1024']]) {
    assert.match(edit.body, new RegExp(`name="${name}"\\r\\n\\r\\n${value}\\r\\n`), name)
  }
  assert.ok(edit.body.includes('filename="image-1.png"') && edit.body.includes('Content-Type: image/png'))

  // Official API only: no video part is ever sent.
  await assert.rejects(openai.chat(cfg, { model: 'gpt-4o', prompt: 'watch', videoUrl: 'https://v.example/a.mp4', imageUrls: [], media, signal }), (e) => e.i18n.code === 'model.no_video_input')

  // The list endpoint proves the key and nothing else.
  assert.deepEqual(await openai.test(cfg), { ok: true })
  assert.equal(openai.listModels, undefined)
  assert.equal(openai.defaultBaseUrl, 'https://api.openai.com/v1')
  assert.deepEqual(openai.customKinds, ['image', 'chat'], 'no video through the official API here')
  assert.equal(openai.sync, true)
})

test('gemini: request shape and every accepted result form', async (t) => {
  let reply = {}
  const up = await fakeUpstream({ 'POST /v1beta/models/gemini-2.5-flash-image:generateContent': () => ({ body: reply }) })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'g-key' }
  const run = { kind: 'image', model: 'gemini-2.5-flash-image', prompt: 'a fox', imageUrls: ['ref.png'], params: { aspectRatio: '16:9' }, media, signal }

  reply = { candidates: [{ content: { parts: [{ text: 'here you go' }, { inlineData: { mimeType: 'image/png', data: 'QUJD' } }] } }] }
  assert.deepEqual((await gemini.submit(cfg, run)).outputs, [{ type: 'image', b64: 'QUJD', mime: 'image/png' }])
  assert.equal(up.calls[0].headers['x-goog-api-key'], 'g-key')
  assert.equal(up.calls[0].path.includes('g-key'), false, 'the key is not put in the URL')
  assert.deepEqual(up.calls[0].body, {
    contents: [{ role: 'user', parts: [{ text: 'a fox' }, { inlineData: { mimeType: 'image/png', data: Buffer.from('ref.png').toString('base64') } }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '16:9' } },
  })

  reply = { candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'WFla' } }] } }] }
  assert.deepEqual((await gemini.submit(cfg, run)).outputs, [{ type: 'image', b64: 'WFla', mime: 'image/jpeg' }])

  reply = { candidates: [{ content: { parts: [{ fileData: { fileUri: 'https://files.example/abc', mimeType: 'image/png' } }] } }] }
  assert.deepEqual((await gemini.submit(cfg, run)).outputs, [{ type: 'image', url: 'https://files.example/abc' }])

  reply = { candidates: [{ content: { parts: [{ text: 'Done: ![image](https://cdn.example/out/1.png) enjoy' }] } }] }
  assert.deepEqual((await gemini.submit(cfg, run)).outputs, [{ type: 'image', url: 'https://cdn.example/out/1.png' }])

  reply = { candidates: [{ content: { parts: [{ text: 'see https://cdn.example/out/2.webp?x=1 and https://example.com/docs' }] } }] }
  assert.deepEqual((await gemini.submit(cfg, run)).outputs, [{ type: 'image', url: 'https://cdn.example/out/2.webp?x=1' }], 'only links that look like images')

  reply = { candidates: [{ content: { parts: [{ text: 'I cannot do that.' }] } }] }
  await assert.rejects(gemini.submit(cfg, run), (e) => e.i18n.code === 'upstream.text_only')
  reply = { promptFeedback: { blockReason: 'SAFETY' } }
  await assert.rejects(gemini.submit(cfg, run), /SAFETY/)

  // "auto" sends no imageConfig at all.
  reply = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'QQ==' } }] } }] }
  await gemini.submit(cfg, { ...run, imageUrls: [], params: { aspectRatio: 'auto' } })
  assert.deepEqual(up.calls.at(-1).body.generationConfig, { responseModalities: ['TEXT', 'IMAGE'] })

  // The number of reference images sent follows the model's declared limit.
  await gemini.submit(cfg, { ...run, imageUrls: ['1', '2', '3', '4'], spec: { maxReferenceImages: 3 } })
  assert.equal(up.calls.at(-1).body.contents[0].parts.length, 1 + 3)
  assert.equal(gemini.listModels, undefined)
  assert.deepEqual(gemini.customKinds, ['image', 'chat'])
})

test('helpers: the old free-text model list (migration only) and base URL normalisation', () => {
  assert.deepEqual(parseModelList(' a, b\nc，d ;a  '), ['a', 'b', 'c', 'd'])
  assert.deepEqual(parseModelList('ok-model, bad model!, <script>'), ['ok-model', 'bad', 'model!'].filter((x) => /^[\w.:/@-]+$/.test(x)))
  assert.deepEqual(parseModelList(''), [])
  assert.equal(openaiBase('https://api.example.com/'), 'https://api.example.com/v1')
  assert.equal(openaiBase('https://api.example.com/v1/'), 'https://api.example.com/v1')
  assert.equal(openaiBase('https://host/api/v3'), 'https://host/api/v3')
})
