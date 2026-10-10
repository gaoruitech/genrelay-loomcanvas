# Changelog / 变更记录

Notable changes to LoomCanvas. Versions follow the `version` field of the root `package.json`.

LoomCanvas 的主要变更。版本号以根目录 `package.json` 的 `version` 为准。

## 0.1.0 (unreleased / 未发布)

First version. Nothing has been tagged or released yet; interfaces may still change. This entry describes what is in the repository.

第一个版本，尚未打标签发布，接口仍可能调整。以下是仓库里目前已有的内容。

### English

**Canvas**

- Infinite canvas editor built on Vue Flow: source nodes (text, image, image set, video), generation nodes (image generation, image edit, video generation, video edit, language model, video analysis), output node, groups.
- Typed connections, undo/redo, copy and paste, duplicate, box-select, alignment and distribution, arrange by data flow, snap to grid, node search, minimap, immersive mode, per-canvas appearance.
- Run a single node, a branch or the whole canvas; batch runs over up to 100 source files; result history per node; confirmation before re-running nodes that already have a result.
- Tool nodes processed on the server without any model: slice, collage, watermark, resize, multi-platform export.
- Canvas templates and text templates (two built-in templates and a set of prompt snippets in Chinese and English), brand kits, asset library, zip download of a canvas's media.
- Read-only share links that snapshot a canvas, with expiry and revocation; run state, task ids and costs are stripped from snapshots.
- Chinese and English interface in one dark theme (no light theme, no theme switch). A landing page, registration and sign-in pages, and an "Add a provider" page for an account that has none yet.
- An app shell with a top bar and a sidebar: Workbench (recent canvases, templates, recent generations, this month's usage, queue, providers), Canvases, Assets, Models (providers, models and prices), History (every run, with totals, filters, details, CSV export and clean-up) and Settings (interface language, account and sessions; for the super admin also storage, run limits, site name, logo and default language, registration, users). In the editor the sidebar shrinks to icons.
- Canvas documents are at `schemaVersion` 2. Generation nodes became much taller, so the two built-in templates were re-spaced, and a canvas last saved by an earlier version is arranged once when it is first opened in the editor, only if its nodes overlap at the new sizes. A notice says so and Ctrl+Z undoes it; it never repeats and never touches a canvas saved by the current version.
- Saving: panning and zooming no longer flip the save status to "Unsaved". The viewport is stored quietly on its own shortly after the view stops moving, and such a save does not change the canvas's "updated" time.
- Tidy up now arranges every loose node on the canvas, not only the ones in view; nodes that were never on screen are placed by an estimated size.
- History: the run details dialog shows the parameters by the names and values the editor uses (Aspect ratio: Auto, Duration: 5s, Reference mode: First & last frame) instead of the API field names, and the provider by its name. A date range, "today" and the clean-up date mean days in your own time zone.
- Share pages show each model by the display name stored with the snapshot (or "Model not listed" when the publisher no longer has it), never the model id.
- A node that is refused before it runs (no prompt, no reference image, no usable model) is listed under "Could not start" in the queue list with the reason, in addition to the message and the mark on the node.
- The three fonts the interface ships (Inter, Sora, JetBrains Mono; SIL Open Font License 1.1) are listed in `THIRD_PARTY_NOTICES.md`, and every build writes their copyright notices and the licence text to `licenses/fonts-OFL-1.1.txt`.

**Server**

- Node.js + Express + MongoDB backend.
- Accounts: signing in is always required. The super admin account is built in: at start-up the server creates it when there is none, from `ADMIN_USERNAME` (default `admin`), `ADMIN_PASSWORD` and `ADMIN_EMAIL` (optional; the super admin is the only account that may have no email). Without `ADMIN_PASSWORD` a random password is generated and printed once in the start-up log, and has to be replaced at the first sign-in. These variables are read only when the account is created; afterwards they are ignored. Its role is `owner` in the API.
- Registration (username, email, password) only ever creates ordinary users. Whether it is open is the super admin's `registrationOpen` setting, open by default; `REGISTRATION_OPEN=true|false` gives that setting its first value and is ignored once the setting has been saved. With registration closed, `POST /api/auth/register` answers `403 auth.registration_closed`.
- `mustChangePassword` on the User object: `true` while the password is one somebody else knows (the generated super admin password, or a temporary one from a reset). Until `PUT /api/auth/password` has replaced it, the API serves that account only `GET /api/auth/me`, `GET /api/bootstrap`, `PUT /api/auth/password` and `POST /api/auth/logout`; everything else answers `403 auth.password_change_required`, and the web app shows a **Set a new password** screen. A new password equal to the current one is refused with `400 auth.same_password`.
- `GET /api/bootstrap` carries `auth: { registrationOpen }` and `user`.
- Each account has its own canvases, files, share links, assets, brand kits, runs and usage, and its own providers, API keys, custom models and prices. No teams or shared workspaces. Another account's resource answers 404.
- Sessions kept on the server (hashed token; 12 hours, or 30 days with "remember"): sign out, sign out other devices, and a password change or reset end them at once. Passwords hashed with scrypt.
- `PUT /api/auth/password` ends every session of the account, the caller's included, and answers `{ revokedSessions, token }` with a fresh token for the caller (same remaining lifetime). The web client swaps it in silently.
- The super admin manages the site only: registration open or closed, storage, run limits, site name, logo and default language, and the user list (disable, enable, delete with its data and files, reset a password). The super admin cannot read other accounts' data through the API.
- `node server/src/cli/reset-password.js <username-or-email>` for a forgotten password, the super admin's included; no email is sent anywhere. Like the super admin's **Reset password**, it gives a temporary password that has to be replaced at the next sign-in.
- Vendors with a registry and per-model overrides. Built in: Gaorui (image and video models; chat models as custom models for now), OpenAI (chat, image generation and editing) and Google Gemini (image, chat). See **Providers** below.
- In-process run queue with bounded concurrency, shared fairly between accounts (`userConcurrency`, `userQueueLimit`), hard deadlines for every step, retries only when a resubmission is safe, cancellation, and recovery of unfinished runs after a restart.
- Results copied into your own storage with content-type sniffing and WebP thumbnails. Storage: the local disk, or one S3-compatible driver for AWS S3, Cloudflare R2, Aliyun OSS, MinIO and similar services (see **Storage** below).
- Cost estimates from price tables each account maintains, "cost unknown" when no price applies, usage summaries by day and by model, usage records with clean-up.
- `GET /api/admin/usage`, `GET /api/admin/usage/records` and `DELETE /api/admin/usage/records` accept `tz` (an IANA zone name, default `UTC`). A bare date in `from`, `to` or `before` is that calendar day in `tz`; full instants are taken as they are; without `tz` nothing changes. An unknown zone is `400 validation.invalid`. The web app always sends the browser's zone, so "today" is the user's local day.
- Optional billing hook (`BILLING_HOOK`) called before and after each run, with the account the run belongs to (`ctx.userId`, `ctx.username`).
- Provider API keys encrypted at rest with AES-256-GCM under `SECRET_KEY`; sign-in, registration and profile changes are rate limited.
- Sign-in limits, in memory, per 10 minutes: 10 per account name and client address, 30 per client address, 100 per account name, 3000 in total. The last two are not applied to an address the account is known at (a successful sign-in in the last 30 days, or a live session), so wrong guesses at a username cannot lock its holder out. Registration: 20 per address per hour. `PUT /api/auth/profile`: 20 changes per account per hour (`429 auth.too_many_attempts`), so its "taken" answers cannot be used to test addresses without limit.
- SSRF-guarded downloader for every user- or upstream-supplied URL; uploads typed by content; security headers including a Content-Security-Policy.
- Server messages in Chinese and English, selected per request; stable error codes.
- Canvas documents carry a `schemaVersion` (now 2) and are migrated on read.
- Admin settings for site name, logo, default language, registration, concurrency (for the instance and per account), the queue limit per account, timeouts, retries and result retention. All of them, `userConcurrency` and `userQueueLimit` included, can be edited under Settings (Run limits, Appearance, Site).
- The `defaultTheme` setting is removed: `GET /api/bootstrap` has no `site.defaultTheme`, `/api/admin/settings` no longer returns it and refuses it with `400 settings.unknown_key`, and a stored value is ignored.
- `GET /api/bootstrap` no longer returns `authRequired` and `authed`; `user` is `null` for a caller who is not signed in.

**Providers**

Added

- Vendors with explicit model catalogs. A provider is now a vendor (Gaorui, OpenAI or Google Gemini) plus your API key. The models each vendor supports are written down in `server/src/providers/catalog/<vendor>.json`, in `image`, `video` and `chat` sections; the section is the kind. Gaorui is listed first and marked as recommended.
- Custom models: on the Models page a model outside the vendor's catalog can be added to a provider by its upstream name, with a kind chosen by hand (image or chat) and an optional display name. Up to 100 per provider. Custom video models are refused for all three vendors.
- The Models page shows the providers as cards and the models of the selected provider grouped by type, filtered by type, status, source and price, plus a search over the display name and the model ID. The filters are remembered in the browser.
- The OpenAI vendor goes through the official OpenAI API: `/chat/completions`, `/images/generations`, and `/images/edits` (multipart) when reference images are connected, so OpenAI image models now take reference images.
- Admin API: `GET /api/admin/vendors`; `POST`, `PUT` and `DELETE /api/admin/providers/:id/models[/:model]` for custom models. Provider objects carry `customBaseUrl` and `customModels`; ModelSpec objects carry `custom`.
- Video analysis through Gaorui with a catalog model: `gemini-3.5-flash-c` accepts a video and is offered in the Video analysis node. A Gaorui provider sends the video as an `image_url` content part holding its public URL, right after the text part (a `video_url` part is dropped by the Gaorui relay without an error). This follows what the Gaorui main site does.
- Token prices with separate input and output rates can be entered and edited on the Models page (two fields), and the model list shows them as "Input … / output … · per 1M tokens". Before, such a price could only be set through the API and was listed as 0.00.
- Automatic migration of stored providers at start-up, once per provider: `openai-compatible` becomes `openai` with the same slug, so model ids on canvases, prices and usage keep working; models typed into the old fields, and models that were in use where the old code fetched the list from the upstream, are carried over as custom models. A Gaorui provider still called by the old default name ("Gaorui API" / 「高瑞 API」) is renamed to "Gaorui" / 「高瑞」; any other name is left alone. Keys, addresses, the enabled flag, order and model overrides are not touched. See [docs/providers.md](docs/providers.md#upgrading-from-the-previous-version).

Changed

- Vendors with explicit catalogs replace provider types and name-based guessing. Nothing about a model is inferred from its name any more, and no model list is fetched from the upstream. **Test connection** still calls the upstream's model-list endpoint, only to prove the address and the key; it no longer reports a model count.
- Every vendor defaults to its official base URL (`https://gaorui.cc`, `https://api.openai.com/v1`, `https://generativelanguage.googleapis.com`). Another address can be set under **Advanced** in the provider dialog; it must speak exactly the same official API. The vendor of a provider cannot be changed after it is added.
- The API key is required when adding a provider of any vendor.
- Providers are called 「服务商」 in the Chinese interface, and the vendor is called 「高瑞」 / "Gaorui".
- The Chinese brand spelling is corrected to 「高瑞」 throughout the interface, the server messages and the documentation; a stored provider whose default name carried the old spelling is renamed by the migration.
- OpenAI chat models no longer accept a video: the official API has no video part. Video analysis is available with `gemini-3.5-flash-c` and with custom chat models of a Gaorui provider; custom Gaorui chat models now send the video as an `image_url` part as well, no longer as `video_url`.
- The Gaorui catalog lists five chat models: `deepseek-v4-pro`, `gpt-5.5` and `glm-5.3` (text only), `gpt-6-astra` (reads images) and `gemini-3.5-flash-c` (reads images and video). Chat models are no longer discovered from the upstream; one that is not listed can be added as a custom model.
- A text-only chat model is never sent an image: `POST /api/llm/tasks` with `imageUrls` for one is refused (`model.no_image_input`), and the Language model node greys out its image input, takes no new image connection and says that connected images are not sent.
- The OpenAI catalog lists `gpt-image-2` next to the two GPT Image 2.5 models, and fifteen chat models from GPT-6 down to GPT-4o Mini; the Gemini catalog lists `gemini-3.1-flash-image`, `gemini-3.6-flash` and `gemini-3-flash-preview` as well. Each catalog holds every current model its vendor serves through the endpoints LoomCanvas calls; what is left out and why is in [Providers](docs/providers.md).
- A custom model whose name a catalog lists is served from the catalog under the same model id (enabled state, order, name and price are kept); the custom entry is removed at start-up.
- On a narrow screen the section list of the Settings page scrolls sideways inside itself and keeps the current section in view, instead of widening the page.
- The Settings page shows one section at a time instead of one long page. The list on the left is grouped into Personal (Account & security, Appearance) and, for the super admin, Site management (Site, Users, Storage, Run limits). The section is part of the address (`/settings/<section>`); `/settings` and the old `/settings#<section>` links go to the right section, and a section an account may not see falls back to Account & security. Leaving a section with unsaved changes asks first. Storage shows the S3 form only when S3 is selected, in four groups; Users has search, a status filter and a Password pending tag for accounts still on a temporary password.
- The built-in admin account is called the super admin (超级管理员) in the interface, in server messages, in the start-up log and in the docs; ordinary accounts are called users. The value in the API stays `owner`, and the `ADMIN_*` variables keep their names.

Removed (**breaking**)

- The provider type `openai-compatible` and the free-text model fields of the provider form (stored providers are migrated, see above).
- `GET /api/admin/provider-types`, replaced by `GET /api/admin/vendors`. `POST /api/admin/providers` no longer takes model fields, provider objects no longer have `options`, and `POST /api/admin/providers/:id/test` no longer returns `modelCount`.
- The `fields` and `listModels` members of the provider plugin contract. A vendor module now exports `catalog`, `customKinds` and `customSpec`; see [docs/writing-a-provider.md](docs/writing-a-provider.md).
- The five-minute model list cache.

**Storage**

Added

- A **Storage** section under Settings (super admin only): choose the local disk or an S3-compatible bucket, with presets for AWS S3, Cloudflare R2, Aliyun OSS and MinIO. Takes effect at once, without a restart. A saved configuration takes precedence over `STORAGE_DRIVER` and `S3_*`. The secret access key is encrypted with `SECRET_KEY` and never returned.
- Options of the S3-compatible driver: key prefix (`S3_KEY_PREFIX`), delivery (`S3_DELIVERY`), object ACL (`S3_ACL`), explicit path-style addressing.
- Private buckets: with `proxy` delivery the app streams files from the bucket itself (Range, ETag, HEAD), so the bucket needs no public access and no CORS configuration.
- `redirect` delivery: `/files/<key>` redirects to a public domain or CDN in front of the bucket.
- Reference media in a bucket is handed to upstream models as a presigned URL valid for one hour (or the public address), so `PUBLIC_URL` is not needed for it. Presigned URLs are never stored, and are blanked in upstream error messages.
- A connection test (`POST /api/admin/storage/test`) that writes, reads back and deletes a test object and names what is wrong in plain words. Saving an S3 configuration runs it first.
- Admin API: `GET` / `PUT /api/admin/storage`, `POST /api/admin/storage/test`.
- After a switch the earlier backend stays readable (the local disk, the saved bucket, up to 5 earlier buckets, the environment's bucket). Files are not moved, and there is no migration tool.
- Thumbnails are generated on first request on every backend and stored next to their source image.
- Tests of the storage layer, and live tests against a real S3 API (`server/test/storage.live.test.js`, run when `TEST_S3_ENDPOINT` is set). They have been run against MinIO only.

Changed

- Every stored file has one address on every backend: the site-relative `/files/<key>`, answered by the app. The S3 driver used to store `<S3_PUBLIC_BASE_URL>/<key>`; such addresses in existing canvases are still recognised while that public base URL stays configured.
- `S3_PUBLIC_BASE_URL` is optional. It used to be required.
- `S3_REGION` defaults to `us-east-1`. It used to default to `auto`; set `S3_REGION=auto` explicitly for Cloudflare R2.
- The AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`) is a regular dependency of `server/`, no longer an optional one.
- The page's Content-Security-Policy lists the origin of every configured public base URL.

Removed (**breaking**)

- The `oss` storage driver, the `ali-oss` package and every `OSS_*` variable. `STORAGE_DRIVER=oss` now stops the server at startup with a message that says what to set. To migrate, use `STORAGE_DRIVER=s3` with `S3_ENDPOINT=https://oss-<region>.aliyuncs.com`, `S3_REGION=oss-<region>`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (formerly `OSS_ACCESS_KEY_SECRET`) and path-style off, or configure it under Settings → Storage. See [docs/storage.md](docs/storage.md#migrating-from-storage_driveross).
- The `EXTRA_NPM_PACKAGES` build argument of the Docker image.

**Packaging and project**

- Dockerfile (non-root, health check) and Docker Compose file with MongoDB 7.
- Tests for the runner, providers (against a fake upstream), pricing, crypto, SSRF guard, storage keys and the storage layer, image tools, schema migration, message catalogs, and end-to-end API and security suites.
- Repository checks for versions, dependency licenses and UI strings; CI workflow.
- AGPL-3.0 license with a separate commercial license, CLA, trademark policy, third-party notices.
- Documentation in English and Chinese under `docs/`.

**Gaorui models**

- Added `veo-3.1` (Veo 3.1: text, up to 3 reference images, or first and last frame; 8 s fixed).
- Removed `sora-2-openai-12s`: the service has no channel for it (HTTP 503 `model_not_found`) and does not list it. A canvas node that still names it shows the model as unavailable and asks for another one.
- `omni-flash` no longer offers 6 s: the service lists `omni_flash_6s` but answers HTTP 503 `model_not_found` for it. 8 s is the default; a node that stored 6 s falls back to 8 s.
- Fixed: reference images of the Gaorui image models are now sent as public URLs only. The service refuses inline base64 (`image_must_be_url`), so an image without a public address is refused before the request is sent, with the usual "A publicly reachable URL is needed…" message.
- Fixed: an upstream error that arrives as a JSON string inside another error body is shown as its message, not as raw JSON; and a `model_not_found` answer is no longer retried, whatever its HTTP status (the service sends it with 503).
- Added `grok-imagine-1.0-video` (Grok Video 1.0: text or up to 3 reference images; 6, 10 or 15 s; 480p).
- `omni-flash` no longer offers 4k (720p and 1080p, as on the Gaorui main site), and `omni-flash-edit` has no resolution to choose: an edit is always 720p. A node that stored 4k falls back to 720p.
- `grok-imagine-video-1.5-preview` no longer offers 4 s: asked for 4 seconds, the service returned a 6-second clip. The shortest is 6 s; a node that stored 4 s falls back to 6 s.
- Models that only take reference images by public URL (the Gaorui image models, Veo 3.1, Grok Video) are marked as such, and the canvas says so before a run: on an instance without a public address, a node that uses one of them with an image connected shows the reason and what to do, and Run stops there. The same for the source video of a video edit. Gaorui has no upload endpoint that would take a local file with just the key.

**Known limitations**

- The built-in Gaorui models have been run against the real service; the OpenAI and Google Gemini integrations follow the official documentation but have not been run by the project. That includes the OpenAI `/images/edits` path and the model names in the OpenAI and Gemini lists.
- With a Gaorui image model, image-to-image needs a public address for the reference image (`PUBLIC_URL`, or files kept in a bucket reachable from the internet).
- The S3 storage driver is verified against MinIO. It has not been run against AWS S3, Cloudflare R2 or Aliyun OSS; their settings follow each vendor's S3-compatibility documentation.
- Switching storage does not move existing files, and there is no migration tool.
- Accounts are separated by the API, in one process, one database and one storage area: no teams, no per-account storage quota, no email verification or two-factor sign-in.
- No content moderation, no private file URLs.

**Upgrading a checkout from before accounts**

- `ACCESS_PASSWORD` is gone. If it is still set the server logs one warning and ignores it; remove it. Signing in is always required now, and tokens issued for the shared password no longer work.
- Nothing is migrated by hand. At its first start the new version creates the super admin account and hands it all of the existing data (canvases, share links, assets, brand kits, providers and their keys, prices, usage); the log says `[auth] the data from before accounts now belongs to "admin": {...}`. Set `ADMIN_PASSWORD` before that start, or read the generated password from the start-up log, then sign in as the super admin. Accounts that register start empty. `SECRET_KEY` must stay the same for stored keys to decrypt.
- File addresses stored in canvases keep working. New files are stored under `uploads|outputs|tools/<account id>/…`.
- API: `POST /api/auth/login` takes `{ account, password, remember? }`; a missing session is `401 auth.required` (was `auth.login_required`); `GET /api/bootstrap` (also at `/api/app/bootstrap`) carries `auth` and `user`, and no longer `authRequired`, `authed` or `site.defaultTheme`; `/api/admin/settings` and `/api/admin/storage` are for the super admin, the other `/api/admin/*` endpoints work on the caller's own providers, models and usage. Model ids and provider slugs are per account.
- Billing hooks: `ctx.userId` is the account id (it was the constant `local`); `ctx.username` is new.
- The interface has one dark theme; the theme switch and the default-theme setting are gone. Providers, models and prices moved from Settings to the Models page and usage to the History page; old `/settings?tab=…` links are redirected.
- Canvases saved before the redesign are arranged once on first open if their nodes overlap at the new node sizes (undo with Ctrl+Z).
- The `jsonwebtoken` dependency was removed.

### 中文

**画布**

- 基于 Vue Flow 的无限画布编辑器：素材节点（文本、图片、图片集合、视频）、生成节点（图片生成、图片编辑、视频生成、视频编辑、大语言模型、视频分析）、成品节点、分组。
- 连线分类型；撤销重做、复制粘贴、原地复制、框选、对齐与等距分布、按数据流整理、吸附到网格、节点搜索、小地图、沉浸式、每张画布单独的外观。
- 运行单个节点、一条分支或整张画布；批量运行，一次最多 100 份素材；每个节点保留历史版本；对已有结果的节点重新运行前先确认。
- 不调用任何模型、在服务端处理的工具节点：切片、拼图、加水印、改尺寸、多平台导出。
- 画布模板和文本模板（内置两个画布模板和一组中英文提示词片段）、品牌包、素材库、把画布里的素材打包下载。
- 只读分享链接：保存画布快照，可设有效期，可撤销；快照里不带运行状态、任务号和成本。
- 中英文界面，只有一套深色主题（没有浅色主题，也没有主题切换）。落地页、注册页和登录页，以及账号还没有服务商时出现的「添加一个服务商」页。
- 应用外壳是顶栏加左侧栏：工作台（最近的画布、模板、最近生成、本月用量、生成队列、服务商）、画布、素材库、模型管理（服务商、模型和价格）、生成记录（每一次运行，带汇总、筛选、详情、导出 CSV 和清理）、设置（界面语言、账号与会话；超级管理员另有存储、运行限制、站点名称 / Logo / 默认语言、是否开放注册、用户管理）。进入编辑器后侧栏收成图标栏。
- 画布文档升到 `schemaVersion` 2。生成节点高了很多，所以内置的两个模板重新排过；最后一次保存还在旧版本的画布，第一次在编辑器里打开时会自动整理一次，而且只在节点按新尺寸互相重叠时才整理。会有提示，按 Ctrl+Z 可以撤销；不会重复，也不会动用当前版本保存过的画布。
- 保存：平移、缩放不再让保存状态跳成「未保存」。视野停下来之后视口会单独、悄悄地存一次，这样的保存不改变画布的「更新时间」。
- 「自动整理」现在整理画布上全部的散节点，不只是视野里的；从没进过视野的节点按估计的尺寸排。
- 生成记录：运行详情里的参数按编辑器里的叫法和写法显示（比例：自适应、时长：5 秒、参考图用法：首尾帧），不再是接口字段名；服务商显示名称。日期范围、「今天」和清理日期指的都是你所在时区的日子。
- 分享页按快照里存的显示名显示模型（发布者已经没有这个模型时显示「未注明模型」），不显示模型标识。
- 运行前检查没过的节点（缺提示词、缺参考图、没有可用模型）除了弹提示、在节点上标出来以外，还会带着原因列在生成队列清单的「没能开始」里。
- 界面自带的三款字体（Inter、Sora、JetBrains Mono，SIL Open Font License 1.1）列在 `THIRD_PARTY_NOTICES.md` 里，每次构建都会把它们的版权声明和协议全文写到 `licenses/fonts-OFL-1.1.txt`。

**服务端**

- Node.js + Express + MongoDB。
- 账号：使用前必须登录。超级管理员账号是内置的：还没有超级管理员时，服务端在启动时按 `ADMIN_USERNAME`（默认 `admin`）、`ADMIN_PASSWORD`、`ADMIN_EMAIL`（可以不填；超级管理员是唯一可以没有邮箱的账号）自动创建。没设 `ADMIN_PASSWORD` 时生成一个随机密码，在启动日志里打印一次，第一次登录时必须换掉。这几个变量只在创建这个账号时读取，之后都被忽略。这个角色在接口里的值是 `owner`。
- 注册（用户名、邮箱、密码）只会产生普通用户。是否开放由超级管理员的 `registrationOpen` 设置决定，默认开放；`REGISTRATION_OPEN=true|false` 给这项设置一个初始值，设置保存过之后不再理会它。关闭注册时，`POST /api/auth/register` 返回 `403 auth.registration_closed`。
- User 对象带 `mustChangePassword`：账号的密码是别人知道的（生成的超级管理员密码，或重置给出的临时密码）时为 `true`。在 `PUT /api/auth/password` 把它换掉之前，接口只给这个账号用 `GET /api/auth/me`、`GET /api/bootstrap`、`PUT /api/auth/password`、`POST /api/auth/logout`，其余一律返回 `403 auth.password_change_required`；网页端显示「设置新密码」这一屏。新密码和当前密码相同会以 `400 auth.same_password` 拒绝。
- `GET /api/bootstrap` 带 `auth: { registrationOpen }` 和 `user`。
- 每个账号有自己的画布、文件、分享链接、素材、品牌包、运行记录和用量，也有自己的服务商、API Key、自定义模型和价格。没有团队，没有共享空间。访问别的账号的资源返回 404。
- 会话保存在服务端（只存凭证的哈希；有效期 12 小时，勾选「记住我」为 30 天）：退出登录、退出其他设备、修改或重置密码都立即生效。密码用 scrypt 哈希。
- `PUT /api/auth/password` 会结束这个账号的全部会话，包括调用方自己的；返回 `{ revokedSessions, token }`，其中 `token` 是给调用方的新凭证（有效期是原会话剩下的时间）。网页端会悄悄换上。
- 超级管理员只管站点：是否开放注册、存储、运行限制、站点名称 / Logo / 默认语言，以及用户列表（停用、启用、连同数据和文件一起删除、重置密码）。超级管理员不能通过接口读取别的账号的数据。
- 忘记密码用 `node server/src/cli/reset-password.js <用户名或邮箱>`，超级管理员的密码也是这样重置；系统不发送任何邮件。它和超级管理员的「重置密码」一样，给出一个临时密码，下次登录时必须换掉。
- 服务商，带注册表和按模型的覆盖项。内置：高瑞（图片、视频模型；对话模型暂时作为自定义模型添加）、OpenAI（对话，图片生成与编辑）、Google Gemini（图片、对话）。见下面的「服务商」。
- 进程内任务队列：并发有上限，在各账号之间公平分配（`userConcurrency`、`userQueueLimit`），每一步都有硬性时限，只在可以安全重新提交时才重试，支持取消，重启后接着处理未完成的运行。
- 结果转存到自己的存储，按内容识别类型，生成 WebP 缩略图。存储：本地磁盘，或者一个 S3 兼容驱动，对接 AWS S3、Cloudflare R2、阿里云 OSS、MinIO 等服务（见下面的「存储」）。
- 按每个账号自己维护的价格表预估成本，没有适用价格时显示「成本未知」；按天、按模型的用量汇总，用量明细及其清理。
- `GET /api/admin/usage`、`GET /api/admin/usage/records` 和 `DELETE /api/admin/usage/records` 接受 `tz`（IANA 时区名，默认 `UTC`）。`from`、`to`、`before` 里只写日期时，指的是 `tz` 时区里的那个自然日；完整的时间按原样使用；不带 `tz` 时行为不变。不认识的时区名返回 `400 validation.invalid`。网页端总是带上浏览器的时区，所以「今天」是用户本地的今天。
- 可选的计费钩子（`BILLING_HOOK`），在每次运行前后调用，并告知这次运行属于哪个账号（`ctx.userId`、`ctx.username`）。
- 服务商的 API Key 用 `SECRET_KEY` 以 AES-256-GCM 加密保存；登录、注册和修改资料都有限流。
- 登录限流（在内存里，时间窗 10 分钟）：同一个账号名 + 同一个客户端地址 10 次，同一个客户端地址 30 次，同一个账号名 100 次，全部合计 3000 次。后两条对账号的「熟悉地址」不生效（最近 30 天从那里成功登录过，或者那里有它的有效会话），所以拿某个用户名乱猜，锁不住它的主人。注册：每个地址每小时 20 次。`PUT /api/auth/profile`：每个账号每小时 20 次（`429 auth.too_many_attempts`），免得它的「已被占用」回答被拿来无限次试探邮箱。
- 凡是用户或上游给出的地址，都经过带 SSRF 防护的下载器；上传文件按内容判断类型；安全响应头，包括 Content-Security-Policy。
- 服务端提示有中英文，按请求选择语言；错误带稳定的标识。
- 画布文档带 `schemaVersion`（现在是 2），读取时迁移。
- 管理设置：站点名称、Logo、默认语言、是否开放注册、并发数（整个实例的和每个账号的）、每个账号的排队上限、超时、重试次数、结果保留天数。这些设置（包括 `userConcurrency` 和 `userQueueLimit`）都可以在「设置」页里改（运行限制、外观、站点）。
- 删除了 `defaultTheme` 设置：`GET /api/bootstrap` 里不再有 `site.defaultTheme`，`/api/admin/settings` 不再返回它，提交它会得到 `400 settings.unknown_key`，以前存下来的值不再使用。
- `GET /api/bootstrap` 不再返回 `authRequired` 和 `authed`；没登录时 `user` 为 `null`。

**服务商**

新增

- 服务商和明确写出的模型清单。添加的服务商现在是一家服务商（高瑞、OpenAI 或 Google Gemini）加上你的 API Key。每家支持的模型写在 `server/src/providers/catalog/<服务商标识>.json` 里，分 `image`、`video`、`chat` 三段，写在哪一段就是哪种类型。高瑞排在第一位并带「推荐」标记。
- 自定义模型：在「模型管理」页，可以按上游的模型名给某个服务商添加清单以外的模型，类型（图片或对话）由你手动选择，显示名称可选。每个服务商最多 100 个。三家服务商都不能添加自定义视频模型。
- 「模型管理」页把服务商显示成卡片，选中的服务商的模型按类型分组；可以按类型、状态、来源、价格筛选，也可以按显示名称或模型 ID 搜索。筛选条件记在浏览器里。
- OpenAI 服务商走 OpenAI 官方接口：`/chat/completions`、`/images/generations`，接了参考图时走 `/images/edits`（multipart）。OpenAI 的图片模型因此可以带参考图了。
- 管理接口：`GET /api/admin/vendors`；管理自定义模型的 `POST`、`PUT`、`DELETE /api/admin/providers/:id/models[/:model]`。服务商对象带 `customBaseUrl` 和 `customModels`；ModelSpec 带 `custom`。
- 用高瑞清单里的模型做视频分析：`gemini-3.5-flash-c` 可以输入视频，会出现在视频分析节点里。高瑞服务商把视频放在 `image_url` 内容片段里发送，值是视频的公网地址，紧跟在文字片段后面（高瑞的中转会把 `video_url` 片段丢掉而不报错）。这是照高瑞主站的做法写的。
- 按 token 计价、输入和输出分开的价格，可以在「模型管理」页填写和修改（两个输入框），模型列表里显示成「输入 … / 输出 … · 每百万 token」。之前这种价格只能通过接口设置，列表里显示成 0.00。
- 启动时自动升级已保存的服务商，每个只升级一次：`openai-compatible` 变成 `openai`，标识（slug）不变，所以画布、价格和用量里的模型标识照常可用；填在旧字段里的模型，以及旧版本向上游读取列表时实际用过的模型，都转成自定义模型带过来。名称还是旧默认名「高瑞 API」（"Gaorui API"）的高瑞服务商改名为「高瑞」（"Gaorui"），其他名称不动。API Key、接口地址、是否启用、排序和模型覆盖项不动。见 [docs/providers.zh-CN.md](docs/providers.zh-CN.md#从上一个版本升级)。

变更

- 用「服务商 + 明确的模型清单」取代原来的「类型」和按名字猜测。不再根据模型的名字推断任何东西，也不再向上游读取模型列表。「测试连接」仍然调用上游的模型列表接口，但只用来证明地址和 Key 可用，不再报告模型数量。
- 每家服务商默认用它的官方接口地址（`https://gaorui.cc`、`https://api.openai.com/v1`、`https://generativelanguage.googleapis.com`）。别的地址可以在服务商对话框的「高级」里填写，对方必须使用完全相同的官方接口。服务商添加后不能更换。
- 添加任何一家服务商都必须填 API Key。
- 中文界面里统一叫「服务商」，这一家服务商叫「高瑞」/ "Gaorui"。
- 品牌的中文写法统一更正为「高瑞」，界面、服务端提示和文档都已改过；已保存的服务商如果默认名称里带着旧写法，升级时会一并改正。
- OpenAI 的对话模型不再接受视频：官方接口没有视频这种内容片段。视频分析可以用高瑞服务商下的 `gemini-3.5-flash-c` 和自定义对话模型；高瑞的自定义对话模型现在同样用 `image_url` 片段发送视频，不再用 `video_url`。
- 高瑞的清单里有五个对话模型：`deepseek-v4-pro`、`gpt-5.5`、`glm-5.3`（纯文本），`gpt-6-astra`（可读图片），`gemini-3.5-flash-c`（可读图片和视频）。对话模型不再从上游发现；清单里没有的可以作为自定义模型添加。
- 纯文本对话模型不会收到图片：对它调用 `POST /api/llm/tasks` 并带 `imageUrls` 会被拒绝（`model.no_image_input`）；大语言模型节点会把图片输入口变灰、不再接受新的图片连线，并写明已连接的图片不会发送。
- OpenAI 的清单在两个 GPT Image 2.5 模型之外列出了 `gpt-image-2`，以及从 GPT-6 到 GPT-4o Mini 的十五个对话模型；Gemini 的清单增加了 `gemini-3.1-flash-image`、`gemini-3.6-flash`、`gemini-3-flash-preview`。每份清单里是这家服务商通过 LoomCanvas 所调用的接口提供的全部现行模型；哪些没有列入、为什么，见[服务商](docs/providers.zh-CN.md)。
- 自定义模型的名字如果已在清单里，就以清单里的为准，模型标识不变（启用状态、排序、名称和价格都保留）；那条自定义记录在服务端启动时删除。
- 窄屏上「设置」页的分区目录在自己里面横向滚动，并让当前分区保持可见，不再把整个页面撑宽。
- 「设置」页改成一次只显示一个分区，不再是一页到底。左边的列表分成「个人」（账号与安全、外观）和只有超级管理员才有的「站点管理」（站点、用户管理、存储、运行限制）。分区写在地址里（`/settings/<分区>`）；`/settings` 和旧的 `/settings#<分区>` 链接会落到对应的分区，没权限看的分区落到「账号与安全」。分区里有没保存的修改时，离开之前先问一句。「存储」选了 S3 才出现 S3 表单，分成四组；「用户管理」可以搜索、按状态筛选，还在用临时密码的账号带「待改密码」标记。
- 内置的管理账号在界面、服务端提示、启动日志和文档里统一叫「超级管理员」（英文 Super admin），普通账号叫「用户」。接口里的取值仍然是 `owner`，`ADMIN_*` 环境变量的名字不变。

移除（**不兼容**）

- `openai-compatible` 这个类型，以及服务商表单里自由填写的模型字段（已保存的服务商会自动升级，见上）。
- `GET /api/admin/provider-types`，由 `GET /api/admin/vendors` 取代。`POST /api/admin/providers` 不再接受模型字段，服务商对象不再有 `options`，`POST /api/admin/providers/:id/test` 不再返回 `modelCount`。
- 插件接口里的 `fields` 和 `listModels`。服务商模块现在导出 `catalog`、`customKinds`、`customSpec`，见 [docs/writing-a-provider.zh-CN.md](docs/writing-a-provider.zh-CN.md)。
- 五分钟的模型列表缓存。

**存储**

新增

- 「设置」页新增「存储」分区（只有超级管理员看得到）：选择本地磁盘或 S3 兼容的桶，带 AWS S3、Cloudflare R2、阿里云 OSS、MinIO 的预设。保存后立即生效，不用重启。保存的配置优先于 `STORAGE_DRIVER` 和 `S3_*`。Secret Access Key 用 `SECRET_KEY` 加密保存，不再返回。
- S3 兼容驱动的选项：路径前缀（`S3_KEY_PREFIX`）、分发方式（`S3_DELIVERY`）、对象 ACL（`S3_ACL`）、明确指定的路径风格。
- 私有桶：`proxy` 分发时由应用自己从桶里流式转发文件（支持 Range、ETag、HEAD），桶不需要公共读，也不需要配 CORS。
- `redirect` 分发：`/files/<key>` 重定向到桶前面的公开域名或 CDN。
- 桶里的参考素材交给上游模型时，用有效期一小时的预签名地址（或公开地址），不需要 `PUBLIC_URL`。预签名地址不会被保存，出现在上游错误信息里时会被抹掉。
- 连接测试（`POST /api/admin/storage/test`）：写入、读回、删除一个测试对象，用大白话指出哪里不对。保存 S3 配置时会先做这个测试。
- 管理接口：`GET` / `PUT /api/admin/storage`、`POST /api/admin/storage/test`。
- 切换之后，原来的后端仍然可读（本地磁盘、已保存的桶、最多 5 个更早的桶、环境变量里的桶）。文件不会被移动，也没有迁移工具。
- 缩略图在所有后端上都能在第一次被请求时现做，并和原图存在同一处。
- 存储层的测试，以及对着真实 S3 接口的测试（`server/test/storage.live.test.js`，设了 `TEST_S3_ENDPOINT` 时运行）。目前只对着 MinIO 跑过。

变更

- 每个存下来的文件在所有后端上都只有一个地址：站内相对地址 `/files/<key>`，由应用应答。S3 驱动以前存的是 `<S3_PUBLIC_BASE_URL>/<key>`；已有画布里的这种地址，只要那个公开访问地址还配置着，仍然能被认出来。
- `S3_PUBLIC_BASE_URL` 变为可选，以前是必填。
- `S3_REGION` 的默认值是 `us-east-1`，以前是 `auto`；用 Cloudflare R2 时请明确设 `S3_REGION=auto`。
- AWS SDK（`@aws-sdk/client-s3`、`@aws-sdk/lib-storage`、`@aws-sdk/s3-request-presigner`）成为 `server/` 的常规依赖，不再是可选依赖。
- 页面的 Content-Security-Policy 会列出每个已配置的公开访问地址的来源。

移除（**不兼容**）

- `oss` 存储驱动、`ali-oss` 这个包和所有 `OSS_*` 变量。`STORAGE_DRIVER=oss` 现在会让服务端在启动时退出，并提示应该改设什么。迁移办法：改用 `STORAGE_DRIVER=s3`，设 `S3_ENDPOINT=https://oss-<地域>.aliyuncs.com`、`S3_REGION=oss-<地域>`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`（原来的 `OSS_ACCESS_KEY_SECRET`），不要打开路径风格；或者在「设置 → 存储」里配置。见 [docs/storage.zh-CN.md](docs/storage.zh-CN.md#从-storage_driveross-迁移)。
- Docker 镜像的构建参数 `EXTRA_NPM_PACKAGES`。

**打包与项目**

- Dockerfile（非 root 运行，带健康检查）和包含 MongoDB 7 的 Docker Compose 文件。
- 测试覆盖执行器、服务商模块（对着假上游）、计价、加密、SSRF 防护、存储 key 与存储层、图片工具、画布迁移、语言文件，以及端到端的接口测试和安全测试。
- 仓库级检查：版本号、依赖协议、界面文案；CI 工作流。
- AGPL-3.0 协议与单独的商业授权、贡献者协议、商标政策、第三方声明。
- `docs/` 下的中英文文档。

**高瑞的模型**

- 新增 `veo-3.1`（Veo 3.1：文生视频、最多 3 张参考图、或首尾帧；固定 8 秒）。
- 移除 `sora-2-openai-12s`：该服务没有它的渠道（HTTP 503 `model_not_found`），模型列表里也没有它。画布上还写着它的节点会显示模型不可用，并提示重新选择。
- `omni-flash` 不再提供 6 秒：该服务列着 `omni_flash_6s`，但对它返回 HTTP 503 `model_not_found`。默认改为 8 秒；存着 6 秒的节点会回落到 8 秒。
- 修正：高瑞图片模型的参考图现在只按公网地址发送。该服务不接受内联的 base64（`image_must_be_url`），所以没有公网地址的图片会在请求发出之前被拒绝，提示还是那句「…需要公网可访问的地址…」。
- 修正：上游的错误如果是包在另一个错误体里的 JSON 字符串，现在显示其中的文字，而不是整段 JSON；`model_not_found` 不管 HTTP 状态码是什么都不再重试（该服务是用 503 返回的）。
- 新增 `grok-imagine-1.0-video`（Grok Video 1.0：文生视频、或最多 3 张参考图；6、10、15 秒；480p）。
- `omni-flash` 不再提供 4k（只有 720p 和 1080p，和高瑞主站一致）；`omni-flash-edit` 没有分辨率可选，视频编辑一律是 720p。存着 4k 的节点会回落到 720p。
- `grok-imagine-video-1.5-preview` 不再提供 4 秒：请求 4 秒，该服务返回的是 6 秒的视频。最短是 6 秒；存着 4 秒的节点会回落到 6 秒。
- 参考图只能给公网地址的模型（高瑞的图片模型、Veo 3.1、Grok Video）现在有标记，画布在运行之前就会说明：实例没有公网地址时，节点用的是这类模型又连着图片，节点上会写明原因和做法，点运行也停在这里。视频编辑的原视频同样处理。高瑞没有只凭 Key 就能上传本地文件的接口。

**已知的局限**

- 内置的高瑞模型已经对着真实服务运行过；OpenAI 和 Google Gemini 按官方文档接入，项目还没有实际运行过。带参考图时走的 OpenAI `/images/edits`，以及 OpenAI、Gemini 两份模型清单里的模型名，也在其内。
- 用高瑞的图片模型做图生图，参考图需要有公网地址（设置 `PUBLIC_URL`，或者把文件存到公网上能访问到的桶里）。
- S3 存储驱动是对着 MinIO 验证的，没有对着 AWS S3、Cloudflare R2、阿里云 OSS 跑过；它们的配法依据的是各家的 S3 兼容文档。
- 切换存储不会移动已有的文件，也没有迁移工具。
- 账号之间由接口隔离，共用一个进程、一个数据库和一个存储空间：没有团队，没有按账号的存储配额，没有邮箱验证和两步验证。
- 没有内容审核，没有私有的文件地址。

**从没有账号的代码升级**

- `ACCESS_PASSWORD` 已经取消。仍然设置着的话，服务端启动时提示一次并忽略它，请删掉。现在必须登录才能使用，用共用口令换来的凭证不再有效。
- 不需要手工迁移。新版本第一次启动时创建超级管理员，并把已有的全部数据交给它（画布、分享链接、素材、品牌包、服务商及其 Key、价格、用量）；日志里有一行 `[auth] the data from before accounts now belongs to "admin": {...}`。请在这次启动之前设好 `ADMIN_PASSWORD`，或者从启动日志里读出生成的密码，然后用超级管理员账号登录。注册出来的账号是空的。`SECRET_KEY` 必须保持不变，已保存的 Key 才能解密。
- 画布里保存的文件地址照常可用。新文件存放在 `uploads|outputs|tools/<账号 id>/…` 下。
- 接口：`POST /api/auth/login` 的请求体是 `{ account, password, remember? }`；未登录返回 `401 auth.required`（原来是 `auth.login_required`）；`GET /api/bootstrap`（`/api/app/bootstrap` 仍可用）多了 `auth` 和 `user`，去掉了 `authRequired`、`authed` 和 `site.defaultTheme`；`/api/admin/settings` 和 `/api/admin/storage` 只有超级管理员能调用，其余 `/api/admin/*` 接口操作的是调用者自己的服务商、模型和用量。模型标识和服务商标识前缀按账号区分。
- 计费钩子：`ctx.userId` 现在是账号 id（原来是常量 `local`）；新增 `ctx.username`。
- 界面只有一套深色主题，主题切换按钮和「默认主题」设置都没有了。服务商、模型和价格从「设置」搬到了「模型管理」页，用量搬到了「生成记录」页；旧的 `/settings?tab=…` 链接会被转过去。
- 改版前保存的画布，如果节点按新的节点尺寸互相重叠，第一次打开时会自动整理一次（按 Ctrl+Z 撤销）。
- 去掉了 `jsonwebtoken` 依赖。
