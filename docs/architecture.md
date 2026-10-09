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
- 返回统一为 `{ "result": 0, "message": "...", "data": ... }`；`result` 非 0 表示失败，同时使用合适的 HTTP 状态码。
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
  "error": "",                    // 给用户看的失败原因
  "cost": { "amount": 0.12, "currency": "CNY", "unknown": false },
  "model": "…", "kind": "image",
  "createdAt": "…", "startedAt": "…", "finishedAt": "…"
}
```

### 4.3 对话类模型（大语言模型节点、视频分析节点）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/llm/tasks` | `{ model, prompt, systemPrompt?, imageUrls?, videoUrl? }` → `{ taskId }` |
| GET | `/api/llm/tasks/:id` | → `{ status, text, error, cost }`，status 同 Run |

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
  label: '高睿 API',
  fields: [ { key: 'apiKey', label: 'API Key', secret: true, required: true } ],
  defaultBaseUrl: 'https://gaorui.cc',
  async listModels(cfg) { /* 返回 ModelSpec[]（不含 providerId 和前缀，由注册表补） */ },
  async test(cfg) { /* 连通性测试 */ },
  async submit(cfg, run) { /* → { externalId } 或 { outputs }（同步接口直接给结果） */ },
  async poll(cfg, run) { /* → { status, progress, outputs?, error? } */ },
  async chat(cfg, req) { /* 对话类 → { text } */ },
}
```
