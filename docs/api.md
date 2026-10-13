# HTTP API reference

[简体中文](api.zh-CN.md)

This is the API the LoomCanvas frontend uses. It is written from the route files in `server/src/routes/`. The Chinese design contract between frontend and backend is [architecture.md](architecture.md); when the two disagree, the code wins and one of the documents has a bug.

> Status: early development. Paths and shapes may change before the first tagged release. There is no API versioning yet.

## Conventions

### Base URL and format

- Every endpoint is under `/api`. Stored files are served under `/files`, on every storage backend.
- Request bodies are JSON (`Content-Type: application/json`), except the file upload, which is `multipart/form-data`.
- JSON bodies are limited to 1 MB, or 6 MB under `/api/workflow`, or 64 KB for `/api/auth`, `/api/canvas-share` and `/api/team-invitations`. On protected endpoints the body is parsed only after the token has been checked.
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
| `data` | The payload, or `null` on failure. A few failures carry a payload: `auth.too_many_attempts` (`{ retryAfterSeconds }`), `storage.save_needs_test` (`{ test }`), `canvas.conflict` and `canvas.locked` (see [Saving and conflicts](#saving-and-conflicts) and [The edit lock](#the-edit-lock)), the six `budget.*` refusals (see [Monthly limits](#monthly-limits)) and `asset.folder_not_empty` (`{ name, count }`). |

Three endpoints stream a file instead of JSON on success: `POST /api/workflow/download`, `POST /api/workflow/:id/download-zip` and `POST /api/runs/download-zip`.

### Language

The language of `message`, of run failure reasons and of built-in names is chosen per request, first match wins:

1. `X-Locale` header: `zh-CN` or `en`
2. `Accept-Language` header
3. the `defaultLocale` setting
4. `zh-CN`

### Authentication

Every instance has accounts, and signing in is always required. There is no mode without it; the `ACCESS_PASSWORD` variable of earlier versions is ignored.

- An account has a username, an email address and a password. There are two roles. The super admin has the role `owner` (that is its value everywhere in this API): the server creates it at start-up when there is none, from `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `ADMIN_EMAIL`, and there is exactly one. Every account that registers is a `user`. An account has no other role on the site; the roles inside a team (owner, admin, member) are a separate thing, see [Spaces and teams](#spaces-and-teams).
- Every request acts in one space: the caller's personal space (no `X-Space` header, or `personal`) or a team the caller is a member of (`X-Space: <team id>`). In its personal space an account sees and changes only its own data: canvases, share links, assets, brand kits, runs, usage records, and its own providers, API keys, custom models, model settings and prices. The super admin is scoped the same way and cannot read another account's data through the API. Where the sections after [Spaces and teams](#spaces-and-teams) say "the caller's own", they mean the space the request acts in.
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

```http
Authorization: Bearer <token>
```

- The token is an opaque string of 43 characters, not a JWT. The server keeps only its SHA-256, in the `sessions` collection. There are no cookies.
- A session lasts 12 hours, or 30 days when the login was sent with `"remember": true`. The lifetime is fixed at sign-in; using the session does not extend it. The session that registration opens lasts 12 hours.
- A session ends before that when: it is signed out (`POST /api/auth/logout`), it is ended from another session (`DELETE /api/auth/sessions…`), the account's password is changed (every session of the account ends; the caller gets a new token in the answer, see [PUT /api/auth/password](#put-apiauthpassword)), the super admin resets the account's password or disables it (all its sessions end), or the account is deleted. Each of these takes effect at once. Changing `SECRET_KEY` does not end sessions.
- Public without a token: `GET /api/bootstrap`, `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/canvas-share/:token`, `GET /api/team-invitations/:token`, `POST /api/workflow/:id/lock/release` (it takes the lock's release token instead), and `GET /files/*`.
- Everything else answers `401` with code `auth.required` when the token is missing, unknown, expired, or belongs to a disabled account. On a protected endpoint a `401` always means "not signed in"; upstream authentication failures are reported as `400`. The only other `401` is `auth.invalid_credentials` from `POST /api/auth/login`.
- An endpoint that only the super admin may call answers `403` with code `auth.forbidden` to any other account.
- While an account's password is a temporary one (`mustChangePassword` is `true` in its [User](#the-user-object)), its sessions are served only `GET /api/auth/me`, `GET /api/bootstrap`, `PUT /api/auth/password` and `POST /api/auth/logout`, plus the public endpoints. Every other endpoint answers `403` with code `auth.password_change_required` until the password has been changed with [PUT /api/auth/password](#put-apiauthpassword).
- A resource of another space (another account's personal space, or a team the request does not act in), addressed by its id, answers `404` with the same code as an id that does not exist (`canvas.not_found`, `run.not_found`, `provider.not_found`…). It is never a `403` and never data. Lists contain only the records of the space the request acts in.

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
| 400 | `team.bad_space` | The `X-Space` header is neither `personal` nor a team id. See [Spaces and teams](#spaces-and-teams). |
| 403 | `team.forbidden` | The caller's role in the team does not allow the action. |
| 403 | `team.dissolved`, `team.suspended` | The team named by `X-Space` (or in the path) is closed. |
| 403 | `budget.*` | A monthly limit of the team refuses the run. See [Monthly limits](#monthly-limits). |
| 403 | `auth.password_change_required` | The caller's password is a temporary one and has to be replaced first ("Choose a new password before you continue"). Only `GET /api/auth/me`, `GET /api/bootstrap`, `PUT /api/auth/password` and `POST /api/auth/logout` are served until then. |
| 404 | `common.route_not_found` | No such endpoint. |
| 404 | `common.not_found`, `*.not_found` | No such record, or it belongs to another space (another account's personal space, or a team the request does not act in). |
| 404 | `team.not_found` | No such team, or the caller is not a member of it. |
| 409 | `canvas.conflict` | A save named a revision the canvas has moved on from. See [Saving and conflicts](#saving-and-conflicts). |
| 423 | `canvas.locked` | Somebody else is editing the team canvas. See [The edit lock](#the-edit-lock). |
| 409 | `common.duplicate` | A unique value already exists. |
| 413 | `common.body_too_large`, `file.too_large` | Body or upload over the limit. |
| 429 | `auth.too_many_attempts` | Sign-in, registration, password-change or profile-change rate limit. `data.retryAfterSeconds` and the `Retry-After` header say how long to wait. |
| 429 | `run.queue_full` | The account has `userQueueLimit` unfinished runs (default 200) across its personal space and its teams, or the instance as a whole has 500. |
| 500 | `common.internal` | Unexpected error. Details are in the server log only. |

### CORS

No cross-origin access is granted by default. Origins listed in `CORS_ORIGIN` may call `/api` with the methods `GET`, `POST`, `PUT`, `PATCH` and `DELETE` and the headers `Authorization`, `Content-Type`, `X-Locale` and `X-Space`.

---

## App and login

### GET /api/bootstrap

Public. What a client needs before anything else; also the health check. `GET /api/app/bootstrap`, the path of earlier versions, still answers the same.

Response `data`, for a caller who is not signed in:

```json
{
  "auth": { "registrationOpen": true },
  "user": null,
  "site": { "name": "LoomCanvas", "logoUrl": "", "showName": true, "defaultLocale": "zh-CN" },
  "hasProvider": false,
  "limits": { "maxUploadMb": 50 },
  "media": { "upstreamByUrl": false, "writable": true },
  "version": "0.1.0"
}
```

| Field | Meaning |
| --- | --- |
| `auth.registrationOpen` | Whether `POST /api/auth/register` accepts a new account now: the value of the `registrationOpen` setting. It is the only field of `auth`. |
| `user` | The caller's [User](#the-user-object) when the request carries a valid token, otherwise `null`. Signing in is always required, so `null` means "not signed in". This endpoint also answers a session whose `user.mustChangePassword` is `true`. |
| `site` | Name, logo and default language of the site. `showName` is the `showSiteName` setting: `false` means a client that shows the logo does not write the name next to it (it only matters when `logoUrl` is not empty). |
| `hasProvider` | `true` when the space the request acts in (the caller's personal space, or the team named by `X-Space`) has at least one enabled provider. Always `false` for a caller who is not signed in. |
| `spaces`, `space`, `spaceError`, `teams` | Where the caller can work, where this request acts and as what, and whether the caller may create a team. See [What the bootstrap and `me` say about spaces](#what-the-bootstrap-and-me-say-about-spaces). `spaces` is `[]` and `space` and `teams` are `null` for a visitor. |
| `limits.maxUploadMb` | The server's `MAX_UPLOAD_MB`, so a client can refuse a file that is too large before uploading it. |
| `version` | The version of the server. |
| `media.upstreamByUrl` | Whether an upstream model can be given a stored file by URL: `true` with a public `PUBLIC_URL`, or when new files go to a bucket reachable from the internet; always `false` for a caller who is not signed in. The canvas uses it to warn, before a run, when a model that only takes URLs (`imageByUrlOnly` in its ModelSpec) has a reference image connected. It describes the configuration: while the bucket in use cannot be written to (see `media.writable`), it still answers for that bucket as it is set up. |
| `media.writable` | Whether a new file can be stored right now. `false` while the saved secret of the bucket in use cannot be read: uploads and image / video runs are then refused (`503 storage.secret_unreadable`), and every signed-in client knows before trying. One boolean: nothing about which storage, or why. Always `true` for a caller who is not signed in. |

Earlier versions also returned `authRequired`, `authed` and `site.defaultTheme`. They are gone: signing in is always required (use `user`), and the theme is a preference of each account (`user.prefs.theme`), not a site setting.

### The User object

What the API returns about an account:

```json
{ "id": "670e…b2", "username": "ada", "email": "ada@example.com", "role": "user", "mustChangePassword": false, "prefs": { "nodeLayout": "a", "theme": "dark" }, "createdAt": "2026-10-09T02:58:01.120Z" }
```

| Field | Meaning |
| --- | --- |
| `role` | `owner` (the super admin) or `user`. |
| `email` | The account's address. It may be `""` for the super admin, the only account that can exist without one (created without `ADMIN_EMAIL`, until it adds one with [PUT /api/auth/profile](#put-apiauthprofile)). |
| `mustChangePassword` | `true` while the account's password is one somebody else knows: the super admin password the server generated at start-up, a temporary password from [`POST /api/admin/users/:id/reset-password`](#accounts), or one from the command-line reset. `PUT /api/auth/password` sets it back to `false`. While it is `true` the API serves the account almost nothing else, see [Authentication](#authentication). |
| `prefs` | The account's preferences for the web app, always complete (an account that never chose gets the defaults). `nodeLayout` is how generation nodes look on the canvas: `"a"` result first with a composer under the selected node (the default), `"b"` compact nodes with an inspector on the right, `"c"` everything on the node. `theme` is the colour theme of the interface: `"dark"` (the default), `"light"`, or `"system"` to follow the device's own light / dark setting. Change them with [PUT /api/auth/prefs](#put-apiauthprefs). |

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

Response: `{ "user": User, "spaces": [...] }`. `spaces` is the same list as in the bootstrap: the personal space, then the teams the account is in (`[]` while `mustChangePassword` is `true`). Available while `mustChangePassword` is `true`.

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

Body: `{ "nodeLayout"?: "a" | "b" | "c", "theme"?: "dark" | "light" | "system" }`. Changes the caller's preferences; only the keys sent are changed. They are stored with the account, so they follow it to every browser. Response: `{ "user": User }`.

The web app also mirrors `theme` in the browser's `localStorage` (key `loomcanvas-theme`), so that pages shown before signing in, shared canvases and the first paint of the next visit use it. The account's value wins whenever someone is signed in.

The body is validated strictly: it has to be an object with at least one key, every key has to be a known preference and every value one of its allowed values. Nothing is changed when a request is refused.

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `validation.body_object` | The body is not a JSON object. |
| 400 | `common.nothing_to_update` | The object is empty. |
| 400 | `validation.bad_key` | A key that is not a preference (an unknown key is refused, not ignored). |
| 400 | `validation.one_of` | A value outside the allowed set, for example `{ "nodeLayout": "d" }` or `{ "theme": "sepia" }`. |

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

## Spaces and teams

Everything an account works with lives in a **space**. Every account has one **personal space**: what it had before teams existed, unchanged. A **team** is a second kind of space that several accounts share: its canvases, assets, brand kits, templates, providers and keys, prices, runs and share links belong to the team, not to the person who made them. An account can be in any number of teams.

Three roles exist inside a team: the **owner** (one per team; whoever created it, until it is handed over), **admins** (named by the owner) and **members**. They are unrelated to the role of an account on the site (`user.role`: `owner` = the site's super admin, `user` = everybody else). The site's super admin has no access to a team they are not a member of.

### Which space a request acts in

| How | Used by | Meaning |
| --- | --- | --- |
| Header `X-Space: <team id>` | Every endpoint that works on a space's content: `/api/workflow`, `/api/files`, `/api/models`, `/api/runs`, `/api/llm`, `/api/user-asset`, `/api/brand-kits`, `/api/canvas`, `/api/canvas-share` (except the public read), and the per-space part of `/api/admin` (`vendors`, `providers`, `models`, `usage`) | The request acts in that team. |
| Header `X-Space: personal`, or no header | The same endpoints | The request acts in the caller's personal space. A client from before teams, and the stand-alone editor's adapter, send no header and keep working exactly as before. |
| The team id in the path: `/api/teams/:id/...` | Team management: members, invite links, limits, usage, activity, settings, handing over, dissolving | The path names the team; the header is not read. |

Membership is checked on every request and nothing about it is kept in the session: somebody who is removed from a team is refused on their very next call.

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `team.bad_space` | `X-Space` is neither `personal` nor a 24-character id. |
| 404 | `team.not_found` | The team does not exist **or the caller is not a member of it** - the two are indistinguishable. |
| 403 | `team.dissolved` | The caller is a member, and the team has been dissolved (restorable for 7 days). |
| 403 | `team.suspended` | The caller is a member, and the super admin has suspended the team. |
| 403 | `team.forbidden` | The caller is a member, and their role does not allow the action (see [the permission matrix](#the-permission-matrix)). |

Inside a space, an id that belongs to another space answers `404` exactly like an id that never existed - also for members of the team that owns it when they are not acting in it, and for the super admin. Inside a team, a canvas the caller may not see (somebody else's "only me" canvas) is a `404` too; a thing they may see but not change answers `403 team.forbidden`.

A client should treat `team.not_found`, `team.dissolved` and `team.suspended` from any call as "this space is gone for me": drop the stored choice of space, fall back to the personal space and fetch the bootstrap again. The super admin's site endpoints (`/api/admin/users`, `/site`, `/teams`, `/team-requests`, `/settings`, `/storage`) ignore a stale `X-Space` instead of failing on it.

### What the bootstrap and `me` say about spaces

`GET /api/bootstrap` gains, for a signed-in caller (all empty or `null` for a visitor, and while `mustChangePassword` is `true`):

```json
{
  "spaces": [
    { "id": "personal", "kind": "personal", "name": "", "role": "owner" },
    { "id": "6712…a0", "kind": "team", "name": "Starlight Studio", "avatar": "", "ownerId": "670e…b2", "status": "active", "role": "member", "members": 7, "maxMembers": 50, "timezone": "Asia/Shanghai", "dissolvedAt": null, "purgeAt": null, "createdAt": "…" }
  ],
  "space": {
    "id": "6712…a0", "kind": "team", "name": "Starlight Studio", "role": "member",
    "permissions": { "canvas:create": true, "provider:manage": false, "canvas:edit": null, "…": true },
    "settings": { "defaultVisibility": "team_view", "publicShare": "editors", "adminsSeeAll": false, "copyToPersonal": true, "blockUnpriced": true }
  },
  "teams": { "authorised": false, "canCreate": false, "held": 0, "max": 3, "maxMembers": 50, "request": null }
}
```

| Field | Meaning |
| --- | --- |
| `spaces` | Every space the caller can work in: the personal one first, then the teams they are in, oldest membership first. A team that is suspended or dissolved is listed only for its owner (with its `status`, and `purgeAt` for a dissolved one). |
| `space` | The space **this request** acts in - named by `X-Space`, the personal space without it. `id` is `"personal"` or the team id. `permissions` is the caller's row of [the permission matrix](#the-permission-matrix): `true`, `false`, or `null` where the answer depends on the canvas or the member at hand (each canvas carries its own `access`). `settings` is the team's ([Team settings](#team-settings)), `null` in a personal space. In a personal space every permission is `true`. |
| `spaceError` | Present only when `X-Space` named a team the caller cannot enter: `team.not_found`, `team.dissolved` or `team.suspended`. The bootstrap does not fail on it; `space` is then the personal space. |
| `teams` | May the caller create a team: see [Who may create a team](#who-may-create-a-team). |
| `hasProvider` | Now about the space the request acts in: does **that space** have an enabled provider. |

`GET /api/auth/me` answers `{ "user": User, "spaces": [...] }` with the same `spaces` array (empty while `mustChangePassword` is `true`).

### Who may create a team

Creating a team needs the super admin's authorisation. It is a flag on the account (`canCreateTeams`), set in user management or by approving the account's request. The site's super admin is always authorised. Two site settings bound it: `teamMaxPerUser` (default **3**) - how many teams one account may create - and `teamMaxMembers` (default **50**) - how many members a team may have.

The creation state, as `bootstrap.teams`, `GET /api/teams` (`creation`) and `GET /api/teams/creation` return it:

```json
{ "authorised": true, "canCreate": true, "held": 1, "max": 3, "maxMembers": 50,
  "request": { "id": "6713…", "status": "approved", "note": "for the studio", "reason": "", "createdAt": "…", "decidedAt": "…" } }
```

| Field | Meaning |
| --- | --- |
| `authorised` | The account has the authorisation. |
| `held` / `max` | Teams the account created or owns that still exist (a dissolved team counts until it is removed for good) / `teamMaxPerUser`. |
| `canCreate` | `authorised && held < max`: show "Create team" only then. |
| `request` | The account's latest request for the authorisation: `status` is `pending`, `approved` or `rejected` (`reason`: what the super admin wrote when rejecting). `null` when it never asked. |

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/teams/creation` | | The creation state. |
| POST | `/api/teams/creation-request` | `{ note? }` (up to 500 characters) | The creation state, with the new `request`. One pending request per account: `409 team.request_pending`. An account that is already authorised gets `409 team.already_authorised`. After a rejection the account may ask again. |
| DELETE | `/api/teams/creation-request` | | `{ withdrawn, ...creation state }`. Takes a pending request back. |

### Teams

A team, as lists return it:

```json
{ "id": "6712…a0", "kind": "team", "name": "Starlight Studio", "avatar": "", "ownerId": "670e…b2",
  "status": "active", "role": "owner", "members": 7, "maxMembers": 50, "timezone": "Asia/Shanghai",
  "dissolvedAt": null, "purgeAt": null, "createdAt": "…" }
```

`status` is `active`, `suspended` (closed by the super admin) or `dissolved` (closed by its owner; `purgeAt` is when it will be removed for good). `role` is the caller's. `avatar` is a media URL or `""`.

| Method | Path | Who | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/teams` | anybody signed in | | `{ teams: Team[], creation }` - the caller's teams and the creation state. |
| POST | `/api/teams` | an authorised account | `{ name, avatar?, timezone? }` | The new Team (`role: "owner"`, `members: 1`). `name` 1-40 characters; `timezone` an IANA name (default `UTC` - **send the browser's zone**: the monthly limits follow it). |
| GET | `/api/teams/:id` | any member; while the team is closed, its owner | | The [team detail](#team-detail). |
| PATCH | `/api/teams/:id` | name, avatar: owner, admins (`team:rename`). `timezone`, `settings`: owner (`team:settings`) | `{ name?, avatar?, timezone?, settings? }` | The team detail. |
| DELETE | `/api/teams/:id?confirm=<team name>` | owner (`team:dissolve`) | | The Team, `status: "dissolved"`, with `purgeAt`. |
| POST | `/api/teams/:id/restore` | owner | | The Team, active again. Only within the 7 days. |
| POST | `/api/teams/:id/transfer` | owner (`team:transfer`) | `{ userId, confirm: <team name> }` | The Team; the caller's `role` is now `admin`. |
| POST | `/api/teams/:id/leave` | admins, members (`team:leave`) | | `{ left: true, canvasesInherited, runsCanceled }` |

Errors: `team.not_authorised` (403; not authorised), `team.max_owned` (403; `teamMaxPerUser` reached), `common.name_required`, `validation.max_length`, `validation.bad_url` (`avatar`), `validation.invalid` (`timezone`), `team.confirm_mismatch` (400; `confirm` is not the team's exact name), `team.member_not_found` (404; `userId` is not a member), `team.already_owner` (400), `team.new_owner_unusable` (409; that account is disabled), `team.owner_cannot_leave` (409), `team.not_dissolved` (409), `team.changed` (409; somebody changed the same thing a moment ago - reload).

#### Team detail

```json
{
  "id": "6712…a0", "kind": "team", "name": "Starlight Studio", "avatar": "", "ownerId": "670e…b2", "status": "active",
  "role": "member", "members": 7, "maxMembers": 50, "timezone": "Asia/Shanghai", "dissolvedAt": null, "purgeAt": null, "createdAt": "…",
  "settings": { "defaultVisibility": "team_view", "publicShare": "editors", "adminsSeeAll": false, "copyToPersonal": true, "blockUnpriced": true },
  "me": { "id": "670f…11", "role": "member", "displayName": "", "joinedAt": "…" },
  "permissions": { "canvas:create": true, "provider:manage": false, "…": null },
  "onboarding": { "hasProvider": true, "hasMembers": true, "hasCanvas": false },
  "concurrency": 4,
  "limits": { "…": "see Limits" }
}
```

`onboarding` drives the three first steps of a new team (configure a provider, invite somebody, create a canvas); all `true` means nothing is left to show. `concurrency` is how many of the team's runs may be in flight at the same time - the cap the queue enforces: the team's own when the super admin set one, else the site's `teamConcurrency`. Every member is told it. `limits` is the [Limits](#monthly-limits) object as the caller may see it (`null` while the team is closed).

#### Team settings

| Key | Default | Values | Meaning |
| --- | --- | --- | --- |
| `defaultVisibility` | `team_view` | `private`, `team_view`, `team_edit` | The visibility a new canvas starts with when its creator names none. |
| `publicShare` | `editors` | `editors`, `managers` | Who may create a public share link: everybody who may edit the canvas, or the owner and admins only. |
| `adminsSeeAll` | `false` | boolean | Admins see everybody's records and usage, as the owner does. |
| `copyToPersonal` | `true` | boolean | Members and admins may copy team canvases and assets into their personal space. The owner always may. |
| `blockUnpriced` | `true` | boolean | With a money limit in force: refuse models whose cost cannot be counted. Changed through `PUT /api/teams/:id/limits`, or here. |

All of them are the owner's to change (`PATCH /api/teams/:id { settings: {...} }`, any subset). An unknown key is `400 settings.unknown_key`.

#### Dissolving, restoring, removal

- **Dissolve** closes the team at once: every member gets `403 team.dissolved`, its share links stop opening (`404 share.gone`), its invite links stop working, runs waiting in the queue are canceled (runs already in flight finish and their results stay), edit locks are released. Nothing is deleted yet.
- For **7 days** the owner (`POST /api/teams/:id/restore`) or the super admin can restore it; everything is as it was (the canceled runs stay canceled).
- After that the server removes the team for good: all its canvases, share links, assets, brand kits, providers and keys, prices, runs, saved templates, members, invite links, its activity log and every file under its key prefixes. This runs hourly and cannot be undone.
- A dissolved team keeps counting towards its owner's `teamMaxPerUser` until it is removed.

#### Handing over

`POST /api/teams/:id/transfer` makes another member the owner and the caller an admin, in one step. The new owner sees every canvas of the team, "only me" ones included. Receiving a team needs no authorisation.

### Members

A member, as `GET /api/teams/:id/members` returns it:

```json
{ "id": "670f…11", "username": "zhouyu", "displayName": "Zhou Yu", "name": "Zhou Yu", "role": "member", "joinedAt": "…", "disabled": false,
  "usage": { "runs": 132, "amount": 61.4, "uncounted": 3, "currency": "CNY" },
  "limits": { "runs": 400, "amount": null, "custom": { "runs": true, "amount": false } } }
```

`name` is what to show: the display name the member has in this team, else the username. `disabled`: the account cannot sign in at the moment (disabled by the super admin). `usage` (this month) and `limits` are present only for callers with `usage:view_all` - the owner, and admins once the owner switched `adminsSeeAll` on; `limits.custom` says which of the two are the member's own rather than the team's default. With them come `usage.breakdown` and `effective` - the member's month by the one definition of "used" (succeeded + in progress), and the state to show (`ok`, `near`, `reached`, `unlimited`): see [Monthly limits](#monthly-limits).

Wherever the API names a person (a canvas's creator, who holds a lock, who started a run, who added an asset, saved a template or published a link, who looks after a provider, the actor and the member of an activity entry) it uses one shape, a **Person**:

```json
{ "id": "670f…11", "username": "zhouyu", "name": "Zhou Yu", "state": "left", "left": true, "deleted": false }
```

| `state` | Meaning | `left` | `deleted` |
| --- | --- | --- | --- |
| `active` | In the team (in a personal space: the account exists). | `false` | `false` |
| `left` | The account exists but is no longer in this team - it left or was removed. | `true` | `false` |
| `deleted` | The account itself is gone. | `true` in a team | `true` |

`state` is the field to read; `left` and `deleted` are the same answer as the two flags older clients read. `name` is the display name the person has in the team, else the username. For somebody who is gone both are **the names they went by when they left** - the server keeps them (and nothing else of the person) so that what they made still says whose it was, until the team itself is removed. They are `""` only for somebody who left before names were kept, or whom nothing was ever known about; show a neutral "former member" / "deleted account" then. Somebody who joins again is `active` again.

| Method | Path | Who | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/teams/:id/members` | any member | | `{ members: Member[], maxMembers, withUsage }`, owner first, then admins, then members. |
| PATCH | `/api/teams/:id/members/:userId` | see below | `{ role?, displayName?, limits? }` | The Member. |
| DELETE | `/api/teams/:id/members/:userId` | owner: anybody else. Admins: plain members (`member:remove`) | | `{ removed: true, canvasesInherited, runsCanceled, keysSet }` |

`PATCH` fields: `role` (`"admin"` or `"member"`) - the owner only (`member:set_role`); `limits` (`{ runs?, amount? }`, a number or `null` = follow the team's default) - the owner only (`limits:manage`); `displayName` (up to 40 characters, `""` = use the username) - oneself, or the owner and admins for anybody.

What happens when somebody **leaves or is removed** (the same either way):

- they are out on their next request: everything of the team answers `404 team.not_found`, in the session they already have;
- what they made stays with the team (canvases, assets, results, templates), shown with `createdBy.state: "left"` and the name they went by (`"deleted"` once the account itself is deleted);
- their "only me" canvases pass to the team's owner (`canvasesInherited` says how many) - nobody else could reach them;
- an edit lock they hold is released; the runs they have **waiting in the queue** are canceled (`runsCanceled`), a run that already started finishes and its result is the team's. A run canceled this way says why: its record reads `status: "canceled"` with `errorCode: "run.canceled_member_removed"` and `error` as a sentence in the reader's language ("Canceled while it was waiting: whoever started it is no longer in the team") - wherever the run is read (`GET /api/runs/:id`, the usage records). A run somebody canceled by hand has `errorCode: "run.canceled"`. A run the queue picked up in the very instant its starter left is not sent to the upstream: it fails with `run.member_removed`;
- invite links they created stop working;
- `keysSet` (removal only) lists the providers `[{ id, name }]` whose current key a removed **admin** entered: they know those keys, so remind the owner to replace them at the upstream. A member never saw a key; nothing needs replacing.

Errors: `team.member_not_found` (404), `team.owner_cannot_leave` (409; the owner hands the team over or dissolves it first), `team.owner_role_fixed` (409; the owner's role changes only by handing over), `team.use_leave` (400; removing oneself), `validation.one_of`, `validation.int_range`, `validation.range` (400).

### Invite links

The only way into a team. A link carries a token; whoever holds it can join **as a member** until it expires, is used up or is revoked. Nothing is ever sent by email.

```json
{ "id": "6714…", "token": "q0X…43 characters", "createdBy": Person, "maxUses": 10, "usedCount": 2, "remainingUses": 8,
  "expiresAt": "…", "revoked": false, "state": "valid", "createdAt": "…" }
```

The link the UI hands out is `<site>/join/<token>` (the path is the web app's; the server only knows the token). `maxUses: 0` means no limit; `remainingUses` is how many more people may use it: `null` when there is no limit and for a link that is `revoked`, `expired` or `team_unavailable` (it has nothing left to use - show its `state`, not a count; `maxUses` and `usedCount` still say what became of it), `0` once it is `used_up`. `state` is `valid`, `expired`, `used_up`, `revoked`, `team_full` or `team_unavailable`. The token is stored encrypted and its SHA-256 is what it is found by, so managers can copy a link again and a copy of the database alone cannot be used to join; `token` is `""` when it can no longer be shown (after `SECRET_KEY` changed) - such a link can only be revoked.

| Method | Path | Who | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/teams/:id/invitations` | owner, admins (`invite:manage`) | | Invitation[], newest first. |
| POST | `/api/teams/:id/invitations` | owner, admins | `{ expiresInDays?: 1-90 (default 7), maxUses?: 0-1000 (default 10) }` | The Invitation. At most 50 working links per team (`invite.max`). |
| DELETE | `/api/teams/:id/invitations/:invitationId` | owner, admins | | `{ id, revoked: true }`. Takes effect at once. |
| GET | `/api/team-invitations/:token` | **public** | | The preview, below. |
| POST | `/api/team-invitations/:token/accept` | signed in | | `{ team: Team, already }` |

The preview - what the join page shows, signed in or not:

```json
{ "state": "valid",
  "team": { "id": "6712…a0", "name": "Starlight Studio", "avatar": "", "members": 7, "maxMembers": 50, "ownerName": "linzhou" },
  "inviterName": "linzhou", "contactName": "linzhou", "expiresAt": "…", "remainingUses": 8, "alreadyMember": false, "registrationOpen": true }
```

`team` is `null` and `inviterName` and `contactName` are `""` when the team is closed. `inviterName` is who made the link - the name they went by in the team, also after they left it. `contactName` is who to ask for a new link when this one cannot be used: the person who made it while they can still make another (still in the team, as its owner or an admin), otherwise the team's owner - never somebody who has left, was removed or whose account is gone. `remainingUses` is how many more people may join with this link ("8 uses left"): a number while the link is `valid` and has a limit of its own, `null` when it has none or when `state` is anything but `valid`. That is all the preview says about the link's use - not how many uses it started with, not how many were spent, not by whom. `alreadyMember` is about the caller when the request carries a token. Nothing of what is inside the team is ever part of it.

Accepting: `already: true` when the caller is in the team already (no use of the link is spent). Refusals: `404 invite.not_found` (unknown token, or the team is closed), `410 invite.expired`, `410 invite.used_up`, `410 invite.revoked`, `409 invite.team_full` (`teamMaxMembers`, or the team's own ceiling, is reached), `401 auth.required`.

**Registration.** An invite link is not a way to get an account. With registration closed, `POST /api/auth/register` answers `403 auth.registration_closed` whatever the request carries; `registrationOpen` in the preview tells the join page to say so instead of offering to register.

### The permission matrix

`✓` allowed, `—` not allowed, `△` allowed under the condition in the note. The ids are the keys of `permissions` in the bootstrap and the team detail. This table is printed from the one the server checks against (`server/src/services/permissions.js`), and a test fails when the two differ.

| Action | Id | Owner | Admin | Member | Note |
| --- | --- | --- | --- | --- | --- |
| Create a canvas | `canvas:create` | ✓ | ✓ | ✓ |  |
| Edit or delete a canvas they created | `canvas:edit_own` | ✓ | ✓ | ✓ | A deleted canvas can be restored by the owner and admins for 30 days |
| See somebody else's canvas | `canvas:view` | ✓ | △ | △ | Admins and members: only canvases set to "team can view" or "team can edit". The owner sees all of them, "only me" included |
| Edit somebody else's canvas | `canvas:edit` | ✓ | △ | △ | Admins and members: only canvases set to "team can edit" |
| Delete somebody else's canvas | `canvas:delete` | ✓ | △ | — | Admins: any canvas they can see |
| Change who can see a canvas | `canvas:set_visibility` | ✓ | △ | △ | Admins: any canvas they can see. Members: only canvases they created |
| Take over a canvas somebody else is editing | `canvas:take_over` | ✓ | △ | △ | Whoever may edit the canvas: for admins and members that is their own canvases and those set to "team can edit" |
| Overwrite a newer version with their own on a save conflict | `canvas:overwrite` | ✓ | △ | △ | Admins: any canvas they may edit. Members: only canvases they created |
| Restore a deleted canvas | `canvas:restore` | ✓ | ✓ | — | Within 30 days of the deletion |
| Create a public share link | `share:create` | ✓ | △ | △ | A canvas they may edit. With the team setting "only managers may share", members cannot |
| See and revoke anybody's share links | `share:manage_all` | ✓ | ✓ | — | Members see and revoke the links they created |
| See, use and upload team assets, templates and snippets | `asset:use` | ✓ | ✓ | ✓ | Everybody may edit or delete what they added themselves |
| Edit or delete assets, templates and snippets somebody else added | `asset:manage_all` | ✓ | ✓ | — |  |
| Create, change or delete brand kits | `brandkit:manage` | ✓ | ✓ | — | Members can only choose one for a canvas |
| Configure providers, keys, custom models, prices; switch models on and off | `provider:manage` | ✓ | ✓ | — | Members see names, models and prices - never a key, its last characters or the address |
| Run models with the team's keys | `run:create` | ✓ | ✓ | ✓ | Within the monthly limits |
| Create and revoke invite links | `invite:manage` | ✓ | ✓ | — |  |
| Remove a member | `member:remove` | ✓ | △ | — | Admins can remove members, not the owner or other admins |
| Make somebody an admin, or a member again | `member:set_role` | ✓ | — | — |  |
| See their own records and usage | `usage:view_own` | ✓ | ✓ | ✓ |  |
| See everybody's records and usage | `usage:view_all` | ✓ | △ | — | Admins: only while the owner has switched "admins see all records" on (off by default) |
| Set the monthly limits of the team and of members; delete usage records | `limits:manage` | ✓ | — | — |  |
| Read the team's activity log | `activity:view` | ✓ | ✓ | — |  |
| Change the team's name and avatar | `team:rename` | ✓ | ✓ | — |  |
| Change the team's settings (default visibility, sharing, time zone...) | `team:settings` | ✓ | — | — |  |
| Hand the team over to another member | `team:transfer` | ✓ | — | — |  |
| Dissolve the team, or restore it within 7 days | `team:dissolve` | ✓ | — | — |  |
| Leave the team | `team:leave` | — | ✓ | ✓ | The owner hands the team over or dissolves it first |

A refusal is `403 team.forbidden`, except where not seeing the thing is the refusal: somebody else's "only me" canvas, and for a member somebody else's share link, answer `404`. `usage:view_all` is not refused but narrowed: the answer then holds the caller's own records only (`scope: "own"`).

### Canvases in a team

Every canvas answer (`GET /api/workflow/list`, `POST /api/workflow`, `GET` and `PUT /api/workflow/:id`, `duplicate`, `restore`, `PATCH .../access`, `PATCH .../meta`) carries these fields, in a personal space too:

| Field | Meaning |
| --- | --- |
| `spaceId` | `"personal"` or the team id. |
| `visibility` | `""` in a personal space. In a team: `private` (only its creator - and the team's owner), `team_view` (everybody sees and may copy it; the creator, and the owner, edit) or `team_edit` (everybody edits, one at a time). |
| `createdBy` | Person. In a personal space: the caller. |
| `revision` | A whole number, raised by one on every content save. See [Saving](#saving-and-conflicts). |
| `metaRevision` | A whole number, raised by one when the canvas is renamed (or its `legacyLayout` flag is cleared). Never involved in a conflict: it only tells an open editor that the name it shows is out of date. |
| `lastEditedBy`, `lastEditedAt` | Person and time of the last content save, `null` before the first. A rename is not one. |
| `lock` | `null`, or `{ by: Person, at, expiresAt, mine, sameUser }` while somebody is editing: show "X is editing" on the card and in the editor. `sameUser`: the holder is the caller's own account. `mine`: it is this very editing session (the request named it with `sessionId`); `sameUser && !mine` is "you, in another tab". The holder's own answers also carry `releaseToken`. See [The edit lock](#the-edit-lock). |
| `access` | What the caller may do with **this** canvas: `{ canView, canEdit, canDelete, canSetVisibility, canTakeOver, canOverwrite, canShare }`. In a personal space all are `true` except `canSetVisibility` and `canTakeOver` (`false`: there is nothing to set or take). |

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/workflow/list` | `?mine=1` (the caller's own), `?member=<account id>`, `?visibility=…` - team only, and they only narrow down what the caller may see | The list entries, each with the fields above. |
| POST | `/api/workflow` | `{ ..., visibility? }` | In a team the canvas starts with `visibility`, else with the team's `defaultVisibility`. `createdBy` is the caller. |
| PATCH | `/api/workflow/:id/access` | `{ visibility }` | The canvas. Team only (`400 canvas.personal_no_visibility` in a personal space). Who: its creator, the owner, an admin who can see it (`canvas:set_visibility`). Does not change `revision`. |
| PATCH | `/api/workflow/:id/meta` | `{ name?, viewport?, legacyLayout? }` | The canvas. Renames it (or stores the viewport) without the edit lock and without a revision: see [Saving and conflicts](#saving-and-conflicts). Who: whoever may edit it. |
| POST | `/api/workflow/:id/duplicate` | `{ name? }` | A copy in the same space. In a team it is the caller's and starts as `private`. Media is shared by reference. |
| POST | `/api/workflow/:id/copy` | `{ toSpace: "personal" \| <team id>, name? }` | `{ workflowId, spaceId, files }` - a copy in **another** space the caller is in. |
| DELETE | `/api/workflow/:id` | | Soft delete. Who: its creator, the owner, an admin who can see it. |
| GET | `/api/workflow/trash` | | Canvases deleted in the last 30 days, each with `deletedAt`, `deletedBy`, `restorableUntil`. Team: owner and admins (`canvas:restore`). Personal space: its owner. |
| POST | `/api/workflow/:id/restore` | | The restored canvas. Same people; `404` after 30 days. |

**Copying between spaces** (`/copy`): from a personal space into a team, or from a team into the caller's personal space or another of their teams. The copy is the caller's, `private` in a team. **The files go along**: every stored file the canvas refers to is duplicated under the target space (`files` says how many), so the copy survives the source space being deleted. Brand kits are not carried over (`brandKitId: ""`, node exceptions removed), and model ids are looked up in the target space - a node whose model the target does not have simply asks for one. Errors: `400 space.same_space` (use `duplicate`), `404 team.not_found` (not a member of the target), `403 space.copy_out_disabled` (the team's owner switched `copyToPersonal` off; the owner still may), `400 space.copy_too_large` (more than 300 files or 2 GiB).

### The edit lock

No two people edit one team canvas at the same time, and there is no real-time collaboration of any kind. One **editing session** at a time holds the canvas's **edit lock**; everybody else who opens it - the same person in a second tab included - gets it read-only.

**The session id.** An editing session is one open editor: one browser tab. The client makes up a random id for it once (`sessionId`: 8 to 64 characters of `A-Z a-z 0-9 _ -`, for example a UUID without dashes) and sends it with every call that concerns the lock: in the JSON body of `POST .../lock` and of `PUT /api/workflow/:id`, and in the query string of `DELETE .../lock` and - optionally - of `GET /api/workflow/:id` (`?sessionId=...`, which makes `lock.mine` exact there). It is a body field, not a header, so a cross-origin deployment needs no extra allowed header. The id never appears in any answer. A client that sends none is one implicit session per account (`""`), which is what clients from before sessions are; it shares nothing with a session that has an id.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| POST | `/api/workflow/:id/lock` | `{ sessionId, takeover? }` | `{ lock, state, revision, metaRevision, name, ttlMs, heartbeatMs, pollMs, ttlSeconds, heartbeatSeconds }` - takes the lock, or renews it (the heartbeat). |
| GET | `/api/workflow/:id/lock` | `?sessionId=…` (optional) | `{ lock, revision, metaRevision, name, canEdit, canTakeOver, ttlMs, heartbeatMs, pollMs }` - looks at the lock without taking or renewing it. What a read-only editor polls. Who: whoever may see the canvas. |
| GET | `/api/workflow/locks` | `?since=…` (optional) | `{ locks: [{ id, lock }], pollMs, now, counts, changed?, removed?, reload? }` - what a canvas list polls: the live locks on the canvases of the space that the caller may see and, with `since`, what else moved on the list (see "What a list poll carries" below). `{ locks: [], pollMs }` in a personal space. |
| DELETE | `/api/workflow/:id/lock?sessionId=…` | | `{ released }` - gives this session's lock back; `false` when it did not hold it. |
| POST | `/api/workflow/:id/lock/release` | `{ releaseToken }` - **public**, no `Authorization` | `{ released }` - gives the lock back from a page that is closing. See below. |

```json
{ "lock": { "by": Person, "at": "2026-10-13T08:00:00.000Z", "expiresAt": "2026-10-13T08:00:36.000Z",
            "mine": true, "sameUser": true, "releaseToken": "pV3…43 characters" },
  "state": "acquired", "revision": 12, "metaRevision": 3, "name": "Storyboard",
  "ttlMs": 36000, "heartbeatMs": 12000, "pollMs": 5000, "ttlSeconds": 36, "heartbeatSeconds": 12 }
```

- **Timings: 36 seconds and 12 seconds.** A lock lasts `ttlMs` = **36 seconds** past its last renewal; the editor renews it by calling `POST .../lock` again every `heartbeatMs` = **12 seconds**; every content save renews it as well. Three heartbeats fit into one lifetime, so two renewals in a row may be lost (a slow network, a laptop waking up) before the canvas goes to somebody else, and a tab that died without saying so (a crash, a lost connection) keeps others waiting for 36 seconds at most. A tab that is closed or navigates away gives the lock back at once (the release beacon, below). Clients read the numbers from the answer and do not hard-code them. `at` is when the lock was taken and stays through renewals.
- **Waiting: 5 seconds and 10 seconds.** `pollMs` = **5 seconds** is how often a read-only editor asks `GET .../lock` while its tab is visible: after the holder's tab was closed the offer to start editing appears within 5 seconds, after a tab that died within 36 + 5 seconds. A canvas list asks `GET /api/workflow/locks` every `pollMs` of that answer = **10 seconds** while it is visible. Neither asks while its tab is hidden; both ask at once when it is shown again.
- **What a list poll carries.** `GET /api/workflow/locks?since=<the now of the answer before>` also says what moved on the caller's list since then, so that somebody else's rename, new canvas or deletion appears within `pollMs` without loading the list again. `changed`: the canvases the caller may see that were created, renamed, saved or restored since, each exactly as `GET /api/workflow/list` gives it (never the nodes). `removed`: the ids of those deleted since. `now`: the server's clock, to send back as `since` next time - an ISO time or milliseconds; a first call may send the newest `updatedAt` of the list it holds. Changes count from two seconds before `since`, so a canvas may be listed twice: apply `changed`, then `removed`, and replace only the cards that differ. `counts`: `{ total, private, team_view, team_edit }`, how many canvases the list would give the caller right now. A change of visibility is not itemised - a canvas that became private is not named to those who can no longer see it - so a client whose list disagrees with `counts` loads the list again; so does one that is told `reload: true` (more than 50 canvases moved; `changed` and `removed` are then left out). Without `since` there is no `changed` and no `removed`. The viewport and the edit lock are not changes of the list. One read of the space's canvases without their nodes, at most 200 of them, as for the list.
- **`state`** says what the call did: `"acquired"` (the canvas was free, or its lock had run out, and is now this session's), `"renewed"` (this session held it and still does), `"reacquired"` (this session's own lock had run out and nobody took the canvas in between: carry on), `"taken_over"` (taken from the session that held it), `"none"` (a personal space).
- **`revision`, `metaRevision`, `name`** are the canvas's current ones. The heartbeat is how an open editor learns that the canvas was renamed elsewhere: when `metaRevision` is not the one it knows, it shows `name`.
- **Taking it.** `POST .../lock` needs the right to edit the canvas (`403 team.forbidden` otherwise - for example on a `team_view` canvas of somebody else). While another session holds a live lock the answer is HTTP **423**:

  ```json
  { "result": -1, "code": "canvas.locked", "message": "Zhou Yu is editing this canvas. You can only view it for now",
    "data": { "lock": { "by": Person, "at": "…", "expiresAt": "…", "mine": false, "sameUser": false },
              "canTakeOver": true, "lost": null, "ttlMs": 36000, "heartbeatMs": 12000, "pollMs": 5000 } }
  ```

  `data.lock.sameUser: true` means the holder is the caller's own account in another tab or on another device (`message`: "You have this canvas open for editing in another tab…"). `data.lost` tells a session that **used to hold** this lock how it lost it: `"taken_over"` (somebody - `data.lock.by` - took it on purpose), `"expired"` (it ran out, and somebody then started editing); `null` for a session that never held it. `message` is a different sentence in each of these cases, in the reader's language; the `code` is always `canvas.locked`.
- **Taking it over.** `{ "takeover": true }` takes the lock from its holder. Whoever may edit the canvas may (`canvas:take_over`) - also from their own other tab. Taking it from **somebody else** is written to the activity log; from oneself it is not. The former holder is not notified by push: its next heartbeat, or its next save, answers `423 canvas.locked` with `lost: "taken_over"`. Nothing it had saved is lost; what it had not saved yet is still in that tab.
- **Giving it back.** Inside the app (leaving the editor): `DELETE .../lock?sessionId=…` with the usual headers. When the **page goes away** (`pagehide`): `navigator.sendBeacon('/api/workflow/<id>/lock/release', JSON.stringify({ releaseToken }))`. A closing page cannot reliably finish a `fetch`, and `sendBeacon` cannot carry an `Authorization` header - so this one endpoint is public and takes the lock's **release token** instead: a value only the holder is given (`lock.releaseToken` in the answers of `POST .../lock`, `PUT`, `PATCH .../meta` and `GET …?sessionId=…` while this session holds the lock), which names exactly one lock of one session, frees that and nothing else, and means nothing any more once the lock changed hands. The body is JSON, sent as `text/plain` (what `sendBeacon` does with a string; no CORS preflight) or as `application/json` (`fetch` with `keepalive: true` works too). The answer is always `200 { released }` - `false` for a token that names no lock held right now - so it tells a guesser nothing. The token is 256 bits out of an HMAC over the lock, so it cannot be guessed; so that an anonymous caller cannot keep the database busy either, more than 120 calls a minute from one address are answered `released: false` without a look (a lock that was not released this way runs out by itself), and a body over 2 kB is `413`. **A save that was still on its way** when the page closed - the editor saves what is unsaved and sends the beacon in the same instant, and the small beacon often arrives first - is written, and does **not** take the lock back: for 30 seconds after a release, a content save of the session that released finds the canvas free and leaves it free.
- **A tab in the background.** Browsers throttle the timers of a hidden tab: to one run a second at once - which a 12-second heartbeat does not notice - and, in Chrome, to one run a **minute** once the tab has been hidden for five minutes. A minute is longer than the 36 seconds a lock lasts, on purpose: a tab nobody has looked at for five minutes does not keep a canvas from the people who are looking. So a tab hidden for less than five minutes keeps its lock; one hidden for longer loses it between two heartbeats. If nobody else wants the canvas, its next (late) heartbeat - or the one it sends at once when it is shown again (`visibilitychange`) - gets `200` with `state: "reacquired"`: the same lock, the same `at`, the same release token, nothing changed. If somebody started editing meanwhile, that heartbeat gets `423` with `lost: "expired"`. A save from a session whose lock ran out goes through as well while nobody else holds the canvas, and carries the same lock on. When somebody else edited **and left** while the tab was away, the heartbeat gets the canvas (`state: "acquired"`) with a `revision` the tab does not know: it must load the canvas again before it edits (or, with unsaved changes of its own, let its next save be the conflict it is).
- `409 canvas.lock_busy`: the lock changed hands in the very instant of the call. Rare; call again.
- **In a personal space** there is no lock: the call succeeds with `lock: null`, `state: "none"`, so an editor can call it without asking what kind of space it is in. Two tabs there are kept apart by the revision check below, as before.
- A removed member's lock is released at once. Dissolving or suspending a team releases all of its locks.

### Saving and conflicts

A save is one of two kinds, decided by the fields it carries:

| | Content | Metadata |
| --- | --- | --- |
| Fields | `nodes`, `edges`, `settings`, `brandKitId` | `name`, `viewport`, `legacyLayout` |
| Call | `PUT /api/workflow/:id` | `PUT /api/workflow/:id` with only these fields, or `PATCH /api/workflow/:id/meta` |
| Needs | the right to edit; in a team: the edit lock (this session's, or a free canvas) and `baseRevision` | the right to edit - nothing else |
| Changes | `revision` + 1, `lastEditedBy`, `lastEditedAt`, `updatedAt`; takes or renews the lock | a new `name`: `metaRevision` + 1 and `updatedAt`. A cleared `legacyLayout`: `metaRevision` + 1. `viewport`: nothing else |

The cover (`thumbnail`) is derived from the nodes on every content save; visibility has [its own call](#canvases-in-a-team).

**Metadata saves** - a rename above all. They neither ask for the lock nor take it, never look at `baseRevision` and never move `revision`. So a canvas can be renamed from the list while somebody is editing it; that editor's next content save is **not** a conflict because of it; and the editor learns the new name from its next heartbeat or save answer (`name`, `metaRevision`). `PATCH /api/workflow/:id/meta` is the same thing with a guard: content fields in its body are refused (`400 canvas.meta_only`) instead of turning the call into a content save. Who may: whoever may edit the canvas (`access.canEdit`; `403 team.forbidden` for a viewer, `404` for a canvas the caller cannot see). Renaming with `PUT { name }` and nothing else - what clients did before - is a metadata save too.

**Content saves** take two more fields, `baseRevision` and `force`, and in a team `sessionId`:

- A content save raises `revision` by one; the answer is the canvas with the new `revision`, which is the `baseRevision` of the client's next save.
- With `baseRevision`, the save goes through only while the canvas is still at that revision. Otherwise **nothing is written** and the answer is HTTP **409**:

  ```json
  { "result": -1, "code": "canvas.conflict", "message": "Somebody else changed this canvas. Your changes were not saved",
    "data": { "revision": 14, "baseRevision": 12, "updatedAt": "…", "lastEditedAt": "…", "lastEditedBy": Person, "canOverwrite": false } }
  ```

- `"force": true` skips the revision check and writes the caller's version over the newer one. Allowed for the canvas's creator, admins who may edit it, and the owner (`canvas:overwrite`; `canOverwrite` in the conflict answer and in `access`); `403 team.forbidden` otherwise. It is written to the activity log.
- **In a team space** a content save **must** carry `baseRevision` (`400 canvas.base_revision_required`), is refused with `423 canvas.locked` while **another session** holds the lock - somebody else, or the caller's own other tab - and, when it goes through, takes or renews the lock for the caller's session.
- **In a personal space** `baseRevision` is optional. Without it the save is the last-write-wins it always was (the stand-alone editor's adapter relies on that); with it, a second tab cannot silently overwrite the first: it gets the 409 above.
- A save that carries content **and** metadata is a content save, and is written or refused as a whole. An editor should not send `name` with its content saves unless the name was changed in that very editor: the stored name may be newer than the one it shows.
- **One save at a time.** A client must not have two content saves of the same canvas in flight: the second would name a revision the first is about to replace, and would be answered with a conflict against the client's own save.

The revision check does not depend on the lock: it is what holds when a lock expired while its holder was away, or was taken over.

### Providers, models and prices in a team

A team has its own providers, keys, custom models, model settings and prices, managed through the ordinary `/api/admin/providers`, `/models` endpoints with `X-Space: <team id>`. **Inside a team only the team's providers exist**: a member's personal providers and keys are never looked at, and a model id of a personal provider answers `400 model.provider_missing` there. The reverse holds too: a team's key is never used for a run in a personal space.

- The owner and admins (`provider:manage`) do everything a personal owner does: add providers, replace keys, test the connection, add custom models, switch models on and off, set prices. They are shown what a personal owner is shown: that a key is set and its last four characters - never the key.
- Members may call the read endpoints: `GET /api/models`, `POST /api/runs/estimate`, `GET /api/admin/models` (with prices), `GET /api/admin/vendors` and `GET /api/admin/providers`. The provider objects they get are **restricted**: `"restricted": true`, `"keyTail": ""`, `"baseUrl": ""`, `"customBaseUrl": false`, `"lastTest": null` - the name, the models, whether it is switched on (`enabled`) and has a key (`hasKey`), and who to ask about it (`maintainer`), nothing else. Every provider carries `restricted` (`false` for those who manage it). Every write, and the connection test, answers `403 team.forbidden`.
- **Who looks after a provider, and how its last test went.** Every provider carries `maintainer` - the [Person](#members) who last changed it (its name, address, key, switch or custom models; for providers from before this was kept: who entered the key, or who created it) - and `updatedAt`. Those who manage providers also get `lastTest`: `{ ok, at, message }` of the last connection test of the provider as it is saved, `message` in the reader's language, or `null` when it was never tested or its key or address changed since. A member never gets `lastTest` - a failed test may quote the upstream. Testing is not an edit: it changes neither `maintainer` nor `updatedAt`.
- The rule that [a stored key is only ever sent to the address it was saved with](#providers) applies to team and personal providers alike.

### Runs, limits and usage in a team

`POST /api/runs` and `POST /api/llm/tasks` with `X-Space` run a model **of the team, with the team's key**; the files of the result are stored under the team. The run records who started it. Any member may follow a run of the team by its id (`GET /api/runs/:id`, `POST /api/runs/status`) - a canvas shows its results to whoever may open it - and only the member who started it, the owner and admins may cancel it. The list of records, which holds prompts, is a different matter: see [Usage](#usage-in-a-team).

**Queue.** The queue stays fair per person: an account is one person in it wherever its runs are (personal space or a team), under the same `userConcurrency` and `userQueueLimit`. In addition a team's runs in flight are capped together (`teamConcurrency`, default 4; the super admin can set a team's own value), so a large team cannot fill the instance.

#### Monthly limits

Two units, per month: **runs**, and **estimated money**. Each can be set for the team as a whole and for each member (a default for everybody, and one member's own).

**One definition of "used"**, wherever the word appears - in this answer, in the member list, in a refusal, in the usage answer:

> **used = succeeded + in progress**

`succeeded`: runs that finished well. `in progress`: runs that are queued, running or archiving - a run holds its place from the moment it is accepted. **Failed and canceled runs count for nothing**: a run that fails gives its place and its money back. A run is one record, whatever its `count` of results. The answer always carries the breakdown behind the number, so a page can show "804 used: 801 succeeded, 3 in progress; 12 failed and 4 canceled do not count" without a second call and without a second way of counting.

```json
{
  "month": "2026-10", "timezone": "Asia/Shanghai",
  "startsAt": "2026-09-30T16:00:00.000Z", "resetsAt": "2026-10-31T16:00:00.000Z", "resetsAtLocal": "2026-11-01 00:00 (Asia/Shanghai)",
  "currency": "CNY", "blockUnpriced": true, "nearRatio": 0.8, "counted": ["succeeded", "inProgress"],
  "member": {
    "runs": { "used": 132, "limit": 400, "remaining": 268 },
    "amount": { "used": 61.4, "limit": null, "remaining": null },
    "uncounted": 3,
    "custom": { "runs": true, "amount": false },
    "breakdown": {
      "succeeded": { "runs": 130, "amount": 60.4, "unknownCost": 3 },
      "inProgress": { "runs": 2, "amount": 1.0, "unknownCost": 0 },
      "failed": { "runs": 7 }, "canceled": { "runs": 1 },
      "counted": { "runs": 132, "amount": 61.4 },
      "unknownCost": 3
    },
    "effective": {
      "runs": { "used": 132, "limit": 400, "remaining": 268, "state": "ok" },
      "amount": { "used": 61.4, "limit": null, "remaining": null, "state": "unlimited" },
      "state": "ok", "blockedBy": null, "uncounted": 3
    }
  },
  "team": { "runs": { "used": 804, "limit": 2000, "remaining": 1196 }, "amount": { "used": 388.2, "limit": 500, "remaining": 111.8 }, "uncounted": 21,
            "breakdown": { "…": "as above" }, "effective": { "…": "as above; blockedBy is team_runs, team_amount or null" } },
  "managers": { "owner": { "id": "670e…b2", "name": "Lin Zhou" }, "admins": [ { "id": "670f…11", "name": "Zhou Yu" } ] },
  "cannotRun": { "moneyLimited": true, "blockUnpriced": true,
                 "models": [ { "id": "gaorui:some-model", "label": "Some model", "reason": "unpriced", "modelCurrency": "", "code": "budget.unpriced_model" } ] },
  "memberDefault": { "runs": 300, "amount": null },
  "members": [ { "id": "670f…11", "name": "Zhou Yu", "username": "zhouyu", "role": "admin", "runs": {}, "amount": {}, "uncounted": 0, "custom": {}, "breakdown": {}, "effective": {} } ],
  "uncountable": [ { "id": "gaorui:some-model", "label": "Some model", "reason": "unpriced", "modelCurrency": "", "code": "budget.unpriced_model", "blocked": "everyone" } ],
  "unpriced": { "models": 1, "moneyLimited": "everyone", "blockUnpriced": true, "blocked": "everyone", "effect": "refused" }
}
```

- `member` is the caller's own month and is always there, and so are `managers` and `cannotRun` (below). `team` and `memberDefault` are present only with `usage:view_all`; so is `members` - one entry per member, the same shape as `member` plus who it is - and only when asked for with `?members=1`. `uncountable` and `unpriced` are for the owner and admins. `limit: null` means no limit.
- **`runs` / `amount`**: `used`, `limit`, `remaining` - `used` is `breakdown.counted`.
- **`breakdown`**: `succeeded`, `inProgress` (runs, their money, and how many of them have a cost that could not be counted), `failed` and `canceled` (runs; they hold no money), `counted` (= succeeded + in progress: the numbers the limits are checked against) and `unknownCost` (= `uncounted`).
- **`effective`** is the same numbers already combined into what a client shows, so that no client derives a state from a limit again:
  - `runs.state` / `amount.state`: `unlimited` (no limit), `ok`, `near` (from `nearRatio` = 80% of the limit on), `reached` (nothing left);
  - `state`: the worse of the two - and `reached` whenever `blockedBy` is set;
  - `blockedBy`: the limit a new run would be refused by **right now**, as the suffix of its refusal code - `member_runs`, `team_runs`, `member_amount`, `team_amount` - or `null`. A member whose own limit has room is still `blockedBy: "team_runs"` when the team's is used up; they are told so without being shown the team's numbers.
  - `uncounted`: see below.
- **`uncounted`** (= `breakdown.unknownCost`) is a number of **runs**: those that count as a run but whose money could not be counted - the model had no price, or a price in another currency than `currency`, or (a chat model) the upstream reported no token usage. They are in `runs.used` and add **0** to `amount.used`. Show it next to the amount ("+ 3 runs of unknown cost") so that nobody takes the sum for more than it is.
- **`managers`** says who to ask, by name: `owner` (`{ id, name }` - the only one who sets limits) and `admins` (`[{ id, name }]` - with the owner, the people who can enter a price). Every member gets it; the names are the ones the member list shows.
- **`cannotRun`** is the answer to "which models can **I** not run because of their price", already worked out by the rule a run is refused by - so that a model picker or a run button shows it without looking at prices and limits itself:
  - `moneyLimited`: the caller is under a money limit (their own, the default for members, or the team's);
  - `blockUnpriced`: the team's switch;
  - `models`: the enabled models a run of the caller is refused on **right now**, each with `reason` (`unpriced`, or `currency` with the model's `modelCurrency`) and the `code` of that refusal. Empty unless both of the above are true. It is per caller: with `unpriced.blocked: "some"` it is filled for the members who have a money limit of their own and empty for everybody else.
  A client shows "cannot run: no price - ask <owner / admins>" from `cannotRun.models` and `managers`, and nothing when a model is not in the list. (A model can still be refused when it is run with parameters its price table has no entry for; that is told by the refusal itself.)
- **`uncountable`** is a list of **models**: the enabled ones a money limit cannot count (`reason`: `unpriced`, or `currency` with the model's `modelCurrency`), each with the `code` a run on it is refused with and `blocked` - for whom: `everyone`, `some` (only members with a money limit of their own), `none`. **`unpriced`** says the same for the list as a whole, ready to show: `moneyLimited` (who is under a money limit at all: `everyone` when the team or the member default has one, `some`, `none`), `blockUnpriced`, `blocked`, and `effect`:
  - `refused` - runs on these models are refused for those people until the model has a price in `currency`;
  - `runs_only` - `blockUnpriced` is off: they run, count as runs and as no money (they become `uncounted`);
  - `none` - nobody is under a money limit: nothing depends on these prices.

| Method | Path | Who | Body | Response |
| --- | --- | --- | --- | --- |
| GET | `/api/teams/:id/limits[?members=1]` | any member | | The object above, as far as the caller may see it. Also part of the team detail (without `members`, `cannotRun`, `uncountable`, `unpriced`). |
| PUT | `/api/teams/:id/limits` | owner (`limits:manage`) | `{ team?: { runs?, amount? }, memberDefault?: { runs?, amount? }, currency?, blockUnpriced? }` | The same object. A number sets a limit, `null` removes it; `runs` is a whole number. Takes effect on the next run. |
| PATCH | `/api/teams/:id/members/:userId` | owner | `{ limits: { runs?, amount? } }` | One member's own limits; `null` = follow `memberDefault`. |

`GET /api/teams/:id/members` (with `usage:view_all`) carries the same per member: `usage: { runs, amount, uncounted, currency, breakdown }`, `limits: { runs, amount, custom }` and `effective`. `GET /api/teams/:id/usage?limits=1` carries the whole object as `limits` next to the usage of the asked range (see [Usage in a team](#usage-in-a-team)).

The rules:

- **The month** is the calendar month in the team's time zone (`timezone`, an IANA name set when the team is created; `UTC` unless one was given). It begins at 00:00 on the 1st there (`startsAt`); `resetsAt` is the instant the current one ends, `resetsAtLocal` the same instant as people in that time zone read it. A run counts in the month it was submitted in; changing the time zone moves the boundary for runs submitted from then on.
- **Money**, per run:
  - *in progress*: what was **reserved** when the run was accepted - the estimate from the model's price (`POST /api/runs/estimate`);
  - *succeeded*: the cost the run recorded (`cost.amount`) - the same estimate;
  - **chat models priced per token** are the exception, because their cost is known only at the end. While such a run is in progress it holds a **reserve**: the price of its input as estimated from what is sent (one token per character of prompt and system prompt, 1500 per picture, 20000 per video) plus the price of the longest answer assumed - the model's own `maxOutputTokens` when its spec states one, else **8192** output tokens (`BUDGET_CHAT_RESERVE_OUTPUT_TOKENS` in the environment changes that). When the run is done the reserve is replaced by the cost worked out from the reported token usage, up or down. So a money limit is not silently passed by chat runs in flight: a chat run is refused when its reserve does not fit. When the upstream reports no usage, the run ends up as a run of unknown cost (`uncounted`).
  - What becomes of a chat run's reserve: **succeeded** - replaced by the real cost; **failed** or **canceled** - given back in full, like any other run's place and money; **succeeded but the upstream reported no token usage** - given back, and the run is a run of unknown cost (it counts as a run and as 0 money, `uncounted`); **the reserve does not fit** into what is left - refused up front with `budget.member_amount` / `budget.team_amount` and `requestedKind: "reserve"`, although the real cost would usually be a fraction of it. A team that wants chat runs to fit more tightly lowers `BUDGET_CHAT_RESERVE_OUTPUT_TOKENS` or gives its chat models a `maxOutputTokens`.
  - It is counted in **one currency**, `currency` (default `CNY`): cost in another currency, and unknown cost, is not money as far as a limit goes.
- **At a limit a new run is refused** with HTTP `403` and one of the codes below. A run is admitted when, for every limit that is set, `used < limit` and `used + this run <= limit`. Runs already queued or running are never touched. Runs are checked before money, and within each the member's limit before the team's.
- **Unpriced models.** With a money limit set (the team's or the member's) and `blockUnpriced` on - the default - a model whose cost cannot be counted is refused: `budget.unpriced_model` (no price), `budget.currency_mismatch` (priced in another currency). The owner can switch `blockUnpriced` off; such runs then count as runs only.
- Limits apply to everybody in the team, the owner included. They do not touch anybody's personal space.
- **Limits are exact**, whatever arrives at the same moment and however many server processes share the database: admitting a run is one atomic, conditional update of the team's counter for the month, which holds the team's total and every member's count. Of a burst of submissions exactly as many are admitted as fit. That counter is a cache of the run records and is rebuilt from them whenever it is missing or a reading finds it disagreeing with them, so the numbers shown and the numbers enforced are the same. **A refusal never rests on a counter that is wrong**: before a run is refused at a limit the counter is compared with the records (at most once per team in 30 seconds and process) and, when it was rebuilt, the run is tried again.
- The estimate is only as good as the prices the team entered; the upstream's bill is what is actually charged.

Refusals. All six are HTTP `403`; `message` is a full sentence with the numbers in the reader's language, and `data` carries everything a client needs for a message of its own:

| `code` | When | `data` |
| --- | --- | --- |
| `budget.member_runs` | The caller's run limit for the month is used up. | limit data, `scope: "member"`, `unit: "runs"` |
| `budget.team_runs` | The team's is. | limit data, `scope: "team"`, `unit: "runs"` |
| `budget.member_amount` | This run does not fit into the caller's money limit. | limit data, `scope: "member"`, `unit: "amount"` |
| `budget.team_amount` | It does not fit into the team's. | limit data, `scope: "team"`, `unit: "amount"` |
| `budget.unpriced_model` | A money limit is set and the model has no price. | price data, `reason: "unpriced"` |
| `budget.currency_mismatch` | A money limit is set and the model is priced in another currency than the team's. | price data, `reason: "currency"` |

```json
{ "result": -1, "code": "budget.team_amount",
  "message": "This run (estimated at 0.5 CNY) does not fit into the team's amount limit for this month: 499.8 / 500 CNY are used. The count starts again on 2026-11-01 00:00 (Asia/Shanghai). Only the team owner (linzhou) can raise the limit",
  "data": { "scope": "team", "unit": "amount", "limit": 500, "used": 499.8, "remaining": 0.2, "requested": 0.5, "requestedKind": "estimate", "currency": "CNY",
            "month": "2026-10", "timezone": "Asia/Shanghai", "resetsAt": "2026-10-31T16:00:00.000Z", "resetsAtLocal": "2026-11-01 00:00 (Asia/Shanghai)",
            "canChange": { "roles": ["owner"], "owner": { "id": "670e…b2", "name": "linzhou" }, "admins": [] } } }
```

- **Limit data** (the four `*_runs` / `*_amount` codes): `scope` (`member` \| `team`: whose limit), `unit` (`runs` \| `amount`), `limit`, `used`, `remaining`, `requested` (what this run asks for: `1` run, or its money) and `requestedKind` (what that number is: `run`, `estimate` - the run's estimated cost -, `reserve` - what a chat run priced per token holds until its real cost is known -, or `none` - a run whose cost cannot be counted, refused because the money limit is used up), `currency` (`""` for runs), `month`, `timezone`, `resetsAt` (ISO instant: the start of the next month in the team's time zone), `resetsAtLocal`, and `canChange`: `roles` is `["owner"]` - limits are the owner's to set - with the `owner` as `{ id, name }`.
- **Price data** (`budget.unpriced_model`, `budget.currency_mismatch`): `scope`, `unit: "amount"` and `limit` name the money limit that makes prices matter (the member's when they have one, else the team's); `reason`; `model: { id, label }`; `modelCurrency` (`""` when there is no price); `currency` (the limit's); `month`, `timezone`, `resetsAt`, `resetsAtLocal`; and `canChange`: `roles` is `["owner", "admin"]` - whoever manages providers can enter a price - with `owner` and `admins: [{ id, name }]`.

One more answer can come from this check and is not a limit: `503 budget.busy` - six attempts in a row were overtaken by other changes to the counter. It does not happen in practice; a client simply tries again.

A client shows the warning at 80% from `effective.*.state === "near"`; the server sends no notification.

#### Usage in a team

`GET /api/admin/usage` and `GET /api/admin/usage/records` with `X-Space: <team id>` - or, identically, `GET /api/teams/:id/usage` and `GET /api/teams/:id/usage/records` - report the team's runs:

- **Whose records.** The owner - and admins once the owner switched `adminsSeeAll` on - get everybody's and may filter with `?member=<account id>`. Everybody else gets their own records only: `member` is ignored for them, whatever it asks for. The answer says which with `"scope": "all" | "own"`.
- `groupBy=member` (teams only) gives one row per member: `key` is the account id, `member` a Person, `label` their name.
- **`limits=1`** (teams only) adds `limits`: the object of [`GET /api/teams/:id/limits`](#monthly-limits) for the current month (with `members` when `groupBy=member`). One call, one way of counting: show the usage of the range from `totals` / `items` and everything about the limits - `used`, the bar, the breakdown - from `limits`.
- Every row carries what the limits count, by the same definition: `succeeded`, `inProgress`, `counted.runs` (= `succeeded` + `inProgress`), and `reserved` - the money the runs in progress hold, per currency. For a range that is the current month, `totals.counted.runs` equals `limits.team.runs.used` and `totals.costs[C] + totals.reserved[C]` equals `limits.team.amount.used` (`C` = the limits' currency). `runs` stays what it was: every record of the range, failed and canceled included - it is a count of records, not of what counts.
- `tz` defaults to the team's time zone.
- Each record carries `createdBy` (Person) and everything else a [record](#usage) carries. One record in full - the whole prompt and text answer - is `GET /api/teams/:id/usage/records/:recordId` (the same as `GET /api/admin/usage/records/:recordId` with `X-Space`); a record the caller may not list is `404 run.not_found` there too.
- `POST /api/runs/download-zip` with `X-Space: <team id>` packs the results of several records into one zip, under the same rule: only records the caller may list.
- `DELETE /api/admin/usage/records` in a team is the owner's alone (`limits:manage`), and never removes records of the current month - the limits are counted from them: `400 usage.current_month` when `before` reaches into it.

There is no CSV endpoint; the usage page builds its export from these answers.

### Assets, brand kits, templates and share links in a team

- **Assets** (`/api/user-asset`): the team's library. Every member sees, uses and adds to it; each edits or deletes what they added, the owner and admins anything (`asset:manage_all`). Every member may create a folder; an **empty** folder is deleted by the owner, an admin or the member who created it, and only the owner and admins dissolve a folder that still holds assets (see [User assets](#user-assets--apiuser-asset)). Each asset carries `scope` (`"team"` | `"personal"`), `mine`, `canManage`, `uploaderName` and `createdBy` (Person, `null` in a personal space); the list carries `isTeamManager`. `POST /api/user-asset/:id/copy { toSpace }` copies an asset into another space the caller is in, duplicating its file: `{ id, spaceId, mediaUrl, thumbnailUrl }` (same rules and errors as copying a canvas). `GET /api/spaces/copy-targets` says ahead of time where a canvas or an asset can be copied to, and why not (see [Copy targets](#copy-targets)). A personal asset is not visible in a team until it is copied there.
- **Brand kits** (`/api/brand-kits`): every member can list and choose them; creating, changing and deleting is the owner's and admins' (`brandkit:manage`). Each kit carries `shared` (`true` in a team), `mine` and `canManage`.
- **Templates and prompt snippets** (`/api/canvas/templates`, `/api/canvas/text-templates`): the built-in ones plus those saved in the space. New: `POST /api/canvas/templates { title, description?, cover?, graph: { nodes, edges, viewport?, group? } }` → the template (its `key` is generated), `DELETE /api/canvas/templates/:key`, `POST /api/canvas/text-templates { title, content, category?, lang? }`, `DELETE /api/canvas/text-templates/:id`. Every member may save one; each deletes their own, the owner and admins anybody's; built-in ones cannot be deleted (`404 template.not_found`). At most 200 saved templates and 200 snippets per space (`template.max`). Every entry carries `builtin` and `canDelete`, and says whose it is: `createdBy` (the [Person](#members) who saved it - still named after they left the team; `null` for a built-in entry), `mine` and `createdAt` (`null` for a built-in entry). These endpoints work in a personal space as well, where `createdBy` is the caller.
- **Tools and uploads** (`/api/canvas/tool/*`, `/api/files/*`): any member; the files are stored under the team.
- **Share links** (`/api/canvas-share`): whoever may edit a canvas may publish it (`share:create`; with `publicShare: "managers"` only the owner and admins). One link per canvas: publishing again refreshes it, whoever does it. `mine` and `plaza` list all of the team's links for the owner and admins, and for a member the links they created; in a team each entry has `createdBy` (Person). A member can change and revoke their own links, the owner and admins any (`share:manage_all`); somebody else's link is `404 share.not_found` to a member. A link keeps working after its publisher left the team, until it is revoked. `POST /api/canvas-share/:token/copy` puts the copy into the space the request acts in (`private` in a team). **A public link is public**: whoever has it sees the snapshot without signing in.

### The activity log

A team's record of management actions - who did what, when. Not of everyday work: saving a canvas or running a model is not in it. It never contains a key, an address or a prompt. Entries cannot be changed or removed through the API; they are dropped when they are older than `teamActivityDays` (default 365; `0` = keep for ever).

`GET /api/teams/:id/activity?category&actor&from&to&page&pageSize[&tz]` - owner and admins (`activity:view`). Newest first; `pageSize` up to 200, default 50; `from` / `to` as for usage, in the team's time zone by default.

```json
{ "list": [
    { "id": "6715…", "type": "limits:member_changed", "category": "limits",
      "actor": { "id": "670e…b2", "username": "linzhou", "name": "Lin Zhou", "state": "active", "left": false, "deleted": false, "system": false },
      "target": { "type": "member", "id": "670f…11", "name": "Zhou Yu", "person": Person },
      "detail": { "before": { "runs": 200, "amount": null }, "after": { "runs": 400, "amount": null } },
      "message": "Lin Zhou changed the monthly limits of Zhou Yu", "createdAt": "…" } ],
  "categories": ["member", "invite", "provider", "limits", "canvas", "share", "team"],
  "total": 1, "page": 1, "pageSize": 50 }
```

An entry is `type` + `actor` + `target` + `detail`: enough for a client to write its own sentence in its own words. `message` is the server's sentence in the reader's language (`X-Locale`) - the fallback for a `type` the client does not know.

- **`actor`** is a [Person](#members) plus `system`. The people of an entry are shown **as they are in the team today**: `name` is the display name the person has in the team now (not the username, and not what it was when it happened), `state` says whether they are still in it. When the site's super admin acted from outside the team, `actor` is `{ "id": "", "username": "", "name": "The super admin", "state": "active", "system": true }` (`name` in the reader's language).
- **`target`** is what was acted on - `{ type, id, name }` with `type` one of `member`, `team`, `provider`, `model`, `canvas`, `share`, `invite` - or `null`. For `type: "member"` it also carries `person` (a Person) and `name` is that person's name today. For everything else `name` is the name at the time (`""` for an invite link).
- **`detail`** is what changed, per type, in the table below. Its shape is a contract: fields are added, never renamed. **Every field is optional**: entries written before a field existed do not have it (`detail` may be `{}`), and such an entry is rendered from `type`, `actor` and `target` alone, or with `message`. Where `detail` names an account (`fromId`, `inviterId`, `createdById`) the name next to it (`fromName`, `inviterName`, `createdByName`) is that person's name today when they are still known, else the name at the time. `detail` never holds a key, an address or a prompt.

| `category` | `type` | `target` | `detail` |
| --- | --- | --- | --- |
| `member` | `member:joined` | the member (also the actor) | `inviterId`, `inviterName`: whose invite link was used; `invitationId` |
| `member` | `member:left` | the member (also the actor) | `role` (`"admin"` \| `"member"`: what they were), `canvasesInherited`, `runsCanceled` (numbers) |
| `member` | `member:removed` | the member | `role`, `canvasesInherited`, `runsCanceled`, `wasAdmin` (boolean), `accountDeleted` (boolean: their account was deleted, by the super admin - the actor is then the super admin) |
| `member` | `member:promoted`, `member:demoted` | the member | `from`, `to`: the role before and after (`"member"` \| `"admin"`) |
| `member` | `member:renamed` | the member | `from`, `to`: the display name before and after (`""` = none, the username is shown); `username` |
| `member` | `team:transferred`, `team:owner_appointed` | the new owner | `fromId`, `fromName`: the owner before. `owner_appointed`: by the super admin |
| `invite` | `invite:created` | the link (`name: ""`) | `maxUses` (0 = unlimited), `expiresAt`, `expiresInDays` |
| `invite` | `invite:revoked` | the link | `maxUses`, `usedCount`, `expiresAt`: the link as it was; `createdById`, `createdByName`: who had created it |
| `provider` | `provider:created` | the provider | `vendor`, `enabled` |
| `provider` | `provider:deleted` | the provider | `vendor` |
| `provider` | `provider:key_changed` | the provider | `cleared` (boolean: the key was removed, not replaced). Never the key |
| `provider` | `provider:url_changed` | the provider | `custom` (boolean: it now uses an address other than the vendor's own). Never the address |
| `provider` | `provider:updated` | the provider | `enabled` (present when it was switched: the new state); `renamed: true` with `from`, `to` (present when the name changed) |
| `provider` | `provider:model_added` | the provider | `model`, `kind` (`image` \| `video` \| `chat`) |
| `provider` | `provider:model_removed` | the provider | `model` |
| `provider` | `model:enabled`, `model:disabled` | the model (`id` = model id) | |
| `provider` | `model:price_changed` | the model | `priced` (boolean: it has a price now); `before`, `after`: a price summary, or `null` for "no price" - see below |
| `limits` | `limits:team_changed` | the team | `before`, `after`: `{ team: { runs, amount }, memberDefault: { runs, amount }, currency, blockUnpriced }`; `null` = no limit |
| `limits` | `limits:member_changed` | the member | `before`, `after`: `{ runs, amount }` - the member's own limits; `null` = follows the team's default |
| `limits` | `usage:records_deleted` | `null` | `deleted` (number), `before` (the date asked for) |
| `canvas` | `canvas:deleted`, `canvas:restored` | the canvas | |
| `canvas` | `canvas:visibility_changed` | the canvas | `from`, `to`: `private` \| `team_view` \| `team_edit` |
| `canvas` | `canvas:taken_over` | the canvas | `fromId`, `fromName`: whose edit lock was taken |
| `canvas` | `canvas:overwritten` | the canvas | `revision`: the revision the overwrite produced |
| `share` | `share:created` | the share link (`name` = its title) | `expiresAt` (`null` = never) |
| `share` | `share:revoked` | the share link | `expiresAt` |
| `team` | `team:created`, `team:restored`, `team:suspended`, `team:resumed` | the team | |
| `team` | `team:renamed` | the team | `from`, `to`: the name before and after |
| `team` | `team:avatar_changed` | the team | `removed` (boolean: the avatar was taken away, not replaced) |
| `team` | `team:settings_changed` | the team | `changed`: the names of what changed (`timezone` or a [setting](#team-settings)); `before`, `after`: objects with the value of each of those before and after |
| `team` | `team:dissolved` | the team | `purgeAt` |

A price summary (`model:price_changed`): `{ unit, currency, price, by, tiers, min, max, input, output }` - `price` is the one price, or `null` when the price depends on something; then `by` says on what (`resolution`, `duration`, `resolution_duration`; `""` for per-token prices with separate rates), `tiers` how many prices the table has, `min` / `max` the lowest and highest of them, and `input` / `output` the per-million-token rates of a per-token price.

### Teams and the super admin

Super admin only (`403 auth.forbidden` for anybody else). The super admin manages that teams exist and how large they may be - not what is in them: nothing here returns a canvas, a key, a prompt or a file of a team, only names and numbers. The super admin enters a team's space only as a member of it, like anybody else.

**Authorisation to create teams.** `PATCH /api/admin/users/:id` now takes `{ disabled?, canCreateTeams? }` (at least one). `canCreateTeams: false` takes the authorisation back: no new teams, the existing ones stay. Each row of `GET /api/admin/users` gains `canCreateTeams` (`true` also for the super admin) and `teams: { member, owned }`; `counts` stays what is in the account's personal space.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/team-requests` | `?status=pending` (default) `\| approved \| rejected \| all`, `page`, `pageSize` | `{ list, total, pending, page, pageSize }`; each entry: the request (`id`, `status`, `note`, `reason`, `createdAt`, `decidedAt`) plus `user: { id, username, email, disabled, canCreateTeams }`. `pending` is the number waiting, whatever the filter. |
| POST | `/api/admin/team-requests/:id/approve` | | The request. Grants the account the authorisation. |
| POST | `/api/admin/team-requests/:id/reject` | `{ reason? }` | The request. The account sees the reason and may ask again. A request that is already decided: `404 team.request_not_found`. |
| GET | `/api/admin/teams` | | `{ teams: AdminTeam[], defaults: { teamMaxPerUser, teamMaxMembers, teamConcurrency, teamActivityDays } }` |
| PATCH | `/api/admin/teams/:id` | `{ maxMembers?: 1-1000 \| null, concurrency?: 1-32 \| null, status?: "suspended" \| "active" }` | The AdminTeam. `null` goes back to the site default. |
| GET | `/api/admin/teams/:id/members` | | `[{ id, username, role, disabled }]` - to choose a new owner from. |
| POST | `/api/admin/teams/:id/owner` | `{ userId }` | The AdminTeam. |
| POST | `/api/admin/teams/:id/restore` | | The AdminTeam. Undoes a dissolution within its 7 days. |
| DELETE | `/api/admin/teams/:id?confirm=<team name>` | | `{ id, name, counts, filesRemoved, removed, files }` - see below. |

```json
{ "id": "6712…a0", "name": "Starlight Studio", "avatar": "/files/uploads/2026/10/….png", "status": "active",
  "owner": { "id": "670e…b2", "username": "linzhou", "usable": true },
  "counts": { "members": 7, "workflows": 41, "runs": 804 },
  "maxMembers": null, "concurrency": null, "effective": { "maxMembers": 50, "concurrency": 4 },
  "dissolvedAt": null, "purgeAt": null, "createdAt": "…" }
```

- **Suspending** (`status: "suspended"`) closes a team for everybody, the owner included (`403 team.suspended`): queued runs are canceled, share and invite links stop, locks are released. Nothing is removed, and there is no time limit; `status: "active"` opens it again. A dissolved team is restored with `/restore`, not with `status` (`409 team.is_dissolved`).
- **Appointing an owner** is possible only while the current owner's account cannot be used - disabled, or gone (`owner.usable: false`); otherwise `409 team.owner_usable`: a usable owner hands the team over themselves. The new owner has to be a member of the team with a usable account (`404 team.member_not_found`, `409 team.new_owner_unusable`); the old owner becomes an admin.
- `avatar` in the AdminTeam is the team's avatar address, `""` when it has none (draw the initial of the name then).
- **Removing a team for good** needs it to be closed first - suspended or dissolved (`409 team.still_active`) - and its exact name in `confirm` (`400 team.confirm_mismatch`). It deletes everything the hourly job would delete after the 7 days, at once. The answer says what went: `counts` has every kind by name, `0` when there was none - `{ members, invitations, activity, canvases, shares, assets, assetFolders, brandKits, providers, modelOverrides, runs, templates, textTemplates, files }` - numbers only, as everywhere for the super admin. `filesRemoved: false` means the documents are gone but not every file is yet: what a storage could not give up in time is removed in the background and tried again until it is gone (the server's log says where files are left; see [Storage](storage.md#when-a-storage-cannot-be-reached)). `removed` (per collection, absent when 0) and `files` are the older form of the same numbers. A team that is no longer there is `404 team.not_found`.
- **Disabling an account** leaves its teams and memberships as they are; members see `disabled: true` next to it. The edit locks it held on team canvases are given back at once. The runs it had waiting in a queue are canceled, as for a removed member (`runsCanceled` in the answer of `PATCH /api/admin/users/:id`), and each says why (`errorCode: "run.canceled_account_disabled"`, `error`: "Canceled while it was waiting: the super admin disabled the account that started it"); one that was submitted in the same instant fails with `run.account_disabled` instead of being sent; a run that already started finishes; nothing new is accepted from the account (`401`). The places these runs held of the team's monthly limits are given back. A team that is dissolved or suspended cancels its waiting runs the same way (`run.canceled_team_closed`; one picked up in the same instant fails with `run.team_closed`). A team whose owner is disabled keeps working; nobody can manage it until the account is enabled again or a new owner is appointed.
- **Deleting an account** (`DELETE /api/admin/users/:id`) is refused while it owns a team - active, suspended or dissolved: `409 team.account_owns_teams` (the message names them). Hand the team over (or appoint a new owner), or remove the team, first. Otherwise the account leaves every team it is in, exactly as if it had been removed from each, and only its personal space is deleted: what it made in a team stays there, shown with `createdBy.state: "deleted"` and the name it went by.

Site settings for teams (`PUT /api/admin/settings`): `teamMaxPerUser` (default 3, 1-100), `teamMaxMembers` (default 50, 1-1000), `teamConcurrency` (default 4, 1-32), `teamActivityDays` (default 365, 0-3650; 0 = keep for ever).

### What a client has to do

The flows that are not obvious from the endpoints:

1. **Choosing the space.** Keep the current space in the page address (a team's pages carry the team id) and send it as `X-Space` with every content request; send nothing, or `personal`, for the personal space. Load `GET /api/bootstrap` with the header to get `space.role`, `space.permissions` and `space.settings`. Never send `X-Space` to another origin.
2. **A space that is gone.** On `team.not_found`, `team.dissolved` or `team.suspended` from any call (or `spaceError` in the bootstrap): leave the team's pages, fall back to the personal space, say why. This is also how somebody learns they were removed while a canvas was open.
3. **Opening a team canvas.** Make up one random `sessionId` per editor tab and keep it in memory for as long as the tab lives (not in `localStorage`: two tabs must not share it). `GET /api/workflow/:id?sessionId=…`. When `access.canEdit` is `false`: read-only, no lock call. When the answer already shows a `lock` that is not `mine`: read-only as for a 423 below, no lock call needed. Otherwise `POST .../lock { sessionId }`. `200`: edit, remember `lock.releaseToken`, and start the heartbeat - `POST .../lock { sessionId }` every `heartbeatMs` from the answer. `423`: read-only, with a bar that says who - "`data.lock.by.name` is editing", or, when `data.lock.sameUser`, "you have this canvas open in another tab"; offer **Take over** when `data.canTakeOver` (`{ sessionId, takeover: true }`) and **Duplicate**. In read-only mode no content is saved and nothing is run - but the name can still be changed by whoever may edit (8).
   **While read-only**, and while the tab is visible, ask `GET .../lock` every `pollMs`: `lock: null` means the canvas is free - offer **Start editing** (a `POST .../lock`; do not take it silently); a `metaRevision` that moved means a new `name`; a `revision` that moved means the holder saved - load the canvas again to show it; `canEdit` says whether the caller's rights changed.
4. **Leaving the editor.** Inside the app: `DELETE .../lock?sessionId=…` and stop the heartbeat. When the page itself goes away (`pagehide`): `navigator.sendBeacon('/api/workflow/<id>/lock/release', JSON.stringify({ releaseToken }))` - the only call a closing page can be relied on to send. Without either the lock runs out by itself after `ttlMs` (36 seconds).
5. **Heartbeats, and a tab in the background.** Each heartbeat answer carries `name` and `metaRevision`: when `metaRevision` moved, show the new `name` (the canvas was renamed elsewhere); and take `lock.releaseToken` from it. On `visibilitychange` to hidden: save what is unsaved (the timers of a hidden tab are throttled, and when the tab is being closed this is the last moment a save can still be sent). On `visibilitychange` to visible: send a heartbeat at once instead of waiting for the timer - `200` with `state: "reacquired"` means the lock had run out and nobody took the canvas: carry on; `423` means somebody did. After any `200`, compare `revision` with the one the editor is based on: when it moved, somebody edited in between - load again (or keep unsaved changes and let the next save report the conflict).
6. **Losing the lock.** A heartbeat or a save answering `423`: switch to read-only at once, say why from `data.lost` and `data.lock` - `"taken_over"`: "`by.name` took over the editing"; `"expired"`: "this tab stopped holding the canvas and `by.name` is editing now"; `sameUser`: "…in another tab of yours" - and offer to save what was not saved yet **as a copy** (`POST /api/workflow` with the editor's current document and `visibility: "private"`). Do not retry the save.
7. **Saving.** One content save in flight at a time; send `sessionId` and `baseRevision` = the `revision` of the last answer (from `GET`, `PUT` or `lock`); take the new `revision` from the answer. Queue or coalesce edits made while a save is in flight. Do not send `name` with content saves.
8. **Renaming.** `PATCH /api/workflow/:id/meta { name }` - from the list and from the editor's title alike, whoever holds the lock, also from an editor that is read-only because somebody else is editing. No `baseRevision`, no lock, never a conflict. Hide it from those without `access.canEdit`, and say why.
   **A canvas list** asks `GET /api/workflow/locks?since=…` every `pollMs` while it is visible and replaces only the cards that changed: who is editing (`locks`), other people's renames and new, saved or restored canvases (`changed`), deleted ones (`removed`). It loads the list again only when `counts` disagrees with what it holds (somebody changed a visibility) or the answer says `reload`.
9. **A conflict** (`409 canvas.conflict`): stop auto-saving and ask, with `data.lastEditedBy.name` and `data.lastEditedAt`: **Load the latest version** (`GET`, discard mine), **Save mine as a copy** (the default; `POST /api/workflow`), and - only when `data.canOverwrite` - **Overwrite with mine** (repeat the `PUT` with `"force": true`).
10. **An invite link opened while signed out.** `GET /api/team-invitations/:token` works without a session: show the team and the inviter. Keep the token, send the visitor to sign in - or to register, only when `registrationOpen` is `true`; when it is `false` say that this site does not take new accounts at the moment - then come back and `POST .../accept`. When `state` is not `valid`, show the reason instead of a join button. After joining, switch to the team's space (`team.id`).
11. **Creating a team.** Show "Create team" only when `teams.canCreate`. When `teams.authorised` is `false`: offer **Request authorisation** (`POST /api/teams/creation-request`); while `request.status` is `pending` say so and offer to withdraw; when `rejected`, show `request.reason` and allow asking again; when `authorised` but `held >= max`, say that the limit of teams is reached. Send the browser's time zone as `timezone` when creating.
12. **Members of a team** see providers read-only: no key, no address, no "Test", no "Edit" (`restricted: true`, `permissions["provider:manage"]: false`). Hide what `permissions` and `access` say the caller cannot do, rather than letting them run into `403`.
13. **Limits.** Show `limits.member` (and `limits.team` when present) with the reset date (`resetsAt`), taking the state from `effective` (`ok`, `near`, `reached`, `unlimited`) rather than working it out; next to "used", show the `breakdown` (succeeded, in progress; failed and canceled do not count) and `uncounted` runs of unknown cost. Take the usage figures shown beside a limit from the same answer (`GET .../usage?limits=1`), never from a second way of counting. On a `budget.*` refusal show `message` - a full sentence with the numbers, the reset time and who can change it - or build your own from `data`; show it where the run was started and leave it there until the person has read it (not a toast). Before a run is started, `limits.member.effective.blockedBy` says whether it would be refused at a limit, and `cannotRun.models` (with `managers`) which models the caller cannot run for want of a price: mark those in the model picker and next to the run button instead of deriving it from prices. With a money limit set, show the owner and admins `unpriced.effect` and the `uncountable` models next to it. A run with `status: "canceled"` and an `errorCode` other than `run.canceled` was not canceled by a person: show its `error`.
14. **Removing an admin.** When the answer's `keysSet` is not empty, tell the owner which providers' keys that person entered and that they should be replaced at the upstream.
15. **Dangerous actions** (dissolve, hand over; for the super admin: delete a team) take the team's exact name as confirmation.
16. **People who are gone.** Read `state` of every Person: `left` → "left the team", `deleted` → "account deleted", next to the name that is still there. Do not treat the two alike, and do not hide what they made.
17. **The activity log.** Write the sentence from `type`, `actor`, `target` and `detail` (before → after for limits, roles, names, settings, prices); use `message` for a `type` you do not know, and expect any `detail` field to be missing on old entries.
18. **Copying to another space.** Ask `GET /api/spaces/copy-targets` and list every target; show an unavailable one disabled with its `message` instead of leaving it out.

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
| 404, empty body | Unknown key, or the file is on none of the readable backends and every one of them answered. |
| 416 | The requested range cannot be satisfied. |
| 503, `{ "result": -1, "code": "storage.unreachable", "message": "…", "data": null }` | The file was found nowhere, and a storage that might hold it could not be asked (unreachable, credential refused, or its saved secret cannot be decrypted), so the file may exist. Sent with `Retry-After: 30` and `Cache-Control: no-store`; the message is in the language of the request and names no host or bucket. A file on the local disk or in the bucket in use is never answered this way because of another bucket. See [Storage](storage.md#when-a-storage-cannot-be-reached). |

---

## Models and runs

### GET /api/models

Query: `kind` (optional) = `image` | `video` | `chat`.

Response: an array of ModelSpec, for the enabled models of the enabled providers of the space the request acts in.

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

`providerType` is the vendor id (`gaorui`, `openai` or `gemini`). `id` is `<provider slug>:<upstream model>`. Model ids are per space: a slug is unique among the providers of one space (an account's personal space, or a team), not across the instance, so `gaorui:nano-banana-2` in one space has nothing to do with the same id in another. `custom` is `true` for a model the user added by hand and `false` for a model from the vendor's catalog. `options` may contain `aspectRatios`, `resolutions`, `durations`, `counts` and `imgModes`. `desc`, `tag` and `pricing` are optional; a custom model has no `desc`. The `pricing` in the example is a placeholder: no prices are shipped, and the field is only present once one has been entered for the space. `imageByUrlOnly: true` is present on models whose reference images are handed over as public URLs only. See [Writing a provider](writing-a-provider.md#modelspec-reference).

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
| `model` | Required. A model id from `/api/models`, that is, of one of the providers of the space the request acts in. Must not be a chat model. |
| `prompt` | String, up to 20,000 characters. |
| `imageUrls` | Up to 16 URLs, each `http(s)://…` or `/files/…` (no `data:` URIs). Cut down to what the model accepts. |
| `videoUrls` | Up to 4 URLs; one is used, and only by models that accept video. |
| `params` | Flat object of short strings, numbers and booleans. Merged over the model's defaults. `count` is clamped to 1–8. |
| `workflowId`, `nodeId` | Optional, for attribution in usage records. |

Response: `{ "runId": string }`. The run is queued; poll it. It belongs to the space the request acts in and is executed with that space's provider and key - the caller's own in a personal space, the team's with `X-Space` - also when it is resumed after a restart. In a team it is also checked against the [monthly limits](#monthly-limits) (`403 budget.*`).

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
| `canceled` | Canceled. `errorCode` says how: `run.canceled` when a person canceled it; `run.canceled_member_removed`, `run.canceled_account_disabled` or `run.canceled_team_closed` when it was canceled while it waited in the queue (see [Members](#members) and [Teams and the super admin](#teams-and-the-super-admin)). |

Errors: `run.not_found` (404), also for a run of another space. Chat runs are not returned here; use `/api/llm/tasks/:id`.

When the server stops, nothing is sent to an upstream twice. A run that already has an upstream task, or for which nothing was sent yet, goes back to `queued` and continues after the restart. A run whose request was sent but has no upstream task id (every run of a synchronous provider, every chat run) ends as `failed` with `run.interrupted`.

### POST /api/runs/status

Batch polling. Body: `{ "ids": string[] }`, up to 100. Response: an array of Run in the order requested; unknown ids, and ids of another space's runs, are simply absent.

### POST /api/runs/:id/cancel

Cancels a queued or running run (image, video or chat). Response: the Run after cancellation. If it had already finished, the Run is returned unchanged with the message `run.already_finished`.

### POST /api/runs/download-zip

The results of several history records as **one zip**, streamed.

```json
{ "ids": ["6660…", "6661…"], "urls": ["/files/outputs/2026/10/….png"], "name": "October picks" }
```

| Field | Meaning |
| --- | --- |
| `ids` | Record (run) ids, 1 to 100. The archive follows their order. |
| `urls` | Optional, at most 2000. Narrows the files down to these addresses (one result out of four, say). It can only narrow: an address that is not a result of one of the records adds nothing. With `urls`, text answers are left out. |
| `name` | Optional name of the archive, without `.zip`. Default `history-<yyyymmdd-hhmmss>` (UTC). |

What goes in comes from the stored records, never from the request: the files of image and video runs, and the text answer of each chat run as a `.txt` file. Only **succeeded** runs of the space the request acts in that the caller may read count - all of them in a personal space and with `usage:view_all` in a team, the caller's own for every other team member; an id that is not one of those is skipped, not an error.

Entries are named `<nn>-<model>-<yyyymmdd-hhmmss>[-<k>].<ext>` - `nn` the position in `ids`, `model` the upstream model name, the time the run was created (UTC), `k` when one run has several files - for example `01-nano-banana-2-20261012-081502.png`, `02-gpt-4o-20261012-081730.txt`. Every name is a single path segment (no separators, nothing a file system refuses) and unique within the archive. Files are stored uncompressed.

The response is `application/zip` with `Content-Disposition: attachment` (the name is in `filename*=UTF-8''…`). Limits: at most 100 files in one archive, 1 GiB per file, 4 GiB in all, 10 minutes, and 3 archives being written for one account at the same time. Files are read from this server's storage or, for an address elsewhere, through the same SSRF guard as `POST /api/workflow/download`, one at a time.

- A file that cannot be **opened** (gone, unreachable) does not fail the archive: `<name>-failed.txt` takes its place, saying so in the reader's language (`<name>-skipped.txt` for a file that is too large, or would take the archive over its size).
- A file that **breaks off half way**, and the time or size budget running out in the middle of one, cut the download: the connection is closed without the end of the zip, so a client sees a failed download and never an archive that is silently short. Ask again.
- When the client goes away the server stops reading at once; nothing keeps running for a download nobody waits for.

Errors, all before the download starts: `validation.array` (`ids` or `urls` is not an array), `validation.required` (no valid id), `validation.max_items` (more than 100 ids, or more than 2000 `urls`), `run.zip_max` (the records hold more than 100 files; the message says how many) - 400; `run.nothing_to_download` (404; none of the records has a result the caller may take - also when retention has removed the files meanwhile); `run.zip_busy` (429; this account already has 3 archives being written - wait for one to finish). With `responseType: 'blob'` a refusal arrives as JSON inside the blob.

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
  "spaceId": "personal",
  "visibility": "",
  "createdBy": { "id": "670e…b2", "username": "admin", "name": "admin", "state": "active", "left": false, "deleted": false },
  "revision": 12,
  "metaRevision": 3,
  "lastEditedBy": null,
  "lastEditedAt": null,
  "lock": null,
  "access": { "canView": true, "canEdit": true, "canDelete": true, "canSetVisibility": false, "canTakeOver": false, "canOverwrite": true, "canShare": true },
  "createdAt": "…",
  "updatedAt": "…"
}
```

`spaceId` through `access` say whose canvas it is, who may do what with it and who is editing; they matter in a team and are explained in [Canvases in a team](#canvases-in-a-team). `revision` counts content saves in every space.

`legacyLayout` is `true` while the node positions date from before `schemaVersion` 2 and the editor has not yet checked them against the current node sizes: the server sets it when it migrates such a canvas (more than one node) on read, a copy of a flagged canvas carries it, and the editor clears it after its one-time check (see below). `brandKitId` is the brand kit of the canvas (`""` for none): the editor adds it to every run of the canvas's generation nodes, except for a node whose `data.brandKitOverride` holds another kit id or `"none"` (see [Brand kits](#brand-kits)). The shape of `nodes[].data` and of `settings` belongs to the frontend; the server stores them as given. Limits: 500 nodes, 2000 edges, name up to 80 characters. Every endpoint here works on the canvases of the space the request acts in: the caller's own in a personal space, the team's - as far as the caller may see them - with `X-Space`.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/workflow/list` | | Array of `{ id, name, thumbnail, thumbnailType, spaceId, visibility, createdBy, revision, metaRevision, lastEditedBy, lastEditedAt, lock, access, createdAt, updatedAt }`, newest first, at most 200. In a team: `?mine=1`, `?member=<id>`, `?visibility=…`. |
| POST | `/api/workflow` | `{ name?, nodes?, edges?, viewport?, settings?, brandKitId? }` | The new canvas. Without `brandKitId` it starts with the account's default brand kit, if there is one; send `""` for none. |
| GET | `/api/workflow/:id` | | The canvas, migrated to the current `schemaVersion` if needed. |
| PUT | `/api/workflow/:id` | Any of `name`, `nodes`, `edges`, `viewport`, `settings`, `brandKitId`, `legacyLayout`; plus `baseRevision?`, `force?`, `sessionId?` | The canvas. Only the fields sent are changed. A save of content (`nodes`, `edges`, `settings`, `brandKitId`) raises `revision`; with `baseRevision` it is refused (409 `canvas.conflict`) when the canvas has moved on, without it the last write wins - which a team space does not allow. A save of nothing but `name`, `viewport`, `legacyLayout` is a metadata save: no revision, no lock; a new name raises `metaRevision`. See [Saving and conflicts](#saving-and-conflicts). `brandKitId` must be `""` or a 24-character kit id (anything else is 400 `validation.invalid`); whose kit it is is not checked, because a kit is only ever looked up among the caller's own and any other id simply means no kit. A save that carries nothing but `viewport` and/or `legacyLayout` leaves `updatedAt` alone: panning and zooming are not edits. `legacyLayout` can only be sent as `false` (anything else is 400 `validation.invalid`); it is ignored on `POST`. |
| POST | `/api/workflow/:id/duplicate` | `{ name? }` | The copy, with the same `brandKitId` and node exceptions. Media is shared by reference, not copied. |
| DELETE | `/api/workflow/:id` | | `{ id }`. Soft delete; restorable for 30 days (`GET /api/workflow/trash`, `POST /api/workflow/:id/restore`). |
| PATCH | `/api/workflow/:id/access` | `{ visibility }` | Team canvases: who else sees or edits it. |
| PATCH | `/api/workflow/:id/meta` | `{ name?, viewport?, legacyLayout? }` | The canvas. A metadata save only (content fields: 400 `canvas.meta_only`). |
| POST, GET, DELETE | `/api/workflow/:id/lock` | `{ sessionId, takeover? }` / `?sessionId=` | Take or renew, look at, give back [the edit lock](#the-edit-lock). |
| GET | `/api/workflow/locks` | `?since=` | `{ locks: [{ id, lock }], pollMs, now, counts, changed?, removed?, reload? }`: who is editing which canvas of the space right now and, with `since`, [what moved on the list](#the-edit-lock) since then. A `since` that is not a time: 400 `validation.invalid`. |
| POST | `/api/workflow/:id/lock/release` | `{ releaseToken }` - **public** | `{ released }`. Gives the lock back from a closing page (`sendBeacon`). |
| POST | `/api/workflow/:id/copy` | `{ toSpace, name? }` | A copy in another space, files included. See [Canvases in a team](#canvases-in-a-team). |
| POST | `/api/workflow/download` | `{ url, filename? }` | The file as an attachment. Download proxy for media the browser cannot fetch itself. Only media comes back out. |
| POST | `/api/workflow/:id/download-zip` | `{ urls?: string[] }` | A zip of the canvas media. `urls` narrows the selection to URLs that are on the canvas; without it, everything. Entries are named `<nn>-<node type>.<ext>`. At most 100 items, 1 GiB per item and 4 GiB in total. A file that cannot be fetched is replaced by `<nn>-<node type>-failed.txt`, one that would take the archive over its total size by `<nn>-<node type>-skipped.txt`. |

Errors: `canvas.not_found` (404); `canvas.conflict`, `canvas.lock_busy` (409); `canvas.locked` (423); `team.forbidden` (403); `canvas.meta_only`, `common.name_required`, `canvas.max_nodes`, `canvas.max_edges`, `canvas.bad_node`, `canvas.bad_edge`, `validation.max_length`, `canvas.base_revision_required`, `canvas.personal_no_visibility` (400); for the downloads `file.not_media_url`, `fetch.*`, `canvas.zip_max` (400) and `canvas.nothing_to_download` (404).

---

## Templates and tools

Base path `/api/canvas`. The tool endpoints process images on the server; they call no model and create no run. Source images are limited to 20 MB each.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/canvas/templates` | | Array of `{ key, title, description, cover, graph: { nodes, edges, viewport }, builtin, canDelete, createdBy, mine, createdAt }`: the built-in templates, which belong to the site and are shown everywhere, plus those saved in the space the request acts in. `createdBy` is the [Person](#members) who saved it (`null`, like `createdAt`, for a built-in one); `mine`: the caller did. |
| POST | `/api/canvas/templates` | `{ title, description?, cover?, graph: { nodes, edges, viewport?, group? } }` | The saved template; its `key` is generated. Up to 200 nodes. |
| DELETE | `/api/canvas/templates/:key` | | `{ key }`. One's own; in a team also the owner and admins. Never a built-in one. |
| GET | `/api/canvas/text-templates` | `?lang=zh` or `en` (default `zh`) | Array of `{ id, title, content, category, lang, builtin, canDelete, createdBy, mine, createdAt }` - the last three as for templates. |
| POST | `/api/canvas/text-templates` | `{ title, content, category?, lang? }` | The saved snippet. |
| DELETE | `/api/canvas/text-templates/:id` | | `{ id }`. |
| POST | `/api/canvas/tool/slice` | `{ imageUrl, cols, rows }` (1–6 each, default 3) | `{ cols, rows, items: [{ key, label, url, width, height }] }` |
| POST | `/api/canvas/tool/collage` | `{ imageUrls[], cols, rows, gap, bg, ratio }` (2–64 images; cols, rows 1–4; gap 0–80) | `{ url, width, height, cols, rows, used, skipped }` |
| POST | `/api/canvas/tool/watermark` | `{ imageUrl, markUrl, position, scalePct, opacity, marginPct }` (scale 5–60, opacity 10–100, margin 0–20) | `{ url, width, height }` |
| POST | `/api/canvas/tool/fit` | `{ imageUrl, ratio, bg, format, quality, maxKb }` (format `jpg` / `png` / `webp`, otherwise automatic; quality 40–95; maxKb 0–20480, 0 = no cap) | `{ url, width, height, bytes, overLimit }` |
| POST | `/api/canvas/platform-export` | `{ imageUrl, group }` (`domestic` or `overseas`) | `{ group, items: [{ key, label, url, width, height }], whiteBg }` |

Out-of-range numbers are clamped, not rejected. Tool results and uploads are stored under the space the request acts in. Errors (400): `media.*` (the source could not be read), `tool.*`, `template.max` (200 saved templates, and 200 snippets, per space); `template.not_found` (404).

---

## Brand kits

Base path `/api/brand-kits`. A kit:

```json
{ "id": "…", "name": "Summer studio", "refImages": ["/files/…"], "promptPrefix": "", "negativePrompt": "", "defaultRatio": "", "defaultModel": "", "isDefault": false, "shared": false, "mine": true, "canManage": true, "updatedAt": "…", "usedBy": 2 }
```

A kit is applied by the editor, not by the server: when a generation node runs, the browser puts `promptPrefix` in front of the prompt, adds `negativePrompt` at the end as a "Do not include: …" line, and appends `refImages` after the node's own reference images up to the model's limit. `/api/runs` receives the finished prompt and image list and knows nothing about kits. Which kit a node uses is stored on the canvas: `brandKitId` on the canvas document, and `data.brandKitOverride` (a kit id, or `"none"`) on a node that differs. `isDefault` marks the kit a new canvas starts with. `defaultRatio` and `defaultModel` are stored and returned but not used by the editor.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/brand-kits` | | Array of kits. Each carries `usedBy`: the number of the caller's canvases that use it, as the canvas's kit or as a node's exception (the other endpoints do not return it). |
| POST | `/api/brand-kits` | `{ name, refImages?, promptPrefix?, negativePrompt?, defaultRatio?, defaultModel?, isDefault? }` | The kit. |
| PUT | `/api/brand-kits/:id` | Any of the fields above | The kit. |
| DELETE | `/api/brand-kits/:id` | | `{ id }`. Soft delete. Canvases and nodes that point at it are left as they are and run without a kit. |

Kits belong to the space. In a team every member lists and chooses them, and creating, changing and deleting is the owner's and admins' (`403 team.forbidden` otherwise); `shared` is `true` there and `canManage` says whether the caller may change the kit. Limits: 50 kits per space; `name` 40 characters; `promptPrefix` 1000; `negativePrompt` 500; 5 reference images (URLs only). Setting `isDefault` clears it on the others.

Errors: `brandKit.name_required`, `brandKit.max`, `brandKit.ref_images_max` (400); `brandKit.not_found` (404).

---

## Assets

### User assets — /api/user-asset

The library of the space the request acts in: the caller's own in a personal space; with `X-Space` the team's, which every member sees and adds to (see [Assets, brand kits, templates and share links in a team](#assets-brand-kits-templates-and-share-links-in-a-team)). `kind` is one of `product`, `brand`, `reference`, `output`. Each asset carries `scope`, `mine`, `canManage`, `uploaderName` and `createdBy`.

| Method | Path | Body / query | Response |
| --- | --- | --- | --- |
| GET | `/api/user-asset/list` | `?kind&folder&tag&search&page&pageSize` (page size up to 200, default 60) | `{ list, folders, folderList, kindCount, limit, isTeamManager, pagination: { total, page, pageSize } }` |
| POST | `/api/user-asset` | `{ mediaUrl, kind?, name?, nodeType?, thumbnailUrl?, width?, height?, aspectRatio?, folder?, tags? }` | The asset. Registers a file that is already uploaded. |
| POST | `/api/user-asset/register-output` | Same, plus `fromFlowId?`, `fromProduct?` | The asset, with `kind: "output"`. |
| POST | `/api/user-asset/folder` | `{ name }` (up to 120 characters) | `{ name, count, empty, canDelete, existed }`. Creates an empty folder. A folder of that name that is already there is answered as it is, with `existed: true`. |
| DELETE | `/api/user-asset/folder?name=<folder>` | | `{ name, deleted: true }`. Deletes an **empty** folder. |
| POST | `/api/user-asset/folder/delete` | `{ name }` | `{ moved }`. Dissolves a folder: the folder goes, its assets are kept, outside any folder. In a team: the owner and admins. |
| PUT | `/api/user-asset/:id` | Any of `name`, `folder`, `tags`, `kind` | The asset. |
| DELETE | `/api/user-asset/:id` | | `{ id }`. Soft delete; the file is kept. |
| POST | `/api/user-asset/:id/copy` | `{ toSpace: "personal" \| <team id> }` | `{ id, spaceId, mediaUrl, thumbnailUrl }`. A copy in another space, with its own copy of the file. |

`nodeType` is `IMAGE` (default) or `VIDEO`. Up to 5000 assets per kind, per space.

**Folders.** An asset says which folder it is in (`folder`, `""` = none). A folder exists from the moment it is created (`POST /folder`) or first named by an asset until it is deleted - also while nothing is in it: moving the last asset out, or deleting it, leaves an empty folder behind. `folders` lists every folder of the library by name, empty ones included; `folderList` says more about each:

```json
"folderList": [ { "name": "Spring shoot", "count": 12, "empty": false, "canDelete": false },
                { "name": "To sort", "count": 0, "empty": true, "canDelete": true } ]
```

`count` is the number of assets in the folder, of every kind (whatever the list is filtered by). `canDelete`: the folder is empty **and** the caller may delete it - in their own space always; in a team the owner, the admins, and the member who created the folder. `DELETE /folder` refuses a folder that still holds assets with `409 asset.folder_not_empty` (`data: { name, count }`; the message says how many): move or delete them first, or dissolve the folder, which keeps them. Up to 500 folders per space (`400 asset.folder_max`).

Errors: `asset.media_url_required`, `asset.bad_thumbnail`, `asset.kind_full`, `asset.folder_required`, `asset.folder_max` (400); `team.forbidden` (403; somebody else's asset, or a folder the caller may not delete); `asset.not_found`, `asset.folder_not_found` (404); `asset.folder_not_empty` (409).

### Copy targets

`GET /api/spaces/copy-targets?kind=canvas|asset[&assetKind=product|brand|reference|output]` - where something of the space the request acts in (`X-Space`) could be copied to. Every space the caller is in is listed - the personal one first, then each team in the order joined, closed teams included - and each says whether it can take the copy and, when not, why:

```json
{ "kind": "canvas", "from": { "id": "6712…a0", "kind": "team" },
  "targets": [
    { "id": "personal", "kind": "personal", "name": "", "avatar": "", "role": "owner", "status": "active",
      "current": false, "available": false, "reason": "copy_out_disabled", "message": "The team owner has switched off copying team content into personal spaces" },
    { "id": "6712…a0", "kind": "team", "name": "Starlight Studio", "avatar": "", "role": "member", "status": "active",
      "current": true, "available": false, "reason": "same_space", "message": "…" },
    { "id": "6713…c4", "kind": "team", "name": "Lime Visuals", "avatar": "", "role": "admin", "status": "active",
      "current": false, "available": true, "reason": "", "message": "" } ] }
```

`id` is what to send as `toSpace` to `POST /api/workflow/:id/copy` or `POST /api/user-asset/:id/copy`. `message` is the reason in the reader's language. The copy routes refuse for the same reasons, with the error named here:

| `reason` | Meaning | The copy answers |
| --- | --- | --- |
| `same_space` | It is the space the request acts in (`current: true`). | `400 space.same_space` |
| `copy_out_disabled` | The source is a team whose owner switched `copyToPersonal` off, the target is the personal space, and the caller is not that team's owner. | `403 space.copy_out_disabled` |
| `team_suspended` | The target team was suspended by the super admin. | `403 team.suspended` |
| `team_dissolved` | The target team was dissolved by its owner. | `403 team.dissolved` |
| `asset_kind_full` | `kind=asset` with `assetKind`: the target's library already holds 5000 assets of that kind. | `400 asset.kind_full` |
| `no_permission` | The caller's role in the target does not allow adding there. No role is refused today (every member may create canvases and add assets); the reason exists so a client need not change when that does. | `403 team.forbidden` |

One refusal is only known when the copy is made: `400 space.copy_too_large` (more than 300 files, or 2 GiB, to duplicate). Errors: `validation.one_of` (400; `kind`, `assetKind`).

### Stock assets — /api/canvas-asset

A read-only library an operator may import into the database. It belongs to the site: every account sees the same one. Empty on a new install; there is no endpoint to add to it.

| Method | Path | Query | Response |
| --- | --- | --- | --- |
| GET | `/api/canvas-asset/categories` | | Array of `{ code, name, count }`. |
| GET | `/api/canvas-asset/list` | `?code&nodeType&page&pageSize` (page size up to 50, default 20) | `{ list, total, page, pageSize }` |

---

## Share links

Base path `/api/canvas-share`. Only reading a link by its token is public. Share links are the one thing meant to cross accounts: whoever has the token can read the snapshot without signing in, and a signed-in account can copy it into its own canvases. Everything else here works on the links of the space the request acts in: the caller's own in a personal space; in a team, all of the team's for its owner and admins and the ones they created for a member (see [Assets, brand kits, templates and share links in a team](#assets-brand-kits-templates-and-share-links-in-a-team)). A team's links stop opening while the team is suspended or dissolved.

| Method | Path | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| POST | `/api/canvas-share/publish` | yes | `{ workflowId, title?, description?, expiresInDays? \| expiresAt? }` | `{ id, token, updated, expiresAt }` |
| GET | `/api/canvas-share/mine` | yes | | `{ list }`: every link of the caller, including expired and revoked ones. |
| GET | `/api/canvas-share/plaza` | yes | `?page&pageSize&sort=hot` | `{ list, total, page, pageSize }`: the caller's active links. |
| GET | `/api/canvas-share/:token` | **public** | | The snapshot: summary fields plus `description`, `nodes`, `edges`, `viewport`, `settings`. Found by the link token only. |
| POST | `/api/canvas-share/:token/copy` | yes | `{ name? }` | `{ workflowId, isOwn }`: a new canvas made from the snapshot, in the space the request acts in (the caller's personal space without `X-Space`). |
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

Errors: `canvas.not_found`, `share.not_found`, `share.gone` (404); `share.empty_canvas`, `share.max` (500 links per space), `share.title_required`, `share.expires_in_past`, `validation.range`, `validation.bad_date` (400).

---

## Admin

Base path `/api/admin`. Two kinds of endpoint live under it, and "admin" in the path is historical for the first kind:

- **Per space.** Vendors, providers and their keys, custom models, model settings and prices, and usage. Any signed-in account may call these, and each call works on the space the request acts in: the caller's own data in a personal space - bring-your-own-key is per account, two accounts never see or use each other's providers - or, with `X-Space`, a team's, where the owner and admins manage and members read (see [Providers, models and prices in a team](#providers-models-and-prices-in-a-team)). The "Who may call it" column below is about a personal space.
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
| `PATCH /api/admin/users/:id` | Super admin only | One other account: disable or enable it; grant or take back the authorisation to create teams |
| `/api/admin/teams…`, `/api/admin/team-requests…` | Super admin only | The teams of the instance - that they exist and how large they may be, never their content - and the requests to create them. See [Teams and the super admin](#teams-and-the-super-admin). |
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

A provider is a vendor plus a key, and belongs to the space it was added in: the account's personal space, or the team. As returned (the key itself is never returned):

```json
{
  "id": "665f…", "type": "gaorui", "name": "Gaorui", "slug": "gaorui",
  "baseUrl": "https://gaorui.cc", "customBaseUrl": false,
  "customModels": [ { "model": "some-chat-model", "kind": "chat", "label": "" } ],
  "enabled": true, "sort": 0,
  "hasKey": true, "keyTail": "3456", "keyUnreadable": false, "restricted": false,
  "maintainer": { "id": "670e…b2", "username": "linzhou", "name": "linzhou", "state": "active", "left": false, "deleted": false },
  "lastTest": { "ok": true, "at": "2026-10-12T08:15:02.000Z", "message": "Connected" },
  "createdAt": "…", "updatedAt": "…"
}
```

- `baseUrl` is the address in use: the one saved for this provider, or the vendor's official address. `customBaseUrl` is `true` when it is not the official one.
- `customModels` are the models added by hand; see [Custom models](#custom-models).
- `keyUnreadable` is `true` when a key is stored but can no longer be decrypted (`SECRET_KEY` changed). The provider cannot be used until the key is entered again (`PUT` with `apiKey`): its connection test answers `ok: false`, and a run or an estimate with one of its models answers `400 provider.key_undecryptable`. `hasKey` and `keyTail` stay as they were.
- `restricted` is `true` for a team member who does not manage the team's providers: `keyTail` and `baseUrl` are then `""`, `customBaseUrl` is `false` and `lastTest` is `null`.
- `maintainer` is the [Person](#members) who last changed the provider - who to ask about it; in a personal space that is the account itself. `updatedAt` is when. A save that changes nothing, and a connection test, change neither.
- `lastTest` is the result of the last connection test of the provider as it is saved: `ok`, `at` (when) and `message` (what the test said, in the reader's language - the upstream's own reason when it failed). `null` when it was never tested, or when its key or address changed since: the old result says nothing about the new one.
- There is no `options` object any more, and no model fields at the top level.

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/providers` | | Array of providers. |
| POST | `/api/admin/providers` | `{ type, apiKey, name?, baseUrl?, enabled?, sort?, slug? }` | The provider. |
| PUT | `/api/admin/providers/:id` | Any of `name`, `baseUrl`, `apiKey`, `clearKey`, `enabled`, `sort` | The provider. |
| DELETE | `/api/admin/providers/:id` | | `{ id }`. Also deletes the overrides of its models. |
| POST | `/api/admin/providers/:id/test` | | `{ ok, message }`. The result is kept as the provider's `lastTest`. |

```bash
curl -X POST http://localhost:3000/api/admin/providers \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"openai","apiKey":"sk-…"}'
```

- `type` is the vendor id and `apiKey` is required. `name` defaults to the vendor's name. Omit `baseUrl` to use the official address.
- The vendor is fixed at creation. A `PUT` with a different `type` is refused with `provider.vendor_fixed`; the same `type` is accepted and ignored.
- On update, omit `apiKey` or send `""` to keep the stored key; send `"clearKey": true` to remove it. `"baseUrl": ""` goes back to the official address.
- **A stored key is only ever sent to the address it was saved with.** A `PUT` that changes the address in use - to another address, or back to the official one - while a key is stored has to carry that key again in the same request (`apiKey`), or give the stored key up (`"clearKey": true`); otherwise it is refused with `400 provider.key_required_for_url` and nothing is changed. Sending the address that is already in use (in any spelling: a trailing slash, another letter case of the host) is no change and needs no key. Without this rule, whoever may edit a provider could point it at a server of their own and collect a key they were never shown. The vendor, which also decides where and how a key travels, cannot be changed at all, and the upstream's redirects are never followed.
- The test endpoint reads nothing from the request: it tests the provider as it is saved - the stored key against the stored address.
- `slug` is set at creation (from `slug` in the body, otherwise from the vendor id) and cannot be changed. It is unique among the providers of the space: a second provider of the same vendor gets `gaorui-2`, and so on. Another space's slugs do not matter.
- A space can have up to 50 providers (`provider.max`).
- The test endpoint calls the upstream's model-list endpoint to prove the address and the key; it no longer returns a model count. It answers HTTP 200 with `ok: false` and a reason when the upstream cannot be reached. A failed test is an answer, not an error.

Errors: `provider.type_unsupported`, `provider.max`, `provider.api_key_required`, `provider.key_required_for_url`, `provider.vendor_fixed`, `provider.type_gone`, `provider.base_url_scheme`, `provider.base_url_credentials`, `validation.bad_url`, `validation.bad_format`, `common.name_required` (400); `provider.not_found` (404); `provider.slug_exhausted` (409).

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

- `:modelId` contains a colon and possibly slashes: URL-encode it (`gaorui%3Anano-banana-2`). It is looked up among the providers of the space the request acts in, and the override is stored for that space only.
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
| `userQueueLimit` | `200` | 1–500 | Unfinished runs (queued, running, archiving) one account may have, across its personal space and its teams. The total for the whole instance stays 500. |
| `teamMaxPerUser` | `3` | 1–100 | How many teams one authorised account may create (and hold). |
| `teamMaxMembers` | `50` | 1–1000 | How many members a team may have, unless the super admin gave that team its own number. |
| `teamConcurrency` | `4` | 1–32 | Runs of one team that may be executing at the same time, unless the team has its own number. |
| `teamActivityDays` | `365` | 0–3650 | How long a team's activity log is kept; `0` = for ever. |

The other limits, the timeouts and `retentionDays` are site settings too and apply to every account's runs. There is no per-account storage quota.

The full set of keys is `siteName`, `logoUrl`, `showSiteName`, `defaultLocale`, `registrationOpen`, `concurrency`, `userConcurrency`, `userQueueLimit`, `maxRetries`, `imageTimeoutMinutes`, `videoTimeoutMinutes`, `chatTimeoutSec`, `submitTimeoutSec`, `downloadTimeoutSec`, `retentionDays`, `teamMaxPerUser`, `teamMaxMembers`, `teamConcurrency` and `teamActivityDays`. `defaultTheme` of earlier versions is not among them any more: the theme is each account's own preference (`prefs.theme`), not a site setting. `GET` does not return it, `PUT` refuses it with `settings.unknown_key` like any other unknown key, and a value stored by an earlier version is ignored.

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
    "canCreateTeams": true,
    "counts": { "workflows": 33, "runs": 35 },
    "teams": { "member": 2, "owned": 1 }
  }
]
```

The fields of a [User](#the-user-object), plus:

| Field | Meaning |
| --- | --- |
| `disabled` | `true` when the super admin has disabled the account. |
| `lastLoginAt` | When a session was last opened for the account, or `null`. |
| `canCreateTeams` | The account may create teams: the super admin's grant (always `true` for the super admin). |
| `counts.workflows` | Canvases in the account's personal space that are not deleted. |
| `counts.runs` | Usage records of the account's personal space. |
| `teams.member`, `teams.owned` | How many teams the account is in, and how many of them it owns. |

**PATCH /api/admin/users/:id** takes `{ "disabled"?: boolean, "canCreateTeams"?: boolean }` (at least one) and returns that account's row, in the shape above. `canCreateTeams` grants or takes back the authorisation to create teams (see [Who may create a team](#who-may-create-a-team)); taking it back leaves the account's existing teams alone. A disabled account keeps its teams and memberships. Disabling ends every session of the account at once; it cannot sign in (`auth.account_disabled`) and its token answers `401`. The runs it had **waiting in the queue** - in its personal space and in every team - are canceled, exactly as for a member who is removed from a team, and give their places in the team's monthly limits back; a run that already started is left to finish. The edit locks it held on team canvases are given back at once, so nobody waits for them to run out. The answer carries `runsCanceled`, how many that were (`0` for any other change). Its data is kept. `"disabled": false` restores access.

**DELETE /api/admin/users/:id?confirm=&lt;username&gt;** removes the account and its personal space. An account that owns a team is not deleted (`409 team.account_owns_teams`): hand the team over or remove it first. From every other team the account leaves, and what it made there stays with the team (see [Teams and the super admin](#teams-and-the-super-admin)). `confirm` must equal the account's username exactly. It stops the account's unfinished runs and deletes its sessions, canvases, share links, assets, brand kits, providers and keys, model overrides, usage records, templates and stored files, then the account itself. This cannot be undone.

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
- `filesRemoved` is `false` when not every file is gone yet: a storage could not be reached, refused, or was still being cleaned when the answer was sent (the request waits 4 seconds for storage at most). The account is gone either way. What is left is removed in the background and tried again every 10 minutes for up to 30 days; the server log says where files are left, and what to remove by hand if that never succeeds. See [Storage](storage.md#when-a-storage-cannot-be-reached).
- Files whose key has no account segment (stored before accounts existed) are never removed this way. They belong to the super admin, who cannot be deleted.

**POST /api/admin/users/:id/reset-password** takes no body, sets a random password and ends every session of the account. Response: `{ "temporaryPassword": string }`, 16 characters, returned this once and not stored in readable form. It also sets the account's `mustChangePassword` to `true`. Hand the password to the person; they sign in with it and are asked to choose a new password right after signing in (`PUT /api/auth/password`), before the API serves them anything else. In the web app this is **Reset password** under **Settings → Users**. No mail is sent. The super admin's own forgotten password is reset on the server, with `node server/src/cli/reset-password.js <username-or-email>`, which does the same three things.

Errors of the three endpoints that take `:id`:

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `auth.cannot_modify_self` | `:id` is the caller. The super admin changes their own password with `PUT /api/auth/password` and cannot disable or delete their own account. |
| 400 | `auth.cannot_modify_owner` | `:id` is the super admin account. |
| 400 | `auth.confirm_mismatch` | `DELETE` only: `confirm` is missing or is not the account's username. |
| 400 | `validation.boolean` | `PATCH` only: neither `disabled` nor `canCreateTeams` is given, or one of them is not a boolean. |
| 409 | `team.account_owns_teams` | `DELETE` only: the account owns one or more teams. |
| 403 | `auth.forbidden` | The caller is not the super admin. |
| 404 | `auth.user_not_found` | No account with that id. |

### Storage

Super admin only (`auth.forbidden`, 403, for any other account). Where files are kept, for every account: the local disk or an S3-compatible bucket. Storage is not part of `/api/admin/settings`; it has its own endpoints. What the fields mean, per-vendor values and what happens to existing files on a switch are in [Storage](storage.md).

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| GET | `/api/admin/storage` | | The storage status (below). With `?probe=1` every bucket is first asked whether it can be reached - all at once, 3 seconds each, 4 seconds at most in total, and a bucket heard of within the last 5 seconds is not asked again - so the states in `buckets` are current. Without it the answer is immediate and the states are what the last file request that touched each bucket found. |
| POST | `/api/admin/storage/test` | `{ s3: {…} }` | The result of a connection test with the submitted, unsaved configuration. |
| PUT | `/api/admin/storage` | `{ driver: "local" }` or `{ driver: "s3", s3: {…}, force?: true }` | The storage status after the change. |
| DELETE | `/api/admin/storage/buckets/:id` | | The storage status after the change. Stops reading a bucket that is no longer written to; see below. |

**The status**, returned by `GET`, by a successful `PUT` and by `DELETE`:

```json
{
  "source": "saved",
  "driver": "s3",
  "delivery": "proxy",
  "envDriver": "local",
  "secretUnreadable": false,
  "writable": true,
  "upstream": "inline",
  "upstreamReason": "",
  "s3": {
    "preset": "minio",
    "endpoint": "http://minio:9000",
    "region": "us-east-1",
    "bucket": "loomcanvas",
    "accessKeyId": "AKIA…",
    "forcePathStyle": true,
    "keyPrefix": "",
    "publicBaseUrl": "",
    "presignEndpoint": "",
    "delivery": "proxy",
    "acl": "",
    "hasSecret": true,
    "secretTail": "x9Qd",
    "endpointHost": "minio:9000"
  },
  "previous": [
    { "endpointHost": "s3.eu-west-1.amazonaws.com", "bucket": "old-bucket", "keyPrefix": "" }
  ],
  "buckets": [
    { "id": "s3-0f3a9c1e7b52", "endpointHost": "minio:9000", "bucket": "loomcanvas", "keyPrefix": "", "origin": "saved", "active": true, "state": "ok", "removable": false },
    { "id": "s3-77c0d1a4e9b3", "endpointHost": "s3.eu-west-1.amazonaws.com", "bucket": "old-bucket", "keyPrefix": "", "origin": "saved", "active": false, "state": "unreachable", "downSince": "2026-10-13T08:15:02.000Z", "removable": true }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `source` | Where the active choice comes from: `saved` (a configuration was saved through this API or the settings page), `env` (`STORAGE_DRIVER=s3` in the environment), `default` (local disk, nothing configured). |
| `driver` | The backend that receives new files: `local` or `s3`. |
| `delivery` | How `/files/<key>` answers for files on the active backend: `proxy` or `redirect`; empty when `driver` is `local`. |
| `envDriver` | What `STORAGE_DRIVER` says. |
| `secretUnreadable` | `true` when the saved secret cannot be decrypted (`SECRET_KEY` changed). It has to be entered again; until then the files in that bucket answer `503`. `driver` stays what was saved. |
| `writable` | `false` while new files are refused: the bucket in use is the one whose secret cannot be read. Uploads then answer `503 storage.secret_unreadable`, and so do image and video runs, before anything is sent to an upstream. Nothing is written elsewhere instead. See [Storage](storage.md#backups). |
| `upstream` | How a file stored now is handed to an upstream model: `public_base` (the bucket's public domain), `signed` (a presigned URL), `app` (`PUBLIC_URL` + `/files/<key>`) or `inline` (no address an upstream on the internet could open: images go inline, an input that must be a URL is refused). `media.upstreamByUrl` in the bootstrap is `false` when this is `inline`. `unavailable` while nothing can be stored at all (`writable` is `false`): that is not a way of handing files over and not a configuration to change, so the bootstrap says `media.writable: false` and keeps describing the configuration in `media.upstreamByUrl`. The rule is in [Storage](storage.md#what-counts-as-reachable). |
| `upstreamReason` | Why `upstream` is `unavailable`: `secret_unreadable`. An empty string otherwise. |
| `buckets` | Every bucket a file is looked for in, the one in use first. `origin`: `saved` (through this API or the settings page) or `env` (the `S3_*` variables; read whatever `STORAGE_DRIVER` says). `state`: `ok` (not known to be down), `unreachable` (it did not answer; `downSince` says since when; file requests leave it alone for 30 seconds at a time, `?probe=1` asks it at once) or `secret_unreadable`. `removable`: whether `DELETE /api/admin/storage/buckets/:id` takes it. A bucket named both on the settings page and in the environment appears once. |
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
| `secretAccessKey` | Empty or omitted means "use the stored one" (the saved secret, otherwise the environment's) - **only while `endpoint` and `accessKeyId` are the ones that secret was saved with**. A request that names another endpoint or another access key id has to bring the secret along: `400 storage.secret_required`, for `PUT` and for the connection test alike. Bucket, region, prefix and the other options may change while the stored secret stays. Required when there is none. |
| `forcePathStyle` | Boolean, default `false`. |
| `keyPrefix` | Optional folder inside the bucket. Returned normalised, with a trailing slash (`a/b/`). |
| `publicBaseUrl` | Optional `http(s)` URL that maps to the bucket root; a path is allowed. Returned without a trailing slash. |
| `presignEndpoint` | Optional `http(s)://host[:port]` without a path: the address the S3 service has from the internet, when `endpoint` only works inside the deployment. Presigned URLs for upstream models are made for it; the server never contacts it. Validated like `endpoint`. |
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

Errors (400): `storage.save_needs_test`, `storage.endpoint_has_path`, `storage.endpoint_has_bucket`, `storage.bad_bucket`, `storage.bad_key_prefix`, `storage.redirect_needs_public_url`, `validation.required`, `validation.one_of`, `validation.bad_url`, `validation.bad_format`, `validation.string`, `validation.boolean`, `storage.secret_required`. A refusal about one field of the form carries `data: { field }` (`endpoint`, `publicBaseUrl`, `presignEndpoint`, `bucket`, `region`, `accessKeyId`, `secretAccessKey`, `keyPrefix`, …), and its `message` names the field as the settings page does ("The endpoint for signed URLs must be just the service address…"), not by its key in the API. `storage.endpoint_has_path` and `storage.endpoint_has_bucket` are shared by `endpoint` and `presignEndpoint`; `data.field` tells them apart.

**DELETE /api/admin/storage/buckets/:id** takes a bucket off the list of buckets that are read (`id` from `buckets` in the status, where `removable` is `true`): an earlier bucket, or the saved one while the local disk is in use. It is for a bucket that is gone for good - as long as a dead bucket is listed, a file that is found nowhere answers `503` instead of `404`, because it might be there. The bucket's files stop loading; nothing is deleted from the bucket. Errors: `404 storage.bucket_not_found`, `400 storage.bucket_in_use` (the bucket new files go to), `400 storage.bucket_from_env` (it comes from the `S3_*` variables: remove them instead).

**While storage is in trouble**, any endpoint that reads or stores a file can answer `503` with one of three codes: `storage.unreachable` (a file that may exist could not be looked up or read), `storage.write_failed` (a file could not be stored) and `storage.secret_unreadable` (see `writable` above). They are described in [Storage](storage.md#troubleshooting).

### Usage

Per space: in a personal space the totals and the records are those of the caller's own runs, and there is no endpoint that reports usage across accounts. With `X-Space` they are the team's, and who sees whose records is described in [Usage in a team](#usage-in-a-team) (`groupBy=member`, the `member` filter, `scope`, `createdBy` on each record).

In the web app this is the **History** page and the usage card of the **Workbench**.

Common query parameters for both `GET` endpoints:

| Parameter | Meaning |
| --- | --- |
| `from`, `to` | Date range on the run's creation time. A bare date (`2026-10-31`) is that calendar day in `tz`: `from` starts at the beginning of the day, `to` runs through the end of it. A full ISO instant or a millisecond timestamp is taken as it is. |
| `tz` | An IANA time zone name such as `Asia/Shanghai`. Default `UTC`. Decides what day a bare date in `from` and `to` means and, with `groupBy=day`, where one day ends and the next begins. Without it everything is in UTC days, as in earlier versions. |
| `kind` | `image`, `video` or `chat` |
| `status` | A run status |
| `model` | A model id |
| `q` | Text search, at most 100 characters (`400 validation.max_length` beyond that; surrounding spaces are dropped and an empty `q` is no search). Keeps the runs that have this text - as it is, in any case, never as a pattern - in their **prompt**, in their **model** (its name or id), or in the **name of the canvas** they came from. It only narrows what the caller may list anyway: in a team a member still gets their own records only, and a canvas is matched by name only if the caller may see it (nobody finds a run through the name of somebody else's private canvas); canvases in the trash are not searched. Applies to the summary too, so totals and list agree. |

**GET /api/admin/usage** — additional parameter: `groupBy` = `day` (default) or `model`. `timezone` in the answer is the zone that was used.

```json
{
  "groupBy": "day",
  "timezone": "UTC",
  "totals": { "key": "total", "runs": 13, "succeeded": 10, "failed": 1, "canceled": 1, "inProgress": 1, "reserved": { "CNY": 0.1 }, "counted": { "runs": 11 }, "amount": 1.0, "currency": "CNY", "unknownCount": 2, "costs": { "CNY": 1.0 } },
  "items": [
    { "key": "2026-10-09", "runs": 13, "succeeded": 10, "failed": 1, "canceled": 1, "inProgress": 1, "reserved": { "CNY": 0.1 }, "counted": { "runs": 11 }, "amount": 1.0, "currency": "CNY", "unknownCount": 2, "costs": { "CNY": 1.0 } }
  ]
}
```

- `runs` is every record of the range, whatever its status: `succeeded` + `failed` + `canceled` + `inProgress`.
- Cost is summed over **succeeded** runs with a **known** cost, per currency, in `costs`. `amount` / `currency` show the largest of them.
- `inProgress` is the number of runs that are queued, running or archiving right now; `reserved` is what they hold, per currency: their estimate, or - for a team's chat run priced per token - its reserve. Neither is part of `costs` yet.
- `counted.runs` = `succeeded` + `inProgress`: what a team's [monthly limits](#monthly-limits) count. Failed and canceled runs do not count.
- `unknownCount` is the number of succeeded runs whose cost is unknown.
- With `groupBy=model`, `key` is the model id and each item also has `label`.

**GET /api/admin/usage/records** — additional parameters: `page`, `pageSize` (up to 100, default 20), and `full=1` to get every record of the page whole (as `GET …/records/:recordId` gives it: the complete prompt and text answer, `systemPrompt`, `imageUrls`, `videoUrls`) - what an export needs; a page of the list does not.

```json
{
  "list": [
    {
      "id": "6660…", "kind": "image", "status": "succeeded", "progress": 100,
      "model": "gaorui:nano-banana-2", "modelLabel": "Nano Banana 2", "providerType": "gaorui",
      "prompt": "an orange cat…", "promptLength": 14, "promptTruncated": false,
      "params": { "resolution": "1K" }, "count": 1, "inputs": { "images": 1, "videos": 0 },
      "cost": { "amount": 0.1, "currency": "CNY", "unknown": false },
      "usage": null,
      "text": "", "textLength": 0, "textTruncated": false,
      "outputs": [ { "type": "image", "url": "/files/outputs/2026/10/….png", "thumbnailUrl": "/files/thumbs/….webp", "width": 1024, "height": 1024 } ],
      "filesPurged": false,
      "error": "", "errorCode": "", "workflowId": "665f…", "nodeId": "node-12",
      "createdAt": "…", "startedAt": "…", "finishedAt": "…", "queuedMs": 420, "durationMs": 8300
    }
  ],
  "total": 12, "page": 1, "pageSize": 20
}
```

A record is one run, with what a history row, its detail view and an export need:

| Field | Meaning |
| --- | --- |
| `prompt`, `promptLength`, `promptTruncated` | The prompt. In the list it is cut to 200 characters: `promptTruncated` says so and `promptLength` how long the whole is. |
| `inputs` | How many images and videos were sent along with the prompt. |
| `cost` | `{ amount, currency, unknown }`. `unknown: true` means "not known", not "free". It is the estimate made when the run was submitted and, once the run **succeeded**, what the run cost. A failed or canceled run keeps the estimate in this field but cost nothing (the summary does not count it either): show no cost for those. |
| `usage` | Chat runs: `{ inputTokens, outputTokens, totalTokens }` as the upstream reported them. `null` for image and video runs and when the upstream reported none. |
| `text`, `textLength`, `textTruncated` | The text answer of a chat run (`""` for image and video runs and until the run succeeded). In the list it is cut to 500 characters. |
| `outputs` | The files of an image or video run: `[{ type, url, thumbnailUrl, width?, height? }]`. `[]` for chat runs and unfinished ones. |
| `filesPurged` | `true` when the files of the run were removed by the retention setting: `outputs` is then `[]` although the run succeeded. |
| `error`, `errorCode` | Why it failed, in the reader's language, and the stable code of that reason (`""` when it did not fail). A canceled run has them too: `run.canceled` when a person canceled it, or the reason it was canceled while waiting (`run.canceled_member_removed`, `run.canceled_account_disabled`, `run.canceled_team_closed`). |
| `queuedMs`, `durationMs` | Milliseconds waiting in the queue (`createdAt` → `startedAt`) and running (`startedAt` → `finishedAt`); `null` while that phase is not over. |
| `createdBy` | In a team: the [Person](#members) who started it. |

**GET /api/admin/usage/records/:recordId** — one record in full: the same object with the **whole** `prompt` and `text` (`promptTruncated` and `textTruncated` are `false`), plus `systemPrompt`, `imageUrls` and `videoUrls` (what was sent along). A record of another space, and in a team somebody else's record for a caller who may not list everybody's, is `404 run.not_found`; a malformed id `400 validation.bad_format`.

`POST /api/runs/download-zip` packs the results of several records into one archive: see [Models and runs](#post-apirunsdownload-zip).

Errors of both list endpoints (400): `validation.bad_date`, `validation.from_before_to`, `validation.invalid` (for `kind`, `status`, `model`, and for a `tz` that is not a known zone name).

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
