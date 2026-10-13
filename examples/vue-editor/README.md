# vue-editor: `<LoomCanvasEditor>` in a Vue app

[简体中文](README.zh-CN.md)

Shape 2 of [docs/integration.md](../../docs/integration.md) for a Vue 3 host, backed by a stock LoomCanvas server through `createHttpAdapter`.

Run it as described in [../README.md](../README.md), then open `http://127.0.0.1:4173/vue-editor/`.

What to look at:

- `index.html`: the import map. `loomcanvas-web/editor` leaves `vue` to the host (peer dependency), so host and editor use one copy of Vue. A bundler resolves it from `node_modules`; this page maps it by hand.
- `main.js`, `signIn()`: the host signs in its own way, then builds **one** adapter with `createHttpAdapter({ apiBase, getAuth })`. Which canvases exist, creating one, and choosing which one is open are the host's business (it calls `/api/workflow` itself); the editor edits the one named by `canvas-id`.
- `main.js`, `enterSpace()`: the space selector lists the personal space and the account's teams. An adapter belongs to one space, so choosing another builds a new one with `createHttpAdapter({ space })` (it sends `X-Space` with every request) and the editor is remounted with it (`:key="space"`). The host's own calls to `/api/workflow` carry the same header.
- In a team space the editor takes turns, with nothing more to do in the host: if somebody else is editing the canvas it opens read-only and says who, with "make a copy" and "take over"; a save that started from an older version asks what to do. Try it with two accounts of one team in two browsers.
- The `created` event fires when the editor stored its document as a new canvas ("make a copy", "save my version as a copy"); the host reloads its list of canvases.
- The template: `canvas-id`, `theme`, `locale`, `node-layout` and `read-only` are reactive props; events arrive as component events; `ref="editor"` exposes `addNode`, `runAll`, `undo`, `redo`, `fitView`, `getDocument`.
- `features: { cost: true, templates: true }` opts in to two features the HTTP adapter can serve. Everything else of the product (share, brand kits, the asset library, batch run, model management, the theme and language menus) stays out.
- The editor fills `.box`; "narrow" shrinks it to 480 px and the editor switches to its narrow layout.

The component is a thin wrapper around `mountEditor`: the editor runs as its own Vue application inside the element, so nothing of LoomCanvas (Pinia, vue-i18n, router) is installed on the host app.

In a real project with a bundler:

```js
import { LoomCanvasEditor, createHttpAdapter } from 'loomcanvas-web/editor'
import 'loomcanvas-web/editor.css'
import 'loomcanvas-web/fonts.css' // optional
```
