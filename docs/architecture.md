# LoomCanvas 架构与接口约定

> English readers: this page is the Chinese design contract between the frontend and the backend. The endpoint reference in English is [api.md](api.md); the other pages are listed in [README.md](README.md).

本文是前后端共同遵守的约定。改接口先改这里。逐个接口的请求、返回和错误码另见 [api.md](api.md)（英文），文档索引见 [README.zh-CN.md](README.zh-CN.md)。

## 1. 仓库结构

```
loomcanvas/
├─ server/            Node.js 20.9+ + Express + Mongoose（CommonJS）
│  ├─ src/
│  │  ├─ index.js           启动入口
│  │  ├─ app.js             Express 装配（中间件顺序、路由、静态前端）
│  │  ├─ config.js          读取环境变量
│  │  ├─ constants.js
│  │  ├─ routes/            HTTP 接口
│  │  ├─ models/            Mongoose 模型
│  │  ├─ providers/         服务商（每家一个模块加一份模型清单）
│  │  │  ├─ index.js        注册表
│  │  │  ├─ gaorui.js / openai.js / gemini.js
│  │  │  └─ catalog/        index.js（清单的格式与校验）、gaorui.json / openai.json / gemini.json（各家的模型清单）
│  │  ├─ runner/            任务执行器（排队、轮询、转存、记账）
│  │  ├─ storage/           存储层：本地磁盘与 S3 兼容对象存储（index 门面、local、s3、schema、probe、keys）
│  │  ├─ billing/           计费钩子（默认空实现）
│  │  ├─ services/          设置、存储设置（storageSettings.js）、素材读取、图片工具、内置内容、结果清理、服务商数据的一次性升级（providerMigration.js）
│  │  ├─ middleware/        登录、语言、错误处理、安全响应头
│  │  ├─ i18n/              服务端给用户看的文字：zh-CN.js、en.js
│  │  └─ utils/
│  └─ test/                 node:test 测试
├─ web/               Vue 3 + Vite + TypeScript + Vue Flow + TDesign
│  └─ src/
│     ├─ views/             CanvasList / Canvas / CanvasShareView / Settings / Setup / NotFound
│     ├─ components/canvas/ 画布节点与对话框
│     ├─ components/settings/ 设置页的各个标签页：服务商、模型、存储、限制、外观、用量
│     ├─ composables/       执行器、批量、历史等
│     ├─ utils/             api.ts、canvasModels.ts 等
│     └─ locales/           zh-CN.ts、en.ts、modules/*.ts
├─ scripts/                 仓库级检查（版本号、依赖协议）
├─ docs/
├─ Dockerfile
├─ docker-compose.yml
├─ package.json             整个仓库的便捷脚本
└─ .env.example
```

## 2. 通用约定

- 所有接口前缀 `/api`。
- 返回统一为 `{ "result": 0, "message": "...", "data": ... }`；`result` 非 0 表示失败，同时使用合适的 HTTP 状态码。失败时多一个 `code`（这条信息的稳定标识，见第 10 节「服务端文字的语言」）。
- 第一版是单用户。所有数据表带 `userId` 字段，固定写入常量 `local`，为以后多用户留位置。
- 登录：环境变量 `ACCESS_PASSWORD` 为空时不需要登录；非空时除 `/api/app/bootstrap`、`/api/auth/login`、分享只读接口外都要带 `Authorization: Bearer <token>`。凭证有效期 30 天，改了口令即全部失效。登录有限流：每个客户端每 10 分钟 10 次（IPv6 按 /64 网段计），所有客户端合计每 10 分钟 300 次；合计达到上限后，这个时间窗内不再接受新的登录，已登录的不受影响。计数在进程内存里。
- 请求体大小：JSON 默认 1 MB，`/api/workflow` 下 6 MB，`/api/auth` 和 `/api/canvas-share` 下 64 KB。需要登录的接口先验凭证、再解析请求体。
- 请求本身格式不对（路径里的百分号编码有误、不支持的字符集等）返回 4xx，`code` 为 `common.bad_request`，不返回 500。
- 文件地址：每个存下来的文件只有一个地址，站内相对地址 `/files/<key>`。接口返回的、画布里保存的都是它，与 `PUBLIC_URL` 无关，也与文件在本地磁盘还是在 S3 兼容的桶里无关。`/files/<key>` 由应用应答（见第 10 节「文件」）。
- 上游 Key 用 `SECRET_KEY` 做 AES-256-GCM 加密后入库；任何接口都不返回明文，只返回 `hasKey` 和 `keyTail`（末四位）。存储设置里的 S3 Secret Access Key 同样处理，接口只返回 `hasSecret` 和 `secretTail`。

## 3. 基础接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/app/bootstrap` | `{ authRequired, authed, site:{name,logoUrl,defaultTheme,defaultLocale}, hasProvider, limits:{maxUploadMb}, media:{upstreamByUrl}, version }`。`media.upstreamByUrl` 表示上游能不能按地址读到站内文件（配了公网的 `PUBLIC_URL`，或新文件存在公网能访问的桶里），画布据此在运行前提示「参考图只能给公网地址」的模型用不了参考图。`limits.maxUploadMb` 是服务端的 `MAX_UPLOAD_MB`，前端据此在上传前拦下过大的文件 |
| POST | `/api/auth/login` | `{ password }` → `{ token }` |
| POST | `/api/files/upload` | multipart，字段 `file` → `{ url, key, size, mime, width?, height?, thumbnailUrl? }`（后三项只有图片有） |
| POST | `/api/files/fetch` | `{ url }`，后端抓取远程图片转存（做内网地址拦截）→ 同上。只接受图片：地址指向本实例存储时也一样，存储里的视频返回 400（`file.image_only`） |

## 4. 模型与运行（新接口）

### 4.1 模型声明 ModelSpec

```jsonc
{
  "id": "gaorui:nano-banana-2.1",      // <服务商实例标识>:<上游模型名>，全局唯一
  "providerId": "…",                    // 服务商实例的数据库 id
  "providerName": "高瑞",                // 服务商实例的名称
  "providerType": "gaorui",             // 服务商标识：gaorui | openai | gemini
  "label": "Nano Banana 2.1",
  "desc": "新版图片模型",                // 可选，下拉副标题；只有清单里的模型有
  "tag": "推荐",                         // 可选
  "kind": "image",                      // image | video | chat；清单里的模型取自所在的段，自定义模型由用户指定
  "custom": false,                      // true 表示用户手动添加的自定义模型，false 表示服务商清单里的模型
  "acceptsImage": true,
  "acceptsVideo": false,                // 能否输入视频；对话模型见 4.3
  "videoEdit": false,                   // 是否出现在「视频编辑」节点
  "maxReferenceImages": 8,
  "options": {
    "aspectRatios": ["auto","1:1","16:9"],
    "resolutions": ["1K","2K","4K"],    // 可选
    "durations": [5,10],                // 可选，秒
    "counts": [1,2,3,4],                // 可选
    "imgModes": ["multi","frames"]      // 可选：multi 多图参考 / frames 首尾帧
  },
  "defaults": { "aspectRatio": "1:1", "resolution": "1K", "count": 1 },
  "pricing": {                          // 可选，来自管理端的覆盖项；没有就显示「成本未知」
    "currency": "CNY",
    "unit": "per_image",                // per_image | per_video | per_second | per_1m_tokens
    "by": "resolution",                 // 可选：resolution | duration | resolution_duration
    "table": { "1K": 0.12 }             // by 为空时用 "price": 0.12
  }
}
```

模型列表不向上游读取，也不根据名字推断：一个服务商实例的模型 = 这家服务商的模型清单（`server/src/providers/catalog/<服务商标识>.json`，分 `image`、`video`、`chat` 三段，写在哪一段就是哪种类型）+ 这个实例的 `customModels`，再套上管理端的覆盖项。这个列表每次由注册表同步算出，没有缓存，也没有需要刷新的东西。

### 4.2 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/models` | 返回所有已启用的服务商下已启用的模型 `ModelSpec[]`，可带 `?kind=image` |
| POST | `/api/runs/estimate` | `{ model, params, count }` → `{ unitCost, totalCost, currency, unknown }` |
| POST | `/api/runs` | 见下 → `{ runId }`。排队中和进行中的运行合计已有 500 个时返回 429（`run.queue_full`） |
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
  "outputs": [ { "type": "image", "url": "…", "thumbnailUrl": "…", "width": 1024, "height": 1024 } ],  // 宽高只有图片有
  "text": "",                     // 对话类运行的结果
  "error": "",                    // 给用户看的失败原因，按请求的语言给出
  "errorCode": "",                // 失败原因的稳定标识，如 run.timeout_generate
  "cost": { "amount": 0.12, "currency": "CNY", "unknown": false },
  "model": "…", "modelLabel": "…", "kind": "image",
  "workflowId": "…", "nodeId": "…",
  "createdAt": "…", "startedAt": "…", "finishedAt": "…"
}
```

### 4.3 对话类模型（大语言模型节点、视频分析节点）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/llm/tasks` | `{ model, prompt, systemPrompt?, imageUrls?, videoUrl? }` → `{ taskId }` |
| GET | `/api/llm/tasks/:id` | → `{ status, text, error, errorCode, cost }`，status 同 Run |

- 对话模型的 `acceptsVideo` 是有意义的：OpenAI 和 Gemini 的对话模型（清单里的和自定义的）都是 `false`，官方接口没有视频这种内容片段，模块收到视频会拒绝；高瑞清单里的 `gemini-3.5-flash-c` 和高瑞的自定义对话模型为 `true`，清单里另外四个是 `false`，所以现在能做视频分析的是这两类。高瑞模块把视频放在 `image_url` 内容片段里发送（公网地址，紧跟在文字片段后面）：中转会把 `video_url` 片段丢掉而不报错。这是照高瑞主站生产环境的做法写的，还没有从 LoomCanvas 对着真实的高瑞接口跑过。`openaiShared.js` 的 `chatCompletion()` 默认拒绝视频，只有调用方传了 `videoAsImageUrl` 才这样发。
- 对话模型的 `acceptsImage` 同样有意义：为 `false` 的是纯文本模型（高瑞清单里的 `deepseek-v4-pro`、`gpt-5.5`、`glm-5.3`）。`POST /api/llm/tasks` 带 `imageUrls` 而模型没有 `acceptsImage` 时返回 400（`model.no_image_input`）。大语言模型节点选了纯文本模型时，图片输入口变灰、不接新连线，已连着的图片不发送并在节点上写明。
- `POST /api/llm/tasks` 带 `videoUrl` 而模型没有 `acceptsVideo` 时返回 400（`model.no_video_input`）。视频分析节点只列出 `acceptsVideo` 的对话模型。
- 未完成运行的 500 个上限对 `POST /api/llm/tasks` 同样适用（429，`run.queue_full`）。

## 5. 管理接口（设置页）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/vendors` | 全部服务商，每家：`{ type, label, recommended, keyUrl, defaultBaseUrl, models[], customKinds, customDefaults }`。`models[]` 是这家清单里的模型（`model, label, kind, desc?, acceptsImage, acceptsVideo, videoEdit, custom: false, maxReferenceImages, options, defaults`）；`customKinds` 是可以添加的自定义模型类型；`customDefaults` 按类型给出自定义模型能用的参数 |
| GET/POST | `/api/admin/providers` | 列表 / 新增服务商实例 `{ type, apiKey, name?, baseUrl?, enabled? }`。`type` 是服务商标识，`apiKey` 必填；请求里不再有任何模型字段 |
| PUT/DELETE | `/api/admin/providers/:id` | 修改 / 删除。服务商添加后不能更换：带上不同的 `type` 返回 400（`provider.vendor_fixed`）。删除时连同它的模型覆盖项一起删 |
| POST | `/api/admin/providers/:id/test` | 连通性测试 → `{ ok, message }`。调用上游的模型列表接口，只用来证明地址和 Key 可用，返回的列表不使用 |
| POST | `/api/admin/providers/:id/models` | 添加自定义模型 `{ model, kind, label? }` → 服务商实例 |
| PUT | `/api/admin/providers/:id/models/:model` | 修改自定义模型 `{ kind?, label? }` → 服务商实例。模型名不能改（`provider.custom_name_fixed`）。`:model` 要做 URL 编码 |
| DELETE | `/api/admin/providers/:id/models/:model` | 删除自定义模型及其覆盖项 → 服务商实例 |
| GET | `/api/admin/models` | 所有模型（含未启用）及其覆盖项 |
| PUT | `/api/admin/models/:modelId` | `{ enabled?, label?, sort?, defaults?, pricing? }` |
| GET/PUT | `/api/admin/settings` | 站点名称、Logo、默认主题和语言、并发数、超时、重试次数、结果保留天数 |
| GET | `/api/admin/storage` | → `{ source: 'saved'\|'env'\|'default', driver: 'local'\|'s3', delivery: ''\|'proxy'\|'redirect', envDriver, secretUnreadable, s3: null \| { preset, endpoint, region, bucket, accessKeyId, forcePathStyle, keyPrefix, publicBaseUrl, delivery, acl, hasSecret, secretTail, endpointHost }, previous: [{ endpointHost, bucket, keyPrefix }] }` |
| POST | `/api/admin/storage/test` | `{ s3 }`，用提交的、未保存的配置真实走一遍 → `{ ok, steps: [{ step: 'put'\|'head'\|'get'\|'public'\|'delete', status: 'ok'\|'failed'\|'skipped', ms? }], message, code }`。测试不通过也是 HTTP 200；`secretAccessKey` 为空表示用已保存的那个 |
| PUT | `/api/admin/storage` | `{ driver: 'local' }` 或 `{ driver: 's3', s3, force? }` → 同 GET。立即生效，不用重启。S3 配置先测试，不通过则不保存，返回 400（`storage.save_needs_test`），测试结果在 `data.test`；`force: true` 跳过测试 |
| GET | `/api/admin/usage` | `?from&to&groupBy=day|model` → 汇总；`/api/admin/usage/records` 分页明细 |
| DELETE | `/api/admin/usage/records` | `?before=<YYYY-MM-DD 或 ISO 时间>` → `{ deleted }`。删除这一刻之前创建、已结束（成功、失败、已取消）的用量记录（`2025-01-31` 表示这一天 UTC 零点之前）；排队中、运行中的不动，生成的文件不删。缺 `before` 返回 400 `validation.required`，日期不对返回 400 `validation.bad_date` |

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
- 运行记录落库在 `runs`；进程启动时把 `queued` 的重新入队，`running` / `archiving` 且有外部任务号的继续轮询（不重新提交），没有外部任务号的以 `run.interrupted` 判失败。
- 未完成的运行（`queued`、`running`、`archiving`）最多 500 个，超出时提交接口返回 429（`run.queue_full`）。
- 每一步都有总时长上限：提交 60 秒（`submitTimeoutSec`），轮询总时长按模型类型（图片 10 分钟 `imageTimeoutMinutes`、视频 30 分钟 `videoTimeoutMinutes`），对话 5 分钟（`chatTimeoutSec`），结果下载 5 分钟（`downloadTimeoutSec`）。这些都是设置项，括号里是键名。超时一律判失败，不允许无限等待。
- 结果文件下载后转存到存储层（当前使用的后端：本地磁盘或 S3 兼容的桶），图片生成缩略图。
- 任何请求都不会向上游发两次。进程收到退出信号时，手上的运行只有在两种情况下放回 `queued`：已经有外部任务号（下次启动继续轮询，不重新提交），或者还什么都没发出去。请求已经发出、还没有外部任务号的运行以 `run.interrupted` 判失败，不会再发一次；同步型服务商（OpenAI 的图片、Gemini）的每一次运行和每一次对话都属于这种情况。
- 运行存储的约定：`recover()` 返回 `{ queued, interrupted }`。`queued` 是要入队的运行 id（按创建时间从早到晚），`interrupted` 是上一个进程留下的、卡在中途又没有外部任务号的运行，由执行器判失败。
- 被 `beforeRun` 放行、最后没有成功的运行都会调用 `billing.onFailed`，包括上面因中断而失败的。启动时处理 `interrupted` 的顺序是先调钩子、再更新记录，中间再崩溃会在下一次启动时重复调用，所以这一处是「至少一次」，钩子应按 `ctx.runId` 做到幂等。
- 传给服务商模块的 `media` 工具与每一次调用的中止信号绑定：取消、超时、进程退出时，参考素材的加载一并停下。

## 8. 计费钩子

```js
// server/src/billing/index.js 默认导出空实现；环境变量 BILLING_HOOK 指向自定义模块时加载它
module.exports = {
  async beforeRun(ctx, cost) { return { allow: true } },
  async afterRun(ctx, result) {},
  async onFailed(ctx, error) {},
}
```

## 9. 服务商模块的写法

一家服务商 = `server/src/providers/<服务商标识>.js` 一个模块 + `server/src/providers/catalog/<服务商标识>.json` 一份模型清单。

```js
module.exports = {
  type: 'gaorui',                       // 服务商标识
  label: 'Gaorui',                      // 自带的名字；语言文件里有 provider.gaorui.label 时用语言文件的
  recommended: true,                    // 可选：排第一的内置服务商带「推荐」标记
  keyUrl: 'https://gaorui.cc',          // 可选：表单里「获取 API Key」的链接
  defaultBaseUrl: 'https://gaorui.cc',  // 官方地址
  catalog: loadCatalog('gaorui'),       // 模型清单，加载时校验，写坏了启动就报错
  customKinds: ['image', 'chat'],       // 用户可以手动添加哪些类型的自定义模型
  customSpec: (kind) => CUSTOM[kind],   // 这种类型的自定义模型能用什么（能力、参数、默认值）
  sync: false,                          // submit 直接给出结果的同步型服务商设为 true
  async test(cfg) { /* 连通性测试 → { ok }；失败就抛错 */ },
  async submit(cfg, run) { /* → { externalId } 或 { outputs }（同步接口直接给结果） */ },
  async poll(cfg, run) { /* → { status, progress, outputs?, error? }；error 填上游的原话 */ },
  async chat(cfg, req) { /* 对话类 → { text, usage?: { inputTokens, outputTokens } } */ },
}
```

- `customSpec`、`test`、`submit`、`poll`、`chat` 五个函数都必须存在（用不到的也要写出来并在里面抛错），`catalog` 和 `customKinds` 必须是数组，否则注册时报错。模块没有表单字段（`fields`），也没有列模型的函数：每家的表单都是 API Key、名称，加上「高级」里的接口地址。
- `cfg` 只有 `{ baseUrl, apiKey }`。`baseUrl` 是实例保存的地址，没保存时是 `defaultBaseUrl`。
- 清单文件是 `{ "image": [...], "video": [...], "chat": [...] }`，三段都必须有，没有就写 `[]`。条目的字段：`id`（上游模型名，原样发送）、`label`、`acceptsImage`、`maxReferenceImages`、`acceptsVideo`、`videoEdit`、`options`、`defaults`、可选的 `verified`（真实跑通的日期）和 `imageByUrlOnly`（参考图只能以公网地址交给上游），以及只给模块自己用、不对外返回的 `_` 开头的私有字段（如 `_protocol`）。条目里不写 `kind`、说明文字和价格。
- 高瑞的接口是我们自己的，可以不标准；其他服务商的模块只走那家的官方接口。接口地址可以改成别的（代理或中转），但对方必须使用完全相同的官方接口，不为第三方的私有格式做适配。
- 内置三家：`gaorui`（默认 `https://gaorui.cc`）、`openai`（默认 `https://api.openai.com/v1`；对话走 `/chat/completions`，图片没有参考图时走 `/images/generations`、有参考图时走 `/images/edits`）、`gemini`（默认 `https://generativelanguage.googleapis.com`；`/v1beta/models/{model}:generateContent`）。三家的 `customKinds` 都是 `['image', 'chat']`，都不能添加自定义视频模型。

服务商实例（`providers` 集合里的一条）：

```jsonc
{
  "userId": "local",
  "type": "gaorui",              // 服务商标识，添加后不能改
  "name": "高瑞",
  "slug": "gaorui",              // 模型标识的前缀，创建后不变
  "baseUrl": "",                 // 空表示用服务商的官方地址；官方地址本身不入库
  "apiKeyEnc": "…",              // 密文，普通查询不带出来
  "hasKey": true, "keyTail": "3456",
  "customModels": [ { "id": "some-chat-model", "kind": "chat", "label": "" } ],  // 清单以外的模型；最多 100 个；kind 由用户指定
  "schemaVersion": 3,            // 当前的数据形状；由 services/providerMigration.js 写入
  "enabled": true, "sort": 0
}
```

旧版本里的 `options`（自由填写的模型字段）已经没有了。启动时 `migrateProviders()` 把 `schemaVersion` 不是 3 的记录各升级一次：`openai-compatible` 改成 `openai`（`slug` 不变）、旧字段里的模型转成 `customModels`、去掉 `options`、把还叫旧默认名「高瑞 API」的高瑞服务商改名为「高瑞」；已经是 2 的记录只做最后这一步改名；每一条规则写在 `services/providerMigration.js` 开头的注释里，面向用户的说明见 [providers.zh-CN.md](providers.zh-CN.md#从上一个版本升级)。

完整说明见 [writing-a-provider.zh-CN.md](writing-a-provider.zh-CN.md)，计费钩子见 [billing-hook.zh-CN.md](billing-hook.zh-CN.md)。

## 10. 补充约定（联调后确定）

实现过程中前后端对齐下来的细节，同样是约定的一部分。

**模型与运行**

- `ModelSpec.options.imgModes?: string[]`（`frames` 首尾帧 / `multi` 多图参考），对应 `params.imgMode`。
- 前端每个"数量"单位提交一次 `POST /api/runs`；一次运行的 `outputs[]` 全部使用。
- `POST /api/runs/estimate` 也会对对话模型调用（只有 `{ model, count }`），返回必须带 `currency`，未知时 `unknown: true`。
- 价格表的键：`by: "resolution"` 用分辨率，`by: "duration"` 用秒数字符串，`by: "resolution_duration"` 用 `"<分辨率>:<秒>"`，例如 `720p:5`。
- 同步型服务商（`submit` 直接给出结果）受生成总时长限制，不受 60 秒提交限制。
- 提交失败只在"上游确定没收到"时重试（连接被拒、域名解析失败、429、503）；超时和连接重置不重试，避免重复产生计费任务。
- 进程崩溃后，停在 `running` 且没有外部任务号的运行以 `run.interrupted` 判失败，不重新提交。进程正常退出（收到退出信号）时，请求已经发出而没有外部任务号的运行同样以 `run.interrupted` 判失败；只有还什么都没发出去的才回到 `queued`，由下一个进程提交（见第 7 节）。
- 上游错误信息里如果带着这次请求的凭据，展示和入库之前先换成 `***`。

**文件**

- `POST /api/files/upload` 对图片返回 `thumbnailUrl`。
- 缩略图的地址由原图地址直接推出，不需要另外记录：存储 key 为 `<uploads|outputs|tools>/…/<名字>.<扩展名>` 的图片，缩略图 key 是 `thumbs/of/<uploads|outputs|tools>/…/<名字>_<扩展名>.webp`（最长边 512 的 webp）。例如 `/files/outputs/2025/01/ab12.png` → `/files/thumbs/of/outputs/2025/01/ab12_png.webp`。只有 png / jpg / webp / bmp / avif 有缩略图；视频、GIF 没有。
  - 上传和运行结果转存时会顺手生成；`GET /files/thumbs/of/…` 发现文件不在（老文件、工具节点的产物）就从原图现做一份、存下来、以后直接读，所有后端都一样。缩略图（顺手生成的和现做的）写到原图所在的那个后端，不一定是当前使用的后端。原图不存在返回 404；原图存在但做不出缩略图时 302 到原图。
  - 画布节点数据里只存原图地址。前端显示小图时：存储里的文件（`/files/…`，任何后端）按上面的规则推出缩略图地址，所以刷新、复制节点、分享页都有缩略图；外链地址（以及早期版本存下的桶的绝对地址）用接口返回的 `thumbnailUrl`（只在当前页面内存里记着，刷新后退回原图）。
- 一个地址：文件地址永远是站内相对地址 `/files/<key>`，所有后端都一样，不带 `PUBLIC_URL`，也不带桶的域名，所以换主机、换端口、改 `PUBLIC_URL`、换存储之后画布照常可用。早期版本存下的 `PUBLIC_URL/files/...`、回环地址，以及 S3 驱动存下的 `<公开访问地址>/<key>`（要求这个公开访问地址还在某个已配置的后端里）仍被认作本实例的文件，映射回 key；画布里的这些旧地址不改写。
- `GET /files/<key>` 由应用应答，不需要登录，按文件所在的后端分三种：
  - 本地磁盘：从磁盘读，同以前。
  - 桶，`delivery: 'proxy'`：从桶里流式转发，不在内存里攒。单个 `Range` → 206（多区间的请求给整个文件），`If-None-Match` / `ETag` → 304，支持 `HEAD`，`Content-Type` 取自 key 的扩展名，`Cache-Control: public, max-age=31536000, immutable`。桶可以是私有的，不需要 CORS，也不需要公共读。
  - 桶，`delivery: 'redirect'`：302 到 `<publicBaseUrl>/<keyPrefix><key>`，`Cache-Control: public, max-age=300`。
  - 前两种带同样的加固头：`X-Content-Type-Options: nosniff`、沙箱化的 CSP，不是图片、视频、音频的文件带 `Content-Disposition: attachment`。找不到返回 404；存储服务问不到（连不上、凭据被拒）返回 502，不是 404。
- 文件在哪个后端不做记录，靠查：先问本地磁盘（一次 stat），再问当前使用的桶，再问其他可读的桶（HEAD），结果记在进程内存里（key 只写一次、不移动；上限 2 万条）。可读的后端 = 本地磁盘（始终）+ 设置页保存的 S3 配置（存储方式改回本地后仍保留）+ 最多 5 个更早保存过的桶（`previous`）+ 环境变量里的 S3 配置（`STORAGE_DRIVER=s3` 时）。切换存储不移动、不复制文件，这个版本没有迁移工具；旧后端的配置还在，旧文件就照常加载。自己复制对象（保持 key 不变、放在路径前缀下）同样能被找到。
- 存储用哪个，优先级是：设置页保存的配置（`settings` 集合里键为 `storage` 的一条）> 环境变量（`STORAGE_DRIVER`、`S3_*`）> 本地磁盘。保存后立即切换，不用重启；进行中的上传在它开始时的后端上完成。`SECRET_KEY` 变了导致保存的 S3 密钥解不开时，新文件退回环境变量指定的后端（默认本地磁盘），记日志，`secretUnreadable` 为 `true`。
- 结果保留期清理、打包下载、画布工具、`files/fetch`、素材库都经过存储层，对两种驱动都适用。
- 把文件交给上游（`services/media.js` 的 `upstreamUrl`）：桶里的文件依次取 (1) `delivery: 'redirect'` 时的公开地址，(2) 有效期 1 小时的预签名 GET 地址，取其中第一个「公网可达」的（不是 `localhost`、不是内网 IP；只看地址本身，不解析）；都不行时 (3) `PUBLIC_URL + /files/<key>`（`PUBLIC_URL` 已设且是公网地址）。本地磁盘上的文件只有 (3)。
- `PUBLIC_URL` 只在上面第 (3) 步用来拼出绝对地址，可以不填。
- 以上都拿不到公网地址时，参考图以 base64 形式发给上游；必须是地址的输入（如参考视频）以 `media.needs_public_url` 报错。
- 预签名地址只用于那一次上游请求，不进画布、分享和运行记录。上游如果在错误信息里把它带了回来，`X-Amz-*` 查询参数的值在入库和展示之前换成 `***`。
- S3 驱动对各家的处理：`forcePathStyle` 由配置明确给出（MinIO 为 true；AWS、R2、OSS 为 false）；始终设置 `requestChecksumCalculation: 'WHEN_REQUIRED'` 和 `responseChecksumValidation: 'WHEN_REQUIRED'`；没有配置 `acl` 就不发 ACL 头；对象写入时带 `Content-Type` 和 `Cache-Control: public, max-age=31536000, immutable`。`STORAGE_DRIVER=oss` 已移除，启动时报配置错误并提示改用 `s3`。
- S3 的 Endpoint 和公开访问地址由部署者填写，不经过 SSRF 防护（与服务商的接口地址同理）；用户给出的地址的防护不变。

**画布**

- `PUT /api/workflow/:id` 只带 `{ name }` 时只改名；保存 `settings.bg`；返回 `updatedAt`。
- `POST /api/workflow/:id/duplicate` 和 `POST /api/canvas-share/:token/copy` 可带 `{ name }` 指定新画布的名字（前端按界面语言起名）；不带时后端用默认名。
- 打包下载（`download-zip`）里的文件名是 `<序号>-<节点类型>.<扩展名>`，例如 `02-image-edit.png`，与界面语言无关。上限：100 个文件，单个 1 GiB，总大小 4 GiB；放不下的换成 `<序号>-<节点类型>-skipped.txt`。
- `POST /api/workflow/download` `{ url, filename }` 代理下载跨域文件；`POST /api/workflow/:id/download-zip` `{ urls? }`，不带 `urls` 表示整张画布。
- 模板和画布里的连线必须带 `sourceHandle` / `targetHandle`（`text-out`、`text-in`、`image-out`、`image-in`、`image-last-in`、`video-out`、`video-in`）。
- 视频生成节点的提示词里，指代首帧 / 尾帧的 `@` 存的是固定写法 `@first_frame` / `@last_frame`，与界面语言无关；文本框里显示成当前语言的名字（`@首帧`、`@First_frame`），提交给模型前再换成自然语言。老画布里存的 `@首帧` / `@尾帧` 照样认。
- 后端内置内容（服务商、内置模板、清单里模型的一句话说明、切片和多平台导出的各项名字）各自带稳定标识（服务商 `type`、模板 `key`、模型标识、导出项 `key`）。除内置模板外，接口按请求的语言给出这些名字（见下面「服务端文字的语言」）；前端仍按标识在自己的语言文件里取当前语言的写法（这样切换语言不用重新请求），语言文件里没有的才显示接口给的。内置模板是入库的内容，接口给的是入库时的原文。

**服务端文字的语言**

- 服务端给用户看的每一句话都是语言文件里的一个条目：`server/src/i18n/zh-CN.js` 和 `en.js`，两边的键必须完全一致，键是 `<分类>.<名字>` 的扁平写法，`{name}` 是占位符。代码里不写给用户看的中文或英文句子，只写键：`badRequest('validation.max_items', { field: 'ids', max: 100 })`、`new RunError('TIMEOUT', 'run.timeout_generate')`。占位符的值可以是另一条信息 `{ code, params }`（比如句子里的名词 `noun.source_image`），渲染时用同一种语言。
- 一次请求用哪种语言，按顺序取第一个认得的：请求头 `X-Locale`（前端每个请求都带当前界面语言，`zh-CN` 或 `en`）→ `Accept-Language` → 设置里的 `defaultLocale` → `zh-CN`。
- 出错的返回是 `{ result, message, code, data: null }`：`message` 是按上面的语言渲染好的句子，`code` 是这条信息的键（稳定，可以拿来做分支；没有对应条目的原样文字 `code` 为空串）。成功的返回 `message` 一般是固定的 `ok`，个别需要提示的（如「运行已结束」）同样按语言给出。
- 会存下来以后再看的错误不存成一句话：运行记录存 `errorCode` + `errorParams`，读的时候按读的人的语言渲染成 `error`；`error` 字段里另存一份 `zh-CN` 的文字，只在没有 `errorCode`（这套机制之前写下的记录）或键已经不存在时才显示。
- 上游接口自己说的话不翻译，原样放进我们的句子里（「上游生成失败：<原话>」/ "Generation failed at the upstream: <原话>"）。计费钩子给的拒绝原因、第三方服务商模块抛出的 `userFacing` 错误也是原样显示。服务商模块的 `poll` 返回 `{ status: 'failed', error }` 时，`error` 填上游的原话（字符串）或一条信息 `{ code, params }`。
- 按请求语言给出的不只是错误：服务商的名字（`provider.<服务商标识>.label`；语言文件里没有的用模块自带的）、清单里模型的一句话说明（`model.<服务商标识>.<模型名>.desc`；内置三家清单里的每个模型在两个语言文件里都必须有，自定义模型没有）、多平台导出各项的名字（`export.<key>`）、切片各格的名字、连通性测试的结果、后端起的默认名字（未命名画布、副本）。
- 不走语言文件的：内置模板和文本模板（`services/seed.js`，首次启动时入库的内容）、服务端日志（英文）、打包下载里的文件名、以及上面说的上游原话。
- `server/test/i18n.test.js` 把这几条当测试守着：两个语言文件的键和占位符一致；代码里用到的键都存在、语言文件里没有用不到的键；`server/src` 里除 `i18n/zh-CN.js`、`services/seed.js` 和注释外没有中文。

**分享链接**

- `POST /api/canvas-share/publish` `{ workflowId, title?, description?, expiresInDays? }` → `{ id, token, updated, expiresAt }`。`expiresInDays: 0` 表示永不过期；不带这个字段时，新链接永不过期，对同一张画布再次发布则沿用原来的有效期（原来的已经过期就清掉）。
- `GET /api/canvas-share/:token` 公开只读；不存在、已过期、已撤销统一返回 404。它和 `POST /api/canvas-share/:token/copy` 只认链接里的 token，数据库 id 不行，登录与否都一样。
- 快照里不带运行状态、运行号和任务号、失败详情和成本：发布时去掉，公开读取时再去一遍，复制出来的画布里也没有。去掉的节点字段是 `status`、`progress`、`validationError`、`validationStamp`、`errorMsg`、`taskId`、`taskIds`、`runId`、`runPending`、`generatedCount`、`cost`、`estimatedCost`，以及 `results[]` 每一项里的 `cost`、`taskId`、`runId`。模型标识（含服务商实例的标识前缀）和提示词保留。
- `GET /api/canvas-share/mine` 保留已撤销和已过期的链接；`DELETE /api/canvas-share/:id` 第一次撤销，对已撤销的再删一次才从列表移除；撤销后的 token 不复用。

**设置与用量**

- 存储不在 `GET/PUT /api/admin/settings` 里：它有自己的三个接口（第 5 节的 `/api/admin/storage`），存在 `settings` 集合里键为 `storage` 的一条记录中，密钥加密。把 `storage` 当作设置键提交会得到 `settings.unknown_key`。
- `GET/PUT /api/admin/settings` 是扁平对象：`siteName`、`logoUrl`、`defaultTheme`、`defaultLocale`、`concurrency`、`submitTimeoutSec`、`imageTimeoutMinutes`、`videoTimeoutMinutes`、`chatTimeoutSec`、`downloadTimeoutSec`、`maxRetries`、`retentionDays`。不认识的键（包括 `constructor`、`__proto__` 这类名字）返回 400（`settings.unknown_key`）。各项的默认值和范围见 [configuration.zh-CN.md](configuration.zh-CN.md#管理设置)。
- `GET /api/admin/usage` → `{ groupBy, timezone, totals, items: [{ key, label?, runs, succeeded, failed, canceled, amount, currency, unknownCount, costs }] }`，`totals` 与 `items` 的每一项形状相同。可带 `tz`（IANA 时区名，默认 `UTC`）决定按天分组时一天的起止。
- 服务商的新增和修改：字段直接放在请求体顶层；新增时 `apiKey` 必填；修改时不带密钥表示保持不变，`baseUrl: ''` 表示恢复官方地址。返回的服务商对象带 `customBaseUrl`（地址是否不是官方地址）和 `customModels: [{ model, kind, label }]`，不再把各种选项字段平铺在顶层。
- 自定义模型的规则由后端强制：模型名必填，只能用字母、数字和 `. _ - : / @`，最长 120 个字符；类型必填、没有默认值，而且必须在这家服务商的 `customKinds` 里；不能和清单里的模型重名；同一个实例里不能重复；每个实例最多 100 个。对应的错误码是 `provider.custom_name_required`、`custom_bad_name`、`custom_kind_required`、`custom_kind_unsupported`、`custom_in_catalog`、`custom_exists`、`custom_max`，以及 `custom_not_found`（404）和 `custom_name_fixed`。
- 只有真正的登录失败才返回 401（前端收到 401 会清除登录状态）。

**安全响应头**

- 每个页面带 `Content-Security-Policy`：`script-src 'self'` 加上构建出的 `index.html` 里内联主题脚本的 sha256，脚本不允许 `'unsafe-inline'` 和 `'unsafe-eval'`；`img-src` / `media-src` / `connect-src` 有意对任何 http(s) 来源开放（画布要显示和下载对象存储、CDN、外链里的结果），另外明确列出存储配置里每个 `publicBaseUrl` 的来源，跟着当前的存储配置变，不用重启（现在不改变效果，为的是以后收紧开放来源时它们仍被允许）；另有 `frame-ancestors 'self'`、`object-src 'none'`、`base-uri 'self'`、`form-action 'self'`。
- 接口响应带 `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` 和 `Cache-Control: no-store`。
- 所有响应带 `X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy`、`Cross-Origin-Opener-Policy`、`Permissions-Policy`。
- 应用不设置 HSTS，交给终结 TLS 的反向代理。
- 前端构建打开了 `__INTLIFY_JIT_COMPILATION__`（`web/vite.config.ts`），vue-i18n 不需要 eval。前端构建产物如果不由本服务端提供，那台服务器要自己发送等效的 CSP。
- `TRUST_PROXY` 只接受代理层数（1 到 10）或逗号分隔的 IP / CIDR / `loopback` / `linklocal` / `uniquelocal`；`true` 和主机名在启动时报配置错误。
