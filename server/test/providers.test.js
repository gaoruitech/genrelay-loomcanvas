'use strict'

/**
 * Provider plugins against a local fake upstream. These pin down the request
 * shapes we send and the response shapes we accept; they do not prove the
 * real upstream agrees.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const gaorui = require('../src/providers/gaorui')
const openai = require('../src/providers/openaiCompatible')
const gemini = require('../src/providers/gemini')
const { parseModelList, openaiBase } = require('../src/providers/http')

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
    model: 'nano-banana-2.1', prompt: 'a cat', imageSize: '2K', images: ['ref(/files/a.png)'],
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
  await assert.rejects(gaorui.submit(cfg, { ...run('x'), model: 'not-in-catalog' }), (e) => e.i18n.code === 'provider.model_not_supported')
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
  assert.deepEqual(up.calls[1].body, { model: 'omni_flash_6s', prompt: 'go', resolution: '720p', aspect_ratio: '16:9' }, 'invalid options fall back to defaults')

  await gaorui.submit(cfg, run('omni-flash', { params: { imgMode: 'frames' }, imageUrls: ['a', 'b', 'c'] }))
  assert.deepEqual(up.calls[2].body.input_reference, ['ref(a)', 'ref(b)'])
  assert.equal(up.calls[2].body.first_last_frame, true)

  await gaorui.submit(cfg, run('omni-flash-edit', { videoUrls: ['/files/v.mp4'], imageUrls: ['r'], params: { resolution: '4k' } }))
  assert.deepEqual(up.calls[3].body, {
    model: 'omni_flash_abra_edit', prompt: 'go', source_video_url: 'public(/files/v.mp4)', aspect_ratio: '16:9', resolution: '4k', input_reference: ['ref(r)'],
  })
  await assert.rejects(gaorui.submit(cfg, run('omni-flash-edit')), (e) => e.i18n.code === 'provider.video_edit_needs_source')

  await gaorui.submit(cfg, run('sora-2-openai-12s', { params: { aspectRatio: '16:9' }, imageUrls: ['one', 'two'] }))
  assert.deepEqual(up.calls[4].body, { model: 'sora-2-openai-12s', prompt: 'go', size: '1280x720', input_reference: 'ref(one)' })

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

test('gaorui listModels: catalog plus chat models discovered from /v1/models', async (t) => {
  const up = await fakeUpstream({
    'GET /v1/models': () => ({ body: { data: [{ id: 'gpt-4o-mini' }, { id: 'claude-sonnet' }, { id: 'nano-banana-2' }, { id: 'veo3.1-fast' }, { id: 'text-embedding-3' }] } }),
  })
  t.after(up.close)
  const specs = await gaorui.listModels({ baseUrl: up.baseUrl, apiKey: 'k' })
  assert.equal(up.calls[0].headers.authorization, 'Bearer k')
  const chat = specs.filter((s) => s.kind === 'chat').map((s) => s.id)
  assert.deepEqual(chat, ['gpt-4o-mini', 'claude-sonnet'])
  for (const id of ['nano-banana-pro', 'nano-banana-2', 'nano-banana-2.1', 'nano-banana-2-lite']) {
    assert.equal(specs.filter((s) => s.id === id && s.kind === 'image').length, 1, id)
  }
  assert.deepEqual(await gaorui.test({ baseUrl: up.baseUrl, apiKey: 'k' }), { ok: true, modelCount: 5 })
  // Without a key, or with the upstream down, the catalog still lists.
  assert.ok((await gaorui.listModels({ baseUrl: up.baseUrl, apiKey: '' })).every((s) => s.kind !== 'chat'))
  assert.ok((await gaorui.listModels({ baseUrl: 'http://127.0.0.1:9', apiKey: 'k' })).length >= 4)
})

test('openai-compatible: chat with vision parts, images as url and b64_json', async (t) => {
  const up = await fakeUpstream({
    'POST /v1/chat/completions': () => ({ body: { choices: [{ message: { content: 'hello there' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } } }),
    'POST /v1/images/generations': (c) => ({ body: { data: c.body.model === 'b64' ? [{ b64_json: 'QUJD' }] : [{ url: 'https://img.example/1.png' }, { url: 'https://img.example/2.png' }] } }),
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

  // Explicit model lists win over discovery.
  const listed = await openai.listModels({ ...cfg, models: 'gpt-4o, my-llm', imageModels: 'gpt-image-1' })
  assert.deepEqual(listed.map((s) => [s.id, s.kind]), [['gpt-image-1', 'image'], ['gpt-4o', 'chat'], ['my-llm', 'chat']])
  const discovered = await openai.listModels(cfg)
  assert.deepEqual(discovered.map((s) => [s.id, s.kind]), [['gpt-4o', 'chat'], ['gpt-image-1', 'image']])
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

  const specs = await gemini.listModels({ ...cfg, models: 'gemini-2.5-flash-image, gemini-2.5-pro' })
  assert.deepEqual(specs.map((s) => [s.id, s.kind]), [['gemini-2.5-flash-image', 'image'], ['gemini-2.5-pro', 'chat']])
})

test('helpers: model list parsing and base URL normalisation', () => {
  assert.deepEqual(parseModelList(' a, b\nc，d ;a  '), ['a', 'b', 'c', 'd'])
  assert.deepEqual(parseModelList('ok-model, bad model!, <script>'), ['ok-model', 'bad', 'model!'].filter((x) => /^[\w.:/@-]+$/.test(x)))
  assert.deepEqual(parseModelList(''), [])
  assert.equal(openaiBase('https://api.example.com/'), 'https://api.example.com/v1')
  assert.equal(openaiBase('https://api.example.com/v1/'), 'https://api.example.com/v1')
  assert.equal(openaiBase('https://host/api/v3'), 'https://host/api/v3')
})
