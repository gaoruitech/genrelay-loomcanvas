# Security

[简体中文](security.zh-CN.md)

How to run a LoomCanvas instance safely, and what it does and does not protect. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## The model in one paragraph

LoomCanvas is a **single-user** application. There is one shared access password, no accounts and no roles. Whoever is inside can do everything: edit every canvas, change settings, replace provider keys and spend money at your upstream. Generated and uploaded files are public to anyone who has their URL. Design your deployment around that.

## Checklist

1. Set a long random `SECRET_KEY` and back it up.
2. Set `ACCESS_PASSWORD` on anything that is not your own machine. Use a long passphrase.
3. Put it behind HTTPS, and send `Strict-Transport-Security` from the proxy that terminates TLS (the app does not).
4. Behind a reverse proxy, set `TRUST_PROXY`.
5. Do not expose MongoDB or the app's port directly; publish only the proxy.
6. Leave `SSRF_ALLOW_HOSTS` and `CORS_ORIGIN` empty unless you need them.
7. Treat every share link and file URL as public.
8. Keep the instance updated.

## SECRET_KEY

`SECRET_KEY` is the root secret. Separate keys are derived from it (HKDF-SHA256) for separate purposes:

| Purpose | Use |
| --- | --- |
| Provider credentials and the storage secret | Encrypting provider API keys, and the S3 secret access key saved under **Settings → Storage**, in the database (AES-256-GCM, fresh random IV per value). |
| Login tokens | Signing the JWT issued at login (HS256). |

Rules:

- At least 16 characters; use 32 random bytes or more. The server refuses to start without it and never generates one.
- Keep it stable. If it changes, saved provider keys cannot be decrypted (re-enter them under **Settings → Providers**) and everyone is signed out. A saved S3 secret cannot be decrypted either: the server logs it, writes new files to what the environment says (the local disk by default) and the **Storage** tab asks for the secret again; until then the files in that bucket do not load.
- It lives in `.env`. Protect that file, keep it out of version control, and back it up together with the database. A database backup without the key cannot restore provider keys. A database backup **with** the key reveals them.

## Access password

`ACCESS_PASSWORD` turns login on.

What it gives you:

- Every API endpoint except the public ones (below) requires a token.
- The password is compared in constant time.
- Login attempts are limited: 10 per client per 10 minutes (an IPv6 client counts as its /64 network), and 300 in total across all clients per 10 minutes. When the total is reached, nobody can sign in until the window ends; sessions that are already signed in keep working.
- Tokens last 30 days and are tied to the password: changing `ACCESS_PASSWORD` invalidates all of them at once.

Its limits:

- **One shared password, not multi-user.** There are no usernames, no per-person permissions, no read-only role. Everyone who knows it is an administrator. You cannot revoke one person without changing the password for all.
- **No audit trail.** Runs are recorded, but not who made them or who changed a setting.
- The password is stored as plain text in the environment. Anyone who can read `.env` or the container's environment has it.
- The rate limit is kept in memory. It resets on restart and assumes a single process.
- The token is kept in the browser's `localStorage`. Anyone with access to that browser profile is signed in.
- With `ACCESS_PASSWORD` empty there is no protection at all, including for settings and provider keys. Do this only on your own machine or a network you fully trust.

If several people need separate accounts or limits, put LoomCanvas behind your own authenticating proxy, or run one instance per person. Note that an extra layer in front protects `/api` and the pages, but files and share links are meant to stay reachable (see below).

## HTTPS

Without HTTPS, the password, the token, your prompts and your images cross the network in clear text. Terminate TLS at a reverse proxy; see [Deployment](deployment.md#reverse-proxy-and-https).

The app deliberately does not set `Strict-Transport-Security` (HSTS): it cannot know whether it is reached over TLS. Add that header at the proxy that terminates TLS.

Behind a proxy, set `TRUST_PROXY` to the number of proxies in front (usually `1`) or to their addresses. Without it, every visitor appears to come from the proxy's address and shares one login rate limit. The value is a hop count from 1 to 10, or a comma-separated list of IPs, CIDR ranges and the names `loopback`, `linklocal`, `uniquelocal`. There is deliberately no "trust everything" value: `TRUST_PROXY=true` and host names stop the server at startup, because trusting every hop would let any client choose its own address in `X-Forwarded-For` and walk around the limit.

## What is public

These work without a token even when a password is set:

| What | Why | What protects it |
| --- | --- | --- |
| `GET /files/<key>` | Share pages and upstream models must be able to load media. This is the address of every stored file, on the local disk and in a bucket alike. | Keys contain 128 random bits and cannot be listed or guessed. There is no expiry. |
| `GET /api/canvas-share/<token>` and the `/share/<token>` page | That is what a share link is. | A 256-bit random token; optional expiry; revocation. |
| `GET /api/app/bootstrap` | The login page needs it. | Reveals the site name, logo URL, default theme and language, whether a password is required, and the version. |
| `POST /api/auth/login` | Signing in. | Rate limit. |

Consequences:

- **A file URL is a capability.** Anyone who obtains it can fetch the file, forever, with or without the password. URLs travel: in share links, in requests to upstream models, in browser history, in screenshots.
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

- **A provider's base URL.** It is set by the operator in Settings, and pointing it at a model server on your own network is legitimate. Since anyone with the access password can add a provider, anyone with the password can make the server send requests to internal addresses. This is one more reason the password equals full trust.
- **The S3 endpoint and the public base URL of the storage settings.** They are set by the operator under Settings → Storage (or in the environment), and a MinIO on your own network is a legitimate target. The server sends its storage requests to the endpoint, and the connection test makes it contact both addresses with whatever was typed into the form. As with providers, anyone with the access password can do this. The guard for URLs that users and upstreams supply is unchanged.
- **Hosts in `SSRF_ALLOW_HOSTS`.** Use it only when an upstream on your own network returns result links that point at itself. Every host you list becomes reachable for all the download features above. List exact host names or IPs, as few as possible, and never in a deployment where untrusted people have the password.

## Upload validation

- The file type is detected from the leading bytes, never from the file name or the `Content-Type` the client sent. Only recognised image, video and audio formats are stored. SVG and HTML are not among them.
- Images are opened to read their dimensions; a file that claims to be an image but cannot be decoded is rejected. Images above 120 megapixels are refused.
- The storage key and the extension are chosen by the server. Nothing from the upload's name ends up in a path.
- Size is capped by `MAX_UPLOAD_MB`. Uploads are held in memory, so the cap also bounds memory use per upload.
- Request bodies of protected endpoints are parsed only after authentication. The public endpoints (login, share links) accept at most 64 KB of JSON; a canvas save 6 MB; everything else 1 MB.
- A zip export holds at most 100 items, 1 GiB per item and 4 GiB in total. Items whose size no longer fits are replaced by a `NN-<type>-skipped.txt` note in the archive.
- At most 500 runs may be unfinished (queued, running or archiving) at a time; further ones are refused with `run.queue_full` (HTTP 429).
- Malformed requests (bad percent-encoding in the path, an unsupported charset…) are answered with a 4xx and the code `common.bad_request`, not a 500. Unknown settings keys, including names such as `constructor` or `__proto__`, are rejected with `settings.unknown_key`.

There is no malware scanning and no content inspection beyond the format check.

## Keys at rest

| Data | At rest |
| --- | --- |
| Provider API keys | Encrypted with AES-256-GCM. Never returned by any endpoint; the interface shows whether a key is set and its last four characters. |
| The S3 secret access key saved under Settings → Storage, and those of earlier buckets | Encrypted the same way. Never returned; the interface shows that one is set and its last four characters. The endpoint, bucket and Access Key ID are stored and returned in plain. |
| Canvases, prompts, settings, usage records | Plain, in MongoDB. |
| Uploaded and generated files | Plain, on disk or in your bucket. |
| `ACCESS_PASSWORD`, `SECRET_KEY`, `S3_*` credentials given as variables | Plain, in the environment. |

Other things done to keep keys from leaking:

- Requests to an upstream do not follow redirects, so the `Authorization` header cannot be carried to another host.
- If an upstream echoes the credentials of the request in an error message, they are replaced by `***` before the message is shown or stored.
- If an upstream quotes a presigned storage URL back in an error, the values of its `X-Amz-*` query parameters (the signature among them) are replaced by `***` before the error is shown or stored.
- Unexpected errors are logged on the server and answered with a generic message.

The stock Compose file runs MongoDB without authentication, reachable only from the app container. If you use an external MongoDB, give it authentication and TLS and put the credentials in `MONGODB_URI`.

## Browser-side protections

- Pages are served with a `Content-Security-Policy`. Scripts: `script-src 'self'` plus the SHA-256 hash of the one inline script in the built `index.html` (it sets the theme before anything paints); no `'unsafe-inline'` and no `'unsafe-eval'` for scripts. Also `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` and `frame-ancestors 'self'`. Styles allow `'unsafe-inline'` for the style attributes the UI libraries set.
- Images, media and fetches (`img-src`, `media-src`, `connect-src`) are allowed from any `http(s)` origin on purpose, because a canvas shows results from object storage, CDNs and pasted links, and downloads them in the browser. The origin of every public base URL in the storage settings is listed explicitly as well, and the list follows the settings without a restart. Today that changes nothing, since any origin is allowed; it keeps those origins allowed if the open sources are ever tightened.
- The web build is made so that it needs no `eval` (`__INTLIFY_JIT_COMPILATION__` in `web/vite.config.ts`, for vue-i18n).
- If you serve the web build from another server than this one (your own nginx, a CDN), that server has to send an equivalent policy itself; the one above is only added by the LoomCanvas server.
- API responses carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and are `no-store`.
- `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin` and a `Permissions-Policy` that turns off camera, microphone, geolocation, payment and USB are set on every response.
- `Strict-Transport-Security` is not set by the app; see [HTTPS](#https).
- Authentication uses a bearer token in a header, not a cookie, so cross-site request forgery does not apply. `CORS_ORIGIN` is empty by default: no other origin may call the API from a browser.

## What LoomCanvas does not do

- **Content moderation.** Prompts and results are not screened. Whatever filtering exists is the upstream's. You are responsible for what you generate and publish, and for complying with your provider's terms and local law.
- **Multi-tenant isolation.** All data belongs to one user. It is not safe to give the password to mutually untrusted people, and it is not a base for a shared service without your own isolation layer.
- **Accounts, roles, single sign-on, two-factor authentication.**
- **Audit logging.**
- **Private or expiring file URLs.** A bucket can be private, but `/files/<key>` in front of it is public and does not expire.
- **Encryption of files or of the database** (beyond provider keys and the storage secret). Encryption at rest in a bucket is the storage vendor's feature.
- **Spending limits.** A person with access can start as many runs as the queue allows (up to 500 unfinished at a time). To cap spending, use a [billing hook](billing-hook.md) and the limits your upstream provider offers.
- **Protection against a malicious upstream**, beyond the download guard and content checks. Whatever you send to a provider (prompts, reference media) is in that provider's hands.

## Related

- [Deployment](deployment.md): reverse proxy, backups, upgrades.
- [Configuration](configuration.md): every variable mentioned here.
- [Storage](storage.md): private buckets, delivery, presigned URLs.
- [SECURITY.md](../SECURITY.md): how to report a vulnerability.
