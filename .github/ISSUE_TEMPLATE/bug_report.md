---
name: Bug report / 缺陷报告
about: Something does not work as documented / 实际行为与文档不符
title: ''
labels: bug
assignees: ''
---

<!--
Never paste API keys, SECRET_KEY, account passwords, storage secret keys or login tokens.
For a security problem, do not open an issue: see SECURITY.md.

不要贴出 API Key、SECRET_KEY、账号密码、存储密钥或登录凭证。
安全问题请不要开 issue，见 SECURITY.md。
-->

## What happened / 发生了什么


## What you expected / 期望的结果


## Steps to reproduce / 复现步骤

1.
2.
3.

## Environment / 环境

- LoomCanvas version (shown at the bottom of the sidebar and of the Settings page; or `version` from `GET /api/bootstrap`; or the commit) / 版本（侧栏底部和「设置」页底部有显示；或 `GET /api/bootstrap` 里的 `version`；或 commit）:
- Deployment (Docker Compose / without Docker) / 部署方式（Docker Compose / 不用 Docker）:
- Behind a reverse proxy? Which one? / 是否在反向代理后面？哪一种？:
- Storage (`local` / `s3`; for `s3` the service: AWS S3, Cloudflare R2, Aliyun OSS, MinIO, other; delivery `proxy` / `redirect`) / 存储（`local` / `s3`；`s3` 请写明服务商和分发方式）:
- Browser and OS / 浏览器与操作系统:
- Page (Workbench / Canvases / editor / Assets / Models / History / Settings / sign-in) / 出问题的页面（工作台 / 画布 / 编辑器 / 素材库 / 模型管理 / 生成记录 / 设置 / 登录注册）:
- Owner account or another account? / 是所有者账号还是普通账号？:

## If a run failed / 如果是运行失败

- Provider (Gaorui / OpenAI / Google Gemini), and whether it uses a non-official base URL / 服务商（高瑞 / OpenAI / Google Gemini），以及是否改过接口地址:
- Is the model a custom model? / 是不是自定义模型:
- Model id / 模型标识:
- Error message shown (History → View details has the failure reason), and its `errorCode` if you have it / 显示的错误信息（「生成记录 → 查看详情」里有失败原因），以及 `errorCode`（如果有）:

## Logs / 日志

<!--
Relevant lines from `docker compose logs app`, with secrets removed.
`docker compose logs app` 里相关的几行，去掉敏感信息。
-->

```
```
