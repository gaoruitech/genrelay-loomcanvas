'use strict'

/**
 * Accounts over real HTTP: the data of the version without accounts being
 * handed to the first account, registering and signing in, sessions, the
 * owner's endpoints, and - above all - that one account never reaches another
 * account's data, by id or in a list.
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
const { execFile } = require('child_process')
const sharp = require('sharp')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomcanvas-accounts-'))
const filesDir = path.join(tmpDir, 'files')
const hookFile = path.join(tmpDir, 'billing-hook.js')
fs.writeFileSync(hookFile, `
const seen = (globalThis.__lcBilling = [])
module.exports = {
  async beforeRun(ctx) { seen.push({ hook: 'beforeRun', runId: ctx.runId, userId: ctx.userId, username: ctx.username }); return { allow: true } },
  async afterRun(ctx) { seen.push({ hook: 'afterRun', runId: ctx.runId, userId: ctx.userId, username: ctx.username }) },
}
`)
process.env.SECRET_KEY = 'accounts-test-secret-key-0123456789'
process.env.STORAGE_DRIVER = 'local'
process.env.STORAGE_LOCAL_DIR = filesDir
process.env.PUBLIC_URL = ''
process.env.WEB_DIST = ''
process.env.BILLING_HOOK = hookFile

const KEY_LEGACY = 'sk-legacy-key-0000000000aaaa'
const KEY_A = 'sk-account-a-key-000000000bbbb'
const KEY_B = 'sk-account-b-key-000000000cccc'

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

/** Fake upstream speaking the gaorui image and chat protocols. Records the key every call came with. */
async function startUpstream(png) {
  const calls = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = req.url.split('?')[0]
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : null
      calls.push({ method: req.method, url, auth: String(req.headers.authorization || '').replace(/^Bearer /, ''), body })
      const base = `http://127.0.0.1:${server.address().port}`
      const json = (obj, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
      if (req.method === 'GET' && url === '/v1/models') return json({ data: [{ id: 'nano-banana-2' }] })
      if (req.method === 'POST' && url === '/v1/nano-banana') return json({ code: 0, data: { id: body.prompt === 'never' ? 'img-never' : 'img-1' } })
      if (req.method === 'GET' && url === '/v1/nano-banana/img-1') return json({ code: 0, data: { status: 'completed', progress: 100, image_url: `${base}/cdn/result.png` } })
      if (req.method === 'GET' && url === '/v1/nano-banana/img-never') return json({ code: 0, data: { status: 'running', progress: 10 } })
      if (req.method === 'POST' && url === '/v1/chat/completions') return json({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 10, completion_tokens: 10 } })
      if (req.method === 'GET' && url === '/cdn/result.png') { res.setHeader('Content-Type', 'image/png'); return res.end(png) }
      json({ error: { message: 'not found' } }, 404)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { calls, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close() } }
}

test('accounts: adoption of old data, sign-in, sessions, the owner, and isolation between accounts', async (t) => {
  const mongo = await findMongo()
  if (!mongo) return t.skip('no MongoDB available (set TEST_MONGODB_URI)')

  const mongoose = require('mongoose')
  const u = new URL(mongo.uri)
  u.pathname = `/loomcanvas_accounts_${crypto.randomBytes(4).toString('hex')}`
  const dbUri = u.toString()
  await mongoose.connect(dbUri, { serverSelectionTimeoutMS: 8000 })
  const db = mongoose.connection
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#335577' } }).png().toBuffer()
  const upstream = await startUpstream(png)
  const { encrypt } = require('../src/utils/crypto')
  const { ObjectId } = mongoose.Types
  const now = new Date()

  /* ---- what an install of the version without accounts looks like ---- */
  const legacy = { workflow: new ObjectId(), provider: new ObjectId(), run: new ObjectId(), finished: new ObjectId(), asset: new ObjectId(), kit: new ObjectId(), share: new ObjectId() }
  await db.collection('providers').createIndex({ slug: 1 }, { unique: true })
  await db.collection('modeloverrides').createIndex({ modelId: 1 }, { unique: true })
  await db.collection('templates').createIndex({ key: 1 }, { unique: true })
  await db.collection('providers').insertOne({ _id: legacy.provider, userId: 'local', type: 'gaorui', name: 'Old', slug: 'gaorui', baseUrl: upstream.baseUrl, apiKeyEnc: encrypt(KEY_LEGACY, process.env.SECRET_KEY), hasKey: true, keyTail: 'aaaa', customModels: [], schemaVersion: 3, enabled: true, sort: 0, createdAt: now, updatedAt: now })
  await db.collection('workflows').insertOne({ _id: legacy.workflow, userId: 'local', name: 'Old canvas', nodes: [{ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { text: 'hi' } }], edges: [], isDeleted: false, schemaVersion: 1, createdAt: now, updatedAt: now })
  const oldRun = { userId: 'local', kind: 'image', modelId: 'gaorui:nano-banana-2', upstreamModel: 'nano-banana-2', providerId: legacy.provider, providerType: 'gaorui', prompt: 'x', params: {}, count: 1, outputs: [], cost: { amount: 0, currency: '', unknown: true }, createdAt: now, updatedAt: now }
  await db.collection('runs').insertMany([
    // Interrupted mid-poll by the upgrade: resumed at the next start, before anybody has an account.
    { ...oldRun, _id: legacy.run, status: 'running', externalId: 'img-1', submittedAt: now, startedAt: now, billingStarted: true },
    { ...oldRun, _id: legacy.finished, status: 'succeeded', finishedAt: now },
  ])
  await db.collection('modeloverrides').insertOne({ userId: 'local', modelId: 'gaorui:nano-banana-2', pricing: { currency: 'CNY', unit: 'per_image', price: 0.5 }, createdAt: now, updatedAt: now })
  await db.collection('userassets').insertOne({ _id: legacy.asset, userId: 'local', kind: 'product', nodeType: 'IMAGE', name: 'Old asset', mediaUrl: '/files/uploads/2025/01/00000000000000000000000000000000.png', isDeleted: false, createdAt: now, updatedAt: now })
  await db.collection('brandkits').insertOne({ _id: legacy.kit, userId: 'local', name: 'Old kit', refImages: [], isDeleted: false, createdAt: now, updatedAt: now })
  await db.collection('shares').insertOne({ _id: legacy.share, userId: 'local', token: 'legacy-share-token-0123456789abcdefghij', sourceWorkflowId: legacy.workflow, title: 'Old share', snapshot: { nodes: [{ id: 'n1', type: 'text', data: { text: 'hi' } }], edges: [] }, revoked: false, isDeleted: false, expiresAt: null, createdAt: now, updatedAt: now })
  await db.collection('templates').insertMany([
    { userId: 'local', key: 'text-to-image', title: 'built in', builtin: true, isActive: true, graph: { nodes: [{ id: 'a' }, { id: 'b' }], edges: [] }, createdAt: now, updatedAt: now },
    { userId: 'local', key: 'mine', title: 'Hand-made template', builtin: false, isActive: true, graph: { nodes: [{ id: 'a' }], edges: [] }, createdAt: now, updatedAt: now },
  ])
  const ownedCollections = ['workflows', 'shares', 'userassets', 'brandkits', 'providers', 'modeloverrides', 'runs']
  const ownersOf = async (name, filter = {}) => (await db.collection(name).distinct('userId', filter)).sort()

  /* ---- start-up, as index.js does it ---- */
  const { setAllowedHosts } = require('../src/utils/safeFetch')
  setAllowedHosts(['127.0.0.1'])
  const settings = require('../src/services/settings')
  await settings.load()
  const accounts = require('../src/services/accounts')
  const auth = require('../src/middleware/auth')
  const waiting = await accounts.prepare()
  assert.deepEqual([waiting.users, waiting.adopted, waiting.legacyWaiting], [0, null, true], 'old data, nobody to give it to yet')
  for (const [name, index] of [['providers', 'slug_1'], ['modeloverrides', 'modelId_1'], ['templates', 'key_1']]) {
    assert.ok(!(await db.collection(name).indexes()).some((i) => i.name === index), `${name}.${index} (unique across the whole database) is gone`)
  }
  await require('../src/services/seed').seed()
  const runnerModule = require('../src/runner')
  const { getRunner } = runnerModule
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

  /** A client: remembers its token. `as(token)` talks as somebody else. */
  function client(token = '') {
    const self = {
      token,
      async call(method, pathname, body, headers = {}) {
        const h = { ...headers }
        if (self.token) h.Authorization = `Bearer ${self.token}`
        let payload
        if (body instanceof FormData) payload = body
        else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
        const res = await fetch(base + pathname, { method, headers: h, body: payload })
        return { status: res.status, headers: res.headers, body: await res.json() }
      },
      async data(method, pathname, body) {
        const r = await self.call(method, pathname, body)
        assert.equal(r.body.result, 0, `${method} ${pathname}: ${JSON.stringify(r.body).slice(0, 300)}`)
        return r.body.data
      },
      /** [status, code] of a call that is expected to be refused. */
      async refused(method, pathname, body) {
        const r = await self.call(method, pathname, body)
        return [r.status, r.body.code]
      },
    }
    return self
  }
  const anon = client()
  const A = client() // the first account: the owner
  const B = client() // an ordinary account
  async function waitRun(c, pathname, timeoutMs = 20000) {
    const end = Date.now() + timeoutMs
    for (;;) {
      const run = await c.data('GET', pathname)
      if (['succeeded', 'failed', 'canceled'].includes(run.status)) return run
      if (Date.now() > end) throw new Error(`still ${run.status}: ${pathname}`)
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  const upload = async (c) => {
    const form = new FormData()
    form.append('file', new Blob([png]), 'x.png')
    return c.data('POST', '/api/files/upload', form)
  }
  const fileExists = (key) => fs.existsSync(path.join(filesDir, key))

  await t.test('data from before accounts: untouched until the first account registers, which becomes the owner and takes all of it', async () => {
    // The interrupted run finishes although nobody owns it yet, with the old provider's key.
    const end = Date.now() + 20000
    let resumed
    do {
      await new Promise((r) => setTimeout(r, 150))
      resumed = await db.collection('runs').findOne({ _id: legacy.run })
    } while (resumed.status !== 'succeeded' && resumed.status !== 'failed' && Date.now() < end)
    assert.equal(resumed.status, 'succeeded', resumed.error)
    assert.ok(upstream.calls.some((c) => c.url === '/v1/nano-banana/img-1' && c.auth === KEY_LEGACY))
    assert.match(resumed.outputs[0].key, /^outputs\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/, 'no account, so no account segment in the key')

    const boot = (await anon.data('GET', '/api/bootstrap'))
    assert.deepEqual([boot.auth, boot.user], [{ registrationOpen: true, hasUsers: false }, null])
    for (const name of ownedCollections) assert.deepEqual(await ownersOf(name), ['local'], name)
    assert.deepEqual(await anon.refused('GET', `/api/workflow/${legacy.workflow}`), [401, 'auth.required'], 'unowned is not public')

    const reg = await A.call('POST', '/api/auth/register', { username: 'Alice', email: 'Alice@Example.com', password: 'alice-password-1' })
    assert.equal(reg.status, 200, JSON.stringify(reg.body))
    A.token = reg.body.data.token
    A.user = reg.body.data.user
    assert.deepEqual(Object.keys(A.user).sort(), ['createdAt', 'email', 'id', 'role', 'username'])
    assert.deepEqual([A.user.username, A.user.email, A.user.role], ['Alice', 'Alice@Example.com', 'owner'])

    for (const name of ownedCollections) assert.deepEqual(await ownersOf(name), [A.user.id], `${name} now belongs to the owner`)
    assert.deepEqual(await ownersOf('templates', { builtin: true }), ['system'], 'built-in templates belong to the site')
    assert.deepEqual(await ownersOf('templates', { builtin: { $ne: true } }), [A.user.id], 'a hand-made template is the owner\'s')
    assert.equal((await db.collection('users').findOne({})).legacyAdoption, 'done')

    // The owner sees the old data through the API, and the stored key still works.
    assert.deepEqual((await A.data('GET', '/api/workflow/list')).map((w) => w.name), ['Old canvas'])
    assert.equal((await A.data('GET', `/api/workflow/${legacy.workflow}`)).nodes[0].data.text, 'hi')
    const [provider] = await A.data('GET', '/api/admin/providers')
    assert.deepEqual([provider.id, provider.slug, provider.hasKey, provider.keyTail], [String(legacy.provider), 'gaorui', true, 'aaaa'])
    upstream.calls.length = 0
    assert.equal((await A.data('POST', `/api/admin/providers/${legacy.provider}/test`)).ok, true)
    assert.equal(upstream.calls[0].auth, KEY_LEGACY, 'decrypted with the same SECRET_KEY')
    assert.equal((await A.data('GET', `/api/runs/${legacy.run}`)).status, 'succeeded')
    assert.equal((await A.data('GET', '/api/admin/usage')).totals.runs, 2)
    assert.equal((await A.data('GET', '/api/admin/models')).find((m) => m.id === 'gaorui:nano-banana-2').pricing.price, 0.5, 'prices came along')
    assert.deepEqual((await A.data('GET', '/api/user-asset/list')).list.map((a) => a.name), ['Old asset'])
    assert.deepEqual((await A.data('GET', '/api/brand-kits')).map((k) => k.name), ['Old kit'])
    assert.deepEqual((await A.data('GET', '/api/canvas-share/mine')).list.map((s) => s.title), ['Old share'])
    assert.deepEqual((await A.data('GET', '/api/canvas/templates')).map((x) => x.key).sort(), ['image-to-video', 'mine', 'text-to-image'])
    // Addresses stored before accounts keep working: the file is where it was.
    assert.equal((await fetch(base + resumed.outputs[0].url)).status, 200)

    // Doing it again changes nothing.
    assert.deepEqual(await accounts.adoptLegacy(A.user.id), {})
    assert.deepEqual((await accounts.prepare()).adopted, null)
  })

  await t.test('registration: validation, uniqueness without regard to case, and the second account is a plain user that owns nothing', async () => {
    const reg = (body) => anon.refused('POST', '/api/auth/register', body)
    const good = { username: 'bob', email: 'bob@example.com', password: 'bob-password-1' }
    for (const username of ['ab', 'a'.repeat(33), 'has space', 'ünï', 'a@b', '', 7, null]) assert.deepEqual(await reg({ ...good, username }), [400, 'auth.invalid_username'], String(username))
    for (const email of ['nope', 'a@b', '@x.com', 'a b@x.com', '', 7]) assert.deepEqual(await reg({ ...good, email }), [400, 'auth.invalid_email'], String(email))
    auth.resetRateLimits()
    for (const password of ['short', 'x'.repeat(129), '', 12345678, { $gt: '' }]) assert.deepEqual(await reg({ ...good, password }), [400, 'auth.weak_password'], String(password))
    assert.deepEqual(await reg({ ...good, username: 'ALICE' }), [409, 'auth.username_taken'])
    assert.deepEqual(await reg({ ...good, email: 'alice@EXAMPLE.com' }), [409, 'auth.email_taken'])

    const made = await B.data('POST', '/api/auth/register', good)
    B.token = made.token
    B.user = made.user
    assert.equal(B.user.role, 'user')
    assert.equal(await db.collection('users').countDocuments({ role: 'owner' }), 1)
    for (const name of ownedCollections) assert.deepEqual(await ownersOf(name), [A.user.id], `${name}: nothing was given to the second account`)
    assert.deepEqual(await B.data('GET', '/api/workflow/list'), [])
    assert.deepEqual(await B.data('GET', '/api/admin/providers'), [])
    assert.deepEqual(await B.data('GET', '/api/models'), [])
    assert.equal((await B.data('GET', '/api/admin/usage')).totals.runs, 0)
    assert.deepEqual((await B.data('GET', '/api/canvas/templates')).map((x) => x.key).sort(), ['image-to-video', 'text-to-image'], 'built-in ones only')

    // Passwords: scrypt with its own salt and parameters, never the password; tokens: only a hash.
    const users = await db.collection('users').find({}).toArray()
    for (const row of users) assert.match(row.passwordHash, /^scrypt\$N=32768,r=8,p=1\$[\w-]{22}\$[\w-]{43}$/)
    assert.notEqual(users[0].passwordHash.split('$')[2], users[1].passwordHash.split('$')[2], 'a salt per account')
    const dump = JSON.stringify([users, await db.collection('sessions').find({}).toArray()])
    for (const secret of ['alice-password-1', 'bob-password-1', A.token, B.token]) assert.ok(!dump.includes(secret))
    assert.ok((await db.collection('sessions').findOne({ userId: B.user.id })).tokenHash === crypto.createHash('sha256').update(B.token).digest('hex'))

    // Data that turns up unowned once accounts exist is never handed to anybody...
    const stray = new ObjectId()
    await db.collection('workflows').insertOne({ _id: stray, userId: 'local', name: 'Stray', nodes: [], edges: [], isDeleted: false, createdAt: now, updatedAt: now })
    const again = await accounts.prepare()
    assert.deepEqual([again.adopted, again.legacyWaiting], [null, false])
    assert.equal((await db.collection('workflows').findOne({ _id: stray })).userId, 'local')
    for (const c of [A, B]) assert.ok(!(await c.data('GET', '/api/workflow/list')).some((w) => w.name === 'Stray'))
    // ...except when the hand-over to the owner was cut short: that one is finished at the next start.
    await db.collection('users').updateOne({ role: 'owner' }, { $set: { legacyAdoption: 'pending' } })
    assert.deepEqual((await accounts.prepare()).adopted, { workflows: 1 })
    assert.equal((await db.collection('workflows').findOne({ _id: stray })).userId, A.user.id)
    await db.collection('workflows').deleteOne({ _id: stray })
  })

  await t.test('sign-in: by username or email, one answer for every wrong combination, limited per account', async () => {
    auth.resetRateLimits()
    const login = (body) => anon.call('POST', '/api/auth/login', body)
    for (const account of ['bob', 'BOB', 'bob@example.com', ' Bob@Example.COM ']) {
      const r = await login({ account, password: 'bob-password-1' })
      assert.deepEqual([r.status, r.body.data.user.id], [200, B.user.id], account)
    }
    const wrong = await login({ account: 'bob', password: 'not-the-password' })
    const nobody = await login({ account: 'nobody-here', password: 'not-the-password' })
    assert.deepEqual([wrong.status, wrong.body.code], [401, 'auth.invalid_credentials'])
    assert.deepEqual([nobody.status, nobody.body.code, nobody.body.message], [401, 'auth.invalid_credentials', wrong.body.message], 'an unknown account reads exactly like a wrong password')
    assert.deepEqual(await anon.refused('POST', '/api/auth/login', { account: 'bob' }), [400, 'auth.credentials_required'])
    assert.deepEqual(await anon.refused('POST', '/api/auth/login', { account: { $ne: '' }, password: { $ne: '' } }), [400, 'auth.credentials_required'])

    // Expiry: twelve hours, or thirty days when asked to remember.
    const hours = async (token) => ((await db.collection('sessions').findOne({ tokenHash: crypto.createHash('sha256').update(token).digest('hex') })).expiresAt - Date.now()) / 3600000
    const short = (await login({ account: 'bob', password: 'bob-password-1' })).body.data.token
    const long = (await login({ account: 'bob', password: 'bob-password-1', remember: true })).body.data.token
    assert.ok(Math.abs(await hours(short) - 12) < 0.1 && Math.abs(await hours(long) - 720) < 0.1)
    // A session past its expiry is refused even before the database has removed it.
    await db.collection('sessions').updateOne({ tokenHash: crypto.createHash('sha256').update(short).digest('hex') }, { $set: { expiresAt: new Date(Date.now() - 1000) } })
    assert.deepEqual(await client(short).refused('GET', '/api/auth/me'), [401, 'auth.required'])

    // One name from one address: ten tries, and that limit belongs to the address that made them.
    auth.resetRateLimits()
    const { LOGIN_LIMITS } = auth
    const guess = (ip, account = 'Alice') => new Promise((resolve) => {
      // Straight through the limiter, as requests from different addresses would arrive.
      const req = { ip }
      auth.loginRateLimit(req, {}, (err) => (err ? resolve(err) : auth.countAccountAttempt(req, {}, account).then(resolve, resolve)))
    })
    for (let i = 0; i < LOGIN_LIMITS.perPair; i++) assert.equal(typeof (await guess('198.51.100.1')), 'function')
    const slowed = await guess('198.51.100.1')
    assert.deepEqual([slowed.status, slowed.code], [429, 'auth.too_many_attempts'])
    assert.ok(slowed.data.retryAfterSeconds > 0 && slowed.data.retryAfterSeconds <= LOGIN_LIMITS.windowMs / 1000)
    assert.equal((await login({ account: 'alice', password: 'alice-password-1' })).status, 200, 'ten wrong guesses by a stranger do not lock the holder out')

    // One name from many addresses: a much higher ceiling, which stops strangers...
    const fill = async () => {
      for (let i = 0; i < LOGIN_LIMITS.perAccount; i++) {
        const r = await guess(`198.51.${100 + (i >> 7)}.${(i & 127) + 1}`)
        if (typeof r !== 'function') return
      }
    }
    const aliceSessions = { userId: A.user.id }
    const realIp = (await db.collection('sessions').findOne(aliceSessions)).ip
    await db.collection('sessions').updateMany(aliceSessions, { $set: { ip: '203.0.113.9' } })
    auth.resetRateLimits()
    await fill()
    const locked = await guess('192.0.2.200')
    assert.deepEqual([locked.status, locked.code], [429, 'auth.too_many_attempts'])
    // ...over HTTP the same refusal, with the wait in the body and in Retry-After - for the right password too,
    // when it comes from an address the account has never been seen at.
    const refused = await login({ account: 'alice', password: 'alice-password-1' })
    assert.deepEqual([refused.status, refused.body.code], [429, 'auth.too_many_attempts'])
    assert.equal(refused.body.data.retryAfterSeconds, Number(refused.headers.get('retry-after')))
    const unknownName = await guess('192.0.2.201', 'nobody-here')
    assert.equal(typeof unknownName, 'function', 'the ceiling is per name')
    assert.equal((await login({ account: 'bob', password: 'bob-password-1' })).status, 200, 'another account is not affected')
    // ...but not the holder at an address one of their sessions was opened from,
    await db.collection('sessions').updateMany(aliceSessions, { $set: { ip: realIp } })
    assert.equal((await login({ account: 'alice', password: 'not-it' })).status, 401, 'the holder still gets a real answer')
    assert.equal((await login({ account: 'alice', password: 'alice-password-1' })).status, 200, 'and gets in, mid-attack')
    // nor at an address a sign-in succeeded from before (remembered without the session).
    await db.collection('sessions').updateMany(aliceSessions, { $set: { ip: '203.0.113.9' } })
    auth.resetRateLimits({ keepKnown: true })
    await fill()
    assert.equal((await guess('192.0.2.200')).status, 429)
    assert.equal((await login({ account: 'alice', password: 'alice-password-1' })).status, 200, 'known address, no session needed')
    await db.collection('sessions').updateMany({ ...aliceSessions, ip: '203.0.113.9' }, { $set: { ip: realIp } })

    // Everybody together: a ceiling over all names and addresses, with the same exemption.
    auth.resetRateLimits()
    let through = 0
    for (let i = 0; i < LOGIN_LIMITS.global + 5; i++) {
      if (typeof (await guess(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, `name-${i}`)) === 'function') through++
    }
    assert.equal(through, LOGIN_LIMITS.global)
    assert.equal((await login({ account: 'nobody-here', password: 'x' })).status, 429)
    assert.equal((await login({ account: 'alice', password: 'alice-password-1' })).status, 200, 'an account at its usual address is not shut out by a flood')
    // Creating accounts is limited per address as well.
    auth.resetRateLimits()
    for (let i = 0; i < auth.REGISTER_LIMITS.perClient; i++) assert.equal((await anon.call('POST', '/api/auth/register', {})).status, 400)
    assert.deepEqual(await anon.refused('POST', '/api/auth/register', { username: 'dave', email: 'dave@example.com', password: 'dave-password-1' }), [429, 'auth.too_many_attempts'])
    assert.equal(await db.collection('users').countDocuments({ usernameLower: 'dave' }), 0)
    // Per address, across names: one client cannot work through a list of accounts.
    auth.resetRateLimits()
    for (let i = 0; i < LOGIN_LIMITS.perClient; i++) assert.equal((await login({ account: `ghost-${i}`, password: 'x' })).status, 401)
    assert.equal((await login({ account: 'bob', password: 'bob-password-1' })).status, 429)
    auth.resetRateLimits()
  })

  await t.test('sessions: listed, ended one by one or all at once, and a changed password ends the others', async () => {
    const login = async (remember) => client((await anon.data('POST', '/api/auth/login', { account: 'bob', password: 'bob-password-1', remember })).token)
    await db.collection('sessions').deleteMany({ userId: B.user.id, tokenHash: { $ne: crypto.createHash('sha256').update(B.token).digest('hex') } })
    const phone = await login(true)
    const laptop = await login(false)
    const sessions = await B.data('GET', '/api/auth/sessions')
    assert.equal(sessions.length, 3)
    assert.deepEqual(Object.keys(sessions[0]).sort(), ['createdAt', 'current', 'id', 'ip', 'lastSeenAt', 'userAgent'])
    assert.deepEqual(sessions.filter((s) => s.current).length, 1)
    assert.ok(sessions.every((s) => s.ip && s.userAgent))
    assert.equal((await A.data('GET', '/api/auth/sessions')).every((s) => !sessions.some((b) => b.id === s.id)), true, 'only my own')

    // Ending a session by id: mine works, somebody else's is "not found".
    const phoneId = (await phone.data('GET', '/api/auth/sessions')).find((s) => s.current).id
    assert.deepEqual(await A.refused('DELETE', `/api/auth/sessions/${phoneId}`), [404, 'auth.session_not_found'])
    assert.equal((await phone.call('GET', '/api/auth/me')).status, 200, 'still alive after the stranger\'s attempt')
    await B.data('DELETE', `/api/auth/sessions/${phoneId}`)
    assert.deepEqual(await phone.refused('GET', '/api/auth/me'), [401, 'auth.required'])
    assert.deepEqual(await B.refused('DELETE', `/api/auth/sessions/${phoneId}`), [404, 'auth.session_not_found'])

    // Logout ends exactly the session it came with.
    await laptop.data('POST', '/api/auth/logout')
    assert.deepEqual(await laptop.refused('GET', '/api/workflow/list'), [401, 'auth.required'])
    assert.equal((await B.call('GET', '/api/auth/me')).status, 200)

    // "Sign out everywhere else".
    const other = await login(false)
    assert.deepEqual(await B.data('DELETE', '/api/auth/sessions'), { revoked: 1 })
    assert.deepEqual(await other.refused('GET', '/api/auth/me'), [401, 'auth.required'])

    // Password: the current one is required; afterwards every other session is gone and the old password is dead.
    const tablet = await login(false)
    assert.deepEqual(await B.refused('PUT', '/api/auth/password', { currentPassword: 'wrong', newPassword: 'bob-password-2' }), [400, 'auth.wrong_current_password'])
    assert.deepEqual(await B.refused('PUT', '/api/auth/password', { currentPassword: 'bob-password-1', newPassword: 'short' }), [400, 'auth.weak_password'])
    const beforeChange = B.token
    const hashOf = (token) => crypto.createHash('sha256').update(token).digest('hex')
    const oldRow = await db.collection('sessions').findOne({ tokenHash: hashOf(beforeChange) })
    const changed = await B.data('PUT', '/api/auth/password', { currentPassword: 'bob-password-1', newPassword: 'bob-password-2' })
    assert.deepEqual(Object.keys(changed).sort(), ['revokedSessions', 'token'])
    assert.equal(changed.revokedSessions, 1, 'the other sessions, not counting the one that was replaced')
    // The session that asked is replaced: a copy of the old token is dead, the new one carries on with the same expiry.
    assert.match(changed.token, /^[A-Za-z0-9_-]{43}$/)
    assert.notEqual(changed.token, beforeChange)
    assert.deepEqual(await client(beforeChange).refused('GET', '/api/auth/me'), [401, 'auth.required'])
    B.token = changed.token
    assert.equal((await B.call('GET', '/api/auth/me')).status, 200, 'the caller stays signed in, on the new token')
    const newRow = await db.collection('sessions').findOne({ tokenHash: hashOf(changed.token) })
    assert.deepEqual([newRow.expiresAt.getTime(), newRow.remember, newRow.userId], [oldRow.expiresAt.getTime(), oldRow.remember, oldRow.userId])
    assert.equal(await db.collection('sessions').countDocuments({ userId: B.user.id }), 1)
    assert.deepEqual(await tablet.refused('GET', '/api/auth/me'), [401, 'auth.required'])
    assert.deepEqual(await anon.refused('POST', '/api/auth/login', { account: 'bob', password: 'bob-password-1' }), [401, 'auth.invalid_credentials'])
    assert.equal((await anon.call('POST', '/api/auth/login', { account: 'bob', password: 'bob-password-2' })).status, 200)
    auth.resetRateLimits()

    // Profile: both fields optional, same rules and uniqueness as at registration.
    assert.deepEqual(await B.refused('PUT', '/api/auth/profile', {}), [400, 'common.nothing_to_update'])
    assert.deepEqual(await B.refused('PUT', '/api/auth/profile', { username: 'alice' }), [409, 'auth.username_taken'])
    assert.deepEqual(await B.refused('PUT', '/api/auth/profile', { email: 'ALICE@example.com' }), [409, 'auth.email_taken'])
    assert.deepEqual(await B.refused('PUT', '/api/auth/profile', { username: 'x' }), [400, 'auth.invalid_username'])
    const renamed = (await B.data('PUT', '/api/auth/profile', { username: 'Bobby', email: 'bobby@example.com' })).user
    assert.deepEqual([renamed.id, renamed.username, renamed.email, renamed.role], [B.user.id, 'Bobby', 'bobby@example.com', 'user'])
    assert.equal((await B.data('PUT', '/api/auth/profile', { username: 'BOBBY' })).user.username, 'BOBBY', 'my own name in another case is not "taken"')
    assert.equal((await anon.call('POST', '/api/auth/login', { account: 'bobby@example.com', password: 'bob-password-2' })).status, 200)
    B.user = (await B.data('PUT', '/api/auth/profile', { username: 'bob', email: 'bob@example.com' })).user
    assert.deepEqual((await B.data('GET', '/api/auth/me')).user, B.user)
    // Nothing but username and email can be set here, whatever else is sent along.
    const stuffed = (await B.data('PUT', '/api/auth/profile', { email: 'bob@example.com', role: 'owner', disabled: true, userId: A.user.id, _id: A.user.id, passwordHash: 'x', legacyAdoption: 'pending' })).user
    assert.deepEqual(stuffed, B.user)
    const row = await db.collection('users').findOne({ usernameLower: 'bob' })
    assert.deepEqual([row.role, !!row.disabled, String(row._id), row.legacyAdoption || ''], ['user', false, B.user.id, ''])
    assert.match(row.passwordHash, /^scrypt\$/)

    // Each answer says whether a name or an email is taken, so the tries per account are bounded.
    auth.resetRateLimits()
    for (let i = 0; i < auth.PROFILE_LIMITS.perAccount; i++) assert.deepEqual(await B.refused('PUT', '/api/auth/profile', { email: 'alice@example.com' }), [409, 'auth.email_taken'])
    const capped = await B.call('PUT', '/api/auth/profile', { email: 'alice@example.com' })
    assert.deepEqual([capped.status, capped.body.code, capped.body.data.retryAfterSeconds > 0], [429, 'auth.too_many_attempts', true])
    assert.equal((await A.call('PUT', '/api/auth/profile', { username: A.user.username })).status, 200, 'another account is not affected')
    auth.resetRateLimits()
  })

  /* ---- the same set of things for each account ---- */
  const own = {}
  async function populate(c, name, apiKey) {
    const o = { name }
    // The owner already has the old "gaorui" provider; its own second one would be gaorui-2.
    if (name === 'A') {
      o.provider = await c.data('PUT', `/api/admin/providers/${legacy.provider}`, { apiKey })
    } else {
      o.provider = await c.data('POST', '/api/admin/providers', { type: 'gaorui', baseUrl: upstream.baseUrl, apiKey })
    }
    await c.data('POST', `/api/admin/providers/${o.provider.id}/models`, { model: `only-${name.toLowerCase()}-chat`, kind: 'chat' })
    await c.data('PUT', `/api/admin/models/${encodeURIComponent('gaorui:nano-banana-2')}`, { pricing: { currency: 'CNY', unit: 'per_image', price: name === 'A' ? 1 : 2 }, label: `Banana of ${name}` })
    o.workflow = await c.data('POST', '/api/workflow', { name: `Canvas of ${name}`, nodes: [{ id: 'n1', type: 'text', position: { x: 0, y: 0 }, data: { text: `secret of ${name}` } }] })
    o.share = await c.data('POST', '/api/canvas-share/publish', { workflowId: o.workflow.id, title: `Share of ${name}` })
    o.file = await upload(c)
    o.asset = await c.data('POST', '/api/user-asset', { name: `Asset of ${name}`, mediaUrl: o.file.url, folder: `folder-${name}` })
    o.kit = await c.data('POST', '/api/brand-kits', { name: `Kit of ${name}`, isDefault: true })
    o.runId = (await c.data('POST', '/api/runs', { model: 'gaorui:nano-banana-2', prompt: `prompt of ${name}`, workflowId: o.workflow.id })).runId
    o.taskId = (await c.data('POST', '/api/llm/tasks', { model: `gaorui:only-${name.toLowerCase()}-chat`, prompt: `question of ${name}` })).taskId
    o.session = (await c.data('GET', '/api/auth/sessions')).find((s) => s.current).id
    o.run = await waitRun(c, `/api/runs/${o.runId}`)
    const end = Date.now() + 20000
    do { o.task = await c.data('GET', `/api/llm/tasks/${o.taskId}`) } while (!['succeeded', 'failed'].includes(o.task.status) && Date.now() < end && await new Promise((r) => setTimeout(r, 150, true)))
    return o
  }

  await t.test('each account brings its own key: same slug, same model id, different provider, key, price and files', async () => {
    upstream.calls.length = 0
    globalThis.__lcBilling.length = 0
    own.A = await populate(A, 'A', KEY_A)
    own.B = await populate(B, 'B', KEY_B)
    assert.deepEqual([own.A.provider.slug, own.B.provider.slug], ['gaorui', 'gaorui'], 'slugs are unique per account, not across the site')
    assert.notEqual(own.A.provider.id, own.B.provider.id)

    for (const [o, key, price, user] of [[own.A, KEY_A, 1, A.user], [own.B, KEY_B, 2, B.user]]) {
      assert.equal(o.run.status, 'succeeded', o.run.error)
      assert.equal(o.task.status, 'succeeded', o.task.error)
      assert.deepEqual([o.run.modelLabel, o.run.cost.amount], [`Banana of ${o.name}`, price], 'the account\'s own label and price')
      const stored = await db.collection('runs').findOne({ _id: new ObjectId(o.runId) })
      assert.deepEqual([stored.userId, String(stored.providerId)], [user.id, o.provider.id])
      // Every upstream call for this account's prompt carried this account's key.
      const submits = upstream.calls.filter((c) => c.url === '/v1/nano-banana' && c.body.prompt === `prompt of ${o.name}`)
      assert.deepEqual(submits.map((c) => c.auth), [key])
      const chats = upstream.calls.filter((c) => c.url === '/v1/chat/completions' && JSON.stringify(c.body).includes(`question of ${o.name}`))
      assert.deepEqual(chats.map((c) => c.auth), [key])
      // Files live under the account's own prefix; the thumbnail next to them.
      assert.ok(o.file.key.startsWith(`uploads/${user.id}/`) && o.run.outputs[0].url.startsWith(`/files/outputs/${user.id}/`))
      assert.ok(o.run.outputs[0].thumbnailUrl.startsWith(`/files/thumbs/of/outputs/${user.id}/`))
      assert.equal((await fetch(base + o.run.outputs[0].url)).status, 200, 'a file address is public to whoever has it')
      // The billing hook is told whose run it is.
      const told = globalThis.__lcBilling.filter((e) => e.runId === o.runId)
      assert.deepEqual(told.map((e) => [e.hook, e.userId, e.username]), [['beforeRun', user.id, user.username], ['afterRun', user.id, user.username]])
    }
    assert.ok(!upstream.calls.some((c) => c.auth === KEY_LEGACY), 'the replaced key is not used any more')
    const tool = await B.data('POST', '/api/canvas/tool/fit', { imageUrl: own.B.file.url, ratio: '1:1' })
    assert.ok(tool.url.startsWith(`/files/tools/${B.user.id}/`))
    assert.equal((await A.data('GET', '/api/bootstrap')).hasProvider, true)
  })

  await t.test('isolation: an account gets 404 for every resource of another account by id, and nothing is changed', async () => {
    const snapshot = async () => JSON.stringify(await Promise.all(
      ['workflows', 'shares', 'userassets', 'brandkits', 'providers', 'modeloverrides', 'runs', 'sessions'].map((n) => db.collection(n).find({}).sort({ _id: 1 }).project({ lastSeenAt: 0, 'stats.viewCount': 0 }).toArray())
    ))
    const before = await snapshot()

    /** Everything addressed by an id, as [method, path, body]. `v` is the victim's set of things. */
    const byId = (v) => {
      const enc = encodeURIComponent
      const custom = `only-${v.name.toLowerCase()}-chat`
      return [
        ['GET', `/api/workflow/${v.workflow.id}`],
        ['PUT', `/api/workflow/${v.workflow.id}`, { name: 'taken over', nodes: [] }],
        ['DELETE', `/api/workflow/${v.workflow.id}`],
        ['POST', `/api/workflow/${v.workflow.id}/duplicate`, {}],
        ['POST', `/api/workflow/${v.workflow.id}/download-zip`, {}],
        ['POST', '/api/canvas-share/publish', { workflowId: v.workflow.id }],
        ['PUT', `/api/canvas-share/${v.share.id}`, { title: 'taken over', revoked: true }],
        ['POST', `/api/canvas-share/${v.share.id}/revoke`],
        ['DELETE', `/api/canvas-share/${v.share.id}`],
        // The database id of a share is never a way to read it, for anybody.
        ['GET', `/api/canvas-share/${v.share.id}`],
        ['POST', `/api/canvas-share/${v.share.id}/copy`, {}],
        ['PUT', `/api/user-asset/${v.asset.id}`, { name: 'taken over' }],
        ['DELETE', `/api/user-asset/${v.asset.id}`],
        ['PUT', `/api/brand-kits/${v.kit.id}`, { name: 'taken over' }],
        ['DELETE', `/api/brand-kits/${v.kit.id}`],
        ['PUT', `/api/admin/providers/${v.provider.id}`, { name: 'taken over', apiKey: 'sk-attacker-key-0000000000', baseUrl: 'http://127.0.0.1:1' }],
        ['DELETE', `/api/admin/providers/${v.provider.id}`],
        ['POST', `/api/admin/providers/${v.provider.id}/test`],
        ['POST', `/api/admin/providers/${v.provider.id}/models`, { model: 'planted', kind: 'chat' }],
        ['PUT', `/api/admin/providers/${v.provider.id}/models/${enc(custom)}`, { label: 'taken over' }],
        ['DELETE', `/api/admin/providers/${v.provider.id}/models/${enc(custom)}`],
        // A model id only means something inside an account: the other account's custom model does not exist here.
        ['PUT', `/api/admin/models/${enc(`gaorui:${custom}`)}`, { enabled: false }],
        ['GET', `/api/runs/${v.runId}`],
        ['POST', `/api/runs/${v.runId}/cancel`],
        ['GET', `/api/runs/${v.taskId}`],
        ['GET', `/api/llm/tasks/${v.taskId}`],
        ['POST', `/api/runs/${v.taskId}/cancel`],
        ['DELETE', `/api/auth/sessions/${v.session}`],
      ]
    }
    for (const [attacker, victim, who] of [[B, own.A, 'B -> A'], [A, own.B, 'the owner -> B']]) {
      for (const [method, pathname, body] of byId(victim)) {
        const r = await attacker.call(method, pathname, body)
        assert.equal(r.status, 404, `${who}: ${method} ${pathname} -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
        assert.equal(r.body.data, null, `${who}: ${method} ${pathname}`)
        assert.ok(!JSON.stringify(r.body).includes(`of ${victim.name}`), `${who}: ${method} ${pathname} leaks`)
      }
      // Batch polling answers with nothing for ids that are not mine.
      assert.deepEqual(await attacker.data('POST', '/api/runs/status', { ids: [victim.runId, victim.taskId] }), [])
      // The other account's model id cannot be run or priced: with my own "gaorui" it resolves to my provider, never theirs.
      assert.deepEqual(await attacker.refused('POST', '/api/llm/tasks', { model: `gaorui:only-${victim.name.toLowerCase()}-chat`, prompt: 'x' }), [400, 'model.unavailable'])
      assert.deepEqual(await attacker.refused('POST', '/api/runs/estimate', { model: `gaorui:only-${victim.name.toLowerCase()}-chat` }), [400, 'model.unavailable'])
      // Clearing usage is clearing my own.
      await attacker.data('DELETE', '/api/admin/usage/records?before=2999-01-01')
    }
    // The two clean-ups above removed each account's own finished records and nothing else; put them back for the comparison.
    const after = JSON.parse(await snapshot())
    const was = JSON.parse(before)
    assert.equal(after[6].length, 0, 'each account cleared its own usage')
    after[6] = was[6]
    assert.equal(JSON.stringify(after), JSON.stringify(was), 'no document of anybody was created, changed or removed by the refused calls')
    await db.collection('runs').insertMany(was[6].map((r) => ({ ...r, _id: new ObjectId(r._id), providerId: new ObjectId(r.providerId), createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt), finishedAt: r.finishedAt ? new Date(r.finishedAt) : null })))
    assert.equal((await fetch(base + own.A.share.token.replace(/^/, '/api/canvas-share/'))).status, 200, 'the share link of A still works')
  })

  await t.test('isolation: lists and totals never mix accounts', async () => {
    const views = async (c) => ({
      workflows: (await c.data('GET', '/api/workflow/list')).map((w) => w.name),
      mine: (await c.data('GET', '/api/canvas-share/mine')).list.map((s) => s.title),
      plaza: (await c.data('GET', '/api/canvas-share/plaza')).list.map((s) => s.title),
      assets: (await c.data('GET', '/api/user-asset/list')).list.map((a) => a.name),
      folders: (await c.data('GET', '/api/user-asset/list')).folders,
      kits: (await c.data('GET', '/api/brand-kits')).map((k) => [k.name, k.isDefault]),
      providers: (await c.data('GET', '/api/admin/providers')).map((p) => [p.id, p.keyTail]),
      custom: (await c.data('GET', '/api/admin/models')).filter((m) => m.custom).map((m) => m.id),
      chat: (await c.data('GET', '/api/models?kind=chat')).filter((m) => m.custom).map((m) => m.id),
      label: (await c.data('GET', '/api/models')).find((m) => m.id === 'gaorui:nano-banana-2').label,
      usage: (await c.data('GET', '/api/admin/usage?groupBy=model')).items.map((i) => [i.key, i.runs]).sort(),
      records: (await c.data('GET', '/api/admin/usage/records')).list.map((r) => r.prompt).sort(),
      sessions: (await c.data('GET', '/api/auth/sessions')).length,
    })
    const a = await views(A)
    const b = await views(B)
    assert.deepEqual(b, {
      workflows: ['Canvas of B'],
      mine: ['Share of B'],
      plaza: ['Share of B'],
      assets: ['Asset of B'],
      folders: ['folder-B'],
      kits: [['Kit of B', true]],
      providers: [[own.B.provider.id, 'cccc']],
      custom: ['gaorui:only-b-chat'],
      chat: ['gaorui:only-b-chat'],
      label: 'Banana of B',
      usage: [['gaorui:nano-banana-2', 1], ['gaorui:only-b-chat', 1]],
      records: ['prompt of B', 'question of B'],
      sessions: b.sessions,
    })
    assert.deepEqual([a.workflows.sort(), a.mine.sort(), a.assets.sort(), a.folders, a.custom, a.label], [['Canvas of A', 'Old canvas'], ['Old share', 'Share of A'], ['Asset of A', 'Old asset'], ['folder-A'], ['gaorui:only-a-chat'], 'Banana of A'])
    assert.deepEqual(a.kits.sort(), [['Kit of A', true], ['Old kit', false]], 'making B\'s kit the default did not clear A\'s default')
    assert.deepEqual(a.providers, [[own.A.provider.id, 'bbbb']])
    assert.ok(!JSON.stringify(a).includes('of B') && !JSON.stringify(b).includes('of A') && !JSON.stringify(b).includes('Old '))
    // Dissolving a folder touches my own assets only, even when the other account uses the same name.
    await db.collection('userassets').updateOne({ _id: new ObjectId(own.A.asset.id) }, { $set: { folder: 'shared-name' } })
    await db.collection('userassets').updateOne({ _id: new ObjectId(own.B.asset.id) }, { $set: { folder: 'shared-name' } })
    assert.deepEqual(await B.data('POST', '/api/user-asset/folder/delete', { name: 'shared-name' }), { moved: 1 })
    assert.equal((await db.collection('userassets').findOne({ _id: new ObjectId(own.A.asset.id) })).folder, 'shared-name')

    // A share link is the one thing meant to cross accounts: whoever has the token may read and copy.
    const read = await B.data('GET', `/api/canvas-share/${own.A.share.token}`)
    assert.equal(read.nodes[0].data.text, 'secret of A')
    assert.ok(!('userId' in read) && !('workflowId' in read), 'nothing about the publishing account')
    const copy = await B.data('POST', `/api/canvas-share/${own.A.share.token}/copy`, {})
    assert.equal((await db.collection('workflows').findOne({ _id: new ObjectId(copy.workflowId) })).userId, B.user.id, 'the copy is the copier\'s')
    assert.deepEqual((await A.data('GET', '/api/workflow/list')).map((w) => w.name).sort(), ['Canvas of A', 'Old canvas'])
    // Revoked by its owner, it is gone for everybody.
    await A.data('POST', `/api/canvas-share/${own.A.share.id}/revoke`)
    assert.deepEqual(await B.refused('GET', `/api/canvas-share/${own.A.share.token}`), [404, 'share.gone'])
  })

  await t.test('limits: an account has its own ceiling on unfinished runs, under the one for the whole site', async () => {
    await A.data('PUT', '/api/admin/settings', { userQueueLimit: 1 })
    try {
      const first = await B.data('POST', '/api/runs', { model: 'gaorui:nano-banana-2', prompt: 'never' })
      assert.deepEqual(await B.refused('POST', '/api/runs', { model: 'gaorui:nano-banana-2', prompt: 'never' }), [429, 'run.queue_full'])
      const mine = await A.call('POST', '/api/runs', { model: 'gaorui:nano-banana-2', prompt: 'never' })
      assert.equal(mine.status, 200, 'B being full does not stop A')
      runnerModule.limits.unfinishedRuns = 2
      await A.data('PUT', '/api/admin/settings', { userQueueLimit: 200 })
      assert.deepEqual(await A.refused('POST', '/api/runs', { model: 'gaorui:nano-banana-2', prompt: 'never' }), [429, 'run.queue_full'], 'the site as a whole is full')
      await B.data('POST', `/api/runs/${first.runId}/cancel`)
      await A.data('POST', `/api/runs/${mine.body.data.runId}/cancel`)
    } finally {
      runnerModule.limits.unfinishedRuns = 500
      await A.data('PUT', '/api/admin/settings', { userQueueLimit: 200 })
    }
  })

  await t.test('restart: unfinished runs of two accounts resume, each against its own provider and into its own files', async () => {
    const Run = require('../src/models/Run')
    const common = { kind: 'image', modelId: 'gaorui:nano-banana-2', upstreamModel: 'nano-banana-2', providerType: 'gaorui', prompt: 'x', billingStarted: true, status: 'running', externalId: 'img-1', submittedAt: new Date(), startedAt: new Date() }
    const ra = await Run.create({ ...common, userId: A.user.id, providerId: own.A.provider.id })
    const rb = await Run.create({ ...common, userId: B.user.id, providerId: own.B.provider.id })
    const lost = await Run.create({ ...common, userId: B.user.id, providerId: own.B.provider.id, externalId: '' })
    upstream.calls.length = 0
    assert.equal(await getRunner().start(), 2)
    const [doneA, doneB] = [await waitRun(A, `/api/runs/${ra._id}`), await waitRun(B, `/api/runs/${rb._id}`)]
    assert.deepEqual([doneA.status, doneB.status], ['succeeded', 'succeeded'], `${doneA.error} ${doneB.error}`)
    assert.ok(doneA.outputs[0].url.startsWith(`/files/outputs/${A.user.id}/`) && doneB.outputs[0].url.startsWith(`/files/outputs/${B.user.id}/`))
    const polls = upstream.calls.filter((c) => c.url === '/v1/nano-banana/img-1').map((c) => c.auth).sort()
    assert.deepEqual(polls, [KEY_A, KEY_B].sort(), 'one poll each, with the key of the account the run belongs to')
    assert.ok(!upstream.calls.some((c) => c.method === 'POST'), 'nothing was submitted again')
    assert.deepEqual([(await B.data('GET', `/api/runs/${lost._id}`)).errorCode], ['run.interrupted'])
    assert.deepEqual(await A.refused('GET', `/api/runs/${rb._id}`), [404, 'run.not_found'])
  })

  await t.test('the owner: site settings, storage and accounts are the owner\'s; an ordinary account gets 403', async () => {
    for (const [m, p, body] of [
      ['GET', '/api/admin/users'], ['PATCH', `/api/admin/users/${A.user.id}`, { disabled: true }], ['DELETE', `/api/admin/users/${A.user.id}?confirm=Alice`],
      ['POST', `/api/admin/users/${A.user.id}/reset-password`], ['GET', '/api/admin/site'], ['PUT', '/api/admin/site', { registrationOpen: false }],
      ['GET', '/api/admin/settings'], ['PUT', '/api/admin/settings', { siteName: 'Mine now' }],
      ['GET', '/api/admin/storage'], ['PUT', '/api/admin/storage', { driver: 'local' }], ['POST', '/api/admin/storage/test', { s3: {} }],
    ]) {
      assert.deepEqual(await B.refused(m, p, body), [403, 'auth.forbidden'], `${m} ${p}`)
      assert.equal((await anon.call(m, p, body)).status, 401, `${m} ${p}`)
    }
    assert.equal(settings.get('siteName'), 'LoomCanvas')
    // What is per account stays open to everybody who is signed in.
    for (const p of ['/api/admin/vendors', '/api/admin/providers', '/api/admin/models', '/api/admin/usage', '/api/admin/usage/records']) assert.equal((await B.call('GET', p)).status, 200, p)

    const users = await A.data('GET', '/api/admin/users')
    assert.deepEqual(users.map((x) => [x.username, x.role, x.disabled]), [['Alice', 'owner', false], ['bob', 'user', false]])
    assert.deepEqual(Object.keys(users[1]).sort(), ['counts', 'createdAt', 'disabled', 'email', 'id', 'lastLoginAt', 'role', 'username'])
    const wf = await db.collection('workflows').countDocuments({ userId: B.user.id, isDeleted: false })
    assert.deepEqual(users[1].counts, { workflows: wf, runs: await db.collection('runs').countDocuments({ userId: B.user.id }) })
    assert.ok(users[1].lastLoginAt && !JSON.stringify(users).includes('scrypt'))

    // Registration can be closed; existing accounts keep signing in.
    assert.deepEqual(await A.data('GET', '/api/admin/site'), { registrationOpen: true })
    assert.deepEqual(await A.refused('PUT', '/api/admin/site', { registrationOpen: 'no' }), [400, 'validation.boolean'])
    assert.deepEqual(await A.data('PUT', '/api/admin/site', { registrationOpen: false }), { registrationOpen: false })
    assert.deepEqual((await anon.data('GET', '/api/bootstrap')).auth, { registrationOpen: false, hasUsers: true })
    assert.deepEqual(await anon.refused('POST', '/api/auth/register', { username: 'carol', email: 'carol@example.com', password: 'carol-password-1' }), [403, 'auth.registration_closed'])
    assert.equal((await anon.call('POST', '/api/auth/login', { account: 'bob', password: 'bob-password-2' })).status, 200)
    await A.data('PUT', '/api/admin/site', { registrationOpen: true })

    // The owner account itself is not a target.
    for (const [m, p, body] of [['PATCH', `/api/admin/users/${A.user.id}`, { disabled: true }], ['DELETE', `/api/admin/users/${A.user.id}?confirm=Alice`], ['POST', `/api/admin/users/${A.user.id}/reset-password`]]) {
      assert.deepEqual(await A.refused(m, p, body), [400, 'auth.cannot_modify_self'], `${m} ${p}`)
    }
    assert.deepEqual(await A.refused('PATCH', `/api/admin/users/${new ObjectId()}`, { disabled: true }), [404, 'auth.user_not_found'])

    // Disable: signed out at once, cannot sign in, data untouched; enable brings it back.
    assert.deepEqual(await A.refused('PATCH', `/api/admin/users/${B.user.id}`, { disabled: 'yes' }), [400, 'validation.boolean'])
    assert.equal((await A.data('PATCH', `/api/admin/users/${B.user.id}`, { disabled: true })).disabled, true)
    assert.deepEqual(await B.refused('GET', '/api/workflow/list'), [401, 'auth.required'])
    assert.deepEqual(await anon.refused('POST', '/api/auth/login', { account: 'bob', password: 'bob-password-2' }), [403, 'auth.account_disabled'])
    assert.deepEqual(await anon.refused('POST', '/api/auth/login', { account: 'bob', password: 'wrong-password' }), [401, 'auth.invalid_credentials'], 'without the password nobody learns the account is disabled')
    assert.equal((await A.data('PATCH', `/api/admin/users/${B.user.id}`, { disabled: false })).disabled, false)
    B.token = (await anon.data('POST', '/api/auth/login', { account: 'bob', password: 'bob-password-2' })).token
    assert.equal((await B.data('GET', '/api/workflow/list')).length, wf)

    // Reset: a temporary password, shown once; every session of the account ends.
    const { temporaryPassword } = await A.data('POST', `/api/admin/users/${B.user.id}/reset-password`)
    assert.match(temporaryPassword, /^[A-Za-z0-9]{16}$/)
    assert.deepEqual(await B.refused('GET', '/api/auth/me'), [401, 'auth.required'])
    assert.deepEqual(await anon.refused('POST', '/api/auth/login', { account: 'bob', password: 'bob-password-2' }), [401, 'auth.invalid_credentials'])
    B.token = (await anon.data('POST', '/api/auth/login', { account: 'bob', password: temporaryPassword })).token
    auth.resetRateLimits()
  })

  await t.test('forgotten password: the command line gives a temporary password and signs the account out', async () => {
    const run = (arg) => new Promise((resolve) => {
      execFile(process.execPath, [path.join(__dirname, '..', 'src', 'cli', 'reset-password.js'), ...(arg ? [arg] : [])], { env: { ...process.env, MONGODB_URI: dbUri } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }))
    })
    assert.equal((await run()).code, 2)
    const missing = await run('nobody-here')
    assert.deepEqual([missing.code, /No account/.test(missing.stderr)], [1, true])
    const out = await run('BOB@example.com')
    assert.equal(out.code, 0, out.stderr)
    const password = /Temporary password: (\S+)/.exec(out.stdout)[1]
    assert.deepEqual(await B.refused('GET', '/api/auth/me'), [401, 'auth.required'])
    B.token = (await anon.data('POST', '/api/auth/login', { account: 'bob', password })).token
    B.token = (await B.data('PUT', '/api/auth/password', { currentPassword: password, newPassword: 'bob-password-3' })).token
  })

  await t.test('deleting an account takes its data and its files with it, and nobody else\'s', async () => {
    const mineBefore = await Promise.all(ownedCollections.map((n) => db.collection(n).countDocuments({ userId: A.user.id })))
    const filesOfB = [own.B.file.key, own.B.run.outputs[0].url.replace('/files/', '')]
    const thumbOfB = own.B.run.outputs[0].thumbnailUrl.replace('/files/', '')
    for (const key of [...filesOfB, thumbOfB, own.A.file.key]) assert.ok(fileExists(key), key)
    // A run of the account that is still going is stopped first.
    const going = (await B.data('POST', '/api/runs', { model: 'gaorui:nano-banana-2', prompt: 'never' })).runId

    assert.deepEqual(await A.refused('DELETE', `/api/admin/users/${B.user.id}`), [400, 'auth.confirm_mismatch'])
    assert.deepEqual(await A.refused('DELETE', `/api/admin/users/${B.user.id}?confirm=BOB`), [400, 'auth.confirm_mismatch'])
    assert.equal(await db.collection('users').countDocuments({}), 2)
    const gone = await A.data('DELETE', `/api/admin/users/${B.user.id}?confirm=bob`)
    assert.deepEqual([gone.id, gone.filesRemoved, gone.files >= 3], [B.user.id, true, true])

    for (const name of [...ownedCollections, 'sessions']) assert.equal(await db.collection(name).countDocuments({ userId: B.user.id }), 0, name)
    assert.equal(await db.collection('runs').countDocuments({ _id: new ObjectId(going) }), 0)
    assert.equal(await db.collection('users').countDocuments({}), 1)
    for (const key of [...filesOfB, thumbOfB]) assert.ok(!fileExists(key), `${key} is gone`)
    assert.equal((await fetch(base + own.B.file.url)).status, 404)
    assert.deepEqual(await B.refused('GET', '/api/auth/me'), [401, 'auth.required'])
    assert.deepEqual(await anon.refused('POST', '/api/auth/login', { account: 'bob', password: 'bob-password-3' }), [401, 'auth.invalid_credentials'])

    // The owner's things, old and new, are all still there.
    assert.deepEqual(await Promise.all(ownedCollections.map((n) => db.collection(n).countDocuments({ userId: A.user.id }))), mineBefore)
    assert.ok(fileExists(own.A.file.key))
    assert.equal((await fetch(base + (await db.collection('runs').findOne({ _id: legacy.run })).outputs[0].url)).status, 200, 'a file from before accounts')
    assert.equal(await db.collection('templates').countDocuments({ builtin: true }), 2)
    // The name is free again, and a new account under it starts with nothing.
    const reborn = client((await anon.data('POST', '/api/auth/register', { username: 'bob', email: 'bob@example.com', password: 'bob-password-9' })).token)
    assert.deepEqual([await reborn.data('GET', '/api/workflow/list'), await reborn.data('GET', '/api/admin/providers')], [[], []])
  })
})

test('the first registration is a race with one winner: one owner, and the old data goes to that owner alone', async (t) => {
  const mongo = await findMongo()
  if (!mongo) return t.skip('no MongoDB available (set TEST_MONGODB_URI)')
  const mongoose = require('mongoose')
  const u = new URL(mongo.uri)
  u.pathname = `/loomcanvas_accounts_race_${crypto.randomBytes(4).toString('hex')}`
  await mongoose.connect(u.toString(), { serverSelectionTimeoutMS: 8000 })
  t.after(async () => {
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
    await mongo.stop()
  })
  const db = mongoose.connection
  const accounts = require('../src/services/accounts')
  await require('../src/services/settings').load()
  const now = new Date()
  await db.collection('workflows').insertMany(Array.from({ length: 5 }, (_, i) => ({ userId: 'local', name: `old ${i}`, nodes: [], edges: [], isDeleted: false, createdAt: now, updatedAt: now })))
  await accounts.prepare()

  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => accounts.register({ username: `racer-${i}`, email: `racer-${i}@example.com`, password: 'racer-password' })))
  assert.deepEqual(results.map((r) => r.status), Array(8).fill('fulfilled'), JSON.stringify(results.map((r) => r.reason && r.reason.message)))
  const users = await db.collection('users').find({}).toArray()
  const owners = users.filter((x) => x.role === 'owner')
  assert.deepEqual([users.length, owners.length], [8, 1])
  assert.deepEqual(users.filter((x) => x.legacyAdoption).map((x) => [x.role, x.legacyAdoption]), [['owner', 'done']])
  assert.deepEqual(await db.collection('workflows').distinct('userId'), [String(owners[0]._id)])

  // The same name or email twice at the same moment: one account, the other is told it is taken.
  const twins = await Promise.allSettled([1, 2].map(() => accounts.register({ username: 'Twin', email: 'twin@example.com', password: 'twin-password' })))
  assert.deepEqual(twins.map((r) => r.status).sort(), ['fulfilled', 'rejected'])
  assert.match(twins.find((r) => r.status === 'rejected').reason.code, /^auth\.(username|email)_taken$/)
  assert.equal(await db.collection('users').countDocuments({ usernameLower: 'twin' }), 1)
})
