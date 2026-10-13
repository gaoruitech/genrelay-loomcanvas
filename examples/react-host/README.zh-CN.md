# react-host：React 应用里的编辑器

[English](README.md)

[docs/integration.zh-CN.md](../../docs/integration.zh-CN.md) 里的形态二，宿主是 React：一个 Vite + React + TypeScript 项目，像真实项目那样把库当作 `loomcanvas-web` 这个包来引（`package.json` 里写的是 `"loomcanvas-web": "file:../../web"`）。它只是示例，不在生产构建里：`web/` 和 `server/` 都不依赖它，Docker 构建不带 `examples/`，它的依赖也不在随产品分发的第三方声明里（`npm run licenses:check` 管的是随产品分发的东西；`npm run versions:check` 倒是会检查这个包的版本号、许可和 Node 版本下限与仓库一致）。

它用四种写法接入编辑器，宿主页头上一个页签对应一种：

| 页签 | 文件 | 演示了什么 |
| --- | --- | --- |
| Component · memory adapter | `src/LoomCanvasEditor.tsx` | 在 effect 里调 `mountEditor`、在清理函数里调 `unmount()`，包成一个带 props、带类型的事件和 ref 的组件。用 `createMemoryAdapter`，完全不需要服务端 |
| Component · HTTP adapter | 同一个组件 | 用 `createHttpAdapter` 对接另一个源上自带的 LoomCanvas 服务端，登录是宿主自己的 |
| Custom element | `src/LoomCanvasElement.tsx` | 在 JSX 里写 `<loom-canvas-editor>`：这个标签的类型声明、通过 ref 设置 `options` 属性、attribute、DOM 事件 |
| Minimal snippet | `src/MinimalEditor.tsx` | 集成文档里印的那一小段，原样照搬 |

## 运行

```bash
# 1. 构建库（一次就够；改了 web/src 之后再构建一次）
cd web && npm ci && npm run build:lib && cd ..

# 2. 安装并启动示例（http://127.0.0.1:5173）
cd examples/react-host
npm install
npm run dev
```

`PORT=5180 npm run dev` 换一个端口。`npm run typecheck` 对着库的类型声明检查这个示例（`npm run build` 也会做这一步）。

第一个页签直接就能用。「Component · HTTP adapter」需要一个允许这个页面所在源访问的 LoomCanvas 服务端：

```bash
# 另开一个终端，在仓库根目录：在 :3000 起一个 LoomCanvas 服务端
CORS_ORIGIN=http://127.0.0.1:5173 ADMIN_PASSWORD=change-me-please npm start     # 见 docs/getting-started.zh-CN.md
```

在这个页签里用 LoomCanvas 的账号登录（`admin` 和上面那个密码）。服务端在别的地址：在 `examples/react-host/.env.local` 里写 `VITE_LC_API=https://your-server/api`，或者在页面地址后面加 `?api=https://your-server/api`。加 `?space=<团队 id>`，适配器就在那个团队空间里工作，而不是个人空间。

### 生产构建，配上严格的 Content-Security-Policy

```bash
npm run build        # 先做类型检查，再写出 dist/
npm run preview      # http://127.0.0.1:4174，带着 csp.mjs 里的策略提供
```

`node examples/serve.mjs` 也会把同一个 `dist/` 放在 `http://127.0.0.1:4173/react-host/` 下，和其他示例在一起，带的是同一份策略。策略只放行一个 API 的源：`npm run preview` 用 `VITE_LC_API` 里的那个，`serve.mjs` 用 `LC_API` 里的那个（两者默认都是 `http://127.0.0.1:3000/api`）；别忘了把页面的源（`:4174` 或 `:4173`）写进服务端的 `CORS_ORIGIN`。`npm run dev` 不带策略，因为 React 的快速刷新要用一段内联脚本。

`csp.mjs` 就是集成文档里说的「嵌入的编辑器需要的策略」：不要 `unsafe-eval`，不要内联脚本；`style-src 'unsafe-inline'` 给 style 属性用；`connect-src` / `img-src` / `media-src` 放行 API 的源；`blob:` 和 `data:` 给预览用；`font-src 'self'` 给 `fonts.css` 用。

## 看哪里

- `src/main.tsx`：`import 'loomcanvas-web/editor.css'`（必需）和 `'loomcanvas-web/fonts.css'`（可选）。开着 `<StrictMode>`，所以开发时每个组件都会先挂载、卸载，再挂载一次。
- `src/LoomCanvasEditor.tsx`：可以直接拿去用的组件。
  - 它引的是 `loomcanvas-web/standalone/editor`，Vue 已经打在里面：React 项目不用装 Vue。
  - 只在挂载时读取的选项（`adapter`、`document`、`features`、`changeDebounceMs`、`storagePrefix`）是挂载那个 effect 的依赖：它们一变，编辑器就重新挂载。适配器对象要保持不变（放在模块顶层，或者用 `useMemo`），否则每次渲染都会挂出一个新的编辑器。
  - `theme`、`locale`、`nodeLayout`、`readOnly` 和 `canvasId` 是随时生效的：各有一个小 effect，对已挂载的编辑器调 `setTheme()`、`setLocale()`、`setNodeLayout()`、`setReadOnly()`、`setCanvasId()`。
  - 事件处理函数存在一个 ref 里，所以每次渲染传新函数也不会引起重新挂载。
  - ref 上暴露了 `addNode`、`runAll`、`runNode`、`undo`、`redo`、`fitView`、`getDocument`、`setDocument`、`save`。
  - `document` 是初始文档：编辑器是非受控的。要留一份自己的副本，就从 `change` 事件里拿。
- `src/App.tsx`：编辑器的事件变成 React 的状态（`ready`、从 `change` 得到的节点数和连线数、`selection`、`saved`）；宿主的工具栏反过来驱动编辑器。HTTP 那个页签里编辑器带着 `key={canvasId}`：`canvasId` 本身是随时生效的 prop，但 `ready` 每次挂载只发一次，而这个宿主想在每张画布加载好时都收到它。HTTP 适配器每个会话建一个，并且留着那个会话的凭证：退出登录会卸载编辑器，它离开时补存的那一次仍然带着有效的凭证。
- `src/LoomCanvasElement.tsx`：自定义元素。`declare module 'react'` 让 JSX 认识这个标签；`options` 是属性（property）而不是 attribute，所以通过 ref 来设；`read-only` 要么有、要么没有；事件不冒泡，所以监听器直接挂在元素上。
- 功能开关（右边那块面板）：第一组默认打开，第二组要在 `features` 里打开，并且适配器得有对应的能力。用内存适配器时，`templates`、`assetLibrary`、`brandKit`、`share`、`batchDownload` 和 `canvasSwitch` 怎么勾都是关的，因为它背后没有这些东西；用 HTTP 适配器时全部可用。
- 「mounted」：卸载编辑器，再挂载回来。卸载之后不留任何东西：挂载元素是空的，`<head>` 和 `<body>` 里自始至终没有多出任何元素或样式。

## 哪些是真的，哪些做了简化

- 登录表单是在浏览器里直接调 `POST /api/auth/login` 拿凭证的。这只是为了让示例能独立运行；真实产品里这一步由你的后端来做。见集成文档的「认证」一节。
- `"loomcanvas-web": "file:../../web"` 是把那个目录链接进来。在别的仓库里用，就在 `web/` 里执行 `npm pack` 再安装那个压缩包，或者让 `file:` 指向你检出的目录。因为是链接，库的构建产物在这个项目之外：`vite.config.ts` 会找出它实际所在的位置，让开发服务器能读到（从压缩包安装的包不需要这一步）。
- 这个包的类型声明里提到了 Vue（给 `<LoomCanvasEditor>` 这个 Vue 组件用的）。不装 Vue 的 React 项目在 `tsconfig.json` 里保留 `"skipLibCheck": true` 就行，这个示例就是这么做的。
