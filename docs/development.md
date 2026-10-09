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
│  │  ├─ providers/        provider plugins, registry, catalog/*.json
│  │  ├─ runner/           run queue, deadlines, result transfer, pricing
│  │  ├─ storage/          local / s3 / oss drivers, key generation
│  │  ├─ billing/          billing hook loader (no-op by default)
│  │  ├─ services/         settings, media, image tools, seed, retention, canvas graph
│  │  ├─ middleware/       auth, locale, errors, security headers
│  │  ├─ i18n/             server messages: en.js, zh-CN.js
│  │  └─ utils/            crypto, safeFetch, sniff, validate, workflowSchema
│  └─ test/                node:test suites
├─ web/                    Vue 3 + Vite + TypeScript + Vue Flow + TDesign
│  ├─ src/
│  │  ├─ views/            CanvasList, Canvas, CanvasShareView, Settings, Setup, NotFound
│  │  ├─ components/canvas/    nodes and dialogs of the editor
│  │  ├─ components/settings/  tabs of the Settings page
│  │  ├─ composables/      executor, batch, history, layout…
│  │  ├─ utils/            api.ts, canvasModels.ts…
│  │  ├─ locales/          zh-CN.ts, en.ts, modules/*.ts
│  │  ├─ stores/           Pinia store (app state, theme, locale)
│  │  └─ router/
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
- The end-to-end tests (`api.e2e.test.js`, `security.e2e.test.js`) need a MongoDB. Set `TEST_MONGODB_URI` to use one you run; each run creates its own databases. Without it, `mongodb-memory-server` is tried, which downloads a MongoDB binary on first use. If neither works, those tests are skipped, not failed.

  ```bash
  TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
  ```

- Providers are tested against a fake upstream started inside the test; see [Writing a provider](writing-a-provider.md#testing-against-a-fake-upstream). No test calls a real model API.

The frontend has no unit tests. `npm run build` (type-check) and `npm run i18n:check` are its gates.

### CI

`.github/workflows/ci.yml` runs on pushes to `main` / `master` and on pull requests. It has two jobs:

- **check**, on Node 20 and Node 22, with a MongoDB 7 service and `TEST_MONGODB_URI` pointing at it: `npm run install:all`, then `npm run check`.
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
- Every response is the envelope `{ result, message, data }`; `unwrap()` returns `data` or throws. A `401` clears the token and shows the password screen.
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

Adding a **model** is not adding a node type: it needs a catalog entry or a provider, not canvas changes. See [Writing a provider](writing-a-provider.md).

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
- Every collection carries `userId`, always the constant `local`, so multi-user support can be added later without a data migration.
- The runner core (`runner/core.js`) takes its store, provider lookup, transfer and billing as injected dependencies, which is what makes it testable without a database.
- No new runtime dependency without a reason: headers, CORS and rate limiting are a few lines each rather than packages.

Web:

- Vue 3 `<script setup lang="ts">`, Composition API, no semicolons, single quotes.
- TDesign components are auto-imported by `unplugin-vue-components`; write `<t-button>` without importing it.
- `@/` is `web/src/`.
- No user-visible literal text in components: everything goes through `t()`.
- Colours and spacing come from `styles/design-tokens.css`; both themes must work.

Both:

- A change to the HTTP contract updates [architecture.md](architecture.md) and [api.md](api.md) in the same pull request.
- Before opening a pull request, run `npm run check` in the repository root. See [CONTRIBUTING.md](../CONTRIBUTING.md).
