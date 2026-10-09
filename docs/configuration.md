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
| `PUBLIC_URL` | empty | Optional. Public address of the instance, `http(s)://…`, no trailing slash. Leave it empty for local or LAN use. It is not part of file URLs; it is only used to give upstream models an absolute URL for reference media kept in local storage (needed for video inputs). See [Deployment](deployment.md#public_url). |
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
| `STORAGE_DRIVER` | `local` | `local`, `s3` or `oss`. |
| `STORAGE_LOCAL_DIR` | `./data/files` | Directory for the local driver. Relative paths are resolved against `server/`. |
| `S3_ENDPOINT` | empty | Endpoint URL for S3-compatible services (R2, MinIO…). Leave empty for AWS S3. |
| `S3_REGION` | `auto` | Region. |
| `S3_BUCKET` | empty | Bucket name. Required for `s3`. |
| `S3_ACCESS_KEY_ID` | empty | Required for `s3`. |
| `S3_SECRET_ACCESS_KEY` | empty | Required for `s3`. |
| `S3_FORCE_PATH_STYLE` | off | `1`, `true` or `yes` turns on path-style addressing (MinIO usually needs it). |
| `S3_PUBLIC_BASE_URL` | empty | Public URL prefix of the bucket or its CDN, no trailing slash. Required for `s3`. |
| `OSS_REGION` | empty | For example `oss-cn-hangzhou`. `OSS_REGION` or `OSS_ENDPOINT` is required for `oss`. |
| `OSS_ENDPOINT` | empty | Alternative to `OSS_REGION`. |
| `OSS_BUCKET` | empty | Required for `oss`. |
| `OSS_ACCESS_KEY_ID` | empty | Required for `oss`. |
| `OSS_ACCESS_KEY_SECRET` | empty | Required for `oss`. |
| `OSS_PUBLIC_BASE_URL` | empty | Public URL prefix of the bucket or its CDN. Required for `oss`. |

The tests additionally read `TEST_MONGODB_URI`; see [Development](development.md#tests).

Which of these the stock Docker Compose file passes through is listed in [Deployment](deployment.md#variables-read-from-env).

### Storage drivers

| Driver | Files live in | File URL | Extra install |
| --- | --- | --- | --- |
| `local` | `STORAGE_LOCAL_DIR` | `/files/<key>` (site-relative), served by the app | none |
| `s3` | Your bucket | `<S3_PUBLIC_BASE_URL>/<key>` | none: the SDK is an optional dependency that `npm ci` installs, and it is in the Docker image |
| `oss` | Your bucket | `<OSS_PUBLIC_BASE_URL>/<key>` | `npm install ali-oss` in `server/`; with Docker, `EXTRA_NPM_PACKAGES=ali-oss` in `.env` and `docker compose build` |

Notes that apply to all drivers:

- Storage keys are generated by the server (`uploads/…`, `outputs/…`, `tools/…`, `thumbs/…` plus the date and 32 random hex characters). They never contain file names or anything a user typed.
- Files are **publicly readable** by anyone who has the URL. The `s3` and `oss` drivers do not sign URLs: objects must be readable through the public base URL (a public-read bucket or a CDN in front of it).
- The `s3` and `oss` drivers are written but have **not been run against a real bucket** in this project. Expect to test them yourself.
- On-demand thumbnails (made the first time a thumbnail is requested) exist only for the local driver. With object storage, thumbnails are made when a file is uploaded or a result is stored.

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

### Providers and models

The other two things you configure on the Settings page are stored in their own collections, not as settings keys:

- **Providers**: type, name, base URL, API key, enabled. See [Providers](providers.md).
- **Model overrides**: per model, `enabled`, display name, order, default parameters and the price table. See [Providers](providers.md#pricing).

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
| Brand kits | 50, each with up to 5 reference images |
| Share links | 500 |
| Assets per category | 5000 |
| Items in one zip download | 100, each up to 1 GiB, 4 GiB in total |
| Unfinished runs (queued or in flight) | 500; further runs are refused until some finish |
| Login attempts | 10 per client per 10 minutes (an IPv6 client is its /64), 300 in total |
| Login token lifetime | 30 days |
| Model list cache per provider | 5 minutes |
