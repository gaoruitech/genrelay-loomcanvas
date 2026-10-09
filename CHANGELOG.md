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
- Results copied into your own storage with content-type sniffing and WebP thumbnails. Storage drivers: local disk; S3-compatible and Aliyun OSS (written, not yet run against a real bucket).
- Cost estimates from operator-maintained price tables, "cost unknown" when no price applies, usage summaries by day and by model, usage records with clean-up.
- Optional billing hook (`BILLING_HOOK`) called before and after each run.
- Provider API keys encrypted at rest with AES-256-GCM under `SECRET_KEY`; optional shared access password with rate-limited login.
- SSRF-guarded downloader for every user- or upstream-supplied URL; uploads typed by content; security headers including a Content-Security-Policy.
- Server messages in Chinese and English, selected per request; stable error codes.
- Canvas documents carry a `schemaVersion` and are migrated on read.
- Admin settings for site name, logo, default theme and language, concurrency, timeouts, retries and result retention.

**Packaging and project**

- Dockerfile (non-root, health check) and Docker Compose file with MongoDB 7.
- Tests for the runner, providers (against a fake upstream), pricing, crypto, SSRF guard, storage keys, image tools, schema migration, message catalogs, and end-to-end API and security suites.
- Repository checks for versions, dependency licenses and UI strings; CI workflow.
- AGPL-3.0 license with a separate commercial license, CLA, trademark policy, third-party notices.
- Documentation in English and Chinese under `docs/`.

**Known limitations**

- The built-in providers have not been exercised against their real upstream services as part of this project.
- The S3 and OSS storage drivers have not been run against a real service. The Docker image includes the S3 SDK; the OSS SDK has to be added when building the image (`EXTRA_NPM_PACKAGES=ali-oss`).
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
- 结果转存到自己的存储，按内容识别类型，生成 WebP 缩略图。存储驱动：本地磁盘；S3 兼容存储和阿里云 OSS（代码已写好，尚未对着真实的桶运行过）。
- 按部署者维护的价格表预估成本，没有适用价格时显示「成本未知」；按天、按模型的用量汇总，用量明细及其清理。
- 可选的计费钩子（`BILLING_HOOK`），在每次运行前后调用。
- 模型接入的 API Key 用 `SECRET_KEY` 以 AES-256-GCM 加密保存；可选的共用访问口令，登录有限流。
- 凡是用户或上游给出的地址，都经过带 SSRF 防护的下载器；上传文件按内容判断类型；安全响应头，包括 Content-Security-Policy。
- 服务端提示有中英文，按请求选择语言；错误带稳定的标识。
- 画布文档带 `schemaVersion`，读取时迁移。
- 管理设置：站点名称、Logo、默认主题和语言、并发数、超时、重试次数、结果保留天数。

**打包与项目**

- Dockerfile（非 root 运行，带健康检查）和包含 MongoDB 7 的 Docker Compose 文件。
- 测试覆盖执行器、模型接入（对着假上游）、计价、加密、SSRF 防护、存储 key、图片工具、画布迁移、语言文件，以及端到端的接口测试和安全测试。
- 仓库级检查：版本号、依赖协议、界面文案；CI 工作流。
- AGPL-3.0 协议与单独的商业授权、贡献者协议、商标政策、第三方声明。
- `docs/` 下的中英文文档。

**已知的局限**

- 内置的模型接入在本项目里还没有对着真实的上游服务运行过。
- S3 和 OSS 存储驱动未对着真实的服务验证过。Docker 镜像自带 S3 的 SDK；OSS 的 SDK 需要在构建镜像时加入（`EXTRA_NPM_PACKAGES=ali-oss`）。
- 不支持多用户，没有内容审核，没有私有的文件地址。
