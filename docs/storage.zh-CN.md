# 存储

[English](storage.md)

上传和生成的文件存在哪里，怎么改存到 S3 兼容的桶里，以及切换时已有的文件会怎样。

## 概览

- 默认存在**本地磁盘**，目录是 `STORAGE_LOCAL_DIR`（用 Docker Compose 时是 `app_data` 数据卷）。什么都不用配。
- 另一种选择是**一个 S3 兼容驱动**。它对接 AWS S3，以及实现了 S3 接口的服务：Cloudflare R2、阿里云 OSS、MinIO 等。各家的差别只是几个明确的选项（Endpoint、地域、路径风格、ACL），见下面[各家服务的配法](#各家服务的配法)。
- 每个存下来的文件在任何后端上都只有**一个地址**：站内相对地址 `/files/<key>`。这个地址由应用自己应答，文件在哪它就去哪找，所以换存储不用改画布。
- 桶可以保持**私有**。不需要公共读，也不需要配 CORS，除非你选择让浏览器直接从公开域名加载文件（见[两种分发方式](#两种分发方式)）。
- S3 的 SDK（`@aws-sdk/client-s3`、`@aws-sdk/lib-storage`、`@aws-sdk/s3-request-presigner`）是 `server/` 的常规依赖，Docker 镜像里也有。第一次用到 S3 后端时才加载。

依赖某一家服务之前，请先看[测试情况](#测试情况)。

## 怎么配置

### 设置 → 存储

打开「设置 → 存储」，填好「S3 兼容对象存储」这张表单，点「测试连接」，然后点「保存并切换到对象存储」。保存后立即生效，不用重启。正在进行的上传会在它开始时的那个后端上完成。想换回去，点同一页上的「切回本地磁盘」。

同样的操作也可以通过接口完成，见 [API](api.md#storage)。

### 环境变量

`STORAGE_DRIVER` 和 `S3_*` 变量（[一览](#环境变量一览)）只是初始默认值：在「设置 → 存储」里从没保存过任何东西的实例，由它们决定用哪种存储。它们在启动时读取一次。`STORAGE_DRIVER=s3` 时，如果 `S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` 有一个为空，或者某个值不合法，服务端拒绝启动；启动时不会去连桶。

### 优先级

1. **设置页里保存的配置**（数据库 `settings` 集合里的一条记录，键为 `storage`）。
2. 没有的话，用**环境变量**（`STORAGE_DRIVER`、`S3_*`）。
3. 再没有，用**本地磁盘**。

「存储」标签页会显示当前的选择来自哪里：「在此保存的配置」「来自环境变量」或「默认」。只要在页面上保存过（包括保存成「本地磁盘」），新文件存到哪就不再由环境变量决定。表单的初始值取自已保存的 S3 配置；从没保存过时，取自环境变量。

启动日志里也有同样的信息：`storage: s3 from settings` 或 `storage: local from environment`。

## 各个字段

| 字段（接口里的名字） | 含义 |
| --- | --- |
| 存储方式（`driver`） | `local`（「本地磁盘」）或 `s3`（「S3 兼容对象存储」）。 |
| 服务商预设（`preset`） | `aws`、`r2`、`oss`、`minio` 或 `custom`。只是一个标签，用来在表单里预填提示，不影响请求怎么发。 |
| Endpoint（`endpoint`） | S3 接口的地址：`http(s)://主机[:端口]`，后面不带路径。用 AWS S3 时留空，地址由地域推出。这里填的是**服务**的地址，不是桶的地址：以桶名开头的 Endpoint 会被拒绝。 |
| 地域（`region`） | 默认 `us-east-1`。小写字母、数字和连字符。 |
| 存储桶（`bucket`） | 3 到 63 位的小写字母、数字、点和连字符。桶必须已经存在，应用不会替你创建。 |
| Access Key ID（`accessKeyId`） | 必填。 |
| Secret Access Key（`secretAccessKey`） | 只写。保存前用 `SECRET_KEY` 加密（AES-256-GCM，和模型接入的 Key 一样），之后不再返回；页面上只显示「已设置」和末四位。留空表示沿用已保存的那个。 |
| 路径风格（`forcePathStyle`） | 开：`https://主机/桶/key`。关：`https://桶.主机/key`。MinIO 和多数自建服务要开；AWS S3、R2、OSS 要关。 |
| 路径前缀（`keyPrefix`） | 可选，桶里的一个目录，例如 `loomcanvas` 或 `apps/canvas`。只能用字母、数字、`_`、`-`、`.`，目录之间用 `/`。每个对象存成 `<前缀>/<key>`。 |
| 公开访问地址（`publicBaseUrl`） | 可选。任何人都能通过它读到桶里文件的 `http(s)` 地址：自定义域名、CDN、`r2.dev` 地址。它必须对应**桶的根**，路径前缀会接在它后面。可以带路径（`http://minio.example.com:9000/my-bucket`）。 |
| 文件分发方式（`delivery`） | `proxy`（「由本站转发」）：应用自己把文件内容发给浏览器。`redirect`（「跳转到公开地址」）：`/files/<key>` 把浏览器重定向到公开访问地址。默认值：填了公开访问地址时是 `redirect`，否则是 `proxy`。`redirect` 必须有公开访问地址。见[下文](#两种分发方式)。 |
| 对象 ACL（`acl`） | 空（「不设置」，默认）、`private` 或 `public-read`。为空时完全不发 ACL 头。除非你的服务要靠对象级 ACL 才能让对象公开，否则留空：R2 没有对象 ACL，AWS 的桶默认禁用 ACL。 |

不管哪一家，驱动总是这样做：

- 写入对象时带上它的 `Content-Type` 和 `Cache-Control: public, max-age=31536000, immutable`。key 不会重复使用。
- 只在接口要求时才发送校验和（`requestChecksumCalculation` 和 `responseChecksumValidation` 都是 `WHEN_REQUIRED`）。新版 AWS SDK 默认会给每次上传加 CRC32 的 `x-amz-checksum-*` 头，有几家兼容服务不接受。
- 内存里的数据用一次 `PutObject` 写入。长度未知的流（生成的视频）用分片上传，来源出错时会中止这次上传。

## 连接测试

「存储」标签页上的「测试连接」（以及 `POST /api/admin/storage/test`）用表单里的值真实地走一遍，这时什么都还没保存：

| 步骤 | 做什么 |
| --- | --- |
| `put` | 在 `probe/` 下（路径前缀之内）写入一个很小的文本对象。 |
| `head` | 查它的大小。然后再查一个不存在的 key：存储服务应该回答「不存在」。没有列出桶权限的密钥得到的会是「无权限」，测试会指出这一点。 |
| `get` | 把对象读回来，逐字节比对。 |
| `public` | 只在 `redirect` 分发时有：不带凭据从公开访问地址加载这个对象并比对。 |
| `delete` | 删除这个对象。只要写入过，这一步就会执行，中间失败了也一样。 |

结果里每一步是 `ok`、`failed` 或 `skipped`，外加一句话说明该改什么。这些话的含义见[排查问题](#排查问题)。测试不会久等：连接 6 秒，每个请求 12 秒，不重试。

保存 S3 配置时会先做同样的测试。测试不通过就不保存，除非你点「仍然保存」确认。

服务端会去连你填的 Endpoint 和公开访问地址。这两个地址有意不经过 SSRF 防护，见[安全](security.zh-CN.md#ssrf-防护)。

## 各家服务的配法

只有 MinIO 对着真实服务跑过。其余几家的配法依据的是各家公开的 S3 兼容文档，见[测试情况](#测试情况)。

### MinIO

已测试。

| 字段 | 值 |
| --- | --- |
| Endpoint | `http://minio:9000`（LoomCanvas 服务端访问 MinIO 用的地址） |
| 地域 | `us-east-1` |
| 路径风格 | **开** |
| 存储桶 | 一个已经存在的桶 |
| 密钥 | 对这个桶有读、写、删除和列出权限的 MinIO Access Key |

私有桶配 `proxy` 分发就能用，不需要别的设置。

要用 `redirect` 分发，先让桶可以匿名读取，再把公开访问地址指向它：

```bash
mc anonymous set download ALIAS/BUCKET
```

公开访问地址：`http://<浏览器能访问到的主机>:9000/BUCKET`。

用 Docker Compose 把 MinIO 和应用放在一起，写在 `docker-compose.override.yml` 里：

```yaml
services:
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: loomcanvas
      MINIO_ROOT_PASSWORD: change-this-password
    volumes:
      - minio_data:/data

volumes:
  minio_data:
```

在 MinIO 控制台里或用 `mc` 建好桶，并给应用单独建一个 Access Key，然后在「设置 → 存储」里填写，Endpoint 填 `http://minio:9000`。

关于参考素材：Endpoint 是 `http://minio:9000` 这样的地址时，公网上的上游模型没法从它下载，而应用看不出这种主机名是内部的。这时必须是地址的输入（原视频、部分视频模型的参考图）会在上游那边失败，设了 `PUBLIC_URL` 也一样。请把 Endpoint 填成上游能访问到的地址，或者填成内网 IP，让应用退回到 `PUBLIC_URL`。见[给上游模型的参考素材](#给上游模型的参考素材)。

### AWS S3

S3 兼容，按下面的方式配置，没有对着真实服务测试过。遇到问题请反馈。

| 字段 | 值 |
| --- | --- |
| Endpoint | 留空 |
| 地域 | 桶所在的地域，例如 `eu-west-1` |
| 路径风格 | 关 |
| ACL | 留空 |

给这把密钥的 IAM 策略：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::BUCKET/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::BUCKET"
    }
  ]
}
```

为什么要 `s3:ListBucket`：没有它，对一个不存在的对象，S3 回答的是 `403 Forbidden` 而不是 `404 Not Found`。存储层找文件的办法是挨个问各个后端「你有没有这个 key」，所以必须能分清「不在这里」和「没查成」。连接测试会发现缺这项权限，并明确指出来。

用 `proxy` 分发时，「阻止公共访问」可以一直开着。要用 `redirect` 分发，在桶前面放 CloudFront 或别的公开域名，把它的地址填进公开访问地址。

### Cloudflare R2

S3 兼容，按下面的方式配置，没有对着真实服务测试过。遇到问题请反馈。

| 字段 | 值 |
| --- | --- |
| Endpoint | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| 地域 | `auto` |
| 路径风格 | 关 |
| ACL | 留空（R2 没有对象 ACL） |
| 密钥 | 对这个桶有 **Object Read & Write** 权限的 R2 API 令牌，用它的 Access Key ID 和 Secret Access Key |

R2 的桶在 S3 接入地址上是私有的。要公开只有两条路：`r2.dev` 子域名（用于开发调试）或自定义域名。用 `redirect` 分发时，开启其中一种，把它填进公开访问地址。用 `proxy` 分发时，桶保持私有即可。

### 阿里云 OSS

S3 兼容，按下面的方式配置，没有对着真实服务测试过。遇到问题请反馈。

| 字段 | 值 |
| --- | --- |
| Endpoint | `https://oss-<地域>.aliyuncs.com`，例如 `https://oss-cn-hangzhou.aliyuncs.com`。**不是**桶自己的域名（`my-bucket.oss-cn-hangzhou.aliyuncs.com`）。 |
| 地域 | `oss-cn-hangzhou`（与 Endpoint 里的地域标识相同） |
| 路径风格 | **必须关**。OSS 拒绝路径风格的请求（`SecondLevelDomainForbidden`），连接测试会把它报成「请关闭路径风格」。 |
| ACL | 留空；想在桶私有的情况下让对象公开，填 `public-read` |
| 密钥 | 一个 RAM 用户的 AccessKey，对这个桶有 `oss:PutObject`、`oss:GetObject`、`oss:DeleteObject`、`oss:AbortMultipartUpload`、`oss:ListObjects` 权限 |

我们没能验证的几点：

- 如果用这个地域时 OSS 报签名不对，试试去掉 `oss-` 前缀的地域标识（`cn-hangzhou`），并请告诉我们哪一个能用。
- 内网 Endpoint（`oss-cn-hangzhou-internal.aliyuncs.com`）只能在阿里云的网络里访问。交给上游模型的签名地址是按所填的 Endpoint 生成的，所以用内网 Endpoint 时，公网上的上游加载不了它。
- 阿里云的文档提到，通过桶的默认域名访问时，部分类型的文件会被当作附件下载。用 `redirect` 分发时，给桶绑定一个自定义域名作为公开访问地址更稳妥。

原来的 `oss` 驱动已经移除，见[从 STORAGE_DRIVER=oss 迁移](#从-storage_driveross-迁移)。

### 其他 S3 兼容服务

Backblaze B2、腾讯云 COS、Wasabi 等：预设选「其他 S3 兼容服务」，按服务商的 S3 兼容说明填 Endpoint、地域和寻址方式。它们都没有测试过。组合对不对，连接测试很快就能告诉你。

## 两种分发方式

`/files/<key>` 始终是文件的地址。浏览器请求它时应用怎么做，取决于文件在哪里：

- 在本地磁盘上：从磁盘读。
- 在 `proxy` 分发的桶里：由应用从桶里流式读出来转发。
- 在 `redirect` 分发的桶里：回答 `302`，指向 `<公开访问地址>/<路径前缀><key>`。

| | `proxy`（由本站转发） | `redirect`（跳转到公开地址） |
| --- | --- | --- |
| 谁发送文件内容 | LoomCanvas 服务端，从桶里边读边发，不在内存里攒。 | 桶的公开域名，或它前面的 CDN。 |
| 桶的可见性 | 私有。不需要公共读。 | 对象必须能不带凭据地通过公开访问地址读到。 |
| 桶上的 CORS 配置 | 不需要。 | 显示不需要：图片和视频跨域加载不要求 CORS。桶不返回 CORS 头时，浏览器里的下载和编辑会退回到应用的代理下载；允许来自你站点来源的 `GET` 只是让这些操作直连。 |
| 流量 | 每次查看都走 桶 → 服务端 → 浏览器。桶到服务端、服务端到访问者，两段出站流量都要算。 | 服务端只回一个很小的重定向。文件流量从公开域名直接到访问者。 |
| 缓存 | `Cache-Control: public, max-age=31536000, immutable`，`ETag` 和 `Last-Modified` 来自桶。`If-None-Match` 命中时返回 `304`。应用前面的 CDN 或反向代理缓存可以缓存 `/files/*`。 | 重定向本身可缓存 5 分钟（`Cache-Control: public, max-age=300`）。对象怎么缓存看公开域名返回什么；对象写入时带的是一年的 `Cache-Control`。 |
| Range 请求（视频拖动进度） | 原样交给桶，桶的回答（`206`、`416`）原样返回。带多个区间的请求得到整个文件。 | 由公开域名处理。 |
| 前提 | 只要有凭据。 | 要有公开访问地址。 |

两种方式下 `/files/*` 本身都是有意公开的：key 里有 128 位随机数，不能列举，也猜不到。`proxy` 分发时，响应带着和本地文件一样的加固头（内容类型取自 key 的扩展名、`X-Content-Type-Options: nosniff`、沙箱化的 `Content-Security-Policy`、不是图片视频音频的一律 `Content-Disposition: attachment`）。`redirect` 分发时，响应头是公开域名返回什么就是什么。见[安全](security.zh-CN.md#哪些是公开的)。

存储服务连不上时，`/files/<key>` 返回 `502`，不是 `404`：文件很可能是存在的。

### CDN 与自定义域名

CDN 有两种放法：

- **放在桶前面**（`redirect` 分发）：一个能读到桶的自定义域名或 CDN，把它的地址填进公开访问地址。它必须对应桶的根，也就是说 `<公开访问地址>/<路径前缀><key>` 就是那个对象。
- **放在应用前面**（`proxy` 分发，或本地磁盘）：给整个站点用的 CDN 或带缓存的反向代理。`/files/*` 的响应是不可变的，可以缓存一年；`/api/*` 的响应是 `no-store`。

每个已配置的公开访问地址的来源（origin）都会列进页面的 `Content-Security-Policy`（`img-src`、`media-src`、`connect-src`），并且跟着存储设置变，不用重启。

### 桶的权限

密钥需要在这个桶、这个路径前缀下有：

| 权限 | 用在哪 |
| --- | --- |
| 写入对象 | 上传、生成结果、缩略图。 |
| 读取对象 | 提供文件、读取参考素材、打包下载、生成签名地址。 |
| 删除对象 | 结果保留期清理、连接测试后的清理。 |
| 中止分片上传 | 流式上传（视频）失败时的清理。 |
| 列出桶 | 让「对象不存在」被报成「不存在」而不是「无权限」（AWS S3，见[它的配法](#aws-s3)）。应用从不真的去列对象。 |

不需要：创建或删除桶、修改桶的设置、对象 ACL（除非你填了 ACL 字段）。给桶配一条清理未完成分片上传的生命周期规则，是个稳妥的兜底。

## 切换存储时会发生什么

**文件不会被移动，也不会被复制。** 这个版本没有迁移工具。切换改变的是**新**文件存到哪。已有的文件留在原处，照常加载，因为存储层并不记录文件当初写到了哪里，而是按 key 去找。

遇到一个没见过的 key，应用先问本地磁盘（一次 `stat`），再问当前使用的桶，再问它知道的其他桶（各一次 `HEAD`），并把结果记在内存里。key 只写一次、从不移动，所以这个结果一直有效。

会被读取的后端：

| 后端 | 什么时候读 |
| --- | --- |
| 本地磁盘（`STORAGE_LOCAL_DIR`） | 始终。 |
| 设置页里保存的 S3 配置 | 始终，把存储方式改回本地磁盘之后也一样。 |
| 最多 5 个更早保存过的桶 | 保存一份指向别处（另一个 Endpoint、桶或路径前缀）的配置时，原来那个会自动记下来。「存储」标签页会列出它们。超过 5 个时最早的那个被丢掉。 |
| 环境变量里的 S3 配置 | 只要 `STORAGE_DRIVER=s3` 和那些 `S3_*` 变量还在。 |

所以：

- 本地磁盘 → S3：切换前上传的文件仍然从磁盘提供。**不要删除本地目录或数据卷。**
- S3 → 本地磁盘，或者一个桶 → 另一个桶：旧桶里的文件仍然从旧桶提供。只要还有画布在用这些文件，**就不要删桶、不要吊销它的密钥、不要去掉 `S3_*` 变量**。
- 同一个 Endpoint、桶和路径前缀，只改密钥、地域或寻址方式，不算切换；新值直接替换旧值。
- 缩略图写到它的原图所在的后端，与当前使用哪个后端无关。
- 结果保留期清理、打包下载、画布工具、「按地址抓取」、素材库都走同一套查找，文件在任何一个可读的后端上都能用。删除旧桶里的文件，需要那把旧密钥仍有删除权限。

旧的地方没了会怎样：指向这些文件的画布、资产和分享链接显示破图，用它们做参考素材的运行会失败。如果旧桶只是连不上，它的文件返回 `502`；哪里都不存在的文件，请求也会返回 `502`。

早期版本存下的地址：这次改动之前，S3 驱动存的是绝对地址 `<S3_PUBLIC_BASE_URL>/<key>`。含有这种地址的画布不会被改写。只要同一个公开访问地址还在某个已配置的后端里，服务端仍会把它认作自己的文件；浏览器则继续直接从那个域名加载，所以对这些画布来说，那个域名得一直保持公开。

### 自己复制文件

文件是靠「找」找到的，所以你自己复制过去的文件，在哪都能被找到。key 保持不变即可：

- 对象在桶里的名字是 `<路径前缀><key>`。
- 本地磁盘上，文件的 key 就是它相对 `STORAGE_LOCAL_DIR` 的路径（例如 `outputs/2026/10/9a…7e.png`）。

例如把本地磁盘复制到桶里（用 Docker 时，目录是 `app_data` 数据卷里的 `/app/data/files`）：

```bash
rclone copy /path/to/data/files remote:BUCKET/PREFIX
# 或者
mc mirror /path/to/data/files ALIAS/BUCKET/PREFIX
```

注意：

- 本地磁盘是先被问的。复制过去的文件，要等磁盘上没有了，才会从桶里提供。
- `thumbs/` 也一起复制，否则缩略图会在第一次被请求时重新生成。
- `redirect` 分发时，公开域名返回的是对象上保存的 `Content-Type`，请确认复制工具设对了它。`proxy` 分发时，类型取自 key 的扩展名。
- 把对象从一个桶挪到另一个桶之后，请重启服务端：文件在哪个桶里是记在内存里的，否则被挪走的文件会先失败一次，之后才重新查找。
- 这些命令只是示例，没有在本项目里实际跑过。

## 给上游模型的参考素材

节点把参考图或原视频交给模型时，上游得能读到这个文件。对桶里的文件，应用按下面的顺序给出地址：

1. 分发方式是 `redirect` 时，给它的公开地址（`<公开访问地址>/<路径前缀><key>`）。
2. 否则给一个**预签名的 GET 地址**，有效期 1 小时，按所填的 Endpoint 生成。
3. 再否则，设了 `PUBLIC_URL` 的话，给 `<PUBLIC_URL>/files/<key>`。

候选地址只有「看起来公网可达」才会用：`http(s)`，不是 `localhost`，不是内网 IP。一个都不满足时，图片以 base64 内联发给支持这种方式的接入；必须是地址的输入（原视频、部分视频模型的参考图）以 `media.needs_public_url` 失败。哪个接入用哪种形式，见[模型接入](providers.zh-CN.md#素材怎么送到上游)。

所以，只要桶的 Endpoint 在公网上（AWS S3、R2、用公网 Endpoint 的 OSS），不设 `PUBLIC_URL`、桶不公开，也能按地址把参考素材交给上游。

预签名地址只为那一次上游请求生成，不会存进画布、分享链接或运行记录。上游如果在错误信息里把它原样带了回来，其中 `X-Amz-*` 查询参数的值会在保存和显示之前被抹掉。

需要知道的限制：

- 「公网可达」只看地址本身，不做解析，也不去连。`localhost`、以 `.localhost`、`.local`、`.internal` 结尾的名字，以及字面上的内网 IP，算作不可达。其他内部主机名（比如 `minio`）能通过这个判断：上游拿到的是一个它加载不了的预签名地址，`PUBLIC_URL` 也不会再被尝试。如果 Endpoint 写的是内网 IP（`http://10.0.0.5:9000`），应用能看出来，会退回到 `PUBLIC_URL` 或内联图片。
- 预签名地址带着签名，拿到它的人在一小时内可以读取那一个对象。它会被发给你选的上游服务商。
- 本地磁盘上的文件不受影响：它们仍然需要 `PUBLIC_URL`。见[部署](deployment.zh-CN.md#public_url)。

## 备份

| 存储 | 备份什么 |
| --- | --- |
| 本地磁盘 | `STORAGE_LOCAL_DIR`（`app_data` 数据卷），和数据库一起备份。命令见[部署](deployment.zh-CN.md#备份)。 |
| S3 | 桶，用服务商的工具：版本控制、跨区域复制、生命周期规则。这些 LoomCanvas 都不做。 |
| 切换过之后 | 每一个还存着文件的地方：旧的和新的。 |

保存的存储配置（包括加密后的密钥和更早的桶）在 MongoDB 里。恢复数据库就能把它带回来，但要用同一个 `SECRET_KEY` 才能使用。

`SECRET_KEY` 变了，保存的 S3 密钥就解不开。这时服务端会在启动日志里说明，新文件按环境变量的配置写（没设 `STORAGE_DRIVER=s3` 就是本地磁盘），「存储」标签页会要求重新填写密钥。填之前，那个桶里的文件加载不出来。

## 环境变量一览

这些是初始默认值；「设置 → 存储」里保存的配置优先于它们。

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local` 或 `s3`。填 `oss` 会让服务端在启动时退出，并提示怎么迁移。 |
| `STORAGE_LOCAL_DIR` | `./data/files` | 本地磁盘后端的目录。相对路径以 `server/` 为基准。始终会用到，包括读取切换前存下的文件。 |
| `S3_ENDPOINT` | 空 | S3 接口的地址，不带路径。留空表示 AWS S3，由地域推出。 |
| `S3_REGION` | `us-east-1` | 地域。R2 填 `auto`。（早期版本的默认值是 `auto`。） |
| `S3_BUCKET` | 空 | 桶名。`s3` 必填。 |
| `S3_ACCESS_KEY_ID` | 空 | `s3` 必填。 |
| `S3_SECRET_ACCESS_KEY` | 空 | `s3` 必填。 |
| `S3_FORCE_PATH_STYLE` | 关 | 填 `1`、`true` 或 `yes` 开启路径风格（MinIO）。 |
| `S3_KEY_PREFIX` | 空 | 可选，桶里的一个目录。 |
| `S3_PUBLIC_BASE_URL` | 空 | 可选。对应桶的根的自定义域名、CDN 或 `r2.dev` 地址，末尾不带斜杠。（早期版本里是必填。） |
| `S3_DELIVERY` | 见含义 | `proxy` 或 `redirect`。默认值：设了 `S3_PUBLIC_BASE_URL` 时是 `redirect`，否则是 `proxy`。 |
| `S3_ACL` | 空 | 空、`private` 或 `public-read`。为空时不发 ACL 头。 |

## 从 STORAGE_DRIVER=oss 迁移

`oss` 驱动、`ali-oss` 这个包和所有 `OSS_*` 变量都已移除。`STORAGE_DRIVER=oss` 时，服务端在启动时退出，并用中英文提示应该改设什么。阿里云 OSS 现在通过它的 S3 兼容接口访问。

| 以前 | 现在 |
| --- | --- |
| `STORAGE_DRIVER=oss` | `STORAGE_DRIVER=s3` |
| `OSS_REGION=oss-cn-hangzhou` 或 `OSS_ENDPOINT=…` | `S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com` 和 `S3_REGION=oss-cn-hangzhou` |
| `OSS_BUCKET` | `S3_BUCKET` |
| `OSS_ACCESS_KEY_ID` | `S3_ACCESS_KEY_ID` |
| `OSS_ACCESS_KEY_SECRET` | `S3_SECRET_ACCESS_KEY` |
| `OSS_PUBLIC_BASE_URL` | `S3_PUBLIC_BASE_URL`（现在是可选的） |
| | 不设 `S3_FORCE_PATH_STYLE`（关） |
| `EXTRA_NPM_PACKAGES=ali-oss` 和 `npm install ali-oss` | 不需要了，删掉。 |

也可以把这些变量全部去掉，先用本地磁盘启动，再到「设置 → 存储」里填同样的值，那里有连接测试帮你核对。

如果有画布是在 `oss` 驱动下保存的，请让 `S3_PUBLIC_BASE_URL` 保持 `OSS_PUBLIC_BASE_URL` 原来的值：这些画布里存的是这个地址下的绝对地址（见[切换存储时会发生什么](#切换存储时会发生什么)）。对象本身不用挪。

原来的 `oss` 驱动从没对着真实的桶跑过，现在走 S3 接口访问 OSS 这条路也还没有。见[阿里云 OSS 的配法](#阿里云-oss)。

## 排查问题

连接测试会说什么，以及该怎么办。`code` 是接口里和这句话一起返回的标识。

| 提示 | `code` | 检查什么 |
| --- | --- | --- |
| 找不到主机 …，请检查 Endpoint | `storage.err_host_not_found` | Endpoint 写错了，或者这台服务器解析不了这个名字（在 Docker 网络之外用了服务名）。 |
| 找不到主机 …。没有打开「路径风格」时，存储桶名会成为主机名的一部分… | `storage.err_host_bucket_not_found` | **打开路径风格**（MinIO 等自建服务）。 |
| 连不上 … | `storage.err_unreachable` | Endpoint、端口、防火墙，或者服务没启动。超时也是这个提示。 |
| 与 … 的加密连接失败 | `storage.err_tls` | Endpoint 该用 `http://` 还是 `https://`；或者证书不被这台服务器信任（自签名）。 |
| 存储服务不认识这个 Access Key ID | `storage.err_access_key` | Access Key ID 写错了，或者这把密钥属于另一个账号或另一个 Endpoint。 |
| Secret Access Key 不对（签名不匹配） | `storage.err_signature` | 重新粘贴密钥。用阿里云 OSS 时，另见[它的配法](#阿里云-oss)里关于地域的说明。 |
| 这台服务器的时间与存储服务相差太多… | `storage.err_clock_skew` | 校准系统时间（NTP）。 |
| 这个 Endpoint 下没有名为「…」的存储桶 | `storage.err_no_bucket` | 桶名；Endpoint 是不是别的地域或别的账号的。应用不会创建桶。 |
| 地域「…」与存储桶不符 | `storage.err_region` | 填桶实际所在的地域。 |
| 这个服务不接受路径风格的请求 | `storage.err_path_style_refused` | **关闭路径风格**（阿里云 OSS）。 |
| 没有权限。这把密钥需要对存储桶「…」有读取、写入和删除对象的权限 | `storage.err_access_denied` | 密钥的策略；桶策略里有没有拒绝它；策略限定在某个目录时，路径前缀对不对。 |
| 这把密钥能读写对象，但不能列出存储桶… | `storage.err_list_permission` | 给它桶上的 `s3:ListBucket` 权限（见 [AWS 的配法](#aws-s3)）。 |
| … 有回应，但不像 S3 接口 | `storage.err_not_s3` | Endpoint 填成了控制台、网站，或者是反向代理的报错页，不是 S3 接口地址。 |
| 测试文件读回来的内容与写入的不一致 | `storage.err_read_back` | 服务端和桶之间有东西改动或缓存了响应。 |
| 文件已经存入，但打不开 … | `storage.err_public_unreachable` | 公开访问地址：主机名、端口、证书。或者把分发方式改成 `proxy`。 |
| 文件已经存入，但不带凭据访问 … 返回 HTTP … | `storage.err_public_status` | 桶或它的域名没有开公共读。开启它，或者把分发方式改成 `proxy`。 |
| 文件已经存入，但 … 返回的不是它 | `storage.err_public_mismatch` | 公开访问地址指向了另一个桶，或者不是这个桶的根（别忘了路径前缀会接在后面）。 |
| 存储服务拒绝了请求：… | `storage.err_other` | 其他情况；后面跟着存储服务自己的错误码和原话。 |

测试开始之前就被拒绝的（HTTP 400）：

| `code` | 含义 |
| --- | --- |
| `storage.endpoint_has_path` | Endpoint 带了路径。只填 `http(s)://主机[:端口]`。 |
| `storage.endpoint_has_bucket` | Endpoint 以桶名开头。这里填服务的地址，桶名填在它自己的那一栏。 |
| `storage.bad_bucket` | 桶名不合法。 |
| `storage.bad_key_prefix` | 路径前缀里有字母、数字、`_`、`-`、`.`、`/` 之外的字符。 |
| `storage.redirect_needs_public_url` | 选了 `redirect` 分发，但没有填公开访问地址。 |

其他现象：

| 现象 | 原因 |
| --- | --- |
| 文件返回 `502` | 某个已配置的存储服务（当前使用的、保存着的或更早的）连不上，或者不认这把密钥。服务端日志里有一行 `[files]`，带着错误的名字。 |
| 切换之后，旧画布里的图片成了破图 | 旧的后端没了：本地目录被删了、旧桶被删了或密钥被吊销了，或者 `S3_*` 变量被去掉了。 |
| 「存储」标签页要求重新填写密钥 | `SECRET_KEY` 变了，见[备份](#备份)。 |
| 服务端启动时退出，提示 `STORAGE_DRIVER=s3 requires …` 或 `The S3_* storage settings are not valid` | 某个必填变量为空，或者某个值不合法。这只针对环境变量；设置页里保存的配置在启动时不做检查。 |
| 用着 S3 存储，却提示「…需要公网可访问的地址…」 | 桶的地址和 `PUBLIC_URL` 看起来都不是公网地址，见[给上游模型的参考素材](#给上游模型的参考素材)。 |

## 测试情况

S3 这条代码路径是对着 **MinIO** 验证的，它是一个真实的 S3 接口。`server/test/storage.live.test.js` 里的自动化测试覆盖：路径风格和虚拟主机风格两种寻址、私有桶配本站转发和预签名地址、公开桶配重定向分发、分片上传、Range 和 ETag 的处理、缩略图、后端之间的切换、设置接口。设置了 `TEST_S3_ENDPOINT` 等变量时才运行，否则报告为跳过；见[开发](development.zh-CN.md#对着真实的-s3-测试)。

**Cloudflare R2、阿里云 OSS 和 AWS S3 没有对着真实服务跑过。** 上面的配法依据的是各家公开的 S3 兼容文档。请把它们当作「S3 兼容、按上述方式配置、未经验证」，并欢迎反馈结果，不管能用还是不能用。

本页里的复制命令（`rclone`、`mc mirror`）以及 IAM、RAM 策略，同样没有在本项目里实际跑过。
