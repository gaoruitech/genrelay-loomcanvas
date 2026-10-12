# HTTP 接口

[English](api.md)

接口的两份文档：

- [architecture.md](architecture.md)：中文，前后端共同遵守的约定，说明每个接口为什么这样设计。
- [api.md](api.md)：英文，按 `server/src/routes/` 里的代码逐个列出请求、返回和错误码。查某个字段、某个错误码时看这一份。

两份文档与代码不一致时，以代码为准，并请提 issue。

> 状态：早期开发中。首个正式版本发布前，路径和结构可能调整，目前没有接口版本号。

## 通用约定

- 所有接口前缀 `/api`。存下来的文件在 `/files/<key>`，不管用的是哪种存储。
- 请求体是 JSON，上传文件除外（`multipart/form-data`，字段名 `file`）。JSON 最大 1 MB，`/api/workflow` 下最大 6 MB，`/api/auth` 和 `/api/canvas-share` 下最大 64 KB。需要登录的接口先验凭证、再解析请求体。
- 返回统一为 `{ "result": 0, "message": "ok", "data": … }`。失败时 `result` 非 0、HTTP 状态码相应变化，并多一个 `code`：这条提示的稳定标识（`server/src/i18n/zh-CN.js` 里的键）。程序里请按 `code` 判断，不要按 `message`。
- `message` 的语言按请求决定：请求头 `X-Locale`（`zh-CN` 或 `en`）→ `Accept-Language` → 设置里的 `defaultLocale` → `zh-CN`。
- 账号：每个实例都有账号，必须登录才能用，没有「免登录」的模式；旧版本的 `ACCESS_PASSWORD` 已经不起作用。角色只有两种：超级管理员（在接口里的值是 `owner`，下文所有 `role`、错误码里出现的 `owner` 指的都是它）和普通账号（`user`）。超级管理员不靠注册产生：还没有超级管理员时，服务端在启动时按 `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_EMAIL` 自动创建，有且只有一个；注册出来的都是普通账号。没有别的角色，也没有团队。
- 数据按账号隔离：画布、分享链接、资产、品牌包、运行、用量，以及服务商、API Key、自定义模型、模型的启用状态和价格，都是每个账号各自一份。超级管理员调用这些接口时同样只看得到自己的数据，接口不提供查看别人数据的途径。
- 登录：用 `POST /api/auth/register` 注册或 `POST /api/auth/login` 登录，拿到 `token`，之后每个请求带 `Authorization: Bearer <token>`。凭证是 43 个字符的随机串，不是 JWT；服务端只存它的 SHA-256（`sessions` 集合）。不用 cookie。
- 会话有效期 12 小时，登录时带 `remember: true` 则是 30 天；从登录那一刻算起，使用过程中不会延长。退出登录、在别的设备上被结束、修改密码（这个账号的会话全部结束，调用方在响应里拿到一个新凭证）、超级管理员重置密码或停用账号（该账号的会话全部结束）、账号被删除，都立即生效。改 `SECRET_KEY` 不会让任何人掉线。
- 没登录调用需要登录的接口返回 401（`auth.required`，旧版本是 `auth.login_required`）；凭证不存在、已过期、账号被停用也是它。除了 `POST /api/auth/login` 自己的 `auth.invalid_credentials`，401 只表示「没登录」，上游接口的认证失败以 400 返回。
- 只有超级管理员能调用的接口，其他账号调用返回 403（`auth.forbidden`）。
- 账号还在用临时密码时（User 里的 `mustChangePassword` 为 `true`），它的会话只能调用 `GET /api/auth/me`、`GET /api/bootstrap`、`PUT /api/auth/password`、`POST /api/auth/logout`，以及公开接口。其余接口一律返回 403（`auth.password_change_required`，「请先设置新密码，再继续使用」），直到用 `PUT /api/auth/password` 改过密码。
- 按 id 访问别的账号的东西返回 404，和 id 不存在时完全一样（`canvas.not_found`、`run.not_found`、`provider.not_found` 等），不会是 403，更不会返回数据。列表里只有自己的记录。
- 登录、注册、修改密码、修改用户名或邮箱都有限流，超出返回 429（`auth.too_many_attempts`），`data.retryAfterSeconds` 和响应头 `Retry-After` 给出要等多少秒。计数在进程内存里，重启清零。
- 网页端把凭证放在浏览器的本地存储里，键是 `loomcanvas-token`（勾了「记住我」用 `localStorage`，没勾用 `sessionStorage`），再放进上面那个请求头。因为不用 cookie，不存在跨站请求伪造的问题，见[安全](security.zh-CN.md#会话)。
- 未完成的运行（排队中、运行中、转存中）每个账号最多 `userQueueLimit` 个（默认 200），整个实例合计最多 500 个，超出时提交运行返回 429（`run.queue_full`）。
- 跨域：`CORS_ORIGIN` 里列出的来源可以用 `GET`、`POST`、`PUT`、`PATCH`、`DELETE` 调用 `/api`。
- 请求本身格式不对（路径里的百分号编码有误、不支持的字符集等）返回 4xx，`code` 为 `common.bad_request`。

## 接口索引

「公开」表示不需要登录。没有标「公开」的都要登录，操作的都是调用者自己账号的数据。

### 基础

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bootstrap` | 公开。客户端启动时先调它，也用作健康检查；旧路径 `/api/app/bootstrap` 仍然可用，返回相同。返回 `auth: { registrationOpen }`（现在能不能注册，就是 `registrationOpen` 这项设置的值；`auth` 里只有这一个字段）、`user`（带了有效凭证时是调用者的账号，否则 `null`，也就是没登录；还在用临时密码的会话也能调这个接口）、`site: { name, logoUrl, defaultLocale }`（站点名称、Logo、默认语言）、`hasProvider`（调用者自己的账号下有没有启用的服务商，未登录恒为 `false`）、`limits.maxUploadMb`（服务端的上传上限）、`media.upstreamByUrl`（上游能不能按地址读到站内文件：配了公网的 `PUBLIC_URL`，或新文件存在公网能访问的桶里；未登录时恒为 `false`）、`version`。早期版本还有 `authRequired`、`authed` 和 `site.defaultTheme`，现在都去掉了：登录是必须的（看 `user` 即可），界面只有一套主题。 |

### 账号与登录

接口返回的账号对象（下文写作 User）：`{ id, username, email, role, mustChangePassword, createdAt }`。注册、登录、`/api/auth/me`、改资料、bootstrap 里的 `user`、超级管理员的账号列表，给出的都是它。

- `role` 是 `owner`（超级管理员）或 `user`。
- `email` 对超级管理员可能是 `""`：超级管理员是唯一可以没有邮箱的账号（创建时没设 `ADMIN_EMAIL`，之后也还没用 `PUT /api/auth/profile` 补上）。
- `mustChangePassword` 为 `true` 表示这个账号现在的密码是别人知道的：启动时生成的超级管理员密码、超级管理员「重置密码」给出的临时密码（`POST /api/admin/users/:id/reset-password`），或者命令行重置给出的临时密码。`PUT /api/auth/password` 成功后变回 `false`。为 `true` 期间接口几乎什么都不给用，见[通用约定](#通用约定)。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 公开。`{ username, email, password }` → `{ user, token }`，注册后即已登录（会话 12 小时）。用户名 3 到 32 个字符，只能用字母、数字、`_`、`-`；邮箱最长 254 个字符；两者都不区分大小写地唯一。密码 8 到 128 个字符。不发任何邮件，没有邮箱验证。注册出来的一定是普通账号（`role: "user"`），成不了超级管理员；要求 `registrationOpen` 为开，关着的时候一律返回 403（`auth.registration_closed`）。 |
| POST | `/api/auth/login` | 公开。`{ account, password, remember? }` → `{ user, token }`。`account` 填用户名或邮箱，不区分大小写。`user.mustChangePassword` 为 `true` 说明用的是临时密码，下一步只能调 `PUT /api/auth/password`；网页端这时只显示「设置新密码」这一屏（`/password`）。 |
| POST | `/api/auth/logout` | 结束发出这个请求的会话。`data` 为 `null`。还在用临时密码时也能调。 |
| GET | `/api/auth/me` | → `{ user }`。还在用临时密码时也能调。 |
| PUT | `/api/auth/password` | `{ currentPassword, newPassword }` → `{ revokedSessions, token }`。改密码，并结束这个账号的**全部**会话，包括发出这个请求的会话。`token` 是给调用方的新凭证，有效期是被替换掉的那个会话剩下的时间；原来的凭证从此失效，之后的请求要用新的。网页端会悄悄换上。临时密码也是用它换掉的：`mustChangePassword` 为 `true` 时可以调（`currentPassword` 填临时密码），成功后这个标记变回 `false`。新密码不能和当前密码相同。 |
| PUT | `/api/auth/profile` | `{ username?, email? }` → `{ user }`。规则同注册。每个账号每小时最多改 20 次：不限的话，`auth.username_taken` / `auth.email_taken` 这两种回答就成了可以无限次查询「这个邮箱注册过没有」的途径。 |
| GET | `/api/auth/sessions` | 调用者还有效的会话，最近活跃的在前：`[{ id, current, createdAt, lastSeenAt, userAgent, ip }]`。`current` 标出当前会话；`lastSeenAt` 最多每分钟更新一次；`ip` 在反向代理后面要配好 `TRUST_PROXY` 才是真实的客户端地址。 |
| DELETE | `/api/auth/sessions/:id` | 结束自己的一个会话（可以是当前这个）→ `{ id }`。 |
| DELETE | `/api/auth/sessions` | 结束除当前会话以外的全部会话（「退出其他设备」）→ `{ revoked }`。 |

错误码：

| 接口 | HTTP | `code` | 什么时候 |
| --- | --- | --- | --- |
| 注册、改资料 | 400 | `auth.invalid_username`、`auth.invalid_email` | 用户名或邮箱不合规则。 |
| 注册、改密码 | 400 | `auth.weak_password` | 密码不足 8 个或超过 128 个字符。 |
| 注册、改资料 | 409 | `auth.username_taken`、`auth.email_taken` | 用户名或邮箱已被别的账号使用。 |
| 注册 | 403 | `auth.registration_closed` | 超级管理员关闭了注册。 |
| 登录 | 400 | `auth.credentials_required` | 没填 `account` 或 `password`。 |
| 登录 | 401 | `auth.invalid_credentials` | 账号不存在或密码不对。两种情况的返回和耗时都一样。 |
| 登录 | 403 | `auth.account_disabled` | 密码正确，但账号已被超级管理员停用。 |
| 改密码 | 400 | `auth.wrong_current_password` | 当前密码没填或不对。有意不用 401：会话本身没问题。 |
| 改密码 | 400 | `auth.same_password` | `newPassword` 和 `currentPassword` 相同（「新密码不能和当前密码相同」）。 |
| 其余需要登录的接口 | 403 | `auth.password_change_required` | 调用者还在用临时密码（`mustChangePassword` 为 `true`），要先改密码（「请先设置新密码，再继续使用」）。 |
| 改资料 | 400 | `common.nothing_to_update` | 两个字段都没带。 |
| 结束会话 | 404 | `auth.session_not_found` | 没有这个会话，或者它是别的账号的。 |
| 注册、登录、改密码、改资料 | 429 | `auth.too_many_attempts` | 见下面的限流。 |

限流：

| | 对象 | 上限 | 说明 |
| --- | --- | --- | --- |
| (a) | 登录，按「账号名 + 客户端地址」 | 10 分钟 10 次 | 这一对登录成功后清零。IPv6 客户端按 /64 网段计。 |
| (b) | 登录，按客户端地址（所有账号名合计） | 10 分钟 30 次 | |
| (c) | 登录，按账号名（所有地址合计） | 10 分钟 100 次 | 对这个账号的「熟悉地址」不生效。 |
| (d) | 登录，全部合计 | 10 分钟 3000 次 | 对账号的「熟悉地址」不生效。 |
| | 注册，按客户端地址 | 1 小时 20 次 | IPv6 同上。 |
| | 改用户名或邮箱，按账号 | 1 小时 20 次 | |

- 账号名不必存在：存不存在计数方式都一样，所以从限流看不出哪些名字存在。
- 「熟悉地址」指最近 30 天里这个账号从那里成功登录过的地址，或者持有这个账号有效会话的地址。所以拿某个账号名乱猜，不会把它的主人锁在外面：从很多地址轮流猜，会被压到每 10 分钟 100 次，而主人从平时用的地址照样能登录；只有从一个全新的地址登录时，才可能要在这种猜测进行期间等一等。
- 改密码时核对当前密码，计入 (a) 和 (c)；当前密码正确则清掉 (a)。
- 注册必然会透露用户名或邮箱是否已被占用（系统不发邮件，没有别的回答方式），靠注册的限流来约束；在意的话请关闭注册。
- 计数和「账号从哪些地址登录过」的记录都在进程内存里，重启清空。

### 文件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/files/upload` | 上传一个文件。按内容识别类型，接受图片、视频、音频。返回的 `url` 永远是站内相对地址 `/files/<key>`，文件在本地磁盘上还是在桶里都一样。key 的形状是 `uploads/<账号 id>/<年>/<月>/<32 位十六进制>.<扩展名>`（运行结果是 `outputs/…`，工具节点的产物是 `tools/…`）；有账号之前存下的文件没有账号这一段（`uploads/2025/01/<hex>.png`），这些 key 和地址照常有效，不移动、不改名。 |
| POST | `/api/files/fetch` | `{ url }`，由服务端抓取远程图片并转存。只接受图片：地址指向本实例存储里的视频时也返回 400（`file.image_only`）。 |
| GET | `/files/<key>` | 公开，拿到地址的人都能读；key 里的账号段只是为了删除账号时能连同文件一起删，不是访问控制。每个存下来的文件唯一的地址，文件在哪个后端都一样：在本地磁盘上就从磁盘读；在桶里、分发方式是 `proxy` 时由应用从桶里流式转发（支持 `Range` → 206、`If-None-Match` → 304）；分发方式是 `redirect` 时返回 302，指向桶的公开地址。不是图片、视频、音频的一律按附件下载。找不到返回 404；存储服务连不上返回 502。 |

### 模型与运行

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/models` | 调用者自己的服务商下已启用的模型，可带 `?kind=image\|video\|chat`。每个模型带 `custom`：`true` 是用户手动添加的自定义模型，`false` 是服务商清单里的模型。对话模型的 `acceptsVideo` 表示能不能输入视频（高瑞清单里的 `gemini-3.5-flash-c` 和高瑞的自定义对话模型是 `true`，其余都是 `false`；视频怎么发见[服务商](providers.zh-CN.md#哪个节点用哪类模型)），`acceptsImage` 表示能不能读图片（`false` 是纯文本模型）。 |
| POST | `/api/runs/estimate` | 预估一次运行的成本。 |
| POST | `/api/runs` | 发起图片或视频运行 → `{ runId }`。运行属于调用者的账号，用这个账号自己的服务商和 Key 执行。这个账号未完成的运行已有 `userQueueLimit` 个（默认 200），或整个实例合计已有 500 个时，返回 429（`run.queue_full`）。 |
| GET | `/api/runs/:id` | 查询一次运行。别的账号的运行返回 404（`run.not_found`）。 |
| POST | `/api/runs/status` | `{ ids }` 批量查询，最多 100 个。不存在的和别的账号的 id 不出现在返回里。 |
| POST | `/api/runs/:id/cancel` | 取消排队中或进行中的运行。 |
| POST | `/api/llm/tasks` | 发起对话运行 → `{ taskId }`。带 `videoUrl` 而模型没有 `acceptsVideo` 时返回 400（`model.no_video_input`）；带 `imageUrls` 而模型是纯文本模型（没有 `acceptsImage`）时返回 400（`model.no_image_input`）；未完成运行的两个上限同样适用（429）。 |
| GET | `/api/llm/tasks/:id` | 查询对话运行。 |

模型标识是 `<标识>:<上游模型名>`，按账号各算各的：标识（slug）只在一个账号自己的服务商里唯一，两个账号可以各有一个标识为 `gaorui` 的服务商，一个账号里的 `gaorui:nano-banana-2` 和另一个账号里的同名标识没有关系。

排队是公平的：`concurrency` 是整个实例同时执行的运行数，其中一个账号最多占 `userConcurrency` 个。有名额空出来时，先给正在执行的运行最少的账号；一样多的，给最久没拿到名额的；同一个账号内先提交的先执行。一个账号排了很长的队，不会挡住别的账号。

### 画布

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/workflow/list` | 自己的画布列表，最近的 200 张。 |
| POST | `/api/workflow` | 新建。不带 `brandKitId` 时套用这个账号的默认品牌包（有的话）；传 `""` 表示不套用。 |
| GET | `/api/workflow/:id` | 读取。 |
| PUT | `/api/workflow/:id` | 保存，只改请求里带的字段。`brandKitId` 是这张画布的品牌包：`""` 或一个品牌包 id，别的值返回 400（`validation.invalid`）。某个节点不跟随画布时，例外存在节点的 `data.brandKitOverride`（品牌包 id，或 `"none"` 表示不套用）。 |
| POST | `/api/workflow/:id/duplicate` | 复制。品牌包和节点上的例外一并保留。 |
| DELETE | `/api/workflow/:id` | 删除（软删除）。 |
| POST | `/api/workflow/download` | 代理下载一个素材文件。 |
| POST | `/api/workflow/:id/download-zip` | 把画布里的素材打包下载。最多 100 个文件，单个最大 1 GiB，总大小最大 4 GiB；放不下的换成 `NN-<类型>-skipped.txt`。 |

### 模板与工具

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/canvas/templates` | 画布模板：内置模板属于站点，所有账号都看得到；另加调用者自己的。 |
| GET | `/api/canvas/text-templates` | 文本模板，`?lang=zh\|en`。 |
| POST | `/api/canvas/tool/slice` | 切片。 |
| POST | `/api/canvas/tool/collage` | 拼图。 |
| POST | `/api/canvas/tool/watermark` | 加水印。 |
| POST | `/api/canvas/tool/fit` | 改尺寸。 |
| POST | `/api/canvas/platform-export` | 多平台导出。 |

### 品牌包

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/brand-kits` | 列表。每个账号最多 50 个。每项带 `usedBy`：有几张自己的画布在用它（作为画布的品牌包，或某个节点的例外）。 |
| POST | `/api/brand-kits` | 新建。 |
| PUT | `/api/brand-kits/:id` | 修改。 |
| DELETE | `/api/brand-kits/:id` | 删除（软删除）。指向它的画布和节点原样留着，之后运行时不再套用。 |

品牌包由编辑器套用，不由服务端套用：生成节点运行时，浏览器把 `promptPrefix` 加在提示词最前面，把 `negativePrompt` 以「不要出现：…」加在末尾，把 `refImages` 排在节点自己的参考图后面（不超过模型上限），再把拼好的提示词和图片交给 `/api/runs`。分享快照不带品牌包：画布的 `brandKitId` 不进快照，节点的 `brandKitOverride` 在发布、公开读取和复制时都会去掉，复制出来的画布从不套用开始。

### 资产

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/user-asset/list` | 我的资产，分页。每个账号每种分类最多 5000 个。 |
| POST | `/api/user-asset` | 登记一个已上传的文件。 |
| POST | `/api/user-asset/register-output` | 把生成结果存入「成品」。 |
| POST | `/api/user-asset/folder/delete` | 解散文件夹，保留其中的资产。 |
| PUT | `/api/user-asset/:id` | 改名、移动、改标签、改分类。 |
| DELETE | `/api/user-asset/:id` | 删除（软删除，文件保留）。 |
| GET | `/api/canvas-asset/categories` | 公共素材库的分类。素材库属于站点，只读，所有账号看到的是同一份。 |
| GET | `/api/canvas-asset/list` | 公共素材库的列表。 |

### 分享链接

分享链接是唯一有意跨账号的东西：拿到链接的人不用登录就能读快照，登录的账号可以把它复制成自己的画布。其余接口操作的都是自己的链接，每个账号最多 500 个。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/canvas-share/publish` | 为一张画布创建或更新分享。 |
| GET | `/api/canvas-share/mine` | 我的全部链接，含已过期和已撤销的。 |
| GET | `/api/canvas-share/plaza` | 我的有效链接，分页。 |
| GET | `/api/canvas-share/:token` | 公开。只读快照，只认链接里的 token（数据库 id 不行，登不登录都一样）。不存在、已过期、已撤销统一返回 404。快照里不带运行状态、运行号和任务号、失败详情和成本。 |
| POST | `/api/canvas-share/:token/copy` | 需要登录。把快照复制成自己的一张新画布，副本归复制的人。同样只认 token。快照里的模型标识是发布者账号的；在副本里按复制者自己的服务商去找，复制者没有同一标识的服务商时，这个模型就是不可用。 |
| PUT | `/api/canvas-share/:id` | 改标题、描述、有效期、撤销状态。 |
| POST | `/api/canvas-share/:id/revoke` | 撤销。 |
| DELETE | `/api/canvas-share/:id` | 第一次撤销，再调一次从列表移除。 |

### 管理（模型管理、生成记录、设置）

`/api/admin` 下现在有两类接口，路径里的 admin 对第一类来说只是历史名字：

- **按账号的**：服务商和 Key、自定义模型、模型设置和价格、用量。登录的账号都能调用，操作的是调用者自己的数据。
- **只有超级管理员能调用的**：站点设置、存储、注册开关、账号管理。其他账号调用返回 403（`auth.forbidden`），没登录返回 401（`auth.required`）。

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
| `PATCH /api/admin/users/:id` | 仅超级管理员 | 另一个账号：停用或启用 |
| `DELETE /api/admin/users/:id` | 仅超级管理员 | 另一个账号及其全部数据 |
| `POST /api/admin/users/:id/reset-password` | 仅超级管理员 | 另一个账号：密码和会话 |

超级管理员自己的服务商、模型和用量和别人一样是按账号的；没有任何接口能返回别的账号的画布、Key 或文件。`/api/admin` 下其他不存在的路径，非超级管理员得到 403，超级管理员得到 404。

按账号的接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/vendors` | 全部服务商及各自支持的模型。每家：`type`、`label`、`recommended`、`keyUrl`、`defaultBaseUrl`、`models[]`（清单里的模型：`model`、`label`、`kind`、`desc?`、`acceptsImage`、`acceptsVideo`、`videoEdit`、`custom: false`、`maxReferenceImages`、`options`、`defaults`）、`customKinds`（可以添加哪些类型的自定义模型）、`customDefaults`（每种类型的自定义模型能用的参数）。上一个版本的 `GET /api/admin/provider-types` 已经没有了。 |
| GET | `/api/admin/providers` | 自己已添加的服务商列表。每个带 `customBaseUrl`（接口地址是否不是官方地址）和 `customModels: [{ model, kind, label }]`；不再有 `options`，也不再把模型字段平铺在顶层。 |
| POST | `/api/admin/providers` | 添加服务商：`{ type, apiKey, name?, baseUrl?, enabled? }`。`type` 是服务商标识（`gaorui`、`openai`、`gemini`），`apiKey` 必填（`provider.api_key_required`）；不带 `baseUrl` 表示用官方地址。请求里不再有模型字段。每个账号最多 50 个（`provider.max`）；标识（slug）在这个账号自己的服务商里唯一，同一家加第二个就是 `gaorui-2`。 |
| PUT | `/api/admin/providers/:id` | 修改服务商。服务商添加后不能更换：带上不同的 `type` 返回 400（`provider.vendor_fixed`）。 |
| DELETE | `/api/admin/providers/:id` | 删除服务商，连同其模型的覆盖项。 |
| POST | `/api/admin/providers/:id/test` | 连通性测试 → `{ ok, message }`，不再返回 `modelCount`。它调用上游的模型列表接口，只用来证明地址和 Key 可用。 |
| POST | `/api/admin/providers/:id/models` | 添加自定义模型：`{ model, kind, label? }` → 服务商对象。 |
| PUT | `/api/admin/providers/:id/models/:model` | 修改自定义模型的类型或显示名称：`{ kind?, label? }` → 服务商对象。模型名不能改。`:model` 要做 URL 编码。 |
| DELETE | `/api/admin/providers/:id/models/:model` | 删除自定义模型及其覆盖项 → 服务商对象。 |
| GET | `/api/admin/models` | 自己的服务商下的全部模型（含停用的和自定义的）及其覆盖项。 |
| PUT | `/api/admin/models/:modelId` | 修改模型的启用状态、名称、排序、默认参数、价格，只对自己的账号生效。`modelId` 要做 URL 编码。 |
| GET | `/api/admin/usage` | 自己的用量汇总，`groupBy=day\|model`。可带 `from`、`to`、`tz`：只写日期（`YYYY-MM-DD`）表示 `tz` 所给时区里的那个自然日，`from` 从这一天开始算，`to` 算到这一天结束；完整的 ISO 时间按原样使用。`tz` 是 IANA 时区名（如 `Asia/Shanghai`），默认 `UTC`，不带时行为和以前完全一样；不认识的时区名返回 400（`validation.invalid`）。 |
| GET | `/api/admin/usage/records` | 自己的用量明细，分页。`from`、`to`、`tz` 同上。 |
| DELETE | `/api/admin/usage/records` | `?before=<YYYY-MM-DD 或 ISO 时间>` → `{ deleted }`。也可带 `tz`。删除自己在这一刻之前创建、已结束（成功、失败、已取消）的用量记录；只写日期表示 `tz` 所给时区里这一天开始之前（不带 `tz` 就是 UTC 零点之前）。排队中、运行中的不动，文件不删。缺参数或日期不对返回 400（`validation.required` / `validation.bad_date`），时区名不认识返回 400（`validation.invalid`）。 |

只有超级管理员能调用的接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/settings` | 读取站点设置：一个扁平对象，整个实例一份。 |
| PUT | `/api/admin/settings` | 修改站点设置。不认识的键返回 400（`settings.unknown_key`）。早期版本的 `defaultTheme` 已经删除，现在也属于不认识的键；以前存下来的值不再使用。 |
| GET | `/api/admin/storage` | 当前的存储：`source`（`saved` 设置页保存的 / `env` 环境变量 / `default` 默认）、`driver`（`local` / `s3`）、`delivery`、S3 配置（不含密钥，只有 `hasSecret` 和 `secretTail`）、仍在读取的旧桶 `previous`。 |
| POST | `/api/admin/storage/test` | `{ s3 }`，用提交的、尚未保存的配置真实地走一遍：写入、查询、读回比对、（`redirect` 分发时）从公开地址加载、删除。返回 `{ ok, steps, message, code }`。测试不通过也是 HTTP 200，`ok` 为 `false`，`code` 是 `storage.err_*`。 |
| PUT | `/api/admin/storage` | `{ driver: 'local' }` 或 `{ driver: 's3', s3, force? }`，保存并立即切换，不用重启。S3 配置会先测试；不通过就不保存，返回 400（`storage.save_needs_test`），测试结果在 `data.test` 里；带 `force: true` 则不测试直接保存。文件不会被移动。 |
| GET | `/api/admin/site` | → `{ registrationOpen }`。和设置里的 `registrationOpen` 是同一个值，单独给一个接口。 |
| PUT | `/api/admin/site` | `{ registrationOpen: boolean }` → `{ registrationOpen }`。关闭后，已有账号照常登录，新注册返回 403（`auth.registration_closed`），没有例外。不是布尔值返回 400（`validation.boolean`）。在这里保存过之后，环境变量 `REGISTRATION_OPEN` 不再生效。 |
| GET | `/api/admin/users` | 全部账号，创建早的在前（最多 1000 个）：`[{ id, username, email, role, mustChangePassword, createdAt, disabled, lastLoginAt, counts: { workflows, runs } }]`。`counts.workflows` 是没删除的画布数，`counts.runs` 是用量记录数。只有数量，没有内容。 |
| PATCH | `/api/admin/users/:id` | `{ disabled: boolean }` → 这个账号在上面列表里的那一行。停用后它的会话立即全部结束，不能再登录（`auth.account_disabled`），数据保留；`disabled: false` 恢复。 |
| DELETE | `/api/admin/users/:id?confirm=<用户名>` | 删除账号，不能撤销。`confirm` 必须和这个账号的用户名完全一致，否则 400（`auth.confirm_mismatch`）。先停掉它未完成的运行，再删它的会话、画布、分享链接、资产、品牌包、服务商和 Key、模型覆盖项、用量记录、模板和存下的文件，最后删账号。→ `{ id, removed: { <集合名>: <条数> }, files, filesRemoved }`：`files` 是删掉的文件数；`filesRemoved` 为 `false` 表示有存储后端中途出错（账号已删，原因在服务端日志里，剩下的文件要自己到存储里清）。key 里没有账号段的老文件不会被这样删掉，它们属于超级管理员。 |
| POST | `/api/admin/users/:id/reset-password` | 不用请求体 → `{ temporaryPassword }`：16 个字符的临时密码，只在这一次返回。该账号的会话全部结束，`mustChangePassword` 置为 `true`。不发邮件，由超级管理员转交；对方用它登录后，系统会要求先设置新密码（`PUT /api/auth/password`），在这之前接口不给用别的。网页端的入口是「设置 → 用户管理」里的「重置密码」。超级管理员自己忘了密码，在服务器上运行 `node server/src/cli/reset-password.js <用户名或邮箱>`，效果相同。 |

带 `:id` 的三个账号接口共同的错误：`:id` 是调用者自己返回 400（`auth.cannot_modify_self`，超级管理员不能在这里停用、删除或重置自己）；`:id` 是超级管理员账号返回 400（`auth.cannot_modify_owner`）；没有这个账号返回 404（`auth.user_not_found`）。

`GET/PUT /api/admin/settings` 里随账号一起新增的三个键（其余各项见[配置](configuration.zh-CN.md#管理设置)）：

| 键 | 默认 | 范围 | 含义 |
| --- | --- | --- | --- |
| `registrationOpen` | `true` | 布尔值 | 是否允许自行注册；注册出来的都是普通账号。环境变量 `REGISTRATION_OPEN` 给它一个初始值，设置保存过之后不再理会这个变量（见[配置](configuration.zh-CN.md#账号)）。 |
| `userConcurrency` | `4` | 1 到 32 | 一个账号同时执行的运行数。`concurrency`（默认 4）仍是整个实例的总数。 |
| `userQueueLimit` | `200` | 1 到 500 | 一个账号未完成的运行（排队中、运行中、转存中）上限。整个实例的总上限仍是 500。 |

超时、重试次数、结果保留天数（`retentionDays`）也是站点设置，对所有账号的运行生效。没有按账号的存储配额。

网页端在「生成记录」页、它的清理弹窗，以及工作台的本月汇总和近 14 天柱状图里，调用用量接口时总是带上浏览器的时区，所以那里的「今天」是用户本地的今天。

登录，添加一个服务商，再给它加一个自定义模型：

```bash
BASE=http://localhost:3000

# 先登录，取返回里的 data.token
curl -s -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"account":"ada","password":"你的密码"}'
TOKEN=<上一步返回的 token>

curl -X POST "$BASE/api/admin/providers" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"type":"openai","apiKey":"sk-…"}'

curl -X POST "$BASE/api/admin/providers/<上一步返回的 id>/models" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"model":"some-chat-model","kind":"chat","label":"我的对话模型"}'
```

自定义模型的规则和错误码：

- `model` 是上游的模型名：只能用字母、数字和 `. _ - : / @`，最长 120 个字符。缺了返回 `provider.custom_name_required`，格式不对返回 `provider.custom_bad_name`。
- `kind` 必填，没有默认值（`provider.custom_kind_required`），而且必须在这家服务商的 `customKinds` 里（`provider.custom_kind_unsupported`）。内置三家都只能是 `image` 或 `chat`，`video` 会被拒绝。
- 不能和服务商清单里的模型重名（`provider.custom_in_catalog`），同一个服务商下不能重复（`provider.custom_exists`），每个服务商最多 100 个（`provider.custom_max`）。
- 修改时带了不同的 `model` 返回 `provider.custom_name_fixed`；修改或删除一个不存在的自定义模型返回 404（`provider.custom_not_found`）。
- 以上除注明的以外都是 400。三个接口都返回更新后的服务商对象。添加后，这个模型以 `<标识>:<模型名>` 出现在 `GET /api/models` 里，`custom` 为 `true`，参数取自 `customDefaults[kind]`。

`GET /api/admin/vendors` 的完整返回示例、服务商对象的每个字段，逐项列在 [api.md](api.md#vendors)。账号、会话和账号管理接口的逐项说明见 [api.md](api.md#app-and-login) 和 [api.md](api.md#accounts)。

存储接口的请求和返回逐项列在 [api.md](api.md#storage)；各个字段的含义、各家服务的配法见[存储](storage.zh-CN.md)。
