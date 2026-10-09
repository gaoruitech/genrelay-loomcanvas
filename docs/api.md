# HTTP API reference

[简体中文](api.zh-CN.md)

This is the API the LoomCanvas frontend uses. It is written from the route files in `server/src/routes/`. The Chinese design contract between frontend and backend is [architecture.md](architecture.md); when the two disagree, the code wins and one of the documents has a bug.

> Status: early development. Paths and shapes may change before the first tagged release. There is no API versioning yet.

## Conventions

### Base URL and format

- Every endpoint is under `/api`. Stored files are served under `/files` (local storage driver).
- Request bodies are JSON (`Content-Type: application/json`), except the file upload, which is `multipart/form-data`.
- JSON bodies are limited to 1 MB, or 6 MB under `/api/workflow`, or 64 KB for `/api/auth` and `/api/canvas-share`. On protected endpoints the body is parsed only after the token has been checked.
- Ids are 24-character hexadecimal strings.
- API responses are sent with `Cache-Control: no-store` and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.

### Response envelope

Success:

```json
{ "result": 0, "message": "ok", "data": { } }
```

Failure, with a matching HTTP status:

```json
{ "result": -1, "message": "model is required", "code": "validation.required", "data": null }
```

| Field | Meaning |
| --- | --- |
| `result` | `0` on success. Non-zero on failure: `-1`, or the HTTP status for `401`, `404` (unknown route) and `429`. |
| `message` | Text for the user, in the language of the request. |
| `code` | Failure only. Stable identifier of the message (a key of `server/src/i18n/en.js`). Branch on this, not on `message`. Empty when the text has no catalog entry, for example a billing hook's own reason. |
| `data` | The payload, or `null` on failure. |

Two endpoints stream a file instead of JSON on success: `POST /api/workflow/download` and `POST /api/workflow/:id/download-zip`.

### Language

The language of `message`, of run failure reasons and of built-in names is chosen per request, first match wins:

1. `X-Locale` header: `zh-CN` or `en`
2. `Accept-Language` header
3. the `defaultLocale` setting
4. `zh-CN`

### Authentication

When `ACCESS_PASSWORD` is empty, no authentication is needed and every request passes.

When it is set, exchange the password for a token and send it on every request:

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"password":"your access password"}'
```

```
Authorization: Bearer <token>
```

- Tokens are valid for 30 days and stop working when `ACCESS_PASSWORD` or `SECRET_KEY` changes.
- Public without a token: `GET /api/app/bootstrap`, `POST /api/auth/login`, `GET /api/canvas-share/:token`, and `GET /files/*`.
- Everything else answers `401` with code `auth.login_required` when the token is missing or invalid. A `401` from this API always means "not signed in"; upstream authentication failures are reported as `400`.

### Common errors

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `validation.*` | A field is missing or has the wrong type, format or range. `message` names the field. |
| 400 | `common.body_not_json` | The body is not valid JSON. |
| 400 | `common.bad_request` | The request itself is malformed (bad encoding in the path, unsupported charset…). |
| 401 | `auth.login_required` | No valid token. |
| 404 | `common.route_not_found` | No such endpoint. |
| 404 | `common.not_found`, `*.not_found` | No such record. |
| 409 | `common.duplicate` | A unique value already exists. |
| 413 | `common.body_too_large`, `file.too_large` | Body or upload over the limit. |
| 429 | `auth.too_many_attempts` | Login rate limit. |
| 429 | `run.queue_full` | Too many unfinished runs. |
| 500 | `common.internal` | Unexpected error. Details are in the server log only. |

### CORS

No cross-origin access is granted by default. Origins listed in `CORS_ORIGIN` may call `/api` with the headers `Authorization`, `Content-Type` and `X-Locale`.

---

## App and login

### GET /api/app/bootstrap

Public. What a client needs before anything else; also the health check.

Response `data`:

```json
{
  "authRequired": true,
  "authed": false,
  "site": { "name": "LoomCanvas", "logoUrl": "", "defaultTheme": "light", "defaultLocale": "zh-CN" },
  "hasProvider": false,
  "limits": { "maxUploadMb": 50 },
  "version": "0.1.0"
}
```

`hasProvider` is `true` when at least one enabled provider exists; it is always `false` for a caller who is not signed in. `limits.maxUploadMb` is the server's `MAX_UPLOAD_MB`, so a client can refuse a file that is too large before uploading it.

### POST /api/auth/login

Public. Body: `{ "password": string }`. Response: `{ "token": string }`.

When no password is configured, it answers `{ "token": "" }` with the message `auth.not_enabled`.

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `auth.password_required` | No password in the body. |
| 401 | `auth.wrong_password` | Wrong password. |
| 429 | `auth.too_many_attempts` | More than 10 attempts from one client in 10 minutes (an IPv6 client counts as its /64), or more than 300 from all clients together in 10 minutes. Once the total is reached, every login is refused until the window ends; tokens already issued keep working. The counters are in memory, per process. |

---

## Files

### POST /api/files/upload

`multipart/form-data` with one field named `file`. Size limit: `MAX_UPLOAD_MB`. The type is detected from the content; images, videos and audio are accepted.

Response `data`:

```json
{
  "url": "/files/uploads/2026/10/3f…c1.png",
  "key": "uploads/2026/10/3f…c1.png",
  "size": 182044,
  "mime": "image/png",
  "width": 1024,
  "height": 768,
  "thumbnailUrl": "/files/thumbs/of/uploads/2026/10/3f…c1_png.webp"
}
```

`width`, `height` and `thumbnailUrl` are present for images only. With the local storage driver `url` is always site-relative (`/files/<key>`), whatever `PUBLIC_URL` is; with object storage it is an absolute URL under the bucket's public base URL.

Errors: `file.missing`, `file.empty`, `file.unsupported_type`, `file.image_corrupt` (400); `file.too_large` (413).

### POST /api/files/fetch

Body: `{ "url": string }`. The server downloads a remote **image** (through the SSRF guard, up to `MAX_UPLOAD_MB`) and stores it. A URL that already points at this instance's storage is returned as it is. Response as for upload.

Errors (400): `file.image_only` (also for a stored file that is not an image), `fetch.*` (for example `fetch.private_address`, `fetch.http_error`, `fetch.timeout`); `file.not_found` (404).

### GET /files/:key

Public. Serves a stored file with the local storage driver. Supports range requests. Anything that is not an image, video or audio file is sent as a download. Thumbnails under `thumbs/of/…` are generated on first request; when a thumbnail cannot be made the response is a `302` to the original. Unknown keys answer `404` with an empty body.

---

## Models and runs

### GET /api/models

Query: `kind` (optional) = `image` | `video` | `chat`.

Response: an array of ModelSpec, for the enabled models of enabled providers.

```json
{
  "id": "gaorui:nano-banana-2",
  "providerId": "665f…",
  "providerName": "Gaorui API",
  "providerType": "gaorui",
  "label": "Nano Banana 2",
  "desc": "Image generation and editing",
  "kind": "image",
  "acceptsImage": true,
  "acceptsVideo": false,
  "videoEdit": false,
  "maxReferenceImages": 8,
  "options": { "aspectRatios": ["auto", "1:1"], "resolutions": ["1K", "2K", "4K"] },
  "defaults": { "aspectRatio": "auto", "resolution": "1K", "count": 1 },
  "pricing": { "currency": "CNY", "unit": "per_image", "price": 0.1 }
}
```

`options` may contain `aspectRatios`, `resolutions`, `durations`, `counts` and `imgModes`. `desc`, `tag` and `pricing` are optional. See [Writing a provider](writing-a-provider.md#modelspec-reference).

For a chat model, `acceptsVideo` says whether it can be given a video (`videoUrl` of `POST /api/llm/tasks`). Chat models of OpenAI-compatible and Gaorui providers report `true`; Gemini chat models report `false`. The Video analysis node lists only chat models with `acceptsVideo`.

### POST /api/runs/estimate

Body: `{ "model": string, "params"?: object, "count"?: number }`.

Response:

```json
{ "unitCost": 0.1, "totalCost": 0.1, "currency": "CNY", "unknown": false }
```

When no price applies, `unknown` is `true` and the amounts are `0`. Chat models priced per token are always `unknown` here.

Errors (400): `validation.required` (model), `model.bad_id`, `model.provider_missing`, `model.provider_disabled`, `model.disabled`, `model.unavailable`.

### POST /api/runs

Starts an image or video run.

```json
{
  "model": "gaorui:nano-banana-2",
  "prompt": "an orange cat on a windowsill",
  "imageUrls": ["/files/uploads/2026/10/3f…c1.png"],
  "videoUrls": [],
  "params": { "aspectRatio": "1:1", "resolution": "1K" },
  "workflowId": "665f…",
  "nodeId": "node-12"
}
```

| Field | Rules |
| --- | --- |
| `model` | Required. A model id from `/api/models`. Must not be a chat model. |
| `prompt` | String, up to 20,000 characters. |
| `imageUrls` | Up to 16 URLs, each `http(s)://…` or `/files/…` (no `data:` URIs). Cut down to what the model accepts. |
| `videoUrls` | Up to 4 URLs; one is used, and only by models that accept video. |
| `params` | Flat object of short strings, numbers and booleans. Merged over the model's defaults. `count` is clamped to 1–8. |
| `workflowId`, `nodeId` | Optional, for attribution in usage records. |

Response: `{ "runId": string }`. The run is queued; poll it.

Errors (400): as for estimate, plus `model.chat_only`, `validation.array`, `validation.max_items`, `validation.bad_url_in`, `validation.too_long`. `run.queue_full` (429) when 500 runs are already queued or in flight.

### GET /api/runs/:id

Response: a Run.

```json
{
  "id": "6660…",
  "status": "succeeded",
  "progress": 100,
  "outputs": [
    { "type": "image", "url": "/files/outputs/2026/10/9a…7e.png", "thumbnailUrl": "/files/thumbs/of/outputs/2026/10/9a…7e_png.webp", "width": 1024, "height": 1024 }
  ],
  "text": "",
  "error": "",
  "errorCode": "",
  "cost": { "amount": 0.1, "currency": "CNY", "unknown": false },
  "model": "gaorui:nano-banana-2",
  "modelLabel": "Nano Banana 2",
  "kind": "image",
  "workflowId": "665f…",
  "nodeId": "node-12",
  "createdAt": "2026-10-09T02:58:01.120Z",
  "startedAt": "2026-10-09T02:58:01.200Z",
  "finishedAt": "2026-10-09T02:58:31.870Z"
}
```

| `status` | Meaning |
| --- | --- |
| `queued` | Waiting for a slot. |
| `running` | Submitted to the upstream, or being submitted. |
| `archiving` | The result is being copied into storage. |
| `succeeded` | Done; `outputs` is filled. |
| `failed` | `error` has the reason in the request's language, `errorCode` its stable code (for example `run.timeout_generate`, `upstream.failed_detail`, `media.needs_public_url`, `run.interrupted`). |
| `canceled` | Canceled by the user. |

Errors: `run.not_found` (404). Chat runs are not returned here; use `/api/llm/tasks/:id`.

When the server stops, nothing is sent to an upstream twice. A run that already has an upstream task, or for which nothing was sent yet, goes back to `queued` and continues after the restart. A run whose request was sent but has no upstream task id (every run of a synchronous provider, every chat run) ends as `failed` with `run.interrupted`.

### POST /api/runs/status

Batch polling. Body: `{ "ids": string[] }`, up to 100. Response: an array of Run in the order requested; unknown ids are simply absent.

### POST /api/runs/:id/cancel

Cancels a queued or running run (image, video or chat). Response: the Run after cancellation. If it had already finished, the Run is returned unchanged with the message `run.already_finished`.

### POST /api/llm/tasks

Starts a chat run (Language model and Video analysis nodes).

Body: `{ "model": string, "prompt"?: string, "systemPrompt"?: string, "imageUrls"?: string[], "videoUrl"?: string, "workflowId"?: string, "nodeId"?: string }`. At least one of `prompt`, `imageUrls`, `videoUrl` is required. `model` must be a chat model.

Response: `{ "taskId": string }`.

Errors (400): `run.prompt_required`, `model.not_chat`, `model.no_video_input` (a `videoUrl` for a model without `acceptsVideo`), and those of `POST /api/runs`, including `run.queue_full` (429).

### GET /api/llm/tasks/:id

Response:

```json
{ "id": "6661…", "status": "succeeded", "progress": 100, "text": "…", "error": "", "errorCode": "", "cost": { "amount": 0, "currency": "", "unknown": true }, "model": "gaorui:chat-small" }
```

`status` values are those of a Run.

---

## Canvases

Base path `/api/workflow`. A canvas ("workflow"):

```json
{
  "id": "665f…",
  "name": "Untitled canvas",
  "nodes": [ { "id": "n1", "type": "text", "position": { "x": 0, "y": 0 }, "data": { "text": "…" } } ],
  "edges": [ { "id": "e1", "source": "n1", "sourceHandle": "text-out", "target": "n2", "targetHandle": "text-in" } ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "settings": { },
  "thumbnail": "",
  "thumbnailType": "",
  "schemaVersion": 1,
  "createdAt": "…",
  "updatedAt": "…"
}
```

The shape of `nodes[].data` and of `settings` belongs to the frontend; the server stores them as given. Limits: 500 nodes, 2000 edges, name up to 80 characters.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/workflow/list` | | Array of `{ id, name, thumbnail, thumbnailType, createdAt, updatedAt }`, newest first, at most 200. |
| POST | `/api/workflow` | `{ name?, nodes?, edges?, viewport?, settings? }` | The new canvas. |
| GET | `/api/workflow/:id` | | The canvas, migrated to the current `schemaVersion` if needed. |
| PUT | `/api/workflow/:id` | Any of `name`, `nodes`, `edges`, `viewport`, `settings` | The canvas. Only the fields sent are changed; the last write wins. |
| POST | `/api/workflow/:id/duplicate` | `{ name? }` | The copy. Media is shared by reference, not copied. |
| DELETE | `/api/workflow/:id` | | `{ id }`. Soft delete. |
| POST | `/api/workflow/download` | `{ url, filename? }` | The file as an attachment. Download proxy for media the browser cannot fetch itself. Only media comes back out. |
| POST | `/api/workflow/:id/download-zip` | `{ urls?: string[] }` | A zip of the canvas media. `urls` narrows the selection to URLs that are on the canvas; without it, everything. Entries are named `<nn>-<node type>.<ext>`. At most 100 items, 1 GiB per item and 4 GiB in total. A file that cannot be fetched is replaced by `<nn>-<node type>-failed.txt`, one that would take the archive over its total size by `<nn>-<node type>-skipped.txt`. |

Errors: `canvas.not_found` (404); `common.name_required`, `canvas.max_nodes`, `canvas.max_edges`, `canvas.bad_node`, `canvas.bad_edge`, `validation.max_length` (400); for the downloads `file.not_media_url`, `fetch.*`, `canvas.zip_max` (400) and `canvas.nothing_to_download` (404).

---

## Templates and tools

Base path `/api/canvas`. The tool endpoints process images on the server; they call no model and create no run. Source images are limited to 20 MB each.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/canvas/templates` | | Array of `{ key, title, description, cover, graph: { nodes, edges, viewport } }`. |
| GET | `/api/canvas/text-templates` | `?lang=zh` or `en` (default `zh`) | Array of `{ id, title, content, category, lang }`. |
| POST | `/api/canvas/tool/slice` | `{ imageUrl, cols, rows }` (1–6 each, default 3) | `{ cols, rows, items: [{ key, label, url, width, height }] }` |
| POST | `/api/canvas/tool/collage` | `{ imageUrls[], cols, rows, gap, bg, ratio }` (2–64 images; cols, rows 1–4; gap 0–80) | `{ url, width, height, cols, rows, used, skipped }` |
| POST | `/api/canvas/tool/watermark` | `{ imageUrl, markUrl, position, scalePct, opacity, marginPct }` (scale 5–60, opacity 10–100, margin 0–20) | `{ url, width, height }` |
| POST | `/api/canvas/tool/fit` | `{ imageUrl, ratio, bg, format, quality, maxKb }` (format `jpg` / `png` / `webp`, otherwise automatic; quality 40–95; maxKb 0–20480, 0 = no cap) | `{ url, width, height, bytes, overLimit }` |
| POST | `/api/canvas/platform-export` | `{ imageUrl, group }` (`domestic` or `overseas`) | `{ group, items: [{ key, label, url, width, height }], whiteBg }` |

Out-of-range numbers are clamped, not rejected. Errors (400): `media.*` (the source could not be read), `tool.*`.

---

## Brand kits

Base path `/api/brand-kits`. A kit:

```json
{ "id": "…", "name": "Summer studio", "refImages": ["/files/…"], "promptPrefix": "", "negativePrompt": "", "defaultRatio": "", "defaultModel": "", "isDefault": false, "shared": false, "mine": true, "updatedAt": "…" }
```

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/brand-kits` | | Array of kits. |
| POST | `/api/brand-kits` | `{ name, refImages?, promptPrefix?, negativePrompt?, defaultRatio?, defaultModel?, isDefault? }` | The kit. |
| PUT | `/api/brand-kits/:id` | Any of the fields above | The kit. |
| DELETE | `/api/brand-kits/:id` | | `{ id }`. Soft delete. |

Limits: 50 kits; `name` 40 characters; `promptPrefix` 1000; `negativePrompt` 500; 5 reference images (URLs only). Setting `isDefault` clears it on the others.

Errors: `brandKit.name_required`, `brandKit.max`, `brandKit.ref_images_max` (400); `brandKit.not_found` (404).

---

## Assets

### User assets — /api/user-asset

The user's own library. `kind` is one of `product`, `brand`, `reference`, `output`.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/user-asset/list` | `?kind&folder&tag&search&page&pageSize` (page size up to 200, default 60) | `{ list, folders, kindCount, limit, isTeamManager, pagination: { total, page, pageSize } }` |
| POST | `/api/user-asset` | `{ mediaUrl, kind?, name?, nodeType?, thumbnailUrl?, width?, height?, aspectRatio?, folder?, tags? }` | The asset. Registers a file that is already uploaded. |
| POST | `/api/user-asset/register-output` | Same, plus `fromFlowId?`, `fromProduct?` | The asset, with `kind: "output"`. |
| POST | `/api/user-asset/folder/delete` | `{ name }` | `{ moved }`. Dissolves a folder; its assets are kept. |
| PUT | `/api/user-asset/:id` | Any of `name`, `folder`, `tags`, `kind` | The asset. |
| DELETE | `/api/user-asset/:id` | | `{ id }`. Soft delete; the file is kept. |

`nodeType` is `IMAGE` (default) or `VIDEO`. Up to 5000 assets per kind.

Errors: `asset.media_url_required`, `asset.bad_thumbnail`, `asset.kind_full`, `asset.folder_required` (400); `asset.not_found` (404).

### Stock assets — /api/canvas-asset

A read-only library an operator may import into the database. Empty on a new install; there is no endpoint to add to it.

| Method | Path | Query | Response |
| --- | --- | --- | --- |
| GET | `/api/canvas-asset/categories` | | Array of `{ code, name, count }`. |
| GET | `/api/canvas-asset/list` | `?code&nodeType&page&pageSize` (page size up to 50, default 20) | `{ list, total, page, pageSize }` |

---

## Share links

Base path `/api/canvas-share`. Only reading a link by its token is public.

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| POST | `/api/canvas-share/publish` | yes | `{ workflowId, title?, description?, expiresInDays? \| expiresAt? }` | `{ id, token, updated, expiresAt }` |
| GET | `/api/canvas-share/mine` | yes | | `{ list }`: every link, including expired and revoked ones. |
| GET | `/api/canvas-share/plaza` | yes | `?page&pageSize&sort=hot` | `{ list, total, page, pageSize }`: the owner's active links. |
| GET | `/api/canvas-share/:token` | **public** | | The snapshot: summary fields plus `description`, `nodes`, `edges`, `viewport`, `settings`. Found by the link token only. |
| POST | `/api/canvas-share/:token/copy` | yes | `{ name? }` | `{ workflowId, isOwn }`: a new canvas made from the snapshot. |
| PUT | `/api/canvas-share/:id` | yes | `{ title?, description?, expiresInDays? \| expiresAt?, revoked? }` | The link summary. |
| POST | `/api/canvas-share/:id/revoke` | yes | | The link summary. |
| DELETE | `/api/canvas-share/:id` | yes | | `{ id, revoked, removed }` |

Behaviour:

- **Publishing** snapshots the canvas. Publishing the same canvas again refreshes the snapshot and keeps the token, unless the link was revoked; then a new token is issued.
- **Expiry**: `expiresInDays` from 0 to 3650, where `0` means never; or `expiresAt` as a future date, `null` for never. Without either, a new link never expires and an existing link keeps its expiry (an expiry already in the past is cleared).
- **Reading** a token that does not exist, has expired or was revoked always answers `404` with `share.gone`, so a caller cannot tell which. Each public read increments the view count.
- **Delete** revokes on the first call and removes the link from `mine` on the second. A revoked token is never reused.
- `:id` in the owner endpoints is the database id from `publish` or `mine`. The public read and `copy` accept only the link token: a database id in its place answers `404`, signed in or not.
- **What a snapshot leaves out.** Run-time state, run ids, failure details and costs are removed from every node when the link is published, again on every public read, and from copies: `status`, `progress`, `validationError`, `validationStamp`, `errorMsg`, `taskId`, `taskIds`, `runId`, `runPending`, `generatedCount`, `cost`, `estimatedCost`, and `cost` / `taskId` / `runId` inside each entry of `results[]`. Prompts and model ids (with the provider's slug prefix) stay.
- Run-time state (status, progress, task and run ids, error text) and costs are stripped from the nodes in a snapshot, and again when a snapshot is read publicly.

Errors: `canvas.not_found`, `share.not_found`, `share.gone` (404); `share.empty_canvas`, `share.max`, `share.title_required`, `share.expires_in_past`, `validation.range`, `validation.bad_date` (400).

---

## Admin

Base path `/api/admin`. These back the Settings page. There is no separate admin role: anyone who is signed in can call them.

### Providers

A provider as returned (the key itself is never returned):

```json
{
  "id": "665f…", "type": "gaorui", "name": "Gaorui API", "slug": "gaorui",
  "baseUrl": "https://gaorui.cc", "options": { }, "enabled": true, "sort": 0,
  "hasKey": true, "keyTail": "3456", "createdAt": "…", "updatedAt": "…"
}
```

Type-specific fields (for example `models` of an OpenAI-compatible provider) appear both inside `options` and at the top level.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/provider-types` | | Array of `{ type, label, defaultBaseUrl, fields: [{ key, label, type, secret, required, placeholder, help }] }` |
| GET | `/api/admin/providers` | | Array of providers. |
| POST | `/api/admin/providers` | `{ type, name?, baseUrl?, apiKey?, enabled?, sort?, slug?, …type fields }` | The provider. |
| PUT | `/api/admin/providers/:id` | Any of `name`, `baseUrl`, `apiKey`, `clearKey`, `enabled`, `sort`, type fields | The provider. |
| DELETE | `/api/admin/providers/:id` | | `{ id }`. Also deletes the overrides of its models. |
| POST | `/api/admin/providers/:id/test` | | `{ ok, message, modelCount? }` |

- On update, omit `apiKey` or send `""` to keep the stored key; send `"clearKey": true` to remove it. `"baseUrl": ""` goes back to the type's default.
- `slug` is set at creation (from `slug` in the body, otherwise from the type) and cannot be changed.
- The test endpoint answers HTTP 200 with `ok: false` and a reason when the upstream cannot be reached. A failed test is an answer, not an error.

Errors: `provider.type_unsupported`, `provider.max`, `provider.api_key_required`, `provider.base_url_required`, `provider.base_url_scheme`, `provider.base_url_credentials`, `validation.bad_url` (400); `provider.not_found` (404); `provider.slug_exhausted` (409).

### Models (admin)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/models` | | Every model, including disabled ones: ModelSpec plus `enabled`, `providerEnabled`, `sort` and `override` (`{ enabled, label, sort, defaults, pricing }` or `null`). |
| PUT | `/api/admin/models/:modelId` | `{ enabled?, label?, sort?, defaults?, pricing? }` | The merged ModelSpec. |

- `:modelId` contains a colon and possibly slashes: URL-encode it (`gaorui%3Anano-banana-2`).
- Sending `null` for a field removes that part of the override. `"pricing": null` goes back to the price the provider declared, if any.
- `pricing` is `{ currency, unit, by?, price?, table? }`:

| Field | Values |
| --- | --- |
| `currency` | String, upper-cased, up to 8 characters. Defaults to `CNY`. |
| `unit` | `per_image`, `per_video`, `per_second`, `per_1m_tokens` |
| `by` | Omit for a flat `price`. Otherwise `resolution`, `duration` or `resolution_duration`, with a `table`. |
| `price` | Number ≥ 0. |
| `table` | Object of key → number ≥ 0, 1 to 200 entries, keys up to 40 characters without `.` or a leading `$`. For `resolution_duration`, keys are `"<resolution>:<duration>"`, or nest one level (`{ "720p": { "6": 1 } }`). For `per_1m_tokens`, `table` must be `{ input, output }` (price per million tokens each). |

Errors: `model.bad_id`, `common.nothing_to_update`, `validation.invalid`, `validation.non_negative`, `price.table_size`, `price.table_key`, `price.token_table` (400); `model.not_found` (404).

### Site settings

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/settings` | | A flat object with every setting. |
| PUT | `/api/admin/settings` | Any subset of the keys | The full object after the update. |

Keys, defaults and ranges are listed in [Configuration](configuration.md#admin-settings). Errors (400): `settings.unknown_key` (any key that is not a setting, including names such as `constructor` or `__proto__`), `validation.int_range`, `validation.one_of`, `validation.string`, `settings.logo_url`.

### Usage

Common query parameters for both endpoints:

| Parameter | Meaning |
| --- | --- |
| `from`, `to` | Date range on the run's creation time. ISO dates or millisecond timestamps. A bare `to` date (`2026-10-31`) includes that whole day. |
| `kind` | `image`, `video` or `chat` |
| `status` | A run status |
| `model` | A model id |

**GET /api/admin/usage** — additional parameters: `groupBy` = `day` (default) or `model`; `tz` = an IANA time zone for day boundaries (default `UTC`).

```json
{
  "groupBy": "day",
  "timezone": "UTC",
  "totals": { "key": "total", "runs": 12, "succeeded": 10, "failed": 1, "canceled": 1, "amount": 1.0, "currency": "CNY", "unknownCount": 2, "costs": { "CNY": 1.0 } },
  "items": [
    { "key": "2026-10-09", "runs": 12, "succeeded": 10, "failed": 1, "canceled": 1, "amount": 1.0, "currency": "CNY", "unknownCount": 2, "costs": { "CNY": 1.0 } }
  ]
}
```

- Cost is summed over **succeeded** runs with a **known** cost, per currency, in `costs`. `amount` / `currency` show the largest of them.
- `unknownCount` is the number of succeeded runs whose cost is unknown.
- With `groupBy=model`, `key` is the model id and each item also has `label`.

**GET /api/admin/usage/records** — additional parameters: `page`, `pageSize` (up to 100, default 20).

```json
{
  "list": [
    {
      "id": "6660…", "kind": "image", "status": "succeeded",
      "model": "gaorui:nano-banana-2", "modelLabel": "Nano Banana 2", "providerType": "gaorui",
      "prompt": "an orange cat…", "params": { "resolution": "1K" }, "count": 1,
      "cost": { "amount": 0.1, "currency": "CNY", "unknown": false },
      "error": "", "workflowId": "665f…", "nodeId": "node-12",
      "createdAt": "…", "startedAt": "…", "finishedAt": "…"
    }
  ],
  "total": 12, "page": 1, "pageSize": 20
}
```

`prompt` is cut to 200 characters. Errors (400): `validation.bad_date`, `validation.from_before_to`, `validation.invalid`, `validation.bad_timezone`.

**DELETE /api/admin/usage/records?before=&lt;date&gt;** — deletes the usage records created before that moment. A bare date (`2026-01-31`) means before the start of that day, UTC. Only finished records (succeeded, failed, canceled) are deleted; queued and running ones are kept, and so are the generated files. This cannot be undone, and the totals for that period go with the records.

Response: `{ "deleted": number }`. Errors (400): `validation.required`, `validation.bad_date`.

---

## A minimal client

Generate one image from the command line, on an instance without a password:

```bash
BASE=http://localhost:3000

# 1. Pick an image model
curl -s "$BASE/api/models?kind=image"

# 2. Start a run (replace the model id with one from step 1)
curl -s -X POST "$BASE/api/runs" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gaorui:nano-banana-2","prompt":"an orange cat on a windowsill","params":{"aspectRatio":"1:1"}}'

# 3. Poll with the runId from step 2 until status is succeeded or failed
curl -s "$BASE/api/runs/<runId>"
```
