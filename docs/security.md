# Security

[简体中文](security.zh-CN.md)

How to run a LoomCanvas instance safely, and what it does and does not protect. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## The model in one paragraph

LoomCanvas has **accounts**, and signing in is always required. The super admin account is built in: the server creates it at the first start, and nobody registers as it. Anyone who can reach the instance can register an ordinary account of their own until the super admin closes registration. Each account sees only its own canvases, files, providers, API keys and usage. The super admin also manages the site (registration, storage, run limits, the site's name, logo and default language, the user list) but cannot read other accounts' data through the API. There are no teams and no shared workspaces. Accounts are kept apart by the API, not by a hardened boundary: they share one process, one database, one storage area and one queue. Generated and uploaded files are public to anyone who has their URL. Design your deployment around that.

## Checklist

1. Set a long random `SECRET_KEY` and back it up.
2. Set `ADMIN_PASSWORD` yourself before the first start, or take the generated super admin password out of the start-up log and replace it at the first sign-in. Until it has been replaced, treat the log of that first start as sensitive. Close registration unless everyone who can reach the instance may have an account: `REGISTRATION_OPEN=false` from the first start, or the switch under **Settings → Site**. Use long passwords.
3. Put it behind HTTPS, and send `Strict-Transport-Security` from the proxy that terminates TLS (the app does not).
4. Behind a reverse proxy, set `TRUST_PROXY`.
5. Do not expose MongoDB or the app's port directly; publish only the proxy.
6. Leave `SSRF_ALLOW_HOSTS` and `CORS_ORIGIN` empty unless you need them.
7. Treat every share link and file URL as public.
8. Keep the instance updated.

## SECRET_KEY

`SECRET_KEY` is the root secret. The encryption key is derived from it (HKDF-SHA256). It is used for one thing:

| Purpose | Use |
| --- | --- |
| Provider credentials and the storage secret | Encrypting every account's provider API keys, and the S3 secret access key saved under **Settings → Storage**, in the database (AES-256-GCM, fresh random IV per value). |

It has no part in signing in. Sessions are random tokens kept in the database (see [Accounts](#accounts)), so changing `SECRET_KEY` does not sign anybody out.

Rules:

- At least 16 characters; use 32 random bytes or more. The server refuses to start without it and never generates one.
- Keep it stable. If it changes, saved provider keys cannot be decrypted, and every account has to enter its own keys again. A saved S3 secret cannot be decrypted either: the server logs it, writes new files to what the environment says (the local disk by default) and the storage settings ask the super admin for the secret again; until then the files in that bucket do not load.
- It lives in `.env`. Protect that file, keep it out of version control, and back it up together with the database. A database backup without the key cannot restore provider keys. A database backup **with** the key reveals them.

## Accounts

Every API endpoint except the public ones ([below](#what-is-public)) requires a signed-in account. There is no mode without sign-in.

### Roles

There are two roles and nothing in between.

| Role | Who | What it can do |
| --- | --- | --- |
| `owner` (the super admin) | Created by the server at the first start (the `ADMIN_*` variables). There is exactly one. | Everything a user can, on its own data. In addition it manages the site, in the sections of **Settings** that only the super admin sees: storage, run limits (concurrency, timeouts, retries, retention), the site's name, logo and default language, whether registration is open, and the user list (disable or enable an account, delete it, reset its password). |
| `user` | Every other account: everyone who registers. | Works in its own space: canvases, share links it published, assets, brand kits, runs, usage records, saved templates, and its own providers, API keys, custom models and prices. |

The super admin role is about managing the site, not about reading data. The super admin's requests are scoped to the super admin's own data like anybody else's. The user list shows, per account, the username, the email, the state and two numbers (canvases and runs), never content. The super admin cannot disable, delete or reset the super admin account from the user list.

The super admin is created at start-up when no account with the `owner` role exists, from `ADMIN_USERNAME` (default `admin`), `ADMIN_PASSWORD` and `ADMIN_EMAIL`. These are read at that moment only: afterwards they are ignored, and an existing super admin is never overwritten from the environment. Registration cannot produce a super admin, so there is no race for the role, also when several processes start at once. See [Deployment](deployment.md#accounts).

### What is separated, and what is not

- Every query the API makes is scoped to the calling account. Lists never mix accounts. Another account's canvas, run, provider or asset addressed by its id answers 404, the same as an id that does not exist.
- Provider keys are per account. A run is executed with the provider and key of the account it belongs to, also when it is resumed after a restart.
- Built-in templates, built-in prompt snippets and the read-only stock asset library belong to the site and are shown to everyone.
- **Share links and file URLs cross accounts on purpose.** Whoever has a share link can read its snapshot without signing in, and a signed-in account can copy it into its own canvases. `/files/<key>` is public to whoever has the URL. Keys of new files contain the account's id (`uploads/<account id>/…`) so that an account's files can be removed with it; that segment is not an access check.
- **This is not a hardened multi-tenant boundary.** All accounts share one process, one database, one storage area and one queue. Whoever can read the database or the server's disk can read everything; provider keys stay encrypted under `SECRET_KEY`.

### Sessions

- Signing in returns a token: 32 random bytes, opaque. The browser sends it as `Authorization: Bearer <token>` on every request. The server stores only its SHA-256, in the `sessions` collection, together with the account, the expiry, when it was last seen, the browser's user agent and the client address.
- A session lasts 12 hours, or 30 days when "remember" was chosen at sign-in. The time is fixed at sign-in; using the session does not extend it.
- Because sessions live in the database, ending one takes effect at once: signing out, ending another device's session, changing the password, a password reset, disabling an account, deleting it.
- Changing the password ends **every** session of the account, the one that made the change included. The response carries a fresh token for the caller, with the remaining lifetime of the session it replaces, and the web client swaps it in without anyone noticing. A token that was copied out of the browser before the change is dead. A password reset (by the super admin or from the command line) ends all sessions and hands out none.
- Each account can list its live sessions and end any of them, under **Settings → Account & security**.
- The web client keeps the token in the browser's web storage under the key `loomcanvas-token`: in `localStorage` when "Remember me" was ticked at sign-in, in `sessionStorage` (gone when the tab is closed) otherwise. Anyone with access to that browser profile is signed in until the session expires or is ended from another device.
- No cookie is involved, so cross-site request forgery does not apply. What a token in web storage is exposed to is script running in the page (XSS); the defence against that is the content security policy, which allows no inline script and no script from another origin (see [Browser-side protections](#browser-side-protections)).

### Passwords

- 8 to 128 characters. No other composition rules.
- Stored as scrypt hashes (`N=32768, r=8, p=1`) with a random 16-byte salt per account; the parameters are stored with the hash. Comparison is constant-time. Tokens are never logged, and passwords are not either, with the one exception described below.
- **The generated super admin password is printed once in the start-up log.** When the super admin is created and `ADMIN_PASSWORD` is not set, the server generates a random 16-character password and prints it in a framed block at that start-up. Only its hash is stored; it is never printed again. The account has to replace it at the first sign-in, and from then on the printed value is worthless. Until then, whoever can read that log can sign in as the super admin, so treat the log as sensitive, or set `ADMIN_PASSWORD` yourself and nothing is printed.
- **A password somebody else knows is always replaced.** The generated super admin password, a temporary password from the super admin's **Reset password** and one from the command line all mark the account (`mustChangePassword`). While the mark is set, a session of that account can do four things: read who it is (`GET /api/auth/me`, `GET /api/bootstrap`), change the password (`PUT /api/auth/password`) and sign out. Every other endpoint that needs a session answers 403 `auth.password_change_required`, and the web app shows only the **Set a new password** screen. The new password must differ from the temporary one.
- Sign-in gives the same answer, after the same amount of work, for an account that does not exist and for a wrong password. That an account is disabled is only said after the correct password.
- No email is ever sent, so there is no "forgot password" mail. A forgotten password is reset by the super admin under **Settings → Users** or, by whoever runs the server, from the command line (`node server/src/cli/reset-password.js <username-or-email>`). The super admin's own password can only be reset from the command line. Both produce a temporary password that is shown once, end all sessions of that account, and force a new password at the next sign-in. See [Deployment](deployment.md#forgotten-password).

### Rate limits

Sign-in attempts are counted four ways, each over a window of 10 minutes:

| | What is counted | Limit per 10 minutes |
| --- | --- | --- |
| (a) | One account name from one client address | 10 |
| (b) | One client address, whatever account names it tries | 30 |
| (c) | One account name, whatever addresses the attempts come from | 100 |
| (d) | All sign-in attempts together | 3000 |

And two more:

| What | Limit |
| --- | --- |
| Registration attempts from one client address | 20 per hour |
| Changes of username or email (`PUT /api/auth/profile`) | 20 per account per hour |

- An IPv6 client counts as its /64 network.
- A successful sign-in clears (a) for that account name and address.
- **Guessing at a name does not lock its holder out.** (c) and (d) are not applied to an address the account is *known at*: one from which that account signed in successfully in the last 30 days, or one that holds a live session of the account. So a guessing run from many addresses against one name is slowed to 100 guesses per 10 minutes, and the holder still signs in from their usual address. From an address the account has never used, the holder may have to wait while such a run is going on.
- The account name need not exist. The limits behave the same for a name nobody has, so they never tell which names exist.
- A wrong current password when changing the password counts under (a) and (c), so a stolen session cannot be used to guess the password without limit.
- Over a limit the answer is HTTP 429 with the code `auth.too_many_attempts`, `data.retryAfterSeconds` in the body and a `Retry-After` header. Sessions that are already signed in are never affected.
- The counters, and the memory of which addresses an account signed in from, are kept in memory, per process. They are empty after a restart (live sessions still make their addresses known) and assume a single process.

### Registration

Registration only ever creates ordinary users (`role: "user"`); there is no way to become the super admin through it. It is open by default. On an instance that strangers can reach, close it: set `REGISTRATION_OPEN=false` before the first start, or the super admin switches **Open sign-up** off under **Settings → Site**, or calls `PUT /api/admin/site` with `{ "registrationOpen": false }`. Existing accounts keep signing in; nobody new can register, without exception. `REGISTRATION_OPEN` only gives the setting its first value; once the setting has been saved, the stored value stands.

What an open registration means: every account can use the instance's storage and queue (bounded by `userQueueLimit` and the upload limit; there is no storage quota), and every account can add providers, whose base URL is not behind the SSRF guard ([below](#ssrf-protection)). Leave registration open only if you trust everyone who can reach the instance.

**Registration tells whether a username or an email is taken.** It has to: a second account with the same name cannot be created, and since no email is ever sent there is no way to answer "check your inbox" instead. So anyone who can reach an open registration form can test whether an address has an account here, at most 20 times per client address per hour. Changing one's own username or email gives the same two answers, which is why it is limited to 20 changes per account per hour. Sign-in never tells (see [Passwords](#passwords)). If it matters that nobody can find out who has an account, close registration.

To take access away from one person, the super admin disables or deletes that account (**Settings → Users**). Disabling signs it out at once and keeps its data; deleting removes the account with its canvases, share links, assets, providers and keys, usage records and stored files, and cannot be undone.

### Its limits

- **No email verification.** An email address only has to look like one and be unused. Nothing is sent to it.
- **No two-factor authentication and no single sign-on.**
- **No audit trail.** Runs are recorded per account, but not who changed a setting or who was disabled when.
- **No per-account storage quota or spending limit.** Use a [billing hook](billing-hook.md); it is told which account a run belongs to.
- **No teams.** Two accounts cannot work on the same canvas. A share link gives the other account a copy.
- Usernames and email addresses are stored in plain text in the database.

An extra authentication layer in front of the instance (a proxy, a VPN) protects `/api` and the pages, but files and share links are meant to stay reachable (see below).

## HTTPS

Without HTTPS, passwords, session tokens, your prompts and your images cross the network in clear text. Terminate TLS at a reverse proxy; see [Deployment](deployment.md#reverse-proxy-and-https).

The app deliberately does not set `Strict-Transport-Security` (HSTS): it cannot know whether it is reached over TLS. Add that header at the proxy that terminates TLS.

Behind a proxy, set `TRUST_PROXY` to the number of proxies in front (usually `1`) or to their addresses. Without it, every visitor appears to come from the proxy's address and shares one sign-in and one registration limit, and the session list shows the proxy's address for every session. The value is a hop count from 1 to 10, or a comma-separated list of IPs, CIDR ranges and the names `loopback`, `linklocal`, `uniquelocal`. There is deliberately no "trust everything" value: `TRUST_PROXY=true` and host names stop the server at startup, because trusting every hop would let any client choose its own address in `X-Forwarded-For` and walk around the limit.

## What is public

These work without signing in:

| What | Why | What protects it |
| --- | --- | --- |
| `GET /files/<key>` | Share pages and upstream models must be able to load media. This is the address of every stored file, on the local disk and in a bucket alike. | Keys contain 128 random bits and cannot be listed or guessed. There is no expiry. |
| `GET /api/canvas-share/<token>` and the `/share/<token>` page | That is what a share link is. | A 256-bit random token; optional expiry; revocation. |
| `GET /api/bootstrap` (also answered at `/api/app/bootstrap`) | The sign-in and registration pages need it. | To an anonymous caller it reveals the site name, logo URL, default language, the upload size limit, the version, and whether registration is open (`auth.registrationOpen`). Nothing about anybody's data, and not the super admin's username. |
| `POST /api/auth/register` | Creating an account. | Rate limit. Refused with `auth.registration_closed` when the super admin has closed registration. |
| `POST /api/auth/login` | Signing in. | Rate limits. |

Consequences:

- **A file URL is a capability.** Anyone who obtains it can fetch the file, forever, signed in or not. URLs travel: in share links, in requests to upstream models, in browser history, in screenshots.
- **Revoking a share link does not delete the files** on it. The link stops working, but a visitor who saved a file URL can still load that file. The same is true after you delete a canvas or an asset: those are soft deletes and the files stay.
- A share link shows a snapshot of the whole canvas: prompts, text nodes, images, videos, and the model ids chosen in the nodes (including the provider's slug). Run state, run and task ids, failure details and costs are stripped when the link is published, again when it is read, and from copies made of it.
- The public read and the copy endpoint accept only the link token. A share's database id never works in its place, signed in or not.
- With S3 storage nothing changes about this: `/files/<key>` is answered by the app for files in a bucket too. **The bucket itself can stay private** (`proxy` delivery): the app reads it with its credentials and browsers never talk to it. With `redirect` delivery the objects are in addition readable at the bucket's public domain, under the same random keys. See [Storage](storage.md#private-or-public-bucket-the-two-delivery-modes).
- Reference media in a bucket is handed to upstream models as a **presigned URL** that is valid for one hour (or as the public address with `redirect` delivery). Whoever has that URL can read that one object until it expires. Presigned URLs are made per upstream request and are never stored in canvases, share links or run records.

If some material must not be reachable by URL at all, LoomCanvas in its current form is not the place for it.

How files are served: the content type comes from the server-chosen extension, with `X-Content-Type-Options: nosniff`, a sandboxing `Content-Security-Policy`, and `Content-Disposition: attachment` for anything that is not an image, video or audio. A stored file cannot run script in the app's origin. This holds for files on the local disk and for files streamed from a bucket (`proxy` delivery). With `redirect` delivery the browser is sent to the bucket's public domain, which is another origin and sends its own headers.

"Fetch from URL" (`POST /api/files/fetch`) only returns images. That also holds when the URL points at this instance's own storage: a stored video is refused with `file.image_only`.

## SSRF protection

The server downloads URLs on behalf of users in several places: "fetch from URL", results returned by upstream models, external media used by tool nodes and as reference images, the download proxy and the zip export. All of them go through one guarded downloader (`server/src/utils/safeFetch.js`):

- Only `http` and `https`, no credentials in the URL.
- Loopback, private, link-local (including cloud metadata addresses), carrier-grade NAT, multicast and reserved ranges are refused, for IPv4 and IPv6, including IPv4 addresses embedded in IPv6.
- The check runs on the address the socket actually connects to, inside the DNS lookup, so a name that resolves to a public address first and a private one later (DNS rebinding) is refused. A name with any private record is refused.
- Redirects are followed manually, at most 5, each hop checked again.
- A total deadline and a byte cap apply to every download.
- What comes back is typed by its content. A "picture" that is really an HTML page is rejected.

Three things are deliberately **not** behind the guard:

- **A provider's base URL.** It defaults to the vendor's official address. It can be changed in the provider's advanced settings, and pointing it at a server on your own network that speaks the same API is legitimate. Every account has its own providers, so every account can make the server send requests to internal addresses. With registration open, that is anyone who can reach the instance. This is one more reason to close registration unless you trust who registers.
- **The S3 endpoint and the public base URL of the storage settings.** They are set by the super admin under **Settings → Storage** (or by the operator in the environment), and a MinIO on your own network is a legitimate target. The server sends its storage requests to the endpoint, and the connection test makes it contact both addresses with whatever was typed into the form. Only the super admin can do this. The guard for URLs that users and upstreams supply is unchanged.
- **Hosts in `SSRF_ALLOW_HOSTS`.** Use it only when an upstream on your own network returns result links that point at itself. Every host you list becomes reachable for all the download features above. List exact host names or IPs, as few as possible, and never in a deployment where people you do not trust have accounts.

## Upload validation

- The file type is detected from the leading bytes, never from the file name or the `Content-Type` the client sent. Only recognised image, video and audio formats are stored. SVG and HTML are not among them.
- Images are opened to read their dimensions; a file that claims to be an image but cannot be decoded is rejected. Images above 120 megapixels are refused.
- The storage key and the extension are chosen by the server. Nothing from the upload's name ends up in a path.
- Size is capped by `MAX_UPLOAD_MB`. Uploads are held in memory, so the cap also bounds memory use per upload.
- Request bodies of protected endpoints are parsed only after authentication. The account endpoints (`/api/auth`, registration and sign-in included) and the share-link endpoints accept at most 64 KB of JSON; a canvas save 6 MB; everything else 1 MB.
- A zip export holds at most 100 items, 1 GiB per item and 4 GiB in total. Items whose size no longer fits are replaced by a `NN-<type>-skipped.txt` note in the archive.
- One account may have at most `userQueueLimit` unfinished runs (queued, running or archiving; 200 by default), and the instance as a whole 500; further ones are refused with `run.queue_full` (HTTP 429).
- Malformed requests (bad percent-encoding in the path, an unsupported charset…) are answered with a 4xx and the code `common.bad_request`, not a 500. Unknown settings keys, including names such as `constructor` or `__proto__`, are rejected with `settings.unknown_key`.

There is no malware scanning and no content inspection beyond the format check.

## Keys at rest

| Data | At rest |
| --- | --- |
| Account passwords | scrypt hashes with a per-account salt. Never returned by any endpoint. |
| Session tokens | Only their SHA-256. A token cannot be recovered from the database. |
| Usernames, email addresses, the user agent and client address of each session | Plain, in MongoDB. |
| Provider API keys | Encrypted with AES-256-GCM. Never returned by any endpoint; the interface shows whether a key is set and its last four characters. |
| The S3 secret access key saved under **Settings → Storage**, and those of earlier buckets | Encrypted the same way. Never returned; the interface shows that one is set and its last four characters. The endpoint, bucket and Access Key ID are stored and returned in plain. |
| Canvases, prompts, settings, usage records | Plain, in MongoDB. |
| Uploaded and generated files | Plain, on disk or in your bucket. |
| `SECRET_KEY`, `S3_*` credentials given as variables | Plain, in the environment. |

Other things done to keep keys from leaking:

- Requests to an upstream do not follow redirects, so the `Authorization` header cannot be carried to another host.
- If an upstream echoes the credentials of the request in an error message, they are replaced by `***` before the message is shown or stored.
- If an upstream quotes a presigned storage URL back in an error, the values of its `X-Amz-*` query parameters (the signature among them) are replaced by `***` before the error is shown or stored.
- Unexpected errors are logged on the server and answered with a generic message.

The stock Compose file runs MongoDB without authentication, reachable only from the app container. If you use an external MongoDB, give it authentication and TLS and put the credentials in `MONGODB_URI`.

## Browser-side protections

- Pages are served with a `Content-Security-Policy`. Scripts: `script-src 'self'`, with no `'unsafe-inline'` and no `'unsafe-eval'`. The built `index.html` contains no inline script, so nothing else is added. (The server reads the built `index.html` at start-up and would add the SHA-256 hash of any inline script it found there, never `'unsafe-inline'`; with the stock build there is none to hash.) Also `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and `frame-ancestors 'self'`. Styles allow `'unsafe-inline'` for the style attributes the UI libraries set.
- Images, media and fetches (`img-src`, `media-src`, `connect-src`) are allowed from any `http(s)` origin on purpose, because a canvas shows results from object storage, CDNs and pasted links, and downloads them in the browser. The origin of every public base URL in the storage settings is listed explicitly as well, and the list follows the settings without a restart. Today that changes nothing, since any origin is allowed; it keeps those origins allowed if the open sources are ever tightened.
- The web build is made so that it needs no `eval` (`__INTLIFY_JIT_COMPILATION__` in `web/vite.config.ts`, for vue-i18n).
- If you serve the web build from another server than this one (your own nginx, a CDN), that server has to send an equivalent policy itself; the one above is only added by the LoomCanvas server.
- API responses carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and are `no-store`.
- `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin` and a `Permissions-Policy` that turns off camera, microphone, geolocation, payment and USB are set on every response.
- `Strict-Transport-Security` is not set by the app; see [HTTPS](#https).
- Authentication uses a bearer token in a header, not a cookie, so cross-site request forgery does not apply. The token is kept in the browser's web storage, which script running in the page can read; the script policy above is what keeps foreign script out of the page. `CORS_ORIGIN` is empty by default: no other origin may call the API from a browser.

## What LoomCanvas does not do

- **Content moderation.** Prompts and results are not screened. Whatever filtering exists is the upstream's. You are responsible for what you generate and publish, and for complying with your provider's terms and local law.
- **Hardened multi-tenant isolation.** Accounts are kept apart by the API on every query, but they share one process, one database, one storage area and one queue, and file URLs and share links are public. It is not a base for a service for mutually untrusted tenants without your own isolation layer.
- **Teams, shared workspaces, roles other than super admin and user.**
- **Email verification, password reset by email, single sign-on, two-factor authentication.**
- **Audit logging.**
- **Private or expiring file URLs.** A bucket can be private, but `/files/<key>` in front of it is public and does not expire.
- **Encryption of files or of the database** (beyond provider keys and the storage secret). Encryption at rest in a bucket is the storage vendor's feature.
- **Spending limits and storage quotas.** An account can start as many runs as its queue allows (`userQueueLimit`, 200 unfinished by default) and store as many files as the disk or bucket holds. Each account spends at the providers it added itself. To cap spending, use a [billing hook](billing-hook.md), which is told the account of every run, and the limits your upstream provider offers.
- **Protection against a malicious upstream**, beyond the download guard and content checks. Whatever you send to a provider (prompts, reference media) is in that provider's hands.

## Related

- [Deployment](deployment.md): reverse proxy, backups, upgrades.
- [Configuration](configuration.md): every variable mentioned here.
- [Storage](storage.md): private buckets, delivery, presigned URLs.
- [SECURITY.md](../SECURITY.md): how to report a vulnerability.
