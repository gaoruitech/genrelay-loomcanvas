# 部署

[English](deployment.md)

正式运行 LoomCanvas 需要知道的事：Docker Compose、不用 Docker 运行、反向代理与 HTTPS、备份和升级。

LoomCanvas 是一个 Node.js 进程加一个 MongoDB。任务队列、登录限流和设置缓存都在这个进程里，所以**一个数据库只跑一个实例**，不要在负载均衡后面放多个副本。

## Docker Compose

仓库自带 `docker-compose.yml`，包含两个服务：

| 服务 | 镜像 | 数据 |
| --- | --- | --- |
| `mongodb` | `mongo:7.0` | 数据卷 `mongo_data`（`/data/db`） |
| `app` | 由 `Dockerfile` 构建（`node:20-alpine`，服务端加构建好的前端） | 数据卷 `app_data`（`/app/data`，上传和生成的文件） |

MongoDB 不对宿主机开放端口，也没有开启认证，只有 `app` 容器能通过 Compose 网络访问它。

```bash
cp .env.example .env     # 设置 SECRET_KEY，按需设置 ACCESS_PASSWORD
docker compose up -d
```

关于镜像：

- 进程以非特权用户 `node` 运行。`/app` 里的代码归 root 所有，进程只能读；只有 `/app/data` 可写，并且声明成了数据卷。
- 镜像里已经设好 `PORT=3000`、`WEB_DIST=/app/web-dist` 和 `STORAGE_LOCAL_DIR=/app/data/files`，所以直接 `docker run`（带上 `SECRET_KEY` 和 `MONGODB_URI`）也能提供前端页面。健康检查跟着 `PORT` 走。
- `LICENSE` 和 `THIRD_PARTY_NOTICES.md` 在 `/app` 下。

### 从 `.env` 读取的变量

Compose 读取 `docker-compose.yml` 同目录下的 `.env`，并把下面这些传进容器：

| 变量 | Compose 里的默认值 | 含义 |
| --- | --- | --- |
| `SECRET_KEY` | 无，必填 | 不填 Compose 拒绝启动。至少 16 位。 |
| `PUBLIC_URL` | 空 | 可选。实例的公网地址，上游模型靠它按地址读取参考素材。见 [PUBLIC_URL](#public_url)。 |
| `ACCESS_PASSWORD` | 空 | 共用的访问口令。留空表示不需要登录。 |
| `PORT` | `3000` | 映射到宿主机的端口。容器内服务端固定监听 3000。 |
| `MAX_UPLOAD_MB` | `50` | 单个上传文件的上限。 |
| `STORAGE_DRIVER` | `local` | `local`、`s3` 或 `oss`。 |
| `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_FORCE_PATH_STYLE`、`S3_PUBLIC_BASE_URL` | 空 | S3 兼容存储。 |
| `OSS_REGION`、`OSS_ENDPOINT`、`OSS_BUCKET`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_PUBLIC_BASE_URL` | 空 | 阿里云 OSS。 |
| `EXTRA_NPM_PACKAGES` | 空 | 构建参数，不是运行时变量：额外装进镜像的 npm 包，例如 `ali-oss`。执行 `docker compose build` 后生效。 |
| `TRUST_PROXY` | 空 | 前面反向代理的层数，或代理的地址。 |
| `CORS_ORIGIN` | 空 | 额外允许跨域调用接口的来源。 |
| `SSRF_ALLOW_HOSTS` | 空 | 不受内网地址下载拦截限制的主机。 |
| `BILLING_HOOK` | 空 | 计费钩子模块在容器内的路径。 |

下面几个由 Compose 文件写死：`MONGODB_URI=mongodb://mongodb:27017/loomcanvas`、`STORAGE_LOCAL_DIR=/app/data/files`、`WEB_DIST=/app/web-dist`。

全部变量及其默认值、取值范围见[配置](configuration.zh-CN.md#环境变量)。

### 在 Docker 里使用计费钩子

`BILLING_HOOK` 会从 `.env` 传进容器，但钩子文件本身也得放进容器。请在 Compose 文件同目录新建 `docker-compose.override.yml` 挂载它（Compose 会自动合并这个文件），并在 `.env` 里设置 `BILLING_HOOK=/app/hooks/billing.js`：

```yaml
services:
  app:
    volumes:
      - ./hooks:/app/hooks:ro
```

见[计费钩子](billing-hook.zh-CN.md)。

### 在 Docker 镜像里使用对象存储

S3 的 SDK（`@aws-sdk/client-s3`、`@aws-sdk/lib-storage`）已经在镜像里，`STORAGE_DRIVER=s3` 不需要额外安装。

OSS 的 SDK（`ali-oss`）镜像里**没有**装。直接设 `STORAGE_DRIVER=oss`，容器会在启动时退出，并提示缺哪个包。要加上它，在 `.env` 里设置下面这一项，然后重新构建：

```ini
EXTRA_NPM_PACKAGES=ali-oss
```

```bash
docker compose build
docker compose up -d
```

S3 和 OSS 两个驱动的代码已经写好，但在本项目里还没有对着真实的桶跑过，请当作未经验证来对待。见[配置](configuration.zh-CN.md#存储驱动)。

## 不用 Docker 运行

需要 Node.js 20.9 以上和 MongoDB 7。

1. 构建前端：

   ```bash
   cd web
   npm ci
   npm run build
   ```

2. 安装服务端并准备配置：

   ```bash
   cd ../server
   npm ci --omit=dev
   cp .env.example .env
   ```

3. 编辑 `server/.env`，至少要有：

   ```ini
   SECRET_KEY=<一串足够长的随机字符>
   MONGODB_URI=mongodb://127.0.0.1:27017/loomcanvas
   WEB_DIST=../web/dist
   ```

   设了 `WEB_DIST`，服务端会同时提供构建好的前端（前端路由回退到 `index.html`）。相对路径以 `server/` 目录为基准。如果设了 `WEB_DIST` 但目录里没有 `index.html`，服务端拒绝启动。

4. 启动：

   ```bash
   npm start
   ```

不用 Docker 时，服务端读的是 `server/.env`，不是仓库根目录的 `.env`。请用进程管理器（systemd、pm2）托管，并确保停止时发送 `SIGTERM`，这样服务端才能正常收尾（见[升级](#升级)）。

## 反向代理与 HTTPS

只要实例能被本机以外的人访问，就应该走 HTTPS：访问口令和登录凭证都在请求里传输。

代理需要注意的几点：

| 事项 | 怎么设 |
| --- | --- |
| 上传大小 | 请求体上限要比 `MAX_UPLOAD_MB` 略大一点（multipart 有额外开销）。保存画布是 JSON，最大 6 MB。 |
| 长请求 | 上传、打包下载和代理下载可能持续几分钟。服务端单个请求最长允许 15 分钟，代理至少给 10 分钟。运行本身是用短请求轮询的，不需要 WebSocket 或 SSE。 |
| 客户端地址 | 设置 `TRUST_PROXY=1`（前面有一层代理），登录限流才能看到真实的客户端地址，而不是代理的地址。 |
| `PUBLIC_URL` | 需要上游模型按地址读取参考素材时，设成对外的 HTTPS 地址。 |
| HSTS | 应用不发送 `Strict-Transport-Security`，请在终结 TLS 的代理上加。 |

如果代理和容器在同一台机器上，不要让映射出来的端口对外开放：把 `docker-compose.yml` 里的 `ports` 改成 `"127.0.0.1:${PORT:-3000}:3000"`，或者用防火墙挡住。

### nginx

```nginx
server {
    listen 443 ssl;
    server_name canvas.example.com;

    ssl_certificate     /etc/letsencrypt/live/canvas.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/canvas.example.com/privkey.pem;

    # 比 MAX_UPLOAD_MB（默认 50）略大
    client_max_body_size 60m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 900s;
        proxy_send_timeout 900s;
        # 上传和下载直接透传，不先落到代理的磁盘上
        proxy_request_buffering off;
        proxy_buffering off;
    }
}

server {
    listen 80;
    server_name canvas.example.com;
    return 301 https://$host$request_uri;
}
```

### Caddy

```caddyfile
canvas.example.com {
    request_body {
        max_size 60MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

Caddy 会自己申请证书，并自动带上 `X-Forwarded-For`。

## PUBLIC_URL

`PUBLIC_URL` 是浏览器和上游接口看到的实例地址，末尾不带斜杠，例如 `https://canvas.example.com`。

它是可选的。本机或内网使用时留空即可；自带的 `docker-compose.yml` 把 `.env` 里的值原样传入，默认为空。

**文件地址里不带它。** 使用本地存储时，不管 `PUBLIC_URL` 是什么，每个存下来的文件地址都是站内相对地址 `/files/<key>`，画布里保存的就是这个地址。浏览器按打开应用的那个地址去加载，所以换主机、换端口、改 `PUBLIC_URL` 之后画布照常可用。早期版本存下的绝对地址（`<PUBLIC_URL>/files/<key>`，或回环地址）仍会被认作本实例的文件；前一种要求 `PUBLIC_URL` 与当时一致。

**它用在发给上游模型的参考素材上。** 节点把参考图或原视频交给模型时，上游得能读到它：

- `PUBLIC_URL` 是公网地址：上游拿到的是 `<PUBLIC_URL>/files/<key>`。
- 留空，或者是 `localhost`、内网地址：图片以 base64 的形式直接发给支持这种方式的接入。必须是地址的输入（视频编辑的原视频、部分视频模型的参考图）会失败，并提示设置 `PUBLIC_URL` 或改用对象存储。

分享链接是浏览器按地址栏里的地址拼出来的，与 `PUBLIC_URL` 无关。

使用 `s3`、`oss` 驱动时，文件地址来自 `S3_PUBLIC_BASE_URL` / `OSS_PUBLIC_BASE_URL`。

## 访问口令

设置 `ACCESS_PASSWORD` 后需要输入口令才能使用。它是整个实例共用的一个口令，不是用户系统。知道口令的人拥有全部权限，包括设置和模型接入的 Key（Key 不会显示，但可以被替换和使用）。

- 留空：完全不需要登录。只在自己的机器或可信的网络里这样做。
- 改口令会让所有人退出登录。
- 忘了口令：改 `.env` 里的 `ACCESS_PASSWORD` 再重启即可，不丢数据。

更多见[安全](security.zh-CN.md)。

## 备份

三样东西要一起备份：

| 内容 | 位置 | 原因 |
| --- | --- | --- |
| 数据库 | 数据卷 `mongo_data` | 画布、模型接入（含加密后的 Key）、设置、运行记录、分享、资产。 |
| 文件 | 数据卷 `app_data` | 上传和生成的素材（本地存储）。 |
| `.env` | 仓库根目录 | `SECRET_KEY`。没有它，数据库里的 Key 解不开。 |

导出数据库：

```bash
docker compose exec -T mongodb mongodump --archive --gzip --db loomcanvas > loomcanvas-db.archive.gz
```

文件：

```bash
docker compose cp app:/app/data ./loomcanvas-data-backup
```

恢复（服务已启动的情况下）：

```bash
docker compose exec -T mongodb mongorestore --archive --gzip --drop < loomcanvas-db.archive.gz
docker compose cp ./loomcanvas-data-backup/. app:/app/data
```

恢复文件后，确认容器内的 `node` 用户仍然能写 `/app/data`（`docker compose exec -u root app chown -R node:node /app/data`）；进程只能写这一个目录。正式依赖之前请自己演练一遍恢复流程，这几条命令不在项目的测试范围内。

使用 `s3`、`oss` 存储时，文件在你的桶里，用存储服务商的工具备份。

## 升级

```bash
git pull
docker compose up -d --build
```

没有单独的迁移命令。服务端启动时会：

1. 接着处理没跑完的运行。排队中的开始执行；已经拿到上游任务号的继续轮询，不会重新提交。进程崩溃（没有正常退出）时，卡在中途又没有任务号的运行判失败（`run.interrupted`），因为无法确定上游有没有创建任务。
2. 内置内容的版本号提升时重新安装。内置画布模板会被新版本覆盖；内置文本模板只在缺失时补上。
3. 画布按需升级：以旧 `schemaVersion` 保存的画布，在下次打开时迁移到当前版本。

执行 `docker compose stop` / `down` 时，服务端收到 `SIGTERM`，停止接新任务。任何请求都不会向上游发两次：进行中的运行只有在已经拿到上游任务号（下次启动继续轮询），或者还什么都没发出去时，才放回 `queued`。请求已经发出、还没拿到任务号的运行以 `run.interrupted` 失败，需要手动重新运行。同步返回的接入（OpenAI 兼容接口的图片、Gemini）和对话请求从来没有任务号，所以这类运行只要在进行中被打断，就一定是这个结果。服务端给自己 20 秒收尾，Compose 给 30 秒。

升级前请先看 [CHANGELOG.md](../CHANGELOG.md)。首个正式版本发布前，接口可能调整。

## 健康检查

`GET /api/app/bootstrap` 不需要登录，服务就绪后返回 HTTP 200 和当前版本号（数据库连上之后才开始监听）。Docker 镜像的 `HEALTHCHECK` 用的就是它。

```bash
curl -fsS http://localhost:3000/api/app/bootstrap
```

## 资源说明

- **上传的文件先放在内存里。** 每个上传在写入存储前都整个放在内存中，最大 `MAX_UPLOAD_MB`；「按地址抓取」也一样。请按同时上传的人数预留内存，`MAX_UPLOAD_MB` 不要调得比实际需要更大。
- 生成的图片也在内存中处理（每张最大 60 MB），用来读取尺寸和生成缩略图。生成的视频是流式写入存储的（每个最大 1 GB）。
- 同时执行的运行数由 `concurrency` 设置决定（默认 4）。一次运行大部分时间在等上游，CPU 占用不高；图片工具和缩略图用的是 `sharp`。
- 磁盘：本地存储下结果永久保留，除非设置了 `retentionDays`。见[配置](configuration.zh-CN.md#管理设置)。
