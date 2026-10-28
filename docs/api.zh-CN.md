# HTTP 接口

[English](api.md)

这是 LoomCanvas 前端使用的接口，按 `server/src/routes/` 里的路由文件逐个写成。前后端共同遵守的设计约定见 [architecture.md](architecture.md)（中文）；两份文档不一致时以代码为准，说明其中一份写错了，请提 issue。

> 状态：早期开发中。首个正式版本发布前，路径和结构可能调整，目前没有接口版本号。

## 通用约定

### 地址和格式

- 所有接口都在 `/api` 下。存下来的文件在 `/files` 下，不管用的是哪种存储。
- 请求体是 JSON（`Content-Type: application/json`），上传文件除外，那是 `multipart/form-data`。
- JSON 请求体最大 1 MB，`/api/workflow` 下最大 6 MB，`/api/auth`、`/api/canvas-share` 和 `/api/team-invitations` 下最大 64 KB。需要登录的接口先验凭证、再解析请求体。
- id 是 24 位的十六进制字符串。
- 接口的响应带 `Cache-Control: no-store` 和 `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`。

### 返回结构

成功：

```json
{ "result": 0, "message": "ok", "data": { } }
```

失败，HTTP 状态码相应变化：

```json
{ "result": -1, "message": "model is required", "code": "validation.required", "data": null }
```

| 字段 | 含义 |
| --- | --- |
| `result` | 成功为 `0`。失败时不是 0：一般是 `-1`；`401`、`404`（路径不存在）和 `429` 时是 HTTP 状态码。 |
| `message` | 给用户看的文字，语言随请求而定。 |
| `code` | 只在失败时有。这条提示的稳定标识（`server/src/i18n/en.js` 里的键）。程序里按它判断，不要按 `message`。文字不在词条表里时为空，例如计费钩子自己给的原因。 |
| `data` | 返回的内容，失败时为 `null`。少数失败也带内容：`auth.too_many_attempts`（`{ retryAfterSeconds }`）、`storage.save_needs_test`（`{ test }`）、`canvas.conflict` 和 `canvas.locked`（见[保存与冲突](#保存与冲突)和[编辑锁](#编辑锁)）、六种 `budget.*` 拒绝（见[每月上限](#每月上限)）、`asset.folder_not_empty`（`{ name, count }`）。 |

有三个接口成功时返回的是文件流，不是 JSON：`POST /api/workflow/download`、`POST /api/workflow/:id/download-zip` 和 `POST /api/runs/download-zip`。

### 语言

`message`、运行的失败原因和内置名称用哪种语言，按请求决定，先匹配到的为准：

1. 请求头 `X-Locale`：`zh-CN` 或 `en`
2. 请求头 `Accept-Language`
3. 设置里的 `defaultLocale`
4. `zh-CN`

### 账号与登录

每个实例都有账号，必须登录才能用。没有免登录的模式；早期版本的 `ACCESS_PASSWORD` 变量已经不起作用。

- 一个账号有用户名、邮箱和密码。角色只有两种。超级管理员的角色是 `owner`（接口里处处都是这个值）：还没有超级管理员时，服务端在启动时按 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 和 `ADMIN_EMAIL` 创建，有且只有一个。注册出来的账号都是 `user`。账号在站点上没有别的角色；团队里的角色（团长、管理员、成员）是另一回事，见[空间与团队](#空间与团队)。
- 每个请求作用于一个空间：调用者的个人空间（不带 `X-Space` 请求头，或带 `personal`），或调用者加入的某个团队（`X-Space: <团队 id>`）。在个人空间里，账号只看得到、也只改得了自己的数据：画布、分享链接、资产、品牌包、运行、用量记录，以及自己的服务商、API Key、自定义模型、模型设置和价格。超级管理员也一样，接口不提供读取别的账号数据的途径。[空间与团队](#空间与团队)之后各节说的「调用者自己的」，指的都是请求作用的那个空间的。
- 超级管理员另外管理站点：设置、存储、注册开关和账号列表。见[管理](#管理)。

注册（注册出来的一定是 `user`，而且只在开放注册时可用）或登录，之后每个请求带上凭证：

```bash
BASE=http://localhost:3000

# Create an account. The answer already contains a token.
curl -s -X POST "$BASE/api/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"username":"ada","email":"ada@example.com","password":"correct horse battery"}'

# Sign in. "account" is the username or the email.
curl -s -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"account":"ada","password":"correct horse battery","remember":true}'
```

两个接口都在 `data` 里返回 `{ "user": { … }, "token": "…" }`。

```http
Authorization: Bearer <token>
```

- 凭证是 43 个字符的随机串，不是 JWT。服务端只存它的 SHA-256，在 `sessions` 集合里。不用 cookie。
- 会话有效期 12 小时，登录时带 `"remember": true` 则是 30 天。有效期在登录时就定了，使用过程中不会延长。注册时开的会话是 12 小时。
- 会话会在到期之前结束的情况：退出登录（`POST /api/auth/logout`）、被别的会话结束（`DELETE /api/auth/sessions…`）、修改密码（这个账号的会话全部结束；调用者在返回里拿到一个新凭证，见 [PUT /api/auth/password](#put-apiauthpassword)）、超级管理员重置了这个账号的密码或停用了它（它的会话全部结束）、账号被删除。这些都立即生效。改 `SECRET_KEY` 不会结束会话。
- 不带凭证就能调用的公开接口：`GET /api/bootstrap`、`POST /api/auth/register`、`POST /api/auth/login`、`GET /api/canvas-share/:token`、`GET /api/team-invitations/:token`、`POST /api/workflow/:id/lock/release`（它认的是编辑锁的释放令牌），以及 `GET /files/*`。
- 其余接口在凭证缺失、不存在、已过期或账号被停用时返回 `401`，错误码 `auth.required`。需要登录的接口上，`401` 只表示「没登录」；上游的认证失败以 `400` 返回。另外唯一的 `401` 是 `POST /api/auth/login` 的 `auth.invalid_credentials`。
- 只有超级管理员能调用的接口，其他账号调用返回 `403`，错误码 `auth.forbidden`。
- 账号还在用临时密码时（它的 [User](#user-对象) 里 `mustChangePassword` 为 `true`），它的会话只能调用 `GET /api/auth/me`、`GET /api/bootstrap`、`PUT /api/auth/password` 和 `POST /api/auth/logout`，以及公开接口。其余接口一律返回 `403`，错误码 `auth.password_change_required`，直到用 [PUT /api/auth/password](#put-apiauthpassword) 改过密码。
- 按 id 访问别的空间（别的账号的个人空间，或请求没有作用于其中的团队）的东西，返回 `404`，错误码和 id 不存在时一样（`canvas.not_found`、`run.not_found`、`provider.not_found`……）。不会是 `403`，更不会返回数据。列表里只有请求作用的那个空间的记录。

登录、注册、修改用户名或邮箱都有限流，见 [POST /api/auth/login](#post-apiauthlogin)、[POST /api/auth/register](#post-apiauthregister) 和 [PUT /api/auth/profile](#put-apiauthprofile)。

网页端把凭证放在浏览器的本地存储里，键是 `loomcanvas-token`（勾了「记住我」用 `localStorage`，没勾用 `sessionStorage`），再放进上面那个请求头。因为不用 cookie，不存在跨站请求伪造的问题，见[安全](security.zh-CN.md#会话)。

### 通用错误

| HTTP | `code` | 什么时候 |
| --- | --- | --- |
| 400 | `validation.*` | 字段缺失，或类型、格式、范围不对。`message` 里写明是哪个字段。 |
| 400 | `common.body_not_json` | 请求体不是合法的 JSON。 |
| 400 | `common.bad_request` | 请求本身格式不对（路径里的编码有误、不支持的字符集等）。 |
| 401 | `auth.required` | 没有有效的会话。早期版本用的是 `auth.login_required`。 |
| 403 | `auth.forbidden` | 接口只给超级管理员用，而调用者是别的账号。 |
| 400 | `team.bad_space` | `X-Space` 请求头既不是 `personal` 也不是团队 id。见[空间与团队](#空间与团队)。 |
| 403 | `team.forbidden` | 调用者在团队里的角色不允许这个操作。 |
| 403 | `team.dissolved`、`team.suspended` | `X-Space`（或路径）指的团队已经关闭。 |
| 403 | `budget.*` | 团队的每月上限拒绝了这次运行。见[每月上限](#每月上限)。 |
| 403 | `auth.password_change_required` | 调用者还在用临时密码，要先换掉（「请先设置新密码，再继续使用」）。在这之前只能调用 `GET /api/auth/me`、`GET /api/bootstrap`、`PUT /api/auth/password` 和 `POST /api/auth/logout`。 |
| 404 | `common.route_not_found` | 没有这个接口。 |
| 404 | `common.not_found`、`*.not_found` | 没有这条记录，或者它属于别的空间（别的账号的个人空间，或请求没有作用于其中的团队）。 |
| 404 | `team.not_found` | 没有这个团队，或者调用者不是它的成员。 |
| 409 | `canvas.conflict` | 保存时带的版本号已经落后于画布。见[保存与冲突](#保存与冲突)。 |
| 423 | `canvas.locked` | 别人正在编辑这张团队画布。见[编辑锁](#编辑锁)。 |
| 409 | `common.duplicate` | 要求唯一的值已经存在。 |
| 413 | `common.body_too_large`、`file.too_large` | 请求体或上传的文件超过上限。 |
| 429 | `auth.too_many_attempts` | 登录、注册、改密码或改资料触发了限流。`data.retryAfterSeconds` 和响应头 `Retry-After` 给出要等多久。 |
| 429 | `run.queue_full` | 这个账号未完成的运行已有 `userQueueLimit` 个（默认 200，个人空间和所在团队合计），或者整个实例合计已有 500 个。 |
| 500 | `common.internal` | 意料之外的错误。细节只在服务端日志里。 |

### 跨域

默认不允许任何跨域访问。`CORS_ORIGIN` 里列出的来源可以用 `GET`、`POST`、`PUT`、`PATCH` 和 `DELETE` 调用 `/api`，允许的请求头是 `Authorization`、`Content-Type`、`X-Locale` 和 `X-Space`。

---

## 应用与登录

<a id="基础"></a>

### GET /api/bootstrap

公开。客户端启动时最先需要的内容，也用作健康检查。早期版本的路径 `GET /api/app/bootstrap` 仍然可用，返回相同。

未登录的调用者拿到的 `data`：

```json
{
  "auth": { "registrationOpen": true },
  "user": null,
  "site": { "name": "LoomCanvas", "logoUrl": "", "showName": true, "defaultLocale": "zh-CN" },
  "hasProvider": false,
  "limits": { "maxUploadMb": 50 },
  "media": { "upstreamByUrl": false, "writable": true },
  "version": "0.1.0"
}
```

| 字段 | 含义 |
| --- | --- |
| `auth.registrationOpen` | `POST /api/auth/register` 现在接不接受新账号：就是 `registrationOpen` 这项设置的值。`auth` 里只有这一个字段。 |
| `user` | 请求带了有效凭证时是调用者的 [User](#user-对象)，否则为 `null`。登录是必须的，所以 `null` 就是「没登录」。`user.mustChangePassword` 为 `true` 的会话也能调这个接口。 |
| `site` | 站点的名称、Logo 和默认语言。`showName` 就是 `showSiteName` 这项设置：`false` 表示显示 Logo 的客户端不在旁边写站点名称（只在 `logoUrl` 不为空时有意义）。 |
| `hasProvider` | 请求作用的那个空间（调用者的个人空间，或 `X-Space` 指的团队）里至少有一个启用的服务商时为 `true`。未登录时恒为 `false`。 |
| `spaces`、`space`、`spaceError`、`teams` | 调用者能在哪些空间里工作，这个请求作用于哪个空间、以什么身份，以及调用者能不能创建团队。见 [bootstrap 和 `me` 里的空间信息](#bootstrap-和-me-里的空间信息)。未登录时 `spaces` 为 `[]`，`space` 和 `teams` 为 `null`。 |
| `limits.maxUploadMb` | 服务端的 `MAX_UPLOAD_MB`，客户端可以在上传之前就拒绝太大的文件。 |
| `version` | 服务端的版本。 |
| `media.upstreamByUrl` | 上游模型能不能按地址拿到站内存的文件：配了公网的 `PUBLIC_URL`，或者新文件存在公网能访问的桶里，为 `true`；未登录时恒为 `false`。画布用它在运行之前提醒：只接受地址的模型（ModelSpec 里的 `imageByUrlOnly`）连着参考图时可能用不了。它说的是配置：当前使用的桶暂时写不了时（见 `media.writable`），它仍然按这个桶的配置回答。 |
| `media.writable` | 现在存不存得了新文件。当前使用的桶保存的密钥解不开时为 `false`：这时上传和图片、视频的运行会被拒绝（`503 storage.secret_unreadable`），每个登录的客户端都能在动手之前知道。只有这一个布尔值，不说是哪个存储、为什么。未登录时恒为 `true`。 |

早期版本还返回 `authRequired`、`authed` 和 `site.defaultTheme`，现在都去掉了：登录是必须的（看 `user` 即可）；主题是每个账号自己的偏好（`user.prefs.theme`），不是站点设置。

### User 对象

接口返回的账号信息：

```json
{ "id": "670e…b2", "username": "ada", "email": "ada@example.com", "role": "user", "mustChangePassword": false, "prefs": { "nodeLayout": "a", "theme": "dark" }, "createdAt": "2026-10-09T02:58:01.120Z" }
```

| 字段 | 含义 |
| --- | --- |
| `role` | `owner`（超级管理员）或 `user`。 |
| `email` | 账号的邮箱。超级管理员的可能是 `""`：它是唯一可以没有邮箱的账号（创建时没设 `ADMIN_EMAIL`，之后也还没用 [PUT /api/auth/profile](#put-apiauthprofile) 补上）。 |
| `mustChangePassword` | 这个账号现在的密码是别人知道的，就为 `true`：服务端启动时生成的超级管理员密码、[`POST /api/admin/users/:id/reset-password`](#账号管理) 给出的临时密码，或者命令行重置给出的密码。`PUT /api/auth/password` 成功后变回 `false`。为 `true` 期间接口几乎什么都不给用，见[账号与登录](#账号与登录)。 |
| `prefs` | 这个账号对网页端的偏好，总是完整的（没选过的项给默认值）。`nodeLayout` 是画布上生成节点的布局：`"a"` 结果优先、选中后在节点下方出输入条（默认），`"b"` 紧凑节点、设置在右侧属性面板里，`"c"` 全部放在节点上。`theme` 是界面的配色主题：`"dark"` 深色（默认）、`"light"` 浅色，或 `"system"` 跟随设备自己的深浅设置。用 [PUT /api/auth/prefs](#put-apiauthprefs) 改。 |

关于账号，服务端通过这个对象给出的只有这些。凡是返回 User 的地方都是它：注册、登录、`GET /api/auth/me`、`PUT /api/auth/profile`、`PUT /api/auth/prefs`、bootstrap 里的 `user`，以及 `GET /api/admin/users` 的每一行。

### POST /api/auth/register

公开。创建一个普通账号（`role: "user"`，成不了超级管理员）并让它登录。

请求体：`{ "username": string, "email": string, "password": string }`。

| 字段 | 规则 |
| --- | --- |
| `username` | 3 到 32 个字符，只能用 `A-Z a-z 0-9 _ -`。不区分大小写地唯一。 |
| `email` | 要像一个邮箱地址，最长 254 个字符。不区分大小写地唯一。系统从不往这个地址发邮件：没有邮箱验证，也没有「忘记密码」邮件。 |
| `password` | 8 到 128 个字符。 |

返回：`{ "user": User, "token": string }`。会话有效期 12 小时。

注册必须是开放的（`registrationOpen` 这项设置，默认 `true`）。关着的时候一律返回 `403` `auth.registration_closed`。超级管理员不在这里产生：服务端在启动时创建它，并把没有账号功能的早期版本留下的数据交给它，见[架构](architecture.md#11-账号与数据归属)。

| HTTP | `code` | 什么时候 |
| --- | --- | --- |
| 400 | `auth.invalid_username` | 没带 `username`，或者不合规则。 |
| 400 | `auth.invalid_email` | 没带 `email`，或者不像一个邮箱地址。 |
| 400 | `auth.weak_password` | 没带 `password`，或者不足 8 个、超过 128 个字符。 |
| 403 | `auth.registration_closed` | 超级管理员关闭了注册。 |
| 409 | `auth.username_taken` | 用户名已被别的账号使用。 |
| 409 | `auth.email_taken` | 邮箱已被别的账号使用。 |
| 429 | `auth.too_many_attempts` | 同一个客户端一小时内注册超过 20 次（IPv6 客户端按 /64 网段计）。`data` 是 `{ "retryAfterSeconds": number }`，响应带 `Retry-After` 头。 |

两种 `409` 会让调用者知道某个用户名或邮箱已经注册过。这避免不了：系统不发邮件，没有别的回答方式。它受上面的限流约束；在意的话请关闭注册。

### POST /api/auth/login

公开。请求体：`{ "account": string, "password": string, "remember"?: boolean }`。`account` 填用户名或邮箱，不区分大小写。

返回：`{ "user": User, "token": string }`。会话有效期 12 小时，带 `"remember": true` 则是 30 天。`user.mustChangePassword` 为 `true` 说明用的是临时密码：下一步只能调 [PUT /api/auth/password](#put-apiauthpassword)。网页端这时只显示**设置新密码**这一屏（`/password`）。

| HTTP | `code` | 什么时候 |
| --- | --- | --- |
| 400 | `auth.credentials_required` | 没带 `account` 或 `password`，或者是空的。 |
| 401 | `auth.invalid_credentials` | 账号不存在，或者密码不对。两种情况的返回和服务端做的事都一样。 |
| 403 | `auth.account_disabled` | 密码正确，但账号已被超级管理员停用。 |
| 429 | `auth.too_many_attempts` | 触发了下面的限流。`data` 是 `{ "retryAfterSeconds": number }`，响应带 `Retry-After` 头。 |

登录尝试的限流，每 10 分钟：

| | 按什么计数 | 上限 | 说明 |
| --- | --- | --- | --- |
| (a) | 账号名加客户端地址 | 10 | 这一对登录成功后清零。 |
| (b) | 客户端地址，所有账号名合计 | 30 | |
| (c) | 账号名，所有地址合计 | 100 | 对这个账号的「熟悉地址」不生效。 |
| (d) | 全部登录尝试合计 | 3000 | 对这个账号的「熟悉地址」不生效。 |

- IPv6 客户端按 /64 网段计。在反向代理后面要配好 `TRUST_PROXY`，客户端地址才是真实的。
- 账号名存不存在都照样计数，所以从限流看不出哪些名字存在。
- 「熟悉地址」指最近 30 天里这个账号从那里成功登录过的地址，或者持有这个账号有效会话的地址。别处的乱猜把 (c) 或 (d) 用完时，账号的主人从这样的地址照样能登录，所以拿某个账号名乱猜，不会把它的主人锁在外面。从一个账号从没用过的地址登录，主人可能要等一等。
- 计数和「账号从哪些地址登录过」的记录都在进程内存里，每个进程各一份，重启后清空。

### POST /api/auth/logout

结束发出这个请求的会话。返回的 `data`：`null`。`mustChangePassword` 为 `true` 时也能调。

### GET /api/auth/me

返回：`{ "user": User, "spaces": [...] }`。`spaces` 和 bootstrap 里的是同一个列表：个人空间，然后是这个账号加入的团队（`mustChangePassword` 为 `true` 时为 `[]`）。`mustChangePassword` 为 `true` 时也能调。

### PUT /api/auth/password

请求体：`{ "currentPassword": string, "newPassword": string }`。修改调用者的密码，并结束这个账号的**全部**会话，包括发出这个请求的会话。调用者拿到一个新会话来接替它。

临时密码也是用它换掉的：`mustChangePassword` 为 `true` 时可以调（这时 `currentPassword` 填临时密码），成功后这个标记变回 `false`。

返回：`{ "revokedSessions": number, "token": string }`。`revokedSessions` 是结束了几个会话。`token` 是给调用者的新凭证，有效期是被它接替的那个会话剩下的时间；发请求时用的凭证从此失效，之后的请求要用新的。网页端会悄悄换上。

| HTTP | `code` | 什么时候 |
| --- | --- | --- |
| 400 | `auth.wrong_current_password` | 没带 `currentPassword`，或者不对。有意不用 `401`：会话本身没问题。 |
| 400 | `auth.same_password` | `newPassword` 和 `currentPassword` 相同（「新密码不能和当前密码相同」）。 |
| 400 | `auth.weak_password` | 没带 `newPassword`，或者不足 8 个、超过 128 个字符。 |
| 429 | `auth.too_many_attempts` | 核对 `currentPassword` 算一次对这个账号的登录尝试，计入[登录](#post-apiauthlogin)限流的 (a) 和 (c)。`currentPassword` 正确则清掉 (a)。 |

### PUT /api/auth/profile

请求体：`{ "username"?: string, "email"?: string }`，规则同[注册](#post-apiauthregister)。返回：`{ "user": User }`。

错误码：`auth.invalid_username`、`auth.invalid_email`、`common.nothing_to_update`（两个字段都没带）（400）；`auth.username_taken`、`auth.email_taken`（409）；`auth.too_many_attempts`（429，带 `data.retryAfterSeconds` 和 `Retry-After`）。

每个账号每小时最多改 20 次。不限的话，`username_taken` 和 `email_taken` 这两种回答就成了登录的账号可以无限次查询「这个地址注册过没有」的途径。

### PUT /api/auth/prefs

请求体：`{ "nodeLayout"?: "a" | "b" | "c", "theme"?: "dark" | "light" | "system" }`。修改调用者的偏好，只改发过去的那几项。偏好存在账号上，换浏览器也跟着走。返回：`{ "user": User }`。

网页端还会把 `theme` 镜像到浏览器的 `localStorage`（键 `loomcanvas-theme`），登录前的页面、分享页和下次打开时的首帧用它。有人登录着的时候，以账号上的值为准。

请求体的校验是严格的：必须是一个对象，至少有一个键；每个键都得是认识的偏好项，每个值都得在它允许的范围内。请求被拒绝时什么都不改。

| HTTP | `code` | 什么时候 |
| --- | --- | --- |
| 400 | `validation.body_object` | 请求体不是 JSON 对象。 |
| 400 | `common.nothing_to_update` | 对象是空的。 |
| 400 | `validation.bad_key` | 有一个键不是偏好项（不认识的键直接拒绝，不是忽略）。 |
| 400 | `validation.one_of` | 值不在允许的范围内，例如 `{ "nodeLayout": "d" }` 或 `{ "theme": "sepia" }`。 |

分享页（`GET /api/canvas-share/:token`）不看这项偏好：分享出去的画布一律按布局 A 只读显示。

### GET /api/auth/sessions

调用者还有效的会话，最近活跃的在前。

```json
[
  { "id": "6712…9c", "current": true, "createdAt": "2026-10-09T02:58:01.120Z", "lastSeenAt": "2026-10-09T03:40:12.004Z", "userAgent": "Mozilla/5.0 …", "ip": "203.0.113.7" }
]
```

`current` 标出发出这个请求的会话。`lastSeenAt` 最多每分钟更新一次。`userAgent` 和 `ip` 是开这个会话的那个请求的；在反向代理后面，`TRUST_PROXY` 配对了，`ip` 才是真实的客户端地址。

### DELETE /api/auth/sessions/:id

结束调用者的一个会话，可以是当前这个。返回：`{ "id": string }`。

错误码：`auth.session_not_found`（404），id 不存在，或者是别的账号的会话。

### DELETE /api/auth/sessions

结束调用者除当前会话以外的全部会话（「退出其他设备」）。返回：`{ "revoked": number }`。

---

## 空间与团队

每个账号有一个**个人空间**：就是有团队功能之前它的全部数据，原样不动。**团队**是第二种空间，多个账号共用：团队空间里的画布、资产、品牌包、模板、服务商和 API Key、价格、运行记录、分享链接都属于团队，不属于创建它们的人。一个账号可以加入多个团队。

团队里有三个角色：**团长**（接口里的值是 `owner`，每个团队一个，默认是创建者，可以转让）、**管理员**（`admin`，由团长指定）、**成员**（`member`）。它们和账号在站点上的角色（`user.role`：`owner` 是站点的超级管理员，`user` 是普通账号）是两回事。超级管理员不是某个团队的成员时，进不了这个团队。

### 请求作用于哪个空间

| 方式 | 用在哪些接口 | 含义 |
| --- | --- | --- |
| 请求头 `X-Space: <团队 id>` | 所有操作空间内容的接口：`/api/workflow`、`/api/files`、`/api/models`、`/api/runs`、`/api/llm`、`/api/user-asset`、`/api/brand-kits`、`/api/canvas`、`/api/canvas-share`（公开读取除外），以及 `/api/admin` 里按空间的部分（`vendors`、`providers`、`models`、`usage`） | 请求作用于这个团队 |
| 请求头 `X-Space: personal`，或不带这个头 | 同上 | 请求作用于调用者的个人空间。团队功能之前的客户端、单独嵌入编辑器时的适配器都不带这个头，行为和以前完全一样 |
| 路径里的团队 id：`/api/teams/:id/...` | 团队管理：成员、邀请链接、上限、用量、动态、设置、转让、解散 | 路径决定团队，不读请求头 |

成员身份每个请求现查，不存在会话里：被移出团队的人，下一个请求就被拒绝。

| HTTP | `code` | 什么时候 |
| --- | --- | --- |
| 400 | `team.bad_space` | `X-Space` 既不是 `personal` 也不是 24 位的 id |
| 404 | `team.not_found` | 团队不存在，**或调用者不是它的成员**，两种情况返回完全一样 |
| 403 | `team.dissolved` | 调用者是成员，团队已解散（7 天内可恢复） |
| 403 | `team.suspended` | 调用者是成员，团队被超级管理员停用 |
| 403 | `team.forbidden` | 调用者是成员，但角色不允许这个操作（见[权限矩阵](#权限矩阵)） |

在一个空间里用别的空间的 id 访问，返回 404，和 id 根本不存在时一样；这个团队自己的成员在请求没有作用于它的时候也一样，超级管理员也一样。团队内，调用者看不到的画布（别人的「仅自己」）同样是 404；看得到但不能改的返回 `403 team.forbidden`。

客户端在任何接口收到 `team.not_found`、`team.dissolved`、`team.suspended`，都应当视为「这个空间对我已经不存在」：丢掉保存的空间选择，回到个人空间，重新取 bootstrap。超级管理员的站点接口（`/api/admin/users`、`/site`、`/teams`、`/team-requests`、`/settings`、`/storage`）遇到失效的 `X-Space` 时忽略它，不报错。

### bootstrap 和 `me` 里的空间信息

`GET /api/bootstrap` 对已登录的调用者多返回下面几项（未登录、或 `mustChangePassword` 为 `true` 时为空数组或 `null`）：

```json
{
  "spaces": [
    { "id": "personal", "kind": "personal", "name": "", "role": "owner" },
    { "id": "6712…a0", "kind": "team", "name": "Starlight Studio", "avatar": "", "ownerId": "670e…b2", "status": "active", "role": "member", "members": 7, "maxMembers": 50, "timezone": "Asia/Shanghai", "dissolvedAt": null, "purgeAt": null, "createdAt": "…" }
  ],
  "space": {
    "id": "6712…a0", "kind": "team", "name": "Starlight Studio", "role": "member",
    "permissions": { "canvas:create": true, "provider:manage": false, "canvas:edit": null, "…": true },
    "settings": { "defaultVisibility": "team_view", "publicShare": "editors", "adminsSeeAll": false, "copyToPersonal": true, "blockUnpriced": true }
  },
  "teams": { "authorised": false, "canCreate": false, "held": 0, "max": 3, "maxMembers": 50, "request": null }
}
```

| 字段 | 含义 |
| --- | --- |
| `spaces` | 调用者能进的所有空间：先是个人空间，然后是加入的团队（[Team](#团队) 对象），按加入先后。已停用或已解散的团队只对它的团长列出（带 `status`，已解散的还带 `purgeAt`） |
| `space` | **这个请求**作用的空间（`X-Space` 指定，不带就是个人空间）。`id` 是 `"personal"` 或团队 id；`permissions` 是调用者在[权限矩阵](#权限矩阵)里的那一列，值为 `true`、`false`，或 `null`（要看具体画布或成员，每张画布自己带 `access`）；`settings` 是[团队设置](#团队设置)，个人空间为 `null`。个人空间里所有权限都是 `true` |
| `spaceError` | 只在 `X-Space` 指向一个进不去的团队时出现：`team.not_found`、`team.dissolved` 或 `team.suspended`。bootstrap 本身不会因此失败，这时 `space` 是个人空间 |
| `teams` | 调用者能不能创建团队，见[谁可以创建团队](#谁可以创建团队) |
| `hasProvider` | 现在说的是请求作用的那个空间：**这个空间**有没有启用的服务商 |

`GET /api/auth/me` 返回 `{ "user": User, "spaces": [...] }`，`spaces` 是同一个数组（`mustChangePassword` 为 `true` 时为空）。

### 谁可以创建团队

创建团队要超级管理员**授权**。授权是账号上的一个标记（`canCreateTeams`），由超级管理员在用户管理里设置，或者通过批准这个账号的申请来授予。超级管理员自己始终有授权。两个站点设置给出上限：`teamMaxPerUser`（默认 **3**）每个账号最多创建几个团队；`teamMaxMembers`（默认 **50**）每个团队最多多少成员。

创建状态（`bootstrap.teams`、`GET /api/teams` 的 `creation`、`GET /api/teams/creation` 都返回它）：

```json
{ "authorised": true, "canCreate": true, "held": 1, "max": 3, "maxMembers": 50,
  "request": { "id": "6713…", "status": "approved", "note": "for the studio", "reason": "", "createdAt": "…", "decidedAt": "…" } }
```

| 字段 | 含义 |
| --- | --- |
| `authorised` | 这个账号有没有授权 |
| `held` / `max` | 这个账号创建的或担任团长的、还存在的团队数（已解散的团队在被永久删除前也算）/ `teamMaxPerUser` |
| `canCreate` | `authorised && held < max`：界面只在这时显示「创建团队」 |
| `request` | 这个账号最近一次申请授权：`status` 为 `pending`、`approved` 或 `rejected`（`reason` 是超级管理员拒绝时写的原因）。从没申请过为 `null` |

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/teams/creation` | | 创建状态 |
| POST | `/api/teams/creation-request` | `{ note? }`（最多 500 字） | 创建状态，带新的 `request`。每个账号同时只能有一条待处理的申请：`409 team.request_pending`；已有授权：`409 team.already_authorised`；被拒绝后可以再申请 |
| DELETE | `/api/teams/creation-request` | | `{ withdrawn, …创建状态 }`，撤回待处理的申请 |

### 团队

Team 对象（列表里的样子）：

```json
{ "id": "6712…a0", "kind": "team", "name": "Starlight Studio", "avatar": "", "ownerId": "670e…b2",
  "status": "active", "role": "owner", "members": 7, "maxMembers": 50, "timezone": "Asia/Shanghai",
  "dissolvedAt": null, "purgeAt": null, "createdAt": "…" }
```

`status`：`active` 正常，`suspended` 被超级管理员停用，`dissolved` 被团长解散（`purgeAt` 是永久删除的时间）。`role` 是调用者的角色。`avatar` 是头像的素材地址，没有头像时为空串。

| 方法 | 路径 | 谁可以 | 请求体 | 返回 |
| --- | --- | --- | --- | --- |
| GET | `/api/teams` | 任何已登录账号 | | `{ teams: Team[], creation }` |
| POST | `/api/teams` | 有授权的账号 | `{ name, avatar?, timezone? }` | 新团队（`role: "owner"`，`members: 1`）。`name` 1 到 40 字；`timezone` 是 IANA 时区名，默认 `UTC`，**请传浏览器的时区**：每月上限按它切月 |
| GET | `/api/teams/:id` | 任何成员；团队关闭期间只有团长 | | [团队详情](#团队详情) |
| PATCH | `/api/teams/:id` | 名称、头像：团长、管理员（`team:rename`）；`timezone`、`settings`：团长（`team:settings`） | `{ name?, avatar?, timezone?, settings? }` | 团队详情 |
| DELETE | `/api/teams/:id?confirm=<团队名称>` | 团长（`team:dissolve`） | | Team，`status: "dissolved"`，带 `purgeAt` |
| POST | `/api/teams/:id/restore` | 团长 | | Team，恢复为正常状态。仅 7 天内 |
| POST | `/api/teams/:id/transfer` | 团长（`team:transfer`） | `{ userId, confirm: <团队名称> }` | Team，调用者的 `role` 变成 `admin` |
| POST | `/api/teams/:id/leave` | 管理员、成员（`team:leave`） | | `{ left: true, canvasesInherited, runsCanceled }` |

错误码：`team.not_authorised`（403，没有授权）、`team.max_owned`（403，达到 `teamMaxPerUser`）、`common.name_required`、`validation.max_length`、`validation.bad_url`（`avatar`）、`validation.invalid`（`timezone`）、`team.confirm_mismatch`（400，`confirm` 不是团队的准确名称）、`team.member_not_found`（404，`userId` 不是成员）、`team.already_owner`（400）、`team.new_owner_unusable`（409，对方账号已停用）、`team.owner_cannot_leave`（409）、`team.not_dissolved`（409）、`team.changed`（409，刚被别人改过，刷新重试）。

#### 团队详情

```json
{
  "id": "6712…a0", "kind": "team", "name": "Starlight Studio", "avatar": "", "ownerId": "670e…b2", "status": "active",
  "role": "member", "members": 7, "maxMembers": 50, "timezone": "Asia/Shanghai", "dissolvedAt": null, "purgeAt": null, "createdAt": "…",
  "settings": { "defaultVisibility": "team_view", "publicShare": "editors", "adminsSeeAll": false, "copyToPersonal": true, "blockUnpriced": true },
  "me": { "id": "670f…11", "role": "member", "displayName": "", "joinedAt": "…" },
  "permissions": { "canvas:create": true, "provider:manage": false, "…": null },
  "onboarding": { "hasProvider": true, "hasMembers": true, "hasCanvas": false },
  "concurrency": 4,
  "limits": { "…": "see Limits" }
}
```

`onboarding` 对应新团队的三步引导（配置服务商、邀请成员、新建画布）；全为 `true` 就不用再显示。`concurrency` 是团队并发上限：这个团队同时在跑的运行最多几个，就是队列实际执行的那个数（超级管理员给这个团队单独设过就用它，否则是站点的 `teamConcurrency`）。每个成员都能看到。`limits` 是调用者能看到的[每月上限](#每月上限)对象（团队关闭时为 `null`）。

#### 团队设置

| 键 | 默认 | 取值 | 含义 |
| --- | --- | --- | --- |
| `defaultVisibility` | `team_view` | `private`、`team_view`、`team_edit` | 新建画布时创建者没指定可见范围时用它 |
| `publicShare` | `editors` | `editors`、`managers` | 谁可以创建对外分享链接：能编辑这张画布的人，或只有团长和管理员 |
| `adminsSeeAll` | `false` | 布尔 | 管理员是否也能看全队的记录和用量 |
| `copyToPersonal` | `true` | 布尔 | 成员和管理员能否把团队的画布、资产复制到个人空间。团长始终可以 |
| `blockUnpriced` | `true` | 布尔 | 设了金额上限时，禁止运行成本算不出来的模型。可以在这里改，也可以用 `PUT /api/teams/:id/limits` 改 |

全部只有团长能改（`PATCH /api/teams/:id { settings: {…} }`，传要改的键即可）。未知的键返回 `400 settings.unknown_key`。

#### 解散、恢复、永久删除

- **解散**后团队立刻关闭：所有成员得到 `403 team.dissolved`，分享链接打不开（`404 share.gone`），邀请链接失效，排队中的运行被取消（已经在跑的跑完，结果保留），编辑锁释放。这时什么都还没删。
- **7 天内**团长（`POST /api/teams/:id/restore`）或超级管理员可以恢复，一切照旧（被取消的运行不会恢复）。
- 到期后服务端把团队永久删除：画布、分享链接、资产、品牌包、服务商和 Key、价格、运行记录、自存模板、成员、邀请链接、团队动态，以及存储里团队前缀下的全部文件。这个清理每小时执行一次，不可恢复。
- 已解散的团队在被永久删除前仍然占团长的 `teamMaxPerUser` 名额。

#### 转让团长

`POST /api/teams/:id/transfer` 一步完成：对方成为团长，调用者变成管理员。新团长能看到团队里的全部画布，包括「仅自己」的。接收团队不需要授权。

### 成员

`GET /api/teams/:id/members` 里的一个成员：

```json
{ "id": "670f…11", "username": "zhouyu", "displayName": "Zhou Yu", "name": "Zhou Yu", "role": "member", "joinedAt": "…", "disabled": false,
  "usage": { "runs": 132, "amount": 61.4, "uncounted": 3, "currency": "CNY" },
  "limits": { "runs": 400, "amount": null, "custom": { "runs": true, "amount": false } } }
```

`name` 是界面上该显示的名字：成员在这个团队里的显示名，没填就是用户名。`disabled`：这个账号当前登录不了（被超级管理员停用）。`usage`（本月）和 `limits` 只有拥有 `usage:view_all` 的调用者才有：团长，以及团长打开 `adminsSeeAll` 后的管理员；`limits.custom` 说明哪一项是这个成员单独设的、哪一项跟的是全员默认值。同时还有 `usage.breakdown` 和 `effective`：按「已用 = 已成功 + 进行中」这一个定义算出的本月明细，以及可以直接显示的状态（`ok`、`near`、`reached`、`unlimited`），见[每月上限](#每月上限)。

接口里凡是提到某个人（画布的创建人、持锁人、运行的发起人、资产的添加人、模板的保存人、分享链接的发布人、服务商的维护人、团队动态里的操作人和被操作的成员），用的都是同一个结构 **Person**：

```json
{ "id": "670f…11", "username": "zhouyu", "name": "Zhou Yu", "state": "left", "left": true, "deleted": false }
```

| `state` | 含义 | `left` | `deleted` |
| --- | --- | --- | --- |
| `active` | 在团队里（个人空间：账号存在） | `false` | `false` |
| `left` | 已离开团队：账号还在，但已不在这个团队（自己退出或被移除） | `true` | `false` |
| `deleted` | 账号已删除：账号本身不存在了 | 团队里为 `true` | `true` |

以 `state` 为准；`left`、`deleted` 是同一个答案的两个布尔写法，留给旧客户端。`name` 是这个人在团队里的显示名，没填就是用户名。人已经不在时，两者都是**他离开时用的名字**：服务端只保留这两个名字（不保留这个人的其他任何信息），好让他留下的东西仍然说得清是谁做的，直到团队本身被删除。只有在开始保留名字之前就离开的人、或者从来查不到的 id，这两项才是空串，这时界面显示中性的「前成员」「已删除的账号」。重新加入的人恢复为 `active`。

| 方法 | 路径 | 谁可以 | 请求体 | 返回 |
| --- | --- | --- | --- | --- |
| GET | `/api/teams/:id/members` | 任何成员 | | `{ members: Member[], maxMembers, withUsage }`，团长在前，然后管理员、成员 |
| PATCH | `/api/teams/:id/members/:userId` | 见下 | `{ role?, displayName?, limits? }` | 这个成员 |
| DELETE | `/api/teams/:id/members/:userId` | 团长：除自己外任何人；管理员：只能移除成员（`member:remove`） | | `{ removed: true, canvasesInherited, runsCanceled, keysSet }` |

`PATCH` 的字段：`role`（`"admin"` 或 `"member"`）只有团长能改（`member:set_role`）；`limits`（`{ runs?, amount? }`，数字或 `null`，`null` 表示跟全员默认值）只有团长能改（`limits:manage`）；`displayName`（最多 40 字，空串表示用用户名）本人可以改自己的，团长和管理员可以改任何人的。

成员**退出或被移除**后（两种情况结果一样）：

- 他的下一个请求就被拒绝：团队里的一切对他返回 `404 team.not_found`，不用等会话过期；
- 他做的东西留在团队（画布、资产、结果、模板），创建人显示为 `createdBy.state: "left"`，名字还是他离开时的名字（账号被删除后变成 `"deleted"`）；
- 他的「仅自己」画布转给团长（`canvasesInherited` 是数量），否则没人进得去；
- 他持有的编辑锁被释放；他**还在排队**的运行被取消（`runsCanceled`），已经开始的运行会跑完，结果归团队。这样被取消的运行会说明原因：记录是 `status: "canceled"`，`errorCode: "run.canceled_member_removed"`，`error` 是读的人的语言写的一句话（「排队时被取消：发起人已不在这个团队」），不管从哪里读这条运行（`GET /api/runs/:id`、用量记录）都一样。人手动取消的运行是 `errorCode: "run.canceled"`。发起人离开的那一瞬间恰好被队列取出的运行不会发往上游，而是以 `run.member_removed` 失败；
- 他创建的邀请链接全部失效；
- `keysSet`（仅移除时返回）列出被移除的**管理员**填写过当前 Key 的服务商 `[{ id, name }]`：这个人知道这些 Key，界面应提醒团长到上游换新。成员从没见过 Key，不需要换。

错误码：`team.member_not_found`（404）、`team.owner_cannot_leave`（409，团长要先转让或解散）、`team.owner_role_fixed`（409，团长的角色只能通过转让改变）、`team.use_leave`（400，不能移除自己）、`validation.one_of`、`validation.int_range`、`validation.range`（400）。

### 邀请链接

加入团队的唯一途径。链接里带一个邀请码，拿到它的人在它过期、用完或被撤销之前都可以**以成员身份**加入。系统不发任何邮件。

```json
{ "id": "6714…", "token": "q0X…43 characters", "createdBy": Person, "maxUses": 10, "usedCount": 2, "remainingUses": 8,
  "expiresAt": "…", "revoked": false, "state": "valid", "createdAt": "…" }
```

界面给出的链接是 `<站点>/join/<token>`（这个路径是网页端的，服务端只认邀请码）。`maxUses: 0` 表示不限次数；`remainingUses` 是还能再用几次：不限次数时为 `null`；链接已撤销、已过期或团队已关闭（`revoked`、`expired`、`team_unavailable`）时也是 `null`——它已经没有「还剩几次」可说，界面显示 `state`，不显示次数（`maxUses`、`usedCount` 仍然说明它用了多少）；用完（`used_up`）时是 `0`。`state`：`valid`、`expired`、`used_up`、`revoked`、`team_full`、`team_unavailable`。邀请码加密存放，查找时用的是它的 SHA-256，所以管理者可以再次复制链接，而只拿到数据库副本的人用不了它；`SECRET_KEY` 改过之后 `token` 为空串，这样的链接只能撤销。

| 方法 | 路径 | 谁可以 | 请求体 | 返回 |
| --- | --- | --- | --- | --- |
| GET | `/api/teams/:id/invitations` | 团长、管理员（`invite:manage`） | | 邀请数组，新的在前 |
| POST | `/api/teams/:id/invitations` | 团长、管理员 | `{ expiresInDays?: 1-90 (default 7), maxUses?: 0-1000 (default 10) }` | 邀请。每个团队最多 50 条有效链接（`invite.max`） |
| DELETE | `/api/teams/:id/invitations/:invitationId` | 团长、管理员 | | `{ id, revoked: true }`，立即生效 |
| GET | `/api/team-invitations/:token` | **公开** | | 预览，见下 |
| POST | `/api/team-invitations/:token/accept` | 已登录 | | `{ team: Team, already }` |

预览（加入页显示的内容，登录不登录都能取）：

```json
{ "state": "valid",
  "team": { "id": "6712…a0", "name": "Starlight Studio", "avatar": "", "members": 7, "maxMembers": 50, "ownerName": "linzhou" },
  "inviterName": "linzhou", "contactName": "linzhou", "expiresAt": "…", "remainingUses": 8, "alreadyMember": false, "registrationOpen": true }
```

团队已关闭时 `team` 为 `null`，`inviterName`、`contactName` 为空串。`inviterName` 是生成这条链接的人（他在团队里用的名字，离开团队之后也还是这个名字）。`contactName` 是链接用不了时该找谁重新生成：生成它的人还能再生成（还在团队里，是团长或管理员）就是他，否则是团长——不会是已经离开、被移除或账号已删除的人。`remainingUses` 是这条链接还能让几个人加入（「还可以用 8 次」）：链接 `valid` 且自己有次数限制时是数字；不限次数、或 `state` 不是 `valid` 时为 `null`。预览对链接的使用情况只说这一项：不说一共多少次，不说用掉了几次，也不说谁用过。请求带了凭证时 `alreadyMember` 说的是调用者。预览里永远没有团队内部的任何内容。

接受邀请：调用者已经在团队里时返回 `already: true`，不消耗次数。拒绝的情况：`404 invite.not_found`（邀请码不存在，或团队已关闭）、`410 invite.expired`、`410 invite.used_up`、`410 invite.revoked`、`409 invite.team_full`（达到 `teamMaxMembers` 或这个团队单独的人数上限）、`401 auth.required`。

**注册。** 邀请链接不能用来注册账号。站点关闭注册后，`POST /api/auth/register` 一律返回 `403 auth.registration_closed`，不管请求里带了什么；预览里的 `registrationOpen` 让加入页如实说明，而不是引导去注册。

### 权限矩阵

`✓` 可以，`—` 不可以，`△` 有条件（见备注）。「标识」一列就是 bootstrap 和团队详情里 `permissions` 的键。这张表和服务端做判断用的是同一张（`server/src/services/permissions.js`），两者不一致时测试会失败。

| 操作 | 标识 | 团长 | 管理员 | 成员 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 新建画布 | `canvas:create` | ✓ | ✓ | ✓ | |
| 改、删自己建的画布 | `canvas:edit_own` | ✓ | ✓ | ✓ | 删除后 30 天内，团长和管理员可以恢复 |
| 看别人的画布 | `canvas:view` | ✓ | △ | △ | 管理员和成员：只能看「团队可看」「团队可改」的。团长看得到全部，包括「仅自己」的 |
| 改别人的画布 | `canvas:edit` | ✓ | △ | △ | 管理员和成员：只能改「团队可改」的 |
| 删别人的画布 | `canvas:delete` | ✓ | △ | — | 管理员：自己看得到的 |
| 改画布的可见范围 | `canvas:set_visibility` | ✓ | △ | △ | 管理员：自己看得到的；成员：自己建的 |
| 接管别人正在编辑的画布 | `canvas:take_over` | ✓ | △ | △ | 能编辑这张画布的人：对管理员和成员来说是自己建的和「团队可改」的 |
| 保存冲突时用自己的版本覆盖 | `canvas:overwrite` | ✓ | △ | △ | 管理员：自己能编辑的；成员：自己建的 |
| 恢复已删除的画布 | `canvas:restore` | ✓ | ✓ | — | 删除后 30 天内 |
| 创建对外分享链接 | `share:create` | ✓ | △ | △ | 自己能编辑的画布。团队设置为「只有团长和管理员能分享」时成员不行 |
| 查看和撤销任何人的分享链接 | `share:manage_all` | ✓ | ✓ | — | 成员只能看到和撤销自己创建的 |
| 查看、使用、上传团队资产、模板、提示词片段 | `asset:use` | ✓ | ✓ | ✓ | 自己加的自己能改、能删 |
| 改、删别人加的资产、模板、片段 | `asset:manage_all` | ✓ | ✓ | — | |
| 新建、修改、删除品牌包 | `brandkit:manage` | ✓ | ✓ | — | 成员只能选用 |
| 配置服务商、Key、自定义模型、价格，启停模型 | `provider:manage` | ✓ | ✓ | — | 成员看得到名称、模型和价格，看不到 Key、Key 的末几位和接口地址 |
| 用团队的 Key 运行模型 | `run:create` | ✓ | ✓ | ✓ | 受每月上限约束 |
| 生成、撤销邀请链接 | `invite:manage` | ✓ | ✓ | — | |
| 移除成员 | `member:remove` | ✓ | △ | — | 管理员只能移除成员，不能移除团长和其他管理员 |
| 设为管理员、取消管理员 | `member:set_role` | ✓ | — | — | |
| 看自己的记录和用量 | `usage:view_own` | ✓ | ✓ | ✓ | |
| 看全队的记录和用量 | `usage:view_all` | ✓ | △ | — | 管理员：团长打开「管理员也能看全队记录」之后（默认关） |
| 设团队和成员的每月上限，删除生成记录 | `limits:manage` | ✓ | — | — | |
| 查看团队动态 | `activity:view` | ✓ | ✓ | — | |
| 改团队名称和头像 | `team:rename` | ✓ | ✓ | — | |
| 改团队设置（默认可见范围、分享、时区等） | `team:settings` | ✓ | — | — | |
| 转让团长 | `team:transfer` | ✓ | — | — | |
| 解散团队，或在 7 天内恢复 | `team:dissolve` | ✓ | — | — | |
| 退出团队 | `team:leave` | — | ✓ | ✓ | 团长要先转让或解散 |

被拒绝时返回 `403 team.forbidden`；例外是「看不到」本身就是拒绝的情况：别人的「仅自己」画布、对成员来说别人的分享链接，返回 404。`usage:view_all` 不是拒绝而是收窄：没有它的人拿到的只是自己的记录（`scope: "own"`）。

### 团队里的画布

所有返回画布的接口（`GET /api/workflow/list`，`POST /api/workflow`，`GET`、`PUT /api/workflow/:id`，`duplicate`、`restore`、`PATCH …/access`、`PATCH …/meta`）都多了下面这些字段，个人空间也有：

| 字段 | 含义 |
| --- | --- |
| `spaceId` | `"personal"` 或团队 id |
| `visibility` | 个人空间为空串。团队里：`private`（仅自己，团长也看得到）、`team_view`（团队可看：所有人能看、能复制一份，创建者和团长能改）、`team_edit`（团队可改：所有人能改，同一时间一个人） |
| `createdBy` | Person。个人空间里就是调用者 |
| `revision` | 整数，每保存一次内容加 1，见[保存与冲突](#保存与冲突) |
| `metaRevision` | 整数，画布改名（或清掉 `legacyLayout` 标记）时加 1。它不参与任何冲突判断，只用来告诉打开着的编辑器「你显示的名字过时了」 |
| `lastEditedBy`、`lastEditedAt` | 最后一次保存内容的人和时间，还没保存过为 `null`。改名不算 |
| `lock` | `null`，或有人正在编辑时为 `{ by: Person, at, expiresAt, mine, sameUser }`：卡片和编辑器上显示「某某 正在编辑」。`sameUser`：持有人就是调用者自己的账号。`mine`：就是当前这个编辑会话（请求用 `sessionId` 指明了自己）；`sameUser && !mine` 就是「你在另一个标签页里」。持有人自己拿到的返回里还带 `releaseToken`。见[编辑锁](#编辑锁) |
| `access` | 调用者对**这张**画布能做什么：`{ canView, canEdit, canDelete, canSetVisibility, canTakeOver, canOverwrite, canShare }`。个人空间里除 `canSetVisibility`、`canTakeOver` 为 `false` 外都是 `true` |

| 方法 | 路径 | 请求体 / 参数 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/workflow/list` | 团队里可用 `?mine=1`（我创建的）、`?member=<账号 id>`、`?visibility=…`，只会在调用者看得到的范围内缩小 | 列表项，各带上面的字段 |
| POST | `/api/workflow` | `{ …, visibility? }` | 团队里新画布用 `visibility`，没传就用团队的 `defaultVisibility`；`createdBy` 是调用者 |
| PATCH | `/api/workflow/:id/access` | `{ visibility }` | 画布。仅团队（个人空间返回 `400 canvas.personal_no_visibility`）。谁可以：创建者、团长、看得到它的管理员（`canvas:set_visibility`）。不改变 `revision` |
| PATCH | `/api/workflow/:id/meta` | `{ name?, viewport?, legacyLayout? }` | 画布。改名（或保存视口），不需要编辑锁，也不需要版本号，见[保存与冲突](#保存与冲突)。谁可以：能编辑它的人 |
| POST | `/api/workflow/:id/duplicate` | `{ name? }` | 同一个空间里的副本。团队里副本归调用者，默认 `private`。素材只引用、不复制 |
| POST | `/api/workflow/:id/copy` | `{ toSpace: "personal" \| <团队 id>, name? }` | `{ workflowId, spaceId, files }`：复制到调用者所在的**另一个**空间 |
| DELETE | `/api/workflow/:id` | | 软删除。谁可以：创建者、团长、看得到它的管理员 |
| GET | `/api/workflow/trash` | | 最近 30 天删除的画布，各带 `deletedAt`、`deletedBy`、`restorableUntil`。团队：团长和管理员（`canvas:restore`）；个人空间：本人 |
| POST | `/api/workflow/:id/restore` | | 恢复后的画布。同上；超过 30 天返回 404 |

**跨空间复制**（`/copy`）：个人空间复制到团队，或团队复制到调用者的个人空间、调用者的另一个团队。副本归调用者，在团队里默认 `private`。**文件一起复制**：画布引用的每个已存文件都在目标空间名下另存一份（`files` 是数量），所以源空间被删除后副本不受影响。品牌包不带过去（`brandKitId: ""`，节点上的例外被去掉）；模型 id 在目标空间里查，目标空间没有的模型，节点会要求重新选择。错误码：`400 space.same_space`（同一空间请用 `duplicate`）、`404 team.not_found`（不是目标团队的成员）、`403 space.copy_out_disabled`（团长关掉了 `copyToPersonal`，团长自己仍然可以）、`400 space.copy_too_large`（超过 300 个文件或 2 GiB）。

### 编辑锁

同一张团队画布同一时间只有一个人能改，没有任何形式的实时协作。画布的**编辑锁**同一时间只属于一个**编辑会话**，其他人打开时是只读的，同一个人开的第二个标签页也一样。

**会话 id。** 一个编辑会话就是一个打开着的编辑器，也就是一个浏览器标签页。客户端为它生成一个随机 id（`sessionId`：8 到 64 个 `A-Z a-z 0-9 _ -` 字符，比如去掉横线的 UUID），之后所有和锁有关的调用都带上它：`POST …/lock` 和 `PUT /api/workflow/:id` 放在 JSON 请求体里，`DELETE …/lock` 放在查询参数里，`GET /api/workflow/:id` 也可以带（`?sessionId=…`，带了之后返回里的 `lock.mine` 才是准确的）。它是请求体字段而不是请求头，所以跨域部署不用多放行一个请求头。任何返回里都不会出现这个 id。不带这个 id 的客户端，每个账号算一个隐含的会话（空串），老客户端就是这样；它和带 id 的会话互不相通。

| 方法 | 路径 | 请求体 / 参数 | 返回 |
| --- | --- | --- | --- |
| POST | `/api/workflow/:id/lock` | `{ sessionId, takeover? }` | `{ lock, state, revision, metaRevision, name, ttlMs, heartbeatMs, pollMs, ttlSeconds, heartbeatSeconds }`：拿锁，或续期（心跳） |
| GET | `/api/workflow/:id/lock` | `?sessionId=…`（可选） | `{ lock, revision, metaRevision, name, canEdit, canTakeOver, ttlMs, heartbeatMs, pollMs }`：只看一眼锁，不拿也不续。只读的编辑器轮询的就是它。谁可以：看得到这张画布的人 |
| GET | `/api/workflow/locks` | `?since=…`（可选） | `{ locks: [{ id, lock }], pollMs, now, counts, changed?, removed?, reload? }`：画布列表轮询的就是它 —— 这个空间里调用者看得到的画布上现在有效的锁；带了 `since` 时还有列表上别的变化（见下面的「列表轮询带回什么」）。个人空间里是 `{ locks: [], pollMs }` |
| DELETE | `/api/workflow/:id/lock?sessionId=…` | | `{ released }`：归还这个会话的锁；本来就没持有时为 `false` |
| POST | `/api/workflow/:id/lock/release` | `{ releaseToken }`，**公开**，不需要 `Authorization` | `{ released }`：页面关闭时归还锁，见下 |

```json
{ "lock": { "by": Person, "at": "2026-10-13T08:00:00.000Z", "expiresAt": "2026-10-13T08:00:36.000Z",
            "mine": true, "sameUser": true, "releaseToken": "pV3…43 characters" },
  "state": "acquired", "revision": 12, "metaRevision": 3, "name": "Storyboard",
  "ttlMs": 36000, "heartbeatMs": 12000, "pollMs": 5000, "ttlSeconds": 36, "heartbeatSeconds": 12 }
```

- **时间：36 秒和 12 秒。** 锁在最后一次续期之后 `ttlMs` = **36 秒**失效；编辑器每 `heartbeatMs` = **12 秒**再调一次 `POST …/lock` 续期，每次保存内容也会续期。一个有效期里有三次心跳，所以连续丢两次续期（网络慢、笔记本刚唤醒）画布也不会被让给别人；而一个没来得及打招呼就没了的标签页（崩溃、断网）最多让别人等 36 秒。正常关闭或跳走的标签页会立刻归还锁（下面的释放信标）。这些数字客户端从返回里读，不要写死。`at` 是拿到锁的时间，续期不改变它。
- **等的人：5 秒和 10 秒。** `pollMs` = **5 秒**是只读的编辑器在标签页可见时多久调一次 `GET …/lock`：持有人关掉标签页之后，5 秒内就会出现「开始编辑」；标签页是死掉的，最多 36 + 5 秒。画布列表在可见时每隔它那个返回里的 `pollMs` = **10 秒**调一次 `GET /api/workflow/locks`。标签页隐藏时两者都不问，重新显示时立刻问一次。
- **列表轮询带回什么。** `GET /api/workflow/locks?since=<上一次返回里的 now>` 还会说出从那以后调用者的列表上变了什么，这样别人改的名字、新建的画布、删掉的画布在 `pollMs` 之内就出现，不用重新取整个列表。`changed`：调用者看得到的画布里，从那以后新建、改名、保存或恢复过的，每一项和 `GET /api/workflow/list` 给的一模一样（从不带节点）。`removed`：从那以后被删掉的画布的 id。`now`：服务端的时钟，下一次原样当 `since` 送回来 —— ISO 时间或毫秒数都行；第一次调用可以送手上那份列表里最新的 `updatedAt`。变化从 `since` 往前两秒算起，所以同一张画布可能被列两次：先合 `changed`，再去掉 `removed`，只换掉内容不同的卡片。`counts`：`{ total, private, team_view, team_edit }`，列表现在会给调用者多少张。可见范围的改动不逐个列出 —— 变成「仅自己」的画布不会把名字告诉再也看不到它的人 —— 所以客户端手上的列表和 `counts` 对不上时就重新取列表；返回里有 `reload: true` 时也一样（变了的超过 50 张，这时不带 `changed` 和 `removed`）。不带 `since` 就没有 `changed` 和 `removed`。视口和编辑锁不算列表的变化。服务端读一次这个空间的画布（不读节点，最多 200 张，和列表一样）。
- **`state`** 说明这次调用做了什么：`"acquired"`（画布是空的，或者锁已经过期，现在归这个会话）、`"renewed"`（这个会话本来就持有，续上了）、`"reacquired"`（这个会话自己的锁过期了，期间没有别人来拿：接着改就行）、`"taken_over"`（从持有它的会话手里接管过来）、`"none"`（个人空间）。
- **`revision`、`metaRevision`、`name`** 是画布当前的值。打开着的编辑器就是靠心跳知道画布在别处被改了名：`metaRevision` 和自己记的不一样，就显示返回里的 `name`。
- **拿锁。** `POST …/lock` 要求调用者能编辑这张画布（否则 `403 team.forbidden`，例如别人的 `team_view`（团队可看）画布）。别的会话持有有效的锁时返回 HTTP **423**：

  ```json
  { "result": -1, "code": "canvas.locked", "message": "Zhou Yu is editing this canvas. You can only view it for now",
    "data": { "lock": { "by": Person, "at": "…", "expiresAt": "…", "mine": false, "sameUser": false },
              "canTakeOver": true, "lost": null, "ttlMs": 36000, "heartbeatMs": 12000, "pollMs": 5000 } }
  ```

  `data.lock.sameUser: true` 表示持有人就是调用者自己的账号，在另一个标签页或另一台设备上（`message` 是「你在另一个标签页…正在编辑这张画布」）。`data.lost` 告诉一个**曾经持有**这把锁的会话它是怎么丢的：`"taken_over"`（被 `data.lock.by` 主动接管）、`"expired"`（锁过期了，之后有人开始编辑）；从没持有过的会话是 `null`。这几种情况的 `message` 是不同的句子，按读者的语言给出；`code` 始终是 `canvas.locked`。
- **接管。** `{ "takeover": true }` 把锁从持有人手里拿过来。能编辑这张画布的人都可以（`canvas:take_over`），从自己的另一个标签页接管也是这样。从**别人**手里接管会记入团队动态，从自己手里接管不记。服务端不会主动通知原持有人：它的下一次心跳或下一次保存会收到 `423 canvas.locked`，带 `lost: "taken_over"`。它已经保存的不会丢；还没保存的仍在那个标签页里。
- **归还。** 在应用内离开编辑器：带着平常的请求头调 `DELETE …/lock?sessionId=…`。**页面本身要没了**（`pagehide`）：`navigator.sendBeacon('/api/workflow/<id>/lock/release', JSON.stringify({ releaseToken }))`。正在关闭的页面发 `fetch` 不保证能发完，而 `sendBeacon` 带不了 `Authorization` 请求头，所以这一个接口是公开的，凭的是这把锁的**释放令牌**：只发给持有人的一个值（这个会话持有锁时，`POST …/lock`、`PUT`、`PATCH …/meta`、`GET …?sessionId=…` 返回的 `lock.releaseToken`），它只对应某一个会话的某一把锁，只能释放这一把，锁一旦换了人就不再有任何意义。请求体是 JSON，以 `text/plain` 发送（`sendBeacon` 发字符串时就是这样，不触发 CORS 预检），也可以是 `application/json`（带 `keepalive: true` 的 `fetch` 同样可用）。返回永远是 `200 { released }`，令牌对不上任何当前的锁时为 `false`，所以猜的人从返回里什么都看不出来。令牌是对这把锁做 HMAC 得到的 256 位，猜不出来；为了不让匿名调用者拿它消耗数据库，同一个地址一分钟超过 120 次的调用直接回 `released: false`，不查库（没这样还掉的锁会自己过期），请求体超过 2 kB 是 `413`。页面关闭时**还在路上的那次保存**——编辑器在同一瞬间把没保存的存掉并发出信标，而小小的信标常常先到——照样写入，并且**不会**把锁再拿回来：归还之后 30 秒内，归还的那个会话再来保存内容，看到画布是空的，就让它继续空着。
- **后台标签页。** 浏览器会放慢隐藏标签页的定时器：一隐藏就降到一秒一次（12 秒一次的心跳不受影响）；Chrome 在标签页隐藏满五分钟后降到**一分钟**一次。一分钟比锁的 36 秒有效期长，这是有意的：五分钟没人看的标签页不该占着画布不让在看的人用。所以隐藏不到五分钟的标签页一直持有锁；更久的会在两次心跳之间丢掉它。期间没人来拿：它下一次（迟到的）心跳，或者重新显示时立刻补的那一次（监听 `visibilitychange`），返回 `200`、`state: "reacquired"`——还是同一把锁，`at` 和释放令牌都不变，什么都没变。期间有人开始编辑了：那次心跳返回 `423`、`lost: "expired"`。锁已过期的会话直接保存也一样：只要没有别的会话持有，保存成功，原来那把锁接着用。如果别人在它离开期间改过**又走了**，心跳会拿到画布（`state: "acquired"`），但 `revision` 不是它记的那个：编辑之前必须重新载入（手上有没保存的改动时不载入，让下一次保存照实报冲突）。
- `409 canvas.lock_busy`：调用的那一瞬间锁正好换了人。很少见，再调一次即可。
- **个人空间**没有锁：这个调用直接成功，返回 `lock: null`、`state: "none"`，编辑器不用先判断自己在哪种空间。个人空间里两个标签页互相覆盖，和以前一样靠下面的版本检查挡住。
- 成员被移除时他的锁立即释放；团队被解散或停用时全部锁释放。

### 保存与冲突

保存分两种，由请求里带了哪些字段决定：

| | 内容 | 元信息 |
| --- | --- | --- |
| 字段 | `nodes`、`edges`、`settings`、`brandKitId` | `name`、`viewport`、`legacyLayout` |
| 接口 | `PUT /api/workflow/:id` | 只带这些字段的 `PUT /api/workflow/:id`，或 `PATCH /api/workflow/:id/meta` |
| 需要 | 能编辑这张画布；团队里还要有编辑锁（这个会话持有，或者画布空着）和 `baseRevision` | 能编辑这张画布，别的都不需要 |
| 改变 | `revision` 加 1、`lastEditedBy`、`lastEditedAt`、`updatedAt`；拿到或续上锁 | 改了 `name`：`metaRevision` 加 1、`updatedAt` 更新。清掉 `legacyLayout`：`metaRevision` 加 1。`viewport`：别的都不动 |

封面（`thumbnail`）是每次保存内容时从节点里算出来的；可见范围有[单独的接口](#团队里的画布)。

**保存元信息**，最常见的是改名。它不要求锁，也不拿锁，不看 `baseRevision`，不改变 `revision`。所以别人正在编辑时，可以从列表里给画布改名；那位编辑者的下一次保存内容**不会**因此冲突；他从下一次心跳或保存的返回里（`name`、`metaRevision`）得知新名字。`PATCH /api/workflow/:id/meta` 是同一件事加一道保险：请求体里带了内容字段会被拒绝（`400 canvas.meta_only`），而不是悄悄变成一次内容保存。谁可以：能编辑这张画布的人（`access.canEdit`；只能看的人 `403 team.forbidden`，看不到的画布 `404`）。`PUT { name }` 且不带别的字段，也就是以前客户端改名的做法，同样是元信息保存。

**保存内容**多了两个字段 `baseRevision` 和 `force`，团队里还有 `sessionId`：

- 保存内容会让 `revision` 加 1；返回的画布带着新的 `revision`，它就是客户端下一次保存的 `baseRevision`。
- 带了 `baseRevision` 时，只有画布仍然停在这个版本才会保存。否则**什么都不写**，返回 HTTP **409**：

  ```json
  { "result": -1, "code": "canvas.conflict", "message": "Somebody else changed this canvas. Your changes were not saved",
    "data": { "revision": 14, "baseRevision": 12, "updatedAt": "…", "lastEditedAt": "…", "lastEditedBy": Person, "canOverwrite": false } }
  ```

- `"force": true` 跳过版本检查，用调用者的版本覆盖更新的版本。允许的人：画布的创建者、能编辑它的管理员、团长（`canvas:overwrite`；冲突返回里和 `access` 里的 `canOverwrite`），其他人 `403 team.forbidden`。覆盖会记入团队动态。
- **团队空间**里保存内容**必须**带 `baseRevision`（否则 `400 canvas.base_revision_required`）；**别的会话**持锁时（别人，或者调用者自己的另一个标签页）返回 `423 canvas.locked`；保存成功的同时为调用者的会话拿到或续上锁。
- **个人空间**里 `baseRevision` 可以不带：不带就是一直以来的「后写覆盖」（单独嵌入编辑器时的适配器靠的就是这个）；带上之后，第二个标签页就不会不声不响地盖掉第一个，它会收到上面的 409。
- 同时带了内容和元信息的保存算内容保存，要么整个写入，要么整个被拒绝。编辑器保存内容时不要带 `name`，除非名字就是在这个编辑器里改的：库里的名字可能比它显示的新。
- **同一时间只发一个保存。** 同一张画布不能有两个保存内容的请求同时在路上：第二个带的版本号正要被第一个替换，会被自己的前一次保存判成冲突。

版本检查不依赖锁：锁过期了、被接管了，最后挡住覆盖的就是它。

### 团队的服务商、模型和价格

团队有自己的一套服务商、Key、自定义模型、模型设置和价格，用普通的 `/api/admin/providers`、`/models` 接口加 `X-Space: <团队 id>` 管理。**团队空间里只有团队的服务商**：成员个人的服务商和 Key 在这里不存在，用个人服务商的模型 id 会得到 `400 model.provider_missing`。反过来也一样：团队的 Key 永远不会用在个人空间的运行上。

- 团长和管理员（`provider:manage`）能做个人空间主人能做的一切：添加服务商、换 Key、测试连接、添加自定义模型、启停模型、填价格。他们看到的也和个人空间一样：是否已设置 Key 和末四位，永远没有 Key 本身。
- 成员可以调用读取类接口：`GET /api/models`、`POST /api/runs/estimate`、`GET /api/admin/models`（含价格）、`GET /api/admin/vendors`、`GET /api/admin/providers`。成员拿到的服务商对象是**受限的**：`"restricted": true`、`"keyTail": ""`、`"baseUrl": ""`、`"customBaseUrl": false`、`"lastTest": null`，只有名称、模型、是否启用（`enabled`）、是否已配置 Key（`hasKey`）和该找谁（`maintainer`）。每个服务商对象都带 `restricted`（能管理它的人为 `false`）。所有写操作和测试连接对成员返回 `403 team.forbidden`。
- **维护人和最近一次测试。** 每个服务商带 `maintainer`：最后一次改动它（名称、地址、Key、启停、自定义模型）的人，是一个 [Person](#成员)（开始记录之前的服务商：填 Key 的人，或创建它的人），以及 `updatedAt`。能管理服务商的人还会拿到 `lastTest`：对当前保存的这份配置最近一次测试连接的结果 `{ ok, at, message }`，`message` 按读者的语言给出；从没测过、或测过之后 Key 或地址变了，为 `null`。成员永远拿不到 `lastTest`，因为失败的原因里可能带着上游的原话。测试不算改动：`maintainer` 和 `updatedAt` 都不变。
- [已保存的 Key 只会发往保存时的那个地址](#服务商)，这条规则对团队和个人的服务商一视同仁。

### 团队里的运行、上限和用量

带 `X-Space` 的 `POST /api/runs`、`POST /api/llm/tasks` 运行的是**团队的模型，用的是团队的 Key**，结果文件存在团队名下，运行记录上记着是谁发起的。团队的任何成员都可以按 id 查看团队的运行（`GET /api/runs/:id`、`POST /api/runs/status`），因为画布上的结果对能打开这张画布的人都可见；取消运行只有发起人、团长和管理员可以。带提示词的记录列表是另一回事，见[团队的用量](#团队的用量)。

**排队。** 队列仍然按人公平：一个账号不管在个人空间还是团队里跑，在队列里都是同一个人，受同一个 `userConcurrency` 和 `userQueueLimit` 约束。此外一个团队同时在跑的运行有一个合计上限（`teamConcurrency`，默认 4；超级管理员可以给某个团队单独设），防止一个大团队占满整个实例。

#### 每月上限

两个单位，按月：**运行次数**和**预估金额**。各自可以给整个团队设，也可以给成员设（全员默认值，和某个成员单独的值）。

**「已用」只有一个定义**，不管它出现在这个返回里、成员列表里、拒绝的返回里，还是用量接口里：

> **已用 = 已成功 + 进行中**

「已成功」是正常跑完的运行。「进行中」是还在排队、运行或转存的运行：一条运行从被接受的那一刻起就占着它的名额。**失败和取消的不计**：运行失败，它占的名额和金额都退回。一条运行记录算一次，不管它的 `count` 是几张。返回里始终带着这个数字背后的明细，所以页面可以写「已用 804：成功 801、进行中 3；失败 12、取消 4 不计」，不用再调一次接口，也不会出现第二种算法。

```json
{
  "month": "2026-10", "timezone": "Asia/Shanghai",
  "startsAt": "2026-09-30T16:00:00.000Z", "resetsAt": "2026-10-31T16:00:00.000Z", "resetsAtLocal": "2026-11-01 00:00 (Asia/Shanghai)",
  "currency": "CNY", "blockUnpriced": true, "nearRatio": 0.8, "counted": ["succeeded", "inProgress"],
  "member": {
    "runs": { "used": 132, "limit": 400, "remaining": 268 },
    "amount": { "used": 61.4, "limit": null, "remaining": null },
    "uncounted": 3,
    "custom": { "runs": true, "amount": false },
    "breakdown": {
      "succeeded": { "runs": 130, "amount": 60.4, "unknownCost": 3 },
      "inProgress": { "runs": 2, "amount": 1.0, "unknownCost": 0 },
      "failed": { "runs": 7 }, "canceled": { "runs": 1 },
      "counted": { "runs": 132, "amount": 61.4 },
      "unknownCost": 3
    },
    "effective": {
      "runs": { "used": 132, "limit": 400, "remaining": 268, "state": "ok" },
      "amount": { "used": 61.4, "limit": null, "remaining": null, "state": "unlimited" },
      "state": "ok", "blockedBy": null, "uncounted": 3
    }
  },
  "team": { "runs": { "used": 804, "limit": 2000, "remaining": 1196 }, "amount": { "used": 388.2, "limit": 500, "remaining": 111.8 }, "uncounted": 21,
            "breakdown": { "…": "as above" }, "effective": { "…": "as above; blockedBy is team_runs, team_amount or null" } },
  "managers": { "owner": { "id": "670e…b2", "name": "Lin Zhou" }, "admins": [ { "id": "670f…11", "name": "Zhou Yu" } ] },
  "cannotRun": { "moneyLimited": true, "blockUnpriced": true,
                 "models": [ { "id": "gaorui:some-model", "label": "Some model", "reason": "unpriced", "modelCurrency": "", "code": "budget.unpriced_model" } ] },
  "memberDefault": { "runs": 300, "amount": null },
  "members": [ { "id": "670f…11", "name": "Zhou Yu", "username": "zhouyu", "role": "admin", "runs": {}, "amount": {}, "uncounted": 0, "custom": {}, "breakdown": {}, "effective": {} } ],
  "uncountable": [ { "id": "gaorui:some-model", "label": "Some model", "reason": "unpriced", "modelCurrency": "", "code": "budget.unpriced_model", "blocked": "everyone" } ],
  "unpriced": { "models": 1, "moneyLimited": "everyone", "blockUnpriced": true, "blocked": "everyone", "effect": "refused" }
}
```

- `member` 是调用者自己本月的数字，始终有；`managers` 和 `cannotRun`（见下）也始终有。`team`、`memberDefault` 只有拥有 `usage:view_all` 的人才有；`members` 也是（每个成员一项，结构同 `member`，另加是谁），而且要带 `?members=1` 才给。`uncountable` 和 `unpriced` 只给团长和管理员。`limit: null` 表示不限。
- **`runs` / `amount`**：`used`、`limit`、`remaining`；`used` 就是 `breakdown.counted`。
- **`breakdown`**：`succeeded`、`inProgress`（次数、金额，以及其中有多少条的成本算不了）、`failed` 和 `canceled`（次数；它们不占金额）、`counted`（= 已成功 + 进行中，上限就是拿它来比的）、`unknownCost`（= `uncounted`）。
- **`effective`** 是同一批数字已经合成好的、客户端直接显示的结果，任何客户端都不用再自己从上限推状态：
  - `runs.state` / `amount.state`：`unlimited`（没设上限）、`ok`、`near`（用到上限的 `nearRatio` = 80% 起）、`reached`（用完了）；
  - `state`：两者里更严重的那个；只要 `blockedBy` 有值就是 `reached`；
  - `blockedBy`：**现在**发起一次新的运行会被哪个上限拒绝，值是拒绝码的后半段：`member_runs`、`team_runs`、`member_amount`、`team_amount`，或 `null`。成员自己的上限还有余量、但团队的已经用完时，他这里是 `blockedBy: "team_runs"`：告诉他被团队的上限挡住了，但不给他看团队的数字。
  - `uncounted`：见下。
- **`uncounted`**（= `breakdown.unknownCost`）是**运行**的条数：算一次运行、但金额算不了的那些。原因是模型没有价格、价格不是 `currency` 这种货币，或者（对话模型）上游没有报 token 用量。它们计入 `runs.used`，在 `amount.used` 里算 **0**。把它显示在金额旁边（「另有 3 次成本未知」），免得有人把这个合计当成全部。
- **`managers`** 说的是该找谁，带名字：`owner`（`{ id, name }`，只有他能设上限）和 `admins`（`[{ id, name }]`，和团长一样可以填价格）。每个成员都拿得到；名字就是成员列表里显示的那个。
- **`cannotRun`** 回答的是「**我**现在因为价格跑不了哪些模型」，按拒绝运行时用的同一条规则算好了给，模型下拉、运行按钮直接照着显示，不用自己去看价格和上限：
  - `moneyLimited`：调用者受金额上限约束（他自己的、成员默认值，或团队的）；
  - `blockUnpriced`：团队的那个开关；
  - `models`：调用者**现在**在上面发起运行会被拒绝的已启用模型，每一项带 `reason`（`unpriced`，或 `currency` 并在 `modelCurrency` 里给出模型的货币）和那次拒绝的 `code`。上面两项不同时为真时是空的。它是按调用者算的：`unpriced.blocked: "some"` 时，单独设了金额上限的成员拿到的有内容，其他人拿到的是空的。
  客户端根据 `cannotRun.models` 和 `managers` 显示「不能运行：没填价格，请联系〈团长 / 管理员〉」；模型不在清单里就什么都不显示。（模型的价格表里没有所选参数的那一档时，运行仍可能被拒绝；那种情况由拒绝的返回自己说明。）
- **`uncountable`** 是**模型**的清单：已启用、但金额上限算不了的模型（`reason` 为 `unpriced`，或 `currency` 并在 `modelCurrency` 里给出模型的货币），每一项带着在它上面运行会被拒绝时的 `code`，以及 `blocked`（对谁拒绝：`everyone`、`some` 只对有单独金额上限的成员、`none`）。**`unpriced`** 是对整个清单的同一个结论，可以直接显示：`moneyLimited`（到底谁受金额上限约束：团队或成员默认值设了金额上限是 `everyone`，否则 `some` 或 `none`）、`blockUnpriced`、`blocked`，以及 `effect`：
  - `refused`：这些人在这些模型上的运行会被拒绝，直到模型填了 `currency` 价格；
  - `runs_only`：`blockUnpriced` 关着：能运行，只计次数、不计金额（成为 `uncounted`）；
  - `none`：没有人受金额上限约束，这些价格不影响任何事。

| 方法 | 路径 | 谁可以 | 请求体 | 返回 |
| --- | --- | --- | --- | --- |
| GET | `/api/teams/:id/limits[?members=1]` | 任何成员 | | 上面的对象里调用者能看的部分。团队详情里也带（不含 `members`、`cannotRun`、`uncountable`、`unpriced`） |
| PUT | `/api/teams/:id/limits` | 团长（`limits:manage`） | `{ team?: { runs?, amount? }, memberDefault?: { runs?, amount? }, currency?, blockUnpriced? }` | 同上。数字是设上限，`null` 是取消；`runs` 必须是整数。下一次运行起生效 |
| PATCH | `/api/teams/:id/members/:userId` | 团长 | `{ limits: { runs?, amount? } }` | 某个成员单独的上限，`null` 表示跟 `memberDefault` |

`GET /api/teams/:id/members`（有 `usage:view_all` 时）每个成员带着同样的内容：`usage: { runs, amount, uncounted, currency, breakdown }`、`limits: { runs, amount, custom }` 和 `effective`。`GET /api/teams/:id/usage?limits=1` 在所查时间段的用量旁边，把整个对象放在 `limits` 里一起返回（见[团队的用量](#团队的用量)）。

规则：

- **月份**是团队时区（`timezone`，创建团队时指定的 IANA 时区名，没指定是 `UTC`）里的自然月，从当地 1 日 00:00 开始（`startsAt`）；`resetsAt` 是本月结束的时刻，`resetsAtLocal` 是同一时刻按该时区的写法。一条运行算在它提交时所在的月份；修改时区只影响之后提交的运行的月份边界。
- **金额**，每条运行：
  - *进行中*：被接受时**预留**的金额，即按模型价格算出的预估（`POST /api/runs/estimate`）；
  - *已成功*：运行记录上的成本（`cost.amount`），也就是同一个预估；
  - **按 token 计价的对话模型**是例外，因为它的成本跑完才知道。这样的运行在进行中时占着一笔**预留**：按实际发出的内容估出的输入价格（提示词和系统提示词每个字符算 1 个 token，每张图 1500，每个视频 20000），加上假定的最长回答的价格：模型声明里写了 `maxOutputTokens` 就用它，否则按 **8192** 个输出 token（环境变量 `BUDGET_CHAT_RESERVE_OUTPUT_TOKENS` 可以改）。跑完后，预留换成按上游报告的 token 用量算出的成本，多退少补。所以金额上限不会被正在跑的对话运行不声不响地超出：预留放不下的对话运行会被拒绝。上游没报用量时，这条运行最后是一条成本未知的运行（`uncounted`）。
  - 对话运行的预留最后怎么样：**成功**，换成真实成本；**失败**或**取消**，全额退回，和别的运行占的名额、金额一样；**成功了但上游没报 token 用量**，预留退回，这条运行成为成本未知的运行（计一次、金额算 0，即 `uncounted`）；**预留放不进剩下的额度**，提交时就被拒绝（`budget.member_amount` / `budget.team_amount`，`requestedKind: "reserve"`），哪怕真实成本通常只是预留的一小部分。想让对话运行卡得没那么松的团队，可以调小 `BUDGET_CHAT_RESERVE_OUTPUT_TOKENS`，或者给对话模型声明 `maxOutputTokens`。
  - 金额只按**一种货币**算，即 `currency`（默认 `CNY`）：别的货币的成本、未知的成本，对上限来说都不算钱。
- **到上限时拒绝新的运行**，HTTP `403`，错误码见下表。对每一项设了的上限，要 `已用 < 上限` 且 `已用 + 这一次 <= 上限` 才接受。已经在排队或运行的不受影响。先查次数、再查金额；每一项里先查成员的、再查团队的。
- **没填价格的模型。** 设了金额上限（团队的或成员的）且 `blockUnpriced` 打开（默认）时，成本算不了的模型被拒绝：`budget.unpriced_model`（没有价格）、`budget.currency_mismatch`（价格是另一种货币）。团长可以关掉 `blockUnpriced`，这类运行此后只计次数。
- 上限对团队里的每个人都生效，包括团长；不影响任何人的个人空间。
- **上限是精确的**，不管多少请求同时到、多少个服务进程连着同一个库：接受一条运行，是对团队当月计数文档的一次带条件的原子更新，这个文档里有团队的合计和每个成员的计数。一批同时提交的请求，放得下几条就恰好接受几条。计数文档是运行记录的缓存：没有它，或者读数时发现它和记录对不上，就从记录重算，所以显示的数字和拦截用的数字是同一个。**拒绝不会建立在一个错的计数上**：因为上限要拒绝一条运行之前，先拿计数文档和运行记录核对一次（每个团队、每个进程 30 秒内最多一次），如果因此重算过，这条运行会再试一次。
- 预估只和团队填的价格一样准；真实账单以上游为准。

拒绝。六种都是 HTTP `403`；`message` 是按读者语言写好的一整句话，带着具体数字；`data` 里是客户端自己组织提示所需要的全部：

| `code` | 什么时候 | `data` |
| --- | --- | --- |
| `budget.member_runs` | 调用者本月的次数已用完 | 上限数据，`scope: "member"`、`unit: "runs"` |
| `budget.team_runs` | 团队本月的次数已用完 | 上限数据，`scope: "team"`、`unit: "runs"` |
| `budget.member_amount` | 这次运行放不进调用者的金额上限 | 上限数据，`scope: "member"`、`unit: "amount"` |
| `budget.team_amount` | 这次运行放不进团队的金额上限 | 上限数据，`scope: "team"`、`unit: "amount"` |
| `budget.unpriced_model` | 设了金额上限，而这个模型没有价格 | 价格数据，`reason: "unpriced"` |
| `budget.currency_mismatch` | 设了金额上限，而这个模型的价格不是团队的货币 | 价格数据，`reason: "currency"` |

```json
{ "result": -1, "code": "budget.team_amount",
  "message": "This run (estimated at 0.5 CNY) does not fit into the team's amount limit for this month: 499.8 / 500 CNY are used. The count starts again on 2026-11-01 00:00 (Asia/Shanghai). Only the team owner (linzhou) can raise the limit",
  "data": { "scope": "team", "unit": "amount", "limit": 500, "used": 499.8, "remaining": 0.2, "requested": 0.5, "requestedKind": "estimate", "currency": "CNY",
            "month": "2026-10", "timezone": "Asia/Shanghai", "resetsAt": "2026-10-31T16:00:00.000Z", "resetsAtLocal": "2026-11-01 00:00 (Asia/Shanghai)",
            "canChange": { "roles": ["owner"], "owner": { "id": "670e…b2", "name": "linzhou" }, "admins": [] } } }
```

- **上限数据**（四个 `*_runs` / `*_amount` 错误码）：`scope`（`member` \| `team`：谁的上限）、`unit`（`runs` \| `amount`）、`limit`、`used`、`remaining`、`requested`（这次运行要占多少：`1` 次，或它的金额）和 `requestedKind`（这个数是什么：`run` 一次运行、`estimate` 这次运行的预估金额、`reserve` 按 token 计价的对话运行在知道真实成本之前占着的预留、`none` 成本算不了的运行，因为金额上限已经用完而被拒绝）、`currency`（次数为空串）、`month`、`timezone`、`resetsAt`（ISO 时刻：团队时区里下个月的开始）、`resetsAtLocal`，以及 `canChange`：`roles` 是 `["owner"]`（上限只有团长能设），`owner` 是 `{ id, name }`。
- **价格数据**（`budget.unpriced_model`、`budget.currency_mismatch`）：`scope`、`unit: "amount"` 和 `limit` 指出是哪个金额上限让价格变得要紧（成员有自己的就是成员的，否则是团队的）；`reason`；`model: { id, label }`；`modelCurrency`（没有价格时为空串）；`currency`（上限的货币）；`month`、`timezone`、`resetsAt`、`resetsAtLocal`；以及 `canChange`：`roles` 是 `["owner", "admin"]`（能管理服务商的人都可以填价格），带 `owner` 和 `admins: [{ id, name }]`。

这项检查还可能返回一个不是上限的结果：`503 budget.busy`，表示连续六次尝试都被计数文档上的其他改动抢了先。实际不会发生；客户端重试即可。

到 80% 的提醒由客户端根据 `effective.*.state === "near"` 显示，服务端不发通知。

#### 团队的用量

带 `X-Space: <团队 id>` 的 `GET /api/admin/usage`、`GET /api/admin/usage/records`，或者等价的 `GET /api/teams/:id/usage`、`GET /api/teams/:id/usage/records`，返回的是团队的运行：

- **看谁的记录。** 团长，以及团长打开 `adminsSeeAll` 后的管理员，看到全队的，可以用 `?member=<账号 id>` 筛选。其他人只看到自己的：他们传 `member` 参数会被忽略。返回里的 `"scope": "all" | "own"` 说明是哪一种。
- `groupBy=member`（仅团队）按成员分组：`key` 是账号 id，`member` 是 Person，`label` 是名字。
- **`limits=1`**（仅团队）在返回里加上 `limits`：就是 [`GET /api/teams/:id/limits`](#每月上限) 返回的本月对象（`groupBy=member` 时带 `members`）。一次调用、一种算法：所查时间段的用量看 `totals` / `items`，和上限有关的一切（`used`、进度条、明细）看 `limits`。
- 每一行都带着上限所计的数字，定义相同：`succeeded`、`inProgress`、`counted.runs`（= `succeeded` + `inProgress`），以及 `reserved`：进行中的运行占着的金额，按货币分。查询范围正好是本月时，`totals.counted.runs` 等于 `limits.team.runs.used`，`totals.costs[C] + totals.reserved[C]` 等于 `limits.team.amount.used`（`C` 是上限的货币）。`runs` 的含义没变：时间段内的全部记录，失败和取消的也在内；它数的是记录，不是「计入的」。
- `tz` 默认是团队的时区。
- 每条记录带 `createdBy`（Person），其余字段同一条[记录](#用量)。完整的一条记录（全部提示词和文字结果）用 `GET /api/teams/:id/usage/records/:recordId`（等价于带 `X-Space` 的 `GET /api/admin/usage/records/:recordId`）；调用者在列表里看不到的记录，这里同样是 `404 run.not_found`。
- 带 `X-Space: <团队 id>` 的 `POST /api/runs/download-zip` 把多条记录的结果打成一个 zip，规则相同：只包含调用者在列表里看得到的记录。
- 团队里的 `DELETE /api/admin/usage/records` 只有团长能调用（`limits:manage`），并且永远不会删本月的记录（上限按它们计算）：`before` 伸进本月时返回 `400 usage.current_month`。

没有导出 CSV 的接口，用量页用这些返回自己生成。

### 团队里的资产、品牌包、模板和分享链接

- **资产**（`/api/user-asset`）：团队的资产库。所有成员能看、能用、能添加；自己加的自己能改、能删，团长和管理员能改、删任何一条（`asset:manage_all`）。所有成员都能新建分组；**空的**分组由团长、管理员或创建它的成员删除，里面还有资产的分组只有团长和管理员能解散（见[我的资产](#我的资产--apiuser-asset)）。每条资产带 `scope`（`"team"` 或 `"personal"`）、`mine`、`canManage`、`uploaderName`、`createdBy`（Person，个人空间为 `null`）；列表带 `isTeamManager`。`POST /api/user-asset/:id/copy { toSpace }` 把资产复制到调用者所在的另一个空间，文件另存一份，返回 `{ id, spaceId, mediaUrl, thumbnailUrl }`（规则和错误码同复制画布）。`GET /api/spaces/copy-targets` 事先告诉界面一张画布或一条资产能复制到哪些空间、不能的原因是什么（见[复制到其他空间的目标](#复制到其他空间的目标)）。个人空间的资产在团队里看不到，要用就先复制过去。
- **品牌包**（`/api/brand-kits`）：所有成员能列出、能选用；新建、修改、删除只有团长和管理员可以（`brandkit:manage`）。每个品牌包带 `shared`（团队里为 `true`）、`mine`、`canManage`。
- **模板和提示词片段**（`/api/canvas/templates`、`/api/canvas/text-templates`）：内置的加上这个空间里保存的。新增接口：`POST /api/canvas/templates { title, description?, cover?, graph: { nodes, edges, viewport?, group? } }` 返回模板（`key` 由服务端生成）、`DELETE /api/canvas/templates/:key`、`POST /api/canvas/text-templates { title, content, category?, lang? }`、`DELETE /api/canvas/text-templates/:id`。所有成员都能保存；自己存的自己能删，团长和管理员能删任何人的；内置的删不了（`404 template.not_found`）。每个空间最多保存 200 个模板、200 个片段（`template.max`）。每一项带 `builtin` 和 `canDelete`，并说明是谁的：`createdBy`（保存它的人，一个 [Person](#成员)，他离开团队后名字仍在；内置的为 `null`）、`mine`、`createdAt`（内置的为 `null`）。这些接口在个人空间同样可用，那里的 `createdBy` 就是调用者自己。
- **工具和上传**（`/api/canvas/tool/*`、`/api/files/*`）：任何成员；文件存在团队名下。
- **分享链接**（`/api/canvas-share`）：能编辑画布的人就能发布它（`share:create`；`publicShare: "managers"` 时只有团长和管理员）。一张画布一条链接，谁再发布都是刷新它。`mine` 和 `plaza` 对团长和管理员列出团队的全部链接，对成员只列出他自己创建的；团队里每一项带 `createdBy`（Person）。成员可以修改、撤销自己的链接，团长和管理员可以处理任何一条（`share:manage_all`）；别人的链接对成员是 `404 share.not_found`。发布人离开团队后链接仍然有效，直到被撤销。`POST /api/canvas-share/:token/copy` 把副本放进请求作用的那个空间（团队里默认 `private`）。**对外链接就是公开的**：拿到链接的人不用登录就能看到快照。

### 团队动态

团队的管理操作记录：谁在什么时候做了什么。不记日常创作（保存画布、运行模型都不在里面），永远不含 Key、接口地址和提示词。接口不提供修改和删除；超过 `teamActivityDays`（默认 365，`0` 表示永久保留）的记录自动清除。

`GET /api/teams/:id/activity?category&actor&from&to&page&pageSize[&tz]`，团长和管理员（`activity:view`）。新的在前；`pageSize` 最大 200、默认 50；`from` / `to` 的写法同用量接口，默认按团队时区。

```json
{ "list": [
    { "id": "6715…", "type": "limits:member_changed", "category": "limits",
      "actor": { "id": "670e…b2", "username": "linzhou", "name": "Lin Zhou", "state": "active", "left": false, "deleted": false, "system": false },
      "target": { "type": "member", "id": "670f…11", "name": "Zhou Yu", "person": Person },
      "detail": { "before": { "runs": 200, "amount": null }, "after": { "runs": 400, "amount": null } },
      "message": "Lin Zhou changed the monthly limits of Zhou Yu", "createdAt": "…" } ],
  "categories": ["member", "invite", "provider", "limits", "canvas", "share", "team"],
  "total": 1, "page": 1, "pageSize": 50 }
```

一条动态就是 `type` + `actor` + `target` + `detail`：足够客户端用自己的话写出一句话。`message` 是服务端按读者语言（`X-Locale`）写好的一句话，留给客户端不认识的 `type` 兜底。

- **`actor`** 是一个 [Person](#成员) 加上 `system`。动态里的人按**他们今天在团队里的样子**显示：`name` 是这个人现在在团队里的显示名（不是用户名，也不是事发当时的名字），`state` 说明他是否还在团队。超级管理员从团队外面做的操作，`actor` 是 `{ "id": "", "username": "", "name": "The super admin", "state": "active", "system": true }`（`name` 按读者的语言给出，中文是「超级管理员」）。
- **`target`** 是被操作的对象：`{ type, id, name }`，`type` 为 `member`、`team`、`provider`、`model`、`canvas`、`share`、`invite` 之一；没有对象时为 `null`。`type: "member"` 时还带 `person`（Person），`name` 是这个人今天的名字。其他类型的 `name` 是事发当时的名称（邀请链接为空串）。
- **`detail`** 是改了什么，每种类型的结构见下表。这个结构是约定：只会加字段，不会改名。**每个字段都可能没有**：字段出现之前写下的动态没有它（`detail` 可能是 `{}`），这样的动态只用 `type`、`actor`、`target` 来写，或者直接用 `message`。`detail` 里提到账号的地方（`fromId`、`inviterId`、`createdById`），旁边的名字（`fromName`、`inviterName`、`createdByName`）在还查得到这个人时是他今天的名字，否则是事发当时的名字。`detail` 里永远没有 Key、接口地址和提示词。

| `category` | `type` | `target` | `detail` |
| --- | --- | --- | --- |
| `member` | `member:joined` | 这个成员（也是操作人） | `inviterId`、`inviterName`：用的是谁的邀请链接；`invitationId` |
| `member` | `member:left` | 这个成员（也是操作人） | `role`（`"admin"` \| `"member"`：他原来的角色）、`canvasesInherited`、`runsCanceled`（数字） |
| `member` | `member:removed` | 这个成员 | `role`、`canvasesInherited`、`runsCanceled`、`wasAdmin`（布尔）、`accountDeleted`（布尔：他的账号被超级管理员删除了，这时操作人是超级管理员） |
| `member` | `member:promoted`、`member:demoted` | 这个成员 | `from`、`to`：改之前和之后的角色（`"member"` \| `"admin"`） |
| `member` | `member:renamed` | 这个成员 | `from`、`to`：改之前和之后的显示名（空串表示没有，显示用户名）；`username` |
| `member` | `team:transferred`、`team:owner_appointed` | 新团长 | `fromId`、`fromName`：原团长。`owner_appointed` 是超级管理员指定的 |
| `invite` | `invite:created` | 这条链接（`name: ""`） | `maxUses`（0 表示不限）、`expiresAt`、`expiresInDays` |
| `invite` | `invite:revoked` | 这条链接 | `maxUses`、`usedCount`、`expiresAt`：链接被撤销时的样子；`createdById`、`createdByName`：创建它的人 |
| `provider` | `provider:created` | 这个服务商 | `vendor`、`enabled` |
| `provider` | `provider:deleted` | 这个服务商 | `vendor` |
| `provider` | `provider:key_changed` | 这个服务商 | `cleared`（布尔：Key 是被清除，而不是被替换）。永远不记 Key |
| `provider` | `provider:url_changed` | 这个服务商 | `custom`（布尔：现在用的不是厂商官方地址）。永远不记地址 |
| `provider` | `provider:updated` | 这个服务商 | `enabled`（启停变了才有：新的状态）；`renamed: true` 和 `from`、`to`（改了名称才有） |
| `provider` | `provider:model_added` | 这个服务商 | `model`、`kind`（`image` \| `video` \| `chat`） |
| `provider` | `provider:model_removed` | 这个服务商 | `model` |
| `provider` | `model:enabled`、`model:disabled` | 这个模型（`id` 是模型 id） | |
| `provider` | `model:price_changed` | 这个模型 | `priced`（布尔：现在有没有价格）；`before`、`after`：价格摘要，没有价格时为 `null`，见下 |
| `limits` | `limits:team_changed` | 团队 | `before`、`after`：`{ team: { runs, amount }, memberDefault: { runs, amount }, currency, blockUnpriced }`；`null` 表示不限 |
| `limits` | `limits:member_changed` | 这个成员 | `before`、`after`：`{ runs, amount }`，这个成员单独的上限；`null` 表示跟全员默认值 |
| `limits` | `usage:records_deleted` | `null` | `deleted`（数字）、`before`（请求里的日期） |
| `canvas` | `canvas:deleted`、`canvas:restored` | 这张画布 | |
| `canvas` | `canvas:visibility_changed` | 这张画布 | `from`、`to`：`private` \| `team_view` \| `team_edit` |
| `canvas` | `canvas:taken_over` | 这张画布 | `fromId`、`fromName`：编辑锁是从谁手里接管的 |
| `canvas` | `canvas:overwritten` | 这张画布 | `revision`：覆盖后得到的版本号 |
| `share` | `share:created` | 这条分享链接（`name` 是它的标题） | `expiresAt`（`null` 表示永不过期） |
| `share` | `share:revoked` | 这条分享链接 | `expiresAt` |
| `team` | `team:created`、`team:restored`、`team:suspended`、`team:resumed` | 团队 | |
| `team` | `team:renamed` | 团队 | `from`、`to`：改之前和之后的名称 |
| `team` | `team:avatar_changed` | 团队 | `removed`（布尔：头像是被去掉，而不是被替换） |
| `team` | `team:settings_changed` | 团队 | `changed`：改了哪些项的名字（`timezone` 或某个[团队设置](#团队设置)）；`before`、`after`：这些项改之前和之后的值，按同样的名字放在对象里 |
| `team` | `team:dissolved` | 团队 | `purgeAt` |

价格摘要（`model:price_changed`）：`{ unit, currency, price, by, tiers, min, max, input, output }`。`price` 是唯一的一个价格；价格随条件变化时为 `null`，这时 `by` 说明随什么变（`resolution`、`duration`、`resolution_duration`；按 token 计价且输入输出分开计价时为空串），`tiers` 是价格表里有几个价格，`min` / `max` 是其中最低和最高的，`input` / `output` 是按 token 计价时每百万 token 的输入、输出单价。

### 超级管理员与团队

仅超级管理员（其他账号 `403 auth.forbidden`）。超级管理员管的是团队的存在和规模，不是团队里的内容：这里的接口不返回任何团队的画布、Key、提示词或文件，只有名称和数字。超级管理员要进某个团队的空间，和别人一样得是它的成员。

**创建团队的授权。** `PATCH /api/admin/users/:id` 现在接受 `{ disabled?, canCreateTeams? }`（至少一个）。`canCreateTeams: false` 收回授权：不能再建新团队，已有的团队保留。`GET /api/admin/users` 的每一行多了 `canCreateTeams`（超级管理员恒为 `true`）和 `teams: { member, owned }`；`counts` 仍然是这个账号个人空间里的数量。

| 方法 | 路径 | 请求体 / 参数 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/admin/team-requests` | `?status=pending`（默认）`\| approved \| rejected \| all`、`page`、`pageSize` | `{ list, total, pending, page, pageSize }`；每一项是申请（`id`、`status`、`note`、`reason`、`createdAt`、`decidedAt`）加 `user: { id, username, email, disabled, canCreateTeams }`。`pending` 是待处理的总数，与筛选无关 |
| POST | `/api/admin/team-requests/:id/approve` | | 申请。同时授予这个账号创建团队的授权 |
| POST | `/api/admin/team-requests/:id/reject` | `{ reason? }` | 申请。账号看得到原因，可以再次申请。已经处理过的申请返回 `404 team.request_not_found` |
| GET | `/api/admin/teams` | | `{ teams: AdminTeam[], defaults: { teamMaxPerUser, teamMaxMembers, teamConcurrency, teamActivityDays } }` |
| PATCH | `/api/admin/teams/:id` | `{ maxMembers?: 1-1000 \| null, concurrency?: 1-32 \| null, status?: "suspended" \| "active" }` | AdminTeam。`null` 表示恢复用站点默认值 |
| GET | `/api/admin/teams/:id/members` | | `[{ id, username, role, disabled }]`，用来挑选新团长 |
| POST | `/api/admin/teams/:id/owner` | `{ userId }` | AdminTeam |
| POST | `/api/admin/teams/:id/restore` | | AdminTeam。在 7 天内撤销解散 |
| DELETE | `/api/admin/teams/:id?confirm=<团队名称>` | | `{ id, name, counts, filesRemoved, removed, files }`，见下 |

```json
{ "id": "6712…a0", "name": "Starlight Studio", "avatar": "/files/uploads/2026/10/….png", "status": "active",
  "owner": { "id": "670e…b2", "username": "linzhou", "usable": true },
  "counts": { "members": 7, "workflows": 41, "runs": 804 },
  "maxMembers": null, "concurrency": null, "effective": { "maxMembers": 50, "concurrency": 4 },
  "dissolvedAt": null, "purgeAt": null, "createdAt": "…" }
```

- **停用**（`status: "suspended"`）对所有人关闭团队，包括团长（`403 team.suspended`）：排队中的运行被取消，分享链接和邀请链接失效，编辑锁释放。不删除任何东西，也没有期限；`status: "active"` 重新开放。已解散的团队要用 `/restore` 恢复，不能用 `status`（`409 team.is_dissolved`）。
- **指定新团长**只在当前团长的账号不可用（已停用或已不存在，`owner.usable: false`）时才行，否则 `409 team.owner_usable`：账号可用的团长应当自己转让。新团长必须是团队成员且账号可用（`404 team.member_not_found`、`409 team.new_owner_unusable`）；原团长变成管理员。
- AdminTeam 里的 `avatar` 是团队头像的地址，没有头像时为空串（这时界面画名称的首字）。
- **永久删除团队**要求它已经关闭（已停用或已解散，否则 `409 team.still_active`），并在 `confirm` 里给出准确的团队名称（`400 team.confirm_mismatch`）。它立刻删除 7 天到期后清理任务会删除的一切。返回里说明删掉了什么：`counts` 按名字列出每一类，没有的那一类是 `0`：`{ members, invitations, activity, canvases, shares, assets, assetFolders, brandKits, providers, modelOverrides, runs, templates, textTemplates, files }`，和超级管理员看到的其他东西一样只有数字。`filesRemoved: false` 表示文档已经删掉，但文件还没有全部删完：存储没能及时删掉的部分会在后台继续删，连不上的会一直重试到删掉为止（服务端日志里写明文件留在哪里，见[存储](storage.zh-CN.md#存储连不上的时候)）。`removed`（按集合，为 0 的不出现）和 `files` 是同一组数字的旧写法。团队已经不存在时返回 `404 team.not_found`。
- **停用账号**不影响它的团队和成员身份；成员列表里它显示 `disabled: true`。它在团队画布上持有的编辑锁立即释放，别人不用等锁过期。它还在排队的运行会被取消，和成员被移除时一样（`PATCH /api/admin/users/:id` 的返回里有 `runsCanceled`），每一条都写明原因（`errorCode: "run.canceled_account_disabled"`，`error`：「排队时被取消：发起人的账号被超级管理员停用了」）；恰好在同一瞬间提交的那一条不会发往上游，而是以 `run.account_disabled` 失败；已经开始的运行跑完；这个账号不能再提交新的运行（`401`）。这些运行占着的团队每月上限名额随之退回。团队被解散或停用时，它还在排队的运行也是这样取消的（`run.canceled_team_closed`；恰好在同一瞬间被取出的那一条以 `run.team_closed` 失败）。团长被停用的团队照常运转，但没人能管，直到账号恢复或指定了新团长。
- **删除账号**（`DELETE /api/admin/users/:id`）：账号还是某个团队的团长时（不管团队是正常、停用还是已解散）拒绝，返回 `409 team.account_owns_teams`（提示里有团队名）：要先转让团长（或指定新团长），或者先删除团队。否则这个账号退出它所在的每个团队（效果同被移除），只删除它的个人空间；它在团队里做的东西留在团队，创建人显示为 `createdBy.state: "deleted"`，名字还是它当时用的名字。

团队相关的站点设置（`PUT /api/admin/settings`）：`teamMaxPerUser`（默认 3，1 到 100）、`teamMaxMembers`（默认 50，1 到 1000）、`teamConcurrency`（默认 4，1 到 32）、`teamActivityDays`（默认 365，0 到 3650，0 表示永久保留）。

### 客户端必须做的事

光看接口看不出来的流程：

1. **选择空间。** 当前空间放在页面地址里（团队页面的地址带团队 id），每个操作内容的请求带上 `X-Space`；个人空间不带或带 `personal`。用带这个头的 `GET /api/bootstrap` 取 `space.role`、`space.permissions`、`space.settings`。不要把 `X-Space` 发给别的来源。
2. **空间没了。** 任何接口返回 `team.not_found`、`team.dissolved`、`team.suspended`（或 bootstrap 里出现 `spaceError`）：离开团队的页面，回到个人空间，说明原因。一个人在打开着画布的时候被移除，也是这样得知的。
3. **打开团队画布。** 每个编辑器标签页生成一个随机的 `sessionId`，只放在内存里，标签页活多久它活多久（不要放 `localStorage`：两个标签页不能共用）。`GET /api/workflow/:id?sessionId=…`。`access.canEdit` 为 `false`：只读，不调锁接口。返回里已经带着一把不是 `mine` 的 `lock`：和下面的 423 一样按只读处理，不用再调锁接口。否则 `POST …/lock { sessionId }`。200：进入编辑，记下 `lock.releaseToken`，开始心跳，按返回里的 `heartbeatMs` 定时再调 `POST …/lock { sessionId }`。423：只读，顶部提示是谁：「`data.lock.by.name` 正在编辑」，`data.lock.sameUser` 为真时是「你在另一个标签页里打开着这张画布」；`data.canTakeOver` 为真时给「接管编辑」（`{ sessionId, takeover: true }`），另给「复制一份」。只读状态下不保存内容，也不能运行；但有编辑权的人照样可以改名（见 8）。
   **只读期间**，只要标签页可见，每隔 `pollMs` 调一次 `GET …/lock`：`lock: null` 表示画布空出来了，给出**开始编辑**（即 `POST …/lock`；不要替用户悄悄拿）；`metaRevision` 变了就是有了新的 `name`；`revision` 变了就是持有人保存过，重新载入画布显示出来；`canEdit` 说明调用者的权限有没有变。
4. **离开编辑器。** 在应用内离开：`DELETE …/lock?sessionId=…`，停止心跳。页面本身要没了（`pagehide`）：`navigator.sendBeacon('/api/workflow/<id>/lock/release', JSON.stringify({ releaseToken }))`，这是正在关闭的页面唯一能指望发出去的请求。两样都没做到，锁在 `ttlMs`（36 秒）后自己过期。
5. **心跳，以及后台标签页。** 每次心跳的返回带 `name` 和 `metaRevision`：`metaRevision` 变了就显示新的 `name`（画布在别处被改了名）；并从返回里取最新的 `lock.releaseToken`。`visibilitychange` 变为隐藏时：把没保存的保存掉（隐藏标签页的定时器会被放慢；标签页正在被关闭的话，这也是保存还发得出去的最后时机）。`visibilitychange` 变回可见时：立刻发一次心跳，不要等定时器。返回 `200` 且 `state: "reacquired"` 表示锁过期过、但没人来拿，接着改；返回 `423` 表示有人拿了。任何一次 `200` 之后，都拿返回的 `revision` 和编辑器所基于的那个比一下：变了就是期间有人改过，重新载入（手上有没保存的改动就留着，让下一次保存报冲突）。
6. **失去锁。** 心跳或保存返回 423：立刻切到只读，按 `data.lost` 和 `data.lock` 说明原因：`"taken_over"` 是「`by.name` 接管了编辑」；`"expired"` 是「这个标签页没有继续占用画布，现在 `by.name` 正在编辑」；`sameUser` 为真时是「…你自己的另一个标签页」。并提供把还没保存的内容**另存为副本**（用编辑器当前的文档调 `POST /api/workflow`，`visibility: "private"`）。不要重试保存。
7. **保存。** 同一时间只有一个保存内容的请求在路上；带 `sessionId` 和 `baseRevision` = 上一次返回的 `revision`（来自 `GET`、`PUT` 或 `lock`）；用返回里的新 `revision` 作为下一次的依据。保存期间发生的修改排队或合并到下一次。保存内容时不要带 `name`。
8. **改名。** `PATCH /api/workflow/:id/meta { name }`，列表里和编辑器标题上都用它，不管锁在谁手里，因为别人正在编辑而只读的编辑器里也一样。不带 `baseRevision`，不需要锁，永远不会冲突。没有 `access.canEdit` 的人不给这个入口，并说明原因。
   **画布列表**在可见时每隔 `pollMs` 调一次 `GET /api/workflow/locks?since=…`，只换掉变了的那几张卡片：谁正在编辑（`locks`），别人改的名字、新建 / 保存 / 恢复的画布（`changed`），被删掉的（`removed`）。只有 `counts` 和手上的对不上（有人改了可见范围）或者返回里有 `reload` 时才重新取列表。
9. **冲突**（`409 canvas.conflict`）：停止自动保存并询问，显示 `data.lastEditedBy.name` 和 `data.lastEditedAt`：**载入最新版本**（`GET`，放弃我的）、**把我的版本另存为副本**（默认按钮，`POST /api/workflow`），以及仅当 `data.canOverwrite` 为真时的**用我的版本覆盖**（带 `"force": true` 重发 `PUT`）。
10. **未登录时打开邀请链接。** `GET /api/team-invitations/:token` 不需要登录：显示团队和邀请人。记住邀请码，让访客去登录；只有 `registrationOpen` 为 `true` 时才提供注册，为 `false` 时说明本站目前不接受新账号；登录后回到这一页调 `POST …/accept`。`state` 不是 `valid` 时显示原因，不显示加入按钮。加入后切换到这个团队的空间（`team.id`）。
11. **创建团队。** 只有 `teams.canCreate` 为真时显示「创建团队」。`teams.authorised` 为假：提供**申请授权**（`POST /api/teams/creation-request`）；`request.status` 为 `pending` 时说明正在等待并可以撤回；为 `rejected` 时显示 `request.reason`，允许再次申请；`authorised` 为真但 `held >= max` 时说明已达到团队数量上限。创建时把浏览器的时区作为 `timezone` 传上去。
12. **团队成员**看到的服务商是只读的：没有 Key、没有地址、没有「测试连接」「编辑」（`restricted: true`，`permissions["provider:manage"]: false`）。按 `permissions` 和 `access` 把调用者做不了的操作藏起来，而不是让他点了之后撞 403。
13. **上限。** 显示 `limits.member`（有 `limits.team` 时也显示）和重置日期（`resetsAt`），状态直接取 `effective`（`ok`、`near`、`reached`、`unlimited`），不要自己算；「已用」旁边显示 `breakdown`（成功、进行中；失败和取消的不计）和 `uncounted`（成本未知的次数）。上限旁边显示的用量数字取自同一个返回（`GET …/usage?limits=1`），不要另用一种算法。被 `budget.*` 拒绝时显示 `message`（一整句话，带数字、重置时间和谁能改），或者用 `data` 自己组织；显示在发起运行的地方，并且留在那里等人看完（不要用一闪而过的轻提示）。发起运行之前，`limits.member.effective.blockedBy` 说明现在会不会被某个上限拒绝，`cannotRun.models`（配合 `managers`）说明调用者因为没有价格跑不了哪些模型：在模型下拉和运行按钮旁边照着标出来，不要自己从价格去推。设了金额上限时，在旁边给团长和管理员显示 `unpriced.effect` 和 `uncountable` 里的模型。`status: "canceled"` 而 `errorCode` 不是 `run.canceled` 的运行不是人取消的：把它的 `error` 显示出来。
14. **移除管理员。** 返回的 `keysSet` 不为空时，告诉团长这个人填写过哪些服务商的 Key，应当到上游换新。
15. **危险操作**（解散、转让；超级管理员的删除团队）要输入准确的团队名称确认。
16. **已经不在的人。** 每个 Person 都看 `state`：`left` 显示「已离开团队」，`deleted` 显示「账号已删除」，标在仍然保留的名字旁边。两者不要混为一谈，也不要把他们留下的东西藏起来。
17. **团队动态。** 用 `type`、`actor`、`target`、`detail` 自己写一句话（上限、角色、名称、设置、价格都写成「之前 → 之后」）；遇到不认识的 `type` 用 `message`；旧动态的 `detail` 里任何字段都可能没有。
18. **复制到其他空间。** 先问 `GET /api/spaces/copy-targets`，把每个目标都列出来；不能用的显示成禁用并附上它的 `message`，而不是不显示。

---

## 文件

### POST /api/files/upload

`multipart/form-data`，只有一个字段，名为 `file`。大小上限是 `MAX_UPLOAD_MB`。类型按内容识别；接受图片、视频和音频。

返回的 `data`：

```json
{
  "url": "/files/uploads/670e…b2/2026/10/3f…c1.png",
  "key": "uploads/670e…b2/2026/10/3f…c1.png",
  "size": 182044,
  "mime": "image/png",
  "width": 1024,
  "height": 768,
  "thumbnailUrl": "/files/thumbs/of/uploads/670e…b2/2026/10/3f…c1_png.webp"
}
```

key 的形状是 `<uploads|outputs|tools>/<account id>/<yyyy>/<mm>/<32 hex characters>.<ext>`（账号 id、年、月、32 位十六进制字符、扩展名）：上传和抓取来的文件在 `uploads` 下，运行的结果在 `outputs` 下，工具节点的产物在 `tools` 下；第二段是文件所属账号的 id。有账号之前存下的文件没有账号这一段（`uploads/2025/01/<hex>.png`）；这些 key 和地址照常有效，不移动、不改名。有账号这一段，是为了删除账号时能连同它的文件一起删。它不是访问控制：`/files/<key>` 对拿到地址的人都是公开的。

`width`、`height` 和 `thumbnailUrl` 只有图片才有。`url` 永远是站内相对地址（`/files/<key>`），不管 `PUBLIC_URL` 是什么，也不管文件在哪个存储后端上：本地磁盘还是桶。

错误码：`file.missing`、`file.empty`、`file.unsupported_type`、`file.image_corrupt`（400）；`file.too_large`（413）。

### POST /api/files/fetch

请求体：`{ "url": string }`。服务端下载一张远程**图片**（经过 SSRF 防护，大小不超过 `MAX_UPLOAD_MB`）并存下来。地址本来就指向本实例存储的，不会再下载一遍；返回的是这个已存文件的信息，带它的 `/files/<key>` 地址。早期版本存过的、位于某个已配置桶的公开地址下的绝对地址也算在内。返回同上传。

错误码（400）：`file.image_only`（已存的文件不是图片时也是它）、`fetch.*`（例如 `fetch.private_address`、`fetch.http_error`、`fetch.timeout`）；`file.not_found`（404）。

### GET /files/:key

公开。已存文件唯一的地址，文件在哪个后端都一样。`HEAD` 也支持。返回什么取决于文件在哪里：

| 文件在 | 返回 |
| --- | --- |
| 本地磁盘上 | 文件本身，从磁盘读。支持范围请求。 |
| 桶里，分发方式是 `proxy` | 对象本身，由应用从桶里流式转发。单个 `Range` 返回 `206` 并带 `Content-Range`（带多个范围的请求拿到整个文件）；`If-None-Match` 返回 `304`；带 `ETag`、`Last-Modified` 和 `Accept-Ranges: bytes`。 |
| 桶里，分发方式是 `redirect` | `302` 到 `<publicBaseUrl>/<keyPrefix><key>`，带 `Cache-Control: public, max-age=300`。 |

由应用自己送出的文件（前两行）带 `Cache-Control: public, max-age=31536000, immutable`、按 key 的扩展名定的 `Content-Type`、`X-Content-Type-Options: nosniff`，以及一条起沙箱作用的 `Content-Security-Policy`。不是图片、视频、音频的文件一律按附件下载。

`thumbs/of/…` 下的缩略图（`thumbs/of/<uploads|outputs|tools>/<account id>/…_<ext>.webp`）在第一次被请求时生成，哪种后端都一样，存在原图旁边；缩略图做不出来时返回 `302` 到原图。

| HTTP | 什么时候 |
| --- | --- |
| 404，响应体为空 | key 不存在，或者文件不在任何一个可读的后端上，而且每个后端都回答了。 |
| 416 | 请求的范围无法满足。 |
| 503，`{ "result": -1, "code": "storage.unreachable", "message": "…", "data": null }` | 哪里都没找到这个文件，而某个可能存着它的存储问不到（连不上、凭证被拒，或保存的密钥解不开），所以文件可能是存在的。带 `Retry-After: 30` 和 `Cache-Control: no-store`；提示按请求的语言给出，不出现主机和桶名。本地磁盘上或当前使用的桶里的文件，不会因为别的桶出问题而得到这个回答。见[存储](storage.zh-CN.md#存储连不上的时候)。 |

---

## 模型与运行

### GET /api/models

查询参数：`kind`（可选）= `image` | `video` | `chat`。

返回：ModelSpec 数组，是请求作用的那个空间里已启用的服务商下已启用的模型。

```json
{
  "id": "gaorui:nano-banana-2",
  "providerId": "665f…",
  "providerName": "Gaorui",
  "providerType": "gaorui",
  "label": "Nano Banana 2",
  "desc": "Image generation and editing",
  "kind": "image",
  "custom": false,
  "acceptsImage": true,
  "acceptsVideo": false,
  "videoEdit": false,
  "maxReferenceImages": 8,
  "options": { "aspectRatios": ["auto", "1:1"], "resolutions": ["1K", "2K", "4K"] },
  "defaults": { "aspectRatio": "auto", "resolution": "1K", "count": 1 },
  "pricing": { "currency": "CNY", "unit": "per_image", "price": 0.1 }
}
```

`providerType` 是服务商标识（`gaorui`、`openai` 或 `gemini`）。`id` 是 `<provider slug>:<upstream model>`，即「服务商的标识（slug）:上游模型名」。模型 id 按空间各算各的：slug 只在一个空间（某个账号的个人空间，或某个团队）自己的服务商里唯一，不是整个实例唯一，所以一个空间里的 `gaorui:nano-banana-2` 和另一个空间里的同名 id 没有关系。`custom` 为 `true` 是用户手动添加的模型，`false` 是这家服务商模型清单里的模型。`options` 里可能有 `aspectRatios`、`resolutions`、`durations`、`counts` 和 `imgModes`。`desc`、`tag` 和 `pricing` 是可选的；自定义模型没有 `desc`。示例里的 `pricing` 只是占位：项目不自带任何价格，只有在这个空间里填过价格之后才有这个字段。只能按公网地址接收参考图的模型带 `imageByUrlOnly: true`。见[编写服务商模块](writing-a-provider.zh-CN.md#modelspec-参考)。

列表是每个服务商所属那一家的模型清单，加上这个服务商的自定义模型。它不是从上游读来的，模型的 `kind` 也从不根据名字推断。

对话模型的 `acceptsVideo` 表示能不能给它视频（`POST /api/llm/tasks` 的 `videoUrl`）。OpenAI 和 Gemini 的对话模型都是 `false`，清单里的和自定义的都一样。高瑞清单里的五个对话模型中，`gemini-3.5-flash-c` 是 `true`，另外四个是 `false`。高瑞服务商的自定义对话模型是 `true`。高瑞服务商把视频作为一个 `image_url` 内容段发出去，里面是它的公网地址，见[服务商](providers.zh-CN.md#哪个节点用哪类模型)。「视频分析」节点只列出带 `acceptsVideo` 的对话模型。`acceptsImage` 表示对话模型能不能读图片（`imageUrls`）：`false` 是纯文本模型，这时 `maxReferenceImages` 为 `0`。

### POST /api/runs/estimate

请求体：`{ "model": string, "params"?: object, "count"?: number }`。

返回：

```json
{ "unitCost": 0.1, "totalCost": 0.1, "currency": "CNY", "unknown": false }
```

没有适用的价格时，`unknown` 为 `true`，金额为 `0`。按 token 计价的对话模型在这里永远是 `unknown`。

错误码（400）：`validation.required`（model）、`model.bad_id`、`model.provider_missing`、`model.provider_disabled`、`model.disabled`、`model.unavailable`。

### POST /api/runs

发起一次图片或视频运行。

```json
{
  "model": "gaorui:nano-banana-2",
  "prompt": "an orange cat on a windowsill",
  "imageUrls": ["/files/uploads/670e…b2/2026/10/3f…c1.png"],
  "videoUrls": [],
  "params": { "aspectRatio": "1:1", "resolution": "1K" },
  "workflowId": "665f…",
  "nodeId": "node-12"
}
```

| 字段 | 规则 |
| --- | --- |
| `model` | 必填。`/api/models` 里的一个模型 id，也就是请求作用的那个空间里某个服务商的模型。不能是对话模型。 |
| `prompt` | 字符串，最长 20000 个字符。 |
| `imageUrls` | 最多 16 个地址，每个是 `http(s)://…` 或 `/files/…`（不接受 `data:` URI）。超出模型能接受的数量时，多的被截掉。 |
| `videoUrls` | 最多 4 个地址；只用其中一个，而且只有接受视频的模型才用。 |
| `params` | 扁平对象，值是短字符串、数字或布尔值。合并到模型的默认参数上。`count` 被限制在 1 到 8。 |
| `workflowId`、`nodeId` | 可选，用来在用量记录里标明出处。 |

返回：`{ "runId": string }`。运行进入队列，之后轮询它。运行属于请求作用的那个空间，用这个空间的服务商和 Key 执行（个人空间里是调用者自己的，带 `X-Space` 时是团队的），服务重启后接着跑时也一样。团队里还要过[每月上限](#每月上限)（`403 budget.*`）。

错误码（400）：同估价，另加 `model.chat_only`、`validation.array`、`validation.max_items`、`validation.bad_url_in`、`validation.too_long`。这个账号未完成的运行（排队中、运行中或转存中）已有 `userQueueLimit` 个（默认 200），或者整个实例合计已有 500 个时，返回 `run.queue_full`（429）。

队列怎么分：`concurrency` 是整个实例同时执行的运行数，其中一个账号最多占 `userConcurrency` 个。有名额空出来时，先给正在执行的运行最少的账号；一样多的，给最久没拿到名额的；同一个账号内，先提交的先执行。一个账号排了很长的队，不会挡住别的账号。这三个数都是[站点设置](#站点设置)。

### GET /api/runs/:id

返回：一个 Run。

```json
{
  "id": "6660…",
  "status": "succeeded",
  "progress": 100,
  "outputs": [
    { "type": "image", "url": "/files/outputs/670e…b2/2026/10/9a…7e.png", "thumbnailUrl": "/files/thumbs/of/outputs/670e…b2/2026/10/9a…7e_png.webp", "width": 1024, "height": 1024 }
  ],
  "text": "",
  "error": "",
  "errorCode": "",
  "cost": { "amount": 0.1, "currency": "CNY", "unknown": false },
  "model": "gaorui:nano-banana-2",
  "modelLabel": "Nano Banana 2",
  "kind": "image",
  "workflowId": "665f…",
  "nodeId": "node-12",
  "createdAt": "2026-10-09T02:58:01.120Z",
  "startedAt": "2026-10-09T02:58:01.200Z",
  "finishedAt": "2026-10-09T02:58:31.870Z"
}
```

| `status` | 含义 |
| --- | --- |
| `queued` | 在等名额。 |
| `running` | 已经提交给上游，或正在提交。 |
| `archiving` | 正在把结果转存到存储里。 |
| `succeeded` | 完成；`outputs` 里有结果。 |
| `failed` | `error` 是按请求的语言给出的原因，`errorCode` 是它的稳定代码（例如 `run.timeout_generate`、`upstream.failed_detail`、`media.needs_public_url`、`run.interrupted`）。 |
| `canceled` | 已取消。`errorCode` 说明是怎么取消的：人手动取消是 `run.canceled`；排队时被取消是 `run.canceled_member_removed`、`run.canceled_account_disabled` 或 `run.canceled_team_closed`（见[成员](#成员)和[超级管理员与团队](#超级管理员与团队)）。 |

错误码：`run.not_found`（404），别的空间的运行也是它。对话运行不从这里返回，用 `/api/llm/tasks/:id`。

服务停止时，不会有任何东西向上游发两次。已经有上游任务的运行，或者还什么都没发的运行，回到 `queued`，重启后继续。请求已经发出、但没有上游任务号的运行（同步服务商的每一次运行、每一次对话运行）以 `failed` 结束，错误码 `run.interrupted`。

### POST /api/runs/status

批量轮询。请求体：`{ "ids": string[] }`，最多 100 个。返回：按请求顺序排列的 Run 数组；不存在的 id，以及别的空间的运行的 id，直接不出现。

### POST /api/runs/:id/cancel

取消一次排队中或运行中的运行（图片、视频或对话）。返回：取消后的 Run。运行已经结束的话，原样返回这个 Run，提示是 `run.already_finished`。

### POST /api/runs/download-zip

把多条生成记录的结果打成**一个 zip**，流式返回。

```json
{ "ids": ["6660…", "6661…"], "urls": ["/files/outputs/2026/10/….png"], "name": "October picks" }
```

| 字段 | 含义 |
| --- | --- |
| `ids` | 记录（运行）的 id，1 到 100 个。压缩包里的顺序跟它一致。 |
| `urls` | 可选，最多 2000 个。只要这些地址对应的文件（比如四张结果里的一张）。它只能缩小范围：不是这些记录的结果的地址不会带来任何东西。带了 `urls` 就不放文字结果。 |
| `name` | 可选，压缩包的名字，不带 `.zip`。默认 `history-<yyyymmdd-hhmmss>`（UTC）。 |

放进去的内容永远来自保存着的记录，而不是请求：图片、视频运行的文件，以及每条对话运行的文字结果（一个 `.txt` 文件）。只算请求作用的那个空间里、调用者有权读取的**已成功**的运行：个人空间里是全部；团队里有 `usage:view_all` 的人是全部，其他成员只有自己的。不在其中的 id 直接跳过，不报错。

文件名是 `<nn>-<model>-<yyyymmdd-hhmmss>[-<k>].<ext>`：`nn` 是在 `ids` 里的位置，`model` 是上游模型名，时间是运行创建的时间（UTC），一条运行有多个文件时加 `k`。例如 `01-nano-banana-2-20261012-081502.png`、`02-gpt-4o-20261012-081730.txt`。每个名字都只是一段文件名（没有路径分隔符，没有文件系统不认的字符），在压缩包里不重复。文件不压缩，原样存放。

返回 `application/zip`，带 `Content-Disposition: attachment`（名字在 `filename*=UTF-8''…` 里）。上限：一个压缩包最多 100 个文件，单个最大 1 GiB，总共最大 4 GiB，最长 10 分钟；同一个账号同时最多打 3 个包。文件从本服务的存储读取，别处的地址走和 `POST /api/workflow/download` 相同的 SSRF 防护，一次只读一个。

- 某个文件**打不开**（没了、连不上）不会让整个压缩包失败：它的位置换成 `<name>-failed.txt`，按读者的语言说明（太大、或者会让压缩包超过总大小的文件换成 `<name>-skipped.txt`）。
- 某个文件**读到一半断了**，或者时间、大小的额度在一个文件中间用完：下载直接中断，连接关掉，不写 zip 的结尾。客户端看到的是下载失败，而不是一个悄悄少了东西的压缩包。重新请求一次即可。
- 客户端走了，服务端立刻停止读取：没人等的下载不会继续跑。

错误都发生在开始下载之前：`validation.array`（`ids` 或 `urls` 不是数组）、`validation.required`（没有一个合法的 id）、`validation.max_items`（超过 100 个 id，或 `urls` 超过 2000 个）、`run.zip_max`（这些记录的文件超过 100 个，提示里有具体数量），以上都是 400；`run.nothing_to_download`（404，这些记录里没有调用者能取的结果，文件在这期间被保留期清理掉了也是它）；`run.zip_busy`（429，这个账号已经有 3 个包在打，等其中一个结束）。按 `responseType: 'blob'` 收的话，被拒绝时拿到的是装在 blob 里的 JSON。

### POST /api/llm/tasks

发起一次对话运行（「语言模型」和「视频分析」节点）。

请求体：`{ "model": string, "prompt"?: string, "systemPrompt"?: string, "imageUrls"?: string[], "videoUrl"?: string, "workflowId"?: string, "nodeId"?: string }`。`prompt`、`imageUrls`、`videoUrl` 至少带一个。`model` 必须是对话模型。

返回：`{ "taskId": string }`。

错误码（400）：`run.prompt_required`、`model.not_chat`、`model.no_video_input`（带了 `videoUrl` 而模型没有 `acceptsVideo`）、`model.no_image_input`（带了 `imageUrls` 而模型是纯文本模型，即没有 `acceptsImage`），以及 `POST /api/runs` 的那些，包括 `run.queue_full`（429）。

### GET /api/llm/tasks/:id

返回：

```json
{ "id": "6661…", "status": "succeeded", "progress": 100, "text": "…", "error": "", "errorCode": "", "cost": { "amount": 0, "currency": "", "unknown": true }, "model": "gaorui:chat-small" }
```

`status` 的取值同 Run。

---

## 画布

基础路径 `/api/workflow`。一张画布（接口里叫 workflow）：

```json
{
  "id": "665f…",
  "name": "Untitled canvas",
  "nodes": [ { "id": "n1", "type": "text", "position": { "x": 0, "y": 0 }, "data": { "text": "…" } } ],
  "edges": [ { "id": "e1", "source": "n1", "sourceHandle": "text-out", "target": "n2", "targetHandle": "text-in" } ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 },
  "settings": { },
  "brandKitId": "",
  "thumbnail": "",
  "thumbnailType": "",
  "schemaVersion": 3,
  "legacyLayout": false,
  "spaceId": "personal",
  "visibility": "",
  "createdBy": { "id": "670e…b2", "username": "admin", "name": "admin", "state": "active", "left": false, "deleted": false },
  "revision": 12,
  "metaRevision": 3,
  "lastEditedBy": null,
  "lastEditedAt": null,
  "lock": null,
  "access": { "canView": true, "canEdit": true, "canDelete": true, "canSetVisibility": false, "canTakeOver": false, "canOverwrite": true, "canShare": true },
  "createdAt": "…",
  "updatedAt": "…"
}
```

从 `spaceId` 到 `access` 这些字段说明画布是谁的、谁能对它做什么、谁正在编辑；它们在团队里才有意义，说明见[团队里的画布](#团队里的画布)。`revision` 在每种空间里都记内容保存的次数。

`legacyLayout` 为 `true` 表示节点位置还是 `schemaVersion` 2 之前排的，编辑器还没有按现在的节点尺寸核对过：服务端在读取时迁移这样的画布（多于一个节点）会设上它，带这个标记的画布复制出来的副本也带着，编辑器做完那一次性的核对后把它清掉（见下）。`brandKitId` 是这张画布的品牌包（`""` 表示没有）：编辑器把它套用到画布上生成节点的每一次运行，节点的 `data.brandKitOverride` 里写了别的品牌包 id 或 `"none"` 的除外（见[品牌包](#品牌包)）。`nodes[].data` 和 `settings` 的结构由前端决定，服务端原样保存。上限：500 个节点，2000 条连线，名称最长 80 个字符。这里的每个接口操作的都是请求作用的那个空间的画布：个人空间里是调用者自己的；带 `X-Space` 时是团队的，以调用者看得到的为限。

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/workflow/list` | | `{ id, name, thumbnail, thumbnailType, spaceId, visibility, createdBy, revision, metaRevision, lastEditedBy, lastEditedAt, lock, access, createdAt, updatedAt }` 的数组，新的在前，最多 200 张。团队里可用 `?mine=1`、`?member=<id>`、`?visibility=…`。 |
| POST | `/api/workflow` | `{ name?, nodes?, edges?, viewport?, settings?, brandKitId? }` | 新画布。不带 `brandKitId` 时套用这个账号的默认品牌包（有的话）；传 `""` 表示不套用。 |
| GET | `/api/workflow/:id` | | 画布，需要时先迁移到当前的 `schemaVersion`。 |
| PUT | `/api/workflow/:id` | `name`、`nodes`、`edges`、`viewport`、`settings`、`brandKitId`、`legacyLayout` 中的任意几个；另可带 `baseRevision?`、`force?`、`sessionId?` | 画布。只改请求里带的字段。保存内容（`nodes`、`edges`、`settings`、`brandKitId`）会让 `revision` 加 1；带了 `baseRevision` 而画布已经往前走了，保存被拒绝（409 `canvas.conflict`），不带就是后写覆盖，而团队空间不允许这样。只带 `name`、`viewport`、`legacyLayout` 的是保存元信息：不要版本号，不要锁；改了名字 `metaRevision` 加 1。见[保存与冲突](#保存与冲突)。`brandKitId` 必须是 `""` 或一个 24 位的品牌包 id（别的值返回 400 `validation.invalid`）；不检查它是谁的品牌包，因为品牌包只会在调用者自己的里面找，别的 id 等于没有品牌包。只带 `viewport` 和/或 `legacyLayout` 的保存不动 `updatedAt`：平移和缩放不算编辑。`legacyLayout` 只能传 `false`（别的值返回 400 `validation.invalid`）；`POST` 时忽略它。 |
| POST | `/api/workflow/:id/duplicate` | `{ name? }` | 副本，`brandKitId` 和节点上的例外都保留。素材只引用，不复制。 |
| DELETE | `/api/workflow/:id` | | `{ id }`。软删除；30 天内可恢复（`GET /api/workflow/trash`、`POST /api/workflow/:id/restore`）。 |
| PATCH | `/api/workflow/:id/access` | `{ visibility }` | 团队画布：还有谁能看、能改。 |
| PATCH | `/api/workflow/:id/meta` | `{ name?, viewport?, legacyLayout? }` | 画布。只保存元信息（带了内容字段：400 `canvas.meta_only`）。 |
| POST、GET、DELETE | `/api/workflow/:id/lock` | `{ sessionId, takeover? }` / `?sessionId=` | 拿锁或续期、查看、归还[编辑锁](#编辑锁)。 |
| GET | `/api/workflow/locks` | `?since=` | `{ locks: [{ id, lock }], pollMs, now, counts, changed?, removed?, reload? }`：这个空间里现在谁在编辑哪张画布；带了 `since` 时还有从那以后[列表上变了什么](#编辑锁)。`since` 不是时间：400 `validation.invalid`。 |
| POST | `/api/workflow/:id/lock/release` | `{ releaseToken }`，**公开** | `{ released }`。页面关闭时归还锁（`sendBeacon`）。 |
| POST | `/api/workflow/:id/copy` | `{ toSpace, name? }` | 另一个空间里的副本，文件一起复制。见[团队里的画布](#团队里的画布)。 |
| POST | `/api/workflow/download` | `{ url, filename? }` | 以附件形式返回这个文件。浏览器自己取不到的素材由它代理下载。只返回素材文件。 |
| POST | `/api/workflow/:id/download-zip` | `{ urls?: string[] }` | 画布里素材的 zip。`urls` 把范围缩小到画布上有的那些地址；不带就是全部。文件名是 `<nn>-<node type>.<ext>`。最多 100 项，单项最大 1 GiB，总共最大 4 GiB。取不到的文件换成 `<nn>-<node type>-failed.txt`，会让压缩包超过总大小的换成 `<nn>-<node type>-skipped.txt`。 |

错误码：`canvas.not_found`（404）；`canvas.conflict`、`canvas.lock_busy`（409）；`canvas.locked`（423）；`team.forbidden`（403）；`canvas.meta_only`、`common.name_required`、`canvas.max_nodes`、`canvas.max_edges`、`canvas.bad_node`、`canvas.bad_edge`、`validation.max_length`、`canvas.base_revision_required`、`canvas.personal_no_visibility`（400）；下载接口还有 `file.not_media_url`、`fetch.*`、`canvas.zip_max`（400）和 `canvas.nothing_to_download`（404）。

---

## 模板与工具

基础路径 `/api/canvas`。工具接口在服务端处理图片；不调用模型，不产生运行。源图片每张最大 20 MB。

| 方法 | 路径 | 请求体 / 参数 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/canvas/templates` | | `{ key, title, description, cover, graph: { nodes, edges, viewport }, builtin, canDelete, createdBy, mine, createdAt }` 的数组：内置模板属于站点，在哪里都显示；另加请求作用的那个空间里保存的。`createdBy` 是保存它的 [Person](#成员)（内置的为 `null`，`createdAt` 也是）；`mine`：是调用者保存的。 |
| POST | `/api/canvas/templates` | `{ title, description?, cover?, graph: { nodes, edges, viewport?, group? } }` | 保存下来的模板；`key` 由服务端生成。最多 200 个节点。 |
| DELETE | `/api/canvas/templates/:key` | | `{ key }`。自己保存的；团队里团长和管理员也可以删。内置的删不了。 |
| GET | `/api/canvas/text-templates` | `?lang=zh` 或 `en`（默认 `zh`） | `{ id, title, content, category, lang, builtin, canDelete, createdBy, mine, createdAt }` 的数组，后三项同模板。 |
| POST | `/api/canvas/text-templates` | `{ title, content, category?, lang? }` | 保存下来的提示词片段。 |
| DELETE | `/api/canvas/text-templates/:id` | | `{ id }`。 |
| POST | `/api/canvas/tool/slice` | `{ imageUrl, cols, rows }`（各 1 到 6，默认 3） | `{ cols, rows, items: [{ key, label, url, width, height }] }` |
| POST | `/api/canvas/tool/collage` | `{ imageUrls[], cols, rows, gap, bg, ratio }`（2 到 64 张图；cols、rows 1 到 4；gap 0 到 80） | `{ url, width, height, cols, rows, used, skipped }` |
| POST | `/api/canvas/tool/watermark` | `{ imageUrl, markUrl, position, scalePct, opacity, marginPct }`（缩放 5 到 60，不透明度 10 到 100，边距 0 到 20） | `{ url, width, height }` |
| POST | `/api/canvas/tool/fit` | `{ imageUrl, ratio, bg, format, quality, maxKb }`（format 为 `jpg` / `png` / `webp`，其他值自动选；quality 40 到 95；maxKb 0 到 20480，0 表示不限） | `{ url, width, height, bytes, overLimit }` |
| POST | `/api/canvas/platform-export` | `{ imageUrl, group }`（`domestic` 或 `overseas`） | `{ group, items: [{ key, label, url, width, height }], whiteBg }` |

超出范围的数字会被收到范围内，不会被拒绝。工具的结果和上传的文件存在请求作用的那个空间名下。错误码（400）：`media.*`（源文件读不了）、`tool.*`、`template.max`（每个空间最多保存 200 个模板、200 个片段）；`template.not_found`（404）。

---

## 品牌包

基础路径 `/api/brand-kits`。一个品牌包：

```json
{ "id": "…", "name": "Summer studio", "refImages": ["/files/…"], "promptPrefix": "", "negativePrompt": "", "defaultRatio": "", "defaultModel": "", "isDefault": false, "shared": false, "mine": true, "canManage": true, "updatedAt": "…", "usedBy": 2 }
```

品牌包由编辑器套用，不由服务端套用：生成节点运行时，浏览器把 `promptPrefix` 加在提示词最前面，把 `negativePrompt` 以「不要出现：…」一行加在末尾，把 `refImages` 排在节点自己的参考图后面，不超过模型的上限。`/api/runs` 收到的是拼好的提示词和图片列表，对品牌包一无所知。节点用哪个品牌包存在画布上：画布文档上的 `brandKitId`，以及不跟随画布的节点上的 `data.brandKitOverride`（品牌包 id，或 `"none"`）。`isDefault` 标出新画布默认套用的那个品牌包。`defaultRatio` 和 `defaultModel` 会保存、会返回，但编辑器不用它们。

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/brand-kits` | | 品牌包数组。每个带 `usedBy`：调用者有几张画布在用它，作为画布的品牌包，或某个节点的例外（其他接口不返回这一项）。 |
| POST | `/api/brand-kits` | `{ name, refImages?, promptPrefix?, negativePrompt?, defaultRatio?, defaultModel?, isDefault? }` | 品牌包。 |
| PUT | `/api/brand-kits/:id` | 上面的任意几个字段 | 品牌包。 |
| DELETE | `/api/brand-kits/:id` | | `{ id }`。软删除。指向它的画布和节点原样留着，之后运行时不再套用品牌包。 |

品牌包属于空间。团队里所有成员都能列出、能选用，新建、修改、删除只有团长和管理员可以（其他人 `403 team.forbidden`）；那里 `shared` 为 `true`，`canManage` 说明调用者能不能改这个品牌包。上限：每个空间 50 个；`name` 40 个字符；`promptPrefix` 1000；`negativePrompt` 500；参考图 5 张（只接受地址）。设了 `isDefault` 会清掉其他品牌包上的这个标记。

错误码：`brandKit.name_required`、`brandKit.max`、`brandKit.ref_images_max`（400）；`brandKit.not_found`（404）。

---

## 资产

### 我的资产 — /api/user-asset

请求作用的那个空间的资产库：个人空间里是调用者自己的；带 `X-Space` 时是团队的，所有成员都能看、能往里加（见[团队里的资产、品牌包、模板和分享链接](#团队里的资产品牌包模板和分享链接)）。`kind` 是 `product`、`brand`、`reference`、`output` 之一。每条资产带 `scope`、`mine`、`canManage`、`uploaderName` 和 `createdBy`。

| 方法 | 路径 | 请求体 / 参数 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/user-asset/list` | `?kind&folder&tag&search&page&pageSize`（每页最多 200，默认 60） | `{ list, folders, folderList, kindCount, limit, isTeamManager, pagination: { total, page, pageSize } }` |
| POST | `/api/user-asset` | `{ mediaUrl, kind?, name?, nodeType?, thumbnailUrl?, width?, height?, aspectRatio?, folder?, tags? }` | 资产。登记一个已经上传的文件。 |
| POST | `/api/user-asset/register-output` | 同上，另加 `fromFlowId?`、`fromProduct?` | 资产，`kind: "output"`。 |
| POST | `/api/user-asset/folder` | `{ name }`（最长 120 个字符） | `{ name, count, empty, canDelete, existed }`。新建一个空分组。同名分组已经存在时原样返回它，`existed: true`。 |
| DELETE | `/api/user-asset/folder?name=<分组名>` | | `{ name, deleted: true }`。删除一个**空的**分组。 |
| POST | `/api/user-asset/folder/delete` | `{ name }` | `{ moved }`。解散分组：分组没了，其中的资产保留，不再属于任何分组。团队里：团长和管理员。 |
| PUT | `/api/user-asset/:id` | `name`、`folder`、`tags`、`kind` 中的任意几个 | 资产。 |
| DELETE | `/api/user-asset/:id` | | `{ id }`。软删除；文件保留。 |
| POST | `/api/user-asset/:id/copy` | `{ toSpace: "personal" \| <团队 id> }` | `{ id, spaceId, mediaUrl, thumbnailUrl }`。另一个空间里的副本，文件另存一份。 |

`nodeType` 是 `IMAGE`（默认）或 `VIDEO`。每个空间每种分类最多 5000 条。

**分组。** 资产用 `folder` 说明自己在哪个分组（`""` 表示不在任何分组）。分组从被创建（`POST /folder`）或第一次被某条资产用到起就存在，直到被删除；里面什么都没有时它也在：把最后一条资产移走或删掉，留下的是一个空分组。`folders` 按名字列出资产库的全部分组，空的也在内；`folderList` 给出每个分组更多的信息：

```json
"folderList": [ { "name": "Spring shoot", "count": 12, "empty": false, "canDelete": false },
                { "name": "To sort", "count": 0, "empty": true, "canDelete": true } ]
```

`count` 是分组里的资产数，各种分类都算（不受列表筛选条件影响）。`canDelete`：分组是空的，**并且**调用者有权删它：自己的空间里总是可以；团队里是团长、管理员，以及创建这个分组的成员。`DELETE /folder` 对里面还有资产的分组返回 `409 asset.folder_not_empty`（`data: { name, count }`；提示里说明还有几条）：先把它们移走或删除，或者解散分组，资产会保留。每个空间最多 500 个分组（`400 asset.folder_max`）。

错误码：`asset.media_url_required`、`asset.bad_thumbnail`、`asset.kind_full`、`asset.folder_required`、`asset.folder_max`（400）；`team.forbidden`（403；别人的资产，或调用者无权删除的分组）；`asset.not_found`、`asset.folder_not_found`（404）；`asset.folder_not_empty`（409）。

### 复制到其他空间的目标

`GET /api/spaces/copy-targets?kind=canvas|asset[&assetKind=product|brand|reference|output]`：请求作用的那个空间（`X-Space`）里的东西能复制到哪里。调用者所在的每个空间都会列出来（个人空间在前，然后按加入的先后列出每个团队，已关闭的团队也在内），每一项说明能不能接收这次复制，不能时说明原因：

```json
{ "kind": "canvas", "from": { "id": "6712…a0", "kind": "team" },
  "targets": [
    { "id": "personal", "kind": "personal", "name": "", "avatar": "", "role": "owner", "status": "active",
      "current": false, "available": false, "reason": "copy_out_disabled", "message": "The team owner has switched off copying team content into personal spaces" },
    { "id": "6712…a0", "kind": "team", "name": "Starlight Studio", "avatar": "", "role": "member", "status": "active",
      "current": true, "available": false, "reason": "same_space", "message": "…" },
    { "id": "6713…c4", "kind": "team", "name": "Lime Visuals", "avatar": "", "role": "admin", "status": "active",
      "current": false, "available": true, "reason": "", "message": "" } ] }
```

`id` 就是调用 `POST /api/workflow/:id/copy` 或 `POST /api/user-asset/:id/copy` 时要传的 `toSpace`。`message` 是按读者的语言写好的原因。复制接口本身会因为同样的原因拒绝，返回下表里的错误：

| `reason` | 含义 | 复制接口返回 |
| --- | --- | --- |
| `same_space` | 就是请求作用的那个空间（`current: true`）。 | `400 space.same_space` |
| `copy_out_disabled` | 来源是团队，团长关掉了 `copyToPersonal`，目标是个人空间，而调用者不是这个团队的团长。 | `403 space.copy_out_disabled` |
| `team_suspended` | 目标团队被超级管理员停用。 | `403 team.suspended` |
| `team_dissolved` | 目标团队已被团长解散。 | `403 team.dissolved` |
| `asset_kind_full` | `kind=asset` 且带了 `assetKind`：目标资产库里这个分类已有 5000 条。 | `400 asset.kind_full` |
| `no_permission` | 调用者在目标团队里的角色不允许往里添加。目前没有哪个角色会被拒绝（所有成员都能新建画布、添加资产）；留着这个原因，是为了以后规则变了客户端不用改。 | `403 team.forbidden` |

有一种拒绝只有真正复制时才知道：`400 space.copy_too_large`（要复制的文件超过 300 个，或 2 GiB）。错误码：`validation.one_of`（400；`kind`、`assetKind`）。

### 公共素材库 — /api/canvas-asset

一个只读的素材库，由运维的人导入数据库。它属于站点：所有账号看到的是同一份。新装的实例里是空的；没有往里添加的接口。

| 方法 | 路径 | 查询参数 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/canvas-asset/categories` | | `{ code, name, count }` 的数组。 |
| GET | `/api/canvas-asset/list` | `?code&nodeType&page&pageSize`（每页最多 50，默认 20） | `{ list, total, page, pageSize }` |

---

## 分享链接

基础路径 `/api/canvas-share`。只有按 token 读取链接是公开的。分享链接是唯一有意跨账号的东西：拿到 token 的人不用登录就能读快照，登录的账号可以把它复制成自己的画布。这里其余的接口操作的都是请求作用的那个空间的链接：个人空间里是调用者自己的；团队里，团长和管理员是团队的全部链接，成员是自己创建的那些（见[团队里的资产、品牌包、模板和分享链接](#团队里的资产品牌包模板和分享链接)）。团队被停用或解散期间，它的链接打不开。

| 方法 | 路径 | 登录 | 请求体 | 返回 |
| --- | --- | --- | --- | --- |
| POST | `/api/canvas-share/publish` | 需要 | `{ workflowId, title?, description?, expiresInDays? \| expiresAt? }` | `{ id, token, updated, expiresAt }` |
| GET | `/api/canvas-share/mine` | 需要 | | `{ list }`：调用者的全部链接，含已过期和已撤销的。 |
| GET | `/api/canvas-share/plaza` | 需要 | `?page&pageSize&sort=hot` | `{ list, total, page, pageSize }`：调用者有效的链接。 |
| GET | `/api/canvas-share/:token` | **公开** | | 快照：摘要字段加 `description`、`nodes`、`edges`、`viewport`、`settings`。只能按链接的 token 找到。 |
| POST | `/api/canvas-share/:token/copy` | 需要 | `{ name? }` | `{ workflowId, isOwn }`：用快照新建的一张画布，放在请求作用的那个空间里（不带 `X-Space` 就是调用者的个人空间）。 |
| PUT | `/api/canvas-share/:id` | 需要 | `{ title?, description?, expiresInDays? \| expiresAt?, revoked? }` | 链接摘要。 |
| POST | `/api/canvas-share/:id/revoke` | 需要 | | 链接摘要。 |
| DELETE | `/api/canvas-share/:id` | 需要 | | `{ id, revoked, removed }` |

行为：

- **发布**给画布拍一份快照。同一张画布再次发布会刷新快照、保留 token；链接已被撤销的除外，那时会发一个新 token。
- **有效期**：`expiresInDays` 取 0 到 3650，`0` 表示永不过期；或者用 `expiresAt` 给一个将来的日期，`null` 表示永不过期。两个都不带时，新链接永不过期，已有的链接保持原来的有效期（已经过去的有效期会被清掉）。
- **读取**一个不存在、已过期或已撤销的 token，一律返回 `404`，错误码 `share.gone`，调用者分不出是哪一种。每次公开读取让浏览次数加 1。
- **删除**第一次调用是撤销，第二次把链接从 `mine` 里移除。被撤销的 token 不会再用。
- **复制**需要登录，副本归复制的账号。快照里保留的是发布者账号的模型 id；在副本里按复制者自己的服务商去找，复制者没有同一个 slug 的服务商时，这个模型就是不可用。
- `PUT`、`revoke` 和 `DELETE` 里的 `:id` 是 `publish` 或 `mine` 返回的数据库 id；别的账号的链接返回 `404`（`share.not_found`）。公开读取和 `copy` 只认链接的 token：拿数据库 id 去调返回 `404`，登不登录都一样。
- **模型名称。** 看的人没有发布者的服务商，所以每个指定了模型的节点还带 `data.modelLabel`：发布者看到的显示名称，由服务端在发布链接时写入（客户端送来的值会被替换）。在这之前发布的快照，读取时按发布者现在的模型补上名称。发布者已经没有的模型不带 `modelLabel`；分享页这时显示中性的「未注明模型」，从不显示模型 id。副本不保留 `modelLabel`。
- **品牌包。** 快照不带品牌包：画布的 `brandKitId` 不进快照，每个节点的 `brandKitOverride` 都会去掉（发布时、每次公开读取时、复制时）。品牌包给某次运行加了什么，只在它本来就在的地方看得到：发出去的提示词（`data.lastPrompt`）。副本以 `brandKitId: ""` 创建。
- **布局。** 快照记着它的节点位置是按哪一版节点尺寸排的（`layoutVersion`，不返回）。改版之前的快照，或者还在等布局核对的画布，复制出来的副本带 `legacyLayout: true`。
- **快照里不带什么。** 运行时的状态、运行号、失败详情和成本，在发布链接时从每个节点上去掉，每次公开读取时再去一遍，复制时也去掉：`status`、`progress`、`validationError`、`validationStamp`、`errorMsg`、`taskId`、`taskIds`、`runId`、`runPending`、`generatedCount`、`cost`、`estimatedCost`、`brandKitOverride`，以及 `results[]` 每一项里的 `cost` / `taskId` / `runId`。提示词和模型 id（带服务商的 slug 前缀）保留。

错误码：`canvas.not_found`、`share.not_found`、`share.gone`（404）；`share.empty_canvas`、`share.max`（每个空间 500 条链接）、`share.title_required`、`share.expires_in_past`、`validation.range`、`validation.bad_date`（400）。

---

## 管理

基础路径 `/api/admin`。它下面有两类接口，路径里的「admin」对第一类来说只是历史名字：

- **按空间的。** 内置服务商、添加的服务商和它们的 Key、自定义模型、模型设置和价格，以及用量。登录的账号都能调用，每次调用操作的是请求作用的那个空间：个人空间里是调用者自己的数据（自带 Key 是按账号的，两个账号永远看不到、也用不了对方的服务商）；带 `X-Space` 时是团队的，团长和管理员管理、成员只读（见[团队的服务商、模型和价格](#团队的服务商模型和价格)）。下表「谁能调用」一列说的是个人空间。
- **仅超级管理员。** 站点设置、存储、注册开关和实例上的账号。其他账号调用返回 `403` `auth.forbidden`；没登录的调用者返回 `401` `auth.required`。

| 接口 | 谁能调用 | 操作谁的数据 |
| --- | --- | --- |
| `GET /api/admin/vendors` | 登录的账号 | 不属于任何账号：服务端内置的服务商和模型清单，人人相同 |
| `GET`、`POST /api/admin/providers` | 登录的账号 | 调用者自己的服务商和 Key |
| `PUT`、`DELETE /api/admin/providers/:id` | 登录的账号 | 调用者自己的服务商和 Key |
| `POST /api/admin/providers/:id/test` | 登录的账号 | 调用者自己的服务商 |
| `POST /api/admin/providers/:id/models` | 登录的账号 | 调用者自己的自定义模型 |
| `PUT`、`DELETE /api/admin/providers/:id/models/:model` | 登录的账号 | 调用者自己的自定义模型 |
| `GET /api/admin/models` | 登录的账号 | 调用者自己的模型及覆盖项 |
| `PUT /api/admin/models/:modelId` | 登录的账号 | 调用者对这个模型的覆盖项（启用、名称、排序、默认参数、价格） |
| `GET /api/admin/usage`、`GET /api/admin/usage/records` | 登录的账号 | 调用者自己的用量记录 |
| `DELETE /api/admin/usage/records` | 登录的账号 | 调用者自己的用量记录 |
| `GET`、`PUT /api/admin/settings` | 仅超级管理员 | 站点 |
| `GET`、`PUT /api/admin/storage`，`POST /api/admin/storage/test` | 仅超级管理员 | 站点 |
| `GET`、`PUT /api/admin/site` | 仅超级管理员 | 站点：是否开放注册 |
| `GET /api/admin/users` | 仅超级管理员 | 全部账号：账号本身的信息和两个数量，不含内容 |
| `PATCH /api/admin/users/:id` | 仅超级管理员 | 另一个账号：停用或启用；授予或收回创建团队的授权 |
| `/api/admin/teams…`、`/api/admin/team-requests…` | 仅超级管理员 | 实例上的团队（存在和规模，不含内容），以及创建团队的申请。见[超级管理员与团队](#超级管理员与团队)。 |
| `DELETE /api/admin/users/:id` | 仅超级管理员 | 另一个账号及其全部数据 |
| `POST /api/admin/users/:id/reset-password` | 仅超级管理员 | 另一个账号：密码和会话 |

超级管理员自己的服务商、模型和用量和别人一样是按账号的：超级管理员调用第一类接口，操作的是自己的数据；没有任何接口能返回别的账号的画布、Key 或文件。`/api/admin` 下的其他路径，非超级管理员得到 `403`，超级管理员得到 `404`。

### 内置服务商

`GET /api/admin/vendors` 返回可以用来添加服务商的每一家，按显示顺序排，各带它支持的模型。名称和说明按请求的语言给出。它取代了上一个版本的 `GET /api/admin/provider-types`，那个接口已经没有了。

```json
[
  {
    "type": "openai",
    "label": "OpenAI",
    "recommended": false,
    "keyUrl": "",
    "defaultBaseUrl": "https://api.openai.com/v1",
    "models": [
      {
        "model": "gpt-image-2.5-sunburst",
        "label": "GPT Image 2.5 Sunburst",
        "kind": "image",
        "desc": "Image generation and editing, most precise edits",
        "acceptsImage": true,
        "acceptsVideo": false,
        "videoEdit": false,
        "custom": false,
        "maxReferenceImages": 16,
        "options": { "aspectRatios": ["auto", "1:1", "3:2", "2:3"], "counts": [1, 2, 3, 4] },
        "defaults": { "aspectRatio": "auto", "count": 1 }
      }
    ],
    "customKinds": ["image", "chat"],
    "customDefaults": {
      "image": {
        "kind": "image", "acceptsImage": true, "acceptsVideo": false, "videoEdit": false, "custom": true,
        "maxReferenceImages": 16,
        "options": { "aspectRatios": ["auto", "1:1", "3:2", "2:3"], "counts": [1, 2, 3, 4] },
        "defaults": { "aspectRatio": "auto", "count": 1 }
      },
      "chat": {
        "kind": "chat", "acceptsImage": true, "acceptsVideo": false, "videoEdit": false, "custom": true,
        "maxReferenceImages": 8, "options": {}, "defaults": {}
      }
    }
  }
]
```

| 字段 | 含义 |
| --- | --- |
| `type` | 服务商标识：`gaorui`、`openai` 或 `gemini`。添加服务商时作为 `type` 传。 |
| `label` | 这一家的名称。 |
| `recommended` | 排在最前面推荐的那一家为 `true`（高瑞）。 |
| `keyUrl` | 去哪里注册申请 Key，或 `""`。服务商表单在 API Key 旁链接到这里。 |
| `defaultBaseUrl` | 这一家的官方地址。 |
| `models[]` | 这一家的模型清单。`model` 是上游模型名；其余字段同 [ModelSpec](#get-apimodels)。`desc` 是可选的。 |
| `customKinds` | 这一家的自定义模型可以是哪些类型。 |
| `customDefaults` | 这些类型各自的自定义模型能用的参数。 |

### 服务商

一个服务商就是「一家内置服务商加一个 Key」，属于添加它的那个空间：账号的个人空间，或团队。返回的样子（Key 本身永远不返回）：

```json
{
  "id": "665f…", "type": "gaorui", "name": "Gaorui", "slug": "gaorui",
  "baseUrl": "https://gaorui.cc", "customBaseUrl": false,
  "customModels": [ { "model": "some-chat-model", "kind": "chat", "label": "" } ],
  "enabled": true, "sort": 0,
  "hasKey": true, "keyTail": "3456", "keyUnreadable": false, "restricted": false,
  "maintainer": { "id": "670e…b2", "username": "linzhou", "name": "linzhou", "state": "active", "left": false, "deleted": false },
  "lastTest": { "ok": true, "at": "2026-10-12T08:15:02.000Z", "message": "Connected" },
  "createdAt": "…", "updatedAt": "…"
}
```

- `baseUrl` 是实际使用的地址：给这个服务商保存的那个，或者这一家的官方地址。不是官方地址时 `customBaseUrl` 为 `true`。
- `customModels` 是手动添加的模型，见[自定义模型](#自定义模型)。
- `keyUnreadable` 为 `true` 表示存着 Key、但已经解不开（`SECRET_KEY` 变了）。重新填写 Key（`PUT` 时带 `apiKey`）之前这个服务商不能用：测试连接返回 `ok: false`，用它的模型发起运行或估价返回 `400 provider.key_undecryptable`。`hasKey` 和 `keyTail` 保持原样。
- `restricted` 为 `true` 是给不管理团队服务商的团队成员看的：这时 `keyTail` 和 `baseUrl` 是 `""`，`customBaseUrl` 是 `false`，`lastTest` 是 `null`。
- `maintainer` 是最后一次改动这个服务商的 [Person](#成员)，也就是有问题该找的人；个人空间里就是账号自己。`updatedAt` 是改动的时间。什么都没变的保存，以及测试连接，都不改这两项。
- `lastTest` 是对当前保存的这份配置最近一次测试连接的结果：`ok`、`at`（时间）和 `message`（测试的结论，按读者的语言给出；失败时是上游自己给的原因）。从没测过，或者之后 Key 或地址变了，为 `null`：旧结果说明不了新配置。
- 不再有 `options` 对象，顶层也不再有模型字段。

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/admin/providers` | | 服务商数组。 |
| POST | `/api/admin/providers` | `{ type, apiKey, name?, baseUrl?, enabled?, sort?, slug? }` | 服务商。 |
| PUT | `/api/admin/providers/:id` | `name`、`baseUrl`、`apiKey`、`clearKey`、`enabled`、`sort` 中的任意几个 | 服务商。 |
| DELETE | `/api/admin/providers/:id` | | `{ id }`。连同它的模型的覆盖项一起删。 |
| POST | `/api/admin/providers/:id/test` | | `{ ok, message }`。结果同时记为这个服务商的 `lastTest`。 |

```bash
curl -X POST http://localhost:3000/api/admin/providers \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"openai","apiKey":"sk-…"}'
```

- `type` 是服务商标识，`apiKey` 必填。`name` 默认是这一家的名称。不带 `baseUrl` 表示用官方地址。
- 是哪一家在添加时就定了。`PUT` 带上不同的 `type` 会被拒绝，错误码 `provider.vendor_fixed`；带相同的 `type` 可以，会被忽略。
- 修改时不带 `apiKey` 或传 `""` 表示保留已存的 Key；传 `"clearKey": true` 表示清除。`"baseUrl": ""` 表示改回官方地址。
- **已保存的 Key 只会发往保存时的那个地址。** 在已存有 Key 的情况下，`PUT` 修改实际使用的地址（改成别的地址，或改回官方地址），必须在同一个请求里重新带上这个 Key（`apiKey`），或者放弃已存的 Key（`"clearKey": true`）；否则返回 `400 provider.key_required_for_url`，什么都不改。传的地址和正在用的是同一个（写法不同也算：末尾多一个斜杠、主机名大小写不同）不算修改，不需要 Key。没有这条规则，能编辑服务商的人就可以把它指到自己的服务器上，拿走一个他从没见过的 Key。是哪一家（它同样决定 Key 发往哪里、怎么发）完全不能改，上游的重定向从不跟随。
- 测试接口不读请求里的任何东西：测的就是保存着的那一份，已存的 Key 发往已存的地址。
- `slug` 在添加时确定（请求体里的 `slug`，没有就用服务商标识），之后不能改。它在这个空间的服务商里唯一：同一家加第二个就是 `gaorui-2`，以此类推。别的空间的 slug 不相干。
- 一个空间最多 50 个服务商（`provider.max`）。
- 测试接口调用上游的模型列表接口，用来证明地址和 Key 可用；它不再返回模型数量。上游连不上时返回 HTTP 200，`ok: false`，并带原因。测试不通过是一个回答，不是错误。

错误码：`provider.type_unsupported`、`provider.max`、`provider.api_key_required`、`provider.key_required_for_url`、`provider.vendor_fixed`、`provider.type_gone`、`provider.base_url_scheme`、`provider.base_url_credentials`、`validation.bad_url`、`validation.bad_format`、`common.name_required`（400）；`provider.not_found`（404）；`provider.slug_exhausted`（409）。

### 自定义模型

模型清单之外的模型，按服务商添加。每个接口都返回服务商对象，带更新后的 `customModels`。

| 方法 | 路径 | 请求体 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/admin/providers/:id/models` | `{ model, kind, label? }` | 添加一个自定义模型。 |
| PUT | `/api/admin/providers/:id/models/:model` | `{ kind?, label? }` | 修改类型或显示名称。模型名不能改。 |
| DELETE | `/api/admin/providers/:id/models/:model` | | 删除它，连同它的覆盖项（启用状态、排序、价格）。 |

```bash
curl -X POST http://localhost:3000/api/admin/providers/665f…/models \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"some-chat-model","kind":"chat","label":"My chat model"}'

curl -X PUT 'http://localhost:3000/api/admin/providers/665f…/models/org%2Fmodel%3Atag' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"label":"Renamed"}'
```

- `model` 是上游的模型名：字母、数字和 `. _ - : / @`，最长 120 个字符。放在路径里要做 URL 编码。
- `kind` 必填，没有默认值。它必须在这一家的 `customKinds` 里；内置的三家都是 `image` 或 `chat`，所以 `video` 会被拒绝。
- `label` 可选，最长 80 个字符。
- 添加后，这个模型以 `<slug>:<model>` 出现在 `GET /api/models` 里，`custom: true`，参数取自 `customDefaults[kind]`。
- 用 `PUT` 传新的 `label`，会同时清掉通过 `PUT /api/admin/models/:modelId` 给这个模型设的显示名称。

| 错误码 | 状态码 | 什么时候 |
| --- | --- | --- |
| `provider.custom_name_required` | 400 | 没带 `model`，或者是空的。 |
| `provider.custom_bad_name` | 400 | `model` 里有别的字符，或者超过 120 个字符。 |
| `provider.custom_kind_required` | 400 | 没带 `kind`，或者不是 `image`、`video`、`chat`。 |
| `provider.custom_kind_unsupported` | 400 | 这一家不接受这种类型的自定义模型。 |
| `provider.custom_in_catalog` | 400 | 这一家的模型清单里已经有这个模型。 |
| `provider.custom_exists` | 400 | 这个服务商已经有这个自定义模型。 |
| `provider.custom_max` | 400 | 这个服务商已经有 100 个自定义模型。 |
| `provider.custom_name_fixed` | 400 | `PUT` 的请求体里带了不同的 `model`。 |
| `provider.custom_not_found` | 404 | 这个服务商下没有这个名字的自定义模型。 |

### 模型（管理）

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/admin/models` | | 调用者的服务商下的全部模型，包括停用的和自定义的：ModelSpec（带 `custom`）加上 `enabled`、`providerEnabled`、`sort` 和 `override`（`{ enabled, label, sort, defaults, pricing }` 或 `null`）。 |
| PUT | `/api/admin/models/:modelId` | `{ enabled?, label?, sort?, defaults?, pricing? }` | 合并后的 ModelSpec。 |

- `:modelId` 里有冒号，还可能有斜杠：要做 URL 编码（`gaorui%3Anano-banana-2`）。它在请求作用的那个空间的服务商里找，覆盖项也只为这个空间保存。
- 某个字段传 `null` 表示去掉覆盖项里的这一部分。`"pricing": null` 去掉你填的价格；内置的模型清单不带任何价格，所以这个模型又显示「成本未知」。
- `pricing` 是 `{ currency, unit, by?, price?, table? }`：

| 字段 | 取值 |
| --- | --- |
| `currency` | 字符串，转成大写，最长 8 个字符。默认 `CNY`。 |
| `unit` | `per_image`、`per_video`、`per_second`、`per_1m_tokens` |
| `by` | 只有一个价格（`price`）时不带。否则是 `resolution`、`duration` 或 `resolution_duration`，并带 `table`。 |
| `price` | 数字，≥ 0。 |
| `table` | 「键 → 数字（≥ 0）」的对象，1 到 200 项，键最长 40 个字符，不能有 `.`，不能以 `$` 开头。`resolution_duration` 的键是 `"<resolution>:<duration>"`，或者嵌套一层（`{ "720p": { "6": 1 } }`）。`per_1m_tokens` 的 `table` 必须是 `{ input, output }`（各自是每百万 token 的价格）。 |

错误码：`model.bad_id`、`common.nothing_to_update`、`validation.invalid`、`validation.non_negative`、`price.table_size`、`price.table_key`、`price.token_table`（400）；`model.not_found`（404）。

### 站点设置

仅超级管理员。整个实例一套设置。

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/admin/settings` | | 一个扁平对象，包含每一项设置。 |
| PUT | `/api/admin/settings` | 这些键的任意子集 | 修改后的完整对象。 |

各个键、默认值和范围列在[配置](configuration.zh-CN.md#管理设置)里。随账号功能一起增加的键：

| 键 | 默认 | 范围 | 含义 |
| --- | --- | --- | --- |
| `registrationOpen` | `true` | 布尔值 | 是否允许自行注册；注册出来的只会是 `user` 账号。环境变量 `REGISTRATION_OPEN` 给它第一个值，这项设置保存过之后就不再理会这个变量（见[配置](configuration.zh-CN.md#账号)）。也可以通过 [`/api/admin/site`](#注册开关) 读写。 |
| `userConcurrency` | `4` | 1–32 | 一个账号同时在执行的运行数。`concurrency`（默认 4）仍是整个实例的总数。 |
| `userQueueLimit` | `200` | 1–500 | 一个账号未完成的运行（排队中、运行中、转存中）上限，个人空间和所在团队合计。整个实例的总上限仍是 500。 |
| `teamMaxPerUser` | `3` | 1–100 | 一个有授权的账号最多创建（并担任团长）几个团队。 |
| `teamMaxMembers` | `50` | 1–1000 | 一个团队最多多少成员；超级管理员给某个团队单独设过的除外。 |
| `teamConcurrency` | `4` | 1–32 | 一个团队同时在执行的运行数；团队单独设过的除外。 |
| `teamActivityDays` | `365` | 0–3650 | 团队动态保留多少天；`0` 表示永久。 |

其他上限、各个超时和 `retentionDays` 也是站点设置，对所有账号的运行生效。没有按账号的存储配额。

全部的键是 `siteName`、`logoUrl`、`showSiteName`、`defaultLocale`、`registrationOpen`、`concurrency`、`userConcurrency`、`userQueueLimit`、`maxRetries`、`imageTimeoutMinutes`、`videoTimeoutMinutes`、`chatTimeoutSec`、`submitTimeoutSec`、`downloadTimeoutSec`、`retentionDays`、`teamMaxPerUser`、`teamMaxMembers`、`teamConcurrency` 和 `teamActivityDays`。早期版本的 `defaultTheme` 已经不在其中：主题是每个账号自己的偏好（`prefs.theme`），不是站点设置。`GET` 不返回它；`PUT` 像对待其他不认识的键一样，以 `settings.unknown_key` 拒绝它；早期版本存下来的值不再使用。

错误码：`auth.forbidden`（403）；`settings.unknown_key`（任何不是设置项的键，包括 `constructor`、`__proto__` 这样的名字）、`validation.int_range`、`validation.one_of`、`validation.string`、`validation.boolean`、`settings.logo_url`（400）。

### 注册开关

仅超级管理员。和 `registrationOpen` 这项设置是同一个值，单独给一个接口。

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/admin/site` | | `{ "registrationOpen": boolean }` |
| PUT | `/api/admin/site` | `{ "registrationOpen": boolean }` | `{ "registrationOpen": boolean }` |

关闭注册后，已有账号照常登录，`POST /api/auth/register` 返回 `403` `auth.registration_closed`，没有例外。在这里 `PUT` 会保存这项设置，之后环境变量 `REGISTRATION_OPEN` 不再生效。

错误码：`auth.forbidden`（403）；`registrationOpen` 没带或不是布尔值时返回 `validation.boolean`（400）。

### 账号管理

仅超级管理员。超级管理员管的是账号，不是账号里的东西：这里的接口不返回别的账号的画布、Key 或文件。

**GET /api/admin/users** 返回全部账号，创建早的在前（最多 1000 个）：

```json
[
  {
    "id": "670e…b2", "username": "admin", "email": "", "role": "owner", "mustChangePassword": false, "createdAt": "2026-10-09T02:58:01.120Z",
    "disabled": false,
    "lastLoginAt": "2026-10-09T03:40:12.004Z",
    "canCreateTeams": true,
    "counts": { "workflows": 33, "runs": 35 },
    "teams": { "member": 2, "owned": 1 }
  }
]
```

[User](#user-对象) 的各个字段，加上：

| 字段 | 含义 |
| --- | --- |
| `disabled` | 账号被超级管理员停用时为 `true`。 |
| `lastLoginAt` | 最近一次为这个账号开会话的时间，或 `null`。 |
| `canCreateTeams` | 这个账号能不能创建团队：超级管理员给的授权（超级管理员自己恒为 `true`）。 |
| `counts.workflows` | 这个账号个人空间里没删除的画布数。 |
| `counts.runs` | 这个账号个人空间里的用量记录数。 |
| `teams.member`、`teams.owned` | 这个账号加入了几个团队，其中担任团长的有几个。 |

**PATCH /api/admin/users/:id** 接受 `{ "disabled"?: boolean, "canCreateTeams"?: boolean }`（至少一个），返回这个账号的那一行，结构同上。`canCreateTeams` 授予或收回创建团队的授权（见[谁可以创建团队](#谁可以创建团队)）；收回不影响这个账号已有的团队。被停用的账号保留它的团队和成员身份。停用后这个账号的会话立即全部结束；它不能再登录（`auth.account_disabled`），它的凭证返回 `401`。它**还在排队**的运行（个人空间和各个团队里的）被取消，和成员被移出团队时完全一样，占着的团队每月上限名额随之退回；已经开始的运行让它跑完。它在团队画布上持有的编辑锁立即释放，别人不用等锁过期。返回里带 `runsCanceled`，即取消了几条（其他修改时为 `0`）。它的数据保留。`"disabled": false` 恢复访问。

**DELETE /api/admin/users/:id?confirm=&lt;用户名&gt;** 删除账号和它的个人空间。还是某个团队团长的账号不删（`409 team.account_owns_teams`）：先转让团队或删除团队。这个账号退出它所在的其他每个团队，它在那里做的东西留在团队（见[超级管理员与团队](#超级管理员与团队)）。`confirm` 必须和这个账号的用户名完全一致。它先停掉这个账号未完成的运行，删除它的会话、画布、分享链接、资产、品牌包、服务商和 Key、模型覆盖项、用量记录、模板和存下的文件，最后删账号本身。不能撤销。

```json
{
  "id": "6711…4d",
  "removed": { "workflows": 12, "shares": 2, "userassets": 7, "providers": 1, "modeloverrides": 4, "runs": 40 },
  "files": 96,
  "filesRemoved": true
}
```

- `removed` 是「集合名 → 删掉的文档数」（`workflows`、`shares`、`userassets`、`brandkits`、`providers`、`modeloverrides`、`runs`、`templates`、`texttemplates`）；没有东西可删的集合不出现。
- `files` 是删掉的已存文件数：这个账号的 key 前缀下的全部文件（`uploads/<account id>/`、`outputs/<account id>/`、`tools/<account id>/` 以及它们的缩略图），每个已配置的后端上都删。
- `filesRemoved` 为 `false` 表示文件还没有全部删完：某个存储连不上、拒绝了，或者返回时还在清理（请求最多等存储 4 秒）。不管怎样账号都已经删了。剩下的文件在后台继续删，每 10 分钟重试一次，最多 30 天；服务端日志里写明文件留在哪里，以及一直删不掉时该手动删什么。见[存储](storage.zh-CN.md#存储连不上的时候)。
- key 里没有账号这一段的文件（有账号之前存下的）不会被这样删掉。它们属于超级管理员，而超级管理员是删不了的。

**POST /api/admin/users/:id/reset-password** 不用请求体，设一个随机密码，并结束这个账号的全部会话。返回：`{ "temporaryPassword": string }`，16 个字符，只在这一次返回，不以可读的形式保存。它还把这个账号的 `mustChangePassword` 置为 `true`。把密码转交给对方；对方用它登录后，系统会立刻要求设置新密码（`PUT /api/auth/password`），在这之前接口不给用别的。网页端的入口是**设置 → 用户管理**里的**重置密码**。不发邮件。超级管理员自己忘了密码，在服务器上运行 `node server/src/cli/reset-password.js <username-or-email>`（用户名或邮箱），做的是同样的三件事。

带 `:id` 的三个接口的错误：

| HTTP | `code` | 什么时候 |
| --- | --- | --- |
| 400 | `auth.cannot_modify_self` | `:id` 就是调用者。超级管理员改自己的密码用 `PUT /api/auth/password`，不能停用或删除自己的账号。 |
| 400 | `auth.cannot_modify_owner` | `:id` 是超级管理员账号。 |
| 400 | `auth.confirm_mismatch` | 仅 `DELETE`：没带 `confirm`，或者它不是这个账号的用户名。 |
| 400 | `validation.boolean` | 仅 `PATCH`：`disabled` 和 `canCreateTeams` 都没给，或者其中一个不是布尔值。 |
| 409 | `team.account_owns_teams` | 仅 `DELETE`：这个账号是一个或多个团队的团长。 |
| 403 | `auth.forbidden` | 调用者不是超级管理员。 |
| 404 | `auth.user_not_found` | 没有这个 id 的账号。 |

### 存储

仅超级管理员（其他账号 `auth.forbidden`，403）。文件存在哪里，对所有账号都一样：本地磁盘，或一个兼容 S3 的桶。存储不在 `/api/admin/settings` 里，有它自己的接口。各字段的含义、各家服务的填法、切换时已有文件怎么办，见[存储](storage.zh-CN.md)。

| 方法 | 路径 | 请求体 | 返回 |
| --- | --- | --- | --- |
| GET | `/api/admin/storage` | | 存储状态（见下）。带 `?probe=1` 时先把每个桶问一遍连不连得上（同时问，每个桶 3 秒，总共最多 4 秒；5 秒内刚得到过回应的桶不再问），所以 `buckets` 里的状态是此刻的。不带时立刻返回，状态是上一次有文件请求碰到那个桶时的样子。 |
| POST | `/api/admin/storage/test` | `{ s3: {…} }` | 用提交的、尚未保存的配置做一次连接测试的结果。 |
| PUT | `/api/admin/storage` | `{ driver: "local" }` 或 `{ driver: "s3", s3: {…}, force?: true }` | 修改后的存储状态。 |
| DELETE | `/api/admin/storage/buckets/:id` | | 修改后的存储状态。不再读取一个已经不写入的桶，见下。 |

**存储状态**，`GET`、成功的 `PUT` 和 `DELETE` 都返回它：

```json
{
  "source": "saved",
  "driver": "s3",
  "delivery": "proxy",
  "envDriver": "local",
  "secretUnreadable": false,
  "writable": true,
  "upstream": "inline",
  "upstreamReason": "",
  "s3": {
    "preset": "minio",
    "endpoint": "http://minio:9000",
    "region": "us-east-1",
    "bucket": "loomcanvas",
    "accessKeyId": "AKIA…",
    "forcePathStyle": true,
    "keyPrefix": "",
    "publicBaseUrl": "",
    "presignEndpoint": "",
    "delivery": "proxy",
    "acl": "",
    "hasSecret": true,
    "secretTail": "x9Qd",
    "endpointHost": "minio:9000"
  },
  "previous": [
    { "endpointHost": "s3.eu-west-1.amazonaws.com", "bucket": "old-bucket", "keyPrefix": "" }
  ],
  "buckets": [
    { "id": "s3-0f3a9c1e7b52", "endpointHost": "minio:9000", "bucket": "loomcanvas", "keyPrefix": "", "origin": "saved", "active": true, "state": "ok", "removable": false },
    { "id": "s3-77c0d1a4e9b3", "endpointHost": "s3.eu-west-1.amazonaws.com", "bucket": "old-bucket", "keyPrefix": "", "origin": "saved", "active": false, "state": "unreachable", "downSince": "2026-10-13T08:15:02.000Z", "removable": true }
  ]
}
```

| 字段 | 含义 |
| --- | --- |
| `source` | 当前的选择从哪里来：`saved`（通过这个接口或设置页保存过配置）、`env`（环境变量里的 `STORAGE_DRIVER=s3`）、`default`（本地磁盘，什么都没配）。 |
| `driver` | 接收新文件的后端：`local` 或 `s3`。 |
| `delivery` | 当前后端上的文件，`/files/<key>` 怎么回答：`proxy` 或 `redirect`；`driver` 为 `local` 时为空。 |
| `envDriver` | `STORAGE_DRIVER` 的值。 |
| `secretUnreadable` | 保存的密钥解不开时为 `true`（`SECRET_KEY` 变了）。要重新填写；在这之前那个桶里的文件返回 `503`。`driver` 仍是保存的那个。 |
| `writable` | 新文件被拒绝期间为 `false`：正在使用的就是密钥解不开的那个桶。这时上传返回 `503 storage.secret_unreadable`，图片和视频的运行也是，而且发生在向上游发任何东西之前。不会改写到别处。见[存储](storage.zh-CN.md#备份)。 |
| `upstream` | 现在存下的文件怎么交给上游模型：`public_base`（桶的公开域名）、`signed`（预签名地址）、`app`（`PUBLIC_URL` + `/files/<key>`）或 `inline`（没有公网上的上游打得开的地址：图片内联发送，必须是地址的输入被拒绝）。它为 `inline` 时，bootstrap 里的 `media.upstreamByUrl` 为 `false`。现在什么都存不了（`writable` 为 `false`）时是 `unavailable`：这既不是一种交付方式，也不是一项要改的配置，所以 bootstrap 给出 `media.writable: false`，而 `media.upstreamByUrl` 继续按配置回答。规则见[存储](storage.zh-CN.md#什么算公网可达)。 |
| `upstreamReason` | `upstream` 为 `unavailable` 的原因：`secret_unreadable`。其余时候是空串。 |
| `buckets` | 会去查找文件的每一个桶，正在使用的排第一。`origin`：`saved`（通过这个接口或设置页）或 `env`（`S3_*` 变量；不管 `STORAGE_DRIVER` 怎么写都会读）。`state`：`ok`（没发现它有问题）、`unreachable`（它没有回应；`downSince` 说明从什么时候起；文件请求每次让它歇 30 秒，`?probe=1` 会立刻问它）或 `secret_unreadable`。`removable`：`DELETE /api/admin/storage/buckets/:id` 接不接受它。设置页和环境变量里都写了的桶只出现一次。 |
| `s3` | 表单的初始内容，即 S3 配置：保存的那一份（`driver` 为 `local` 时也留着），没有就是环境变量里的，再没有就是 `null`。密钥永远不返回：用 `hasSecret` 和 `secretTail`（末四位）代替。`endpointHost` 是 endpoint 的主机；endpoint 为空时是这个区域的 AWS 默认主机。 |
| `previous` | 更早保存过的桶，最多 5 个。它们不再接收新文件，仍然会被读取。 |

**请求体里的 `s3` 对象**：

| 字段 | 取值 |
| --- | --- |
| `preset` | `aws`、`r2`、`oss`、`minio` 或 `custom`（默认）。只是表单用的标签，对请求没有影响。 |
| `endpoint` | `http(s)://host[:port]`，不带路径、账号密码和查询串。AWS S3 留空。不能以桶名开头。 |
| `region` | 默认 `us-east-1`。 |
| `bucket` | 必填。3 到 63 个小写字母、数字、点和连字符。 |
| `accessKeyId` | 必填。 |
| `secretAccessKey` | 留空或不带表示「沿用已存的那个」（保存的密钥，没有就是环境变量里的），但**只在 `endpoint` 和 `accessKeyId` 与这个密钥保存时相同的情况下**。请求里写了别的 endpoint 或别的 Access Key ID，就必须把密钥一起带上：否则 `400 storage.secret_required`，`PUT` 和连接测试都一样。桶、区域、前缀和其他选项可以改，已存的密钥照旧。一个密钥都没有时必填。 |
| `forcePathStyle` | 布尔值，默认 `false`。 |
| `keyPrefix` | 可选，桶里的一个目录。返回时已规范化，末尾带斜杠（`a/b/`）。 |
| `publicBaseUrl` | 可选，对应桶根目录的 `http(s)` 地址；可以带路径。返回时末尾不带斜杠。 |
| `presignEndpoint` | 可选，`http(s)://host[:port]`，不带路径：`endpoint` 只在部署内部能用时，这个 S3 服务在公网上的地址。交给上游模型的预签名地址按它生成；服务端从不连接它。校验规则同 `endpoint`。 |
| `delivery` | `proxy` 或 `redirect`。默认：设了 `publicBaseUrl` 是 `redirect`，否则是 `proxy`。`redirect` 要求有 `publicBaseUrl`。 |
| `acl` | `""`（默认）、`private` 或 `public-read`。 |

**POST /api/admin/storage/test** 真实地走一遍：在 `probe/` 下写一个小对象，查询它（并查询一个不存在的 key，用来发现没有列表权限的凭证），读回来比对字节，分发方式是 `redirect` 时再从公开地址加载一次，然后删除。什么都不保存。

```json
{
  "ok": false,
  "steps": [
    { "step": "put", "status": "failed", "ms": 41 },
    { "step": "head", "status": "skipped" },
    { "step": "get", "status": "skipped" },
    { "step": "delete", "status": "skipped" }
  ],
  "message": "The Secret Access Key is wrong (the signature does not match). Paste it again, without spaces",
  "code": "storage.err_signature"
}
```

- `steps[].step` 是 `put`、`head`、`get`、`public`（只在 `redirect` 分发时）或 `delete`；`status` 是 `ok`、`failed` 或 `skipped`；跳过的步骤没有 `ms`。
- `message` 按请求的语言给出。`ok` 为 `true` 时 `code` 为空。
- 测试不通过是一个回答，不是错误：HTTP 200，`ok: false`。只有请求体校验不过才返回 400。
- 测试不通过时的 `code`：`storage.err_access_key`、`storage.err_signature`、`storage.err_access_denied`、`storage.err_list_permission`、`storage.err_no_bucket`、`storage.err_region`、`storage.err_unreachable`、`storage.err_host_not_found`、`storage.err_host_bucket_not_found`（请打开路径风格寻址）、`storage.err_path_style_refused`（请关掉它）、`storage.err_tls`、`storage.err_clock_skew`、`storage.err_not_s3`、`storage.err_read_back`、`storage.err_public_unreachable`、`storage.err_public_status`、`storage.err_public_mismatch`、`storage.err_other`。各自的含义见[存储](storage.zh-CN.md#排查问题)。
- 服务端会连接提交的 `endpoint` 和 `publicBaseUrl`。这两个地址不受 SSRF 防护限制，见[安全](security.zh-CN.md#ssrf-防护)。

**PUT /api/admin/storage** 保存并立即切换，不用重启。正在进行的上传在它开始时的后端上完成。

- `{ "driver": "local" }` 改回本地磁盘。保存着的 S3 配置留着，仍然可读。
- `{ "driver": "s3", "s3": {…} }` 先做连接测试。不通过就什么都不保存，返回 HTTP 400，`code: "storage.save_needs_test"`，并且和别的错误不同，带内容：`data.test` 是上面那种结构的测试结果。
- `"force": true` 不测试直接保存。
- 保存一份指向别处的配置（别的 endpoint、桶或 key 前缀）时，原来那份移到 `previous`。文件不会被移动。

错误码（400）：`storage.save_needs_test`、`storage.endpoint_has_path`、`storage.endpoint_has_bucket`、`storage.bad_bucket`、`storage.bad_key_prefix`、`storage.redirect_needs_public_url`、`validation.required`、`validation.one_of`、`validation.bad_url`、`validation.bad_format`、`validation.string`、`validation.boolean`、`storage.secret_required`。针对表单里某一栏的拒绝带 `data: { field }`（`endpoint`、`publicBaseUrl`、`presignEndpoint`、`bucket`、`region`、`accessKeyId`、`secretAccessKey`、`keyPrefix`……），它的 `message` 用的是设置页上的叫法（「签名地址用的 Endpoint 只能是服务地址…」），不是这一栏在接口里的键名。`storage.endpoint_has_path` 和 `storage.endpoint_has_bucket` 是 `endpoint` 和 `presignEndpoint` 共用的，靠 `data.field` 区分。

**DELETE /api/admin/storage/buckets/:id** 把一个桶从「会去读取的桶」里拿掉（`id` 取自状态里的 `buckets`，`removable` 为 `true` 的）：更早的桶，或者正在用本地磁盘时保存着的那个桶。它是给已经彻底没了的桶用的：只要一个死掉的桶还在列表里，哪里都找不到的文件就返回 `503` 而不是 `404`，因为文件可能在那个桶里。这个桶的文件不再加载；桶里的东西不删除。错误码：`404 storage.bucket_not_found`、`400 storage.bucket_in_use`（新文件正写在这个桶里）、`400 storage.bucket_from_env`（它来自 `S3_*` 变量：去掉变量即可）。

**存储出问题期间**，任何读取或存储文件的接口都可能返回 `503`，错误码是这三个之一：`storage.unreachable`（一个可能存在的文件查不了或读不了）、`storage.write_failed`（文件存不下来）和 `storage.secret_unreadable`（见上面的 `writable`）。说明见[存储](storage.zh-CN.md#排查问题)。

### 用量

按空间：个人空间里，汇总和记录都是调用者自己的运行，没有跨账号汇报用量的接口。带 `X-Space` 时是团队的，谁看得到谁的记录见[团队的用量](#团队的用量)（`groupBy=member`、`member` 筛选、`scope`、每条记录上的 `createdBy`）。

网页端里这就是**生成记录**页和**工作台**的用量卡片。

两个 `GET` 接口共用的查询参数：

| 参数 | 含义 |
| --- | --- |
| `from`、`to` | 按运行的创建时间筛选的日期范围。只写日期（`2026-10-31`）表示 `tz` 里的那个自然日：`from` 从这一天开始算，`to` 算到这一天结束。完整的 ISO 时刻或毫秒时间戳按原样使用。 |
| `tz` | IANA 时区名，例如 `Asia/Shanghai`。默认 `UTC`。它决定 `from` 和 `to` 里只写日期时指的是哪一天，以及 `groupBy=day` 时一天在哪里结束、下一天从哪里开始。不带时一切按 UTC 的日子算，和早期版本一样。 |
| `kind` | `image`、`video` 或 `chat` |
| `status` | 运行的一个状态 |
| `model` | 一个模型 id |
| `q` | 文字搜索，最多 100 个字符（超过返回 `400 validation.max_length`；首尾空格不算，空的 `q` 等于没搜）。只留**提示词**、**模型**（名称或 id）或**所在画布的名字**里含这段文字的运行；按字面匹配，不分大小写，从不当作模式。它只在调用者本来就能列出的记录里再筛：团队成员仍然只有自己的记录；按画布名匹配时只认调用者看得到的画布（没人能借别人私有画布的名字搜到运行）；回收站里的画布不搜。汇总也适用，所以汇总和列表对得上。 |

**GET /api/admin/usage** — 另有参数：`groupBy` = `day`（默认）或 `model`。返回里的 `timezone` 是实际用的时区。

```json
{
  "groupBy": "day",
  "timezone": "UTC",
  "totals": { "key": "total", "runs": 13, "succeeded": 10, "failed": 1, "canceled": 1, "inProgress": 1, "reserved": { "CNY": 0.1 }, "counted": { "runs": 11 }, "amount": 1.0, "currency": "CNY", "unknownCount": 2, "costs": { "CNY": 1.0 } },
  "items": [
    { "key": "2026-10-09", "runs": 13, "succeeded": 10, "failed": 1, "canceled": 1, "inProgress": 1, "reserved": { "CNY": 0.1 }, "counted": { "runs": 11 }, "amount": 1.0, "currency": "CNY", "unknownCount": 2, "costs": { "CNY": 1.0 } }
  ]
}
```

- `runs` 是时间段内的全部记录，不管状态：`succeeded` + `failed` + `canceled` + `inProgress`。
- 成本只对**已成功**且成本**已知**的运行求和，按货币分，放在 `costs` 里。`amount` / `currency` 给出其中最大的一项。
- `inProgress` 是此刻还在排队、运行或转存的运行数；`reserved` 是它们占着的金额，按货币分：它们的预估，团队里按 token 计价的对话运行则是它的预留。两者都还没进 `costs`。
- `counted.runs` = `succeeded` + `inProgress`：团队的[每月上限](#每月上限)所计的次数。失败和取消的运行不计。
- `unknownCount` 是已成功但成本未知的运行数。
- `groupBy=model` 时，`key` 是模型 id，每一项还带 `label`。

**GET /api/admin/usage/records** — 另有参数：`page`、`pageSize`（最多 100，默认 20），以及 `full=1`：这一页的每条记录都给完整的（和 `GET …/records/:recordId` 给的一样：提示词和文字结果的全文、`systemPrompt`、`imageUrls`、`videoUrls`）。导出时要用它；翻页看列表不需要。

```json
{
  "list": [
    {
      "id": "6660…", "kind": "image", "status": "succeeded", "progress": 100,
      "model": "gaorui:nano-banana-2", "modelLabel": "Nano Banana 2", "providerType": "gaorui",
      "prompt": "an orange cat…", "promptLength": 14, "promptTruncated": false,
      "params": { "resolution": "1K" }, "count": 1, "inputs": { "images": 1, "videos": 0 },
      "cost": { "amount": 0.1, "currency": "CNY", "unknown": false },
      "usage": null,
      "text": "", "textLength": 0, "textTruncated": false,
      "outputs": [ { "type": "image", "url": "/files/outputs/2026/10/….png", "thumbnailUrl": "/files/thumbs/….webp", "width": 1024, "height": 1024 } ],
      "filesPurged": false,
      "error": "", "errorCode": "", "workflowId": "665f…", "nodeId": "node-12",
      "createdAt": "…", "startedAt": "…", "finishedAt": "…", "queuedMs": 420, "durationMs": 8300
    }
  ],
  "total": 12, "page": 1, "pageSize": 20
}
```

一条记录就是一次运行，带着生成记录里的一行、它的详情和导出需要的全部内容：

| 字段 | 含义 |
| --- | --- |
| `prompt`、`promptLength`、`promptTruncated` | 提示词。列表里截到 200 个字符：`promptTruncated` 说明是否截断，`promptLength` 是全文长度。 |
| `inputs` | 随提示词一起发出去的图片、视频各有几个。 |
| `cost` | `{ amount, currency, unknown }`。`unknown: true` 是「不知道」，不是「免费」。它是提交时估的数；运行**成功**之后就是这次的花费。失败、取消的运行这一项里留着当初估的数，但并没有花钱（汇总里也不计）：界面上不要把它显示成成本。 |
| `usage` | 对话运行：上游报告的 `{ inputTokens, outputTokens, totalTokens }`。图片、视频运行，以及上游没有报告用量时为 `null`。 |
| `text`、`textLength`、`textTruncated` | 对话运行的文字结果（图片、视频运行以及还没成功的运行为 `""`）。列表里截到 500 个字符。 |
| `outputs` | 图片、视频运行的文件：`[{ type, url, thumbnailUrl, width?, height? }]`。对话运行和未完成的运行为 `[]`。 |
| `filesPurged` | `true` 表示这次运行的文件已经被「结果保留天数」清理掉：运行是成功的，但 `outputs` 为 `[]`。 |
| `error`、`errorCode` | 失败原因（按读者的语言）和这个原因的稳定代码（没失败时为 `""`）。已取消的运行也有：人手动取消是 `run.canceled`；排队时被取消的是它的原因（`run.canceled_member_removed`、`run.canceled_account_disabled`、`run.canceled_team_closed`）。 |
| `queuedMs`、`durationMs` | 排队等了多少毫秒（`createdAt` → `startedAt`）、运行了多少毫秒（`startedAt` → `finishedAt`）；那个阶段还没结束时为 `null`。 |
| `createdBy` | 团队里：发起这次运行的 [Person](#成员)。 |

**GET /api/admin/usage/records/:recordId** — 完整的一条记录：同一个对象，但 `prompt` 和 `text` 是**全文**（`promptTruncated` 和 `textTruncated` 为 `false`），另加 `systemPrompt`、`imageUrls` 和 `videoUrls`（随提示词一起发出去的内容）。别的空间的记录，以及团队里调用者无权列出全队记录时别人的记录，返回 `404 run.not_found`；id 格式不对返回 `400 validation.bad_format`。

`POST /api/runs/download-zip` 把多条记录的结果打成一个压缩包，见[模型与运行](#post-apirunsdownload-zip)。

两个列表接口的错误码（400）：`validation.bad_date`、`validation.from_before_to`、`validation.invalid`（`kind`、`status`、`model`，以及不是已知时区名的 `tz`）。

**DELETE /api/admin/usage/records?before=&lt;日期&gt;[&amp;tz=&lt;时区&gt;]** — 删除调用者在这一刻之前创建的用量记录。只写日期（`2026-01-31`）表示 `tz` 里这一天开始之前（不带 `tz` 按 UTC）；完整的时刻按原样使用。只删已结束的记录（成功、失败、已取消）；排队中和运行中的保留，生成的文件也保留。不能撤销，那段时间的汇总数字随记录一起消失。

返回：`{ "deleted": number }`。错误码（400）：`validation.required`、`validation.bad_date`、`validation.invalid`（`tz`）。

网页端总是把浏览器的时区作为 `tz` 传上去：生成记录页、它的清理弹窗、工作台的本月汇总和近 14 天柱状图都是。所以那里的「今天」是用户本地的今天。

---

## 一个最小的客户端

从命令行生成一张图片。账号要先有一个带自己 Key 的服务商，在**模型管理**页添加，或者用 `POST /api/admin/providers` 添加。

```bash
BASE=http://localhost:3000

# 0. Sign in and keep the token (data.token in the answer)
curl -s -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"account":"ada","password":"correct horse battery"}'
TOKEN=<token from the answer>

# 1. Pick an image model
curl -s "$BASE/api/models?kind=image" -H "Authorization: Bearer $TOKEN"

# 2. Start a run (replace the model id with one from step 1)
curl -s -X POST "$BASE/api/runs" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gaorui:nano-banana-2","prompt":"an orange cat on a windowsill","params":{"aspectRatio":"1:1"}}'

# 3. Poll with the runId from step 2 until status is succeeded or failed
curl -s "$BASE/api/runs/<runId>" -H "Authorization: Bearer $TOKEN"
```
