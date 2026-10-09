# Deployment

[简体中文](deployment.zh-CN.md)

How to run LoomCanvas for real: Docker Compose, running without Docker, reverse proxy and HTTPS, backups and upgrades.

LoomCanvas is one Node.js process plus MongoDB. The run queue, the login rate limit and the settings cache live in that process, so run **one** instance per database. Do not put several replicas behind a load balancer.

## Docker Compose

The repository ships a `docker-compose.yml` with two services:

| Service | Image | Data |
| --- | --- | --- |
| `mongodb` | `mongo:7.0` | volume `mongo_data` (`/data/db`) |
| `app` | built from `Dockerfile` (`node:20-alpine`, the server plus the built frontend) | volume `app_data` (`/app/data`, uploaded and generated files) |

MongoDB is not published on the host and has no authentication; it is only reachable from the `app` container over the Compose network.

```bash
cp .env.example .env     # set SECRET_KEY, optionally ACCESS_PASSWORD
docker compose up -d
```

About the image:

- The process runs as the unprivileged user `node`. The code in `/app` is owned by root and read-only to the process; `/app/data` is the only writable directory and is declared as a volume.
- `PORT=3000`, `WEB_DIST=/app/web-dist` and `STORAGE_LOCAL_DIR=/app/data/files` are set in the image, so a plain `docker run` (with `SECRET_KEY` and `MONGODB_URI`) also serves the web app. The health check follows `PORT`.
- `LICENSE` and `THIRD_PARTY_NOTICES.md` are in `/app`.

### Variables read from `.env`

Compose reads the `.env` file next to `docker-compose.yml` and passes these on to the container:

| Variable | Default in Compose | Meaning |
| --- | --- | --- |
| `SECRET_KEY` | none, required | Compose refuses to start without it. At least 16 characters. |
| `PUBLIC_URL` | empty | Optional. Public address of the instance, so upstream models can fetch reference media by URL. See [PUBLIC_URL](#public_url). |
| `ACCESS_PASSWORD` | empty | Shared access password. Empty means no login. |
| `PORT` | `3000` | Port published on the host. Inside the container the server always listens on 3000. |
| `MAX_UPLOAD_MB` | `50` | Largest accepted upload. |
| `STORAGE_DRIVER` | `local` | `local`, `s3` or `oss`. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_PUBLIC_BASE_URL` | empty | S3-compatible storage. |
| `OSS_REGION`, `OSS_ENDPOINT`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_PUBLIC_BASE_URL` | empty | Aliyun OSS. |
| `EXTRA_NPM_PACKAGES` | empty | Build argument, not a runtime variable: extra npm packages installed into the image, e.g. `ali-oss`. Takes effect after `docker compose build`. |
| `TRUST_PROXY` | empty | Number of reverse proxies in front, or their addresses. |
| `CORS_ORIGIN` | empty | Extra browser origins allowed to call the API. |
| `SSRF_ALLOW_HOSTS` | empty | Hosts exempt from the private-address download block. |
| `BILLING_HOOK` | empty | Path of a billing hook module inside the container. |

These are fixed by the Compose file: `MONGODB_URI=mongodb://mongodb:27017/loomcanvas`, `STORAGE_LOCAL_DIR=/app/data/files`, `WEB_DIST=/app/web-dist`.

The full list of variables, with defaults and ranges, is in [Configuration](configuration.md#environment-variables).

### Billing hook with Docker

`BILLING_HOOK` is passed from `.env`, but the hook file also has to be inside the container. Mount it in a `docker-compose.override.yml` next to the Compose file (Compose merges that file automatically) and set `BILLING_HOOK=/app/hooks/billing.js` in `.env`:

```yaml
services:
  app:
    volumes:
      - ./hooks:/app/hooks:ro
```

See [Billing hook](billing-hook.md).

### Object storage with the Docker image

The S3 SDK (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`) is in the image, so `STORAGE_DRIVER=s3` needs nothing extra.

The OSS SDK (`ali-oss`) is **not** in the image. With `STORAGE_DRIVER=oss` the stock image exits at startup with a message naming the missing package. To add it, set this in `.env` and rebuild:

```ini
EXTRA_NPM_PACKAGES=ali-oss
```

```bash
docker compose build
docker compose up -d
```

The S3 and OSS drivers are written but have not been run against a real bucket in this project; treat them as untested. See [Configuration](configuration.md#storage-drivers).

## Running without Docker

You need Node.js 20.9 or newer and MongoDB 7.

1. Build the frontend:

   ```bash
   cd web
   npm ci
   npm run build
   ```

2. Install the server and configure it:

   ```bash
   cd ../server
   npm ci --omit=dev
   cp .env.example .env
   ```

3. Edit `server/.env`. At minimum:

   ```ini
   SECRET_KEY=<a long random string>
   MONGODB_URI=mongodb://127.0.0.1:27017/loomcanvas
   WEB_DIST=../web/dist
   ```

   `WEB_DIST` makes the server serve the built frontend (with a fallback to `index.html` for client-side routes). A relative path is resolved against the `server/` directory. If `WEB_DIST` is set but has no `index.html`, the server refuses to start.

4. Start it:

   ```bash
   npm start
   ```

Without Docker the server reads `server/.env`, not the `.env` in the repository root. Run it under a process manager (systemd, pm2) that sends `SIGTERM` on stop, so the server can shut down cleanly (see [Upgrading](#upgrading)).

## Reverse proxy and HTTPS

Serve LoomCanvas over HTTPS whenever it is reachable from outside your machine: the access password and the login token travel in requests.

Things the proxy must get right:

| Concern | What to set |
| --- | --- |
| Upload size | Allow request bodies a little larger than `MAX_UPLOAD_MB` (multipart adds overhead). Canvas saves are JSON up to 6 MB. |
| Long requests | Uploads, zip downloads and the download proxy can run for minutes. The server allows 15 minutes per request; give the proxy at least 10. Runs themselves are polled with short requests, so no WebSocket or SSE support is needed. |
| Client address | Set `TRUST_PROXY=1` (one proxy in front) so the login rate limit sees the real client address instead of the proxy's. |
| `PUBLIC_URL` | Set it to the public HTTPS address if upstream models should fetch reference media by URL. |
| HSTS | The app does not send `Strict-Transport-Security`. Add it at the proxy that terminates TLS. |

When a proxy on the same host fronts the container, do not leave the published port open to the world: change the `ports` line in `docker-compose.yml` to `"127.0.0.1:${PORT:-3000}:3000"`, or firewall it.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name canvas.example.com;

    ssl_certificate     /etc/letsencrypt/live/canvas.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/canvas.example.com/privkey.pem;

    # A little above MAX_UPLOAD_MB (default 50)
    client_max_body_size 60m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 900s;
        proxy_send_timeout 900s;
        # Stream uploads and downloads instead of buffering them on disk
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

Caddy obtains the certificate itself and sets `X-Forwarded-For`.

## PUBLIC_URL

`PUBLIC_URL` is the address of the instance as browsers and upstream APIs see it, without a trailing slash, for example `https://canvas.example.com`.

It is optional. Leave it empty for local or LAN use; the stock `docker-compose.yml` passes on whatever `.env` has, empty by default.

**File URLs do not contain it.** With the local storage driver every stored file gets the site-relative URL `/files/<key>`, whatever `PUBLIC_URL` is, and that is what canvases save. Browsers load it from the address the app was opened at, so canvases keep working when the host, the port or `PUBLIC_URL` changes. Absolute URLs saved by earlier versions (`<PUBLIC_URL>/files/<key>`, or a loopback address) are still recognized as this instance's files; for the first form `PUBLIC_URL` has to be the same as it was then.

**It is used for reference media sent to upstream models.** When a node sends a reference image or a source video to a model, the upstream has to read it:

- If `PUBLIC_URL` is a public address, the upstream receives `<PUBLIC_URL>/files/<key>`.
- If it is empty, or points at `localhost` or a private address, images are sent inline as base64 to providers that accept that. Inputs that must be a URL (the source video of a video edit, reference images for some video models) fail with a message asking you to set `PUBLIC_URL` or switch to object storage.

Share links are built by the browser from the address in the address bar, not from `PUBLIC_URL`.

With the `s3` and `oss` drivers file URLs come from `S3_PUBLIC_BASE_URL` / `OSS_PUBLIC_BASE_URL` instead.

## Access password

Set `ACCESS_PASSWORD` to require a password. It is one shared password for the whole instance, not a user system. Everyone who has it has full access, including settings and provider keys (keys are never shown, but can be replaced or used).

- Empty: no login at all. Only do this on your own machine or a trusted network.
- Changing the password signs everyone out.
- To reset a forgotten password, change `ACCESS_PASSWORD` in `.env` and restart. No data is lost.

More in [Security](security.md).

## Backups

Back up three things together:

| What | Where | Why |
| --- | --- | --- |
| The database | volume `mongo_data` | Canvases, providers (with encrypted keys), settings, runs, shares, assets. |
| The files | volume `app_data` | Uploaded and generated media (local driver). |
| `.env` | repository root | `SECRET_KEY`. Without it the provider keys in the database cannot be decrypted. |

Database dump:

```bash
docker compose exec -T mongodb mongodump --archive --gzip --db loomcanvas > loomcanvas-db.archive.gz
```

Files:

```bash
docker compose cp app:/app/data ./loomcanvas-data-backup
```

Restore, on a stack that is up:

```bash
docker compose exec -T mongodb mongorestore --archive --gzip --drop < loomcanvas-db.archive.gz
docker compose cp ./loomcanvas-data-backup/. app:/app/data
```

After restoring files, make sure `/app/data` is still writable by the `node` user inside the container (`docker compose exec -u root app chown -R node:node /app/data`); the process can write nowhere else. Test your restore procedure before you rely on it; these commands have not been exercised as part of the project's test suite.

With `s3` or `oss` storage the files live in your bucket; back that up with the provider's tools.

## Upgrading

```bash
git pull
docker compose up -d --build
```

There is no separate migration command. On startup the server:

1. Puts unfinished runs back to work. Queued runs start. A run that already has an upstream task id is polled again, not resubmitted. After a crash (no clean shutdown), a run that was caught mid-flight without a task id is marked failed (`run.interrupted`), because it is unknown whether the upstream created the task.
2. Installs built-in content when its seed version has increased. Built-in canvas templates are overwritten with the new version; built-in text snippets are only added when missing.
3. Upgrades canvases lazily: a canvas saved under an older `schemaVersion` is migrated when it is next opened.

On `docker compose stop`/`down` the server gets `SIGTERM` and stops taking work. Nothing is sent to an upstream twice: an in-flight run goes back to `queued` only if it already has an upstream task id (the next start polls it again) or if nothing was sent for it yet. A run whose request was sent but has no task id yet fails with `run.interrupted` and has to be run again by hand. With a synchronous provider (OpenAI-compatible images, Gemini) and with chat requests there never is a task id, so those runs always end this way when they are caught in flight. The server gives itself 20 seconds for the shutdown and Compose allows 30.

Read [CHANGELOG.md](../CHANGELOG.md) before upgrading. Before the first tagged release, interfaces may change.

## Health check

`GET /api/app/bootstrap` is public and returns HTTP 200 with the running version once the server is up (it only starts listening after the database is connected). The Docker image uses it as its `HEALTHCHECK`.

```bash
curl -fsS http://localhost:3000/api/app/bootstrap
```

## Resource notes

- **Uploads are buffered in memory.** Each upload is held in RAM up to `MAX_UPLOAD_MB` before it is written to storage; "fetch from URL" does the same. Size the container's memory for the number of people uploading at once, and do not raise `MAX_UPLOAD_MB` further than you need.
- Generated images are also handled in memory (up to 60 MB each) to read their size and make a thumbnail. Generated videos are streamed to storage (up to 1 GB each).
- Concurrency of runs is the `concurrency` setting (default 4). Most of a run is waiting on the upstream, so CPU use is low; image tools and thumbnails use `sharp`.
- Disk: with the local driver, results are kept forever unless you set `retentionDays`. See [Configuration](configuration.md#admin-settings).
