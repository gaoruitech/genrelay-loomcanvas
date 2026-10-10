'use strict'

/**
 * End-to-end over real HTTP: the Express app, MongoDB, local storage, the
 * runner and a fake upstream speaking the gaorui protocols.
 *
 * Needs a MongoDB: set TEST_MONGODB_URI, otherwise mongodb-memory-server is
 * tried, and the whole file is skipped when neither is available.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const os = require('os')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const sharp = require('sharp')
const zh = require('../src/i18n/zh-CN')
const en = require('../src/i18n/en')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomcanvas-e2e-'))
process.env.SECRET_KEY = 'e2e-test-secret-key-0123456789'
process.env.ACCESS_PASSWORD = 'correct horse'
process.env.STORAGE_DRIVER = 'local'
process.env.STORAGE_LOCAL_DIR = tmpDir
process.env.PUBLIC_URL = ''
process.env.WEB_DIST = ''
process.env.BILLING_HOOK = ''

async function findMongo() {
  if (process.env.TEST_MONGODB_URI) return { uri: process.env.TEST_MONGODB_URI, stop: async () => {} }
  try {
    const { MongoMemoryServer } = require('mongodb-memory-server')
    const server = await MongoMemoryServer.create()
    return { uri: server.getUri(), stop: () => server.stop() }
  } catch {
    return null
  }
}

/** Fake upstream: nano-banana, /v1/videos, chat and model list. */
async function startUpstream(png) {
  const state = { calls: [], imagePolls: 0, slow: false }
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = req.url.split('?')[0]
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : null
      state.calls.push({ method: req.method, url, auth: req.headers.authorization || '', body })
      const base = `http://127.0.0.1:${server.address().port}`
      const json = (obj, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }

      if (req.method === 'GET' && url === '/v1/models') return json({ data: [{ id: 'chat-small' }, { id: 'nano-banana-2' }] })
      if (req.method === 'POST' && url === '/v1/nano-banana') {
        if (req.headers.authorization !== 'sk-e2e-key-abcdef123456') return json({ code: 401, msg: 'bad key' })
        return json({ code: 0, data: { id: body.prompt === 'slow' ? 'img-slow' : 'img-1' } })
      }
      if (req.method === 'GET' && url === '/v1/nano-banana/img-1') {
        state.imagePolls++
        return json({ code: 0, data: { status: 'completed', progress: 100, image_url: `${base}/cdn/result.png` } })
      }
      if (req.method === 'GET' && url === '/v1/nano-banana/img-slow') return json({ code: 0, data: { status: 'running', progress: 20 } })
      if (req.method === 'POST' && url === '/v1/videos') return json({ id: 'vid-1', status: 'queued' })
      if (req.method === 'GET' && url === '/v1/videos/vid-1') return json({ id: 'vid-1', status: 'completed' })
      if (req.method === 'GET' && url === '/v1/videos/vid-1/content') {
        if (req.headers.authorization !== 'Bearer sk-e2e-key-abcdef123456') { res.statusCode = 401; return res.end('no') }
        res.setHeader('Content-Type', 'application/octet-stream')
        return res.end(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(64)]))
      }
      if (req.method === 'POST' && url === '/v1/chat/completions') {
        return json({ choices: [{ message: { content: `echo: ${JSON.stringify(body.messages.at(-1).content).slice(0, 40)}` } }], usage: { prompt_tokens: 1000, completion_tokens: 1000 } })
      }
      if (req.method === 'GET' && url === '/cdn/result.png') { res.setHeader('Content-Type', 'image/png'); return res.end(png) }
      if (req.method === 'GET' && url === '/cdn/page.html') { res.setHeader('Content-Type', 'image/png'); return res.end('<html><script>alert(1)</script></html>') }
      json({ error: { message: 'not found' } }, 404)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { state, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close() } }
}

test('LoomCanvas API end to end', async (t) => {
  const mongo = await findMongo()
  if (!mongo) return t.skip('no MongoDB available (set TEST_MONGODB_URI)')

  const mongoose = require('mongoose')
  const dbName = `loomcanvas_e2e_${crypto.randomBytes(4).toString('hex')}`
  const u = new URL(mongo.uri)
  u.pathname = `/${dbName}`
  await mongoose.connect(u.toString(), { serverSelectionTimeoutMS: 8000 })

  const png = await sharp({ create: { width: 1024, height: 768, channels: 3, background: '#2266aa' } }).png().toBuffer()
  const upstream = await startUpstream(png)

  const { setAllowedHosts } = require('../src/utils/safeFetch')
  setAllowedHosts(['127.0.0.1']) // what SSRF_ALLOW_HOSTS=127.0.0.1 does at boot
  const settings = require('../src/services/settings')
  await settings.load()
  await require('../src/services/seed').seed()
  const { getRunner } = require('../src/runner')
  await getRunner().start()
  const server = require('../src/app').createApp().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  t.after(async () => {
    await getRunner().shutdown()
    server.closeAllConnections()
    server.close()
    upstream.close()
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
    await mongo.stop()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  let token = ''
  /** JSON call; returns { status, body }. */
  async function call(method, pathname, body, { auth = true, raw = false, headers: extra = {} } = {}) {
    const headers = { ...extra }
    if (auth && token) headers.Authorization = `Bearer ${token}`
    let payload
    if (body instanceof FormData) payload = body
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(base + pathname, { method, headers, body: payload })
    if (raw) return res
    return { status: res.status, body: await res.json() }
  }
  const data = async (method, pathname, body) => {
    const r = await call(method, pathname, body)
    assert.equal(r.body.result, 0, `${method} ${pathname}: ${JSON.stringify(r.body).slice(0, 300)}`)
    return r.body.data
  }
  async function waitRun(pathname, timeoutMs = 20000) {
    const end = Date.now() + timeoutMs
    for (;;) {
      const run = await data('GET', pathname)
      if (['succeeded', 'failed', 'canceled'].includes(run.status)) return run
      if (Date.now() > end) throw new Error(`still ${run.status}: ${pathname}`)
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  await t.test('auth: everything but bootstrap/login/share-read needs a token', async () => {
    const boot = await call('GET', '/api/app/bootstrap')
    assert.deepEqual([boot.status, boot.body.data.authRequired, boot.body.data.authed, boot.body.data.hasProvider], [200, true, false, false])
    assert.deepEqual(boot.body.data.limits, { maxUploadMb: 50 })
    for (const [m, p] of [['GET', '/api/workflow/list'], ['GET', '/api/models'], ['GET', '/api/admin/providers'], ['GET', '/api/admin/settings'], ['GET', '/api/admin/storage'], ['POST', '/api/admin/storage/test'], ['POST', '/api/runs'], ['POST', '/api/files/fetch'], ['GET', '/api/canvas-share/mine'], ['GET', '/api/brand-kits']]) {
      const r = await call(m, p, m === 'POST' ? {} : undefined)
      assert.equal(r.status, 401, `${m} ${p}`)
      assert.notEqual(r.body.result, 0)
    }
    assert.equal((await call('POST', '/api/auth/login', { password: 'wrong' })).status, 401)
    assert.equal((await call('POST', '/api/auth/login', {})).status, 400)
    const ok = await call('POST', '/api/auth/login', { password: 'correct horse' })
    assert.equal(ok.status, 200)
    token = ok.body.data.token
    assert.equal((await call('GET', '/api/app/bootstrap')).body.data.authed, true)

    // A forged or foreign-signed token is not accepted.
    const forged = require('jsonwebtoken').sign({ sub: 'local' }, 'some-other-key')
    const res = await fetch(base + '/api/workflow/list', { headers: { Authorization: `Bearer ${forged}` } })
    assert.equal(res.status, 401)
  })

  let providerId = ''
  await t.test('providers: key is encrypted at rest and never returned', async () => {
    const created = await data('POST', '/api/admin/providers', { type: 'gaorui', name: 'Fake', baseUrl: upstream.baseUrl, apiKey: 'sk-e2e-key-abcdef123456', enabled: true })
    providerId = created.id
    assert.deepEqual([created.hasKey, created.keyTail, created.slug], [true, '3456', 'gaorui'])
    const listed = await call('GET', '/api/admin/providers')
    assert.ok(!JSON.stringify([created, listed.body]).includes('sk-e2e-key'))
    const stored = await mongoose.connection.collection('providers').findOne({})
    assert.ok(stored.apiKeyEnc.startsWith('v1.') && !JSON.stringify(stored).includes('sk-e2e-key'))

    // Updating other fields with a blank key keeps the stored key.
    const updated = await data('PUT', `/api/admin/providers/${providerId}`, { name: 'Fake upstream', apiKey: '' })
    assert.deepEqual([updated.name, updated.hasKey, updated.keyTail], ['Fake upstream', true, '3456'])
    assert.deepEqual(await data('POST', `/api/admin/providers/${providerId}/test`), { ok: true, message: zh['provider.test_ok'] })
    assert.equal((await call('GET', '/api/app/bootstrap')).body.data.hasProvider, true)
  })

  await t.test('models: catalog + a custom chat model, overrides, estimate', async () => {
    // The upstream's /v1/models names "chat-small"; that alone creates nothing.
    const GAORUI_CHAT = ['gaorui:deepseek-v4-pro', 'gaorui:gpt-5.5', 'gaorui:glm-5.3', 'gaorui:gpt-6-astra', 'gaorui:gemini-3.5-flash-c']
    assert.deepEqual((await data('GET', '/api/models?kind=chat')).map((m) => m.id), GAORUI_CHAT, 'the catalog chat models, and nothing from the upstream list')
    const withCustom = await data('POST', `/api/admin/providers/${providerId}/models`, { model: 'chat-small', kind: 'chat' })
    assert.deepEqual(withCustom.customModels, [{ model: 'chat-small', kind: 'chat', label: '' }])
    const models = await data('GET', '/api/models')
    const ids = models.map((m) => m.id)
    assert.ok(ids.includes('gaorui:nano-banana-2.1') && ids.includes('gaorui:chat-small'))
    assert.equal(models.find((m) => m.id === 'gaorui:chat-small').kind, 'chat')
    assert.deepEqual(models.find((m) => m.id === 'gaorui:omni-flash').options.imgModes, ['multi', 'frames'])
    assert.deepEqual((await data('GET', '/api/models?kind=chat')).map((m) => m.id), [...GAORUI_CHAT, 'gaorui:chat-small'])

    assert.deepEqual(await data('POST', '/api/runs/estimate', { model: 'gaorui:nano-banana-2.1', params: { resolution: '2K' }, count: 2 }), { unitCost: 0, totalCost: 0, currency: '', unknown: true })
    assert.equal((await data('POST', '/api/runs/estimate', { model: 'gaorui:chat-small', count: 1 })).unknown, true)

    const id = encodeURIComponent('gaorui:nano-banana-2.1')
    await data('PUT', `/api/admin/models/${id}`, { pricing: { currency: 'CNY', unit: 'per_image', by: 'resolution', table: { '1K': 0.1, '2K': 0.2 } } })
    assert.deepEqual(await data('POST', '/api/runs/estimate', { model: 'gaorui:nano-banana-2.1', params: { resolution: '2K' }, count: 2 }), { unitCost: 0.2, totalCost: 0.4, currency: 'CNY', unknown: false })
    await data('PUT', `/api/admin/models/${encodeURIComponent('gaorui:omni-flash')}`, { pricing: { currency: 'CNY', unit: 'per_video', by: 'resolution_duration', table: { '720p:6': 3 } } })
    assert.equal((await data('POST', '/api/runs/estimate', { model: 'gaorui:omni-flash', params: { resolution: '720p', duration: 6, imgMode: 'frames' } })).totalCost, 3)
    await data('PUT', `/api/admin/models/${encodeURIComponent('gaorui:chat-small')}`, { pricing: { currency: 'USD', unit: 'per_1m_tokens', table: { input: 1, output: 3 } } })

    await data('PUT', `/api/admin/models/${encodeURIComponent('gaorui:nano-banana-pro')}`, { enabled: false })
    assert.ok(!(await data('GET', '/api/models')).some((m) => m.id === 'gaorui:nano-banana-pro'))
    const admin = await data('GET', '/api/admin/models')
    assert.equal(admin.find((m) => m.id === 'gaorui:nano-banana-pro').enabled, false)
    assert.equal((await call('POST', '/api/runs', { model: 'gaorui:nano-banana-pro', prompt: 'x' })).status, 400)
    // pricing: null clears the override.
    await data('PUT', `/api/admin/models/${encodeURIComponent('gaorui:omni-flash')}`, { pricing: null })
    assert.equal((await data('POST', '/api/runs/estimate', { model: 'gaorui:omni-flash', params: {} })).unknown, true)
  })

  let uploaded
  await t.test('files: upload sniffs the type, makes a thumbnail, serves with ranges', async () => {
    const form = new FormData()
    form.append('file', new Blob([png]), '../../etc/passwd.html')
    uploaded = await data('POST', '/api/files/upload', form)
    assert.match(uploaded.key, /^uploads\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/)
    assert.deepEqual([uploaded.mime, uploaded.width, uploaded.height, uploaded.size], ['image/png', 1024, 768, png.length])
    // The thumbnail URL is derived from the image's own key.
    assert.equal(uploaded.thumbnailUrl, `/files/thumbs/of/${uploaded.key.replace(/\.png$/, '_png.webp')}`)

    const bad = new FormData()
    bad.append('file', new Blob(['<html><script>alert(1)</script>'], { type: 'image/png' }), 'x.png')
    assert.equal((await call('POST', '/api/files/upload', bad)).status, 400)

    // Public, typed from the key, sandboxed, range-capable.
    const res = await fetch(base + uploaded.url, { headers: { Range: 'bytes=0-7' } })
    assert.equal(res.status, 206)
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.match(res.headers.get('content-security-policy'), /sandbox/)
    assert.equal((await res.arrayBuffer()).byteLength, 8)
    assert.equal((await fetch(base + '/files/uploads/2025/01/' + '0'.repeat(32) + '.png')).status, 404)

    // Derived thumbnails are generated on first request when the file is not there
    // (deleted, or the image was stored before it had one), then served from disk.
    const thumbFile = path.join(tmpDir, uploaded.thumbnailUrl.slice('/files/'.length))
    fs.rmSync(thumbFile)
    const lazy = await fetch(base + uploaded.thumbnailUrl)
    assert.deepEqual([lazy.status, lazy.headers.get('content-type')], [200, 'image/webp'])
    const lazyMeta = await sharp(Buffer.from(await lazy.arrayBuffer())).metadata()
    assert.deepEqual([lazyMeta.format, lazyMeta.width, lazyMeta.height], ['webp', 512, 384])
    assert.ok(fs.existsSync(thumbFile), 'cached on disk')
    // No source image: 404. Keys that are not derived thumbnails are never generated.
    assert.equal((await fetch(base + '/files/thumbs/of/uploads/2025/01/' + '0'.repeat(32) + '_png.webp')).status, 404)
    assert.equal((await fetch(base + '/files/thumbs/of/thumbs/of/' + uploaded.key.replace(/\.png$/, '_png_webp.webp'))).status, 404)
    assert.equal((await fetch(base + '/files/thumbs/of/' + uploaded.key.replace(/\.png$/, '_mp4.webp'))).status, 404)

    // Remote fetch: guarded, and the payload must really be an image.
    assert.equal((await call('POST', '/api/files/fetch', { url: 'http://169.254.169.254/latest/meta-data' })).status, 400)
    assert.equal((await call('POST', '/api/files/fetch', { url: 'http://localhost:1/x.png' })).status, 400)
    assert.equal((await call('POST', '/api/files/fetch', { url: `${upstream.baseUrl}/cdn/page.html` })).status, 400)
    const fetched = await data('POST', '/api/files/fetch', { url: `${upstream.baseUrl}/cdn/result.png` })
    assert.deepEqual([fetched.mime, fetched.width], ['image/png', 1024])
  })

  let workflowId = ''
  await t.test('workflow: CRUD, rename without touching nodes, download proxy, zip', async () => {
    const node = { id: 'i1', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: uploaded.url, status: 'done' } }
    const created = await data('POST', '/api/workflow', { name: '画布', nodes: [node], edges: [], settings: { bg: { color: '#111', pattern: 'dots' } } })
    workflowId = created.id
    assert.deepEqual([created.thumbnail, created.thumbnailType, created.schemaVersion], [uploaded.url, 'image', 1])

    const renamed = await data('PUT', `/api/workflow/${workflowId}`, { name: '新名字' })
    assert.equal(renamed.name, '新名字')
    assert.deepEqual(renamed.nodes, [node])
    assert.deepEqual(renamed.settings, { bg: { color: '#111', pattern: 'dots' } })
    assert.ok(renamed.updatedAt)
    const saved = await data('PUT', `/api/workflow/${workflowId}`, { settings: { bg: { color: '#fff' } } })
    assert.deepEqual(saved.settings, { bg: { color: '#fff' } })
    assert.equal((await data('GET', `/api/workflow/${workflowId}`)).settings.bg.color, '#fff')

    for (const bad of [{ name: '' }, { nodes: 'x' }, { nodes: Array(501).fill({}) }, { nodes: [1] }, { viewport: 5 }]) {
      assert.equal((await call('PUT', `/api/workflow/${workflowId}`, bad)).status, 400, JSON.stringify(bad).slice(0, 30))
    }
    assert.equal((await call('GET', '/api/workflow/zzz')).status, 400)
    assert.equal((await call('GET', '/api/workflow/' + '0'.repeat(24))).status, 404)

    const dup = await data('POST', `/api/workflow/${workflowId}/duplicate`)
    assert.equal(dup.name, zh['canvas.copy_name'].replace('{name}', '新名字'))
    await data('DELETE', `/api/workflow/${dup.id}`)
    assert.equal((await data('GET', '/api/workflow/list')).length, 1)

    const dl = await call('POST', '/api/workflow/download', { url: uploaded.url, filename: '成品.png' }, { raw: true })
    assert.equal(dl.status, 200)
    assert.equal(dl.headers.get('content-type'), 'image/png')
    assert.match(dl.headers.get('content-disposition'), /^attachment;/)
    assert.equal((await dl.arrayBuffer()).byteLength, png.length)
    assert.equal((await call('POST', '/api/workflow/download', { url: 'http://127.0.0.2/secret', filename: 'x' })).status, 400)
    assert.equal((await call('POST', '/api/workflow/download', { url: `${upstream.baseUrl}/cdn/page.html`, filename: 'x' })).status, 400)

    const zip = await call('POST', `/api/workflow/${workflowId}/download-zip`, {}, { raw: true })
    assert.equal(zip.headers.get('content-type'), 'application/zip')
    const bytes = Buffer.from(await zip.arrayBuffer())
    assert.equal(bytes.subarray(0, 2).toString(), 'PK')
    assert.ok(bytes.includes(png.subarray(0, 64)), 'stored uncompressed, so the image bytes are in the archive')
    // urls only narrows the canvas content; an address not on the canvas yields nothing.
    assert.equal((await call('POST', `/api/workflow/${workflowId}/download-zip`, { urls: ['http://169.254.169.254/'] })).status, 404)
  })

  await t.test('image run: submit, poll, transfer into storage, thumbnail, cost, usage', async () => {
    const { runId } = await data('POST', '/api/runs', { model: 'gaorui:nano-banana-2.1', prompt: 'a cat', imageUrls: [uploaded.url], params: { resolution: '2K', aspectRatio: 'auto' }, workflowId, nodeId: 'n1' })
    const run = await waitRun(`/api/runs/${runId}`)
    assert.equal(run.status, 'succeeded', run.error)
    assert.deepEqual([run.progress, run.kind, run.model], [100, 'image', 'gaorui:nano-banana-2.1'])
    assert.deepEqual(run.cost, { amount: 0.2, currency: 'CNY', unknown: false })
    assert.equal(run.outputs.length, 1)
    const out = run.outputs[0]
    assert.match(out.url, /^\/files\/outputs\/.+\.png$/, 'copied into our storage, not left at the upstream')
    assert.match(out.thumbnailUrl, /^\/files\/thumbs\/.+\.webp$/)
    const stored = Buffer.from(await (await fetch(base + out.url)).arrayBuffer())
    assert.ok(stored.equals(png))
    const thumb = await sharp(Buffer.from(await (await fetch(base + out.thumbnailUrl)).arrayBuffer())).metadata()
    assert.deepEqual([thumb.format, thumb.width, thumb.height], ['webp', 512, 384])

    // What the upstream received: raw key, and the local reference image inlined as a data URI.
    const submit = upstream.state.calls.find((c) => c.method === 'POST' && c.url === '/v1/nano-banana')
    assert.equal(submit.auth, 'sk-e2e-key-abcdef123456')
    assert.deepEqual([submit.body.model, submit.body.imageSize, 'aspectRatio' in submit.body], ['nano-banana-2.1', '2K', false])
    assert.match(submit.body.images[0], /^data:image\/png;base64,/)

    const batch = await data('POST', '/api/runs/status', { ids: [runId, 'junk', '0'.repeat(24)] })
    assert.deepEqual(batch.map((r) => r.id), [runId])
    assert.ok(!JSON.stringify(run).includes('sk-e2e'))
  })

  await t.test('video run: no direct link, falls back to the authenticated content endpoint', async () => {
    const { runId } = await data('POST', '/api/runs', { model: 'gaorui:omni-flash', prompt: 'pan left', params: { duration: 8, resolution: '720p', aspectRatio: '9:16' } })
    const run = await waitRun(`/api/runs/${runId}`)
    assert.equal(run.status, 'succeeded', run.error)
    assert.equal(run.outputs[0].type, 'video')
    assert.match(run.outputs[0].url, /^\/files\/outputs\/.+\.mp4$/)
    const body = upstream.state.calls.find((c) => c.method === 'POST' && c.url === '/v1/videos')
    assert.equal(body.auth, 'Bearer sk-e2e-key-abcdef123456')
    assert.deepEqual(body.body, { model: 'omni_flash_8s', prompt: 'pan left', resolution: '720p', aspect_ratio: '9:16' })
    const res = await fetch(base + run.outputs[0].url)
    assert.equal(res.headers.get('content-type'), 'video/mp4')
  })

  await t.test('cancel an in-flight run', async () => {
    const { runId } = await data('POST', '/api/runs', { model: 'gaorui:nano-banana-2', prompt: 'slow' })
    await new Promise((r) => setTimeout(r, 300))
    const canceled = await data('POST', `/api/runs/${runId}/cancel`)
    assert.equal(canceled.status, 'canceled')
    assert.equal((await data('GET', `/api/runs/${runId}`)).status, 'canceled')
    assert.equal((await call('POST', `/api/runs/${'0'.repeat(24)}/cancel`)).status, 404)
  })

  await t.test('failed run carries a user-facing reason; validation errors are 400, never 401', async () => {
    await data('PUT', `/api/admin/providers/${providerId}`, { apiKey: 'sk-wrong-key-000000000000' })
    const { runId } = await data('POST', '/api/runs', { model: 'gaorui:nano-banana-2', prompt: 'x' })
    const run = await waitRun(`/api/runs/${runId}`)
    assert.equal(run.status, 'failed')
    assert.match(run.error, /bad key/)
    // The reason is stored as a message code, so each reader gets it in their own language;
    // the upstream's own words ("bad key") are passed through untranslated.
    assert.equal(run.errorCode, 'upstream.submit_failed_detail')
    const inLocale = async (locale) => (await call('GET', `/api/runs/${runId}`, undefined, { headers: { 'X-Locale': locale } })).body.data.error
    assert.equal(await inLocale('en'), en['upstream.submit_failed_detail'].replace('{detail}', 'bad key'))
    assert.equal(await inLocale('zh-CN'), zh['upstream.submit_failed_detail'].replace('{detail}', 'bad key'))
    const batch = await call('POST', '/api/runs/status', { ids: [runId] }, { headers: { 'X-Locale': 'en' } })
    assert.equal(batch.body.data[0].error, await inLocale('en'))
    const records = await call('GET', '/api/admin/usage/records?status=failed', undefined, { headers: { 'X-Locale': 'en' } })
    assert.equal(records.body.data.list.find((r) => r.id === runId).error, await inLocale('en'))
    // A record written before message codes existed still shows the text it has.
    await mongoose.connection.collection('runs').updateOne({ _id: new mongoose.Types.ObjectId(runId) }, { $set: { error: '旧版本写下的原因' }, $unset: { errorCode: '', errorParams: '' } })
    assert.equal(await inLocale('en'), '旧版本写下的原因')
    await data('PUT', `/api/admin/providers/${providerId}`, { apiKey: 'sk-e2e-key-abcdef123456' })

    for (const body of [{}, { model: 'nope' }, { model: 'ghost:model', prompt: 'x' }, { model: 'gaorui:nano-banana-2', prompt: 5 }, { model: 'gaorui:nano-banana-2', imageUrls: ['data:image/png;base64,AAAA'] }, { model: 'gaorui:nano-banana-2', params: [] }, { model: 'gaorui:chat-small', prompt: 'x' }]) {
      assert.equal((await call('POST', '/api/runs', body)).status, 400, JSON.stringify(body))
    }
    assert.equal((await call('GET', '/api/runs/not-an-id')).status, 400)
  })

  await t.test('llm task: chat model, token cost from usage', async () => {
    const { taskId } = await data('POST', '/api/llm/tasks', { model: 'gaorui:chat-small', prompt: 'describe', systemPrompt: 'short', imageUrls: [uploaded.url] })
    const task = await waitRun(`/api/llm/tasks/${taskId}`)
    assert.equal(task.status, 'succeeded', task.error)
    assert.match(task.text, /^echo: /)
    assert.equal(task.progress, 100)
    assert.deepEqual(task.cost, { amount: 0.004, currency: 'USD', unknown: false })
    const sent = upstream.state.calls.find((c) => c.url === '/v1/chat/completions')
    assert.equal(sent.auth, 'Bearer sk-e2e-key-abcdef123456')
    assert.deepEqual(sent.body.messages[0], { role: 'system', content: 'short' })
    assert.equal(sent.body.messages[1].content[1].type, 'image_url')
    // A chat task is not readable as a media run and vice versa.
    assert.equal((await call('GET', `/api/runs/${taskId}`)).status, 404)
    assert.equal((await call('POST', '/api/llm/tasks', { model: 'gaorui:nano-banana-2', prompt: 'x' })).status, 400)
  })

  await t.test('usage: summary by day and by model, records', async () => {
    const byModel = await data('GET', '/api/admin/usage?groupBy=model')
    const nb = byModel.items.find((r) => r.key === 'gaorui:nano-banana-2.1')
    assert.deepEqual([nb.runs, nb.succeeded, nb.failed, nb.amount, nb.currency, nb.unknownCount], [1, 1, 0, 0.2, 'CNY', 0])
    const nb2 = byModel.items.find((r) => r.key === 'gaorui:nano-banana-2')
    assert.deepEqual([nb2.runs, nb2.failed, nb2.canceled, nb2.amount], [2, 1, 1, 0])
    assert.equal(byModel.items.find((r) => r.key === 'gaorui:omni-flash').unknownCount, 1)

    const today = new Date().toISOString().slice(0, 10)
    const byDay = await data('GET', `/api/admin/usage?groupBy=day&from=${today}&to=${today}`)
    assert.deepEqual(byDay.items.map((r) => [r.key, r.runs]), [[today, 5]])
    assert.deepEqual((await data('GET', '/api/admin/usage?groupBy=day&from=2000-01-01&to=2000-01-02')).items, [])
    assert.equal((await call('GET', '/api/admin/usage?from=garbage')).status, 400)

    const records = await data('GET', '/api/admin/usage/records?page=1&pageSize=2')
    assert.deepEqual([records.total, records.page, records.pageSize, records.list.length], [5, 1, 2, 2])
    assert.deepEqual(Object.keys(records.list[0]).filter((k) => ['id', 'createdAt', 'model', 'kind', 'status', 'cost'].includes(k)).length, 6)
    assert.equal((await data('GET', '/api/admin/usage/records?pageSize=99999')).pageSize, 100)
  })

  await t.test('share links: public read by token, expiry, revoke, copy', async () => {
    const pub = await data('POST', '/api/canvas-share/publish', { workflowId, expiresInDays: 7 })
    assert.match(pub.token, /^[A-Za-z0-9_-]{43}$/)
    assert.ok(new Date(pub.expiresAt) > new Date())

    const read = await call('GET', `/api/canvas-share/${pub.token}`, undefined, { auth: false })
    assert.equal(read.status, 200)
    assert.equal(read.body.data.nodes[0].data.imageUrl, uploaded.url)
    assert.equal('status' in read.body.data.nodes[0].data, false, 'run-time state is stripped from the snapshot')
    assert.deepEqual(Object.keys(read.body.data).filter((k) => ['userId', 'workflowId', 'sourceWorkflowId', 'revoked'].includes(k)), [], 'owner-only fields stay private')
    // A snapshot stored before costs and run ids were stripped is cleaned when it is read.
    await mongoose.connection.collection('shares').updateOne({ token: pub.token }, { $set: { 'snapshot.nodes.0.data.cost': { amount: 9 }, 'snapshot.nodes.0.data.taskIds': ['x'] } })
    const legacy = (await call('GET', `/api/canvas-share/${pub.token}`, undefined, { auth: false })).body.data.nodes[0].data
    assert.deepEqual(['cost' in legacy, 'taskIds' in legacy, legacy.imageUrl], [false, false, uploaded.url])
    // The snapshot is independent of later edits.
    await data('PUT', `/api/workflow/${workflowId}`, { nodes: [] })
    assert.equal((await call('GET', `/api/canvas-share/${pub.token}`, undefined, { auth: false })).body.data.nodes.length, 1)

    // The database id is not a link, signed in or not; other owner endpoints need a token.
    assert.equal((await call('GET', `/api/canvas-share/${pub.id}`, undefined, { auth: false })).status, 404)
    assert.equal((await call('GET', `/api/canvas-share/${pub.id}`)).status, 404)
    assert.equal((await call('POST', `/api/canvas-share/${pub.id}/copy`)).status, 404)
    assert.equal((await call('POST', `/api/canvas-share/${pub.token}/copy`, undefined, { auth: false })).status, 401)
    assert.equal((await call('DELETE', `/api/canvas-share/${pub.id}`, undefined, { auth: false })).status, 401)

    const copy = await data('POST', `/api/canvas-share/${pub.token}/copy`)
    assert.equal((await data('GET', `/api/workflow/${copy.workflowId}`)).nodes.length, 1)

    // Expired.
    await mongoose.connection.collection('shares').updateOne({ token: pub.token }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
    assert.equal((await call('GET', `/api/canvas-share/${pub.token}`, undefined, { auth: false })).status, 404)
    let mine = (await data('GET', '/api/canvas-share/mine')).list
    assert.deepEqual([mine.length, mine[0].token, mine[0].workflowId, mine[0].revoked, mine[0].active], [1, pub.token, workflowId, false, false])

    // Publishing again revives the same link; revoking kills it for good.
    await data('PUT', `/api/workflow/${workflowId}`, { nodes: [{ id: 't', type: 'text', position: { x: 0, y: 0 }, data: { text: 'v2' } }] })
    const again = await data('POST', '/api/canvas-share/publish', { workflowId })
    assert.deepEqual([again.token, again.updated, again.expiresAt], [pub.token, true, null])
    assert.equal((await call('GET', `/api/canvas-share/${pub.token}`, undefined, { auth: false })).body.data.nodes[0].data.text, 'v2')

    await data('DELETE', `/api/canvas-share/${pub.id}`)
    assert.equal((await call('GET', `/api/canvas-share/${pub.token}`, undefined, { auth: false })).status, 404)
    mine = (await data('GET', '/api/canvas-share/mine')).list
    assert.deepEqual([mine.length, mine[0].revoked], [1, true], 'revoked links stay listed')
    const fresh = await data('POST', '/api/canvas-share/publish', { workflowId })
    assert.notEqual(fresh.token, pub.token, 'a revoked token is never reused')
    // Re-publishing: an explicit expiry replaces the old one, 0 means "never", omitting it keeps it.
    const dated = await data('POST', '/api/canvas-share/publish', { workflowId, expiresInDays: 7 })
    assert.equal(dated.token, fresh.token)
    assert.ok(new Date(dated.expiresAt).getTime() > Date.now())
    assert.equal((await data('POST', '/api/canvas-share/publish', { workflowId })).expiresAt, dated.expiresAt)
    assert.equal((await data('POST', '/api/canvas-share/publish', { workflowId, expiresInDays: 0 })).expiresAt, null)
    assert.equal((await call('POST', '/api/canvas-share/publish', { workflowId, expiresInDays: -1 })).status, 400)
  })

  await t.test('settings, templates, brand kits, assets, tools', async () => {
    const s = await data('GET', '/api/admin/settings')
    for (const k of ['siteName', 'logoUrl', 'defaultTheme', 'defaultLocale', 'concurrency', 'imageTimeoutMinutes', 'videoTimeoutMinutes', 'maxRetries', 'retentionDays']) assert.ok(k in s, k)
    const put = await data('PUT', '/api/admin/settings', { siteName: 'Mine', concurrency: 2, imageTimeoutMinutes: 5, maxRetries: 0 })
    assert.deepEqual([put.siteName, put.concurrency, put.imageTimeoutMinutes, put.maxRetries], ['Mine', 2, 5, 0])
    assert.equal(settings.runnerSettings().pollTimeoutMs.image, 300000)
    assert.equal((await call('GET', '/api/app/bootstrap', undefined, { auth: false })).body.data.site.name, 'Mine')
    assert.equal((await call('PUT', '/api/admin/settings', { concurrency: 0 })).status, 400)
    assert.equal((await call('PUT', '/api/admin/settings', { logoUrl: 'javascript:alert(1)' })).status, 400)

    const templates = await data('GET', '/api/canvas/templates')
    assert.ok(templates.length >= 1 && templates[0].graph.nodes.length >= 2 && templates[0].key && templates[0].title)
    for (const lang of ['zh', 'en']) {
      const texts = await data('GET', `/api/canvas/text-templates?lang=${lang}`)
      assert.ok(texts.length >= 3 && texts.every((x) => x.id && x.title && x.content && x.lang === lang))
    }

    const kit = await data('POST', '/api/brand-kits', { name: 'Kit', refImages: [uploaded.url, 'data:image/png;base64,AAAA'], promptPrefix: 'p', negativePrompt: 'n', isDefault: true })
    assert.deepEqual(kit.refImages, [uploaded.url])
    const kit2 = await data('POST', '/api/brand-kits', { name: 'Kit2', isDefault: true })
    const kits = await data('GET', '/api/brand-kits')
    assert.deepEqual(kits.filter((k) => k.isDefault).map((k) => k.id), [kit2.id], 'only one default')
    await data('DELETE', `/api/brand-kits/${kit.id}`)
    assert.equal((await call('PUT', `/api/brand-kits/${kit.id}`, { name: 'x' })).status, 404)

    const asset = await data('POST', '/api/user-asset', { kind: 'brand', nodeType: 'IMAGE', name: 'logo', mediaUrl: uploaded.url })
    assert.deepEqual([asset._id, asset.width, asset.height, asset.aspectRatio], [asset.id, 1024, 768, '4:3'])
    await data('POST', '/api/user-asset/register-output', { mediaUrl: uploaded.url, nodeType: 'IMAGE', name: 'out', fromFlowId: workflowId })
    assert.equal((await data('GET', '/api/user-asset/list?pageSize=100')).list.length, 2, 'no kind = all kinds')
    assert.deepEqual((await data('GET', '/api/user-asset/list?kind=output')).list.map((a) => a.name), ['out'])
    assert.equal((await call('POST', '/api/user-asset', { mediaUrl: 'javascript:alert(1)' })).status, 400)
    assert.equal((await call('DELETE', `/api/user-asset/${asset.id}`)).body.result, 0)

    const sliced = await data('POST', '/api/canvas/tool/slice', { imageUrl: uploaded.url, cols: 2, rows: 2 })
    assert.deepEqual(sliced.items.map((i) => [i.key, i.width, i.height]), [['r1c1', 512, 384], ['r1c2', 512, 384], ['r2c1', 512, 384], ['r2c2', 512, 384]])
    assert.ok(sliced.items.every((i) => i.label && /^\/files\/tools\//.test(i.url)))
    const fit = await data('POST', '/api/canvas/tool/fit', { imageUrl: uploaded.url, ratio: '1:1', format: 'jpg' })
    assert.deepEqual([fit.width, fit.height, fit.overLimit, typeof fit.bytes], [1024, 1024, false, 'number'])
    const collage = await data('POST', '/api/canvas/tool/collage', { imageUrls: [uploaded.url, uploaded.url, uploaded.url], cols: 2, rows: 1 })
    assert.deepEqual([collage.used, collage.skipped], [2, 1])
    const marked = await data('POST', '/api/canvas/tool/watermark', { imageUrl: uploaded.url, markUrl: uploaded.url })
    assert.deepEqual([marked.width, marked.height], [1024, 768])
    const exported = await data('POST', '/api/canvas/platform-export', { imageUrl: uploaded.url, group: 'domestic' })
    assert.deepEqual(exported.items.map((i) => i.key), ['taobao', 'whiteBg', 'xhs', 'douyin'])
    assert.equal(typeof exported.whiteBg.pure, 'boolean')
    for (const url of ['http://10.0.0.1/a.png', 'http://[::1]/a.png', 'file:///etc/passwd', '/etc/passwd', '/files/../../etc/passwd']) {
      assert.equal((await call('POST', '/api/canvas/tool/slice', { imageUrl: url, cols: 2, rows: 2 })).status, 400, url)
    }
  })

  await t.test('storage settings: local by default; an S3 configuration that fails its test is not saved', async () => {
    const status = await data('GET', '/api/admin/storage')
    assert.deepEqual([status.source, status.driver, status.delivery, status.s3, status.previous], ['default', 'local', '', null, []])

    const s3 = { preset: 'minio', endpoint: 'http://127.0.0.1:9', bucket: 'canvas', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'not-a-real-secret-0000', forcePathStyle: true }
    const tested = await data('POST', '/api/admin/storage/test', { s3 })
    assert.deepEqual([tested.ok, tested.code, tested.steps[0]], [false, 'storage.err_unreachable', { step: 'put', status: 'failed', ms: tested.steps[0].ms }])
    assert.ok(tested.message.startsWith(zh['storage.err_unreachable'].split('{')[0]))
    assert.ok(!JSON.stringify(tested).includes('not-a-real-secret'))

    const refused = await call('PUT', '/api/admin/storage', { driver: 's3', s3 })
    assert.deepEqual([refused.status, refused.body.code, refused.body.data.test.ok], [400, 'storage.save_needs_test', false])
    assert.equal((await call('PUT', '/api/admin/storage', { driver: 's3', s3: { ...s3, endpoint: 'https://canvas.oss-cn-hangzhou.aliyuncs.com' } })).body.code, 'storage.endpoint_has_bucket')
    assert.equal((await call('PUT', '/api/admin/storage', { driver: 'ftp' })).body.code, 'validation.one_of')
    assert.equal((await call('PUT', '/api/admin/storage', { driver: 'local' }, { auth: false })).status, 401)
    assert.equal(await mongoose.connection.collection('settings').countDocuments({ key: 'storage' }), 0, 'nothing was saved')
    assert.equal((await data('GET', '/api/admin/storage')).driver, 'local')
    // The stored file from the upload test is still served.
    assert.equal((await fetch(base + uploaded.url)).status, 200)
    // The storage document is not one of the ordinary settings.
    assert.equal((await call('PUT', '/api/admin/settings', { storage: { driver: 's3' } })).body.code, 'settings.unknown_key')
  })

  await t.test('restart recovery: interrupted run with an upstream task resumes polling, one without fails', async () => {
    const Run = require('../src/models/Run')
    const common = { kind: 'image', modelId: 'gaorui:nano-banana-2', upstreamModel: 'nano-banana-2', providerId, providerType: 'gaorui', prompt: 'x', billingStarted: true }
    const resumable = await Run.create({ ...common, status: 'running', externalId: 'img-1', submittedAt: new Date(), startedAt: new Date() })
    const lost = await Run.create({ ...common, status: 'running', externalId: '' })
    const archiving = await Run.create({ ...common, status: 'archiving', externalId: 'img-1', submittedAt: new Date() })
    const submitsBefore = upstream.state.calls.filter((c) => c.method === 'POST' && c.url === '/v1/nano-banana').length

    // What index.js does at boot.
    assert.equal(await getRunner().start(), 2)

    assert.equal((await waitRun(`/api/runs/${lost._id}`)).status, 'failed')
    for (const doc of [resumable, archiving]) {
      const run = await waitRun(`/api/runs/${doc._id}`)
      assert.equal(run.status, 'succeeded', run.error)
      assert.match(run.outputs[0].url, /^\/files\/outputs\//)
    }
    const submitsAfter = upstream.state.calls.filter((c) => c.method === 'POST' && c.url === '/v1/nano-banana').length
    assert.equal(submitsAfter, submitsBefore, 'resumed runs are polled, never submitted again')
  })

  await t.test('provider removal and error envelope', async () => {
    assert.equal((await call('GET', '/api/nope')).status, 404)
    const malformed = await fetch(base + '/api/brand-kits', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{oops' })
    assert.equal(malformed.status, 400)
    const envelope = await malformed.json()
    assert.deepEqual(Object.keys(envelope).sort(), ['code', 'data', 'message', 'result'])
    assert.equal(envelope.code, 'common.body_not_json')

    // Language of a message: X-Locale, then Accept-Language, then the site default.
    const said = async (headers) => (await call('GET', '/api/runs/not-an-id', undefined, { headers })).body
    const bad = (catalog) => catalog['validation.bad_format'].replace('{field}', 'id')
    assert.deepEqual([(await said({})).message, (await said({})).code], [bad(zh), 'validation.bad_format'])
    assert.equal((await said({ 'X-Locale': 'en' })).message, bad(en))
    assert.equal((await said({ 'Accept-Language': 'en-US,en;q=0.9,zh;q=0.8' })).message, bad(en))
    assert.equal((await said({ 'X-Locale': 'zh-CN', 'Accept-Language': 'en' })).message, bad(zh))
    assert.equal((await said({ 'X-Locale': 'fr', 'Accept-Language': 'fr' })).message, bad(zh), 'unsupported languages fall through')
    await data('PUT', '/api/admin/settings', { defaultLocale: 'en' })
    assert.equal((await said({})).message, bad(en), 'site default')
    assert.equal((await said({ 'Accept-Language': 'zh-CN' })).message, bad(zh))
    assert.equal((await call('POST', '/api/auth/login', { password: 'nope' }, { auth: false })).body.message, en['auth.wrong_password'])
    await data('PUT', '/api/admin/settings', { defaultLocale: 'zh-CN' })
    const types = await call('GET', '/api/admin/vendors', undefined, { headers: { 'X-Locale': 'en' } })
    assert.equal(types.body.data.find((p) => p.type === 'gaorui').label, en['provider.gaorui.label'])
    await data('DELETE', `/api/admin/providers/${providerId}`)
    assert.deepEqual(await data('GET', '/api/models'), [])
    assert.equal(await mongoose.connection.collection('modeloverrides').countDocuments(), 0, 'overrides go with their provider')
  })

  await t.test('usage: records older than a date can be cleared, unfinished ones are kept', async () => {
    const runs = mongoose.connection.collection('runs')
    const total = await runs.countDocuments()
    const old = new Date('2020-03-01T12:00:00Z')
    const first = await runs.find().sort({ _id: 1 }).limit(2).toArray()
    await runs.updateOne({ _id: first[0]._id }, { $set: { createdAt: old, status: 'succeeded' } })
    await runs.updateOne({ _id: first[1]._id }, { $set: { createdAt: old, status: 'queued' } })

    assert.deepEqual([(await call('DELETE', '/api/admin/usage/records')).status, (await call('DELETE', '/api/admin/usage/records')).body.code], [400, 'validation.required'])
    assert.equal((await call('DELETE', '/api/admin/usage/records?before=garbage')).body.code, 'validation.bad_date')
    assert.equal((await call('DELETE', '/api/admin/usage/records?before[$gt]=2000-01-01')).status, 400)
    assert.equal((await call('DELETE', '/api/admin/usage/records?before=2030-01-01', undefined, { auth: false })).status, 401)
    assert.equal(await runs.countDocuments(), total, 'nothing removed by the rejected calls')

    assert.deepEqual(await data('DELETE', '/api/admin/usage/records?before=2020-03-01'), { deleted: 0 }, 'a bare date is the start of that day')
    assert.deepEqual(await data('DELETE', '/api/admin/usage/records?before=2020-03-02'), { deleted: 1 })
    assert.equal(await runs.countDocuments(), total - 1)
    assert.ok(await runs.findOne({ _id: first[1]._id }), 'the queued record of the same age is still there')
  })
})
