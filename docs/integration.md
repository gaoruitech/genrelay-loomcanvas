# Building LoomCanvas into your own product

[简体中文](integration.zh-CN.md)

> Status: early development. The integration API described here is at version 0.1: it is tested and documented, but until the first tagged release it may still change (see [Compatibility](#compatibility)).

LoomCanvas can run on its own (`docker compose up`), and it can be built into another web product. This page is for developers doing the second.

What you get is code and its documentation: two entry points you compile into your own front end. Everything around them is yours: your users, your sign-in, your backend wiring, your API keys, your branding, your deployment. LoomCanvas does not host anything for you, does not provide single sign-on, and does not need to know your users exist. The project maintains the entry points and keeps them working.

Contents: [The two shapes](#the-two-shapes) · [Getting the files](#getting-the-files) · [Shape 1: the whole app](#shape-1-the-whole-app) · [Shape 2: the editor](#shape-2-the-editor) · [The adapter](#the-adapter) · [The document format](#the-document-format) · [Feature switches](#feature-switches) · [Style isolation](#style-isolation) · [Theme, language, branding](#theme-language-branding) · [Authentication](#authentication) · [Server notes](#server-notes) · [Compatibility](#compatibility) · [Licensing](#licensing) · [Limits](#limits)

## The two shapes

| | Shape 1: the whole app | Shape 2: the editor |
| --- | --- | --- |
| What it is | The complete single-page application (canvas list, editor, assets, models, history, settings: the pages you choose), mounted inside an element of your page | Only the canvas editor: the canvas, the tool palette, nodes, wires, running, results, the queue button, undo and redo, zoom, arrange, the minimap |
| Entry | `loomcanvas-web/app` → `mountLoomCanvas(el, options)` | `loomcanvas-web/editor` → `mountEditor(el, options)`, the Vue component `<LoomCanvasEditor>`, the custom element `<loom-canvas-editor>` |
| Backend | A server that speaks the LoomCanvas API ([api.md](api.md)); normally the stock server, behind your gateway if you like | Anything: you supply an **adapter** (a handful of functions). Ready-made: one for the stock server, one that needs no server |
| Sign-in | Yours (`getAuth`), or LoomCanvas' own pages if you give none | Yours: the adapter makes the calls |
| LoomCanvas' top bar and sidebar | `shell: 'full'` or `'none'` | Never |
| List of canvases, accounts, settings pages | Yes (the ones in `pages`) | No. Which canvas is open is your decision |
| Use it when | You want the product as it is, inside yours, and keep its server | You want canvas editing as a feature of your product and own the data model around it |

Both are the same code as the stand-alone app: the stand-alone app is itself a consumer of these entries (`web/src/main.ts` calls the same start-up code as `mountLoomCanvas`).

## Getting the files

Nothing is published to npm. Build the library from the repository:

```bash
cd web
npm ci
npm run build:lib        # -> web/dist-lib/
```

| File | What it is |
| --- | --- |
| `app.js`, `editor.js` | The two entries as ES modules. `vue` is left as an import (peer dependency, `^3.4`) |
| `standalone/app.js`, `standalone/editor.js` | The same entries with Vue inside, for pages without a bundler or hosts that do not use Vue |
| `chunks/`, `standalone/chunks/` | Code loaded on demand (the app loads each page when it is first opened; the editor is one file) |
| `app.css`, `editor.css` | One stylesheet per entry. Required |
| `fonts.css`, `fonts/` | Optional: the three self-hosted fonts (see [Fonts](#fonts)) |
| `types/` | TypeScript declarations |
| `licenses/fonts-OFL-1.1.txt` | Licence text of the fonts; ship it when you ship the fonts |

Ways to consume it:

- With a bundler: `npm pack` in `web/` (or reference the folder with `"loomcanvas-web": "file:../loomcanvas/web"`) and import `loomcanvas-web/app`, `loomcanvas-web/editor`, `loomcanvas-web/app.css`, `loomcanvas-web/editor.css`, `loomcanvas-web/fonts.css`. The package's `exports` map points at `dist-lib/`.
- Without a bundler: copy `dist-lib/` to your static files and import `…/dist-lib/standalone/app.js` from a `<script type="module">`. Keep the folder together: entries load their chunks by relative path, and nothing in it refers to an absolute path such as `/assets`, so it works from any base address.

Why Vue is a peer dependency in the default entries: `<LoomCanvasEditor>` is rendered by your application's Vue, and two copies of Vue in one page do not share reactivity. Everything else LoomCanvas uses (vue-router, Pinia, vue-i18n, Vue Flow, TDesign, axios) is bundled and private to it: it runs as its own Vue application inside your element and installs nothing on yours. If your host is not a Vue application, use the `standalone/` entries and ignore Vue altogether.

Sizes of version 0.1 (minified; gzip in brackets): `editor.js` 1.49 MB (401 kB), `editor.css` 440 kB (51 kB); the app entry loads a 686 kB (202 kB) core chunk plus a chunk per page (the editor page adds about 800 kB, 200 kB gzipped), `app.css` 719 kB (84 kB); Vue adds about 135 kB (40 kB) in the `standalone/` variants.

Runnable examples are in [`examples/`](../examples/README.md).

## Shape 1: the whole app

```js
import { mountLoomCanvas } from 'loomcanvas-web/app'
import 'loomcanvas-web/app.css'

const lc = mountLoomCanvas(document.getElementById('canvas'), {
  apiBase: 'https://canvas.example.com/api',
  getAuth: async () => ({ Authorization: `Bearer ${await mySession.token()}` }),
  onAuthRequired: () => mySession.signIn(),
  user: { name: 'Ada Lovelace' },
  shell: 'none',
  pages: ['canvases', 'canvas', 'assets'],
  features: { share: false },
})

lc.on('route', ({ name, path }) => myRouter.sync(path))
lc.navigate('canvas', { id: 'abc' })
```

The mount element must have a size (for example `height: 640px`, or be a flex or grid cell): LoomCanvas fills its container and does not size itself from its content. A warning is logged when the element has no height.

### Options of `mountLoomCanvas(el, options)`

All optional.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `apiBase` | string | `/api` | Base address of the LoomCanvas-compatible API |
| `fileBase` | string | origin of `apiBase` | Origin that serves `/files/<key>` |
| `getAuth` | `() => headers \| Promise<headers>` | none | Your authentication: request headers, asked before every call. When given, LoomCanvas never shows its landing, sign-in, register or password pages and stores no token |
| `onAuthRequired` | `() => void` | none | Called when the API answers 401 (with `getAuth`); at most once per second |
| `user` | `{ name, id?, email?, avatarUrl?, role? }` | from `GET /api/bootstrap` | Who is signed in, as your system knows them; shown in the shell. `role: 'owner'` shows the site-management settings sections (their endpoints are owner-only on the server regardless) |
| `getUser` | `() => user \| Promise<user>` | none | The same, resolved at start-up |
| `routerMode` | `'memory' \| 'hash' \| 'history'` | `'memory'` | How navigation shows in the address bar: not at all, `#/canvases`, or real paths under `basePath` |
| `basePath` | string | `/` | Sub-path of your site the app lives under (hash and history modes) |
| `initialPage` | page name or in-app path | first allowed page | Where to start in memory mode |
| `onNavigate` | `(route) => void` | none | Called after every navigation; same payload as the `route` event |
| `shell` | `'full' \| 'none'` | `'full'` | `'none'`: page content only, no top bar and no sidebar; you provide navigation with `navigate()` |
| `pages` | page names | all | The pages that exist. Others are unreachable (by link, by `navigate()`, by address) and links to them are not rendered |
| `features` | partial [feature switches](#feature-switches) | all on | With `getAuth`, `account` and `externalLinks` start off |
| `nodeLayout` | `'a' \| 'b' \| 'c'` | `'a'` | Layout of generation nodes for a user without a stored preference |
| `brand` | `{ name?, logoUrl? } \| false` | site settings of the server | Name and logo in the shell; `false` removes the brand block |
| `theme` | `'dark' \| 'light' \| 'system'` | stored choice, else `'dark'` | Initial theme. Giving it makes the theme yours to control (`setTheme`) |
| `locale` | `'en' \| 'zh-CN'` | stored choice, else the browser's | Initial language. Giving it makes it yours to control (`setLocale`) |
| `messages` | `{ en?: {...}, 'zh-CN'?: {...} }` | none | Text overrides, merged over the built-in catalogue (same key paths as `web/src/locales/`) |
| `storagePrefix` | string | `loomcanvas-` | Prefix of every `localStorage` / `sessionStorage` key |
| `zIndex` | number | none | `z-index` of the mount root in your page |

Page names: `home` (workbench), `canvases`, `canvas`, `assets`, `brand-kits`, `models`, `history`, `settings`, `setup`, `share`.

### Handle

| Method | Meaning |
| --- | --- |
| `navigate(to, params?)` | Go to a page (`'canvases'`, `'canvas'` with `{ id }`) or an in-app path (`'/canvas/abc'`). A page outside `pages` is not entered |
| `setTheme(theme)` / `setLocale(locale)` | Change theme / language |
| `on(event, handler)` | Subscribe; returns an unsubscribe function |
| `unmount()` | Remove everything that was added to your element |

### Events

| Event | Payload | When |
| --- | --- | --- |
| `ready` | `{}` | The first page is on screen |
| `route` | `{ name, path, params }` | After every navigation |
| `canvas:saved` | `{ canvasId, updatedAt }` | A canvas was saved |
| `run:started`, `run:finished`, `run:failed` | `{ canvasId, nodeId, nodeType, runIds, error? }` | A node started / finished / failed running |
| `result` | `{ canvasId, nodeId, nodeType, outputs: [{ type, url }], text? }` | A node has a result |
| `error` | `{ scope, message, cause? }` | Bootstrap, load or `getUser` failed (`scope`: `bootstrap`, `load`, `auth`) |

### Routing

- `memory` (default): the address bar is yours. Mirror `route` into your own router if you want deep links, and call `navigate()` when your route changes.
- `hash`: `…/your/page#/canvas/abc`. Deep links and the back button work without server changes.
- `history`: real paths under `basePath`. Your server must answer those paths with your host page.

Only one mounted view should use `hash` or `history` on a page.

Share links (`/share/<token>`) are built from the app's own routes, so they need `hash` or `history` mode to be openable; in `memory` mode switch `features.share` off or handle the `share` page yourself.

## Shape 2: the editor

```js
import { mountEditor, createHttpAdapter } from 'loomcanvas-web/editor'
import 'loomcanvas-web/editor.css'

const editor = mountEditor(document.getElementById('editor'), {
  adapter: createHttpAdapter({ apiBase: '/api', getAuth: () => ({ Authorization: `Bearer ${token}` }) }),
  canvasId: 'abc',
})
editor.on('saved', ({ updatedAt }) => console.log('saved', updatedAt))
```

Vue:

```vue
<script setup>
import { ref } from 'vue'
import { LoomCanvasEditor, createHttpAdapter } from 'loomcanvas-web/editor'
import 'loomcanvas-web/editor.css'
const adapter = createHttpAdapter({ apiBase: '/api', getAuth: () => ({ Authorization: `Bearer ${token}` }) })
const editor = ref()
</script>

<template>
  <div style="height: 640px">
    <LoomCanvasEditor ref="editor" :adapter="adapter" :canvas-id="id" theme="light" @saved="onSaved" @result="onResult" />
  </div>
</template>
```

`<LoomCanvasEditor>` is a thin wrapper around `mountEditor`: the editor still runs as its own Vue application inside the component's element, so your app needs no Pinia, vue-i18n or router of ours. Props are the options below (`onChange` is the `change` event). Reactive props: `canvasId`, `theme`, `locale`, `nodeLayout`, `readOnly`; the others are read at mount (change `:key` to remount). `document` is the initial document only. The methods of the handle are exposed on the component ref.

React and others: call `mountEditor` in an effect and `unmount()` in its clean-up; or register the custom element once with `defineLoomCanvasEditorElement()` and set its `options` property (attributes `canvas-id`, `theme`, `locale`, `node-layout`, `read-only` update a mounted editor; events are DOM `CustomEvent`s with the payload in `detail`; the handle is the `editor` property). The custom element renders into the light DOM, not a shadow root.

### Options of `mountEditor(el, options)`

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `adapter` | [EditorAdapter](#the-adapter) | required | The editor's backend |
| `canvasId` | string | none | Canvas to load through `adapter.loadCanvas`. The editor then saves through `adapter.saveCanvas` |
| `document` | [CanvasDocument](#the-document-format) | none | Edit this document directly: nothing is loaded or saved through the adapter, changes are reported to you. Give either `canvasId` or `document` |
| `onChange` | `(document) => void` | none | The document changed (debounced) |
| `changeDebounceMs` | number | 1500 | Quiet time before a change is saved / reported |
| `readOnly` | boolean | false | View only: pan and zoom work; nodes do not react, nothing runs, nothing is saved |
| `nodeLayout` | `'a' \| 'b' \| 'c'` | `'a'` | Layout of generation nodes |
| `features` | partial [feature switches](#feature-switches) | editor chrome only | Opt in to more where the adapter provides what they need |
| `nodeTypes` | node type names | all the adapter can run | Node types offered in the palette and menus |
| `onBack` | `() => void` | none | Shows a back button in the title block and is called when it is pressed |
| `theme`, `locale`, `messages`, `storagePrefix`, `zIndex` | | | As for the app. Theme and language are always yours to control here |

### Handle

`getDocument()`, `setDocument(doc)`, `setCanvasId(id)`, `save()`, `fitView()`, `runAll()`, `runNode(id)`, `addNode(type, data?, position?)` → id, `undo()`, `redo()`, `setTheme()`, `setLocale()`, `setNodeLayout()`, `setReadOnly()`, `on()`, `unmount()`.

- `runAll()` is the "Run all" button: it runs everything that leads to an Output node. `runNode(id)` runs one node after the nodes it depends on.
- Methods that touch the canvas throw before the `ready` event.
- `setDocument()` clears the undo history.

### Events

`ready` `{ canvasId }` · `change` `{ canvasId, document }` (debounced) · `saved` `{ canvasId, updatedAt }` (only with `canvasId`) · `run:started` / `run:finished` / `run:failed` · `result` · `selection` `{ nodeIds, edgeIds }` · `error` `{ scope, message, cause? }` (`scope`: `load`, `adapter`).

### What the editor shows

By default: the canvas, the title block (name and save state), the tool palette, the bottom toolbar (zoom, fit, undo, redo, arrange, run all), the queue button, the minimap, node menus, the image crop tool, node search, the canvas appearance panel. Not shown unless switched on: share, templates, brand kits, the asset library, batch run, batch download, costs, the tutorial, switching to another canvas, any link to model management, any layout / theme / language menu.

## The adapter

The editor talks to the outside only through this object. Types are in `types/embed/types.d.ts` (`EditorAdapter`).

| Member | Required | Purpose |
| --- | --- | --- |
| `loadCanvas(id)` → `{ id, document, updatedAt? }` | yes | Load a canvas; reject when it does not exist |
| `saveCanvas(id, partialDocument)` → `{ updatedAt }` | yes | Save. May receive only `{ viewport }`: that is not a content change and should not move `updatedAt` |
| `listModels()` → `ModelSpec[]` | yes | Models the user may pick ([architecture.md](architecture.md), section 4.1) |
| `submitRun(req)` → `{ runId }` | yes | Start an image or video run |
| `getRuns(ids)` → `Run[]` | yes | State of runs, polled by the editor; unknown ids may be left out |
| `cancelRun(id)` | yes | Cancel an unfinished run |
| `submitLlm(req)` → `{ taskId }`, `getLlm(taskId)` → `LlmTask` | yes | Text tasks (language-model and video-analysis nodes) |
| `upload(file, { filename?, onProgress? })` → `{ url, … }` | yes | Store a file; `url` is what goes into the document |
| `resolveFileUrl(url)` → string | yes | Address stored in a document → address the browser can load. Return the input for addresses that need nothing |
| `capabilities()` → `{ maxUploadMb?, upstreamByUrl? }` | no | Limits checked before uploading / running |
| `estimate(req)` | no | Cost estimate; needed for `features.cost` |
| `importRemoteFile(url)`, `downloadFile(url, name)`, `downloadZip(canvasId, urls?)` | no | Copy a pasted link into storage; download through your backend; zip download (`features.batchDownload`) |
| `runTool(tool, payload)` | no | Server-side image tools; without it the tool nodes (slice, collage, watermark, resize, platform export) are not offered |
| `listCanvases()` | no | Needed for `features.canvasSwitch` |
| `brandKits`, `templates`, `assets`, `share` | no | Needed for the features of the same names; shapes follow the stock server ([api.md](api.md)) |

Errors: reject with an `Error`; its message is shown to the user. An optional numeric `status` (HTTP-like) lets the editor tell client errors from transient ones.

Runs are polled (`getRuns` / `getLlm`, repeatedly while something is running). There is no streaming variant in 0.1.

Ready-made adapters:

- `createHttpAdapter({ apiBase, getAuth, onAuthRequired, fileBase, locale, timeoutMs })`: the stock server API. It has its own HTTP client and sends only the headers `getAuth` returns (plus `X-Locale`). The stand-alone app and Shape 1 use the same implementation internally.
- `createMemoryAdapter({ canvases, models, runMs, resolveRun, resolveLlm })`: no server. Canvases live in memory, uploads become object URLs, runs "finish" after `runMs` with a generated picture. For demos, tests and for starting before your backend exists. It exposes `canvases` and `runRequests` for inspection.

To write your own, implement the required members against your backend. `web/test/adapterContract.ts` is the contract as an executable test suite; both ready-made adapters pass it, and you can run it against yours.

One adapter per page: all editors mounted on a page share the adapter passed last (a warning is logged when they differ).

## The document format

A canvas is plain JSON. It is what `loadCanvas` returns, what `saveCanvas` receives, what `getDocument()` / `setDocument()` exchange, and what the stock server stores. Types: `CanvasDocument`, `CanvasNode`, `CanvasEdge` in `types/embed/document.d.ts`.

```jsonc
{
  "schemaVersion": 3,
  "name": "My canvas",
  "nodes": [
    { "id": "prompt", "type": "text", "position": { "x": 40, "y": 80 }, "data": { "text": "a lighthouse at dusk" } },
    { "id": "picture", "type": "image-gen", "position": { "x": 420, "y": 60 }, "data": { "prompt": "", "model": "gaorui:nano-banana-2.1", "aspectRatio": "16:9" } },
    { "id": "result", "type": "output", "position": { "x": 800, "y": 60 }, "data": { "imageUrl": "", "videoUrl": "" } }
  ],
  "edges": [
    { "id": "e1", "source": "prompt", "sourceHandle": "text-out", "target": "picture", "targetHandle": "text-in" },
    { "id": "e2", "source": "picture", "sourceHandle": "image-out", "target": "result", "targetHandle": "image-in" }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "settings": {},
  "brandKitId": ""
}
```

| Node type | `data` you may write | Handles |
| --- | --- | --- |
| `text` | `text` | `text-out` |
| `image` | `imageUrl` | `image-out` |
| `video` | `videoUrl` | `video-out` |
| `image-collection` | `imageUrls[]` | `image-in`, `image-out` |
| `image-gen` | `prompt`, `model`, model parameters (`aspectRatio`, `resolution`, `count`) | `text-in`, `image-in`, `image-out` |
| `image-edit` | `instruction`, `model`, parameters | `text-in`, `image-in`, `image-out` |
| `video-gen` | `prompt`, `model`, `aspectRatio`, `duration`, `imgMode` | `text-in`, `image-in`, `image-last-in`, `video-out` |
| `video-edit` | `prompt`, `model`, `aspectRatio` | `text-in`, `video-in`, `image-in`, `video-out` |
| `llm` | `text` (the result), `prompt`, `systemPrompt`, `model` | `text-in`, `image-in`, `text-out` |
| `video-analysis` | `text` (the result), `prompt`, `model` | `text-in`, `video-in`, `image-in`, `text-out` |
| `output` | none (it collects results) | `image-in`, `video-in` |
| `slice`, `collage`, `watermark`, `fit-size`, `platform-export` | the tool's settings (see `CanvasNodeDataMap`) | `image-in`, `image-out` |
| `frame` | `label`, `w`, `h`; children name it in `parentNode` | none |

Rules for a host that creates or changes documents:

- `id` is any string unique within the document. `position` is the top-left corner in canvas coordinates (relative to the frame when `parentNode` is set).
- An edge joins an `*-out` handle to the `*-in` handle of the same data type (text, image, video). Edges whose ends do not exist are dropped on load.
- Result fields (`imageUrl`, `imageUrls`, `videoUrl`, `text` of result nodes), run bookkeeping (`taskId`, `taskIds`, `errorMsg`, `errorRunId`, `results`, `cost`) and measured sizes (`dimensions`) are written by the editor. Read them; do not invent them. Removing a result field resets that node.
- Unknown keys in `data` are preserved, so you can attach your own metadata; prefix them to stay clear of future fields.
- `model` must be an id from `listModels()`. A node whose model is unknown shows a notice and does not run.
- Addresses are stored as given by `upload()` / run outputs and passed through `resolveFileUrl()` for display. With the stock server they are site-relative (`/files/<key>`).

Versioning: `schemaVersion` (currently 3, the same number the stock server uses) is raised when the shape changes in a way an older reader would misread. `migrateDocument(doc)` (exported by both entries, no dependencies) brings any older document to the current version and fills in missing parts; the editor runs it on every load, so you may store documents of any past version. A document with a higher version than the build knows is refused (`CanvasDocumentError`, code `newer_version`) instead of being damaged. Upgrade the front end before the first document of a new version is written.

## Feature switches

`features` hides entry points; it is a UI switch, not access control. In Shape 2 a feature also needs its backend: without the adapter member it stays off whatever you pass.

| Flag | Hides | Needs (Shape 2) |
| --- | --- | --- |
| `share` | Share button, "my shares" | `adapter.share` |
| `templates` | Canvas templates, text snippets | `adapter.templates` |
| `brandKit` | Brand-kit chip, per-node exception, kit editor | `adapter.brandKits` |
| `assetLibrary` | Library dialog, "pick from library", "save to assets" | `adapter.assets` |
| `batchRun` | Batch run | |
| `batchDownload` | Zip download | `adapter.downloadZip` |
| `cost` | Estimates and costs everywhere | `adapter.estimate` |
| `modelManagement` | Links to the models page, the "add a provider" guide | |
| `nodeLayoutSwitch`, `themeSwitch`, `localeSwitch` | The respective switch (menu, top bar, settings) | |
| `guide` | Tutorial and shortcut sheet | |
| `canvasSwitch` | Switch to / import another canvas inside the editor | `adapter.listCanvases` |
| `immersive` | The immersive toggle (only with `shell: 'full'`) | |
| `account` | User menu, sign-out, account settings | not available |
| `externalLinks` | Links to the documentation and the source code | |
| `palette`, `queue`, `minimap`, `titleBar`, `backButton`, `canvasStyle`, `imageEditor`, `search` | The named piece of editor chrome | |

Defaults: Shape 1 has everything on (with `getAuth`: `account` and `externalLinks` off). Shape 2 has only the last row on (`backButton` when `onBack` is given).

## Style isolation

LoomCanvas renders into your document (light DOM), not into an iframe or a shadow root. What that means, exactly:

**Guaranteed**

- Every rule of `app.css` / `editor.css` is confined to the mount root: selectors are rewritten at build time (`:root`, `html`, `body` → `.lc-root`; everything else gets a `:where(.lc-root)` prefix, including TDesign's and Vue Flow's styles). No rule can match an element of your page. This is checked by a unit test over the stylesheets and by a browser test that compares the computed styles of host elements before and after mounting.
- Design tokens (CSS custom properties), the theme attributes (`data-theme`, `theme-mode`) and `lang` are set on the mount root, never on `<html>` or `<body>`.
- Nothing is appended to `<body>` or `<head>`: dialogs, menus, toasts, the lightbox and date pickers are attached to a layer inside the mount root. `document.title` is not touched.
- Popups stay inside the mount root: it is the containing block of everything positioned `fixed`, it clips, and it scrolls with your page. Internal `z-index` values do not compete with yours (`isolation: isolate`); use `zIndex` to place the root.
- Sizes that used to depend on the browser window depend on the mount root: viewport units are replaced by root-relative ones, and every `@media (max-width)` block has a container-query twin, so a narrow box gets the narrow-screen layout whatever the window width.
- Text properties your page would otherwise pass down (font, colour, line height, letter spacing, alignment, …) are reset at the root; `box-sizing`, margins and paddings are reset for everything inside with a specificity above element selectors (`* { … }`, `button { … }`, `a { … }` on your page do not get through).
- Keyboard shortcuts (Delete, Ctrl+Z, Ctrl+A, …) act only when the key event comes from inside the mount root, or when focus is on the page itself and the user's last click was in that root. Typing in your own inputs is never intercepted.
- Storage keys carry `storagePrefix`.

**Not guaranteed**

- Rules of yours that reach into the root with higher specificity than an element selector do apply: `#app button { … }`, `.content a { … }`, `.page * { … }`. Mount LoomCanvas outside such containers, or exclude it in your selectors (`:not(.lc-root *)`).
- `!important` rules of yours win.
- `@font-face` family names and `@keyframes` names cannot be scoped in CSS. `fonts.css` registers `Inter Variable`, `Sora Variable` and `JetBrains Mono Variable` for the whole document. Keyframe names are mostly prefixed, but one is a plain `spin`; a `@keyframes spin` of your own loaded after LoomCanvas' stylesheet replaces it (and the reverse).
- Inherited properties not in the reset list, and anything applied through `*` with `!important`.
- Browser features that are document-wide by nature: the leave-page warning when a canvas has unsaved changes (`beforeunload`), drag-and-drop of files onto the canvas, the clipboard.
- JavaScript globals: LoomCanvas defines none, but it is not sandboxed. A Content-Security-Policy of your page applies to it (it needs `style-src 'unsafe-inline'` for style attributes, `img-src` / `media-src` / `connect-src` for your API and file origin, `font-src` for the fonts, `blob:` and `data:` for previews).

Browser support for the embedded layout: container queries and container units (Chrome and Edge 105, Safari 16, Firefox 110).

If you need a hard boundary (a host page you do not control, hostile CSS), put the stand-alone app in an `<iframe>` instead; see [Server notes](#server-notes).

### Fonts

The stylesheets name three font families with system fallbacks and contain no `@font-face`. Choose one:

- include `fonts.css` (it references `./fonts/*.woff2` next to it);
- declare the same family names yourself, pointing at wherever you host the files;
- include nothing: the interface falls back to system fonts.

## Theme, language, branding

- Theme: `dark`, `light` or `system`. `theme` option at mount, `setTheme()` later. To restyle beyond that, override the design tokens on the root: `.lc-root { --cyan: #7c3aed; … }` (the tokens are in `web/src/styles/design-tokens.css`; they are not yet a stable API).
- Language: `en` and `zh-CN`. `messages` overrides any text by key path, for example `{ en: { views: { list: { title: 'Boards' } } } }`. Language is page-wide: all mounted views share it.
- Branding (Shape 1): `brand: { name, logoUrl }`, or `false` for no brand block; with `shell: 'none'` there is no brand at all. The page title is yours.

## Authentication

LoomCanvas does not sign your users in and does not provide single sign-on. It sends whatever headers you give it.

- **Shape 2 with your own backend**: your adapter makes the calls; authenticate them like any other call of your product.
- **Either shape with the stock server**: the server authenticates `Authorization: Bearer <session token>` and has its own accounts (one canvas space per account). Mapping your users onto those accounts is your backend's job. Two patterns:
  1. *Token exchange.* Your backend creates one LoomCanvas account per user of yours (`POST /api/auth/register`), keeps its credentials, signs it in server-side (`POST /api/auth/login`) and hands the session token to your page; `getAuth` returns it. Sessions last 12 hours (30 days with `remember: true`); on 401 `onAuthRequired` fires and you fetch a new one.
  2. *Gateway.* Your reverse proxy authenticates your own session cookie or token and injects the `Authorization` header for the mapped LoomCanvas account before forwarding to the LoomCanvas server. The page needs no `getAuth` headers at all (return `{}`), and the token never reaches the browser.
- The stock server has no administrative API that creates accounts: an account comes from `POST /api/auth/register`, which works only while registration is open (Settings → Site, or `REGISTRATION_OPEN`). If only your backend should be able to create accounts, keep registration open and block that path for everybody else at your reverse proxy. If the accounts already exist, close registration.
- Provider API keys, prices and models are per LoomCanvas account. If your users should not manage them, leave `models` out of `pages`, switch `modelManagement` off and configure providers for each account from your backend through the API.

## Server notes

No server change was needed for integration; these existing settings matter:

- **Cross-origin API.** When your page and the LoomCanvas API are on different origins, list your page's origin in `CORS_ORIGIN` ([configuration.md](configuration.md)). Allowed request headers are `Authorization`, `Content-Type` and `X-Locale`; other headers of yours must be added by a gateway on the same origin as the API or the preflight fails.
- **Files.** `/files/<key>` answers with `Access-Control-Allow-Origin: *` and `Cross-Origin-Resource-Policy: cross-origin`, so images and videos load from another origin. Stored addresses stay site-relative; the front end prefixes `fileBase`.
- **Iframe instead of embedding.** The stock server sends `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'`: the stand-alone app can be framed only by pages of its own origin. To frame it from your product, serve both under one origin through your reverse proxy, or change those two headers at the proxy.
- **Your page's CSP** applies to embedded LoomCanvas (see [Style isolation](#style-isolation)); the stock server's CSP does not, because it is your page that is served.

## Compatibility

Public API, covered by semantic versioning of the package version (`VERSION` export):

- the exports of `loomcanvas-web/app` and `loomcanvas-web/editor`;
- option names and meanings, handle methods, event names and payloads;
- the `EditorAdapter` interface, `createHttpAdapter`, `createMemoryAdapter`;
- the canvas document format and `migrateDocument`;
- the feature-switch and page names;
- the class name `lc-root` on the mount root and the files of `dist-lib/` named in the `exports` map.

A guard test (`web/test/public-api.test.ts`) snapshots this surface: changing it fails the test until the snapshot, this page and the changelog are updated together.

Not public, may change in any release: everything else under `web/src/`, internal class names and DOM structure, design-token names, chunk file names, storage key names (beyond the prefix), the stock server's API beyond what [api.md](api.md) documents.

Until 1.0, minor versions (0.x) may contain breaking changes; they are listed in the [changelog](../CHANGELOG.md) under "Integration". Adding an optional adapter member, an option, an event or a feature flag is not a breaking change; a new feature flag in Shape 2 starts off.

## Licensing

LoomCanvas is licensed under AGPL-3.0-or-later ([LICENSE](../LICENSE)). Building it into your product is "conveying" or "network use" of a work based on it:

- if your product, with LoomCanvas inside, is used by others over a network or distributed to them, the AGPL obliges you to offer those users the corresponding source code of the combined work under the AGPL, including your modifications;
- that applies to the front-end bundle your product ships (LoomCanvas' code is in it) and to the server if you run or modify the stock one.

If you cannot or do not want to release your product under the AGPL, you need a commercial licence: see [COMMERCIAL.md](../COMMERCIAL.md). The name and logo are covered by [TRADEMARK.md](../TRADEMARK.md); removing them with `brand` is permitted, presenting a modified version as the official project is not. Third-party notices: [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md); the bundled fonts are under the SIL Open Font License 1.1.

This section is a summary, not legal advice.

## Limits

Read this before you plan a project around it.

- **One runtime per page.** API address, authentication, adapter, language, theme and storage prefix are shared by every LoomCanvas view on a page. Several views of one runtime work (each has its own navigation, state and canvas); two editors with different adapters, languages or themes on one page do not. Use iframes for that.
- **You build everything around it.** There is no "create canvas" in the editor entry (your product decides when a canvas exists), no user provisioning, no SSO, no quota or billing UI. With the stock server, mapping users to accounts and configuring providers per account is your backend's work.
- **Not a sandbox.** Light-DOM embedding shares your document: see what is [not guaranteed](#style-isolation). Aggressive host CSS with higher specificity than element selectors will leak in.
- **Size.** The editor is about 400 kB of gzipped JavaScript plus 51 kB of CSS in one piece; it is not split further and includes both languages and every node type.
- **Read-only is coarse.** `readOnly` makes nodes inert: users cannot open a result in the lightbox or copy text from a node. Switching it on does not cancel a run in progress; what changed while it was on is saved when it is switched off. For a presentable read-only view, the stock app's share page is better.
- **Polling only.** Run state is polled; there is no push or streaming interface in the adapter yet.
- **Responsive layout in a box** depends on container queries. Boxes of 440 px to 1000 px wide are covered by the browser tests; anything narrower has not been tried.
- **Share links** need hash or history routing (Shape 1) or `adapter.share.linkFor` (Shape 2).
- **Not yet run by the project**: history-mode routing (memory and hash modes are tested), the custom element inside a framework (it is tested in a plain page), a React or Angular host (the framework-free example is the nearest), Safari and Firefox (the browser tests run on Chrome), the opt-in editor features other than cost and templates (`share`, `brandKit`, `assetLibrary`, `batchRun`, `batchDownload`, `canvasSwitch` in Shape 2), a hand-written adapter against a backend other than the stock server. Server-side rendering is not supported: the entries need a browser, import them on the client only.
- **Tokens and class names are not stable.** Restyling through design tokens works today and may break on upgrade.
