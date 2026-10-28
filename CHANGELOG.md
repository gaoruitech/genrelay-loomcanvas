# Changelog / 变更记录

Notable changes to LoomCanvas. Versions follow the `version` field of the root `package.json`.

LoomCanvas 的主要变更。版本号以根目录 `package.json` 的 `version` 为准。

## 0.1.0 (unreleased / 未发布)

First version. Nothing has been tagged or released yet; interfaces may still change. This entry describes what is in the repository.

第一个版本，尚未打标签发布，接口仍可能调整。以下是仓库里目前已有的内容。

### English

**Canvas**

- Infinite canvas editor built on Vue Flow: source nodes (text, image, image set, video), generation nodes (image generation, image edit, video generation, video edit, language model, video analysis), output node, groups.
- Typed connections, undo/redo, copy and paste, duplicate, box-select, alignment and distribution, arrange by data flow, snap to grid, node search, minimap, immersive mode, per-canvas appearance.
- Run a single node, a branch or the whole canvas; batch runs over up to 100 source files; result history per node; confirmation before re-running nodes that already have a result.
- Tool nodes processed on the server without any model: slice, collage, watermark, resize, multi-platform export.
- Canvas templates and text templates (two built-in templates and a set of prompt snippets in Chinese and English), brand kits, asset library, zip download of a canvas's media.
- Read-only share links that snapshot a canvas, with expiry and revocation; run state, task ids and costs are stripped from snapshots.
- Chinese and English interface. Two themes: dark (the default) and light, plus "System", which follows the device. The switch is an icon in the top bar and in the header of the landing, sign-in and shared-canvas pages, and three preview cards under Settings → Appearance; it applies at once with a short cross-fade and without a reload. The choice is kept with the account (`prefs.theme`, `PUT /api/auth/prefs`) and mirrored in the browser, so signed-out pages and the first paint use it (applied by `/theme-boot.js`, a same-origin script: the Content-Security-Policy stays `script-src 'self'`). A canvas on the default background follows the viewer's theme; a background colour picked by the author is kept as it is, and wires, group outlines, the pattern and the minimap follow that colour's brightness. A landing page, registration and sign-in pages, and an "Add a provider" page for an account that has none yet.
- An app shell with a top bar and a sidebar: Workbench (recent canvases, templates, recent generations, this month's usage, queue, providers), Canvases, Assets, Models (providers, models and prices), History (every run, with totals, filters, details, CSV export and clean-up) and Settings (interface language, account and sessions; for the super admin also storage, run limits, site name, logo and default language, registration, users and teams). In the editor the sidebar shrinks to icons.
- Generation nodes became much taller (canvas documents went to `schemaVersion` 2 with that redesign; they are at 3 now, see below), so the two built-in templates were re-spaced, and a canvas last saved by an earlier version is arranged once when it is first opened in the editor, only if its nodes overlap at the new sizes. A notice says so and Ctrl+Z undoes it; it never repeats and never touches a canvas saved by the current version.
- Brand kits are chosen per canvas, not on every node. The "Brand kit" row is gone from the body of the generation nodes. A button next to the canvas name shows the kit the canvas uses and opens a panel that explains what a kit does, lists your kits and lets you choose one, or none, for the whole canvas; the choice is saved with the canvas. One node can still differ (right-click it, or use "This node" where you edit its prompt): follow the canvas, no kit, or another kit, and such a node shows a small icon next to its title. Where you edit a node's prompt, a line says which kit applies and shows exactly what the next run adds: the text in front of the prompt, the "Do not include: …" line, and the reference images that will and will not be sent.
- Brand kits are managed under Assets › Brand kits (`/assets/brand-kits`): cards with the reference images and a summary, create, edit, duplicate, delete, "default for new canvases", and in how many canvases each kit is in use. The default kit now applies to new canvases instead of new nodes. The editor form also opens in a dialog on the canvas.
- Canvas documents are at `schemaVersion` 3: a canvas has `brandKitId`, and a node that differs has `data.brandKitOverride`. Canvases from before are converted at start-up and on read. When every generation node used the same kit it becomes the canvas's kit; otherwise each node keeps its own as an exception, so every node runs with the kit it had. `GET /api/brand-kits` returns `usedBy`.
- A share link carries no brand kit (the canvas's kit and the nodes' exceptions are left out of the snapshot), and a copy made from one starts without a kit. Duplicating your own canvas keeps both.
- A brand kit no longer makes a model that takes no reference images warn about dropped images, and the "this instance has no public address" notice now also counts the kit's reference images, before the run instead of as a refusal from the server.
- Saving: panning and zooming no longer flip the save status to "Unsaved". The viewport is stored quietly on its own shortly after the view stops moving, and such a save does not change the canvas's "updated" time.
- Saving: opening a canvas and not touching it no longer shows "Unsaved" for a moment. What the editor fills in by itself on open (default model and parameters of a node, measured node sizes, the layout marker) is stored quietly; the status reads "Loading…" until the canvas is in.
- Spaces: switching quickly between spaces can no longer leave one space's canvas list on screen under another space's address.
- Tidy up now arranges every loose node on the canvas, not only the ones in view; nodes that were never on screen are placed by an estimated size.
- History: the run details dialog shows the parameters by the names and values the editor uses (Aspect ratio: Auto, Duration: 5s, Reference mode: First & last frame) instead of the API field names, and the provider by its name. A date range, "today" and the clean-up date mean days in your own time zone.
- Share pages show each model by the display name stored with the snapshot (or "Model not listed" when the publisher no longer has it), never the model id.
- A node that is refused before it runs (no prompt, no reference image, no usable model) is listed under "Could not start" in the queue list with the reason, in addition to the message and the mark on the node.
- **The queue button and its list.** The button is a solid chip that stays findable when nothing runs, on any canvas background in both themes. Two quick taps or a double-click only open and close the list: putting the button back in its corner is the **Reset** control in the list's header (shown once the button has been moved). Mouse, finger and pen all drag it; it snaps to an edge, keeps clear of the other floating panels and stays inside the editor when the window is resized. The ring shows the progress of the whole batch - finished runs count as done, queued ones as nothing yet - so it no longer jumps back when a run ends or another is added, and its colour runs one way along the arc. On a phone the list is a full-width sheet with a close button, a grip to swipe down, its own scrolling and the bottom safe area; on wider screens the running rows come first and the whole card scrolls as one (the monthly limits used to pin half of it). The list, the task details, the canvas appearance panel and the image editor take the keyboard like every other dialog: focus goes in, Tab stays in, Esc closes, focus returns to where it came from.
- **Tooltips.** Hover hints are drawn by the interface itself instead of the browser's `title`: they follow the theme, show on keyboard focus and on touch-and-hold, stay inside the window and leave on scroll, Esc or when the pointer leaves. Icon-only buttons keep an accessible name. Text that is cut off shows in full on hover; text that fits gets no tooltip.
- **The composer of the "Result first" layout finds its own place.** It floats above the canvas and no longer has to sit under the node: when it would not fit there, or would cover the node toolbar, the queue button, the minimap, the title block or the bottom toolbar, it slides along the node's edge, then goes above the node, then beside it. It may lie over other nodes (it then gets a denser background), never over the ports of its own node. If no side has room the canvas pans a little; in an editor too small for node and composer together it docks at the bottom as a sheet, as on a phone. Esc collapses it and keeps the node selected, and the next character typed opens it again and is kept. With an input method, composing starts with the first key after selecting a node (that key used to arrive as a stray Latin letter), and while it lasts Enter, Esc and the arrow keys go to the input method: Enter does not run, Esc does not collapse.
- **A toolbar for several selected nodes**, the same in all three layouts: "N nodes selected", **Align** (six alignments and two distributions as a row of icons), **Group** (**Merge into one group** when a group is selected, plus **Ungroup** or **Remove from group**), **Run selected** and delete. It sits next to the selection, keeps clear of the other floating panels, and is a fixed row on a phone. **Run selected** runs the selected nodes that can run, upstream ones first so that downstream ones use the new result, asks "Run again?" once for the whole selection, and is greyed out with the reason when a monthly limit is used up. Keyboard: one Tab stop, ← → between the buttons, Esc closes the alignment icons.
- **The node toolbar fits a short editor.** When the whole toolbar does not fit (a low window, an embedded editor) its buttons get smaller first; then buttons move into **More tools** in a fixed order - output and tools and chat / analysis first, text last - while **+** and **More ⋯** stay. It is dragged with mouse, finger or pen; on a touch screen two taps on the handle do not reset it (the handle's menu has **Reset**). The minimap is hidden while the editor is under about 370px high.
- **The compact layout in a narrow window, and "Everything on the node".** With the inspector open in a window of about 1000 to 1100px, the canvas pans sideways just far enough to show the selected node when it would lie under the inspector, and the minimap is hidden until the inspector closes; neither is a step for undo. The Run button of an image or video node reads **Re-run** once there is a result, in all three layouts. On the node, model, parameters, cost and Run always stay on one row (the spacing tightens, then the parameters shorten to the first one and "+N", then the model name is cut), and the result of a Language model or Video analysis node is a box of its own, labelled **Result**, that does not look like the prompt box below it.
- **A brand kit shows on the node.** An image or video node that a kit applies to, or that has an exception, carries a star in its header in all three layouts: hovering it names the kit and says when its reference images cannot be sent, clicking it opens **Brand kit for this node** (what the next run adds; follow the canvas, no kit, or another kit). In "Everything on the node" the star is also the way in on a node without a kit. Changing the kit of a canvas, or the exception of a node, is a step for Ctrl+Z. The subtitle of Assets › Brand kits says whose kits the page lists.
- **Settings and the shell.** In the users list, the tag and the fourth status filter for accounts on a temporary password read **Temp password** in English (待改密码 in Chinese). **Show the site name next to the logo** under Settings → Appearance (the `showSiteName` setting, on by default; `site.showName` in `GET /api/bootstrap`): turned off, the top bar, the sign-in pages and the landing page show the logo alone, for a logo that already spells the name; without a logo the name is always shown. In a window narrower than 760px the language dropdown of the top bar moves into the account menu. On a phone the entry of the start page in the bottom navigation reads **Home**, where "Workbench" and "Team home" do not fit. Signing in on a browser that shows another theme than the account's no longer flashes: the sign-in page keeps its look and the first frame of the app has the account's theme. "Page not found" and "Can't reach the server" have the language and theme switches.
- **The landing page on a phone.** In a window up to 820px wide the header collapses into a menu button: Features, Integration, Open source, Docs, Source, the theme (Dark / Light / System), the language, Sign in and Sign up. It is a sheet at the bottom on a phone and a panel under the header on a tablet, takes the keyboard like every other dialog, and scrolls to the section you pick.
- **Durations read the same everywhere**, one style per language: 42s, 1m 05s, 1h 02m and <1s in English; 42 秒, 1 分 05 秒, 1 小时 02 分 and <1 秒 in Chinese - on nodes, in parameter chips, in the queue list, the run details and History. The clip length of a video (8s / 8 秒) follows the same rule; the CSV export keeps plain seconds, and the time code over a video stays 0:08.
- **A run refused by a monthly limit no longer keeps saying so after the limit was raised.** While such a notice (or the warning before running) is on screen the editor re-reads the limits when the tab is looked at again and every 30 seconds; a notice that no longer holds is taken off the node, which goes back to how it was before the run, and one that still holds shows the numbers of the moment. The batch dialog now checks every node that will submit a run - language-model and video-analysis nodes included - by the model it will actually run on, also when the node never chose one.
- **History search looks through every record of the period**, not only the page on screen: prompt, model and canvas name, any case, typed text taken as it is. The totals and the CSV export follow the search.
- **Invite links.** A link that was revoked or has expired shows that state in the managers' table instead of "5 / 5 left". The join page of a link that no longer works names somebody who can still make a new one: whoever made it while they are still the owner or an admin, otherwise the team's owner - never somebody who has left.
- The three fonts the interface ships (Inter, Sora, JetBrains Mono; SIL Open Font License 1.1) are listed in `THIRD_PARTY_NOTICES.md`, and every build writes their copyright notices and the licence text to `licenses/fonts-OFL-1.1.txt`.

**Server**

- Node.js + Express + MongoDB backend.
- Accounts: signing in is always required. The super admin account is built in: at start-up the server creates it when there is none, from `ADMIN_USERNAME` (default `admin`), `ADMIN_PASSWORD` and `ADMIN_EMAIL` (optional; the super admin is the only account that may have no email). Without `ADMIN_PASSWORD` a random password is generated and printed once in the start-up log, and has to be replaced at the first sign-in. These variables are read only when the account is created; afterwards they are ignored. Its role is `owner` in the API.
- Registration (username, email, password) only ever creates ordinary users. Whether it is open is the super admin's `registrationOpen` setting, open by default; `REGISTRATION_OPEN=true|false` gives that setting its first value and is ignored once the setting has been saved. With registration closed, `POST /api/auth/register` answers `403 auth.registration_closed`.
- `mustChangePassword` on the User object: `true` while the password is one somebody else knows (the generated super admin password, or a temporary one from a reset). Until `PUT /api/auth/password` has replaced it, the API serves that account only `GET /api/auth/me`, `GET /api/bootstrap`, `PUT /api/auth/password` and `POST /api/auth/logout`; everything else answers `403 auth.password_change_required`, and the web app shows a **Set a new password** screen. A new password equal to the current one is refused with `400 auth.same_password`.
- `GET /api/bootstrap` carries `auth: { registrationOpen }` and `user`.
- Each account has its own canvases, files, share links, assets, brand kits, runs and usage, and its own providers, API keys, custom models and prices: its personal space. Accounts share only through a team (see **Teams** below). Another account's resource answers 404.
- Sessions kept on the server (hashed token; 12 hours, or 30 days with "remember"): sign out, sign out other devices, and a password change or reset end them at once. Passwords hashed with scrypt.
- `PUT /api/auth/password` ends every session of the account, the caller's included, and answers `{ revokedSessions, token }` with a fresh token for the caller (same remaining lifetime). The web client swaps it in silently.
- The super admin manages the site only: registration open or closed, storage, run limits, site name, logo and default language, and the user list (disable, enable, delete with its data and files, reset a password). The super admin cannot read other accounts' data through the API.
- `node server/src/cli/reset-password.js <username-or-email>` for a forgotten password, the super admin's included; no email is sent anywhere. Like the super admin's **Reset password**, it gives a temporary password that has to be replaced at the next sign-in.
- Vendors with a registry and per-model overrides. Built in: Gaorui (image and video models; chat models as custom models for now), OpenAI (chat, image generation and editing) and Google Gemini (image, chat). See **Providers** below.
- In-process run queue with bounded concurrency, shared fairly between accounts (`userConcurrency`, `userQueueLimit`), hard deadlines for every step, retries only when a resubmission is safe, cancellation, and recovery of unfinished runs after a restart.
- Results copied into your own storage with content-type sniffing and WebP thumbnails. Storage: the local disk, or one S3-compatible driver for AWS S3, Cloudflare R2, Aliyun OSS, MinIO and similar services (see **Storage** below).
- Cost estimates from price tables each account maintains, "cost unknown" when no price applies, usage summaries by day and by model, usage records with clean-up.
- `GET /api/admin/usage`, `GET /api/admin/usage/records` and `DELETE /api/admin/usage/records` accept `tz` (an IANA zone name, default `UTC`). A bare date in `from`, `to` or `before` is that calendar day in `tz`; full instants are taken as they are; without `tz` nothing changes. An unknown zone is `400 validation.invalid`. The web app always sends the browser's zone, so "today" is the user's local day.
- Optional billing hook (`BILLING_HOOK`) called before and after each run, with the account the run belongs to (`ctx.userId`, `ctx.username`).
- Provider API keys encrypted at rest with AES-256-GCM under `SECRET_KEY`; sign-in, registration and profile changes are rate limited.
- Sign-in limits, in memory, per 10 minutes: 10 per account name and client address, 30 per client address, 100 per account name, 3000 in total. The last two are not applied to an address the account is known at (a successful sign-in in the last 30 days, or a live session), so wrong guesses at a username cannot lock its holder out. Registration: 20 per address per hour. `PUT /api/auth/profile`: 20 changes per account per hour (`429 auth.too_many_attempts`), so its "taken" answers cannot be used to test addresses without limit.
- SSRF-guarded downloader for every user- or upstream-supplied URL; uploads typed by content; security headers including a Content-Security-Policy.
- Server messages in Chinese and English, selected per request; stable error codes.
- Canvas documents carry a `schemaVersion` (now 3) and are migrated at start-up and on read.
- Admin settings for site name, logo, default language, registration, concurrency (for the instance and per account), the queue limit per account, timeouts, retries and result retention. All of them, `userConcurrency` and `userQueueLimit` included, can be edited under Settings (Run limits, Appearance, Site).
- The `defaultTheme` setting is removed: `GET /api/bootstrap` has no `site.defaultTheme`, `/api/admin/settings` no longer returns it and refuses it with `400 settings.unknown_key`, and a stored value is ignored.
- `GET /api/bootstrap` no longer returns `authRequired` and `authed`; `user` is `null` for a caller who is not signed in.

**Providers**

Added

- Signing up with Gaorui is one click away. In the provider form (on the "Add a provider" page and under Models) the API key field has a "No key yet? Sign up at gaorui.cc" link on its right, taken from the vendor's `keyUrl`; it replaces the separate "Get an API key" link. The landing page has a "Recommended provider" section that introduces Gaorui (gaorui.cc), lists the image, video and chat models one Gaorui key covers and links to its sign-up page; the second of the three start steps names it too. Both links follow `features.externalLinks`.
- Vendors with explicit model catalogs. A provider is now a vendor (Gaorui, OpenAI or Google Gemini) plus your API key. The models each vendor supports are written down in `server/src/providers/catalog/<vendor>.json`, in `image`, `video` and `chat` sections; the section is the kind. Gaorui is listed first and marked as recommended.
- Custom models: on the Models page a model outside the vendor's catalog can be added to a provider by its upstream name, with a kind chosen by hand (image or chat) and an optional display name. Up to 100 per provider. Custom video models are refused for all three vendors.
- The Models page shows the providers as cards and the models of the selected provider grouped by type, filtered by type, status, source and price, plus a search over the display name and the model ID. The filters are remembered in the browser.
- The OpenAI vendor goes through the official OpenAI API: `/chat/completions`, `/images/generations`, and `/images/edits` (multipart) when reference images are connected, so OpenAI image models now take reference images.
- Admin API: `GET /api/admin/vendors`; `POST`, `PUT` and `DELETE /api/admin/providers/:id/models[/:model]` for custom models. Provider objects carry `customBaseUrl` and `customModels`; ModelSpec objects carry `custom`.
- Video analysis through Gaorui with a catalog model: `gemini-3.5-flash-c` accepts a video and is offered in the Video analysis node. A Gaorui provider sends the video as an `image_url` content part holding its public URL, right after the text part (a `video_url` part is dropped by the Gaorui relay without an error). This follows what the Gaorui main site does.
- Token prices with separate input and output rates can be entered and edited on the Models page (two fields), and the model list shows them as "Input … / output … · per 1M tokens". Before, such a price could only be set through the API and was listed as 0.00.
- Automatic migration of stored providers at start-up, once per provider: `openai-compatible` becomes `openai` with the same slug, so model ids on canvases, prices and usage keep working; models typed into the old fields, and models that were in use where the old code fetched the list from the upstream, are carried over as custom models. A Gaorui provider still called by the old default name ("Gaorui API" / 「高瑞 API」) is renamed to "Gaorui" / 「高瑞」; any other name is left alone. Keys, addresses, the enabled flag, order and model overrides are not touched. See [docs/providers.md](docs/providers.md#upgrading-from-the-previous-version).

Changed

- Vendors with explicit catalogs replace provider types and name-based guessing. Nothing about a model is inferred from its name any more, and no model list is fetched from the upstream. **Test connection** still calls the upstream's model-list endpoint, only to prove the address and the key; it no longer reports a model count.
- Every vendor defaults to its official base URL (`https://gaorui.cc`, `https://api.openai.com/v1`, `https://generativelanguage.googleapis.com`). Another address can be set under **Advanced** in the provider dialog; it must speak exactly the same official API. The vendor of a provider cannot be changed after it is added.
- The API key is required when adding a provider of any vendor.
- Providers are called 「服务商」 in the Chinese interface, and the vendor is called 「高瑞」 / "Gaorui".
- The Chinese brand spelling is corrected to 「高瑞」 throughout the interface, the server messages and the documentation; a stored provider whose default name carried the old spelling is renamed by the migration.
- OpenAI chat models no longer accept a video: the official API has no video part. Video analysis is available with `gemini-3.5-flash-c` and with custom chat models of a Gaorui provider; custom Gaorui chat models now send the video as an `image_url` part as well, no longer as `video_url`.
- The Gaorui catalog lists five chat models: `deepseek-v4-pro`, `gpt-5.5` and `glm-5.3` (text only), `gpt-6-astra` (reads images) and `gemini-3.5-flash-c` (reads images and video). Chat models are no longer discovered from the upstream; one that is not listed can be added as a custom model.
- A text-only chat model is never sent an image: `POST /api/llm/tasks` with `imageUrls` for one is refused (`model.no_image_input`), and the Language model node greys out its image input, takes no new image connection and says that connected images are not sent.
- The OpenAI catalog lists `gpt-image-2` next to the two GPT Image 2.5 models, and fifteen chat models from GPT-6 down to GPT-4o Mini; the Gemini catalog lists `gemini-3.1-flash-image`, `gemini-3.6-flash` and `gemini-3-flash-preview` as well. Each catalog holds every current model its vendor serves through the endpoints LoomCanvas calls; what is left out and why is in [Providers](docs/providers.md).
- A custom model whose name a catalog lists is served from the catalog under the same model id (enabled state, order, name and price are kept); the custom entry is removed at start-up.
- On a narrow screen the section list of the Settings page scrolls sideways inside itself and keeps the current section in view, instead of widening the page.
- The Settings page shows one section at a time instead of one long page. The list on the left is grouped into Personal (Account & security, Appearance) and, for the super admin, Site management (Site, Users, Teams, Storage, Run limits). The section is part of the address (`/settings/<section>`); `/settings` and the old `/settings#<section>` links go to the right section, and a section an account may not see falls back to Account & security. Leaving a section with unsaved changes asks first. Storage shows the S3 form only when S3 is selected, in four groups; Users has search, a status filter and a **Temp password** tag for accounts still on a temporary password (the same words are the fourth choice of the status filter).
- The built-in admin account is called the super admin (超级管理员) in the interface, in server messages, in the start-up log and in the docs; ordinary accounts are called users. The value in the API stays `owner`, and the `ADMIN_*` variables keep their names.

Removed (**breaking**)

- The provider type `openai-compatible` and the free-text model fields of the provider form (stored providers are migrated, see above).
- `GET /api/admin/provider-types`, replaced by `GET /api/admin/vendors`. `POST /api/admin/providers` no longer takes model fields, provider objects no longer have `options`, and `POST /api/admin/providers/:id/test` no longer returns `modelCount`.
- The `fields` and `listModels` members of the provider plugin contract. A vendor module now exports `catalog`, `customKinds` and `customSpec`; see [docs/writing-a-provider.md](docs/writing-a-provider.md).
- The five-minute model list cache.

**Storage**

Added

- A **Storage** section under Settings (super admin only): choose the local disk or an S3-compatible bucket, with presets for AWS S3, Cloudflare R2, Aliyun OSS and MinIO. Takes effect at once, without a restart. A saved configuration takes precedence over `STORAGE_DRIVER` and `S3_*`. The secret access key is encrypted with `SECRET_KEY` and never returned.
- Options of the S3-compatible driver: key prefix (`S3_KEY_PREFIX`), delivery (`S3_DELIVERY`), object ACL (`S3_ACL`), explicit path-style addressing.
- Private buckets: with `proxy` delivery the app streams files from the bucket itself (Range, ETag, HEAD), so the bucket needs no public access and no CORS configuration.
- `redirect` delivery: `/files/<key>` redirects to a public domain or CDN in front of the bucket.
- Reference media in a bucket is handed to upstream models as a presigned URL valid for one hour (or the public address), so `PUBLIC_URL` is not needed for it. Presigned URLs are never stored, and are blanked in upstream error messages.
- A connection test (`POST /api/admin/storage/test`) that writes, reads back and deletes a test object and names what is wrong in plain words. Saving an S3 configuration runs it first.
- Admin API: `GET` / `PUT /api/admin/storage`, `POST /api/admin/storage/test`.
- After a switch the earlier backend stays readable (the local disk, the saved bucket, up to 5 earlier buckets, the environment's bucket). Files are not moved, and there is no migration tool.
- Thumbnails are generated on first request on every backend and stored next to their source image.
- Tests of the storage layer, and live tests against a real S3 API (`server/test/storage.live.test.js`, run when `TEST_S3_ENDPOINT` is set). They have been run against MinIO only.
- **A bucket with an internal address is never handed to an upstream model.** Whether an address can be reached from the internet is decided by one rule for `PUBLIC_URL`, the public base URL and the S3 endpoint: not `localhost`, not a host name of a single label (`minio`), not a private or reserved IP address, not a private-use suffix. For such a bucket, reference media go through `PUBLIC_URL`, inline, or are refused before anything is sent. `SSRF_ALLOW_HOSTS` has no say in this.
- `S3_PRESIGN_ENDPOINT` / `presignEndpoint` (**Endpoint for signed URLs** in the form under Settings → Storage): the address an internal S3 service has from the internet; presigned URLs for upstream models are made for it. A reverse proxy there has to keep the `Host` header (tested against MinIO).
- **A bucket that is only read and cannot be reached no longer gets in the way.** Files on the disk and in the bucket in use are found first; earlier buckets are asked together with a 3-second deadline; a bucket that does not answer is left alone for 30 seconds and logged once per period. A file that is found nowhere answers `404` when every storage answered and `503 storage.unreachable` when one that might hold it did not (it used to be `502` in both cases). Thumbnails follow the same rule, and a failure is never cached.
- Deleting an account or a team waits 4 seconds for storage at most; what a storage could not give up is removed in the background and tried again every 10 minutes for up to 30 days. Result retention no longer writes a file off as cleaned when its storage could not be reached.
- `DELETE /api/admin/storage/buckets/:id` stops reading a bucket that is gone for good (**Stop reading** on its row under Settings → Storage). The storage status has `writable`, `upstream` (how a file stored now is handed to an upstream model: `public_base`, `signed`, `app`, `inline`, or `unavailable` while nothing can be stored) and `buckets` (every bucket that is read, with its state). `GET /api/admin/storage?probe=1` asks every bucket first whether it can be reached, 4 seconds at most; the **Current status** card of the settings page does that on **Refresh**, and every 10 seconds while a store cannot be reached.
- `GET /api/bootstrap` has `media.writable` next to `media.upstreamByUrl`: `false` while new files are refused, so image and video nodes say so before a run (`storageWritable` in what an editor adapter's `capabilities()` returns).
- A refusal about one field of the storage form says which one in `data.field`, and its message names the field as the settings page does; the page shows it under that field.
- **A changed `SECRET_KEY`**: the server starts; the saved bucket stays configured and unusable (its files answer `503`, and when it is the bucket in use new files are refused with `503 storage.secret_unreadable` instead of being written somewhere else; `secretUnreadable: true` and `writable: false` in the storage status); a provider whose key cannot be decrypted is marked `keyUnreadable` and refuses runs with a message. Settings → Storage and the provider cards on the Models page ask for the secret or the key again.
- The bucket the `S3_*` variables describe is read whatever `STORAGE_DRIVER` says, and a bucket named both there and on the settings page is one bucket.

Changed

- Every stored file has one address on every backend: the site-relative `/files/<key>`, answered by the app. The S3 driver used to store `<S3_PUBLIC_BASE_URL>/<key>`; such addresses in existing canvases are still recognised while that public base URL stays configured.
- `S3_PUBLIC_BASE_URL` is optional. It used to be required.
- `S3_REGION` defaults to `us-east-1`. It used to default to `auto`; set `S3_REGION=auto` explicitly for Cloudflare R2.
- The AWS SDK (`@aws-sdk/client-s3`, `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`) is a regular dependency of `server/`, no longer an optional one.
- The page's Content-Security-Policy lists the origin of every configured public base URL.

Removed (**breaking**)

- The `oss` storage driver, the `ali-oss` package and every `OSS_*` variable. `STORAGE_DRIVER=oss` now stops the server at startup with a message that says what to set. To migrate, use `STORAGE_DRIVER=s3` with `S3_ENDPOINT=https://oss-<region>.aliyuncs.com`, `S3_REGION=oss-<region>`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (formerly `OSS_ACCESS_KEY_SECRET`) and path-style off, or configure it under Settings → Storage. See [docs/storage.md](docs/storage.md#migrating-from-storage_driveross).
- The `EXTRA_NPM_PACKAGES` build argument of the Docker image.

**Integration**

- LoomCanvas can be built into another product. Two entry points, built with `npm run build:lib` in `web/` into `web/dist-lib` (ES modules, one stylesheet per entry, type declarations; Vue as a peer dependency, plus `standalone/` variants with Vue inside). Nothing is published to npm. Guide: [docs/integration.md](docs/integration.md); runnable host pages in [`examples/`](examples/README.md).
- `loomcanvas-web/app`, `mountLoomCanvas(el, options)`: the whole application inside an element of a host page. The host can supply its own authentication (`getAuth`, `onAuthRequired`, `user`), drop LoomCanvas' top bar and sidebar (`shell: 'none'`), restrict the pages (`pages`), switch features off (`features`), choose how navigation maps to the address bar (`routerMode`: memory, hash, history), control theme and language, override texts and the brand (`brand: { name, logoUrl, showName }`; `showName: false` shows the logo alone), and prefix storage keys. Handle: `navigate`, `setTheme`, `setLocale`, `on`, `unmount`. Events: `ready`, `route`, `canvas:saved`, `run:started`, `run:finished`, `run:failed`, `result`, `error`.
- `loomcanvas-web/editor`, `mountEditor(el, options)`, the Vue component `<LoomCanvasEditor>` and the custom element `<loom-canvas-editor>`: only the canvas editor, with no list, shell or account. It reaches a backend only through an adapter the host supplies (`EditorAdapter`); `createHttpAdapter` implements it for the stock server and `createMemoryAdapter` needs no server. A canvas is loaded by id through the adapter or passed in as a document; `readOnly`, node layout, feature switches, node types. Handle: `getDocument`, `setDocument`, `setCanvasId`, `save`, `fitView`, `runAll`, `runNode`, `addNode`, `undo`, `redo` and the setters. Events as above plus `change`, `saved`, `selection`.
- The canvas document format is a public contract: typed (`CanvasDocument`), versioned (`schemaVersion` 3, the number the server uses) and migrated on load by `migrateDocument`, which is exported and has no dependencies.
- When embedded, LoomCanvas stays inside its mount root: every style rule is confined to it, tokens and theme attributes are set on it, popups attach to a layer inside it and are positioned relative to it, responsive layouts follow its size, and keyboard shortcuts act only on events that belong to it. Nothing is written to `<html>`, `<body>`, `<head>` or `document.title`. The limits of same-document embedding are listed in the guide.
- The stand-alone app is built from the same entries and behaves as before. Internally: the editor's backend calls go through the adapter (`web/src/utils/canvasBackend.ts`), the router and the app start-up are factories, styles are scoped to `.lc-root` (`<html>` carries that class), and the three self-hosted fonts moved to their own stylesheet.
- Teams in both entry points, all additive: a host that passes none of this, and an adapter that implements none of it, behave as before.
  - `mountLoomCanvas`: the option `space` (`'personal'` or a team id) pins the app to one space, where the user cannot switch (in a team the top bar names the team and the role as text); the feature flags `spaceSwitch` (the switcher in the top bar) and `teamAdmin` (the Team page and its entry points; off, the switcher is for switching only: no "create a team", no "join with an invite", no member counts); the event `space` (`{ id, kind, name, role }`) when the user enters a space; the page names `team` and `join`. In-app paths of a team space start with `/t-<team id>`.
  - `createHttpAdapter({ space })` sends `X-Space` with every request of that adapter and implements the edit lock and revision-checked saves against the stock server.
  - `EditorAdapter` gains optional members: `acquireLock`, `releaseLock` and `peekLock` (the edit lock: take or renew it, give it back - `releaseLock(id, { unloading: true })` when the page itself goes away - and look at it without taking it; without `acquireLock` the editor never locks), `createCanvas` (needed for "make a copy" and "save my version as a copy"), an `options` argument of `saveCanvas` (`{ baseRevision, force }`; an adapter that ignores it keeps "last write wins"), the optional fields `revision`, `access` and `lock` in what `loadCanvas` returns, and inside the optional groups `templates.createCanvasTemplate` / `removeCanvasTemplate` / `createTextTemplate` / `removeTextTemplate` and `assets.update`. The lock belongs to one editor (an adapter instance), not to one account: `lock.sameUser` tells the editor that the holder is the same person's other tab. A rename is a metadata save: `saveCanvas(id, { name })`, never part of a content save.
  - The editor has a new event, `created` (`{ canvasId, fromCanvasId }`): it stored its document as a new canvas.
  - The examples show it: `host-page` has a space selector in the host's own navigation, `vue-editor` builds one adapter per space.
- A switched-off feature leaves no entry point. A page that is the feature goes with its switch and does not exist: no sidebar item, no link, not reachable by `navigate()` or by address (`assetLibrary` → `assets`, `brandKit` → `brand-kits`, `modelManagement` → `models` and `setup`, `teamAdmin` → `team`), and the Settings page does not exist for somebody who would find nothing on it. `cost: false` also removes the money from History (column, tile, CSV), the workbench, the Models page and a team's usage, members and limits screens; `templates: false` removes "start from a template" on the workbench; `batchDownload: false` the zip download on canvas cards; `share: false` the team setting about share links; `externalLinks: false` the providers' "get an API key" links; `themeSwitch` / `localeSwitch` also apply to the sign-in, set-up and share pages; the built-in guide leaves out what is switched off. In the editor entry a link to a page (it has none) is not rendered instead of breaking the popup it is in.
- `examples/react-host`: a React host (Vite, React 19, TypeScript) that uses `mountEditor` as a component and the custom element in JSX, with the memory adapter and with the HTTP adapter on another origin; its production build is served under a strict Content-Security-Policy, and the guide's React section is taken from it. `npm run versions:check` covers its version, licence and Node floor; `examples/` is left out of the Docker build context.
- Fixed in the editor entry: an editor unmounted with unsaved changes sent its last save to the page's own `/api` instead of the host's adapter (the adapter is now kept for that save, and an idle save queue starts at once); a toast that arrived after the last view was unmounted was appended to the host's `<body>` (it is dropped); a "set prices" / "change limits" link of a limit notice opened a new tab on an address the host does not serve (it navigates in place in memory mode and is left out when that page does not exist); "Open" on a share link in "my shares" did the same.
- `node scripts/build-lib.mjs --out=<dir>` (in `web/`) builds the library into another folder; `LC_LIB=<dir> node examples/serve.mjs` serves it.
- No server change for the integration itself. `CORS_ORIGIN` already covers a front end on another origin, and `/files` is readable cross-origin.
- Tests in `web/` (Vitest, `npm test`): a snapshot guard over the public surface, option and router-guard handling, the adapter contract run against both adapters (the HTTP one against the real server when `TEST_MONGODB_URI` is set), the document migrations checked against the server's, and the style-scoping plugin.

**Packaging and project**

- Dockerfile (non-root, health check) and Docker Compose file with MongoDB 7.
- Tests for the runner, providers (against a fake upstream), pricing, crypto, SSRF guard, storage keys and the storage layer, image tools, schema migration, message catalogs, and end-to-end API and security suites.
- Repository checks for versions, dependency licenses and UI strings; CI workflow.
- AGPL-3.0 license with a separate commercial license, CLA, trademark policy, third-party notices.
- Documentation in English and Chinese under `docs/`.

**Gaorui models**

- Added `veo-3.1` (Veo 3.1: text, up to 3 reference images, or first and last frame; 8 s fixed).
- Removed `sora-2-openai-12s`: the service has no channel for it (HTTP 503 `model_not_found`) and does not list it. A canvas node that still names it shows the model as unavailable and asks for another one.
- `omni-flash` no longer offers 6 s: the service lists `omni_flash_6s` but answers HTTP 503 `model_not_found` for it. 8 s is the default; a node that stored 6 s falls back to 8 s.
- Fixed: reference images of the Gaorui image models are now sent as public URLs only. The service refuses inline base64 (`image_must_be_url`), so an image without a public address is refused before the request is sent, with the usual "A publicly reachable URL is needed…" message.
- Fixed: an upstream error that arrives as a JSON string inside another error body is shown as its message, not as raw JSON; and a `model_not_found` answer is no longer retried, whatever its HTTP status (the service sends it with 503).
- Added `grok-imagine-1.0-video` (Grok Video 1.0: text or up to 3 reference images; 6, 10 or 15 s; 480p).
- `omni-flash` no longer offers 4k (720p and 1080p, as on the Gaorui main site), and `omni-flash-edit` has no resolution to choose: an edit is always 720p. A node that stored 4k falls back to 720p.
- `grok-imagine-video-1.5-preview` no longer offers 4 s: asked for 4 seconds, the service returned a 6-second clip. The shortest is 6 s; a node that stored 4 s falls back to 6 s.
- Models that only take reference images by public URL (the Gaorui image models, Veo 3.1, Grok Video) are marked as such, and the canvas says so before a run: on an instance without a public address, a node that uses one of them with an image connected shows the reason and what to do, and Run stops there. The same for the source video of a video edit. Gaorui has no upload endpoint that would take a local file with just the key.

**Teams**

- A second kind of space next to every account's personal one: a **team**, shared by several accounts. A team's canvases, share links, assets, brand kits, saved templates and snippets, providers and API keys, prices and runs belong to the team. Three roles: owner (one per team), admins, members. Everything is part of the AGPL code base.
- Which space a request acts in is one header, `X-Space: <team id>` (or `personal`); without it a request acts on the caller's personal space, so every existing client, and the stand-alone editor's adapter, behaves exactly as before. Team management is addressed by path, `/api/teams/:id/...`. Membership is looked up on every request: somebody who is removed is refused on their next call.
- Nothing is migrated. The per-space collections keep carrying the space's id in `userId` (an account's id for its personal space, the team's id for a team) and gain `createdBy`; every account's existing data simply is its personal space, and no stored document is rewritten. A version from before teams does not see team data and does not hand it to anybody. The reasoning is in `docs/architecture.md`, section 12.
- **Creating a team needs the super admin's authorisation**: a per-account grant (`canCreateTeams`, in user management) and a request flow (an account asks, the super admin approves or rejects with a reason). Two site settings bound it: `teamMaxPerUser` (default 3) and `teamMaxMembers` (default 50).
- **Invite links** are the way in: 7 days and 10 uses by default, revocable, always joining as a member. With registration closed an invite link cannot be used to get an account.
- **The team's keys**: the owner and admins configure providers, keys, custom models and prices once; members run with them and are never shown a key, its last characters or the address it is sent to. Inside a team only the team's providers exist - a member's personal keys are not used there, and the team's keys are not used anywhere else.
- **Team canvases** have three levels of visibility - only me (and the owner), team can view, team can edit - with "team can view" as the default for a new canvas, changeable per canvas by its creator and per team by the owner. Canvases, and assets, can be copied between a personal space and a team; the copy takes its files along.
- **One editor at a time, no real-time collaboration**: an edit lock per team canvas, held by one editing session - one tab, not one account: a second tab of the same person is locked out and takes over like anybody else - for 36 seconds, renewed every 12, given back at once when the page closes (a `sendBeacon` to the public `POST /api/workflow/:id/lock/release` with the lock's release token), and a revision check on every save - a save that started from an older revision is refused with `409 canvas.conflict` instead of overwriting. The revision check is available in personal spaces too, for clients that send `baseRevision`. A session that lost the lock is told how (`data.lost`: taken over, or run out while the tab was in the background); a tab that comes back and finds the canvas untouched simply carries on (`state: "reacquired"`). A save of that session that was still on its way when its page closed is written without taking the lock back. Two read-only calls let the people who wait find out without a push channel: `GET /api/workflow/:id/lock` (a read-only editor, every 5 seconds: free now? renamed? saved?) and `GET /api/workflow/locks` (a canvas list, every 10 seconds: who is editing what).
- **Renaming is not editing**: a canvas's name, viewport and old-layout flag are metadata. Saving them (`PUT` with only these fields, or `PATCH /api/workflow/:id/meta`) needs the right to edit and nothing else - no lock, no `baseRevision` - and never moves `revision`, so a canvas can be renamed while somebody edits it and that editor's next save is no conflict. The open editor follows the new name through `metaRevision`, which every lock and save answer carries.
- **Monthly limits** per member and per team, in runs and in estimated money, in the team's time zone. At a limit new runs are refused and running ones finish. With a money limit set, a model without a countable price is refused unless the owner switches that off. "Used" has one definition everywhere - succeeded + in progress; failed and canceled runs count for nothing - and the limits answer, the member list and the usage answer (`?limits=1`) all carry the same numbers with their breakdown and a ready-made state (`effective`). Limits are exact for any number of simultaneous submissions and server processes: admission is one atomic update of a per-team, per-month counter, which is a cache of the run records and is rebuilt from them when it is missing or disagrees. A chat run priced per token holds a reserve while it runs and is settled to its real cost when done. A failed or canceled chat run gives its reserve back; one whose upstream reports no usage becomes a run of unknown cost. Each of the six `budget.*` refusals carries structured `data` (whose limit, the numbers, what the run asked for and of what kind - `requestedKind` -, when it starts again, who can change it), and a refusal is never issued from a counter that disagrees with the run records: it is checked first. The limits answer tells every member who to ask (`managers`) and which models they cannot run for want of a countable price (`cannotRun`), so no client works that out from prices. Disabling an account cancels its queued runs, as removing a member does, and gives back at once the edit locks it held on team canvases; runs canceled that way - and by a team being closed - say why (`run.canceled_account_disabled`, `run.canceled_member_removed`, `run.canceled_team_closed`) wherever they are read.
- **Usage**: the owner sees everybody's records and usage and can filter by member; everybody else sees their own; a team setting (off by default) lets admins see all.
- **Queue**: still fair per person - an account is one person in the queue wherever its runs are - plus a cap on the runs of one team in flight (`teamConcurrency`, default 4, or a team's own value).
- **Leaving and removal**: what a member made stays with the team; their "only me" canvases pass to the owner; their queued runs are canceled and running ones finish; their edit lock and the invite links they made are dropped.
- **Dissolving** a team closes it at once and keeps it restorable for 7 days; then it is removed with its data and files. Handing a team over, and - for the super admin - suspending a team, removing a closed one and appointing a new owner when the current one's account cannot be used. An account that owns a team cannot be deleted until the team is handed over or removed.
- **Activity log** per team: members, invite links, providers and keys, prices, limits, canvases deleted, restored, taken over or overwritten, share links, settings, dissolving. Read by the owner and admins, never editable, kept `teamActivityDays` (default 365), and free of keys, addresses and prompts.
- The super admin manages that teams exist and how large they may be, and sees names and numbers only: no endpoint gives the super admin a team's canvases, keys or files.
- Canvases deleted in any space can be restored for 30 days (`GET /api/workflow/trash`, `POST /api/workflow/:id/restore`). Templates and prompt snippets can be saved and deleted through the API in any space.
- The billing hook's `ctx` gains `spaceId` and `teamId`; `ctx.userId` stays the account that started the run.
- **People who are gone still have a name.** Every person the API names is one shape with `state`: `active`, `left` (the account exists but is no longer in the team) or `deleted` (the account is gone) - the same in canvases, assets, history records, templates, share links, providers and the activity log. The name somebody went by in a team is kept when they leave, are removed or have their account deleted, so what they made still says whose it was.
- **The activity log says what changed**: role before and after, limits before and after (the numbers of the team's limits used to be dropped from the entry), old and new names, the settings that changed with their old and new values, a price before and after, what an invite link allowed, whose link somebody joined with. New entry types `member:renamed` and `team:avatar_changed`. The people of an entry read under the display name they have in the team today.
- What a team's screens are told in addition: how many uses an invite link has left (also in the public preview, and nothing else about its use); who looks after a provider (`maintainer`) and how its last connection test went (`lastTest`, for those who manage providers only); the team's concurrency cap in the team detail; the team's avatar in the super admin's list; who saved a template or snippet; and, when a team is removed, one complete `counts` object of everything that went.
- **Asset folders exist while empty**: `POST /api/user-asset/folder` creates one, `DELETE /api/user-asset/folder?name=` deletes an empty one (`409 asset.folder_not_empty` otherwise), the list carries `folderList` with a count per folder. A folder no longer disappears when its last asset is moved out.
- `GET /api/spaces/copy-targets` lists where a canvas or an asset can be copied to, with the reason a space cannot take it.
- **History**: a record carries the text answer of a chat run, token usage, the files of an image or video run, queue and run time and the error code; `GET /api/admin/usage/records/:recordId` returns one record in full; `POST /api/runs/download-zip` packs the results of up to 100 records into one zip.
- The history zip is written one file at a time and never left half-finished without saying so: a file that cannot be opened becomes a `…-failed.txt` note, a file that breaks off half way (or the size or time budget running out inside one) cuts the download instead of ending a short archive, and a client that goes away stops the work at once - before, a download abandoned in the middle of a stored file kept its file open and its request waiting for good, and a broken file hung the response. Entry names are single path segments and unique; `urls` takes at most 2000 addresses; one account can have 3 archives in the making (`429 run.zip_busy`). `GET /api/admin/usage/records?full=1` returns every record of the page whole, for exports.
- The permission matrix is one table in the code (`server/src/services/permissions.js`); the table in the API reference is printed from it and a test walks every cell over HTTP.

**Teams in the web app**

- A **space switcher** in the top bar, right of the logo: personal space, the teams you are in with your role, **Create a team** (or **Ask to create a team** for an account without the authorisation: one request with an optional note, which can be withdrawn and, when declined, shows the reason), and **Join with an invite**. Pages of a team space live under `/t-<team id>/…`; personal pages keep their addresses.
- In a team space the sidebar is Team home, Canvases, Assets, Models, History, Team, Settings. **Team home** shows this month's runs and estimated amount, what is queued and running, and the monthly limit in full (bars, what is left, "used = succeeded + in progress", failed and canceled listed apart as not counting, runs of unknown cost, the reset in the team's time zone), a three-step start for a new team, recent canvases and the team's providers.
- The **Team** page: **Members** (search, role filter, make or remove admin, per-member limits, display name, remove, leave; invite links valid 1, 7 or 30 days for 1, 10 or unlimited uses, copy, revoke), **Usage** (the current month's limit, then the chosen month by member, model or day - counted and not-counted runs in separate columns - with CSV export for the owner; one's own for everybody else), **Activity** and **Team settings** (basics, default permissions, limits, transfer and dissolve, each confirmed with the team's exact name).
- **Canvases in a team**: a visibility on every card and in the editor's title block (Only me, Team can view, Team can edit), filters by visibility and creator, "… is editing" on a card, Duplicate, copy to another space, Team access. The Share dialog has two tabs, **In the team** and **Public link**.
- **A run refused by a monthly limit explains itself where it was started** - composer, inspector, node, batch dialog, queue list - and stays readable: which limit, the numbers, when the count starts again in the team's time zone, and who to ask by name (or where to change it, for whoever may). The same notice appears before running when a limit is already used up; models that cannot run for want of a price are marked in the model list. A refusal is not stored in the team's canvas.
- **Taking turns in the editor**: whoever opens an editable team canvas first edits; everybody else gets a read-only bar with **Make a copy** and **Take over**, and **Start editing** once the other person has left. A save that started from an older version opens "Somebody else changed this canvas": save my version as a copy, load the latest version, or (creator, admins, owner) overwrite. The bar tells the cases apart: somebody else is editing, **you have the canvas open in another tab** (**Edit here** moves the editing over), somebody took over, or this tab was in the background for too long and somebody started editing. Closing the holder's tab frees the canvas at once and the waiting editor offers **Start editing** within about 5 seconds, without a reload; a hidden tab saves what is unsaved the moment it is hidden and renews its lock the moment it is shown again. While read-only, the toolbar is a read-only one - asset library to browse and download, the share dialog to look at the team access and copy an existing public link, search, batch download - and the nodes can be looked at properly: open an image or a video large, play a video, scroll, select and copy text and prompts, look through earlier versions, download a result, and read a node's prompt, model and parameters in a read-only composer or inspector, with nothing on them that would change the canvas (the mode is live: a node switches the moment the editor loses or gets the lock); what the holder saves appears within seconds. The confirmation of **Take over** says what really happens: you can edit right away, and the other page turns read-only at its next automatic renewal or save, within about 12 seconds. **The name can be changed by whoever may edit, at any time**: from the list, the workbench or the editor's title, also while somebody else is editing; the other editor's title follows without a conflict. The canvas list and the workbench refresh "who is editing" and the canvas names in place every 10 seconds while they are visible, so a rename by somebody else shows up without a reload and without leaving the tab and coming back.
- **Limits where you work**: a counter next to Run all, "My limit this month" in the queue list, and the server's message with the numbers on a node whose run was refused. Runs without a price are shown as "Cost unknown" and counted separately, never as 0.
- **Models, history, assets, brand kits, templates in a team**: members get the Models page read-only, without key, key tail or address; the owner's History has a member filter and column and cannot clear the current month; "My assets" becomes **Team assets**; brand kits are chosen by everybody and edited by the owner and admins; anybody can save the current canvas as a template and a prompt as a snippet (in a personal space too).
- A **Trash** on the Canvases page, in personal spaces too: deleted canvases can be restored for 30 days (in a team by the owner and admins).
- The **join page** `/join/<code>` shows the team, the inviter and the member count before sign-in, and each reason an invite cannot be used. With registration closed it says so and does not offer to register.
- Somebody who is removed, or whose team is dissolved or suspended, while using it is taken back to their personal space with a dialog that says which of the three happened.
- **Super admin**: a **Teams** section in Settings (the three site settings, the requests to create teams, and the list of teams with numbers only and Change limits, Suspend / Resume, Restore, Name new owner, Delete permanently); **Default team concurrency limit** under Run limits; a Teams column and **Allow creating teams** / **Take back team creation** under Users.
- Wherever the app names a person - canvas cards, the trash, assets, invite links, usage, activity, provider cards, share links, saved templates and snippets - somebody who has left the team keeps their name with a **Left the team** tag and a deleted account with **Account deleted** (one shared `PersonName` component and `utils/person.ts`, reading `Person.state`); only when no name was kept does it say "Former member" / "Deleted account".
- **Activity** is written on the client from each entry's `type`, `actor`, `target` and `detail`, in both languages: before → after for roles, display names, limits, prices, visibility, the team's name and settings; the facts of an invite link; people under their current name; the super admin's actions under "Super admin". An entry of a type the client does not know falls back to the server's sentence.
- **Models**: provider cards show who maintains the provider and when it last changed; the owner and admins (and a personal space) see the stored result of the last connection test - Connected / Last test failed, with the message / Not tested - which updates when a test finishes. Members see only Available / Unavailable.
- **Assets**: folders are first-class. A **Folders** dialog creates folders (also empty ones), shows how many assets each holds and deletes empty ones; deleting a folder that still holds assets shows the server's refusal and offers "Show these assets" and, for the owner and admins, "Dissolve folder, keep assets". An empty folder says so when you filter on it. The Chinese interface calls them 分组 throughout (it said 文件夹 before).
- **Copy to…** asks the server where a canvas or asset can go (`GET /api/spaces/copy-targets`) and lists every space of the caller; unavailable ones are shown disabled with the reason (copying out switched off, team suspended, team dissolved, asset kind full, the current space).
- The join page shows how many uses an invite link has left; the team home shows the team's concurrency cap next to what is running; saved templates and snippets show who saved them, and a snippet's title is no longer cut short by its tags; the super admin's team list shows team avatars, and deleting a team permanently lists what was removed in fourteen named counts.
- Keyboard: every dialog of the team pages, the space switcher, canvas list, assets, library, brand kits and the canvas-side dialogs keeps Tab inside, closes on Esc (top-most first) and gives focus back to what opened it, through one mechanism (`composables/useDialogFocus.ts`, the `v-dialog` directive in `directives/dialog.ts`, the `TeamDialog` shell). The "more" menu of canvas cards and folder rows is the shared `ActionMenu` (arrow keys, Home / End, type-ahead, Esc). `LcSelect` has a `searchable` option - used for the team time zone and other long lists - and gives focus back to its button. `ConfirmPop` has a `tone`: a confirmation that destroys nothing (taking over your own other tab, duplicating a canvas) is no longer painted red.
- **History, reworked** (personal spaces too). The details of a run show everything: for a chat run the whole reply and prompt (copyable), the system prompt, tokens in and out, cost, queue time and duration; for an image or video run the files, what was sent along and the parameters; a failed or canceled run its reason and stable error code; a run whose files the retention period removed says so. Thumbnails come from the record, so the page no longer asks for run status except to follow unfinished rows. **Several results leave as one ZIP**: tick records (kept across pages, up to 100 records and 100 files), one request, a progress note while it runs, the server's own sentence when it refuses; a record with several files downloads as one ZIP as well. **The numbers agree with the budget**: tiles are Records / Succeeded (with what counts toward the monthly limit) / Not succeeded (failed · canceled) / Estimated cost (succeeded runs with a price, plus what runs in progress hold); a failed or canceled row says **No charge** instead of the estimate from submit time, an unpriced success **Cost unknown**, a run in progress **≈**. **CSV**: all records of the filter with the whole prompt, system prompt and reply, tokens, queue and run seconds, cost with a note, error code and reason, local time with the zone in the header - BOM, CRLF, quoted, formula-safe, cells cut at what a spreadsheet can hold. Departed members keep their names with **Left the team** / **Account deleted** in the table, the member filter, the details and the CSV. At 1440px the filter bar is one line and the table keeps Duration next to Member; narrower windows get two-line rows, phones get cards; the selection bar stays in view while the list scrolls. **Copy prompt** copies the whole prompt, not the 200 characters of the list.
- **Models**: capability chips stay on one line with a "+N" that opens the rest (keyboard, and a real touch target on phones); between 721 and 900px the model rows stack instead of squeezing the capability column to a letter; English prices read as English ("CN¥0.20 per image", "$0.15 per 1M input tokens · $0.60 per 1M output tokens") and counts are pluralised; the price, name and provider dialogs no longer force a dark colour scheme in the light theme. Every dialog of the page (provider, delete confirmations, custom model, name and order, price) is in the portal as a sheet with the shared focus handling; the vendor cards are one radio group (arrow keys, Home / End).
- **Settings**: every dialog of the sections - users, sessions, storage, the team cards (limits, suspend, name new owner, deletion result, approve, decline), unsaved changes - uses the shared focus handling. Deleting an account says exactly what happens: its personal space is deleted, it leaves its teams, and what it made there stays with the team. The users list stays a table down to tablet widths and gives up its less important columns step by step (the role moves next to the name and the join date goes; then the avatar and the Canvases and Runs columns), and is one card per account on a phone; English says **Reset password** and **Temp password**.
- Three changes reach everybody, teams or not. Changing the **Base URL** of a provider that has a saved key asks for the API key again. Changing the endpoint or the Access Key ID under Settings → Storage asks for the secret again. And a personal canvas open in two browser tabs now gets the conflict dialog instead of the later save silently replacing the earlier one.

**Security**

- **A stored provider key is only ever sent to the address it was saved with.** Until now a `PUT /api/admin/providers/:id` could change a provider's address and keep the stored key, which let whoever could edit the provider send that key to a server of their choosing. Changing the address in use now needs the key again in the same request, or giving the stored key up (`clearKey`); otherwise `400 provider.key_required_for_url`. This applies to personal spaces as well as teams. If your client edited a provider's address without re-sending the key, it has to send the key now.
- The same rule for storage: a saved S3 secret access key is reused only while the endpoint and the access key id are the ones it was saved with; a request that changes either has to bring the secret (`400 storage.secret_required`), for saving and for the connection test.
- "Test connection" of a provider tests what is saved and reads nothing from the request (it already did; it is now stated and tested).

**Known limitations**

- The built-in Gaorui models have been run against the real service; the OpenAI and Google Gemini integrations follow the official documentation but have not been run by the project. That includes the OpenAI `/images/edits` path and the model names in the OpenAI and Gemini lists.
- With a Gaorui image model, image-to-image needs a public address for the reference image (`PUBLIC_URL`, or files kept in a bucket reachable from the internet).
- The S3 storage driver is verified against MinIO. It has not been run against AWS S3, Cloudflare R2 or Aliyun OSS; their settings follow each vendor's S3-compatibility documentation.
- Switching storage does not move existing files, and there is no migration tool.
- Accounts and teams are separated by the API, in one process, one database and one storage area: no per-account storage quota, no email verification or two-factor sign-in. It is not a hardened multi-tenant boundary. Teams have no real-time collaboration (one person edits a canvas at a time), no comments, no email (an invite is a link you pass on yourself), and no per-member choice of models. A team's amounts are estimates from the prices the team entered, not bills.
- The run queue lives in one server process, so several server processes on one database are still not supported as a deployment. (A team's monthly limits no longer depend on that: they hold across processes.)
- No content moderation, no private file URLs.

**Upgrading a checkout from before accounts**

- `ACCESS_PASSWORD` is gone. If it is still set the server logs one warning and ignores it; remove it. Signing in is always required now, and tokens issued for the shared password no longer work.
- Nothing is migrated by hand. At its first start the new version creates the super admin account and hands it all of the existing data (canvases, share links, assets, brand kits, providers and their keys, prices, usage); the log says `[auth] the data from before accounts now belongs to "admin": {...}`. Set `ADMIN_PASSWORD` before that start, or read the generated password from the start-up log, then sign in as the super admin. Accounts that register start empty. `SECRET_KEY` must stay the same for stored keys to decrypt.
- File addresses stored in canvases keep working. New files are stored under `uploads|outputs|tools/<account id>/…`.
- API: `POST /api/auth/login` takes `{ account, password, remember? }`; a missing session is `401 auth.required` (was `auth.login_required`); `GET /api/bootstrap` (also at `/api/app/bootstrap`) carries `auth` and `user`, and no longer `authRequired`, `authed` or `site.defaultTheme`; `/api/admin/settings` and `/api/admin/storage` are for the super admin, the other `/api/admin/*` endpoints work on the caller's own providers, models and usage. Model ids and provider slugs are per account.
- Billing hooks: `ctx.userId` is the account id (it was the constant `local`); `ctx.username` is new.
- The site-wide default-theme setting is gone: the theme (dark, light or system) is each account's own preference, and dark is the default. Providers, models and prices moved from Settings to the Models page and usage to the History page; old `/settings?tab=…` links are redirected.
- Canvases saved before the redesign are arranged once on first open if their nodes overlap at the new node sizes (undo with Ctrl+Z).
- Generation nodes (image generation, image edit, video generation, video edit, LLM, video analysis) come in three layouts, chosen per account under Settings → Appearance or from More ⋯ on a canvas: **Result first** (the default: the node is the result, and one composer under the selected node holds the prompt, model, parameters, cost and Run), **Compact + side panel** (small nodes, with every setting in an inspector at the right edge of the canvas) and **Everything on the node** (the successor of the previous node: result on top, one prompt field, one row of model, parameters, cost and Run). The three share one implementation and send the same requests. Switching never moves nodes; when nodes overlap afterwards a notice offers Tidy up. Share links always show the result-first layout, read-only. API: the User object has `prefs: { nodeLayout }`, changed with the new `PUT /api/auth/prefs`. The built-in templates were re-spaced for the three layouts.
- The canvas toolbar (add-node buttons, asset library) now also holds **Share** and **More ⋯**; the separate button group at the top right of the editor is gone. The toolbar can be dragged anywhere on the canvas by its handle and flipped between vertical and horizontal; position and orientation are remembered per browser, it keeps clear of the title block, bottom toolbar, minimap, queue button and side panel, and double-clicking the handle sends it back to the left. On a phone it is a fixed row under the title block. The side panel of the "compact" node layout now starts at the top of the canvas.
- The `jsonwebtoken` dependency was removed.

### 中文

**画布**

- 基于 Vue Flow 的无限画布编辑器：素材节点（文本、图片、图片集合、视频）、生成节点（图片生成、图片编辑、视频生成、视频编辑、大语言模型、视频分析）、成品节点、分组。
- 连线分类型；撤销重做、复制粘贴、原地复制、框选、对齐与等距分布、按数据流整理、吸附到网格、节点搜索、小地图、沉浸式、每张画布单独的外观。
- 运行单个节点、一条分支或整张画布；批量运行，一次最多 100 份素材；每个节点保留历史版本；对已有结果的节点重新运行前先确认。
- 不调用任何模型、在服务端处理的工具节点：切片、拼图、加水印、改尺寸、多平台导出。
- 画布模板和文本模板（内置两个画布模板和一组中英文提示词片段）、品牌包、素材库、把画布里的素材打包下载。
- 只读分享链接：保存画布快照，可设有效期，可撤销；快照里不带运行状态、任务号和成本。
- 中英文界面。两套主题：深色（默认）和浅色，另有「跟随系统」。切换入口是顶栏和落地页 / 登录页 / 分享页页头的图标，以及「设置 → 外观」的三张预览卡；选了立刻生效，带一次很短的交叉淡入，不刷新页面。选择跟着账号走（`prefs.theme`，`PUT /api/auth/prefs`），同时记在浏览器里，没登录的页面和打开时的首帧也用它（由同源脚本 `/theme-boot.js` 套用，CSP 仍是 `script-src 'self'`）。画布底色留在默认档时跟看的人的主题走；作者自选的底色原样保留，连线、组的虚线框、图案和小地图跟着这个底色的明暗取色。落地页、注册页和登录页，以及账号还没有服务商时出现的「添加一个服务商」页。
- 应用外壳是顶栏加左侧栏：工作台（最近的画布、模板、最近生成、本月用量、生成队列、服务商）、画布、素材库、模型管理（服务商、模型和价格）、生成记录（每一次运行，带汇总、筛选、详情、导出 CSV 和清理）、设置（界面语言、账号与会话；超级管理员另有存储、运行限制、站点名称 / Logo / 默认语言、是否开放注册、用户管理和团队）。进入编辑器后侧栏收成图标栏。
- 生成节点高了很多（画布文档随这次改版升到 `schemaVersion` 2，现在是 3，见下），所以内置的两个模板重新排过；最后一次保存还在旧版本的画布，第一次在编辑器里打开时会自动整理一次，而且只在节点按新尺寸互相重叠时才整理。会有提示，按 Ctrl+Z 可以撤销；不会重复，也不会动用当前版本保存过的画布。
- 品牌包改成按画布选，不再每个节点各选一次。生成节点正文里的「品牌包」一行没有了；画布名旁边多了一个按钮，显示这张画布套用的品牌包，点开是一段「品牌包是什么、运行时会做什么」的说明、你的品牌包列表和「不套用」，选的结果对整张画布生效并跟画布一起保存。单个节点仍然可以例外（在节点上右键，或在改提示词的地方用「此节点」）：跟随画布、此节点不套用、单独用另一个；有例外的节点标题旁有一个小图标。改提示词的地方有一行写明这次套用的是哪个品牌包，点开能看到下一次运行会原样加上的内容：加在提示词最前面的话、「不要出现：…」那一行、会发出去和不会发出去的参考图。
- 品牌包的管理挪到「素材库 › 品牌包」（`/assets/brand-kits`）：卡片上有参考图和内容摘要，可以新建、修改、复制、删除、设为「新画布默认」，还能看到有几张画布在用。默认品牌包现在作用于新建的画布，而不是新建的节点。在画布里也能用弹窗打开同一个编辑表单。
- 画布文档升到 `schemaVersion` 3：画布带 `brandKitId`，不跟随画布的节点带 `data.brandKitOverride`。旧画布在启动时和读取时自动转换：所有生成节点用的是同一个品牌包时，它成为画布的品牌包；否则各节点保留自己的，作为例外。每个节点套用的都还是原来那一个。`GET /api/brand-kits` 多返回 `usedBy`。
- 分享链接不带品牌包（画布的品牌包和节点的例外都不进快照），从分享链接复制出来的画布从不套用开始；复制自己的画布两样都保留。
- 套用了带参考图的品牌包时，不接收参考图的模型不再提示「参考图被截断」；「这个实例没有公网地址」的提示现在把品牌包的参考图也算进去，在运行之前就说明，而不是等服务端拒绝。
- 保存：平移、缩放不再让保存状态跳成「未保存」。视野停下来之后视口会单独、悄悄地存一次，这样的保存不改变画布的「更新时间」。
- 保存：打开一张画布、什么都没动，不再闪一下「未保存」。编辑器在打开时自己补上的内容（节点的默认模型和参数、量出来的节点尺寸、布局标记）会悄悄存好；画布载入之前状态显示「加载中…」。
- 空间：在几个空间之间快速切换，不会再出现一个空间的画布列表留在另一个空间的地址下面。
- 「自动整理」现在整理画布上全部的散节点，不只是视野里的；从没进过视野的节点按估计的尺寸排。
- 生成记录：运行详情里的参数按编辑器里的叫法和写法显示（比例：自适应、时长：5 秒、参考图用法：首尾帧），不再是接口字段名；服务商显示名称。日期范围、「今天」和清理日期指的都是你所在时区的日子。
- 分享页按快照里存的显示名显示模型（发布者已经没有这个模型时显示「未注明模型」），不显示模型标识。
- 运行前检查没过的节点（缺提示词、缺参考图、没有可用模型）除了弹提示、在节点上标出来以外，还会带着原因列在生成队列清单的「没能开始」里。
- **生成队列的圆钮和清单。**圆钮是一块实心的小牌子，没有任务时也找得到，两套皮肤、深浅画布底色上都一样。连点两下、双击只是把清单开了又关；把圆钮放回角上要点清单表头里的「复位」（圆钮被挪走之后才有）。鼠标、手指、手写笔都能拖它：松手吸到左右两边，绕开别的悬浮面板，窗口变大变小也不会跑到编辑区外面。进度环画的是这一批任务的整体进度（结束的算满、排队的算零），所以一个任务结束、或者中途又加了一个，它都不会往回退；颜色沿着弧只往一个方向走。手机上清单是贴底的通栏面板：有关闭按钮，能按住往下划收起，内容在面板里滚动，让开底部安全区。宽屏上进行中的任务排在最前，整张卡片一起滚动（原来每月上限固定占着半张卡片）。清单、任务详情、画布外观面板、图片编辑器和别的弹窗一样接管键盘：焦点进去，Tab 在里面循环，Esc 关闭，关闭后焦点回到原处。
- **悬停提示。**提示由界面自己画，不再用浏览器的 `title`：跟随主题，键盘聚焦和触屏长按时也会出现，不会超出窗口，滚动、按 Esc 或指针移开就收起。只有图标的按钮仍然有读屏用的名字。被截断的文字悬停看全文；没截断的不重复提示。
- **「结果优先」布局的输入条自己找地方。**它浮在画布上面，不再非得待在节点下方：下方放不下，或者会盖住节点工具栏、生成队列圆钮、小地图、标题块、底部工具条时，先沿着节点的边滑开，再换到节点上方，再换到旁边。它可以压在别的节点上（这时底色更实），但不盖自己节点的端口。四边都放不下时画布平移一小段；编辑区小到节点和输入条摆不开时，它贴到底部变成抽屉，和手机上一样。按 Esc 收起后节点仍然选中，接着打的第一个字会把它唤回来，而且不丢。用输入法时，选中节点后的第一个键就开始组字（以前这一键会变成一个多出来的英文字母）；组字期间回车、Esc、方向键归输入法：回车不会运行，Esc 不会收起。
- **选中多个节点时的工具条**，三种布局都一样：「已选 N 个节点」、「对齐」（六种对齐、两种等距分布，一排图标）、「编组」（选中了组时是「合并为一组」，另有「解散组」或「移出组」）、「运行所选」和删除。它贴着选区，让开别的悬浮面板，手机上是固定的一行。「运行所选」把选中的、能运行的节点各跑一次，上游先跑，下游用的是新结果；「重新运行？」整批只问一次；每月上限用完时按钮是灰的，并写明原因。键盘：Tab 只停一次，← → 在按钮之间移动，Esc 收起对齐的那排图标。
- **节点工具栏在很矮的编辑区里放得下了。**整条放不下时（窗口很矮、嵌在别的页面里），按钮先变小一号，再按固定的次序收进「更多工具」：先收输出与工具、对话 / 分析，文本最后；「+」和「更多 ⋯」一直留着。鼠标、手指、手写笔都能拖它；触屏上在把手上连点两下不会复位（把手的菜单里有「复位」）。编辑区不到大约 370px 高时不显示小地图。
- **窄窗口里的紧凑布局，以及「全部放在节点上」。**属性面板开着、窗口宽度在 1000 到 1100px 左右时，选中的节点要是落在面板底下，画布横向平移到刚好看得见它，面板关掉之前不显示小地图；两样都不算一步撤销。图片、视频节点有了结果之后，运行按钮在三种布局下都写「重新运行」。在节点上，模型、参数、成本、运行始终在同一行（先收紧间距，再把参数缩成「第一项 +N」，最后才截短模型名）；大语言模型和视频分析节点的结果单独是一个框，标着「生成结果」/「分析结果」，和下面的提示词框长得不一样。
- **节点上看得出套没套品牌包。**会套用品牌包的图片、视频节点，以及有例外的节点，三种布局下表头都有一颗星：鼠标放上去写着是哪个品牌包、参考图发不出去时也写明，点开是「此节点的品牌包」（下一次运行会加什么；跟随画布、不套用，或单独用另一个）。「全部放在节点上」里，没套用品牌包的节点也从这颗星进来。换画布的品牌包、改节点的例外，都是 Ctrl+Z 的一步。「素材库 › 品牌包」的副标题写明这一页列的是谁的品牌包。
- **设置和外壳。**用户列表里，还在用临时密码的账号的标记和状态筛选的第四项，中文是「待改密码」，英文是 **Temp password**。「设置 → 外观」多了「在 Logo 旁显示站点名称」（设置项 `showSiteName`，默认打开；`GET /api/bootstrap` 里是 `site.showName`）：关掉之后，顶栏、登录页和落地页只显示 Logo，适合本身就带着名称的 Logo；没有 Logo 时名称总是显示。窗口窄于 760px 时，顶栏的语言下拉收进账号菜单。手机底部导航里，起始页那一格用放得下的短名：英文是 **Home**，中文在团队空间里是「首页」。在一台主题和账号不一样的浏览器上登录不再闪一下：登录页保持原样，应用的第一帧就是账号的主题。「页面不存在」和「连接不上服务端」这两屏有语言和主题的切换。
- **手机上的落地页。**窗口不超过 820px 宽时，页头收成一颗菜单按钮：功能、集成、开源、文档、源码、主题（深色 / 浅色 / 跟随系统）、语言、登录和注册。手机上它是贴底的面板，平板宽度下挂在页头下面；和别的弹窗一样接管键盘，点哪一节就滚到哪一节。
- **时长在哪里都是同一种写法**，每种语言一种：中文是 42 秒、1 分 05 秒、1 小时 02 分、<1 秒，英文是 42s、1m 05s、1h 02m、<1s；节点上、参数 chip 里、生成队列清单、任务详情和生成记录里都一样。视频的片长（8 秒 / 8s）也按这条规则；导出的 CSV 仍然是秒数，压在视频上的时间码仍然是 0:08。
- **被每月上限拦下的运行，上限提高之后不再一直写着「被拦下」。**这样的说明（或运行前的提醒）还摆着的时候，编辑器会在你回到这个标签页时、以及每隔 30 秒重新取一次上限：已经不成立的说明会从节点上撤掉，节点回到运行之前的样子；还成立的换成现在的数字。批量运行的弹窗现在会检查这一批里每个要提交任务的节点（包括大语言模型和视频分析节点），按它实际会用的模型查，没选过模型的节点也查得到。
- **生成记录的搜索查的是这段时间的全部记录**，不再只是眼前这一页：提示词、模型、画布名，不分大小写，输入的文字按字面匹配。汇总和导出的 CSV 跟着搜索走。
- **邀请链接。**已撤销、已过期的链接在管理列表里显示它的状态，不再写着「5 / 5」。打开一条用不了的邀请链接，加入页告诉你该找谁重新生成：生成它的人还是团长或管理员就是他，否则是团长，不会让你去找已经离开团队的人。
- 界面自带的三款字体（Inter、Sora、JetBrains Mono，SIL Open Font License 1.1）列在 `THIRD_PARTY_NOTICES.md` 里，每次构建都会把它们的版权声明和协议全文写到 `licenses/fonts-OFL-1.1.txt`。

**服务端**

- Node.js + Express + MongoDB。
- 账号：使用前必须登录。超级管理员账号是内置的：还没有超级管理员时，服务端在启动时按 `ADMIN_USERNAME`（默认 `admin`）、`ADMIN_PASSWORD`、`ADMIN_EMAIL`（可以不填；超级管理员是唯一可以没有邮箱的账号）自动创建。没设 `ADMIN_PASSWORD` 时生成一个随机密码，在启动日志里打印一次，第一次登录时必须换掉。这几个变量只在创建这个账号时读取，之后都被忽略。这个角色在接口里的值是 `owner`。
- 注册（用户名、邮箱、密码）只会产生普通用户。是否开放由超级管理员的 `registrationOpen` 设置决定，默认开放；`REGISTRATION_OPEN=true|false` 给这项设置一个初始值，设置保存过之后不再理会它。关闭注册时，`POST /api/auth/register` 返回 `403 auth.registration_closed`。
- User 对象带 `mustChangePassword`：账号的密码是别人知道的（生成的超级管理员密码，或重置给出的临时密码）时为 `true`。在 `PUT /api/auth/password` 把它换掉之前，接口只给这个账号用 `GET /api/auth/me`、`GET /api/bootstrap`、`PUT /api/auth/password`、`POST /api/auth/logout`，其余一律返回 `403 auth.password_change_required`；网页端显示「设置新密码」这一屏。新密码和当前密码相同会以 `400 auth.same_password` 拒绝。
- `GET /api/bootstrap` 带 `auth: { registrationOpen }` 和 `user`。
- 每个账号有自己的画布、文件、分享链接、素材、品牌包、运行记录和用量，也有自己的服务商、API Key、自定义模型和价格：这就是它的个人空间。账号之间只有通过团队才共用东西（见下面的**团队**）。访问别的账号的资源返回 404。
- 会话保存在服务端（只存凭证的哈希；有效期 12 小时，勾选「记住我」为 30 天）：退出登录、退出其他设备、修改或重置密码都立即生效。密码用 scrypt 哈希。
- `PUT /api/auth/password` 会结束这个账号的全部会话，包括调用方自己的；返回 `{ revokedSessions, token }`，其中 `token` 是给调用方的新凭证（有效期是原会话剩下的时间）。网页端会悄悄换上。
- 超级管理员只管站点：是否开放注册、存储、运行限制、站点名称 / Logo / 默认语言，以及用户列表（停用、启用、连同数据和文件一起删除、重置密码）。超级管理员不能通过接口读取别的账号的数据。
- 忘记密码用 `node server/src/cli/reset-password.js <用户名或邮箱>`，超级管理员的密码也是这样重置；系统不发送任何邮件。它和超级管理员的「重置密码」一样，给出一个临时密码，下次登录时必须换掉。
- 服务商，带注册表和按模型的覆盖项。内置：高瑞（图片、视频模型；对话模型暂时作为自定义模型添加）、OpenAI（对话，图片生成与编辑）、Google Gemini（图片、对话）。见下面的「服务商」。
- 进程内任务队列：并发有上限，在各账号之间公平分配（`userConcurrency`、`userQueueLimit`），每一步都有硬性时限，只在可以安全重新提交时才重试，支持取消，重启后接着处理未完成的运行。
- 结果转存到自己的存储，按内容识别类型，生成 WebP 缩略图。存储：本地磁盘，或者一个 S3 兼容驱动，对接 AWS S3、Cloudflare R2、阿里云 OSS、MinIO 等服务（见下面的「存储」）。
- 按每个账号自己维护的价格表预估成本，没有适用价格时显示「成本未知」；按天、按模型的用量汇总，用量明细及其清理。
- `GET /api/admin/usage`、`GET /api/admin/usage/records` 和 `DELETE /api/admin/usage/records` 接受 `tz`（IANA 时区名，默认 `UTC`）。`from`、`to`、`before` 里只写日期时，指的是 `tz` 时区里的那个自然日；完整的时间按原样使用；不带 `tz` 时行为不变。不认识的时区名返回 `400 validation.invalid`。网页端总是带上浏览器的时区，所以「今天」是用户本地的今天。
- 可选的计费钩子（`BILLING_HOOK`），在每次运行前后调用，并告知这次运行属于哪个账号（`ctx.userId`、`ctx.username`）。
- 服务商的 API Key 用 `SECRET_KEY` 以 AES-256-GCM 加密保存；登录、注册和修改资料都有限流。
- 登录限流（在内存里，时间窗 10 分钟）：同一个账号名 + 同一个客户端地址 10 次，同一个客户端地址 30 次，同一个账号名 100 次，全部合计 3000 次。后两条对账号的「熟悉地址」不生效（最近 30 天从那里成功登录过，或者那里有它的有效会话），所以拿某个用户名乱猜，锁不住它的主人。注册：每个地址每小时 20 次。`PUT /api/auth/profile`：每个账号每小时 20 次（`429 auth.too_many_attempts`），免得它的「已被占用」回答被拿来无限次试探邮箱。
- 凡是用户或上游给出的地址，都经过带 SSRF 防护的下载器；上传文件按内容判断类型；安全响应头，包括 Content-Security-Policy。
- 服务端提示有中英文，按请求选择语言；错误带稳定的标识。
- 画布文档带 `schemaVersion`（现在是 3），启动时和读取时迁移。
- 管理设置：站点名称、Logo、默认语言、是否开放注册、并发数（整个实例的和每个账号的）、每个账号的排队上限、超时、重试次数、结果保留天数。这些设置（包括 `userConcurrency` 和 `userQueueLimit`）都可以在「设置」页里改（运行限制、外观、站点）。
- 删除了 `defaultTheme` 设置：`GET /api/bootstrap` 里不再有 `site.defaultTheme`，`/api/admin/settings` 不再返回它，提交它会得到 `400 settings.unknown_key`，以前存下来的值不再使用。
- `GET /api/bootstrap` 不再返回 `authRequired` 和 `authed`；没登录时 `user` 为 `null`。

**服务商**

新增

- 去高瑞注册只要点一下。服务商表单（「添加一个服务商」页和模型管理里）的 API Key 一栏右侧有「没有 Key？去 gaorui.cc 注册申请」的链接，地址取自服务商的 `keyUrl`，取代原来单独的「获取 API Key」链接。首页新增「推荐服务商」一节，介绍高瑞（gaorui.cc），列出一个高瑞 Key 能用的图片、视频和对话模型，并链接到注册页；「三步开始」的第二步也提到了它。两处链接都听 `features.externalLinks`。
- 服务商和明确写出的模型清单。添加的服务商现在是一家服务商（高瑞、OpenAI 或 Google Gemini）加上你的 API Key。每家支持的模型写在 `server/src/providers/catalog/<服务商标识>.json` 里，分 `image`、`video`、`chat` 三段，写在哪一段就是哪种类型。高瑞排在第一位并带「推荐」标记。
- 自定义模型：在「模型管理」页，可以按上游的模型名给某个服务商添加清单以外的模型，类型（图片或对话）由你手动选择，显示名称可选。每个服务商最多 100 个。三家服务商都不能添加自定义视频模型。
- 「模型管理」页把服务商显示成卡片，选中的服务商的模型按类型分组；可以按类型、状态、来源、价格筛选，也可以按显示名称或模型 ID 搜索。筛选条件记在浏览器里。
- OpenAI 服务商走 OpenAI 官方接口：`/chat/completions`、`/images/generations`，接了参考图时走 `/images/edits`（multipart）。OpenAI 的图片模型因此可以带参考图了。
- 管理接口：`GET /api/admin/vendors`；管理自定义模型的 `POST`、`PUT`、`DELETE /api/admin/providers/:id/models[/:model]`。服务商对象带 `customBaseUrl` 和 `customModels`；ModelSpec 带 `custom`。
- 用高瑞清单里的模型做视频分析：`gemini-3.5-flash-c` 可以输入视频，会出现在视频分析节点里。高瑞服务商把视频放在 `image_url` 内容片段里发送，值是视频的公网地址，紧跟在文字片段后面（高瑞的中转会把 `video_url` 片段丢掉而不报错）。这是照高瑞主站的做法写的。
- 按 token 计价、输入和输出分开的价格，可以在「模型管理」页填写和修改（两个输入框），模型列表里显示成「输入 … / 输出 … · 每百万 token」。之前这种价格只能通过接口设置，列表里显示成 0.00。
- 启动时自动升级已保存的服务商，每个只升级一次：`openai-compatible` 变成 `openai`，标识（slug）不变，所以画布、价格和用量里的模型标识照常可用；填在旧字段里的模型，以及旧版本向上游读取列表时实际用过的模型，都转成自定义模型带过来。名称还是旧默认名「高瑞 API」（"Gaorui API"）的高瑞服务商改名为「高瑞」（"Gaorui"），其他名称不动。API Key、接口地址、是否启用、排序和模型覆盖项不动。见 [docs/providers.zh-CN.md](docs/providers.zh-CN.md#从上一个版本升级)。

变更

- 用「服务商 + 明确的模型清单」取代原来的「类型」和按名字猜测。不再根据模型的名字推断任何东西，也不再向上游读取模型列表。「测试连接」仍然调用上游的模型列表接口，但只用来证明地址和 Key 可用，不再报告模型数量。
- 每家服务商默认用它的官方接口地址（`https://gaorui.cc`、`https://api.openai.com/v1`、`https://generativelanguage.googleapis.com`）。别的地址可以在服务商对话框的「高级」里填写，对方必须使用完全相同的官方接口。服务商添加后不能更换。
- 添加任何一家服务商都必须填 API Key。
- 中文界面里统一叫「服务商」，这一家服务商叫「高瑞」/ "Gaorui"。
- 品牌的中文写法统一更正为「高瑞」，界面、服务端提示和文档都已改过；已保存的服务商如果默认名称里带着旧写法，升级时会一并改正。
- OpenAI 的对话模型不再接受视频：官方接口没有视频这种内容片段。视频分析可以用高瑞服务商下的 `gemini-3.5-flash-c` 和自定义对话模型；高瑞的自定义对话模型现在同样用 `image_url` 片段发送视频，不再用 `video_url`。
- 高瑞的清单里有五个对话模型：`deepseek-v4-pro`、`gpt-5.5`、`glm-5.3`（纯文本），`gpt-6-astra`（可读图片），`gemini-3.5-flash-c`（可读图片和视频）。对话模型不再从上游发现；清单里没有的可以作为自定义模型添加。
- 纯文本对话模型不会收到图片：对它调用 `POST /api/llm/tasks` 并带 `imageUrls` 会被拒绝（`model.no_image_input`）；大语言模型节点会把图片输入口变灰、不再接受新的图片连线，并写明已连接的图片不会发送。
- OpenAI 的清单在两个 GPT Image 2.5 模型之外列出了 `gpt-image-2`，以及从 GPT-6 到 GPT-4o Mini 的十五个对话模型；Gemini 的清单增加了 `gemini-3.1-flash-image`、`gemini-3.6-flash`、`gemini-3-flash-preview`。每份清单里是这家服务商通过 LoomCanvas 所调用的接口提供的全部现行模型；哪些没有列入、为什么，见[服务商](docs/providers.zh-CN.md)。
- 自定义模型的名字如果已在清单里，就以清单里的为准，模型标识不变（启用状态、排序、名称和价格都保留）；那条自定义记录在服务端启动时删除。
- 窄屏上「设置」页的分区目录在自己里面横向滚动，并让当前分区保持可见，不再把整个页面撑宽。
- 「设置」页改成一次只显示一个分区，不再是一页到底。左边的列表分成「个人」（账号与安全、外观）和只有超级管理员才有的「站点管理」（站点、用户管理、团队、存储、运行限制）。分区写在地址里（`/settings/<分区>`）；`/settings` 和旧的 `/settings#<分区>` 链接会落到对应的分区，没权限看的分区落到「账号与安全」。分区里有没保存的修改时，离开之前先问一句。「存储」选了 S3 才出现 S3 表单，分成四组；「用户管理」可以搜索、按状态筛选，还在用临时密码的账号带「待改密码」标记（状态筛选的第四项也是这四个字）。
- 内置的管理账号在界面、服务端提示、启动日志和文档里统一叫「超级管理员」（英文 Super admin），普通账号叫「用户」。接口里的取值仍然是 `owner`，`ADMIN_*` 环境变量的名字不变。

移除（**不兼容**）

- `openai-compatible` 这个类型，以及服务商表单里自由填写的模型字段（已保存的服务商会自动升级，见上）。
- `GET /api/admin/provider-types`，由 `GET /api/admin/vendors` 取代。`POST /api/admin/providers` 不再接受模型字段，服务商对象不再有 `options`，`POST /api/admin/providers/:id/test` 不再返回 `modelCount`。
- 插件接口里的 `fields` 和 `listModels`。服务商模块现在导出 `catalog`、`customKinds`、`customSpec`，见 [docs/writing-a-provider.zh-CN.md](docs/writing-a-provider.zh-CN.md)。
- 五分钟的模型列表缓存。

**存储**

新增

- 「设置」页新增「存储」分区（只有超级管理员看得到）：选择本地磁盘或 S3 兼容的桶，带 AWS S3、Cloudflare R2、阿里云 OSS、MinIO 的预设。保存后立即生效，不用重启。保存的配置优先于 `STORAGE_DRIVER` 和 `S3_*`。Secret Access Key 用 `SECRET_KEY` 加密保存，不再返回。
- S3 兼容驱动的选项：路径前缀（`S3_KEY_PREFIX`）、分发方式（`S3_DELIVERY`）、对象 ACL（`S3_ACL`）、明确指定的路径风格。
- 私有桶：`proxy` 分发时由应用自己从桶里流式转发文件（支持 Range、ETag、HEAD），桶不需要公共读，也不需要配 CORS。
- `redirect` 分发：`/files/<key>` 重定向到桶前面的公开域名或 CDN。
- 桶里的参考素材交给上游模型时，用有效期一小时的预签名地址（或公开地址），不需要 `PUBLIC_URL`。预签名地址不会被保存，出现在上游错误信息里时会被抹掉。
- 连接测试（`POST /api/admin/storage/test`）：写入、读回、删除一个测试对象，用大白话指出哪里不对。保存 S3 配置时会先做这个测试。
- 管理接口：`GET` / `PUT /api/admin/storage`、`POST /api/admin/storage/test`。
- 切换之后，原来的后端仍然可读（本地磁盘、已保存的桶、最多 5 个更早的桶、环境变量里的桶）。文件不会被移动，也没有迁移工具。
- 缩略图在所有后端上都能在第一次被请求时现做，并和原图存在同一处。
- 存储层的测试，以及对着真实 S3 接口的测试（`server/test/storage.live.test.js`，设了 `TEST_S3_ENDPOINT` 时运行）。目前只对着 MinIO 跑过。
- **地址在内网的桶，绝不会交给上游模型。** 一个地址算不算公网可达，`PUBLIC_URL`、公开访问地址、S3 的 Endpoint 都按同一条规则判断：不是 `localhost`，不是只有一段的主机名（`minio`），不是内网或保留 IP，不是私网后缀。这样的桶，参考素材经由 `PUBLIC_URL` 交给上游、内联发送，或者在发出任何请求之前被拒绝。`SSRF_ALLOW_HOSTS` 不影响这个判断。
- `S3_PRESIGN_ENDPOINT` / `presignEndpoint`（「设置 → 存储」表单里的「签名地址用的 Endpoint」）：内网里的 S3 服务在公网上的地址，交给上游模型的预签名地址按它生成。架在这个地址上的反向代理必须保留 `Host` 头（对着 MinIO 测过）。
- **只读不写、又连不上的桶不再碍事。** 本地磁盘上和当前使用的桶里的文件最先被找到；更早的桶同时去问，每个最多等 3 秒；没有回应的桶 30 秒内不再去连，每个周期只记一行日志。哪里都找不到的文件：每个存储都回答了就是 `404`，某个可能存着它的存储没问到就是 `503 storage.unreachable`（以前两种情况都是 `502`）。缩略图遵守同样的规则，失败不会被缓存。
- 删除账号或团队时最多等存储 4 秒；存储没能及时删掉的部分在后台继续删，连不上的每 10 分钟重试一次，最多 30 天。结果保留期清理不再把「存储连不上」的文件记成已清理。
- `DELETE /api/admin/storage/buckets/:id`：不再读取一个已经彻底没了的桶（「设置 → 存储」里那一行的「不再读取」）。存储状态里新增 `writable`、`upstream`（现在存下的文件怎么交给上游模型：`public_base`、`signed`、`app`、`inline`，什么都存不了时是 `unavailable`）和 `buckets`（会被读取的每个桶及其状态）。`GET /api/admin/storage?probe=1` 先把每个桶问一遍连不连得上，最多等 4 秒；设置页的「当前状态」卡片点「刷新」时这样做，有存储连不上时每 10 秒自动做一次。
- `GET /api/bootstrap` 在 `media.upstreamByUrl` 旁边新增 `media.writable`：新文件被拒绝期间为 `false`，图片和视频节点在运行前就写明（对应编辑器适配器 `capabilities()` 返回里的 `storageWritable`）。
- 存储表单里某一栏不合法时，`data.field` 指出是哪一栏，提示里用的是设置页上的叫法；页面把它显示在那一栏下面。
- **`SECRET_KEY` 变了之后**：服务端照常启动；保存的桶仍然是配置好的存储，只是用不了（它的文件返回 `503`；如果它正是当前使用的桶，新文件以 `503 storage.secret_unreadable` 被拒绝，不会改写到别处；存储状态里是 `secretUnreadable: true`、`writable: false`）；Key 解不开的服务商标记为 `keyUnreadable`，运行被拒绝并说明原因。「设置 → 存储」和「模型管理」页的服务商卡片会要求重新填写密钥或 Key。
- 不管 `STORAGE_DRIVER` 是什么，`S3_*` 变量描述的桶都会被读取；同一个桶既写在环境变量里又在设置页保存过时，算一个桶。

变更

- 每个存下来的文件在所有后端上都只有一个地址：站内相对地址 `/files/<key>`，由应用应答。S3 驱动以前存的是 `<S3_PUBLIC_BASE_URL>/<key>`；已有画布里的这种地址，只要那个公开访问地址还配置着，仍然能被认出来。
- `S3_PUBLIC_BASE_URL` 变为可选，以前是必填。
- `S3_REGION` 的默认值是 `us-east-1`，以前是 `auto`；用 Cloudflare R2 时请明确设 `S3_REGION=auto`。
- AWS SDK（`@aws-sdk/client-s3`、`@aws-sdk/lib-storage`、`@aws-sdk/s3-request-presigner`）成为 `server/` 的常规依赖，不再是可选依赖。
- 页面的 Content-Security-Policy 会列出每个已配置的公开访问地址的来源。

移除（**不兼容**）

- `oss` 存储驱动、`ali-oss` 这个包和所有 `OSS_*` 变量。`STORAGE_DRIVER=oss` 现在会让服务端在启动时退出，并提示应该改设什么。迁移办法：改用 `STORAGE_DRIVER=s3`，设 `S3_ENDPOINT=https://oss-<地域>.aliyuncs.com`、`S3_REGION=oss-<地域>`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`（原来的 `OSS_ACCESS_KEY_SECRET`），不要打开路径风格；或者在「设置 → 存储」里配置。见 [docs/storage.zh-CN.md](docs/storage.zh-CN.md#从-storage_driveross-迁移)。
- Docker 镜像的构建参数 `EXTRA_NPM_PACKAGES`。

**集成**

- LoomCanvas 可以集成进别的产品。两个入口，在 `web/` 里执行 `npm run build:lib` 构建到 `web/dist-lib`（ES 模块、每个入口一份样式表、类型声明；Vue 是对等依赖，另有把 Vue 打在里面的 `standalone/` 版本）。不发布到 npm。文档：[docs/integration.zh-CN.md](docs/integration.zh-CN.md)；可以直接运行的宿主页面在 [`examples/`](examples/README.zh-CN.md)。
- `loomcanvas-web/app`，`mountLoomCanvas(el, options)`：把整个应用挂进宿主页面的一个元素里。宿主可以用自己的认证（`getAuth`、`onAuthRequired`、`user`），不要 LoomCanvas 的顶栏和侧栏（`shell: 'none'`），只开放一部分页面（`pages`），关掉功能（`features`），选择导航怎么反映到地址栏（`routerMode`：memory、hash、history），控制主题和语言，覆盖文案和品牌（`brand: { name, logoUrl, showName }`，`showName: false` 只显示 Logo），给存储键加前缀。句柄：`navigate`、`setTheme`、`setLocale`、`on`、`unmount`。事件：`ready`、`route`、`canvas:saved`、`run:started`、`run:finished`、`run:failed`、`result`、`error`。
- `loomcanvas-web/editor`，`mountEditor(el, options)`、Vue 组件 `<LoomCanvasEditor>` 和自定义元素 `<loom-canvas-editor>`：只有画布编辑器，没有列表、外壳和账号。它只通过宿主提供的适配器（`EditorAdapter`）接触后端；`createHttpAdapter` 是对着原装服务端的实现，`createMemoryAdapter` 不需要服务端。画布可以按 id 经适配器加载，也可以直接传入文档；支持 `readOnly`、节点布局、功能开关、节点类型。句柄：`getDocument`、`setDocument`、`setCanvasId`、`save`、`fitView`、`runAll`、`runNode`、`addNode`、`undo`、`redo` 和几个设置方法。事件除上面那些外还有 `change`、`saved`、`selection`。
- 画布文档格式是对外的约定：有类型（`CanvasDocument`），有版本（`schemaVersion` 3，和服务端用的是同一个数），加载时由 `migrateDocument` 升级；这个函数对外导出，没有任何依赖。
- 嵌入时 LoomCanvas 不越出自己的挂载根：每条样式规则都限制在它之内，设计令牌和主题属性写在它上面，弹层挂在它里面的一层上并相对它定位，响应式布局跟着它的尺寸走，键盘快捷键只处理属于它的按键。不往 `<html>`、`<body>`、`<head>` 和 `document.title` 写任何东西。同文档嵌入做不到的地方在文档里逐条列出。
- 独立应用由同样的入口构建，行为和以前一样。内部的变化：编辑器对后端的调用都经过适配器（`web/src/utils/canvasBackend.ts`），路由和应用启动改成了工厂，样式的作用域是 `.lc-root`（`<html>` 上带这个类），三款自托管字体拆到了单独的样式表里。
- 两个入口都支持团队，全部是新增项：宿主什么都不传、适配器什么都不实现，行为和以前一样。
  - `mountLoomCanvas`：选项 `space`（`'personal'` 或团队 id）把应用固定在一个空间，用户不能切换（在团队里，顶栏只用文字写出团队名和角色）；功能开关 `spaceSwitch`（顶栏的空间切换器）和 `teamAdmin`（「团队」页及其入口；关掉后切换器只用来换空间：没有「创建团队」，没有「用邀请码加入」，不写成员数）；用户进入一个空间时的事件 `space`（`{ id, kind, name, role }`）；页面名 `team` 和 `join`。团队空间的站内路径以 `/t-<团队 id>` 开头。
  - `createHttpAdapter({ space })` 让这个适配器的每个请求都带上 `X-Space`，并对着原装服务端实现了编辑锁和带版本检查的保存。
  - `EditorAdapter` 新增可选成员：`acquireLock`、`releaseLock` 和 `peekLock`（编辑锁：拿锁或续期、归还——页面本身要没了时是 `releaseLock(id, { unloading: true })`——以及只看不拿；不实现 `acquireLock` 就不加锁）、`createCanvas`（「复制一份」和「把我的版本另存为副本」需要它）、`saveCanvas` 的 `options` 参数（`{ baseRevision, force }`；忽略它的适配器仍然是「后写覆盖」）、`loadCanvas` 返回里可选的 `revision`、`access`、`lock` 字段，以及可选分组里的 `templates.createCanvasTemplate` / `removeCanvasTemplate` / `createTextTemplate` / `removeTextTemplate` 和 `assets.update`。锁属于一个编辑器（一个适配器实例），不属于账号：`lock.sameUser` 告诉编辑器持有人是同一个人的另一个标签页。改名是一次元信息保存：`saveCanvas(id, { name })`，不随内容保存发送。
  - 编辑器新增事件 `created`（`{ canvasId, fromCanvasId }`）：它把文档存成了一张新画布。
  - 示例里都有演示：`host-page` 在宿主自己的导航里加了空间选择，`vue-editor` 每个空间建一个适配器。
- 关掉的功能不留任何入口。本身就是这项功能的页面跟着开关走，不存在：侧栏里没有这一项，没有链接，用 `navigate()` 或地址都到不了（`assetLibrary` → `assets`，`brandKit` → `brand-kits`，`modelManagement` → `models` 和 `setup`，`teamAdmin` → `team`）；「设置」页对进去之后什么都看不到的人也不存在。`cost: false` 同时去掉生成记录（那一列、那一块、导出里的几列）、工作台、「模型管理」页和团队「用量」「成员」「上限」里的金额；`templates: false` 去掉工作台上的「从模板开始」；`batchDownload: false` 去掉画布卡片上的打包下载；`share: false` 去掉团队设置里关于分享链接的那一项；`externalLinks: false` 去掉服务商的「获取 API Key」链接；`themeSwitch` / `localeSwitch` 对登录页、引导页和分享页同样生效；内置教程不再讲已经关掉的功能。只嵌编辑器时，指向页面的链接（它没有页面）不渲染，不会再把所在的浮层弄坏。
- `examples/react-host`：一个 React 宿主（Vite、React 19、TypeScript），把 `mountEditor` 包成组件来用，也在 JSX 里用自定义元素；既有内存适配器，也有对着另一个源的 HTTP 适配器；生产构建带着严格的 Content-Security-Policy 提供，集成文档的 React 一节就取自它。`npm run versions:check` 会检查它的版本号、许可和 Node 版本下限；Docker 构建的上下文不带 `examples/`。
- 只嵌编辑器时修掉的问题：带着未保存的改动卸载编辑器，最后那次保存发到了页面自己的 `/api` 而不是宿主的适配器（现在适配器会留给这次保存用，空闲的保存队列也立刻开始）；最后一个视图卸载之后才到的轻提示被加到了宿主的 `<body>` 上（现在直接不出）；上限提示里「去填价格」「去改上限」的链接在新标签页里打开了一个宿主并不提供的地址（memory 模式下改为原地跳转，那一页不存在时不出这个链接）；「我的分享」里的「打开」也是同样的问题。
- 在 `web/` 里执行 `node scripts/build-lib.mjs --out=<目录>` 可以把库构建到另一个目录；`LC_LIB=<目录> node examples/serve.mjs` 提供那一份。
- 集成本身不需要改服务端。`CORS_ORIGIN` 本来就支持前端在另一个源上，`/files` 本来就允许跨源读取。
- `web/` 里新增测试（Vitest，`npm test`）：对外接口的快照守卫、选项与路由守卫的处理、对两个适配器都跑一遍的适配器约定（HTTP 适配器在设了 `TEST_MONGODB_URI` 时对着真实服务端跑）、与服务端逐项对照的文档迁移、样式作用域插件。

**打包与项目**

- Dockerfile（非 root 运行，带健康检查）和包含 MongoDB 7 的 Docker Compose 文件。
- 测试覆盖执行器、服务商模块（对着假上游）、计价、加密、SSRF 防护、存储 key 与存储层、图片工具、画布迁移、语言文件，以及端到端的接口测试和安全测试。
- 仓库级检查：版本号、依赖协议、界面文案；CI 工作流。
- AGPL-3.0 协议与单独的商业授权、贡献者协议、商标政策、第三方声明。
- `docs/` 下的中英文文档。

**高瑞的模型**

- 新增 `veo-3.1`（Veo 3.1：文生视频、最多 3 张参考图、或首尾帧；固定 8 秒）。
- 移除 `sora-2-openai-12s`：该服务没有它的渠道（HTTP 503 `model_not_found`），模型列表里也没有它。画布上还写着它的节点会显示模型不可用，并提示重新选择。
- `omni-flash` 不再提供 6 秒：该服务列着 `omni_flash_6s`，但对它返回 HTTP 503 `model_not_found`。默认改为 8 秒；存着 6 秒的节点会回落到 8 秒。
- 修正：高瑞图片模型的参考图现在只按公网地址发送。该服务不接受内联的 base64（`image_must_be_url`），所以没有公网地址的图片会在请求发出之前被拒绝，提示还是那句「…需要公网可访问的地址…」。
- 修正：上游的错误如果是包在另一个错误体里的 JSON 字符串，现在显示其中的文字，而不是整段 JSON；`model_not_found` 不管 HTTP 状态码是什么都不再重试（该服务是用 503 返回的）。
- 新增 `grok-imagine-1.0-video`（Grok Video 1.0：文生视频、或最多 3 张参考图；6、10、15 秒；480p）。
- `omni-flash` 不再提供 4k（只有 720p 和 1080p，和高瑞主站一致）；`omni-flash-edit` 没有分辨率可选，视频编辑一律是 720p。存着 4k 的节点会回落到 720p。
- `grok-imagine-video-1.5-preview` 不再提供 4 秒：请求 4 秒，该服务返回的是 6 秒的视频。最短是 6 秒；存着 4 秒的节点会回落到 6 秒。
- 参考图只能给公网地址的模型（高瑞的图片模型、Veo 3.1、Grok Video）现在有标记，画布在运行之前就会说明：实例没有公网地址时，节点用的是这类模型又连着图片，节点上会写明原因和做法，点运行也停在这里。视频编辑的原视频同样处理。高瑞没有只凭 Key 就能上传本地文件的接口。

**团队**

- 在每个账号的个人空间之外多了第二种空间：**团队**，多个账号共用。团队的画布、分享链接、资产、品牌包、自存模板和片段、服务商和 API Key、价格、运行记录都属于团队。三个角色：团长（每个团队一个）、管理员、成员。全部在 AGPL 开源代码里。
- 请求作用于哪个空间只看一个请求头：`X-Space: <团队 id>`（或 `personal`）；不带它就是调用者的个人空间，所以现有的客户端、单独嵌入编辑器时的适配器，行为和以前完全一样。团队管理接口按路径寻址：`/api/teams/:id/...`。成员身份每个请求现查：被移除的人下一个请求就被拒绝。
- 不做任何数据迁移。按空间的集合继续用 `userId` 存空间的 id（个人空间是账号 id，团队是团队 id），另加 `createdBy`；每个账号现有的数据就是它的个人空间，已存的文档一条都不改。退回有团队之前的版本时，团队的数据不可见，也不会被错给任何人。理由写在 `docs/architecture.md` 第 12 节。
- **创建团队要超级管理员授权**：按账号授予（用户管理里的 `canCreateTeams`），并有申请流程（账号提交申请，超级管理员批准或带原因拒绝）。两个站点设置给出上限：`teamMaxPerUser`（默认 3）和 `teamMaxMembers`（默认 50）。
- **邀请链接**是加入团队的途径：默认 7 天有效、可用 10 次，可撤销，加入后都是成员。站点关闭注册时，邀请链接不能用来注册账号。
- **团队的 Key**：团长和管理员配置一次服务商、Key、自定义模型和价格；成员直接使用，看不到 Key、Key 的末几位和接口地址。团队空间里只有团队的服务商：成员个人的 Key 不会用在团队里，团队的 Key 也不会用在别处。
- **团队画布**有三档可见范围：仅自己（团长可见）、团队可看、团队可改；新画布默认「团队可看」，创建者可以逐张改，团长可以改团队的默认值。画布和资产可以在个人空间和团队之间复制，文件一起复制。
- **同一时间一个人编辑，不做实时协作**：团队画布有编辑锁，按编辑会话（一个标签页）而不是按账号：同一个人开的第二个标签页和别人一样是只读，一样可以接管。有效期 36 秒，每 12 秒续期，页面关闭时立即归还（用 `sendBeacon` 调公开的 `POST /api/workflow/:id/lock/release`，凭这把锁的释放令牌）。每次保存检查版本，基于旧版本的保存返回 `409 canvas.conflict` 而不是覆盖。个人空间里客户端带上 `baseRevision` 也能用这个检查。丢了锁的会话会被告知原因（`data.lost`：被接管，或标签页在后台时过期）；回到前台时画布没人动过，就直接接着改（`state: "reacquired"`）。页面关闭时还在路上的那次保存照样写入，但不会把锁再拿回来。两个只读接口让等的人不靠推送也能知道：`GET /api/workflow/:id/lock`（只读的编辑器每 5 秒问一次：空出来没有、改名没有、保存没有）和 `GET /api/workflow/locks`（画布列表每 10 秒问一次：谁在编辑哪张）。
- **改名不是编辑**：画布的名字、视口和旧布局标记是元信息。保存它们（只带这些字段的 `PUT`，或 `PATCH /api/workflow/:id/meta`）只要求能编辑这张画布，不要锁、不要 `baseRevision`，也不改变 `revision`；所以别人正在编辑时可以改名，那位编辑者的下一次保存不会冲突。打开着的编辑器通过每次锁接口和保存返回里的 `metaRevision` 跟上新名字。
- **每月上限**：按成员和按团队，次数和预估金额各一个，按团队的时区切月。到上限时拒绝新的运行，已经在跑的跑完。设了金额上限后，价格算不了的模型默认禁止运行，团长可以关掉这个限制。「已用」处处只有一个定义：已成功 + 进行中，失败和取消的不计；上限接口、成员列表和用量接口（`?limits=1`）给出的是同一批数字，带明细和现成的状态（`effective`）。上限对任意多的同时提交、任意多的服务进程都是精确的：接受一条运行是对「团队 + 月份」计数文档的一次原子更新，计数文档是运行记录的缓存，缺失或对不上时从记录重算。按 token 计价的对话运行在进行中占一笔预留，跑完按真实成本结算；失败或取消的对话运行把预留退回，上游没报用量的成为成本未知的运行。六种 `budget.*` 拒绝都带结构化的 `data`（谁的上限、具体数字、这次要占多少及它是什么（`requestedKind`）、何时重新计数、谁能改），而且拒绝不会建立在一个和运行记录对不上的计数上：拒绝之前先核对。上限接口告诉每个成员该找谁（`managers`）、哪些模型因为价格算不了而跑不了（`cannotRun`），客户端不用自己从价格去推。停用账号会取消它排队中的运行，和移除成员一样，它在团队画布上持有的编辑锁也立即释放；这样被取消的运行，以及团队被关闭时取消的运行，不管从哪里读都写明原因（`run.canceled_account_disabled`、`run.canceled_member_removed`、`run.canceled_team_closed`）。
- **用量**：团长看全队的记录和用量、可以按成员筛选；其他人只看自己的；团队设置里有一个开关（默认关）可以让管理员也看全队。
- **排队**：仍然按人公平（一个账号不管在哪个空间跑，在队列里都是同一个人），另加每个团队同时在跑的运行上限（`teamConcurrency`，默认 4，或某个团队单独的值）。
- **退出和移除**：成员做的东西留在团队；他的「仅自己」画布转给团长；他排队中的运行被取消、已在跑的跑完；他的编辑锁和他创建的邀请链接作废。
- **解散**团队后立刻关闭，7 天内可恢复，之后连同数据和文件永久删除。可以转让团长；超级管理员可以停用团队、删除已关闭的团队、在团长账号不可用时指定新团长。账号还是某个团队的团长时不能被删除，要先转让或删除团队。
- 每个团队有**团队动态**：成员、邀请链接、服务商和 Key、价格、上限、画布的删除 / 恢复 / 接管 / 覆盖、分享链接、设置、解散。团长和管理员可看，任何人不能改，保留 `teamActivityDays` 天（默认 365），不含 Key、地址和提示词。
- 超级管理员管的是团队的存在和规模，只看得到名称和数字：没有任何接口让超级管理员拿到团队的画布、Key 或文件。
- 任何空间里删除的画布 30 天内可以恢复（`GET /api/workflow/trash`、`POST /api/workflow/:id/restore`）。任何空间里都可以通过接口保存和删除模板、提示词片段。
- 计费钩子的 `ctx` 新增 `spaceId` 和 `teamId`；`ctx.userId` 仍然是发起运行的账号。
- **人不在了，名字还在。** 接口里提到的每个人都是同一个结构，带 `state`：`active`、`left`（已离开团队：账号还在，但已不在团队）、`deleted`（账号已删除），在画布、资产、生成记录、模板、分享链接、服务商和团队动态里完全一致。成员退出、被移除或账号被删除时，他在团队里用的名字会保留下来，他留下的东西仍然说得清是谁做的。
- **团队动态写明改了什么**：角色的前后、上限的前后（团队上限的具体数字以前会从动态里丢掉）、新旧名称、改了哪些设置及其新旧值、价格的前后、邀请链接的次数和期限、某人是用谁的链接加入的。新增动态类型 `member:renamed`、`team:avatar_changed`。动态里的人按他今天在团队里的显示名显示。
- 团队各个页面多拿到的信息：邀请链接还能用几次（公开的预览里也有，而且对使用情况只说这一项）；服务商的维护人（`maintainer`）和最近一次测试连接的结果（`lastTest`，只给能管理服务商的人）；团队详情里的团队并发上限；超级管理员团队列表里的团队头像；模板和提示词片段是谁保存的；永久删除团队时返回一个完整的 `counts`，列出删掉的每一类各有多少。
- **资产分组可以是空的**：`POST /api/user-asset/folder` 新建，`DELETE /api/user-asset/folder?name=` 删除空分组（不空返回 `409 asset.folder_not_empty`），列表多了带数量的 `folderList`。把最后一条资产移走后，分组不再自己消失。
- `GET /api/spaces/copy-targets` 列出一张画布或一条资产能复制到哪些空间，不能的附上原因。
- **生成记录**：一条记录带上对话运行的文字结果、token 用量、图片和视频运行的文件、排队和运行耗时、错误代码；`GET /api/admin/usage/records/:recordId` 返回完整的一条；`POST /api/runs/download-zip` 把最多 100 条记录的结果打成一个 zip。
- 生成记录的 zip 一次只读一个文件，而且不会悄悄少东西：打不开的文件换成一份 `…-failed.txt` 说明；读到一半断了的文件（或者大小、时间的额度在一个文件中间用完）直接中断下载，而不是交出一个不完整的压缩包；客户端走了，服务端立刻停手——以前，下载到一半（正在读存储里的文件）被放弃时，那个文件一直开着、请求一直挂着，读坏的文件会让响应卡死。包里的文件名都只是一段文件名且不重复；`urls` 最多 2000 个；同一个账号同时最多打 3 个包（`429 run.zip_busy`）。`GET /api/admin/usage/records?full=1` 让这一页的每条记录都是完整的，导出用。
- 权限矩阵在代码里只有一张表（`server/src/services/permissions.js`）；接口文档里的表由它生成，测试逐格走真实 HTTP 入口验证。

**网页端的团队功能**

- 顶栏 Logo 右边的**空间切换器**：个人空间、你加入的团队和你的角色、「创建团队」（没有授权的账号是「申请创建团队」：一条申请，可以附一句说明、可以撤回，没通过时显示原因）、「用邀请码加入」。团队空间的页面地址是 `/t-<团队 id>/…`，个人空间的地址不变。
- 团队空间里的侧栏是「团队首页」「画布」「素材库」「模型管理」「生成记录」「团队」「设置」。**团队首页**显示本月运行、本月预估金额、排队和运行中的任务，以及完整的每月上限（进度条、还剩多少、「已用 = 已成功 + 进行中」、失败和取消的单独列出并写明不计入、成本未知的次数、按团队时区写的重新计数时刻）、新团队的三步引导、最近的画布和团队服务商。
- **「团队」页**：「成员」（搜索、按角色筛选、设为或取消管理员、成员单独的上限、显示名、移除、退出；邀请链接有效 1 / 7 / 30 天、可用 1 / 10 / 不限次，可复制、可撤销）、「用量」（最上面是本月的上限，下面是所选月份按成员、按模型或按天的用量，计入和不计入的运行分成两组列，团长可以导出 CSV；其他人只看自己的）、「动态」和「团队设置」（基本信息、默认权限、额度，以及要输入准确团队名称确认的转让和解散）。
- **团队里的画布**：卡片上和编辑器标题块里显示可见范围（仅自己、团队可看、团队可改），可以按可见范围和创建人筛选，卡片上显示「某某 正在编辑」，有「复制一份」、复制到另一个空间、「团队权限」。「分享」弹窗分成「团队内」和「对外链接」两个页签。
- **被每月上限拒绝的运行，在发起它的地方把话说清楚**（输入条、属性面板、节点、批量运行弹窗、生成队列清单），并且一直留着：是哪一项上限、具体数字、按团队时区什么时候重新开始计数、该找谁（写出名字；自己能改的人给的是去改的入口）。某项上限已经用完时，运行之前就显示同样的说明；因为没有价格而不能运行的模型在模型下拉里有标记。拒绝的说明不存进团队的画布。
- **在编辑器里轮流编辑**：先打开一张可编辑团队画布的人编辑，其他人看到只读提示条，带「复制一份」和「接管编辑」，对方离开后出现「开始编辑」。基于旧版本的保存会弹出「这张画布已被别人修改」：把我的版本另存为副本、载入最新版本，或者（创建者、管理员、团长）用我的版本覆盖。提示条把几种情况分开说：别人正在编辑、**你在另一个标签页打开了这张画布**（点「在这里编辑」把编辑挪过来）、被人接管了、这个标签页在后台停得太久而别人已经开始编辑。持有人关掉标签页，画布立刻空出来，等着的编辑器大约 5 秒内给出「开始编辑」，不用刷新；标签页被切到后台的那一刻先把没保存的存掉，回到前台的那一刻立刻续锁。只读时工具栏是只读的一套（素材库只能浏览和下载，分享弹窗里看团队权限、复制已有的对外链接，还有搜索、批量下载），节点可以好好地看：点开图片或视频看大图、播放视频、滚动、选中和复制文字与提示词、切换查看历史版本、下载结果，在只读的输入条或属性面板里看节点的提示词、模型和参数，但上面没有任何会改动画布的东西（这个状态是活的：编辑器丢了锁或拿到锁的那一刻，节点就跟着变）；「接管编辑」的确认里写的是实际会发生的事：你马上就能编辑，对方的页面要到下一次自动续期或保存时才变成只读（约 12 秒内）；持有人保存的内容几秒内就能看到。**有编辑权的人随时可以改名**：列表、工作台、编辑器标题都行，别人正在编辑时也行；对方的标题跟着变，不产生冲突。画布列表和工作台在可见时每 10 秒就地刷新一次「谁正在编辑」和画布名（别人改了名，不用刷新、也不用切走再切回来就能看到）。
- **干活的地方就能看到上限**：「运行全部」旁边的计数、生成队列清单里的「我的本月上限」，运行被拒绝时节点上显示服务端带数字的提示。没有价格的运行显示为「成本未知」并单独计数，不会算成 0 元。
- **团队里的模型管理、生成记录、素材、品牌包、模板**：成员看到的「模型管理」是只读的，没有 Key、Key 的末几位和接口地址；团长的「生成记录」多了成员筛选和成员列，不能清理本月的记录；「我的资产」变成「团队资产」；品牌包人人可选、团长和管理员维护；谁都可以把当前画布存为模板、把提示词存为片段（个人空间里也可以）。
- 「画布」页有了**回收站**，个人空间也有：删除的画布 30 天内可以恢复（团队里由团长和管理员恢复）。
- **加入页** `/join/<邀请码>` 在登录之前就显示团队、邀请人和成员数，邀请用不了时各有各的原因。站点关闭注册时如实说明，不提供注册入口。
- 正在使用团队时被移出，或者团队被解散、被停用：下一个操作把人送回个人空间，并说明是这三种情况里的哪一种。
- **超级管理员**：「设置」里新增「团队」分区（三项站点设置、创建团队的申请，以及只有数字的团队列表，可以调整上限、停用 / 恢复使用、恢复、指定新团长、永久删除）；「运行限制」里新增「团队并发上限的默认值」；「用户管理」里新增「团队」一列和「允许创建团队」/「收回创建团队的授权」。
- 凡是提到人的地方——画布卡片、回收站、素材、邀请链接、用量、动态、服务商卡片、分享链接、存下来的模板和片段——已经离开团队的人名字照旧，后面跟「已离开团队」，账号被删除的跟「账号已删除」（共用一个 `PersonName` 组件和 `utils/person.ts`，读 `Person.state`）；只有名字没留下来时才写「前成员」/「已删除的账号」。
- **动态**改为在前端按每一条的 `type`、`actor`、`target`、`detail` 写成话，中英文都有：角色、显示名、上限、价格、可见范围、团队名称和设置写出「改之前 → 改之后」；邀请链接写可用次数和到期日；人名是此刻的名字；超级管理员从外面做的事记在「超级管理员」名下。前端不认识的类型用服务端给的那句话。
- **模型管理**：服务商卡片上有维护人和最后改动的时间；团长和管理员（以及个人空间）看得到服务端记着的最近一次连接测试——连接正常 / 上次测试失败（带原因）/ 未测试，测完立刻更新。成员只看到「可用」或「不可用」。
- **素材库**：分组成为独立的东西。「分组」弹窗里可以新建分组（可以是空的）、看每个分组有几个素材、删除空分组；删一个里面还有素材的分组时显示服务端的拒绝原因，并给出「查看这些素材」，团长和管理员还可以「解散分组，素材保留」。筛到一个空分组时会明说它是空的。界面上原来叫「文件夹」的地方统一叫「分组」。
- **「复制到…」**改为向服务端问能去哪儿（`GET /api/spaces/copy-targets`），列出调用者所在的每一个空间；去不了的灰着并写明原因（团长关闭了复制到个人空间、团队被停用、团队已解散、这一类素材已放满、就是当前空间）。
- 加入页显示邀请链接还可以用几次；团队首页在进行中的旁边显示团队并发上限；存下来的模板和片段显示是谁存的，片段的标题不再被标签挤得过早截断；超级管理员的团队列表显示团队头像，永久删除团队之后按十四项列出各删掉了多少。
- 键盘：团队页、空间切换器、画布列表、素材库、资源库、品牌包和画布里那些弹窗，Tab 都在弹窗里循环，Esc 关最上面一层，关掉后焦点回到打开它的地方，走的是同一套机制（`composables/useDialogFocus.ts`、`directives/dialog.ts` 里的 `v-dialog` 指令、`TeamDialog` 这个壳）。画布卡片和分组行的「更多」菜单用的是共用的 `ActionMenu`（方向键、Home / End、按首字母跳转、Esc）。`LcSelect` 多了 `searchable`（团队时区和别的长列表在用），收起后焦点回到按钮。`ConfirmPop` 多了 `tone`：不破坏任何东西的确认（把编辑接到当前标签页、复制一份画布）不再画成红色。
- **生成记录重做了一遍**（个人空间也一样）。运行详情什么都有：对话是回复全文和提示词全文（可复制）、系统提示词、输入 / 输出 Token、成本、排队和用时；图片、视频是结果文件、随提示词发出去的内容和参数；失败、取消的写着原因和稳定的错误码；结果文件已按保留期清理的会说明。缩略图直接用记录里的文件，页面只在有没跑完的行时才去跟进度。**多条结果打成一个 ZIP**：勾选记录（翻页保留，最多 100 条、100 个文件），一次请求，打包时有进度，被拒绝时照服务端的原话说；一条记录有几个文件时它自己的下载也是一个 ZIP。**数字和上限是同一个口径**：四个汇总是「记录 / 已成功（附计入每月上限的次数）/ 未成功（失败 · 取消）/ 预估花费（已成功且有价格的，加上进行中占着的）」；失败、取消的行写「不计费」，不再显示提交时估的那个数，没价格却成功的写「成本未知」，还在跑的带「≈」。**CSV**：当前筛选下的全部记录，带提示词、系统提示词和回复的全文、Token、排队和用时秒数、成本和成本说明、错误码和原因、本地时间（时区写在表头）——带 BOM、CRLF、该加引号的加引号、公式开头的文字垫单引号、超出一个格子容量的截断。已离开团队 / 账号已删除的人在表格、成员筛选、详情和 CSV 里都留着名字和标记。1440 宽的窗口里筛选条排成一行，表格在「成员」旁边留着「用时」；再窄排成两行一条，手机上是卡片；往下翻着勾选时选中条一直停在顶上。「复制提示词」复制的是全文，不是列表里那 200 个字符。
- **模型管理**：能力标签只占一行，放不下的收进「+N」（键盘可达，手机上是够大的按钮）；721–900 宽的窗口里模型行改成上下两段，不再把「能力」一列挤成一个字；英文界面的价格按英文的说法写（「CN¥0.20 per image」「$0.15 per 1M input tokens · $0.60 per 1M output tokens」），数量分单复数；价格、名称、服务商这几个弹窗在浅色主题下不再强制深色配色。这一页的每个弹窗（服务商、两处删除确认、自定义模型、名称与排序、价格）都挂到页面末尾、手机上贴底，用同一套焦点机制；选服务商的卡片是一组单选（方向键、Home / End）。
- **设置**：各分区的弹窗（用户管理、登录会话、存储、团队那几张卡片里的调整上限 / 停用 / 指定新团长 / 删除结果 / 批准 / 拒绝、没保存就离开）都用同一套焦点机制。删除账号的弹窗把后果说准了：个人空间里的东西删掉，退出所在的团队，它在团队里做的东西留给团队。用户列表到平板宽度都还是一张表，次要的列一档一档收起（先是角色并到名字后面、注册日期不显示，再是头像和「画布」「运行」两列），手机上一个账号一张卡片；英文界面写的是 **Reset password** 和 **Temp password**。
- 有三处改动对所有人生效，用不用团队都一样。在已存有 Key 的服务商上改「接口地址」，要重新填写 API Key。在「设置 → 存储」里改了服务地址或 Access Key ID，要重新填写 Secret。同一张个人画布开在两个浏览器标签页里，现在会弹出冲突提示，后保存的不再不声不响地盖掉先保存的。

**安全**

- **已保存的服务商 Key 只会发往保存时的那个地址。** 此前 `PUT /api/admin/providers/:id` 可以修改服务商地址而保留已存的 Key，能编辑服务商的人因此可以把这个 Key 发到自己指定的服务器上。现在修改实际使用的地址必须在同一个请求里重新带上 Key，或者放弃已存的 Key（`clearKey`），否则返回 `400 provider.key_required_for_url`。个人空间和团队都一样。如果你的客户端以前只改地址、不重发 Key，现在需要一并发送 Key。
- 存储设置同理：已保存的 S3 Secret Access Key 只在服务地址和 Access Key ID 与保存时相同的情况下才沿用；改了其中任何一个的请求必须带上密钥（`400 storage.secret_required`），保存和测试连接都一样。
- 服务商的「测试连接」测的是保存着的那一份，不读请求里的任何内容（原来就是这样，现在写明并加了测试）。

**已知的局限**

- 内置的高瑞模型已经对着真实服务运行过；OpenAI 和 Google Gemini 按官方文档接入，项目还没有实际运行过。带参考图时走的 OpenAI `/images/edits`，以及 OpenAI、Gemini 两份模型清单里的模型名，也在其内。
- 用高瑞的图片模型做图生图，参考图需要有公网地址（设置 `PUBLIC_URL`，或者把文件存到公网上能访问到的桶里）。
- S3 存储驱动是对着 MinIO 验证的，没有对着 AWS S3、Cloudflare R2、阿里云 OSS 跑过；它们的配法依据的是各家的 S3 兼容文档。
- 切换存储不会移动已有的文件，也没有迁移工具。
- 账号之间、团队之间由接口隔离，共用一个进程、一个数据库和一个存储空间：没有按账号的存储配额，没有邮箱验证和两步验证。这不是加固过的多租户边界。团队没有实时协作（同一张画布同一时间一个人编辑），没有评论，不发邮件（邀请就是一条要你自己转交的链接），也不能按成员限制可用模型。团队里的金额是按团队填的价格算出的预估，不是账单。
- 运行队列在单个服务进程里，所以多个服务进程连同一个数据库仍然不是受支持的部署方式。（团队的每月上限已不依赖这一点：跨进程也成立。）
- 没有内容审核，没有私有的文件地址。

**从没有账号的代码升级**

- `ACCESS_PASSWORD` 已经取消。仍然设置着的话，服务端启动时提示一次并忽略它，请删掉。现在必须登录才能使用，用共用口令换来的凭证不再有效。
- 不需要手工迁移。新版本第一次启动时创建超级管理员，并把已有的全部数据交给它（画布、分享链接、素材、品牌包、服务商及其 Key、价格、用量）；日志里有一行 `[auth] the data from before accounts now belongs to "admin": {...}`。请在这次启动之前设好 `ADMIN_PASSWORD`，或者从启动日志里读出生成的密码，然后用超级管理员账号登录。注册出来的账号是空的。`SECRET_KEY` 必须保持不变，已保存的 Key 才能解密。
- 画布里保存的文件地址照常可用。新文件存放在 `uploads|outputs|tools/<账号 id>/…` 下。
- 接口：`POST /api/auth/login` 的请求体是 `{ account, password, remember? }`；未登录返回 `401 auth.required`（原来是 `auth.login_required`）；`GET /api/bootstrap`（`/api/app/bootstrap` 仍可用）多了 `auth` 和 `user`，去掉了 `authRequired`、`authed` 和 `site.defaultTheme`；`/api/admin/settings` 和 `/api/admin/storage` 只有超级管理员能调用，其余 `/api/admin/*` 接口操作的是调用者自己的服务商、模型和用量。模型标识和服务商标识前缀按账号区分。
- 计费钩子：`ctx.userId` 现在是账号 id（原来是常量 `local`）；新增 `ctx.username`。
- 全站的「默认主题」设置没有了：主题（深色 / 浅色 / 跟随系统）是每个账号自己的偏好，默认深色。服务商、模型和价格从「设置」搬到了「模型管理」页，用量搬到了「生成记录」页；旧的 `/settings?tab=…` 链接会被转过去。
- 改版前保存的画布，如果节点按新的节点尺寸互相重叠，第一次打开时会自动整理一次（按 Ctrl+Z 撤销）。
- 生成节点（图片生成、图片编辑、视频生成、视频编辑、大语言模型、视频分析）有三种布局，按账号选，在「设置 → 外观」或画布的「更多 ⋯」里切：**结果优先**（默认：节点就是结果，选中后节点下方的一条输入条里是提示词、模型、参数、成本和运行）、**紧凑 + 右侧面板**（节点很小，全部设置在画布右缘的属性面板里）、**全部放在节点上**（原来那种节点的后继：结果在上，一个提示词框，模型 / 参数 / 成本 / 运行并成一行）。三种布局是同一份实现，发出的请求相同。换布局不会挪动节点；换完有节点互相压住时出一条提示，点「自动整理」才重排。分享链接一律按「结果优先」只读显示。接口：User 对象多了 `prefs: { nodeLayout }`，用新增的 `PUT /api/auth/prefs` 修改。内置模板按三种布局重新排过间距。
- 画布工具栏（加节点的按钮、素材库）里现在还有「分享」和「更多 ⋯」，编辑器右上角原来那组按钮没有了。工具栏可以抓着把手拖到画布上任何地方，也可以在竖向和横向之间切换；位置和方向按浏览器记住，会让开标题块、底部工具条、小地图、生成队列圆钮和右侧属性面板，双击把手回到左侧。手机上它是标题块下面固定的一横条。「紧凑 + 右侧面板」布局的属性面板改为从画布顶部开始。
- 去掉了 `jsonwebtoken` 依赖。
