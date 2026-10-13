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
| 后端 | 一个提供 LoomCanvas API 的服务端（[api.zh-CN.md](api.zh-CN.md)）；通常就是自带的服务端，愿意的话可以放在你的网关后面 | 任意：由你提供一个**适配器**（几个函数）。现成的有两个：一个对接自带的服务端，一个不需要服务端 |
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
| `standalone/app.js`、`standalone/editor.js` | 同样的两个入口，但把 Vue 打在里面，给没有打包工具的页面或不用 Vue 的宿主用 |
| `chunks/`、`standalone/chunks/` | 按需加载的代码（应用在每个页面第一次打开时加载它；编辑器是一个文件） |
| `app.css`、`editor.css` | 每个入口一份样式表。必需 |
| `fonts.css`、`fonts/` | 可选：三款自托管的字体（见[字体](#字体)） |
| `types/` | TypeScript 类型声明 |
| `licenses/fonts-OFL-1.1.txt` | 字体的许可文本；分发字体时要一并带上 |

在 `web/` 里执行 `node scripts/build-lib.mjs --out=<目录>`，同样的构建会写到另一个目录，不动 `dist-lib/`。

使用方式：

- 有打包工具：在 `web/` 里执行 `npm pack`（或者用 `"loomcanvas-web": "file:../loomcanvas/web"` 引用这个目录），然后导入 `loomcanvas-web/app`、`loomcanvas-web/editor`、`loomcanvas-web/app.css`、`loomcanvas-web/editor.css`、`loomcanvas-web/fonts.css`。包的 `exports` 映射指向 `dist-lib/`。
- 没有打包工具：把 `dist-lib/` 复制到你的静态文件里，在 `<script type="module">` 中导入 `…/dist-lib/standalone/app.js`。这个目录要保持完整：入口按相对路径加载自己的 chunk，里面没有任何地方引用 `/assets` 这样的绝对路径，所以放在任何基础地址下都能用。

默认入口为什么把 Vue 作为对等依赖：`<LoomCanvasEditor>` 是由你应用的 Vue 渲染的，而一个页面里的两份 Vue 不共享响应式。LoomCanvas 用到的其他东西（vue-router、Pinia、vue-i18n、Vue Flow、TDesign、axios）都打包在内、归它私有：它在你的元素里作为自己的 Vue 应用运行，不往你的应用上安装任何东西。如果你的宿主不是 Vue 应用，用 `standalone/` 入口，完全不用管 Vue。

0.1 版的体积（压缩后；括号里是 gzip 后）：`editor.js` 1.9 MB（500 kB），`editor.css` 500 kB（58 kB）；应用入口加载一个 930 kB（270 kB）的核心 chunk，外加每个页面一个 chunk（编辑器页面再加约 1 MB，gzip 后 240 kB），`app.css` 900 kB（106 kB）；`standalone/` 版本里 Vue 另占约 136 kB（39 kB）。`npm run build:lib` 会打印你这次构建的准确数字。

可运行的示例在 [`examples/`](../examples/README.zh-CN.md)。

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
| `user` | `{ name, id?, email?, avatarUrl?, role? }` | 取自 `GET /api/bootstrap` | 当前登录的是谁，以你的系统所知为准；显示在外壳里。`role: 'owner'` 会显示站点管理的那几个设置分区（不管这里传什么，它们的接口在服务端都只有超级管理员能调） |
| `getUser` | `() => user \| Promise<user>` | 无 | 同上，在启动时解析 |
| `routerMode` | `'memory' \| 'hash' \| 'history'` | `'memory'` | 导航在地址栏里怎么体现：完全不体现、`#/canvases`，或者 `basePath` 下的真实路径 |
| `basePath` | string | `/` | 应用位于你站点的哪个子路径下（hash 和 history 模式） |
| `initialPage` | 页面名或应用内路径 | 第一个存在的页面 | memory 模式下从哪里开始 |
| `onNavigate` | `(route) => void` | 无 | 每次导航后调用；载荷与 `route` 事件相同 |
| `shell` | `'full' \| 'none'` | `'full'` | `'none'`：只有页面内容，没有顶栏也没有侧栏；导航由你用 `navigate()` 提供 |
| `pages` | 页面名 | 全部 | 存在的页面。其余页面无法到达（通过链接、通过 `navigate()`、通过地址都不行），指向它们的链接也不渲染。属于某项已关闭功能的页面同样不存在，不管这个清单里写没写（见[功能开关](#功能开关)） |
| `features` | 部分[功能开关](#功能开关) | 全部打开 | 给了 `getAuth` 时，`account` 和 `externalLinks` 初始为关 |
| `nodeLayout` | `'a' \| 'b' \| 'c'` | `'a'` | 用户没有保存过偏好时，生成节点用的布局 |
| `brand` | `{ name?, logoUrl?, showName? } \| false` | 服务端的站点设置 | 外壳里的名称和 Logo；`false` 去掉品牌区块。`showName: false`（默认 `true`）只显示你的 Logo、旁边不写名称，给本身已经带着名称的 Logo 用；名称仍然是 Logo 的替代文字，没给 `logoUrl` 时名称总是显示 |
| `space` | `'personal'` 或团队 id | 无：用户自己切换 | 把应用固定在一个[空间](#空间与团队)里：不显示空间切换器，指向别的空间的链接不会被打开。团队必须是已登录账号所在的团队 |
| `theme` | `'dark' \| 'light' \| 'system'` | 保存过的选择，否则 `'dark'` | 初始主题。给了它，主题就归你控制（`setTheme`） |
| `locale` | `'en' \| 'zh-CN'` | 保存过的选择，否则跟随浏览器 | 初始语言。给了它，语言就归你控制（`setLocale`） |
| `messages` | `{ en?: {...}, 'zh-CN'?: {...} }` | 无 | 文案覆盖，合并到内置文案之上（键路径与 `web/src/locales/` 相同） |
| `storagePrefix` | string | `loomcanvas-` | 每个 `localStorage` / `sessionStorage` 键的前缀 |
| `zIndex` | number | 无 | 挂载根在你页面里的 `z-index` |

页面名：`home`（工作台；团队空间里是团队首页）、`canvases`、`canvas`、`assets`、`brand-kits`、`models`、`history`、`team`（成员、用量、动态、团队设置；只在团队空间里有）、`settings`、`setup`、`share`、`join`（邀请链接打开的那一页）。

### 句柄

| 方法 | 含义 |
| --- | --- |
| `navigate(to, params?)` | 前往一个页面（`'canvases'`，或 `'canvas'` 加 `{ id }`）或一个应用内路径（`'/canvas/abc'`）。不存在的页面（不在 `pages` 里，或者它所属的功能关了）不会进入 |
| `setTheme(theme)` / `setLocale(locale)` | 切换主题 / 语言 |
| `on(event, handler)` | 订阅；返回一个取消订阅的函数 |
| `unmount()` | 移除加到你元素里的一切 |

### 事件

| 事件 | 载荷 | 时机 |
| --- | --- | --- |
| `ready` | `{}` | 第一个页面已经显示出来 |
| `route` | `{ name, path, params }` | 每次导航之后 |
| `canvas:saved` | `{ canvasId, updatedAt }` | 一张画布保存了 |
| `space` | `{ id, kind, name, role }` | 用户进入了一个空间：`id` 是 `'personal'` 或团队 id，`kind` 是 `'personal'` 或 `'team'`，`role` 是他在里面的角色（`'owner'` 团长、`'admin'` 管理员、`'member'` 成员；个人空间里是 `'owner'`） |
| `run:started`、`run:finished`、`run:failed` | `{ canvasId, nodeId, nodeType, runIds, error? }` | 一个节点开始运行 / 运行完成 / 运行失败 |
| `result` | `{ canvasId, nodeId, nodeType, outputs: [{ type, url }], text? }` | 一个节点有了结果 |
| `error` | `{ scope, message, cause? }` | 启动引导、加载或 `getUser` 失败（`scope`：`bootstrap`、`load`、`auth`） |

### 路由

应用内的路径带着空间：团队空间的页面以 `/t-<团队 id>` 开头（`/t-6712…a0/canvases`），个人空间的页面不带前缀（`/canvases`）。`navigate('canvases')` 这类按页面名的跳转留在当前空间；`navigate('/t-<团队 id>/canvases')` 进入那个团队，`navigate('/canvases?space=personal')` 回到个人空间。`route` 事件报告的路径带着前缀，页面 `name` 在哪个空间里都一样。

- `memory`（默认）：地址栏是你的。想要深链接，就把 `route` 同步到你自己的路由里，并在你的路由变化时调用 `navigate()`。
- `hash`：`…/your/page#/canvas/abc`。深链接和后退按钮不用改服务端就能用。
- `history`：`basePath` 下的真实路径。你的服务端必须用你的宿主页面响应这些路径。

一个页面上只应有一个挂载的视图使用 `hash` 或 `history`。

分享链接（`/share/<token>`）和团队的邀请链接（`/join/<token>`）是按应用自己的路由拼出来的，所以要在 `hash` 或 `history` 模式下才打得开；在 `memory` 模式下请关掉 `features.share`（和 `features.teamAdmin`），或者自己处理 `share`、`join` 页面（收到这样的链接后调 `navigate('/join/<token>')`）。

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

React：在 effect 里调 `mountEditor`，在它的清理函数里调 `unmount()`，见 [React](#react)。其他宿主，或者标记不是你自己渲染的场合：用[自定义元素](#自定义元素) `<loom-canvas-editor>`。

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
- 有未保存的改动时调 `unmount()`（`canvasId` 模式）：编辑器在离开的路上保存一次。这个请求在 `unmount()` 返回之前就交给了适配器，或者紧跟在还没回来的那次保存后面；它的结果晚些才到，不再理会。所以编辑器卸掉之后适配器还得能用一小会儿：让用户退出登录时，等卸载之后再清掉 `getAuth` 读的那个凭证，或者给每个会话一个自己的适配器对象、各自留着自己的凭证。
- `document` 模式下调 `unmount()`：`change` / `onChange` 是防抖的，`unmount()` 之后不再报告任何东西。需要最后 `changeDebounceMs` 之内的改动，就先调 `getDocument()`。

### 事件

`ready` `{ canvasId }`（每次挂载只发一次，在第一张画布显示出来时；之后调 `setCanvasId()` 不会再发） · `change` `{ canvasId, document }`（已防抖） · `saved` `{ canvasId, updatedAt }`（只在给了 `canvasId` 时） · `created` `{ canvasId, fromCanvasId }`（编辑器通过 `adapter.createCanvas` 把它的文档存成了一张新画布：「复制一份」，或者保存冲突、丢了锁之后的「把我的版本另存为副本」；编辑器留在 `fromCanvasId` 上，要打开副本就调 `setCanvasId(canvasId)`） · `run:started` / `run:finished` / `run:failed` · `result` · `selection` `{ nodeIds, edgeIds }` · `error` `{ scope, message, cause? }`（`scope`：`load`、`adapter`）。

### 编辑器显示什么

默认显示：画布、标题块（名称和保存状态）、工具面板、底部工具栏（缩放、适应视图、撤销、重做、整理、全部运行）、队列按钮、小地图、节点菜单、图片裁剪工具、节点搜索、画布外观面板。不打开开关就不显示：分享、模板、品牌包、素材库、批量运行、打包下载、成本、教程、切换到另一张画布、任何指向模型管理的链接、任何布局 / 主题 / 语言菜单。

### React

在 effect 里调 `mountEditor`，在它的清理函数里调 `unmount()`。引 `standalone/` 入口：Vue 已经打在里面，React 项目不用装 Vue。

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

这就是 `examples/react-host/src/MinimalEditor.tsx`，项目自己在浏览器里跑过它：生产构建配上严格的 Content-Security-Policy 跑一遍，Vite 开发服务器开着 `<StrictMode>` 再跑一遍。在 React 里要注意这几点：

- **适配器对象只建一个。** 建在组件外面，或者用 `useMemo`。每次渲染都新建一个对象，就会每次都挂出一个新的编辑器；何况一个页面本来就只能共用一个适配器。
- **有的选项只在挂载时读，有的随时生效。** `adapter`、`document`、`features`、`nodeTypes`、`messages`、`storagePrefix`、`changeDebounceMs` 和 `onBack` 只读一次：要改就重新挂载（放进 effect 的依赖，或者给你的组件换 `key`）。`theme`、`locale`、`nodeLayout`、`readOnly` 和 `canvasId` 可以改已挂载的编辑器：各用一个 effect 去调 `setTheme()`、`setLocale()`、`setNodeLayout()`、`setReadOnly()`、`setCanvasId()`。
- **事件处理函数放在 ref 里。** 处理函数通常每次渲染都是新的；从 ref 里读，它们就不用进 effect 的依赖。
- **`document` 是初始文档。** 编辑器是非受控的：从 `onChange` / `change` 里留一份自己的副本，或者调 `setDocument()`。
- **StrictMode 没问题。** `unmount()` 会把编辑器加到元素里的东西全部移走；`<head>` 和 `<body>` 里本来就什么都没加。
- **`ready` 每次挂载只发一次。** 想在每张画布加载好时都收到信号，就给你的组件加 `key={canvasId}`，而不是去改已挂载编辑器的 `canvasId`。
- **给元素一个尺寸**，并且不要往它里面渲染 React 的子节点。
- **TypeScript。** 两个入口共用同一份类型声明，里面提到了 Vue（给 `<LoomCanvasEditor>` 这个 Vue 组件用的）。没装 Vue 的话，保留 `"skipLibCheck": true`。

`examples/react-host/src/LoomCanvasEditor.tsx` 是按这些规则写好的完整组件（props、带类型的事件、带命令式方法的 ref），可以直接拿去用。同一个示例里，它既对着 `createMemoryAdapter` 跑，也通过 `createHttpAdapter` 对着另一个源上自带的服务端跑。

### 自定义元素

`defineLoomCanvasEditorElement()` 注册 `<loom-canvas-editor>`（想换标签名可以传进去；重复调用什么都不做）。这个元素渲染到 light DOM 里，不是 shadow root，所以样式表的引入方式和 `mountEditor` 一样。

- `options` 是**属性（property）**，值是一个对象：设置它就挂载编辑器，再设置一次就重新挂载，设成 `null` 就卸载。把元素从文档里移走也会卸载。
- `canvas-id`、`theme`、`locale`、`node-layout` 和 `read-only` 这几个 attribute 会更新已挂载的编辑器。挂载时，`options` 里的值优先于 attribute，所以用 attribute 控制这五项时，就不要把它们写进 `options`。`read-only` 只要出现（并且不是 `"false"`）就是只读。
- 事件是 DOM 的 `CustomEvent`，名字和编辑器的事件相同（`ready`、`change`、`run:started` 等），载荷在 `detail` 里。它们不冒泡：要在元素本身上监听。
- 句柄是 `editor` 属性（没有挂载编辑器时是 `null`）。

在 React 加 TypeScript 里，要先为 JSX 声明这个标签和它的 attribute：

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

然后这样用（`examples/react-host/src/LoomCanvasElement.tsx`，项目跑它的方式和上面那个组件一样）：

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

## 适配器

编辑器只通过这个对象和外界打交道。类型在 `types/embed/types.d.ts`（`EditorAdapter`）。

| 成员 | 必需 | 用途 |
| --- | --- | --- |
| `loadCanvas(id)` → `{ id, document, updatedAt?, revision?, metaRevision?, access?, lock?, … }` | 是 | 加载一张画布；不存在时 reject。那几个可选字段用来打开[轮流编辑](#轮流编辑编辑锁与保存冲突) |
| `saveCanvas(id, partialDocument, options?)` → `{ updatedAt, revision? }` | 是 | 保存。**内容保存**带 `nodes`、`edges`、`settings`、`brandKitId`（视口随它们一起），从不带名字；`options` 是 `{ baseRevision?, force? }`，不理会它的适配器仍然是「后写覆盖」。**元信息保存**只带 `{ name }`（改名）、`{ viewport }` 或 `{ legacyLayout: false }`，不带 `options`，不能因为锁或版本被拒绝，也不能改变 `revision`；只带视口的保存还不应该改变 `updatedAt` |
| `listModels()` → `ModelSpec[]` | 是 | 用户可以选的模型（[architecture.md](architecture.md) 第 4.1 节） |
| `submitRun(req)` → `{ runId }` | 是 | 发起一次图片或视频运行 |
| `getRuns(ids)` → `Run[]` | 是 | 运行的状态，由编辑器轮询；不认识的 id 可以不返回 |
| `cancelRun(id)` | 是 | 取消一次未完成的运行 |
| `submitLlm(req)` → `{ taskId }`、`getLlm(taskId)` → `LlmTask` | 是 | 文本任务（语言模型节点和视频分析节点） |
| `upload(file, { filename?, onProgress? })` → `{ url, … }` | 是 | 存一个文件；`url` 就是写进文档的内容 |
| `resolveFileUrl(url)` → string | 是 | 文档里存的地址 → 浏览器能加载的地址。不需要处理的地址原样返回 |
| `acquireLock(id, { takeover? })` → `{ lock, revision?, heartbeatMs?, name?, metaRevision?, state? }`、`releaseLock(id, { unloading? })`、`peekLock(id)` → `{ lock, revision?, name?, metaRevision?, canEdit?, canTakeOver?, pollMs? }` | 否 | 编辑锁：拿锁或续期、归还、只看不拿。没有 `acquireLock` 时编辑器从不拿锁；没有 `peekLock` 时只读的编辑器改为每 20 秒重新载入一次画布 |
| `createCanvas(partialDocument, { visibility? })` → `{ id }` | 否 | 把一份文档存成新画布。「复制一份」和「把我的版本另存为副本」需要它；没有就不提供这两个选择 |
| `capabilities()` → `{ maxUploadMb?, upstreamByUrl?, storageWritable? }` | 否 | 上传 / 运行前检查的限制。`storageWritable: false`：现在存不了新文件，图片、视频节点在运行前就写明 |
| `estimate(req)` | 否 | 成本预估；`features.cost` 需要它 |
| `importRemoteFile(url)`、`downloadFile(url, name)`、`downloadZip(canvasId, urls?)` | 否 | 把粘贴进来的链接复制到存储里；通过你的后端下载；打包下载（`features.batchDownload`） |
| `runTool(tool, payload)` | 否 | 服务端的图片工具；没有它就不提供工具节点（切图、拼图、水印、调整尺寸、平台导出） |
| `listCanvases()` | 否 | `features.canvasSwitch` 需要它 |
| `brandKits`、`templates`、`assets`、`share` | 否 | 同名功能需要它们；数据结构跟自带的服务端一致（[api.zh-CN.md](api.zh-CN.md)）。其中 `templates.createCanvasTemplate` / `removeCanvasTemplate` / `createTextTemplate` / `removeTextTemplate` 和 `assets.update` 是可选的：没有它们就不提供「存为模板」「新建片段」和对应的删除按钮 |

错误：用一个 `Error` 来 reject；它的 message 会显示给用户。可以带一个数字的 `status`（类似 HTTP 状态码），让编辑器区分客户端错误和暂时性错误。有两个错误码会改变编辑器的行为，见下一节。

### 轮流编辑：编辑锁与保存冲突

这一节全部是可选的。一样都不实现的适配器和以前完全一样：一个人用，后写覆盖。同一张画布可能被几个人打开时再实现它。

- **带版本的保存。** `loadCanvas` 返回一个数字 `revision`。编辑器下一次保存内容时把它作为 `options.baseRevision` 带回来，并期望返回里有新的 `revision`。存着的画布已经不是 `baseRevision` 那一版时，什么都不要写，用一个 `code` 为 `'canvas.conflict'`、`data` 为 `{ revision, lastEditedBy?: { id, name }, lastEditedAt?, canOverwrite? }` 的错误来 reject。编辑器会停止保存并让用户选：把我的版本另存为副本（需要 `createCanvas`）、载入最新版本，或者（仅当 `canOverwrite` 为真）覆盖，也就是带着 `options.force: true` 再存一次。同一张画布，编辑器同一时间只发**一个**内容保存，所以一次保存不会和它的前一次冲突。
- **编辑锁。** 有 `acquireLock` 时，编辑器打开画布时来要锁，之后每隔 `heartbeatMs`（默认 12000；`heartbeatSeconds` 仍然认）再要一次，标签页回到前台时立刻再要一次。锁在调用者手里：resolve `{ lock: { by: { id, name }, mine: true }, revision }`；这张画布不需要锁：resolve `{ lock: null }`。别的编辑会话拿着时，用 `code: 'canvas.locked'`、`data: { lock: { by: { id, name }, mine: false, sameUser?: boolean }, canTakeOver?: boolean, lost?: 'taken_over' | 'expired' | null }` 来 reject：编辑器以只读打开，说明谁正在编辑（`sameUser: true` 时说的是「你在另一个标签页打开了这张画布」），`canTakeOver` 为真时给「接管编辑」（这时它调 `acquireLock(id, { takeover: true })`）。心跳或 `saveCanvas` 收到同样的拒绝，表示这个编辑器丢了锁；`lost` 说明是怎么丢的，提示条照此措辞，编辑器立刻变成只读，不重试，并提供把没保存的改动另存为副本。`loadCanvas` 返回里已经带着一把不是 `mine` 的 `lock` 时，编辑器直接以只读打开，不调 `acquireLock`。
- **一个编辑器一把锁，不是一个账号一把。** 一个适配器实例代表一个编辑会话。`createHttpAdapter` 为每个实例生成一个会话 id（只放内存），每次调用自己带上；如果你的后端按账号加锁，同一个人的两个标签页会同时可编辑，靠版本检查把它们分开。
- **归还。** 编辑器在页面内关闭时调 `releaseLock(id)`；页面本身要没了（`pagehide`）时调 `releaseLock(id, { unloading: true })`：这时普通请求不保证发得出去，要用 `navigator.sendBeacon` 或带 `keepalive` 的 `fetch`，并且不要等回音。你那边同样要让锁自己过期。
- **只读地等着。** 只读并且标签页可见时，编辑器每隔 `pollMs`（默认 5000）调一次 `peekLock(id)`：`lock: null` 时给出「开始编辑」（从不悄悄拿锁）；`metaRevision` 变了就显示新的 `name`；`revision` 变了就重新载入画布；`canEdit` / `canTakeOver` 决定它给出哪些按钮。
- **改名是元信息。** 标题框失去焦点时，编辑器用 `saveCanvas(id, { name })` 保存新名字，因为别人正在编辑而只读时也一样；别处改的名字通过 `acquireLock` / `peekLock` 返回里的 `name` + `metaRevision` 跟上（`loadCanvas` 也请返回 `metaRevision`）。`access.canEdit: false` 时标题不可编辑。
- **按画布的权限。** `loadCanvas` 返回的 `access`：`{ canEdit?, canTakeOver?, canOverwrite?, canShare?, canSetVisibility? }`。`canEdit: false` 时以只读打开，不来要锁。没给的字段表示「可以」。
- 因为以上任何一种原因处于只读时，编辑器什么都不保存（包括视口），什么都不运行。它留着一条精简的工具栏（一枚「只读」标记、「更多」菜单，以及在对应功能开着时：可以浏览和下载的素材库、可以查看的分享），`readOnly` 选项则不留：那个选项连工具栏一起去掉。
- 错误的 `code` 和 `data` 可以直接挂在 `Error` 上，也可以在 HTTP 客户端的响应体里（`error.response.data.code` / `.data`），编辑器两处都认。类型声明里的 `AdapterError` 描述的就是它。

`createHttpAdapter` 已经按自带的服务端实现了这一切；在那里它对团队空间里的画布生效。

运行靠轮询（`getRuns` / `getLlm`，有东西在运行时反复调用）。0.1 里没有流式的版本。

现成的适配器：

- `createHttpAdapter({ apiBase, getAuth, onAuthRequired, fileBase, locale, timeoutMs, space })`：自带的服务端的 API。它有自己的 HTTP 客户端，只发送 `getAuth` 返回的请求头（外加 `X-Locale`；`space` 是团队 id 时再加 `X-Space`）。`space` 是这个适配器的每个请求作用的[空间](#空间与团队)：`'personal'`（默认）或一个团队 id；要换空间就另建一个适配器，并用它重新挂载编辑器。独立部署的应用和形态一内部用的是同一个实现。
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

关掉的功能不留任何入口：没有按钮、菜单项、页签、快捷键、提示或链接，内置教程里讲它的内容也一并不出。本身就是这项功能的页面跟着开关走：它不存在（侧栏里没有这一项，没有指向它的链接，用 `navigate()` 或地址都到不了），和没把它列进 `pages` 完全一样：

| 关掉的开关 | 不存在的页面 |
| --- | --- |
| `assetLibrary` | `assets` |
| `brandKit` | `brand-kits`（素材库的第二个页签；`assetLibrary` 关着而 `brandKit` 开着时，侧栏那一项直接进它） |
| `modelManagement` | `models`、`setup` |
| `teamAdmin` | `team` |

链接落脚的那两页（`share`、`join`）只由 `pages` 决定。`settings` 页对一个进去之后什么都看不到的人不存在：`account` 关着，外观的三个开关都关着，他又不是站点的超级管理员。

| 开关 | 隐藏什么 | 需要（形态二） |
| --- | --- | --- |
| `share` | 分享按钮、「我的分享」、团队设置里的「谁能创建分享链接」 | `adapter.share` |
| `templates` | 画布模板、文本模板、工作台上和空画布上的「从模板开始」 | `adapter.templates` |
| `brandKit` | 品牌包标签、单个节点的例外、品牌包编辑器、「品牌包」页 | `adapter.brandKits` |
| `assetLibrary` | 素材库对话框、「从素材库选择」、「保存到素材库」、「素材」页 | `adapter.assets` |
| `batchRun` | 批量运行 | |
| `batchDownload` | 打包下载，编辑器里的和画布卡片上的都算 | `adapter.downloadZip` |
| `cost` | 所有地方的金额：节点上、队列里、批量运行里的预估成本和实际成本；生成记录的成本列、成本那一块和导出里的几列；工作台；「模型管理」页上的价格；以及团队里「用量」「成员」「上限」中的金额（金额上限这时在那里既不显示也不能改，次数上限照旧）。服务端该怎么算、怎么拦还是照它的配置来 | `adapter.estimate` |
| `modelManagement` | 「模型管理」页和「添加服务商」引导、所有指向它们的链接、工作台上的服务商卡片 | |
| `nodeLayoutSwitch`、`themeSwitch`、`localeSwitch` | 各自对应的切换入口（编辑器菜单、顶栏、设置，以及登录页、引导页、加入页、分享页的顶栏） | |
| `guide` | 教程和快捷键表。它开着的时候，讲已关闭功能的章节和句子不出 | |
| `canvasSwitch` | 在编辑器里切换到 / 导入另一张画布 | `adapter.listCanvases` |
| `immersive` | 沉浸模式的开关（只在 `shell: 'full'` 时有） | |
| `account` | 用户菜单、退出登录、账号设置 | 不可用 |
| `externalLinks` | 会离开本产品的链接：文档、源代码、服务商的「获取 API Key」页面 | |
| `spaceSwitch` | 顶栏里的空间切换器（个人空间 / 团队、「创建团队」「用邀请码加入」），以及把东西复制到另一个空间之后的「过去看」。关掉：用户待在应用当前所在的那个空间（你自己调 `navigate()` 仍然可以换）。这时在团队里，顶栏那个位置只用文字写出团队名和用户在其中的角色；在个人空间里，那个位置什么都不显示 | 不可用 |
| `teamAdmin` | 「团队」页（成员、邀请链接、用量、动态、团队设置）和它的入口。成员由你的产品自己管时关掉它。关掉后空间切换器只用来换空间：不提供「创建团队」和「用邀请码加入」，列表里每个团队只写用户在其中的角色，不写成员数（团队首页同样不写成员数） | 不可用 |
| `palette`、`queue`、`minimap`、`titleBar`、`backButton`、`canvasStyle`、`imageEditor`、`search` | 名字所指的那个编辑器界面部件 | |

默认值：形态一全部打开（给了 `getAuth` 时：`account` 和 `externalLinks` 关闭）。形态二只打开最后一行（`backButton` 要给了 `onBack` 才打开）。

## 样式隔离

LoomCanvas 渲染在你的文档里（light DOM），不在 iframe 里，也不在 shadow root 里。这具体意味着什么：

**保证的**

- `app.css` / `editor.css` 的每一条规则都限定在挂载根之内：选择器在构建时被改写（`:root`、`html`、`body` → `.lc-root`；其余的都加上 `:where(.lc-root)` 前缀，包括 TDesign 和 Vue Flow 的样式）。没有任何规则能匹配到你页面上的元素。这一点由一个针对样式表的单元测试和一个浏览器测试来检查，后者对比宿主元素在挂载前后的计算样式。
- 设计令牌（CSS 自定义属性）、主题属性（`data-theme`、`theme-mode`）和 `lang` 都设在挂载根上，绝不设在 `<html>` 或 `<body>` 上。
- 不在 `<body>` 或 `<head>` 里留下任何东西：对话框、菜单、轻提示、悬停提示、大图查看和日期选择器都挂在挂载根内部的一个图层上；最后一个视图卸载之后才要出现的轻提示直接不出。（发起一次文件下载，以及在非安全上下文的页面上复制到剪贴板，会往 `<body>` 里放一个隐藏元素，只在那一次调用期间存在。）不碰 `document.title`。
- 弹出层留在挂载根之内：它是所有 `fixed` 定位元素的包含块，它会裁剪，并且跟着你的页面滚动。内部的 `z-index` 值不和你的竞争（`isolation: isolate`）；用 `zIndex` 来安放这个根。
- 原来取决于浏览器窗口的尺寸，现在取决于挂载根：视口单位被换成相对于根的单位，每个 `@media (max-width)` 块都有一个容器查询的孪生版本，所以不管窗口多宽，窄的盒子得到的就是窄屏布局。
- 你的页面本来会往下传的文本属性（字体、颜色、行高、字间距、对齐等）在根上被重置；`box-sizing`、外边距和内边距对内部的所有元素重置，优先级高于元素选择器（你页面上的 `* { … }`、`button { … }`、`a { … }` 进不来）。
- 键盘快捷键（Delete、Ctrl+Z、Ctrl+A 等）只在按键事件来自挂载根内部时生效，或者在焦点位于页面本身、且用户最后一次点击落在这个根里时生效。在你自己的输入框里打字绝不会被拦截。
- 存储键带有 `storagePrefix`。

**不保证的**

- 你的规则如果以高于元素选择器的优先级伸进根里，是会生效的：`#app button { … }`、`.content a { … }`、`.page * { … }`。请把 LoomCanvas 挂在这类容器之外，或者在你的选择器里把它排除掉（`:not(.lc-root *)`）。
- 你的 `!important` 规则会赢。
- `@font-face` 的字体族名和 `@keyframes` 的名字在 CSS 里无法限定作用域。`fonts.css` 为整个文档注册 `Inter Variable`、`Sora Variable` 和 `JetBrains Mono Variable`。关键帧的名字都加了前缀，只有两个例外：`spin` 和 Vue Flow 的 `dashdraw`。你自己的 `@keyframes spin` 如果在 LoomCanvas 的样式表之后加载，会替换掉 LoomCanvas 的那个（反过来也一样）。
- 不在重置清单里的继承属性，以及任何通过 `*` 加 `!important` 施加的东西。
- 本质上作用于整个文档的浏览器功能：画布有未保存改动时的离开页面提醒（`beforeunload`）、把文件拖放到画布上、剪贴板。
- JavaScript 全局变量：LoomCanvas 一个都不定义，但它没有被沙箱隔离。你页面的 Content-Security-Policy 对它生效；它需要什么，见 [Content-Security-Policy](#content-security-policy)。

嵌入式布局的浏览器支持：容器查询和容器单位（Chrome 和 Edge 105、Safari 16、Firefox 110）。

如果你需要一条硬边界（你控制不了的宿主页面、带敌意的 CSS），请改为把独立部署的应用放进 `<iframe>`；见[服务端说明](#服务端说明)。

### Content-Security-Policy

LoomCanvas 能在你页面的严格策略下运行。它不需要 `'unsafe-eval'`，也不需要内联脚本。它需要的是这些：

| 指令 | 需要 | 原因 |
| --- | --- | --- |
| `script-src` | 提供你的打包产物（或 `dist-lib/`）的源 | 别的都不要：没有内联脚本，没有 `eval` |
| `style-src` | 同上，外加 `'unsafe-inline'` | 节点、菜单和弹出层是用 `style` 属性定位的 |
| `connect-src` | 你的 API 的源、`blob:`、`data:` | 适配器发的请求；预览和下载是用 `fetch()` 读回来的 |
| `img-src`、`media-src` | 提供文件的源、`blob:`、`data:` | 结果和上传的文件；本地预览 |
| `font-src` | 提供 `fonts/` 的源 | 只在引入了 `fonts.css` 时需要 |

`examples/react-host` 就是带着下面这份策略提供的（这里假设 API 和文件的源是 `https://canvas.example.com`）：

```text
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://canvas.example.com; media-src 'self' data: blob: https://canvas.example.com; connect-src 'self' data: blob: https://canvas.example.com; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

那个示例的浏览器检查只要遇到一次违反策略就算失败（内存适配器、另一个源上的 HTTP 适配器、自定义元素；加节点、运行、切换主题和语言、卸载）。

### 字体

样式表里写了三个字体族名，并带系统字体作为回退，其中不含 `@font-face`。三选一：

- 引入 `fonts.css`（它引用旁边的 `./fonts/*.woff2`）；
- 自己声明同样的字体族名，指向你托管这些文件的位置；
- 什么都不引入：界面回退到系统字体。

## 主题、语言与品牌

- 主题：`dark`、`light` 或 `system`。挂载时用 `theme` 选项，之后用 `setTheme()`。想做更多的样式改动，就在根上覆盖设计令牌：`.lc-root { --cyan: #7c3aed; … }`（令牌在 `web/src/styles/design-tokens.css` 里；它们还不是稳定的 API）。
- 语言：`en` 和 `zh-CN`。`messages` 按键路径覆盖任意文案，例如 `{ en: { views: { list: { title: 'Boards' } } } }`。语言是整个页面范围的：所有挂载的视图共用。
- 品牌（形态一）：`brand: { name, logoUrl, showName }`，或者用 `false` 去掉品牌区块；`shell: 'none'` 时完全没有品牌。`showName: false` 只显示你的 Logo，名称作为它的替代文字（和站点设置「在 Logo 旁显示站点名称」是同一条规则：没有 Logo 时名称总是显示）。页面标题是你的。

## 认证

LoomCanvas 不替你的用户登录，也不提供单点登录。你给它什么请求头，它就发什么。

- **形态二，用你自己的后端**：调用是你的适配器发的；像你产品里的其他调用一样给它们做认证。
- **任一形态，用自带的服务端**：服务端认证的是 `Authorization: Bearer <session token>`，并且有它自己的账号（每个账号一个个人画布空间，外加它加入的团队，见[服务端说明](#服务端说明)）。把你的用户对应到这些账号上是你后端的事。有两种做法：
  1. *换取凭证。* 你的后端为你的每个用户创建一个 LoomCanvas 账号（`POST /api/auth/register`），保管它的凭据，在服务端替它登录（`POST /api/auth/login`），再把会话凭证交给你的页面；`getAuth` 返回它。会话有效期 12 小时（带 `remember: true` 时 30 天）；遇到 401 时 `onAuthRequired` 触发，你再去取一个新的。
  2. *网关。* 你的反向代理认证你自己的会话 cookie 或凭证，在转发给 LoomCanvas 服务端之前，为对应的 LoomCanvas 账号注入 `Authorization` 请求头。页面完全不需要 `getAuth` 请求头（返回 `{}`），凭证也永远不会到达浏览器。
- 自带的服务端没有用来创建账号的管理接口：账号来自 `POST /api/auth/register`，而它只在开放注册期间可用（「设置 → 站点」，或 `REGISTRATION_OPEN`）。如果只应该让你的后端能创建账号，就保持注册开放，并在你的反向代理上对其他所有人挡住这个路径。如果账号已经都有了，就关闭注册。
- 服务商的 API Key、价格和模型是按 LoomCanvas 账号分开的。如果不该让你的用户管理它们，就关掉 `modelManagement`（「模型管理」页和引导页随之不存在），并由你的后端通过 API 为每个账号配置服务商。

## 服务端说明

用自带的服务端做集成，需要知道这几件事：

- **跨域 API。** 你的页面和 LoomCanvas API 不同源时，把你页面的源写进 `CORS_ORIGIN`（[configuration.zh-CN.md](configuration.zh-CN.md)）。允许的请求头是 `Authorization`、`Content-Type`、`X-Locale` 和 `X-Space`；你的其他请求头必须由一个与 API 同源的网关来加，否则预检请求会失败。
- <a id="空间与团队"></a>**空间（团队）。** 自带的服务端把每个账号的东西放在它的个人空间里，并且允许多个账号共用一个**团队**空间（[api.zh-CN.md](api.zh-CN.md#空间与团队)）。请求作用于哪个空间只看一个请求头：`X-Space: <团队 id>` 表示已登录账号所在的某个团队，`X-Space: personal` 或不带这个头表示它的个人空间。有团队之前的一切都不带这个头，行为不变。
  - *形态一（整站嵌入）。* 不给 `space` 选项时，用户在顶栏里切换空间（个人空间、他加入的团队、「创建团队」「用邀请码加入」），请求头由应用自己带。给了 `space: '<团队 id>'` 或 `space: 'personal'`，应用就固定在那个空间里，用户不能切换：在团队里，顶栏只用文字写出团队名和用户在其中的角色；在个人空间里，那个位置什么都不显示。`features.spaceSwitch: false` 效果相同，但不固定空间。`features.teamAdmin: false` 去掉「团队」页，切换器只用来换空间：没有「创建团队」，没有「用邀请码加入」，团队旁边也不写成员数。`space` 事件告诉你用户现在在哪个空间。
  - *形态二（只嵌编辑器）。* `createHttpAdapter({ space: '<团队 id>' })` 让这个适配器发出的每个请求都带上这个头。自己写的适配器由它自己决定。
  - *团队画布对适配器多两个要求*，`createHttpAdapter` 已经做了：编辑锁（打开画布准备编辑时调 `POST /api/workflow/:id/lock { sessionId }`，之后每 12 秒调一次，离开时 `DELETE`，页面关闭时用 `sendBeacon` 调 `…/lock/release`；返回 `423 canvas.locked` 表示别的编辑会话正在编辑：别人，或者同一个人的另一个标签页）和每次保存带版本（`PUT /api/workflow/:id` 里的 `baseRevision`，取自上一次返回的 `revision`；返回 `409 canvas.conflict` 表示画布已经被改过）。团队空间拒绝不带 `baseRevision` 的内容保存。个人空间里两者都是可选的，两样都不懂的适配器照旧能用。编辑器怎么用它们见[轮流编辑](#轮流编辑编辑锁与保存冲突)。
  - *把你的组织对应到团队。* 没有「替别人创建团队、替别人加成员」的管理接口。你的后端要像人一样一步步做：超级管理员授权将要当团长的账号（`PATCH /api/admin/users/:id { "canCreateTeams": true }`），这个账号创建团队（`POST /api/teams`）、生成邀请链接（`POST /api/teams/:id/invitations`），每个成员账号接受邀请（`POST /api/team-invitations/:token/accept`）。角色由团长账号设置（`PATCH /api/teams/:id/members/:userId`）。移除成员（`DELETE …/members/:userId`）在这个成员的下一个请求上生效。
  - 团队服务商的 Key 由团长或管理员填一次，所有成员直接使用、看不到 Key。集成方通常正需要这个，而不是给每个账号分别配置服务商。
- **文件。** `/files/<key>` 的响应带 `Access-Control-Allow-Origin: *` 和 `Cross-Origin-Resource-Policy: cross-origin`，所以图片和视频可以从别的源加载。保存的地址仍是站内相对地址；前端会在前面加上 `fileBase`。
- **用 iframe 代替嵌入。** 自带的服务端发送 `X-Frame-Options: SAMEORIGIN` 和 `frame-ancestors 'self'`：独立部署的应用只能被同源的页面放进 iframe。要从你的产品里用 iframe 嵌它，就通过你的反向代理把两者放在同一个源下提供，或者在代理上修改这两个响应头。
- **你页面的 CSP** 对嵌入的 LoomCanvas 生效（见[样式隔离](#样式隔离)）；自带的服务端的 CSP 不生效，因为被提供出去的是你的页面。

## 兼容性

公开 API，受包版本号（导出的 `VERSION`）的语义化版本约束：

- `loomcanvas-web/app` 和 `loomcanvas-web/editor` 的导出；
- 选项的名字和含义、句柄的方法、事件的名字和载荷；
- `EditorAdapter` 接口、`createHttpAdapter`、`createMemoryAdapter`；
- 画布文档格式和 `migrateDocument`；
- 功能开关的名字和页面名；
- 挂载根上的类名 `lc-root`，以及 `exports` 映射里列出的 `dist-lib/` 文件。

有一个守卫测试（`web/test/public-api.test.ts`）给这个接口面做了快照：改动它会让测试失败，直到快照、这一页和更新日志一起更新。

不公开、任何版本都可能变：`web/src/` 下的其他一切、内部的类名和 DOM 结构、设计令牌的名字、chunk 的文件名、存储键的名字（前缀除外）、自带的服务端的 API 中 [api.zh-CN.md](api.zh-CN.md) 没有写到的部分。

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
- **体积。** 编辑器是约 500 kB 的 gzip 后 JavaScript 加 58 kB 的 CSS，一整块；没有再拆分，并且包含两种语言和所有节点类型。
- **内置教程写的是原装产品。** 功能关掉之后它会去掉整章和单句，但它毕竟是成段的文字：留下来的句子里仍可能提到你去掉的那条工具栏上的某颗按钮（`palette: false`）。如果每个字都得和你的产品对得上，就让 `guide` 保持关闭。
- **只读很粗糙。** `readOnly` 让节点完全不响应：用户不能在大图里打开结果，也不能从节点里复制文字。打开它不会取消正在进行的运行；它打开期间发生的改动，在它关掉时保存。想要一个拿得出手的只读视图，独立部署的应用自带的分享页更合适。
- **只有轮询。** 运行状态靠轮询；适配器里还没有推送或流式的接口。
- **盒子里的响应式布局**依赖容器查询。宽度 440 px 到 1000 px 的盒子有浏览器测试覆盖；更窄的没有试过。
- **分享链接**需要 hash 或 history 路由（形态一），或者 `adapter.share.linkFor`（形态二）。memory 模式下，`share` 在页面清单里时「我的分享」里的「打开」会在原地显示分享页；复制出来的地址仍然是一条应用内路径，得由你自己的站点来响应。
- **项目自己还没有跑过的**：history 模式的路由（memory 和 hash 模式有测试）、Angular 或 Svelte 宿主（React、Vue 和不用框架的页面都跑过；自定义元素在纯页面和 React 里跑过）、Next.js 这类带服务端渲染的框架、Safari 和 Firefox（浏览器测试跑在 Chrome 上）、成本和模板以外需要主动打开的编辑器功能在入口之后的部分（形态二里的 `share`、`brandKit`、`assetLibrary`、`batchRun`、`batchDownload`、`canvasSwitch`：功能开关的浏览器巡检会对着自带的服务端打开它们的菜单和对话框，但没有把一次分享、一次批量运行或一次下载走完）、对着自带的服务端以外的后端手写的适配器。不支持服务端渲染：入口需要浏览器，只能在客户端导入它们。
- **令牌和类名不稳定。** 通过设计令牌改样式今天可用，升级时可能失效。
