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

`S3_*` 变量描述的那个桶还会一直被**读取**，不管 `STORAGE_DRIVER` 是什么，也不管设置页里保存了什么：曾经把文件存在那里、后来改回本地磁盘的实例，文件不会丢。前提是 `S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` 三个都填了；缺一个就不算描述了一个桶。三个都填了但某个值不合法、而 `STORAGE_DRIVER` 又不是 `s3` 时，服务端照常启动，在日志里说明（`[storage] the S3_* variables are set but not used: …`），不读这个桶。想让它不再被读取，去掉这些变量即可。

### 优先级

1. **设置页里保存的配置**（数据库 `settings` 集合里的一条记录，键为 `storage`）。
2. 没有的话，用**环境变量**（`STORAGE_DRIVER`、`S3_*`）。
3. 再没有，用**本地磁盘**。

「设置 → 存储」会显示当前的选择来自哪里：「在此保存的配置」「来自环境变量」或「默认」。只要在页面上保存过（包括保存成「本地磁盘」），新文件存到哪就不再由环境变量决定。表单的初始值取自已保存的 S3 配置；从没保存过时，取自环境变量。

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
| Secret Access Key（`secretAccessKey`） | 只写。保存前用 `SECRET_KEY` 加密（AES-256-GCM，和服务商的 API Key 一样），之后不再返回；页面上只显示「已设置」和末四位。留空表示沿用已保存的那个。 |
| 路径风格（`forcePathStyle`） | 开：`https://主机/桶/key`。关：`https://桶.主机/key`。MinIO 和多数自建服务要开；AWS S3、R2、OSS 要关。 |
| 路径前缀（`keyPrefix`） | 可选，桶里的一个目录，例如 `loomcanvas` 或 `apps/canvas`。只能用字母、数字、`_`、`-`、`.`，目录之间用 `/`。每个对象存成 `<前缀>/<key>`。 |
| 公开访问地址（`publicBaseUrl`） | 可选。任何人都能通过它读到桶里文件的 `http(s)` 地址：自定义域名、CDN、`r2.dev` 地址。它必须对应**桶的根**，路径前缀会接在它后面。可以带路径（`http://minio.example.com:9000/my-bucket`）。 |
| 签名地址用的 Endpoint（`presignEndpoint`） | 可选。同一个 S3 服务**在公网上**的地址：`http(s)://主机[:端口]`，不带路径。上面的 Endpoint 只在你的内网里能用时（`http://minio:9000`）才需要它。它只有一个用途：交给上游模型的签名地址按它生成。应用自己仍然走 Endpoint，从不去连这个地址。架在这个地址上的反向代理必须把 `Host` 头原样传下去，因为签名里包含主机名。在「设置 → 存储」表单的「访问与分发」一组里填写，或者用 `S3_PRESIGN_ENDPOINT`、[接口](api.md#storage)设置。见[给上游模型的参考素材](#给上游模型的参考素材)。 |
| 文件分发方式（`delivery`） | `proxy`（「由本站转发」）：应用自己把文件内容发给浏览器。`redirect`（「跳转到公开地址」）：`/files/<key>` 把浏览器重定向到公开访问地址。默认值：填了公开访问地址时是 `redirect`，否则是 `proxy`。`redirect` 必须有公开访问地址。见[下文](#两种分发方式)。 |
| 对象 ACL（`acl`） | 空（「不设置」，默认）、`private` 或 `public-read`。为空时完全不发 ACL 头。除非你的服务要靠对象级 ACL 才能让对象公开，否则留空：R2 没有对象 ACL，AWS 的桶默认禁用 ACL。 |

不管哪一家，驱动总是这样做：

- 写入对象时带上它的 `Content-Type` 和 `Cache-Control: public, max-age=31536000, immutable`。key 不会重复使用。
- 只在接口要求时才发送校验和（`requestChecksumCalculation` 和 `responseChecksumValidation` 都是 `WHEN_REQUIRED`）。新版 AWS SDK 默认会给每次上传加 CRC32 的 `x-amz-checksum-*` 头，有几家兼容服务不接受。
- 内存里的数据用一次 `PutObject` 写入。长度未知的流（生成的视频）用分片上传，来源出错时会中止这次上传。

## 连接测试

「设置 → 存储」里的「测试连接」（以及 `POST /api/admin/storage/test`）用表单里的值真实地走一遍，这时什么都还没保存：

| 步骤 | 做什么 |
| --- | --- |
| `put` | 在 `probe/` 下（路径前缀之内）写入一个很小的文本对象。 |
| `head` | 查它的大小。然后再查一个不存在的 key：存储服务应该回答「不存在」。没有列出桶权限的密钥得到的会是「无权限」，测试会指出这一点。 |
| `get` | 把对象读回来，逐字节比对。 |
| `public` | 只在 `redirect` 分发时有：不带凭据从公开访问地址加载这个对象并比对。 |
| `delete` | 删除这个对象。只要写入过，这一步就会执行，中间失败了也一样。 |

结果里每一步是 `ok`、`failed` 或 `skipped`，外加一句话说明该改什么。这些话的含义见[排查问题](#排查问题)。测试不会久等：连接 6 秒，每个请求 12 秒，不重试。这两个都是硬上限：一个接受了连接却一声不吭的服务，只会让它被问到的那一步失败，不会把测试挂住。

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

关于参考素材：`http://minio:9000` 这样的 Endpoint 只在 Docker 网络里能用，公网上的上游模型没法从它下载。应用不会把这个地址交出去，也不会交出按它生成的签名地址。参考图这时以内联的方式发给支持内联的模型；必须是地址的输入（原视频、部分模型的参考图）在 `PUBLIC_URL` 是你的公网地址时经由 `PUBLIC_URL` 交给上游，不是的话在运行开始之前就被拒绝。

如果想让上游直接从 MinIO 取文件，就用反向代理把 MinIO 的 S3 端口以一个公网域名发布出去，再把这个域名设为签名地址用的 Endpoint：在「设置 → 存储 → 访问与分发」里填「签名地址用的 Endpoint」，或者 `S3_PRESIGN_ENDPOINT=https://s3.example.com`，或者通过接口设置 `presignEndpoint`。代理必须保留 `Host` 头，否则所有签名地址都会返回 `SignatureDoesNotMatch`。nginx 的写法：

```nginx
location / {
  proxy_set_header Host $http_host;
  proxy_pass http://minio:9000;
}
```

见[给上游模型的参考素材](#给上游模型的参考素材)。

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

哪个存储里都没有的文件返回 `404`。可能在某个现在问不到的存储里的文件返回 `503`，带 `Retry-After: 30`、`Cache-Control: no-store` 和一段 JSON（`code` 为 `storage.unreachable`）：文件很可能是存在的，这次失败不应该被任何地方记住。见[存储连不上的时候](#存储连不上的时候)。

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

遇到一个没见过的 key，应用先问本地磁盘（一次 `stat`），再问当前使用的桶（一次 `HEAD`）。两处都没有，才去问它知道的其他桶，而且是同时问。结果记在内存里。key 只写一次、从不移动，所以这个结果一直有效。也就是说，本地磁盘上和当前使用的桶里的文件，不需要联系任何别的桶就能找到。

会被读取的后端：

| 后端 | 什么时候读 |
| --- | --- |
| 本地磁盘（`STORAGE_LOCAL_DIR`） | 始终。 |
| 设置页里保存的 S3 配置 | 始终，把存储方式改回本地磁盘之后也一样。 |
| 最多 5 个更早保存过的桶 | 保存一份指向别处（另一个 Endpoint、桶或路径前缀）的配置时，原来那个会自动记下来。「设置 → 存储」会列出它们。超过 5 个时最早的那个被丢掉。已经彻底没了的桶可以[从列表里去掉](#存储连不上的时候)。 |
| `S3_*` 变量描述的桶 | 只要 `S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY` 都还在，不管 `STORAGE_DRIVER` 是什么。它和某个已保存的桶是同一个地方（Endpoint、桶、路径前缀都相同）时，算一个桶，只问一次。 |

所以：

- 本地磁盘 → S3：切换前上传的文件仍然从磁盘提供。**不要删除本地目录或数据卷。**
- S3 → 本地磁盘，或者一个桶 → 另一个桶：旧桶里的文件仍然从旧桶提供。只要还有画布在用这些文件，**就不要删桶、不要吊销它的密钥、不要去掉 `S3_*` 变量**。
- 同一个 Endpoint、桶和路径前缀，只改密钥、地域或寻址方式，不算切换；新值直接替换旧值。
- 缩略图写到它的原图所在的后端，与当前使用哪个后端无关。
- 结果保留期清理、打包下载、画布工具、「按地址抓取」、素材库都走同一套查找，文件在任何一个可读的后端上都能用。删除旧桶里的文件，需要那把旧密钥仍有删除权限。

旧的地方没了会怎样：指向这些文件的画布、资产和分享链接显示破图，用它们做参考素材的运行会失败，并说明是存储连不上。

### 存储连不上的时候

只读不写的桶（更早的桶、改回本地磁盘后保存着的那个桶、`S3_*` 变量描述的桶）可能连不上，也可能已经没了。这不会妨碍存在别处的东西：

- 本地磁盘上和当前使用的桶里的文件最先被找到，所以它们照常加载，速度不变，缩略图也一样。
- 两处都没有的文件，才会同时去问其他的桶，每个桶有 3 秒钟回答「有没有」。
- 没有回应的桶（连接被拒、找不到主机、超时、TLS 失败）会被记为「连不上」，持续 30 秒。这段时间里完全不去连它。时间到了放一个请求过去探一下。服务端日志里，一个桶连不上时有一行 `[storage]`，之后每个周期一行，恢复时一行；不会每个请求一行。
- 有回应但拒绝了请求的桶（密钥被吊销）每次都会再问：它回得很快。

请求一个文件会得到什么：

| 这个文件 | 返回 |
| --- | --- |
| 在本地磁盘上，或者在某个有回应的桶里 | 文件本身。 |
| 哪里都没找到，而且每个存储都回答了 | `404`。 |
| 哪里都没找到，而某个可能存着它的存储没问到 | `503`，`code: storage.unreachable`，带 `Retry-After: 30` 和 `Cache-Control: no-store`。提示里不出现主机和桶名，因为文件地址是公开的；具体是哪个存储，看服务端日志和「设置 → 存储」。 |

缩略图遵守同样的规则。缩略图和原图存在一起，所以还没生成的缩略图只要原图读得到就照常生成，不受其他桶的状态影响。原图本身可能在连不上的存储里时，缩略图同样返回 `503`；这个回答不会被缓存。缩略图存不下来时会跳转到原图，这个跳转也不会被缓存。

通过接口读取已存文件的地方（按地址抓取、画布工具、打包下载）得到的是同一个 `503 storage.unreachable`。运行要用的参考图或视频因此读不到时，在向上游发出任何请求之前就以这句提示失败。

如果连不上的是**当前使用的桶**：上传和生成结果以 `503 storage.write_failed` 失败，本地磁盘上的文件照常加载，第一次成功的上传会把这个桶重新标记为可用。

**删除账号或团队**时，它在各个存储里的文件是同时删除的。请求最多等 4 秒。需要更久的桶在后台继续删，连不上的桶每 10 分钟重试一次。还没删完的部分记在数据库里（`settings` 集合里键为 `storageCleanup` 的一条），重启后不会丢。30 天仍然不成功，服务端会在日志里写明需要手动删除哪些 key 前缀，然后不再重试。接口返回的 `filesRemoved: false` 表示「还没有全部删完」。

**结果保留期清理**也一样：文件可能在连不上的存储里的结果，不会被记成「已清理」，每次清理都会再试，最多 30 天。

「设置 → 存储」最上面的「当前状态」卡片里，「读取文件的存储」列出会去查找文件的每一个地方和它的状态：「正常」「连不上（自某时起）」或「密钥读不出」（[接口](api.md#storage)里的 `buckets`：`ok`、`unreachable`、`secret_unreadable`）。有存储连不上时，这张卡片每 10 秒自己刷新一次，也可以点「刷新」。每次刷新都会去问各个桶（`GET /api/admin/storage?probe=1`）：恢复了的桶显示为恢复，不再回应的桶显示为连不上，不用等有人去请求它里面的文件。不管有几个桶不回应，最多等 4 秒。只要列表里还有一个连不上的桶，哪里都找不到的文件就会返回 `503` 而不是 `404`，因为它可能在那个桶里。所以已经彻底没了的桶应该从列表里去掉：点那一行的「不再读取」并确认（接口是 `DELETE /api/admin/storage/buckets/:id`）。去掉之后它的文件不再加载；桶里的东西不会被删除。`S3_*` 变量描述的桶，去掉这些变量就不再读取。

早期版本存下的地址：这次改动之前，S3 驱动存的是绝对地址 `<S3_PUBLIC_BASE_URL>/<key>`。含有这种地址的画布不会被改写。只要同一个公开访问地址还在某个已配置的后端里，服务端仍会把它认作自己的文件；浏览器则继续直接从那个域名加载，所以对这些画布来说，那个域名得一直保持公开。

### 自己复制文件

文件是靠「找」找到的，所以你自己复制过去的文件，在哪都能被找到。key 保持不变即可：

- 对象在桶里的名字是 `<路径前缀><key>`。
- 本地磁盘上，文件的 key 就是它相对 `STORAGE_LOCAL_DIR` 的路径（例如 `outputs/<账号 id>/2026/10/9a…7e.png`；有账号功能之前存下的文件没有账号这一段，它们的 key 照常有效）。

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

节点把参考图或原视频交给模型时，上游得能读到这个文件。应用按下面的顺序，给出第一个公网上的上游打得开的地址：

1. 文件在 `redirect` 分发的桶里：它的公开地址（`<公开访问地址>/<路径前缀><key>`）。
2. 文件在桶里：一个**预签名的 GET 地址**，有效期 1 小时。设了签名地址用的 Endpoint（`presignEndpoint`、`S3_PRESIGN_ENDPOINT`）就按它生成，否则按 Endpoint 生成。
3. 任何文件：`<PUBLIC_URL>/files/<key>`，由应用自己应答。

一个都不满足时，图片以 base64 内联发给支持这种方式的服务商；必须是地址的输入（高瑞图片模型的参考图、原视频、交给对话模型分析的视频、部分视频模型的参考图）在发出任何请求之前就以 `media.needs_public_url` 被拒绝。哪家服务商用哪种形式，见[服务商](providers.zh-CN.md#素材怎么送到上游)。

### 什么算公网可达

只有一条规则，`PUBLIC_URL`、公开访问地址、签名地址所用的 Endpoint 都按它判断。只看地址本身，不解析，也不去连。下面这些不算公网可达：

- 不是 `http(s)` 的地址，以及带着用户名或密码的地址；
- `localhost`，以及其他只有一段的主机名，比如 `minio`、`storage`：容器名、机器名只在它自己的网络里能解析；
- 字面上的回环、内网、链路本地和其他保留 IP（`127.0.0.1`、`10.x`、`172.16`～`172.31`、`192.168.x`、`169.254.x`、`fc00::/7` 等）；
- 以 `.localhost`、`.local`、`.internal`、`.test`、`.home.arpa`、`.lan`、`.home`、`.corp`、`.intranet`、`.private`、`.svc` 结尾的名字。

对签名地址，判断的是 Endpoint，不是签出来的地址：虚拟主机风格下，地址里的主机是 `<桶名>.<Endpoint 主机>`，不这样的话 `my-bucket.minio` 会被当成一个域名。

`SSRF_ALLOW_HOSTS` 不影响这个判断。它列的是服务端可以去下载的主机；服务端连得上自己网络里的某台机器，不等于上游也连得上。

所以：

- **公网上的桶**（AWS S3、R2、用公网 Endpoint 的 OSS）：不设 `PUBLIC_URL`、桶不公开，也能按地址把参考素材交给上游。
- **内网里的桶**（同一个 Compose 文件里的 MinIO、OSS 的内网 Endpoint、内网 IP）：它的地址绝不会交给上游。要么把 `PUBLIC_URL` 设为你的公网地址，文件经由应用交给上游；要么把 S3 接口以一个公网域名发布出去，并设置签名地址用的 Endpoint。前面的反向代理必须保留 `Host` 头（见 [MinIO 的配法](#minio)）。这一点对着 MinIO 测过：按公网域名签出来的地址，经过保留 `Host` 的代理能加载；经过改写 `Host` 的代理返回 `403 SignatureDoesNotMatch`。
- **规则认不出来的内部名字**（两段的 Kubernetes 名字，比如 `minio.storage`）：设置签名地址用的 Endpoint。设了它，就以它为准，不管 Endpoint 长什么样。

只收地址的模型拿不到文件时，画布会在运行之前说明（`GET /api/bootstrap` 里的 `media.upstreamByUrl`）。「设置 → 存储」的「当前状态」卡片里，「交给上游模型」一行说明现在存下的文件走哪一种：「公开地址」「临时签名地址」「经本站地址」或「内联发送」（`GET /api/admin/storage` 里的 `upstream`：`public_base`、`signed`、`app`、`inline`）。是「内联发送」时，那里会列出哪些节点受影响、该配什么。

预签名地址只为那一次上游请求生成，不会存进画布、分享链接或运行记录。上游如果在错误信息里把它原样带了回来，其中 `X-Amz-*` 查询参数的值会在保存和显示之前被抹掉。

需要知道的限制：

- 预签名地址带着签名，拿到它的人在一小时内可以读取那一个对象。它会被发给你选的上游服务商。
- 本地磁盘上的文件只能经由 `PUBLIC_URL`。见[部署](deployment.zh-CN.md#public_url)。

## 备份

| 存储 | 备份什么 |
| --- | --- |
| 本地磁盘 | `STORAGE_LOCAL_DIR`（`app_data` 数据卷），和数据库一起备份。命令见[部署](deployment.zh-CN.md#备份)。 |
| S3 | 桶，用服务商的工具：版本控制、跨区域复制、生命周期规则。这些 LoomCanvas 都不做。 |
| 切换过之后 | 每一个还存着文件的地方：旧的和新的。 |

保存的存储配置（包括加密后的密钥和更早的桶）在 MongoDB 里。恢复数据库就能把它带回来，但要用同一个 `SECRET_KEY` 才能使用。

`SECRET_KEY` 变了，保存的 S3 密钥就解不开。服务端照常启动，并在日志里说明。这个桶仍然是配置好的存储，只是用不了：

- 桶里的文件返回 `503`（`storage.unreachable`）。本地磁盘上的文件照常加载。
- 「设置 → 存储」会提示重新填写密钥，「重新填写密钥」那颗按钮直接把焦点送到 Secret Access Key 一栏（接口里是 `secretUnreadable: true`）。
- 如果它正是当前使用的桶，新文件会被拒绝，返回 `503 storage.secret_unreadable`（接口里是 `writable: false`）：上传当场被拒；图片和视频的运行在向上游发出任何请求之前被拒。每个登录的人都会在动手之前知道（`GET /api/bootstrap` 里的 `media.writable: false`）：画布上的图片、视频节点在运行前就写明。设置页的「交给上游模型」这时显示「现在交不了」（`upstream: unavailable`）：要修的是密钥，不是地址。

这时**不会**把新文件改写到本地磁盘或环境变量里的桶。那样会把文件散落到一块可能既没人保留、也没人备份、其他实例也看不到的磁盘上。况且 `SECRET_KEY` 变了之后，所有服务商的 Key 同样解不开，在管理员处理之前本来也什么都生成不了。

解决办法：把原来的 `SECRET_KEY` 改回去；或者到「设置 → 存储」重新填写密钥（服务商的 Key 到「模型管理」页重新填写：Key 解不开的服务商，卡片上状态是「Key 读不出」，有一颗「重新填入 Key」；接口里是 `keyUnreadable`，运行以 `provider.key_undecryptable` 被拒绝。团队成员看到的只是「暂不可用，请联系团长或管理员」）。两种特殊情况：

- 同一个桶（Endpoint、桶、路径前缀都相同）同时也写在 `S3_*` 变量里：直接用环境变量里的密钥，一切照常。页面仍会提示重新填写密钥。
- 在设置页切回本地磁盘不需要密钥。之后新文件可以正常存储；那个桶里原有的文件在填回密钥之前仍然不可用。

密钥解不开的更早的桶会留在列表里，状态是不可用。不再需要的话，把它们[从列表里去掉](#存储连不上的时候)。

## 环境变量一览

这些是初始默认值；「设置 → 存储」里保存的配置优先于它们。它们描述的桶无论如何都会被读取（见[环境变量](#环境变量)）。

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
| `S3_PRESIGN_ENDPOINT` | 空 | 可选。`S3_ENDPOINT` 只在内网里能用时，这个 S3 服务在公网上的地址，不带路径。交给上游模型的签名地址按它生成；架在这个地址上的反向代理必须保留 `Host` 头。 |
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
| `storage.bucket_in_use` | 要从列表里去掉的正是新文件在写的那个桶。先切换存储。 |
| `storage.bucket_from_env` | 要从列表里去掉的桶来自 `S3_*` 变量。去掉这些变量并重启。 |

表单里某一栏不合法时，`data.field` 指出是哪一栏（`endpoint`、`publicBaseUrl`、`presignEndpoint`、`bucket`……），提示里用的是页面上的叫法。设置页把它显示在那一栏下面。

运行过程中（HTTP 503；`storage.bucket_not_found` 是 404）：

| `code` | 含义 |
| --- | --- |
| `storage.unreachable` | 一个可能存在的文件没法查找或读取：可能存着它的某个存储没有回应、不认这把密钥，或者保存的密钥解不开。见[存储连不上的时候](#存储连不上的时候)。 |
| `storage.write_failed` | 文件没存下来：当前使用的存储连不上，或者拒绝了这次写入（也可能是本地磁盘满了、只读）。原因在服务端日志里。 |
| `storage.secret_unreadable` | 当前使用的桶，保存的密钥解不开，所以新文件被拒绝。见[备份](#备份)。 |
| `storage.bucket_not_found` | 列表里没有这个 id 的桶。 |

其他现象：

| 现象 | 原因 |
| --- | --- |
| 文件返回 `503` | 某个可能存着它的存储（当前使用的、保存着的、更早的，或 `S3_*` 变量描述的）连不上、不认这把密钥，或者保存的密钥解不开。服务端日志里有一行 `[storage]` 指明是哪个，「设置 → 存储」也会显示它的状态。 |
| 本该是 `404` 的文件返回 `503` | 列表里有一个桶连不上，而这个文件可能在它里面。如果那个桶已经彻底没了，把它[从列表里去掉](#存储连不上的时候)。 |
| 上传失败，提示「文件没有存下来」 | 当前使用的存储连不上，或者拒绝写入；看日志里的 `[storage]` 那一行。 |
| 切换之后，旧画布里的图片成了破图 | 旧的后端没了：本地目录被删了、旧桶被删了或密钥被吊销了，或者 `S3_*` 变量被去掉了。 |
| 「设置 → 存储」要求重新填写密钥，上传返回 `503` | `SECRET_KEY` 变了，见[备份](#备份)。 |
| 服务端启动时退出，提示 `STORAGE_DRIVER=s3 requires …` 或 `The S3_* storage settings are not valid` | 某个必填变量为空，或者某个值不合法。这只针对环境变量；设置页里保存的配置在启动时不做检查。 |
| 用着 S3 存储，却提示「…需要公网可访问的地址…」 | 桶的 Endpoint 在内网里（`http://minio:9000`、内网 IP），`PUBLIC_URL` 也不是公网地址。设置 `PUBLIC_URL`，或者设置签名地址用的 Endpoint；见[给上游模型的参考素材](#给上游模型的参考素材)。 |

## 测试情况

S3 这条代码路径是对着 **MinIO** 验证的，它是一个真实的 S3 接口。`server/test/storage.live.test.js` 里的自动化测试覆盖：路径风格和虚拟主机风格两种寻址、私有桶配本站转发和预签名地址、公开桶配重定向分发、分片上传、Range 和 ETag 的处理、缩略图、后端之间的切换、设置接口。另外还覆盖：按另一个主机名生成的签名地址（经过保留 `Host` 头的反向代理，以及不保留的），和一个永远不回应的更早的桶。设置了 `TEST_S3_ENDPOINT` 等变量时才运行，否则报告为跳过；见[开发](development.zh-CN.md#对着真实的-s3-测试)。

存储出问题时的行为不依赖任何存储服务就能测，在 `server/test/storageResilience.test.js` 和 `server/test/storage.e2e.test.js` 里：S3 SDK 通过真实的套接字去连一个内存里的 S3 接口、一个拒绝连接的端口，和一个接受连接却从不回应的服务。覆盖上面的查找规则、`404` 与 `503` 的区分、缩略图、删除账号、`SECRET_KEY` 变更、`S3_*` 变量描述的桶，以及桶的地址在内网时交给上游的是什么。

**Cloudflare R2、阿里云 OSS 和 AWS S3 没有对着真实服务跑过。** 上面的配法依据的是各家公开的 S3 兼容文档。请把它们当作「S3 兼容、按上述方式配置、未经验证」，并欢迎反馈结果，不管能用还是不能用。

本页里的复制命令（`rclone`、`mc mirror`）以及 IAM、RAM 策略，同样没有在本项目里实际跑过。
