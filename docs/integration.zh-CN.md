# 把 LoomCanvas 集成进你自己的产品

[English](integration.md)

> 状态：早期开发阶段。这里描述的集成 API 是 0.1 版：有测试、有文档，但在第一个打了标签的版本发布之前仍可能变化（见[兼容性](#兼容性)）。

LoomCanvas 可以独立部署运行（`docker compose up`），也可以集成进另一个 Web 产品。这一页写给做后一件事的开发者。

你拿到的是代码和它的文档：两个入口，由你编译进自己的前端。它们周围的一切都是你的：你的用户、你的登录、你的后端对接、你的 API Key、你的品牌、你的部署。LoomCanvas 不替你托管任何东西，不提供单点登录，也不需要知道你的用户存在。项目维护这两个入口，并保证它们可用。

目录：[两种形态](#两种形态) · [获取文件](#获取文件) · [形态一：整站嵌入](#形态一整站嵌入) · [形态二：只嵌编辑器](#形态二只嵌编辑器) · [适配器](#适配器) · [文档格式](#文档格式) · [功能开关](#功能开关) · [样式隔离](#样式隔离) · [主题、语言与品牌](#主题语言与品牌) · [认证](#认证) · [服务端说明](#服务端说明) · [兼容性](#兼容性) · [许可](#许可) · [限制](#限制)

## 两种形态

| | 形态一：整站嵌入 | 形态二：只嵌编辑器 |
| --- | --- | --- |
| 是什么 | 完整的单页应用（画布列表、编辑器、素材库、模型管理、生成记录、设置：你选哪些页面就有哪些），挂载在你页面的一个元素里 | 只有画布编辑器：画布、工具面板、节点、连线、运行、结果、队列按钮、撤销和重做、缩放、整理、小地图 |
| 入口 | `loomcanvas-web/app` → `mountLoomCanvas(el, options)` | `loomcanvas-web/editor` → `mountEditor(el, options)`、Vue 组件 `<LoomCanvasEditor>`、自定义元素 `<loom-canvas-editor>` |
| 后端 | 一个说 LoomCanvas API 的服务端（[api.md](api.zh-CN.md)）；通常就是自带的服务端，愿意的话可以放在你的网关后面 | 任意：由你提供一个**适配器**（几个函数）。现成的有两个：一个对接自带的服务端，一个不需要服务端 |
| 登录 | 你的（`getAuth`）；不给的话用 LoomCanvas 自己的页面 | 你的：调用是适配器发的 |
| LoomCanvas 的顶栏和侧栏 | `shell: 'full'` 或 `'none'` | 没有 |
| 画布列表、账号、设置页 | 有（`pages` 里列出的那些） | 没有。打开哪张画布由你决定 |
| 什么时候用 | 你想把这个产品原样放进自己的产品里，并继续用它的服务端 | 你想把画布编辑作为自己产品的一项功能，并自己掌握它周围的数据模型 |

两者和独立部署的应用是同一份代码：独立部署的应用本身就是这两个入口的使用方（`web/src/main.ts` 调用的启动代码与 `mountLoomCanvas` 相同）。

## 获取文件

没有任何东西发布到 npm。请从仓库构建这个库：

```bash
cd web
npm ci
npm run build:lib        # -> web/dist-lib/
```

| 文件 | 是什么 |
| --- | --- |
| `app.js`、`editor.js` | 两个入口，ES 模块。`vue` 保留为 import（对等依赖，`^3.4`） |
| `standalone/app.js`、`standalone/editor.js` | 同样的两个入口，但把 Vue 打在里面，给没有打包器的页面或不用 Vue 的宿主用 |
| `chunks/`、`standalone/chunks/` | 按需加载的代码（应用在每个页面第一次打开时加载它；编辑器是一个文件） |
| `app.css`、`editor.css` | 每个入口一份样式表。必需 |
| `fonts.css`、`fonts/` | 可选：三款自托管的字体（见[字体](#字体)） |
| `types/` | TypeScript 类型声明 |
| `licenses/fonts-OFL-1.1.txt` | 字体的许可文本；分发字体时要一并带上 |

使用方式：

- 有打包器：在 `web/` 里执行 `npm pack`（或者用 `"loomcanvas-web": "file:../loomcanvas/web"` 引用这个目录），然后导入 `loomcanvas-web/app`、`loomcanvas-web/editor`、`loomcanvas-web/app.css`、`loomcanvas-web/editor.css`、`loomcanvas-web/fonts.css`。包的 `exports` 映射指向 `dist-lib/`。
- 没有打包器：把 `dist-lib/` 复制到你的静态文件里，在 `<script type="module">` 中导入 `…/dist-lib/standalone/app.js`。这个目录要保持完整：入口按相对路径加载自己的 chunk，里面没有任何地方引用 `/assets` 这样的绝对路径，所以放在任何基础地址下都能用。

默认入口为什么把 Vue 作为对等依赖：`<LoomCanvasEditor>` 是由你应用的 Vue 渲染的，而一个页面里的两份 Vue 不共享响应式。LoomCanvas 用到的其他东西（vue-router、Pinia、vue-i18n、Vue Flow、TDesign、axios）都打包在内、归它私有：它在你的元素里作为自己的 Vue 应用运行，不往你的应用上安装任何东西。如果你的宿主不是 Vue 应用，用 `standalone/` 入口，完全不用管 Vue。

0.1 版的体积（压缩后；括号里是 gzip 后）：`editor.js` 1.49 MB（401 kB），`editor.css` 440 kB（51 kB）；应用入口加载一个 686 kB（202 kB）的核心 chunk，外加每个页面一个 chunk（编辑器页面再加约 800 kB，gzip 后 200 kB），`app.css` 719 kB（84 kB）；`standalone/` 版本里 Vue 另占约 135 kB（40 kB）。

可运行的示例在 [`examples/`](../examples/README.md)。

## 形态一：整站嵌入

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

挂载元素必须有尺寸（例如 `height: 640px`，或者是一个 flex 或 grid 单元格）：LoomCanvas 填满它的容器，不会根据自己的内容决定大小。元素没有高度时会打一条警告日志。

### `mountLoomCanvas(el, options)` 的选项

全部可选。

| 选项 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `apiBase` | string | `/api` | 兼容 LoomCanvas 的 API 的基础地址 |
| `fileBase` | string | `apiBase` 的源 | 提供 `/files/<key>` 的源 |
| `getAuth` | `() => headers \| Promise<headers>` | 无 | 你的认证：请求头，每次调用前都会问一次。给了它，LoomCanvas 绝不显示自己的落地页、登录页、注册页和密码页，也不保存任何凭证 |
| `onAuthRequired` | `() => void` | 无 | API 返回 401 时调用（配合 `getAuth`）；每秒最多一次 |
| `user` | `{ name, id?, email?, avatarUrl?, role? }` | 取自 `GET /api/bootstrap` | 当前登录的是谁，以你的系统所知为准；显示在外壳里。`role: 'owner'` 会显示站点管理的那几个设置分区（它们的接口在服务端无论如何都只允许超级管理员调用） |
| `getUser` | `() => user \| Promise<user>` | 无 | 同上，在启动时解析 |
| `routerMode` | `'memory' \| 'hash' \| 'history'` | `'memory'` | 导航在地址栏里怎么体现：完全不体现、`#/canvases`，或者 `basePath` 下的真实路径 |
| `basePath` | string | `/` | 应用位于你站点的哪个子路径下（hash 和 history 模式） |
| `initialPage` | 页面名或应用内路径 | 第一个允许的页面 | memory 模式下从哪里开始 |
| `onNavigate` | `(route) => void` | 无 | 每次导航后调用；载荷与 `route` 事件相同 |
| `shell` | `'full' \| 'none'` | `'full'` | `'none'`：只有页面内容，没有顶栏也没有侧栏；导航由你用 `navigate()` 提供 |
| `pages` | 页面名 | 全部 | 存在的页面。其余页面无法到达（通过链接、通过 `navigate()`、通过地址都不行），指向它们的链接也不渲染 |
| `features` | 部分[功能开关](#功能开关) | 全部打开 | 给了 `getAuth` 时，`account` 和 `externalLinks` 初始为关 |
| `nodeLayout` | `'a' \| 'b' \| 'c'` | `'a'` | 用户没有保存过偏好时，生成节点用的布局 |
| `brand` | `{ name?, logoUrl? } \| false` | 服务端的站点设置 | 外壳里的名称和 Logo；`false` 去掉品牌区块 |
| `theme` | `'dark' \| 'light' \| 'system'` | 保存过的选择，否则 `'dark'` | 初始主题。给了它，主题就归你控制（`setTheme`） |
| `locale` | `'en' \| 'zh-CN'` | 保存过的选择，否则跟随浏览器 | 初始语言。给了它，语言就归你控制（`setLocale`） |
| `messages` | `{ en?: {...}, 'zh-CN'?: {...} }` | 无 | 文案覆盖，合并到内置文案之上（键路径与 `web/src/locales/` 相同） |
| `storagePrefix` | string | `loomcanvas-` | 每个 `localStorage` / `sessionStorage` 键的前缀 |
| `zIndex` | number | 无 | 挂载根在你页面里的 `z-index` |

页面名：`home`（工作台）、`canvases`、`canvas`、`assets`、`brand-kits`、`models`、`history`、`settings`、`setup`、`share`。

### 句柄

| 方法 | 含义 |
| --- | --- |
| `navigate(to, params?)` | 前往一个页面（`'canvases'`，或 `'canvas'` 加 `{ id }`）或一个应用内路径（`'/canvas/abc'`）。不在 `pages` 里的页面不会进入 |
| `setTheme(theme)` / `setLocale(locale)` | 切换主题 / 语言 |
| `on(event, handler)` | 订阅；返回一个取消订阅的函数 |
| `unmount()` | 移除加到你元素里的一切 |

### 事件

| 事件 | 载荷 | 时机 |
| --- | --- | --- |
| `ready` | `{}` | 第一个页面已经显示出来 |
| `route` | `{ name, path, params }` | 每次导航之后 |
| `canvas:saved` | `{ canvasId, updatedAt }` | 一张画布保存了 |
| `run:started`、`run:finished`、`run:failed` | `{ canvasId, nodeId, nodeType, runIds, error? }` | 一个节点开始运行 / 运行完成 / 运行失败 |
| `result` | `{ canvasId, nodeId, nodeType, outputs: [{ type, url }], text? }` | 一个节点有了结果 |
| `error` | `{ scope, message, cause? }` | 启动引导、加载或 `getUser` 失败（`scope`：`bootstrap`、`load`、`auth`） |

### 路由

- `memory`（默认）：地址栏是你的。想要深链接，就把 `route` 同步到你自己的路由里，并在你的路由变化时调用 `navigate()`。
- `hash`：`…/your/page#/canvas/abc`。深链接和后退按钮不用改服务端就能用。
- `history`：`basePath` 下的真实路径。你的服务端必须用你的宿主页面响应这些路径。

一个页面上只应有一个挂载的视图使用 `hash` 或 `history`。

分享链接（`/share/<token>`）是按应用自己的路由拼出来的，所以要在 `hash` 或 `history` 模式下才打得开；在 `memory` 模式下请关掉 `features.share`，或者自己处理 `share` 页面。

## 形态二：只嵌编辑器

```js
import { mountEditor, createHttpAdapter } from 'loomcanvas-web/editor'
import 'loomcanvas-web/editor.css'

const editor = mountEditor(document.getElementById('editor'), {
  adapter: createHttpAdapter({ apiBase: '/api', getAuth: () => ({ Authorization: `Bearer ${token}` }) }),
  canvasId: 'abc',
})
editor.on('saved', ({ updatedAt }) => console.log('saved', updatedAt))
```

Vue：

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

`<LoomCanvasEditor>` 是 `mountEditor` 外面的一层薄封装：编辑器仍然在组件的元素里作为自己的 Vue 应用运行，所以你的应用不需要装我们的 Pinia、vue-i18n 或路由。props 就是下面的选项（`onChange` 对应 `change` 事件）。响应式的 props：`canvasId`、`theme`、`locale`、`nodeLayout`、`readOnly`；其余的只在挂载时读取（改 `:key` 可以重新挂载）。`document` 只是初始文档。句柄的方法暴露在组件的 ref 上。

React 和其他框架：在 effect 里调用 `mountEditor`，在它的清理函数里调用 `unmount()`；或者用 `defineLoomCanvasEditorElement()` 注册一次自定义元素，再设置它的 `options` 属性（`canvas-id`、`theme`、`locale`、`node-layout`、`read-only` 这几个 attribute 会更新已挂载的编辑器；事件是 DOM 的 `CustomEvent`，载荷在 `detail` 里；句柄是 `editor` 属性）。自定义元素渲染到 light DOM 里，不是 shadow root。

### `mountEditor(el, options)` 的选项

| 选项 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `adapter` | [EditorAdapter](#适配器) | 必填 | 编辑器的后端 |
| `canvasId` | string | 无 | 要通过 `adapter.loadCanvas` 加载的画布。之后编辑器通过 `adapter.saveCanvas` 保存 |
| `document` | [CanvasDocument](#文档格式) | 无 | 直接编辑这份文档：不通过适配器加载或保存任何东西，改动会报告给你。`canvasId` 和 `document` 二选一 |
| `onChange` | `(document) => void` | 无 | 文档变了（已防抖） |
| `changeDebounceMs` | number | 1500 | 一次改动被保存 / 报告之前的静默时间 |
| `readOnly` | boolean | false | 只能看：平移和缩放可用；节点没有反应，什么都不运行，什么都不保存 |
| `nodeLayout` | `'a' \| 'b' \| 'c'` | `'a'` | 生成节点的布局 |
| `features` | 部分[功能开关](#功能开关) | 只有编辑器自身的界面部件 | 适配器提供了所需的东西时，可以选择打开更多 |
| `nodeTypes` | 节点类型名 | 适配器能运行的全部 | 工具面板和菜单里提供的节点类型 |
| `onBack` | `() => void` | 无 | 在标题块里显示一个返回按钮，按下时调用它 |
| `theme`、`locale`、`messages`、`storagePrefix`、`zIndex` | | | 与应用入口相同。在这里，主题和语言始终归你控制 |

### 句柄

`getDocument()`、`setDocument(doc)`、`setCanvasId(id)`、`save()`、`fitView()`、`runAll()`、`runNode(id)`、`addNode(type, data?, position?)` → id、`undo()`、`redo()`、`setTheme()`、`setLocale()`、`setNodeLayout()`、`setReadOnly()`、`on()`、`unmount()`。

- `runAll()` 就是「全部运行」按钮：它运行通向某个输出节点的所有节点。`runNode(id)` 先运行它依赖的节点，再运行这一个节点。
- 会碰画布的方法在 `ready` 事件之前调用会抛错。
- `setDocument()` 会清空撤销历史。

### 事件

`ready` `{ canvasId }` · `change` `{ canvasId, document }`（已防抖） · `saved` `{ canvasId, updatedAt }`（只在给了 `canvasId` 时） · `run:started` / `run:finished` / `run:failed` · `result` · `selection` `{ nodeIds, edgeIds }` · `error` `{ scope, message, cause? }`（`scope`：`load`、`adapter`）。

### 编辑器显示什么

默认显示：画布、标题块（名称和保存状态）、工具面板、底部工具栏（缩放、适应视图、撤销、重做、整理、全部运行）、队列按钮、小地图、节点菜单、图片裁剪工具、节点搜索、画布外观面板。不打开开关就不显示：分享、模板、品牌包、素材库、批量运行、打包下载、费用、教程、切换到另一张画布、任何指向模型管理的链接、任何布局 / 主题 / 语言菜单。

## 适配器

编辑器只通过这个对象和外界打交道。类型在 `types/embed/types.d.ts`（`EditorAdapter`）。

| 成员 | 必需 | 用途 |
| --- | --- | --- |
| `loadCanvas(id)` → `{ id, document, updatedAt? }` | 是 | 加载一张画布；不存在时 reject |
| `saveCanvas(id, partialDocument)` → `{ updatedAt }` | 是 | 保存。可能只收到 `{ viewport }`：这不算内容改动，不应该改变 `updatedAt` |
| `listModels()` → `ModelSpec[]` | 是 | 用户可以选的模型（[architecture.md](architecture.md) 第 4.1 节） |
| `submitRun(req)` → `{ runId }` | 是 | 发起一次图片或视频运行 |
| `getRuns(ids)` → `Run[]` | 是 | 运行的状态，由编辑器轮询；不认识的 id 可以不返回 |
| `cancelRun(id)` | 是 | 取消一次未完成的运行 |
| `submitLlm(req)` → `{ taskId }`、`getLlm(taskId)` → `LlmTask` | 是 | 文本任务（语言模型节点和视频分析节点） |
| `upload(file, { filename?, onProgress? })` → `{ url, … }` | 是 | 存一个文件；`url` 就是写进文档的内容 |
| `resolveFileUrl(url)` → string | 是 | 文档里存的地址 → 浏览器能加载的地址。不需要处理的地址原样返回 |
| `capabilities()` → `{ maxUploadMb?, upstreamByUrl? }` | 否 | 上传 / 运行前检查的限制 |
| `estimate(req)` | 否 | 费用预估；`features.cost` 需要它 |
| `importRemoteFile(url)`、`downloadFile(url, name)`、`downloadZip(canvasId, urls?)` | 否 | 把粘贴进来的链接复制到存储里；通过你的后端下载；打包下载（`features.batchDownload`） |
| `runTool(tool, payload)` | 否 | 服务端的图片工具；没有它就不提供工具节点（切图、拼图、水印、调整尺寸、平台导出） |
| `listCanvases()` | 否 | `features.canvasSwitch` 需要它 |
| `brandKits`、`templates`、`assets`、`share` | 否 | 同名功能需要它们；数据结构跟自带的服务端一致（[api.md](api.zh-CN.md)） |

错误：用一个 `Error` 来 reject；它的 message 会显示给用户。可以带一个数字的 `status`（类似 HTTP 状态码），让编辑器区分客户端错误和暂时性错误。

运行靠轮询（`getRuns` / `getLlm`，有东西在运行时反复调用）。0.1 里没有流式的版本。

现成的适配器：

- `createHttpAdapter({ apiBase, getAuth, onAuthRequired, fileBase, locale, timeoutMs })`：自带服务端的 API。它有自己的 HTTP 客户端，只发送 `getAuth` 返回的请求头（外加 `X-Locale`）。独立部署的应用和形态一内部用的是同一个实现。
- `createMemoryAdapter({ canvases, models, runMs, resolveRun, resolveLlm })`：不需要服务端。画布存在内存里，上传的文件变成 object URL，运行在 `runMs` 之后「完成」，结果是一张生成出来的图片。用于演示、测试，以及在你的后端还不存在时先动手。它暴露 `canvases` 和 `runRequests` 供检查。

要自己写一个，就对着你的后端实现必需的成员。`web/test/adapterContract.ts` 是以可执行测试套件形式写成的契约；两个现成的适配器都通过了它，你也可以拿它跑你的适配器。

一个页面一个适配器：页面上挂载的所有编辑器共用最后传入的那个适配器（它们不一致时会打一条警告日志）。

## 文档格式

一张画布就是普通的 JSON。`loadCanvas` 返回的是它，`saveCanvas` 收到的是它，`getDocument()` / `setDocument()` 交换的是它，自带的服务端存的也是它。类型：`types/embed/document.d.ts` 里的 `CanvasDocument`、`CanvasNode`、`CanvasEdge`。

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

| 节点类型 | 你可以写的 `data` | 连接点 |
| --- | --- | --- |
| `text` | `text` | `text-out` |
| `image` | `imageUrl` | `image-out` |
| `video` | `videoUrl` | `video-out` |
| `image-collection` | `imageUrls[]` | `image-in`、`image-out` |
| `image-gen` | `prompt`、`model`、模型参数（`aspectRatio`、`resolution`、`count`） | `text-in`、`image-in`、`image-out` |
| `image-edit` | `instruction`、`model`、参数 | `text-in`、`image-in`、`image-out` |
| `video-gen` | `prompt`、`model`、`aspectRatio`、`duration`、`imgMode` | `text-in`、`image-in`、`image-last-in`、`video-out` |
| `video-edit` | `prompt`、`model`、`aspectRatio` | `text-in`、`video-in`、`image-in`、`video-out` |
| `llm` | `text`（结果）、`prompt`、`systemPrompt`、`model` | `text-in`、`image-in`、`text-out` |
| `video-analysis` | `text`（结果）、`prompt`、`model` | `text-in`、`video-in`、`image-in`、`text-out` |
| `output` | 无（它负责收集结果） | `image-in`、`video-in` |
| `slice`、`collage`、`watermark`、`fit-size`、`platform-export` | 该工具的设置（见 `CanvasNodeDataMap`） | `image-in`、`image-out` |
| `frame` | `label`、`w`、`h`；子节点在 `parentNode` 里写它的 id | 无 |

宿主自己创建或修改文档时要遵守的规则：

- `id` 是文档内唯一的任意字符串。`position` 是左上角在画布坐标系里的位置（设了 `parentNode` 时相对于分组框）。
- 一条连线把一个 `*-out` 连接点接到数据类型相同（文本、图片、视频）的 `*-in` 连接点上。两端有不存在的，加载时这条连线会被丢弃。
- 结果字段（`imageUrl`、`imageUrls`、`videoUrl`，以及结果节点的 `text`）、运行的记账字段（`taskId`、`taskIds`、`errorMsg`、`errorRunId`、`results`、`cost`）和测量出来的尺寸（`dimensions`）由编辑器写入。可以读，不要自己编。删掉一个结果字段会重置那个节点。
- `data` 里不认识的键会原样保留，所以你可以挂上自己的元数据；请给它们加前缀，避开以后新增的字段。
- `model` 必须是 `listModels()` 返回的某个 id。模型不认识的节点会显示一条提示，并且不运行。
- 地址按 `upload()` / 运行输出给出的原样保存，显示时经过 `resolveFileUrl()`。用自带的服务端时，它们是站内相对地址（`/files/<key>`）。

版本：`schemaVersion`（目前是 3，和自带的服务端用的是同一个数）在结构变化到旧的读取方会读错时提升。`migrateDocument(doc)`（两个入口都导出，没有依赖）把任何旧文档升到当前版本，并补上缺失的部分；编辑器每次加载都会运行它，所以你可以存任何过去版本的文档。版本号高于当前构建所认识的文档会被拒绝（`CanvasDocumentError`，code 为 `newer_version`），而不是被弄坏。请在第一份新版本的文档写出来之前先升级前端。

## 功能开关

`features` 隐藏的是入口；它是界面开关，不是访问控制。在形态二里，一项功能还需要它的后端：没有对应的适配器成员，不管你传什么它都是关的。

| 开关 | 隐藏什么 | 需要（形态二） |
| --- | --- | --- |
| `share` | 分享按钮、「我的分享」 | `adapter.share` |
| `templates` | 画布模板、文本模板 | `adapter.templates` |
| `brandKit` | 品牌包标签、单个节点的例外、品牌包编辑器 | `adapter.brandKits` |
| `assetLibrary` | 素材库对话框、「从素材库选择」、「保存到素材库」 | `adapter.assets` |
| `batchRun` | 批量运行 | |
| `batchDownload` | 打包下载 | `adapter.downloadZip` |
| `cost` | 所有地方的预估和费用 | `adapter.estimate` |
| `modelManagement` | 指向模型管理页的链接、「添加服务商」引导 | |
| `nodeLayoutSwitch`、`themeSwitch`、`localeSwitch` | 各自对应的切换入口（菜单、顶栏、设置） | |
| `guide` | 教程和快捷键表 | |
| `canvasSwitch` | 在编辑器里切换到 / 导入另一张画布 | `adapter.listCanvases` |
| `immersive` | 沉浸模式的开关（只在 `shell: 'full'` 时有） | |
| `account` | 用户菜单、退出登录、账号设置 | 不可用 |
| `externalLinks` | 指向文档和源代码的链接 | |
| `palette`、`queue`、`minimap`、`titleBar`、`backButton`、`canvasStyle`、`imageEditor`、`search` | 名字所指的那个编辑器界面部件 | |

默认值：形态一全部打开（给了 `getAuth` 时：`account` 和 `externalLinks` 关闭）。形态二只打开最后一行（`backButton` 要给了 `onBack` 才打开）。

## 样式隔离

LoomCanvas 渲染在你的文档里（light DOM），不在 iframe 里，也不在 shadow root 里。这具体意味着什么：

**保证的**

- `app.css` / `editor.css` 的每一条规则都限定在挂载根之内：选择器在构建时被改写（`:root`、`html`、`body` → `.lc-root`；其余的都加上 `:where(.lc-root)` 前缀，包括 TDesign 和 Vue Flow 的样式）。没有任何规则能匹配到你页面上的元素。这一点由一个针对样式表的单元测试和一个浏览器测试来检查，后者对比宿主元素在挂载前后的计算样式。
- 设计令牌（CSS 自定义属性）、主题属性（`data-theme`、`theme-mode`）和 `lang` 都设在挂载根上，绝不设在 `<html>` 或 `<body>` 上。
- 不往 `<body>` 或 `<head>` 里追加任何东西：对话框、菜单、轻提示、大图查看和日期选择器都挂在挂载根内部的一个图层上。不碰 `document.title`。
- 弹出层留在挂载根之内：它是所有 `fixed` 定位元素的包含块，它会裁剪，并且跟着你的页面滚动。内部的 `z-index` 值不和你的竞争（`isolation: isolate`）；用 `zIndex` 来安放这个根。
- 原来取决于浏览器窗口的尺寸，现在取决于挂载根：视口单位被换成相对于根的单位，每个 `@media (max-width)` 块都有一个容器查询的孪生版本，所以不管窗口多宽，窄的盒子得到的就是窄屏布局。
- 你的页面本来会往下传的文本属性（字体、颜色、行高、字间距、对齐等）在根上被重置；`box-sizing`、外边距和内边距对内部的所有元素重置，优先级高于元素选择器（你页面上的 `* { … }`、`button { … }`、`a { … }` 进不来）。
- 键盘快捷键（Delete、Ctrl+Z、Ctrl+A 等）只在按键事件来自挂载根内部时生效，或者在焦点位于页面本身、且用户最后一次点击落在这个根里时生效。在你自己的输入框里打字绝不会被拦截。
- 存储键带有 `storagePrefix`。

**不保证的**

- 你的规则如果以高于元素选择器的优先级伸进根里，是会生效的：`#app button { … }`、`.content a { … }`、`.page * { … }`。请把 LoomCanvas 挂在这类容器之外，或者在你的选择器里把它排除掉（`:not(.lc-root *)`）。
- 你的 `!important` 规则会赢。
- `@font-face` 的字体族名和 `@keyframes` 的名字在 CSS 里无法限定作用域。`fonts.css` 为整个文档注册 `Inter Variable`、`Sora Variable` 和 `JetBrains Mono Variable`。关键帧的名字大多加了前缀，但有一个就叫 `spin`；你自己的 `@keyframes spin` 如果在 LoomCanvas 的样式表之后加载，会替换掉它（反过来也一样）。
- 不在重置清单里的继承属性，以及任何通过 `*` 加 `!important` 施加的东西。
- 本质上作用于整个文档的浏览器功能：画布有未保存改动时的离开页面提醒（`beforeunload`）、把文件拖放到画布上、剪贴板。
- JavaScript 全局变量：LoomCanvas 一个都不定义，但它没有被沙箱隔离。你页面的 Content-Security-Policy 对它生效（它需要 `style-src 'unsafe-inline'` 用于 style 属性，`img-src` / `media-src` / `connect-src` 用于你的 API 和文件的源，`font-src` 用于字体，`blob:` 和 `data:` 用于预览）。

嵌入式布局的浏览器支持：容器查询和容器单位（Chrome 和 Edge 105、Safari 16、Firefox 110）。

如果你需要一条硬边界（你控制不了的宿主页面、带敌意的 CSS），请改为把独立部署的应用放进 `<iframe>`；见[服务端说明](#服务端说明)。

### 字体

样式表里写了三个字体族名，并带系统字体作为回退，其中不含 `@font-face`。三选一：

- 引入 `fonts.css`（它引用旁边的 `./fonts/*.woff2`）；
- 自己声明同样的字体族名，指向你托管这些文件的位置；
- 什么都不引入：界面回退到系统字体。

## 主题、语言与品牌

- 主题：`dark`、`light` 或 `system`。挂载时用 `theme` 选项，之后用 `setTheme()`。想做更多的样式改动，就在根上覆盖设计令牌：`.lc-root { --cyan: #7c3aed; … }`（令牌在 `web/src/styles/design-tokens.css` 里；它们还不是稳定的 API）。
- 语言：`en` 和 `zh-CN`。`messages` 按键路径覆盖任意文案，例如 `{ en: { views: { list: { title: 'Boards' } } } }`。语言是整个页面范围的：所有挂载的视图共用。
- 品牌（形态一）：`brand: { name, logoUrl }`，或者用 `false` 去掉品牌区块；`shell: 'none'` 时完全没有品牌。页面标题是你的。

## 认证

LoomCanvas 不替你的用户登录，也不提供单点登录。你给它什么请求头，它就发什么。

- **形态二，用你自己的后端**：调用是你的适配器发的；像你产品里的其他调用一样给它们做认证。
- **任一形态，用自带的服务端**：服务端认证的是 `Authorization: Bearer <session token>`，并且有它自己的账号（每个账号一个画布空间）。把你的用户对应到这些账号上是你后端的事。有两种做法：
  1. *换取凭证。* 你的后端为你的每个用户创建一个 LoomCanvas 账号（`POST /api/auth/register`），保管它的凭据，在服务端替它登录（`POST /api/auth/login`），再把会话凭证交给你的页面；`getAuth` 返回它。会话有效期 12 小时（带 `remember: true` 时 30 天）；遇到 401 时 `onAuthRequired` 触发，你再去取一个新的。
  2. *网关。* 你的反向代理认证你自己的会话 cookie 或凭证，在转发给 LoomCanvas 服务端之前，为对应的 LoomCanvas 账号注入 `Authorization` 请求头。页面完全不需要 `getAuth` 请求头（返回 `{}`），凭证也永远不会到达浏览器。
- 自带的服务端没有用来创建账号的管理接口：账号来自 `POST /api/auth/register`，而它只在开放注册期间可用（「设置 → 站点」，或 `REGISTRATION_OPEN`）。如果只应该让你的后端能创建账号，就保持注册开放，并在你的反向代理上对其他所有人挡住这个路径。如果账号已经都有了，就关闭注册。
- 服务商的 API Key、价格和模型是按 LoomCanvas 账号分开的。如果不该让你的用户管理它们，就不要把 `models` 放进 `pages`，关掉 `modelManagement`，并由你的后端通过 API 为每个账号配置服务商。

## 服务端说明

集成不需要改动服务端；下面这些已有的设置有影响：

- **跨域 API。** 你的页面和 LoomCanvas API 不同源时，把你页面的源写进 `CORS_ORIGIN`（[configuration.md](configuration.zh-CN.md)）。允许的请求头是 `Authorization`、`Content-Type` 和 `X-Locale`；你的其他请求头必须由一个与 API 同源的网关来加，否则预检请求会失败。
- **文件。** `/files/<key>` 的响应带 `Access-Control-Allow-Origin: *` 和 `Cross-Origin-Resource-Policy: cross-origin`，所以图片和视频可以从别的源加载。保存的地址仍是站内相对地址；前端会在前面加上 `fileBase`。
- **用 iframe 代替嵌入。** 自带的服务端发送 `X-Frame-Options: SAMEORIGIN` 和 `frame-ancestors 'self'`：独立部署的应用只能被同源的页面放进 iframe。要从你的产品里用 iframe 嵌它，就通过你的反向代理把两者放在同一个源下提供，或者在代理上修改这两个响应头。
- **你页面的 CSP** 对嵌入的 LoomCanvas 生效（见[样式隔离](#样式隔离)）；自带服务端的 CSP 不生效，因为被提供出去的是你的页面。

## 兼容性

公开 API，受包版本号（导出的 `VERSION`）的语义化版本约束：

- `loomcanvas-web/app` 和 `loomcanvas-web/editor` 的导出；
- 选项的名字和含义、句柄的方法、事件的名字和载荷；
- `EditorAdapter` 接口、`createHttpAdapter`、`createMemoryAdapter`；
- 画布文档格式和 `migrateDocument`；
- 功能开关的名字和页面名；
- 挂载根上的类名 `lc-root`，以及 `exports` 映射里列出的 `dist-lib/` 文件。

有一个守卫测试（`web/test/public-api.test.ts`）给这个接口面做了快照：改动它会让测试失败，直到快照、这一页和更新日志一起更新。

不公开、任何版本都可能变：`web/src/` 下的其他一切、内部的类名和 DOM 结构、设计令牌的名字、chunk 的文件名、存储键的名字（前缀除外）、自带服务端的 API 中 [api.md](api.zh-CN.md) 没有写到的部分。

1.0 之前，次版本（0.x）可能包含不兼容的改动；它们列在[更新日志](../CHANGELOG.md)的「集成」一节下。新增一个可选的适配器成员、一个选项、一个事件或一个功能开关不算不兼容的改动；形态二里新增的功能开关初始为关。

## 许可

LoomCanvas 以 AGPL-3.0-or-later 授权（[LICENSE](../LICENSE)）。把它集成进你的产品，属于对基于它的作品的「传播」（conveying）或「网络使用」（network use）：

- 如果你的产品带着 LoomCanvas 被他人通过网络使用，或者被分发给他人，AGPL 要求你以 AGPL 向这些用户提供组合作品的对应源代码，包括你的修改；
- 这适用于你的产品分发的前端打包产物（LoomCanvas 的代码在里面），如果你运行或修改了自带的服务端，也适用于服务端。

如果你不能或不想以 AGPL 发布你的产品，你需要商业授权：见 [COMMERCIAL.md](../COMMERCIAL.md)。名称和 Logo 受 [TRADEMARK.md](../TRADEMARK.md) 约束；用 `brand` 去掉它们是允许的，把修改过的版本当作官方项目来展示则不允许。第三方声明：[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)；内置的字体采用 SIL Open Font License 1.1。

这一节是概要，不是法律意见。

## 限制

围绕它规划项目之前，请先读这一节。

- **一个页面一个运行时。** API 地址、认证、适配器、语言、主题和存储前缀由页面上的每个 LoomCanvas 视图共用。同一个运行时的多个视图可以工作（各有各的导航、状态和画布）；一个页面上两个适配器、语言或主题不同的编辑器不行。那种情况请用 iframe。
- **它周围的一切都要你自己做。** 编辑器入口里没有「新建画布」（画布什么时候存在由你的产品决定），没有用户开通，没有 SSO，没有配额或计费界面。用自带的服务端时，把用户对应到账号、为每个账号配置服务商，都是你后端的工作。
- **不是沙箱。** light DOM 嵌入与你共用同一个文档：见[不保证的](#样式隔离)部分。宿主那边优先级高于元素选择器的激进 CSS 会漏进来。
- **体积。** 编辑器是约 400 kB 的 gzip 后 JavaScript 加 51 kB 的 CSS，一整块；没有再拆分，并且包含两种语言和所有节点类型。
- **只读很粗糙。** `readOnly` 让节点完全不响应：用户不能在大图里打开结果，也不能从节点里复制文字。打开它不会取消正在进行的运行；它打开期间发生的改动，在它关掉时保存。想要一个拿得出手的只读视图，自带应用的分享页更合适。
- **只有轮询。** 运行状态靠轮询；适配器里还没有推送或流式的接口。
- **盒子里的响应式布局**依赖容器查询。宽度 440 px 到 1000 px 的盒子有浏览器测试覆盖；更窄的没有试过。
- **分享链接**需要 hash 或 history 路由（形态一），或者 `adapter.share.linkFor`（形态二）。
- **项目自己还没有跑过的**：history 模式的路由（memory 和 hash 模式有测试）、框架里的自定义元素（它是在一个纯页面里测的）、React 或 Angular 宿主（不用框架的那个示例最接近）、Safari 和 Firefox（浏览器测试跑在 Chrome 上）、费用和模板以外需要主动打开的编辑器功能（形态二里的 `share`、`brandKit`、`assetLibrary`、`batchRun`、`batchDownload`、`canvasSwitch`）、对着自带服务端以外的后端手写的适配器。不支持服务端渲染：入口需要浏览器，只能在客户端导入它们。
- **令牌和类名不稳定。** 通过设计令牌改样式今天可用，升级时可能失效。
