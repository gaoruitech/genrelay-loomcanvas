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
- Chinese and English interface, light and dark themes, first-run setup page, optional access password screen.

**Server**

- Node.js + Express + MongoDB backend, single user.
- Vendors with a registry and per-model overrides. Built in: Gaorui (image and video models; chat models as custom models for now), OpenAI (chat, image generation and editing) and Google Gemini (image, chat). See **Providers** below.
- In-process run queue with bounded concurrency, hard deadlines for every step, retries only when a resubmission is safe, cancellation, and recovery of unfinished runs after a restart.
- Results copied into your own storage with content-type sniffing and WebP thumbnails. Storage: the local disk, or one S3-compatible driver for AWS S3, Cloudflare R2, Aliyun OSS, MinIO and similar services (see **Storage** below).
- Cost estimates from operator-maintained price tables, "cost unknown" when no price applies, usage summaries by day and by model, usage records with clean-up.
- Optional billing hook (`BILLING_HOOK`) called before and after each run.
- Provider API keys encrypted at rest with AES-256-GCM under `SECRET_KEY`; optional shared access password with rate-limited login.
- SSRF-guarded downloader for every user- or upstream-supplied URL; uploads typed by content; security headers including a Content-Security-Policy.
- Server messages in Chinese and English, selected per request; stable error codes.
- Canvas documents carry a `schemaVersion` and are migrated on read.
- Admin settings for site name, logo, default theme and language, concurrency, timeouts, retries and result retention.

**Providers**

Added

- Vendors with explicit model catalogs. A provider is now a vendor (Gaorui, OpenAI or Google Gemini) plus your API key. The models each vendor supports are written down in `server/src/providers/catalog/<vendor>.json`, in `image`, `video` and `chat` sections; the section is the kind. Gaorui is listed first and marked as recommended.
- Custom models: under Settings → Models a model outside the vendor's catalog can be added to a provider by its upstream name, with a kind chosen by hand (image or chat) and an optional display name. Up to 100 per provider. Custom video models are refused for all three vendors.
- The OpenAI vendor goes through the official OpenAI API: `/chat/completions`, `/images/generations`, and `/images/edits` (multipart) when reference images are connected, so OpenAI image models now take reference images.
- Admin API: `GET /api/admin/vendors`; `POST`, `PUT` and `DELETE /api/admin/providers/:id/models[/:model]` for custom models. Provider objects carry `customBaseUrl` and `customModels`; ModelSpec objects carry `custom`.
- Video analysis through Gaorui with a catalog model: `gemini-3.5-flash-c` accepts a video and is offered in the Video analysis node. A Gaorui provider sends the video as an `image_url` content part holding its public URL, right after the text part (a `video_url` part is dropped by the Gaorui relay without an error). This follows what the Gaorui main site does in production; it was run from LoomCanvas against the real Gaorui API on 2026-10-10 (see below).
- Token prices with separate input and output rates can be entered and edited under Settings → Models (two fields), and the model list shows them as "Input … / output … · per 1M tokens". Before, such a price could only be set through the API and was listed as 0.00.
- Automatic migration of stored providers at start-up, once per provider: `openai-compatible` becomes `openai` with the same slug, so model ids on canvases, prices and usage keep working; models typed into the old fields, and models that were in use where the old code fetched the list from the upstream, are carried over as custom models. A Gaorui provider still called by the old default name ("Gaorui API" / 「高瑞 API」) is renamed to "Gaorui" / 「高瑞」; any other name is left alone. Keys, addresses, the enabled flag, order and model overrides are not touched. See [docs/providers.md](docs/providers.md#upgrading-from-the-previous-version).

Changed

- Vendors with explicit catalogs replace provider types and name-based guessing. Nothing about a model is inferred from its name any more, and no model list is fetched from the upstream. **Test connection** still calls the upstream's model-list endpoint, only to prove the address and the key; it no longer reports a model count.
- Every vendor defaults to its official base URL (`https://gaorui.cc`, `https://api.openai.com/v1`, `https://generativelanguage.googleapis.com`). Another address can be set under **Advanced** in the provider dialog; it must speak exactly the same official API. The vendor of a provider cannot be changed after it is added.
- The API key is required when adding a provider of any vendor.
- The Settings tab **Providers** is named 「服务商」 in Chinese, and the vendor is called 「高瑞」 / "Gaorui".
- The Chinese brand spelling is corrected to 「高瑞」 throughout the interface, the server messages and the documentation; a stored provider whose default name carried the old spelling is renamed by the migration.
- OpenAI chat models no longer accept a video: the official API has no video part. Video analysis is available with `gemini-3.5-flash-c` and with custom chat models of a Gaorui provider; custom Gaorui chat models now send the video as an `image_url` part as well, no longer as `video_url`.
- The Gaorui catalog lists five chat models: `deepseek-v4-pro`, `gpt-5.5` and `glm-5.3` (text only), `gpt-6-astra` (reads images) and `gemini-3.5-flash-c` (reads images and video). Chat models are no longer discovered from the upstream; one that is not listed can be added as a custom model.
- A text-only chat model is never sent an image: `POST /api/llm/tasks` with `imageUrls` for one is refused (`model.no_image_input`), and the Language model node greys out its image input, takes no new image connection and says that connected images are not sent.
- The OpenAI catalog lists `gpt-image-2` next to the two GPT Image 2.5 models, and fifteen chat models from GPT-6 down to GPT-4o Mini; the Gemini catalog lists `gemini-3.1-flash-image`, `gemini-3.6-flash` and `gemini-3-flash-preview` as well. Each catalog holds every current model its vendor serves through the endpoints LoomCanvas calls; what is left out and why is in [Providers](docs/providers.md).
- A custom model whose name a catalog lists is served from the catalog under the same model id (enabled state, order, name and price are kept); the custom entry is removed at start-up.
- On a narrow screen the Settings tab strip scrolls sideways inside itself and keeps the current tab in view, instead of widening the page.

Removed (**breaking**)

- The provider type `openai-compatible` and the free-text model fields of the provider form (stored providers are migrated, see above).
- `GET /api/admin/provider-types`, replaced by `GET /api/admin/vendors`. `POST /api/admin/providers` no longer takes model fields, provider objects no longer have `options`, and `POST /api/admin/providers/:id/test` no longer returns `modelCount`.
- The `fields` and `listModels` members of the provider plugin contract. A vendor module now exports `catalog`, `customKinds` and `customSpec`; see [docs/writing-a-provider.md](docs/writing-a-provider.md).
- The five-minute model list cache.

**Storage**

Added

- A **Storage** tab under Settings: choose the local disk or an S3-compatible bucket, with presets for AWS S3, Cloudflare R2, Aliyun OSS and MinIO. Takes effect at once, without a restart. A saved configuration takes precedence over `STORAGE_DRIVER` and `S3_*`. The secret access key is encrypted with `SECRET_KEY` and never returned.
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

**Verified against the real Gaorui service (2026-10-10)**

- Every model in the Gaorui catalog completed one real run with a real key at the lowest settings: the four Nano Banana image models (text-to-image, 1K); all five chat models; `omni-flash` (text-to-video, 8 s, 720p); `veo-3.1` (text-to-video, lite); `grok-imagine-video-1.5-preview` (text-to-video, 480p); `omni-flash-edit` (video edit, 720p). The connection test as well.
- Also verified with inputs: `nano-banana-2` and `omni-flash` with one reference image; `veo-3.1` with one reference image and with a first and a last frame; `gpt-6-astra` and `gemini-3.5-flash-c` with an image; video analysis with `gemini-3.5-flash-c`.
- Not verified: reference images for `nano-banana-pro`, `nano-banana-2.1`, `nano-banana-2-lite`, `omni-flash-edit` and `grok-imagine-video-1.5-preview`; the first-and-last-frame mode of `omni-flash`; every resolution above the lowest; OpenAI and Google Gemini as a whole. The table, one row per model: [docs/providers.md](docs/providers.md#gaorui-what-has-been-verified).
- Catalog entries can carry a `verified` date. Models that have one show a "Verified" badge in the provider's model list and on Settings → Models.
- Added `veo-3.1` (Veo 3.1: text, up to 3 reference images, or first and last frame; 8 s fixed).
- Removed `sora-2-openai-12s`: the service has no channel for it (HTTP 503 `model_not_found`) and does not list it. A canvas node that still names it shows the model as unavailable and asks for another one.
- `omni-flash` no longer offers 6 s: the service lists `omni_flash_6s` but answers HTTP 503 `model_not_found` for it. 8 s is the default; a node that stored 6 s falls back to 8 s.
- Fixed as a result: reference images of the Gaorui image models are now sent as public URLs only. The real service refuses inline base64 (`image_must_be_url`), so an image without a public address is refused before the request is sent, with the usual "A publicly reachable URL is needed…" message.
- Fixed as a result: an upstream error that arrives as a JSON string inside another error body is shown as its message, not as raw JSON; and a `model_not_found` answer is no longer retried, whatever its HTTP status (the service sends it with 503).
- Observed, not changed: `grok-imagine-video-1.5-preview` asked for 4 seconds returned a 6-second clip (a single sample).

**Known limitations**

- The OpenAI and Google Gemini providers have not been exercised against their real upstream services as part of this project. That includes the OpenAI `/images/edits` path and the model names in the OpenAI and Gemini catalogs, which have only been sent to a local fake upstream. Gaorui has been; see above for what exactly.
- With a Gaorui image model, image-to-image needs a public address for the reference image (`PUBLIC_URL`, or files kept in a bucket reachable from the internet).
- The S3 storage driver is verified against MinIO. It has not been run against AWS S3, Cloudflare R2 or Aliyun OSS; their settings follow each vendor's S3-compatibility documentation.
- Switching storage does not move existing files, and there is no migration tool.
- No multi-user support, no content moderation, no private file URLs.

### 中文

**画布**

- 基于 Vue Flow 的无限画布编辑器：素材节点（文本、图片、图片集合、视频）、生成节点（图片生成、图片编辑、视频生成、视频编辑、大语言模型、视频分析）、成品节点、分组。
- 连线分类型；撤销重做、复制粘贴、原地复制、框选、对齐与等距分布、按数据流整理、吸附到网格、节点搜索、小地图、沉浸式、每张画布单独的外观。
- 运行单个节点、一条分支或整张画布；批量运行，一次最多 100 份素材；每个节点保留历史版本；对已有结果的节点重新运行前先确认。
- 不调用任何模型、在服务端处理的工具节点：切片、拼图、加水印、改尺寸、多平台导出。
- 画布模板和文本模板（内置两个画布模板和一组中英文提示词片段）、品牌包、素材库、把画布里的素材打包下载。
- 只读分享链接：保存画布快照，可设有效期，可撤销；快照里不带运行状态、任务号和成本。
- 中英文界面，浅色、深色主题，首次使用的引导页，可选的访问口令页。

**服务端**

- Node.js + Express + MongoDB，单用户。
- 服务商，带注册表和按模型的覆盖项。内置：高瑞（图片、视频模型；对话模型暂时作为自定义模型添加）、OpenAI（对话，图片生成与编辑）、Google Gemini（图片、对话）。见下面的「服务商」。
- 进程内任务队列：并发有上限，每一步都有硬性时限，只在可以安全重新提交时才重试，支持取消，重启后接着处理未完成的运行。
- 结果转存到自己的存储，按内容识别类型，生成 WebP 缩略图。存储：本地磁盘，或者一个 S3 兼容驱动，对接 AWS S3、Cloudflare R2、阿里云 OSS、MinIO 等服务（见下面的「存储」）。
- 按部署者维护的价格表预估成本，没有适用价格时显示「成本未知」；按天、按模型的用量汇总，用量明细及其清理。
- 可选的计费钩子（`BILLING_HOOK`），在每次运行前后调用。
- 服务商的 API Key 用 `SECRET_KEY` 以 AES-256-GCM 加密保存；可选的共用访问口令，登录有限流。
- 凡是用户或上游给出的地址，都经过带 SSRF 防护的下载器；上传文件按内容判断类型；安全响应头，包括 Content-Security-Policy。
- 服务端提示有中英文，按请求选择语言；错误带稳定的标识。
- 画布文档带 `schemaVersion`，读取时迁移。
- 管理设置：站点名称、Logo、默认主题和语言、并发数、超时、重试次数、结果保留天数。

**服务商**

新增

- 服务商和明确写出的模型清单。添加的服务商现在是一家服务商（高瑞、OpenAI 或 Google Gemini）加上你的 API Key。每家支持的模型写在 `server/src/providers/catalog/<服务商标识>.json` 里，分 `image`、`video`、`chat` 三段，写在哪一段就是哪种类型。高瑞排在第一位并带「推荐」标记。
- 自定义模型：在「设置 → 模型」里，可以按上游的模型名给某个服务商添加清单以外的模型，类型（图片或对话）由你手动选择，显示名称可选。每个服务商最多 100 个。三家服务商都不能添加自定义视频模型。
- OpenAI 服务商走 OpenAI 官方接口：`/chat/completions`、`/images/generations`，接了参考图时走 `/images/edits`（multipart）。OpenAI 的图片模型因此可以带参考图了。
- 管理接口：`GET /api/admin/vendors`；管理自定义模型的 `POST`、`PUT`、`DELETE /api/admin/providers/:id/models[/:model]`。服务商对象带 `customBaseUrl` 和 `customModels`；ModelSpec 带 `custom`。
- 用高瑞清单里的模型做视频分析：`gemini-3.5-flash-c` 可以输入视频，会出现在视频分析节点里。高瑞服务商把视频放在 `image_url` 内容片段里发送，值是视频的公网地址，紧跟在文字片段后面（高瑞的中转会把 `video_url` 片段丢掉而不报错）。这是照高瑞主站生产环境的做法写的，还没有从 LoomCanvas 对着真实的高瑞接口跑过。
- 按 token 计价、输入和输出分开的价格，可以在「设置 → 模型」里填写和修改（两个输入框），模型列表里显示成「输入 … / 输出 … · 每百万 token」。之前这种价格只能通过接口设置，列表里显示成 0.00。
- 启动时自动升级已保存的服务商，每个只升级一次：`openai-compatible` 变成 `openai`，标识（slug）不变，所以画布、价格和用量里的模型标识照常可用；填在旧字段里的模型，以及旧版本向上游读取列表时实际用过的模型，都转成自定义模型带过来。名称还是旧默认名「高瑞 API」（"Gaorui API"）的高瑞服务商改名为「高瑞」（"Gaorui"），其他名称不动。API Key、接口地址、是否启用、排序和模型覆盖项不动。见 [docs/providers.zh-CN.md](docs/providers.zh-CN.md#从上一个版本升级)。

变更

- 用「服务商 + 明确的模型清单」取代原来的「类型」和按名字猜测。不再根据模型的名字推断任何东西，也不再向上游读取模型列表。「测试连接」仍然调用上游的模型列表接口，但只用来证明地址和 Key 可用，不再报告模型数量。
- 每家服务商默认用它的官方接口地址（`https://gaorui.cc`、`https://api.openai.com/v1`、`https://generativelanguage.googleapis.com`）。别的地址可以在服务商对话框的「高级」里填写，对方必须使用完全相同的官方接口。服务商添加后不能更换。
- 添加任何一家服务商都必须填 API Key。
- 设置页的标签页改叫「服务商」，这一家服务商叫「高瑞」/ "Gaorui"。
- 品牌的中文写法统一更正为「高瑞」，界面、服务端提示和文档都已改过；已保存的服务商如果默认名称里带着旧写法，升级时会一并改正。
- OpenAI 的对话模型不再接受视频：官方接口没有视频这种内容片段。视频分析可以用高瑞服务商下的 `gemini-3.5-flash-c` 和自定义对话模型；高瑞的自定义对话模型现在同样用 `image_url` 片段发送视频，不再用 `video_url`。
- 高瑞的清单里有五个对话模型：`deepseek-v4-pro`、`gpt-5.5`、`glm-5.3`（纯文本），`gpt-6-astra`（可读图片），`gemini-3.5-flash-c`（可读图片和视频）。对话模型不再从上游发现；清单里没有的可以作为自定义模型添加。
- 纯文本对话模型不会收到图片：对它调用 `POST /api/llm/tasks` 并带 `imageUrls` 会被拒绝（`model.no_image_input`）；大语言模型节点会把图片输入口变灰、不再接受新的图片连线，并写明已连接的图片不会发送。
- OpenAI 的清单在两个 GPT Image 2.5 模型之外列出了 `gpt-image-2`，以及从 GPT-6 到 GPT-4o Mini 的十五个对话模型；Gemini 的清单增加了 `gemini-3.1-flash-image`、`gemini-3.6-flash`、`gemini-3-flash-preview`。每份清单里是这家服务商通过 LoomCanvas 所调用的接口提供的全部现行模型；哪些没有列入、为什么，见[服务商](docs/providers.zh-CN.md)。
- 自定义模型的名字如果已在清单里，就以清单里的为准，模型标识不变（启用状态、排序、名称和价格都保留）；那条自定义记录在服务端启动时删除。
- 窄屏上设置页的标签条在自己里面横向滚动，并让当前标签保持可见，不再把整个页面撑宽。

移除（**不兼容**）

- `openai-compatible` 这个类型，以及服务商表单里自由填写的模型字段（已保存的服务商会自动升级，见上）。
- `GET /api/admin/provider-types`，由 `GET /api/admin/vendors` 取代。`POST /api/admin/providers` 不再接受模型字段，服务商对象不再有 `options`，`POST /api/admin/providers/:id/test` 不再返回 `modelCount`。
- 插件接口里的 `fields` 和 `listModels`。服务商模块现在导出 `catalog`、`customKinds`、`customSpec`，见 [docs/writing-a-provider.zh-CN.md](docs/writing-a-provider.zh-CN.md)。
- 五分钟的模型列表缓存。

**存储**

新增

- 设置页新增「存储」标签页：选择本地磁盘或 S3 兼容的桶，带 AWS S3、Cloudflare R2、阿里云 OSS、MinIO 的预设。保存后立即生效，不用重启。保存的配置优先于 `STORAGE_DRIVER` 和 `S3_*`。Secret Access Key 用 `SECRET_KEY` 加密保存，不再返回。
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

**对着真实的高瑞服务验证过的内容（2026-10-10）**

- 高瑞清单里的每个模型都用真实的 Key、最低档参数真实跑通过一次：四个 Nano Banana 图片模型（文生图，1K）；五个对话模型；`omni-flash`（文生视频，8 秒，720p）；`veo-3.1`（文生视频，lite）；`grok-imagine-video-1.5-preview`（文生视频，480p）；`omni-flash-edit`（视频编辑，720p）。连接测试也验证了。
- 带输入也验证了的：`nano-banana-2` 和 `omni-flash` 带一张参考图；`veo-3.1` 带一张参考图、以及首尾帧；`gpt-6-astra` 和 `gemini-3.5-flash-c` 带一张图片；用 `gemini-3.5-flash-c` 做视频分析。
- 未验证：`nano-banana-pro`、`nano-banana-2.1`、`nano-banana-2-lite`、`omni-flash-edit`、`grok-imagine-video-1.5-preview` 的参考图；`omni-flash` 的首尾帧模式；最低档以外的所有分辨率；OpenAI 和 Google Gemini 全部。每个模型一行的表见 [docs/providers.zh-CN.md](docs/providers.zh-CN.md#高瑞已经验证过的内容)。
- 模型清单的条目可以带一个 `verified` 日期。带日期的模型在服务商的模型列表和「设置 → 模型」页显示「已实测」标记。
- 新增 `veo-3.1`（Veo 3.1：文生视频、最多 3 张参考图、或首尾帧；固定 8 秒）。
- 移除 `sora-2-openai-12s`：该服务没有它的渠道（HTTP 503 `model_not_found`），模型列表里也没有它。画布上还写着它的节点会显示模型不可用，并提示重新选择。
- `omni-flash` 不再提供 6 秒：该服务列着 `omni_flash_6s`，但对它返回 HTTP 503 `model_not_found`。默认改为 8 秒；存着 6 秒的节点会回落到 8 秒。
- 由此修正：高瑞图片模型的参考图现在只按公网地址发送。真实服务不接受内联的 base64（`image_must_be_url`），所以没有公网地址的图片会在请求发出之前被拒绝，提示还是那句「…需要公网可访问的地址…」。
- 由此修正：上游的错误如果是包在另一个错误体里的 JSON 字符串，现在显示其中的文字，而不是整段 JSON；`model_not_found` 不管 HTTP 状态码是什么都不再重试（该服务是用 503 返回的）。
- 观察到、未改动：`grok-imagine-video-1.5-preview` 请求 4 秒，返回的是 6 秒的视频（只有这一次样本）。

**已知的局限**

- OpenAI 和 Google Gemini 两家服务商在本项目里还没有对着真实的上游服务运行过。带参考图时走的 OpenAI `/images/edits`，以及 OpenAI、Gemini 两份模型清单里的模型名，也都只发给过本地的假上游。高瑞已经跑过，具体内容见上。
- 用高瑞的图片模型做图生图，参考图需要有公网地址（设置 `PUBLIC_URL`，或者把文件存到公网上能访问到的桶里）。
- S3 存储驱动是对着 MinIO 验证的，没有对着 AWS S3、Cloudflare R2、阿里云 OSS 跑过；它们的配法依据的是各家的 S3 兼容文档。
- 切换存储不会移动已有的文件，也没有迁移工具。
- 不支持多用户，没有内容审核，没有私有的文件地址。
