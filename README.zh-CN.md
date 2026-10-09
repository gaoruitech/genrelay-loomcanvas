# LoomCanvas

[English](README.md)

开源、可自己部署的 AI 创作无限画布。把文字、图片和模型用连线串起来，一键跑完整个流程，产出图片和视频。

LoomCanvas 不卖积分。你填自己的 API Key，画布告诉你每一步大概花多少钱，并记录用量。

> 状态：早期开发中。首个正式版本发布前，接口可能调整。

## 功能

- **画布编辑器**：素材节点（文本、图片、图片集、视频）、生成节点（图片生成、图片编辑、视频生成、视频编辑、大语言模型、视频分析）、本地工具节点（切片、拼图、改尺寸、加水印、一图出全平台）、分组框、成品。
- **运行编排**：运行单个节点、一条分支或整张画布；批量运行；撤销重做；自动整理。
- **自带模型**：模型接入是插件式的。内置高睿 API（一个 Key 用多个模型）、任意 OpenAI 兼容接口、Gemini 格式接口。
- **显示成本，不用积分**：按你自己维护的价格表预估每次运行的成本，并保留用量记录。
- **自己部署**：一条 `docker compose up`。文件默认存本地磁盘，也支持 S3 兼容存储和阿里云 OSS。
- **模板、品牌包、分享链接。**

## 快速开始

```bash
git clone <本仓库> loomcanvas && cd loomcanvas
cp .env.example .env
# 编辑 .env，把 SECRET_KEY 设成一串足够长的随机字符
docker compose up -d
```

打开 http://localhost:3000 ，按引导页连接一个模型接入即可开始使用。

`SECRET_KEY` 用来加密数据库里保存的上游 API Key。请妥善保存，设置后不要再改，否则已保存的 Key 将无法解密。

## 开发

```bash
# 后端
cd server && npm install && npm run dev      # http://localhost:3000
# 前端
cd web && npm install && npm run dev         # http://localhost:5173，/api 代理到 :3000
```

需要 Node.js 20 以上和 MongoDB 7。

## 文档

- [架构与接口约定](docs/architecture.md)
- [如何写一个模型接入](server/README.md)

## 协议

LoomCanvas 采用双协议：

- **AGPL-3.0**：可以免费使用和修改。如果你把修改后的版本作为网络服务对外提供，必须公开你的修改。见 [LICENSE](LICENSE)。
- **商业授权**：用于闭源使用或嵌入到专有产品中。见 [COMMERCIAL.md](COMMERCIAL.md)。

"LoomCanvas" 名称和 Logo 是商标，不随代码协议授权。见 [TRADEMARK.md](TRADEMARK.md)。

欢迎贡献代码，贡献前需同意[贡献者协议](CLA.md)。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。
