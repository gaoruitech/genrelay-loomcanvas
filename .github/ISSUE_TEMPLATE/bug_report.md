---
name: Bug report / 缺陷报告
about: Something does not work as documented / 实际行为与文档不符
title: ''
labels: bug
assignees: ''
---

<!--
Never paste API keys, SECRET_KEY, ACCESS_PASSWORD or login tokens.
For a security problem, do not open an issue: see SECURITY.md.

不要贴出 API Key、SECRET_KEY、ACCESS_PASSWORD 或登录凭证。
安全问题请不要开 issue，见 SECURITY.md。
-->

## What happened / 发生了什么


## What you expected / 期望的结果


## Steps to reproduce / 复现步骤

1.
2.
3.

## Environment / 环境

- LoomCanvas version (`version` from `GET /api/app/bootstrap`, or the commit) / 版本（`GET /api/app/bootstrap` 里的 `version`，或 commit）:
- Deployment (Docker Compose / without Docker) / 部署方式（Docker Compose / 不用 Docker）:
- Behind a reverse proxy? Which one? / 是否在反向代理后面？哪一种？:
- Storage driver (`local` / `s3` / `oss`) / 存储驱动:
- Browser and OS / 浏览器与操作系统:

## If a run failed / 如果是运行失败

- Provider type (Gaorui API / OpenAI-compatible / Gemini / other) / 接入类型:
- Model id / 模型标识:
- Error message shown, and its `errorCode` if you have it / 显示的错误信息，以及 `errorCode`（如果有）:

## Logs / 日志

<!--
Relevant lines from `docker compose logs app`, with secrets removed.
`docker compose logs app` 里相关的几行，去掉敏感信息。
-->

```
```
