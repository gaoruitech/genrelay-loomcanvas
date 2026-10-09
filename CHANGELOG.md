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
- Provider plugins with a registry and per-model overrides. Built in: Gaorui API (image and video catalog plus discovered chat models), OpenAI-compatible (chat, text-to-image), Google Gemini (image, chat).
- In-process run queue with bounded concurrency, hard deadlines for every step, retries only when a resubmission is safe, cancellation, and recovery of unfinished runs after a restart.
- Results copied into your own storage with content-type sniffing and WebP thumbnails. Storage: the local disk, or one S3-compatible driver for AWS S3, Cloudflare R2, Aliyun OSS, MinIO and similar services (see **Storage** below).
- Cost estimates from operator-maintained price tables, "cost unknown" when no price applies, usage summaries by day and by model, usage records with clean-up.
- Optional billing hook (`BILLING_HOOK`) called before and after each run.
- Provider API keys encrypted at rest with AES-256-GCM under `SECRET_KEY`; optional shared access password with rate-limited login.
- SSRF-guarded downloader for every user- or upstream-supplied URL; uploads typed by content; security headers including a Content-Security-Policy.
- Server messages in Chinese and English, selected per request; stable error codes.
- Canvas documents carry a `schemaVersion` and are migrated on read.
- Admin settings for site name, logo, default theme and language, concurrency, timeouts, retries and result retention.

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

**Known limitations**

- The built-in providers have not been exercised against their real upstream services as part of this project.
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
- 插件式的模型接入，带注册表和按模型的覆盖项。内置：高睿 API（图片、视频模型清单，加上自动发现的对话模型）、OpenAI 兼容接口（对话、文生图）、Google Gemini（图片、对话）。
- 进程内任务队列：并发有上限，每一步都有硬性时限，只在可以安全重新提交时才重试，支持取消，重启后接着处理未完成的运行。
- 结果转存到自己的存储，按内容识别类型，生成 WebP 缩略图。存储：本地磁盘，或者一个 S3 兼容驱动，对接 AWS S3、Cloudflare R2、阿里云 OSS、MinIO 等服务（见下面的「存储」）。
- 按部署者维护的价格表预估成本，没有适用价格时显示「成本未知」；按天、按模型的用量汇总，用量明细及其清理。
- 可选的计费钩子（`BILLING_HOOK`），在每次运行前后调用。
- 模型接入的 API Key 用 `SECRET_KEY` 以 AES-256-GCM 加密保存；可选的共用访问口令，登录有限流。
- 凡是用户或上游给出的地址，都经过带 SSRF 防护的下载器；上传文件按内容判断类型；安全响应头，包括 Content-Security-Policy。
- 服务端提示有中英文，按请求选择语言；错误带稳定的标识。
- 画布文档带 `schemaVersion`，读取时迁移。
- 管理设置：站点名称、Logo、默认主题和语言、并发数、超时、重试次数、结果保留天数。

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
- 测试覆盖执行器、模型接入（对着假上游）、计价、加密、SSRF 防护、存储 key 与存储层、图片工具、画布迁移、语言文件，以及端到端的接口测试和安全测试。
- 仓库级检查：版本号、依赖协议、界面文案；CI 工作流。
- AGPL-3.0 协议与单独的商业授权、贡献者协议、商标政策、第三方声明。
- `docs/` 下的中英文文档。

**已知的局限**

- 内置的模型接入在本项目里还没有对着真实的上游服务运行过。
- S3 存储驱动是对着 MinIO 验证的，没有对着 AWS S3、Cloudflare R2、阿里云 OSS 跑过；它们的配法依据的是各家的 S3 兼容文档。
- 切换存储不会移动已有的文件，也没有迁移工具。
- 不支持多用户，没有内容审核，没有私有的文件地址。
