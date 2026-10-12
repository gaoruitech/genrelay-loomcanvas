# Integration examples

[简体中文](README.zh-CN.md)

Three small "host products" that build LoomCanvas in. They go with [docs/integration.md](../docs/integration.md). None of them is part of the production build: they are plain files served by a tiny static server, and they load the library from `web/dist-lib/`.

| Folder | Shape | Host | Backend | What it shows |
| --- | --- | --- | --- | --- |
| [host-page](host-page/) | 1: the whole app | Plain HTML + ES module | Stock LoomCanvas server (another origin) | `shell: 'none'`, the host's own header, navigation and sign-in feeding `getAuth`, a page allow-list, theme and language driven by the host, a second instance, `onAuthRequired`. The host page's CSS is deliberately aggressive |
| [vue-editor](vue-editor/) | 2: the editor | Vue 3 app | Stock LoomCanvas server through `createHttpAdapter` | `<LoomCanvasEditor>` with reactive props, events and the methods on the component ref. One Vue shared by host and editor |
| [plain-editor](plain-editor/) | 2: the editor | Plain HTML, no framework | None: `createMemoryAdapter` | `mountEditor` with a document passed in, `onChange`, every imperative method, `readOnly`, node layouts. Nothing depends on a LoomCanvas server |

## Running them

```bash
# 1. build the library
cd web && npm ci && npm run build:lib && cd ..

# 2. serve the examples (http://127.0.0.1:4173)
node examples/serve.mjs
```

`plain-editor` works right away. The other two need a LoomCanvas server that allows the examples' origin:

```bash
# in another terminal: a LoomCanvas server on :3000 that accepts calls from the examples
CORS_ORIGIN=http://127.0.0.1:4173 ADMIN_PASSWORD=change-me-please npm start     # see docs/getting-started.md
```

Open `http://127.0.0.1:4173/`, pick an example and sign in with a LoomCanvas account (`admin` and the password above). Add a provider on the server first (Models page of the stand-alone app at `http://127.0.0.1:3000`), otherwise there are no models to run.

A server at another address: append `?api=https://your-server/api` to the example's address.

## What is real and what is simplified

- The sign-in forms of `host-page` and `vue-editor` call `POST /api/auth/login` from the browser to obtain a token. That is a shortcut to keep the examples self-contained. In a product, your backend authenticates your own user and obtains what the canvas API expects; the page only receives the result. See "Authentication" in the integration guide.
- The examples import the library by path (`/lib/...`). With a bundler you would import `loomcanvas-web/app` / `loomcanvas-web/editor` and the CSS files from the package.
- `serve.mjs` is for these examples only.
