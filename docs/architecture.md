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
│  │  ├─ routes/            HTTP 接口；auth.js（注册、登录、自己的账号与会话）、adminUsers.js（超级管理员：账号管理、注册开关）
│  │  ├─ models/            Mongoose 模型；User.js（账号）、Session.js（会话）
│  │  ├─ providers/         服务商（每家一个模块加一份模型清单）
│  │  │  ├─ index.js        注册表
│  │  │  ├─ gaorui.js / openai.js / gemini.js
│  │  │  └─ catalog/        index.js（清单的格式与校验）、gaorui.json / openai.json / gemini.json（各家的模型清单）
│  │  ├─ runner/            任务执行器（排队、轮询、转存、记账）
│  │  ├─ storage/           存储层：本地磁盘与 S3 兼容对象存储（index 门面、local、s3、schema、probe、keys）
│  │  ├─ billing/           计费钩子（默认空实现）
│  │  ├─ services/          账号、会话与数据归属（accounts.js）、设置、存储设置（storageSettings.js）、素材读取、图片工具、内置内容、结果清理、服务商数据的一次性升级（providerMigration.js）
│  │  ├─ middleware/        auth.js（认出调用者、只要求有会话 requireSession、要求登录且已换掉临时密码 requireAuth、要求超级管理员 requireOwner、登录与注册的限流）、语言、错误处理、安全响应头
│  │  ├─ cli/               reset-password.js：在服务器上重置某个账号的密码
│  │  ├─ i18n/              服务端给用户看的文字：zh-CN.js、en.js
│  │  └─ utils/             password.js（密码哈希，scrypt）等
│  └─ test/                 node:test 测试
├─ web/               Vue 3 + Vite + TypeScript + Vue Flow + TDesign
│  └─ src/
│     ├─ views/             Landing / Login / Register / Workbench / CanvasList / Canvas / CanvasShareView / Assets / History / Models / Settings / Setup / NotFound
│     ├─ router/            路由与登录守卫：/（落地页）、/login、/register、/app（工作台）、/canvases、/canvas/:id、/assets、/models、/history、/settings、/setup、/share/:token
│     ├─ components/AppShell.vue 登录后的外壳：顶栏 + 左侧栏（工作台 / 画布 / 素材库 / 模型管理 / 生成记录 / 设置）；编辑器里侧栏收成图标栏
│     ├─ components/canvas/ 画布节点与对话框
│     ├─ components/auth/   登录页与注册页共用的版式
│     ├─ components/landing/ 落地页的示意画布
│     ├─ components/workbench/ 工作台：新建画布、模板卡片
│     ├─ components/models/ 「模型管理」页：服务商表单、自定义模型、价格
│     ├─ components/history/ 「生成记录」页：详情弹窗、清理弹窗
│     ├─ components/settings/ 「设置」页的各个分区，一次显示一个（地址 /settings/<分区>）：「个人」组的账号与安全、外观；「站点管理」组的站点、用户管理、存储、运行限制（只有超级管理员看得到）
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
- 账号：实例有正常的账号体系，登录后使用，没有免登录的模式。只有两种角色：超级管理员（界面上叫「超级管理员」，在接口和数据库里的值是 `owner`；有且只有一个，由唯一索引保证）和普通账号（`user`）。超级管理员是内置的：还没有超级管理员时，服务端在启动时按 `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` 自动创建，没有人靠注册成为超级管理员；注册（用户名、邮箱、密码）产生的一律是普通账号。没有团队，没有共享空间。旧版本的 `ACCESS_PASSWORD` 已废弃：变量还设着的话，启动时打一条警告，此外不起任何作用。
- 归属：每个账号只看得到、改得了自己的数据。按账号的有：画布、分享链接、资产、品牌包、运行与对话任务、用量记录、自己存的模板，以及服务商、API Key、自定义模型、模型覆盖项（启用、名称、排序、默认参数、价格）。属于站点、由超级管理员管理的有：是否开放注册、存储配置、并发与超时等限制、结果保留天数、站点外观（名称、Logo、默认语言）、账号列表。内置模板、内置文本模板和只读的公共素材库属于站点，所有账号都看得到。
- 每条按账号的记录带 `userId`，值是账号 id（24 位十六进制字符串）；每个查询都带上调用者的 `userId`（`req.userId`）。按 id 访问别的账号的东西返回 404，和 id 不存在时一样，不返回 403，更不返回数据；列表不混入别人的记录。超级管理员没有例外：他的请求同样只落在他自己的数据上，账号列表里只给数量。详见第 11 节。
- 两件事有意跨账号：分享链接（拿到链接的 token 就能读快照，不用登录；登录的账号可以把它复制成自己的画布）和文件地址（`/files/<key>` 对拿到地址的人公开，key 猜不出来；分享页和上游模型都要读它）。
- 会话的传递方式没变：每个请求带 `Authorization: Bearer <token>`，前端把凭证放在浏览器的本地存储里（键 `loomcanvas-token`；勾了「记住我」放 `localStorage`，没勾放 `sessionStorage`）。不用 cookie，所以没有 CSRF 的问题；要防的是 XSS，靠的是 CSP 的 `script-src 'self'`、页面里没有内联脚本（见第 10 节「安全响应头」）。凭证不再是 JWT，而是 32 字节随机数的 base64url（43 个字符），本身不含任何信息；服务端在 `sessions` 集合里只存它的 SHA-256，连同 `userId`、`expiresAt`、`lastSeenAt`、`userAgent`、`ip`。
- 会话有效期 12 小时，登录时带 `remember: true` 则 30 天，从登录时算起，不因使用而延长；注册返回的凭证是 12 小时。过期的记录由 MongoDB 的 TTL 索引清掉，清掉之前也已经被拒绝。因为会话存在库里，退出登录、「退出其他设备」、修改密码（该账号全部会话结束，包括发起修改的这一个；调用方在响应里拿到一个新凭证，有效期是原会话剩下的时间）、重置密码（该账号全部会话结束）、停用账号（全部会话结束）、删除账号都立即生效。
- `SECRET_KEY` 不再参与登录，改了它不会让任何人掉线；它现在只用来加密服务商的 API Key 和保存的 S3 密钥。密码用 `node:crypto` 的 scrypt（N=32768、r=8、p=1），每个账号 16 字节随机盐，参数随哈希一起存（`scrypt$N=32768,r=8,p=1$<盐>$<哈希>`），比较用恒定时间。凭证不进日志；密码也不进，唯一的例外是没设 `ADMIN_PASSWORD` 时生成的超级管理员密码，它在创建超级管理员的那一次启动里打印一次（见第 11 节）。
- 不需要登录的只有：`GET /api/bootstrap`、`POST /api/auth/register`、`POST /api/auth/login`、`GET /api/canvas-share/:token`、`GET /files/*` 和静态前端。其余接口没带有效凭证一律返回 401、`code` 为 `auth.required`（旧版本是 `auth.login_required`）；只有超级管理员能调用的接口对其他账号返回 403、`auth.forbidden`。
- 强制改密码：账号的密码是别人知道的（启动时生成的超级管理员密码、超级管理员重置或命令行重置给出的临时密码）时，`users.mustChangePassword` 为 `true`。`middleware/auth.js` 里有两道闸：`requireSession` 只要求请求带着有效会话，`requireAuth` 在它之上再加一条「`mustChangePassword` 为 `true` 就返回 403 `auth.password_change_required`」。只有 `GET /api/auth/me`、`PUT /api/auth/password`、`POST /api/auth/logout` 用 `requireSession`（`GET /api/bootstrap` 是公开的，同样照常应答）；其余需要登录的接口全部走 `requireAuth`，所以这样的会话除了改密码什么都做不了。`PUT /api/auth/password` 成功后标记清掉。前端的对应物是 `/password` 这一屏（「设置新密码」）：路由守卫把这样的账号一律带到那里，改完再去原本要去的地址。
- 限流（在进程内存里，单进程，重启清零）。登录按四种口径计数，时间窗都是 10 分钟：(a) 同一个账号名 + 同一个客户端地址 10 次；(b) 同一个客户端地址、所有账号名合计 30 次；(c) 同一个账号名、所有地址合计 100 次；(d) 全部登录合计 3000 次。IPv6 按 /64 网段计。账号名不必存在，计数方式一样，所以从限流看不出哪些名字存在。这个账号的「熟悉地址」不受 (c) 和 (d) 约束：最近 30 天里它从那里成功登录过（记在内存里），或者那个地址持有它的有效会话。这样设计是为了让「拿某个账号名乱猜」锁不住账号的主人：从很多地址轮流猜，攻击者被压到每 10 分钟 100 次，主人从平时用的地址照样能登录；只有从全新的地址登录时，才可能要在攻击进行期间等一等。登录成功会清掉这一对「账号名 + 地址」在 (a) 上的计数。修改密码时的当前密码校验计入 (a) 和 (c)。注册每个客户端地址每小时 20 次；修改用户名或邮箱（`PUT /api/auth/profile`）每个账号每小时 20 次。超出一律返回 429、`auth.too_many_attempts`，`data` 为 `{ retryAfterSeconds }`，并带 `Retry-After` 响应头；已登录的会话不受影响。反向代理后面要配 `TRUST_PROXY`，限流和会话列表里的 `ip` 才是真实的客户端地址。
- 注册必然会透露用户名或邮箱是否已被占用（`auth.username_taken`、`auth.email_taken`）：系统不发邮件，没有别的回答方式。它靠注册的限流约束；修改资料也给出同样的回答，所以单独限流。在意这一点的实例应当关闭注册。登录不透露账号是否存在。
- 请求体大小：JSON 默认 1 MB，`/api/workflow` 下 6 MB，`/api/auth` 和 `/api/canvas-share` 下 64 KB。需要登录的接口先验凭证、再解析请求体。
- 请求本身格式不对（路径里的百分号编码有误、不支持的字符集等）返回 4xx，`code` 为 `common.bad_request`，不返回 500。
- 文件地址：每个存下来的文件只有一个地址，站内相对地址 `/files/<key>`。接口返回的、画布里保存的都是它，与 `PUBLIC_URL` 无关，也与文件在本地磁盘还是在 S3 兼容的桶里无关。`/files/<key>` 由应用应答（见第 10 节「文件」）。
- 上游 Key 用 `SECRET_KEY` 做 AES-256-GCM 加密后入库；任何接口都不返回明文，只返回 `hasKey` 和 `keyTail`（末四位）。存储设置里的 S3 Secret Access Key 同样处理，接口只返回 `hasSecret` 和 `secretTail`。

## 3. 基础接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bootstrap` | 公开；旧路径 `/api/app/bootstrap` 仍然应答（Docker 的 HEALTHCHECK 还在用它）。`{ auth:{registrationOpen}, user, site:{name,logoUrl,defaultLocale}, hasProvider, limits:{maxUploadMb}, media:{upstreamByUrl}, version }`。`auth.registrationOpen` 表示现在能不能注册，就是 `registrationOpen` 这项设置的值，`auth` 里只有这一个字段；`user` 是调用者的 User（请求带了有效凭证时），否则 `null`，也就是没登录；早期版本的 `authRequired`、`authed` 和 `site.defaultTheme` 已经去掉（登录是必须的，界面只有一套主题）；`hasProvider` 说的是调用者自己的服务商，未登录为 `false`。`media.upstreamByUrl` 表示上游能不能按地址读到站内文件（配了公网的 `PUBLIC_URL`，或新文件存在公网能访问的桶里），画布据此在运行前提示「参考图只能给公网地址」的模型用不了参考图。`limits.maxUploadMb` 是服务端的 `MAX_UPLOAD_MB`，前端据此在上传前拦下过大的文件 |
| POST | `/api/auth/register` | 公开。`{ username, email, password }` → `{ user, token }`。产生的一定是普通账号（`role: 'user'`）；`registrationOpen` 关着时一律 403，没有例外。错误：`auth.invalid_username`、`auth.invalid_email`、`auth.weak_password`（400），`auth.username_taken`、`auth.email_taken`（409），`auth.registration_closed`（403），`auth.too_many_attempts`（429） |
| POST | `/api/auth/login` | 公开。`{ account, password, remember? }` → `{ user, token }`，`account` 是用户名或邮箱，不区分大小写。错误：`auth.credentials_required`（400，缺字段），`auth.invalid_credentials`（401；账号不存在和密码不对是同一个返回、同样的计算量），`auth.account_disabled`（403，密码正确之后才会告知），`auth.too_many_attempts`（429） |
| POST | `/api/auth/logout` | 结束发出请求的这个会话，`data: null` |
| GET | `/api/auth/me` | → `{ user }` |
| PUT | `/api/auth/password` | `{ currentPassword, newPassword }` → `{ revokedSessions, token }`。该账号的会话全部结束，包括发出请求的这一个；`token` 是给调用方的新凭证（有效期是被替换的会话剩下的时间），前端悄悄换上。临时密码也是用它换掉的：`mustChangePassword` 为 `true` 时可以调，成功后清掉这个标记。当前密码不对返回 400 `auth.wrong_current_password`（有意不用 401），新密码和当前密码相同返回 400 `auth.same_password`，另有 `auth.weak_password`（400）、`auth.too_many_attempts`（429） |
| PUT | `/api/auth/profile` | `{ username?, email? }` → `{ user }`。错误：`auth.invalid_username`、`auth.invalid_email`、`common.nothing_to_update`（400），`auth.username_taken`、`auth.email_taken`（409），`auth.too_many_attempts`（429；每个账号每小时最多 20 次，否则前两个 409 就成了不限次数的「这个邮箱注册过没有」查询） |
| GET | `/api/auth/sessions` | → `[{ id, current, createdAt, lastSeenAt, userAgent, ip }]`，调用者还有效的会话，最近活跃的在前；`lastSeenAt` 最多每分钟刷新一次 |
| DELETE | `/api/auth/sessions/:id` | → `{ id }`，结束自己的一个会话（可以是当前这个）。不存在或是别人的：404 `auth.session_not_found` |
| DELETE | `/api/auth/sessions` | → `{ revoked }`，结束除当前会话以外的全部会话 |
| POST | `/api/files/upload` | multipart，字段 `file` → `{ url, key, size, mime, width?, height?, thumbnailUrl? }`（后三项只有图片有） |
| POST | `/api/files/fetch` | `{ url }`，后端抓取远程图片转存（做内网地址拦截）→ 同上。只接受图片：地址指向本实例存储时也一样，存储里的视频返回 400（`file.image_only`） |

User 是接口对外给出的账号信息：`{ id, username, email, role: 'owner'|'user', mustChangePassword, createdAt }`（注册、登录、`me`、改资料、bootstrap 的 `user`、超级管理员的账号列表给的都是它）。`email` 对超级管理员可能是 `''`（见第 11 节的邮箱规则）；`mustChangePassword` 为 `true` 表示还在用别人知道的密码。用户名 3 到 32 个字符（`A-Z a-z 0-9 _ -`），邮箱最长 254 个字符，两者都不区分大小写地唯一；密码 8 到 128 个字符。不发任何邮件：没有邮箱验证，也没有「忘记密码」邮件。忘了密码有两条路：超级管理员在「设置 → 用户管理」里重置（接口见第 5 节），或者运行服务的人执行 `node server/src/cli/reset-password.js <用户名或邮箱>`（超级管理员自己的密码只能走这条）；两者都给出一个临时密码，让这个账号在所有设备上退出登录，并把 `mustChangePassword` 置为 `true`：用临时密码登录后必须先设置新密码。

## 4. 模型与运行（新接口）

### 4.1 模型声明 ModelSpec

```jsonc
{
  "id": "gaorui:nano-banana-2.1",      // <服务商实例标识>:<上游模型名>，在一个账号内唯一
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
  "pricing": {                          // 可选，来自这个账号的覆盖项；没有就显示「成本未知」
    "currency": "CNY",
    "unit": "per_image",                // per_image | per_video | per_second | per_1m_tokens
    "by": "resolution",                 // 可选：resolution | duration | resolution_duration
    "table": { "1K": 0.12 }             // by 为空时用 "price": 0.12
  }
}
```

模型列表不向上游读取，也不根据名字推断：一个服务商实例的模型 = 这家服务商的模型清单（`server/src/providers/catalog/<服务商标识>.json`，分 `image`、`video`、`chat` 三段，写在哪一段就是哪种类型）+ 这个实例的 `customModels`，再套上这个账号的覆盖项。这个列表每次由注册表同步算出，没有缓存，也没有需要刷新的东西。

模型标识按账号各算各的：实例标识（slug）只在一个账号自己的服务商里唯一（索引 `{ userId, slug }`），覆盖项同理（`{ userId, modelId }`）。两个账号可以各有一个标识为 `gaorui` 的服务商，一个账号里的 `gaorui:nano-banana-2.1` 和另一个账号里的同名标识没有关系。注册表的 `listModels`、`resolveModel` 都要传 `userId`。

### 4.2 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/models` | 返回调用者自己已启用的服务商下已启用的模型 `ModelSpec[]`，可带 `?kind=image` |
| POST | `/api/runs/estimate` | `{ model, params, count }` → `{ unitCost, totalCost, currency, unknown }` |
| POST | `/api/runs` | 见下 → `{ runId }`。运行属于调用者的账号。这个账号未完成的运行已有 `userQueueLimit` 个（默认 200），或整个实例合计已有 500 个时，返回 429（`run.queue_full`） |
| GET | `/api/runs/:id` | → `Run`。别的账号的运行返回 404 |
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
- 未完成运行的两个上限（每个账号 `userQueueLimit`、整个实例 500）对 `POST /api/llm/tasks` 同样适用（429，`run.queue_full`）。

## 5. 管理接口（模型管理、生成记录、设置）

`/api/admin` 下有两类接口。路径里的 admin 是历史名字：第一类人人可用，第二类才是真正的管理。界面上，服务商、模型和价格在「模型管理」页（`/models`），用量在「生成记录」页（`/history`）和工作台，站点设置、存储、注册开关和账号管理在「设置」页（`/settings`）只有超级管理员看得到的分区里。

**按账号的**：登录的账号都能调用，每个查询带调用者的 `userId`，操作的是调用者自己的服务商、Key、自定义模型、覆盖项、价格和用量。自带 Key 是按账号的；别的账号的记录按 id 访问是 404。`GET /api/admin/vendors` 返回的是服务端内置的清单，不属于任何账号。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/vendors` | 全部服务商，每家：`{ type, label, recommended, keyUrl, defaultBaseUrl, models[], customKinds, customDefaults }`。`models[]` 是这家清单里的模型（`model, label, kind, desc?, acceptsImage, acceptsVideo, videoEdit, custom: false, maxReferenceImages, options, defaults`）；`customKinds` 是可以添加的自定义模型类型；`customDefaults` 按类型给出自定义模型能用的参数 |
| GET/POST | `/api/admin/providers` | 自己的服务商实例列表 / 新增服务商实例 `{ type, apiKey, name?, baseUrl?, enabled? }`。`type` 是服务商标识，`apiKey` 必填；请求里不再有任何模型字段。每个账号最多 50 个 |
| PUT/DELETE | `/api/admin/providers/:id` | 修改 / 删除。服务商添加后不能更换：带上不同的 `type` 返回 400（`provider.vendor_fixed`）。删除时连同它的模型覆盖项一起删 |
| POST | `/api/admin/providers/:id/test` | 连通性测试 → `{ ok, message }`。调用上游的模型列表接口，只用来证明地址和 Key 可用，返回的列表不使用 |
| POST | `/api/admin/providers/:id/models` | 添加自定义模型 `{ model, kind, label? }` → 服务商实例 |
| PUT | `/api/admin/providers/:id/models/:model` | 修改自定义模型 `{ kind?, label? }` → 服务商实例。模型名不能改（`provider.custom_name_fixed`）。`:model` 要做 URL 编码 |
| DELETE | `/api/admin/providers/:id/models/:model` | 删除自定义模型及其覆盖项 → 服务商实例 |
| GET | `/api/admin/models` | 自己的服务商下的所有模型（含未启用）及其覆盖项 |
| PUT | `/api/admin/models/:modelId` | `{ enabled?, label?, sort?, defaults?, pricing? }`，写的是调用者自己的覆盖项 |
| GET | `/api/admin/usage` | `?from&to&groupBy=day|model&tz` → 自己的用量汇总；`/api/admin/usage/records` 分页明细，同样接受 `from`、`to`、`tz`。只写日期（`YYYY-MM-DD`）的 `from` / `to` 表示 `tz` 时区里的那个自然日：`from` 从这一天开始，`to` 到这一天结束；完整的 ISO 时间按原样使用。`tz` 是 IANA 时区名，默认 `UTC`（不带时和以前完全一样）；不认识的时区名返回 400 `validation.invalid`（字段 `tz`） |
| DELETE | `/api/admin/usage/records` | `?before=<YYYY-MM-DD 或 ISO 时间>` → `{ deleted }`。也接受 `tz`。删除自己在这一刻之前创建、已结束（成功、失败、已取消）的用量记录（`2025-01-31` 表示 `tz` 时区里这一天开始之前，不带 `tz` 即 UTC 零点之前）；排队中、运行中的不动，生成的文件不删。缺 `before` 返回 400 `validation.required`，日期不对返回 400 `validation.bad_date` |

**只有超级管理员能调用的**：路由上挂 `requireOwner`，其他账号返回 403（`auth.forbidden`），未登录返回 401（`auth.required`）。超级管理员管的是站点和账号，不是别人的内容：下面没有任何接口返回别的账号的画布、Key 或文件，账号列表里只有数量。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/PUT | `/api/admin/settings` | 站点名称、Logo、默认语言、是否开放注册（`registrationOpen`）、并发数（整个实例 `concurrency`、每个账号 `userConcurrency`）、每个账号的未完成运行上限（`userQueueLimit`）、超时、重试次数、结果保留天数 |
| GET | `/api/admin/storage` | → `{ source: 'saved'\|'env'\|'default', driver: 'local'\|'s3', delivery: ''\|'proxy'\|'redirect', envDriver, secretUnreadable, s3: null \| { preset, endpoint, region, bucket, accessKeyId, forcePathStyle, keyPrefix, publicBaseUrl, delivery, acl, hasSecret, secretTail, endpointHost }, previous: [{ endpointHost, bucket, keyPrefix }] }` |
| POST | `/api/admin/storage/test` | `{ s3 }`，用提交的、未保存的配置真实走一遍 → `{ ok, steps: [{ step: 'put'\|'head'\|'get'\|'public'\|'delete', status: 'ok'\|'failed'\|'skipped', ms? }], message, code }`。测试不通过也是 HTTP 200；`secretAccessKey` 为空表示用已保存的那个 |
| PUT | `/api/admin/storage` | `{ driver: 'local' }` 或 `{ driver: 's3', s3, force? }` → 同 GET。立即生效，不用重启。S3 配置先测试，不通过则不保存，返回 400（`storage.save_needs_test`），测试结果在 `data.test`；`force: true` 跳过测试 |
| GET/PUT | `/api/admin/site` | → `{ registrationOpen }`；`PUT` 的请求体是 `{ registrationOpen: boolean }`。和设置里的 `registrationOpen` 是同一个值（存在 `settings` 集合里），单独给一个接口 |
| GET | `/api/admin/users` | → `[{ id, username, email, role, createdAt, disabled, lastLoginAt, counts: { workflows, runs } }]`，注册早的在前。`counts.workflows` 是没删除的画布数，`counts.runs` 是用量记录数 |
| PATCH | `/api/admin/users/:id` | `{ disabled: boolean }` → 这个账号的那一行。停用后它的会话立即全部结束，不能登录（`auth.account_disabled`），数据保留；启用即恢复 |
| DELETE | `/api/admin/users/:id?confirm=<用户名>` | → `{ id, removed: { <集合名>: <条数> }, files, filesRemoved }`。`confirm` 必须和账号的用户名完全一致，否则 400 `auth.confirm_mismatch`。先停掉它未完成的运行，再删它的会话、画布、分享链接、资产、品牌包、服务商和 Key、覆盖项、用量记录、自己存的模板，以及它名下的文件（按 key 前缀，见第 10 节「文件」），最后删账号；不能撤销。有账号之前写下的文件 key 里没有账号段，不会被这样删掉（它们属于超级管理员，而超级管理员不能被删） |
| POST | `/api/admin/users/:id/reset-password` | → `{ temporaryPassword }`，16 个字符，只出现这一次；该账号的会话全部结束，`mustChangePassword` 置为 `true` |

- 超级管理员不能通过这些接口停用、删除或重置自己（400 `auth.cannot_modify_self`）；超级管理员账号永远不是操作对象（400 `auth.cannot_modify_owner`）；id 不存在返回 404 `auth.user_not_found`。
- 跨域允许的方法里加了 `PATCH`。
- 两类接口的归属一览（每个 `/api/admin/*` 路由一行）见 [api.md](api.md#admin) 的表。

## 6. 沿用主站路径的画布接口

以下接口的路径、请求和返回与主站画布保持一致，去掉其中的积分、团队、白名单逻辑，用户换成本项目自己的账号（每个接口只操作调用者自己的数据）：

- `/api/workflow`：画布的列表、新建、读取、保存、删除、复制、批量下载。
- `/api/canvas-share`：分享链接（新增过期时间与撤销）。
- `/api/canvas-asset`、`/api/user-asset`：素材库。
- `/api/canvas`：模板、文本模板、工具节点（切片、拼图、水印、改尺寸）、多平台导出。
- `/api/brand-kits`：品牌包。列表里每项带 `usedBy`（有几张画布在用）。

不搬：合规体检、短视频链接解析、去水印、反推提示词（由 4.3 的对话接口替代）、积分预估（由 4.1 的预估接口替代）。

## 7. 任务执行器

- 进程内队列，所有账号共用一个。`concurrency`（默认 4）是整个实例同时执行的运行数；其中一个账号最多占 `userConcurrency` 个（默认 4，范围 1 到 32）。
- 队列在账号之间公平分配：有名额空出来时，给正在执行的运行最少的账号；一样多的，给最久没拿到名额的账号；同一个账号内先提交的先执行。一个账号排了很长的队不会挡住别人；只有一个账号时就是普通的先进先出。
- 运行属于发起它的账号（`runs.userId`）：解析模型时用这个账号的服务商和 Key（`resolveModel(modelId, { userId })`，重启后续跑时也一样），结果文件写到这个账号的 key 前缀下，计费钩子也被告知是谁的运行。执行器自己只按 id 找运行、对所有账号一视同仁；归属校验在接口层做。
- 运行记录落库在 `runs`；进程启动时把 `queued` 的重新入队，`running` / `archiving` 且有外部任务号的继续轮询（不重新提交），没有外部任务号的以 `run.interrupted` 判失败。
- 未完成的运行（`queued`、`running`、`archiving`）每个账号最多 `userQueueLimit` 个（默认 200，范围 1 到 500），整个实例合计最多 500 个；先查账号的、再查全站的，超出时提交接口返回 429（`run.queue_full`）。
- 每一步都有总时长上限：提交 60 秒（`submitTimeoutSec`），轮询总时长按模型类型（图片 10 分钟 `imageTimeoutMinutes`、视频 30 分钟 `videoTimeoutMinutes`），对话 5 分钟（`chatTimeoutSec`），结果下载 5 分钟（`downloadTimeoutSec`）。这些都是设置项，括号里是键名。超时一律判失败，不允许无限等待。
- 结果文件下载后转存到存储层（当前使用的后端：本地磁盘或 S3 兼容的桶），图片生成缩略图。注入的 `transfer(output, { signal, kind, userId })` 带着运行所属账号的 `userId`，用它生成 key。
- 任何请求都不会向上游发两次。进程收到退出信号时，手上的运行只有在两种情况下放回 `queued`：已经有外部任务号（下次启动继续轮询，不重新提交），或者还什么都没发出去。请求已经发出、还没有外部任务号的运行以 `run.interrupted` 判失败，不会再发一次；同步型服务商（OpenAI 的图片、Gemini）的每一次运行和每一次对话都属于这种情况。
- 运行存储的约定：`recover()` 返回 `{ queued: [{ id, userId }], interrupted }`。`queued` 是要入队的运行（按创建时间从早到晚），每项带上所属账号，执行器才能照上面的规则分配；`enqueue(id, userId)` 同理。`interrupted` 是上一个进程留下的、卡在中途又没有外部任务号的运行，由执行器判失败。
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

`ctx = { runId, userId, username, kind, model, providerType, workflowId, nodeId, params, count }`，三个函数拿到的都一样。`userId` 是运行所属账号的 id（24 位十六进制字符串）；有账号之前留下、还没有人接手的运行是 `'local'`。`username` 是这个账号当前的用户名（账号已不存在或运行还没有归属时为 `''`）；用户名可以改，自己的记录请以 `userId` 为键。

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
- 清单文件是 `{ "image": [...], "video": [...], "chat": [...] }`，三段都必须有，没有就写 `[]`。条目的字段：`id`（上游模型名，原样发送）、`label`、`acceptsImage`、`maxReferenceImages`、`acceptsVideo`、`videoEdit`、`options`、`defaults`、可选的 `imageByUrlOnly`（参考图只能以公网地址交给上游），以及只给模块自己用、不对外返回的 `_` 开头的私有字段（如 `_protocol`）。条目里不写 `kind`、说明文字和价格。
- 高瑞的接口是我们自己的，可以不标准；其他服务商的模块只走那家的官方接口。接口地址可以改成别的（代理或中转），但对方必须使用完全相同的官方接口，不为第三方的私有格式做适配。
- 内置三家：`gaorui`（默认 `https://gaorui.cc`）、`openai`（默认 `https://api.openai.com/v1`；对话走 `/chat/completions`，图片没有参考图时走 `/images/generations`、有参考图时走 `/images/edits`）、`gemini`（默认 `https://generativelanguage.googleapis.com`；`/v1beta/models/{model}:generateContent`）。三家的 `customKinds` 都是 `['image', 'chat']`，都不能添加自定义视频模型。

服务商实例（`providers` 集合里的一条）：

```jsonc
{
  "userId": "670e…b2",           // 所属账号的 id
  "type": "gaorui",              // 服务商标识，添加后不能改
  "name": "高瑞",
  "slug": "gaorui",              // 模型标识的前缀，创建后不变；在这个账号内唯一
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
- 存储 key 只由 `storage/keys.js` 生成：`<uploads|outputs|tools>/<账号 id>/<年>/<月>/<32 位十六进制>.<扩展名>`，`uploads` 是上传和抓取的文件，`outputs` 是运行结果，`tools` 是工具节点的产物。有账号之前存下的文件没有账号这一段（`uploads/2025/01/<hex>.png`），这些 key 照常有效，地址不变，不移动、不改名。账号这一段是为了删除账号时能把它的文件一并删掉（`storage.deleteUserFiles(userId)` 按前缀删），不是访问控制：`/files/<key>` 对拿到地址的人公开。
- 缩略图的地址由原图地址直接推出，不需要另外记录：存储 key 为 `<uploads|outputs|tools>/…/<名字>.<扩展名>` 的图片，缩略图 key 是 `thumbs/of/<uploads|outputs|tools>/…/<名字>_<扩展名>.webp`（最长边 512 的 webp）。例如 `/files/outputs/<账号 id>/2025/01/ab12.png` → `/files/thumbs/of/outputs/<账号 id>/2025/01/ab12_png.webp`。只有 png / jpg / webp / bmp / avif 有缩略图；视频、GIF 没有。
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
- S3 的 Endpoint 和公开访问地址由超级管理员填写，不经过 SSRF 防护。服务商的接口地址同样不经过，而它现在由每个账号自己填写：注册了的账号都能让服务端向内网地址发请求，不信任注册者时请关闭注册。画布里用户给出的素材地址的防护不变。

**画布**

- `PUT /api/workflow/:id` 只带 `{ name }` 时只改名；保存 `settings.bg`；返回 `updatedAt`。只带 `viewport`（和 / 或 `legacyLayout`）的保存不更新 `updatedAt`：平移、缩放不算改动。编辑器据此把视口单独、悄悄地存（停手约 1.2 秒后一次），不置「未保存」；内容的自动保存照旧，指纹里不含视口。
- 画布文档在 `schemaVersion` 3。3 把品牌包从「每个节点各选」改成「按画布选」：画布文档多了 `brandKitId`（空串 = 不套用），生成类节点（`image-gen` / `image-edit` / `video-gen` / `video-edit`）只在不跟随画布时带 `data.brandKitOverride`（品牌包 id，或 `'none'` 表示这个节点不套用），原来节点上的 `data.brandKitId` 没有了。迁移（`utils/workflowSchema.js` 的 2→3，纯函数、幂等）：所有生成节点用的是同一个品牌包 → 它成为画布的品牌包，节点跟随；其余情况（都没用，或混用）→ 画布不套用，原来有品牌包的节点各自保留成例外。两种情况下每个节点套用的都还是原来那一个。读取时迁移并落库（不更新 `updatedAt`），另外启动时 `routes/workflow.js` 的 `migrateStoredWorkflows()` 把还没迁的画布全部过一遍，这样「有几张画布在用这个品牌包」之类往文档里面看的查询只需要认一种形状。升级时还开着的旧页面仍会往节点上写 `brandKitId`：`PUT` 先把文档迁到当前版本，再把请求里的这个字段转成节点的例外（`normalizeNodeKits`），不会原样存下去。
- 品牌包是前端套用的：执行器 `useCanvasExecutor.ts` 的 `composeGenRequest` 先按 `resolveNodeKit`（节点有例外听节点的，否则跟画布；查不到就当没有）定下品牌包，再用 `useBrandKits.ts` 的 `composeBrandKit` 把前缀、「不要出现：…」和参考图拼进这次请求。节点提示词面板里的「会加什么」预览（`executor.brandKitEffect`）走的是同一个函数，所以预览和实际发出去的一致。新建画布（`POST /api/workflow`）不带 `brandKitId` 时由服务端填上这个账号的默认品牌包；复制画布保留 `brandKitId` 和节点例外；分享快照两样都不带（`cleanNodes` 去掉 `brandKitOverride`），从快照复制出来的画布 `brandKitId` 为空；模板里的节点不带品牌包，放进哪张画布就跟哪张；把另一张画布加载进当前画布时，两边品牌包不同就把原来「跟随画布」的节点钉成例外。
- 版本 2 是随改版来的：生成类节点高了一倍左右，按旧尺寸排的画布会有节点叠在一起。节点的真实尺寸只有浏览器知道，所以服务端的迁移（`utils/workflowSchema.js` 的 1→2）不动位置，只在节点多于一个时给文档打上 `legacyLayout: true`；读取时迁移并落库（不更新 `updatedAt`）。编辑器打开带这个标记的画布时查一次：先把全部节点框进视野（开着「只渲染视野内」，视野外的节点量不到尺寸；实在量不到的按节点类型估），按实测尺寸判断散节点有没有真的重叠（12 像素以内的贴边不算），有才调用和工具条同一个的自动整理、记一笔撤销历史并提示，没有就一个位置都不动、视口还原；然后用 `PUT { legacyLayout: false }`（整理过的话连同新位置）把标记清掉。标记只能由客户端清成 `false`，不能设成 `true`；新建的画布没有标记；复制带标记的画布，副本也带。所以每张老画布只查一次，改版后保存的画布永远不会被动。
- 自动整理覆盖画布上的全部散节点（组和组内节点保持原样），不只是视野里的：尺寸取实测值，没渲染过的节点按类型估（`web/src/composables/useAutoLayout.ts` 的 `ESTIMATED_SIZE`）。内置模板的位置按同一组尺寸排（`services/seed.js`，`SEED_VERSION` 3），`server/test/seed.test.js` 守着它们不重叠；改了节点尺寸要同时改这三处。
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
- `GET /api/canvas-share/:token` 公开只读；不存在、已过期、已撤销统一返回 404。它和 `POST /api/canvas-share/:token/copy` 只认链接里的 token，数据库 id 不行，登不登录都一样。
- 快照里每个带模型的节点另存一个 `data.modelLabel`：发布者看到的模型显示名，发布时由服务端按发布者的模型清单写入（客户端传来的值会被换掉）。看分享的人没有发布者的服务商，模型标识对他们没有意义：分享页只显示这个名字，没有名字（发布者已经没有这个模型）时显示中性的「未注明模型」，不显示标识。更早发布、没有存名字的快照在读取时按发布者当前的模型补上。复制出来的画布不带 `modelLabel`。
- 快照另记 `layoutVersion`（2 表示位置是按现在的节点尺寸排的，不对外返回）。从没有这个值的旧快照、或从还带着 `legacyLayout` 的画布发布的快照复制出来的画布带 `legacyLayout: true`，打开时照上面「画布」一节查一次。分享页用的是另一套小得多的只读节点，旧快照在那里不会重叠，不做整理。
- 读快照不用登录；复制需要登录，复制出来的画布归复制的人。快照保留发布者账号的模型标识，在副本里按复制者自己的服务商解析，复制者没有同一标识的服务商时这个模型就是不可用。
- 发布、列表、修改、撤销、删除只对自己的链接有效，别的账号的链接按 id 访问是 404（`share.not_found`）。每个账号最多 500 个链接。
- 快照里不带运行状态、运行号和任务号、失败详情和成本：发布时去掉，公开读取时再去一遍，复制出来的画布里也没有。去掉的节点字段是 `status`、`progress`、`validationError`、`validationStamp`、`errorMsg`、`taskId`、`taskIds`、`runId`、`runPending`、`generatedCount`、`cost`、`estimatedCost`，以及 `results[]` 每一项里的 `cost`、`taskId`、`runId`。模型标识（含服务商实例的标识前缀）和提示词保留。
- `GET /api/canvas-share/mine` 保留已撤销和已过期的链接；`DELETE /api/canvas-share/:id` 第一次撤销，对已撤销的再删一次才从列表移除；撤销后的 token 不复用。

**设置与用量**

- 站点设置和存储只有超级管理员能读写（其他账号 403 `auth.forbidden`）；服务商、模型、用量是每个账号各管各的（见第 5 节）。
- 存储不在 `GET/PUT /api/admin/settings` 里：它有自己的三个接口（第 5 节的 `/api/admin/storage`），存在 `settings` 集合里键为 `storage` 的一条记录中，密钥加密。把 `storage` 当作设置键提交会得到 `settings.unknown_key`。
- `GET/PUT /api/admin/settings` 是扁平对象：`siteName`、`logoUrl`、`defaultLocale`、`registrationOpen`、`concurrency`、`userConcurrency`、`userQueueLimit`、`submitTimeoutSec`、`imageTimeoutMinutes`、`videoTimeoutMinutes`、`chatTimeoutSec`、`downloadTimeoutSec`、`maxRetries`、`retentionDays`。不认识的键（包括 `constructor`、`__proto__` 这类名字）返回 400（`settings.unknown_key`）。界面只有一套主题，早期版本的 `defaultTheme` 已经从头到尾删除：`GET` 不再返回它，`PUT` 带上它和别的不认识的键一样返回 `settings.unknown_key`，早期版本存下来的值不再使用。各项的默认值和范围、在「设置」页的哪个分区，见 [configuration.zh-CN.md](configuration.zh-CN.md#管理设置)。
- 随账号新增的三个键：`registrationOpen`（布尔值，默认 `true`）是否允许自行注册（注册出来的都是普通账号）。环境变量 `REGISTRATION_OPEN` 只给它一个初始值：启动时 `index.js` 调 `settings.seed('registrationOpen', …)`，用 `$setOnInsert` 的 upsert 写入，所以只有这项设置从没保存过时才写得进去；一旦库里有了这一条（由这次播种、设置页或 `PUT /api/admin/site` 写入），存下的值为准，变量不再起作用。写进去的那一次，日志里有一行 `[auth] registration is open|closed (REGISTRATION_OPEN); ...`；`userConcurrency`（1 到 32，默认 4）一个账号同时执行的运行数，`concurrency` 仍是整个实例的总数；`userQueueLimit`（1 到 500，默认 200）一个账号未完成运行的上限，整个实例的总上限仍是 500。
- 结果保留天数（`retentionDays`）是站点设置，对所有账号的运行生效。没有按账号的存储配额。
- 原有的各项上限现在都按账号计：服务商 50 个、每个服务商的自定义模型 100 个、分享链接 500 个、品牌包 50 个、资产每种分类 5000 个、画布列表 200 张。
- `GET /api/admin/usage`（调用者自己的用量）→ `{ groupBy, timezone, totals, items: [{ key, label?, runs, succeeded, failed, canceled, amount, currency, unknownCount, costs }] }`，`totals` 与 `items` 的每一项形状相同。可带 `tz`（IANA 时区名，默认 `UTC`），它同时决定按天分组时一天的起止，以及 `from` / `to` 里只写日期时指的是哪一天。网页端（「生成记录」页、清理弹窗、工作台的本月汇总和近 14 天柱状图）总是带上浏览器的时区，所以那里的「今天」是用户本地的今天。
- 服务商的新增和修改：字段直接放在请求体顶层；新增时 `apiKey` 必填；修改时不带密钥表示保持不变，`baseUrl: ''` 表示恢复官方地址。返回的服务商对象带 `customBaseUrl`（地址是否不是官方地址）和 `customModels: [{ model, kind, label }]`，不再把各种选项字段平铺在顶层。
- 自定义模型的规则由后端强制：模型名必填，只能用字母、数字和 `. _ - : / @`，最长 120 个字符；类型必填、没有默认值，而且必须在这家服务商的 `customKinds` 里；不能和清单里的模型重名；同一个实例里不能重复；每个实例最多 100 个。对应的错误码是 `provider.custom_name_required`、`custom_bad_name`、`custom_kind_required`、`custom_kind_unsupported`、`custom_in_catalog`、`custom_exists`、`custom_max`，以及 `custom_not_found`（404）和 `custom_name_fixed`。
- 需要登录的接口上，401 只表示「没登录」（`auth.required`：没带凭证、凭证不存在或已过期、账号被停用），前端收到会清除登录状态、回到登录页。所以别的失败都不用 401：上游的认证失败是 400，修改密码时当前密码不对是 400（`auth.wrong_current_password`）。唯一的例外是 `POST /api/auth/login` 自己的 `auth.invalid_credentials`，前端对登录和注册接口的 401 不做「登录失效」处理。

**安全响应头**

- 每个页面带 `Content-Security-Policy`：`script-src 'self'`，脚本不允许 `'unsafe-inline'` 和 `'unsafe-eval'`。构建出的 `index.html` 里已经没有内联脚本（只有一套主题，`theme-mode` 直接写在 `<html>` 上），所以策略里不再有哈希；`middleware/security.js` 启动时仍会扫描 `index.html`，如果里面出现内联脚本，加进去的是它的 sha256，而不是 `'unsafe-inline'`。`img-src` / `media-src` / `connect-src` 有意对任何 http(s) 来源开放（画布要显示和下载对象存储、CDN、外链里的结果），另外明确列出存储配置里每个 `publicBaseUrl` 的来源，跟着当前的存储配置变，不用重启（现在不改变效果，为的是以后收紧开放来源时它们仍被允许）；另有 `frame-ancestors 'self'`、`object-src 'none'`、`base-uri 'self'`、`form-action 'self'`。
- 接口响应带 `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` 和 `Cache-Control: no-store`。
- 所有响应带 `X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy`、`Cross-Origin-Opener-Policy`、`Permissions-Policy`。
- 应用不设置 HSTS，交给终结 TLS 的反向代理。
- 前端构建打开了 `__INTLIFY_JIT_COMPILATION__`（`web/vite.config.ts`），vue-i18n 不需要 eval。前端构建产物如果不由本服务端提供，那台服务器要自己发送等效的 CSP。
- `TRUST_PROXY` 只接受代理层数（1 到 10）或逗号分隔的 IP / CIDR / `loopback` / `linklocal` / `uniquelocal`；`true` 和主机名在启动时报配置错误。

## 11. 账号与数据归属

**哪些集合带归属**

- 按账号的集合，每条记录带 `userId`（账号 id 的字符串）：`workflows`、`shares`、`userassets`、`brandkits`、`providers`、`modeloverrides`、`runs`，以及 `templates`、`texttemplates` 里不是内置的那些。
- 新增两个集合：`users`（账号：用户名、邮箱及各自的小写形式、密码哈希、`role`、`disabled`、`lastLoginAt`、`mustChangePassword`、`legacyAdoption`）和 `sessions`（会话：凭证的 SHA-256、`userId`、`expiresAt`、`lastSeenAt`、`userAgent`、`ip`）。
- 属于站点的：`settings`、`canvasassets`，以及内置模板和内置文本模板（`userId` 为 `system`）。
- 按账号唯一的索引：`providers` 的 `{ userId, slug }`、`modeloverrides` 的 `{ userId, modelId }`、`templates` 的 `{ userId, key }`。
- `services/accounts.js` 里的 `OWNED` 是按账号集合的唯一清单，「接手旧数据」和「删除账号」都照它逐个处理。新增一个按账号的集合，必须加进 `OWNED`，并且它的每个查询都要带 `userId`。

**超级管理员是怎么来的**

- 每次启动时 `index.js` 调 `accounts.prepare()`，重复执行无害。它依次：删掉原来全站唯一的三个索引（`providers.slug_1`、`modeloverrides.modelId_1`、`templates.key_1`）并建立按账号的索引；把内置模板和内置文本模板改归站点（`system`）；调 `ensureAdministrator()`；把上次做到一半的交接做完（见下一小节）。
- `ensureAdministrator()`：库里已经有 `role: 'owner'` 的账号（不管它是怎么来的、叫什么名字）就什么都不读、什么都不改，`ADMIN_*` 被忽略，日志里也不提。没有的话，按 `config.admin`（`ADMIN_USERNAME`，默认 `admin`；`ADMIN_EMAIL`，可空；`ADMIN_PASSWORD`，可空）创建一个，并在同一步里接手有账号之前的数据。
- 密码：设了 `ADMIN_PASSWORD`（8 到 128 个字符）就用它，`mustChangePassword` 为 `false`，日志里一行 `[auth] created the super admin account "admin" with the password from ADMIN_PASSWORD`。没设就生成一个 16 位随机密码，`mustChangePassword` 为 `true`，由 `announceGeneratedPassword()` 在启动日志里用一个框打印一次；库里只存哈希，`prepare()` 的返回值里也不带它，以后不会再出现。
- 这三个变量的检查也在这里做，而不是在 `config.js` 里：用户名不合规则、邮箱不像邮箱、密码长度不对，都抛 `ConfigError`，服务端带着 `[config] ...` 退出（例如 `[config] ADMIN_PASSWORD must be 8 to 128 characters long. ...`）。
- 并发安全：`users` 上有一个部分唯一索引 `{ role: 1 }`（`partialFilterExpression: { role: 'owner' }`），最多只允许一条 `owner`。几个进程同时启动时，只有一个 `User.create` 成功，其余的撞上重复键后重新查一遍，找到那个超级管理员就直接返回，所以只会有一个超级管理员、只打印一个密码。
- 撞上重复键、而库里仍然没有超级管理员，说明 `ADMIN_USERNAME` 或 `ADMIN_EMAIL` 已经是某个普通账号的用户名或邮箱：抛 `ConfigError`，提示改哪一个变量，服务端拒绝启动。
- 邮箱规则：超级管理员可以没有邮箱（没设 `ADMIN_EMAIL` 时 `email` 和 `emailLower` 都存成 `''`），它用用户名登录，之后可以在「设置 → 账号与安全」里补上。`emailLower` 上是普通的唯一索引，所以全库恰好只容得下一个没有邮箱的账号，也就是它。注册和修改资料始终要求一个合法的邮箱（`parseEmail`），普通账号的邮箱不可能为空，补上之后也改不回空。
- 超级管理员密码丢了：`ADMIN_PASSWORD` 改了也没用，只能跑 `node server/src/cli/reset-password.js <用户名>`，它调的是和超级管理员「重置密码」同一个 `accounts.resetPassword()`。

**有账号之前的数据怎么交接**

- 旧版本的全部数据都写着常量 `userId: 'local'`。升级后不用手工做任何事。
- 新版本第一次启动时，`ensureAdministrator()` 创建超级管理员，并在同一步里把全部旧数据交给它：画布、分享链接（token 不变，照常可用）、资产、品牌包、服务商及其 Key（`SECRET_KEY` 没变就仍能解密）、自定义模型、覆盖项和价格、用量记录、自己做的模板。画布里存的文件地址照常可用。日志里写（带每个集合的条数）：`[auth] the data from before accounts now belongs to "admin": {...}`。
- 交接是幂等的：超级管理员的记录在创建时就带着 `legacyAdoption: 'pending'`（和账号写在同一条记录里，所以「超级管理员已经有了」和「旧数据还没交接」不可能被分开看到），`adoptLegacy()` 做完后改成 `'done'`；中途停掉，下次启动时 `prepare()` 看到 `pending` 就接着做完。每一步都是「把还没有归属的改成你的」，再跑一遍什么都不会变。
- 交接完成之后才冒出来的无主数据，不会再交给任何人。
- 库里已经有超级管理员的实例，超级管理员原样保留，不创建、不改动，`ADMIN_*` 被忽略。
- 升级时要做的只有：第一次启动新版本之前设好 `ADMIN_PASSWORD`（或者从那次启动的日志里读出生成的密码），`SECRET_KEY` 保持不变，删掉 `ACCESS_PASSWORD`；用超级管理员账号登录，旧数据都在。之后注册的账号是空的，看不到旧数据。
- 跨升级时还没完成的运行照常续跑，用的还是原来的服务商；它们归超级管理员。
- 以前没设 `ACCESS_PASSWORD`、不带凭证直接调接口的集成，现在要先 `POST /api/auth/login`，再带 `Authorization: Bearer <token>`；旧的口令凭证全部作废。

**隔离的边界**

- 账号之间的隔离由接口在每个查询上强制，不是加固过的多租户边界：所有账号共用一个进程、一个数据库、一块存储和一个队列。能接触数据库或服务器磁盘的人当然什么都读得到；服务商 Key 仍然用 `SECRET_KEY` 加密着。
- 注册默认是开放的，产生的只会是普通账号。每个账号都能占用实例的存储和队列（受 `userQueueLimit` 和上传大小限制，没有存储配额），也都能添加服务商。不想让陌生人进来，就从第一次启动起设 `REGISTRATION_OPEN=false`，或者在「设置 → 站点」里、用 `PUT /api/admin/site` 关闭注册。
- 没设 `ADMIN_PASSWORD` 时，第一次启动的日志里有超级管理员的初始密码。在它被换掉之前，这份日志要当作敏感信息；换掉之后它就没有用了。
- 没有的东西：邮箱验证、两步验证、单点登录、审计日志、按账号的存储配额和花费上限（后者用计费钩子做，它现在知道是哪个账号）。
