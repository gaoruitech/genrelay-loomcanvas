# Writing a provider

[简体中文](writing-a-provider.zh-CN.md)

A provider type is one CommonJS module in `server/src/providers/`. It translates between LoomCanvas runs and one upstream API format. This guide describes the interface exactly as the registry and the runner use it.

Read the built-in ones alongside this page: `gaorui.js` (asynchronous tasks), `openaiCompatible.js` and `gemini.js` (synchronous).

## What the plugin does and does not do

| The plugin | LoomCanvas |
| --- | --- |
| Lists its models | Prefixes ids with the instance slug, applies admin overrides, caches the list |
| Builds upstream requests, reads responses | Decrypts the key, validates input, queues, enforces deadlines, retries, cancels |
| Returns where the result is | Downloads it into storage, sniffs its type, makes thumbnails |
| Reports token usage for chat | Estimates and records cost, calls the billing hook |

A plugin never touches the database or the storage.

## The module shape

```js
module.exports = {
  type: 'acme',                 // required, /^[a-z0-9-]+$/, stable forever
  label: 'Acme',                // display name
  defaultBaseUrl: 'https://…',  // optional
  fields: [ /* form fields */ ],// required (may be empty)
  sync: false,                  // optional, see "Sync and async"

  async listModels(cfg, { signal }) {},
  async test(cfg, { signal }) {},
  async submit(cfg, run) {},
  async poll(cfg, run) {},
  async chat(cfg, req) {},
}
```

All five functions are required; `register()` throws at startup if one is missing. A function your upstream has no use for must still exist and throw (see the example).

### `fields`

Each entry describes one input of the provider form.

| Property | Type | Meaning |
| --- | --- | --- |
| `key` | string | Field name. Two keys are special, see below. |
| `label` | string | Shown next to the input. |
| `type` | `'text'` \| `'password'` \| `'textarea'` | Optional. Defaults to `password` when `secret`, else `text`. |
| `secret` | boolean | Mask the input. |
| `required` | boolean | The server enforces it for `apiKey` and `baseUrl`; the form checks the rest. |
| `placeholder`, `help` | string | Optional hints. |

- `apiKey` is encrypted at rest and reaches you as `cfg.apiKey`.
- `baseUrl` is validated as an `http(s)` URL without credentials and reaches you as `cfg.baseUrl` (or `defaultBaseUrl` when the user left it empty).
- Every other field is stored as a plain string (up to 5000 characters) and reaches you as `cfg.<key>`. Do not put secrets in them.

### `cfg`

`{ baseUrl, apiKey, ...your other fields }`, with the key already decrypted. Never log it and never put it in an error message.

## Functions

### `listModels(cfg, { signal }) → ModelSpec[]`

Return the models this instance offers, with ids local to the upstream (no slug prefix). Called with a 12-second abort signal; the result is cached for five minutes.

- If it throws, the last good list is used, or an empty list when there is none. So a fixed catalog should not depend on the network.
- It may be called before a key is set. Return what you can instead of throwing.

See [ModelSpec reference](#modelspec-reference).

### `test(cfg, { signal }) → { ok?, message?, modelCount? }`

Connection test behind the **Test connection** button, with a 20-second abort signal. Do something cheap that proves the address and key work.

- Return `{ ok: true, modelCount }` on success. `message` is optional; without it a standard "Connected" is shown.
- Throw on failure. A user-facing error's message is shown; anything else shows "Connection failed".

### `submit(cfg, run) → { externalId } | { outputs }`

Start a generation.

- Return `{ externalId }` when the upstream created a task to poll later. The id is stored with the run, which is what makes it resumable after a restart.
- Return `{ outputs: [...] }` when the result is already available.
- Returning neither fails the run with `upstream.no_task_id`.

### `poll(cfg, run) → { status, progress?, outputs?, error? }`

Check a task. `run.externalId` is what `submit` returned.

| `status` | Other fields | Effect |
| --- | --- | --- |
| `'succeeded'` | `outputs` (non-empty) | The run moves to archiving. |
| `'failed'` | `error` | The run fails. `error` is the upstream's own words (a string, shown inside "Generation failed at the upstream: …") or a message object from `msg()`. |
| anything else | `progress` 0–100 | Still running. Progress only moves forward and is capped at 94 until the result is stored. |

`poll` is called every 2 to 8 seconds. Each call has at most 30 seconds.

### `chat(cfg, req) → { text, usage? }`

One chat completion for the Language model and Video analysis nodes. `usage` is `{ inputTokens, outputTokens }`; return it when the upstream reports it, so per-token prices can be applied. An empty `text` fails the run.

### The `run` / `req` object

`submit`, `poll` and `chat` receive the same shape:

| Property | Meaning |
| --- | --- |
| `id` | Run id (string). |
| `kind` | `'image'`, `'video'` or `'chat'`. |
| `model` | The upstream model id (your spec's `id`, without the slug). |
| `spec` | The merged ModelSpec, or `null` if the model has since disappeared from your list. |
| `prompt`, `systemPrompt` | Strings, possibly empty. |
| `imageUrls` | Canvas URLs of reference images, already cut to the model's `maxReferenceImages`. |
| `videoUrls`, `videoUrl` | Source video (at most one), only for models with `acceptsVideo`, chat models included. |
| `params` | The model's `defaults` merged with what the node sent: small strings, numbers and booleans such as `aspectRatio`, `resolution`, `duration`, `imgMode`, `count`. Validate them yourself. |
| `externalId` | Set in `poll`. |
| `signal` | AbortSignal carrying the deadline and cancellation. **Pass it to every request.** |
| `media` | Helpers that turn a canvas URL into something the upstream can read. They are bound to the same abort signal as this call, so loading reference media stops on cancel, deadline and shutdown. |

`run.media`:

| Helper | Returns | Use when the upstream takes |
| --- | --- | --- |
| `await media.toBase64(url)` | `{ mime, data }` (base64, images only, up to 20 MB) | inline bytes |
| `await media.toRef(url)` | a public URL, or a `data:` URI when there is no public address | either form in one field |
| `await media.toPublicUrl(url, what?)` | a public URL, or throws `media.needs_public_url` | URLs only (and for video) |

Canvas URLs may be site-relative (`/files/…`). Never forward them unchanged.

### Outputs

```js
{ type: 'image' | 'video' | 'audio', url: 'https://…', headers?: { … } }  // remote file
{ type: 'image', b64: '…', mime?: 'image/png' }                          // inline base64
```

- `headers` are sent when downloading, for results behind authentication. Only add them when the URL is on the API host; a signed CDN link must be fetched without your key.
- A `data:` URL in `url` is accepted for images.
- The downloaded file is checked by content: an "image" that is not an image fails the run. Limits: 60 MB per image, 1 GB per video.
- Downloads go through the SSRF guard. If your upstream is on a private network and returns links to itself, the operator must list its host in `SSRF_ALLOW_HOSTS`.

## Sync and async

| | Async (default) | Sync (`sync: true`) |
| --- | --- | --- |
| `submit` returns | `{ externalId }` | `{ outputs }` |
| `submit` deadline | `submitTimeoutSec` (default 60 s) | the image or video timeout |
| `poll` | called until done | never called; implement it to throw `provider.no_async` |
| After a restart | polling resumes | see below |

Set `sync: true` whenever `submit` waits for the finished result. Without it, the call is cut off after the submit timeout.

An async plugin may still return `{ outputs }` from `submit` for individual requests; that works too.

Restart behaviour of a run that has no `externalId` yet: nothing is sent to an upstream twice. If the server shuts down before `submit` (or `chat`) was called for the run, it goes back to the queue and is submitted by the next process. If the call had started, the run fails with `run.interrupted`, because nobody knows whether the upstream accepted it; the same happens to runs found in that state after a crash. A sync plugin never has an `externalId`, so each of its runs that is in flight when the server stops ends this way, and so does every `chat` call.

## Errors

Throw `ProviderError` from `./http`:

```js
const { ProviderError } = require('./http')

throw new ProviderError('upstream.error_detail', { detail: upstreamMessage })
throw new ProviderError('upstream.unrecognized', {}, { transient: true })
```

- The first argument is a key of the server message catalog (`server/src/i18n/en.js` and `zh-CN.js`); the second fills its `{placeholders}`. The user sees the message in their own language, and API clients get the key as `code`.
- Text from the upstream goes into a parameter such as `detail`. It is shown as it is, untranslated.
- The third argument sets flags the runner acts on:

| Flag | Meaning | Runner behaviour |
| --- | --- | --- |
| `safeToResubmit: true` | The upstream **certainly** did not accept the request. | `submit` is retried, up to `maxRetries` times, with 1 s, 2 s, 4 s… pauses, inside the deadline. |
| `transient: true` | Worth asking again later. | `poll` keeps going until the deadline. Without it, five consecutive poll errors fail the run. |

Never set `safeToResubmit` for a timeout or a dropped connection: the task may exist, and a second submission would be billed twice.

Use the `request()` helper from `./http` and most of this is done for you:

| Situation | Message | `transient` | `safeToResubmit` |
| --- | --- | --- | --- |
| Connection never established (refused, DNS failure, unreachable) | `upstream.unreachable` | yes | yes |
| Reset, timeout, broken pipe | `upstream.interrupted` | yes | no |
| HTTP 401 / 403 | `upstream.auth_rejected` | no | no |
| HTTP 429 / 503 | `upstream.http_error` | yes | yes |
| HTTP 408 / 500 / 502 / 504 | `upstream.http_error` | yes | no |
| Other non-2xx | `upstream.http_error` | no | no |

When the error body carries a message (`error.message`, `message`, `msg`, `detail` or `fail_reason`), the `_detail` variant of the key is used and includes it. `request()` does not follow redirects and caps responses at 80 MB.

Other rules:

- An error that is not user-facing (a plain `Error`, a bug) is logged on the server and the user sees the generic `run.failed`. Nothing from it leaks.
- Many APIs answer HTTP 200 with an error inside the body. Check for it and throw.
- If you need a new message, add the key to **both** catalogs; `server/test/i18n.test.js` fails when the two differ, when code uses a missing key, or when a catalog key is unused. Reusing existing `upstream.*` keys avoids that work.

Display names can be localized the same way, by adding `provider.<type>.label` and `provider.<type>.field.<key>.label` / `.help` to both catalogs. Without them, the `label` and `help` you declared are shown.

## ModelSpec reference

What `listModels` returns for each model. Unknown properties (and anything starting with `_`) are dropped before the spec leaves the server, so you can keep private data such as a protocol name on the same object.

| Property | Type | Default | Meaning |
| --- | --- | --- | --- |
| `id` | string | required | Upstream model id. Becomes `<slug>:<id>`. |
| `kind` | `'image'` \| `'video'` \| `'chat'` | required | Entries with another kind are dropped. |
| `label` | string | `id` | Display name. |
| `desc` | string | none | One-line description in the dropdown. |
| `tag` | string | none | Small badge in the dropdown. |
| `acceptsImage` | boolean | `false` | Reference images are accepted. |
| `acceptsVideo` | boolean | `false` | A source video is accepted. For a chat model: it is offered in the Video analysis node, and your `chat` receives `videoUrl`. A chat request with a video for a model without this flag is refused with `model.no_video_input` before it reaches the plugin. |
| `videoEdit` | boolean | `false` | Offer this model in the Video edit node (and not in Video generation). |
| `maxReferenceImages` | integer | `0` | Extra images are cut off before `submit`. |
| `options.aspectRatios` | string[] | none | Choices in the parameters dropdown. `'auto'` is conventional for "let the model decide". |
| `options.resolutions` | string[] | none | For example `['1K', '2K']` or `['720p']`. |
| `options.durations` | number[] | none | Seconds. |
| `options.counts` | number[] | none | How many results per click. The canvas submits one run per unit. |
| `options.imgModes` | string[] | none | `'multi'` (reference images) and/or `'frames'` (first and last frame). Arrives as `params.imgMode`. |
| `defaults` | object | `{}` | Initial parameter values, merged under what the node sends. |
| `pricing` | object | none | Only if you are sure of the price. Without it the model shows "Cost unknown" and the operator can enter a price. See [Providers](providers.md#pricing). |

An option list that is absent means the node does not show that control.

## A worked example

An imaginary upstream with this API:

- `GET /v1/me` → 200 when the key is valid
- `POST /v1/generate` `{ model, prompt, images, ratio, size }` → `{ task_id }`
- `GET /v1/tasks/:id` → `{ state: 'working' | 'done' | 'failed', percent, image_url, message }`

`server/src/providers/acme.js`:

```js
'use strict'

const { request, ProviderError, trimBase } = require('./http')
const { msg } = require('../i18n')

const MODELS = [
  {
    id: 'acme-image-1',
    label: 'Acme Image 1',
    kind: 'image',
    acceptsImage: true,
    maxReferenceImages: 4,
    options: { aspectRatios: ['1:1', '16:9', '9:16'], resolutions: ['1K', '2K'] },
    defaults: { aspectRatio: '1:1', resolution: '1K', count: 1 },
  },
]

function auth(cfg) {
  if (!cfg.apiKey) throw new ProviderError('provider.api_key_missing')
  return { Authorization: `Bearer ${cfg.apiKey}` }
}

module.exports = {
  type: 'acme',
  label: 'Acme',
  defaultBaseUrl: 'https://api.acme.example',
  fields: [
    { key: 'apiKey', label: 'API Key', secret: true, required: true },
    { key: 'baseUrl', label: 'Base URL', placeholder: 'https://api.acme.example' },
  ],

  async listModels() {
    return MODELS
  },

  async test(cfg, { signal } = {}) {
    await request({ url: `${trimBase(cfg.baseUrl)}/v1/me`, headers: auth(cfg), signal, timeoutMs: 15000 })
    return { ok: true, modelCount: MODELS.length }
  },

  async submit(cfg, run) {
    if (!run.prompt) throw new ProviderError('run.prompt_required')
    const images = []
    for (const url of run.imageUrls || []) images.push(await run.media.toRef(url))
    const data = await request({
      method: 'POST',
      url: `${trimBase(cfg.baseUrl)}/v1/generate`,
      headers: { 'Content-Type': 'application/json', ...auth(cfg) },
      data: { model: run.model, prompt: run.prompt, images, ratio: run.params.aspectRatio, size: run.params.resolution },
      signal: run.signal,
      timeoutMs: 60000,
    })
    if (!data || !data.task_id) throw new ProviderError('upstream.no_task_id')
    return { externalId: String(data.task_id) }
  },

  async poll(cfg, run) {
    const data = await request({
      url: `${trimBase(cfg.baseUrl)}/v1/tasks/${encodeURIComponent(run.externalId)}`,
      headers: auth(cfg),
      signal: run.signal,
      timeoutMs: 20000,
    })
    if (!data || typeof data !== 'object') throw new ProviderError('upstream.unrecognized', {}, { transient: true })
    if (data.state === 'done') {
      if (!data.image_url) return { status: 'failed', error: msg('upstream.no_image_url') }
      return { status: 'succeeded', outputs: [{ type: 'image', url: data.image_url }] }
    }
    if (data.state === 'failed') return { status: 'failed', error: String(data.message || '') }
    return { status: 'running', progress: Number(data.percent) || 0 }
  },

  async chat() {
    throw new ProviderError('run.chat_unsupported')
  },
}
```

## Registering it

Add one line to `server/src/providers/index.js`, next to the built-in ones:

```js
register(require('./acme'))
```

Restart the server. The type appears in **Settings → Providers → Add provider** and on the setup page. No frontend change is needed: the form is drawn from `fields`.

There is no way to load a provider from outside the source tree yet; a provider is part of your build.

## Testing against a fake upstream

The project tests providers by starting a small HTTP server that records requests and answers from a route table, then calling the plugin functions directly. Copy the pattern from `server/test/providers.test.js`. For the example above, `server/test/acme.test.js`:

```js
'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const acme = require('../src/providers/acme')

/** Fake upstream: records every request, answers from a route table. */
async function fakeUpstream(routes) {
  const calls = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString()
      const call = { method: req.method, path: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null }
      calls.push(call)
      const handler = routes[`${req.method} ${req.url}`]
      const out = handler ? handler(call) : { status: 404, body: { error: { message: 'no such route' } } }
      res.statusCode = out.status || 200
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(out.body))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { calls, baseUrl: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close() } }
}

// Stand-ins for run.media, so the test does not need storage.
const media = {
  async toRef(url) { return `ref(${url})` },
  async toBase64(url) { return { mime: 'image/png', data: Buffer.from(url).toString('base64') } },
  async toPublicUrl(url) { return `public(${url})` },
}
const signal = new AbortController().signal

test('acme: submit, poll, errors', async (t) => {
  let task = { state: 'working', percent: 30 }
  const up = await fakeUpstream({
    'POST /v1/generate': (c) => (c.body.prompt === 'busy' ? { status: 503, body: { message: 'try later' } } : { body: { task_id: 't-1' } }),
    'GET /v1/tasks/t-1': () => ({ body: task }),
  })
  t.after(up.close)
  const cfg = { baseUrl: up.baseUrl, apiKey: 'sk-test' }
  const run = { kind: 'image', model: 'acme-image-1', prompt: 'a cat', imageUrls: ['/files/a.png'], params: { aspectRatio: '16:9', resolution: '2K' }, media, signal }

  assert.deepEqual(await acme.submit(cfg, run), { externalId: 't-1' })
  assert.equal(up.calls[0].headers.authorization, 'Bearer sk-test')
  assert.deepEqual(up.calls[0].body, { model: 'acme-image-1', prompt: 'a cat', images: ['ref(/files/a.png)'], ratio: '16:9', size: '2K' })

  const polling = { ...run, externalId: 't-1' }
  assert.deepEqual(await acme.poll(cfg, polling), { status: 'running', progress: 30 })
  task = { state: 'done', image_url: 'https://cdn.example/out.png' }
  assert.deepEqual(await acme.poll(cfg, polling), { status: 'succeeded', outputs: [{ type: 'image', url: 'https://cdn.example/out.png' }] })
  task = { state: 'failed', message: 'content rejected' }
  assert.deepEqual(await acme.poll(cfg, polling), { status: 'failed', error: 'content rejected' })

  // 503 means "not accepted": the runner may submit again.
  await assert.rejects(acme.submit(cfg, { ...run, prompt: 'busy' }), (e) => e.userFacing && e.transient && e.safeToResubmit)
  await assert.rejects(acme.submit({ ...cfg, apiKey: '' }, run), (e) => e.i18n.code === 'provider.api_key_missing')
})
```

Run it:

```bash
cd server
npm test
```

What such a test proves, and what it does not:

- It pins the request you send and the responses you accept.
- It does **not** prove the real upstream agrees. Run at least one real generation before relying on a provider.

For the layers around the plugin:

- `server/test/runner.test.js` drives the runner with stub providers and an in-memory store (`runner/memoryStore.js`): deadlines, retries, cancellation, restart.
- `server/test/api.e2e.test.js` runs the whole server over HTTP against a fake upstream, including the download of results. It sets `SSRF_ALLOW_HOSTS`-style access to `127.0.0.1` so the fake upstream's result links can be fetched.
- To try a plugin by hand against a fake upstream on your machine, start the server with `SSRF_ALLOW_HOSTS=127.0.0.1`. Do not set that in production.
