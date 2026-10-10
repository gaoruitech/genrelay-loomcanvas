# 开发

[English](development.md)

仓库怎么组织、开发时怎么跑起来、常见的几类改动该改哪里。

## 仓库结构

```
loomcanvas/
├─ server/                 Node.js + Express + Mongoose（CommonJS）
│  ├─ src/
│  │  ├─ index.js          启动与退出
│  │  ├─ app.js            Express 装配：中间件顺序、路由、静态前端
│  │  ├─ config.js         所有环境变量，只解析一次
│  │  ├─ constants.js
│  │  ├─ routes/           HTTP 接口
│  │  ├─ models/           Mongoose 模型
│  │  ├─ providers/        服务商模块、注册表、catalog/（模型清单及其校验）
│  │  ├─ runner/           任务队列、时限、结果转存、计价
│  │  ├─ storage/          存储层：本地磁盘与 S3 兼容的桶、key 生成
│  │  ├─ billing/          计费钩子的加载（默认空实现）
│  │  ├─ services/         账号与会话、设置、存储设置、素材读取、图片工具、内置内容、结果清理、画布图
│  │  ├─ cli/              reset-password.js
│  │  ├─ middleware/       会话与角色、语言、错误、安全响应头
│  │  ├─ i18n/             服务端提示语：en.js、zh-CN.js
│  │  └─ utils/            crypto、safeFetch、sniff、validate、workflowSchema
│  └─ test/                node:test 测试
├─ web/                    Vue 3 + Vite + TypeScript + Vue Flow + TDesign
│  ├─ src/
│  │  ├─ views/            Landing、Login、Register、ChangePassword、Setup、Workbench、CanvasList、Canvas、Assets、Models、History、Settings、CanvasShareView、NotFound
│  │  ├─ components/AppShell.vue  登录后每个页面外面的顶栏和侧栏
│  │  ├─ components/canvas/    编辑器的节点和对话框
│  │  ├─ components/models/    「模型管理」页：服务商表单、自定义模型、价格
│  │  ├─ components/history/   「生成记录」页：详情弹窗和清理弹窗
│  │  ├─ components/settings/  「设置」页的各个分区
│  │  ├─ components/workbench/、landing/、auth/  工作台、落地页、登录注册页用到的部件
│  │  ├─ composables/      执行器、批量、历史、布局等
│  │  ├─ utils/            api.ts、canvasModels.ts 等
│  │  ├─ locales/          zh-CN.ts、en.ts、modules/*.ts
│  │  ├─ stores/           Pinia（bootstrap、当前登录的账号、语言）
│  │  └─ router/           路由和登录守卫
│  └─ scripts/check-i18n.mjs
├─ scripts/                仓库级检查（版本号、依赖协议）
├─ docs/
├─ Dockerfile
├─ docker-compose.yml
└─ package.json            整个仓库的便捷脚本
```

## 环境准备

需要 Node.js 20.9 以上，以及一个连得上的 MongoDB 7。

1. 没有 MongoDB 的话先起一个：

   ```bash
   docker run -d --name loomcanvas-mongo -p 127.0.0.1:27017:27017 mongo:7.0
   ```

2. 后端：

   ```bash
   cd server
   npm install
   cp .env.example .env
   ```

   编辑 `server/.env`，设置 `SECRET_KEY`（至少 16 位）。默认的 `MONGODB_URI` 指向 `127.0.0.1:27017`。然后：

   ```bash
   npm run dev
   ```

   接口监听在 <http://localhost:3000>，文件改动后自动重启。

3. 前端，另开一个终端：

   ```bash
   cd web
   npm install
   npm run dev
   ```

   打开 <http://localhost:5173>。

## 脚本

| 位置 | 命令 | 作用 |
| --- | --- | --- |
| `server/` | `npm run dev` | 用 `node --watch` 启动。 |
| `server/` | `npm start` | 普通启动。 |
| `server/` | `npm test` | 用 `node --test` 跑全部测试。 |
| `web/` | `npm run dev` | Vite 开发服务器，端口 5173。 |
| `web/` | `npm run build` | 先做类型检查（`vue-tsc --noEmit`），再构建到 `web/dist`。 |
| `web/` | `npm run typecheck` | 只做类型检查。 |
| `web/` | `npm run i18n:check` | 检查界面文案（见[添加界面文案](#添加界面文案)）。 |
| `web/` | `npm run preview` | 本地预览构建好的 `web/dist`。 |
| 根目录 | `npm run install:all` | 在 `server/` 和 `web/` 里分别执行 `npm ci`。 |
| 根目录 | `npm run test`、`build`、`typecheck`、`i18n:check` | 与 `server/`、`web/` 里的同名命令相同，可以在根目录直接调用。 |
| 根目录 | `npm run check` | 一次跑完版本检查、协议检查、文案检查、后端测试和前端构建。CI 跑的就是它。 |
| 根目录 | `npm run versions:check` | `server/`、`web/` 的版本号和 Node 最低版本必须与根目录 `package.json` 一致。 |
| 根目录 | `npm run licenses:check` | 生产依赖的协议必须在允许清单内，且 `THIRD_PARTY_NOTICES.md` 是最新的。需要先在 `server/` 和 `web/` 里执行过 `npm ci`。 |
| 根目录 | `npm run licenses:write` | 重新生成 `THIRD_PARTY_NOTICES.md`。改了依赖之后运行。 |

项目没有配置 lint 工具。

### 测试

```bash
cd server
npm test
```

- 单元测试只需要 Node。
- 端到端测试（`api.e2e.test.js`、`security.e2e.test.js`、`vendors.e2e.test.js`、`accounts.e2e.test.js`）需要 MongoDB。设置 `TEST_MONGODB_URI` 可以用你自己起的那个，每次运行会建自己的库。不设的话会尝试 `mongodb-memory-server`，它第一次使用时要下载 MongoDB 的可执行文件。两个都不行时，这些测试是跳过，不是失败。

  ```bash
  TEST_MONGODB_URI=mongodb://127.0.0.1:27017 npm test
  ```

- 服务商模块是对着测试里现起的假上游测的，见[编写服务商模块](writing-a-provider.zh-CN.md#对着假上游测试)。没有任何测试会调用真实的模型接口；`server/test/providers.test.js` 里名字带 "real service" 的测试，用的样本是 2026-10-10 从高瑞服务录下来的回答。
- 对着真实服务的 S3 存储测试，没设 `TEST_S3_ENDPOINT` 时是跳过的，见[对着真实的 S3 测试](#对着真实的-s3-测试)。

前端没有单元测试，把关的是 `npm run build`（类型检查）和 `npm run i18n:check`。

### 对着真实的 S3 测试

`server/test/storage.test.js` 不联网，测的是存储层本身：配置校验、寻址、查找、切换、优先级、密钥加密、设置逻辑、错误归类。它和其他单元测试一样随 `npm test` 运行。

`server/test/storage.live.test.js` 让同一层代码对着真实的 S3 接口跑。里面没有任何模拟：对象真的写进环境变量指定的服务，再读回来。没设 `TEST_S3_ENDPOINT` 时，这个文件里的测试全部报告为跳过，CI 里就是这种情况。

| 变量 | 含义 |
| --- | --- |
| `TEST_S3_ENDPOINT` | 例如 `http://127.0.0.1:9000`（MinIO）。设了它才会运行这些测试。 |
| `TEST_S3_BUCKET` | 一个已经存在的私有桶。 |
| `TEST_S3_ACCESS_KEY_ID`、`TEST_S3_SECRET_ACCESS_KEY` | 对这个桶有读、写、删除和列出权限的密钥。 |
| `TEST_S3_REGION` | 默认 `us-east-1`。 |
| `TEST_S3_FORCE_PATH_STYLE` | 默认 `true`。 |
| `TEST_S3_VHOST_ENDPOINT` | 可选。一个能解析 `<桶>.<主机>` 的 Endpoint，用来测虚拟主机风格的寻址。 |
| `TEST_S3_PUBLIC_BUCKET`、`TEST_S3_PUBLIC_BASE_URL` | 可选。一个任何人都能读的桶，以及读它用的地址，用来测 `redirect` 分发。 |
| `TEST_MONGODB_URI` | 走设置接口的那个测试需要它（这一个没有内存数据库兜底）。 |

起一个 MinIO 来测：

```bash
docker run -d --name loomcanvas-minio -p 9000:9000 -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin minio/minio server /data
```

用 `mc` 建桶（这里用 `minio/mc` 镜像，和 MinIO 容器共用网络）：

```bash
docker run --rm --network container:loomcanvas-minio --entrypoint sh minio/mc -c "mc alias set local http://127.0.0.1:9000 minioadmin minioadmin && mc mb local/loomcanvas-test && mc mb local/loomcanvas-public && mc anonymous set download local/loomcanvas-public"
```

运行这些测试：

```bash
cd server
TEST_S3_ENDPOINT=http://127.0.0.1:9000 \
TEST_S3_BUCKET=loomcanvas-test \
TEST_S3_ACCESS_KEY_ID=minioadmin \
TEST_S3_SECRET_ACCESS_KEY=minioadmin \
TEST_S3_PUBLIC_BUCKET=loomcanvas-public \
TEST_S3_PUBLIC_BASE_URL=http://127.0.0.1:9000/loomcanvas-public \
TEST_MONGODB_URI=mongodb://127.0.0.1:27017 \
node --test test/storage.live.test.js
```

每次运行都写在自己的前缀下（`loomcanvastest/<随机>/`），结束时删掉自己写的东西。这套测试同样可以指向别的 S3 兼容服务；到目前为止它只对着 MinIO 跑过。如果你对着 AWS S3、R2 或 OSS 跑了，请把结果告诉我们。

### CI

`.github/workflows/ci.yml` 在推送到 `main` / `master` 和提交合并请求时运行，有两个任务：

- **check**：分别在 Node 20 和 Node 22 上跑，带一个 MongoDB 7 服务，`TEST_MONGODB_URI` 指向它。先 `npm run install:all`，再 `npm run check`。CI 里没有起 S3 服务，所以对着真实 S3 的测试在那里是跳过的。
- **docker**：构建镜像并启动 Compose 整套服务，然后检查 `/api/app/bootstrap` 有响应、前端页面能打开、进程不是以 root 运行。

没有别的流水线（没有 Gitee 的）。

### 依赖与协议

- 三个 `package.json` 里的 Node 最低版本都是 `>=20.9.0`，这是 `sharp` 的要求。`npm run versions:check` 保证 `server/`、`web/` 的版本号、Node 最低版本和 license 字段与根目录一致。
- 两个 lockfile 都从 `registry.npmjs.org` 解析。更新依赖时请保持这一点。
- `THIRD_PARTY_NOTICES.md` 由 `npm run licenses:write` 根据 lockfile 生成，不要手工修改。生产依赖的协议不在 `scripts/licenses.mjs` 的允许清单里，或者这个文件不是最新的，`npm run licenses:check` 就不通过。
- libvips（LGPL-3.0-or-later，预编译的库，由 `sharp` 动态加载）在这个脚本里登记为「已审阅的例外」。MongoDB（SSPL）不是代码的依赖：它作为独立的服务运行。

## 前端怎么和后端通信

- 所有请求都走 `web/src/utils/api.ts` 里的同一个 axios 实例，`baseURL: '/api'`。函数按功能分组（`workflowApi`、`adminApi`、`filesApi` 等）。
- 开发时，Vite 把 `/api` 和 `/files` 代理到 `http://127.0.0.1:3000`（`web/vite.config.ts`），浏览器看到的是同一个来源，不用配跨域。生产环境由服务端直接提供构建好的前端（`WEB_DIST`）。
- 每个请求都带 `X-Locale`（当前界面语言）；登录后还带 `Authorization: Bearer <token>`。
- 每个返回都是 `{ result, message, data }`，`unwrap()` 取出 `data` 或抛错。收到 `401` 会清掉凭证并显示登录页。
- 运行是异步的：前端提交运行，然后拿着在等的 id 轮询 `POST /api/runs/status`。没有 WebSocket。
- 接口层用到的类型在 `web/src/types/index.ts`。

接口约定写在 [architecture.md](architecture.md)（中文，设计）和 [api.md](api.md)（英文，逐项说明）里。改接口时在同一个合并请求里一起改。

## 添加一种节点

节点类型是一个字符串标识，例如 `fit-size`。下面这些地方认识节点类型：

| 文件 | 要加什么 |
| --- | --- |
| `web/src/components/canvas/<Name>Node.vue` | 节点组件。从相近的节点改起，公共样式在 `node-shared.css` 和 `tool-node.css`。 |
| `web/src/views/Canvas.vue` | `NodeKind` 联合类型、`nodeTypes` 映射、标题键和图标映射、它出现在添加面板的哪一组、默认的 `data`。搜一个现有的标识（如 `'fit-size'`）就能把这些地方都找出来。 |
| `web/src/views/CanvasShareView.vue` | 只读分享页会渲染的节点类型列表。 |
| `web/src/composables/useCanvasExecutor.ts` | 节点怎么运行：从上游读什么、调哪个接口、把什么写回去。 |
| `web/src/utils/canvasMedia.ts`、`web/src/components/canvas/OutputNode.vue`、`ShareNode.vue` | 标题键，以及成品节点怎么收集这个节点的结果。 |
| `web/src/locales/zh-CN.ts`、`en.ts` | `nodes.title.<name>` 以及其他文案。 |
| `server/src/services/canvasGraph.js` | `IMAGE_COVER_ORDER` / `VIDEO_COVER_ORDER`：节点的结果可以当画布封面时才需要。打包下载会从任何节点里取 `imageUrl`、`imageUrls`、`videoUrl`、`videoUrls`。 |
| `server/src/routes/canvas.js`、`server/src/services/imageTools.js` | 只有需要服务端处理的工具节点才用得到。 |

保证画布兼容的几条规则：

- 连线必须带 `sourceHandle` 和 `targetHandle`。现有的连接点标识：`text-out`、`text-in`、`image-out`、`image-in`、`image-last-in`、`video-out`、`video-in`。输入端以 `-in` 结尾，连线校验靠的就是这个后缀。
- 节点数据里只存素材地址，不存内联 base64。
- 如果改动了现有画布里已经存在的数据形状，见[画布的 schemaVersion 与迁移](#画布的-schemaversion-与迁移)。

加一个**模型**不等于加一种节点：它只需要在某家服务商的模型清单里加一条（`server/src/providers/catalog/<服务商标识>.json`，并在服务端两个语言文件里加上它的说明文字），或者新写一个服务商模块，不用改画布。模型的类型就是它在清单里所在的那一段，任何代码都不能根据名字去推断。见[编写服务商模块](writing-a-provider.zh-CN.md)。

## 添加界面文案

界面文案在 `web/src/locales/` 下：`zh-CN.ts` 和 `en.ts` 放公共的分组，并从 `modules/*.ts` 引入较大的分组；每个模块导出 `{ 'zh-CN': {…}, en: {…} }`。

1. 两种语言**都要**加上这个键。
2. 使用：组件里用 `useI18n()` 的 `t('group.key')`，其他地方用从 `@/locales` 引入的 `t`。
3. 跑检查：

   ```bash
   cd web
   npm run i18n:check
   ```

脚本（`web/scripts/check-i18n.mjs`）在下列情况下以退出码 1 结束：

- `src/locales/` 之外的文件里有中文（注释不算）；
- 某个键只在一种语言里有；
- 代码里用了 `t('a.b.c')`，但语言文件里没有这个键。

## 添加服务端提示语

服务端给用户看的每一句话，都是 `server/src/i18n/en.js` 和 `zh-CN.js` 里的一个键。代码里不写句子本身：

```js
throw badRequest('validation.max_items', { field: 'ids', max: 100 })
throw new RunError('TIMEOUT', 'run.timeout_generate')
```

1. **两个**语言文件都加上这个键，`{占位符}` 要一致。
2. 通过 `badRequest()`、`notFound()`、`new ApiError()`、`new ProviderError()`、`new RunError()` 使用；需要存下来或嵌在别的提示里的，用 `msg()`。
3. 在 `server/` 下运行 `npm test`。

出现以下情况时 `server/test/i18n.test.js` 会失败：两个语言文件的键或占位符不一致；代码用了不存在的键；语言文件里有没被用到的键；`server/src` 里除 `i18n/zh-CN.js`、`services/seed.js` 和注释之外出现了中文。

上游说的话不翻译，作为参数（`{detail}`）传进去。服务端日志用英文，不走语言文件。

## 画布的 schemaVersion 与迁移

每张存下来的画布都带 `schemaVersion`。当前版本号和迁移步骤在 `server/src/utils/workflowSchema.js`。

- `CURRENT_SCHEMA_VERSION` 是 `1`。
- `MIGRATIONS[n]` 是一个纯函数：接收版本 `n` 的画布，返回版本 `n + 1` 的画布。没有版本号的画布按 `0` 处理。
- 迁移是按需进行的：`GET /api/workflow/:id`（以及复制、打包下载）读到旧画布时逐级升级并写回。没有批量任务。
- 版本比服务端认识的**更新**的画布原样返回，不会降级。
- 保存节点时会写上当前版本号，因为客户端写的总是当前的形状。

要改节点或连线的保存形状：

1. 提升 `CURRENT_SCHEMA_VERSION`。
2. 添加 `MIGRATIONS[<旧版本号>]`。不要修改传入的对象。
3. 在 `server/test/workflowSchema.test.js` 里加一个用例。
4. 让前端按新形状读写。

分享快照是单独存的，**不**经过这套迁移。只读分享页要能容忍旧快照。

内置的画布模板和文本模板由 `server/src/services/seed.js` 写入。改了它们要提升那里的 `SEED_VERSION`；下次启动时内置画布模板会被覆盖，缺失的文本模板会补上。

## 代码里看得到的约定

服务端：

- CommonJS，`'use strict'`，不写分号，两格缩进，单引号。
- 每个文件开头有一段注释，说明它是做什么的、保证什么。注释解释「为什么」，不复述「做了什么」。
- 只有 `config.js` 读环境变量，其他代码调用 `getConfig()`。
- 路由不信任 `req.body` 和 `req.query` 的形状：用 `utils/validate.js` 里的工具校验，异步处理函数用 `wrap()` 包起来。
- 成功用 `ok(res, data)` 返回；失败就抛一个带语言文件键的错误。意料之外的错误记日志，给用户的是统一的提示。
- 凡是来自用户或上游响应的地址，都通过 `utils/safeFetch.js` 去取。文件类型按内容判断（`utils/sniff.js`），不看文件名，也不看对方声明的类型。
- 存储 key 由 `storage/keys.js` 生成，用户输入的任何内容都不会进入 key。
- 读写文件一律通过 `getStorage()`（`storage/index.js`），文件在哪个后端它就去哪找。存下来的、返回给客户端的地址永远是 `storage.urlFor(key)`，也就是 `/files/<key>`。预签名地址（`storage.externalUrls()`）只给那一次上游请求用：不要保存，不要返回给客户端，也不要写进日志。
- 每张按账号区分的数据表都带 `userId`（所属账号的 id），对它的每一次查询都要带上 `req.userId`：别的账号的数据必须返回 404，不是 403，更不能返回内容。新增按账号区分的表时，要把它加进 `server/src/services/accounts.js` 的 `OWNED`（接手旧数据和删除账号都按这份清单走），并补进隔离测试 `server/test/accounts.e2e.test.js`。查服务商和模型一律经过 `providers/index.js`，不给账号 id 它会直接报错。站点级的东西（设置、存储、内置模板）只有管理员能改（`requireOwner`）。
- 执行器核心（`runner/core.js`）的存储、服务商查找、转存和计费都是注入的依赖，所以不需要数据库就能测试。
- 没有理由不加新的运行时依赖：响应头、跨域、限流各自只有几行代码，没有引入包。

前端：

- Vue 3 `<script setup lang="ts">`，组合式 API，不写分号，单引号。
- TDesign 组件由 `unplugin-vue-components` 自动引入，直接写 `<t-button>` 即可。
- `@/` 指 `web/src/`。
- 组件里不写给用户看的字面文字，一律走 `t()`。
- 颜色和间距来自 `styles/design-tokens.css`。界面只有一套深色主题，不要加浅色版本或主题开关。

共同的：

- 改 HTTP 接口约定时，在同一个合并请求里更新 [architecture.md](architecture.md) 和 [api.md](api.md)。
- 提交合并请求之前，在仓库根目录运行 `npm run check`。见 [CONTRIBUTING.md](../CONTRIBUTING.md)。
