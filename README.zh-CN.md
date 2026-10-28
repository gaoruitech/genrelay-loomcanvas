# LoomCanvas

**开源、可自部署的节点式 AI 画布：把提示词、参考图和模型用连线编排成可视化工作流，文生图、图生视频一键跑完，自带 API Key。**

[![协议：AGPL-3.0](https://img.shields.io/badge/%E5%8D%8F%E8%AE%AE-AGPL--3.0-3b7bff)](LICENSE)
[![用 Docker Compose 部署](https://img.shields.io/badge/%E9%83%A8%E7%BD%B2-Docker%20Compose-2496ED?logo=docker&logoColor=white)](docs/deployment.zh-CN.md)
[![Node.js ≥ 20.9](https://img.shields.io/badge/node-%E2%89%A5%2020.9-339933?logo=nodedotjs&logoColor=white)](docs/development.zh-CN.md)
[![Vue 3 + Vue Flow](https://img.shields.io/badge/Vue%203-Vue%20Flow-4FC08D?logo=vuedotjs&logoColor=white)](docs/development.zh-CN.md)
[![界面语言：中文 | English](https://img.shields.io/badge/%E8%AF%AD%E8%A8%80-%E4%B8%AD%E6%96%87%20%7C%20English-8a5cff)](README.md)

[English](README.md) · [文档](docs/README.zh-CN.md) · [快速开始](#快速开始) · [支持的模型](#支持的模型) · [截图](#截图)

![LoomCanvas 编辑器：文本节点连到图片生成节点](docs/images/04-editor.png)

## 它是什么

LoomCanvas 是一块无限画布：文字、图片、视频和 AI 模型都是节点，连线把数据从一个节点送到下一个节点，文生图、图片编辑、图生视频、视频编辑和大语言模型可以串在同一个可视化工作流里。它用 Docker Compose 装在你自己的服务器上，用的是你自己的 API Key；它不自带模型，也不卖积分。

> 状态：早期开发中。首个正式版本发布前，接口可能调整。内置的高瑞模型已经对着真实服务运行过；OpenAI 和 Google Gemini 按官方文档接入，项目还没有实际运行过。S3 存储驱动只对着 MinIO 测试过，没有对着 AWS S3、Cloudflare R2、阿里云 OSS 跑过。

## 亮点

- **节点式工作流**：文本、图片、图片集合、视频素材节点；图片生成、图片编辑、视频生成、视频编辑、大语言模型、视频分析等生成节点。
- **运行单个节点、一条分支或整张画布**，也可以对一批图片批量运行；运行会排队，服务端重启后接着跑。
- **自带 Key（BYOK）**：内置高瑞、OpenAI、Google Gemini，没列出的模型可以作为自定义模型添加。
- **显示预估成本，不用积分**：按你自己填的价格表预估每次运行的花费，按天、按模型记录用量。
- **文件存在你自己的存储里**：本地磁盘，或 S3 兼容的桶（AWS S3、Cloudflare R2、阿里云 OSS、MinIO）。
- **免费的本机工具节点**：切片、拼图、改尺寸、加水印、多平台导出，在你自己的服务器上处理。
- **模板、品牌包、素材库**，以及只读分享链接。
- **团队空间**：画布和素材放在一起，团长配置一次 Key，每张画布可设成团队可看或可改，用邀请链接加入，可设每月限额。
- **账号**：注册登录，每个账号有自己的个人空间，内置超级管理员。
- **可以嵌入**：把整个应用，或只把画布编辑器，集成进你自己的产品。
- **中英文界面**，深色、浅色两套主题，有手机版式和触屏手势。
- **一条 `docker compose up` 部署**：前端 Vue 3 + Vue Flow，后端 Node.js + Express + MongoDB。

## 支持的模型

| 服务商 | 类型 | 模型 |
| --- | --- | --- |
| **高瑞** | 图片 | Nano Banana Pro、Nano Banana 2、Nano Banana 2.1、Nano Banana 2 Lite |
| | 视频 | Veo 3.1、Grok Video 1.5、Grok Video 1.0、Omni Flash |
| | 视频编辑 | Omni Flash Edit |
| | 对话（大语言模型） | DeepSeek V4 Pro、GPT 5.5、GLM 5.3、GPT 6 Astra、Gemini 3.5 Flash |
| **OpenAI** | 图片 | GPT Image 2.5 Sunburst、GPT Image 2.5 Flare、GPT Image 2（`gpt-image-2`） |
| | 对话（大语言模型） | GPT-6 Astra、GPT-6.1 Sol、GPT-6 Sol、GPT-6 Luna、GPT-5.6 Sol、GPT-5.6 Terra、GPT-5.6 Luna、GPT-5.5、GPT-5.4、GPT-5.4 Mini、GPT-5.2、GPT-4.1、GPT-4.1 Mini、GPT-4o、GPT-4o Mini |
| **Google Gemini** | 图片 | Nano Banana 2.1、Gemini 3 Pro Image（即 Nano Banana Pro）、Gemini 3.1 Flash Image（即 Nano Banana 2）、Gemini 3.1 Flash Lite Image（即 Nano Banana 2 Lite） |
| | 对话（大语言模型） | Gemini 3.8 Flash、Gemini 3.6 Flash、Gemini 3.5 Flash-Lite、Gemini 3.1 Pro（预览版）、Gemini 3 Flash（预览版） |

- 高瑞一个 Key 就能用它的图片、视频和对话模型。OpenAI 和 Google Gemini 只走各自的官方接口。
- 图片模型可以按提示词生成，也可以带参考图编辑。视频生成模型支持文生视频和图生视频；Veo 3.1 和 Omni Flash 还可以指定首帧和尾帧。对话模型用在「大语言模型」节点；高瑞的 Gemini 3.5 Flash 还能读视频，用在「视频分析」节点。
- 同一家服务商的其他图片或对话模型，可以按模型名作为自定义模型添加；接入别的服务商要写一个服务商模块，见[编写服务商模块](docs/writing-a-provider.zh-CN.md)。
- 发往上游的模型名、参考图数量上限、画幅、分辨率和时长，见[服务商](docs/providers.zh-CN.md)。

## 与同类工具的区别

LoomCanvas 和 ComfyUI 一样是节点式的，但它不在你自己的机器上跑模型：每个生成节点都通过 API 调用托管的模型，所以不需要本地显卡，也不能加载本地的模型文件。结果直接显示在画布的节点上。它装在你自己的服务器上、用你自己的 API Key，而不是一项托管服务；几个人可以共用一个团队空间。

## 快速开始

需要 Docker 和 Compose v2。

```bash
git clone https://github.com/gaoruitech/loomcanvas.git
cd loomcanvas
cp .env.example .env
# 编辑 .env：把 SECRET_KEY 设成一串足够长的随机字符，把 ADMIN_PASSWORD 设成超级管理员的密码
docker compose up -d
```

打开 http://localhost:3000 （或这台机器的地址，端口是你设的 `PORT`），点「登录」，用 `admin` 和你设的密码登录，再在接下来的页面上添加一个服务商即可开始使用。推荐高瑞，在 https://gaorui.cc 获取 Key。

- `SECRET_KEY` 用来加密数据库里保存的上游 API Key。请妥善保存，设置后不要再改，否则已保存的 Key 将无法解密。
- `PUBLIC_URL` 可以不填。本机或内网使用时留空即可：文件按「当前打开的地址」寻址。实例有公网地址时把它设成那个地址，上游模型才能按地址读取参考素材（文件存在本地磁盘上，又要用视频做输入、或者给高瑞的图片模型传参考图时需要）。
- 超级管理员账号由服务端在第一次启动时创建，不靠注册产生。用户名是 `admin`，除非你设了 `ADMIN_USERNAME`；`ADMIN_PASSWORD`（8 到 128 个字符）是它的密码。留空的话，服务端会生成一个随机密码，在启动日志里打印一次（`docker compose logs app`）；用它登录后，系统会要求你先换成自己的密码。这几个变量只在创建这个账号时读取。
- 其他人点「注册」，得到的是普通账号。注册默认开放；超级管理员可以在「设置 → 站点」里关掉，也可以一开始就用 `REGISTRATION_OPEN=false` 启动。见[账号](docs/getting-started.zh-CN.md#账号)。

逐步说明见[快速上手](docs/getting-started.zh-CN.md)。

## 截图

| | |
| --- | --- |
| ![落地页](docs/images/12-landing.png) 落地页 | ![登录页](docs/images/13-login.png) 登录 |
| ![添加服务商](docs/images/01-setup.png) 第一次登录后添加第一个服务商 | ![工作台](docs/images/14-workbench.png) 工作台 |
| ![编辑器](docs/images/04-editor.png) 编辑器（中文界面） | ![英文界面](docs/images/11-editor-en.png) 编辑器（英文界面） |
| ![图生视频模板](docs/images/09-editor-dark.png) 内置的「图生视频」模板 | ![运行完成](docs/images/06-editor-result.png) 画布上的结果 |
| ![模型与价格](docs/images/08-settings-models.png) 模型管理：服务商、模型与价格（项目不带价格，由你自己填） | ![生成记录](docs/images/15-history.png) 生成记录：每一次运行和汇总 |
| ![空间切换器](docs/images/16-space-switcher.png) 空间切换器：个人空间和团队 | ![团队首页](docs/images/17-team-home.png) 团队首页 |
| ![团队成员](docs/images/18-team-members.png) 团队：成员和邀请链接 | ![只读与接管](docs/images/24-editor-readonly.png) 别人正在编辑时：只读，可以接管 |
| ![浅色主题下的工作台](docs/images/14-workbench-light.png) 浅色主题：工作台 | ![浅色主题下的编辑器](docs/images/04-editor-light.png) 浅色主题：编辑器 |

## 功能详情

<details>
<summary>画布、运行、模型、存储、账号和团队目前能做的全部事情</summary>

- **画布编辑器。** 素材节点（文本、图片、图片集合、视频）、生成节点（图片生成、图片编辑、视频生成、视频编辑、大语言模型、视频分析）、成品节点和分组。连线分类型，支持撤销重做、复制粘贴、自动整理、节点搜索。生成节点有三种布局（结果优先、紧凑加右侧面板、全部放在节点上）；选中多个节点时有一条工具条，可以对齐、编组、一起运行。工具栏和生成队列圆钮可以拖到画布上别的位置；选中一个节点直接打字，字就进它的提示词（输入法也一样）。
- **本机工具节点。** 切片、拼图、改尺寸、加水印、多平台导出，在你自己的服务器上处理，没有成本。
- **运行编排。** 运行单个节点、一条分支或整张画布；对一批素材图做批量运行。运行会排队，有并发上限和硬性超时。服务端重启后，排队中的运行和已经拿到上游任务号的运行会接着跑。
- **自带模型。** 选一家服务商，填入你自己的 API Key。内置：高瑞（一个 Key 用图片、视频和对话模型）、OpenAI（对话，图片生成与编辑）、Google Gemini（图片和对话），后两家走各自的官方接口。每家服务商支持哪些模型都明确列出；没列出的模型可以作为自定义模型添加。
- **显示成本，不用积分。** 按你自己维护的价格表预估每次运行的成本，没填价格时显示「成本未知」；按天、按模型的用量记录。
- **文件留在你手里。** 结果会转存到你自己的存储：默认本地磁盘，也可以是 S3 兼容的桶（AWS S3、Cloudflare R2、阿里云 OSS、MinIO），在「设置 → 存储」里配置。桶可以保持私有。哪些经过了测试，见[存储](docs/storage.zh-CN.md)。
- **模板、品牌包、素材库、分享链接。** 只读分享链接，可设有效期，可撤销。
- **工作台、生成记录、模型管理。** 工作台上是最近的画布、模板、生成队列和本月用量；「生成记录」里是每一次运行，可以筛选、看运行详情、导出 CSV，也可以把多条结果打成一个 ZIP 下载；「模型管理」里管服务商、模型和价格。
- **可以集成进你自己的产品。** 由你的开发者把整个应用挂载进自己的页面（用你自己的登录，可以不带外壳，页面和功能逐项开关），或者只嵌画布编辑器，通过一个适配器接你自己的后端。见[集成](docs/integration.zh-CN.md)和 [`examples/`](examples/README.zh-CN.md)。
- **中英文**界面和服务端提示。深色、浅色两套主题，也可以跟随系统。落地页、应用和编辑器在手机大小的屏幕上会换一种排法：导航在屏幕底部，编辑器里的输入条、属性面板和生成队列变成贴底的面板。触屏上画布单指拖动平移、双指缩放，按住按钮会显示它的说明，工具栏（手机上除外）和生成队列圆钮可以用手指或手写笔拖动；适合查看、小改和运行，搭复杂的画布还是大屏幕顺手。
- **账号。** 注册、登录后使用；每个账号有自己的个人空间：自己的画布、文件、服务商和 API Key。超级管理员账号是内置的：服务端第一次启动时自动创建。它负责管理站点和账号列表，可以关闭注册。
- **团队。** 几个账号共用一个团队空间：画布、素材、品牌包、模板和生成记录放在一起。团长和管理员配置一次服务商和 Key，成员直接使用、看不到 Key。画布有三档可见范围（仅自己、团队可看、团队可改）；用邀请链接加入；可以按成员、按团队设每月的次数上限和预估金额上限；有用量统计和团队动态。创建团队要超级管理员授权。见[使用指南](docs/user-guide.zh-CN.md#团队)。
- **团队不是什么。** 不是实时协作：同一张画布同一时间一个人编辑，其他人只读，可以接管。不发邮件：邀请是一条要你自己转交的链接。金额是按你们填的价格算出的预估，不是账单。账号之间、团队之间的隔离不是加固过的多租户边界。见[安全](docs/security.zh-CN.md)。

</details>

## 文档

| | |
| --- | --- |
| [快速上手](docs/getting-started.zh-CN.md) | 从零到第一张图 |
| [使用指南](docs/user-guide.zh-CN.md) | 画布怎么用 |
| [部署](docs/deployment.zh-CN.md) | Docker、反向代理、备份、升级 |
| [配置](docs/configuration.zh-CN.md) | 环境变量与设置 |
| [存储](docs/storage.zh-CN.md) | 本地磁盘或 S3 兼容的桶 |
| [服务商](docs/providers.zh-CN.md) | 服务商、支持的模型、自定义模型、价格 |
| [安全](docs/security.zh-CN.md) | 部署加固与局限 |
| [常见问题](docs/faq.zh-CN.md) | 常见问题 |
| [开发](docs/development.zh-CN.md) | 参与开发 |
| [集成](docs/integration.zh-CN.md) | 把 LoomCanvas 集成进自己的产品：整站嵌入，或只嵌编辑器 |
| [编写服务商模块](docs/writing-a-provider.zh-CN.md) | 添加别的服务商 |
| [计费钩子](docs/billing-hook.zh-CN.md) | 计量与限额 |
| [HTTP 接口](docs/api.zh-CN.md) | 接口索引 |
| [架构与接口约定](docs/architecture.md) | 前后端约定 |
| [变更记录](CHANGELOG.md) | 改了什么 |

全部文档见 [docs/README.zh-CN.md](docs/README.zh-CN.md)。

## 开发

需要 Node.js 20.9 以上和 MongoDB 7。

```bash
# 后端
cd server && npm install && cp .env.example .env   # 然后在 server/.env 里设置 SECRET_KEY
npm run dev                                        # http://localhost:3000

# 前端，另开一个终端
cd web && npm install && npm run dev               # http://localhost:5173，/api 代理到 :3000
```

详见[开发](docs/development.zh-CN.md)。

## 集成

LoomCanvas 可以单独运行，也可以集成进别的 Web 产品，有两种形态：

- **整个应用**，挂载到你页面里的一个元素上：用你自己的登录，LoomCanvas 的顶栏和侧栏可要可不要，页面和功能逐项开关。
- **只要画布编辑器**，以函数、Vue 组件或自定义元素的形式提供，背后接一个由你提供的适配器：可以接自带的服务端、你自己的服务端，也可以完全不要服务端。

两个入口都从本仓库构建（没有发布到 npm）。见[集成](docs/integration.zh-CN.md)和 [`examples/`](examples/README.zh-CN.md) 里的示例。产品不能按 AGPL 开源的，需要商业授权（见[协议](#协议)）。

## 协议

LoomCanvas 采用双协议：

- **AGPL-3.0**：可以免费使用和修改。如果你把修改后的版本作为网络服务对外提供，必须公开你的修改。见 [LICENSE](LICENSE)。
- **商业授权**：用于闭源使用或嵌入到专有产品中。见 [COMMERCIAL.md](COMMERCIAL.md)。

"LoomCanvas" 名称和 Logo 是商标，不随代码协议授权。见 [TRADEMARK.md](TRADEMARK.md)。第三方软件列在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 参与贡献

欢迎贡献代码，贡献前需同意[贡献者协议](CLA.md)。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。报告漏洞请看 [SECURITY.md](SECURITY.md)。
