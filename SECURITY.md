# Security Policy / 安全政策

## Reporting a vulnerability / 报告漏洞

Please do not open a public issue for security problems. Contact us via https://gaorui.cc and describe the problem, affected version and how to reproduce it. We will confirm receipt and keep you informed.

请不要用公开 issue 报告安全问题。请通过 https://gaorui.cc 联系我们，说明问题、受影响的版本和复现方法。我们会确认收到并告知处理进展。

## Supported versions / 支持的版本

Only the latest minor release receives security fixes.
只有最新的次版本会收到安全修复。

## Deployment notes / 部署注意事项

The full hardening guide is [docs/security.md](docs/security.md). In short:
完整的部署加固说明见 [docs/security.zh-CN.md](docs/security.zh-CN.md)。要点：

- Set a strong `SECRET_KEY` and keep it private. It encrypts provider API keys at rest. 设置足够强的 `SECRET_KEY` 并妥善保管，它用于加密保存的上游 API Key。
- Register the owner account (the first account registered) before the instance is reachable by anyone else, and serve the instance over HTTPS. 第一个注册的账号是所有者，请赶在别人能访问到实例之前注册；并使用 HTTPS。
- Registration is open by default. If the instance is reachable from the internet and strangers should not have accounts, the owner should close it (Settings → Site). Every account has its own data and API keys, but accounts are not a hardened multi-tenant boundary. 注册默认开放。实例对公网开放、又不希望陌生人注册时，请由所有者关闭注册（「设置 → 站点」）。每个账号有自己的数据和 API Key，但账号之间不是加固过的多租户边界。
- Behind a reverse proxy, set `TRUST_PROXY` to the number of proxies in front (usually `1`), and send `Strict-Transport-Security` from the proxy: the app does not set it. 在反向代理后面运行时，把 `TRUST_PROXY` 设成前面代理的层数（一般是 `1`），并在代理上发送 `Strict-Transport-Security`，应用自己不设这个头。
- Uploaded and generated files, and share links, are readable by anyone who has their URL. 上传和生成的文件以及分享链接，拿到地址的人都能访问。
- LoomCanvas does not moderate generated content. You are responsible for what you generate and publish. LoomCanvas 不内置内容审核，使用者对生成和发布的内容自行负责。
