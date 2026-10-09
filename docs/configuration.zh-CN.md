# 配置

[English](configuration.md)

LoomCanvas 的配置分三层：

| 层 | 在哪里 | 谁来改 | 何时生效 |
| --- | --- | --- | --- |
| [环境变量](#环境变量) | `.env`（Docker Compose）或 `server/.env` | 部署的人 | 重启后 |
| [管理设置](#管理设置) | 「设置」页，存在数据库里 | 能访问实例的人 | 立即 |
| [画布内设置](#画布内设置) | 每张画布、每个浏览器 | 正在编辑的人 | 立即 |

## 环境变量

所有变量在启动时由 `server/src/config.js` 读取一次。值不合法时服务端直接退出，并指出是哪个变量。

### 基础

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `SECRET_KEY` | 无，**必填** | 主密钥，至少 16 位。用来加密数据库里的上游 API Key，并派生出签发登录凭证的密钥。服务端不会替你生成。改掉它，已保存的 Key 无法解密，所有人也会被退出登录。 |
| `PORT` | `3000` | 服务端监听的端口（1 到 65535）。在 Docker Compose 里这个名字设置的是宿主机端口，容器内固定监听 3000。 |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/loomcanvas` | MongoDB 连接串。 |
| `PUBLIC_URL` | 空 | 可选。实例的公网地址，`http(s)://…`，末尾不带斜杠。本机或内网使用时留空。文件地址里不带它；它只用来把本地存储里的参考素材变成上游模型能读取的绝对地址（用视频做输入时需要）。见[部署](deployment.zh-CN.md#public_url)。 |
| `ACCESS_PASSWORD` | 空 | 共用的访问口令。留空则完全不需要登录。 |
| `MAX_UPLOAD_MB` | `50` | 单个上传文件的上限，也是「按地址抓取」能接受的最大文件（1 到 2048）。上传的文件先放在内存里。 |
| `WEB_DIST` | 空 | 构建好的前端目录（`web/dist`），由服务端一并提供。相对路径以 `server/` 为基准。目录里必须有 `index.html`。 |

### 网络与集成

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `TRUST_PROXY` | 空 | 在反向代理后面运行时设置，登录限流才能看到真实的客户端地址。可以填前面代理的层数（一层代理填 `1`，最多 10），或者逗号分隔的代理地址：IP、CIDR 网段，或 `loopback`、`linklocal`、`uniquelocal` 这几个名字。其他写法（包括 `true` 和主机名）会让服务端在启动时退出。没有「全部信任」这个取值：有的话，客户端可以伪造 `X-Forwarded-For` 绕过登录限流。 |
| `CORS_ORIGIN` | 空 | 额外允许跨域调用 `/api` 的来源，逗号分隔。默认不允许任何跨域访问。只有前端部署在另一个来源时才需要。 |
| `SSRF_ALLOW_HOSTS` | 空 | 不受服务端下载器「内网地址拦截」限制的主机名或 IP，逗号分隔。用于自己网络里的模型服务返回了指向自身的结果链接的情况。见[安全](security.zh-CN.md#ssrf-防护)。 |
| `BILLING_HOOK` | 空 | 计费钩子模块的路径。相对路径以启动服务端时所在的目录为基准。见[计费钩子](billing-hook.zh-CN.md)。 |

### 存储

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local`、`s3` 或 `oss`。 |
| `STORAGE_LOCAL_DIR` | `./data/files` | 本地存储的目录。相对路径以 `server/` 为基准。 |
| `S3_ENDPOINT` | 空 | S3 兼容服务（R2、MinIO 等）的接入地址。用 AWS S3 时留空。 |
| `S3_REGION` | `auto` | 区域。 |
| `S3_BUCKET` | 空 | 桶名。`s3` 必填。 |
| `S3_ACCESS_KEY_ID` | 空 | `s3` 必填。 |
| `S3_SECRET_ACCESS_KEY` | 空 | `s3` 必填。 |
| `S3_FORCE_PATH_STYLE` | 关 | 填 `1`、`true` 或 `yes` 开启路径风格寻址（MinIO 通常需要）。 |
| `S3_PUBLIC_BASE_URL` | 空 | 桶或其 CDN 的公开地址前缀，末尾不带斜杠。`s3` 必填。 |
| `OSS_REGION` | 空 | 例如 `oss-cn-hangzhou`。`oss` 需要 `OSS_REGION` 或 `OSS_ENDPOINT` 之一。 |
| `OSS_ENDPOINT` | 空 | 可代替 `OSS_REGION`。 |
| `OSS_BUCKET` | 空 | `oss` 必填。 |
| `OSS_ACCESS_KEY_ID` | 空 | `oss` 必填。 |
| `OSS_ACCESS_KEY_SECRET` | 空 | `oss` 必填。 |
| `OSS_PUBLIC_BASE_URL` | 空 | 桶或其 CDN 的公开地址前缀。`oss` 必填。 |

测试另外会读 `TEST_MONGODB_URI`，见[开发](development.zh-CN.md#测试)。

自带的 Docker Compose 文件传了其中哪些，见[部署](deployment.zh-CN.md#从-env-读取的变量)。

### 存储驱动

| 驱动 | 文件存在哪 | 文件地址 | 额外安装 |
| --- | --- | --- | --- |
| `local` | `STORAGE_LOCAL_DIR` | `/files/<key>`（站内相对地址），由应用自己提供 | 无 |
| `s3` | 你的桶 | `<S3_PUBLIC_BASE_URL>/<key>` | 无：SDK 是可选依赖，`npm ci` 会装上，Docker 镜像里也有 |
| `oss` | 你的桶 | `<OSS_PUBLIC_BASE_URL>/<key>` | 在 `server/` 下执行 `npm install ali-oss`；用 Docker 时在 `.env` 里设 `EXTRA_NPM_PACKAGES=ali-oss`，再执行 `docker compose build` |

对所有驱动都成立的几点：

- 存储 key 由服务端生成（`uploads/…`、`outputs/…`、`tools/…`、`thumbs/…` 加日期和 32 位随机十六进制字符），里面不会出现文件名或任何用户输入的内容。
- 文件对拿到地址的人**公开可读**。`s3`、`oss` 驱动不做地址签名：对象必须能通过公开地址前缀读到（桶设为公共读，或前面挂 CDN）。
- `s3`、`oss` 两个驱动的代码已经写好，但在本项目里**还没有对着真实的桶跑过**。使用前请自己验证。
- 「第一次请求时现做」的缩略图只有本地存储才有。使用对象存储时，缩略图在上传或结果转存时生成。

## 管理设置

这些设置存在数据库里，在「设置」页修改，也可以通过 `GET` / `PUT /api/admin/settings` 修改（见 [API](api.zh-CN.md)）。不认识的键和超出范围的值会被拒绝。

| 键 | 默认值 | 范围 | 界面位置 | 含义 |
| --- | --- | --- | --- | --- |
| `siteName` | `LoomCanvas` | 最多 40 个字符 | 外观 | 顶栏显示的站点名称。 |
| `logoUrl` | 空 | http(s) 地址或 `/files/…`，最多 2048 个字符 | 外观 | 顶栏的 Logo。留空用默认图标。 |
| `defaultTheme` | `light` | `light`、`dark`、`system` | 外观 | 没有自己选过主题的浏览器使用的主题。 |
| `defaultLocale` | `zh-CN` | `zh-CN`、`en` | 外观 | 没有自己选过语言的浏览器使用的语言；也是服务端提示的兜底语言。 |
| `concurrency` | `4` | 1 到 32 | 限制 | 同时执行的运行数量，超出的排队。调大后立即生效。 |
| `maxRetries` | `2` | 0 到 5 | 限制 | 提交任务失败时的重试次数。只在确定上游没有收到请求时才重试。 |
| `imageTimeoutMinutes` | `10` | 1 到 120 | 限制 | 图片类运行从提交到出结果的总时长上限。 |
| `videoTimeoutMinutes` | `30` | 1 到 240 | 限制 | 视频类运行的总时长上限。 |
| `retentionDays` | `0` | 0 到 3650 | 限制 | 运行结束超过这么多天后删除它的结果文件。`0` 表示永久保留。 |
| `submitTimeoutSec` | `60` | 5 到 600 | 限制 | 向异步型接入提交任务的时限。 |
| `chatTimeoutSec` | `300` | 10 到 3600 | 限制 | 一次对话请求的时限（大语言模型节点、视频分析节点）。 |
| `downloadTimeoutSec` | `300` | 10 到 3600 | 限制 | 把结果转存到存储的时限。 |

每个键也都可以直接发请求修改，例如：

```bash
curl -X PUT http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' \
  -d '{"chatTimeoutSec": 600}'
```

设了 `ACCESS_PASSWORD` 时，加上 `-H 'Authorization: Bearer <token>'`（见 [API](api.md#authentication)）。

### 关于 `retentionDays`

- 清理在启动一分钟后执行一次，之后每六小时一次，每次最多处理 200 条运行。
- 只删除**成功的运行**的结果文件（和缩略图）。上传的文件、工具节点的产物、资产不受影响。
- 运行记录保留，它们就是用量历史。
- 画布上如果还显示着已被删除的结果，会变成破图。所以默认值是 `0`。

### 模型接入与模型

设置页上另外两类配置存在各自的数据表里，不是设置键：

- **模型接入**：类型、名称、接口地址、API Key、是否启用。见[模型接入](providers.zh-CN.md)。
- **模型覆盖项**：每个模型的启用状态、显示名称、排序、默认参数和价格表。见[模型接入](providers.zh-CN.md#价格)。

## 画布内设置

| 设置 | 作用范围 | 存在哪 |
| --- | --- | --- |
| 画布外观：背景颜色、图案、疏密 | 一张画布；分享链接里也带着 | 画布文档（`settings`） |
| 节点的模型与参数（比例、分辨率、时长、数量） | 一个节点 | 画布文档 |
| 节点挂的品牌包 | 一个节点 | 画布文档（品牌包本身是跨画布共用的） |
| 主题（浅色 / 深色） | 一个浏览器 | `localStorage` |
| 语言（简体中文 / English） | 一个浏览器 | `localStorage` |

浏览器自己选的主题和语言优先于站点默认值。

## 固定上限

这些是代码里的常量，列在这里方便你知道边界在哪。

| 上限 | 值 |
| --- | --- |
| 每张画布的节点数 | 500 |
| 每张画布的连线数 | 2000 |
| 列表里显示的画布 | 最近的 200 张 |
| 保存画布的请求 | 6 MB JSON |
| 其他 JSON 请求 | 1 MB（登录和分享链接相关的请求是 64 KB） |
| 提示词长度 | 20,000 个字符 |
| 模型接入 | 50 个 |
| 品牌包 | 50 个，每个最多 5 张参考图 |
| 分享链接 | 500 个 |
| 每个分类的资产 | 5000 个 |
| 一次打包下载的文件数 | 100 个，单个最大 1 GiB，总大小 4 GiB |
| 未完成的运行（排队中或进行中） | 500 个；超出后新的运行会被拒绝，直到有运行结束 |
| 登录尝试 | 每个客户端每 10 分钟 10 次（IPv6 客户端按 /64 网段计），合计 300 次 |
| 登录凭证有效期 | 30 天 |
| 每个接入的模型列表缓存 | 5 分钟 |
