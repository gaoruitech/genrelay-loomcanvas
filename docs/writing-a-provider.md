# Writing a provider

[简体中文](writing-a-provider.zh-CN.md)

A vendor is two files: a CommonJS module in `server/src/providers/` that translates between LoomCanvas runs and the vendor's API, and a catalog in `server/src/providers/catalog/` that states which models the vendor supports. This guide describes both exactly as the registry and the runner use them.

Read the built-in ones alongside this page: `gaorui.js` (asynchronous tasks), `openai.js` and `gemini.js` (synchronous), and their catalogs `catalog/gaorui.json`, `catalog/openai.json`, `catalog/gemini.json`.

Two rules apply to every vendor:

- **Models are stated, never inferred.** A vendor's models are the entries of its catalog. A module does not fetch a model list from the upstream to offer it, and nothing may derive a model's kind or abilities from its name. `server/test/vendors.test.js` fails if a vendor module has a function that lists models from the upstream, or tests a model name against a pattern.
- **Official API only for vendors other than Gaorui.** Gaorui's API is our own and may be non-standard. Any other vendor module sends what that vendor's official API documents and nothing else: no relay extensions, no private fields. A user may point a provider at another address, but only one that speaks the same official API.

## What the module does and does not do

| The vendor module and catalog | LoomCanvas |
| --- | --- |
| State the vendor's models and what a custom model gets | Prefixes ids with the provider's slug, adds the user's custom models, applies admin overrides |
| Build upstream requests, read responses | Decrypts the key, validates input, queues, enforces deadlines, retries, cancels |
| Return where the result is | Downloads it into storage, sniffs its type, makes thumbnails |
| Report token usage for chat | Estimates and records cost, calls the billing hook |

A vendor module never touches the database or the storage.

## The module shape

```js
const { loadCatalog } = require('./catalog')

module.exports = {
  type: 'acme',                       // required, /^[a-z0-9-]+$/, stable forever: the vendor id
  label: 'Acme',                      // display name
  defaultBaseUrl: 'https://…',        // the vendor's official address
  catalog: loadCatalog('acme'),       // required: catalog/acme.json, validated
  customKinds: ['image', 'chat'],     // required (may be empty): kinds a user may add by hand
  customSpec: (kind) => CUSTOM[kind], // required: what a custom model of that kind gets
  sync: false,                        // optional, see "Sync and async"
  recommended: false,                 // optional: shows the "Recommended" badge
  keyUrl: '',                         // optional: the "Get an API key" link in the form

  async test(cfg, { signal }) {},
  async submit(cfg, run) {},
  async poll(cfg, run) {},
  async chat(cfg, req) {},
}
```

`register()` throws at startup when:

- `type` is missing or not lowercase letters, digits and hyphens;
- one of `customSpec`, `test`, `submit`, `poll`, `chat` is not a function. A function your upstream has no use for must still exist and throw (see the example);
- `catalog` is not an array;
- `customKinds` is not an array, contains something other than `image`, `video` or `chat`, or lists a kind for which `customSpec(kind)` returns nothing.

There are no form fields to declare. Every vendor has the same form: API key, name, and the base URL under **Advanced**.

### `cfg`

`{ baseUrl, apiKey }`, with the key already decrypted. `baseUrl` is the address the user entered under **Advanced**, or your `defaultBaseUrl` when they did not. It is validated as an `http(s)` URL without credentials. Never log the key and never put it in an error message.

## The catalog file

`server/src/providers/catalog/<type>.json` has exactly three sections, and all three must be present. A vendor without models of some kind writes an empty list, so "none" is stated rather than implied.

```json
{
  "image": [
    {
      "id": "acme-image-1",
      "label": "Acme Image 1",
      "acceptsImage": true,
      "acceptsVideo": false,
      "videoEdit": false,
      "maxReferenceImages": 4,
      "options": { "aspectRatios": ["1:1", "16:9", "9:16"], "resolutions": ["1K", "2K"] },
      "defaults": { "aspectRatio": "1:1", "resolution": "1K", "count": 1 }
    }
  ],
  "video": [],
  "chat": []
}
```

**The section an entry sits in is its kind.** An entry must not carry a `kind` field.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The upstream model name, sent as is. Letters, digits and `. _ - : / @`, up to 120 characters. Becomes `<slug>:<id>`. Unique across the whole file. |
| `label` | string | Display name. Required, not empty. |
| `acceptsImage` | boolean | Reference images are accepted. For a chat model: it can read images. A chat model with `false` is text only: a chat request with images for it is refused with `model.no_image_input` before it reaches the module, and the Language model node does not send connected images to it. |
| `maxReferenceImages` | integer ≥ 0 | How many. Must be greater than 0 exactly when `acceptsImage` is `true`. |
| `acceptsVideo` | boolean | A video is accepted: for a video model as the source, for a chat model to read. A chat model with this flag is offered in the Video analysis node, and your `chat` receives `videoUrl`. A chat request with a video for a model without it is refused with `model.no_video_input` before it reaches the module. The OpenAI API has no content part for a video, so `chatCompletion()` in `openaiShared.js` refuses one too, unless the module states how its upstream takes it (the Gaorui module passes `{ videoAsImageUrl: true }`). |
| `videoEdit` | boolean | Offer this model in the Video edit node (and not in Video generation). Only allowed in the `video` section, on a model with `acceptsVideo`. |
| `options.aspectRatios` | string[] | Choices in the parameters dropdown. `'auto'` is conventional for "let the model decide". |
| `options.resolutions` | string[] | For example `["1K", "2K"]` or `["720p"]`. |
| `options.durations` | number[] | Seconds. |
| `options.counts` | number[] | How many results per click. |
| `options.imgModes` | string[] | `"multi"` (reference images) and/or `"frames"` (first and last frame). Arrives as `params.imgMode`. |
| `defaults` | object | Initial parameter values, merged under what the node sends: `aspectRatio`, `resolution`, `duration`, `imgMode`, `count`. |
| `imageByUrlOnly` | `true`, optional | Reference images reach this model as public URLs only: your `submit` uses `run.media.toPublicUrl()` for them, which refuses an image that has no public address. With the flag, the canvas says so before the run instead of after. Leave it out for models that also take inline data (`toRef`, `toBase64`). |
| `verified` | string, optional | `"YYYY-MM-DD"`: the day the project completed a real run of this model against the vendor's API (one full text-only run; for a video edit model, one edit). Write it only when that run happened. A model that has it shows a "Verified" badge in the UI; without it there is no badge. |
| `_anything` | any | Private to the vendor module, never served. See below. |

The validator (`validateCatalog` in `catalog/index.js`) runs when the module is loaded and throws on the first problem, so a broken catalog stops the server at startup instead of surfacing later as a model that half works. Beyond the table above it requires:

- no sections other than `image`, `video`, `chat`;
- all three flags (`acceptsImage`, `acceptsVideo`, `videoEdit`) written out as `true` or `false`, and `options` and `defaults` present as objects (`{}` when empty);
- no unknown fields. There is no `desc`, `tag` or `pricing` in a catalog: descriptions are i18n keys (below), and prices are entered by the operator;
- every option list non-empty, of the right type, without duplicates. An option list that is absent means the node does not show that control;
- every default taken from the matching option list (`defaults.aspectRatio` from `options.aspectRatios`, and so on). `defaults.count` is a positive integer, and one of `options.counts` when that list exists.

**Private fields.** A field whose name starts with `_` passes validation and is dropped before a spec leaves the server. Use it for what only your module needs, such as which request format a model takes (`"_protocol"` in `catalog/gaorui.json`). Private fields are not on `run.spec`; look the entry up in your own catalog by `run.model`.

**Where the entries come from.** For the built-in OpenAI and Gemini catalogs, the source of each entry is recorded in `server/src/providers/catalog/SOURCES.md`. Do the same for a vendor you add.

**Descriptions and names.** Both server message catalogs (`server/src/i18n/en.js` and `zh-CN.js`) carry:

- `provider.<type>.label`: the vendor's name. Without it, the `label` you declared is shown.
- `model.<type>.<model id>.desc`: a one-line description of each catalog model, shown in the model dropdown and in the supported-models list.

For the built-in vendors, `server/test/i18n.test.js` requires the label key and a `desc` key for every catalog model, in both languages, and rejects keys of these two shapes that belong to no known vendor or model. Its list of vendors is written out in the test, so add yours there.

## Custom models

A user can add a model your catalog does not list (see [Providers](providers.md#custom-models)). They state its name and its kind. You decide which kinds are possible and what such a model gets:

```js
const CUSTOM = {
  image: {
    acceptsImage: true,
    acceptsVideo: false,
    videoEdit: false,
    maxReferenceImages: 4,
    options: { aspectRatios: ['1:1', '16:9', '9:16'] },
    defaults: { aspectRatio: '1:1', count: 1 },
  },
}
```

- `customKinds` lists the kinds a user may pick. Leave a kind out when there is no request that fits any model of that kind. All three built-in vendors leave out `video`.
- `customSpec(kind)` returns the abilities and parameters for that kind, in the same shape as a catalog entry without `id` and `label`. The registry adds the name, the kind and `custom: true`.
- A custom model reaches `submit` and `chat` like any other. `run.model` is the name the user typed, `run.kind` the kind they chose, and `run.spec.custom` is `true`. It has no catalog entry, so a module that picks a request format per catalog entry needs a fallback by `run.kind` (see `protocolOf` in `gaorui.js`).
- The registry refuses a custom model whose name is in your catalog, and one of a kind you did not list.

## Functions

### `test(cfg, { signal }) → { ok?, message? }`

Connection test behind the **Test connection** button, with a 20-second abort signal. Do something cheap that proves the address and key work. The built-in modules call the upstream's model-list endpoint for this and discard the list.

- Return `{ ok: true }` on success. `message` is optional; without it a standard "Connected" is shown.
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
| `model` | The upstream model name, without the slug: the catalog entry's `id`, or the name of a custom model. |
| `spec` | The merged [ModelSpec](#modelspec-reference), or `null` if the model has since been removed (a deleted custom model). `spec.maxReferenceImages` is the model's reference image limit, available for capping what you send; `spec.custom` tells a custom model from a catalog one. |
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

Canvas URLs are usually site-relative (`/files/…`). Never forward them unchanged.

The URL that `toRef` and `toPublicUrl` return is for the upstream request you are building, and for nothing else. For a file kept in a bucket it can be a **presigned URL**: it carries a signature in its query string, lets anyone who has it read the file, and expires after one hour. So:

- Put it in the request to the upstream and nowhere else. Do not log it, and do not put it in an error message, in `outputs` or in anything else you return.
- Do not keep it for later. Call the helper again in `poll` if you need the address again; a URL from `submit` may have expired by then.
- An upstream that fetches the URL long after it accepted the task (more than an hour) will find it expired.

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

An async vendor module may still return `{ outputs }` from `submit` for individual requests; that works too.

Restart behaviour of a run that has no `externalId` yet: nothing is sent to an upstream twice. If the server shuts down before `submit` (or `chat`) was called for the run, it goes back to the queue and is submitted by the next process. If the call had started, the run fails with `run.interrupted`, because nobody knows whether the upstream accepted it; the same happens to runs found in that state after a crash. A sync vendor module never has an `externalId`, so each of its runs that is in flight when the server stops ends this way, and so does every `chat` call.

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

The vendor's name and the model descriptions are entries of the same two message catalogs; see [The catalog file](#the-catalog-file).

## ModelSpec reference

What the server serves for each model (`GET /api/models`, `run.spec`). It is built from a catalog entry or from `customSpec(kind)`; you do not write it yourself.

| Property | From | Meaning |
| --- | --- | --- |
| `id` | the provider's slug and the entry's `id` | `<slug>:<id>` |
| `providerId`, `providerName`, `providerType` | the provider | Its database id, its name, and the vendor id. |
| `kind` | the catalog section, or the kind the user chose | `'image'`, `'video'` or `'chat'` |
| `label` | the entry's `label`; for a custom model the user's display name, else the model name | Display name. An admin override can replace it. |
| `custom` | | `true` for a custom model, `false` for a catalog model. |
| `desc` | `model.<type>.<model id>.desc` | One-line description, in the reader's language. Catalog models only. |
| `acceptsImage`, `acceptsVideo`, `videoEdit`, `maxReferenceImages`, `options`, `defaults` | the entry or `customSpec(kind)` | As in [the catalog file](#the-catalog-file). An admin override can change `defaults`. |
| `imageByUrlOnly` | the entry or `customSpec(kind)` | `true` when reference images go out as public URLs only. Absent otherwise. |
| `verified` | the entry's `verified` | The day the project ran this model against the real API. Catalog models only; a custom model never has it. |
| `pricing` | the admin override | Only when the operator entered a price. Without it the model shows "Cost unknown". See [Providers](providers.md#pricing). |

Private (`_`) fields and anything not in this table are dropped.

## A worked example

An imaginary vendor whose official API is:

- `GET /v1/me` → 200 when the key is valid
- `POST /v1/generate` `{ model, prompt, images, ratio, size }` → `{ task_id }`
- `GET /v1/tasks/:id` → `{ state: 'working' | 'done' | 'failed', percent, image_url, message }`

`server/src/providers/catalog/acme.json`:

```json
{
  "image": [
    {
      "id": "acme-image-1",
      "label": "Acme Image 1",
      "acceptsImage": true,
      "acceptsVideo": false,
      "videoEdit": false,
      "maxReferenceImages": 4,
      "options": { "aspectRatios": ["1:1", "16:9", "9:16"], "resolutions": ["1K", "2K"] },
      "defaults": { "aspectRatio": "1:1", "resolution": "1K", "count": 1 }
    }
  ],
  "video": [],
  "chat": []
}
```

`server/src/providers/acme.js`:

```js
'use strict'

const { loadCatalog } = require('./catalog')
const { request, ProviderError, trimBase } = require('./http')
const { msg } = require('../i18n')

const DEFAULT_BASE_URL = 'https://api.acme.example'

// What a model the user added by hand gets. No resolution option: sizes
// differ per model, so a custom one is left at the model's own default.
const CUSTOM = {
  image: {
    acceptsImage: true,
    acceptsVideo: false,
    videoEdit: false,
    maxReferenceImages: 4,
    options: { aspectRatios: ['1:1', '16:9', '9:16'] },
    defaults: { aspectRatio: '1:1', count: 1 },
  },
}

function base(cfg) {
  return trimBase(cfg.baseUrl || DEFAULT_BASE_URL)
}

function auth(cfg) {
  if (!cfg.apiKey) throw new ProviderError('provider.api_key_missing')
  return { Authorization: `Bearer ${cfg.apiKey}` }
}

module.exports = {
  type: 'acme',
  label: 'Acme',
  defaultBaseUrl: DEFAULT_BASE_URL,
  catalog: loadCatalog('acme'),
  // This API has no chat and no video endpoint, so only images can be added by hand.
  customKinds: ['image'],
  customSpec: (kind) => CUSTOM[kind],

  async test(cfg, { signal } = {}) {
    await request({ url: `${base(cfg)}/v1/me`, headers: auth(cfg), signal, timeoutMs: 15000 })
    return { ok: true }
  },

  async submit(cfg, run) {
    if (run.kind !== 'image') throw new ProviderError('provider.model_not_supported', { model: run.model })
    if (!run.prompt) throw new ProviderError('run.prompt_required')
    const max = (run.spec && run.spec.maxReferenceImages) || CUSTOM.image.maxReferenceImages
    const images = []
    for (const url of (run.imageUrls || []).slice(0, max)) images.push(await run.media.toRef(url))
    const data = await request({
      method: 'POST',
      url: `${base(cfg)}/v1/generate`,
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
      url: `${base(cfg)}/v1/tasks/${encodeURIComponent(run.externalId)}`,
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

Messages, in both `server/src/i18n/en.js` and `zh-CN.js`:

```js
'provider.acme.label': 'Acme',
'model.acme.acme-image-1.desc': 'Image generation with up to 4 reference images',
```

## Registering it

Add one line to `server/src/providers/index.js`, after the built-in ones. Registration order is display order:

```js
register(require('./acme'))
```

Then update the tests that pin the set of vendors on purpose:

- `server/test/registry.test.js`: the list of registered vendor ids and their order.
- `server/test/vendors.test.js`: the `VENDORS` list, and the model names each catalog holds.
- `server/test/i18n.test.js`: the list of vendors whose label and description keys are required.

Restart the server. The vendor appears in **Settings → Providers → Add provider** and on the setup page, with its supported models. No frontend change is needed: the page is drawn from `GET /api/admin/vendors`. Optionally add `settings.vendors.acme` (`label`, `desc`) to `web/src/locales/modules/settings.ts` for the one-line description on the vendor card, and so that the name follows a language switch without a reload.

There is no way to load a vendor from outside the source tree yet; a vendor is part of your build.

## Testing against a fake upstream

The project tests vendor modules by starting a small HTTP server that records requests and answers from a route table, then calling the module's functions directly. Copy the pattern from `server/test/providers.test.js`. For the example above, `server/test/acme.test.js`:

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
- It does **not** prove the real upstream agrees. Run at least one real generation before relying on a vendor module.

For the layers around the module:

- `server/test/vendors.test.js` checks every catalog against the validator, the custom-model rules of each vendor, and that no code reads a kind off a model name. `server/test/vendors.e2e.test.js` does the same through the admin API.
- `server/test/runner.test.js` drives the runner with stub providers and an in-memory store (`runner/memoryStore.js`): deadlines, retries, cancellation, restart.
- `server/test/api.e2e.test.js` runs the whole server over HTTP against a fake upstream, including the download of results. It sets `SSRF_ALLOW_HOSTS`-style access to `127.0.0.1` so the fake upstream's result links can be fetched.
- To try a vendor module by hand against a fake upstream on your machine, start the server with `SSRF_ALLOW_HOSTS=127.0.0.1`. Do not set that in production.
