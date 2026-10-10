# FAQ

[简体中文](faq.zh-CN.md)

Questions people running their own instance tend to hit. For questions about using the canvas, the in-app guide (the **?** button) has its own FAQ, and there is the [User guide](user-guide.md).

## Models and cost

### The node shows "Cost unknown"

The model has no price that matches the current parameters. LoomCanvas ships no prices: it cannot know what your upstream charges you.

1. Open **Settings → Models**, find the model, click **Set price**.
2. Enter the rate you actually pay. If the price depends on resolution or duration, choose that under "Price varies by" and fill in one row per tier.

A table that has no row for the chosen resolution or duration also gives "Cost unknown". Chat models priced per token show it before a run and get their cost afterwards, if the upstream reports token usage. You can always run a model without a price. Details: [Providers](providers.md#pricing).

### The model dropdown is empty, or says "No models available yet"

Check in this order:

1. **Settings → Providers**: is there a provider, and is it enabled? Click **Test connection**.
2. **Settings → Models**: are the models enabled?
3. Is the node the right kind? A Video edit node only lists video-edit models. OpenAI and Gemini providers offer no video models at all.
4. Language model node: it lists every enabled chat model. A Gaorui provider has five (three text only, two that read images); a chat model that is not in a provider's list can be added as a custom model under **Settings → Models**. With a text-only model selected, the node's image input is greyed out and connected images are not sent.
5. Video analysis node: it lists only chat models that accept a video. At present those are `gemini-3.5-flash-c` of a Gaorui provider and custom chat models of a Gaorui provider. OpenAI and Gemini chat models are never listed there.

The list does not depend on the upstream being reachable: it is the provider's own model list plus your custom models.

### A model I need is missing, or a wrong one is listed

Each provider has a fixed list of supported models that ships with LoomCanvas. Nothing is read from the upstream's model list and nothing is guessed from a model's name.

- Missing: go to **Settings → Models**, find the provider and click **Add custom model**. Enter the model name exactly as the upstream expects it and choose its type (Image or Chat). Custom video models cannot be added.
- Not wanted: disable it under **Settings → Models**.
- After upgrading from the previous version, a custom model may have the wrong type or a model you used may be missing; see [Upgrading from the previous version](providers.md#upgrading-from-the-previous-version).

### Running a node again: is it billed again?

Yes. Every run submits a new task to the upstream. The canvas asks for confirmation before re-running nodes that already have a result. Earlier results stay in the node's history.

### Do the amounts match my real bill?

Not necessarily. They are calculated from the prices you typed in, at the time the run was submitted (or from reported token usage for chat). The upstream's bill is the truth. A failed run counts as no spend here even if the upstream charged for it.

## Media

### Video edit fails with "A publicly reachable URL is needed…"

Some inputs can only be passed to the upstream as a URL: the source video of a video edit, reference images of some video models, and video in chat. The upstream must be able to download that URL from the internet.

Fix one of:

- Set `PUBLIC_URL` to your instance's public address (for example `https://canvas.example.com`) and make sure it is reachable from the internet; or
- keep files in an S3-compatible bucket that is reachable from the internet (**Settings → Storage**). A file in a bucket is handed to the upstream as a presigned URL that is valid for one hour, so neither `PUBLIC_URL` nor a public bucket is needed.

With `PUBLIC_URL`, files already on the canvas need no re-upload: their URL is site-relative and `PUBLIC_URL` is added when the file is handed to the upstream. Switching to a bucket does not move files that are already on the local disk; those still need `PUBLIC_URL`, or have to be uploaded again. `localhost` and private addresses never count as public. See [Providers](providers.md#how-media-reaches-the-upstream) and [Storage](storage.md#reference-media-for-upstream-models).

### Images are broken when I open the app from another computer

Files are stored with a site-relative URL (`/files/<key>`), on the local disk and in a bucket alike, and load from whatever address the app is opened at. So this should not happen with files stored by the current version, whatever `PUBLIC_URL` is.

It can still happen with canvases saved by an earlier version, which stored absolute URLs such as `http://localhost:3000/files/…`. The browser on the other computer cannot reach that address. Re-upload those files, or re-run the nodes. See [Deployment](deployment.md#public_url).

### How do thumbnails work, and why are some missing?

- Nodes show a small WebP thumbnail (longest edge 512 px) instead of the full image; opening or downloading always uses the original.
- Thumbnails are made when a file is uploaded or a result is stored. A missing one is also generated the first time it is requested, and kept. This works the same on the local disk and in a bucket; a thumbnail is stored next to its image.
- Only PNG, JPEG, WebP, BMP and AVIF images get one. Videos, GIFs and HEIC images do not; the original is shown.
- Small uploads (longest edge up to 512 px) are their own thumbnail.
- Images at external addresses, and images that canvases saved by earlier versions reference by an absolute bucket URL, have no derived thumbnail. They are shown from the original. That is slower, not broken.

### An upload fails or says the file is too large

Two limits apply, and the smaller wins:

| Limit | Default | Where |
| --- | --- | --- |
| Server, per file | 50 MB | `MAX_UPLOAD_MB`. The canvas reads this value from the server and refuses a larger file before uploading it. |
| Reverse proxy | varies (nginx: 1 MB unless configured) | `client_max_body_size` or equivalent |

A `413` that does not look like a LoomCanvas message comes from the proxy. Only image and video files are accepted, judged by their content.

### A result could not be downloaded: "Private network addresses are not allowed"

The upstream returned a result link that points at a private or loopback address, and the server refuses to fetch those. If the upstream is a model server on your own network, list its host in `SSRF_ALLOW_HOSTS` and restart. Read [Security](security.md#ssrf-protection) first.

## Storage

### Which storage should I use?

- **Local disk** (the default): nothing to set up. Right for one machine with enough disk. Back up the `app_data` volume.
- **An S3-compatible bucket** (AWS S3, Cloudflare R2, Aliyun OSS, MinIO…): when the disk is too small, when files should survive the machine, or when upstream models must fetch reference videos by URL and the instance has no public address.

Configure it under **Settings → Storage**. Details: [Storage](storage.md).

### Do I need a public bucket?

No. With the default `proxy` delivery the bucket stays private: the app reads it with its credentials and serves the files itself at `/files/<key>`. No public access and no CORS configuration are needed. A public domain is only needed if you choose `redirect` delivery, so that browsers load files straight from the bucket or its CDN. See [Storage](storage.md#private-or-public-bucket-the-two-delivery-modes).

Note that `/files/<key>` itself is public either way; see [Security](security.md#what-is-public).

### What happens to my files when I switch storage?

Nothing: they are not moved or copied, and there is no migration tool. New files go to the new place; files stored before stay where they were and keep loading from there, as long as that place still exists. Do not delete the local directory (or the `app_data` volume), and do not delete the old bucket or revoke its key. You can copy the files yourself if you want everything in one place. See [Storage](storage.md#what-happens-when-you-switch).

### Does it work with Cloudflare R2, Aliyun OSS, AWS S3?

They are S3-compatible and the settings for each are in [Storage](storage.md#recipes-per-vendor), but only MinIO has been run against a live service in this project. Use the connection test on the Storage tab, and please report what you find.

### I used `STORAGE_DRIVER=oss` and the server no longer starts

The `oss` driver was removed. Aliyun OSS is now used through its S3-compatible API with `STORAGE_DRIVER=s3`. The variables to rename are listed in [Storage](storage.md#migrating-from-storage_driveross).

### Files answer 502

A storage service the app is configured to read (the active bucket, or an earlier one) cannot be reached or refuses the credential. That is reported as `502`, not `404`, because the file may well exist. Run the connection test under **Settings → Storage** and look for `[files]` lines in the server log.

## Runs

### A run seems stuck

- **Queued** for a long time: all slots are busy. Raise **Settings → Limits → Concurrency**, or wait.
- **Running** for a long time: the upstream has not finished. A run cannot wait forever: image runs fail after 10 minutes and video runs after 30 by default (**Settings → Limits**). Chat requests fail after 5 minutes (`chatTimeoutSec`).
- A node that is running shows a **Cancel run** button. A queued or running run can also be canceled through the API: `POST /api/runs/<id>/cancel` ([API](api.md#models-and-runs)). The run id is the `id` of the record returned by `GET /api/admin/usage/records`.
- After a server restart, queued runs and runs that already have an upstream task continue by themselves. The time limit counts from the original submission, so a restart does not extend it. Runs that were being sent when the server stopped fail instead; see "The server stopped while this task was being sent…" below.
- If runs time out regularly while the upstream does deliver in the end, raise the timeout. If they time out at "Downloading the result", raise `downloadTimeoutSec` ([Configuration](configuration.md#admin-settings)).

The failure reason is in the node's task details and under **Settings → Usage**. For anything unexpected, the server log has more: `docker compose logs app`.

### "There are already 500 unfinished runs"

New runs are refused while 500 are queued or in flight. Wait for some to finish. A large batch run can reach this.

### "The server stopped while this task was being sent…"

The server stopped (a restart, an upgrade, a crash, out of memory, a forced kill) after the request for that run had been sent and before an upstream task id came back. It is not sent again, because the upstream may already have created, and billed, the task. Check your upstream's records and run the node again if needed.

With providers that return the result in the same request (OpenAI images, Gemini) and with Language model and Video analysis nodes there never is a task id, so any such run that is in flight when the server stops ends this way.

### "Run all" does nothing

"Run all" and "Run this branch" need an Output node at the end of the chain. Add one and connect your results to it, or use the Run button of a single node.

## Access and startup

### Saved API keys stopped working after I changed SECRET_KEY

Provider keys are encrypted with `SECRET_KEY`. With a different key they cannot be decrypted, and runs fail with "The saved API key could not be decrypted (was SECRET_KEY changed?)".

- If you still have the old `SECRET_KEY`, put it back and restart. Everything works again.
- If not, open **Settings → Providers**, edit each provider and enter its API key again. Nothing else is lost.

### How do I reset the access password?

Change `ACCESS_PASSWORD` in `.env` (or `server/.env` without Docker) and restart:

```bash
docker compose up -d
```

There is nothing to reset in the database. Everyone is signed out and signs in with the new password. Removing the value turns login off entirely.

### "Too many attempts. Please try again later"

The login rate limit was reached: 10 attempts per client per 10 minutes, 300 in total. Wait ten minutes, or restart the server to clear the counters.

If everyone hits this behind a reverse proxy, the server sees all visitors as the proxy. Set `TRUST_PROXY=1` (the number of proxies in front); `TRUST_PROXY=true` is not accepted.

### The server exits at startup

Read the last lines of the log (`docker compose logs app`). The usual causes:

| Message contains | Cause |
| --- | --- |
| `SECRET_KEY is required` | Missing or shorter than 16 characters. |
| `must be an integer between` / `must be one of` | An environment variable has an invalid value; the message names it. |
| `TRUST_PROXY must be …` | `TRUST_PROXY` is not a number of proxies (1 to 10) or a list of addresses. `true` and host names are rejected. |
| `STORAGE_DRIVER=oss is no longer supported` | The `oss` driver was removed. Use `STORAGE_DRIVER=s3` with the OSS S3-compatible endpoint. See [Storage](storage.md#migrating-from-storage_driveross). |
| `STORAGE_DRIVER=s3 requires …` | `S3_BUCKET`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` is empty. |
| `The S3_* storage settings are not valid` | An `S3_*` variable has a value that is not accepted (an endpoint with a path, an invalid bucket name, `S3_DELIVERY=redirect` without `S3_PUBLIC_BASE_URL`…). See [Storage](storage.md#environment-variable-reference). |
| `WEB_DIST is set to … but there is no index.html` | The frontend was not built, or the path is wrong. |
| `BILLING_HOOK could not be loaded` | The hook file is missing or throws on load. |
| a MongoDB connection error | The database is not reachable at `MONGODB_URI`. |

### The disk is filling up

Generated files are kept forever by default. Options:

- Move new files to a bucket under **Settings → Storage**. Files that are already on the disk stay there; see [Storage](storage.md#what-happens-when-you-switch).
- Set **Settings → Limits → Result retention (days)**. Result files of runs older than that are deleted; canvases that still show them will show broken images.
- Usage records are small, but you can delete old ones under **Settings → Usage → Clear records older than**. That removes records only, not files.
- Deleting a canvas or an asset does not delete its files.

## Scope

### Can several people use one instance with their own accounts?

No. There is one shared password and one set of data. See [Security](security.md#access-password).

### My upstream is not one of the three providers

If it is a proxy or relay that speaks exactly the official OpenAI or Gemini API, add an OpenAI or Google Gemini provider and change **Base URL** under **Advanced**; add its models as custom models if they are not in the list. LoomCanvas does not adapt to third-party private formats. A different vendor needs a vendor module and a model list: [Writing a provider](writing-a-provider.md).

### Have the providers been tested against the real services?

Not as part of this project so far. They are tested against a fake upstream that pins the request and response shapes. The S3 storage driver is verified against MinIO; AWS S3, Cloudflare R2 and Aliyun OSS have not been run against the live services ([Storage](storage.md#what-has-been-tested)). Expect to verify these in your own environment, and please report what you find.

## Licensing

### May I use LoomCanvas inside my company? May I offer it as a service?

This is a pointer to the documents, not legal advice.

- LoomCanvas is published under the **AGPL-3.0**; the full terms are in [LICENSE](../LICENSE). It also has a separate commercial license.
- The AGPL lets you use, modify and run the software. Its distinctive condition concerns modified versions that other people interact with over a network: they must be offered the corresponding source code. Whether your situation triggers this depends on what you change and who uses it. Read sections 5, 6 and 13 of the license.
- If you want to keep modifications closed, embed LoomCanvas in a proprietary product, or your organisation cannot accept AGPL software, see [COMMERCIAL.md](../COMMERCIAL.md).
- The name and logo are covered by [TRADEMARK.md](../TRADEMARK.md), not by the code license.
- Third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

For a decision that matters to your business, ask a lawyer. For licensing questions, contact the project via <https://gaorui.cc>.
