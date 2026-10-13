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

`node scripts/build-lib.mjs --out=<dir>` (in `web/`) writes the same build to another folder and leaves `dist-lib/` alone.

Ways to consume it:

- With a bundler: `npm pack` in `web/` (or reference the folder with `"loomcanvas-web": "file:../loomcanvas/web"`) and import `loomcanvas-web/app`, `loomcanvas-web/editor`, `loomcanvas-web/app.css`, `loomcanvas-web/editor.css`, `loomcanvas-web/fonts.css`. The package's `exports` map points at `dist-lib/`.
- Without a bundler: copy `dist-lib/` to your static files and import `…/dist-lib/standalone/app.js` from a `<script type="module">`. Keep the folder together: entries load their chunks by relative path, and nothing in it refers to an absolute path such as `/assets`, so it works from any base address.

Why Vue is a peer dependency in the default entries: `<LoomCanvasEditor>` is rendered by your application's Vue, and two copies of Vue in one page do not share reactivity. Everything else LoomCanvas uses (vue-router, Pinia, vue-i18n, Vue Flow, TDesign, axios) is bundled and private to it: it runs as its own Vue application inside your element and installs nothing on yours. If your host is not a Vue application, use the `standalone/` entries and ignore Vue altogether.

Sizes of version 0.1 (minified; gzip in brackets): `editor.js` 1.9 MB (500 kB), `editor.css` 500 kB (58 kB); the app entry loads a 930 kB (270 kB) core chunk plus a chunk per page (the editor page adds about 1 MB, 240 kB gzipped), `app.css` 900 kB (106 kB); Vue adds about 136 kB (39 kB) in the `standalone/` variants. `npm run build:lib` prints the exact numbers of your build.

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
| `user` | `{ name, id?, email?, avatarUrl?, role? }` | from `GET /api/bootstrap` | Who is signed in, as your system knows them; shown in the shell. `role: 'owner'` shows the site-management settings sections (on the server their endpoints are for the super admin only, whatever you pass here) |
| `getUser` | `() => user \| Promise<user>` | none | The same, resolved at start-up |
| `routerMode` | `'memory' \| 'hash' \| 'history'` | `'memory'` | How navigation shows in the address bar: not at all, `#/canvases`, or real paths under `basePath` |
| `basePath` | string | `/` | Sub-path of your site the app lives under (hash and history modes) |
| `initialPage` | page name or in-app path | first page that exists | Where to start in memory mode |
| `onNavigate` | `(route) => void` | none | Called after every navigation; same payload as the `route` event |
| `shell` | `'full' \| 'none'` | `'full'` | `'none'`: page content only, no top bar and no sidebar; you provide navigation with `navigate()` |
| `pages` | page names | all | The pages that exist. Others are unreachable (by link, by `navigate()`, by address) and links to them are not rendered. A page that belongs to a switched-off feature does not exist either, whatever this list says (see [Feature switches](#feature-switches)) |
| `features` | partial [feature switches](#feature-switches) | all on | With `getAuth`, `account` and `externalLinks` start off |
| `nodeLayout` | `'a' \| 'b' \| 'c'` | `'a'` | Layout of generation nodes for a user without a stored preference |
| `brand` | `{ name?, logoUrl?, showName? } \| false` | site settings of the server | Name and logo in the shell; `false` removes the brand block. `showName: false` (default `true`) shows your logo without the name next to it, for a logo that already spells the name; the name stays the logo's text alternative, and without `logoUrl` the name is always shown |
| `space` | `'personal'` or a team id | none: the user switches | Pin the app to one [space](#spaces-and-teams): the space switcher is not shown and links into other spaces are not followed. The team must be one the signed-in account is a member of |
| `theme` | `'dark' \| 'light' \| 'system'` | stored choice, else `'dark'` | Initial theme. Giving it makes the theme yours to control (`setTheme`) |
| `locale` | `'en' \| 'zh-CN'` | stored choice, else the browser's | Initial language. Giving it makes it yours to control (`setLocale`) |
| `messages` | `{ en?: {...}, 'zh-CN'?: {...} }` | none | Text overrides, merged over the built-in catalogue (same key paths as `web/src/locales/`) |
| `storagePrefix` | string | `loomcanvas-` | Prefix of every `localStorage` / `sessionStorage` key |
| `zIndex` | number | none | `z-index` of the mount root in your page |

Page names: `home` (workbench; the team home in a team space), `canvases`, `canvas`, `assets`, `brand-kits`, `models`, `history`, `team` (members, usage, activity, team settings; exists only in a team space), `settings`, `setup`, `share`, `join` (the page an invite link opens).

### Handle

| Method | Meaning |
| --- | --- |
| `navigate(to, params?)` | Go to a page (`'canvases'`, `'canvas'` with `{ id }`) or an in-app path (`'/canvas/abc'`). A page that does not exist (outside `pages`, or its feature is off) is not entered |
| `setTheme(theme)` / `setLocale(locale)` | Change theme / language |
| `on(event, handler)` | Subscribe; returns an unsubscribe function |
| `unmount()` | Remove everything that was added to your element |

### Events

| Event | Payload | When |
| --- | --- | --- |
| `ready` | `{}` | The first page is on screen |
| `route` | `{ name, path, params }` | After every navigation |
| `canvas:saved` | `{ canvasId, updatedAt }` | A canvas was saved |
| `space` | `{ id, kind, name, role }` | The user entered a space: `id` is `'personal'` or a team id, `kind` is `'personal'` or `'team'`, `role` is their role in it (`'owner'`, `'admin'`, `'member'`; `'owner'` in the personal space) |
| `run:started`, `run:finished`, `run:failed` | `{ canvasId, nodeId, nodeType, runIds, error? }` | A node started / finished / failed running |
| `result` | `{ canvasId, nodeId, nodeType, outputs: [{ type, url }], text? }` | A node has a result |
| `error` | `{ scope, message, cause? }` | Bootstrap, load or `getUser` failed (`scope`: `bootstrap`, `load`, `auth`) |

### Routing

In-app paths carry the space: pages of a team space start with `/t-<team id>` (`/t-6712…a0/canvases`), pages of the personal space have no prefix (`/canvases`). `navigate('canvases')` and other navigation by page name stay in the current space; `navigate('/t-<team id>/canvases')` enters that team, `navigate('/canvases?space=personal')` goes back to the personal space. The `route` event reports the path with the prefix and the same page `name` in every space.

- `memory` (default): the address bar is yours. Mirror `route` into your own router if you want deep links, and call `navigate()` when your route changes.
- `hash`: `…/your/page#/canvas/abc`. Deep links and the back button work without server changes.
- `history`: real paths under `basePath`. Your server must answer those paths with your host page.

Only one mounted view should use `hash` or `history` on a page.

Share links (`/share/<token>`) and team invite links (`/join/<token>`) are built from the app's own routes, so they need `hash` or `history` mode to be openable; in `memory` mode switch `features.share` (and `features.teamAdmin`) off, or handle the `share` and `join` pages yourself (call `navigate('/join/<token>')` when you receive such a link).

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

React: call `mountEditor` in an effect and `unmount()` in its clean-up; see [React](#react). Any other host, or markup you do not render yourself: the [custom element](#the-custom-element) `<loom-canvas-editor>`.

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
- `unmount()` with unsaved changes (`canvasId` mode): the editor saves on its way out. The request is handed to the adapter before `unmount()` returns, or right after the save that is still in flight; its answer arrives later and is ignored. So the adapter must stay usable for a moment after the editor is gone: when you sign a user out, drop the token `getAuth` reads only after unmounting, or give each session its own adapter object that keeps its own token.
- `unmount()` in `document` mode: `change` / `onChange` are debounced, and nothing is reported after `unmount()`. Call `getDocument()` first if you need the edits of the last `changeDebounceMs`.

### Events

`ready` `{ canvasId }` (once per mount, when the first canvas is on screen; not again after `setCanvasId()`) · `change` `{ canvasId, document }` (debounced) · `saved` `{ canvasId, updatedAt }` (only with `canvasId`) · `created` `{ canvasId, fromCanvasId }` (the editor stored its document as a new canvas through `adapter.createCanvas`: "make a copy", or "save my version as a copy" after a save conflict or a lost lock; the editor stays on `fromCanvasId`, call `setCanvasId(canvasId)` to open the copy) · `run:started` / `run:finished` / `run:failed` · `result` · `selection` `{ nodeIds, edgeIds }` · `error` `{ scope, message, cause? }` (`scope`: `load`, `adapter`).

### What the editor shows

By default: the canvas, the title block (name and save state), the tool palette, the bottom toolbar (zoom, fit, undo, redo, arrange, run all), the queue button, the minimap, node menus, the image crop tool, node search, the canvas appearance panel. Not shown unless switched on: share, templates, brand kits, the asset library, batch run, batch download, costs, the tutorial, switching to another canvas, any link to model management, any layout / theme / language menu.

### React

Call `mountEditor` in an effect and `unmount()` in its clean-up. Import the `standalone/` entry: it has Vue inside, so a React project installs no Vue.

```tsx
import { useEffect, useRef } from 'react'
import { mountEditor, createMemoryAdapter } from 'loomcanvas-web/standalone/editor'
import type { CanvasDocument } from 'loomcanvas-web/standalone/editor'
import 'loomcanvas-web/editor.css'

// Outside the component: one adapter object for the whole life of the page.
const adapter = createMemoryAdapter()

export function Canvas({ document, onChange }: { document: CanvasDocument; onChange: (doc: CanvasDocument) => void }) {
  const el = useRef<HTMLDivElement>(null)
  // The newest props, without making them dependencies of the effect.
  const latest = useRef({ document, onChange })
  latest.current = { document, onChange }

  useEffect(() => {
    const editor = mountEditor(el.current!, {
      adapter,
      // The INITIAL document: the editor is uncontrolled, changes come back through onChange.
      document: latest.current.document,
      onChange: (doc) => latest.current.onChange(doc),
    })
    // unmount() removes everything the editor added, so React's StrictMode (mount, unmount, mount) is fine.
    return () => editor.unmount()
  }, [])

  // The editor fills this element: give it a size.
  return <div ref={el} style={{ height: 640 }} />
}
```

This is `examples/react-host/src/MinimalEditor.tsx`, and the project runs it in a browser: the production build under a strict Content-Security-Policy, and the Vite dev server with `<StrictMode>` on. What matters in React:

- **One adapter object.** Create it outside the component or with `useMemo`. A new object on every render would mount a new editor every time, and one page shares one adapter anyway.
- **Options read at mount, options that are live.** `adapter`, `document`, `features`, `nodeTypes`, `messages`, `storagePrefix`, `changeDebounceMs` and `onBack` are read once: to change them, mount again (effect dependencies, or `key` on your component). `theme`, `locale`, `nodeLayout`, `readOnly` and `canvasId` change a mounted editor: call `setTheme()`, `setLocale()`, `setNodeLayout()`, `setReadOnly()`, `setCanvasId()` from an effect of their own.
- **Handlers through a ref.** Handlers are usually new functions on every render; reading them from a ref keeps them out of the effect's dependencies.
- **`document` is the initial document.** The editor is uncontrolled: keep your own copy from `onChange` / `change`, or call `setDocument()`.
- **StrictMode is fine.** `unmount()` removes everything the editor added to the element; nothing was added to `<head>` or `<body>` in the first place.
- **`ready` comes once per mount.** A host that wants a "loaded" signal for every canvas gives its component `key={canvasId}` instead of changing the `canvasId` of a mounted editor.
- **Give the element a size**, and render no React children into it.
- **TypeScript.** Both entries share one set of type declarations, and it mentions Vue (for the `<LoomCanvasEditor>` Vue component). Without Vue installed, keep `"skipLibCheck": true`.

`examples/react-host/src/LoomCanvasEditor.tsx` is a complete component built on these rules (props, typed events, a ref with the imperative methods); copy it. The same example runs it against `createMemoryAdapter` and, on another origin, against the stock server through `createHttpAdapter`.

### The custom element

`defineLoomCanvasEditorElement()` registers `<loom-canvas-editor>` (pass another tag name if you like; a second call is a no-op). The element renders into the light DOM, not a shadow root, so the stylesheet is included the same way as for `mountEditor`.

- `options` is a **property** (an object): setting it mounts the editor, setting it again mounts it again, `null` unmounts. Removing the element from the document unmounts too.
- The attributes `canvas-id`, `theme`, `locale`, `node-layout` and `read-only` update a mounted editor. At mount, a value in `options` wins over the attribute, so leave those five out of `options` when you drive them with attributes. `read-only` is on when present (and not `"false"`).
- Events are DOM `CustomEvent`s with the editor's event names (`ready`, `change`, `run:started`, …) and the payload in `detail`. They do not bubble: listen on the element.
- The handle is the `editor` property (`null` while nothing is mounted).

In React with TypeScript, the tag and its attributes have to be declared for JSX:

```tsx
/** The element as TypeScript should see it. */
export interface LoomCanvasEditorElement extends HTMLElement {
  /** Setting it mounts the editor (again); `null` unmounts it. */
  options: LoomCanvasEditorOptions | null
  /** The handle of the mounted editor. */
  readonly editor: LoomCanvasEditorHandle | null
}

// Teach JSX the tag and its attributes.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'loom-canvas-editor': DetailedHTMLProps<HTMLAttributes<LoomCanvasEditorElement>, LoomCanvasEditorElement> & {
        'canvas-id'?: string
        theme?: LoomCanvasTheme
        locale?: LoomCanvasLocale
        'node-layout'?: LoomCanvasNodeLayout
        /** Present (`''`) = read-only; leave it out (`undefined`) for an editable canvas. */
        'read-only'?: '' | 'true' | 'false'
      }
    }
  }
}

// Once per page. A second call is a no-op.
defineLoomCanvasEditorElement()
```

and the element is used like this (`examples/react-host/src/LoomCanvasElement.tsx`, run by the project the same way as the component above):

```tsx
export function LoomCanvasElement({ options, theme, locale, nodeLayout, readOnly, on, elementRef }: LoomCanvasElementProps) {
  const el = useRef<LoomCanvasEditorElement | null>(null)
  const handlers = useRef(on)
  handlers.current = on

  // Events: plain DOM listeners.
  useEffect(() => {
    const node = el.current!
    const off = EVENTS.map((name) => {
      const listener = (e: Event) => handlers.current?.[name]?.((e as CustomEvent).detail as never)
      node.addEventListener(name, listener)
      return () => node.removeEventListener(name, listener)
    })
    return () => off.forEach((fn) => fn())
  }, [])

  // The property. Clearing it in the clean-up unmounts the editor (StrictMode, a new `options` object, leaving the page).
  useEffect(() => {
    const node = el.current!
    node.options = options
    return () => { node.options = null }
  }, [options])

  return (
    <loom-canvas-editor
      ref={(node) => {
        el.current = node
        if (typeof elementRef === 'function') elementRef(node)
        else if (elementRef) elementRef.current = node
      }}
      theme={theme}
      locale={locale}
      node-layout={nodeLayout}
      read-only={readOnly ? '' : undefined}
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  )
}
```

## The adapter

The editor talks to the outside only through this object. Types are in `types/embed/types.d.ts` (`EditorAdapter`).

| Member | Required | Purpose |
| --- | --- | --- |
| `loadCanvas(id)` → `{ id, document, updatedAt?, revision?, metaRevision?, access?, lock?, … }` | yes | Load a canvas; reject when it does not exist. The optional fields switch on [taking turns](#taking-turns-edit-lock-and-save-conflicts) |
| `saveCanvas(id, partialDocument, options?)` → `{ updatedAt, revision? }` | yes | Save. A **content** save carries `nodes`, `edges`, `settings`, `brandKitId` (and the viewport along with them) and never the name; `options` is `{ baseRevision?, force? }`, and an adapter that ignores it keeps "last write wins". A **metadata** save carries only `{ name }` (a rename), `{ viewport }` or `{ legacyLayout: false }`, comes without `options`, must not be refused because of a lock or a revision, and must not move `revision`; a viewport-only save should not move `updatedAt` either |
| `listModels()` → `ModelSpec[]` | yes | Models the user may pick ([architecture.md](architecture.md), section 4.1) |
| `submitRun(req)` → `{ runId }` | yes | Start an image or video run |
| `getRuns(ids)` → `Run[]` | yes | State of runs, polled by the editor; unknown ids may be left out |
| `cancelRun(id)` | yes | Cancel an unfinished run |
| `submitLlm(req)` → `{ taskId }`, `getLlm(taskId)` → `LlmTask` | yes | Text tasks (language-model and video-analysis nodes) |
| `upload(file, { filename?, onProgress? })` → `{ url, … }` | yes | Store a file; `url` is what goes into the document |
| `resolveFileUrl(url)` → string | yes | Address stored in a document → address the browser can load. Return the input for addresses that need nothing |
| `acquireLock(id, { takeover? })` → `{ lock, revision?, heartbeatMs?, name?, metaRevision?, state? }`, `releaseLock(id, { unloading? })`, `peekLock(id)` → `{ lock, revision?, name?, metaRevision?, canEdit?, canTakeOver?, pollMs? }` | no | The edit lock: take or renew it, give it back, look at it without taking it. Without `acquireLock` the editor never locks; without `peekLock` a read-only editor loads the canvas again every 20 seconds instead |
| `createCanvas(partialDocument, { visibility? })` → `{ id }` | no | Store a document as a new canvas. Needed for "make a copy" and "save my version as a copy"; without it those choices are not offered |
| `capabilities()` → `{ maxUploadMb?, upstreamByUrl?, storageWritable? }` | no | Limits checked before uploading / running. `storageWritable: false`: new files cannot be stored right now; image and video nodes say so before a run |
| `estimate(req)` | no | Cost estimate; needed for `features.cost` |
| `importRemoteFile(url)`, `downloadFile(url, name)`, `downloadZip(canvasId, urls?)` | no | Copy a pasted link into storage; download through your backend; zip download (`features.batchDownload`) |
| `runTool(tool, payload)` | no | Server-side image tools; without it the tool nodes (slice, collage, watermark, resize, platform export) are not offered |
| `listCanvases()` | no | Needed for `features.canvasSwitch` |
| `brandKits`, `templates`, `assets`, `share` | no | Needed for the features of the same names; shapes follow the stock server ([api.md](api.md)). `templates.createCanvasTemplate` / `removeCanvasTemplate` / `createTextTemplate` / `removeTextTemplate` and `assets.update` are optional inside them: without them "save as template", "new snippet" and their delete buttons are not offered |

Errors: reject with an `Error`; its message is shown to the user. An optional numeric `status` (HTTP-like) lets the editor tell client errors from transient ones. Two error codes change what the editor does, see the next section.

### Taking turns: edit lock and save conflicts

All of this is optional. An adapter that implements none of it behaves exactly as before: one person, last write wins. Implement it when several people may open the same canvas.

- **Revision-checked saves.** Return a number as `revision` from `loadCanvas`. The editor then sends it back as `options.baseRevision` with the next content save and expects the new `revision` in the answer. When the stored canvas is no longer at `baseRevision`, write nothing and reject with an error whose `code` is `'canvas.conflict'` and whose `data` is `{ revision, lastEditedBy?: { id, name }, lastEditedAt?, canOverwrite? }`. The editor stops saving and asks the user: save my version as a copy (needs `createCanvas`), load the latest version, or - only when `canOverwrite` is true - overwrite, which repeats the save with `options.force: true`. The editor sends ONE content save at a time per canvas, so a save never conflicts with the one before it.
- **Edit lock.** With `acquireLock`, the editor asks for the lock when it opens a canvas, again every `heartbeatMs` (default 12000; `heartbeatSeconds` is still read), and at once when its tab becomes visible again. Resolve with `{ lock: { by: { id, name }, mine: true }, revision }` when the caller holds it, or with `{ lock: null }` when this canvas needs no lock. While another editing session holds it, reject with `code: 'canvas.locked'` and `data: { lock: { by: { id, name }, mine: false, sameUser?: boolean }, canTakeOver?: boolean, lost?: 'taken_over' | 'expired' | null }`: the editor opens read-only, says who is editing - or, with `sameUser: true`, "You have this canvas open in another tab" - and offers "Take over" when `canTakeOver` is true (it then calls `acquireLock(id, { takeover: true })`). The same rejection from a heartbeat or from `saveCanvas` means this editor lost the lock; `lost` says how, and the editor words its bar accordingly, turns read-only at once, does not retry, and offers to save the unsaved changes as a copy. When `loadCanvas` already returns a `lock` that is not `mine`, the editor opens read-only without calling `acquireLock`.
- **One lock per editor, not per account.** An adapter instance stands for one editing session. `createHttpAdapter` makes up a session id per instance (kept in memory) and sends it with every call; if your backend locks per account instead, two tabs of one person will both edit and the revision check is what keeps them apart.
- **Giving the lock back.** `releaseLock(id)` is called when the editor closes inside the page; `releaseLock(id, { unloading: true })` when the page itself goes away (`pagehide`): an ordinary request may never leave the browser then, so use `navigator.sendBeacon` or `fetch` with `keepalive` and do not wait. Let locks expire on your side as well.
- **Waiting read-only.** While read-only and visible, the editor calls `peekLock(id)` every `pollMs` (default 5000): `lock: null` makes it offer "Start editing" (it never takes the lock silently); a `metaRevision` that moved makes it show the new `name`; a `revision` that moved makes it load the canvas again; `canEdit` / `canTakeOver` update what it offers.
- **Renaming is metadata.** The editor saves a new name with `saveCanvas(id, { name })` when the title field loses focus - also while it is read-only because somebody else is editing - and follows renames made elsewhere through `name` + `metaRevision` in the answers of `acquireLock` / `peekLock` (return `metaRevision` from `loadCanvas` too). With `access.canEdit: false` the title is not editable.
- **Per-canvas rights.** `access` from `loadCanvas`: `{ canEdit?, canTakeOver?, canOverwrite?, canShare?, canSetVisibility? }`. `canEdit: false` opens the canvas read-only without asking for the lock. A missing field means "allowed".
- While read-only for any of these reasons the editor saves nothing (not even the viewport) and runs nothing. It keeps a reduced toolbar (a "read-only" mark, the "more" menu and, where those features are on, the library to browse and download from and sharing to look at), which the `readOnly` option does not: that one removes the toolbar altogether.
- The error may carry `code` and `data` directly on the `Error`, or in an HTTP client's response body (`error.response.data.code` / `.data`); the editor reads both. `AdapterError` in the type declarations describes it.

`createHttpAdapter` implements all of this against the stock server, where it applies to canvases in a team space.

Runs are polled (`getRuns` / `getLlm`, repeatedly while something is running). There is no streaming variant in 0.1.

Ready-made adapters:

- `createHttpAdapter({ apiBase, getAuth, onAuthRequired, fileBase, locale, timeoutMs, space })`: the stock server API. It has its own HTTP client and sends only the headers `getAuth` returns (plus `X-Locale`, and `X-Space` when `space` is a team id). `space` is the [space](#spaces-and-teams) every request of this adapter acts in: `'personal'` (default) or a team id; for another space create another adapter and remount the editor with it. The stand-alone app and Shape 1 use the same implementation internally.
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

A switched-off feature leaves no entry point behind: no button, menu item, tab, keyboard shortcut, hint or link, and the built-in guide leaves out what it would say about it. A page that IS the feature goes with the switch: it does not exist (no sidebar item, no link to it, not reachable by `navigate()` or by address), exactly as if it had been left out of `pages`:

| Switch off | Pages that do not exist |
| --- | --- |
| `assetLibrary` | `assets` |
| `brandKit` | `brand-kits` (the second tab of the library; with `assetLibrary` off and `brandKit` on, the sidebar item goes straight to it) |
| `modelManagement` | `models`, `setup` |
| `teamAdmin` | `team` |

The pages a link lands on (`share`, `join`) are governed by `pages` alone. The `settings` page does not exist for somebody who would find nothing on it: `account` off, the three appearance switches off, and not the site's super admin.

| Flag | Hides | Needs (Shape 2) |
| --- | --- | --- |
| `share` | Share button, "my shares", the team setting "who may create share links" | `adapter.share` |
| `templates` | Canvas templates, text snippets, "start from a template" on the workbench and on an empty canvas | `adapter.templates` |
| `brandKit` | Brand-kit chip, per-node exception, kit editor, the Brand kits page | `adapter.brandKits` |
| `assetLibrary` | Library dialog, "pick from library", "save to assets", the Assets page | `adapter.assets` |
| `batchRun` | Batch run | |
| `batchDownload` | Zip download, in the editor and on the canvas cards | `adapter.downloadZip` |
| `cost` | Money everywhere: estimates and costs on nodes, in the queue and in batch run; the cost column, tile and CSV columns of History; the workbench; prices on the Models page; and, in a team, the amounts under Usage, Members and Limits (amount limits are then neither shown nor editable there, run-count limits stay). The server keeps counting and enforcing what it is configured to | `adapter.estimate` |
| `modelManagement` | The Models page and the "add a provider" guide, every link to them, the providers card of the workbench | |
| `nodeLayoutSwitch`, `themeSwitch`, `localeSwitch` | The respective switch (editor menu, top bar, settings, and the top bars of the sign-in, set-up, join and share pages) | |
| `guide` | Tutorial and shortcut sheet. While it is on, it leaves out the sections and sentences about features that are off | |
| `canvasSwitch` | Switch to / import another canvas inside the editor | `adapter.listCanvases` |
| `immersive` | The immersive toggle (only with `shell: 'full'`) | |
| `account` | User menu, sign-out, account settings | not available |
| `externalLinks` | Links that leave the product: documentation, source code, a provider's "get an API key" page | |
| `spaceSwitch` | The space switcher in the top bar (personal space / teams, "create a team", "join with an invite") and "open it there" after copying something to another space. Off: the user stays in the space the app is in (your own `navigate()` can still change it). In a team the top bar then names the team and the user's role there as plain text; in the personal space it shows nothing in that place | not available |
| `teamAdmin` | The Team page (members, invite links, usage, activity, team settings) and its entry points. Switch it off when your product manages membership itself. The space switcher is then for switching only: "create a team" and "join with an invite" are not offered, and a team is listed with the user's role in it, without the member count (the team home leaves the member count out as well) | not available |
| `palette`, `queue`, `minimap`, `titleBar`, `backButton`, `canvasStyle`, `imageEditor`, `search` | The named piece of editor chrome | |

Defaults: Shape 1 has everything on (with `getAuth`: `account` and `externalLinks` off). Shape 2 has only the last row on (`backButton` when `onBack` is given).

## Style isolation

LoomCanvas renders into your document (light DOM), not into an iframe or a shadow root. What that means, exactly:

**Guaranteed**

- Every rule of `app.css` / `editor.css` is confined to the mount root: selectors are rewritten at build time (`:root`, `html`, `body` → `.lc-root`; everything else gets a `:where(.lc-root)` prefix, including TDesign's and Vue Flow's styles). No rule can match an element of your page. This is checked by a unit test over the stylesheets and by a browser test that compares the computed styles of host elements before and after mounting.
- Design tokens (CSS custom properties), the theme attributes (`data-theme`, `theme-mode`) and `lang` are set on the mount root, never on `<html>` or `<body>`.
- Nothing is left in `<body>` or `<head>`: dialogs, menus, toasts, tooltips, the lightbox and date pickers are attached to a layer inside the mount root, and a toast that would appear after the last view was unmounted is dropped. (Starting a file download, and copying to the clipboard on a page that is not a secure context, put a hidden element into `<body>` for the duration of that one call.) `document.title` is not touched.
- Popups stay inside the mount root: it is the containing block of everything positioned `fixed`, it clips, and it scrolls with your page. Internal `z-index` values do not compete with yours (`isolation: isolate`); use `zIndex` to place the root.
- Sizes that used to depend on the browser window depend on the mount root: viewport units are replaced by root-relative ones, and every `@media (max-width)` block has a container-query twin, so a narrow box gets the narrow-screen layout whatever the window width.
- Text properties your page would otherwise pass down (font, colour, line height, letter spacing, alignment, …) are reset at the root; `box-sizing`, margins and paddings are reset for everything inside with a specificity above element selectors (`* { … }`, `button { … }`, `a { … }` on your page do not get through).
- Keyboard shortcuts (Delete, Ctrl+Z, Ctrl+A, …) act only when the key event comes from inside the mount root, or when focus is on the page itself and the user's last click was in that root. Typing in your own inputs is never intercepted.
- Storage keys carry `storagePrefix`.

**Not guaranteed**

- Rules of yours that reach into the root with higher specificity than an element selector do apply: `#app button { … }`, `.content a { … }`, `.page * { … }`. Mount LoomCanvas outside such containers, or exclude it in your selectors (`:not(.lc-root *)`).
- `!important` rules of yours win.
- `@font-face` family names and `@keyframes` names cannot be scoped in CSS. `fonts.css` registers `Inter Variable`, `Sora Variable` and `JetBrains Mono Variable` for the whole document. Keyframe names are prefixed, except two plain ones: `spin` and Vue Flow's `dashdraw`. A `@keyframes spin` of your own loaded after LoomCanvas' stylesheet replaces LoomCanvas' (and the reverse).
- Inherited properties not in the reset list, and anything applied through `*` with `!important`.
- Browser features that are document-wide by nature: the leave-page warning when a canvas has unsaved changes (`beforeunload`), drag-and-drop of files onto the canvas, the clipboard.
- JavaScript globals: LoomCanvas defines none, but it is not sandboxed. A Content-Security-Policy of your page applies to it; [Content-Security-Policy](#content-security-policy) lists what it needs.

Browser support for the embedded layout: container queries and container units (Chrome and Edge 105, Safari 16, Firefox 110).

If you need a hard boundary (a host page you do not control, hostile CSS), put the stand-alone app in an `<iframe>` instead; see [Server notes](#server-notes).

### Content-Security-Policy

LoomCanvas runs under a strict policy of your page. It needs no `'unsafe-eval'` and no inline script. What it does need:

| Directive | Needs | Why |
| --- | --- | --- |
| `script-src` | the origin that serves your bundle (or `dist-lib/`) | Nothing else: no inline script, no `eval` |
| `style-src` | the same, plus `'unsafe-inline'` | Nodes, menus and popups are positioned with `style` attributes |
| `connect-src` | your API origin, `blob:`, `data:` | The adapter's calls; previews and downloads are read back with `fetch()` |
| `img-src`, `media-src` | the origin that serves the files, `blob:`, `data:` | Results and uploads; local previews |
| `font-src` | the origin that serves `fonts/` | Only when you include `fonts.css` |

The policy `examples/react-host` is served with, for an API and file origin of `https://canvas.example.com`:

```text
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://canvas.example.com; media-src 'self' data: blob: https://canvas.example.com; connect-src 'self' data: blob: https://canvas.example.com; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

The browser check of that example fails on any violation (memory adapter, HTTP adapter on another origin, the custom element; adding nodes, running, switching theme and language, unmounting).

### Fonts

The stylesheets name three font families with system fallbacks and contain no `@font-face`. Choose one:

- include `fonts.css` (it references `./fonts/*.woff2` next to it);
- declare the same family names yourself, pointing at wherever you host the files;
- include nothing: the interface falls back to system fonts.

## Theme, language, branding

- Theme: `dark`, `light` or `system`. `theme` option at mount, `setTheme()` later. To restyle beyond that, override the design tokens on the root: `.lc-root { --cyan: #7c3aed; … }` (the tokens are in `web/src/styles/design-tokens.css`; they are not yet a stable API).
- Language: `en` and `zh-CN`. `messages` overrides any text by key path, for example `{ en: { views: { list: { title: 'Boards' } } } }`. Language is page-wide: all mounted views share it.
- Branding (Shape 1): `brand: { name, logoUrl, showName }`, or `false` for no brand block; with `shell: 'none'` there is no brand at all. `showName: false` shows your logo alone, with the name as its text alternative (the same rule as the site setting "Show the site name next to the logo": without a logo the name is always shown). The page title is yours.

## Authentication

LoomCanvas does not sign your users in and does not provide single sign-on. It sends whatever headers you give it.

- **Shape 2 with your own backend**: your adapter makes the calls; authenticate them like any other call of your product.
- **Either shape with the stock server**: the server authenticates `Authorization: Bearer <session token>` and has its own accounts (one personal canvas space per account, plus the teams it is a member of - see [Server notes](#server-notes)). Mapping your users onto those accounts is your backend's job. Two patterns:
  1. *Token exchange.* Your backend creates one LoomCanvas account per user of yours (`POST /api/auth/register`), keeps its credentials, signs it in server-side (`POST /api/auth/login`) and hands the session token to your page; `getAuth` returns it. Sessions last 12 hours (30 days with `remember: true`); on 401 `onAuthRequired` fires and you fetch a new one.
  2. *Gateway.* Your reverse proxy authenticates your own session cookie or token and injects the `Authorization` header for the mapped LoomCanvas account before forwarding to the LoomCanvas server. The page needs no `getAuth` headers at all (return `{}`), and the token never reaches the browser.
- The stock server has no administrative API that creates accounts: an account comes from `POST /api/auth/register`, which works only while registration is open (Settings → Site, or `REGISTRATION_OPEN`). If only your backend should be able to create accounts, keep registration open and block that path for everybody else at your reverse proxy. If the accounts already exist, close registration.
- Provider API keys, prices and models are per LoomCanvas account. If your users should not manage them, switch `modelManagement` off (the Models page and the set-up guide go with it) and configure providers for each account from your backend through the API.

## Server notes

What an integrator needs to know about the stock server:

- **Cross-origin API.** When your page and the LoomCanvas API are on different origins, list your page's origin in `CORS_ORIGIN` ([configuration.md](configuration.md)). Allowed request headers are `Authorization`, `Content-Type`, `X-Locale` and `X-Space`; other headers of yours must be added by a gateway on the same origin as the API or the preflight fails.
- <a id="spaces-and-teams"></a>**Spaces (teams).** The stock server keeps every account's work in its personal space and lets accounts share a **team** space ([api.md](api.md#spaces-and-teams)). Which space a request acts in is one request header: `X-Space: <team id>` for a team the signed-in account is a member of, `X-Space: personal` or no header for its personal space. Everything from before teams sends no header and is unchanged.
  - *Shape 1 (the whole app).* Without the `space` option the user switches spaces in the top bar (personal space, their teams, "create a team", "join with an invite") and the app sends the header itself. With `space: '<team id>'` or `space: 'personal'` the app is pinned to that space and the user cannot switch: in a team the top bar names the team and the user's role there as plain text, in the personal space nothing is shown in that place. `features.spaceSwitch: false` does the same without pinning. `features.teamAdmin: false` removes the Team page and leaves the switcher for switching only: no "create a team", no "join with an invite", and no member counts next to the teams. The `space` event tells you which space the user is in.
  - *Shape 2 (the editor).* `createHttpAdapter({ space: '<team id>' })` sends the header with every request of that adapter. An adapter of your own decides this itself.
  - *Team canvases need two more things from an adapter*, which `createHttpAdapter` already does: the edit lock (`POST /api/workflow/:id/lock { sessionId }` when the canvas is opened for editing and then every 12 seconds, `DELETE` on leaving, a `sendBeacon` to `…/lock/release` when the page closes; `423 canvas.locked` means another editing session - somebody else, or the same person's other tab - is editing) and a revision with every save (`baseRevision` in `PUT /api/workflow/:id`, taken from the `revision` of the last answer; `409 canvas.conflict` means the canvas has moved on). A team space refuses a content save without `baseRevision`. In a personal space both are optional and an adapter that knows neither works as before. How the editor uses them is in [Taking turns](#taking-turns-edit-lock-and-save-conflicts).
  - *Mapping your organisations onto teams.* There is no administrative API that creates teams or adds members on somebody's behalf. Your backend does what a person would: the super admin authorises the account that will own the team (`PATCH /api/admin/users/:id { "canCreateTeams": true }`), that account creates the team (`POST /api/teams`), creates an invite link (`POST /api/teams/:id/invitations`), and each member account accepts it (`POST /api/team-invitations/:token/accept`). Roles are then set by the owner account (`PATCH /api/teams/:id/members/:userId`). Removing a member (`DELETE .../members/:userId`) takes effect on that member's next request.
  - A team's provider keys are entered once, by its owner or an admin, and used by every member without being shown to them - which is usually what an integrator wants instead of configuring providers per account.
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
- **Size.** The editor is about 500 kB of gzipped JavaScript plus 58 kB of CSS in one piece; it is not split further and includes both languages and every node type.
- **The built-in guide describes the stock product.** With features off it drops whole sections and single sentences, but it is prose: a remaining sentence may still name a button of the toolbar you removed (`palette: false`). Leave `guide` off if every word has to match your product.
- **Read-only is coarse.** `readOnly` makes nodes inert: users cannot open a result in the lightbox or copy text from a node. Switching it on does not cancel a run in progress; what changed while it was on is saved when it is switched off. For a presentable read-only view, the stock app's share page is better.
- **Polling only.** Run state is polled; there is no push or streaming interface in the adapter yet.
- **Responsive layout in a box** depends on container queries. Boxes of 440 px to 1000 px wide are covered by the browser tests; anything narrower has not been tried.
- **Share links** need hash or history routing (Shape 1) or `adapter.share.linkFor` (Shape 2). In memory mode "Open" in "my shares" shows the share page in place when `share` is among the pages; the copied address is still an in-app path your own site would have to answer.
- **Not yet run by the project**: history-mode routing (memory and hash modes are tested), an Angular or Svelte host (React, Vue and a framework-free page are run; the custom element is run in a plain page and in React), server-side rendering frameworks such as Next.js, Safari and Firefox (the browser tests run on Chrome), the opt-in editor features other than cost and templates beyond their entry points (`share`, `brandKit`, `assetLibrary`, `batchRun`, `batchDownload`, `canvasSwitch` in Shape 2: the browser sweep of the feature switches opens their menus and dialogs against the stock server, it does not carry a share, a batch or a download through), a hand-written adapter against a backend other than the stock server. Server-side rendering is not supported: the entries need a browser, import them on the client only.
- **Tokens and class names are not stable.** Restyling through design tokens works today and may break on upgrade.
