# LoomCanvas server

Backend of LoomCanvas: Node.js 20.9+, Express, Mongoose. Accounts (the super admin is created by the server at start-up; everyone who registers is an ordinary user), each with its own personal space: its own canvases, files and model API keys. Several accounts can share a team space, with roles, invite links, an edit lock per canvas and monthly limits.

The HTTP API reference is [`../docs/api.md`](../docs/api.md) (English) and
[`../docs/api.zh-CN.md`](../docs/api.zh-CN.md) (Chinese, the same content); the design contract behind it is
[`../docs/architecture.md`](../docs/architecture.md) (Chinese).
All documentation: [`../docs/README.md`](../docs/README.md).

## Run

```bash
cd server
npm install
cp .env.example .env      # set SECRET_KEY (required) and MONGODB_URI
npm start                 # or: npm run dev  (restarts on file changes)
```

The server refuses to start without a `SECRET_KEY` of at least 16 characters.
It never invents one: provider API keys are encrypted with it, so it has to stay the same across restarts.

The first start creates the super admin: username `ADMIN_USERNAME` (default `admin`), password `ADMIN_PASSWORD`.
Without `ADMIN_PASSWORD` a random password is generated and shown once in the start-up log; it has to be replaced
at the first sign-in. There is no access password and no mode without accounts.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `SECRET_KEY` | (required) | Master secret, 16+ characters. Encrypts provider API keys and the saved S3 secret. Sign-in does not depend on it. |
| `PORT` | `3000` | HTTP port. |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/loomcanvas` | Database. |
| `PUBLIC_URL` | empty | Optional. Public address of the instance, e.g. `https://canvas.example.com`. Only used to give upstream models an absolute URL for a stored file they cannot load straight from a bucket (files on the local disk); file URLs themselves are always site-relative (`/files/<key>`). |
| `MAX_UPLOAD_MB` | `50` | Upload size limit (1 to 2048). Uploads are buffered in memory. |
| `STORAGE_DRIVER` | `local` | `local` or `s3`. A bootstrap default: a configuration saved under Settings → Storage takes precedence. |
| `STORAGE_LOCAL_DIR` | `./data/files` | Where the local disk backend keeps files. |
| `S3_*` | | Settings of the S3-compatible backend, see `.env.example`. `S3_PRESIGN_ENDPOINT` is the public address of the S3 service when `S3_ENDPOINT` only works inside the deployment. |
| `WEB_DIST` | empty | Built frontend to serve from this process (with SPA fallback). |
| `BILLING_HOOK` | empty | Path to a custom billing module, relative to the directory the server is started from. |
| `CORS_ORIGIN` | empty | Extra browser origins allowed to call the API (comma separated). |
| `TRUST_PROXY` | empty | Behind a reverse proxy: the number of proxies in front (`1` to `10`), or a comma-separated list of their addresses (IP, CIDR, `loopback`, `linklocal`, `uniquelocal`). `true` and host names are rejected at startup. |
| `SSRF_ALLOW_HOSTS` | empty | Hosts exempt from the private-address download block. |
| `BUDGET_CHAT_RESERVE_OUTPUT_TOKENS` | `8192` | Teams with a money limit: how many output tokens a chat run priced per token reserves of the limit while it runs (1 to 1000000). |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_EMAIL` | `admin`, empty, empty | The super admin account, created at start-up when there is none. `ADMIN_PASSWORD` is 8 to 128 characters; empty means a generated one, shown once in the log. See [Accounts](#accounts). |
| `REGISTRATION_OPEN` | empty | The first value of the registration setting; ignored once the setting has been saved. |

The complete table, with every `S3_*` variable, is in
[`../docs/configuration.md`](../docs/configuration.md#environment-variables).

### Storage

Files are kept on the local disk by default. The alternative is one S3-compatible driver (AWS S3, Cloudflare R2,
Aliyun OSS, MinIO and similar services), configured under Settings → Storage or with `S3_*`; what is saved in the
settings takes precedence over the environment and takes effect without a restart.
The AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`) is a regular dependency,
loaded the first time an S3 backend is used. `STORAGE_DRIVER=oss` is no longer accepted: use `s3` with the OSS
S3-compatible endpoint.

Every stored file has one address, `/files/<key>`, on every backend. The app answers it: from disk, by streaming
the object out of the bucket (so the bucket can be private), or with a redirect to the bucket's public domain.
Files are not moved when storage is switched; the earlier backend stays readable.
Files under `/files/` are public by design (share links and upstream models need to load them);
their names are random and unguessable.

The S3 driver is verified against MinIO. AWS S3, Cloudflare R2 and Aliyun OSS have not been run against the live
services. Everything else is in [`../docs/storage.md`](../docs/storage.md).

### Reference media and `PUBLIC_URL`

A file in a bucket is handed to an upstream model as a presigned URL that is valid for one hour (or as the bucket's
public address). When the bucket's endpoint is an internal one (`http://minio:9000`), set `S3_PRESIGN_ENDPOINT`, or
"Endpoint for signed URLs" under Settings → Storage, to the address the service has from the internet: presigned URLs
are made for it. A file on the local disk needs a public `PUBLIC_URL` instead.
When there is no publicly reachable address, images are sent inline (base64) to providers that accept it, and
inputs that must be a URL (a source video for video editing, some image-to-video models) fail.

## Layout

```text
src/
  index.js        boot and shutdown        app.js      Express wiring
  config.js       environment              constants.js
  routes/         HTTP endpoints           models/     Mongoose models
  providers/      vendor modules, catalogs runner/     run queue, polling, transfer, pricing
  storage/        local disk + S3 buckets  billing/    billing hook (no-op by default)
  services/       accounts, spaces, teams, permissions, budget (monthly limits), activity, space copy, zip export,
                  settings, storage settings, media, image tools, seed, retention, provider migration
  middleware/     auth, errors, headers    utils/      crypto, safeFetch, validation
  i18n/           en.js, zh-CN.js messages cli/        reset-password.js
test/             node:test suites (unit and end-to-end)
```

## Writing a provider

The full guide, with a worked example and tests, is
[`../docs/writing-a-provider.md`](../docs/writing-a-provider.md). In short:

A vendor is two files: a module in `src/providers/`, registered in `src/providers/index.js`, and a catalog
`src/providers/catalog/<type>.json` that states the models the vendor supports. Built in: `gaorui`, `openai`, `gemini`.

```js
const { loadCatalog } = require('./catalog')

module.exports = {
  type: 'my-vendor',                      // lowercase, stable: the vendor id
  label: 'My Vendor',
  defaultBaseUrl: 'https://api.example.com',  // the vendor's official address
  catalog: loadCatalog('my-vendor'),      // catalog/my-vendor.json, validated at load
  customKinds: ['image', 'chat'],         // kinds a user may add by hand as custom models
  customSpec: (kind) => CUSTOM[kind],     // what a custom model of that kind gets
  sync: false,                            // true when submit() returns the finished result

  // -> { ok, message? }; throw to report a failure
  async test(cfg, { signal }) {},
  // -> { externalId } for an async task, or { outputs } when the result is ready
  async submit(cfg, run) {},
  // -> { status: 'running' | 'succeeded' | 'failed', progress?, outputs?, error? }
  async poll(cfg, run) {},
  // -> { text, usage?: { inputTokens, outputTokens } }
  async chat(cfg, req) {},
}
```

`customSpec`, `test`, `submit`, `poll` and `chat` must exist; one your upstream has no use for should throw.

- The catalog is `{ "image": [...], "video": [...], "chat": [...] }`, all three sections present. The section an
  entry sits in is its kind. Nothing about a model is inferred from its name, and no model list is fetched from
  the upstream. The format and the validator are in `providers/catalog/index.js`.
- Every catalog model needs a `model.<type>.<model>.desc` message in both `i18n/en.js` and `i18n/zh-CN.js`.
  Catalogs carry no prices: a missing price shows as "cost unknown" and is set per model on the Models page of the web app.
- A vendor other than Gaorui goes through its official API only. Another base URL is allowed as long as what
  answers there speaks exactly that API.
- `cfg` is `{ baseUrl, apiKey }`, with the key already decrypted. Never log it.
- `run` is `{ kind, model, prompt, imageUrls, videoUrls, params, externalId, spec, signal, media }`.
  `model` is the upstream model name. `spec.maxReferenceImages` is the model's reference image limit.
  Pass `signal` to every request so deadlines and cancellation work.
- `run.media` converts canvas URLs into something the upstream can read:
  `toRef(url)` (public URL, or data URI as fallback), `toBase64(url)`, `toPublicUrl(url)` (throws if there is none).
  The URL may be a presigned storage URL: use it for the upstream request only, never log or keep it.
- An output is `{ type: 'image' | 'video', url, headers? }` or `{ type: 'image', b64 }`.
  The runner downloads it into storage; do not store anything yourself.
- Use `request()` from `providers/http.js`. It turns failures into errors with a user-facing message and the
  `transient` / `safeToResubmit` flags the runner uses to decide what may be retried.

Providers saved by the previous version (provider types, free-text model fields) are converted once at start-up by
`services/providerMigration.js`; its header comment states every rule.

## Billing hook

`BILLING_HOOK=./my-billing.js` loads a module that may export `beforeRun(ctx, cost)`, `afterRun(ctx, result)`
and `onFailed(ctx, error)`. `beforeRun` returning `{ allow: false, reason }` fails the run with that reason.
When each function is called, and what is not guaranteed after a crash, is in
[`../docs/billing-hook.md`](../docs/billing-hook.md).

## Accounts

Signing in is always required. `POST /api/auth/register` creates an ordinary user, never the super admin. The super admin (role `owner` in the API: site settings, storage, registration, user list; in the web app the "Site management" group of the Settings page) is created by the server at start-up from the `ADMIN_*` variables. In its personal space each account sees only its own data, and a resource of another space answers 404. Sessions are stored in the database (hashed token, 12 hours, or 30 days with `remember`) and travel as `Authorization: Bearer <token>`. Changing the password ends every session of the account and returns a fresh token to the caller. `ACCESS_PASSWORD` of earlier versions is ignored.

Sign-in attempts are rate limited in memory, per 10 minutes: 10 per account name and client address, 30 per client address, 100 per account name and 3000 in total; the last two are not applied to an address the account is known at, so guessing at a name does not lock its holder out. Registration: 20 per address per hour. Profile changes: 20 per account per hour. Details: [`../docs/security.md`](../docs/security.md#rate-limits).

Forgotten password (no email is sent):

```bash
node src/cli/reset-password.js <username-or-email>   # prints a temporary password, signs the account out everywhere
```

Teams: several accounts share one space, named per request by the `X-Space` header (or by the team id in `/api/teams/:id/...`); membership is looked up on every request. The contract - roles and the permission matrix, invite links, canvas visibility, the edit lock (one editing session at a time; 36 s lifetime, 12 s heartbeat), saving and conflicts, monthly limits, usage, the activity log, copying between spaces and what the super admin may do with a team - is in [`../docs/api.md`](../docs/api.md#spaces-and-teams) ([Chinese](../docs/api.zh-CN.md#空间与团队)); the reasons behind it are in section 12 of [`../docs/architecture.md`](../docs/architecture.md).

Code that adds a per-space collection must add it to `OWNED` in `src/services/accounts.js`, and every query on such a collection must carry `userId: req.spaceId` - the space the request acts in: the caller's personal space, or a team named by the `X-Space` header (`src/services/spaces.js`). What a team role may do is one table, `src/services/permissions.js`. `test/accounts.e2e.test.js` and `test/teams.e2e.test.js` are the isolation suites; `test/teams.matrix.e2e.test.js` walks the permission table; `test/locks.e2e.test.js`, `test/budget.e2e.test.js` and `test/teamdata.e2e.test.js` cover the edit lock, the monthly limits and what team pages read.

## Tests

```bash
npm test
```

Unit tests need nothing. The end-to-end tests need a MongoDB: set `TEST_MONGODB_URI`, otherwise
`mongodb-memory-server` is used (it downloads a MongoDB binary on first run), and those tests are skipped if neither works.
The storage tests against a real S3 API (`test/storage.live.test.js`) are skipped unless `TEST_S3_ENDPOINT` and the
related variables are set; see [`../docs/development.md`](../docs/development.md#live-s3-tests).
No test calls a real model API: vendor modules are tested against a fake upstream. For Gaorui, part of that fake upstream's answers
were recorded from the real service on 2026-10-10 (the tests named "real service").
