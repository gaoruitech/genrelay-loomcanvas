# LoomCanvas web

The frontend of LoomCanvas: Vue 3, Vite, TypeScript, Vue Flow, TDesign, vue-i18n, Pinia. It builds two things from one source tree: the web app (`dist/`) and the two integration entries other projects import (`dist-lib/`).

LoomCanvas 的前端：Vue 3、Vite、TypeScript、Vue Flow、TDesign、vue-i18n、Pinia。同一份源码构建出两样东西：网页应用（`dist/`），以及给别的项目引用的两个集成入口（`dist-lib/`）。

## Run / 运行

Requires Node.js 20.9+ and a running backend on port 3000 (see [`../server/README.md`](../server/README.md)).

需要 Node.js 20.9 以上，以及在 3000 端口运行的后端（见 [`../server/README.md`](../server/README.md)）。

```bash
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` and `/files` to `http://127.0.0.1:3000`. Signing in is always required: use the super admin the server created at start-up (`ADMIN_USERNAME` / `ADMIN_PASSWORD`), or register an account.

打开 http://localhost:5173 。开发服务器把 `/api` 和 `/files` 代理到 `http://127.0.0.1:3000`。必须登录才能用：用服务端启动时创建的超级管理员（`ADMIN_USERNAME` / `ADMIN_PASSWORD`）登录，或者注册一个账号。

## Scripts / 脚本

| Command / 命令 | What it does / 作用 |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 / 开发服务器，端口 5173 |
| `npm run build` | Type-check, then build the app into `dist/` / 类型检查后把应用构建到 `dist/` |
| `npm run build:lib` | Build the integration entries into `dist-lib/` / 把集成入口构建到 `dist-lib/` |
| `npm run typecheck` | Type-check only / 只做类型检查 |
| `npm test` | Vitest. The HTTP-adapter suite starts the real server and runs only when `TEST_MONGODB_URI` is set / Vitest 测试；HTTP 适配器那一组会启动真实的服务端，只在设了 `TEST_MONGODB_URI` 时运行 |
| `npm run i18n:check` | Check UI strings in both languages / 检查两种语言的界面文案 |
| `npm run theme:check` | Check the dark and light token sets against each other, and their contrast / 检查深色、浅色两套令牌是否对应，以及对比度 |
| `npm run preview` | Serve the built `dist/` / 预览构建结果 |

## Production / 生产

The server serves the built frontend when `WEB_DIST` points at `dist/`. The Docker image does this for you.

把 `WEB_DIST` 指向 `dist/`，服务端就会一并提供构建好的前端。Docker 镜像已经配好。

## Integration / 集成

`src/embed/` holds the two entries for use inside another project: `app.ts` (the whole app, mounted into an element of your page) and `editor.ts` (the canvas editor alone, as a Vue component or a mount function, with your own data adapter). `npm run build:lib` writes them to `dist-lib/`, with a `standalone/` variant that has Vue inside. See [Integration](../docs/integration.md).

`src/embed/` 里是给别的项目用的两个入口：`app.ts`（整个应用，挂载到你页面的一个元素里）和 `editor.ts`（只有画布编辑器，可以当 Vue 组件用，也可以用挂载函数，数据由你自己的适配器提供）。`npm run build:lib` 把它们构建到 `dist-lib/`，其中 `standalone/` 是把 Vue 也打在里面的版本。见[集成](../docs/integration.zh-CN.md)。

## Layout / 目录

```
src/
  views/                 Landing, Login, Register, ChangePassword, Join, Workbench, CanvasList, Canvas,
                         CanvasShareView, Assets, BrandKits, Models, History, Team, Settings, Setup, NotFound
  components/            canvas/ (nodes and dialogs of the editor / 编辑器的节点和对话框), settings/, team/, space/,
                         models/, history/, assets/, brandkit/, workbench/, auth/, landing/ …
  embed/                 integration entries and adapters / 集成入口和适配器
  composables/           executor, batch, history, layout, theme … / 执行器、批量、历史、布局、主题等
  stores/                app (account, site), space (personal space and teams) / 账号与站点、空间
  utils/                 api.ts and helpers / 接口封装与工具
  locales/               zh-CN.ts, en.ts, modules/ / 语言文件
  styles/                design-tokens.css (dark and light) / 设计令牌（深色和浅色）
  directives/, router/, types/
scripts/                 check-i18n.mjs, check-theme.mjs, build-lib.mjs
test/                    Vitest suites / 测试
```

## Rules / 约定

- Every user-visible string goes through `t()` and exists in both `zh-CN` and `en`. `npm run i18n:check` enforces it.
- 给用户看的文字一律走 `t()`，中英文都要有，由 `npm run i18n:check` 把关。
- Colours come from `src/styles/design-tokens.css`, which holds two themes under the same token names: dark (the default) and light. No colour literals in components; `npm run theme:check` lists the ones it finds.
- 颜色一律取自 `src/styles/design-tokens.css`：深色（默认）和浅色两套主题用同一组令牌名。组件里不写颜色值，`npm run theme:check` 会把找到的列出来。
- API calls go through `src/utils/api.ts`. The contract is in [`../docs/api.md`](../docs/api.md) and [`../docs/architecture.md`](../docs/architecture.md).
- 接口调用统一走 `src/utils/api.ts`，约定见 [`../docs/api.zh-CN.md`](../docs/api.zh-CN.md) 和 [`../docs/architecture.md`](../docs/architecture.md)。
- What `src/embed/` exports is a public API: `test/public-api.test.ts` fails when it changes.
- `src/embed/` 导出的内容是公开接口：它一变，`test/public-api.test.ts` 就会失败。

More / 更多：[Development](../docs/development.md) · [开发](../docs/development.zh-CN.md)
