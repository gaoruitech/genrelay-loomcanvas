# LoomCanvas server

Backend of LoomCanvas: Node.js 20.9+, Express, Mongoose. Single user, bring your own model API keys.

The HTTP API is documented in [`../docs/api.md`](../docs/api.md) (reference, English) and
[`../docs/architecture.md`](../docs/architecture.md) (design contract, Chinese).
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

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `SECRET_KEY` | (required) | Master secret, 16+ characters. Encrypts provider keys, signs login tokens. |
| `PORT` | `3000` | HTTP port. |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/loomcanvas` | Database. |
| `PUBLIC_URL` | empty | Optional. Public address of the instance, e.g. `https://canvas.example.com`. Only used to give upstream models an absolute URL for a stored file (local driver); file URLs themselves are always site-relative (`/files/<key>`). |
| `ACCESS_PASSWORD` | empty | Shared login password. Empty means no login at all. |
| `MAX_UPLOAD_MB` | `50` | Upload size limit (1 to 2048). Uploads are buffered in memory. |
| `STORAGE_DRIVER` | `local` | `local`, `s3` or `oss`. |
| `STORAGE_LOCAL_DIR` | `./data/files` | Where the local driver keeps files (served at `/files/<key>`). |
| `S3_*`, `OSS_*` | | Object storage settings, see `.env.example`. |
| `WEB_DIST` | empty | Built frontend to serve from this process (with SPA fallback). |
| `BILLING_HOOK` | empty | Path to a custom billing module, relative to the directory the server is started from. |
| `CORS_ORIGIN` | empty | Extra browser origins allowed to call the API (comma separated). |
| `TRUST_PROXY` | empty | Behind a reverse proxy: the number of proxies in front (`1` to `10`), or a comma-separated list of their addresses (IP, CIDR, `loopback`, `linklocal`, `uniquelocal`). `true` and host names are rejected at startup. |
| `SSRF_ALLOW_HOSTS` | empty | Hosts exempt from the private-address download block. |

The complete table, with every `S3_*` and `OSS_*` variable, is in
[`../docs/configuration.md`](../docs/configuration.md#environment-variables).

The S3 SDK (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`) is an optional dependency: `npm ci` / `npm install` installs it,
and it is in the Docker image. The OSS SDK is not bundled: run `npm install ali-oss` here, or with Docker set
`EXTRA_NPM_PACKAGES=ali-oss` in `.env` and rebuild the image (`docker compose build`).
Both drivers expect objects to be publicly readable at the configured public base URL.
They are written but have not been run against a real bucket in this project yet.

Files under `/files/` are public by design (share links and upstream models need to load them);
their names are random and unguessable.

### Reference media and `PUBLIC_URL`

With local storage and no public address, an upstream model cannot download a reference image from this server.
Images are then sent inline (base64) to providers that accept it.
Inputs that must be a URL (a source video for video editing, some image-to-video models) need either a public
`PUBLIC_URL` or object storage.

## Layout

```
src/
  index.js        boot and shutdown        app.js      Express wiring
  config.js       environment              constants.js
  routes/         HTTP endpoints           models/     Mongoose models
  providers/      model provider plugins   runner/     run queue, polling, transfer, pricing
  storage/        local / s3 / oss         billing/    billing hook (no-op by default)
  services/       settings, media, image tools, seed, retention
  middleware/     auth, errors, headers    utils/      crypto, safeFetch, validation
```

## Writing a provider

The full guide, with a worked example and tests, is
[`../docs/writing-a-provider.md`](../docs/writing-a-provider.md). In short:

A provider is one file in `src/providers/` exporting this shape, registered in `src/providers/index.js`:

```js
module.exports = {
  type: 'my-provider',                    // lowercase, stable
  label: 'My Provider',
  defaultBaseUrl: 'https://api.example.com',
  fields: [                               // drives the settings form
    { key: 'apiKey', label: 'API Key', secret: true, required: true },
    { key: 'baseUrl', label: 'Base URL' },
  ],
  sync: false,                            // true when submit() returns the finished result

  // -> ModelSpec[] without `providerId` and without the "<slug>:" id prefix
  async listModels(cfg, { signal }) {},
  // -> { ok, message, modelCount? }; throw to report a failure
  async test(cfg, { signal }) {},
  // -> { externalId } for an async task, or { outputs } when the result is ready
  async submit(cfg, run) {},
  // -> { status: 'running' | 'succeeded' | 'failed', progress?, outputs?, error? }
  async poll(cfg, run) {},
  // -> { text, usage?: { inputTokens, outputTokens } }
  async chat(cfg, req) {},
}
```

All five functions must exist; one your upstream has no use for should throw.

- `cfg` is `{ baseUrl, apiKey, ...other fields }`, with the key already decrypted. Never log it.
- `run` is `{ kind, model, prompt, imageUrls, videoUrls, params, externalId, spec, signal, media }`.
  `model` is the upstream model id. Pass `signal` to every request so deadlines and cancellation work.
- `run.media` converts canvas URLs into something the upstream can read:
  `toRef(url)` (public URL, or data URI as fallback), `toBase64(url)`, `toPublicUrl(url)` (throws if there is none).
- An output is `{ type: 'image' | 'video', url, headers? }` or `{ type: 'image', b64 }`.
  The runner downloads it into storage; do not store anything yourself.
- Use `request()` from `providers/http.js`. It turns failures into errors with a user-facing message and the
  `transient` / `safeToResubmit` flags the runner uses to decide what may be retried.
- Declare models in `providers/catalog/<type>.json` when the list is fixed. Leave `pricing` out unless you are
  sure of it: a missing price shows as "cost unknown" and can be set per model in the settings page.

## Billing hook

`BILLING_HOOK=./my-billing.js` loads a module that may export `beforeRun(ctx, cost)`, `afterRun(ctx, result)`
and `onFailed(ctx, error)`. `beforeRun` returning `{ allow: false, reason }` fails the run with that reason.
When each function is called, and what is not guaranteed after a crash, is in
[`../docs/billing-hook.md`](../docs/billing-hook.md).

## Tests

```bash
npm test
```

Unit tests need nothing. The end-to-end tests need a MongoDB: set `TEST_MONGODB_URI`, otherwise
`mongodb-memory-server` is used (it downloads a MongoDB binary on first run), and those tests are skipped if neither works.
No test calls a real model API: providers are tested against a fake upstream.
