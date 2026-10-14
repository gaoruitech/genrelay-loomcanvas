# LoomCanvas 文档

[English](README.md)

> 状态：早期开发中。首个正式版本发布前，接口可能调整。

## 使用

| 文档 | 内容 |
| --- | --- |
| [快速上手](getting-started.zh-CN.md) | 从零到生成第一张图：启动、用超级管理员账号登录、添加服务商、运行节点。账号，以及四步建起第一个团队。 |
| [使用指南](user-guide.zh-CN.md) | 整体导航（工作台、画布、素材库、模型管理、生成记录、设置）和画布：编辑器（工具栏、生成队列圆钮、一次操作多个节点）、节点和它的三种布局、连线、运行、结果与生成记录、品牌包、模板、资产、分享链接、快捷键。团队：空间和角色、邀请、团队里的画布、轮流编辑、每月上限和用量、团队动态、团队设置。 |
| [常见问题](faq.zh-CN.md) | 常遇到的问题（模型与成本、素材、存储、运行、编辑器、访问与启动、团队），以及协议方面该看哪些文件。 |

## 部署与运维

| 文档 | 内容 |
| --- | --- |
| [部署](deployment.zh-CN.md) | Docker Compose、不用 Docker 运行、反向代理与 HTTPS、备份、升级。 |
| [配置](configuration.zh-CN.md) | 环境变量、管理设置及其在「设置」页的位置、超级管理员对团队要决定的事、画布内设置、固定上限。 |
| [存储](storage.zh-CN.md) | 本地磁盘或 S3 兼容的桶（AWS S3、Cloudflare R2、阿里云 OSS、MinIO）：各家的配法、私有桶、分发方式、切换、测试情况。 |
| [服务商](providers.zh-CN.md) | 三家服务商及各自支持的模型、自定义模型、修改接口地址、从上一个版本升级、素材怎么送到上游、价格与用量。 |
| [安全](security.zh-CN.md) | 部署加固、账号和团队靠什么隔开、哪些内容是公开的、LoomCanvas 不做什么。 |

## 扩展与开发

| 文档 | 内容 |
| --- | --- |
| [开发](development.zh-CN.md) | 仓库结构、开发环境、脚本、添加节点和文案、迁移、代码约定。 |
| [集成](integration.zh-CN.md) | 把 LoomCanvas 集成进自己的产品：把整个应用挂进宿主页面，或者只嵌画布编辑器、后端由你提供的适配器对接。选项、事件、文档格式、样式隔离、认证的接法、兼容性、协议。示例在 [`examples/`](../examples/README.zh-CN.md)。 |
| [编写服务商模块](writing-a-provider.zh-CN.md) | 服务商模块的接口和模型清单文件的格式，附完整示例和测试。 |
| [计费钩子](billing-hook.zh-CN.md) | 用自己的模块对运行做计量或限额。 |
| [HTTP 接口](api.zh-CN.md) | 全部接口的逐项说明：请求、响应、错误码，含「空间与团队」的完整约定。 |
| [架构与接口约定](architecture.md) | 前后端共同遵守的设计约定。 |

## 项目

| 文档 | 内容 |
| --- | --- |
| [README](../README.zh-CN.md) | 概览和快速开始。 |
| [CHANGELOG](../CHANGELOG.md) | 变更记录。 |
| [CONTRIBUTING](../CONTRIBUTING.md) | 如何参与贡献。 |
| [SECURITY](../SECURITY.md) | 如何报告漏洞。 |
| [LICENSE](../LICENSE)、[COMMERCIAL](../COMMERCIAL.md)、[CLA](../CLA.md)、[TRADEMARK](../TRADEMARK.md) | 协议与授权。 |
| [THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) | 第三方软件及其协议。 |
