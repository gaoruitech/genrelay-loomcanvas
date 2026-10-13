# react-host: the editor in a React app

[简体中文](README.zh-CN.md)

Shape 2 of [docs/integration.md](../../docs/integration.md) for a React host: a Vite + React + TypeScript project that imports the library the way a real project does, as the package `loomcanvas-web` (`"loomcanvas-web": "file:../../web"` in `package.json`). It is an example, not part of the production build: nothing in `web/` or `server/` depends on it, the Docker build leaves `examples/` out, and its dependencies are not in the shipped third-party notices (`npm run licenses:check` covers what ships; `npm run versions:check` does keep this package's version, licence and Node floor in line with the repository).

It integrates the editor four ways, one per tab of the host's header:

| Tab | File | What it shows |
| --- | --- | --- |
| Component · memory adapter | `src/LoomCanvasEditor.tsx` | `mountEditor` in an effect, `unmount()` in its clean-up, wrapped as a component with props, typed events and a ref. `createMemoryAdapter`: no server at all |
| Component · HTTP adapter | the same component | `createHttpAdapter` against a stock LoomCanvas server on another origin, with the host's own sign-in |
| Custom element | `src/LoomCanvasElement.tsx` | `<loom-canvas-editor>` written in JSX: the typing for the tag, the `options` property through a ref, attributes, DOM events |
| Minimal snippet | `src/MinimalEditor.tsx` | The short snippet printed in the integration guide, as it is |

## Running it

```bash
# 1. build the library (once, and again after changing web/src)
cd web && npm ci && npm run build:lib && cd ..

# 2. install and start the example (http://127.0.0.1:5173)
cd examples/react-host
npm install
npm run dev
```

`PORT=5180 npm run dev` uses another port. `npm run typecheck` checks the example against the library's type declarations (`npm run build` does it too).

The first tab works right away. "Component · HTTP adapter" needs a LoomCanvas server that allows this page's origin:

```bash
# in another terminal, in the repository root: a LoomCanvas server on :3000
CORS_ORIGIN=http://127.0.0.1:5173 ADMIN_PASSWORD=change-me-please npm start     # see docs/getting-started.md
```

Sign in on that tab with a LoomCanvas account (`admin` and the password above). A server at another address: put `VITE_LC_API=https://your-server/api` into `examples/react-host/.env.local`, or append `?api=https://your-server/api` to the page address. `?space=<team id>` makes the adapter work in a team space instead of the personal one.

### The production build, under a strict Content-Security-Policy

```bash
npm run build        # type-checks, then writes dist/
npm run preview      # http://127.0.0.1:4174, served with the policy in csp.mjs
```

`node examples/serve.mjs` serves the same `dist/` at `http://127.0.0.1:4173/react-host/`, next to the other examples, with the same policy. The policy allows one API origin: the one in `VITE_LC_API` for `npm run preview`, the one in `LC_API` for `serve.mjs` (default for both: `http://127.0.0.1:3000/api`); remember to list the page's origin (`:4174` or `:4173`) in the server's `CORS_ORIGIN`. `npm run dev` sends no policy, because React's fast refresh needs an inline script.

`csp.mjs` is the policy the integration guide says an embedded editor needs: no `unsafe-eval`, no inline script, `style-src 'unsafe-inline'` for style attributes, the API origin for `connect-src` / `img-src` / `media-src`, `blob:` and `data:` for previews, `font-src 'self'` for `fonts.css`.

## What to look at

- `src/main.tsx`: `import 'loomcanvas-web/editor.css'` (required) and `'loomcanvas-web/fonts.css'` (optional). `<StrictMode>` is on, so in development every component is mounted, unmounted and mounted again.
- `src/LoomCanvasEditor.tsx`: the component to copy.
  - It imports `loomcanvas-web/standalone/editor`, which has Vue inside: a React project installs no Vue.
  - Options that are read at mount (`adapter`, `document`, `features`, `changeDebounceMs`, `storagePrefix`) are the dependencies of the mounting effect: a change mounts the editor again. Keep the adapter object stable (module scope or `useMemo`), or every render mounts a new editor.
  - `theme`, `locale`, `nodeLayout`, `readOnly` and `canvasId` are live: one small effect each calls `setTheme()`, `setLocale()`, `setNodeLayout()`, `setReadOnly()`, `setCanvasId()` on the mounted editor.
  - Event handlers go through a ref, so passing new functions on every render remounts nothing.
  - The ref exposes `addNode`, `runAll`, `runNode`, `undo`, `redo`, `fitView`, `getDocument`, `setDocument`, `save`.
  - `document` is the initial document: the editor is uncontrolled. Keep your own copy from `change`.
- `src/App.tsx`: editor events become React state (`ready`, node and edge counts from `change`, `selection`, `saved`); the host's toolbar drives the editor. In the HTTP tab the editor gets `key={canvasId}`: `canvasId` is a live prop, but `ready` is announced once per mount, and this host wants it for every canvas. The HTTP adapter is created once per session and keeps that session's token: signing out unmounts the editor, and the save it sends on its way out is still authenticated.
- `src/LoomCanvasElement.tsx`: the custom element. `declare module 'react'` teaches JSX the tag; `options` is set through a ref because it is a property, not an attribute; `read-only` is present or absent; events do not bubble, so the listeners are on the element.
- Feature switches (the panel on the right): the first group is on by default, the second needs `features` and an adapter that can serve it. With the memory adapter `templates`, `assetLibrary`, `brandKit`, `share`, `batchDownload` and `canvasSwitch` stay off whatever you tick, because it has nothing behind them; with the HTTP adapter all of them work.
- "mounted": unmounts the editor and mounts it again. Nothing is left behind: the mount element is empty, and no element or style was ever added to `<head>` or `<body>`.

## What is real and what is simplified

- The sign-in form calls `POST /api/auth/login` from the browser to obtain a token. That keeps the example self-contained; in a product your backend does this. See "Authentication" in the integration guide.
- `"loomcanvas-web": "file:../../web"` links the folder. From another repository, run `npm pack` in `web/` and install the tarball, or point `file:` at your checkout. Because of the link, the library build is outside this project: `vite.config.ts` finds where it really is and lets the dev server read it (a package installed from a tarball needs none of that).
- The package's type declarations mention Vue (for the `<LoomCanvasEditor>` Vue component). A React project without Vue keeps `"skipLibCheck": true` in `tsconfig.json`, as this one does.
