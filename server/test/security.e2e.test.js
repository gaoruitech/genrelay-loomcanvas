'use strict'

/**
 * Attack-shaped requests over real HTTP, against an instance with a password.
 * Each case here was a finding of the pre-release security review.
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomcanvas-sec-'))
const webDist = path.join(tmpDir, 'web')
const INLINE_SCRIPT = "document.documentElement.setAttribute('data-theme', 'dark')"
fs.mkdirSync(webDist)
fs.writeFileSync(path.join(webDist, 'index.html'), `<!DOCTYPE html><html><head><script>${INLINE_SCRIPT}</script></head><body><div id="app"></div><script type="module" src="/assets/app.js"></script></body></html>`)

const API_KEY = 'sk-sec-key-ECHOED-0123456789'
process.env.SECRET_KEY = 'security-test-secret-key-0123456789'
process.env.ACCESS_PASSWORD = 'correct horse'
process.env.STORAGE_DRIVER = 'local'
process.env.STORAGE_LOCAL_DIR = path.join(tmpDir, 'files')
process.env.PUBLIC_URL = ''
process.env.WEB_DIST = webDist
process.env.BILLING_HOOK = ''
process.env.TRUST_PROXY = ''
process.env.CORS_ORIGIN = ''

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

/** An upstream that can repeat the credentials it was sent in its error message, and never finishes a chat. */
async function startUpstream() {
  const state = { rejectKeys: false }
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      const url = req.url.split('?')[0]
      res.setHeader('Content-Type', 'application/json')
      if (url === '/v1/models') {
        if (state.rejectKeys) {
          res.statusCode = 401
          return res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${req.headers.authorization}` } }))
        }
        return res.end(JSON.stringify({ data: [{ id: 'chat-small' }] }))
      }
      if (url === '/v1/chat/completions') return // never answered: the task stays unfinished
      res.statusCode = 404
      res.end('{}')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { state, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close() } }
}

test('security review findings stay fixed', async (t) => {
  const mongo = await findMongo()
  if (!mongo) return t.skip('no MongoDB available (set TEST_MONGODB_URI)')

  const mongoose = require('mongoose')
  const u = new URL(mongo.uri)
  u.pathname = `/loomcanvas_sec_${crypto.randomBytes(4).toString('hex')}`
  await mongoose.connect(u.toString(), { serverSelectionTimeoutMS: 8000 })

  const upstream = await startUpstream()
  const settings = require('../src/services/settings')
  await settings.load()
  const runnerModule = require('../src/runner')
  await runnerModule.getRunner().start()
  const server = require('../src/app').createApp().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  t.after(async () => {
    await runnerModule.getRunner().shutdown()
    server.closeAllConnections()
    server.close()
    upstream.close()
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
    await mongo.stop()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  let token = ''
  async function call(method, pathname, body, { auth = true, raw = false, headers: extra = {} } = {}) {
    const headers = { ...extra }
    if (auth && token) headers.Authorization = `Bearer ${token}`
    let payload
    if (body instanceof FormData || typeof body === 'string') payload = body
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(base + pathname, { method, headers, body: payload })
    if (raw) return res
    return { status: res.status, headers: res.headers, body: await res.json() }
  }
  const data = async (method, pathname, body) => {
    const r = await call(method, pathname, body)
    assert.equal(r.body.result, 0, `${method} ${pathname}: ${JSON.stringify(r.body).slice(0, 300)}`)
    return r.body.data
  }
  /** A request path exactly as written, without the normalisation fetch() applies. */
  const rawGet = (rawPath) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: rawPath }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)) }).on('error', reject)
  })
  const asJson = { 'Content-Type': 'application/json' }

  token = (await data('POST', '/api/auth/login', { password: 'correct horse' })).token

  await t.test('headers: a content security policy that only runs our own scripts', async () => {
    const page = await call('GET', '/', undefined, { raw: true, auth: false })
    const csp = page.headers.get('content-security-policy') || ''
    const directive = (name) => (csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) || '')
    const hash = crypto.createHash('sha256').update(INLINE_SCRIPT).digest('base64')
    assert.equal(directive('script-src'), `script-src 'self' 'sha256-${hash}'`, 'the inline theme script is allowed by hash, nothing else inline')
    assert.equal(directive('object-src'), "object-src 'none'")
    assert.equal(directive('base-uri'), "base-uri 'self'")
    assert.equal(directive('frame-ancestors'), "frame-ancestors 'self'")
    assert.equal(directive('form-action'), "form-action 'self'")
    assert.ok(!/unsafe-eval/.test(csp))
    assert.match(page.headers.get('permissions-policy') || '', /camera=\(\)/)
    assert.equal(page.headers.get('x-powered-by'), null)
    // The API is JSON only: nothing in it is ever to be rendered or run.
    const api = await call('GET', '/api/app/bootstrap', undefined, { raw: true, auth: false })
    assert.match(api.headers.get('content-security-policy') || '', /default-src 'none'/)
    assert.equal(api.headers.get('access-control-allow-origin'), null, 'same-origin unless CORS_ORIGIN is set')
    const cross = await call('GET', '/api/app/bootstrap', undefined, { raw: true, auth: false, headers: { Origin: 'https://evil.example' } })
    assert.equal(cross.headers.get('access-control-allow-origin'), null)
  })

  await t.test('anonymous request bodies are refused before they are parsed', async () => {
    const junk = '{"nodes":[' + 'x'.repeat(200 * 1024)
    for (const p of ['/api/workflow', '/api/runs', '/api/admin/settings']) {
      const r = await call('POST', p, junk, { auth: false, headers: asJson })
      assert.deepEqual([r.status, r.body.code], [401, 'auth.login_required'], p)
    }
    // The public endpoints still read their (small) bodies.
    const login = await call('POST', '/api/auth/login', '{"password":', { auth: false, headers: asJson })
    assert.deepEqual([login.status, login.body.code], [400, 'common.body_not_json'])
    const big = await call('POST', '/api/auth/login', JSON.stringify({ password: 'x'.repeat(200 * 1024) }), { auth: false, headers: asJson })
    assert.equal(big.status, 413)
    // Signed in, a canvas save may be large and everything else stays at 1 MB.
    assert.equal((await call('POST', '/api/workflow', { name: 'big', nodes: [{ id: 'n', type: 'text', data: { text: 'x'.repeat(2 * 1024 * 1024) } }] })).status, 200)
    assert.equal((await call('POST', '/api/brand-kits', { name: 'x'.repeat(2 * 1024 * 1024) })).status, 413)
  })

  await t.test('malformed requests are a 4xx with nothing internal in the answer', async () => {
    assert.equal(await rawGet('/files/%E0%A4%A'), 400)
    assert.equal(await rawGet('/api/canvas-share/%E0%A4%A'), 400)
    const charset = await call('POST', '/api/auth/login', '{"password":"x"}', { auth: false, headers: { 'Content-Type': 'application/json; charset=klingon' } })
    assert.deepEqual([charset.status, charset.body.code], [415, 'common.bad_request'])
    for (const r of [charset, await call('GET', '/api/workflow/%00'), await call('GET', '/api/nope')]) {
      assert.ok(r.status >= 400 && r.status < 500, String(r.status))
      assert.ok(!/node_modules|\.js:\d+|at \w+ \(/.test(JSON.stringify(r.body)), JSON.stringify(r.body))
    }
  })

  await t.test('object-valued and prototype-named fields never reach a query', async () => {
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const r = await call('PUT', '/api/admin/settings', `{"${key}":1}`, { headers: asJson })
      assert.deepEqual([r.status, r.body.code], [400, 'settings.unknown_key'], key)
    }
    assert.equal(({}).polluted, undefined)
    const inject = { $gt: '' }
    const probes = [
      ['POST', '/api/auth/login', { password: inject }, 400],
      ['POST', '/api/canvas-share/publish', { workflowId: inject }, 400],
      ['POST', '/api/runs', { model: inject }, 400],
      ['POST', '/api/runs/status', { ids: [inject, { $ne: null }] }, 200],
      ['POST', '/api/llm/tasks', { model: 'a:b', prompt: inject }, 400],
      ['PUT', '/api/admin/models/' + encodeURIComponent('a:b'), { label: inject }, 400],
      ['POST', '/api/user-asset/folder/delete', { name: inject }, 400],
      ['POST', '/api/admin/providers', { type: inject }, 400],
      ['GET', '/api/admin/usage/records?model[$ne]=x', undefined, 400],
      ['GET', '/api/admin/usage?kind[$ne]=x', undefined, 400],
      ['GET', '/api/canvas-share/' + encodeURIComponent('{"$gt":""}'), undefined, 404],
      ['GET', '/api/workflow/' + encodeURIComponent('{"$gt":""}'), undefined, 400],
    ]
    for (const [m, p, b, want] of probes) {
      const r = await call(m, p, b)
      assert.equal(r.status, want, `${m} ${p}: ${JSON.stringify(r.body).slice(0, 200)}`)
    }
    assert.deepEqual(await data('POST', '/api/runs/status', { ids: [inject] }), [])
    assert.deepEqual((await data('GET', '/api/user-asset/list?kind[$ne]=x&folder[$ne]=&tag[$ne]=&search[$regex]=.*')).list, [])
  })

  let providerId = ''
  await t.test('provider keys: not echoed back from an upstream error, and a changed SECRET_KEY is a clear, recoverable error', async () => {
    const created = await data('POST', '/api/admin/providers', { type: 'openai', name: 'Echo', baseUrl: upstream.baseUrl, apiKey: API_KEY })
    providerId = created.id
    await data('POST', `/api/admin/providers/${providerId}/models`, { model: 'chat-small', kind: 'chat' })
    upstream.state.rejectKeys = true
    const tested = await data('POST', `/api/admin/providers/${providerId}/test`)
    upstream.state.rejectKeys = false
    assert.equal(tested.ok, false)
    assert.ok(!tested.message.includes('ECHOED'), tested.message)
    assert.match(tested.message, /Incorrect API key provided/)

    // The same row, as it looks after the operator changed SECRET_KEY.
    const { encrypt } = require('../src/utils/crypto')
    const providers = mongoose.connection.collection('providers')
    const original = (await providers.findOne({})).apiKeyEnc
    await providers.updateOne({}, { $set: { apiKeyEnc: encrypt(API_KEY, 'a-different-secret-key-0123456789') } })
    assert.equal((await call('GET', '/api/admin/providers')).status, 200)
    assert.equal((await call('GET', '/api/models')).status, 200)
    const run = await call('POST', '/api/llm/tasks', { model: 'openai:chat-small', prompt: 'hi' })
    assert.deepEqual([run.status, run.body.code], [400, 'provider.key_undecryptable'])
    assert.equal((await data('POST', `/api/admin/providers/${providerId}/test`)).ok, false)
    await data('PUT', `/api/admin/providers/${providerId}`, { apiKey: API_KEY })
    assert.equal((await data('POST', `/api/admin/providers/${providerId}/test`)).ok, true)
    assert.notEqual((await providers.findOne({})).apiKeyEnc, original, 'a fresh IV every time')
  })

  await t.test('a video is refused by a chat model that cannot take one, not silently dropped', async () => {
    const video = 'https://media.example/clip.mp4'
    const g = await data('POST', '/api/admin/providers', { type: 'gemini', name: 'G', baseUrl: upstream.baseUrl, apiKey: API_KEY })
    await data('POST', `/api/admin/providers/${g.id}/models`, { model: 'gemini-chat', kind: 'chat' })
    // The kind is what was chosen, whatever the name looks like.
    await data('POST', `/api/admin/providers/${g.id}/models`, { model: 'nano-banana-image-x', kind: 'chat' })
    const r = await data('POST', '/api/admin/providers', { type: 'gaorui', name: 'R', baseUrl: upstream.baseUrl, apiKey: API_KEY })
    await data('POST', `/api/admin/providers/${r.id}/models`, { model: 'chat-small', kind: 'chat' })
    const models = await data('GET', '/api/models')
    const flags = Object.fromEntries(models.map((m) => [m.id, [m.kind, m.acceptsVideo]]))
    assert.deepEqual(flags['gemini:gemini-chat'], ['chat', false])
    assert.deepEqual(flags['gemini:nano-banana-image-x'], ['chat', false])
    assert.deepEqual(flags['openai:chat-small'], ['chat', false], 'the official OpenAI API takes no video')
    assert.deepEqual(flags['gaorui:chat-small'], ['chat', true])
    for (const model of ['gemini:gemini-chat', 'openai:chat-small']) {
      const refused = await call('POST', '/api/llm/tasks', { model, prompt: 'what happens?', videoUrl: video })
      assert.deepEqual([refused.status, refused.body.code], [400, 'model.no_video_input'], model)
    }
    const accepted = await data('POST', '/api/llm/tasks', { model: 'gaorui:chat-small', prompt: 'what happens?', videoUrl: video })
    await data('POST', `/api/runs/${accepted.taskId}/cancel`)
  })

  await t.test('unfinished runs are capped', async () => {
    runnerModule.limits.unfinishedRuns = 2
    try {
      const body = { model: 'openai:chat-small', prompt: 'never answered' }
      const ids = [(await data('POST', '/api/llm/tasks', body)).taskId, (await data('POST', '/api/llm/tasks', body)).taskId]
      const third = await call('POST', '/api/llm/tasks', body)
      assert.deepEqual([third.status, third.body.code], [429, 'run.queue_full'])
      for (const id of ids) await data('POST', `/api/runs/${id}/cancel`)
      const after = await data('POST', '/api/llm/tasks', body)
      await data('POST', `/api/runs/${after.taskId}/cancel`)
    } finally {
      runnerModule.limits.unfinishedRuns = 500
    }
  })

  await t.test('files: only images through fetch, and a zip export has a total size cap', async () => {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#2266aa' } }).png().toBuffer()
    const form = new FormData()
    form.append('file', new Blob([png]), 'a.png')
    const image = await data('POST', '/api/files/upload', form)
    const video = new FormData()
    video.append('file', new Blob([Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(4096)])]), 'a.mp4')
    const clip = await data('POST', '/api/files/upload', video)

    // Media is served as what it is, never as something a browser would run.
    const served = await call('GET', clip.url, undefined, { raw: true, auth: false })
    assert.deepEqual([served.headers.get('content-type'), served.headers.get('x-content-type-options')], ['video/mp4', 'nosniff'])
    assert.match(served.headers.get('content-security-policy'), /sandbox/)

    const own = await call('POST', '/api/files/fetch', { url: clip.url })
    assert.deepEqual([own.status, own.body.code], [400, 'file.image_only'], 'a stored video is not read into memory')
    assert.equal((await data('POST', '/api/files/fetch', { url: image.url })).key, image.key)

    const wf = await data('POST', '/api/workflow', { name: 'zip', nodes: [
      { id: 'a', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: image.url } },
      { id: 'b', type: 'video', position: { x: 0, y: 0 }, data: { videoUrl: clip.url } },
    ] })
    const workflow = require('../src/routes/workflow')
    const zip = async () => Buffer.from(await (await call('POST', `/api/workflow/${wf.id}/download-zip`, {}, { raw: true })).arrayBuffer())
    const whole = await zip()
    assert.ok(whole.includes(Buffer.from('01-image.png')) && whole.includes(Buffer.from('02-video.mp4')))
    const before = workflow.limits.zipTotalBytes
    workflow.limits.zipTotalBytes = png.length + 100
    try {
      const capped = await zip()
      assert.ok(capped.includes(Buffer.from('01-image.png')))
      assert.ok(!capped.includes(Buffer.from('02-video.mp4')) && capped.includes(Buffer.from('02-video-skipped.txt')), 'what does not fit is left out, with a note')
      assert.ok(capped.length < whole.length)
    } finally {
      workflow.limits.zipTotalBytes = before
    }
  })
})
