# Deployment

[简体中文](deployment.zh-CN.md)

How to run LoomCanvas for real: Docker Compose, running without Docker, reverse proxy and HTTPS, backups and upgrades.

LoomCanvas is one Node.js process plus MongoDB. The run queue, the sign-in and registration rate limits and the settings cache live in that process, so run **one** instance per database. Do not put several replicas behind a load balancer.

## Docker Compose

The repository ships a `docker-compose.yml` with two services:

| Service | Image | Data |
| --- | --- | --- |
| `mongodb` | `mongo:7.0` | volume `mongo_data` (`/data/db`) |
| `app` | built from `Dockerfile` (`node:20-alpine`, the server plus the built frontend) | volume `app_data` (`/app/data`, uploaded and generated files) |

MongoDB is not published on the host and has no authentication; it is only reachable from the `app` container over the Compose network.

```bash
cp .env.example .env     # set SECRET_KEY and ADMIN_PASSWORD
docker compose up -d
```

Then open the instance, click **Sign in** on the landing page and sign in as `admin` with the password you set in `ADMIN_PASSWORD`. The server creates this administrator account at the first start. If `ADMIN_PASSWORD` was left empty, `docker compose logs app` shows a generated password once (search for `Password:`); sign in with it and choose your own. Other people then use **Sign up** and get ordinary accounts. See [Accounts](#accounts).

About the image:

- The process runs as the unprivileged user `node`. The code in `/app` is owned by root and read-only to the process; `/app/data` is the only writable directory and is declared as a volume.
- `PORT=3000`, `WEB_DIST=/app/web-dist` and `STORAGE_LOCAL_DIR=/app/data/files` are set in the image, so a plain `docker run` (with `SECRET_KEY` and `MONGODB_URI`) also serves the web app. The health check follows `PORT`.
- `LICENSE` and `THIRD_PARTY_NOTICES.md` are in `/app`.

### Variables read from `.env`

Compose reads the `.env` file next to `docker-compose.yml` and passes these on to the container:

| Variable | Default in Compose | Meaning |
| --- | --- | --- |
| `SECRET_KEY` | none, required | Compose refuses to start without it. At least 16 characters. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_EMAIL` | empty (`admin`, a generated password, no email) | The administrator account the server creates when there is none. Read at that moment only. See [Accounts](#accounts). |
| `REGISTRATION_OPEN` | empty (open) | `true` or `false`: the first value of the **Open sign-up** setting. Ignored once the setting has been saved. |
| `PUBLIC_URL` | empty | Optional. Public address of the instance, so upstream models can fetch reference media by URL. See [PUBLIC_URL](#public_url). |
| `PORT` | `3000` | Port published on the host. Inside the container the server always listens on 3000. |
| `MAX_UPLOAD_MB` | `50` | Largest accepted upload. |
| `STORAGE_DRIVER` | `local` | `local` or `s3`. A bootstrap default: a configuration saved under **Settings → Storage** takes precedence. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`, `S3_KEY_PREFIX`, `S3_PUBLIC_BASE_URL`, `S3_DELIVERY`, `S3_ACL` | empty | S3-compatible storage (AWS S3, Cloudflare R2, Aliyun OSS, MinIO…). See [Storage](storage.md#environment-variable-reference). |
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

By default files are kept in the `app_data` volume. To keep them in a bucket instead, open **Settings → Storage** in the running app, enter the bucket, test the connection and save. It takes effect immediately; nothing has to be rebuilt or restarted. The `S3_*` variables in `.env` are the alternative for an instance that should start on a bucket before anyone opens the settings page; a configuration saved on the page overrides them.

- The AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`) is a regular dependency and is in the image. There is no extra package to install and no build argument. The `EXTRA_NPM_PACKAGES` build argument of earlier versions is gone; remove it from `.env`.
- `STORAGE_DRIVER=oss` is no longer accepted: the container exits at startup with a message that says what to set instead. Aliyun OSS is now used through its S3-compatible API. See [Storage](storage.md#migrating-from-storage_driveross).
- Keep the `app_data` volume after switching to a bucket. Files stored before the switch are still read from it; they are not moved.
- A MinIO container can run next to the app; there is a Compose snippet in [Storage](storage.md#minio).

The S3 driver is verified against MinIO. AWS S3, Cloudflare R2 and Aliyun OSS have not been run against the live services; see [Storage](storage.md#what-has-been-tested).

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
   ADMIN_PASSWORD=<the administrator's password, 8 to 128 characters>
   ```

   `ADMIN_PASSWORD` is optional: without it the server generates the administrator's password and prints it once, in the terminal where `npm start` runs (see [Accounts](#accounts)). `WEB_DIST` makes the server serve the built frontend (with a fallback to `index.html` for client-side routes). A relative path is resolved against the `server/` directory. If `WEB_DIST` is set but has no `index.html`, the server refuses to start.

4. Start it:

   ```bash
   npm start
   ```

Without Docker the server reads `server/.env`, not the `.env` in the repository root. Run it under a process manager (systemd, pm2) that sends `SIGTERM` on stop, so the server can shut down cleanly (see [Upgrading](#upgrading)).

## Reverse proxy and HTTPS

Serve LoomCanvas over HTTPS whenever it is reachable from outside your machine: account passwords travel in the sign-in and registration requests, and the session token travels in every request.

Things the proxy must get right:

| Concern | What to set |
| --- | --- |
| Upload size | Allow request bodies a little larger than `MAX_UPLOAD_MB` (multipart adds overhead). Canvas saves are JSON up to 6 MB. |
| Long requests | Uploads, zip downloads and the download proxy can run for minutes. The server allows 15 minutes per request; give the proxy at least 10. Runs themselves are polled with short requests, so no WebSocket or SSE support is needed. |
| Files from a bucket | With S3 storage and `proxy` delivery, `/files/*` is streamed from the bucket through the app, videos included. Do not let the proxy buffer those responses on disk (`proxy_buffering off` in nginx, as below), pass `Range` and `If-None-Match` through unchanged (the default), and keep the long timeouts. The responses are immutable, so a cache in front may keep them. With `redirect` delivery the app only answers a `302`. See [Storage](storage.md#private-or-public-bucket-the-two-delivery-modes). |
| Client address | Set `TRUST_PROXY=1` (one proxy in front) so the sign-in and registration rate limits, and the session list, see the real client address instead of the proxy's. |
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

**File URLs do not contain it.** Every stored file gets the site-relative URL `/files/<key>`, whatever `PUBLIC_URL` is and whichever storage holds the file, and that is what canvases save. Browsers load it from the address the app was opened at, so canvases keep working when the host, the port or `PUBLIC_URL` changes. Absolute URLs saved by earlier versions (`<PUBLIC_URL>/files/<key>`, or a loopback address) are still recognized as this instance's files; for the first form `PUBLIC_URL` has to be the same as it was then.

**It is used for reference media sent to upstream models.** When a node sends a reference image or a source video to a model, the upstream has to read it. For a file on the local disk:

- If `PUBLIC_URL` is a public address, the upstream receives `<PUBLIC_URL>/files/<key>`.
- If it is empty, or points at `localhost` or a private address, images are sent inline as base64 to providers that accept that. Inputs that must be a URL (reference images for the Gaorui image models, the source video of a video edit, a video given to a chat model, reference images for some video models) fail with a message asking you to set `PUBLIC_URL` or switch to object storage.

A file in a bucket is handed to the upstream straight from the bucket instead: its public address, or a presigned URL that is valid for one hour. `PUBLIC_URL` is only the fallback when neither is publicly reachable. So with a bucket on the internet, `PUBLIC_URL` is not needed for reference media. See [Storage](storage.md#reference-media-for-upstream-models).

Share links are built by the browser from the address in the address bar, not from `PUBLIC_URL`.

## Accounts

Signing in is always required. Accounts are stored in the database. The administrator is created by the server; everybody else registers in the web app.

- **The administrator account.** At start-up, if no administrator exists, the server creates one. It is the one account that manages the site (its role is called `owner` in the API). Nobody registers as it, and there is nothing to do before the instance may be reached by others. Three variables say what it looks like:

  | Variable | Default | Meaning |
  | --- | --- | --- |
  | `ADMIN_USERNAME` | `admin` | 3 to 32 characters from letters, digits, `_` and `-`. |
  | `ADMIN_PASSWORD` | empty | 8 to 128 characters. With a shorter or longer value the server refuses to start (`[config] ADMIN_PASSWORD must be 8 to 128 characters long. ...`). Empty: a random password is generated. |
  | `ADMIN_EMAIL` | empty | Optional. The administrator is the only account that may have no email: it signs in by username and can add an address later under **Settings → Account & security**. |

  - With `ADMIN_PASSWORD` set, the account is created with that password and the log says `[auth] created the administrator account "admin" with the password from ADMIN_PASSWORD`. This is the recommended way with Compose: set it in `.env` before the first `docker compose up -d`.
  - Without it, a random 16-character password is generated and printed **once** in the start-up log:

    ```
    =======================================================================
    | LoomCanvas created the administrator account.                       |
    |                                                                     |
    |     Username:  admin                                                |
    |     Password:  <16 random characters>                               |
    |                                                                     |
    | This password is shown only this once. Sign in with it: you will be |
    | asked to choose your own before anything else.                      |
    | Lost it? Run:  node server/src/cli/reset-password.js admin          |
    =======================================================================
    ```

    With Docker Compose read it with `docker compose logs app` (search for `Password:`); without Docker it is in the terminal where `npm start` runs. Only its hash is stored and it is never printed again. Whoever signs in with it has to choose a new password before anything else. Until that has happened, treat the log of that first start as sensitive; afterwards the printed password is worthless.
  - These variables are read **only when the administrator is created**. On every later start they are ignored: the existing administrator's name, email and password are never overwritten, and nothing is logged about them. Changing `ADMIN_PASSWORD` later does nothing; a lost administrator password is reset from the command line, see [Forgotten password](#forgotten-password).
  - Several processes starting at the same moment still create one administrator and print one password.
  - If `ADMIN_USERNAME` or `ADMIN_EMAIL` is already the name or the address of an ordinary account while no administrator exists, the server refuses to start with a `[config]` message that says which one to change.
- **Decide about registration.** Registration only ever creates ordinary users, and it is open by default: anyone who can reach the instance can create an account with its own private space, its own providers and its own keys. If that is not what you want, set `REGISTRATION_OPEN=false` in `.env` before the first start, or switch **Open sign-up** off under **Settings → Site**, or send a request:

  ```bash
  curl -X PUT http://localhost:3000/api/admin/site \
    -H 'Authorization: Bearer <token>' \
    -H 'Content-Type: application/json' \
    -d '{"registrationOpen": false}'
  ```

  Existing accounts keep signing in. Open it again for as long as it takes someone to register, then close it. `REGISTRATION_OPEN` (`true` or `false`; any other value stops the server at start-up) only gives the setting its first value: it is applied while the setting has never been saved, and ignored from then on, whether it was saved by this variable, on the settings page or through the API.
- **Managing accounts.** Under **Settings → Users** the administrator can disable or enable an account, delete it and reset its password. Disabling signs the account out at once and keeps its data. Deleting removes the account together with everything it owns, including its stored files, and cannot be undone.
- **Limits.** `userConcurrency` and `userQueueLimit` bound what one account can occupy of the queue. The administrator sets them under **Settings → Run limits** (**Concurrent runs per account**, **Queue limit per account**); see [Configuration](configuration.md#admin-settings). There is no storage quota per account.

No email is sent by LoomCanvas, so no mail server is needed and addresses are not verified.

### Forgotten password

There is no "forgot password" mail. There are two ways to get back in:

1. **The administrator resets it.** Under **Settings → Users**, the administrator chooses **Reset password** for the account and is shown a temporary password once.
2. **Whoever runs the server resets it from the command line.** This is the only way for the administrator's own password (for example `... reset-password.js admin`); the `ADMIN_*` variables do not change an existing account. With Docker Compose:

   ```bash
   docker compose exec app node src/cli/reset-password.js <username-or-email>
   ```

   Without Docker, from the repository root:

   ```bash
   node server/src/cli/reset-password.js <username-or-email>
   ```

   The command uses the server's own configuration (`MONGODB_URI` from the environment or `server/.env`), prints a temporary password and signs the account out everywhere. The server can keep running. The exit code is 0 on success, 1 when there is no such account and 2 on wrong usage.

Either way, sign in with the temporary password: you are asked to choose a new password right after signing in, on the **Set a new password** screen, and nothing else is available until you have.

More in [Security](security.md#accounts).

## Backups

Back up three things together:

| What | Where | Why |
| --- | --- | --- |
| The database | volume `mongo_data` | Accounts (with password hashes) and their sessions, canvases, providers (with encrypted keys), settings, the saved storage configuration (with its encrypted secret), runs, shares, assets. |
| The files | volume `app_data` | Uploaded and generated media kept on the local disk. |
| `.env` | repository root | `SECRET_KEY`. Without it the provider keys and the storage secret in the database cannot be decrypted. |

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

A database dump now holds every account's username, email and password hash, and the hashes of live session tokens. Store it accordingly. Restoring an older dump brings back the accounts and passwords of that time.

With S3 storage the files live in your bucket; back that up with the vendor's tools (versioning, replication). If you switched storage at some point, files are in both places, the `app_data` volume and the bucket, and both need a backup. See [Storage](storage.md#backups).

## Upgrading

```bash
git pull
docker compose up -d --build
```

There is no separate migration command. On startup the server:

1. Puts unfinished runs back to work. Queued runs start. A run that already has an upstream task id is polled again, not resubmitted. After a crash (no clean shutdown), a run that was caught mid-flight without a task id is marked failed (`run.interrupted`), because it is unknown whether the upstream created the task.
2. Installs built-in content when its seed version has increased. Built-in canvas templates are overwritten with the new version; built-in text snippets are only added when missing.
3. Upgrades canvases lazily: a canvas saved under an older `schemaVersion` is migrated when it is next read. Canvas documents are at `schemaVersion` 2. Because generation nodes became taller in the redesign, a canvas last saved by an earlier version is also arranged once when it is first opened in the editor, if its nodes overlap at the new sizes; see the [FAQ](faq.md#after-the-upgrade-a-canvas-looks-rearranged).
4. Converts providers saved by the previous version to the vendor model, once per provider, and logs how many were converted. Keys, addresses and model ids are kept. See [Providers](providers.md#upgrading-from-the-previous-version) for what to check afterwards.

On `docker compose stop`/`down` the server gets `SIGTERM` and stops taking work. Nothing is sent to an upstream twice: an in-flight run goes back to `queued` only if it already has an upstream task id (the next start polls it again) or if nothing was sent for it yet. A run whose request was sent but has no task id yet fails with `run.interrupted` and has to be run again by hand. With a synchronous provider (OpenAI images, Gemini) and with chat requests there never is a task id, so those runs always end this way when they are caught in flight. The server gives itself 20 seconds for the shutdown and Compose allows 30.

Read [CHANGELOG.md](../CHANGELOG.md) before upgrading. Before the first tagged release, interfaces may change.

### Upgrading from a version without accounts

Earlier versions had no accounts: all data belonged to one built-in user, and an optional shared password (`ACCESS_PASSWORD`) guarded the instance. The version with accounts takes that data over as follows.

- **There is nothing to run by hand.** At its first start the new version drops three unique indexes that were site-wide (`providers.slug_1`, `modeloverrides.modelId_1`, `templates.key_1`), creates the per-account ones, and moves the built-in templates to the site.
- **The existing data goes to the administrator, at the first start of the new version.** In the same start-up the server creates the administrator account (see [Accounts](#accounts)) and hands it everything the earlier version wrote: canvases, share links (they keep working, with the same addresses), assets, brand kits, providers with their keys, custom models, overrides and prices, usage records and hand-made templates. File addresses stored in canvases keep working; files are not moved or renamed. The log says, with a count per collection: `[auth] the data from before accounts now belongs to "admin": {...}`.
- **Set `ADMIN_PASSWORD` before that first start**, in `.env` (and `ADMIN_USERNAME`, `ADMIN_EMAIL` if you want other values than the defaults). If you do not, read the generated password from the log of that start. Then sign in as the administrator: all the old data is there. Nobody else can get at it, because registering only creates ordinary accounts, which start empty.
- **Keep `SECRET_KEY` unchanged.** The provider keys that are handed over are still encrypted with it.
- The hand-over can be repeated safely: if the server stops in the middle, the next start finishes it. Data without an account that turns up after the hand-over is never given to anybody.
- An instance that already has an administrator keeps it exactly as it is: nothing is created or changed, and the `ADMIN_*` variables are ignored.
- Runs that were unfinished across the upgrade are resumed as usual, with the provider they were started with. They belong to the administrator.
- **Remove `ACCESS_PASSWORD`** from `.env` and from your Compose file. It is ignored; the server logs one warning at start-up while it is still set. Everybody signs in with an account now, and tokens issued for the old shared password are no longer valid.
- **Integrations that called the API without a token** (instances that had no `ACCESS_PASSWORD`) must sign in first: `POST /api/auth/login`, then send `Authorization: Bearer <token>`. See [API](api.md#authentication).
- **`GET /api/bootstrap` changed shape.** `authRequired` and `authed` are gone (signing in is always required; `user` is `null` for an anonymous caller), and so is `site.defaultTheme`. See [API](api.md#get-apibootstrap).
- **One theme.** The interface has a single dark theme. The `defaultTheme` setting was removed: `PUT /api/admin/settings` refuses it as an unknown key, and a value stored by an earlier version is ignored.
- **Old links to the Settings tabs still work.** Providers, models and prices moved to the **Models** page and usage to the **History** page; `/settings?tab=providers`, `?tab=models` and `?tab=usage` are redirected there.
- **Billing hooks**: `ctx.userId` is now the id of the account (it was the constant `'local'`), and there is a new `ctx.username`. See [Billing hook](billing-hook.md).

## Health check

`GET /api/app/bootstrap` (the earlier path of `GET /api/bootstrap`; both are answered) is public and returns HTTP 200 with the running version once the server is up (it only starts listening after the database is connected). The Docker image uses it as its `HEALTHCHECK`.

```bash
curl -fsS http://localhost:3000/api/app/bootstrap
```

## Resource notes

- **Uploads are buffered in memory.** Each upload is held in RAM up to `MAX_UPLOAD_MB` before it is written to storage; "fetch from URL" does the same. Size the container's memory for the number of people uploading at once, and do not raise `MAX_UPLOAD_MB` further than you need.
- Generated images are also handled in memory (up to 60 MB each) to read their size and make a thumbnail. Generated videos are streamed to storage (up to 1 GB each).
- Concurrency of runs is the `concurrency` setting (default 4) for the whole instance; one account holds at most `userConcurrency` of those slots. Most of a run is waiting on the upstream, so CPU use is low; image tools and thumbnails use `sharp`.
- With S3 storage and `proxy` delivery, every file view passes through the app as a stream. That costs little memory, but the traffic is the server's.
- Disk: results are kept forever, on the local disk or in the bucket, unless you set `retentionDays`. See [Configuration](configuration.md#admin-settings).
