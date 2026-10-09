# LoomCanvas 架构与接口约定

本文是前后端共同遵守的约定。改接口先改这里。

## 1. 仓库结构

```
loomcanvas/
├─ server/            Node.js 20 + Express + Mongoose（CommonJS）
│  └─ src/
│     ├─ index.js           启动入口
│     ├─ config.js          读取环境变量
│     ├─ routes/            HTTP 接口
│     ├─ models/            Mongoose 模型
│     ├─ providers/         模型接入（插件）
│     │  ├─ index.js        注册表
│     │  ├─ gaorui.js / openaiCompatible.js / gemini.js
│     │  └─ catalog/*.json  各接入的模型声明
│     ├─ runner/            任务执行器（排队、轮询、转存、记账）
│     ├─ storage/           存储驱动：local / s3 / oss
│     ├─ billing/           计费钩子（默认空实现）
│     ├─ i18n/              服务端给用户看的文字：zh-CN.js、en.js
│     └─ utils/
├─ web/               Vue 3 + Vite + TypeScript + Vue Flow + TDesign
│  └─ src/
│     ├─ views/             CanvasList / Canvas / ShareView / Settings / Setup
│     ├─ components/canvas/ 画布节点与对话框
│     ├─ composables/       执行器、批量、历史等
│     ├─ utils/             api.ts、canvasModels.ts 等
│     └─ locales/           zh-CN.ts、en.ts
├─ docs/
├─ docker-compose.yml
└─ .env.example
```

## 2. 通用约定

- 所有接口前缀 `/api`。
- 返回统一为 `{ "result": 0, "message": "...", "data": ... }`；`result` 非 0 表示失败，同时使用合适的 HTTP 状态码。失败时多一个 `code`（这条信息的稳定标识，见第 10 节「服务端文字的语言」）。
- 第一版是单用户。所有数据表带 `userId` 字段，固定写入常量 `local`，为以后多用户留位置。
- 登录：环境变量 `ACCESS_PASSWORD` 为空时不需要登录；非空时除 `/api/app/bootstrap`、`/api/auth/login`、分享只读接口外都要带 `Authorization: Bearer <token>`。
- 文件地址：本地存储驱动下，文件通过 `/files/<key>` 访问；接口返回的都是可直接访问的完整或站内相对地址。
- 上游 Key 用 `SECRET_KEY` 做 AES-256-GCM 加密后入库；任何接口都不返回明文，只返回 `hasKey` 和 `keyTail`（末四位）。

## 3. 基础接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/app/bootstrap` | `{ authRequired, authed, site:{name,logoUrl,defaultTheme,defaultLocale}, hasProvider, version }` |
| POST | `/api/auth/login` | `{ password }` → `{ token }` |
| POST | `/api/files/upload` | multipart，字段 `file` → `{ url, key, size, mime, width?, height? }` |
| POST | `/api/files/fetch` | `{ url }`，后端抓取远程图片转存（做内网地址拦截）→ 同上 |

## 4. 模型与运行（新接口）

### 4.1 模型声明 ModelSpec

```jsonc
{
  "id": "gaorui:nano-banana-2.1",      // <接入实例标识>:<模型标识>，全局唯一
  "providerId": "…",                    // 接入实例的数据库 id
  "label": "Nano Banana 2.1",
  "desc": "新版图片模型",                // 可选，下拉副标题
  "tag": "推荐",                         // 可选
  "kind": "image",                      // image | video | chat
  "acceptsImage": true,
  "acceptsVideo": false,
  "videoEdit": false,                   // 是否出现在「视频编辑」节点
  "maxReferenceImages": 8,
  "options": {
    "aspectRatios": ["auto","1:1","16:9"],
    "resolutions": ["1K","2K","4K"],    // 可选
    "durations": [5,10],                // 可选，秒
    "counts": [1,2,3,4]                 // 可选
  },
  "defaults": { "aspectRatio": "1:1", "resolution": "1K", "count": 1 },
  "pricing": {                          // 可选；没有就显示「成本未知」
    "currency": "CNY",
    "unit": "per_image",                // per_image | per_video | per_second | per_1m_tokens
    "by": "resolution",                 // 可选：resolution | duration | resolution_duration
    "table": { "1K": 0.12 }             // by 为空时用 "price": 0.12
  }
}
```

### 4.2 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/models` | 返回所有已启用接入下已启用的模型 `ModelSpec[]`，可带 `?kind=image` |
| POST | `/api/runs/estimate` | `{ model, params, count }` → `{ unitCost, totalCost, currency, unknown }` |
| POST | `/api/runs` | 见下 → `{ runId }` |
| GET | `/api/runs/:id` | → `Run` |
| POST | `/api/runs/status` | `{ ids: [] }` → `Run[]`（批量轮询） |
| POST | `/api/runs/:id/cancel` | 取消排队或进行中的运行 |

提交运行的请求体：

```jsonc
{
  "model": "gaorui:nano-banana-2.1",
  "prompt": "…",
  "imageUrls": ["…"],
  "videoUrls": ["…"],
  "params": { "aspectRatio": "1:1", "resolution": "1K", "duration": 5 },
  "workflowId": "…",   // 可选，用于用量归属
  "nodeId": "…"        // 可选
}
```

Run：

```jsonc
{
  "id": "…",
  "status": "queued",            // queued | running | archiving | succeeded | failed | canceled
  "progress": 0,                  // 0-100
  "outputs": [ { "type": "image", "url": "…", "thumbnailUrl": "…" } ],
  "error": "",                    // 给用户看的失败原因，按请求的语言给出
  "errorCode": "",                // 失败原因的稳定标识，如 run.timeout_generate
  "cost": { "amount": 0.12, "currency": "CNY", "unknown": false },
  "model": "…", "kind": "image",
  "createdAt": "…", "startedAt": "…", "finishedAt": "…"
}
```

### 4.3 对话类模型（大语言模型节点、视频分析节点）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/llm/tasks` | `{ model, prompt, systemPrompt?, imageUrls?, videoUrl? }` → `{ taskId }` |
| GET | `/api/llm/tasks/:id` | → `{ status, text, error, errorCode, cost }`，status 同 Run |

## 5. 管理接口（设置页）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/provider-types` | 可选的接入类型及其表单字段 |
| GET/POST | `/api/admin/providers` | 列表 / 新增接入实例 `{ type, name, baseUrl?, apiKey, enabled }` |
| PUT/DELETE | `/api/admin/providers/:id` | 修改 / 删除 |
| POST | `/api/admin/providers/:id/test` | 连通性测试 → `{ ok, message, modelCount? }` |
| GET | `/api/admin/models` | 所有模型（含未启用）及其覆盖项 |
| PUT | `/api/admin/models/:modelId` | `{ enabled?, label?, sort?, defaults?, pricing? }` |
| GET/PUT | `/api/admin/settings` | 站点名称、Logo、默认主题和语言、并发数、超时、重试次数、结果保留天数 |
| GET | `/api/admin/usage` | `?from&to&groupBy=day|model` → 汇总；`/api/admin/usage/records` 分页明细 |

## 6. 沿用主站路径的画布接口

以下接口的路径、请求和返回与主站画布保持一致，去掉其中的用户、积分、团队、白名单逻辑：

- `/api/workflow`：画布的列表、新建、读取、保存、删除、复制、批量下载。
- `/api/canvas-share`：分享链接（新增过期时间与撤销）。
- `/api/canvas-asset`、`/api/user-asset`：素材库。
- `/api/canvas`：模板、文本模板、工具节点（切片、拼图、水印、改尺寸）、多平台导出。
- `/api/brand-kits`：品牌包。

不搬：合规体检、短视频链接解析、去水印、反推提示词（由 4.3 的对话接口替代）、积分预估（由 4.1 的预估接口替代）。

## 7. 任务执行器

- 进程内队列，并发数来自设置（默认 4）。
- 运行记录落库在 `runs`；进程启动时把 `queued` 的重新入队，`running` 且有外部任务号的继续轮询。
- 每一步都有总时长上限：提交 60 秒，轮询总时长按模型类型（图片 10 分钟、视频 30 分钟，可在设置里改），结果下载 5 分钟。超时一律判失败，不允许无限等待。
- 结果文件下载后转存到存储层，图片生成缩略图。
- 进程收到退出信号时，把手上的运行放回 `queued`。

## 8. 计费钩子

```js
// server/src/billing/index.js 默认导出空实现；环境变量 BILLING_HOOK 指向自定义模块时加载它
module.exports = {
  async beforeRun(ctx, cost) { return { allow: true } },
  async afterRun(ctx, result) {},
  async onFailed(ctx, error) {},
}
```

## 9. 模型接入的写法

```js
module.exports = {
  type: 'gaorui',
  label: 'Gaorui API',                  // 自带的名字；语言文件里有 provider.gaorui.label 时用语言文件的
  fields: [ { key: 'apiKey', label: 'API Key', secret: true, required: true } ],
  defaultBaseUrl: 'https://gaorui.cc',
  async listModels(cfg) { /* 返回 ModelSpec[]（不含 providerId 和前缀，由注册表补） */ },
  async test(cfg) { /* 连通性测试 → { ok, modelCount? }；失败就抛错 */ },
  async submit(cfg, run) { /* → { externalId } 或 { outputs }（同步接口直接给结果） */ },
  async poll(cfg, run) { /* → { status, progress, outputs?, error? }；error 填上游的原话 */ },
  async chat(cfg, req) { /* 对话类 → { text } */ },
}
```

## 10. 补充约定（联调后确定）

实现过程中前后端对齐下来的细节，同样是约定的一部分。

**模型与运行**

- `ModelSpec.options.imgModes?: string[]`（`frames` 首尾帧 / `multi` 多图参考），对应 `params.imgMode`。
- 前端每个"数量"单位提交一次 `POST /api/runs`；一次运行的 `outputs[]` 全部使用。
- `POST /api/runs/estimate` 也会对对话模型调用（只有 `{ model, count }`），返回必须带 `currency`，未知时 `unknown: true`。
- 价格表的键：`by: "resolution"` 用分辨率，`by: "duration"` 用秒数字符串，`by: "resolution_duration"` 用 `"<分辨率>:<秒>"`，例如 `720p:5`。
- 同步型接入（`submit` 直接给出结果）受生成总时长限制，不受 60 秒提交限制。
- 提交失败只在"上游确定没收到"时重试（连接被拒、域名解析失败、429、503）；超时和连接重置不重试，避免重复产生计费任务。
- 进程崩溃后，停在 `running` 且没有外部任务号的运行直接判失败，不重新提交。

**文件**

- `POST /api/files/upload` 对图片返回 `thumbnailUrl`。
- 缩略图的地址由原图地址直接推出，不需要另外记录：存储 key 为 `<uploads|outputs|tools>/…/<名字>.<扩展名>` 的图片，缩略图 key 是 `thumbs/of/<uploads|outputs|tools>/…/<名字>_<扩展名>.webp`（最长边 512 的 webp）。例如 `/files/outputs/2025/01/ab12.png` → `/files/thumbs/of/outputs/2025/01/ab12_png.webp`。只有 png / jpg / webp / bmp / avif 有缩略图；视频、GIF 没有。
  - 上传和运行结果转存时会顺手生成；本地存储下 `GET /files/thumbs/of/…` 发现文件不在（老文件、工具节点的产物）就从原图现做一份、落盘、以后直接读。原图不存在返回 404；原图存在但做不出缩略图时 302 到原图。
  - 画布节点数据里只存原图地址。前端显示小图时：本地存储的地址（`/files/…`）按上面的规则推出缩略图地址，所以刷新、复制节点、分享页都有缩略图；对象存储和外链地址用接口返回的 `thumbnailUrl`（只在当前页面内存里记着，刷新后退回原图）。
- 文件地址可以是站内相对地址（`/files/...`）；`/files/*` 不需要登录。
- 没有公网地址时，本地存储里的参考图以 base64 形式发给上游；必须是地址的输入（如参考视频）会报错并提示设置 `PUBLIC_URL` 或改用对象存储。

**画布**

- `PUT /api/workflow/:id` 只带 `{ name }` 时只改名；保存 `settings.bg`；返回 `updatedAt`。
- `POST /api/workflow/:id/duplicate` 和 `POST /api/canvas-share/:token/copy` 可带 `{ name }` 指定新画布的名字（前端按界面语言起名）；不带时后端用默认名。
- 打包下载（`download-zip`）里的文件名是 `<序号>-<节点类型>.<扩展名>`，例如 `02-image-edit.png`，与界面语言无关。
- `POST /api/workflow/download` `{ url, filename }` 代理下载跨域文件；`POST /api/workflow/:id/download-zip` `{ urls? }`，不带 `urls` 表示整张画布。
- 模板和画布里的连线必须带 `sourceHandle` / `targetHandle`（`text-out`、`text-in`、`image-out`、`image-in`、`image-last-in`、`video-out`、`video-in`）。
- 视频生成节点的提示词里，指代首帧 / 尾帧的 `@` 存的是固定写法 `@first_frame` / `@last_frame`，与界面语言无关；文本框里显示成当前语言的名字（`@首帧`、`@First_frame`），提交给模型前再换成自然语言。老画布里存的 `@首帧` / `@尾帧` 照样认。
- 后端内置内容（接入类型及其表单字段、内置模板、内置模型的一句话说明、切片和多平台导出的各项名字）各自带稳定标识（接入 `type`、字段 `key`、模板 `key`、模型标识、导出项 `key`）。除内置模板外，接口按请求的语言给出这些名字（见下面「服务端文字的语言」）；前端仍按标识在自己的语言文件里取当前语言的写法（这样切换语言不用重新请求），语言文件里没有的才显示接口给的。内置模板是入库的内容，接口给的是入库时的原文。

**服务端文字的语言**

- 服务端给用户看的每一句话都是语言文件里的一个条目：`server/src/i18n/zh-CN.js` 和 `en.js`，两边的键必须完全一致，键是 `<分类>.<名字>` 的扁平写法，`{name}` 是占位符。代码里不写给用户看的中文或英文句子，只写键：`badRequest('validation.max_items', { field: 'ids', max: 100 })`、`new RunError('TIMEOUT', 'run.timeout_generate')`。占位符的值可以是另一条信息 `{ code, params }`（比如句子里的名词 `noun.source_image`），渲染时用同一种语言。
- 一次请求用哪种语言，按顺序取第一个认得的：请求头 `X-Locale`（前端每个请求都带当前界面语言，`zh-CN` 或 `en`）→ `Accept-Language` → 设置里的 `defaultLocale` → `zh-CN`。
- 出错的返回是 `{ result, message, code, data: null }`：`message` 是按上面的语言渲染好的句子，`code` 是这条信息的键（稳定，可以拿来做分支；没有对应条目的原样文字 `code` 为空串）。成功的返回 `message` 一般是固定的 `ok`，个别需要提示的（如「运行已结束」）同样按语言给出。
- 会存下来以后再看的错误不存成一句话：运行记录存 `errorCode` + `errorParams`，读的时候按读的人的语言渲染成 `error`；`error` 字段里另存一份 `zh-CN` 的文字，只在没有 `errorCode`（这套机制之前写下的记录）或键已经不存在时才显示。
- 上游接口自己说的话不翻译，原样放进我们的句子里（「上游生成失败：<原话>」/ "Generation failed at the upstream: <原话>"）。计费钩子给的拒绝原因、第三方接入插件抛出的 `userFacing` 错误也是原样显示。接入插件的 `poll` 返回 `{ status: 'failed', error }` 时，`error` 填上游的原话（字符串）或一条信息 `{ code, params }`。
- 按请求语言给出的不只是错误：接入类型和表单字段的名字（`provider.<type>.label`、`provider.<type>.field.<key>.label|help`、各类型共用的 `provider.field.<key>.label`；语言文件里没有的用插件自带的）、内置模型的一句话说明（`model.<接入类型>.<模型标识>.desc`）、多平台导出各项的名字（`export.<key>`）、切片各格的名字、连通性测试的结果、后端起的默认名字（未命名画布、副本）。
- 不走语言文件的：内置模板和文本模板（`services/seed.js`，首次启动时入库的内容）、服务端日志（英文）、打包下载里的文件名、以及上面说的上游原话。
- `server/test/i18n.test.js` 把这几条当测试守着：两个语言文件的键和占位符一致；代码里用到的键都存在、语言文件里没有用不到的键；`server/src` 里除 `i18n/zh-CN.js`、`services/seed.js` 和注释外没有中文。

**分享链接**

- `POST /api/canvas-share/publish` `{ workflowId, title?, description?, expiresInDays? }` → `{ id, token, updated, expiresAt }`。`expiresInDays: 0` 表示永不过期；不带这个字段时，新链接永不过期，对同一张画布再次发布则沿用原来的有效期（原来的已经过期就清掉）。
- `GET /api/canvas-share/:token` 公开只读；不存在、已过期、已撤销统一返回 404。
- `GET /api/canvas-share/mine` 保留已撤销和已过期的链接；`DELETE /api/canvas-share/:id` 第一次撤销，对已撤销的再删一次才从列表移除；撤销后的 token 不复用。

**设置与用量**

- `GET/PUT /api/admin/settings` 是扁平对象：`siteName`、`logoUrl`、`defaultTheme`、`defaultLocale`、`concurrency`、`imageTimeoutMinutes`、`videoTimeoutMinutes`、`maxRetries`、`retentionDays`。
- `GET /api/admin/usage` → `{ items: [{ key, label?, runs, succeeded, failed, canceled, amount, currency, unknownCount, costs }] }`。
- 接入的新增和修改：字段直接放在请求体顶层；修改时不带密钥表示保持不变，`baseUrl: ''` 表示恢复默认地址。
- 只有真正的登录失败才返回 401（前端收到 401 会清除登录状态）。
