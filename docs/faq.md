# FAQ

[简体中文](faq.zh-CN.md)

Questions people running their own instance tend to hit. For questions about using the canvas, the in-app guide (**More ⋯ → Guide** in the editor) has its own FAQ, and there is the [User guide](user-guide.md).

## Models and cost

### The node shows "Cost unknown"

The model has no price that matches the current parameters. LoomCanvas ships no prices: it cannot know what your upstream charges you.

1. Open the **Models** page, select the provider, find the model and click **Set price**.
2. Enter the rate you actually pay. If the price depends on resolution or duration, choose that under "Price varies by" and fill in one row per tier.

A table that has no row for the chosen resolution or duration also gives "Cost unknown". Chat models priced per token show it before a run and get their cost afterwards, if the upstream reports token usage. You can always run a model without a price. Details: [Providers](providers.md#pricing).

### The model dropdown is empty, or says "No models available yet"

Check in this order:

1. The **Models** page: is there a provider, does its card say it is enabled and has a key? Click **Test connection** on the card.
2. On the same page, select the provider: are its models switched on?
3. Is the node the right kind? A Video edit node only lists video-edit models. OpenAI and Gemini providers offer no video models at all.
4. Language model node: it lists every enabled chat model. A Gaorui provider has five (three text only, two that read images); a chat model that is not in a provider's list can be added as a custom model on the **Models** page. With a text-only model selected, the node's image input is greyed out and connected images are not sent.
5. Video analysis node: it lists only chat models that accept a video. At present those are `gemini-3.5-flash-c` of a Gaorui provider and custom chat models of a Gaorui provider. OpenAI and Gemini chat models are never listed there.

The list does not depend on the upstream being reachable: it is the provider's own model list plus your custom models.

### A model I need is missing, or a wrong one is listed

Each provider has a fixed list of supported models that ships with LoomCanvas. Nothing is read from the upstream's model list and nothing is guessed from a model's name.

- Missing: go to the **Models** page, select the provider and click **Add custom model**. Enter the model name exactly as the upstream expects it and choose its type (Image or Chat). Custom video models cannot be added.
- Not wanted: switch it off on the **Models** page.
- After upgrading from the previous version, a custom model may have the wrong type or a model you used may be missing; see [Upgrading from the previous version](providers.md#upgrading-from-the-previous-version).

### Running a node again: is it billed again?

Yes. Every run submits a new task to the upstream. The canvas asks for confirmation before re-running nodes that already have a result. Earlier results stay in the node's history.

### Do the amounts match my real bill?

Not necessarily. They are calculated from the prices you typed in, at the time the run was submitted (or from reported token usage for chat). The upstream's bill is the truth. A failed run counts as no spend here even if the upstream charged for it.

## Media

### A run fails with "A publicly reachable URL is needed…"

Some inputs can only be passed to the upstream as a URL: reference images of the Gaorui image models (image-to-image), the source video of a video edit, reference images of some video models, and video in chat. The upstream must be able to download that URL from the internet.

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

They are S3-compatible and the settings for each are in [Storage](storage.md#recipes-per-vendor), but only MinIO has been run against a live service in this project. Use **Test connection** under **Settings → Storage**, and please report what you find.

### I used `STORAGE_DRIVER=oss` and the server no longer starts

The `oss` driver was removed. Aliyun OSS is now used through its S3-compatible API with `STORAGE_DRIVER=s3`. The variables to rename are listed in [Storage](storage.md#migrating-from-storage_driveross).

### Files answer 502

A storage service the app is configured to read (the active bucket, or an earlier one) cannot be reached or refuses the credential. That is reported as `502`, not `404`, because the file may well exist. Run the connection test under **Settings → Storage** and look for `[files]` lines in the server log.

## Runs

### A run seems stuck

- **Queued** for a long time: all slots are busy, or your account already holds as many as one account may. The super admin can raise **Concurrent runs** and **Concurrent runs per account** under **Settings → Run limits**; otherwise wait.
- **Running** for a long time: the upstream has not finished. A run cannot wait forever: image runs fail after 10 minutes and video runs after 30 by default (**Settings → Run limits**). Chat requests fail after 5 minutes (`chatTimeoutSec`).
- A node that is running shows a **Cancel run** button. A queued or running run can also be canceled through the API: `POST /api/runs/<id>/cancel` ([API](api.md#models-and-runs)). The run id is the `id` of the record returned by `GET /api/admin/usage/records`.
- After a server restart, queued runs and runs that already have an upstream task continue by themselves. The time limit counts from the original submission, so a restart does not extend it. Runs that were being sent when the server stopped fail instead; see "The server stopped while this task was being sent…" below.
- If runs time out regularly while the upstream does deliver in the end, raise the timeout. If they time out at "Downloading the result", raise `downloadTimeoutSec` ([Configuration](configuration.md#admin-settings)).

The failure reason is in the node's task details and on the **History** page (**View details** in the row of the run). For anything unexpected, the server log has more: `docker compose logs app`.

### "There are already 500 unfinished runs"

The number in the message is whichever limit was reached. One account may have `userQueueLimit` runs queued or in flight (200 by default; the super admin can change it, see [Configuration](configuration.md#admin-settings)), and the instance as a whole 500. Wait for some to finish or cancel some. A large batch run can reach this.

### "The server stopped while this task was being sent…"

The server stopped (a restart, an upgrade, a crash, out of memory, a forced kill) after the request for that run had been sent and before an upstream task id came back. It is not sent again, because the upstream may already have created, and billed, the task. Check your upstream's records and run the node again if needed.

With providers that return the result in the same request (OpenAI images, Gemini) and with Language model and Video analysis nodes there never is a task id, so any such run that is in flight when the server stops ends this way.

### "Run all" does nothing

"Run all" and "Run this branch" need an Output node at the end of the chain. Add one and connect your results to it, or use the Run button of a single node.

## Access and startup

### Saved API keys stopped working after I changed SECRET_KEY

Provider keys are encrypted with `SECRET_KEY`. With a different key they cannot be decrypted, and runs fail with "The saved API key could not be decrypted (was SECRET_KEY changed?)".

- If you still have the old `SECRET_KEY`, put it back and restart. Everything works again.
- If not, open the **Models** page, click **Edit** on each provider card and enter its API key again. Every account has to do this for its own providers. Nothing else is lost, and nobody is signed out: sessions do not depend on `SECRET_KEY`.

### Where is the super admin password?

The super admin account is created by the server at the first start; nobody registers as it. Its username is `admin` unless `ADMIN_USERNAME` was set.

- If `ADMIN_PASSWORD` was set at that first start, that is the password.
- If it was not, the server generated one and printed it once in the start-up log, in a framed block that begins with `LoomCanvas created the super admin account.` With Docker Compose: `docker compose logs app`, and search for `Password:`. Without Docker it is in the terminal where `npm start` ran. Sign in with it and you are asked to choose your own before anything else.
- If it is lost (the log is gone, or the password was changed and forgotten), reset it from the command line: `docker compose exec app node src/cli/reset-password.js admin`, or without Docker `node server/src/cli/reset-password.js admin`. See the next question.

`ADMIN_PASSWORD` is only read when the account is created. Setting or changing it later does nothing.

### I forgot my password

LoomCanvas sends no email, so there is no reset link. There are two ways:

- **Ask the super admin.** Under **Settings → Users** the super admin chooses **Reset password** for your account and gets a temporary password to pass on to you.
- **You are the super admin, or you run the server.** Reset it from the command line; for the super admin this is the only way. The server can keep running:

  ```bash
  docker compose exec app node src/cli/reset-password.js <username-or-email>
  ```

  Without Docker, from the repository root: `node server/src/cli/reset-password.js <username-or-email>`.

Both give a temporary password that is shown once, and sign the account out on every device. Sign in with it: you are asked to choose a new password right after signing in, and nothing else is available until you have. Details: [Deployment](deployment.md#forgotten-password).

### "Too many attempts. Please try again later"

A rate limit was reached:

| Limit | Value |
| --- | --- |
| Sign-in attempts at one account from one client address | 10 per 10 minutes |
| Sign-in attempts from one client address, at any accounts | 30 per 10 minutes |
| Sign-in attempts at one account, from all addresses together | 100 per 10 minutes |
| Sign-in attempts in total | 3000 per 10 minutes |
| Registration attempts from one client address | 20 per hour |
| Changes of username or email | 20 per account per hour |

The answer (HTTP 429, code `auth.too_many_attempts`) says how long to wait: `data.retryAfterSeconds` in the body and the `Retry-After` header. Wait that long, or restart the server to clear the counters. Changing your password with a wrong current password counts as a sign-in attempt at your account.

Somebody else guessing at your username does not lock you out. The last two sign-in limits do not apply from an address your account is known at: one you signed in from in the last 30 days, or one where you are still signed in. Only from an address you have never used may you have to wait while such guessing is going on. See [Security](security.md#rate-limits).

If everyone hits this behind a reverse proxy, the server sees all visitors as the proxy. Set `TRUST_PROXY=1` (the number of proxies in front); `TRUST_PROXY=true` is not accepted.

### How do I close registration?

Registration is open by default, and it only ever creates ordinary accounts. There are three ways to close it:

- Before the first start, set `REGISTRATION_OPEN=false` in `.env`. The variable gives the setting its first value only; once the setting has been saved (by this variable, on the settings page or through the API) it is ignored.
- The super admin switches **Open sign-up** off under **Settings → Site**.
- Or the super admin sends a request:

```bash
curl -X PUT http://localhost:3000/api/admin/site \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"registrationOpen": false}'
```

Existing accounts keep signing in. New registrations are refused with "Registration is closed on this site". To let one more person in, open it, let them register, and close it again. On an instance that strangers can reach, keep it closed; see [Security](security.md#accounts).

### What happens to my existing data when I upgrade to the version with accounts?

Nothing is lost and nothing has to be migrated by hand. At the first start of the new version the server creates the super admin account and **hands it all of the existing data**: canvases, share links (the same links keep working), assets, brand kits, providers and their keys, models and prices, usage records and your own templates.

So before that first start, set `ADMIN_PASSWORD` in `.env` (or read the generated password from the start-up log afterwards), keep `SECRET_KEY` unchanged, and remove `ACCESS_PASSWORD`. Then sign in as the super admin and everything is there. An account that registers starts empty and sees none of the old data. The full list is in [Deployment](deployment.md#upgrading-from-a-version-without-accounts).

### After the upgrade a canvas looks rearranged

Generation nodes became much taller in the redesign, so nodes placed for the old sizes can end up on top of each other. A canvas that was last saved by an earlier version is therefore arranged once, the first time you open it in the editor, and only if its nodes actually overlap at the new sizes. It is the same arrangement as **Tidy up** in the bottom toolbar. A notice says that it happened; press Ctrl+Z to get the old positions back. It happens once per canvas and never to a canvas saved by the current version. The two built-in templates were re-spaced as well. Canvas documents are now at `schemaVersion` 2; older ones are migrated when they are read, and nothing has to be done by hand.

### The interface used to have a light theme

It has one dark theme now. The theme switch and the "default theme" site setting are gone; a value saved by an earlier version is ignored.

### The server exits at startup

Read the last lines of the log (`docker compose logs app`). The usual causes:

| Message contains | Cause |
| --- | --- |
| `SECRET_KEY is required` | Missing or shorter than 16 characters. |
| `must be an integer between` / `must be one of` | An environment variable has an invalid value; the message names it. |
| `TRUST_PROXY must be …` | `TRUST_PROXY` is not a number of proxies (1 to 10) or a list of addresses. `true` and host names are rejected. |
| `ADMIN_PASSWORD must be 8 to 128 characters long` | The super admin is about to be created and `ADMIN_PASSWORD` is too short or too long. Set a longer one, or remove it and a password is generated. |
| `ADMIN_USERNAME … is already the name of another account` / `ADMIN_EMAIL is already the email of another account` | There is no super admin yet, and an ordinary account already uses that name or address. Set a different value. |
| `REGISTRATION_OPEN must be true or false` | The variable has another value. |
| `STORAGE_DRIVER=oss is no longer supported` | The `oss` driver was removed. Use `STORAGE_DRIVER=s3` with the OSS S3-compatible endpoint. See [Storage](storage.md#migrating-from-storage_driveross). |
| `STORAGE_DRIVER=s3 requires …` | `S3_BUCKET`, `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` is empty. |
| `The S3_* storage settings are not valid` | An `S3_*` variable has a value that is not accepted (an endpoint with a path, an invalid bucket name, `S3_DELIVERY=redirect` without `S3_PUBLIC_BASE_URL`…). See [Storage](storage.md#environment-variable-reference). |
| `WEB_DIST is set to … but there is no index.html` | The frontend was not built, or the path is wrong. |
| `BILLING_HOOK could not be loaded` | The hook file is missing or throws on load. |
| a MongoDB connection error | The database is not reachable at `MONGODB_URI`. |

### The disk is filling up

Generated files are kept forever by default. Options:

- Move new files to a bucket under **Settings → Storage**. Files that are already on the disk stay there; see [Storage](storage.md#what-happens-when-you-switch).
- Set **Result retention** under **Settings → Run limits**. Result files of runs older than that many days are deleted; canvases that still show them will show broken images.
- Usage records are small, but you can delete old ones with **Clean up** on the **History** page. That removes records only, not files.
- Deleting a canvas or an asset does not delete its files.

## Scope

### Can several people use one instance with their own accounts?

Yes. Everyone registers an account of their own, and each account has its own canvases, files, providers and API keys, models, prices and usage. The super admin, the one account the server creates itself, manages the site and the list of accounts, but cannot read what the others make.

There are no teams and no shared workspaces: two accounts cannot edit the same canvas. To pass a canvas on, publish a share link and let the other account copy it. Note that model ids are per account, so the copy only finds its models if the other account has a provider with the same slug.

Accounts are kept apart by the API, not by separate processes or databases. See [Security](security.md#accounts) before you open an instance to people you do not know.

### My upstream is not one of the three providers

If it is a proxy or relay that speaks exactly the official OpenAI or Gemini API, add an OpenAI or Google Gemini provider and change **Base URL** under **Advanced**; add its models as custom models if they are not in the list. LoomCanvas does not adapt to third-party private formats. A different vendor needs a vendor module and a model list: [Writing a provider](writing-a-provider.md).

### Have the providers been tested against the real services?

The built-in Gaorui models have been run against the real service; the OpenAI and Google Gemini integrations follow the official documentation but have not been run by the project. The S3 storage driver is tested against MinIO; AWS S3, Cloudflare R2 and Aliyun OSS have not been run against the live services ([Storage](storage.md#what-has-been-tested)). Expect to check these in your own environment, and please report what you find.

## Licensing

### May I use LoomCanvas inside my company? May I offer it as a service?

This is a pointer to the documents, not legal advice.

- LoomCanvas is published under the **AGPL-3.0**; the full terms are in [LICENSE](../LICENSE). It also has a separate commercial license.
- The AGPL lets you use, modify and run the software. Its distinctive condition concerns modified versions that other people interact with over a network: they must be offered the corresponding source code. Whether your situation triggers this depends on what you change and who uses it. Read sections 5, 6 and 13 of the license.
- If you want to keep modifications closed, embed LoomCanvas in a proprietary product, or your organisation cannot accept AGPL software, see [COMMERCIAL.md](../COMMERCIAL.md).
- The name and logo are covered by [TRADEMARK.md](../TRADEMARK.md), not by the code license.
- Third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

For a decision that matters to your business, ask a lawyer. For licensing questions, contact the project via <https://gaorui.cc>.
