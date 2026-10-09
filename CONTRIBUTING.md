# Contributing / 参与贡献

Thanks for your interest in LoomCanvas. 感谢你对 LoomCanvas 的关注。

## Before you start / 开始之前

- Read and agree to the [Contributor License Agreement](CLA.md). 请先阅读并同意[贡献者协议](CLA.md)。
- For anything larger than a small fix, open an issue first so we can agree on the approach. 较大的改动请先开 issue 讨论方案。

## Reporting bugs / 报告缺陷

Include the LoomCanvas version, how you deployed it, steps to reproduce, what you expected and what happened. Never paste API keys.

请写明 LoomCanvas 版本、部署方式、复现步骤、期望结果和实际结果。不要贴出 API Key。

## Development rules / 开发约定

- Interfaces between `web/` and `server/` are defined in [docs/architecture.md](docs/architecture.md), with the endpoint reference in [docs/api.md](docs/api.md). Change both in the same pull request as the code. 前后端接口以 [docs/architecture.md](docs/architecture.md) 为准，逐项说明在 [docs/api.md](docs/api.md)；改接口要同时改这两份文档。
- A change to the saved canvas format must bump `schemaVersion` and ship a migration. 改动画布保存格式必须提升 `schemaVersion` 并附带升级脚本。
- Adding a model should only need a catalog entry or a provider file, not changes to the canvas. See [docs/writing-a-provider.md](docs/writing-a-provider.md). 新增模型应只需要改模型声明或接入文件，不改画布代码，见 [docs/writing-a-provider.zh-CN.md](docs/writing-a-provider.zh-CN.md)。
- User-facing text goes into `web/src/locales/` in both `zh-CN` and `en`; messages from the server go into `server/src/i18n/zh-CN.js` and `en.js`. 界面文案放进 `web/src/locales/`，服务端提示放进 `server/src/i18n/`，中英文都要有。
- Run before submitting, in the repository root / 提交前在仓库根目录运行：`npm run check`. It runs the version check, the license check, the UI string check, the server tests and the web build. 它会依次跑版本检查、协议检查、界面文案检查、后端测试和前端构建。
- The end-to-end tests need a MongoDB: set `TEST_MONGODB_URI`, or let `mongodb-memory-server` download one on first run. 端到端测试需要 MongoDB：设置 `TEST_MONGODB_URI`，或者让 `mongodb-memory-server` 在首次运行时自己下载一份。
- After changing dependencies, run `npm run licenses:write` to regenerate `THIRD_PARTY_NOTICES.md`. Production dependencies must be on the license allowlist in `scripts/licenses.mjs`, or the check fails. 改了依赖之后运行 `npm run licenses:write` 重新生成 `THIRD_PARTY_NOTICES.md`。生产依赖的协议必须在 `scripts/licenses.mjs` 的允许清单里，否则检查不通过。
- Setup, scripts and conventions are in [docs/development.md](docs/development.md). 开发环境、脚本和代码约定见 [docs/development.zh-CN.md](docs/development.zh-CN.md)。

## Security issues / 安全问题

See [SECURITY.md](SECURITY.md). 见 [SECURITY.md](SECURITY.md)。
