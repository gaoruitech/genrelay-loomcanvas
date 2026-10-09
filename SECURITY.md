# Security Policy / 安全政策

## Reporting a vulnerability / 报告漏洞

Please do not open a public issue for security problems. Contact us via https://gaorui.cc and describe the problem, affected version and how to reproduce it. We will confirm receipt and keep you informed.

请不要用公开 issue 报告安全问题。请通过 https://gaorui.cc 联系我们，说明问题、受影响的版本和复现方法。我们会确认收到并告知处理进展。

## Supported versions / 支持的版本

Only the latest minor release receives security fixes.
只有最新的次版本会收到安全修复。

## Deployment notes / 部署注意事项

- Set a strong `SECRET_KEY` and keep it private. It encrypts provider API keys at rest. 设置足够强的 `SECRET_KEY` 并妥善保管，它用于加密保存的上游 API Key。
- If the instance is reachable from the internet, set `ACCESS_PASSWORD` and serve it over HTTPS. 实例对公网开放时，请设置 `ACCESS_PASSWORD` 并使用 HTTPS。
- LoomCanvas does not moderate generated content. You are responsible for what you generate and publish. LoomCanvas 不内置内容审核，使用者对生成和发布的内容自行负责。
