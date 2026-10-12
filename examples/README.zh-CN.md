# 集成示例

[English](README.md)

三个把 LoomCanvas 集成进去的小「宿主产品」，配合 [docs/integration.zh-CN.md](../docs/integration.zh-CN.md) 看。它们都不在生产构建里：就是几个静态文件，由一个很小的静态服务器提供，库从 `web/dist-lib/` 加载。

| 目录 | 形态 | 宿主 | 后端 | 演示了什么 |
| --- | --- | --- | --- | --- |
| [host-page](host-page/) | 一：整站嵌入 | 纯 HTML + ES 模块 | 原装 LoomCanvas 服务端（另一个源） | `shell: 'none'`，宿主自己的页头、导航和登录（喂给 `getAuth`），只开放一部分页面，主题和语言由宿主控制，同页第二个实例，`onAuthRequired`。宿主页面的样式是故意写得很「凶」的 |
| [vue-editor](vue-editor/) | 二：只嵌编辑器 | Vue 3 应用 | 原装 LoomCanvas 服务端，经 `createHttpAdapter` | `<LoomCanvasEditor>`：响应式的 props、事件、组件引用上的方法。宿主和编辑器共用一份 Vue |
| [plain-editor](plain-editor/) | 二：只嵌编辑器 | 纯 HTML，不用框架 | 没有：`createMemoryAdapter` | `mountEditor` 直接传入文档、`onChange`、全部命令式方法、`readOnly`、三种节点布局。完全不依赖 LoomCanvas 服务端 |

## 运行

```bash
# 1. 构建库
cd web && npm ci && npm run build:lib && cd ..

# 2. 启动示例（http://127.0.0.1:4173）
node examples/serve.mjs
```

`plain-editor` 直接就能用。另外两个需要一个允许示例所在源访问的 LoomCanvas 服务端：

```bash
# 另开一个终端：在 :3000 起一个接受示例页面调用的 LoomCanvas 服务端
CORS_ORIGIN=http://127.0.0.1:4173 ADMIN_PASSWORD=change-me-please npm start     # 见 docs/getting-started.zh-CN.md
```

打开 `http://127.0.0.1:4173/`，选一个示例，用 LoomCanvas 的账号登录（`admin` 和上面那个密码）。先在服务端接入一个服务商（独立应用 `http://127.0.0.1:3000` 的「模型管理」页），否则没有模型可以运行。

服务端在别的地址：在示例地址后面加 `?api=https://your-server/api`。

## 哪些是真的，哪些做了简化

- `host-page` 和 `vue-editor` 的登录表单是在浏览器里直接调 `POST /api/auth/login` 拿令牌的。这只是为了让示例能独立运行。真实产品里，应该由你的后端认证你自己的用户，再去换取画布接口要的凭证，页面只拿结果。见集成文档的「认证」一节。
- 示例按路径引入库（`/lib/...`）。用打包工具时应从包里引 `loomcanvas-web/app` / `loomcanvas-web/editor` 和对应的 CSS。
- `serve.mjs` 只给这几个示例用。
