# Development

[简体中文](development.zh-CN.md)

How the repository is laid out, how to run it for development, and where to make the common kinds of change.

## Repository layout

```
loomcanvas/
├─ server/                 Node.js + Express + Mongoose (CommonJS)
│  ├─ src/
│  │  ├─ index.js          boot and shutdown
│  │  ├─ app.js            Express wiring: middleware order, routes, static frontend
│  │  ├─ config.js         every environment variable, parsed once
│  │  ├─ constants.js
│  │  ├─ routes/           HTTP endpoints
│  │  ├─ models/           Mongoose models
│  │  ├─ providers/        vendor modules, registry, catalog/ (model lists and their validator)
│  │  ├─ runner/           run queue, deadlines, result transfer, pricing
│  │  ├─ storage/          storage layer: local disk and S3-compatible buckets, key generation
│  │  ├─ billing/          billing hook loader (no-op by default)
│  │  ├─ services/         accounts and sessions, settings, storage settings, media, image tools, seed, retention, canvas graph
│  │  ├─ cli/              reset-password.js
│  │  ├─ middleware/       sessions and roles, locale, errors, security headers
│  │  ├─ i18n/             server messages: en.js, zh-CN.js
│  │  └─ utils/            crypto, safeFetch, sniff, validate, workflowSchema
│  └─ test/                node:test suites
├─ web/                    Vue 3 + Vite + TypeScript + Vue Flow + TDesign
│  ├─ src/
│  │  ├─ views/            Landing, Login, Register, Setup, Workbench, CanvasList, Canvas, Assets, Models, History, Settings, CanvasShareView, NotFound
│  │  ├─ components/AppShell.vue  top bar and sidebar around every signed-in page
│  │  ├─ components/canvas/    nodes and dialogs of the editor
│  │  ├─ components/models/    the Models page: provider form, custom models, prices
│  │  ├─ components/history/   the History page: details and clean-up dialogs
│  │  ├─ components/settings/  sections of the Settings page
│  │  ├─ components/workbench/, landing/, auth/  parts of the workbench, the landing page and the sign-in pages
│  │  ├─ composables/      executor, batch, history, layout…
│  │  ├─ utils/            api.ts, canvasModels.ts…
│  │  ├─ locales/          zh-CN.ts, en.ts, modules/*.ts
│  │  ├─ stores/           Pinia store (bootstrap, signed-in user, locale)
│  │  └─ router/           routes and the sign-in guard
│  └─ scripts/check-i18n.mjs
├─ scripts/                repository checks (versions, licenses)
├─ docs/
├─ Dockerfile
├─ docker-compose.yml
└─ package.json            convenience scripts for the whole repository
```

## Setup

You need Node.js 20.9 or newer and a MongoDB 7 you can reach.

1. Start a MongoDB if you do not have one:

   ```bash
   docker run -d --name loomcanvas-mongo -p 127.0.0.1:27017:27017 mongo:7.0
   ```

2. Backend:

   ```bash
   cd server
   npm install
   cp .env.example .env
   ```

   Edit `server/.env`: set `SECRET_KEY` (16+ characters). The default `MONGODB_URI` points at `127.0.0.1:27017`. Then:

   ```bash
   npm run dev
   ```

   The API listens on <http://localhost:3000> and restarts when a file changes.

3. Frontend, in a second terminal:

   ```bash
   cd web
   npm install
   npm run dev
   ```

   Open <http://localhost:5173>.

## Scripts

| Where | Command | What it does |
| --- | --- | --- |
| `server/` | `npm run dev` | Start with `node --watch`. |
| `server/` | `npm start` | Start without watching. |
| `server/` | `npm test` | Run all tests with `node --test`. |
| `web/` | `npm run dev` | Vite dev server on port 5173. |
| `web/` | `npm run build` | Type-check (`vue-tsc --noEmit`), then build into `web/dist`. |
| `web/` | `npm run typecheck` | Type-check only. |
| `web/` | `npm run i18n:check` | Check the UI strings (see [Adding UI strings](#adding-ui-strings)). |
| `web/` | `npm run preview` | Serve the built `web/dist` locally. |
| root | `npm run install:all` | `npm ci` in `server/` and `web/`. |
| root | `npm run test`, `build`, `typecheck`, `i18n:check` | The same commands as in `server/` and `web/`, callable from the root. |
| root | `npm run check` | Version check, license check, i18n check, server tests and web build in one go. This is what CI runs. |
| root | `npm run versions:check` | `server/` and `web/` must carry the same version and Node floor as the root `package.json`. |
| root | `npm run licenses:check` | Production dependencies must be within the license allowlist and `THIRD_PARTY_NOTICES.md` must be current. Needs `npm ci` to have been run in `server/` and `web/`. |
| root | `npm run licenses:write` | Regenerates `THIRD_PARTY_NOTICES.md`. Run it after changing dependencies. |

There is no linter.

### Tests

```bash
cd server
npm test
```

- Unit tests need nothing but Node.
- The end-to-end tests (`api.e2e.test.js`, `security.e2e.test.js`, `vendors.e2e.test.js`, `accounts.e2e.test.js`) need a MongoDB. Set `TEST_MONGODB_URI` to use one you run; each run creates its own databases. Without it, `mongodb-memory-server` is tried, which downloads a MongoDB binary on first use. If neither works, those tests are skipped, not failed.

  ```bash
  TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
  ```

- Vendor modules are tested against a fake upstream started inside the test; see [Writing a provider](writing-a-provider.md#testing-against-a-fake-upstream). No test calls a real model API; the fixtures of the tests named "real service" in `server/test/providers.test.js` are answers recorded from the Gaorui service on 2026-10-10.
- The S3 storage tests against a real service are skipped unless `TEST_S3_ENDPOINT` is set; see [Live S3 tests](#live-s3-tests).

The frontend has no unit tests. `npm run build` (type-check) and `npm run i18n:check` are its gates.

### Live S3 tests

`server/test/storage.test.js` covers the storage layer without a network: validation, addressing, lookup, switching, precedence, the encrypted secret, the settings logic, error classification. It runs with `npm test` like every other unit test.

`server/test/storage.live.test.js` runs the same layer against a real S3 API. Nothing in it is mocked: objects are written to and read from the service named by the environment. Without `TEST_S3_ENDPOINT` every test in the file is reported as skipped, which is what happens in CI.

| Variable | Meaning |
| --- | --- |
| `TEST_S3_ENDPOINT` | For example `http://127.0.0.1:9000` (MinIO). Turns the live tests on. |
| `TEST_S3_BUCKET` | An existing, private bucket. |
| `TEST_S3_ACCESS_KEY_ID`, `TEST_S3_SECRET_ACCESS_KEY` | A credential that may read, write, delete and list in it. |
| `TEST_S3_REGION` | Default `us-east-1`. |
| `TEST_S3_FORCE_PATH_STYLE` | Default `true`. |
| `TEST_S3_VHOST_ENDPOINT` | Optional. An endpoint where `<bucket>.<host>` resolves, to exercise virtual-hosted addressing. |
| `TEST_S3_PUBLIC_BUCKET`, `TEST_S3_PUBLIC_BASE_URL` | Optional. A bucket anyone can read and the address it is read at, to exercise `redirect` delivery. |
| `TEST_MONGODB_URI` | Needed by the test that goes through the settings API (there is no in-memory fallback for this one). |

A MinIO to test against:

```bash
docker run -d --name loomcanvas-minio -p 9000:9000 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin minio/minio server /data
```

Create the buckets with `mc` (here from the `minio/mc` image, sharing the MinIO container's network):

```bash
docker run --rm --network container:loomcanvas-minio --entrypoint sh minio/mc -c "mc alias set local http://127.0.0.1:9000 minioadmin minioadmin && mc mb local/loomcanvas-test && mc mb local/loomcanvas-public && mc anonymous set download local/loomcanvas-public"
```

Run the live tests:

```bash
cd server
TEST_S3_ENDPOINT=http://127.0.0.1:9000 \
TEST_S3_BUCKET=loomcanvas-test \
TEST_S3_ACCESS_KEY_ID=minioadmin \
TEST_S3_SECRET_ACCESS_KEY=minioadmin \
TEST_S3_PUBLIC_BUCKET=loomcanvas-public \
TEST_S3_PUBLIC_BASE_URL=http://127.0.0.1:9000/loomcanvas-public \
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 \
node --test test/storage.live.test.js
```

Each run writes under its own prefix (`loomcanvastest/<random>/`) and removes what it wrote. The suite can be pointed at another S3-compatible service the same way; so far it has only been run against MinIO. If you run it against AWS S3, R2 or OSS, please report the result.

### CI

`.github/workflows/ci.yml` runs on pushes to `main` / `master` and on pull requests. It has two jobs:

- **check**, on Node 20 and Node 22, with a MongoDB 7 service and `TEST_MONGODB_URI` pointing at it: `npm run install:all`, then `npm run check`. No S3 service is started, so the live S3 tests are skipped there.
- **docker**: builds the image and starts the Compose stack, then checks that `/api/app/bootstrap` answers, that the web app is served, and that the process does not run as root.

There is no other pipeline (none for Gitee).

### Dependencies and licenses

- The Node floor is `>=20.9.0` in all three `package.json` files; `sharp` requires it. `npm run versions:check` keeps the version, the Node floor and the license field of `server/` and `web/` equal to the root.
- Both lockfiles resolve from `registry.npmjs.org`. Keep it that way when you update them.
- `THIRD_PARTY_NOTICES.md` is generated by `npm run licenses:write` from the lockfiles; do not edit it by hand. `npm run licenses:check` fails when a production dependency carries a license outside the allowlist in `scripts/licenses.mjs`, or when the file is out of date.
- libvips (LGPL-3.0-or-later; a prebuilt library that `sharp` loads dynamically) is recorded in that script as a reviewed exception. MongoDB (SSPL) is not a dependency of the code: it runs as a separate service.

## How the frontend talks to the backend

- All calls go through one axios instance in `web/src/utils/api.ts`, with `baseURL: '/api'`. Functions are grouped by area (`workflowApi`, `adminApi`, `filesApi`…).
- In development the Vite server proxies `/api` and `/files` to `http://127.0.0.1:3000` (`web/vite.config.ts`), so the browser sees one origin and no CORS setup is needed. In production the server serves the built frontend itself (`WEB_DIST`).
- Every request carries `X-Locale` (the current UI language) and, when signed in, `Authorization: Bearer <token>`.
- Every response is the envelope `{ result, message, data }`; `unwrap()` returns `data` or throws. A `401` clears the token and shows the sign-in page.
- Runs are asynchronous: the frontend posts a run, then polls `POST /api/runs/status` with the ids it is waiting for. There are no WebSockets.
- Types shared by the API layer are in `web/src/types/index.ts`.

The contract is documented in [architecture.md](architecture.md) (Chinese, design) and [api.md](api.md) (English, reference). Change them in the same pull request as the code.

## Adding a node type

A node type is a string id such as `fit-size`. These places know about node types:

| File | What to add |
| --- | --- |
| `web/src/components/canvas/<Name>Node.vue` | The node component. Start from a similar one; shared styles are in `node-shared.css` and `tool-node.css`. |
| `web/src/views/Canvas.vue` | The `NodeKind` union, the `nodeTypes` map, the title key and icon maps, the add-panel group it appears in, and its default `data`. Search for an existing id such as `'fit-size'` to find all of them. |
| `web/src/views/CanvasShareView.vue` | The list of node types the read-only share page renders. |
| `web/src/composables/useCanvasExecutor.ts` | How the node runs: what it reads from upstream, which endpoint it calls, what it writes back. |
| `web/src/utils/canvasMedia.ts`, `web/src/components/canvas/OutputNode.vue`, `ShareNode.vue` | Title key, and how the node's result is collected by Output nodes. |
| `web/src/locales/zh-CN.ts`, `en.ts` | `nodes.title.<name>` and any other strings. |
| `server/src/services/canvasGraph.js` | `IMAGE_COVER_ORDER` / `VIDEO_COVER_ORDER`, if the node's result may serve as the canvas cover. The zip export picks up `imageUrl`, `imageUrls`, `videoUrl`, `videoUrls` from any node. |
| `server/src/routes/canvas.js`, `server/src/services/imageTools.js` | Only for a tool node that needs server-side processing. |

Rules that keep canvases compatible:

- Connections must carry `sourceHandle` and `targetHandle`. Existing handle ids: `text-out`, `text-in`, `image-out`, `image-in`, `image-last-in`, `video-out`, `video-in`. Input handles end in `-in`; the connection check relies on that suffix.
- Store only media URLs in node data, never inline base64.
- If you change the shape of data that existing canvases already contain, see [Canvas schema version](#canvas-schema-version-and-migrations).

Adding a **model** is not adding a node type: it needs an entry in a vendor's catalog (`server/src/providers/catalog/<vendor>.json`, with its description key in both server message catalogs), or a new vendor module, not canvas changes. A model's kind is the catalog section it is written in; no code may work it out from the name. See [Writing a provider](writing-a-provider.md).

## Adding UI strings

UI text lives in `web/src/locales/`: `zh-CN.ts` and `en.ts` hold the common groups and import the larger groups from `modules/*.ts`, where each module exports `{ 'zh-CN': {…}, en: {…} }`.

1. Add the key to **both** languages.
2. Use it: `t('group.key')` from `useI18n()` in components, or `t` imported from `@/locales` elsewhere.
3. Run the check:

   ```bash
   cd web
   npm run i18n:check
   ```

The script (`web/scripts/check-i18n.mjs`) exits with code 1 when:

- a file outside `src/locales/` contains Chinese characters outside comments,
- a key exists in only one of the two languages, or
- code uses a `t('a.b.c')` key that the locale files do not have.

It prints its findings in Chinese.

## Adding server messages

Everything the server says to a user is a key in `server/src/i18n/en.js` and `zh-CN.js`. Code never contains the sentence itself:

```js
throw badRequest('validation.max_items', { field: 'ids', max: 100 })
throw new RunError('TIMEOUT', 'run.timeout_generate')
```

1. Add the key to **both** catalogs, with the same `{placeholders}`.
2. Use it through `badRequest()`, `notFound()`, `new ApiError()`, `new ProviderError()`, `new RunError()`, or `msg()` for a message that is stored or nested.
3. Run `npm test` in `server/`.

`server/test/i18n.test.js` fails when the two catalogs differ in keys or placeholders, when code uses a key that does not exist, when a catalog key is not used anywhere, or when `server/src` contains Chinese outside `i18n/zh-CN.js`, `services/seed.js` and comments.

Text from an upstream is never translated; pass it as a parameter (`{detail}`). Server logs are English and do not go through the catalog.

## Canvas schema version and migrations

Every stored canvas carries `schemaVersion`. The current value and the migrations are in `server/src/utils/workflowSchema.js`.

- `CURRENT_SCHEMA_VERSION` is `1`.
- `MIGRATIONS[n]` is a pure function that takes a canvas at version `n` and returns it at version `n + 1`. Canvases without a version count as `0`.
- Migration is lazy: `GET /api/workflow/:id` (and duplicate, zip export) upgrades an old canvas step by step and writes it back. There is no batch job.
- A canvas from a **newer** version than the server knows is returned untouched, not downgraded.
- Saving nodes stamps the current version, because the client always writes the current shape.

To change the saved shape of nodes or edges:

1. Bump `CURRENT_SCHEMA_VERSION`.
2. Add `MIGRATIONS[<old version>]`. Do not mutate the input.
3. Add a case to `server/test/workflowSchema.test.js`.
4. Update the frontend to read and write the new shape.

Share snapshots are stored separately and are **not** migrated by this mechanism. Keep the read-only share page tolerant of older snapshots.

Built-in templates and text snippets are seeded by `server/src/services/seed.js`. Bump `SEED_VERSION` there when you change them; on the next start the built-in canvas templates are overwritten, and missing text snippets are added.

## Conventions visible in the code

Server:

- CommonJS, `'use strict'`, no semicolons, two-space indent, single quotes.
- Each file starts with a comment that says what it is for and what it guarantees. Comments explain why, not what.
- Environment variables are read only in `config.js`. Other code calls `getConfig()`.
- Routes never trust the shape of `req.body` or `req.query`: validate with the helpers in `utils/validate.js`, and wrap async handlers in `wrap()`.
- Respond with `ok(res, data)`; fail by throwing an error with a catalog key. Unexpected errors are logged and answered with a generic message.
- Any URL that came from a user or from an upstream response is fetched through `utils/safeFetch.js`. Files are typed by content (`utils/sniff.js`), never by name or declared type.
- Storage keys are generated by `storage/keys.js`; nothing a user typed goes into a key.
- Files are read and written only through `getStorage()` (`storage/index.js`), which finds a file on whichever backend holds it. The address that is stored and returned is always `storage.urlFor(key)`, that is `/files/<key>`. A presigned URL (`storage.externalUrls()`) is for one upstream request: never store it, return it to a client or log it.
- Every per-account collection carries `userId`, the id of the account that owns the document, and every query on it carries `req.userId`: another account's document must answer 404, never 403 and never data. A new per-account collection has to be added to `OWNED` in `server/src/services/accounts.js` (adoption of pre-account data and deletion of an account walk that list) and to the isolation suite, `server/test/accounts.e2e.test.js`. Provider and model lookups go through `providers/index.js`, which refuses to run without an account id. Site-wide things (settings, storage, built-in templates) are changed by the owner only (`requireOwner`).
- The runner core (`runner/core.js`) takes its store, provider lookup, transfer and billing as injected dependencies, which is what makes it testable without a database.
- No new runtime dependency without a reason: headers, CORS and rate limiting are a few lines each rather than packages.

Web:

- Vue 3 `<script setup lang="ts">`, Composition API, no semicolons, single quotes.
- TDesign components are auto-imported by `unplugin-vue-components`; write `<t-button>` without importing it.
- `@/` is `web/src/`.
- No user-visible literal text in components: everything goes through `t()`.
- Colours and spacing come from `styles/design-tokens.css`. There is one dark theme; do not add a light variant or a theme switch.

Both:

- A change to the HTTP contract updates [architecture.md](architecture.md) and [api.md](api.md) in the same pull request.
- Before opening a pull request, run `npm run check` in the repository root. See [CONTRIBUTING.md](../CONTRIBUTING.md).
