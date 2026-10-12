# HTTP API reference

[简体中文](api.zh-CN.md)

This is the API the LoomCanvas frontend uses. It is written from the route files in `server/src/routes/`. The Chinese design contract between frontend and backend is [architecture.md](architecture.md); when the two disagree, the code wins and one of the documents has a bug.

> Status: early development. Paths and shapes may change before the first tagged release. There is no API versioning yet.

## Conventions

### Base URL and format

- Every endpoint is under `/api`. Stored files are served under `/files`, on every storage backend.
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
| `data` | The payload, or `null` on failure. Two failures carry a payload: `auth.too_many_attempts` (`{ retryAfterSeconds }`) and `storage.save_needs_test` (`{ test }`). |

Two endpoints stream a file instead of JSON on success: `POST /api/workflow/download` and `POST /api/workflow/:id/download-zip`.

### Language

The language of `message`, of run failure reasons and of built-in names is chosen per request, first match wins:

1. `X-Locale` header: `zh-CN` or `en`
2. `Accept-Language` header
3. the `defaultLocale` setting
4. `zh-CN`

### Authentication

Every instance has accounts, and signing in is always required. There is no mode without it; the `ACCESS_PASSWORD` variable of earlier versions is ignored.

- An account has a username, an email address and a password. There are two roles. The super admin has the role `owner` (that is its value everywhere in this API): the server creates it at start-up when there is none, from `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `ADMIN_EMAIL`, and there is exactly one. Every account that registers is a `user`. There are no other roles and no teams.
- Each account sees and changes only its own data: canvases, share links, assets, brand kits, runs, usage records, and its own providers, API keys, custom models, model settings and prices. The super admin is scoped the same way and cannot read another account's data through the API.
- The super admin additionally manages the site: settings, storage, registration and the list of accounts. See [Admin](#admin).

Register (this always creates a `user`, and only while registration is open), or sign in, and send the token on every request:

```bash
BASE=http://localhost:3000

# Create an account. The answer already contains a token.
curl -s -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"username":"ada","email":"ada@example.com","password":"correct horse battery"}'

# Sign in. "account" is the username or the email.
curl -s -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"account":"ada","password":"correct horse battery","remember":true}'
```

Both answer `{ "user": { … }, "token": "…" }` in `data`.

```
Authorization: Bearer <token>
```

- The token is an opaque string of 43 characters, not a JWT. The server keeps only its SHA-256, in the `sessions` collection. There are no cookies.
- A session lasts 12 hours, or 30 days when the login was sent with `"remember": true`. The lifetime is fixed at sign-in; using the session does not extend it. The session that registration opens lasts 12 hours.
- A session ends before that when: it is signed out (`POST /api/auth/logout`), it is ended from another session (`DELETE /api/auth/sessions…`), the account's password is changed (every session of the account ends; the caller gets a new token in the answer, see [PUT /api/auth/password](#put-apiauthpassword)), the super admin resets the account's password or disables it (all its sessions end), or the account is deleted. Each of these takes effect at once. Changing `SECRET_KEY` does not end sessions.
- Public without a token: `GET /api/bootstrap`, `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/canvas-share/:token`, and `GET /files/*`.
- Everything else answers `401` with code `auth.required` when the token is missing, unknown, expired, or belongs to a disabled account. On a protected endpoint a `401` always means "not signed in"; upstream authentication failures are reported as `400`. The only other `401` is `auth.invalid_credentials` from `POST /api/auth/login`.
- An endpoint that only the super admin may call answers `403` with code `auth.forbidden` to any other account.
- While an account's password is a temporary one (`mustChangePassword` is `true` in its [User](#the-user-object)), its sessions are served only `GET /api/auth/me`, `GET /api/bootstrap`, `PUT /api/auth/password` and `POST /api/auth/logout`, plus the public endpoints. Every other endpoint answers `403` with code `auth.password_change_required` until the password has been changed with [PUT /api/auth/password](#put-apiauthpassword).
- A resource of another account, addressed by its id, answers `404` with the same code as an id that does not exist (`canvas.not_found`, `run.not_found`, `provider.not_found`…). It is never a `403` and never data. Lists contain only the caller's records.

Sign-in, registration and changes of username or email are rate limited; see [POST /api/auth/login](#post-apiauthlogin), [POST /api/auth/register](#post-apiauthregister) and [PUT /api/auth/profile](#put-apiauthprofile).

The web client keeps the token in the browser's web storage under the key `loomcanvas-token` (`localStorage` when "Remember me" was ticked, `sessionStorage` otherwise) and sends it in the header above. Since there are no cookies, cross-site request forgery does not apply; see [Security](security.md#sessions).

### Common errors

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `validation.*` | A field is missing or has the wrong type, format or range. `message` names the field. |
| 400 | `common.body_not_json` | The body is not valid JSON. |
| 400 | `common.bad_request` | The request itself is malformed (bad encoding in the path, unsupported charset…). |
| 401 | `auth.required` | No valid session. Earlier versions used `auth.login_required`. |
| 403 | `auth.forbidden` | The endpoint is for the super admin and the caller is another account. |
| 403 | `auth.password_change_required` | The caller's password is a temporary one and has to be replaced first ("Choose a new password before you continue"). Only `GET /api/auth/me`, `GET /api/bootstrap`, `PUT /api/auth/password` and `POST /api/auth/logout` are served until then. |
| 404 | `common.route_not_found` | No such endpoint. |
| 404 | `common.not_found`, `*.not_found` | No such record, or it belongs to another account. |
| 409 | `common.duplicate` | A unique value already exists. |
| 413 | `common.body_too_large`, `file.too_large` | Body or upload over the limit. |
| 429 | `auth.too_many_attempts` | Sign-in, registration, password-change or profile-change rate limit. `data.retryAfterSeconds` and the `Retry-After` header say how long to wait. |
| 429 | `run.queue_full` | The account has `userQueueLimit` unfinished runs (default 200), or the instance as a whole has 500. |
| 500 | `common.internal` | Unexpected error. Details are in the server log only. |

### CORS

No cross-origin access is granted by default. Origins listed in `CORS_ORIGIN` may call `/api` with the methods `GET`, `POST`, `PUT`, `PATCH` and `DELETE` and the headers `Authorization`, `Content-Type` and `X-Locale`.

---

## App and login

### GET /api/bootstrap

Public. What a client needs before anything else; also the health check. `GET /api/app/bootstrap`, the path of earlier versions, still answers the same.

Response `data`, for a caller who is not signed in:

```json
{
  "auth": { "registrationOpen": true },
  "user": null,
  "site": { "name": "LoomCanvas", "logoUrl": "", "defaultLocale": "zh-CN" },
  "hasProvider": false,
  "limits": { "maxUploadMb": 50 },
  "media": { "upstreamByUrl": false },
  "version": "0.1.0"
}
```

| Field | Meaning |
| --- | --- |
| `auth.registrationOpen` | Whether `POST /api/auth/register` accepts a new account now: the value of the `registrationOpen` setting. It is the only field of `auth`. |
| `user` | The caller's [User](#the-user-object) when the request carries a valid token, otherwise `null`. Signing in is always required, so `null` means "not signed in". This endpoint also answers a session whose `user.mustChangePassword` is `true`. |
| `site` | Name, logo and default language of the site. |
| `hasProvider` | `true` when the caller's own account has at least one enabled provider. Always `false` for a caller who is not signed in. |
| `limits.maxUploadMb` | The server's `MAX_UPLOAD_MB`, so a client can refuse a file that is too large before uploading it. |
| `version` | The version of the server. |
| `media.upstreamByUrl` | Whether an upstream model can be given a stored file by URL: `true` with a public `PUBLIC_URL`, or when new files go to a bucket reachable from the internet; always `false` for a caller who is not signed in. The canvas uses it to warn, before a run, when a model that only takes URLs (`imageByUrlOnly` in its ModelSpec) has a reference image connected. |

Earlier versions also returned `authRequired`, `authed` and `site.defaultTheme`. They are gone: signing in is always required (use `user`), and the interface has a single theme.

### The User object

What the API returns about an account:

```json
{ "id": "670e…b2", "username": "ada", "email": "ada@example.com", "role": "user", "mustChangePassword": false, "prefs": { "nodeLayout": "a" }, "createdAt": "2026-10-09T02:58:01.120Z" }
```

| Field | Meaning |
| --- | --- |
| `role` | `owner` (the super admin) or `user`. |
| `email` | The account's address. It may be `""` for the super admin, the only account that can exist without one (created without `ADMIN_EMAIL`, until it adds one with [PUT /api/auth/profile](#put-apiauthprofile)). |
| `mustChangePassword` | `true` while the account's password is one somebody else knows: the super admin password the server generated at start-up, a temporary password from [`POST /api/admin/users/:id/reset-password`](#accounts), or one from the command-line reset. `PUT /api/auth/password` sets it back to `false`. While it is `true` the API serves the account almost nothing else, see [Authentication](#authentication). |
| `prefs` | The account's preferences for the web app, always complete (an account that never chose gets the defaults). `nodeLayout` is how generation nodes look on the canvas: `"a"` result first with a composer under the selected node (the default), `"b"` compact nodes with an inspector on the right, `"c"` everything on the node. Change it with [PUT /api/auth/prefs](#put-apiauthprefs). |

Nothing else about an account leaves the server through this object. It is the same wherever a User is returned: registration, sign-in, `GET /api/auth/me`, `PUT /api/auth/profile`, `PUT /api/auth/prefs`, `user` in the bootstrap and the rows of `GET /api/admin/users`.

### POST /api/auth/register

Public. Creates an ordinary account (`role: "user"`, never the super admin) and signs it in.

Body: `{ "username": string, "email": string, "password": string }`.

| Field | Rules |
| --- | --- |
| `username` | 3 to 32 characters from `A-Z a-z 0-9 _ -`. Unique without regard to case. |
| `email` | Must look like an address, up to 254 characters. Unique without regard to case. No mail is ever sent to it: there is no verification and no "forgot password" mail. |
| `password` | 8 to 128 characters. |

Response: `{ "user": User, "token": string }`. The session lasts 12 hours.

Registration has to be open (the `registrationOpen` setting, `true` by default). When it is closed the answer is `403` `auth.registration_closed`, always. The super admin is not created here: the server creates it at start-up and hands it the data an earlier version without accounts left behind; see [Architecture](architecture.md#11-账号与数据归属) (Chinese).

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `auth.invalid_username` | `username` is missing or does not fit the rules. |
| 400 | `auth.invalid_email` | `email` is missing or does not look like an address. |
| 400 | `auth.weak_password` | `password` is missing, shorter than 8 or longer than 128 characters. |
| 403 | `auth.registration_closed` | The super admin has closed registration. |
| 409 | `auth.username_taken` | Another account has that username. |
| 409 | `auth.email_taken` | Another account has that email. |
| 429 | `auth.too_many_attempts` | More than 20 registration attempts from one client in an hour (an IPv6 client counts as its /64). `data` is `{ "retryAfterSeconds": number }` and the response has a `Retry-After` header. |

The two `409` answers tell a caller whether a username or an email already has an account. That cannot be avoided: no mail is ever sent, so there is nothing else to answer. It is bounded by the rate limit above; close registration if it matters.

### POST /api/auth/login

Public. Body: `{ "account": string, "password": string, "remember"?: boolean }`. `account` is the username or the email, without regard to case.

Response: `{ "user": User, "token": string }`. The session lasts 12 hours, or 30 days with `"remember": true`. When `user.mustChangePassword` is `true` the password was a temporary one: the next call has to be [PUT /api/auth/password](#put-apiauthpassword). The web app then shows its **Set a new password** screen (`/password`) and nothing else.

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `auth.credentials_required` | `account` or `password` is missing or empty. |
| 401 | `auth.invalid_credentials` | No such account, or a wrong password. The answer and the work done are the same in both cases. |
| 403 | `auth.account_disabled` | The password is correct and the super admin has disabled the account. |
| 429 | `auth.too_many_attempts` | A rate limit, below. `data` is `{ "retryAfterSeconds": number }` and the response has a `Retry-After` header. |

Limits on sign-in attempts, per 10 minutes:

| | Counted per | Limit | Notes |
| --- | --- | --- | --- |
| (a) | Account name and client address | 10 | Cleared by a successful sign-in of that pair. |
| (b) | Client address, all account names | 30 | |
| (c) | Account name, all addresses | 100 | Not applied to an address the account is known at. |
| (d) | All sign-in attempts together | 3000 | Not applied to an address the account is known at. |

- An IPv6 client counts as its /64. Behind a reverse proxy, `TRUST_PROXY` must be set for the client address to be the real one.
- The account name is counted whether an account by that name exists or not, so the limits never tell which names exist.
- An address is one the account is *known at* when that account signed in successfully from it in the last 30 days, or when it holds a live session of the account. From such an address the holder can still sign in while (c) or (d) is exhausted by guesses from elsewhere; wrong guesses at a name therefore do not lock its holder out. From an address the account has never used, the holder may have to wait.
- The counters, and the memory of where an account signed in from, are in memory, per process, and are empty after a restart.

### POST /api/auth/logout

Ends the session the request came with. Response `data`: `null`. Available while `mustChangePassword` is `true`.

### GET /api/auth/me

Response: `{ "user": User }`. Available while `mustChangePassword` is `true`.

### PUT /api/auth/password

Body: `{ "currentPassword": string, "newPassword": string }`. Changes the caller's password and ends **every** session of the account, the one that made the request included. The caller gets a new session in its place.

This is also how a temporary password is replaced: the call is available while `mustChangePassword` is `true` (`currentPassword` is then the temporary password), and a successful change sets the flag to `false`.

Response: `{ "revokedSessions": number, "token": string }`. `revokedSessions` is the number of sessions that were ended. `token` is a fresh session token for the caller, valid for as long as the session it replaces had left; the token the request was sent with no longer works, so use the new one from here on. The web client swaps it in silently.

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `auth.wrong_current_password` | `currentPassword` is missing or wrong. Deliberately not a `401`: the session is fine. |
| 400 | `auth.same_password` | `newPassword` equals `currentPassword` ("The new password must be different from the current one"). |
| 400 | `auth.weak_password` | `newPassword` is missing, shorter than 8 or longer than 128 characters. |
| 429 | `auth.too_many_attempts` | The check of `currentPassword` counts as a sign-in attempt at the account, under limits (a) and (c) of [sign-in](#post-apiauthlogin). A correct `currentPassword` clears (a). |

### PUT /api/auth/profile

Body: `{ "username"?: string, "email"?: string }`, with the rules of [registration](#post-apiauthregister). Response: `{ "user": User }`.

Errors: `auth.invalid_username`, `auth.invalid_email`, `common.nothing_to_update` (neither field sent) (400); `auth.username_taken`, `auth.email_taken` (409); `auth.too_many_attempts` (429, with `data.retryAfterSeconds` and `Retry-After`).

Limited to 20 changes per account per hour. Without a limit the `username_taken` and `email_taken` answers would let a signed-in account test any number of addresses for whether they are registered.

### PUT /api/auth/prefs

Body: `{ "nodeLayout"?: "a" | "b" | "c" }`. Changes the caller's preferences; only the keys sent are changed. They are stored with the account, so they follow it to every browser. Response: `{ "user": User }`.

The body is validated strictly: it has to be an object with at least one key, every key has to be a known preference and every value one of its allowed values. Nothing is changed when a request is refused.

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `validation.body_object` | The body is not a JSON object. |
| 400 | `common.nothing_to_update` | The object is empty. |
| 400 | `validation.bad_key` | A key that is not a preference (an unknown key is refused, not ignored). |
| 400 | `validation.one_of` | A value outside the allowed set, for example `{ "nodeLayout": "d" }`. |

The share view (`GET /api/canvas-share/:token`) does not depend on it: a shared canvas is always shown in layout A, read-only.

### GET /api/auth/sessions

The caller's live sessions, most recently seen first.

```json
[
  { "id": "6712…9c", "current": true, "createdAt": "2026-10-09T02:58:01.120Z", "lastSeenAt": "2026-10-09T03:40:12.004Z", "userAgent": "Mozilla/5.0 …", "ip": "203.0.113.7" }
]
```

`current` marks the session the request came with. `lastSeenAt` is refreshed at most once a minute. `userAgent` and `ip` are those of the request that opened the session; `ip` is the real client address only when `TRUST_PROXY` is set correctly behind a proxy.

### DELETE /api/auth/sessions/:id

Ends one of the caller's sessions; it may be the current one. Response: `{ "id": string }`.

Errors: `auth.session_not_found` (404) for an id that does not exist or is a session of another account.

### DELETE /api/auth/sessions

Ends every session of the caller except the current one ("sign out other devices"). Response: `{ "revoked": number }`.

---

## Files

### POST /api/files/upload

`multipart/form-data` with one field named `file`. Size limit: `MAX_UPLOAD_MB`. The type is detected from the content; images, videos and audio are accepted.

Response `data`:

```json
{
  "url": "/files/uploads/670e…b2/2026/10/3f…c1.png",
  "key": "uploads/670e…b2/2026/10/3f…c1.png",
  "size": 182044,
  "mime": "image/png",
  "width": 1024,
  "height": 768,
  "thumbnailUrl": "/files/thumbs/of/uploads/670e…b2/2026/10/3f…c1_png.webp"
}
```

A key is `<uploads|outputs|tools>/<account id>/<yyyy>/<mm>/<32 hex characters>.<ext>`: `uploads` for uploaded and fetched files, `outputs` for results of runs, `tools` for results of tool nodes; the second segment is the id of the account the file belongs to. Files stored before accounts existed have no account segment (`uploads/2025/01/<hex>.png`); those keys and their addresses stay valid, and nothing is moved or renamed. The account segment exists so that an account's files can be removed with it. It is not an access check: `/files/<key>` is public to whoever has the address.

`width`, `height` and `thumbnailUrl` are present for images only. `url` is always site-relative (`/files/<key>`), whatever `PUBLIC_URL` is and whichever storage backend holds the file: the local disk or a bucket.

Errors: `file.missing`, `file.empty`, `file.unsupported_type`, `file.image_corrupt` (400); `file.too_large` (413).

### POST /api/files/fetch

Body: `{ "url": string }`. The server downloads a remote **image** (through the SSRF guard, up to `MAX_UPLOAD_MB`) and stores it. A URL that already points at this instance's storage is not downloaded again; the response describes the stored file, with its `/files/<key>` address. That includes absolute addresses under a configured bucket's public base URL, which earlier versions stored. Response as for upload.

Errors (400): `file.image_only` (also for a stored file that is not an image), `fetch.*` (for example `fetch.private_address`, `fetch.http_error`, `fetch.timeout`); `file.not_found` (404).

### GET /files/:key

Public. The one address of a stored file, whichever backend holds it. `HEAD` is answered as well. The response depends on where the file is:

| File is | Response |
| --- | --- |
| On the local disk | The file, read from disk. Range requests are supported. |
| In a bucket with `proxy` delivery | The object, streamed from the bucket. A single `Range` gives `206` with `Content-Range` (a request with several ranges gets the whole file); `If-None-Match` gives `304`; `ETag`, `Last-Modified` and `Accept-Ranges: bytes` are set. |
| In a bucket with `redirect` delivery | `302` to `<publicBaseUrl>/<keyPrefix><key>`, with `Cache-Control: public, max-age=300`. |

Files served by the app (the first two rows) carry `Cache-Control: public, max-age=31536000, immutable`, a `Content-Type` taken from the key's extension, `X-Content-Type-Options: nosniff` and a sandboxing `Content-Security-Policy`. Anything that is not an image, video or audio file is sent as a download.

Thumbnails under `thumbs/of/…` (`thumbs/of/<uploads|outputs|tools>/<account id>/…_<ext>.webp`) are generated on first request, on every backend, and stored next to their source image; when a thumbnail cannot be made the response is a `302` to the original.

| HTTP | When |
| --- | --- |
| 404, empty body | Unknown key, or the file is on none of the readable backends. |
| 416 | The requested range cannot be satisfied. |
| 502, empty body | A storage service could not be asked (unreachable, credential refused), so the file may exist. |

---

## Models and runs

### GET /api/models

Query: `kind` (optional) = `image` | `video` | `chat`.

Response: an array of ModelSpec, for the enabled models of the caller's enabled providers.

```json
{
  "id": "gaorui:nano-banana-2",
  "providerId": "665f…",
  "providerName": "Gaorui",
  "providerType": "gaorui",
  "label": "Nano Banana 2",
  "desc": "Image generation and editing",
  "kind": "image",
  "custom": false,
  "acceptsImage": true,
  "acceptsVideo": false,
  "videoEdit": false,
  "maxReferenceImages": 8,
  "options": { "aspectRatios": ["auto", "1:1"], "resolutions": ["1K", "2K", "4K"] },
  "defaults": { "aspectRatio": "auto", "resolution": "1K", "count": 1 },
  "pricing": { "currency": "CNY", "unit": "per_image", "price": 0.1 }
}
```

`providerType` is the vendor id (`gaorui`, `openai` or `gemini`). `id` is `<provider slug>:<upstream model>`. Model ids are per account: a slug is unique among the providers of one account, not across the instance, so `gaorui:nano-banana-2` in one account has nothing to do with the same id in another. `custom` is `true` for a model the user added by hand and `false` for a model from the vendor's catalog. `options` may contain `aspectRatios`, `resolutions`, `durations`, `counts` and `imgModes`. `desc`, `tag` and `pricing` are optional; a custom model has no `desc`. The `pricing` in the example is a placeholder: no prices are shipped, and the field is only present once the account has entered one. `imageByUrlOnly: true` is present on models whose reference images are handed over as public URLs only. See [Writing a provider](writing-a-provider.md#modelspec-reference).

The list is the catalog of each provider's vendor plus that provider's custom models. It is not fetched from an upstream, and a model's `kind` is never derived from its name.

For a chat model, `acceptsVideo` says whether it can be given a video (`videoUrl` of `POST /api/llm/tasks`). OpenAI and Gemini chat models report `false`, catalog and custom ones alike. Of the five chat models in the Gaorui catalog, `gemini-3.5-flash-c` reports `true` and the other four `false`. Custom chat models of a Gaorui provider report `true`. A Gaorui provider sends the video as an `image_url` content part holding its public URL, see [Providers](providers.md#which-node-uses-which-model). The Video analysis node lists only chat models with `acceptsVideo`. `acceptsImage` says whether a chat model reads images (`imageUrls`): `false` is a text-only model, and `maxReferenceImages` is then `0`.

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
  "imageUrls": ["/files/uploads/670e…b2/2026/10/3f…c1.png"],
  "videoUrls": [],
  "params": { "aspectRatio": "1:1", "resolution": "1K" },
  "workflowId": "665f…",
  "nodeId": "node-12"
}
```

| Field | Rules |
| --- | --- |
| `model` | Required. A model id from `/api/models`, that is, of one of the caller's own providers. Must not be a chat model. |
| `prompt` | String, up to 20,000 characters. |
| `imageUrls` | Up to 16 URLs, each `http(s)://…` or `/files/…` (no `data:` URIs). Cut down to what the model accepts. |
| `videoUrls` | Up to 4 URLs; one is used, and only by models that accept video. |
| `params` | Flat object of short strings, numbers and booleans. Merged over the model's defaults. `count` is clamped to 1–8. |
| `workflowId`, `nodeId` | Optional, for attribution in usage records. |

Response: `{ "runId": string }`. The run is queued; poll it. It belongs to the caller's account and is executed with that account's provider and key, also when it is resumed after a restart.

Errors (400): as for estimate, plus `model.chat_only`, `validation.array`, `validation.max_items`, `validation.bad_url_in`, `validation.too_long`. `run.queue_full` (429) when the account already has `userQueueLimit` unfinished runs (queued, running or archiving; default 200), or when the instance as a whole has 500.

How the queue is shared: `concurrency` is the number of runs executing at once on the whole instance, and one account holds at most `userConcurrency` of those slots. When a slot frees, it goes to the account with the fewest runs in flight; among those, to the account that was given a slot longest ago; within an account, to its oldest run. One account with a long queue does not hold the others up. All three numbers are [site settings](#site-settings).

### GET /api/runs/:id

Response: a Run.

```json
{
  "id": "6660…",
  "status": "succeeded",
  "progress": 100,
  "outputs": [
    { "type": "image", "url": "/files/outputs/670e…b2/2026/10/9a…7e.png", "thumbnailUrl": "/files/thumbs/of/outputs/670e…b2/2026/10/9a…7e_png.webp", "width": 1024, "height": 1024 }
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

Errors: `run.not_found` (404), also for a run of another account. Chat runs are not returned here; use `/api/llm/tasks/:id`.

When the server stops, nothing is sent to an upstream twice. A run that already has an upstream task, or for which nothing was sent yet, goes back to `queued` and continues after the restart. A run whose request was sent but has no upstream task id (every run of a synchronous provider, every chat run) ends as `failed` with `run.interrupted`.

### POST /api/runs/status

Batch polling. Body: `{ "ids": string[] }`, up to 100. Response: an array of Run in the order requested; unknown ids, and ids of another account's runs, are simply absent.

### POST /api/runs/:id/cancel

Cancels a queued or running run (image, video or chat). Response: the Run after cancellation. If it had already finished, the Run is returned unchanged with the message `run.already_finished`.

### POST /api/llm/tasks

Starts a chat run (Language model and Video analysis nodes).

Body: `{ "model": string, "prompt"?: string, "systemPrompt"?: string, "imageUrls"?: string[], "videoUrl"?: string, "workflowId"?: string, "nodeId"?: string }`. At least one of `prompt`, `imageUrls`, `videoUrl` is required. `model` must be a chat model.

Response: `{ "taskId": string }`.

Errors (400): `run.prompt_required`, `model.not_chat`, `model.no_video_input` (a `videoUrl` for a model without `acceptsVideo`), `model.no_image_input` (`imageUrls` for a text-only model, one without `acceptsImage`), and those of `POST /api/runs`, including `run.queue_full` (429).

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
  "brandKitId": "",
  "thumbnail": "",
  "thumbnailType": "",
  "schemaVersion": 3,
  "legacyLayout": false,
  "createdAt": "…",
  "updatedAt": "…"
}
```

`legacyLayout` is `true` while the node positions date from before `schemaVersion` 2 and the editor has not yet checked them against the current node sizes: the server sets it when it migrates such a canvas (more than one node) on read, a copy of a flagged canvas carries it, and the editor clears it after its one-time check (see below). `brandKitId` is the brand kit of the canvas (`""` for none): the editor adds it to every run of the canvas's generation nodes, except for a node whose `data.brandKitOverride` holds another kit id or `"none"` (see [Brand kits](#brand-kits)). The shape of `nodes[].data` and of `settings` belongs to the frontend; the server stores them as given. Limits: 500 nodes, 2000 edges, name up to 80 characters. Every endpoint here works on the caller's own canvases.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/workflow/list` | | Array of `{ id, name, thumbnail, thumbnailType, createdAt, updatedAt }`, newest first, at most 200. |
| POST | `/api/workflow` | `{ name?, nodes?, edges?, viewport?, settings?, brandKitId? }` | The new canvas. Without `brandKitId` it starts with the account's default brand kit, if there is one; send `""` for none. |
| GET | `/api/workflow/:id` | | The canvas, migrated to the current `schemaVersion` if needed. |
| PUT | `/api/workflow/:id` | Any of `name`, `nodes`, `edges`, `viewport`, `settings`, `brandKitId`, `legacyLayout` | The canvas. Only the fields sent are changed; the last write wins. `brandKitId` must be `""` or a 24-character kit id (anything else is 400 `validation.invalid`); whose kit it is is not checked, because a kit is only ever looked up among the caller's own and any other id simply means no kit. A save that carries nothing but `viewport` and/or `legacyLayout` leaves `updatedAt` alone: panning and zooming are not edits. `legacyLayout` can only be sent as `false` (anything else is 400 `validation.invalid`); it is ignored on `POST`. |
| POST | `/api/workflow/:id/duplicate` | `{ name? }` | The copy, with the same `brandKitId` and node exceptions. Media is shared by reference, not copied. |
| DELETE | `/api/workflow/:id` | | `{ id }`. Soft delete. |
| POST | `/api/workflow/download` | `{ url, filename? }` | The file as an attachment. Download proxy for media the browser cannot fetch itself. Only media comes back out. |
| POST | `/api/workflow/:id/download-zip` | `{ urls?: string[] }` | A zip of the canvas media. `urls` narrows the selection to URLs that are on the canvas; without it, everything. Entries are named `<nn>-<node type>.<ext>`. At most 100 items, 1 GiB per item and 4 GiB in total. A file that cannot be fetched is replaced by `<nn>-<node type>-failed.txt`, one that would take the archive over its total size by `<nn>-<node type>-skipped.txt`. |

Errors: `canvas.not_found` (404); `common.name_required`, `canvas.max_nodes`, `canvas.max_edges`, `canvas.bad_node`, `canvas.bad_edge`, `validation.max_length` (400); for the downloads `file.not_media_url`, `fetch.*`, `canvas.zip_max` (400) and `canvas.nothing_to_download` (404).

---

## Templates and tools

Base path `/api/canvas`. The tool endpoints process images on the server; they call no model and create no run. Source images are limited to 20 MB each.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/canvas/templates` | | Array of `{ key, title, description, cover, graph: { nodes, edges, viewport } }`: the built-in templates, which belong to the site and are shown to every account, plus the caller's own. |
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
{ "id": "…", "name": "Summer studio", "refImages": ["/files/…"], "promptPrefix": "", "negativePrompt": "", "defaultRatio": "", "defaultModel": "", "isDefault": false, "shared": false, "mine": true, "updatedAt": "…", "usedBy": 2 }
```

A kit is applied by the editor, not by the server: when a generation node runs, the browser puts `promptPrefix` in front of the prompt, adds `negativePrompt` at the end as a "Do not include: …" line, and appends `refImages` after the node's own reference images up to the model's limit. `/api/runs` receives the finished prompt and image list and knows nothing about kits. Which kit a node uses is stored on the canvas: `brandKitId` on the canvas document, and `data.brandKitOverride` (a kit id, or `"none"`) on a node that differs. `isDefault` marks the kit a new canvas starts with. `defaultRatio` and `defaultModel` are stored and returned but not used by the editor.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/brand-kits` | | Array of kits. Each carries `usedBy`: the number of the caller's canvases that use it, as the canvas's kit or as a node's exception (the other endpoints do not return it). |
| POST | `/api/brand-kits` | `{ name, refImages?, promptPrefix?, negativePrompt?, defaultRatio?, defaultModel?, isDefault? }` | The kit. |
| PUT | `/api/brand-kits/:id` | Any of the fields above | The kit. |
| DELETE | `/api/brand-kits/:id` | | `{ id }`. Soft delete. Canvases and nodes that point at it are left as they are and run without a kit. |

Limits: 50 kits per account; `name` 40 characters; `promptPrefix` 1000; `negativePrompt` 500; 5 reference images (URLs only). Setting `isDefault` clears it on the others.

Errors: `brandKit.name_required`, `brandKit.max`, `brandKit.ref_images_max` (400); `brandKit.not_found` (404).

---

## Assets

### User assets — /api/user-asset

The caller's own library. `kind` is one of `product`, `brand`, `reference`, `output`.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/user-asset/list` | `?kind&folder&tag&search&page&pageSize` (page size up to 200, default 60) | `{ list, folders, kindCount, limit, isTeamManager, pagination: { total, page, pageSize } }` |
| POST | `/api/user-asset` | `{ mediaUrl, kind?, name?, nodeType?, thumbnailUrl?, width?, height?, aspectRatio?, folder?, tags? }` | The asset. Registers a file that is already uploaded. |
| POST | `/api/user-asset/register-output` | Same, plus `fromFlowId?`, `fromProduct?` | The asset, with `kind: "output"`. |
| POST | `/api/user-asset/folder/delete` | `{ name }` | `{ moved }`. Dissolves a folder; its assets are kept. |
| PUT | `/api/user-asset/:id` | Any of `name`, `folder`, `tags`, `kind` | The asset. |
| DELETE | `/api/user-asset/:id` | | `{ id }`. Soft delete; the file is kept. |

`nodeType` is `IMAGE` (default) or `VIDEO`. Up to 5000 assets per kind, per account.

Errors: `asset.media_url_required`, `asset.bad_thumbnail`, `asset.kind_full`, `asset.folder_required` (400); `asset.not_found` (404).

### Stock assets — /api/canvas-asset

A read-only library an operator may import into the database. It belongs to the site: every account sees the same one. Empty on a new install; there is no endpoint to add to it.

| Method | Path | Query | Response |
| --- | --- | --- | --- |
| GET | `/api/canvas-asset/categories` | | Array of `{ code, name, count }`. |
| GET | `/api/canvas-asset/list` | `?code&nodeType&page&pageSize` (page size up to 50, default 20) | `{ list, total, page, pageSize }` |

---

## Share links

Base path `/api/canvas-share`. Only reading a link by its token is public. Share links are the one thing meant to cross accounts: whoever has the token can read the snapshot without signing in, and a signed-in account can copy it into its own canvases. Everything else here works on the caller's own links.

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| POST | `/api/canvas-share/publish` | yes | `{ workflowId, title?, description?, expiresInDays? \| expiresAt? }` | `{ id, token, updated, expiresAt }` |
| GET | `/api/canvas-share/mine` | yes | | `{ list }`: every link of the caller, including expired and revoked ones. |
| GET | `/api/canvas-share/plaza` | yes | `?page&pageSize&sort=hot` | `{ list, total, page, pageSize }`: the caller's active links. |
| GET | `/api/canvas-share/:token` | **public** | | The snapshot: summary fields plus `description`, `nodes`, `edges`, `viewport`, `settings`. Found by the link token only. |
| POST | `/api/canvas-share/:token/copy` | yes | `{ name? }` | `{ workflowId, isOwn }`: a new canvas made from the snapshot, in the caller's account. |
| PUT | `/api/canvas-share/:id` | yes | `{ title?, description?, expiresInDays? \| expiresAt?, revoked? }` | The link summary. |
| POST | `/api/canvas-share/:id/revoke` | yes | | The link summary. |
| DELETE | `/api/canvas-share/:id` | yes | | `{ id, revoked, removed }` |

Behaviour:

- **Publishing** snapshots the canvas. Publishing the same canvas again refreshes the snapshot and keeps the token, unless the link was revoked; then a new token is issued.
- **Expiry**: `expiresInDays` from 0 to 3650, where `0` means never; or `expiresAt` as a future date, `null` for never. Without either, a new link never expires and an existing link keeps its expiry (an expiry already in the past is cleared).
- **Reading** a token that does not exist, has expired or was revoked always answers `404` with `share.gone`, so a caller cannot tell which. Each public read increments the view count.
- **Delete** revokes on the first call and removes the link from `mine` on the second. A revoked token is never reused.
- **Copying** needs a session, and the copy belongs to the account that made it. The snapshot keeps the model ids of the account that published it; in the copy they are looked up among the copier's own providers, and a model is simply not available when the copier has no provider with that slug.
- `:id` in `PUT`, `revoke` and `DELETE` is the database id from `publish` or `mine`; a link of another account answers `404` (`share.not_found`). The public read and `copy` accept only the link token: a database id in its place answers `404`, signed in or not.
- **Model names.** A viewer has none of the publisher's providers, so each node that names a model also carries `data.modelLabel`: the display name the publisher sees, written by the server when the link is published (a value sent by the client is replaced). A snapshot published before this is given the names when it is read, from the publisher's current models. A model the publisher no longer has gets no `modelLabel`; the share page then shows a neutral "Model not listed" and never the model id. A copy does not keep `modelLabel`.
- **Brand kits.** A snapshot carries no brand kit: the canvas's `brandKitId` is not part of it, and `brandKitOverride` is removed from every node (on publish, on every public read, and from copies). What a kit added to a run is visible only where it already is, in the prompt that was sent (`data.lastPrompt`). A copy is created with `brandKitId: ""`.
- **Layout.** A snapshot records which node sizes its positions were made for (`layoutVersion`, not returned). A copy of a snapshot from before the redesign, or of a canvas still waiting for its layout check, is created with `legacyLayout: true`.
- **What a snapshot leaves out.** Run-time state, run ids, failure details and costs are removed from every node when the link is published, again on every public read, and from copies: `status`, `progress`, `validationError`, `validationStamp`, `errorMsg`, `taskId`, `taskIds`, `runId`, `runPending`, `generatedCount`, `cost`, `estimatedCost`, `brandKitOverride`, and `cost` / `taskId` / `runId` inside each entry of `results[]`. Prompts and model ids (with the provider's slug prefix) stay.
- Run-time state (status, progress, task and run ids, error text) and costs are stripped from the nodes in a snapshot, and again when a snapshot is read publicly.

Errors: `canvas.not_found`, `share.not_found`, `share.gone` (404); `share.empty_canvas`, `share.max` (500 links per account), `share.title_required`, `share.expires_in_past`, `validation.range`, `validation.bad_date` (400).

---

## Admin

Base path `/api/admin`. Two kinds of endpoint live under it, and "admin" in the path is historical for the first kind:

- **Per account.** Vendors, providers and their keys, custom models, model settings and prices, and usage. Any signed-in account may call these, and each call works on the caller's own data. Bring-your-own-key is per account: two accounts never see or use each other's providers.
- **Super admin only.** Site settings, storage, registration and the accounts of the instance. Any other account gets `403` `auth.forbidden`; a caller who is not signed in gets `401` `auth.required`.

| Endpoint | Who may call it | Whose data it works on |
| --- | --- | --- |
| `GET /api/admin/vendors` | Any signed-in account | Nobody's: the vendors and catalogs built into the server, the same for every account |
| `GET`, `POST /api/admin/providers` | Any signed-in account | The caller's providers and keys |
| `PUT`, `DELETE /api/admin/providers/:id` | Any signed-in account | The caller's providers and keys |
| `POST /api/admin/providers/:id/test` | Any signed-in account | The caller's provider |
| `POST /api/admin/providers/:id/models` | Any signed-in account | The caller's custom models |
| `PUT`, `DELETE /api/admin/providers/:id/models/:model` | Any signed-in account | The caller's custom models |
| `GET /api/admin/models` | Any signed-in account | The caller's models and their overrides |
| `PUT /api/admin/models/:modelId` | Any signed-in account | The caller's override of that model (enabled, label, order, defaults, price) |
| `GET /api/admin/usage`, `GET /api/admin/usage/records` | Any signed-in account | The caller's usage records |
| `DELETE /api/admin/usage/records` | Any signed-in account | The caller's usage records |
| `GET`, `PUT /api/admin/settings` | Super admin only | The site |
| `GET`, `PUT /api/admin/storage`, `POST /api/admin/storage/test` | Super admin only | The site |
| `GET`, `PUT /api/admin/site` | Super admin only | The site: whether registration is open |
| `GET /api/admin/users` | Super admin only | Every account: what identifies it and two counts, never its content |
| `PATCH /api/admin/users/:id` | Super admin only | One other account: disable or enable it |
| `DELETE /api/admin/users/:id` | Super admin only | One other account and everything it owns |
| `POST /api/admin/users/:id/reset-password` | Super admin only | One other account: its password and sessions |

The super admin's own providers, models and usage are per account like anybody else's: the super admin calls the first group for the super admin's own data and has no endpoint that returns another account's canvases, keys or files. Any other path under `/api/admin` answers `403` to an account that is not the super admin and `404` to the super admin.

### Vendors

`GET /api/admin/vendors` returns every vendor a provider can be created for, in display order, with the models it supports. Names and descriptions are in the language of the request. This replaces `GET /api/admin/provider-types` of the previous version, which no longer exists.

```json
[
  {
    "type": "openai",
    "label": "OpenAI",
    "recommended": false,
    "keyUrl": "",
    "defaultBaseUrl": "https://api.openai.com/v1",
    "models": [
      {
        "model": "gpt-image-2.5-sunburst",
        "label": "GPT Image 2.5 Sunburst",
        "kind": "image",
        "desc": "Image generation and editing, most precise edits",
        "acceptsImage": true,
        "acceptsVideo": false,
        "videoEdit": false,
        "custom": false,
        "maxReferenceImages": 16,
        "options": { "aspectRatios": ["auto", "1:1", "3:2", "2:3"], "counts": [1, 2, 3, 4] },
        "defaults": { "aspectRatio": "auto", "count": 1 }
      }
    ],
    "customKinds": ["image", "chat"],
    "customDefaults": {
      "image": {
        "kind": "image", "acceptsImage": true, "acceptsVideo": false, "videoEdit": false, "custom": true,
        "maxReferenceImages": 16,
        "options": { "aspectRatios": ["auto", "1:1", "3:2", "2:3"], "counts": [1, 2, 3, 4] },
        "defaults": { "aspectRatio": "auto", "count": 1 }
      },
      "chat": {
        "kind": "chat", "acceptsImage": true, "acceptsVideo": false, "videoEdit": false, "custom": true,
        "maxReferenceImages": 8, "options": {}, "defaults": {}
      }
    }
  }
]
```

| Field | Meaning |
| --- | --- |
| `type` | The vendor id: `gaorui`, `openai` or `gemini`. Sent as `type` when creating a provider. |
| `label` | The vendor's name. |
| `recommended` | `true` for the vendor to offer first (Gaorui). |
| `keyUrl` | Where to get a key, or `""`. |
| `defaultBaseUrl` | The vendor's official address. |
| `models[]` | The vendor's catalog. `model` is the upstream model name; the other fields are as in a [ModelSpec](#get-apimodels). `desc` is optional. |
| `customKinds` | The kinds a custom model of this vendor may have. |
| `customDefaults` | For each of those kinds, what a custom model of that kind gets. |

### Providers

A provider is a vendor plus a key, and belongs to the account that added it. As returned (the key itself is never returned):

```json
{
  "id": "665f…", "type": "gaorui", "name": "Gaorui", "slug": "gaorui",
  "baseUrl": "https://gaorui.cc", "customBaseUrl": false,
  "customModels": [ { "model": "some-chat-model", "kind": "chat", "label": "" } ],
  "enabled": true, "sort": 0,
  "hasKey": true, "keyTail": "3456", "createdAt": "…", "updatedAt": "…"
}
```

- `baseUrl` is the address in use: the one saved for this provider, or the vendor's official address. `customBaseUrl` is `true` when it is not the official one.
- `customModels` are the models added by hand; see [Custom models](#custom-models).
- There is no `options` object any more, and no model fields at the top level.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/providers` | | Array of providers. |
| POST | `/api/admin/providers` | `{ type, apiKey, name?, baseUrl?, enabled?, sort?, slug? }` | The provider. |
| PUT | `/api/admin/providers/:id` | Any of `name`, `baseUrl`, `apiKey`, `clearKey`, `enabled`, `sort` | The provider. |
| DELETE | `/api/admin/providers/:id` | | `{ id }`. Also deletes the overrides of its models. |
| POST | `/api/admin/providers/:id/test` | | `{ ok, message }` |

```bash
curl -X POST http://localhost:3000/api/admin/providers \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"openai","apiKey":"sk-…"}'
```

- `type` is the vendor id and `apiKey` is required. `name` defaults to the vendor's name. Omit `baseUrl` to use the official address.
- The vendor is fixed at creation. A `PUT` with a different `type` is refused with `provider.vendor_fixed`; the same `type` is accepted and ignored.
- On update, omit `apiKey` or send `""` to keep the stored key; send `"clearKey": true` to remove it. `"baseUrl": ""` goes back to the official address.
- `slug` is set at creation (from `slug` in the body, otherwise from the vendor id) and cannot be changed. It is unique among the caller's providers: a second provider of the same vendor gets `gaorui-2`, and so on. Another account's slugs do not matter.
- An account can have up to 50 providers (`provider.max`).
- The test endpoint calls the upstream's model-list endpoint to prove the address and the key; it no longer returns a model count. It answers HTTP 200 with `ok: false` and a reason when the upstream cannot be reached. A failed test is an answer, not an error.

Errors: `provider.type_unsupported`, `provider.max`, `provider.api_key_required`, `provider.vendor_fixed`, `provider.type_gone`, `provider.base_url_scheme`, `provider.base_url_credentials`, `validation.bad_url`, `validation.bad_format`, `common.name_required` (400); `provider.not_found` (404); `provider.slug_exhausted` (409).

### Custom models

Models outside the vendor's catalog, per provider. Each call returns the provider, with the updated `customModels`.

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/api/admin/providers/:id/models` | `{ model, kind, label? }` | Adds a custom model. |
| PUT | `/api/admin/providers/:id/models/:model` | `{ kind?, label? }` | Changes the kind or the display name. The name cannot be changed. |
| DELETE | `/api/admin/providers/:id/models/:model` | | Removes it, with its override (enabled state, order, price). |

```bash
curl -X POST http://localhost:3000/api/admin/providers/665f…/models \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"some-chat-model","kind":"chat","label":"My chat model"}'

curl -X PUT 'http://localhost:3000/api/admin/providers/665f…/models/org%2Fmodel%3Atag' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"label":"Renamed"}'
```

- `model` is the upstream model name: letters, digits and `. _ - : / @`, up to 120 characters. In the path it must be URL-encoded.
- `kind` is required and has no default. It must be one of the vendor's `customKinds`; for the three built-in vendors that is `image` or `chat`, so `video` is refused.
- `label` is optional, up to 80 characters.
- The model then appears in `GET /api/models` as `<slug>:<model>` with `custom: true` and the parameters of `customDefaults[kind]`.
- Sending a new `label` with `PUT` also clears a display name set through `PUT /api/admin/models/:modelId` for that model.

| Code | Status | When |
| --- | --- | --- |
| `provider.custom_name_required` | 400 | `model` is missing or empty. |
| `provider.custom_bad_name` | 400 | `model` has other characters or is longer than 120. |
| `provider.custom_kind_required` | 400 | `kind` is missing or not `image`, `video` or `chat`. |
| `provider.custom_kind_unsupported` | 400 | The vendor takes no custom model of that kind. |
| `provider.custom_in_catalog` | 400 | The vendor's catalog already lists that model. |
| `provider.custom_exists` | 400 | This provider already has that custom model. |
| `provider.custom_max` | 400 | The provider already has 100 custom models. |
| `provider.custom_name_fixed` | 400 | A `PUT` body carries a different `model`. |
| `provider.custom_not_found` | 404 | No custom model of that name on this provider. |

### Models (admin)

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/models` | | Every model of the caller's providers, including disabled ones and custom ones: ModelSpec (with `custom`) plus `enabled`, `providerEnabled`, `sort` and `override` (`{ enabled, label, sort, defaults, pricing }` or `null`). |
| PUT | `/api/admin/models/:modelId` | `{ enabled?, label?, sort?, defaults?, pricing? }` | The merged ModelSpec. |

- `:modelId` contains a colon and possibly slashes: URL-encode it (`gaorui%3Anano-banana-2`). It is looked up among the caller's providers, and the override is stored for the caller's account only.
- Sending `null` for a field removes that part of the override. `"pricing": null` removes your price; the built-in catalogs declare none, so the model shows "Cost unknown" again.
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

Super admin only. One set of settings for the whole instance.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/settings` | | A flat object with every setting. |
| PUT | `/api/admin/settings` | Any subset of the keys | The full object after the update. |

Keys, defaults and ranges are listed in [Configuration](configuration.md#admin-settings). The keys that came with accounts:

| Key | Default | Range | Meaning |
| --- | --- | --- | --- |
| `registrationOpen` | `true` | boolean | Whether people may create accounts themselves; registration only ever creates `user` accounts. The `REGISTRATION_OPEN` variable gives it its first value and is ignored once the setting has been saved (see [Configuration](configuration.md#accounts)). Also readable and writable through [`/api/admin/site`](#registration). |
| `userConcurrency` | `4` | 1–32 | Runs one account may have executing at the same time. `concurrency` (default 4) stays the total for the whole instance. |
| `userQueueLimit` | `200` | 1–500 | Unfinished runs (queued, running, archiving) one account may have. The total for the whole instance stays 500. |

The other limits, the timeouts and `retentionDays` are site settings too and apply to every account's runs. There is no per-account storage quota.

The full set of keys is `siteName`, `logoUrl`, `defaultLocale`, `registrationOpen`, `concurrency`, `userConcurrency`, `userQueueLimit`, `maxRetries`, `imageTimeoutMinutes`, `videoTimeoutMinutes`, `chatTimeoutSec`, `submitTimeoutSec`, `downloadTimeoutSec` and `retentionDays`. `defaultTheme` of earlier versions is not among them any more: the interface has a single theme. `GET` does not return it, `PUT` refuses it with `settings.unknown_key` like any other unknown key, and a value stored by an earlier version is ignored.

Errors: `auth.forbidden` (403); `settings.unknown_key` (any key that is not a setting, including names such as `constructor` or `__proto__`), `validation.int_range`, `validation.one_of`, `validation.string`, `validation.boolean`, `settings.logo_url` (400).

### Registration

Super admin only. The same value as the `registrationOpen` setting, on its own endpoint.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/site` | | `{ "registrationOpen": boolean }` |
| PUT | `/api/admin/site` | `{ "registrationOpen": boolean }` | `{ "registrationOpen": boolean }` |

With registration closed, existing accounts keep signing in and `POST /api/auth/register` answers `403` `auth.registration_closed`, without exception. A `PUT` here saves the setting, after which the `REGISTRATION_OPEN` variable is no longer applied.

Errors: `auth.forbidden` (403); `validation.boolean` (400) when `registrationOpen` is missing or not a boolean.

### Accounts

Super admin only. The super admin manages accounts, not what is in them: nothing here returns a canvas, a key or a file of another account.

**GET /api/admin/users** returns every account, oldest first (at most 1000):

```json
[
  {
    "id": "670e…b2", "username": "admin", "email": "", "role": "owner", "mustChangePassword": false, "createdAt": "2026-10-09T02:58:01.120Z",
    "disabled": false,
    "lastLoginAt": "2026-10-09T03:40:12.004Z",
    "counts": { "workflows": 33, "runs": 35 }
  }
]
```

The fields of a [User](#the-user-object), plus:

| Field | Meaning |
| --- | --- |
| `disabled` | `true` when the super admin has disabled the account. |
| `lastLoginAt` | When a session was last opened for the account, or `null`. |
| `counts.workflows` | Canvases of the account that are not deleted. |
| `counts.runs` | Usage records of the account. |

**PATCH /api/admin/users/:id** takes `{ "disabled": boolean }` and returns that account's row, in the shape above. Disabling ends every session of the account at once; it cannot sign in (`auth.account_disabled`) and its token answers `401`. Its data is kept. `"disabled": false` restores access.

**DELETE /api/admin/users/:id?confirm=&lt;username&gt;** removes the account. `confirm` must equal the account's username exactly. It stops the account's unfinished runs and deletes its sessions, canvases, share links, assets, brand kits, providers and keys, model overrides, usage records, templates and stored files, then the account itself. This cannot be undone.

```json
{
  "id": "6711…4d",
  "removed": { "workflows": 12, "shares": 2, "userassets": 7, "providers": 1, "modeloverrides": 4, "runs": 40 },
  "files": 96,
  "filesRemoved": true
}
```

- `removed` maps a collection name to the number of documents deleted (`workflows`, `shares`, `userassets`, `brandkits`, `providers`, `modeloverrides`, `runs`, `templates`, `texttemplates`); a collection with nothing to delete is absent.
- `files` is the number of stored files removed: everything under the account's key prefixes (`uploads/<account id>/`, `outputs/<account id>/`, `tools/<account id>/` and their thumbnails), on every configured backend.
- `filesRemoved` is `false` when a storage backend failed part-way. The account is gone either way; the reason is in the server log, and the files that are left have to be removed from the storage by hand.
- Files whose key has no account segment (stored before accounts existed) are never removed this way. They belong to the super admin, who cannot be deleted.

**POST /api/admin/users/:id/reset-password** takes no body, sets a random password and ends every session of the account. Response: `{ "temporaryPassword": string }`, 16 characters, returned this once and not stored in readable form. It also sets the account's `mustChangePassword` to `true`. Hand the password to the person; they sign in with it and are asked to choose a new password right after signing in (`PUT /api/auth/password`), before the API serves them anything else. In the web app this is **Reset password** under **Settings → Users**. No mail is sent. The super admin's own forgotten password is reset on the server, with `node server/src/cli/reset-password.js <username-or-email>`, which does the same three things.

Errors of the three endpoints that take `:id`:

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `auth.cannot_modify_self` | `:id` is the caller. The super admin changes their own password with `PUT /api/auth/password` and cannot disable or delete their own account. |
| 400 | `auth.cannot_modify_owner` | `:id` is the super admin account. |
| 400 | `auth.confirm_mismatch` | `DELETE` only: `confirm` is missing or is not the account's username. |
| 400 | `validation.boolean` | `PATCH` only: `disabled` is missing or not a boolean. |
| 403 | `auth.forbidden` | The caller is not the super admin. |
| 404 | `auth.user_not_found` | No account with that id. |

### Storage

Super admin only (`auth.forbidden`, 403, for any other account). Where files are kept, for every account: the local disk or an S3-compatible bucket. Storage is not part of `/api/admin/settings`; it has its own endpoints. What the fields mean, per-vendor values and what happens to existing files on a switch are in [Storage](storage.md).

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/storage` | | The storage status (below). |
| POST | `/api/admin/storage/test` | `{ s3: {…} }` | The result of a connection test with the submitted, unsaved configuration. |
| PUT | `/api/admin/storage` | `{ driver: "local" }` or `{ driver: "s3", s3: {…}, force?: true }` | The storage status after the change. |

**The status**, returned by `GET` and by a successful `PUT`:

```json
{
  "source": "saved",
  "driver": "s3",
  "delivery": "proxy",
  "envDriver": "local",
  "secretUnreadable": false,
  "s3": {
    "preset": "minio",
    "endpoint": "http://minio:9000",
    "region": "us-east-1",
    "bucket": "loomcanvas",
    "accessKeyId": "AKIA…",
    "forcePathStyle": true,
    "keyPrefix": "",
    "publicBaseUrl": "",
    "delivery": "proxy",
    "acl": "",
    "hasSecret": true,
    "secretTail": "x9Qd",
    "endpointHost": "minio:9000"
  },
  "previous": [
    { "endpointHost": "s3.eu-west-1.amazonaws.com", "bucket": "old-bucket", "keyPrefix": "" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `source` | Where the active choice comes from: `saved` (a configuration was saved through this API or the settings page), `env` (`STORAGE_DRIVER=s3` in the environment), `default` (local disk, nothing configured). |
| `driver` | The backend that receives new files: `local` or `s3`. |
| `delivery` | How `/files/<key>` answers for files on the active backend: `proxy` or `redirect`; empty when `driver` is `local`. |
| `envDriver` | What `STORAGE_DRIVER` says. |
| `secretUnreadable` | `true` when the saved secret cannot be decrypted (`SECRET_KEY` changed). New files then go to what the environment says until the secret is entered again. |
| `s3` | The S3 configuration the form starts from: the saved one (kept also while `driver` is `local`), otherwise the environment's, otherwise `null`. The secret is never returned: `hasSecret` and `secretTail` (its last four characters) stand in for it. `endpointHost` is the endpoint's host, or the AWS default for the region when the endpoint is empty. |
| `previous` | Earlier saved buckets, at most 5. They receive no new files and are still read. |

**The `s3` object** in request bodies:

| Field | Values |
| --- | --- |
| `preset` | `aws`, `r2`, `oss`, `minio` or `custom` (default). A label for the form; it has no effect on requests. |
| `endpoint` | `http(s)://host[:port]` without a path, credentials or query. Empty for AWS S3. Must not start with the bucket name. |
| `region` | Default `us-east-1`. |
| `bucket` | Required. 3 to 63 lowercase letters, digits, dots and hyphens. |
| `accessKeyId` | Required. |
| `secretAccessKey` | Empty or omitted means "use the stored one" (the saved secret, otherwise the environment's). Required when there is none. |
| `forcePathStyle` | Boolean, default `false`. |
| `keyPrefix` | Optional folder inside the bucket. Returned normalised, with a trailing slash (`a/b/`). |
| `publicBaseUrl` | Optional `http(s)` URL that maps to the bucket root; a path is allowed. Returned without a trailing slash. |
| `delivery` | `proxy` or `redirect`. Default: `redirect` when `publicBaseUrl` is set, otherwise `proxy`. `redirect` needs `publicBaseUrl`. |
| `acl` | `""` (default), `private` or `public-read`. |

**POST /api/admin/storage/test** makes a real round trip: it writes a small object under `probe/`, looks it up (and looks up a key that does not exist, to detect a credential without list permission), reads it back and compares the bytes, loads it through the public address when delivery is `redirect`, and deletes it. Nothing is saved.

```json
{
  "ok": false,
  "steps": [
    { "step": "put", "status": "failed", "ms": 41 },
    { "step": "head", "status": "skipped" },
    { "step": "get", "status": "skipped" },
    { "step": "delete", "status": "skipped" }
  ],
  "message": "The Secret Access Key is wrong (the signature does not match). Paste it again, without spaces",
  "code": "storage.err_signature"
}
```

- `steps[].step` is `put`, `head`, `get`, `public` (only with `redirect` delivery) or `delete`; `status` is `ok`, `failed` or `skipped`; `ms` is absent for skipped steps.
- `message` is in the language of the request. `code` is empty when `ok` is `true`.
- A failed test is an answer, not an error: HTTP 200 with `ok: false`. Only a body that does not validate is answered with 400.
- `code` of a failed test: `storage.err_access_key`, `storage.err_signature`, `storage.err_access_denied`, `storage.err_list_permission`, `storage.err_no_bucket`, `storage.err_region`, `storage.err_unreachable`, `storage.err_host_not_found`, `storage.err_host_bucket_not_found` (turn path-style addressing on), `storage.err_path_style_refused` (turn it off), `storage.err_tls`, `storage.err_clock_skew`, `storage.err_not_s3`, `storage.err_read_back`, `storage.err_public_unreachable`, `storage.err_public_status`, `storage.err_public_mismatch`, `storage.err_other`. What each means is in [Storage](storage.md#troubleshooting).
- The server contacts the submitted `endpoint` and `publicBaseUrl`. These are not subject to the SSRF guard; see [Security](security.md#ssrf-protection).

**PUT /api/admin/storage** saves and switches at once, without a restart. Uploads under way finish on the backend they started with.

- `{ "driver": "local" }` goes back to the local disk. A saved S3 configuration is kept and stays readable.
- `{ "driver": "s3", "s3": {…} }` runs the connection test first. When it fails nothing is saved and the answer is HTTP 400 with `code: "storage.save_needs_test"` and, unlike other errors, a payload: `data.test` is the test result in the shape above.
- `"force": true` saves without testing.
- Saving a configuration that points somewhere else (another endpoint, bucket or key prefix) moves the previous one to `previous`. Files are not moved.

Errors (400): `storage.save_needs_test`, `storage.endpoint_has_path`, `storage.endpoint_has_bucket`, `storage.bad_bucket`, `storage.bad_key_prefix`, `storage.redirect_needs_public_url`, `validation.required`, `validation.one_of`, `validation.bad_url`, `validation.bad_format`, `validation.string`, `validation.boolean`.

### Usage

Per account: the totals and the records are those of the caller's own runs. There is no endpoint that reports usage across accounts.

In the web app this is the **History** page and the usage card of the **Workbench**.

Common query parameters for both `GET` endpoints:

| Parameter | Meaning |
| --- | --- |
| `from`, `to` | Date range on the run's creation time. A bare date (`2026-10-31`) is that calendar day in `tz`: `from` starts at the beginning of the day, `to` runs through the end of it. A full ISO instant or a millisecond timestamp is taken as it is. |
| `tz` | An IANA time zone name such as `Asia/Shanghai`. Default `UTC`. Decides what day a bare date in `from` and `to` means and, with `groupBy=day`, where one day ends and the next begins. Without it everything is in UTC days, as in earlier versions. |
| `kind` | `image`, `video` or `chat` |
| `status` | A run status |
| `model` | A model id |

**GET /api/admin/usage** — additional parameter: `groupBy` = `day` (default) or `model`. `timezone` in the answer is the zone that was used.

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

`prompt` is cut to 200 characters. Errors of both endpoints (400): `validation.bad_date`, `validation.from_before_to`, `validation.invalid` (for `kind`, `status`, `model`, and for a `tz` that is not a known zone name).

**DELETE /api/admin/usage/records?before=&lt;date&gt;[&amp;tz=&lt;zone&gt;]** — deletes the caller's usage records created before that moment. A bare date (`2026-01-31`) means before the start of that day in `tz` (UTC without `tz`); a full instant is taken as it is. Only finished records (succeeded, failed, canceled) are deleted; queued and running ones are kept, and so are the generated files. This cannot be undone, and the totals for that period go with the records.

Response: `{ "deleted": number }`. Errors (400): `validation.required`, `validation.bad_date`, `validation.invalid` (`tz`).

The web app always sends the browser's time zone as `tz`: on the History page, in its clean-up dialog and for the month totals and the 14-day bars of the workbench. "Today" there is the user's local day.

---

## A minimal client

Generate one image from the command line. The account needs a provider with a key of its own first, added on the **Models** page or with `POST /api/admin/providers`.

```bash
BASE=http://localhost:3000

# 0. Sign in and keep the token (data.token in the answer)
curl -s -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"account":"ada","password":"correct horse battery"}'
TOKEN=<token from the answer>

# 1. Pick an image model
curl -s "$BASE/api/models?kind=image" -H "Authorization: Bearer $TOKEN"

# 2. Start a run (replace the model id with one from step 1)
curl -s -X POST "$BASE/api/runs" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gaorui:nano-banana-2","prompt":"an orange cat on a windowsill","params":{"aspectRatio":"1:1"}}'

# 3. Poll with the runId from step 2 until status is succeeded or failed
curl -s "$BASE/api/runs/<runId>" -H "Authorization: Bearer $TOKEN"
```
