## What this changes / 改了什么


## Why / 为什么

<!--
Link the issue if there is one. 有对应的 issue 请附上链接。
-->


## How it was tested / 怎么验证的


## Checklist / 检查项

Run in the repository root / 在仓库根目录运行：

```bash
npm run check
```

It runs the version check, the license check, `i18n:check`, the server tests and the web build.
它会依次跑版本检查、协议检查、`i18n:check`、后端测试和前端构建。

- [ ] `npm run check` passes / 通过
- [ ] UI text is in `web/src/locales/` in both `zh-CN` and `en` / 界面文案中英文都已添加
- [ ] Server messages are in both `server/src/i18n/zh-CN.js` and `en.js` / 服务端提示两个语言文件都已添加
- [ ] An API change updates `docs/architecture.md` and `docs/api.md` / 改接口时同步更新了这两份文档
- [ ] A change to the saved canvas format bumps `schemaVersion` and adds a migration with a test / 改动画布保存格式时提升了 `schemaVersion` 并附带迁移和测试
- [ ] New or changed behaviour is covered in `docs/` (English and Chinese) / 新增或变化的行为已写进 `docs/`（中英文）
- [ ] No API keys, passwords or internal addresses in code, tests, logs or screenshots / 代码、测试、日志和截图里没有 Key、口令或内部地址

## CLA / 贡献者协议

<!--
First pull request: keep the line below. It is how you agree to CLA.md.
第一次提交合并请求：请保留下面这一行，表示你同意 CLA.md。
-->

I have read and agree to CLA.md
我已阅读并同意 CLA.md
