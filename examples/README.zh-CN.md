# 集成示例

[English](README.md)

四个把 LoomCanvas 集成进去的小「宿主产品」，配合 [docs/integration.zh-CN.md](../docs/integration.zh-CN.md) 看。它们都不在生产构建里。其中三个就是几个静态文件，由一个很小的静态服务器提供，库从 `web/dist-lib/` 加载；React 那个自己是一个小的 Vite 项目，把库当作一个包来引。

| 目录 | 形态 | 宿主 | 后端 | 演示了什么 |
| --- | --- | --- | --- | --- |
| [host-page](host-page/README.zh-CN.md) | 一：整站嵌入 | 纯 HTML + ES 模块 | 自带的 LoomCanvas 服务端（另一个源） | `shell: 'none'`，宿主自己的页头、导航和登录（喂给 `getAuth`），只开放一部分页面，主题和语言由宿主控制，同页第二个实例，`onAuthRequired`。宿主导航里的「Space」选择把应用固定在个人空间或某个团队（`space`）。宿主页面的样式是故意写得很「凶」的 |
| [vue-editor](vue-editor/README.zh-CN.md) | 二：只嵌编辑器 | Vue 3 应用 | 自带的 LoomCanvas 服务端，经 `createHttpAdapter` | `<LoomCanvasEditor>`：响应式的 props、事件、组件引用上的方法。宿主和编辑器共用一份 Vue。空间选择用 `createHttpAdapter({ space })` 建适配器；在团队空间里编辑器会显示编辑锁和保存冲突 |
| [plain-editor](plain-editor/README.zh-CN.md) | 二：只嵌编辑器 | 纯 HTML，不用框架 | 没有：`createMemoryAdapter` | `mountEditor` 直接传入文档、`onChange`、全部命令式方法、`readOnly`、三种节点布局。完全不依赖 LoomCanvas 服务端 |
| [react-host](react-host/README.zh-CN.md) | 二：只嵌编辑器 | React 19 应用（Vite、TypeScript） | 没有（`createMemoryAdapter`），或者自带的 LoomCanvas 服务端，经 `createHttpAdapter` | 在 effect 里调 `mountEditor`，包成一个 React 组件（props、带类型的事件、ref，在 StrictMode 下没问题）；在 JSX 里写自定义元素 `<loom-canvas-editor>` 和它的类型声明；每个功能开关一个复选框；生产构建配上严格的 Content-Security-Policy 提供 |

## 运行

```bash
# 1. 构建库
cd web && npm ci && npm run build:lib && cd ..

# 2. 启动示例（http://127.0.0.1:4173）
node examples/serve.mjs
```

`plain-editor` 直接就能用。`host-page` 和 `vue-editor` 需要一个允许示例所在源访问的 LoomCanvas 服务端：

```bash
# 另开一个终端：在 :3000 起一个接受示例页面调用的 LoomCanvas 服务端
CORS_ORIGIN=http://127.0.0.1:4173 ADMIN_PASSWORD=change-me-please npm start     # 见 docs/getting-started.zh-CN.md
```

打开 `http://127.0.0.1:4173/`，选一个示例，用 LoomCanvas 的账号登录（`admin` 和上面那个密码）。先在服务端接入一个服务商（独立应用 `http://127.0.0.1:3000` 的「模型管理」页），否则没有模型可以运行。

服务端在别的地址：在示例地址后面加 `?api=https://your-server/api`。

`PORT=5000 node examples/serve.mjs` 换一个端口（这时写进 `CORS_ORIGIN` 的也要是那个源）。`LC_LIB=/path/to/a/build node examples/serve.mjs` 提供的是另一份库构建而不是 `web/dist-lib`，比如在 `web/` 里用 `node scripts/build-lib.mjs --out=<目录>` 构建出来的那一份。

`react-host` 是用打包工具构建的，所以它自己还多两步（先 `npm install`，再 `npm run dev`；或者 `npm run build`，之后 `serve.mjs` 就会把它放在 `/react-host/` 下，和其他几个在一起）。步骤写在 [react-host/README.zh-CN.md](react-host/README.zh-CN.md) 里；它的第一个页签同样不需要服务端。

## 哪些是真的，哪些做了简化

- `host-page`、`vue-editor` 和 `react-host` 的登录表单是在浏览器里直接调 `POST /api/auth/login` 拿凭证的。这只是为了让示例能独立运行。真实产品里，应该由你的后端认证你自己的用户，再去换取画布接口要的凭证，页面只拿结果。见集成文档的「认证」一节。
- 三个纯页面的示例按路径引入库（`/lib/...`）。用打包工具时从包里引 `loomcanvas-web/app` / `loomcanvas-web/editor` 和对应的 CSS，`react-host` 就是这么做的。
- `serve.mjs` 只给这几个示例用。
