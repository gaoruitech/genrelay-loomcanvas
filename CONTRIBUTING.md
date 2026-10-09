# Contributing / 参与贡献

Thanks for your interest in LoomCanvas. 感谢你对 LoomCanvas 的关注。

## Before you start / 开始之前

- Read and agree to the [Contributor License Agreement](CLA.md). 请先阅读并同意[贡献者协议](CLA.md)。
- For anything larger than a small fix, open an issue first so we can agree on the approach. 较大的改动请先开 issue 讨论方案。

## Reporting bugs / 报告缺陷

Include the LoomCanvas version, how you deployed it, steps to reproduce, what you expected and what happened. Never paste API keys.

请写明 LoomCanvas 版本、部署方式、复现步骤、期望结果和实际结果。不要贴出 API Key。

## Development rules / 开发约定

- Interfaces between `web/` and `server/` are defined in [docs/architecture.md](docs/architecture.md). Change the document in the same pull request as the code. 前后端接口以该文档为准，改接口要同时改文档。
- A change to the saved canvas format must bump `schemaVersion` and ship a migration. 改动画布保存格式必须提升 `schemaVersion` 并附带升级脚本。
- Adding a model should only need a catalog entry or a provider file, not changes to the canvas. 新增模型应只需要改模型声明或接入文件，不改画布代码。
- User-facing text goes into `web/src/locales/` in both `zh-CN` and `en`. 界面文案放进语言文件，中英文都要有。
- Run before submitting / 提交前运行：`cd server && npm test`，`cd web && npm run build`。

## Security issues / 安全问题

See [SECURITY.md](SECURITY.md). 见 [SECURITY.md](SECURITY.md)。
