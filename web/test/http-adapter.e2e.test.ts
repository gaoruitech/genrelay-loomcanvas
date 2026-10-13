// @vitest-environment node
/**
 * The HTTP adapter against the real stock server: Express app, MongoDB, local storage, the runner
 * and a fake upstream. Needs a MongoDB: set TEST_MONGODB_URI (e.g. mongodb://127.0.0.1:27017/lc_test).
 * Without it the whole file is skipped. The server's own dependencies must be installed (npm ci in server/).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { EditorAdapter } from '../src/embed/types'
import { runAdapterContract, type ContractFixture } from './adapterContract'

const MONGO = process.env.TEST_MONGODB_URI || ''
const require = createRequire(import.meta.url)
const KEY = 'sk-contract-key-abcdef123456'
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const state: { fixture?: ContractFixture; base?: string; token?: string; stop?: () => Promise<void>; seen: Record<string, string | undefined>[] } = { seen: [] }

/** Fake upstream speaking the gaorui protocols the stock catalogue uses: image runs and chat. */
function startUpstream(): Promise<{ baseUrl: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const url = (req.url || '').split('?')[0]
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || 'null') : null
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const json = (obj: unknown, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)) }
      if (req.method === 'GET' && url === '/v1/models') return json({ data: [] })
      if (req.method === 'POST' && url === '/v1/nano-banana') return json({ code: 0, data: { id: body?.prompt === 'slow' ? 'img-slow' : 'img-1' } })
      if (req.method === 'GET' && url === '/v1/nano-banana/img-1') return json({ code: 0, data: { status: 'completed', progress: 100, image_url: `${base}/cdn/result.png` } })
      if (req.method === 'GET' && url === '/v1/nano-banana/img-slow') return json({ code: 0, data: { status: 'running', progress: 20 } })
      if (req.method === 'POST' && url === '/v1/chat/completions') return json({ choices: [{ message: { content: 'hi there' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
      if (req.method === 'GET' && url === '/cdn/result.png') { res.setHeader('Content-Type', 'image/png'); return res.end(PNG) }
      json({ error: { message: 'not found' } }, 404)
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => { server.closeAllConnections(); server.close() },
  })))
}

describe.skipIf(!MONGO)('HTTP adapter against the stock server', () => {
  beforeAll(async () => {
    // The web modules read these at import time; Node < 21 has no navigator.
    ;(globalThis as any).navigator ??= { language: 'en' }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomcanvas-adapter-'))
    Object.assign(process.env, {
      SECRET_KEY: 'adapter-contract-secret-0123456789', STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: tmpDir,
      PUBLIC_URL: '', WEB_DIST: '', BILLING_HOOK: '', CORS_ORIGIN: 'https://host.example',
    })
    const mongoose = require('../../server/node_modules/mongoose')
    const u = new URL(MONGO)
    u.pathname = `/lc_adapter_${crypto.randomBytes(4).toString('hex')}`
    await mongoose.connect(u.toString(), { serverSelectionTimeoutMS: 8000 })
    const upstream = await startUpstream()
    require('../../server/src/utils/safeFetch').setAllowedHosts(['127.0.0.1'])
    await require('../../server/src/services/settings').load()
    await require('../../server/src/services/accounts').prepare({ admin: { username: 'owner', email: 'owner@example.com', password: 'correct horse' } })
    await require('../../server/src/services/seed').seed()
    const { getRunner } = require('../../server/src/runner')
    await getRunner().start()
    const server: http.Server = require('../../server/src/app').createApp().listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    state.base = base
    state.stop = async () => {
      await getRunner().shutdown()
      server.closeAllConnections(); server.close(); upstream.close()
      await mongoose.connection.dropDatabase()
      await mongoose.disconnect()
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }

    const call = async (method: string, p: string, body?: unknown, token = '') => {
      const res = await fetch(base + p, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      const out = await res.json()
      if (out.result !== 0) throw new Error(`${method} ${p}: ${JSON.stringify(out).slice(0, 200)}`)
      return out.data
    }
    // What a host's backend would do: obtain a LoomCanvas session for its user, hand the token to the page.
    const login = await call('POST', '/api/auth/login', { account: 'owner', password: 'correct horse' })
    state.token = login.token
    await call('POST', '/api/admin/providers', { type: 'gaorui', name: 'Fake', baseUrl: upstream.baseUrl, apiKey: KEY, enabled: true }, login.token)
    const canvas = await call('POST', '/api/workflow', { name: 'Seed' }, login.token)

    const { createHttpAdapter } = await import('../src/embed/httpAdapter')
    const adapter: EditorAdapter = createHttpAdapter({
      apiBase: `${base}/api`,
      // The host's own headers, asynchronously, on every call.
      getAuth: async () => { const h = { Authorization: `Bearer ${state.token}` }; state.seen.push(h); return h },
      locale: () => 'en',
    })
    const models = await adapter.listModels()
    state.fixture = {
      adapter,
      canvasId: canvas.id,
      imageModel: models.find((m) => m.kind === 'image' && m.id.includes('nano-banana'))!.id,
      chatModel: models.find((m) => m.kind === 'chat')!.id,
      slowPrompt: 'slow',
      fetchUploads: true,
    }
  })

  afterAll(async () => { await state.stop?.() })

  runAdapterContract('http (stock server)', () => state.fixture!)

  it('resolves stored files against the API origin and keeps documents site-relative', async () => {
    const { adapter } = state.fixture!
    expect(adapter.resolveFileUrl('/files/uploads/x.png')).toBe(`${state.base}/files/uploads/x.png`)
    const file = await adapter.upload(new Blob([PNG], { type: 'image/png' }), { filename: 'a.png' })
    expect(file.url.startsWith('/files/')).toBe(true)
  })

  it('sends the host headers on every call and nothing of its own', async () => {
    expect(state.seen.length).toBeGreaterThan(5)
    const { createHttpAdapter } = await import('../src/embed/httpAdapter')
    let asked = 0
    const anonymous = createHttpAdapter({ apiBase: `${state.base}/api`, onAuthRequired: () => { asked++ } })
    await expect(anonymous.listModels()).rejects.toMatchObject({ response: { status: 401 } })
    expect(asked).toBe(1)
  })

  it('offers the optional parts the stock server has', async () => {
    const { adapter, canvasId } = state.fixture!
    expect(await adapter.capabilities!()).toEqual({ maxUploadMb: 50, upstreamByUrl: false, storageWritable: true })
    expect((await adapter.listCanvases!()).some((c) => c.id === canvasId)).toBe(true)
    expect(Array.isArray(await adapter.brandKits!.list())).toBe(true)
    expect(Array.isArray(await adapter.templates!.listCanvasTemplates())).toBe(true)
    const est = await adapter.estimate!({ model: state.fixture!.imageModel, params: {}, count: 1 })
    expect(typeof est.unknown).toBe('boolean')
    const share = await adapter.share!.publish({ workflowId: canvasId, title: 'T' })
    expect(typeof share.token).toBe('string')
  })

  it('the server answers a cross-origin page: preflight, credentials header, files', async () => {
    const pre = await fetch(`${state.base}/api/models`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://host.example', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,x-locale' },
    })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://host.example')
    expect(pre.headers.get('access-control-allow-headers')!.toLowerCase()).toContain('authorization')
    const other = await fetch(`${state.base}/api/models`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } })
    expect(other.headers.get('access-control-allow-origin')).toBeNull()
    const file = await state.fixture!.adapter.upload(new Blob([PNG], { type: 'image/png' }), { filename: 'b.png' })
    const res = await fetch(state.fixture!.adapter.resolveFileUrl(file.url), { headers: { Origin: 'https://host.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
  })
})
