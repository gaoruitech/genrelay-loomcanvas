# Where the catalog entries come from

Review note for maintainers. Not shown in the product.

The OpenAI and Gemini catalogs were written from the vendors' own
documentation. Every page named below was fetched on 2026-10-10 as markdown
(OpenAI: the page URL plus `.md`; Google: the page URL plus `.md.txt`) and
read as text, not through a summary. "Verified" means the statement was read
on the page named in that row on that day. It does not mean the model was
called: none of the OpenAI and Gemini entries has been run against the real
API, only against a local fake upstream; no OpenAI or Gemini entry carries a
`verified` date. The 高瑞 entries are a different case: every one of them
completed a real run on the real service on 2026-10-10 and carries
`"verified": "2026-10-10"`, see "高瑞: run against the real service" at the
end.

Prices are deliberately not recorded here or in the catalogs.

## What goes into a catalog

A model is listed when all three hold:

1. It is current: not marked deprecated, and no shutdown date announced. A
   model name that is only an alias for a single snapshot counts as having a
   shutdown date when that snapshot has one.
2. It is served by the API shape the vendor module implements.
3. It is something a canvas user would pick: no realtime, audio, speech,
   transcription, embedding, moderation, agent or restricted-access models,
   and no dated snapshots.

Within a section the order is newest generation first and, inside a
generation, most capable first.

## openai.json

API shape used by `openai.js`: `POST /v1/chat/completions`,
`POST /v1/images/generations`, `POST /v1/images/edits`.

Listing used for completeness:
https://developers.openai.com/api/docs/models/all ("All models").
https://developers.openai.com/api/docs/models shows only the featured models,
which is why the first pass (2026-10-09) missed everything else.
Shutdown dates: https://developers.openai.com/api/docs/deprecations.

What was checked on each model page: the model id; the "Endpoints" table
(Chat Completions for chat models, Image generation and Image edit for image
models, each "Supported"); input and output modalities; the "Snapshots" list.
What was checked on the deprecations page: that neither the model nor its
only snapshot appears with a shutdown date.

| Model | Kind | Source (model page) | Status |
|---|---|---|---|
| `gpt-image-2.5-sunburst` | image | https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst | verified |
| `gpt-image-2.5-flare` | image | https://developers.openai.com/api/docs/models/gpt-image-2.5-flare | verified |
| `gpt-image-2` | image | https://developers.openai.com/api/docs/models/gpt-image-2 | verified: snapshot `gpt-image-2-2026-04-21`; `v1/images/generations` and `v1/images/edits` "Supported"; input text + image, output image; listed under "Image" on the all-models page without "Deprecated"; on the deprecations page only as a recommended replacement |
| `gpt-6-astra` | chat | https://developers.openai.com/api/docs/models/gpt-6-astra | verified |
| `gpt-6.1-sol` | chat | https://developers.openai.com/api/docs/models/gpt-6.1-sol | verified |
| `gpt-6-sol` | chat | https://developers.openai.com/api/docs/models/gpt-6-sol | verified |
| `gpt-6-luna` | chat | https://developers.openai.com/api/docs/models/gpt-6-luna | verified |
| `gpt-5.6-sol` | chat | https://developers.openai.com/api/docs/models/gpt-5.6-sol | verified |
| `gpt-5.6-terra` | chat | https://developers.openai.com/api/docs/models/gpt-5.6-terra | verified |
| `gpt-5.6-luna` | chat | https://developers.openai.com/api/docs/models/gpt-5.6-luna | verified |
| `gpt-5.5` | chat | https://developers.openai.com/api/docs/models/gpt-5.5 | verified (snapshot `gpt-5.5-2026-04-23`, no shutdown date) |
| `gpt-5.4` | chat | https://developers.openai.com/api/docs/models/gpt-5.4 | verified (snapshot `gpt-5.4-2026-03-05`, no shutdown date) |
| `gpt-5.4-mini` | chat | https://developers.openai.com/api/docs/models/gpt-5.4-mini | verified (snapshot `gpt-5.4-mini-2026-03-17`, no shutdown date) |
| `gpt-5.2` | chat | https://developers.openai.com/api/docs/models/gpt-5.2 | verified (snapshot `gpt-5.2-2025-12-11`, no shutdown date) |
| `gpt-4.1` | chat | https://developers.openai.com/api/docs/models/gpt-4.1 | verified (snapshot `gpt-4.1-2025-04-14`, no shutdown date) |
| `gpt-4.1-mini` | chat | https://developers.openai.com/api/docs/models/gpt-4.1-mini | verified (snapshot `gpt-4.1-mini-2025-04-14`, no shutdown date) |
| `gpt-4o` | chat | https://developers.openai.com/api/docs/models/gpt-4o | verified (default snapshot `gpt-4o-2024-08-06`, no shutdown date; the older `gpt-4o-2024-05-13` shuts down on 2026-10-23, which does not affect the alias) |
| `gpt-4o-mini` | chat | https://developers.openai.com/api/docs/models/gpt-4o-mini | verified (snapshot `gpt-4o-mini-2024-07-18`, no shutdown date) |

Every chat entry: input "text, image", output "text", Chat Completions
"Supported". The limit of 8 images per chat request is ours (the same as a
custom chat model gets), not a figure from the documentation: **unverified**
as an upstream limit.

Capabilities of the three image models:

| Capability | Value in the catalog | Source | Status |
|---|---|---|---|
| Sizes | `1024x1024`, `1536x1024`, `1024x1536` (shown as 1:1, 3:2, 2:3; "auto" sends no size) | https://developers.openai.com/api/reference/python/resources/images/methods/edit (`size`: "The standard sizes `1024x1024`, `1536x1024`, and `1024x1536` are supported by the GPT image models") and https://developers.openai.com/api/docs/guides/image-generation ("Recommended sizes" for the 2.5 models, "Popular sizes" for `gpt-image-2`) | verified for all three. All three also take custom `WIDTHxHEIGHT` sizes; not offered. |
| Edit request | multipart form, `image[]` file parts, `prompt`, `model` | image generation guide, curl example for `/v1/images/edits` | verified |
| Output | `b64_json` | same guide | verified |
| Reference images | up to 16 | the reference page above (`image`: names `gpt-image-2`, `gpt-image-2.5-sunburst` and `gpt-image-2.5-flare` among the GPT image models and says "You can provide up to 16 images") | verified. On 2026-10-09 this page answered 403/404 and the row was unverified; on 2026-10-10 the Python reference page was fetched. The language-neutral pages `api/reference/resources/images/methods/edit` and `.../generate` still answer 404. |
| Images per run | 1 to 4 offered (`n`) | same reference page: "Must be between 1 and 10" | verified for edits; for `/images/generations` the reference page could not be fetched (404), so `n` there is **unverified**. 4 is our own, lower, limit. |

Not offered: `quality`, `background`, `output_format`, `moderation`,
`input_fidelity` (real parameters, but there is no node control for them).

Left out, with the reason:

| Model | Reason | Where it says so |
|---|---|---|
| `gpt-5.5-pro`, `gpt-5.4-pro`, `gpt-5.2-pro`, `gpt-5-pro`, `o3-pro` | Chat Completions "Not supported" (Responses API only) | each model page |
| `gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `o3` | the only snapshot (`gpt-5-2025-08-07`, `gpt-5-mini-2025-08-07`, `gpt-5-nano-2025-08-07`, `o3-2025-04-16`) shuts down on 2026-12-11. The alias itself is not named on the deprecations page and the all-models page does not mark these four as deprecated, so leaving them out is our reading of rule 1, not OpenAI's wording. | model pages ("Snapshots") and deprecations page, 2026-06-11 |
| `gpt-image-1` | deprecated, shutdown 2026-10-23 | deprecations page, 2026-04-22 |
| `gpt-image-1.5`, `gpt-image-1-mini`, `chatgpt-image-latest` | deprecated, shutdown 2026-12-01 | deprecations page, 2026-06-02 |
| `gpt-5.1`, `gpt-5.4-nano`, `gpt-5.3-codex` | deprecated, shutdown 2027-04-01 | deprecations page, 2026-10-01 |
| `gpt-4.1-nano`, `o4-mini`, `o3-mini`, `o1`, `o1-pro`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo` and every other entry marked "Deprecated" | deprecated | all-models page |
| `gpt-5.6-cyber`, `gpt-rosalind-research` | restricted access, specialist | all-models page |
| `gpt-oss-120b`, `gpt-oss-20b` | open-weight models; their pages were not fetched | all-models page |
| `chat-latest` | "not recommended for API use" | all-models page |
| realtime, live, audio, TTS, transcription, embedding, moderation models; dated snapshots | rule 3 | all-models page |

## gemini.json

API shape used by `gemini.js`: `POST /v1beta/models/{model}:generateContent`.

Google's guides now show the **Interactions API**
(`POST /v1beta/interactions`) first, for both text and images.
https://ai.google.dev/gemini-api/docs/interactions calls it "the new standard
for building with Gemini, recommended for all new projects" and says: "The
original `generateContent` API remains fully supported." (The word "legacy",
which an earlier version of this note quoted, is not on the page as fetched
on 2026-10-10.)

The request fields this module sends are documented on
https://ai.google.dev/api/generate-content: `generationConfig.responseModalities`,
`generationConfig.imageConfig.aspectRatio` ("Supported aspect ratios: `1:1`,
`1:4`, `4:1`, `1:8`, `8:1`, `2:3`, `3:2`, `3:4`, `4:3`, `4:5`, `5:4`, `9:16`,
`16:9`, or `21:9`") and `imageConfig.imageSize` ("Supported values are `512`,
`1K`, `2K`, `4K`"). Verified. Which of these each model takes is in the table
below.

Listing used for completeness: https://ai.google.dev/gemini-api/docs/models
(its "All Gemini 3 models", "Gemini 2.5 ...", "Generative media models" and
"Previous models" tables). Shutdown dates:
https://ai.google.dev/gemini-api/docs/deprecations.

| Model | Kind | What was checked | Source | Status |
|---|---|---|---|---|
| `gemini-nano-banana-2.1` | image | Model code; stable; released 2026-10-06, "No shutdown date announced"; 1K / 2K / 4K (default 1K); "up to 14 reference images"; the 14 aspect ratios of its table | https://ai.google.dev/gemini-api/docs/models/gemini-nano-banana-2.1 and https://ai.google.dev/gemini-api/docs/image-generation (table "Nano Banana 2.1") | verified, the ratio list included |
| `gemini-3-pro-image` | image | Model code; stable; "No shutdown date announced"; input image + text, output image + text; 1K / 2K / 4K; the 10 aspect ratios of its table | https://ai.google.dev/gemini-api/docs/models/gemini-3-pro-image and the image guide | id, status, sizes: verified. Ratios: verified from the table the guide heads "3.1 Pro Image", which we take to be this model (the guide names no other Pro image model). Reference images: the catalog says 6, the guide's "up to 6 images of objects"; the guide also says "up to 14 images in total" (6 objects + 5 characters + 3 style). 6 is the conservative figure. |
| `gemini-3.1-flash-image` | image | Model code; stable; released 2026-05-28, "No shutdown date announced", recommended replacement `gemini-nano-banana-2.1`; "0.5K, 2K and 4K, default 1K"; the 14 aspect ratios of its table; "Up to 10 images of objects" plus "Up to 4 images of characters" | https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-image, the image guide (table "3.1 Flash Image") and the deprecations page ("Nano Banana models") | verified. The 512 px size (`imageSize: "512"`) exists and is deliberately not offered: the catalog gives this model the same 1K / 2K / 4K as its siblings. |
| `gemini-3.1-flash-lite-image` | image | Model code; stable; "No shutdown date announced"; 1K only; ratios `1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9`; up to 14 images | https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-image and the image guide | verified (the model page says "a discrete set of 14 aspect ratios" and names these ten; only the ten named ones are offered) |
| `gemini-3.8-flash` | chat | Model code; stable; released 2026-09-02, "No shutdown date announced"; inputs "Text, Image, Video, Audio, and PDF", output text | https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash | verified |
| `gemini-3.6-flash` | chat | Same points; released 2026-07-21, "No shutdown date announced" | https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash | verified |
| `gemini-3.5-flash-lite` | chat | Same points; released 2026-07-21, "No shutdown date announced" | https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite | verified (on its own page this time) |
| `gemini-3.1-pro-preview` | chat | Same points; preview; released 2026-02-19, "No shutdown date announced" | https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview | verified (on its own page this time) |
| `gemini-3-flash-preview` | chat | Same points; preview; released 2025-12-17, "No shutdown date announced", recommended replacement `gemini-3.6-flash` | https://ai.google.dev/gemini-api/docs/models/gemini-3-flash-preview | verified |

Order of the chat section: the stable models newest first, then the two
preview models newest first. Order of the image section: Nano Banana 2.1
(newest), Nano Banana Pro (the professional tier), Nano Banana 2, Nano Banana
2 Lite.

`gemini-3.1-flash-image`, whose status the first pass called conflicting:
the deprecations page lists it with "No shutdown date announced" and names
`gemini-nano-banana-2.1` as the recommended replacement; the models page
lists it as Stable; the image guide calls it "the previous-generation
high-efficiency workhorse model". A recommended replacement is not a
deprecation, so it is included.

The 8 images per chat request are our own limit, **unverified** as an
upstream limit. Chat models accept video, audio and PDF according to Google;
`gemini.js` sends text and images only, so the catalog says
`acceptsVideo: false`.

Left out, with the reason:

| Model | Reason | Where it says so |
|---|---|---|
| `gemini-3.1-flash-lite` | shutdown 2027-05-07 | deprecations page |
| `gemini-2.5-flash-image` | shutdown 2027-03-15 | deprecations page |
| `gemini-3.7-flash`, `gemini-3.5-flash` | no shutdown date, but "requests to `gemini-3.7-flash` are automatically routed to `gemini-3.8-flash`" (and 3.5 to 3.6); neither is on the models page any more. Listing them would offer the same model twice. | deprecations page |
| `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite` | no shutdown date, but "we are limiting access to the 2.5 models to users who have actively used them in the past ... For any new projects, use our latest models". A new key cannot use them. Their own pages were not fetched. | models page and deprecations page |
| `veo-3.1-*`, `gemini-omni-1.1-flash` | video; not implemented in `gemini.js` (the Veo previews also shut down on 2026-10-22) | models page, deprecations page |
| Live, TTS, transcription, embedding, Lyria, robotics, Deep Research and Antigravity models | rule 3 | models page |

## gaorui.json

Our own API; no external source.

The image entries, `omni-flash`, `omni-flash-edit` and
`grok-imagine-video-1.5-preview` are the ones the catalog already had.

Changed on 2026-10-10 after the runs against the real service:

- `omni-flash`: 6 s removed from `durations`, default now 8 s. The key's
  `GET /v1/models` lists `omni_flash_6s`, `omni_flash_8s` and
  `omni_flash_10s`, but `omni_flash_6s` answers HTTP 503 `model_not_found`
  ("分组 default 下模型 omni_flash_6s 无可用渠道（distributor）", wrapped in
  `fail_to_fetch_task`: the service behind the relay has no channel), while
  the same body with `omni_flash_8s` is accepted. The main site's own code
  offers 8 and 10 s only and marks 6 s as taken offline
  (`backend/src/routes/omni.js`, `FLASH_DURATIONS`). The request body was
  right; the duration was not served.
- `omni-flash`: 4k removed from `resolutions` (owner's decision). The main
  site offers 720p and 1080p only (`backend/src/routes/omni.js`,
  `FLASH_RESOLUTIONS = ['720p', '1080p'] // 4k 已隐藏`; the same two in
  `frontend/src/views/Omni.vue` and in the canvas adapter). The upstream
  caller still accepts 4k; it was never run. A stored 4k is sent as 720p.
- `omni-flash-edit`: `resolutions` is now `["720p"]`. The main site offers no
  resolution for an edit: its page shows the resolution choice only when the
  mode is not video edit and sends `resolution: undefined` for one
  (`Omni.vue`), its canvas edit adapter has aspect ratios only, and the route
  then falls back to `FLASH_DEFAULT_RESOLUTION = '720p'`, which the caller
  sends upstream. So every edit the main site makes is 720p, which is also
  the one that was run here. `gaorui.js` always sends 720p for an edit.
- `grok-imagine-video-1.5-preview`: 4 s removed from `durations` (owner: the
  minimum is 6 s). It agrees with the run below (asked for 4, got 6) and with
  the main site's pages, which offer 6 to 15 s. A stored 4 is sent as 6.
- `grok-imagine-1.0-video`: added as "Grok Video 1.0". Protocol from the main
  site (`backend/src/routes/grok.js`,
  `services/batch-video/callers/GrokCaller.js`, whose default address is
  `https://gaorui.cc/v1/videos`): `POST /v1/videos` with
  `{ model, prompt, size, seconds: "<n>" (a string), quality, resolution, image_urls?: [URL] (max 3) }`,
  polled like the other video models. Sizes are those of Grok Video 1.5
  (`GROK_RATIO_SIZE_MAP`). Durations 6 / 10 / 15 s are what the main site's
  pages offer (its route still accepts 12, 16 and 20 for old canvases; not
  offered here). Quality: the caller maps 480p to `quality: "standard"` and
  720p to `"high"` and sends `resolution` as well, but the main site offers
  480p only (`GROK_10_RESOLUTIONS = ['480p']`), and so does the catalog. With
  more than one reference image the main site's page caps the clip at 10 s;
  `gaorui.js` does the same. The main site has a second caller for 1.0
  (`GrokV2Caller`: `input_reference` as one `|`-joined string, 10 s forced)
  behind a configuration switch; it was not used: the two runs below went
  through with `image_urls`, and the reference image is visibly the first
  frame of the returned clip.
- `imageByUrlOnly: true` on the four image models, `veo-3.1` and the two Grok
  models: `gaorui.js` hands their reference images over as public URLs and
  refuses one that has none. The canvas reads the flag to say so before a run.
- `sora-2-openai-12s`: removed. HTTP 503 `model_not_found` from the relay
  itself, and the id is not in the key's `/v1/models`.
- `veo-3.1`: added. Protocol from the main site (`backend/src/routes/veo.js`,
  `services/mockAi.js`, "线路1"): `POST /v1/videos` with
  `{ model, prompt, resolution: lite|720p|1080p|4k, aspect_ratio: 16:9|9:16, images?: [URL] }`,
  no duration field (8 s fixed). Three upstream ids, all in the key's
  `/v1/models`: `veo_3_1` (text), `veo_3_1-components` (reference images, the
  main site allows 3), `veo_3_1-fl` (first and last frame, 2 images). One
  catalog entry covers the three, the same way `omni-flash` covers its
  durations; `imgMode` and the presence of images pick the id. All three were
  run, see below.

Video-capable ids in the key's `GET /v1/models` on 2026-10-10 that are not in
the catalog, none of them run: `grok-imagine-video-1.5`,
`grok-imagine-video-edit`, `sd-2.0`, `sd-2.0-fast`,
`sd-2.0-mini`, `seedance-2.0`, `seedance-2.0-fast`, `seedance-2.0-mini`,
`seedance-2.5`, and `omni_flash_6s` (see above).

The `chat` section was supplied by the product owner on 2026-10-10 as a list
of display name, model id and type:

| Display name on 高瑞 | Model id | Type | In the catalog |
|---|---|---|---|
| 通用 · 智能推理 · DeepSeek V4 Pro | `deepseek-v4-pro` | text only | `acceptsImage: false`, `maxReferenceImages: 0` |
| 通用 · 快速 · GPT 5.5 | `gpt-5.5` | text only | `acceptsImage: false`, `maxReferenceImages: 0` |
| 智谱 · 超强推理 · GLM 5.3 | `glm-5.3` | text only | `acceptsImage: false`, `maxReferenceImages: 0` |
| 通用 · 快速 · GPT 6 Astra | `gpt-6-astra` | reads images | `acceptsImage: true`, `maxReferenceImages: 8` |
| 看图 · 快速 · Gemini 3.5 Flash | `gemini-3.5-flash-c` | reads images | `acceptsImage: true`, `maxReferenceImages: 8`, `acceptsVideo: true` (see below) |

- The label is the model's own name; the positioning words are the localized
  description (`model.gaorui.<id>.desc` in `src/i18n/`).
- `acceptsVideo` is `true` for `gemini-3.5-flash-c` and `false` for the other
  four. The owner's list does not mention video. The `true` comes from the
  main site, established on 2026-10-10 from its production configuration and
  code (`backend/src/services/reversePromptService.js`): its video analysis
  calls this model through the same relay. Nothing of the kind is known for
  the other four, and nothing is assumed.
- How the video is sent, from the same source: as an **`image_url`** content
  part holding a public http(s) URL, right after the text part
  (`[ { type: 'text' }, { type: 'image_url', image_url: { url: <video> } } ]`).
  The main site's code notes that the relay drops `video_url`, `file_url` and
  base64 data URLs without an error, after which the model answers without
  having seen the video. `gaorui.js` sends the same shape, also for custom
  chat models, and refuses a video that has no public URL. Where the main
  site adds reference images it puts one more text part ("以下为参考图…")
  between the video and the images; LoomCanvas sends the images straight
  after the video, without that sentence.
- Run from LoomCanvas against the real 高瑞 API on 2026-10-10 (see the next
  section): the `image_url` form works, and a `video_url` part is ignored.
- 8 images for the two that read images is the figure a custom 高瑞 chat model
  gets; the owner's list gives no number. **Unverified** (one image was sent).

## 高瑞: run against the real service

On 2026-10-10, against `https://gaorui.cc`, with a real key, through a
LoomCanvas instance with local storage and no public address (the whole path:
`POST /api/runs` or `/api/llm/tasks`, submit, poll, download, store, usage
record). One run per row at the lowest settings, count 1. The recorded
answers, with ids and file names replaced, are the fixtures of the tests named
"real service" in `server/test/providers.test.js`.

"verified" = that run completed and the result was looked at. A catalog entry
gets `"verified": "2026-10-10"` when its text-only run is verified (for
`omni-flash-edit`, which has no text-only use, when its edit run is).

| Entry | Text only | With reference images / first and last frame | What was sent, what came back |
| --- | --- | --- | --- |
| `nano-banana-pro` | verified | not verified | 1K, 1:1 |
| `nano-banana-2` | verified | verified | 1K, 1:1. Reference: one image as an http(s) URL, aspect ratio not sent (`auto`). The same as a base64 data URI is refused: HTTP 400 `image_must_be_url` |
| `nano-banana-2.1` | verified | not verified | 1K, 1:1 |
| `nano-banana-2-lite` | verified | not verified | 1K, 1:1 |
| `omni-flash` | verified | verified | `omni_flash_8s`, 720p, 16:9: 1280x720, 8 s, with audio, about 70 s. Reference: `input_reference` with one URL, `imgMode` multi; the clip starts from the reference image. `first_last_frame` not run; `omni_flash_10s` not run |
| `omni-flash-edit` | n/a | not verified | Edit run verified: `omni_flash_abra_edit`, `source_video_url`, 16:9, 720p; edited clip returned (1280x720), about 2.5 min. `input_reference` not run |
| `veo-3.1` | verified | verified | `veo_3_1`, `lite`, 16:9: 1280x720, 8 s, with audio, about 90 s. `veo_3_1-components` with `images: [one URL]`: the subject of the reference is kept, about 80 s. `veo_3_1-fl` with `images: [first, last]`: the clip goes from the first image to the last, about 80 s. Status answers name the model with its tier: `veo_3_1-lite`, `veo_3_1-lite-components`, `veo_3_1-lite-fl` |
| `grok-imagine-video-1.5-preview` | verified | not verified | `size` 1280x720, `resolution` 480p, `seconds` "4": the clip was 848x480 and 6 s long, not 4 s. 4 has since been removed from `durations`; no run has been made with `seconds` "6" or more. `image_urls` not run. `size` 1792x1024 (3:2) was refused: "aspect_ratio must be one of: 1:1, 16:9, 9:16"; 3:2 and 2:3 removed from the catalog |
| `grok-imagine-1.0-video` | verified | verified | `size` 1280x720, `seconds` "6", `quality` standard, `resolution` 480p: 752x416, 6.04 s, h264 with audio, about 40 s. With `image_urls: [one URL]`: same format, 6.04 s, about 55 s, the clip starts from the reference image. The create answer names no model; status answers are flat (`status: in_progress` / `completed`, the link in `video_url`, `url`, `output_url` and `metadata.url`). 10 and 15 s not run. `size` 1792x1024 (3:2) was accepted but the clip was 848x480 (16:9), after about 230 s; 3:2 and 2:3 removed from the catalog (2:3 itself not run) |
| `deepseek-v4-pro`, `gpt-5.5`, `glm-5.3` | verified | n/a | text; answered, usage returned |
| `gpt-6-astra` | verified | verified | text; text with one image as a data URI, the image was read: `acceptsImage: true` holds |
| `gemini-3.5-flash-c` | verified | verified | text; one image as a data URI, read. A 6-second video by public URL in an `image_url` part, described correctly: `acceptsVideo: true` holds. Control: the same with a `video_url` part, answer "no video", prompt tokens those of the text alone |

Whether the public API can take a local file with just the key, looked into
on 2026-10-10 (main site code, and calls that cost nothing):

| Call | Answer |
| --- | --- |
| `GET` / `POST /v1/uploads`, `/v1/upload`, `GET /v1/assets`, `/v1/images/uploads`, `/v1/media` | HTTP 404 `Invalid URL` |
| `POST /v1/assets/uploads` with `{}` | HTTP 400 `purpose is required`. The route exists. In the main site (`services/taskWorker.js`) it is called with `{ url, model, mode: 'asset', type, purpose, role, subject_type }` to register material that already has a public URL for the Seedance models, and returns `asset_url` (`asset://…`) |
| `GET` / `POST /v1/files` | HTTP 400 "未指定模型名称": a relay route that needs a model. Not used anywhere in the main site |
| `POST /v1/nano-banana` with a data URI in `images` | HTTP 400 `image_must_be_url` ("图片/参考图仅支持 http/https URL"), recorded earlier |

Nothing here turns a local file into an http(s) address the image models
accept, so nothing was built on it. The main site itself uploads to its own
object storage first and passes that address on.

Not verified for 高瑞: every option value not named above (2K, 4K, 1080p,
Veo's 720p and above, the other aspect ratios and durations),
`maxReferenceImages` of every entry (one image was sent each time, two for
first and last frame), reference images sent inline to the video endpoint,
the three text-only chat models' refusal of images (LoomCanvas does not send
them any, so the upstream's answer was not looked at), and custom models.
