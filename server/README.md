# LoomCanvas server

Backend of LoomCanvas: Node.js 20+, Express, Mongoose. Single user, bring your own model API keys.
The HTTP contract is in [`../docs/architecture.md`](../docs/architecture.md).

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
| `PUBLIC_URL` | empty | Public address of the instance, e.g. `https://canvas.example.com`. |
| `ACCESS_PASSWORD` | empty | Login password. Empty means no login at all. |
| `MAX_UPLOAD_MB` | `50` | Upload size limit. |
| `STORAGE_DRIVER` | `local` | `local`, `s3` or `oss`. |
| `STORAGE_LOCAL_DIR` | `./data/files` | Where the local driver keeps files (served at `/files/<key>`). |
| `S3_*`, `OSS_*` | | Object storage settings, see `.env.example`. |
| `WEB_DIST` | empty | Built frontend to serve from this process (with SPA fallback). |
| `BILLING_HOOK` | empty | Path to a custom billing module. |
| `CORS_ORIGIN` | empty | Extra browser origins allowed to call the API (comma separated). |
| `TRUST_PROXY` | empty | Set behind a reverse proxy (e.g. `1`). |
| `SSRF_ALLOW_HOSTS` | empty | Hosts exempt from the private-address download block. |

Object storage SDKs are not installed by default:
`npm install @aws-sdk/client-s3 @aws-sdk/lib-storage` for `s3`, `npm install ali-oss` for `oss`.
Both drivers expect objects to be publicly readable at the configured public base URL.

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
See `src/billing/index.js`.

## Tests

```bash
npm test
```

Unit tests need nothing. The end-to-end test needs a MongoDB: set `TEST_MONGODB_URI`, otherwise
`mongodb-memory-server` is used (it downloads a MongoDB binary on first run), and the test is skipped if neither works.
