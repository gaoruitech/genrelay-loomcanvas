# LoomCanvas 架构与接口约定

> English readers: this page is the Chinese design contract between the frontend and the backend. The endpoint reference in English is [api.md](api.md); the other pages are listed in [README.md](README.md).

本文是前后端共同遵守的约定。改接口先改这里。逐个接口的请求、返回和错误码另见 [api.md](api.md)（英文），文档索引见 [README.zh-CN.md](README.zh-CN.md)。

前端除了独立部署，还可以集成进别的产品：整站嵌入，或只嵌画布编辑器（后端由集成方提供的适配器对接）。入口、选项、画布文档格式和兼容性承诺见 [integration.zh-CN.md](integration.zh-CN.md)；画布编辑器与后端之间的每一次调用都经过那里定义的适配器接口（`web/src/embed/types.ts` 的 `EditorAdapter`），本文第 4、6 节的接口是原装后端对这套接口的实现。

## 1. 仓库结构

```text
loomcanvas/
├─ server/            Node.js 20.9+ + Express + Mongoose（CommonJS）
│  ├─ src/
│  │  ├─ index.js           启动入口
│  │  ├─ app.js             Express 装配（中间件顺序、路由、静态前端）
│  │  ├─ config.js          读取环境变量
│  │  ├─ constants.js
│  │  ├─ routes/            HTTP 接口；auth.js（注册、登录、自己的账号与会话）、adminUsers.js（超级管理员：账号管理、注册开关）、teams.js / teamInvitations.js / spaces.js / adminTeams.js（团队，见第 12 节）、runExport.js（生成记录打包下载）
│  │  ├─ models/            Mongoose 模型；User.js（账号）、Session.js（会话）、Team*.js（团队、成员、邀请、动态、申请、离开的人）、BudgetCounter.js（每月上限的计数）
│  │  ├─ providers/         服务商（每家一个模块加一份模型清单）
│  │  │  ├─ index.js        注册表
│  │  │  ├─ gaorui.js / openai.js / gemini.js
│  │  │  └─ catalog/        index.js（清单的格式与校验）、gaorui.json / openai.json / gemini.json（各家的模型清单）
│  │  ├─ runner/            任务执行器（排队、轮询、转存、记账）
│  │  ├─ storage/           存储层：本地磁盘与 S3 兼容对象存储（index 门面、local、s3、schema、probe、keys）
│  │  ├─ billing/           计费钩子（默认空实现）
│  │  ├─ services/          账号、会话与数据归属（accounts.js）、空间与团队（spaces.js、teams.js、permissions.js、budget.js、activity.js、spaceCopy.js，见第 12 节）、打包下载（zipExport.js）、设置、存储设置（storageSettings.js）、素材读取、图片工具、内置内容、结果清理、服务商数据的一次性升级（providerMigration.js）
│  │  ├─ middleware/        auth.js（认出调用者、只要求有会话 requireSession、要求登录且已换掉临时密码 requireAuth、要求超级管理员 requireOwner、登录与注册的限流）、语言、错误处理、安全响应头
│  │  ├─ cli/               reset-password.js：在服务器上重置某个账号的密码
│  │  ├─ i18n/              服务端给用户看的文字：zh-CN.js、en.js
│  │  └─ utils/             password.js（密码哈希，scrypt）等
│  └─ test/                 node:test 测试
├─ web/               Vue 3 + Vite + TypeScript + Vue Flow + TDesign
│  └─ src/
│     ├─ views/             Landing / Login / Register / ChangePassword / Workbench / CanvasList / Canvas / CanvasShareView / Assets / BrandKits / History / Models / Team / Join / Settings / Setup / NotFound
│     ├─ embed/             集成入口：app.ts（整站嵌入）、editor.ts（只嵌编辑器）、types.ts / document.ts（对外的类型与画布文档格式）、适配器、挂载代码；独立应用的 main.ts 走的是同一份启动代码
│     ├─ router/            路由与登录守卫：/（落地页）、/login、/register、/app（工作台）、/canvases、/canvas/:id、/assets、/models、/history、/settings、/setup、/share/:token、/join/:token（加入团队）；团队空间里的页面是同一组地址加前缀 /t-<团队 id>/，另有 /t-<团队 id>/team（「团队」页）
│     ├─ components/AppShell.vue 登录后的外壳：顶栏（含空间切换器）+ 左侧栏（工作台 / 画布 / 素材库 / 模型管理 / 生成记录 / 设置；团队空间里是团队首页 / 画布 / 素材库 / 模型管理 / 生成记录 / 团队 / 设置）；编辑器里侧栏收成图标栏
│     ├─ components/team/、space/ 「团队」页（成员、用量、动态、设置），以及各个空间共用的部件（空间切换器、创建和加入团队、团队权限、复制到其他空间、上限）
│     ├─ components/canvas/ 画布节点与对话框（gen/ 是生成节点：一份状态、三套布局外壳、输入条和属性面板；SelectionToolbar.vue 是多选工具条，QueuePanel.vue 是生成队列的圆钮和清单）
│     ├─ components/auth/   登录页与注册页共用的版式（AuthLayout.vue），以及 404 和「连接不上服务端」这两屏用的 BarePage.vue（只有 Logo、语言和主题）
│     ├─ components/landing/ 落地页的示意画布，以及窄屏（≤820px）页头收成的菜单 LandingMenu.vue
│     ├─ components/workbench/ 工作台：新建画布、模板卡片
│     ├─ components/models/ 「模型管理」页：服务商表单、自定义模型、价格
│     ├─ components/history/ 「生成记录」页：详情弹窗、清理弹窗
│     ├─ components/settings/ 「设置」页的各个分区，一次显示一个（地址 /settings/<分区>）：「个人」组的账号与安全、外观；「站点管理」组的站点、用户管理、团队、存储、运行限制（只有超级管理员看得到）
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
- 账号：实例有正常的账号体系，登录后使用，没有免登录的模式。只有两种角色：超级管理员（界面上叫「超级管理员」，在接口和数据库里的值是 `owner`；有且只有一个，由唯一索引保证）和普通账号（`user`）。超级管理员是内置的：还没有超级管理员时，服务端在启动时按 `ADMIN_USERNAME` / `ADMIN_PASSWORD` / `ADMIN_EMAIL` 自动创建，没有人靠注册成为超级管理员；注册（用户名、邮箱、密码）产生的一律是普通账号。账号在站点上没有别的角色；几个账号共用的团队空间和团队里的三个角色是另一套，见第 12 节。旧版本的 `ACCESS_PASSWORD` 已废弃：变量还设着的话，启动时打一条警告，此外不起任何作用。
- 归属：每个请求作用于一个空间：调用者的个人空间，或他加入的某个团队（第 12 节）。下面说的是个人空间，团队出现之前的全部内容都在这里：每个账号只看得到、改得了自己的数据。按账号的有：画布、分享链接、资产、品牌包、运行与对话任务、用量记录、自己存的模板，以及服务商、API Key、自定义模型、模型覆盖项（启用、名称、排序、默认参数、价格）。属于站点、由超级管理员管理的有：是否开放注册、存储配置、并发与超时等限制、结果保留天数、站点外观（名称、Logo、默认语言）、账号列表。内置模板、内置文本模板和只读的公共素材库属于站点，所有账号都看得到。
- 每条按空间的记录带 `userId`：个人空间里值是账号 id（24 位十六进制字符串），团队空间里是团队 id（见 12.2）；每个查询都带上请求作用的空间的 id（`req.spaceId`，个人空间里它等于 `req.userId`）。按 id 访问别的空间的东西返回 404，和 id 不存在时一样，不返回 403，更不返回数据；列表不混入别人的记录。超级管理员没有例外：他的请求同样只落在他自己的数据上，账号列表里只给数量。详见第 11 节。
- 两件事有意跨账号：分享链接（拿到链接的 token 就能读快照，不用登录；登录的账号可以把它复制成自己的画布）和文件地址（`/files/<key>` 对拿到地址的人公开，key 猜不出来；分享页和上游模型都要读它）。
- 会话的传递方式没变：每个请求带 `Authorization: Bearer <token>`，前端把凭证放在浏览器的本地存储里（键 `loomcanvas-token`；勾了「记住我」放 `localStorage`，没勾放 `sessionStorage`）。不用 cookie，所以没有 CSRF 的问题；要防的是 XSS，靠的是 CSP 的 `script-src 'self'`、页面里没有内联脚本（见第 10 节「安全响应头」）。凭证不再是 JWT，而是 32 字节随机数的 base64url（43 个字符），本身不含任何信息；服务端在 `sessions` 集合里只存它的 SHA-256，连同 `userId`、`expiresAt`、`lastSeenAt`、`userAgent`、`ip`。
- 会话有效期 12 小时，登录时带 `remember: true` 则 30 天，从登录时算起，不因使用而延长；注册返回的凭证是 12 小时。过期的记录由 MongoDB 的 TTL 索引清掉，清掉之前也已经被拒绝。因为会话存在库里，退出登录、「退出其他设备」、修改密码（该账号全部会话结束，包括发起修改的这一个；调用方在响应里拿到一个新凭证，有效期是原会话剩下的时间）、重置密码（该账号全部会话结束）、停用账号（全部会话结束）、删除账号都立即生效。
- `SECRET_KEY` 不再参与登录，改了它不会让任何人掉线；它现在只用来加密服务商的 API Key 和保存的 S3 密钥。密码用 `node:crypto` 的 scrypt（N=32768、r=8、p=1），每个账号 16 字节随机盐，参数随哈希一起存（`scrypt$N=32768,r=8,p=1$<盐>$<哈希>`），比较用恒定时间。凭证不进日志；密码也不进，唯一的例外是没设 `ADMIN_PASSWORD` 时生成的超级管理员密码，它在创建超级管理员的那一次启动里打印一次（见第 11 节）。
- 不需要登录的只有：`GET /api/bootstrap`、`POST /api/auth/register`、`POST /api/auth/login`、`GET /api/canvas-share/:token`、`GET /api/team-invitations/:token`（邀请预览）、`POST /api/workflow/:id/lock/release`（页面关闭时归还编辑锁，凭释放令牌，见 12.6）、`GET /files/*` 和静态前端。其余接口没带有效凭证一律返回 401、`code` 为 `auth.required`（旧版本是 `auth.login_required`）；只有超级管理员能调用的接口对其他账号返回 403、`auth.forbidden`。
- 强制改密码：账号的密码是别人知道的（启动时生成的超级管理员密码、超级管理员重置或命令行重置给出的临时密码）时，`users.mustChangePassword` 为 `true`。`middleware/auth.js` 里有两道闸：`requireSession` 只要求请求带着有效会话，`requireAuth` 在它之上再加一条「`mustChangePassword` 为 `true` 就返回 403 `auth.password_change_required`」。只有 `GET /api/auth/me`、`PUT /api/auth/password`、`POST /api/auth/logout` 用 `requireSession`（`GET /api/bootstrap` 是公开的，同样照常应答）；其余需要登录的接口全部走 `requireAuth`，所以这样的会话除了改密码什么都做不了。`PUT /api/auth/password` 成功后标记清掉。前端的对应物是 `/password` 这一屏（「设置新密码」）：路由守卫把这样的账号一律带到那里，改完再去原本要去的地址。
- 限流（在进程内存里，单进程，重启清零）。登录按四种口径计数，时间窗都是 10 分钟：(a) 同一个账号名 + 同一个客户端地址 10 次；(b) 同一个客户端地址、所有账号名合计 30 次；(c) 同一个账号名、所有地址合计 100 次；(d) 全部登录合计 3000 次。IPv6 按 /64 网段计。账号名不必存在，计数方式一样，所以从限流看不出哪些名字存在。这个账号的「熟悉地址」不受 (c) 和 (d) 约束：最近 30 天里它从那里成功登录过（记在内存里），或者那个地址持有它的有效会话。这样设计是为了让「拿某个账号名乱猜」锁不住账号的主人：从很多地址轮流猜，攻击者被压到每 10 分钟 100 次，主人从平时用的地址照样能登录；只有从全新的地址登录时，才可能要在攻击进行期间等一等。登录成功会清掉这一对「账号名 + 地址」在 (a) 上的计数。修改密码时的当前密码校验计入 (a) 和 (c)。注册每个客户端地址每小时 20 次；修改用户名或邮箱（`PUT /api/auth/profile`）每个账号每小时 20 次。超出一律返回 429、`auth.too_many_attempts`，`data` 为 `{ retryAfterSeconds }`，并带 `Retry-After` 响应头；已登录的会话不受影响。反向代理后面要配 `TRUST_PROXY`，限流和会话列表里的 `ip` 才是真实的客户端地址。
- 注册必然会透露用户名或邮箱是否已被占用（`auth.username_taken`、`auth.email_taken`）：系统不发邮件，没有别的回答方式。它靠注册的限流约束；修改资料也给出同样的回答，所以单独限流。在意这一点的实例应当关闭注册。登录不透露账号是否存在。
- 请求体大小：JSON 默认 1 MB，`/api/workflow` 下 6 MB，`/api/auth`、`/api/canvas-share` 和 `/api/team-invitations` 下 64 KB。需要登录的接口先验凭证、再解析请求体。
- 请求本身格式不对（路径里的百分号编码有误、不支持的字符集等）返回 4xx，`code` 为 `common.bad_request`，不返回 500。
- 文件地址：每个存下来的文件只有一个地址，站内相对地址 `/files/<key>`。接口返回的、画布里保存的都是它，与 `PUBLIC_URL` 无关，也与文件在本地磁盘还是在 S3 兼容的桶里无关。`/files/<key>` 由应用应答（见第 10 节「文件」）。
- 上游 Key 用 `SECRET_KEY` 做 AES-256-GCM 加密后入库；任何接口都不返回明文，只返回 `hasKey` 和 `keyTail`（末四位），以及 `keyUnreadable`（存着 Key 但已经解不开，即 `SECRET_KEY` 变了）。存储设置里的 S3 Secret Access Key 同样处理，接口只返回 `hasSecret` 和 `secretTail`。

## 3. 基础接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bootstrap` | 公开；旧路径 `/api/app/bootstrap` 仍然应答（Docker 的 HEALTHCHECK 还在用它）。`{ auth:{registrationOpen}, user, site:{name,logoUrl,showName,defaultLocale}, spaces, space, spaceError?, teams, hasProvider, limits:{maxUploadMb}, media:{upstreamByUrl,writable}, version }`（`spaces`、`space`、`spaceError`、`teams` 见 api 文档的「bootstrap 和 me 里的空间信息」）。`auth.registrationOpen` 表示现在能不能注册，就是 `registrationOpen` 这项设置的值，`auth` 里只有这一个字段；`user` 是调用者的 User（请求带了有效凭证时），否则 `null`，也就是没登录；早期版本的 `authRequired`、`authed` 和 `site.defaultTheme` 已经去掉（登录是必须的；主题是每个账号自己的偏好 `user.prefs.theme`，不是站点设置）；`hasProvider` 说的是请求作用的那个空间有没有启用的服务商，未登录为 `false`。`media.upstreamByUrl` 表示上游能不能按地址读到站内文件（配了公网的 `PUBLIC_URL`，或新文件存在公网能访问的桶里），画布据此在运行前提示「参考图只能给公网地址」的模型用不了参考图。`limits.maxUploadMb` 是服务端的 `MAX_UPLOAD_MB`，前端据此在上传前拦下过大的文件 |
| POST | `/api/auth/register` | 公开。`{ username, email, password }` → `{ user, token }`。产生的一定是普通账号（`role: 'user'`）；`registrationOpen` 关着时一律 403，没有例外。错误：`auth.invalid_username`、`auth.invalid_email`、`auth.weak_password`（400），`auth.username_taken`、`auth.email_taken`（409），`auth.registration_closed`（403），`auth.too_many_attempts`（429） |
| POST | `/api/auth/login` | 公开。`{ account, password, remember? }` → `{ user, token }`，`account` 是用户名或邮箱，不区分大小写。错误：`auth.credentials_required`（400，缺字段），`auth.invalid_credentials`（401；账号不存在和密码不对是同一个返回、同样的计算量），`auth.account_disabled`（403，密码正确之后才会告知），`auth.too_many_attempts`（429） |
| POST | `/api/auth/logout` | 结束发出请求的这个会话，`data: null` |
| GET | `/api/auth/me` | → `{ user, spaces }`，`spaces` 同 bootstrap |
| PUT | `/api/auth/password` | `{ currentPassword, newPassword }` → `{ revokedSessions, token }`。该账号的会话全部结束，包括发出请求的这一个；`token` 是给调用方的新凭证（有效期是被替换的会话剩下的时间），前端悄悄换上。临时密码也是用它换掉的：`mustChangePassword` 为 `true` 时可以调，成功后清掉这个标记。当前密码不对返回 400 `auth.wrong_current_password`（有意不用 401），新密码和当前密码相同返回 400 `auth.same_password`，另有 `auth.weak_password`（400）、`auth.too_many_attempts`（429） |
| PUT | `/api/auth/profile` | `{ username?, email? }` → `{ user }`。错误：`auth.invalid_username`、`auth.invalid_email`、`common.nothing_to_update`（400），`auth.username_taken`、`auth.email_taken`（409），`auth.too_many_attempts`（429；每个账号每小时最多 20 次，否则前两个 409 就成了不限次数的「这个邮箱注册过没有」查询） |
| PUT | `/api/auth/prefs` | `{ nodeLayout?: 'a'\|'b'\|'c', theme?: 'dark'\|'light'\|'system' }` → `{ user }`。账号对网页端的偏好，只改发过去的键；键和值都有白名单（`services/accounts.js` 的 `PREFS`），不认识的键 400 `validation.bad_key`，值不对 400 `validation.one_of`，空对象 400 `common.nothing_to_update` |
| GET | `/api/auth/sessions` | → `[{ id, current, createdAt, lastSeenAt, userAgent, ip }]`，调用者还有效的会话，最近活跃的在前；`lastSeenAt` 最多每分钟刷新一次 |
| DELETE | `/api/auth/sessions/:id` | → `{ id }`，结束自己的一个会话（可以是当前这个）。不存在或是别人的：404 `auth.session_not_found` |
| DELETE | `/api/auth/sessions` | → `{ revoked }`，结束除当前会话以外的全部会话 |
| POST | `/api/files/upload` | multipart，字段 `file` → `{ url, key, size, mime, width?, height?, thumbnailUrl? }`（后三项只有图片有） |
| POST | `/api/files/fetch` | `{ url }`，后端抓取远程图片转存（做内网地址拦截）→ 同上。只接受图片：地址指向本实例存储时也一样，存储里的视频返回 400（`file.image_only`） |

User 是接口对外给出的账号信息：`{ id, username, email, role: 'owner'|'user', mustChangePassword, prefs, createdAt }`（注册、登录、`me`、改资料、改偏好、bootstrap 的 `user`、超级管理员的账号列表给的都是它）。`prefs` 是这个账号对网页端的偏好（`users.prefs`），总是完整的，有两项：`nodeLayout: 'a'|'b'|'c'`（默认 `'a'`，见第 10 节「生成节点的三种布局」）和 `theme: 'dark'|'light'|'system'`（默认 `'dark'`，见第 10 节「主题」）。`email` 对超级管理员可能是 `''`（见第 11 节的邮箱规则）；`mustChangePassword` 为 `true` 表示还在用别人知道的密码。用户名 3 到 32 个字符（`A-Z a-z 0-9 _ -`），邮箱最长 254 个字符，两者都不区分大小写地唯一；密码 8 到 128 个字符。不发任何邮件：没有邮箱验证，也没有「忘记密码」邮件。忘了密码有两条路：超级管理员在「设置 → 用户管理」里重置（接口见第 5 节），或者运行服务的人执行 `node server/src/cli/reset-password.js <用户名或邮箱>`（超级管理员自己的密码只能走这条）；两者都给出一个临时密码，让这个账号在所有设备上退出登录，并把 `mustChangePassword` 置为 `true`：用临时密码登录后必须先设置新密码。

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

模型标识按空间各算各的（个人空间按账号，团队按团队，见 12.2）：实例标识（slug）只在一个空间自己的服务商里唯一（索引 `{ userId, slug }`），覆盖项同理（`{ userId, modelId }`）。两个空间可以各有一个标识为 `gaorui` 的服务商，一个空间里的 `gaorui:nano-banana-2.1` 和另一个空间里的同名标识没有关系。注册表的 `listModels`、`resolveModel` 都要传 `userId`（空间的 id）。

### 4.2 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/models` | 返回调用者自己已启用的服务商下已启用的模型 `ModelSpec[]`，可带 `?kind=image` |
| POST | `/api/runs/estimate` | `{ model, params, count }` → `{ unitCost, totalCost, currency, unknown }` |
| POST | `/api/runs` | 见下 → `{ runId }`。运行属于调用者的账号。这个账号未完成的运行已有 `userQueueLimit` 个（默认 200），或整个实例合计已有 500 个时，返回 429（`run.queue_full`） |
| GET | `/api/runs/:id` | → `Run`。别的空间的运行返回 404 |
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

**按空间的**（个人空间里就是按账号的；带 `X-Space` 时是团队的，团长和管理员管理、成员只读，见第 12 节）：登录的账号都能调用，每个查询带请求作用的空间的 id（`req.spaceId`），操作的是这个空间的服务商、Key、自定义模型、覆盖项、价格和用量。个人空间里自带 Key 是按账号的；别的空间的记录按 id 访问是 404。`GET /api/admin/vendors` 返回的是服务端内置的清单，不属于任何账号。

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
| GET | `/api/admin/usage` | `?from&to&groupBy=day\|model&tz` → 自己的用量汇总；`/api/admin/usage/records` 分页明细，同样接受 `from`、`to`、`tz`。只写日期（`YYYY-MM-DD`）的 `from` / `to` 表示 `tz` 时区里的那个自然日：`from` 从这一天开始，`to` 到这一天结束；完整的 ISO 时间按原样使用。`tz` 是 IANA 时区名，默认 `UTC`（不带时和以前完全一样）；不认识的时区名返回 400 `validation.invalid`（字段 `tz`） |
| DELETE | `/api/admin/usage/records` | `?before=<YYYY-MM-DD 或 ISO 时间>` → `{ deleted }`。也接受 `tz`。删除自己在这一刻之前创建、已结束（成功、失败、已取消）的用量记录（`2025-01-31` 表示 `tz` 时区里这一天开始之前，不带 `tz` 即 UTC 零点之前）；排队中、运行中的不动，生成的文件不删。缺 `before` 返回 400 `validation.required`，日期不对返回 400 `validation.bad_date` |

**只有超级管理员能调用的**：路由上挂 `requireOwner`，其他账号返回 403（`auth.forbidden`），未登录返回 401（`auth.required`）。超级管理员管的是站点和账号，不是别人的内容：下面没有任何接口返回别的账号的画布、Key 或文件，账号列表里只有数量。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/PUT | `/api/admin/settings` | 站点名称、Logo、默认语言、是否开放注册（`registrationOpen`）、并发数（整个实例 `concurrency`、每个账号 `userConcurrency`）、每个账号的未完成运行上限（`userQueueLimit`）、超时、重试次数、结果保留天数 |
| GET | `/api/admin/storage` | → `{ source: 'saved'\|'env'\|'default', driver: 'local'\|'s3', delivery: ''\|'proxy'\|'redirect', envDriver, secretUnreadable, writable, upstream: 'public_base'\|'signed'\|'app'\|'inline'\|'unavailable', upstreamReason, s3: null \| { preset, endpoint, region, bucket, accessKeyId, forcePathStyle, keyPrefix, publicBaseUrl, presignEndpoint, delivery, acl, hasSecret, secretTail, endpointHost }, previous: [{ endpointHost, bucket, keyPrefix }], buckets: [{ id, endpointHost, bucket, keyPrefix, origin: 'saved'\|'env', active, state: 'ok'\|'unreachable'\|'secret_unreadable', downSince?, removable }] }`。`writable: false`：当前使用的桶密钥解不开，新文件被拒绝 |
| DELETE | `/api/admin/storage/buckets/:id` | 不再读取一个已经不写入的桶（`buckets` 里 `removable` 为 `true` 的）→ 同 GET。`404 storage.bucket_not_found`、`400 storage.bucket_in_use`、`400 storage.bucket_from_env` |
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

- 进程内队列，所有账号共用一个。`concurrency`（默认 4）是整个实例同时执行的运行数；其中一个账号最多占 `userConcurrency` 个（默认 4，范围 1 到 32），一个团队合计最多占 `teamConcurrency` 个（默认 4，超级管理员可以给某个团队单独设）。「账号」指发起运行的人：他在个人空间和团队里的运行合起来算，见 [12.8](#128-队列)。
- 队列在账号之间公平分配：有名额空出来时，给正在执行的运行最少的账号；一样多的，给最久没拿到名额的账号；同一个账号内先提交的先执行。一个账号排了很长的队不会挡住别人；只有一个账号时就是普通的先进先出。
- 运行属于一个空间（`runs.userId`：个人空间时是发起它的账号的 id，团队空间时是团队的 id，见 [12.2](#122-归属字段的决定沿用-userid-做空间标识新增-createdby)），发起人另记在 `runs.createdBy`：解析模型时用这个空间的服务商和 Key（`resolveModel(modelId, { userId })`，重启后续跑时也一样），结果文件写到这个空间的 key 前缀下，计费钩子被告知是谁发起的、在哪个空间。执行器自己只按 id 找运行、对所有账号一视同仁；归属校验在接口层做。
- 运行记录落库在 `runs`；进程启动时把 `queued` 的重新入队，`running` / `archiving` 且有外部任务号的继续轮询（不重新提交），没有外部任务号的以 `run.interrupted` 判失败。
- 未完成的运行（`queued`、`running`、`archiving`）每个账号最多 `userQueueLimit` 个（默认 200，范围 1 到 500），整个实例合计最多 500 个；先查账号的、再查全站的，超出时提交接口返回 429（`run.queue_full`）。
- 每一步都有总时长上限：提交 60 秒（`submitTimeoutSec`），轮询总时长按模型类型（图片 10 分钟 `imageTimeoutMinutes`、视频 30 分钟 `videoTimeoutMinutes`），对话 5 分钟（`chatTimeoutSec`），结果下载 5 分钟（`downloadTimeoutSec`）。这些都是设置项，括号里是键名。超时一律判失败，不允许无限等待。
- 结果文件下载后转存到存储层（当前使用的后端：本地磁盘或 S3 兼容的桶），图片生成缩略图。注入的 `transfer(output, { signal, kind, userId })` 带着运行所属账号的 `userId`，用它生成 key。
- 任何请求都不会向上游发两次。进程收到退出信号时，手上的运行只有在两种情况下放回 `queued`：已经有外部任务号（下次启动继续轮询，不重新提交），或者还什么都没发出去。请求已经发出、还没有外部任务号的运行以 `run.interrupted` 判失败，不会再发一次；同步型服务商（OpenAI 的图片、Gemini）的每一次运行和每一次对话都属于这种情况。
- 运行存储的约定：`recover()` 返回 `{ queued: [{ id, userId, groupId }], interrupted }`。`queued` 是要入队的运行（按创建时间从早到晚），每项带上发起人（`userId`）和所属团队（`groupId`，个人运行为空串），执行器才能照上面的规则分配；`enqueue(id, userId, groupId)` 同理。`interrupted` 是上一个进程留下的、卡在中途又没有外部任务号的运行，由执行器判失败。
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

`ctx = { runId, userId, username, spaceId, teamId, kind, model, providerType, workflowId, nodeId, params, count }`，三个函数拿到的都一样。`spaceId` 是运行所在空间的 id（个人空间时等于 `userId`，团队空间时是团队 id），`teamId` 是团队 id（个人空间为空串）。`userId` 是**发起**这次运行的账号的 id（24 位十六进制字符串），个人空间和团队里都是如此，所以已有的钩子不用改；有账号之前留下、还没有人接手的运行是 `'local'`。`username` 是这个账号当前的用户名（账号已不存在或运行还没有归属时为 `''`）；用户名可以改，自己的记录请以 `userId` 为键。

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
  - 前两种带同样的加固头：`X-Content-Type-Options: nosniff`、沙箱化的 CSP，不是图片、视频、音频的文件带 `Content-Disposition: attachment`。文件的各个头（含一年的缓存）只在桶回答之后才写：404 和 503 不带它们。
  - 哪个后端都没有、而且每个后端都回答了：404。哪里都没找到、而某个可能存着它的后端没问到（连不上、凭据被拒、保存的密钥解不开）：503，`{ result: -1, code: 'storage.unreachable', message, data: null }`，带 `Retry-After: 30` 和 `Cache-Control: no-store`，提示里不出现主机和桶名。缩略图同理：原图可能在问不到的后端里时返回 503，不缓存、不跳转。
- 文件在哪个后端不做记录，靠查（`storage/index.js` 的 `locate`）：先问本地磁盘（一次 stat），再问当前使用的桶（HEAD）；两处都没有，才同时去问其他可读的桶，每个最多等 3 秒（`LOOKUP_MS`）。结果记在进程内存里（key 只写一次、不移动；上限 2 万条）。所以本地磁盘上和当前使用的桶里的文件，不联系别的桶就能找到。没有回应的桶（连接被拒、找不到主机、超时、TLS 失败）记为「连不上」30 秒（`storage/health.js`），这期间完全不去连，到期放一个请求探一下；下线、每个周期、恢复各记一行日志。有回应但拒绝的桶不记，每次都问。S3 的每个请求都有等待回应的上限（`storage/s3.js` 的 `ANSWER_MS`），一个接受了连接却不回应的服务挂不住调用方。存储层自己出的问题统一是 `StorageUnavailable`（HTTP 503）：`storage.unreachable`（读）、`storage.write_failed`（写）、`storage.secret_unreadable`（当前使用的桶密钥解不开）。可读的后端 = 本地磁盘（始终）+ 设置页保存的 S3 配置（存储方式改回本地后仍保留）+ 最多 5 个更早保存过的桶（`previous`）+ `S3_*` 变量描述的桶（三个必填变量都在即可，与 `STORAGE_DRIVER` 无关）；同一个地方（Endpoint、桶、前缀相同）出现两次算一个后端。超级管理员可以用 `DELETE /api/admin/storage/buckets/:id` 把一个不再写入的桶从列表里去掉。
- 删除账号或团队的文件（`services/storageCleanup.js` 的 `removeOwnerFiles`）：各个后端同时删，请求最多等 4 秒；没删完的在后台继续，连不上的每 10 分钟重试，最多 30 天。待办记在 `settings` 集合里键为 `storageCleanup` 的一条里，重启不丢。保留期清理（`services/retention.js`）遇到「后端问不到」的文件不把运行标成 `filesPurged`，下一轮再试，同样最多 30 天。切换存储不移动、不复制文件，这个版本没有迁移工具；旧后端的配置还在，旧文件就照常加载。自己复制对象（保持 key 不变、放在路径前缀下）同样能被找到。
- 存储用哪个，优先级是：设置页保存的配置（`settings` 集合里键为 `storage` 的一条）> 环境变量（`STORAGE_DRIVER`、`S3_*`）> 本地磁盘。保存后立即切换，不用重启；进行中的上传在它开始时的后端上完成。`SECRET_KEY` 变了导致保存的 S3 密钥解不开时，服务端照常启动并记日志，`secretUnreadable` 为 `true`；那个桶仍然留在后端集合里，只是什么都拒绝：它的文件返回 503，如果它正是当前使用的桶，新文件以 `503 storage.secret_unreadable` 被拒绝（`writable: false`；图片和视频的运行在 `createRun` 和发给上游之前各拦一次），**不**改写到本地磁盘或环境变量里的桶。只有环境变量描述的正是同一个桶时，才用环境变量里的密钥顶上。服务商的 Key 解不开时，列表里标 `keyUnreadable: true`，运行以 `provider.key_undecryptable` 被拒绝。
- 结果保留期清理、打包下载、画布工具、`files/fetch`、素材库都经过存储层，对两种驱动都适用。
- 把文件交给上游（`services/media.js` 的 `upstreamUrl`）：桶里的文件依次取 (1) `delivery: 'redirect'` 时的公开地址，(2) 有效期 1 小时的预签名 GET 地址（设了 `presignEndpoint` / `S3_PRESIGN_ENDPOINT` 就按它签，否则按 Endpoint 签），取其中第一个「公网可达」的；都不行时 (3) `PUBLIC_URL + /files/<key>`（`PUBLIC_URL` 已设且是公网地址）。本地磁盘上的文件只有 (3)。「公网可达」只有一条规则（`utils/reachability.js`），`PUBLIC_URL`、公开访问地址、签名所用的 Endpoint 都按它判断，只看地址本身、不解析：必须是 `http(s)`；不是只有一段的主机名（`localhost`、`minio`）；不是回环、内网、链路本地等保留 IP；不以 `.localhost`、`.local`、`.internal`、`.test`、`.home.arpa`、`.lan`、`.home`、`.corp`、`.intranet`、`.private`、`.svc` 结尾。对预签名地址判断的是 Endpoint 而不是签出来的地址（虚拟主机风格下主机是 `<桶名>.<Endpoint 主机>`）。`SSRF_ALLOW_HOSTS` 不参与这个判断。bootstrap 的 `media.upstreamByUrl` 和存储状态里的 `upstream`（`public_base` / `signed` / `app` / `inline`）用的是同一个函数；当前使用的桶密钥解不开、什么都存不了时，`upstream` 是 `unavailable`（`upstreamReason: 'secret_unreadable'`），`media.upstreamByUrl` 仍按这个桶的配置回答，另由 `media.writable: false` 说明现在存不了。
- `PUBLIC_URL` 只在上面第 (3) 步用来拼出绝对地址，可以不填。
- 以上都拿不到公网地址时，参考图以 base64 形式发给上游；必须是地址的输入（如参考视频）以 `media.needs_public_url` 报错。
- 预签名地址只用于那一次上游请求，不进画布、分享和运行记录。上游如果在错误信息里把它带了回来，`X-Amz-*` 查询参数的值在入库和展示之前换成 `***`。
- S3 驱动对各家的处理：`forcePathStyle` 由配置明确给出（MinIO 为 true；AWS、R2、OSS 为 false）；始终设置 `requestChecksumCalculation: 'WHEN_REQUIRED'` 和 `responseChecksumValidation: 'WHEN_REQUIRED'`；没有配置 `acl` 就不发 ACL 头；对象写入时带 `Content-Type` 和 `Cache-Control: public, max-age=31536000, immutable`。`STORAGE_DRIVER=oss` 已移除，启动时报配置错误并提示改用 `s3`。
- S3 的 Endpoint 和公开访问地址由超级管理员填写，不经过 SSRF 防护。服务商的接口地址同样不经过，而它现在由每个账号自己填写：注册了的账号都能让服务端向内网地址发请求，不信任注册者时请关闭注册。画布里用户给出的素材地址的防护不变。

**画布**

- `PUT /api/workflow/:id` 只带 `{ name }` 时只改名；保存 `settings.bg`；返回 `updatedAt`。只带 `viewport`（和 / 或 `legacyLayout`）的保存不更新 `updatedAt`：平移、缩放不算改动。编辑器据此把视口单独、悄悄地存（停手约 1.2 秒后一次），不置「未保存」；内容的自动保存照旧，指纹里不含视口。
- 画布文档在 `schemaVersion` 3。3 把品牌包从「每个节点各选」改成「按画布选」：画布文档多了 `brandKitId`（空串 = 不套用），生成类节点（`image-gen` / `image-edit` / `video-gen` / `video-edit`）只在不跟随画布时带 `data.brandKitOverride`（品牌包 id，或 `'none'` 表示这个节点不套用），原来节点上的 `data.brandKitId` 没有了。迁移（`utils/workflowSchema.js` 的 2→3，纯函数、幂等）：所有生成节点用的是同一个品牌包 → 它成为画布的品牌包，节点跟随；其余情况（都没用，或混用）→ 画布不套用，原来有品牌包的节点各自保留成例外。两种情况下每个节点套用的都还是原来那一个。读取时迁移并落库（不更新 `updatedAt`），另外启动时 `routes/workflow.js` 的 `migrateStoredWorkflows()` 把还没迁的画布全部过一遍，这样「有几张画布在用这个品牌包」之类往文档里面看的查询只需要认一种形状。升级时还开着的旧页面仍会往节点上写 `brandKitId`：`PUT` 先把文档迁到当前版本，再把请求里的这个字段转成节点的例外（`normalizeNodeKits`），不会原样存下去。
- 品牌包是前端套用的：执行器 `useCanvasExecutor.ts` 的 `composeGenRequest` 先按 `resolveNodeKit`（节点有例外听节点的，否则跟画布；查不到就当没有）定下品牌包，再用 `useBrandKits.ts` 的 `composeBrandKit` 把前缀、「不要出现：…」和参考图拼进这次请求。节点编辑处（布局 a 的输入条、b 的属性面板、c 的节点内）的「会加什么」预览（`executor.brandKitEffect`）走的是同一个函数，所以预览和实际发出去的一致。新建画布（`POST /api/workflow`）不带 `brandKitId` 时由服务端填上这个账号的默认品牌包；复制画布保留 `brandKitId` 和节点例外；分享快照两样都不带（`cleanNodes` 去掉 `brandKitOverride`），从快照复制出来的画布 `brandKitId` 为空；模板里的节点不带品牌包，放进哪张画布就跟哪张；把另一张画布加载进当前画布时，两边品牌包不同就把原来「跟随画布」的节点钉成例外。
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
- 发布、列表、修改、撤销、删除只对自己的链接有效，别的空间的链接按 id 访问是 404（`share.not_found`）。每个空间最多 500 个链接。团队里谁看得到、撤得了哪些链接见 api 文档的「团队里的资产、品牌包、模板和分享链接」。
- 快照里不带运行状态、运行号和任务号、失败详情和成本：发布时去掉，公开读取时再去一遍，复制出来的画布里也没有。去掉的节点字段是 `status`、`progress`、`validationError`、`validationStamp`、`errorMsg`、`taskId`、`taskIds`、`runId`、`runPending`、`generatedCount`、`cost`、`estimatedCost`，以及 `results[]` 每一项里的 `cost`、`taskId`、`runId`。模型标识（含服务商实例的标识前缀）和提示词保留。
- `GET /api/canvas-share/mine` 保留已撤销和已过期的链接；`DELETE /api/canvas-share/:id` 第一次撤销，对已撤销的再删一次才从列表移除；撤销后的 token 不复用。

**设置与用量**

- 站点设置和存储只有超级管理员能读写（其他账号 403 `auth.forbidden`）；服务商、模型、用量是每个账号各管各的（见第 5 节）。
- 存储不在 `GET/PUT /api/admin/settings` 里：它有自己的三个接口（第 5 节的 `/api/admin/storage`），存在 `settings` 集合里键为 `storage` 的一条记录中，密钥加密。把 `storage` 当作设置键提交会得到 `settings.unknown_key`。
- `GET/PUT /api/admin/settings` 是扁平对象：`siteName`、`logoUrl`、`showSiteName`（有 Logo 时旁边要不要写站点名称，默认 `true`；bootstrap 里是 `site.showName`）、`defaultLocale`、`registrationOpen`、`concurrency`、`userConcurrency`、`userQueueLimit`、`submitTimeoutSec`、`imageTimeoutMinutes`、`videoTimeoutMinutes`、`chatTimeoutSec`、`downloadTimeoutSec`、`maxRetries`、`retentionDays`、`teamMaxPerUser`、`teamMaxMembers`、`teamConcurrency`、`teamActivityDays`。不认识的键（包括 `constructor`、`__proto__` 这类名字）返回 400（`settings.unknown_key`）。主题是每个账号自己的偏好（`users.prefs.theme`），不是站点设置：早期版本的 `defaultTheme` 已经从头到尾删除：`GET` 不再返回它，`PUT` 带上它和别的不认识的键一样返回 `settings.unknown_key`，早期版本存下来的值不再使用。各项的默认值和范围、在「设置」页的哪个分区，见 [configuration.zh-CN.md](configuration.zh-CN.md#管理设置)。
- 随账号新增的三个键：`registrationOpen`（布尔值，默认 `true`）是否允许自行注册（注册出来的都是普通账号）。环境变量 `REGISTRATION_OPEN` 只给它一个初始值：启动时 `index.js` 调 `settings.seed('registrationOpen', …)`，用 `$setOnInsert` 的 upsert 写入，所以只有这项设置从没保存过时才写得进去；一旦库里有了这一条（由这次播种、设置页或 `PUT /api/admin/site` 写入），存下的值为准，变量不再起作用。写进去的那一次，日志里有一行 `[auth] registration is open|closed (REGISTRATION_OPEN); ...`；`userConcurrency`（1 到 32，默认 4）一个账号同时执行的运行数，`concurrency` 仍是整个实例的总数；`userQueueLimit`（1 到 500，默认 200）一个账号未完成运行的上限，整个实例的总上限仍是 500。
- 结果保留天数（`retentionDays`）是站点设置，对所有账号的运行生效。没有按账号的存储配额。
- 原有的各项上限现在都按空间计（个人空间按账号，团队按团队）：服务商 50 个、每个服务商的自定义模型 100 个、分享链接 500 个、品牌包 50 个、资产每种分类 5000 个、素材分组 500 个、自存的模板和提示词片段各 200 个、画布列表 200 张。
- `GET /api/admin/usage`（调用者自己的用量）→ `{ groupBy, timezone, totals, items: [{ key, label?, runs, succeeded, failed, canceled, amount, currency, unknownCount, costs }] }`，`totals` 与 `items` 的每一项形状相同。可带 `tz`（IANA 时区名，默认 `UTC`），它同时决定按天分组时一天的起止，以及 `from` / `to` 里只写日期时指的是哪一天。网页端（「生成记录」页、清理弹窗、工作台的本月汇总和近 14 天柱状图）总是带上浏览器的时区，所以那里的「今天」是用户本地的今天。
- 服务商的新增和修改：字段直接放在请求体顶层；新增时 `apiKey` 必填；修改时不带密钥表示保持不变，`baseUrl: ''` 表示恢复官方地址。返回的服务商对象带 `customBaseUrl`（地址是否不是官方地址）和 `customModels: [{ model, kind, label }]`，不再把各种选项字段平铺在顶层。
- 自定义模型的规则由后端强制：模型名必填，只能用字母、数字和 `. _ - : / @`，最长 120 个字符；类型必填、没有默认值，而且必须在这家服务商的 `customKinds` 里；不能和清单里的模型重名；同一个实例里不能重复；每个实例最多 100 个。对应的错误码是 `provider.custom_name_required`、`custom_bad_name`、`custom_kind_required`、`custom_kind_unsupported`、`custom_in_catalog`、`custom_exists`、`custom_max`，以及 `custom_not_found`（404）和 `custom_name_fixed`。
- 需要登录的接口上，401 只表示「没登录」（`auth.required`：没带凭证、凭证不存在或已过期、账号被停用），前端收到会清除登录状态、回到登录页。所以别的失败都不用 401：上游的认证失败是 400，修改密码时当前密码不对是 400（`auth.wrong_current_password`）。唯一的例外是 `POST /api/auth/login` 自己的 `auth.invalid_credentials`，前端对登录和注册接口的 401 不做「登录失效」处理。

**安全响应头**

- 每个页面带 `Content-Security-Policy`：`script-src 'self'`，脚本不允许 `'unsafe-inline'` 和 `'unsafe-eval'`。构建出的 `index.html` 里没有内联脚本：首帧之前套用主题的那几行是同源的外链文件 `/theme-boot.js`（`web/public/`），在 `<head>` 里同步加载，`script-src 'self'` 本来就放行，所以策略里没有哈希；`middleware/security.js` 启动时仍会扫描 `index.html`，如果里面出现内联脚本，加进去的是它的 sha256，而不是 `'unsafe-inline'`。`img-src` / `media-src` / `connect-src` 有意对任何 http(s) 来源开放（画布要显示和下载对象存储、CDN、外链里的结果），另外明确列出存储配置里每个 `publicBaseUrl` 的来源，跟着当前的存储配置变，不用重启（现在不改变效果，为的是以后收紧开放来源时它们仍被允许）；另有 `frame-ancestors 'self'`、`object-src 'none'`、`base-uri 'self'`、`form-action 'self'`。
- 接口响应带 `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` 和 `Cache-Control: no-store`。
- 所有响应带 `X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy`、`Cross-Origin-Opener-Policy`、`Permissions-Policy`。
- 应用不设置 HSTS，交给终结 TLS 的反向代理。
- 前端构建打开了 `__INTLIFY_JIT_COMPILATION__`（`web/vite.config.ts`），vue-i18n 不需要 eval。前端构建产物如果不由本服务端提供，那台服务器要自己发送等效的 CSP。
- `TRUST_PROXY` 只接受代理层数（1 到 10）或逗号分隔的 IP / CIDR / `loopback` / `linklocal` / `uniquelocal`；`true` 和主机名在启动时报配置错误。

### 生成节点的三种布局

**主题。** 界面有深色（默认）和浅色两套主题，另有「跟随系统」。

- 取值全部在 `web/src/styles/design-tokens.css`：`:root` 是深色，`:root[data-theme='light']` 把同名令牌逐个换成浅色，组件只引用令牌、不写裸色值。要自己配透明度的地方用通道令牌：`rgb(var(--c-cyan) / .12)`（模糊的外发光用 `--g-*`，浅色里它更淡）。压在用户画面上的件（`--c-scrim`、`--on-scrim*`）两套取值相同。`cd web && npm run theme:check` 核对两套令牌的名字、算对比度，并列出令牌文件之外残留的裸色值。
- `<html>` 上的 `data-theme`（以及 TDesign 认的 `theme-mode`、`<meta name="color-scheme">`、`<meta name="theme-color">`）由 `web/public/theme-boot.js` 在首帧之前写好，之后由 `composables/useTheme.ts` 维护；「跟随系统」先解析成 dark / light 再写，并监听 `prefers-color-scheme`。切换不刷新页面，用 View Transitions 做一次约 0.2 秒的交叉淡入（不支持的浏览器退回颜色属性的过渡；系统开了「减少动态效果」就直接换）。
- 选择存两份：账号上的 `users.prefs.theme`（`PUT /api/auth/prefs`）是准的；浏览器 `localStorage` 的 `loomcanvas-theme` 是它的镜像，落地页 / 登录页 / 分享页和每次打开时的首帧用它。登录或取回启动信息时以账号上的为准对齐本机；没登录时在本机选过、还没存到任何账号上的主题（以及新注册的账号）反过来，以本机的为准存到账号上。登录那一下两边不一样时，账号上的主题先拿在手里，路由换到外壳的那一帧才上色（`stores/app.ts` 的 `applyHeldTheme`）：登录页不会先整页变一次色，外壳第一帧就是账号的主题。入口在顶栏和公开页页头的图标钮（落地页、登录 / 注册、分享页、加入页，以及 404 和「连接不上服务端」这两屏用的 `components/auth/BarePage.vue`），以及「设置 → 外观」的三张预览卡。
- SVG 属性和 vue-flow 的 Background / MiniMap 不认 `var()`：前者改用类名取色，后者用 `utils/tokenColor.ts` 读令牌的计算值，主题一换自己重读。
- 画布底色（`settings.bg`）：`auto` 跟看的人的主题走；自选的颜色原样保留，直接画在底上的东西（图案、小地图、连线、组的虚线框、框选矩形）按这个底色的明暗取色而不是按主题 —— 明暗和主题相反时画布容器带 `data-ground`，把「画布底」那一组令牌换成对应的取值。分享页用的是看的人自己的主题。

图片生成 / 图片编辑 / 视频生成 / 视频编辑 / 大语言模型 / 视频分析这六种节点有三种布局，选哪种是账号的偏好（`users.prefs.nodeLayout`，`PUT /api/auth/prefs`；入口在「设置 → 外观」和画布的「更多 ⋯」菜单），默认 a：

| 布局 | 节点 | 在哪里编辑 |
| --- | --- | --- |
| a 结果优先 | 表头 + 通栏的结果 + 一行摘要（272 宽） | 选中一个节点后，节点下方的输入条 `GenComposer` |
| b 紧凑 | 表头 + 缩略图 + 一行摘要 + 小运行钮（240 宽） | 选中一个节点后，画布右缘的属性面板 `GenInspector` |
| c 一体化 | 结果、提示词框、模型 / 参数 / 成本 / 运行都在节点上（328 宽） | 节点本身 |

实现上是「一份状态 + 三套外壳」，不是三份节点：

- `web/src/composables/useGenNode.ts`：一个生成节点的全部状态和动作（模型、参数、提示词、上游文本、输入图与 @、端口、结果与历史版本、成本、状态、运行前提示、运行 / 取消），与布局无关。发出去什么仍然只由执行器决定（`collectInputs` / `composeGenRequest`），所以同一份节点数据在三种布局下发出的请求一样。
- `web/src/components/canvas/gen/`：`GenNode.vue` 是六种节点共用的那个组件，按布局挑 `GenShellA/B/C.vue` 来画；提示词、输入图、模型、参数、成本、运行、说明、历史版本各是一个字段组件（`GenPromptField`、`GenRefs`、`GenModelField`、`GenParamsField`、`GenCost`、`GenRunButton`、`GenNotes`、`GenVersions`），输入条、属性面板和布局 c 的节点内表单用的是同一批。样式全在 `gen.css`。
- 输入条和属性面板整张画布各只有一个实例（挂在 `Canvas.vue` 上，按节点 id 加 key）。它们自己另起一份 `useGenNode`：开着 `only-render-visible-elements`，被选中的节点可能没渲染。只选中一个生成节点时出现；多选、没选都不出。输入条跟着节点走（平移 / 缩放 / 拖动），大小是固定的屏幕像素、不跟画布缩放；属性面板开着时「适应屏幕」、新节点落点和生成队列圆钮都把它的宽度让出来。手机宽度下两者都是贴底的抽屉。按 Esc 收起后节点仍然选中（`panelDismissedId`），再打字就唤回来，这一键不丢。
- 悬浮件摆在哪由 `web/src/utils/floatSpot.ts` 统一算（`placeNear` / `nearestFree` / `watchRects`）：输入条默认在节点下方，放不下或会压着工具面板、生成队列圆钮、小地图、标题块、底部工具条时，先沿节点的边滑开，再换到上方、右边、左边；可以压在别的节点上（换成更实的一层），但不盖自己节点的端口。四边都放不下时把画布平移一小段（`makeRoom`，不进撤销）；编辑区比「节点 + 输入条」还小时改成贴底的抽屉。布局 b 的属性面板在不宽的窗口（1000–1100）里会盖住选中的节点：`Canvas.vue` 的 `revealNode` 把画布横向平移到刚好看得见，这期间小地图收起（`miniCramped`）。
- 多选工具条 `components/canvas/SelectionToolbar.vue`：选中两个及以上节点时出现，三种布局一样，用同一套 `placeNear` 贴着选区（默认在上方）。它只摆位置和管键盘，动作由 `Canvas.vue` 做：对齐 / 等距分布（`useAutoLayout`）、编组 / 合并 / 解散 / 移出各记一笔历史；「运行所选」（`runSelected`）按选中节点之间的先后关系依次发起，「要不要重跑」整批只问一次。
- 工具面板的位置和方向由 `composables/usePaletteDock.ts` 管（只记在浏览器里）；编辑区太矮时 `fitPalette` 先换小一号，再按固定次序把按钮收进「更多工具」（纯函数，`web/test/palette-fit.test.ts`）。生成队列圆钮和清单是 `components/canvas/QueuePanel.vue`：位置同样只记在浏览器里，复位在清单表头，不认双击。悬停提示统一走 `directives/tip.ts` 的 `v-tip`（不用浏览器的 `title`），触屏长按也出。
- 选中一个生成节点后直接打字：`Canvas.vue` 把焦点放在一个看不见的输入框上候着（在 closed shadow root 里，不影响画布快捷键），输入法因此从第一个键起就能组字；组字期间输入条 / 属性面板在捕获阶段拦掉回车、Esc、方向键，不会误触发运行或收起。
- 换布局只改节点的大小，不改位置：位置是跟着画布存的。画布在 `settings.nodeLayout` 里记着「节点是在哪种布局下排的」；换布局后、或打开一张在别的布局下排的画布时，只有真的有节点互相压住才出一条提示，点「自动整理」才动（可撤销）。没渲染过的节点按 `nodeLayout.ts` 的 `GEN_NODE_SIZE` 估大小，内置模板的间距（`server/src/services/seed.js`）和它的测试用的是同一组数。
- 分享页不 provide 画布上下文，`GenNode` 据此走只读：一律布局 a，不写数据、不发请求。

## 11. 账号与数据归属

**哪些集合带归属**

- 按空间的集合，每条记录带 `userId`：个人空间里是账号 id 的字符串，团队空间里是团队 id（字段名是有团队之前留下的，为什么不改见 [12.2](#122-归属字段的决定沿用-userid-做空间标识新增-createdby)），另有 `createdBy` 记创建人：`workflows`、`shares`、`userassets`、`brandkits`、`providers`、`modeloverrides`、`runs`，以及 `templates`、`texttemplates` 里不是内置的那些。
- 新增两个集合：`users`（账号：用户名、邮箱及各自的小写形式、密码哈希、`role`、`disabled`、`lastLoginAt`、`mustChangePassword`、`legacyAdoption`）和 `sessions`（会话：凭证的 SHA-256、`userId`、`expiresAt`、`lastSeenAt`、`userAgent`、`ip`）。
- 属于站点的：`settings`、`canvasassets`，以及内置模板和内置文本模板（`userId` 为 `system`）。
- 按账号唯一的索引：`providers` 的 `{ userId, slug }`、`modeloverrides` 的 `{ userId, modelId }`、`templates` 的 `{ userId, key }`。
- `services/accounts.js` 里的 `OWNED` 是按空间集合的唯一清单（`userId` 存的是空间 id，见 12.2），「接手旧数据」「删除账号」和「永久删除团队」都照它逐个处理。新增一个按空间的集合，必须加进 `OWNED`，并且它的每个查询都要带 `userId: req.spaceId`。

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
- 没有的东西：邮箱验证、两步验证、单点登录、站点级的审计日志、存储配额、团队之外的花费上限（用计费钩子做，它知道是哪个账号、哪个空间）。团队、团队内的花费上限和团队动态见第 12 节。

## 12. 空间与团队

接口的逐项说明在 [api.zh-CN.md 的「空间与团队」](api.zh-CN.md#空间与团队)（英文版 [api.md](api.md#spaces-and-teams)）。这一节记的是为什么这样做、代码里各部分在哪、哪些规则不能破。

### 12.1 模型

- **空间**有两种：每个账号一个**个人空间**，和**团队**。团队空间里的画布、分享链接、资产、品牌包、服务商和 Key、模型覆盖项和价格、运行记录、自存模板和提示词片段属于团队。账号、会话、界面偏好属于人；内置模板、只读素材库、存储和站点设置属于站点。
- **角色**三个：团长（`owner`）、管理员（`admin`）、成员（`member`）。谁是团长只由 `teams.ownerId` 决定，成员记录里的 `role` 只区分管理员和成员，所以转让团长是一次带条件的原子更新（`{ _id, ownerId: 原团长 } → ownerId: 新团长`），不存在「两个团长」或「没有团长」的中间状态。
- 新集合：`teams`（名称、头像、`ownerId`、`status`、`dissolvedAt` / `purgeAt`、`timezone`、`settings`、`limits`、可空的 `maxMembers` / `concurrency`、`createdBy`）、`teammembers`（`{ teamId, userId }` 唯一，`role`、`displayName`、可空的 `limits`）、`teamformermembers`（离开的人留下的名字，见 12.9）、`teaminvitations`（`tokenHash` 唯一、`tokenEnc`、`maxUses`、`usedCount`、`expiresAt`、`revoked`）、`teamactivities`（团队动态）、`teamrequests`（创建团队的授权申请，每个账号至多一条 `pending`，靠部分唯一索引保证）、`budgetcounters`（每个团队每个月一份计数，见 12.7）、`userassetfolders`（素材分组，`{ userId, name }` 唯一；分组空了也留着，个人空间同样适用）。
- 新字段：`users.canCreateTeams`；九个按空间的集合各加 `createdBy`；`workflows` 另加 `visibility`、`revision`、`metaRevision`、`lastEditedBy` / `lastEditedAt`、`lock { by, session, at, expiresAt, prev* }`、`deletedAt` / `deletedBy`、`inheritedFrom`；`runs` 另加 `teamId` 和 `budget`（见 12.7）；`providers` 另加 `keySetBy`、`updatedBy`（维护人）、`lastTest`（最近一次测试连接的结果）。

### 12.2 归属字段的决定：沿用 `userId` 做空间标识，新增 `createdBy`

九个按空间的集合（`services/accounts.js` 的 `OWNED`）继续用现有的 `userId` 字段表示「属于哪个空间」：个人空间里它是账号 id，团队空间里它是团队 id。另加 `createdBy` 记「谁创建的」；老数据没有它，读取时回落到 `userId`（`permissions.creatorOf()`）。

没有选「新增 `spaceId` 字段并回填」，原因按分量排：

1. **老数据一条都不用动。** 每个账号现有的数据天然就是它的个人空间，升级不需要迁移脚本，也就没有迁移做到一半的状态。`createdBy`、`revision`、`visibility`、`lock` 都是缺省即正确的字段。
2. **退回旧版本是安全的。** 旧版本只认 `userId` = 账号 id。团队的数据写的是团队 id，没有任何账号的 id 与之相等，所以旧版本看不到它们，也不会把它们错给任何人；再升级回来，数据都在。换成 `spaceId` 方案，新版本写的团队数据要么也得带一个 `userId`（带谁的？带创建者的就会在回滚时泄漏给创建者个人），要么让旧版本的必填校验失败。
3. **现有的唯一索引和查询索引原样适用**：`{ userId, slug }`、`{ userId, modelId }`、`{ userId, key }` 在团队里正好是「团队内唯一」。
4. **存储 key 前缀不用改**：`uploads/<id>/…` 里的 id 换成团队 id，`deleteUserFiles(id)` 原样就是「删除这个团队的全部文件」。
5. **删除账号不会碰团队的数据**：`deleteAccount` 按 `userId = 账号 id` 删，团队的记录不在其中。

代价是字段名和含义不再一致。约束它的办法：

- 路由里只用 `req.spaceId` 做查询条件、`req.userId` 表示操作人，两者由 `services/spaces.js` 的中间件一次设好；`userId` 这个名字只出现在查询对象的键上。
- 团队 id 和账号 id 永不相同：创建团队时生成的 id 先查 `users` 里没有（`teams.newTeamId()`），注册账号时生成的 id 先查 `teams` 里没有（`accounts.newAccountId()`）。
- `runs.teamId` 冗余存一份（团队运行时等于 `userId`，个人运行为空串），这样队列的团队并发上限和每月上限不需要去猜一个 id 是账号还是团队。

**升级时实际发生的事**：建新集合和它们的索引；`runs` 多两个索引（`createdBy`，以及只含团队运行的 `{ teamId, createdAt }` 部分索引）。不改任何已有文档。第二次启动什么都不做。

### 12.3 请求作用于哪个空间

- 约定见 api 文档：`X-Space: <团队 id>` 或 `personal`，不带就是个人空间；`/api/teams/:id/...` 由路径决定。选请求头而不是把团队 id 放进所有路径，是因为这样**现有的每个接口、每个客户端、单独嵌入编辑器时的适配器都不用改**，不带头的请求含义和以前完全一样。
- `services/spaces.js`：`resolve(userId, raw)` 每个请求现查 `teams` 和 `teammembers` 各一次，得到 `req.space = { id, kind, role, team, member, userId }`。不是成员 → 404 `team.not_found`，和团队不存在时一样；是成员但团队已关闭 → 403。**不缓存**：移除成员的效果必须在他的下一个请求上就出现，代价是团队请求多两次按主键和唯一索引的查询。
- `app.js` 的挂载顺序：公开接口 → `requireAuth` → `/api/teams`（路径寻址，自己查成员身份）→ `resolveSpace` → 其余所有接口。超级管理员的站点接口路径在 `resolveSpace` 里遇到失效的头时回落到个人空间，不报错。
- **写新接口时**：查询条件一律 `userId: req.spaceId`；新建的文档写 `userId: req.spaceId, createdBy: req.userId`；团队里不是所有人都能做的操作用 `spaces.requireCan(action)` 或 `spaces.assertCan(req, action, ctx)`；按 id 取到别的空间的东西必须是 404（查询条件里带着空间 id 就自然如此）。`test/teams.e2e.test.js` 的 `byId()` 列表要加上新接口。

### 12.4 权限只有一张表

`services/permissions.js` 的 `MATRIX` 是唯一的权限表：每个操作一行，三个角色各一格（可以 / 不可以 / 有条件），有条件的格子在 `when` 里写成函数。路由里所有角色判断都经它（`can`、`canvasAccess`、`visibleCanvasFilter`）；`docs/api.md` 里的矩阵是 `toMarkdown()` 的输出；`test/teams.matrix.e2e.test.js` 对表里每一行、每个角色走真实 HTTP 入口验证，并检查两份文档里的表和代码里的是同一张。改权限只改这一张表，测试会指出文档和探针要跟着改的地方。

个人空间里只有一个人，不查表：`can()` 对非团队空间恒为真。

和设计稿相比的两处收紧，都写进了表：

- **团队设置和时区只有团长能改**（设计稿写的是团长和管理员）。`adminsSeeAll` 如果管理员能改，管理员就能给自己打开全队记录；时区决定每月上限从哪天算起。管理员仍然可以改名称和头像。
- **接管编辑要求能编辑这张画布**（设计稿对管理员写的是无条件）。管理员本来就不能改别人「团队可看」的画布，接管它没有意义；要改，先把可见范围改成「团队可改」，那是管理员可以做的。

### 12.5 Key 的边界

- 团队空间里解析模型只查团队的服务商（`resolveModel(id, { userId: 团队 id })`），所以「在哪个空间，用哪个空间的 Key」不需要额外判断：成员个人的服务商在团队里根本查不到，反之亦然。
- 成员拿到的服务商对象是受限的（`serializeProvider(doc, { restricted: true })`）：没有 `keyTail`、没有 `baseUrl`。测试把成员能读到的全部接口的返回拼在一起，搜 Key 明文、密文、末四位、地址和主机名，一处都不能有。
- **已保存的 Key 只发往保存时的地址**，对个人空间同样生效：`PUT /api/admin/providers/:id` 在已有 Key 时改变实际使用的地址，必须同时带上 Key 或 `clearKey`，否则 400 `provider.key_required_for_url`。比较的是「实际使用的地址」（存的地址，为空时是服务商的官方地址），所以把自定义地址改回官方地址也算改地址。服务商类型创建后不能改；`providers/http.js` 不跟随重定向（`maxRedirects: 0`）；测试连接不读请求体。存储设置同理：已保存的 Secret Access Key 只在 `endpoint` 和 `accessKeyId` 都没变时才沿用（`storageSettings.knownSecret()`）。
- 邀请码只存 SHA-256（用来查找）和用 `SECRET_KEY` 加密的密文（让管理者能再次复制链接）。

### 12.6 编辑锁与保存冲突

- 锁存在画布文档上：`lock.by`（账号）、`lock.session`（编辑会话）、`at`、`expiresAt`，以及 `prevBy` / `prevSession` / `prevHow`（这把锁是从谁手里、以什么方式拿来的）。拿锁、续期、接管、保存时的续期都是带条件的 `findOneAndUpdate`，两个会话同时抢只有一个成功。
- **锁按编辑会话，不按账号。** 会话就是一个标签页，由客户端生成的随机 `sessionId` 指明，放在请求体里（`GET`、`DELETE` 放查询参数）；选请求体而不是请求头，是为了跨域部署不用多放行一个头（`middleware/security.js` 的允许列表不用动）。同一个人的第二个标签页和别人一样收到 423（`data.lock.sameUser: true`），一样可以接管。会话 id 不出现在任何返回里。不带 `sessionId` 的老客户端，每个账号算一个隐含会话（空串）。
- **数字：有效期 36 秒，心跳 12 秒**（`constants.js` 的 `EDIT_LOCK`，随每次锁接口的返回下发为 `ttlMs`、`heartbeatMs`，客户端不写死）。一个有效期容得下三次心跳：连丢两次续期不丢锁；崩溃或断网的标签页最多让别人等 36 秒。原来的 60 / 20 秒让人在别人已经关掉页面之后还要白等最多一分钟。
- **可靠释放。** 页面关闭时 `fetch` 不保证发得出去，`sendBeacon` 又带不了 `Authorization` 头。所以多了一个公开接口 `POST /api/workflow/:id/lock/release { releaseToken }`（在 `app.js` 里挂在登录检查之前，只有这一条路由）。`releaseToken` 是 `HMAC-SHA256(SECRET_KEY, 画布 id + 持有人 + 会话 + 拿锁时刻)`：不用另存，只发给持有人，只能释放这一把锁，锁换手之后自然失效；比较用 `timingSafeEqual`，对不上一律返回 `released: false`。没有选「让 `fetch(keepalive)` 带登录头」作为唯一手段，是因为它在页面卸载时仍可能被浏览器丢弃，而信标是浏览器保证尽力送达的那一种。
- **后台标签页。** 浏览器会放慢隐藏页的定时器：一隐藏就是每秒最多一次（对 12 秒的心跳没影响），Chrome 在隐藏满五分钟后降到每分钟一次。一分钟比 36 秒的有效期长，所以隐藏超过五分钟的标签页会在两次心跳之间丢锁。这是有意的：不为没人看的标签页延长有效期。它下一次心跳（迟到的那次，或者客户端在 `visibilitychange` 变回可见时立刻补的那次）：没人拿过，条件更新把同一把锁续上（`at` 和释放令牌都不变），返回 `state: "reacquired"`；有人拿了，返回 423，`data.lost: "expired"`。被接管则是 `lost: "taken_over"`。这两个值来自新持有人写锁时记下的 `prev*` 字段，所以服务端不用另外记「谁丢过锁」。锁过期的会话直接保存内容走的是同一条路（`lockForSave`）：没人拿走就把原来那把锁接着用。客户端在变为隐藏时先把没保存的存掉，所以丢锁不丢内容。
- **关页面时还在路上的保存。** 编辑器在同一瞬间做两件事：把没保存的存掉（`PUT`），发释放信标。小小的信标常常先到；之后到的那次保存如果照常「保存顺带拿锁」，一个已经不存在的标签页就会把画布再占 36 秒。所以归还时把锁写成「空的，并记下是谁在什么时候还的」（`prevHow: "released"`，见 `releasedLock`）；这个会话 30 秒内再来保存内容，写入但不拿锁。保存的写入条件按「看到的锁」来定，写不进去就按最新的锁再定一次（先到的是保存、信标紧跟着把锁清掉，也是这条路）。`locks.e2e.test.js` 里有一组两者真并发的用例。
- **只看不拿。** `GET /:id/lock`（只读的编辑器每 `WAIT_POLL_MS` = 5 秒问一次：空出来没有、改名没有、对方保存没有；只查几个字段，不读节点）和 `GET /locks`（画布列表和工作台每 `LIST_POLL_MS` = 10 秒问一次：这个空间里调用者看得到的画布上有效的锁，按可见范围过滤；带上 `?since=<上一次回答的 now>` 时还给出这段时间里变了的画布 `changed`（别人改的名字、新建、保存、恢复）、不在了的 `removed` 和一组张数 `counts`，变得太多时是 `reload`，客户端才整个重取）。两者都不续锁。没有推送通道：等的人最长等待 = 持有人关页面后 5 秒，标签页死掉后 36 + 5 秒。
- **公开的释放接口不能被拿来消耗数据库**：令牌 256 位猜不出来，不需要为「防猜」限速；但每个地址每分钟超过 120 次的调用直接回 `released: false`、不查库（进程内计数，`RELEASE_LIMIT`），请求体上限 2 kB。
- **内容和元信息分开。** 内容是 `nodes`、`edges`、`settings`、`brandKitId`；元信息是 `name`、`viewport`、`legacyLayout`。只带元信息的保存（`PUT`，或专用的 `PATCH /:id/meta`）只要求能编辑这张画布：不查锁、不拿锁、不看 `baseRevision`、不动 `revision`。改名让 `metaRevision` 加 1，它随每次锁接口和保存的返回下发，持锁的编辑器据此跟上新名字。改名以前算内容，于是「别人开着画布时在列表里改名」会被锁挡住，或者让编辑者的下一次保存冲突；现在两样都不会。
- 保存内容用 `revision` 做乐观并发控制：`PUT` 的条件里带 `revision: baseRevision`，更新里带 `$inc: { revision: 1 }`。条件不满足就什么都不写，返回 409 和当前版本的信息。团队空间里保存内容必须带 `baseRevision`；个人空间里可选，不带就是原来的后写覆盖。个人空间没有锁，两个标签页仍然靠这个检查分开。
- 团队里保存内容的条件还带着「锁还是我看到的那样」（是这个会话的；或者是空的 / 已过期），所以「检查锁」和「写入」之间被人接管也不会写进去。
- **客户端这一侧**（`web/src/composables/useCanvasCollab.ts`，界面在 `Canvas.vue` / `CollabBar.vue`）：会话 id 由 HTTP 适配器每个实例生成一个、只放内存（`embed/httpAdapterCore.ts`），释放令牌也只留在适配器里；载入时已经看到别的会话持锁就直接只读，不去调锁接口；改名是标题框失焦时单独的一次 `PATCH …/meta`，内容保存不带名字；只读时工具面板换成只读的一套（素材库只能浏览下载、分享只能看、「更多」里没有会改画布的项）。节点层不设 `inert`：「只读」是画布上下文里一个活的开关（`composables/nodeLayout.ts` 的 `CanvasNodeUi.readOnly`，节点用 `useCanvasReadOnly()` 读；丢了锁的那一刻变 true，接管之后变回 false），每种节点自己把「做事」的入口收起来（改字段、运行、删除、上传、调序、换品牌包），「看」的照常：看大图、播放视频、选中和复制文字、展开长文、切换查看历史版本（只读期间切到哪儿记在 `peek` 里，不写进文档）、下载。变成只读的那一刻，正在打字的框退出焦点，只为「改」开着的层收掉。画布列表和工作台用 `components/canvaslist/useCanvasLocks.ts` 就地刷新：谁正在编辑、别人改的名字、新建 / 保存 / 删掉 / 恢复的画布，没变的卡片不重绘。
- 锁只是为了让人知道谁在改、少撞车；**真正防止覆盖的是版本检查**，它不依赖锁。不做任何自动合并，也没有任何实时通道。

### 12.7 每月上限

规则全文在 `services/budget.js` 文件头和 api 文档。实现上要记住的：

- **「已用」只有一个定义：已成功 + 进行中**（排队、运行、转存）。失败和取消的不计。上限接口、成员列表、用量接口、拒绝返回里的数字都出自 `budget.js` 的同一个聚合（`tally()`），并且带着明细（成功 / 进行中 / 失败 / 取消，次数和金额，成本未知的条数）。金额内部一律用百万分之一的整数（micro）累加，避免浮点误差。
- **接受一条运行是一次原子更新。** 每个团队每个月一份计数文档（`BudgetCounter`：团队合计 + 每个成员的次数和金额）。`budget.reserve()` 用一次带条件的 `findOneAndUpdate` 同时检查团队和成员的四个上限并加计数，条件不满足就不改；MongoDB 对单文档更新是原子的，所以不管多少请求同时到、多少个进程连着同一个库，放得下几条就恰好接受几条。原来的进程内锁（`withLock`）只能管住一个进程。测试里起了**两个进程**（测试进程，加上 `test/support/secondInstance.js` 另起的一个，各有自己的执行器）对着同一个库并发提交，四种上限都恰好卡在额度上。
- **预留与结算。** 运行记录带着 `budget: { state, month, micro, currency, countable }`。提交时 `reserved`；进入终态时在 `runner/mongoStore.js`（所有状态变更的必经之处）调 `budget.finish()`：成功则把预留换成记录上的真实成本（`settled`），失败或取消则把名额和金额退回（`released`）。`budget.state` 从 `reserved` 的条件更新保证每条运行只结算一次。
- **按 token 计价的对话模型**跑完才知道成本，所以提交时预留一笔：按发出的内容估输入（每字符 1 token、每图 1500、每视频 20000），加上假定的最长回答（模型声明的 `maxOutputTokens`，没有就按 `BUDGET.CHAT_RESERVE_OUTPUT_TOKENS` = 8192，可用环境变量 `BUDGET_CHAT_RESERVE_OUTPUT_TOKENS` 改）。跑完按上游报的用量结算，多退少补。金额上限因此不会被在跑的对话运行悄悄超出。完全没有价格的模型和以前一样：成本未知，只计次数。
- **计数文档是运行记录的缓存，可以随时从记录重算**（`budget.reconcile()`）。什么时候重算：文档不存在（新的月份、升级前就有的团队）、团队改了上限的货币、读数时发现它和记录对不上（`snapshot()` 每次都比）、进程启动时（`reconcileAll()`）。漂移的来源只有一个：进程死在「运行已到终态」和「名额已退回」之间。重算分三步：先把终态超过 60 秒（`BUDGET.STUCK_MS`）却还占着预留的运行结算掉；再按记录聚合，并把最近 60 秒内（`BUDGET.PENDING_MS`）已加计数、记录还没写进去的预留（`pending`）算上；最后只在计数文档自读取以来没被改过（`seq`）时写回，并把 `epoch` 加 1。结算在翻转运行状态之前先读 `epoch`，更新时带上它：重算如果插在中间，这次扣减就不生效，转而再重算一次。每一步都只会多算、不会少算：重算可能让一条本来放得下的运行被短暂拒绝，但不会放进一条放不下的。
- 月份边界用团队的时区（`teams.timezone`），用 `startOfDayIn()` 按日历算，不是减一个固定的偏移。运行记录上记着它算在哪个月（`budget.month`），所以改时区只影响之后提交的运行。
- 本月的记录不能删（`usage.current_month`）：它们就是额度的账本。
- 拒绝的返回带结构化的 `data`（是谁的上限、哪个单位、上限和已用、这次要占多少及它是什么（`requestedKind`）、重置时刻、谁能改），六个错误码的形状见 api 文档。
- **拒绝之前先核对计数。** `reserve()` 的条件更新没成功时，先拿计数文档和运行记录比一次（`verified()`，每个团队每个进程 `BUDGET.VERIFY_MS` = 30 秒内最多一次；这个节流只是省事，不是正确性的一部分），重算过就再试一次。否则一个死在半路的进程留下的偏高计数，要等到有人去看上限页面才会被纠正，期间的拒绝都是冤枉的。
- **「这个模型我跑不了」由服务端回答。** 上限接口对每个成员都返回 `cannotRun`（按 `reserve()` 拒绝时用的同一条规则算出：调用者受不受金额上限约束、`blockUnpriced` 开没开、哪些已启用的模型成本算不进去）和 `managers`（团长和管理员的名字）。前端的模型下拉、运行前的提醒、模型管理页都只读这个结果，不看价格自己推（`web/src/utils/budget.ts` 的 `preflight()` / `modelBlock()`）。团长和管理员另有 `uncountable` / `unpriced`：同一件事在全队范围内的说法。
- **不是人点的取消带着原因。** 成员被移出、账号被停用、团队被关闭时取消排队中的运行，走 `teams.cancelQueued(filter, why)` → `runner.cancelIfQueued(id, message)`，记录上的 `errorCode` 是 `run.canceled_member_removed` / `run.canceled_account_disabled` / `run.canceled_team_closed`（人点的取消是 `run.canceled`），哪里读这条运行都按读的人的语言给出这句话。只碰数据库里仍是 `queued` 的记录，所以另一个进程里正在跑的运行不会被误取消。
- **前端只有一种说法。** 所有显示上限的地方（团队首页、团队 → 用量、成员名单、成员上限对话框、编辑器里的小计数和队列清单）都用 `components/space/` 下的 `LimitBar` / `LimitSide` / `MemberLimitCell`，状态取 `effective`，不从 `used / limit` 再算；被拒绝的说明统一由 `BudgetNotice` 按 `data` 现写（中英文），节点上只在本次会话里保留（`refusal` 不随画布保存：它说的是「这个人此刻」的事）。
- 执行器仍然是进程内队列（见 12.8），多进程部署整体上不在支持范围内；但上限这一项不再依赖「只有一个进程」。

### 12.8 队列

- 公平键从「运行所属的账号」改成「发起人」（`createdBy`，老运行回落到 `userId`）：一个人在个人空间和团队里的运行合起来算一个人，受同一个 `userConcurrency`、`userQueueLimit`。
- 新增按团队的并发上限：`Runner` 多一个注入项 `groupLimit(groupId)`，队列项带 `groupId`（团队 id，个人运行为空）。`_pick()` 跳过所属团队已满的运行，名额给下一个人。上限的值是 `teams.concurrency`（超级管理员单独设的），没有就是站点设置 `teamConcurrency`；`teams.concurrencyOf()` 是同步的（内存里一张表，启动时载入，修改时更新），因为每次挑选都要问。
- `recover()` 返回的队列项是 `{ id, userId: 发起人, groupId: 团队 }`。

### 12.9 成员离开、团队关闭时在途的东西

| 事件 | 成员身份 | 排队中的运行 | 已开始的运行 | 编辑锁 | 其他 |
| --- | --- | --- | --- | --- | --- |
| 成员退出、被移除、账号被删除 | 立即删除，下一个请求起 404 | 他发起的：取消 | 跑完，结果归团队 | 他持有的：释放 | 「仅自己」的画布转给团长；他创建的邀请链接作废 |
| 账号被停用 | 保留（成员列表里 `disabled: true`） | 他发起的：取消（个人空间和各团队里的，`teams.cancelQueued()`，和移除成员用的是同一个函数） | 跑完 | 他持有的：立即释放（`routes/adminUsers.js`），别人不用等锁过期 | 会话全部结束；占着的每月上限名额随取消退回 |
| 团队被解散或停用 | 保留，但所有人 403 | 团队的全部：取消 | 跑完 | 全部释放 | 分享链接、邀请链接不可用 |
| 团队被永久删除 | 删除 | - | 全部取消 | - | `OWNED` 里 `userId = 团队 id` 的全部文档、团队前缀下的全部文件、成员、邀请、动态，最后才是团队本身 |

- 「已开始的运行跑完」的理由：请求已经发到上游，上游已经在计费，取消只会丢掉结果。
- `resolveRun()` 在把一个还没发到上游的团队运行发出去之前，再查一次团队是否开放、发起人是否还在团队里（`run.team_closed`、`run.member_removed`）：挡住「提交」和「移除 / 关闭」落在同一瞬间的那一条。发起人的账号是否已被停用也在这里再查一次（`run.account_disabled`，个人空间的运行同样查）。
- 永久删除按「先数据、后团队文档」的顺序做，中途停掉，下一次清理（每小时一次，`teams.sweep()`）看到的仍是一个到期的已解散团队，接着删完。
- 账号还是某个团队的团长时不能删除（`team.account_owns_teams`）。没有选「自动把团队转给别人」或「连团队一起删」：前者替人做了一个不该替的决定，后者一次误操作毁掉几十个人的东西。
- **人走了，名字留下。** 成员行（`TeamMember`）就是访问权，人一走立刻删除；同时在 `TeamFormerMember` 里记一行：他离开时的用户名、团队里的显示名、原来的角色、怎么走的（`left` / `removed` / `deleted`）。这一行不给任何人任何权限，只被 `spaces.people()` 读：所有接口里的 Person 都从这一个函数出来，所以「已离开团队」（`state: "left"`，账号还在）和「账号已删除」（`state: "deleted"`）在画布、资产、生成记录、模板、分享链接、服务商、团队动态里是同一个答案，名字也还在。同一个账号再次离开时覆盖这一行，团队被永久删除时一起删掉。

### 12.10 团队动态

`services/activity.js` 的 `TYPES` 是事件的完整清单：每种事件的类别、对应的提示语键、允许带的 `detail` 字段。`record()` 只留下清单里列出的字段，且只留小的原始值，所以 Key、地址、提示词不可能因为疏忽进到动态里。写动态失败不影响它所描述的操作（在控制台报错，请求继续）。清理按 `teamActivityDays` 由 `teams.sweep()` 做，没有删除接口。

`detail` 是给客户端自己造句用的结构化数据（上限、角色、名称、设置、价格的「之前 → 之后」），每种类型的字段在 `docs/api.md` 的表里，是约定：只加字段，不改名、不改含义，所以旧动态缺字段是正常的，读的一方必须把每个字段都当成可选。`detail` 最多嵌套两层（`before.team.runs`）。价格只记摘要（单位、货币、单价或价格表的档数和最低最高价），不记整张价格表。动态里的人在**读**的时候解析（`serialize()` 接收 `spaces.people()` 的结果）：显示的是他今天在团队里的显示名和状态，写入时存的名字只在查不到这个人时兜底；这样写动态的各处不用关心显示名，改了显示名之后旧动态也跟着变。

### 12.11 超级管理员与团队

超级管理员对团队能做的全部：看名称、团长、人数、画布数、运行数、状态（`GET /api/admin/teams`）；改某个团队的人数上限和并发上限；停用和恢复；恢复已解散的；永久删除已关闭的；在团长账号不可用时指定新团长（为此能看到成员的用户名和角色）；授权谁能创建团队、处理申请；设 `teamMaxPerUser`、`teamMaxMembers`、`teamConcurrency`、`teamActivityDays`。不能做的：以超级管理员的身份进入任何团队的空间。他带着别的团队的 `X-Space` 调用，和任何外人一样得到 404。

### 12.12 这不是什么

- 不是互不信任的租户之间的隔离：所有团队和个人共用一个进程、一个数据库、一块存储、一条队列。隔离由接口在每个查询上强制。
- 文件地址（`/files/<key>`）和对外分享链接仍然对拿到地址的人公开。团队的「私密」指的是列表和接口，不是文件地址。
- 预估金额不是账单；上限拦的是从这套系统发起的运行。
