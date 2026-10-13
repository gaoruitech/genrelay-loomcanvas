# Storage

[简体中文](storage.zh-CN.md)

Where uploaded and generated files are kept, how to move that to an S3-compatible bucket, and what happens to existing files when you do.

## Overview

- By default files are kept on the **local disk**, in `STORAGE_LOCAL_DIR` (the `app_data` volume with Docker Compose). Nothing has to be configured.
- The alternative is **one S3-compatible driver**. It speaks to AWS S3 and to services that implement the S3 API: Cloudflare R2, Aliyun OSS, MinIO and others. What differs between vendors is a handful of explicit options (endpoint, region, path-style addressing, ACL), described [per vendor](#recipes-per-vendor) below.
- Every stored file has **one address** on every backend: the site-relative `/files/<key>`. The app answers that address itself and finds the file wherever it is, so canvases do not change when storage does.
- The bucket can stay **private**. No public access and no CORS configuration are needed unless you choose to let browsers load files straight from a public domain ([delivery](#private-or-public-bucket-the-two-delivery-modes)).
- The S3 SDK (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`) is a regular dependency of `server/` and is in the Docker image. It is loaded the first time an S3 backend is used.

Read [What has been tested](#what-has-been-tested) before relying on a particular vendor.

## How to configure it

### Settings → Storage

Open **Settings → Storage**, fill in the **S3-compatible object storage** form, click **Test connection**, then **Save and switch to object storage**. The change takes effect immediately, without a restart. Uploads that are under way finish on the backend they started with. **Switch back to local disk** on the same tab goes the other way.

The same can be done over HTTP: see [API](api.md#storage).

### Environment variables

`STORAGE_DRIVER` and the `S3_*` variables ([reference](#environment-variable-reference)) are a bootstrap default: they decide the storage of an instance on which nothing was ever saved under Settings → Storage. They are read once at startup. With `STORAGE_DRIVER=s3` the server refuses to start when `S3_BUCKET`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` is empty or when a value is not valid; it does not contact the bucket at startup.

The bucket that the `S3_*` variables describe is also **read**, whatever `STORAGE_DRIVER` says and whatever is saved on the settings page: an install that kept its files there and then went back to the local disk keeps them. That takes `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`; with one of them empty the variables describe no bucket. If they are complete but not valid while `STORAGE_DRIVER` is not `s3`, the server starts, says so in the log (`[storage] the S3_* variables are set but not used: …`) and does not read the bucket. To stop reading the bucket, remove the variables.

### Precedence

1. The configuration **saved on the settings page** (a document in the `settings` collection of the database, key `storage`).
2. Otherwise the **environment** (`STORAGE_DRIVER`, `S3_*`).
3. Otherwise the **local disk**.

**Settings → Storage** shows where the active choice comes from: "Saved here", "From environment variables" or "Default". Once something has been saved on the page, including "local disk", the environment no longer decides where new files go. The form starts from the saved S3 configuration, or from the environment's when nothing was saved.

The startup log line says the same: `storage: s3 from settings` or `storage: local from environment`.

## The fields

| Field (API name) | Meaning |
| --- | --- |
| Storage (`driver`) | `local` ("Local disk") or `s3` ("S3-compatible object storage"). |
| Provider preset (`preset`) | `aws`, `r2`, `oss`, `minio` or `custom`. Only a label that pre-fills hints in the form. It changes nothing about how requests are made. |
| Endpoint (`endpoint`) | Address of the S3 API: `http(s)://host[:port]`, without a path. Leave it empty for AWS S3; the address is then derived from the region. It is the address of the **service**, not of the bucket: an endpoint that starts with the bucket name is refused. |
| Region (`region`) | Default `us-east-1`. Lowercase letters, digits and hyphens. |
| Bucket (`bucket`) | 3 to 63 lowercase letters, digits, dots and hyphens. The bucket must exist; the app does not create it. |
| Access Key ID (`accessKeyId`) | Required. |
| Secret Access Key (`secretAccessKey`) | Write-only. It is encrypted with `SECRET_KEY` (AES-256-GCM, like provider keys) before it is stored and never returned; the page shows that one is set and its last four characters. Leaving the field empty keeps the stored secret. |
| Path-style addressing (`forcePathStyle`) | On: `https://host/bucket/key`. Off: `https://bucket.host/key`. MinIO and most self-hosted services need it on; AWS S3, R2 and OSS take it off. |
| Key prefix (`keyPrefix`) | Optional folder inside the bucket, for example `loomcanvas` or `apps/canvas`. Letters, digits, `_`, `-` and `.`, with `/` between folders. Every object is stored as `<prefix>/<key>`. |
| Public base URL (`publicBaseUrl`) | Optional. An `http(s)` address under which anyone can read the bucket: a custom domain, a CDN, an `r2.dev` address. It has to map to the **root of the bucket**; the key prefix is appended to it. A path is allowed (`http://minio.example.com:9000/my-bucket`). |
| Endpoint for signed URLs (`presignEndpoint`) | Optional. The address the same S3 service has **from the internet**, `http(s)://host[:port]` without a path, for when the endpoint above only works inside your network (`http://minio:9000`). It is used for one thing: the signed addresses handed to upstream models are made for it. The app itself keeps talking to the endpoint, and never contacts this address. A reverse proxy at this address has to pass the `Host` header on unchanged, because the signature covers the host name. Enter it in the **Access and delivery** group of the form under **Settings → Storage**, or set it with `S3_PRESIGN_ENDPOINT` or through the [API](api.md#storage). See [Reference media](#reference-media-for-upstream-models). |
| File delivery (`delivery`) | `proxy` ("Served by this site"): the app serves the bytes. `redirect` ("Redirect to the public address"): `/files/<key>` redirects the browser to the public base URL. Default: `redirect` when a public base URL is set, otherwise `proxy`. `redirect` needs a public base URL. See [below](#private-or-public-bucket-the-two-delivery-modes). |
| Object ACL (`acl`) | Empty ("Unset", the default), `private` or `public-read`. When empty, no ACL header is sent at all. Leave it empty unless your service needs a per-object ACL to make objects public: R2 has no object ACLs, and AWS buckets have ACLs disabled by default. |

Things the driver always does, whatever the vendor:

- Objects are written with their `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`. Keys are never reused.
- Checksums are only sent when the API requires them (`requestChecksumCalculation` and `responseChecksumValidation` are `WHEN_REQUIRED`). Recent AWS SDK versions otherwise add CRC32 `x-amz-checksum-*` headers to every upload, which several compatible services reject.
- A buffer is written with one `PutObject`. A stream of unknown length (a generated video) is written as a multipart upload, which is aborted when the source fails.

## Connection test

**Test connection** under **Settings → Storage** (and `POST /api/admin/storage/test`) makes a real round trip with the values in the form, before anything is saved:

| Step | What happens |
| --- | --- |
| `put` | A small text object is written under `probe/` (inside the key prefix). |
| `head` | Its size is looked up. Then a key that does not exist is looked up: the service has to answer "not found". A credential that may not list the bucket gets "forbidden" instead, and the test says so. |
| `get` | The object is read back and compared byte by byte. |
| `public` | Only with `redirect` delivery: the object is loaded from the public base URL without credentials and compared. |
| `delete` | The object is deleted. This step runs whenever something was written, also after a failure in between. |

The result lists each step as `ok`, `failed` or `skipped`, with one sentence that says what to change. The sentences are explained under [Troubleshooting](#troubleshooting). The test gives up quickly: 6 seconds to connect, 12 seconds per request, no retries. Both are hard limits: a service that accepts the connection and then says nothing fails the step it was asked for, it does not hang the test.

Saving an S3 configuration runs the same test first. If it fails nothing is saved, unless you confirm with **Save anyway**.

The server contacts the endpoint and the public base URL you typed. These addresses are deliberately not subject to the SSRF guard; see [Security](security.md#ssrf-protection).

## Recipes per vendor

Only MinIO has been run against a live service. The other recipes follow each vendor's published S3-compatibility documentation; see [What has been tested](#what-has-been-tested).

### MinIO

Tested.

| Field | Value |
| --- | --- |
| Endpoint | `http://minio:9000` (the address the LoomCanvas server reaches MinIO at) |
| Region | `us-east-1` |
| Path-style addressing | **on** |
| Bucket | an existing bucket |
| Access key | a MinIO access key with read, write, delete and list on the bucket |

A private bucket works with `proxy` delivery; nothing else is needed.

For `redirect` delivery make the bucket readable anonymously and point the public base URL at it:

```bash
mc anonymous set download ALIAS/BUCKET
```

Public base URL: `http://<host browsers can reach>:9000/BUCKET`.

MinIO next to the app with Docker Compose, in a `docker-compose.override.yml`:

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

Create the bucket and an access key for the app in the MinIO console or with `mc`, then enter them under Settings → Storage with the endpoint `http://minio:9000`.

Note on reference media: an endpoint such as `http://minio:9000` only works inside the Docker network, and upstream models on the internet cannot download from it. The app never hands out that address, nor a signed address made from it. Reference images then go inline to the models that take them. Inputs that must be a URL (a source video, reference images of some models) go through `PUBLIC_URL` when that is your public address, and are refused before the run starts when it is not.

To let upstreams load files straight from MinIO instead, publish MinIO's S3 port under a public name through your reverse proxy, and set that name as the endpoint for signed URLs: **Endpoint for signed URLs** under **Settings → Storage → Access and delivery**, or `S3_PRESIGN_ENDPOINT=https://s3.example.com`, or `presignEndpoint` through the API. The proxy has to keep the `Host` header, or every signed address answers `SignatureDoesNotMatch`. With nginx:

```nginx
location / {
  proxy_set_header Host $http_host;
  proxy_pass http://minio:9000;
}
```

See [Reference media for upstream models](#reference-media-for-upstream-models).

### AWS S3

S3-compatible, configured as follows, untested against the live service. Please report problems.

| Field | Value |
| --- | --- |
| Endpoint | empty |
| Region | the bucket's region, for example `eu-west-1` |
| Path-style addressing | off |
| ACL | empty |

IAM policy for the access key:

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

Why `s3:ListBucket`: without it S3 answers `403 Forbidden` instead of `404 Not Found` for an object that does not exist. The storage layer finds files by asking each backend whether it has the key, so it has to be able to tell "not here" from "could not check". The connection test detects the missing permission and names it.

"Block Public Access" can stay on with `proxy` delivery. For `redirect` delivery put CloudFront or another public domain in front of the bucket and use its address as the public base URL.

### Cloudflare R2

S3-compatible, configured as follows, untested against the live service. Please report problems.

| Field | Value |
| --- | --- |
| Endpoint | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| Region | `auto` |
| Path-style addressing | off |
| ACL | empty (R2 has no object ACLs) |
| Access key | an R2 API token with **Object Read & Write** on the bucket; use its Access Key ID and Secret Access Key |

An R2 bucket is private at its S3 endpoint. It can be made public only through an `r2.dev` subdomain (meant for development) or a custom domain. For `redirect` delivery enable one of them and enter it as the public base URL. For `proxy` delivery leave the bucket private.

### Aliyun OSS

S3-compatible, configured as follows, untested against the live service. Please report problems.

| Field | Value |
| --- | --- |
| Endpoint | `https://oss-<region>.aliyuncs.com`, for example `https://oss-cn-hangzhou.aliyuncs.com`. **Not** the bucket's own domain (`my-bucket.oss-cn-hangzhou.aliyuncs.com`). |
| Region | `oss-cn-hangzhou` (the same region id as in the endpoint) |
| Path-style addressing | **must be off**. OSS refuses path-style requests (`SecondLevelDomainForbidden`); the connection test reports that as "turn path-style addressing off". |
| ACL | empty, or `public-read` if you want objects public while the bucket is private |
| Access key | the AccessKey of a RAM user allowed `oss:PutObject`, `oss:GetObject`, `oss:DeleteObject`, `oss:AbortMultipartUpload` and `oss:ListObjects` on the bucket |

Things we could not verify:

- If OSS rejects the signature with this region, try the region id without the `oss-` prefix (`cn-hangzhou`), and tell us which one worked.
- The internal endpoint (`oss-cn-hangzhou-internal.aliyuncs.com`) only works from Aliyun's network. Signed addresses given to upstream models are built from the configured endpoint, so with the internal endpoint an upstream on the internet cannot load them.
- Aliyun documents that some file types are served as downloads from a bucket's default domain. If you use `redirect` delivery, a custom domain bound to the bucket is the safer public base URL.

The former `oss` driver is gone; see [Migrating from STORAGE_DRIVER=oss](#migrating-from-storage_driveross).

### Other S3-compatible services

Backblaze B2, Tencent COS, Wasabi and so on: choose the **Other S3-compatible service** preset and fill in the endpoint, region and addressing style from the vendor's S3-compatibility page. None of them has been tested. The connection test tells you quickly whether the combination works.

## Private or public bucket: the two delivery modes

`/files/<key>` is always the address of a file. What the app does when a browser asks for it depends on where the file is:

- On the local disk: read from disk.
- In a bucket with `proxy` delivery: streamed out of the bucket by the app.
- In a bucket with `redirect` delivery: answered with `302` to `<public base URL>/<key prefix><key>`.

| | `proxy` ("Served by this site") | `redirect` ("Redirect to the public address") |
| --- | --- | --- |
| Who sends the bytes | The LoomCanvas server, streaming from the bucket. Nothing is buffered. | The bucket's public domain or the CDN in front of it. |
| Bucket visibility | Private. No public access needed. | Objects must be readable without credentials at the public base URL. |
| CORS configuration on the bucket | None. | None required for display: images and videos load across origins without CORS. In-browser downloads and edits fall back to the app's download proxy when the bucket sends no CORS headers; allowing `GET` from your site's origin only lets those go direct. |
| Traffic | Every view goes bucket → server → browser. You pay egress from the bucket to the server and from the server to the visitor. | The server only answers a small redirect. File traffic goes from the public domain to the visitor. |
| Caching | `Cache-Control: public, max-age=31536000, immutable`, `ETag` and `Last-Modified` from the bucket. `If-None-Match` gives `304`. A CDN or reverse-proxy cache in front of the app can cache `/files/*`. | The redirect itself is cacheable for 5 minutes (`Cache-Control: public, max-age=300`). The object is cached according to what the public domain sends; objects are stored with the one-year `Cache-Control`. |
| Range requests (video seeking) | Passed to the bucket; the answer (`206`, `416`) is passed back. A request with several ranges gets the whole file. | Handled by the public domain. |
| Needs | Nothing beyond the credentials. | A public base URL. |

In both modes `/files/*` itself stays public by design: keys contain 128 random bits and cannot be listed or guessed. With `proxy` delivery the responses carry the same hardening headers as local files (content type from the key's extension, `X-Content-Type-Options: nosniff`, a sandboxing `Content-Security-Policy`, `Content-Disposition: attachment` for anything that is not an image, video or audio). With `redirect` delivery the headers are whatever the public domain sends. See [Security](security.md#what-is-public).

A file that no storage has answers `404`. A file that may be in a storage which cannot be asked right now answers `503`, with `Retry-After: 30`, `Cache-Control: no-store` and a JSON body whose `code` is `storage.unreachable`: the file may well exist, and nothing should remember the failure. See [When a storage cannot be reached](#when-a-storage-cannot-be-reached).

### CDN or custom domain

Two ways to put a CDN in front:

- **In front of the bucket** (`redirect` delivery): a custom domain or CDN that reads the bucket. Enter its address as the public base URL. It has to map to the root of the bucket, so that `<public base URL>/<key prefix><key>` is the object.
- **In front of the app** (`proxy` delivery, or local disk): a CDN or caching reverse proxy for the whole site. `/files/*` responses are immutable and may be cached for a year; `/api/*` responses are `no-store`.

The origin of every configured public base URL is listed in the page's `Content-Security-Policy` (`img-src`, `media-src`, `connect-src`), and follows the storage settings without a restart.

### Bucket permissions

The credential needs, on the bucket and under the key prefix:

| Permission | Used for |
| --- | --- |
| Put object | Uploads, results, thumbnails. |
| Get object | Serving files, reading reference media, zip downloads, signed addresses. |
| Delete object | Result retention, cleaning up after the connection test. |
| Abort multipart upload | Cleaning up when a streamed upload (a video) fails. |
| List bucket | So that a missing object is reported as "not found" instead of "forbidden" (AWS S3; see [the recipe](#aws-s3)). Nothing is ever listed. |

Not needed: creating or deleting buckets, changing bucket settings, object ACLs (unless you set the ACL field). A lifecycle rule that removes incomplete multipart uploads is a reasonable safety net on any bucket.

## What happens when you switch

**Files are not moved or copied.** There is no migration tool in this version. Switching changes where **new** files go. Existing files stay where they are and keep loading, because the storage layer does not record where a file was written: it looks the key up.

For a key it has not seen, the app asks the local disk first (a `stat`), then the bucket in use (a `HEAD`). Only when the file is in neither does it ask the other buckets it knows, all of them at once. It remembers the answer in memory. Keys are written once and never moved, so the answer stays valid. A file on the disk or in the bucket in use is therefore found without any other bucket being contacted.

Backends that are read:

| Backend | Read as long as |
| --- | --- |
| The local disk (`STORAGE_LOCAL_DIR`) | Always. |
| The S3 configuration saved on the settings page | Always, also while the driver is set back to local disk. |
| Up to 5 earlier saved buckets | They are remembered automatically when you save a configuration that points somewhere else (another endpoint, bucket or key prefix). **Settings → Storage** lists them. The sixth-oldest is dropped. One that is gone for good can be [taken off the list](#when-a-storage-cannot-be-reached). |
| The bucket of the `S3_*` variables | As long as `S3_BUCKET`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are set, whatever `STORAGE_DRIVER` says. When it is the same place (endpoint, bucket and key prefix) as a saved bucket, the two are one bucket and it is asked once. |

So:

- Local disk → S3: files uploaded before the switch are still served from the disk. **Do not delete the local directory or the volume.**
- S3 → local disk, or one bucket → another: files in the old bucket are still served from it. **Do not delete the bucket, revoke its key or remove the `S3_*` variables** while canvases use those files.
- Changing only the credentials, the region or the addressing style of the same endpoint, bucket and prefix is not a switch; the new values replace the old.
- Thumbnails are written to the backend that holds their source image, whichever backend is active.
- Result retention, zip downloads, canvas tools, "fetch from URL" and the asset library all go through the same lookup and work with files on any readable backend. Deleting a file from an earlier bucket needs delete permission there.

What breaks when the old place is gone: the canvases, assets and share links that point at those files show broken images, and runs that use them as reference media fail, saying that the storage cannot be reached.

### When a storage cannot be reached

A bucket that is only read - an earlier one, the saved one while the local disk is in use, the one from the `S3_*` variables - may be down or gone. That does not get in the way of anything that is somewhere else:

- Files on the local disk and in the bucket in use are found first, so they load at their usual speed, thumbnails included.
- For a file that is in neither, the other buckets are asked together, and each has 3 seconds to say whether it has the file.
- A bucket that does not answer (connection refused, host not found, no reply in time, TLS failure) is remembered as down for 30 seconds. During that time it is not contacted at all. Then one request is let through to find out. The server log has one `[storage]` line when a bucket goes down, one per period while it stays down, and one when it is back; nothing per request.
- A bucket that answers with a refusal (its key was revoked) is asked again every time: it answers fast.

What a request for a file gets:

| The file | Answer |
| --- | --- |
| is on the disk, or in a bucket that answers | The file. |
| is found nowhere, and every storage answered | `404`. |
| is found nowhere, and a storage that might have it could not be asked | `503` with `code: storage.unreachable`, `Retry-After: 30` and `Cache-Control: no-store`. The message names no host and no bucket, because file addresses are public; which storage it was is in the server log and under **Settings → Storage**. |

Thumbnails follow the same rule. A thumbnail lives next to its image, so one that does not exist yet is made as long as the image can be read, whatever state other buckets are in. When the image itself may be in a storage that is down, the thumbnail answers `503` too; that answer is not cached, and neither is the redirect to the full image that is sent when a thumbnail cannot be stored.

Through the API the same `503 storage.unreachable` comes back wherever a stored file is read (fetch by URL, canvas tools, zip downloads). A run whose reference image or video cannot be read that way fails with this message before anything is sent to the upstream.

If the bucket **in use** is down, uploads and results fail with `503 storage.write_failed`, files on the local disk keep loading, and the first upload that succeeds marks the bucket as back.

**Deleting an account or a team** removes its files from every storage at the same time. The request waits 4 seconds at most. A bucket that needs longer is finished in the background, and one that cannot be reached is tried again every 10 minutes. What is still owed is kept in the database (a document in `settings`, key `storageCleanup`), so it survives a restart. After 30 days without success the server logs which key prefixes to remove by hand and stops trying. In the API answer, `filesRemoved: false` means that not everything is gone yet.

**Result retention** works the same way: a result whose file may be in a storage that cannot be reached is not written off as cleaned. It is tried again at every sweep, for 30 days.

On the **Current status** card at the top of **Settings → Storage**, **Stores that are read** lists every place a file is looked for, with its state: "OK", "Unreachable (since …)" or "Secret unreadable" (`buckets` in [the API](api.md#storage): `ok`, `unreachable`, `secret_unreadable`). While a store cannot be reached the card refreshes itself every 10 seconds; **Refresh** does it at once. Each refresh asks the buckets (`GET /api/admin/storage?probe=1`): a bucket that came back is shown as back, and one that stopped answering as unreachable, without waiting for somebody to request a file from it. It takes 4 seconds at most, however many buckets hang. As long as a dead bucket is on the list, a file that is found nowhere answers `503` instead of `404`, because it might be there. A bucket that is gone for good should therefore be taken off the list: **Stop reading** on its row, and confirm (`DELETE /api/admin/storage/buckets/:id` in the API). Its files stop loading; nothing is deleted from the bucket. The bucket of the `S3_*` variables is dropped by removing the variables.

Addresses stored by earlier versions: before this change the S3 driver stored absolute addresses, `<S3_PUBLIC_BASE_URL>/<key>`. Canvases that contain them are not rewritten. The server still recognises such an address as its own file as long as the same public base URL is part of a configured backend, and browsers keep loading it directly from that domain, so the domain has to stay public for those canvases.

### Copying the files yourself

Because files are found by looking, files you copy are found wherever they are. Keep the keys the same:

- An object's name in the bucket is `<key prefix><key>`.
- A file's key on the local disk is its path relative to `STORAGE_LOCAL_DIR` (for example `outputs/<account id>/2026/10/9a…7e.png`; files stored before accounts existed have no account segment, and their keys stay valid).

For example, local disk to a bucket (with Docker, the directory is `/app/data/files` in the `app_data` volume):

```bash
rclone copy /path/to/data/files remote:BUCKET/PREFIX
# or
mc mirror /path/to/data/files ALIAS/BUCKET/PREFIX
```

Notes:

- The local disk is asked first. A copied file is served from the bucket once it is no longer on the disk.
- Copy `thumbs/` as well, or thumbnails are made again on first request.
- With `redirect` delivery the public domain serves the `Content-Type` stored with the object, so make sure your copy tool sets it. With `proxy` delivery the type comes from the key's extension.
- After moving objects from one bucket to another, restart the server: the location of a file in a bucket is remembered in memory, and a moved file would otherwise fail once before it is looked up again.
- These commands are examples. They have not been run as part of this project.

## Reference media for upstream models

When a node sends a reference image or a source video to a model, the upstream has to read the file. The app hands over the first of these that an upstream on the internet can open:

1. For a file in a bucket with `redirect` delivery: its public address (`<public base URL>/<key prefix><key>`).
2. For a file in a bucket: a **presigned GET URL**, valid for 1 hour. It is made for the endpoint for signed URLs (`presignEndpoint`, `S3_PRESIGN_ENDPOINT`) when one is set, otherwise for the endpoint.
3. For any file: `<PUBLIC_URL>/files/<key>`, served by the app.

If none of them qualifies, images are sent inline as base64 to providers that accept that, and inputs that must be a URL (reference images of the Gaorui image models, a source video, a video given to a chat model, reference images of some video models) are refused with `media.needs_public_url` before anything is sent. Which provider uses which form is in [Providers](providers.md#how-media-reaches-the-upstream).

### What counts as reachable

One rule, applied to `PUBLIC_URL`, to the public base URL and to the endpoint a signed URL is made for. It looks at the address only; nothing is resolved or contacted. Not reachable:

- anything that is not `http(s)`, and an address that carries a user name or password;
- `localhost` and every other host name of a single label, such as `minio` or `storage`: a container or machine name only resolves inside its own network;
- literal loopback, private, link-local and other reserved IP addresses (`127.0.0.1`, `10.x`, `172.16`-`172.31`, `192.168.x`, `169.254.x`, `fc00::/7` and so on);
- names ending in `.localhost`, `.local`, `.internal`, `.test`, `.home.arpa`, `.lan`, `.home`, `.corp`, `.intranet`, `.private` or `.svc`.

For a signed URL it is the endpoint that is judged, not the URL: with virtual-hosted addressing the URL's host is `<bucket>.<endpoint host>`, and `my-bucket.minio` would otherwise pass for a domain.

`SSRF_ALLOW_HOSTS` has no say in this. It lists what the server may download from; that the server can reach a host on its own network does not mean an upstream can.

So:

- **A bucket on the internet** (AWS S3, R2, OSS with its public endpoint): reference media by URL works without `PUBLIC_URL` and without a public bucket.
- **A bucket inside your network** (MinIO in the same Compose file, an internal OSS endpoint, a private IP address): its address is never given to an upstream. Either set `PUBLIC_URL` to your public address, and files reach the upstream through the app; or publish the S3 API under a public name and set the endpoint for signed URLs. The reverse proxy in front of it has to keep the `Host` header (see the [MinIO recipe](#minio)). This is tested against MinIO: a signed URL made for the public name loads through a proxy that keeps `Host`, and answers `403 SignatureDoesNotMatch` through one that replaces it.
- **An internal name the rule cannot recognise** (a Kubernetes name of two labels such as `minio.storage`): set the endpoint for signed URLs. When it is set it decides, whatever the endpoint looks like.

The canvas says so before a run when a model that only takes URLs cannot be given a file (`media.upstreamByUrl` in `GET /api/bootstrap`). On the **Current status** card under **Settings → Storage**, the row **Handed to upstream models** says which way applies to files stored now: "Public address", "Temporary signed URL", "Through this site" or "Sent inline" (`upstream` in `GET /api/admin/storage`: `public_base`, `signed`, `app`, `inline`). With "Sent inline" it lists which nodes are affected and what to configure.

Presigned URLs are made for one upstream request. They are never stored in canvases, share links or run records. If an upstream quotes one back in an error message, the values of its `X-Amz-*` query parameters are blanked before the error is stored or shown.

Limits you should know:

- A presigned URL carries a signature that lets anyone who has it read that one object for an hour. It is sent to the upstream provider you chose.
- Files on the local disk can only go through `PUBLIC_URL`. See [Deployment](deployment.md#public_url).

## Backups

| Storage | What to back up |
| --- | --- |
| Local disk | `STORAGE_LOCAL_DIR` (the `app_data` volume), together with the database. Commands are in [Deployment](deployment.md#backups). |
| S3 | The bucket, with the vendor's tools: versioning, replication, lifecycle rules. LoomCanvas does none of that. |
| After a switch | Every place that still holds files: the old one and the new one. |

The saved storage configuration, including the encrypted secret and the earlier buckets, lives in MongoDB. Restoring the database brings it back, and it needs the same `SECRET_KEY` to be usable.

If `SECRET_KEY` changes, the saved S3 secret cannot be decrypted. The server starts, and logs it. The bucket stays the configured storage, but it cannot be used:

- Its files answer `503` (`storage.unreachable`). Files on the local disk keep loading.
- **Settings → Storage** says that the secret has to be entered again, and its **Enter the secret again** button takes you straight to the Secret Access Key field (`secretUnreadable: true` in the API).
- When it is the bucket in use, new files are refused with `503 storage.secret_unreadable` (`writable: false` in the API): uploads at once, and image and video runs before anything is sent to the upstream. Everybody who is signed in is told before they try (`media.writable: false` in `GET /api/bootstrap`): image and video nodes on the canvas say so before a run. On the settings page **Handed to upstream models** then reads "Not possible right now" (`upstream: unavailable`): the thing to put right is the secret, not an address.

New files are deliberately **not** written to the local disk or to the environment's bucket instead. That would scatter files onto a disk that may be neither kept nor backed up and that other instances of the app cannot see. And with `SECRET_KEY` changed no provider key can be decrypted either, so nothing can be generated until an administrator has been there anyway.

To get out of it, put the old `SECRET_KEY` back, or enter the secret again under **Settings → Storage** (and the provider keys under **Models**: the card of a provider whose key cannot be read shows "Key unreadable" and an **Enter the key again** button; in the API it is marked `keyUnreadable` and refuses runs with `provider.key_undecryptable`. Team members only see "Unavailable for now. Ask the team owner or an admin"). Two special cases:

- If the same bucket (endpoint, bucket and key prefix) is also described by the `S3_*` variables, their secret is used and nothing stops. The page still asks for the secret.
- Switching to the local disk on the settings page needs no secret. New files are stored again; the bucket's own files stay unavailable until its secret is entered.

Earlier buckets whose secret cannot be read stay on the list as unavailable. Take them [off the list](#when-a-storage-cannot-be-reached) if they are no longer needed.

## Environment variable reference

Bootstrap defaults; a configuration saved under Settings → Storage overrides them. The bucket they describe stays readable in any case (see [Environment variables](#environment-variables)).

| Variable | Default | Meaning |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local` or `s3`. `oss` stops the server at startup with a message that says how to migrate. |
| `STORAGE_LOCAL_DIR` | `./data/files` | Directory of the local disk backend. Relative paths are resolved against `server/`. Always used, also for reading files stored before a switch. |
| `S3_ENDPOINT` | empty | Endpoint of the S3 API, without a path. Empty means AWS S3, derived from the region. |
| `S3_REGION` | `us-east-1` | Region. Use `auto` for R2. (Earlier versions defaulted to `auto`.) |
| `S3_BUCKET` | empty | Bucket name. Required for `s3`. |
| `S3_ACCESS_KEY_ID` | empty | Required for `s3`. |
| `S3_SECRET_ACCESS_KEY` | empty | Required for `s3`. |
| `S3_FORCE_PATH_STYLE` | off | `1`, `true` or `yes` turns on path-style addressing (MinIO). |
| `S3_KEY_PREFIX` | empty | Optional folder inside the bucket. |
| `S3_PUBLIC_BASE_URL` | empty | Optional. Custom domain, CDN or `r2.dev` address that maps to the root of the bucket, no trailing slash. (Earlier versions required it.) |
| `S3_PRESIGN_ENDPOINT` | empty | Optional. The address the S3 service has from the internet, without a path, when `S3_ENDPOINT` only works inside your network. Signed addresses for upstream models are made for it; a reverse proxy there has to keep the `Host` header. |
| `S3_DELIVERY` | see meaning | `proxy` or `redirect`. Default: `redirect` when `S3_PUBLIC_BASE_URL` is set, otherwise `proxy`. |
| `S3_ACL` | empty | Empty, `private` or `public-read`. Empty sends no ACL header. |

## Migrating from STORAGE_DRIVER=oss

The `oss` driver, the `ali-oss` package and every `OSS_*` variable have been removed. With `STORAGE_DRIVER=oss` the server exits at startup with a message, in English and Chinese, that says what to set instead. Aliyun OSS is now reached through its S3-compatible API.

| Before | Now |
| --- | --- |
| `STORAGE_DRIVER=oss` | `STORAGE_DRIVER=s3` |
| `OSS_REGION=oss-cn-hangzhou` or `OSS_ENDPOINT=…` | `S3_ENDPOINT=https://oss-cn-hangzhou.aliyuncs.com` and `S3_REGION=oss-cn-hangzhou` |
| `OSS_BUCKET` | `S3_BUCKET` |
| `OSS_ACCESS_KEY_ID` | `S3_ACCESS_KEY_ID` |
| `OSS_ACCESS_KEY_SECRET` | `S3_SECRET_ACCESS_KEY` |
| `OSS_PUBLIC_BASE_URL` | `S3_PUBLIC_BASE_URL` (now optional) |
| | `S3_FORCE_PATH_STYLE` unset (off) |
| `EXTRA_NPM_PACKAGES=ali-oss` and `npm install ali-oss` | Nothing. Remove them. |

Or remove the variables altogether, start on the local disk and enter the same values under Settings → Storage, where the connection test checks them.

Keep `S3_PUBLIC_BASE_URL` at the old value of `OSS_PUBLIC_BASE_URL` if canvases were saved with the `oss` driver: they contain absolute addresses under that URL (see [What happens when you switch](#what-happens-when-you-switch)). The objects themselves do not have to move.

The old `oss` driver had never been run against a real bucket, and the S3 path to OSS has not either. See the [Aliyun OSS recipe](#aliyun-oss).

## Troubleshooting

What the connection test says, and what to do. The `code` is what the API returns next to the sentence.

| Message | `code` | What to check |
| --- | --- | --- |
| The host … cannot be found. Check the endpoint | `storage.err_host_not_found` | A typo in the endpoint, or a name this server cannot resolve (a Docker service name from outside its network). |
| The host … cannot be found. With path-style addressing off, the bucket name becomes part of the host name… | `storage.err_host_bucket_not_found` | Turn **path-style addressing on** (MinIO and other self-hosted services). |
| Could not connect to … | `storage.err_unreachable` | The endpoint, the port, a firewall, or the service is down. Also shown on a timeout. |
| The secure connection to … failed | `storage.err_tls` | `http://` versus `https://` in the endpoint, or a certificate this server does not trust (self-signed). |
| The service does not know this Access Key ID | `storage.err_access_key` | The Access Key ID, or a key that belongs to another account or endpoint. |
| The Secret Access Key is wrong (the signature does not match) | `storage.err_signature` | Paste the secret again. With Aliyun OSS, also see the note about the region in [its recipe](#aliyun-oss). |
| The clock of this server is too far off… | `storage.err_clock_skew` | Synchronise the system time (NTP). |
| There is no bucket named "…" at this endpoint | `storage.err_no_bucket` | The bucket name; the endpoint of another region or account. The app does not create buckets. |
| The region "…" does not match the bucket | `storage.err_region` | Set the region the bucket is in. |
| This service does not accept path-style addressing | `storage.err_path_style_refused` | Turn **path-style addressing off** (Aliyun OSS). |
| Access denied. The key needs permission to read, write and delete objects… | `storage.err_access_denied` | The policy of the key; a bucket policy that denies it; a wrong key prefix in a policy that is limited to a folder. |
| The key can read and write objects but may not list the bucket… | `storage.err_list_permission` | Grant `s3:ListBucket` on the bucket (see the [AWS recipe](#aws-s3)). |
| … answered, but not like an S3 API | `storage.err_not_s3` | The endpoint is a console, a website or a reverse proxy's error page, not the S3 API address. |
| The test object did not come back the way it was written | `storage.err_read_back` | Something between the server and the bucket alters or caches responses. |
| The object was stored, but … could not be loaded | `storage.err_public_unreachable` | The public base URL: its host name, port, certificate. Or switch delivery to `proxy`. |
| The object was stored, but … answers HTTP … without credentials | `storage.err_public_status` | The bucket or its domain does not allow public reads. Allow them, or switch delivery to `proxy`. |
| The object was stored, but … returned something else | `storage.err_public_mismatch` | The public base URL points at another bucket, or not at the root of this one (remember the key prefix is appended). |
| The storage service refused the request: … | `storage.err_other` | Anything else; the service's own code and words follow. |

Refused before the test runs (HTTP 400):

| `code` | Meaning |
| --- | --- |
| `storage.endpoint_has_path` | The endpoint has a path. Enter only `http(s)://host[:port]`. |
| `storage.endpoint_has_bucket` | The endpoint starts with the bucket name. Enter the address of the service and put the bucket in its own field. |
| `storage.bad_bucket` | Not a valid bucket name. |
| `storage.bad_key_prefix` | The key prefix contains characters other than letters, digits, `_`, `-`, `.` and `/`. |
| `storage.redirect_needs_public_url` | `redirect` delivery without a public base URL. |
| `storage.bucket_in_use` | The bucket to take off the list is the one new files go to. Switch storage first. |
| `storage.bucket_from_env` | The bucket to take off the list comes from the `S3_*` variables. Remove them and restart. |

A refusal about one field of the form says which one in `data.field` (`endpoint`, `publicBaseUrl`, `presignEndpoint`, `bucket`, …), and its message names the field as the page does. The settings page shows it under that field.

While the server runs (HTTP 503; `storage.bucket_not_found` is a 404):

| `code` | Meaning |
| --- | --- |
| `storage.unreachable` | A file that may exist could not be looked up or read: a storage that might hold it does not answer, refuses the credential, or its saved secret cannot be decrypted. See [When a storage cannot be reached](#when-a-storage-cannot-be-reached). |
| `storage.write_failed` | A file could not be stored: the storage in use cannot be reached or refused it (or the local disk is full or read-only). The server log has the cause. |
| `storage.secret_unreadable` | The saved secret of the bucket in use cannot be decrypted, so new files are refused. See [Backups](#backups). |
| `storage.bucket_not_found` | No bucket with that id is on the list. |

Other symptoms:

| Symptom | Cause |
| --- | --- |
| Files answer `503` | A storage that may hold the file (in use, saved, earlier, or from the `S3_*` variables) cannot be reached, refuses the credential, or has a secret that cannot be decrypted. The server log has a `[storage]` line that names it, and **Settings → Storage** shows its state. |
| A file that should be a `404` answers `503` | A bucket on the list is down, and the file might be in it. If that bucket is gone for good, [take it off the list](#when-a-storage-cannot-be-reached). |
| Uploads fail with "The file could not be stored" | The storage in use is down or refuses the write; see the `[storage]` line in the log. |
| Images of older canvases are broken after a switch | The old backend is gone: the local directory was removed, the old bucket deleted or its key revoked, or the `S3_*` variables removed. |
| **Settings → Storage** asks for the secret again, uploads answer `503` | `SECRET_KEY` changed; see [Backups](#backups). |
| The server exits with `STORAGE_DRIVER=s3 requires …` or `The S3_* storage settings are not valid` | A required variable is empty or a value is not valid. This only concerns the environment; a configuration saved on the settings page is not checked at startup. |
| "A publicly reachable URL is needed…" with S3 storage | The bucket's endpoint is inside your network (`http://minio:9000`, a private address) and `PUBLIC_URL` is not a public address either. Set `PUBLIC_URL`, or the endpoint for signed URLs; see [Reference media](#reference-media-for-upstream-models). |

## What has been tested

The S3 code path is verified against **MinIO**, which is a real S3 API. Automated tests in `server/test/storage.live.test.js` cover path-style and virtual-hosted addressing, a private bucket with proxy delivery and presigned URLs, a public bucket with redirect delivery, multipart upload, Range and ETag handling, thumbnails, switching between backends, and the settings API. They also cover signed URLs made for another host name (through a reverse proxy that keeps the `Host` header, and one that does not) and an earlier bucket that never answers. They run when `TEST_S3_ENDPOINT` and the related variables are set, and are reported as skipped otherwise; see [Development](development.md#live-s3-tests).

What happens when storage is in trouble is tested without any storage service, in `server/test/storageResilience.test.js` and `server/test/storage.e2e.test.js`: the S3 SDK talks over real sockets to an S3 API in memory, to a port that refuses connections and to a server that accepts them and never answers. That covers the lookup rules above, `404` versus `503`, thumbnails, deleting an account, a changed `SECRET_KEY`, the bucket of the `S3_*` variables, and what an upstream is given for a bucket with an internal address.

**Cloudflare R2, Aliyun OSS and AWS S3 have not been run against the live services.** Their settings above follow each vendor's published S3-compatibility documentation. Treat them as S3-compatible, configured as described, and untested, and please report what you find, working or not.

The copy commands (`rclone`, `mc mirror`) and the IAM and RAM policies on this page have not been exercised as part of the project either.
