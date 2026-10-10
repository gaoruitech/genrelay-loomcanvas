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
