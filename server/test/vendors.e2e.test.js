'use strict'

/**
 * Vendors over real HTTP and a real database: the vendor list, custom model
 * add / edit / delete with its validation, and the start-up migration of
 * providers stored by the previous version.
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomcanvas-vendors-'))
process.env.SECRET_KEY = 'vendors-test-secret-key-0123456789'
process.env.ACCESS_PASSWORD = ''
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

/** An upstream whose model list names things the app must NOT turn into models. */
async function startUpstream() {
  const calls = []
  const chats = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = req.url.split('?')[0]
      calls.push(`${req.method} ${url}`)
      res.setHeader('Content-Type', 'application/json')
      if (url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'upstream-chat' }, { id: 'upstream-image-model' }] }))
      if (url === '/v1beta/models') return res.end(JSON.stringify({ models: [{ name: 'models/upstream-gemini', supportedGenerationMethods: ['generateContent'] }] }))
      if (url === '/v1/chat/completions') {
        chats.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        return res.end(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }))
      }
      res.statusCode = 404
      res.end(JSON.stringify({ error: { message: 'not found' } }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { calls, chats, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close() } }
}

test('vendors, custom models and the provider migration', async (t) => {
  const mongo = await findMongo()
  if (!mongo) return t.skip('no MongoDB available (set TEST_MONGODB_URI)')

  const mongoose = require('mongoose')
  const u = new URL(mongo.uri)
  u.pathname = `/loomcanvas_vendors_${crypto.randomBytes(4).toString('hex')}`
  await mongoose.connect(u.toString(), { serverSelectionTimeoutMS: 8000 })
  const upstream = await startUpstream()
  await require('../src/services/settings').load()
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

  async function call(method, pathname, body, headers = {}) {
    const res = await fetch(base + pathname, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }
  const data = async (method, pathname, body) => {
    const r = await call(method, pathname, body)
    assert.equal(r.body.result, 0, `${method} ${pathname}: ${JSON.stringify(r.body).slice(0, 300)}`)
    return r.body.data
  }
  const refused = async (method, pathname, body) => {
    const r = await call(method, pathname, body)
    return [r.status, r.body.code]
  }
  const providers = mongoose.connection.collection('providers')
  let vendors = []
  const finished = async (taskId) => {
    for (let i = 0; i < 100; i++) {
      const run = await data('GET', `/api/llm/tasks/${taskId}`)
      if (run.status === 'succeeded') return run
      assert.notEqual(run.status, 'failed', run.error)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.fail('the run did not finish')
  }
  const KEY = 'sk-vendors-test-key-12345678'
  // The misspelt brand name of earlier versions, written as escapes so the repository stays free of it.
  const OLD_BRAND = '\u9ad8\u777f'

  await t.test('GET /api/admin/vendors: three vendors, each with its supported models, in both languages', async () => {
    const zh = await data('GET', '/api/admin/vendors')
    vendors = zh
    assert.deepEqual(zh.map((v) => [v.type, v.label, v.recommended]), [['gaorui', '高瑞', true], ['openai', 'OpenAI', false], ['gemini', 'Google Gemini', false]])
    assert.equal(zh[0].keyUrl, 'https://gaorui.cc')
    assert.deepEqual(zh.map((v) => v.defaultBaseUrl), ['https://gaorui.cc', 'https://api.openai.com/v1', 'https://generativelanguage.googleapis.com'])
    const sunburst = zh[1].models.find((m) => m.model === 'gpt-image-2.5-sunburst')
    assert.deepEqual([sunburst.kind, sunburst.maxReferenceImages, sunburst.options.aspectRatios], ['image', 16, ['auto', '1:1', '3:2', '2:3']])
    assert.ok(!JSON.stringify(zh).includes('_protocol'))
    const en = (await call('GET', '/api/admin/vendors', undefined, { 'X-Locale': 'en' })).body.data
    assert.equal(en[0].label, 'Gaorui')
    assert.notEqual(en[0].models[0].desc, zh[0].models[0].desc)
    assert.equal((await call('GET', '/api/admin/provider-types')).status, 404, 'the old endpoint is gone')
  })

  let openaiId = ''
  await t.test('adding a provider: vendor + key; the official address is the default; the upstream list creates no models', async () => {
    assert.deepEqual(await refused('POST', '/api/admin/providers', { type: 'openai-compatible', apiKey: KEY }), [400, 'provider.type_unsupported'])
    assert.deepEqual(await refused('POST', '/api/admin/providers', { type: 'openai' }), [400, 'provider.api_key_required'])
    const official = await data('POST', '/api/admin/providers', { type: 'openai', apiKey: KEY, baseUrl: 'https://api.openai.com/v1' })
    assert.deepEqual([official.name, official.slug, official.baseUrl, official.customBaseUrl], ['OpenAI', 'openai', 'https://api.openai.com/v1', false])
    assert.equal((await providers.findOne({ slug: 'openai' })).baseUrl, '', 'the official address is not stored')
    assert.equal((await providers.findOne({ slug: 'openai' })).schemaVersion, 3)
    openaiId = official.id
    const zhModel = (id) => vendors[1].models.find((m) => m.model === id)

    const moved = await data('PUT', `/api/admin/providers/${openaiId}`, { baseUrl: upstream.baseUrl })
    assert.deepEqual([moved.baseUrl, moved.customBaseUrl], [upstream.baseUrl, true])
    assert.deepEqual(await refused('PUT', `/api/admin/providers/${openaiId}`, { type: 'gemini' }), [400, 'provider.vendor_fixed'])
    assert.equal((await data('PUT', `/api/admin/providers/${openaiId}`, { type: 'openai', name: 'Mine' })).name, 'Mine')

    assert.deepEqual(await data('POST', `/api/admin/providers/${openaiId}/test`), { ok: true, message: '连接成功' })
    assert.ok(upstream.calls.includes('GET /v1/models'))
    const ids = (await data('GET', '/api/models')).map((m) => m.id)
    assert.deepEqual(ids, [
      'openai:gpt-image-2.5-sunburst', 'openai:gpt-image-2.5-flare', 'openai:gpt-image-2',
      'openai:gpt-6-astra', 'openai:gpt-6.1-sol', 'openai:gpt-6-sol', 'openai:gpt-6-luna',
      'openai:gpt-5.6-sol', 'openai:gpt-5.6-terra', 'openai:gpt-5.6-luna',
      'openai:gpt-5.5', 'openai:gpt-5.4', 'openai:gpt-5.4-mini', 'openai:gpt-5.2',
      'openai:gpt-4.1', 'openai:gpt-4.1-mini', 'openai:gpt-4o', 'openai:gpt-4o-mini',
    ], 'the catalog, and only the catalog')
    const image2 = zhModel('gpt-image-2')
    assert.deepEqual([image2.label, image2.kind, image2.maxReferenceImages, image2.options], ['GPT Image 2', 'image', 16, { aspectRatios: ['auto', '1:1', '3:2', '2:3'], counts: [1, 2, 3, 4] }])
  })

  await t.test('custom models: add, edit, delete, and every refusal', async () => {
    const url = `/api/admin/providers/${openaiId}/models`
    assert.deepEqual(await refused('POST', url, { kind: 'chat' }), [400, 'provider.custom_name_required'])
    assert.deepEqual(await refused('POST', url, { model: 'my image', kind: 'image' }), [400, 'provider.custom_bad_name'])
    assert.deepEqual(await refused('POST', url, { model: 'my-image-model' }), [400, 'provider.custom_kind_required'])
    assert.deepEqual(await refused('POST', url, { model: 'my-video', kind: 'video' }), [400, 'provider.custom_kind_unsupported'])
    assert.deepEqual(await refused('POST', url, { model: 'gpt-6-luna', kind: 'image' }), [400, 'provider.custom_in_catalog'])
    assert.deepEqual(await refused('POST', `/api/admin/providers/${'0'.repeat(24)}/models`, { model: 'm', kind: 'chat' }), [404, 'provider.not_found'])

    // The name says "image"; the user says chat; chat it is.
    const added = await data('POST', url, { model: 'my-image-model', kind: 'chat', label: 'My model' })
    assert.deepEqual(added.customModels, [{ model: 'my-image-model', kind: 'chat', label: 'My model' }])
    assert.deepEqual(await refused('POST', url, { model: 'my-image-model', kind: 'image' }), [400, 'provider.custom_exists'])
    await data('POST', url, { model: 'ft:gpt/x@1', kind: 'image' })

    const admin = await data('GET', '/api/admin/models')
    const mine = admin.find((m) => m.id === 'openai:my-image-model')
    assert.deepEqual([mine.kind, mine.custom, mine.label, mine.providerType, mine.providerName, mine.acceptsVideo], ['chat', true, 'My model', 'openai', 'Mine', false])
    const tuned = admin.find((m) => m.id === 'openai:ft:gpt/x@1')
    assert.deepEqual([tuned.kind, tuned.custom, tuned.label, tuned.maxReferenceImages], ['image', true, 'ft:gpt/x@1', 16])
    assert.equal(admin.find((m) => m.id === 'openai:gpt-6-luna').custom, false)
    assert.deepEqual((await data('GET', '/api/models?kind=chat')).map((m) => m.id).slice(-1), ['openai:my-image-model'])

    // It runs as what it was declared to be.
    const task = await data('POST', '/api/llm/tasks', { model: 'openai:my-image-model', prompt: 'hello' })
    assert.ok(task.taskId)
    assert.deepEqual(await refused('POST', '/api/runs', { model: 'openai:my-image-model', prompt: 'x' }), [400, 'model.chat_only'])

    // Overrides (price, order, on/off) work on a custom model like on any other.
    const mid = encodeURIComponent('openai:my-image-model')
    await data('PUT', `/api/admin/models/${mid}`, { label: 'Renamed in the list', pricing: { currency: 'USD', unit: 'per_1m_tokens', table: { input: 1, output: 2 } } })

    // Edit: kind and display name, never the name itself.
    const one = `${url}/${encodeURIComponent('my-image-model')}`
    assert.deepEqual(await refused('PUT', one, { model: 'other-name' }), [400, 'provider.custom_name_fixed'])
    assert.deepEqual(await refused('PUT', one, { kind: 'video' }), [400, 'provider.custom_kind_unsupported'])
    assert.deepEqual(await refused('PUT', `${url}/nope`, { kind: 'chat' }), [404, 'provider.custom_not_found'])
    const edited = await data('PUT', one, { kind: 'image', label: 'Now an image model' })
    assert.deepEqual(edited.customModels[0], { model: 'my-image-model', kind: 'image', label: 'Now an image model' })
    const after = (await data('GET', '/api/admin/models')).find((m) => m.id === 'openai:my-image-model')
    assert.deepEqual([after.kind, after.label], ['image', 'Now an image model'], 'the name given in the dialog is the one shown')
    assert.ok(after.pricing, 'the price stays')

    // Delete: the model and its override go; a name with ":" and "/" works in the path.
    await data('DELETE', `${url}/${encodeURIComponent('ft:gpt/x@1')}`)
    const left = await data('DELETE', one)
    assert.deepEqual(left.customModels, [])
    assert.deepEqual(await refused('DELETE', one), [404, 'provider.custom_not_found'])
    assert.equal(await mongoose.connection.collection('modeloverrides').countDocuments({ modelId: 'openai:my-image-model' }), 0)
    assert.ok(!(await data('GET', '/api/admin/models')).some((m) => m.custom))

    // The cap.
    await providers.updateOne({ slug: 'openai' }, { $set: { customModels: Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, kind: 'chat', label: '' })) } })
    assert.deepEqual(await refused('POST', url, { model: 'one-more', kind: 'chat' }), [400, 'provider.custom_max'])
    await providers.updateOne({ slug: 'openai' }, { $set: { customModels: [] } })
  })

  await t.test('migration: providers stored by the previous version', async () => {
    const { encrypt } = require('../src/utils/crypto')
    const { migrateProviders } = require('../src/services/providerMigration')
    await providers.deleteMany({})
    const oid = () => new mongoose.Types.ObjectId()
    const row = (extra) => ({ userId: 'local', baseUrl: upstream.baseUrl, apiKeyEnc: encrypt(KEY, process.env.SECRET_KEY), hasKey: true, keyTail: '5678', enabled: true, sort: 0, createdAt: new Date(), updatedAt: new Date(), ...extra })
    const gaoruiId = oid()
    const relayId = oid()
    const discoveredId = oid()
    await providers.insertMany([
      row({ _id: gaoruiId, type: 'gaorui', name: OLD_BRAND + ' API', slug: 'gaorui', options: {} }),
      row({ _id: relayId, type: 'openai-compatible', name: 'My relay', slug: 'openai-compatible', options: { models: 'my-old-llm, gpt-6-luna, gpt-4o-mini', imageModels: 'gpt-image-1' } }),
      row({ _id: oid(), type: 'gemini', name: 'Google Gemini', slug: 'gemini', options: { models: 'gemini-nano-banana-2.1, old-banana-model, gemini-2.5-pro' } }),
      row({ _id: discoveredId, type: 'openai-compatible', name: 'Discovered', slug: 'gateway', enabled: false, sort: 3, options: { models: '', imageModels: '' } }),
    ])
    // What was in use. Runs record the kind; canvas nodes imply it.
    const run = (providerId, upstreamModel, kind, slug) => ({ userId: 'local', kind, status: 'succeeded', modelId: `${slug}:${upstreamModel}`, upstreamModel, providerId, createdAt: new Date(), updatedAt: new Date() })
    await mongoose.connection.collection('runs').insertMany([
      run(gaoruiId, 'gpt-4o-mini', 'chat', 'gaorui'),
      run(gaoruiId, 'gpt-4o-mini', 'chat', 'gaorui'),
      run(gaoruiId, 'nano-banana-2', 'image', 'gaorui'),
      run(discoveredId, 'local-sdxl', 'image', 'gateway'),
      run(relayId, 'removed-long-ago', 'chat', 'openai-compatible'),
    ])
    await mongoose.connection.collection('workflows').insertMany([
      { userId: 'local', name: 'c1', isDeleted: false, nodes: [
        { id: 'a', type: 'llm', data: { model: 'gaorui:claude-on-canvas' } },
        { id: 'b', type: 'video-analysis', data: { model: 'gaorui:gpt-4o-mini' } },
        { id: 'c', type: 'image-gen', data: { model: 'gaorui:nano-banana-pro' } },
        { id: 'd', type: 'llm', data: { model: 'gateway:local-llm' } },
        { id: 'e', type: 'text', data: { model: 'gaorui:not-a-model-node' } },
      ], edges: [] },
      { userId: 'local', name: 'trash', isDeleted: true, nodes: [{ id: 'a', type: 'llm', data: { model: 'gaorui:only-in-trash' } }], edges: [] },
    ])
    await mongoose.connection.collection('modeloverrides').insertOne({ userId: 'local', modelId: 'openai-compatible:my-old-llm', pricing: { currency: 'USD', unit: 'per_1m_tokens', table: { input: 1, output: 2 } } })

    assert.deepEqual(await migrateProviders(), { providers: 4, customModels: 8 })
    const stored = Object.fromEntries((await providers.find().toArray()).map((p) => [p.slug, p]))
    assert.deepEqual(Object.keys(stored).sort(), ['gaorui', 'gateway', 'gemini', 'openai-compatible'], 'slugs are untouched')
    for (const p of Object.values(stored)) {
      assert.equal(p.schemaVersion, 3)
      assert.equal('options' in p, false, 'the free-text fields are gone')
      assert.equal(p.keyTail, '5678')
      assert.equal(p.baseUrl, upstream.baseUrl)
    }
    assert.deepEqual([stored.gaorui.type, stored.gaorui.name], ['gaorui', '高瑞'], 'the old default name, misspelt as it was, becomes the default of today')
    assert.deepEqual(stored.gaorui.customModels, [{ id: 'gpt-4o-mini', kind: 'chat', label: '' }, { id: 'claude-on-canvas', kind: 'chat', label: '' }])
    assert.deepEqual([stored['openai-compatible'].type, stored['openai-compatible'].name], ['openai', 'My relay'])
    assert.deepEqual(stored['openai-compatible'].customModels, [{ id: 'gpt-image-1', kind: 'image', label: '' }, { id: 'my-old-llm', kind: 'chat', label: '' }])
    assert.deepEqual(stored.gemini.customModels, [{ id: 'old-banana-model', kind: 'image', label: '' }, { id: 'gemini-2.5-pro', kind: 'chat', label: '' }])
    assert.deepEqual([stored.gateway.type, stored.gateway.enabled, stored.gateway.sort], ['openai', false, 3])
    assert.deepEqual(stored.gateway.customModels, [{ id: 'local-sdxl', kind: 'image', label: '' }, { id: 'local-llm', kind: 'chat', label: '' }])

    // Running it again changes nothing.
    assert.deepEqual(await migrateProviders(), { providers: 0, customModels: 0 })

    // Providers written by a build that had the vendor model but still the old default name
    // (version 2): only the name changes, and only where it is exactly that default.
    const before = await providers.find().sort({ _id: 1 }).toArray()
    await providers.updateOne({ slug: 'gaorui' }, { $set: { schemaVersion: 2, name: '高瑞 API' } })
    await providers.updateOne({ slug: 'gemini' }, { $set: { schemaVersion: 2, name: '高瑞 API' } })
    await providers.updateOne({ slug: 'gateway' }, { $set: { schemaVersion: 2 } })
    await providers.insertOne(row({ _id: oid(), type: 'gaorui', name: '高瑞 API 备用', slug: 'gaorui-2', schemaVersion: 2, customModels: [{ id: 'kept-as-is', kind: 'chat', label: 'K' }] }))
    assert.deepEqual(await migrateProviders(), { providers: 4, customModels: 0 })
    const after = Object.fromEntries((await providers.find().toArray()).map((p) => [p.slug, p]))
    assert.deepEqual(Object.values(after).map((p) => p.schemaVersion), [3, 3, 3, 3, 3])
    assert.equal(after.gaorui.name, '高瑞')
    assert.equal(after.gemini.name, '高瑞 API', 'a provider of another vendor keeps whatever it is called')
    assert.equal(after['gaorui-2'].name, '高瑞 API 备用', 'a name that is not exactly the old default was chosen by the user')
    assert.deepEqual(after['gaorui-2'].customModels, [{ id: 'kept-as-is', kind: 'chat', label: 'K' }])
    // Nothing but the name and the version moved: keys, addresses, custom models, order.
    const strip = ({ name, schemaVersion, ...rest }) => rest
    assert.deepEqual((await providers.find({ slug: { $ne: 'gaorui-2' } }).sort({ _id: 1 }).toArray()).map(strip), before.map(strip))
    assert.deepEqual(await migrateProviders(), { providers: 0, customModels: 0 }, 'once per provider')
    // Naming one "高瑞 API" on purpose afterwards is respected on the next start.
    await providers.updateOne({ slug: 'gaorui-2' }, { $set: { name: '高瑞 API' } })
    assert.deepEqual(await migrateProviders(), { providers: 0, customModels: 0 })
    assert.equal((await providers.findOne({ slug: 'gaorui-2' })).name, '高瑞 API')
    await providers.deleteOne({ slug: 'gaorui-2' })
    await providers.updateOne({ slug: 'gemini' }, { $set: { name: 'Google Gemini' } })

    // Through the API: same model ids as before, keys still readable, prices still attached.
    const listed = await data('GET', '/api/admin/providers')
    assert.deepEqual(listed.map((p) => [p.slug, p.type, p.hasKey, p.keyTail]), [
      ['gaorui', 'gaorui', true, '5678'], ['openai-compatible', 'openai', true, '5678'], ['gemini', 'gemini', true, '5678'], ['gateway', 'openai', true, '5678'],
    ])
    const admin = await data('GET', '/api/admin/models')
    const kindOf = (id) => { const m = admin.find((x) => x.id === id); return m ? [m.kind, m.custom] : null }
    assert.deepEqual(kindOf('openai-compatible:my-old-llm'), ['chat', true])
    assert.deepEqual(kindOf('openai-compatible:gpt-4o-mini'), ['chat', false], 'so is this one, since the catalog lists it')
    assert.deepEqual(kindOf('openai-compatible:gpt-image-1'), ['image', true])
    assert.deepEqual(kindOf('openai-compatible:gpt-6-luna'), ['chat', false], 'a typed name the catalog has is the catalog model')
    assert.deepEqual(kindOf('gemini:gemini-nano-banana-2.1'), ['image', false])
    assert.deepEqual(kindOf('gemini:old-banana-model'), ['image', true])
    assert.deepEqual(kindOf('gaorui:gpt-4o-mini'), ['chat', true])
    assert.deepEqual(kindOf('gateway:local-sdxl'), ['image', true])
    assert.equal(kindOf('gaorui:only-in-trash'), null)
    assert.equal(kindOf('openai-compatible:removed-long-ago'), null)
    assert.equal(admin.find((m) => m.id === 'openai-compatible:my-old-llm').pricing.currency, 'USD')
    // The migrated key decrypts: a chat call reaches the upstream.
    const task = await data('POST', '/api/llm/tasks', { model: 'openai-compatible:my-old-llm', prompt: 'still works?' })
    await finished(task.taskId)
  })

  await t.test('a custom model the catalog has caught up with: catalog entry served, settings kept, the row removed at start-up', async () => {
    const { dropShadowedCustomModels } = require('../src/services/providerMigration')
    // As on an instance where 高瑞 chat models had been added by hand before the catalog listed them.
    await providers.updateOne({ slug: 'gaorui' }, { $push: { customModels: { $each: [{ id: 'gpt-5.5', kind: 'chat', label: 'Mine' }, { id: 'gemini-3.5-flash-c', kind: 'image', label: '' }] } } })
    const pricing = { currency: 'CNY', unit: 'per_1m_tokens', table: { input: 1, output: 2 } }
    await data('PUT', `/api/admin/models/${encodeURIComponent('gaorui:gpt-5.5')}`, { enabled: true, sort: 3, pricing })

    const check = async () => {
      const admin = await data('GET', '/api/admin/models')
      const hits = admin.filter((m) => m.id === 'gaorui:gpt-5.5')
      assert.equal(hits.length, 1, 'listed once')
      assert.deepEqual([hits[0].custom, hits[0].kind, hits[0].label, hits[0].acceptsImage, hits[0].acceptsVideo, hits[0].sort, hits[0].pricing], [false, 'chat', 'GPT 5.5', false, false, 3, pricing])
      assert.deepEqual([admin.find((m) => m.id === 'gaorui:gemini-3.5-flash-c').kind, admin.find((m) => m.id === 'gaorui:gemini-3.5-flash-c').custom], ['chat', false])
      assert.deepEqual(admin.filter((m) => m.providerType === 'gaorui' && m.custom).map((m) => m.id), ['gaorui:gpt-4o-mini', 'gaorui:claude-on-canvas'], 'custom models the catalog does not list are untouched')
    }
    // Before the clean-up the row is still stored, and already ignored.
    assert.equal((await providers.findOne({ slug: 'gaorui' })).customModels.length, 4)
    await check()
    assert.equal(await dropShadowedCustomModels(), 2)
    assert.deepEqual((await providers.findOne({ slug: 'gaorui' })).customModels, [{ id: 'gpt-4o-mini', kind: 'chat', label: '' }, { id: 'claude-on-canvas', kind: 'chat', label: '' }])
    assert.equal(await mongoose.connection.collection('modeloverrides').countDocuments({ modelId: 'gaorui:gpt-5.5' }), 1, 'the override is not the row\'s to take along')
    await check()
    assert.equal(await dropShadowedCustomModels(), 0, 'nothing left to do on the next start')
    assert.deepEqual((await data('GET', '/api/admin/providers')).find((p) => p.slug === 'gaorui').customModels.map((m) => m.model), ['gpt-4o-mini', 'claude-on-canvas'])
  })

  await t.test('a text-only chat model is never handed an image', async () => {
    const image = 'https://img.example/cat.png'
    for (const model of ['gaorui:deepseek-v4-pro', 'gaorui:gpt-5.5', 'gaorui:glm-5.3']) {
      assert.deepEqual(await refused('POST', '/api/llm/tasks', { model, prompt: 'what is in the picture?', imageUrls: [image] }), [400, 'model.no_image_input'], model)
    }
    const en = await call('POST', '/api/llm/tasks', { model: 'gaorui:glm-5.3', prompt: 'x', imageUrls: [image] }, { 'X-Locale': 'en' })
    assert.match(en.body.message, /text only/)
    // Four of the five take no video either.
    for (const model of ['gaorui:deepseek-v4-pro', 'gaorui:gpt-5.5', 'gaorui:glm-5.3', 'gaorui:gpt-6-astra']) {
      assert.deepEqual(await refused('POST', '/api/llm/tasks', { model, prompt: 'watch', videoUrl: 'https://v.example/a.mp4' }), [400, 'model.no_video_input'], model)
    }
    // (gpt-5.5 comes last here: the previous step gave it a sort of 3.)
    assert.deepEqual((await data('GET', '/api/models?kind=chat')).filter((m) => m.providerType === 'gaorui' && !m.custom).map((m) => [m.id, m.acceptsImage, m.maxReferenceImages]), [
      ['gaorui:deepseek-v4-pro', false, 0], ['gaorui:glm-5.3', false, 0], ['gaorui:gpt-6-astra', true, 8], ['gaorui:gemini-3.5-flash-c', true, 8], ['gaorui:gpt-5.5', false, 0],
    ])
    // Text alone goes through, as a plain string: no content parts at all.
    upstream.chats.length = 0
    const task = await data('POST', '/api/llm/tasks', { model: 'gaorui:deepseek-v4-pro', prompt: 'text only', systemPrompt: 'be brief' })
    await finished(task.taskId)
    assert.deepEqual(upstream.chats, [{ model: 'deepseek-v4-pro', messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'text only' }], stream: false }])
  })

  await t.test('video analysis through 高瑞: the catalog model that reads video gets it as an image_url part', async () => {
    const video = 'https://media.example/clip.mp4'
    const image = 'https://img.example/ref.png'
    // What the Video analysis node lists: chat models with acceptsVideo.
    const videoChat = (await data('GET', '/api/models?kind=chat')).filter((m) => m.acceptsVideo).map((m) => [m.id, m.custom])
    assert.deepEqual(videoChat, [['gaorui:gemini-3.5-flash-c', false], ['gaorui:gpt-4o-mini', true], ['gaorui:claude-on-canvas', true]], 'one catalog model, plus the custom 高瑞 chat models; none of OpenAI or Gemini')
    const vendor = (await data('GET', '/api/admin/vendors')).find((v) => v.type === 'gaorui')
    assert.deepEqual(vendor.models.filter((m) => m.kind === 'chat').map((m) => [m.model, m.acceptsImage, m.acceptsVideo]), [
      ['deepseek-v4-pro', false, false], ['gpt-5.5', false, false], ['glm-5.3', false, false], ['gpt-6-astra', true, false], ['gemini-3.5-flash-c', true, true],
    ])

    upstream.chats.length = 0
    await finished((await data('POST', '/api/llm/tasks', { model: 'gaorui:gemini-3.5-flash-c', prompt: 'describe the clip', videoUrl: video })).taskId)
    await finished((await data('POST', '/api/llm/tasks', { model: 'gaorui:claude-on-canvas', prompt: 'describe the clip', videoUrl: video, imageUrls: [image] })).taskId)
    assert.deepEqual(upstream.chats, [
      { model: 'gemini-3.5-flash-c', messages: [{ role: 'user', content: [
        { type: 'text', text: 'describe the clip' },
        { type: 'image_url', image_url: { url: video } },
      ] }], stream: false },
      { model: 'claude-on-canvas', messages: [{ role: 'user', content: [
        { type: 'text', text: 'describe the clip' },
        { type: 'image_url', image_url: { url: video } },
        { type: 'image_url', image_url: { url: image } },
      ] }], stream: false },
    ])

    // A video that only exists in local storage (no PUBLIC_URL here) cannot be handed over:
    // the run fails, saying why, and nothing is sent.
    upstream.chats.length = 0
    const form = new FormData()
    form.append('file', new Blob([Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(2048)])]), 'a.mp4')
    const up = await (await fetch(base + '/api/files/upload', { method: 'POST', body: form })).json()
    assert.equal(up.result, 0, JSON.stringify(up).slice(0, 200))
    const task = await data('POST', '/api/llm/tasks', { model: 'gaorui:gemini-3.5-flash-c', prompt: 'describe the clip', videoUrl: up.data.url })
    let run
    for (let i = 0; i < 100; i++) {
      run = await data('GET', `/api/llm/tasks/${task.taskId}`)
      if (run.status === 'failed' || run.status === 'succeeded') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(run.status, 'failed')
    assert.match(run.error, /公网可访问的地址/)
    assert.deepEqual(upstream.chats, [])
  })
})
