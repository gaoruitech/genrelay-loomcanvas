'use strict'

/**
 * Storage trouble, end to end over real HTTP: the Express app, MongoDB, the
 * runner, a fake upstream that records what it is sent, and stand-ins for
 * storage services (support/fakeS3.js) - an S3 API in memory and a server that
 * accepts connections and never answers.
 *
 *   1. a reference image in a bucket whose address only works inside the deployment
 *   2. an earlier bucket that is down while files are read and an account is deleted
 *   3. a restart with another SECRET_KEY
 *   4. a bucket described by the S3_* variables while the local disk is in use
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
const en = require('../src/i18n/en')
const zh = require('../src/i18n/zh-CN')
const { startFakeS3, startBlackHole } = require('./support/fakeS3')
const { capturingLog, timed } = require('./support/storageEnv')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomcanvas-storage-e2e-'))
const SECRET_KEY = 'storage-e2e-secret-key-0123456789'
process.env.SECRET_KEY = SECRET_KEY
process.env.STORAGE_LOCAL_DIR = tmpDir
process.env.PUBLIC_URL = ''
process.env.WEB_DIST = ''
process.env.BILLING_HOOK = ''
for (const name of Object.keys(process.env)) if (/^(S3_|STORAGE_DRIVER$)/.test(name)) delete process.env[name]

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

/** Fake upstream: the image task API, chat and a result to download. Everything it is sent is kept. */
async function startUpstream(png) {
  const calls = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = req.url.split('?')[0]
      const text = Buffer.concat(chunks).toString()
      calls.push({ method: req.method, url, text })
      const base = `http://127.0.0.1:${server.address().port}`
      const json = (obj) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
      if (req.method === 'GET' && url === '/v1/models') return json({ data: [{ id: 'chat-small' }] })
      if (req.method === 'POST' && url === '/v1/nano-banana') return json({ code: 0, data: { id: 'img-1' } })
      if (req.method === 'GET' && url === '/v1/nano-banana/img-1') return json({ code: 0, data: { status: 'completed', progress: 100, image_url: `${base}/cdn/result.png` } })
      if (req.method === 'POST' && url === '/v1/chat/completions') return json({ choices: [{ message: { content: 'seen' } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })
      if (req.method === 'GET' && url === '/cdn/result.png') { res.setHeader('Content-Type', 'image/png'); return res.end(png) }
      res.statusCode = 404
      json({ error: { message: 'not found' } })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { calls, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close() } }
}

test('storage trouble end to end', async (t) => {
  const mongo = await findMongo()
  if (!mongo) return t.skip('no MongoDB available (set TEST_MONGODB_URI)')

  const mongoose = require('mongoose')
  const u = new URL(mongo.uri)
  u.pathname = `/loomcanvas_storage_e2e_${crypto.randomBytes(4).toString('hex')}`
  await mongoose.connect(u.toString(), { serverSelectionTimeoutMS: 8000 })

  const png = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#2266aa' } }).png().toBuffer()
  const upstream = await startUpstream(png)
  const service = await startFakeS3()
  const hole = await startBlackHole()

  const { resetConfig } = require('../src/config')
  const storage = require('../src/storage')
  const storageSettings = require('../src/services/storageSettings')
  const storageCleanup = require('../src/services/storageCleanup')
  const { setAllowedHosts } = require('../src/utils/safeFetch')
  setAllowedHosts(['127.0.0.1']) // the fake upstream's result link; what SSRF_ALLOW_HOSTS=127.0.0.1 does at boot
  /** What index.js does at start-up, again: read the environment and the saved storage settings. */
  const restart = async (env = {}) => {
    for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    resetConfig()
    storage.resetStorage()
    storageSettings.reset()
    return storageSettings.load()
  }

  await require('../src/services/settings').load()
  await storageSettings.load()
  await require('../src/services/accounts').prepare({ admin: { username: 'owner', email: 'owner@example.com', password: 'correct horse' } })
  const { getRunner } = require('../src/runner')
  await getRunner().start()
  const server = require('../src/app').createApp().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  t.after(async () => {
    await storageCleanup.idle()
    await getRunner().shutdown()
    server.closeAllConnections()
    server.close()
    upstream.close()
    service.close()
    hole.close()
    setAllowedHosts([])
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
    await mongo.stop()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /** A client signed in as one account. */
  function client(token) {
    async function call(method, pathname, body, headers = {}) {
      const h = { 'X-Locale': 'en', ...headers }
      if (token) h.Authorization = `Bearer ${token}`
      let payload
      if (body instanceof FormData) payload = body
      else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
      const res = await fetch(base + pathname, { method, headers: h, body: payload })
      return { status: res.status, body: await res.json() }
    }
    async function data(method, pathname, body) {
      const r = await call(method, pathname, body)
      assert.equal(r.body.result, 0, `${method} ${pathname}: ${JSON.stringify(r.body).slice(0, 300)}`)
      return r.body.data
    }
    const form = (buffer) => { const f = new FormData(); f.append('file', new Blob([buffer], { type: 'image/png' }), 'x.png'); return f }
    const upload = (buffer = png) => data('POST', '/api/files/upload', form(buffer))
    async function waitRun(pathname) {
      const end = Date.now() + 20000
      for (;;) {
        const run = await data('GET', pathname)
        if (['succeeded', 'failed', 'canceled'].includes(run.status)) return run
        if (Date.now() > end) throw new Error(`still ${run.status}: ${pathname}`)
        await new Promise((r) => setTimeout(r, 200))
      }
    }
    return { call, data, upload, form, waitRun }
  }
  const login = async (account, password) => (await client('').data('POST', '/api/auth/login', { account, password })).token
  const owner = client(await login('owner', 'correct horse'))
  const file = (pathname, headers) => fetch(base + pathname, { headers: { 'X-Locale': 'en', ...headers }, redirect: 'manual' })
  const sentTo = (url) => upstream.calls.filter((c) => c.method === 'POST' && c.url === url)
  const missing = () => `/files/uploads/2025/01/${crypto.randomBytes(16).toString('hex')}.png`

  const provider = await owner.data('POST', '/api/admin/providers', { type: 'gaorui', name: 'Fake', baseUrl: upstream.baseUrl, apiKey: 'sk-e2e-key-abcdef123456', enabled: true })
  assert.equal(provider.keyUnreadable, false)
  await owner.data('POST', `/api/admin/providers/${provider.id}/models`, { model: 'chat-small', kind: 'chat' })
  const onDisk = await owner.upload()
  assert.ok(fs.existsSync(path.join(tmpDir, onDisk.key)))
  const { secretAccessKey, ...mediaForm } = service.bucket('media')

  await t.test('a bucket with an internal address: inline where the model takes it, refused where a URL is needed, never the address', async () => {
    // Saved through the real connection test. The endpoint is a private address, like "http://minio:9000" in a compose file.
    let status = await owner.data('PUT', '/api/admin/storage', { driver: 's3', s3: { ...mediaForm, secretAccessKey } })
    assert.deepEqual([status.driver, status.delivery, status.writable, status.upstream, status.s3.presignEndpoint], ['s3', 'proxy', true, 'inline', ''])
    assert.equal((await owner.data('GET', '/api/bootstrap')).media.upstreamByUrl, false, 'the canvas is told before a run')
    const reference = await owner.upload()
    assert.ok(service.objects('media').has(reference.key) && !fs.existsSync(path.join(tmpDir, reference.key)))

    // A chat model takes pictures inline: it gets the bytes.
    const { taskId } = await owner.data('POST', '/api/llm/tasks', { model: 'gaorui:chat-small', prompt: 'describe', imageUrls: [reference.url] })
    assert.equal((await owner.waitRun(`/api/llm/tasks/${taskId}`)).status, 'succeeded')
    const chat = JSON.parse(sentTo('/v1/chat/completions').at(-1).text)
    assert.match(chat.messages.at(-1).content[1].image_url.url, /^data:image\/png;base64,/)

    // An image model that only takes URLs: refused before anything is sent, with the reason.
    const sent = sentTo('/v1/nano-banana').length
    const { runId } = await owner.data('POST', '/api/runs', { model: 'gaorui:nano-banana-2.1', prompt: 'a cat', imageUrls: [reference.url], params: { resolution: '1K' } })
    const refused = await owner.waitRun(`/api/runs/${runId}`)
    assert.deepEqual([refused.status, refused.errorCode], ['failed', 'media.needs_public_url'])
    assert.match(refused.error, /publicly reachable URL is needed for the reference image/)
    assert.equal(sentTo('/v1/nano-banana').length, sent)
    // Whatever went to the upstream, the bucket's address was not in it.
    const everything = upstream.calls.map((c) => c.text).join('\n')
    assert.ok(!everything.includes(new URL(service.endpoint).host) && !everything.includes('X-Amz-'))

    // With the name the service has from outside, signed addresses are made for that name - and only for it.
    status = await owner.data('PUT', '/api/admin/storage', { driver: 's3', s3: { ...mediaForm, presignEndpoint: 'https://s3.example.com' } })
    assert.deepEqual([status.upstream, status.s3.presignEndpoint, status.previous.length], ['signed', 'https://s3.example.com', 0])
    assert.equal((await owner.data('GET', '/api/bootstrap')).media.upstreamByUrl, true)
    const second = await owner.data('POST', '/api/runs', { model: 'gaorui:nano-banana-2.1', prompt: 'a cat', imageUrls: [reference.url], params: { resolution: '1K' } })
    const run = await owner.waitRun(`/api/runs/${second.runId}`)
    assert.equal(run.status, 'succeeded', run.error)
    const submitted = sentTo('/v1/nano-banana').at(-1).text
    assert.match(submitted, new RegExp(`https://s3\\.example\\.com/media/${reference.key.replace(/[/.]/g, '\\$&')}\\?[^"]*X-Amz-Signature=`))
    assert.ok(!submitted.includes(new URL(service.endpoint).host))
    // The signed address went to the upstream and nowhere else: not into the run, not into the canvas.
    assert.ok(!JSON.stringify(run).includes('X-Amz-') && !JSON.stringify(run).includes('s3.example.com'))
    assert.ok(service.objects('media').has(run.outputs[0].url.slice('/files/'.length)), 'the result is in the bucket')
    assert.equal((await file(run.outputs[0].url)).status, 200)

    await owner.data('PUT', '/api/admin/storage', { driver: 's3', s3: mediaForm })
  })

  await t.test('an earlier bucket that never answers: files elsewhere load, missing is 503, deleting an account does not wait', async () => {
    // A bucket that was used before and is now a black hole, then back to the one that works.
    const dead = { ...service.bucket('gone'), endpoint: hole.endpoint }
    await owner.data('PUT', '/api/admin/storage', { driver: 's3', force: true, s3: dead })
    let status = await owner.data('PUT', '/api/admin/storage', { driver: 's3', s3: { ...mediaForm, secretAccessKey } })
    assert.deepEqual(status.buckets.map((b) => [b.bucket, b.active, b.state, b.removable]), [['media', true, 'ok', false], ['gone', false, 'ok', true]])
    storage.resetStorage() // as after a restart: nothing is remembered about where files are
    await storageSettings.load()

    const reg = await client('').data('POST', '/api/auth/register', { username: 'leaving', email: 'leaving@example.com', password: 'correct horse' })
    const leaving = client(reg.token)
    const theirs = await leaving.upload()
    const kept = await owner.upload()
    assert.ok(service.objects('media').has(theirs.key))

    const lines = await capturingLog(async () => {
      // Files on the disk and in the bucket in use, and their thumbnails: served without the dead bucket being asked.
      for (const address of [onDisk.url, onDisk.thumbnailUrl, kept.url, kept.thumbnailUrl]) {
        const [res, ms] = await timed(() => file(address))
        assert.equal(res.status, 200, address)
        assert.ok(ms < 1500, `${address}: ${ms} ms`)
        await res.arrayBuffer()
      }
      assert.equal(hole.connections, 0)

      // A file that is nowhere: 503 with a message, within the short deadline; after that at once.
      let [res, ms] = await timed(() => file(missing()))
      assert.equal(res.status, 503)
      assert.ok(ms < storage.LOOKUP_MS + 2500, `${ms} ms`)
      assert.deepEqual(await res.json(), { result: -1, message: en['storage.unreachable'], code: 'storage.unreachable', data: null })
      ;[res, ms] = await timed(() => file(missing(), { 'X-Locale': 'zh-CN' }))
      assert.deepEqual([res.status, (await res.json()).message], [503, zh['storage.unreachable']])
      assert.ok(ms < 500, `${ms} ms`)
      // The same through the API: an address of ours that cannot be looked up is not "not found".
      const fetched = await owner.call('POST', '/api/files/fetch', { url: missing() })
      assert.deepEqual([fetched.status, fetched.body.code], [503, 'storage.unreachable'])
      status = await owner.data('GET', '/api/admin/storage')
      assert.deepEqual(status.buckets.map((b) => [b.bucket, b.state]), [['media', 'ok'], ['gone', 'unreachable']])
      assert.ok(status.buckets[1].downSince)

      // Deleting the account: answered promptly, what could be removed is gone, the rest is owed.
      const [gone, took] = await timed(() => owner.data('DELETE', `/api/admin/users/${reg.user.id}?confirm=leaving`))
      assert.ok(took < 3000, `${took} ms`)
      assert.deepEqual([gone.id, gone.filesRemoved, gone.files >= 1], [reg.user.id, false, true])
      assert.ok(!service.objects('media').has(theirs.key))
      assert.ok(service.objects('media').has(kept.key))
      const journal = await mongoose.connection.collection('settings').findOne({ key: 'storageCleanup' })
      assert.deepEqual(journal.value.owners.map((o) => o.owner), [reg.user.id])
      assert.equal(hole.connections, 1, 'the dead bucket was contacted once in all of this')
    })
    assert.equal(lines.filter((l) => /gone cannot be reached/.test(l)).length, 1)
    assert.match(lines.join('\n'), /files of deleted account [0-9a-f]{24} could not all be removed: left in 127\.0\.0\.1:\d+\/gone/)

    // Retention: an expired result that is where it can be removed is removed. One that may be in the
    // dead bucket is not written off as cleaned - until the bucket has been away for a month.
    const Run = require('../src/models/Run')
    const retention = require('../src/services/retention')
    const ownerId = (await owner.data('GET', '/api/bootstrap')).user.id
    const expired = (key, daysAgo) => Run.create({ userId: ownerId, kind: 'image', status: 'succeeded', modelId: 'x:y', providerId: new mongoose.Types.ObjectId(), upstreamModel: 'y', finishedAt: new Date(Date.now() - daysAgo * 86400000), outputs: [{ type: 'image', url: `/files/${key}`, key }] })
    const here = await expired(kept.key, 3)
    const maybeThere = await expired(missing().slice('/files/'.length), 3)
    const longOverdue = await expired(missing().slice('/files/'.length), 40)
    await owner.data('PUT', '/api/admin/settings', { retentionDays: 1 })
    const purgedOf = async (run) => (await Run.findById(run._id).lean()).filesPurged
    const swept = await capturingLog(async () => {
      assert.equal(await retention.sweep(), 2)
      assert.deepEqual([await purgedOf(here), await purgedOf(maybeThere), await purgedOf(longOverdue)], [true, false, true])
      assert.ok(!service.objects('media').has(kept.key))
      assert.equal(await retention.sweep(), 0, 'tried again, still not written off')
      assert.equal(await purgedOf(maybeThere), false)
    })
    assert.equal(swept.filter((l) => /1 expired run\(s\) keep their files for now/.test(l)).length, 2)
    assert.equal(swept.filter((l) => /1 run\(s\) marked as cleaned although a storage that may hold their files has not been reachable for 30 days/.test(l)).length, 1)
    await owner.data('PUT', '/api/admin/settings', { retentionDays: 0 })
    assert.equal(hole.connections, 1)

    // The owner stops reading the dead bucket: missing is missing again, and nothing is owed any more.
    assert.deepEqual((await owner.call('DELETE', '/api/admin/storage/buckets/s3-000000000000')).body.code, 'storage.bucket_not_found')
    const active = status.buckets.find((b) => b.active)
    assert.deepEqual([(await owner.call('DELETE', `/api/admin/storage/buckets/${active.id}`)).status, (await owner.call('DELETE', `/api/admin/storage/buckets/${active.id}`)).body.code], [400, 'storage.bucket_in_use'])
    status = await owner.data('DELETE', `/api/admin/storage/buckets/${status.buckets[1].id}`)
    assert.deepEqual([status.buckets.map((b) => b.bucket), status.previous], [['media'], []])
    assert.equal((await file(missing())).status, 404)
    await storageCleanup.retry()
    assert.equal(await storageCleanup.owed(), 0)
    assert.equal((await file(onDisk.url)).status, 200)
  })

  await t.test('a restart with another SECRET_KEY: starts, says what cannot be read, refuses clearly, recovers when the secrets are entered again', async () => {
    const inBucket = await owner.upload()
    const calls = upstream.calls.length
    const asked = service.requests.length
    try {
      let status = await restart({ SECRET_KEY: 'a-completely-different-secret-key' })
      assert.deepEqual([status.driver, status.secretUnreadable, status.writable], ['s3', true, false])

      // The session survives (it does not hang on SECRET_KEY), and the settings page is told.
      status = await owner.data('GET', '/api/admin/storage')
      assert.deepEqual([status.source, status.driver, status.secretUnreadable, status.writable, status.s3.bucket], ['saved', 's3', true, false, 'media'])
      assert.deepEqual(status.buckets.map((b) => [b.bucket, b.active, b.state]), [['media', true, 'secret_unreadable']])
      assert.deepEqual([status.upstream, status.upstreamReason], ['unavailable', 'secret_unreadable'])
      // Everybody who is signed in is told before they try - the owner and an ordinary account alike - and nothing else.
      const plain = client((await client('').data('POST', '/api/auth/register', { username: 'plain', email: 'plain@example.com', password: 'correct horse' })).token)
      for (const who of [owner, plain]) {
        const boot = await who.data('GET', '/api/bootstrap')
        assert.deepEqual(boot.media, { upstreamByUrl: false, writable: false })
      }
      assert.deepEqual((await client('').data('GET', '/api/bootstrap')).media, { upstreamByUrl: false, writable: true }, 'an anonymous caller is told nothing')
      assert.equal((await plain.call('GET', '/api/admin/storage')).status, 403)

      // Files: what is on the disk loads; what is in the bucket is unavailable, not gone; uploads are refused.
      assert.equal((await file(onDisk.url)).status, 200)
      const lost = await file(inBucket.url)
      assert.deepEqual([lost.status, (await lost.json()).code], [503, 'storage.unreachable'])
      for (const [locale, catalog] of [['en', en], ['zh-CN', zh]]) {
        const refused = await owner.call('POST', '/api/files/upload', owner.form(png), { 'X-Locale': locale })
        assert.deepEqual([refused.status, refused.body.code, refused.body.message], [503, 'storage.secret_unreadable', catalog['storage.secret_unreadable']])
      }
      assert.equal(fs.readdirSync(tmpDir, { recursive: true }).filter((f) => String(f).includes(inBucket.key.split('/').pop())).length, 0)

      // Providers: listed, marked, and a run says what to do instead of a decrypt error.
      const listed = (await owner.data('GET', '/api/admin/providers'))[0]
      assert.deepEqual([listed.hasKey, listed.keyTail, listed.keyUnreadable], [true, '3456', true])
      assert.ok(!JSON.stringify(listed).includes('apiKeyEnc'))
      assert.deepEqual(await owner.data('POST', `/api/admin/providers/${provider.id}/test`), { ok: false, message: en['provider.key_undecryptable'] })
      for (const [pathname, body] of [['/api/runs', { model: 'gaorui:nano-banana-2', prompt: 'x' }], ['/api/llm/tasks', { model: 'gaorui:chat-small', prompt: 'x' }]]) {
        const run = await owner.call('POST', pathname, body)
        assert.deepEqual([run.status, run.body.code, run.body.message], [400, 'provider.key_undecryptable', en['provider.key_undecryptable']], pathname)
      }
      assert.equal((await owner.call('POST', '/api/runs', { model: 'gaorui:nano-banana-2', prompt: 'x' }, { 'X-Locale': 'zh-CN' })).body.message, zh['provider.key_undecryptable'])

      // The provider key entered again while storage is still unusable: text works, and an image is
      // refused before the upstream is paid for a result that could not be kept.
      const fixed = await owner.data('PUT', `/api/admin/providers/${provider.id}`, { apiKey: 'sk-e2e-key-abcdef123456' })
      assert.equal(fixed.keyUnreadable, false)
      const { taskId } = await owner.data('POST', '/api/llm/tasks', { model: 'gaorui:chat-small', prompt: 'hello' })
      assert.equal((await owner.waitRun(`/api/llm/tasks/${taskId}`)).status, 'succeeded')
      const sent = sentTo('/v1/nano-banana').length
      const image = await owner.call('POST', '/api/runs', { model: 'gaorui:nano-banana-2', prompt: 'x' })
      assert.deepEqual([image.status, image.body.code, image.body.message], [503, 'storage.secret_unreadable', en['storage.secret_unreadable']])
      assert.equal(sentTo('/v1/nano-banana').length, sent)
      assert.equal(service.requests.length, asked, 'the bucket was never contacted with a garbled secret')

      // The S3 secret entered again: everything is back.
      await assert.rejects(() => owner.data('PUT', '/api/admin/storage', { driver: 's3', s3: mediaForm }), /secretAccessKey/)
      status = await owner.data('PUT', '/api/admin/storage', { driver: 's3', s3: { ...mediaForm, secretAccessKey } })
      assert.deepEqual([status.secretUnreadable, status.writable, status.buckets[0].state], [false, true, 'ok'])
      assert.deepEqual([status.upstream, status.upstreamReason, (await owner.data('GET', '/api/bootstrap')).media.writable], ['inline', '', true])
      assert.equal((await file(inBucket.url)).status, 200)
      const { runId } = await owner.data('POST', '/api/runs', { model: 'gaorui:nano-banana-2', prompt: 'x' })
      assert.equal((await owner.waitRun(`/api/runs/${runId}`)).status, 'succeeded')
      assert.ok(upstream.calls.length > calls)
    } finally {
      await restart({ SECRET_KEY })
    }
    // Back under the first key, what was saved under the other one is the unreadable part.
    const status = await owner.data('GET', '/api/admin/storage')
    assert.deepEqual([status.secretUnreadable, status.writable], [true, false])
    assert.equal((await owner.data('GET', '/api/admin/providers'))[0].keyUnreadable, true)
    await owner.data('PUT', '/api/admin/storage', { driver: 's3', s3: { ...mediaForm, secretAccessKey } })
    await owner.data('PUT', `/api/admin/providers/${provider.id}`, { apiKey: 'sk-e2e-key-abcdef123456' })
  })

  await t.test('the settings page: a refusal names its field, and ?probe=1 finds out the state of every bucket without a file request', async () => {
    // Which of the two endpoints is wrong is in the answer, and said in the reader's words.
    for (const [locale, catalog] of [['en', en], ['zh-CN', zh]]) {
      for (const pathname of ['/api/admin/storage/test', '/api/admin/storage']) {
        const refused = await owner.call(pathname.endsWith('/test') ? 'POST' : 'PUT', pathname, { driver: 's3', s3: { ...mediaForm, presignEndpoint: 'https://s3.example.com/minio' } }, { 'X-Locale': locale })
        assert.deepEqual([refused.status, refused.body.code, refused.body.data], [400, 'storage.endpoint_has_path', { field: 'presignEndpoint' }])
        assert.ok(refused.body.message.startsWith(catalog['storage.field.presignEndpoint']), refused.body.message)
      }
    }
    const bad = await owner.call('POST', '/api/admin/storage/test', { s3: { ...mediaForm, publicBaseUrl: 'ftp://cdn.example.com' } })
    assert.deepEqual([bad.body.code, bad.body.data, bad.body.message], ['validation.bad_url', { field: 'publicBaseUrl' }, 'The public base URL is not a valid URL'])
    const secret = await owner.call('POST', '/api/admin/storage/test', { s3: { ...mediaForm, accessKeyId: 'SOMEBODY-ELSE' } })
    assert.deepEqual([secret.body.code, secret.body.data], ['storage.secret_required', { field: 'secretAccessKey' }])

    // An earlier bucket on a port nothing listens on. Nobody asks for a file.
    const { refusedPort } = require('./support/fakeS3')
    const dead = { ...service.bucket('refusing'), endpoint: `http://127.0.0.1:${await refusedPort()}` }
    await owner.data('PUT', '/api/admin/storage', { driver: 's3', force: true, s3: dead })
    let status = await owner.data('PUT', '/api/admin/storage', { driver: 's3', s3: { ...mediaForm, secretAccessKey } })
    // The plain status is what is known, and nothing is known yet...
    assert.deepEqual(status.buckets.map((b) => [b.bucket, b.state]), [['media', 'ok'], ['refusing', 'ok']])
    assert.deepEqual((await owner.data('GET', '/api/admin/storage')).buckets.map((b) => b.state), ['ok', 'ok'])
    // ...with ?probe=1 the buckets are asked first.
    const lines = await capturingLog(async () => {
      const [probed, ms] = await timed(() => owner.data('GET', '/api/admin/storage?probe=1'))
      assert.ok(ms < storage.PROBE_DEADLINE_MS + 1500, `${ms} ms`)
      assert.deepEqual(probed.buckets.map((b) => [b.bucket, b.state, !!b.downSince]), [['media', 'ok', false], ['refusing', 'unreachable', true]])
      // A black hole instead: the answer still comes within the bound.
      await owner.data('DELETE', `/api/admin/storage/buckets/${probed.buckets[1].id}`)
    })
    assert.equal(lines.filter((l) => /refusing cannot be reached/.test(l)).length, 1)
    const before = hole.connections
    await owner.data('PUT', '/api/admin/storage', { driver: 's3', force: true, s3: { ...service.bucket('silent'), endpoint: hole.endpoint } })
    await owner.data('PUT', '/api/admin/storage', { driver: 's3', s3: { ...mediaForm, secretAccessKey } })
    await capturingLog(async () => {
      const [probed, ms] = await timed(() => owner.data('GET', '/api/admin/storage?probe=1'))
      assert.ok(ms < storage.PROBE_DEADLINE_MS + 1500, `${ms} ms`)
      assert.deepEqual(probed.buckets.map((b) => [b.bucket, b.state]), [['media', 'ok'], ['silent', 'unreachable']])
      assert.equal(hole.connections, before + 1)
      status = await owner.data('DELETE', `/api/admin/storage/buckets/${probed.buckets[1].id}`)
    })
    assert.deepEqual(status.buckets.map((b) => b.bucket), ['media'])
    assert.equal((await client('').call('GET', '/api/admin/storage?probe=1')).status, 401)
  })

  await t.test('the bucket of the S3_* variables with STORAGE_DRIVER=local: its files load, new ones go to the disk', async () => {
    const inBucket = await owner.upload()
    await mongoose.connection.collection('settings').deleteOne({ key: 'storage' })
    const S3_ENV = { S3_ENDPOINT: mediaForm.endpoint, S3_BUCKET: 'media', S3_ACCESS_KEY_ID: mediaForm.accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey, S3_FORCE_PATH_STYLE: 'true' }
    try {
      await restart({ STORAGE_DRIVER: 'local', ...S3_ENV })
      const status = await owner.data('GET', '/api/admin/storage')
      assert.deepEqual([status.source, status.driver, status.envDriver, status.writable], ['default', 'local', 'local', true])
      assert.deepEqual(status.buckets.map((b) => [b.bucket, b.origin, b.active, b.state, b.removable]), [['media', 'env', false, 'ok', false]])
      const res = await file(inBucket.url)
      assert.equal(res.status, 200)
      assert.ok(Buffer.from(await res.arrayBuffer()).equals(png))
      assert.equal((await file(inBucket.thumbnailUrl)).status, 200)
      const fresh = await owner.upload()
      assert.ok(fs.existsSync(path.join(tmpDir, fresh.key)) && !service.objects('media').has(fresh.key))
      assert.equal((await file(missing())).status, 404)
      // Without the variables the bucket is simply not known.
      await restart(Object.fromEntries(Object.keys(S3_ENV).map((k) => [k, undefined])))
      assert.equal((await file(inBucket.url)).status, 404)
      assert.deepEqual((await owner.data('GET', '/api/admin/storage')).buckets, [])
    } finally {
      await restart({ STORAGE_DRIVER: undefined, ...Object.fromEntries(Object.keys(S3_ENV).map((k) => [k, undefined])) })
    }
  })
})
