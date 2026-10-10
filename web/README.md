# LoomCanvas web

The frontend of LoomCanvas: Vue 3, Vite, TypeScript, Vue Flow, TDesign, vue-i18n, Pinia.

LoomCanvas 的前端：Vue 3、Vite、TypeScript、Vue Flow、TDesign、vue-i18n、Pinia。

## Run / 运行

Requires Node.js 20.9+ and a running backend on port 3000 (see [`../server/README.md`](../server/README.md)).

需要 Node.js 20.9 以上，以及在 3000 端口运行的后端（见 [`../server/README.md`](../server/README.md)）。

```bash
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` and `/files` to `http://127.0.0.1:3000`.

打开 http://localhost:5173 。开发服务器把 `/api` 和 `/files` 代理到 `http://127.0.0.1:3000`。

## Scripts / 脚本

| Command / 命令 | What it does / 作用 |
| --- | --- |
| `npm run dev` | Vite dev server on port 5173 / 开发服务器，端口 5173 |
| `npm run build` | Type-check, then build into `dist/` / 类型检查后构建到 `dist/` |
| `npm run typecheck` | Type-check only / 只做类型检查 |
| `npm run i18n:check` | Check UI strings in both languages / 检查两种语言的界面文案 |
| `npm run preview` | Serve the built `dist/` / 预览构建结果 |

## Production / 生产

The server serves the built frontend when `WEB_DIST` points at `dist/`. The Docker image does this for you.

把 `WEB_DIST` 指向 `dist/`，服务端就会一并提供构建好的前端。Docker 镜像已经配好。

## Layout / 目录

```
src/
  views/                 CanvasList, Canvas, CanvasShareView, Settings, Setup, NotFound
  components/canvas/     nodes and dialogs of the editor / 编辑器的节点和对话框
  components/settings/   sections of the Settings page, one shown at a time / 设置页的各个分区，一次显示一个
  composables/           executor, batch, history, layout / 执行器、批量、历史、布局
  utils/                 api.ts and helpers / 接口封装与工具
  locales/               zh-CN.ts, en.ts, modules/ / 语言文件
  stores/, router/, styles/, types/
scripts/check-i18n.mjs
```

## Rules / 约定

- Every user-visible string goes through `t()` and exists in both `zh-CN` and `en`. `npm run i18n:check` enforces it.
- 给用户看的文字一律走 `t()`，中英文都要有，由 `npm run i18n:check` 把关。
- API calls go through `src/utils/api.ts`. The contract is in [`../docs/api.md`](../docs/api.md) and [`../docs/architecture.md`](../docs/architecture.md).
- 接口调用统一走 `src/utils/api.ts`，约定见 [`../docs/api.md`](../docs/api.md) 和 [`../docs/architecture.md`](../docs/architecture.md)。

More / 更多：[Development](../docs/development.md) · [开发](../docs/development.zh-CN.md)
