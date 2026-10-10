# Configuration

[简体中文](configuration.zh-CN.md)

LoomCanvas is configured in three layers:

| Layer | Where | Who changes it | Takes effect |
| --- | --- | --- | --- |
| [Environment variables](#environment-variables) | `.env` (Docker Compose) or `server/.env` | The operator | On restart |
| [Admin settings](#admin-settings) | **Settings** page, stored in the database | Anyone with access | Immediately |
| [In-canvas settings](#in-canvas-settings) | Each canvas and each browser | The person editing | Immediately |

## Environment variables

All variables are read once at startup by `server/src/config.js`. An invalid value stops the server with a message that names the variable.

### Core

| Variable | Default | Meaning |
| --- | --- | --- |
| `SECRET_KEY` | none, **required** | Master secret, at least 16 characters. Encrypts provider API keys in the database and derives the key that signs login tokens. The server never generates one for you. Changing it makes saved provider keys unreadable and signs everyone out. |
| `PORT` | `3000` | HTTP port the server listens on (1 to 65535). In Docker Compose this name sets the host port instead; the container always listens on 3000. |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/loomcanvas` | MongoDB connection string. |
| `PUBLIC_URL` | empty | Optional. Public address of the instance, `http(s)://…`, no trailing slash. Leave it empty for local or LAN use. It is not part of file URLs; it is only used to give upstream models an absolute URL for reference media that they cannot load straight from a bucket (files on the local disk; needed for video inputs and for reference images with the Gaorui image models). See [Deployment](deployment.md#public_url). |
| `ACCESS_PASSWORD` | empty | Shared access password. Empty disables login entirely. |
| `MAX_UPLOAD_MB` | `50` | Largest accepted upload, and the largest file "fetch from URL" will take (1 to 2048). Uploads are buffered in memory. |
| `WEB_DIST` | empty | Directory of the built frontend (`web/dist`) to serve from the server. Relative paths are resolved against `server/`. Must contain `index.html`. |

### Network and integration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRUST_PROXY` | empty | Set when running behind a reverse proxy so the login rate limit sees the real client address. Either the number of proxies in front (`1` for one proxy, at most 10), or a comma-separated list of the addresses they connect from: IPs, CIDR ranges, or the names `loopback`, `linklocal`, `uniquelocal`. Anything else, including `true` and host names, stops the server at startup. There is no "trust everything" value: with it a client could forge `X-Forwarded-For` and get around the login rate limit. |
| `CORS_ORIGIN` | empty | Extra browser origins allowed to call `/api`, comma separated. By default no cross-origin access is granted. Needed only when a frontend is served from another origin. |
| `SSRF_ALLOW_HOSTS` | empty | Host names or IPs, comma separated, that are exempt from the private-address block of the server-side downloader. For a model server on your own network that returns result links pointing at itself. See [Security](security.md#ssrf-protection). |
| `BILLING_HOOK` | empty | Path to a billing hook module. A relative path is resolved against the directory the server is started from. See [Billing hook](billing-hook.md). |

### Storage

| Variable | Default | Meaning |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local` or `s3`. `oss` is no longer accepted: the server exits at startup with a message that says how to migrate ([Storage](storage.md#migrating-from-storage_driveross)). |
| `STORAGE_LOCAL_DIR` | `./data/files` | Directory of the local disk backend. Relative paths are resolved against `server/`. |
| `S3_ENDPOINT` | empty | Endpoint of the S3 API for S3-compatible services (R2, OSS, MinIO…), without a path. Leave empty for AWS S3. |
| `S3_REGION` | `us-east-1` | Region. Use `auto` for R2. |
| `S3_BUCKET` | empty | Bucket name. Required for `s3`. |
| `S3_ACCESS_KEY_ID` | empty | Required for `s3`. |
| `S3_SECRET_ACCESS_KEY` | empty | Required for `s3`. |
| `S3_FORCE_PATH_STYLE` | off | `1`, `true` or `yes` turns on path-style addressing (MinIO needs it; AWS S3, R2 and OSS do not). |
| `S3_KEY_PREFIX` | empty | Optional folder inside the bucket. |
| `S3_PUBLIC_BASE_URL` | empty | Optional. Custom domain, CDN or `r2.dev` address that maps to the root of the bucket, no trailing slash. |
| `S3_DELIVERY` | see meaning | `proxy` (the app serves the bytes; the bucket can be private) or `redirect` (browsers are redirected to `S3_PUBLIC_BASE_URL`). Default: `redirect` when `S3_PUBLIC_BASE_URL` is set, otherwise `proxy`. |
| `S3_ACL` | empty | Empty, `private` or `public-read`. Empty sends no ACL header. |

These variables are a bootstrap default. Storage is normally configured under **Settings → Storage**, and **a configuration saved there takes precedence over the environment**. See [Storage](storage.md) for the fields, a recipe per vendor, private buckets and what happens when you switch.

The tests additionally read `TEST_MONGODB_URI` and, for the live S3 tests, `TEST_S3_*`; see [Development](development.md#tests).

Which of these the stock Docker Compose file passes through is listed in [Deployment](deployment.md#variables-read-from-env).

### Storage backends

| Driver | Files live in | File URL | Extra install |
| --- | --- | --- | --- |
| `local` | `STORAGE_LOCAL_DIR` | `/files/<key>` (site-relative), served by the app | none |
| `s3` | Your bucket (AWS S3, Cloudflare R2, Aliyun OSS, MinIO, other S3-compatible services) | `/files/<key>` as well. The app streams the object from the bucket, or redirects to the bucket's public domain. | none: the AWS SDK is a regular dependency of `server/` and is in the Docker image |

Notes that apply to both:

- Storage keys are generated by the server (`uploads/…`, `outputs/…`, `tools/…`, `thumbs/…` plus the date and 32 random hex characters). They never contain file names or anything a user typed.
- `/files/<key>` is **publicly readable** by anyone who has the URL. The bucket itself can stay private.
- Files are not moved when storage is switched; the earlier backend stays readable. See [Storage](storage.md#what-happens-when-you-switch).
- Thumbnails are made when a file is uploaded or a result is stored, and on first request when one is missing, on both backends. A thumbnail is written to the backend that holds its source image.
- The S3 driver is verified against MinIO. AWS S3, Cloudflare R2 and Aliyun OSS have **not been run against the live services**. See [Storage](storage.md#what-has-been-tested).

## Admin settings

These are stored in the database and edited on the **Settings** page, or through `GET`/`PUT /api/admin/settings` (see [API](api.md#site-settings)). Unknown keys and out-of-range values are rejected.

| Key | Default | Range | Where in the UI | Meaning |
| --- | --- | --- | --- | --- |
| `siteName` | `LoomCanvas` | up to 40 characters | Appearance | Name shown in the top bar. |
| `logoUrl` | empty | http(s) URL or `/files/…`, up to 2048 characters | Appearance | Logo in the top bar. Empty uses the default icon. |
| `defaultTheme` | `light` | `light`, `dark`, `system` | Appearance | Theme for browsers that have not picked their own. |
| `defaultLocale` | `zh-CN` | `zh-CN`, `en` | Appearance | Language for browsers that have not picked their own; also the fallback language of server messages. |
| `concurrency` | `4` | 1 to 32 | Limits | Runs executing at the same time. The rest wait in the queue. Raising it takes effect at once. |
| `maxRetries` | `2` | 0 to 5 | Limits | How many times a task submission is retried, and only when the upstream certainly did not accept it. |
| `imageTimeoutMinutes` | `10` | 1 to 120 | Limits | Total time an image run may take from submission to result. |
| `videoTimeoutMinutes` | `30` | 1 to 240 | Limits | Same for a video run. |
| `retentionDays` | `0` | 0 to 3650 | Limits | Delete the result files of runs that finished more than this many days ago. `0` keeps them forever. |
| `submitTimeoutSec` | `60` | 5 to 600 | Limits | Time allowed for submitting a task to an asynchronous provider. |
| `chatTimeoutSec` | `300` | 10 to 3600 | Limits | Time allowed for a chat completion (Language model and Video analysis nodes). |
| `downloadTimeoutSec` | `300` | 10 to 3600 | Limits | Time allowed for copying a finished result into storage. |

Every key can also be changed with a request, for example:

```bash
curl -X PUT http://localhost:3000/api/admin/settings \
  -H 'Content-Type: application/json' \
  -d '{"chatTimeoutSec": 600}'
```

When `ACCESS_PASSWORD` is set, add `-H 'Authorization: Bearer <token>'` (see [API](api.md#authentication)).

### About `retentionDays`

- The sweep runs one minute after startup and then every six hours, up to 200 runs per sweep.
- Only the output files (and thumbnails) of **succeeded runs** are deleted. Uploads, tool-node outputs and assets are not touched.
- Run records stay; they are the usage history.
- A canvas that still shows a deleted result will show a broken image. That is why the default is `0`.

### Providers, models and storage

The other things you configure on the Settings page are not settings keys and are not part of `GET`/`PUT /api/admin/settings`:

- **Providers**: the vendor, name, API key, enabled, a base URL when it is not the vendor's official one, and the custom models added by hand. Stored in their own collection. See [Providers](providers.md).
- **Model overrides**: per model, `enabled`, display name, order, default parameters and the price table. Stored in their own collection. See [Providers](providers.md#pricing).
- **Storage**: local disk or an S3-compatible bucket, on the **Storage** tab. It has its own endpoints (`/api/admin/storage`, see [API](api.md#storage)), takes effect immediately and takes precedence over `STORAGE_DRIVER` and `S3_*`. See [Storage](storage.md).

## In-canvas settings

| Setting | Scope | Stored in |
| --- | --- | --- |
| Canvas appearance: background colour, pattern, density | One canvas; travels with its share links | The canvas document (`settings`) |
| Node model and parameters (aspect ratio, resolution, duration, count) | One node | The canvas document |
| Brand kit attached to a node | One node | The canvas document (the kit itself is shared across canvases) |
| Theme (light / dark) | One browser | `localStorage` |
| Language (简体中文 / English) | One browser | `localStorage` |

A browser's own theme and language win over the site defaults.

## Fixed limits

These are constants in the code, listed here so you know where the edges are.

| Limit | Value |
| --- | --- |
| Nodes per canvas | 500 |
| Connections per canvas | 2000 |
| Canvases shown in the list | the 200 most recent |
| Canvas save request | 6 MB of JSON |
| Other JSON requests | 1 MB (64 KB for login and share-link requests) |
| Prompt length | 20,000 characters |
| Providers | 50 |
| Custom models per provider | 100 |
| Brand kits | 50, each with up to 5 reference images |
| Share links | 500 |
| Assets per category | 5000 |
| Items in one zip download | 100, each up to 1 GiB, 4 GiB in total |
| Unfinished runs (queued or in flight) | 500; further runs are refused until some finish |
| Login attempts | 10 per client per 10 minutes (an IPv6 client is its /64), 300 in total |
| Login token lifetime | 30 days |
