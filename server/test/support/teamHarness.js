'use strict'

/**
 * What the team suites share: one server over real HTTP on a database of its
 * own, a fake upstream that records the key every call came with, and clients
 * that remember who they are and which space they act in.
 *
 * Nothing happens when this file is merely loaded (the test runner loads every
 * file under test/): boot() does the work.
 *
 * Needs a MongoDB: set TEST_MONGODB_URI, otherwise mongodb-memory-server is
 * tried, and boot() resolves null (the caller skips) when neither is there.
 */
const assert = require('node:assert/strict')
const http = require('http')
const os = require('os')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

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

/**
 * Fake upstream speaking the gaorui image and chat protocols. Records the key
 * every call came with. A prompt of "never" starts a task that never finishes;
 * `hold()` makes every new task wait until `release()`; `chat(mode)` chooses how
 * chat calls are answered.
 */
async function startUpstream(png) {
  const calls = []
  let held = false
  let chatMode = 'ok'
  const chatWaiting = []
  let seq = 0
  const done = new Set()
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = req.url.split('?')[0]
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : null
      calls.push({ method: req.method, url, host: req.headers.host, auth: String(req.headers.authorization || '').replace(/^Bearer /, ''), body })
      const base = `http://127.0.0.1:${server.address().port}`
      const json = (obj, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
      if (req.method === 'GET' && url === '/v1/models') return json({ data: [{ id: 'nano-banana-2' }] })
      if (req.method === 'POST' && url === '/v1/nano-banana') {
        const id = body.prompt === 'never' ? 'img-never' : `img-${++seq}`
        if (!held && id !== 'img-never') done.add(id)
        return json({ code: 0, data: { id } })
      }
      const poll = /^\/v1\/nano-banana\/(img-[\w-]+)$/.exec(url)
      if (req.method === 'GET' && poll) {
        if (done.has(poll[1])) return json({ code: 0, data: { status: 'completed', progress: 100, image_url: `${base}/cdn/result.png` } })
        return json({ code: 0, data: { status: 'running', progress: 10 } })
      }
      if (req.method === 'POST' && url === '/v1/chat/completions') {
        const mode = chatMode
        const answer = () => {
          if (res.destroyed) return
          if (mode === 'fail') return json({ error: { message: 'the model refused' } }, 400)
          json({ choices: [{ message: { content: 'hello' } }], ...(mode === 'no-usage' ? {} : { usage: { prompt_tokens: 10, completion_tokens: 10 } }) })
        }
        return mode === 'hold' ? chatWaiting.push(answer) : answer()
      }
      if (req.method === 'GET' && url === '/cdn/result.png') { res.setHeader('Content-Type', 'image/png'); return res.end(png) }
      json({ error: { message: 'not found' } }, 404)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    calls,
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    /** New tasks stay "running" until release(). */
    hold() { held = true },
    release() { held = false; for (let i = 1; i <= seq; i++) done.add(`img-${i}`) },
    /**
     * How chat calls are answered from now on: 'ok' (an answer with token usage), 'no-usage'
     * (an answer without), 'fail' (HTTP 400), 'hold' (no answer until the mode changes).
     */
    chat(mode) { chatMode = mode; if (mode !== 'hold') for (const answer of chatWaiting.splice(0)) answer() },
    close: () => { server.closeAllConnections(); server.close() },
  }
}

/**
 * Start everything. Resolves null when there is no MongoDB.
 * `t.after` tears it down and drops the database.
 */
async function boot(t, name) {
  const mongo = await findMongo()
  if (!mongo) return null
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `loomcanvas-${name}-`))
  const filesDir = path.join(tmpDir, 'files')
  const hookFile = path.join(tmpDir, 'billing-hook.js')
  fs.writeFileSync(hookFile, `
const seen = (globalThis.__lcTeamBilling = [])
module.exports = {
  async beforeRun(ctx) { seen.push({ hook: 'beforeRun', runId: ctx.runId, userId: ctx.userId, username: ctx.username, spaceId: ctx.spaceId, teamId: ctx.teamId }); return { allow: true } },
}
`)
  process.env.SECRET_KEY = 'teams-test-secret-key-0123456789ab'
  process.env.STORAGE_DRIVER = 'local'
  process.env.STORAGE_LOCAL_DIR = filesDir
  process.env.PUBLIC_URL = ''
  process.env.WEB_DIST = ''
  process.env.BILLING_HOOK = hookFile
  for (const k of ['ADMIN_USERNAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'REGISTRATION_OPEN']) delete process.env[k]

  const mongoose = require('mongoose')
  const sharp = require('sharp')
  const u = new URL(mongo.uri)
  u.pathname = `/loomcanvas_${name}_${crypto.randomBytes(4).toString('hex')}`
  await mongoose.connect(u.toString(), { serverSelectionTimeoutMS: 8000 })
  const db = mongoose.connection
  const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#335577' } }).png().toBuffer()
  const upstream = await startUpstream(png)

  // Start-up, as index.js does it.
  require('../../src/utils/safeFetch').setAllowedHosts(['127.0.0.1'])
  const settings = require('../../src/services/settings')
  await settings.load()
  const accounts = require('../../src/services/accounts')
  const auth = require('../../src/middleware/auth')
  await accounts.prepare({ admin: { username: 'root', email: '', password: 'root-password-1' }, log: () => {} })
  await require('../../src/services/seed').seed()
  const teams = require('../../src/services/teams')
  await teams.start()
  const { getRunner } = require('../../src/runner')
  await getRunner().start()
  // Ask the fake upstream often: a run is done in a fraction of a second instead of seconds.
  getRunner().pollIntervalMs = [40, 120]
  const server = require('../../src/app').createApp().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`

  t.after(async () => {
    teams.stop()
    await getRunner().shutdown()
    server.closeAllConnections()
    server.close()
    upstream.close()
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
    await mongo.stop()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /**
   * A client: remembers its token and the space it acts in. `in(space)` is the
   * same account acting in another space ('' = no header = the personal one).
   */
  function client(token = '', space = '', user = null) {
    const self = {
      token,
      space,
      user,
      in: (other) => client(self.token, other, self.user),
      async call(method, pathname, body, headers = {}) {
        const h = { ...headers }
        if (self.token) h.Authorization = `Bearer ${self.token}`
        if (self.space) h['X-Space'] = self.space
        let payload
        if (body instanceof FormData) payload = body
        else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
        const res = await fetch(base + pathname, { method, headers: h, body: payload })
        const type = res.headers.get('content-type') || ''
        return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : null, text: type.includes('json') ? '' : await res.text() }
      },
      async data(method, pathname, body) {
        const r = await self.call(method, pathname, body)
        assert.equal(r.body && r.body.result, 0, `${method} ${pathname}: ${JSON.stringify(r.body).slice(0, 300)}`)
        return r.body.data
      },
      /** [status, code] of a call that is expected to be refused. */
      async refused(method, pathname, body) {
        const r = await self.call(method, pathname, body)
        return [r.status, r.body && r.body.code]
      },
      /** Just the HTTP status. */
      async status(method, pathname, body) {
        return (await self.call(method, pathname, body)).status
      },
    }
    return self
  }

  const anon = client()
  const root = client((await anon.data('POST', '/api/auth/login', { account: 'root', password: 'root-password-1' })).token)
  root.user = (await root.data('GET', '/api/auth/me')).user

  /** Register an account and sign it in. */
  async function register(username) {
    auth.resetRateLimits()
    const made = await anon.data('POST', '/api/auth/register', { username, email: `${username}@example.com`, password: `${username}-password-1` })
    return client(made.token, '', made.user)
  }

  /** The super admin authorises an account, which then creates a team. Resolves the team. */
  async function createTeam(owner, teamName, extra = {}) {
    await root.data('PATCH', `/api/admin/users/${owner.user.id}`, { canCreateTeams: true })
    return owner.data('POST', '/api/teams', { name: teamName, ...extra })
  }

  /** `member` joins `teamId` through a fresh invite link made by `manager`; optionally promoted by `owner`. */
  async function join(manager, teamId, member, { admin = false, owner = manager } = {}) {
    const inv = await manager.data('POST', `/api/teams/${teamId}/invitations`, { maxUses: 1 })
    await member.data('POST', `/api/team-invitations/${inv.token}/accept`)
    if (admin) await owner.data('PATCH', `/api/teams/${teamId}/members/${member.user.id}`, { role: 'admin' })
    return inv
  }

  /** A provider of the space the client acts in, pointed at the fake upstream. */
  async function addProvider(c, apiKey, extra = {}) {
    return c.data('POST', '/api/admin/providers', { type: 'gaorui', apiKey, baseUrl: upstream.baseUrl, ...extra })
  }

  async function waitRun(c, runId, timeoutMs = 20000) {
    const end = Date.now() + timeoutMs
    for (;;) {
      const run = await c.data('GET', `/api/runs/${runId}`)
      if (['succeeded', 'failed', 'canceled'].includes(run.status)) return run
      if (Date.now() > end) throw new Error(`still ${run.status}: ${runId}`)
      await new Promise((r) => setTimeout(r, 150))
    }
  }

  async function upload(c) {
    const form = new FormData()
    form.append('file', new Blob([png]), 'x.png')
    return c.data('POST', '/api/files/upload', form)
  }

  /**
   * Wait until nothing is queued or in flight any more (optionally: in one space) - and until
   * every run that ended has settled what it held of a team's monthly limits: a run reaches
   * its final status first and gives its place back (or swaps its reserve for the real cost)
   * a moment later, in a second write.
   */
  async function idle(spaceId = '', timeoutMs = 30000) {
    const end = Date.now() + timeoutMs
    const filter = {
      $or: [{ status: { $in: ['queued', 'running', 'archiving'] } }, { status: { $in: ['succeeded', 'failed', 'canceled'] }, 'budget.state': 'reserved' }],
      ...(spaceId ? { userId: spaceId } : {}),
    }
    while (await db.collection('runs').countDocuments(filter)) {
      if (Date.now() > end) throw new Error('runs are still unfinished')
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  const fileExists = (key) => fs.existsSync(path.join(filesDir, key))
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  return { base, db, mongoose, upstream, png, settings, auth, accounts, teams, getRunner, client, anon, root, register, createTeam, join, addProvider, waitRun, idle, upload, fileExists, filesDir, sleep, billing: () => globalThis.__lcTeamBilling || [] }
}

module.exports = { boot }
