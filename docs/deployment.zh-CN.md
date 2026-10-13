# 部署

[English](deployment.md)

正式运行 LoomCanvas 需要知道的事：Docker Compose、不用 Docker 运行、反向代理与 HTTPS、备份和升级。

LoomCanvas 是一个 Node.js 进程加一个 MongoDB。任务队列、登录和注册的限流、设置缓存都在这个进程里，所以**一个数据库只跑一个实例**，不要在负载均衡后面放多个副本。

## Docker Compose

仓库自带 `docker-compose.yml`，包含两个服务：

| 服务 | 镜像 | 数据 |
| --- | --- | --- |
| `mongodb` | `mongo:7.0` | 数据卷 `mongo_data`（`/data/db`） |
| `app` | 由 `Dockerfile` 构建（`node:20-alpine`，服务端加构建好的前端） | 数据卷 `app_data`（`/app/data`，上传和生成的文件） |

MongoDB 不对宿主机开放端口，也没有开启认证，只有 `app` 容器能通过 Compose 网络访问它。

```bash
cp .env.example .env     # 设置 SECRET_KEY 和 ADMIN_PASSWORD
docker compose up -d
```

然后打开实例，在落地页点「登录」，用 `admin` 和你在 `ADMIN_PASSWORD` 里设的密码登录。这个超级管理员账号是服务端第一次启动时创建的。如果 `ADMIN_PASSWORD` 留空了，`docker compose logs app` 里会有一个只显示一次的生成密码（搜 `Password:`）；用它登录，再换成自己的密码。之后其他人点「注册」，得到的是普通账号。见[账号](#账号)。

关于镜像：

- 进程以非特权用户 `node` 运行。`/app` 里的代码归 root 所有，进程只能读；只有 `/app/data` 可写，并且声明成了数据卷。
- 镜像里已经设好 `PORT=3000`、`WEB_DIST=/app/web-dist` 和 `STORAGE_LOCAL_DIR=/app/data/files`，所以直接 `docker run`（带上 `SECRET_KEY` 和 `MONGODB_URI`）也能提供前端页面。健康检查跟着 `PORT` 走。
- `LICENSE` 和 `THIRD_PARTY_NOTICES.md` 在 `/app` 下。

### 从 `.env` 读取的变量

Compose 读取 `docker-compose.yml` 同目录下的 `.env`，并把下面这些传进容器：

| 变量 | Compose 里的默认值 | 含义 |
| --- | --- | --- |
| `SECRET_KEY` | 无，必填 | 不填 Compose 拒绝启动。至少 16 位。 |
| `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_EMAIL` | 空（即 `admin`、生成的密码、没有邮箱） | 还没有超级管理员时，服务端按它们创建超级管理员。只在那一刻读取。见[账号](#账号)。 |
| `REGISTRATION_OPEN` | 空（即开放） | `true` 或 `false`：「开放注册」这项设置的初始值。设置保存过之后不再理会它。 |
| `PUBLIC_URL` | 空 | 可选。实例的公网地址，上游模型靠它按地址读取参考素材。见 [PUBLIC_URL](#public_url)。 |
| `PORT` | `3000` | 映射到宿主机的端口。容器内服务端固定监听 3000。 |
| `MAX_UPLOAD_MB` | `50` | 单个上传文件的上限。 |
| `STORAGE_DRIVER` | `local` | `local` 或 `s3`。只是初始默认值：「设置 → 存储」里保存的配置优先于它。 |
| `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_FORCE_PATH_STYLE`、`S3_KEY_PREFIX`、`S3_PUBLIC_BASE_URL`、`S3_PRESIGN_ENDPOINT`、`S3_DELIVERY`、`S3_ACL` | 空 | S3 兼容存储（AWS S3、Cloudflare R2、阿里云 OSS、MinIO 等）。不管 `STORAGE_DRIVER` 是什么、「设置 → 存储」里保存了什么，它们描述的桶都会被读取。见[存储](storage.zh-CN.md#环境变量一览)。 |
| `TRUST_PROXY` | 空 | 前面反向代理的层数，或代理的地址。 |
| `CORS_ORIGIN` | 空 | 额外允许跨域调用接口的来源。 |
| `SSRF_ALLOW_HOSTS` | 空 | 不受内网地址下载拦截限制的主机。 |
| `BILLING_HOOK` | 空 | 计费钩子模块在容器内的路径。 |
| `BUDGET_CHAT_RESERVE_OUTPUT_TOKENS` | 空（`8192`） | 只和设了金额上限的团队有关：按 token 计价的对话运行在跑的时候按多少个输出 token 预留额度。见[配置](configuration.zh-CN.md#网络与集成)。 |

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

默认情况下文件存在 `app_data` 数据卷里。想改存到桶里，在运行中的应用里打开「设置 → 存储」，填好桶的信息，测试连接，保存。保存后立即生效，不用重新构建，也不用重启。`.env` 里的 `S3_*` 变量是另一种办法，适合在还没人打开设置页之前就要用桶的实例；页面上保存的配置优先于它们。

- AWS SDK（`@aws-sdk/client-s3`、`@aws-sdk/lib-storage`、`@aws-sdk/s3-request-presigner`）是常规依赖，镜像里已经有了。不用额外装包，也没有构建参数。早期版本的构建参数 `EXTRA_NPM_PACKAGES` 已经去掉，请从 `.env` 里删除。
- 不再接受 `STORAGE_DRIVER=oss`：容器会在启动时退出，并提示应该改设什么。阿里云 OSS 现在通过它的 S3 兼容接口使用。见[存储](storage.zh-CN.md#从-storage_driveross-迁移)。
- 切换到桶之后，请保留 `app_data` 数据卷。切换前存下的文件仍然从它读取，不会被搬走。
- MinIO 容器可以和应用放在一起跑，Compose 片段见[存储](storage.zh-CN.md#minio)。

S3 驱动是对着 MinIO 验证的。AWS S3、Cloudflare R2、阿里云 OSS 没有对着真实服务跑过，见[存储](storage.zh-CN.md#测试情况)。

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
   ADMIN_PASSWORD=<超级管理员的密码，8 到 128 个字符>
   ```

   `ADMIN_PASSWORD` 可以不设：这时服务端自己生成超级管理员的密码，在运行 `npm start` 的终端里打印一次（见[账号](#账号)）。设了 `WEB_DIST`，服务端会同时提供构建好的前端（前端路由回退到 `index.html`）。相对路径以 `server/` 目录为基准。如果设了 `WEB_DIST` 但目录里没有 `index.html`，服务端拒绝启动。

4. 启动：

   ```bash
   npm start
   ```

不用 Docker 时，服务端读的是 `server/.env`，不是仓库根目录的 `.env`。请用进程管理器（systemd、pm2）托管，并确保停止时发送 `SIGTERM`，这样服务端才能正常收尾（见[升级](#升级)）。

## 反向代理与 HTTPS

只要实例能被本机以外的人访问，就应该走 HTTPS：账号密码在登录和注册请求里传输，会话凭证在每个请求里传输。

代理需要注意的几点：

| 事项 | 怎么设 |
| --- | --- |
| 上传大小 | 请求体上限要比 `MAX_UPLOAD_MB` 略大一点（multipart 有额外开销）。保存画布是 JSON，最大 6 MB。 |
| 长请求 | 上传、打包下载和代理下载可能持续几分钟。服务端单个请求最长允许 15 分钟，代理至少给 10 分钟。运行本身是用短请求轮询的，不需要 WebSocket 或 SSE。 |
| 来自桶的文件 | 使用 S3 存储并且分发方式是 `proxy` 时，`/files/*` 由应用从桶里流式转发，视频也一样。不要让代理把这些响应先缓冲到磁盘上（nginx 里是 `proxy_buffering off`，见下面的例子），`Range` 和 `If-None-Match` 原样透传（默认就是），超时保持上面那样长。这些响应是不可变的，前面的缓存可以留着它们。分发方式是 `redirect` 时，应用只回一个 `302`。见[存储](storage.zh-CN.md#两种分发方式)。 |
| 客户端地址 | 设置 `TRUST_PROXY=1`（前面有一层代理），登录和注册的限流、会话列表才能看到真实的客户端地址，而不是代理的地址。 |
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

**文件地址里不带它。** 不管 `PUBLIC_URL` 是什么、文件存在哪种存储里，每个存下来的文件地址都是站内相对地址 `/files/<key>`，画布里保存的就是这个地址。浏览器按打开应用的那个地址去加载，所以换主机、换端口、改 `PUBLIC_URL` 之后画布照常可用。早期版本存下的绝对地址（`<PUBLIC_URL>/files/<key>`，或回环地址）仍会被认作本实例的文件；前一种要求 `PUBLIC_URL` 与当时一致。

**它用在发给上游模型的参考素材上。** 节点把参考图或原视频交给模型时，上游得能读到它。对本地磁盘上的文件：

- `PUBLIC_URL` 是公网地址：上游拿到的是 `<PUBLIC_URL>/files/<key>`。
- 留空，或者是 `localhost`、`app` 这样的容器名、内网地址：图片以 base64 的形式直接发给支持这种方式的服务商。必须是地址的输入（高瑞图片模型的参考图、视频编辑的原视频、交给对话模型分析的视频、部分视频模型的参考图）会失败，并提示设置 `PUBLIC_URL` 或改用对象存储。

桶里的文件则是直接从桶交给上游：给它的公开地址，或者一个有效期一小时的预签名地址。只有这两个都不是公网可达的地址时，才退回到 `PUBLIC_URL`。Endpoint 只在内网里能用的桶（比如 `http://minio:9000`）就是这种情况：它的地址绝不会交给上游。所以桶在公网上的话，参考素材不需要 `PUBLIC_URL`；桶在内网里的话就需要，除非把桶的 S3 接口发布到公网并设置 `S3_PRESIGN_ENDPOINT`。见[存储](storage.zh-CN.md#给上游模型的参考素材)。

分享链接是浏览器按地址栏里的地址拼出来的，与 `PUBLIC_URL` 无关。

## 账号

使用前必须登录。账号存在数据库里。超级管理员由服务端创建，其他人在网页上注册。

- **超级管理员账号。** 服务端启动时，如果还没有超级管理员，就自动创建一个。它是唯一负责管理站点的账号（这个角色在接口里的值是 `owner`）。没有人靠注册成为超级管理员，实例对外开放之前也不需要抢先做什么。它长什么样由三个变量决定：

  | 变量 | 默认值 | 含义 |
  | --- | --- | --- |
  | `ADMIN_USERNAME` | `admin` | 3 到 32 个字符，只能用字母、数字、`_` 和 `-`。 |
  | `ADMIN_PASSWORD` | 空 | 8 到 128 个字符。太短或太长，服务端拒绝启动（`[config] ADMIN_PASSWORD must be 8 to 128 characters long. ...`）。留空：生成一个随机密码。 |
  | `ADMIN_EMAIL` | 空 | 可以不填。超级管理员是唯一可以没有邮箱的账号：它用用户名登录，以后可以在「设置 → 账号与安全」里补上邮箱。 |

  - 设了 `ADMIN_PASSWORD`：账号用这个密码创建，日志里有一行 `[auth] created the super admin account "admin" with the password from ADMIN_PASSWORD`。用 Compose 时推荐这样做：第一次 `docker compose up -d` 之前把它写进 `.env`。
  - 没设：生成一个 16 位的随机密码，在启动日志里**只打印一次**：

    ```text
    =======================================================================
    | LoomCanvas created the super admin account.                       |
    |                                                                     |
    |     Username:  admin                                                |
    |     Password:  <16 random characters>                               |
    |                                                                     |
    | This password is shown only this once. Sign in with it: you will be |
    | asked to choose your own before anything else.                      |
    | Lost it? Run:  node server/src/cli/reset-password.js admin          |
    =======================================================================
    ```

    用 Docker Compose 时用 `docker compose logs app` 查看（搜 `Password:`）；不用 Docker 时它在运行 `npm start` 的终端里。数据库里只存它的哈希，以后不会再打印。用它登录的人必须先设置新密码，之后才能做别的。在这之前，请把第一次启动的那份日志当作敏感信息；换过密码之后，日志里的那个密码就没有用了。
  - 这三个变量**只在创建超级管理员时读取**。之后每次启动都会忽略它们：已有超级管理员的用户名、邮箱和密码不会被覆盖，日志里也不会有任何相关内容。事后再改 `ADMIN_PASSWORD` 不起作用；超级管理员密码丢了，用命令行重置，见[忘记密码](#忘记密码)。
  - 几个进程同时启动，也只会创建一个超级管理员、打印一个密码。
  - 还没有超级管理员，而 `ADMIN_USERNAME` 或 `ADMIN_EMAIL` 已经是某个普通账号的用户名或邮箱时，服务端拒绝启动，并用一条 `[config]` 提示说明该改哪一个。
- **决定要不要开放注册。** 注册只会产生普通用户，而且默认是开放的：能访问到实例的人都可以注册账号，各有各的私有空间、各自的服务商和 Key。不想这样，就在第一次启动之前在 `.env` 里设 `REGISTRATION_OPEN=false`，或者在「设置 → 站点」里把「开放注册」关掉，或者发一个请求：

  ```bash
  curl -X PUT http://localhost:3000/api/admin/site \
    -H 'Authorization: Bearer <token>' \
    -H 'Content-Type: application/json' \
    -d '{"registrationOpen": false}'
  ```

  已有的账号照常登录。要让某个人注册，就临时打开，等他注册完再关上。`REGISTRATION_OPEN`（`true` 或 `false`，写成别的值服务端拒绝启动）只给这项设置一个初始值：设置从没保存过时才生效，之后就不再理会它，不管当初是由这个变量、设置页还是接口保存的。
- **管理账号。** 超级管理员可以在「设置 → 用户管理」里停用或启用账号、删除账号、重置密码。停用会让该账号立即退出登录，数据保留；它还在排队的运行会被取消，它在团队画布上持有的编辑锁立即释放。删除会把账号和它个人空间里的一切（包括存储里的文件）一起删掉，无法恢复；它在团队里做的东西留在团队，账号还是某个团队的团长时不能删除，要先转让团长或删除团队。授权某个账号创建团队（「允许创建团队」）也在这一页；团队本身在「设置 → 团队」里管理，见[配置](configuration.zh-CN.md#团队)。
- **限制。** `userConcurrency` 和 `userQueueLimit` 限定一个账号最多能占用多少队列。超级管理员在「设置 → 运行限制」里设置（「每个账号的并发上限」「每个账号的排队上限」），见[配置](configuration.zh-CN.md#管理设置)。没有按账号的存储配额。

LoomCanvas 不发任何邮件，所以不需要邮件服务器，邮箱也不做验证。

### 忘记密码

没有「找回密码」邮件。有两个办法：

1. **由超级管理员重置。** 超级管理员在「设置 → 用户管理」里对这个账号点「重置密码」，页面上会显示一次临时密码。
2. **由运行服务端的人用命令行重置。** 超级管理员自己忘了密码，只能用这个办法（例如 `... reset-password.js admin`）；`ADMIN_*` 变量改不了已有的账号。用 Docker Compose 时：

   ```bash
   docker compose exec app node src/cli/reset-password.js <用户名或邮箱>
   ```

   不用 Docker 时，在仓库根目录执行：

   ```bash
   node server/src/cli/reset-password.js <用户名或邮箱>
   ```

   这条命令使用服务端自己的配置（环境变量或 `server/.env` 里的 `MONGODB_URI`），打印一个临时密码，并让这个账号在所有设备上退出登录。服务端不用停。退出码：成功是 0，没有这个账号是 1，用法不对是 2。

不管用哪种办法，之后都是用临时密码登录：登录后马上进入「设置新密码」这一屏，系统要求先设置新密码，在这之前别的都用不了。

更多见[安全](security.zh-CN.md#账号)。

## 备份

三样东西要一起备份：

| 内容 | 位置 | 原因 |
| --- | --- | --- |
| 数据库 | 数据卷 `mongo_data` | 账号（含密码哈希）和它们的会话、画布、服务商（含加密后的 Key）、设置、保存的存储配置（含加密后的密钥）、运行记录、分享、资产。 |
| 文件 | 数据卷 `app_data` | 存在本地磁盘上的上传和生成的素材。 |
| `.env` | 仓库根目录 | `SECRET_KEY`。没有它，数据库里的服务商 Key 和存储密钥都解不开。 |

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

数据库备份里现在有每个账号的用户名、邮箱和密码哈希，以及当前会话凭证的哈希，请按这个敏感程度保管。恢复一份旧备份，账号和密码也会回到当时的状态。

使用 S3 存储时，文件在你的桶里，用存储服务商的工具备份（版本控制、跨区域复制）。如果中途切换过存储，两边都有文件：`app_data` 数据卷和桶都要备份。见[存储](storage.zh-CN.md#备份)。

## 升级

```bash
git pull
docker compose up -d --build
```

没有单独的迁移命令。服务端启动时会：

1. 接着处理没跑完的运行。排队中的开始执行；已经拿到上游任务号的继续轮询，不会重新提交。进程崩溃（没有正常退出）时，卡在中途又没有任务号的运行判失败（`run.interrupted`），因为无法确定上游有没有创建任务。
2. 内置内容的版本号提升时重新安装。内置画布模板会被新版本覆盖；内置文本模板只在缺失时补上。
3. 把以旧 `schemaVersion` 保存的画布升级到当前版本：启动时全部过一遍（日志里有 `[canvas] brought N stored canvas(es) up to the current document version`），之后读到旧形状的也会当场迁移。画布文档现在是 `schemaVersion` 3。版本 3 把品牌包从每个节点挪到了画布上，每个节点套用的还是原来那一个（见[使用指南](user-guide.zh-CN.md#品牌包)）。改版之后生成节点变高了，所以最后一次保存还在旧版本的画布，第一次在编辑器里打开时如果节点按新尺寸互相重叠，还会自动整理一次，见[常见问题](faq.zh-CN.md#升级之后画布好像被重新排过)。
4. 把上一个版本保存的服务商转换成现在的形状，每个只转换一次，并在日志里记下转换了几个。API Key、接口地址和模型标识都保留。升级后需要核对什么，见[服务商](providers.zh-CN.md#从上一个版本升级)。

执行 `docker compose stop` / `down` 时，服务端收到 `SIGTERM`，停止接新任务。任何请求都不会向上游发两次：进行中的运行只有在已经拿到上游任务号（下次启动继续轮询），或者还什么都没发出去时，才放回 `queued`。请求已经发出、还没拿到任务号的运行以 `run.interrupted` 失败，需要手动重新运行。同步返回的服务商（OpenAI 的图片、Gemini）和对话请求从来没有任务号，所以这类运行只要在进行中被打断，就一定是这个结果。服务端给自己 20 秒收尾，Compose 给 30 秒。

升级前请先看 [CHANGELOG.md](../CHANGELOG.md)。首个正式版本发布前，接口可能调整。

### 从没有账号的版本升级

更早的版本没有账号：所有数据属于一个内置用户，实例靠一个可选的共用口令（`ACCESS_PASSWORD`）保护。有账号的版本这样接手这些数据：

- **不需要手动执行任何东西。** 新版本第一次启动时，会删掉原来全站范围的三个唯一索引（`providers.slug_1`、`modeloverrides.modelId_1`、`templates.key_1`），建立按账号的索引，并把内置模板归到站点名下。
- **已有的数据在新版本第一次启动时交给超级管理员。** 同一次启动里，服务端创建超级管理员（见[账号](#账号)），并把旧版本写下的一切交给它：画布、分享链接（照常可用，地址不变）、资产、品牌包、服务商和它们的 Key、自定义模型、模型覆盖项和价格、用量记录、自己做的模板。画布里保存的文件地址照常可用，文件不会被移动或改名。日志里有一行，带着每个集合的条数：`[auth] the data from before accounts now belongs to "admin": {...}`。
- **第一次启动之前先设好 `ADMIN_PASSWORD`**，写在 `.env` 里（不想用默认值的话，再加上 `ADMIN_USERNAME`、`ADMIN_EMAIL`）。没设的话，从那次启动的日志里读出生成的密码。然后用超级管理员账号登录，旧数据都在。别人拿不到这些数据，因为注册只会产生普通账号，而普通账号是空的。
- **`SECRET_KEY` 不要改。** 交接过去的服务商 Key 仍然是用它加密的。
- 交接可以放心重复执行：服务端在中途停了，下次启动会接着做完。交接完成之后才冒出来的无主数据，不会再交给任何人。
- 已经有超级管理员的实例，超级管理员原样保留：不创建、不改动任何东西，`ADMIN_*` 变量被忽略。
- 升级时还没跑完的运行照常续跑，用的是提交时的那个服务商。它们归超级管理员。
- **删掉 `ACCESS_PASSWORD`**：从 `.env` 和你的 Compose 文件里去掉它。它已经不起作用；只要还设着，服务端每次启动会打一条警告。现在所有人都用账号登录，原来共用口令签发的凭证全部失效。
- **不带凭证调用接口的集成**（原来没设 `ACCESS_PASSWORD` 的实例）现在要先登录：`POST /api/auth/login`，然后带上 `Authorization: Bearer <token>`。见 [API](api.zh-CN.md#账号与登录)。
- **`GET /api/bootstrap` 的结构变了。** `authRequired` 和 `authed` 已经去掉（现在总是要登录；未登录时 `user` 是 `null`），`site.defaultTheme` 也去掉了。见 [API](api.zh-CN.md#基础)。
- **主题。** 界面有深色（默认）和浅色两套主题，每个人自己选，跟着账号走。仍然没有全站的设置项：`defaultTheme` 已经删除，`PUT /api/admin/settings` 会把它当作不认识的键拒绝，早期版本存下来的值不再使用。页面最先加载一个同源的小脚本 `/theme-boot.js`，前面有反向代理或 CDN 的话，要像 `/assets/` 下的文件一样放行它。
- **指向「设置」页旧页签的链接仍然可用。** 服务商、模型和价格搬到了「模型管理」页，用量搬到了「生成记录」页；`/settings?tab=providers`、`?tab=models`、`?tab=usage` 会被转到新页面。
- **计费钩子**：`ctx.userId` 现在是账号的 id（原来是常量 `'local'`），另外新增了 `ctx.username`。见[计费钩子](billing-hook.zh-CN.md)。

## 健康检查

`GET /api/app/bootstrap`（`GET /api/bootstrap` 原来的路径，两个都能用）不需要登录，服务就绪后返回 HTTP 200 和当前版本号（数据库连上之后才开始监听）。Docker 镜像的 `HEALTHCHECK` 用的就是它。

```bash
curl -fsS http://localhost:3000/api/app/bootstrap
```

## 资源说明

- **上传的文件先放在内存里。** 每个上传在写入存储前都整个放在内存中，最大 `MAX_UPLOAD_MB`；「按地址抓取」也一样。请按同时上传的人数预留内存，`MAX_UPLOAD_MB` 不要调得比实际需要更大。
- 生成的图片也在内存中处理（每张最大 60 MB），用来读取尺寸和生成缩略图。生成的视频是流式写入存储的（每个最大 1 GB）。
- 整个实例同时执行的运行数由 `concurrency` 设置决定（默认 4），其中一个账号最多占 `userConcurrency` 个。一次运行大部分时间在等上游，CPU 占用不高；图片工具和缩略图用的是 `sharp`。
- 使用 S3 存储并且分发方式是 `proxy` 时，每次查看文件都以流的方式经过应用。占的内存很少，但流量算在这台服务器上。
- 磁盘：结果永久保留（不管在本地磁盘还是在桶里），除非设置了 `retentionDays`。见[配置](configuration.zh-CN.md#管理设置)。
