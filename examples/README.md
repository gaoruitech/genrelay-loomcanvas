# Integration examples

[简体中文](README.zh-CN.md)

Four small "host products" that build LoomCanvas in. They go with [docs/integration.md](../docs/integration.md). None of them is part of the production build. Three are plain files served by a tiny static server and load the library from `web/dist-lib/`; the React one is a small Vite project of its own that imports the library as a package.

| Folder | Shape | Host | Backend | What it shows |
| --- | --- | --- | --- | --- |
| [host-page](host-page/) | 1: the whole app | Plain HTML + ES module | Stock LoomCanvas server (another origin) | `shell: 'none'`, the host's own header, navigation and sign-in feeding `getAuth`, a page allow-list, theme and language driven by the host, a second instance, `onAuthRequired`. A "Space" selector in the host's navigation pins the app to the personal space or to a team (`space`). The host page's CSS is deliberately aggressive |
| [vue-editor](vue-editor/) | 2: the editor | Vue 3 app | Stock LoomCanvas server through `createHttpAdapter` | `<LoomCanvasEditor>` with reactive props, events and the methods on the component ref. One Vue shared by host and editor. A space selector builds `createHttpAdapter({ space })`; in a team space the editor shows the edit lock and save conflicts |
| [plain-editor](plain-editor/) | 2: the editor | Plain HTML, no framework | None: `createMemoryAdapter` | `mountEditor` with a document passed in, `onChange`, every imperative method, `readOnly`, node layouts. Nothing depends on a LoomCanvas server |
| [react-host](react-host/) | 2: the editor | React 19 app (Vite, TypeScript) | None (`createMemoryAdapter`), or the stock LoomCanvas server through `createHttpAdapter` | `mountEditor` in an effect, wrapped as a React component (props, typed events, a ref, safe under StrictMode); the custom element `<loom-canvas-editor>` in JSX with its typing; every feature switch as a checkbox; the production build served under a strict Content-Security-Policy |

## Running them

```bash
# 1. build the library
cd web && npm ci && npm run build:lib && cd ..

# 2. serve the examples (http://127.0.0.1:4173)
node examples/serve.mjs
```

`plain-editor` works right away. `host-page` and `vue-editor` need a LoomCanvas server that allows the examples' origin:

```bash
# in another terminal: a LoomCanvas server on :3000 that accepts calls from the examples
CORS_ORIGIN=http://127.0.0.1:4173 ADMIN_PASSWORD=change-me-please npm start     # see docs/getting-started.md
```

Open `http://127.0.0.1:4173/`, pick an example and sign in with a LoomCanvas account (`admin` and the password above). Add a provider on the server first (Models page of the stand-alone app at `http://127.0.0.1:3000`), otherwise there are no models to run.

A server at another address: append `?api=https://your-server/api` to the example's address.

`PORT=5000 node examples/serve.mjs` uses another port (then put that origin into `CORS_ORIGIN`). `LC_LIB=/path/to/a/build node examples/serve.mjs` serves another library build than `web/dist-lib`, for instance one made with `node scripts/build-lib.mjs --out=<dir>` in `web/`.

`react-host` is built with a bundler, so it has two more steps of its own (`npm install`, then `npm run dev`, or `npm run build` to have `serve.mjs` serve it at `/react-host/` next to the others). They are in [react-host/README.md](react-host/README.md); its first tab needs no server either.

## What is real and what is simplified

- The sign-in forms of `host-page`, `vue-editor` and `react-host` call `POST /api/auth/login` from the browser to obtain a token. That is a shortcut to keep the examples self-contained. In a product, your backend authenticates your own user and obtains what the canvas API expects; the page only receives the result. See "Authentication" in the integration guide.
- The three plain examples import the library by path (`/lib/...`). With a bundler you import `loomcanvas-web/app` / `loomcanvas-web/editor` and the CSS files from the package, as `react-host` does.
- `serve.mjs` is for these examples only.
