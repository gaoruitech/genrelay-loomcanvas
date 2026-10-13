# Configuration

[简体中文](configuration.zh-CN.md)

LoomCanvas is configured in three layers:

| Layer | Where | Who changes it | Takes effect |
| --- | --- | --- | --- |
| [Environment variables](#environment-variables) | `.env` (Docker Compose) or `server/.env` | The operator | On restart |
| [Admin settings](#admin-settings) | **Settings** page (site settings) and **Models** page (providers, models, prices), stored in the database | The super admin (site settings); each account for its own providers and models | Immediately |
| [In-canvas settings](#in-canvas-settings) | Each canvas and each browser | The person editing | Immediately |

## Environment variables

All variables are read once at startup by `server/src/config.js`. An invalid value stops the server with a message that names the variable.

### Core

| Variable | Default | Meaning |
| --- | --- | --- |
| `SECRET_KEY` | none, **required** | Master secret, at least 16 characters. Encrypts provider API keys and the saved S3 secret in the database. The server never generates one for you. Changing it makes saved provider keys and the saved S3 secret unreadable: the server still starts, runs are refused until each key is entered again, and a bucket saved under **Settings → Storage** stays configured but cannot be used until its secret is entered again (see [Storage](storage.md#backups)). It does not sign anybody out, because sessions do not depend on it. |
| `PORT` | `3000` | HTTP port the server listens on (1 to 65535). In Docker Compose this name sets the host port instead; the container always listens on 3000. |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/loomcanvas` | MongoDB connection string. |
| `PUBLIC_URL` | empty | Optional. Public address of the instance, `http(s)://…`, no trailing slash. Leave it empty for local or LAN use. It is not part of file URLs; it is only used to give upstream models an absolute URL for reference media that they cannot load straight from a bucket (files on the local disk; needed for video inputs and for reference images with the Gaorui image models). See [Deployment](deployment.md#public_url). |
| `MAX_UPLOAD_MB` | `50` | Largest accepted upload, and the largest file "fetch from URL" will take (1 to 2048). Uploads are buffered in memory. |
| `WEB_DIST` | empty | Directory of the built frontend (`web/dist`) to serve from the server. Relative paths are resolved against `server/`. Must contain `index.html`. |

### Accounts

| Variable | Default | Meaning |
| --- | --- | --- |
| `ADMIN_USERNAME` | `admin` | Username of the super admin account the server creates when there is none. 3 to 32 characters from letters, digits, `_` and `-`. |
| `ADMIN_PASSWORD` | empty | Password of that account, 8 to 128 characters; the account is created with it and no change is forced. Empty: a random 16-character password is generated, printed once in the start-up log, and has to be replaced at the first sign-in. |
| `ADMIN_EMAIL` | empty | Email address of that account. Optional: the super admin is the only account that may have none. It then signs in by username and can add an address later under **Settings → Account & security**. |
| `REGISTRATION_OPEN` | empty | `true` or `false`. The first value of the [`registrationOpen`](#admin-settings) setting. Empty leaves the setting at its own default, open. |

When these are read:

- `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `ADMIN_EMAIL` are used **only at the start-up that creates the super admin**, that is, when no account with the `owner` role exists. They are checked at that moment too: a password of the wrong length, an invalid name or address, or a name or address that an ordinary account already has stops the server with a `[config]` message. On every later start they are ignored. An existing super admin's name, email and password are never overwritten, so changing `ADMIN_PASSWORD` afterwards does nothing; see [Deployment](deployment.md#forgotten-password) for a lost password.
- `REGISTRATION_OPEN` is applied **only while the `registrationOpen` setting has never been saved**. Once it has been saved, by this variable at a start-up, on the settings page or through `PUT /api/admin/site`, the stored value stands and the variable is ignored. Any value other than `true` or `false` stops the server at start-up (`REGISTRATION_OPEN must be true or false`).

Registration itself needs no variable: people register in the web app and get ordinary accounts; see [Getting started](getting-started.md#accounts) and [Deployment](deployment.md#accounts). `ACCESS_PASSWORD`, the shared password of earlier versions, is gone: if it is still set it is ignored, and the server logs one warning at start-up.

### Network and integration

| Variable | Default | Meaning |
| --- | --- | --- |
| `TRUST_PROXY` | empty | Set when running behind a reverse proxy so the sign-in and registration rate limits, and the session list, see the real client address. Either the number of proxies in front (`1` for one proxy, at most 10), or a comma-separated list of the addresses they connect from: IPs, CIDR ranges, or the names `loopback`, `linklocal`, `uniquelocal`. Anything else, including `true` and host names, stops the server at startup. There is no "trust everything" value: with it a client could forge `X-Forwarded-For` and get around the login rate limit. |
| `CORS_ORIGIN` | empty | Extra browser origins allowed to call `/api`, comma separated. By default no cross-origin access is granted. Needed only when a frontend is served from another origin, for example the Vite dev server or a product that embeds LoomCanvas (see [integration.md](integration.md#server-notes)). The allowed request headers are `Authorization`, `Content-Type`, `X-Locale` and `X-Space`. |
| `SSRF_ALLOW_HOSTS` | empty | Host names or IPs, comma separated, that are exempt from the private-address block of the server-side downloader. For a model server on your own network that returns result links pointing at itself. See [Security](security.md#ssrf-protection). |
| `BILLING_HOOK` | empty | Path to a billing hook module. A relative path is resolved against the directory the server is started from. See [Billing hook](billing-hook.md). |
| `BUDGET_CHAT_RESERVE_OUTPUT_TOKENS` | `8192` | Teams with a money limit only. A chat run priced per token costs what it costs only when it is done; while it runs it holds a reserve of the limit: the price of its input plus the price of this many output tokens (a model whose spec states `maxOutputTokens` uses that instead). A whole number from 1 to 1000000; anything else falls back to the default. Lower it if chat runs are refused although the limit has room for what they really cost; raise it if your models answer at greater length. See [Monthly limits](api.md#monthly-limits). |

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
| `S3_PRESIGN_ENDPOINT` | empty | Optional. The address the S3 service has from the internet, without a path, when `S3_ENDPOINT` only works inside your network (`http://minio:9000`). Signed addresses handed to upstream models are made for it; a reverse proxy there has to keep the `Host` header. It can also be entered as **Endpoint for signed URLs** under **Settings → Storage → Access and delivery**. See [Storage](storage.md#reference-media-for-upstream-models). |
| `S3_DELIVERY` | see meaning | `proxy` (the app serves the bytes; the bucket can be private) or `redirect` (browsers are redirected to `S3_PUBLIC_BASE_URL`). Default: `redirect` when `S3_PUBLIC_BASE_URL` is set, otherwise `proxy`. |
| `S3_ACL` | empty | Empty, `private` or `public-read`. Empty sends no ACL header. |

These variables are a bootstrap default. Storage is normally configured under **Settings → Storage**, and **a configuration saved there takes precedence over the environment**. The bucket the `S3_*` variables describe is still read whatever `STORAGE_DRIVER` says, so the files an install left there keep loading; remove the variables to stop that. See [Storage](storage.md) for the fields, a recipe per vendor, private buckets and what happens when you switch.

The tests additionally read `TEST_MONGODB_URI` and, for the live S3 tests, `TEST_S3_*`; see [Development](development.md#tests).

Which of these the stock Docker Compose file passes through is listed in [Deployment](deployment.md#variables-read-from-env).

### Storage backends

| Driver | Files live in | File URL | Extra install |
| --- | --- | --- | --- |
| `local` | `STORAGE_LOCAL_DIR` | `/files/<key>` (site-relative), served by the app | none |
| `s3` | Your bucket (AWS S3, Cloudflare R2, Aliyun OSS, MinIO, other S3-compatible services) | `/files/<key>` as well. The app streams the object from the bucket, or redirects to the bucket's public domain. | none: the AWS SDK is a regular dependency of `server/` and is in the Docker image |

Notes that apply to both:

- Storage keys are generated by the server (`uploads/…`, `outputs/…`, `tools/…`, `thumbs/…` plus the id of the account, the date and 32 random hex characters; files stored before accounts existed have no account segment and keep their keys). They never contain file names or anything a user typed.
- `/files/<key>` is **publicly readable** by anyone who has the URL. The account id in a key is not an access check. The bucket itself can stay private.
- Files are not moved when storage is switched; the earlier backend stays readable. See [Storage](storage.md#what-happens-when-you-switch).
- Thumbnails are made when a file is uploaded or a result is stored, and on first request when one is missing, on both backends. A thumbnail is written to the backend that holds its source image.
- The S3 driver is verified against MinIO. AWS S3, Cloudflare R2 and Aliyun OSS have **not been run against the live services**. See [Storage](storage.md#what-has-been-tested).

## Admin settings

These are stored in the database and edited on the **Settings** page, or through `GET`/`PUT /api/admin/settings` (see [API](api.md#site-settings)). Unknown keys and out-of-range values are rejected.

They are one set for the whole instance and **only the super admin can read or change them**. Any other account gets HTTP 403 with the code `auth.forbidden`, and its Settings page shows only **Appearance** (the interface language of that browser, and the theme and node layout of the account) and **Account & security**.

The Settings page shows one section at a time. The list on the left is grouped: **Personal** for everyone, **Site management** for the super admin only. Each section has its own address (`/settings/account`, `/settings/storage`, …), so a section can be linked to and the browser's back and forward buttons move between sections; leaving a section with unsaved changes asks first. On a phone the list becomes a row of chips above the section. "Where in the UI" below names the section and the label of the field.

| Group | Section | Address | Who sees it | What is there |
| --- | --- | --- | --- | --- |
| Personal | **Account & security** | `/settings/account` | Everyone | Username and email, change password, sign-in sessions. |
| Personal | **Appearance** | `/settings/appearance` | Everyone | **Interface language**, for this browser; **Theme** and **Node layout**, kept with the account. The super admin also sees **Site name**, **Logo**, **Show the site name next to the logo** and **Default language**. |
| Site management | **Site** | `/settings/site` | Super admin | **Open sign-up**. |
| Site management | **Users** | `/settings/users` | Super admin | The list of accounts as a table (user, role, status, last sign-in, teams, canvases, runs), with a search over username and email and a status filter (**All**, **Active**, **Disabled**, **Temp password**; the last three show how many accounts they hold). The ⋯ menu of a row has **Disable account** / **Enable account**, **Reset password**, **Allow creating teams** / **Take back team creation** and **Delete account**. The **Teams** column says how many teams the account is in and owns. An account that still has a temporary password is tagged **Temp password**. In a narrower window the table gives up its less important columns, and on a phone each account is a card. |
| Site management | **Teams** | `/settings/teams` | Super admin | **Team feature** (three site settings), **Requests to create teams**, and the list of teams. See [Teams](#teams). |
| Site management | **Storage** | `/settings/storage` | Super admin | Local disk or an S3-compatible bucket; the S3 form appears only when S3 is selected. See [Storage](storage.md). |
| Site management | **Run limits** | `/settings/limits` | Super admin | Concurrency, the per-account and per-team limits, timeouts, retries, result retention. |

| Key | Default | Range | Where in the UI | Meaning |
| --- | --- | --- | --- | --- |
| `siteName` | `LoomCanvas` | up to 40 characters | Appearance → Site name | Name shown in the top bar and in the browser tab. |
| `logoUrl` | empty | http(s) URL or `/files/…`, up to 2048 characters | Appearance → Logo | Logo in the top bar, on the sign-in pages and on the landing page, in place of the default icon (shown 28px tall, at most 132px wide). Empty uses the default icon. |
| `showSiteName` | `true` | `true`, `false` | Appearance → Show the site name next to the logo | Only matters when `logoUrl` is set. `true`: the site name is written next to the logo. `false`: the logo stands alone, for a logo that already spells the name (a wordmark); the name is still used for the browser tab and as the logo's text alternative. Without a logo the name is always shown. |
| `defaultLocale` | `zh-CN` | `zh-CN`, `en` | Appearance → Default language | Language for browsers that have not picked their own; also the fallback language of server messages. |
| `registrationOpen` | `true` | `true`, `false` | Site → Open sign-up | May people create accounts themselves (always ordinary users). When `false`, existing accounts keep signing in and nobody new can register. `REGISTRATION_OPEN` can give it its first value, see [Accounts](#accounts). Also available as `GET`/`PUT /api/admin/site`, which is what the switch uses. |
| `concurrency` | `4` | 1 to 32 | Run limits → Concurrent runs | Runs executing at the same time, for the whole instance. The rest wait in the queue. Raising it takes effect at once. |
| `userConcurrency` | `4` | 1 to 32 | Run limits → Concurrent runs per account | Runs one account may have executing at the same time, within `concurrency`. |
| `userQueueLimit` | `200` | 1 to 500 | Run limits → Queue limit per account | Unfinished runs (queued, running or archiving) one account may have. Further ones are refused with `run.queue_full`. The total for the whole instance stays 500. |
| `maxRetries` | `2` | 0 to 5 | Run limits → Retries | How many times a task submission is retried, and only when the upstream certainly did not accept it. |
| `imageTimeoutMinutes` | `10` | 1 to 120 | Run limits → Image timeout | Total time an image run may take from submission to result. |
| `videoTimeoutMinutes` | `30` | 1 to 240 | Run limits → Video timeout | Same for a video run. |
| `chatTimeoutSec` | `300` | 10 to 3600 | Run limits → Chat timeout | Time allowed for a chat completion (Language model and Video analysis nodes). |
| `submitTimeoutSec` | `60` | 5 to 600 | Run limits → Submit timeout | Time allowed for submitting a task to an asynchronous provider. |
| `downloadTimeoutSec` | `300` | 10 to 3600 | Run limits → Result download timeout | Time allowed for copying a finished result into storage. |
| `retentionDays` | `0` | 0 to 3650 | Run limits → Result retention | Delete the result files of runs that finished more than this many days ago. `0` keeps them forever. |
| `teamMaxPerUser` | `3` | 1 to 100 | Teams → Team feature → Teams one person may create | How many teams one authorised account may create. Teams it created or owns that still exist count; a dissolved team counts until it is removed for good. |
| `teamMaxMembers` | `50` | 1 to 1000 | Teams → Team feature → Members per team | How many members a team may have. The super admin can give one team its own number: **Change limits** in the team's row of the list under Teams (`PATCH /api/admin/teams/:id`). |
| `teamConcurrency` | `4` | 1 to 32 | Run limits → Default team concurrency limit | Runs of one team that may be executing at the same time, whoever of its members started them, within `concurrency`. A team can be given its own number, also under **Change limits** in its row. |
| `teamActivityDays` | `365` | 0 to 3650 | Teams → Team feature → Days team activity is kept | Days a team's activity log is kept. `0` keeps it for ever. |

There is no site-wide theme setting. Dark or light is each person's own choice (the icon in the top bar, or Settings → Appearance), kept with their account; an account that never chose is dark. The `defaultTheme` key of earlier versions is gone: sending it is refused with `settings.unknown_key` like any other unknown key, and a value an earlier version stored is ignored.

Every key can also be changed with a request, for example:

```bash
curl -X PUT http://localhost:3000/api/admin/settings \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"chatTimeoutSec": 600}'
```

`<token>` is what `POST /api/auth/login` returned for the super admin account (see [API](api.md#authentication)).

### How the queue is shared

`concurrency` is the number of runs executing at once for the whole instance. Within it, one account holds at most `userConcurrency` slots. When a slot frees, it goes to the account with the fewest runs in flight; among those, to the account that was given a slot longest ago; within an account, to its oldest run. One account with a long queue does not hold the others up. With a single account this is plain first-in, first-out.

### Teams

A team is a space several accounts share; how it is used is in the [user guide](user-guide.md#teams), the API in the [API reference](api.md#spaces-and-teams). The super admin's side of it is **Settings → Teams**.

![Settings → Teams](images/27-admin-teams.png)

What an operator decides:

- **Who may create teams.** Nobody but the super admin, until the super admin authorises an account: with **Allow creating teams** in the **More** menu of its row under **Settings → Users** (`PATCH /api/admin/users/:id { "canCreateTeams": true }`), or with **Approve** on the request an account sent, under **Requests to create teams** in **Settings → Teams** (`POST /api/teams/creation-request`, decided under `/api/admin/team-requests`); **Reject** takes an optional reason, which the person sees, and they may ask again. **Take back team creation** stops new teams and leaves the existing ones alone. With nobody authorised there are no teams, and the instance behaves exactly as before teams existed.
- **How many and how large**: `teamMaxPerUser` (default 3) and `teamMaxMembers` (default 50) above, under **Settings → Teams → Team feature**.
- **How much of the queue a team may take**: `teamConcurrency` (default 4, the same as `concurrency`), under **Settings → Run limits**. Lower it, or raise `concurrency`, if one team should not be able to fill the instance.
- **One team's own limits and state**: the list of teams further down in **Settings → Teams**. A row is numbers only: owner, members, canvases, runs, concurrency limit and status. Its actions are **Change limits** (this team's member limit and concurrency limit, or back to the site default), **Suspend** / **Resume**, **Restore** for a dissolved team, **Name new owner** (offered only when the owner's account cannot be used), and **Delete permanently** for a suspended or dissolved team (type the exact team name). The super admin sees no canvases, assets, keys or prompts of a team here, and cannot enter a team without being a member.
- **Deleting an account.** An account that still owns a team cannot be deleted: have the person transfer ownership first (or, when the account is disabled, name a new owner under **Settings → Teams**), or suspend the team and delete it permanently.
- **Almost nothing in the environment.** Teams need no environment variable, and upgrading needs no migration step: the new collections and indexes are created at the first start, and no existing document is changed. Every account's existing data simply is its personal space. The one optional variable is `BUDGET_CHAT_RESERVE_OUTPUT_TOKENS` (above): how much of a team's amount limit a chat run priced per token holds while it runs.
- **Dissolved teams** are removed for good 7 days after their owner dissolved them; the server checks hourly. The 7 days are a constant, not a setting.
- **Several server processes on one database** are not a supported way to run the queue (it lives in one process, see [How the queue is shared](#how-the-queue-is-shared)). The monthly limits do not depend on that: a run is admitted by one atomic update in the database, so a limit holds exactly however many processes share it.

Inside a team, its owner sets the team's own things - members, monthly limits, default visibility, who may publish share links - on the team's own **Team** page, not here; see the [user guide](user-guide.md#team-settings).

### About `retentionDays`

- The sweep runs one minute after startup and then every six hours, up to 200 runs per sweep.
- Only the output files (and thumbnails) of **succeeded runs** are deleted. Uploads, tool-node outputs and assets are not touched.
- Run records stay; they are the usage history.
- A canvas that still shows a deleted result will show a broken image. That is why the default is `0`.

### Providers, models and storage

The other things you configure in the app are not settings keys and are not part of `GET`/`PUT /api/admin/settings`:

- **Providers** (the **Models** page): the vendor, name, API key, enabled, a base URL when it is not the vendor's official one, and the custom models added by hand. Stored in their own collection. **Each space has its own**: nobody else sees or uses those of a personal space; a team's are managed by its owner and admins, and members use them without seeing the key. Changing the base URL of a provider that has a saved key needs the key again. See [Providers](providers.md).
- **Model overrides** (the **Models** page): per model, `enabled`, display name, order, default parameters and the price table. Stored in their own collection, also per space. Model ids (`<provider slug>:<upstream model>`) are per space too: two spaces can use the same slug, and the same id in two spaces is unrelated. See [Providers](providers.md#pricing).
- **Storage** (**Settings → Storage**): local disk or an S3-compatible bucket, for the whole instance, **super admin only**. It has its own endpoints (`/api/admin/storage`, see [API](api.md#storage)), takes effect immediately and takes precedence over `STORAGE_DRIVER` and `S3_*`. Changing the endpoint or the Access Key ID needs the Secret Access Key again. See [Storage](storage.md).

## In-canvas settings

| Setting | Scope | Stored in |
| --- | --- | --- |
| Canvas appearance: background colour, pattern, density | One canvas; travels with its share links | The canvas document (`settings`) |
| Node model and parameters (aspect ratio, resolution, duration, count) | One node | The canvas document |
| Brand kit of a canvas, and a node's exception to it | One canvas / one node | The canvas document (the kit itself is shared across the canvases of that space) |
| Language (简体中文 / English) | One browser | `localStorage` (`loomcanvas-locale`) |

A browser's own language wins over the site default. The theme is not a site setting: everyone picks dark, light or "follow the system" for themselves, and dark is the default.

## Fixed limits

These are constants in the code, listed here so you know where the edges are. Counts of things a space holds (providers, brand kits, share links, assets, canvases) are per space: per account for its personal space, per team for a team.

| Limit | Value |
| --- | --- |
| Nodes per canvas | 500 |
| Connections per canvas | 2000 |
| Canvases shown in the list | the 200 most recent |
| Canvas save request | 6 MB of JSON |
| Other JSON requests | 1 MB (64 KB for account, share-link and invite-link requests) |
| Prompt length | 20,000 characters |
| Providers | 50 per space |
| Custom models per provider | 100 |
| Brand kits | 50 per space, each with up to 5 reference images |
| Share links | 500 per space |
| Assets per category | 5000 per space |
| Asset folders | 500 per space |
| Saved templates, saved prompt snippets | 200 each per space |
| Working invite links per team | 50; each valid 1 to 90 days (default 7) for up to 1000 uses or without limit (default 10) |
| Edit lock of a team canvas | One per open editor (tab). 36 seconds past its last renewal; the editor renews every 12 seconds, and gives it back at once when the page closes. A read-only editor looks every 5 seconds whether the canvas became free; a canvas list refreshes "who is editing" every 10 seconds |
| Restoring a deleted canvas | within 30 days |
| Restoring a dissolved team | within 7 days; then it is removed with everything in it |
| Files copied along with one canvas or asset between spaces | 300 files, 2 GiB |
| Items in one zip download (a canvas, or history records) | 100, each up to 1 GiB, 4 GiB in total; from the history up to 100 records at a time, and 3 archives being prepared per account at once |
| Unfinished runs (queued or in flight), one account | the `userQueueLimit` setting, 200 by default, across its personal space and its teams; further runs are refused until some finish |
| Unfinished runs, whole instance | 500 |
| Sign-in attempts at one account name from one client address | 10 per 10 minutes (an IPv6 client is its /64). A successful sign-in clears the count. |
| Sign-in attempts from one client address, all account names together | 30 per 10 minutes |
| Sign-in attempts at one account name, all addresses together | 100 per 10 minutes. Does not apply from an address the account is known at. |
| Sign-in attempts in total | 3000 per 10 minutes. Does not apply from an address the account is known at. |
| Registration attempts per client address | 20 per hour |
| Changes of username or email | 20 per account per hour |
| Session lifetime | 12 hours; 30 days when "remember" is chosen at sign-in. Fixed from sign-in, not extended by use. |
| Username | 3 to 32 characters from `A-Z a-z 0-9 _ -`, unique without regard to case |
| Password | 8 to 128 characters |

How the sign-in limits work together, and what "known at" means, is in [Security](security.md#accounts).
