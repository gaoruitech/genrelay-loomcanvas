# Providers

[简体中文](providers.zh-CN.md)

LoomCanvas has no models of its own. You pick a **vendor**, enter your own API key, and the models that vendor supports become available on the canvas. This page covers the three built-in vendors, the models each one supports, custom models, changing the address, upgrading from the previous version, how reference media reaches the upstream, and pricing.

> None of the built-in vendors has been exercised against its real upstream as part of this project yet. Their request and response shapes are pinned by tests against a fake upstream (`server/test/providers.test.js`). That includes the OpenAI `/images/edits` path used for reference images, and the model names in the OpenAI and Gemini catalogs: they have only been sent to a local fake upstream, not to the real APIs. The way a video is sent in a Gaorui chat request (see [Which node uses which model](#which-node-uses-which-model)) is taken from what the Gaorui main site does in production; it has not been run from LoomCanvas against the real Gaorui API either. Treat the first real run as a test, and report mismatches.

## Concepts

A vendor is a vendor and a model is a model. Which models a vendor has is written down in a list that ships with LoomCanvas. Nothing about a model is worked out from its name, and no model list is fetched from the upstream.

| Term | Meaning |
| --- | --- |
| Vendor | The company whose API is called: Gaorui (高瑞), OpenAI or Google Gemini. In the code, one module in `server/src/providers/` plus one catalog file. The interface calls it a provider. |
| Catalog | The models a vendor supports, stated by hand in `server/src/providers/catalog/<vendor>.json`, in three sections: image, video, chat. The section a model sits in is its kind. |
| Provider | A vendor plus your API key, added under **Settings → Providers**. You can add the same vendor more than once (for example with two keys), up to 50 providers in total. The vendor of a provider cannot be changed after it is added. |
| Custom model | A model that is not in the vendor's catalog, added by hand to one provider. You state its kind yourself. See [Custom models](#custom-models). |
| Slug | A short id given to the provider when it is created, taken from the vendor id: `gaorui`, then `gaorui-2`, and so on. It never changes. |
| Model id | `<slug>:<upstream model name>`, for example `gaorui:nano-banana-2`. Canvases, prices and usage refer to models by this id. |

Things to know:

- A provider's models are its vendor's catalog plus the custom models you added to it. The list is put together locally; saving or testing a provider does not change it.
- The API key is required. It is encrypted before it is stored and is never returned by any endpoint. The interface shows only whether a key is set and its last four characters. When editing a provider, leave the key blank to keep the current one.
- **Test connection** calls the upstream's model-list endpoint. It only proves that the address and the key work; the list that comes back is not used.
- A disabled provider hides all its models from the canvas. Deleting a provider also deletes its custom models and the price and display overrides of its models. Runs already recorded are kept.
- Every model of a provider is listed under **Settings → Models**, grouped by provider, with a kind badge (Image, Video or Chat) and a **Custom** badge on custom models. A model you do not use can be disabled there.

## Vendors

Vendors are offered in this order on the setup page and under **Settings → Providers → Add provider**. Each card opens a form with the API key, an optional name, the list **Models supported by this provider**, and **Advanced**.

| Vendor | Id | Default base URL | API used |
| --- | --- | --- | --- |
| Gaorui (recommended) | `gaorui` | `https://gaorui.cc` | Gaorui's own API |
| OpenAI | `openai` | `https://api.openai.com/v1` | The official OpenAI API only |
| Google Gemini | `gemini` | `https://generativelanguage.googleapis.com` | The official Gemini API only |

### Gaorui

Built in, listed first and marked **Recommended**: one key covers image, video and chat models. Get a key at <https://gaorui.cc>. Its API is our own and is not bound to anyone else's standard.

Supported models (`server/src/providers/catalog/gaorui.json`):

| Model name sent upstream | Display name | Kind | Reference images | Aspect ratios | Resolutions | Duration |
| --- | --- | --- | --- | --- | --- | --- |
| `nano-banana-pro` | Nano Banana Pro | image | up to 8 | auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 16:9, 9:16, 21:9 | 1K, 2K, 4K | |
| `nano-banana-2` | Nano Banana 2 | image | up to 8 | same | 1K, 2K, 4K | |
| `nano-banana-2.1` | Nano Banana 2.1 | image | up to 8 | same | 1K, 2K, 4K | |
| `nano-banana-2-lite` | Nano Banana 2 Lite | image | up to 8 | same | 1K | |
| `omni-flash` | Omni Flash | video | up to 5, or first + last frame | 16:9, 9:16 | 720p, 1080p, 4k | 6, 8, 10 s |
| `omni-flash-edit` | Omni Flash Edit | video (video edit) | up to 5, plus a source video | 16:9, 9:16 | 720p, 1080p, 4k | |
| `sora-2-openai-12s` | Sora 2 (12s) | video | 1 | 9:16, 16:9 | | 12 s fixed |
| `grok-imagine-video-1.5-preview` | Grok Video 1.5 | video | up to 5 | 9:16, 16:9, 1:1, 3:2, 2:3 | 480p, 720p | 4, 6, 8, 10, 12, 15 s |
| `deepseek-v4-pro` | DeepSeek V4 Pro | chat | text only | | | |
| `gpt-5.5` | GPT 5.5 | chat | text only | | | |
| `glm-5.3` | GLM 5.3 | chat | text only | | | |
| `gpt-6-astra` | GPT 6 Astra | chat | reads up to 8 images | | | |
| `gemini-3.5-flash-c` | Gemini 3.5 Flash | chat | reads up to 8 images; reads video | | | |

- **Chat models.** Five are listed. `deepseek-v4-pro`, `gpt-5.5` and `glm-5.3` are text only; `gpt-6-astra` reads images; `gemini-3.5-flash-c` reads images and video. They are called through `POST /v1/chat/completions` (OpenAI format). Of the five only `gemini-3.5-flash-c` takes a video, so it is the one catalog model offered in the Video analysis node; how the video is sent is described under [Which node uses which model](#which-node-uses-which-model). A Gaorui chat model that is not in this list can still be added as a [custom model](#custom-models) of kind Chat.
- **Text-only chat models.** A text-only model is never sent an image. In the Language model node its image input is greyed out and takes no new connection; if images are already connected, the node says that they will not be sent, and the run goes out with the text alone. `POST /api/llm/tasks` with `imageUrls` for such a model is refused (`model.no_image_input`).
- Image and video models are asynchronous: LoomCanvas submits a task, then polls it.
- `omni-flash-edit` is the only model offered in the Video edit node.
- Each video model has its own request body, written out in `server/src/providers/gaorui.js`.

### OpenAI

Through the official OpenAI API only. Nothing outside that API is sent.

Supported models (`server/src/providers/catalog/openai.json`):

| Model name sent upstream | Display name | Kind | Reference images | Aspect ratios | Count |
| --- | --- | --- | --- | --- | --- |
| `gpt-image-2.5-sunburst` | GPT Image 2.5 Sunburst | image | up to 16 | auto, 1:1, 3:2, 2:3 | 1 to 4 |
| `gpt-image-2.5-flare` | GPT Image 2.5 Flare | image | up to 16 | auto, 1:1, 3:2, 2:3 | 1 to 4 |
| `gpt-image-2` | GPT Image 2 | image | up to 16 | auto, 1:1, 3:2, 2:3 | 1 to 4 |
| `gpt-6-astra` | GPT-6 Astra | chat | reads up to 8 images | | |
| `gpt-6.1-sol` | GPT-6.1 Sol | chat | reads up to 8 images | | |
| `gpt-6-sol` | GPT-6 Sol | chat | reads up to 8 images | | |
| `gpt-6-luna` | GPT-6 Luna | chat | reads up to 8 images | | |
| `gpt-5.6-sol` | GPT-5.6 Sol | chat | reads up to 8 images | | |
| `gpt-5.6-terra` | GPT-5.6 Terra | chat | reads up to 8 images | | |
| `gpt-5.6-luna` | GPT-5.6 Luna | chat | reads up to 8 images | | |
| `gpt-5.5` | GPT-5.5 | chat | reads up to 8 images | | |
| `gpt-5.4` | GPT-5.4 | chat | reads up to 8 images | | |
| `gpt-5.4-mini` | GPT-5.4 Mini | chat | reads up to 8 images | | |
| `gpt-5.2` | GPT-5.2 | chat | reads up to 8 images | | |
| `gpt-4.1` | GPT-4.1 | chat | reads up to 8 images | | |
| `gpt-4.1-mini` | GPT-4.1 Mini | chat | reads up to 8 images | | |
| `gpt-4o` | GPT-4o | chat | reads up to 8 images | | |
| `gpt-4o-mini` | GPT-4o Mini | chat | reads up to 8 images | | |

No video models. No resolution option for images.

The list holds every model that OpenAI's "All models" page shows as not deprecated, that has no shutdown date for its only snapshot, and that is served by the endpoints below. Not listed, and available as custom models if you need them: the `-pro` models and `o3-pro` (Responses API only, which LoomCanvas does not call); `gpt-5`, `gpt-5-mini`, `gpt-5-nano` and `o3` (their only snapshot shuts down on 11 December 2026); every model marked Deprecated, among them `gpt-image-1`, `gpt-image-1.5`, `gpt-5.1` and `gpt-4.1-nano`; dated snapshots; realtime, audio, embedding, moderation, open-weight and restricted-access models. Sources are in `server/src/providers/catalog/SOURCES.md`.

What is called:

| Kind | Endpoint | Notes |
| --- | --- | --- |
| Chat | `POST /chat/completions` | Text, plus images as `image_url` parts. A video is refused (`model.no_video_input`): the official API has no video part. |
| Image, no reference images | `POST /images/generations` (JSON) | `{ model, prompt, n, size? }` |
| Image, with reference images | `POST /images/edits` (multipart) | `model`, `prompt`, `n`, `size?`, and one `image[]` file part per reference image. |

- Aspect ratios `1:1`, `3:2` and `2:3` are sent as `size` `1024x1024`, `1536x1024` and `1024x1536`; `auto` sends no size.
- Both `b64_json` and `url` results are accepted.
- The request waits for the finished image, so it runs under the image timeout rather than the short submit timeout.

### Google Gemini

Through the official Gemini API only: `POST /v1beta/models/{model}:generateContent`, with the key in the `x-goog-api-key` header. Google now documents the Interactions API first, as "the new standard", and says that generateContent "remains fully supported"; LoomCanvas uses generateContent.

Supported models (`server/src/providers/catalog/gemini.json`):

| Model name sent upstream | Display name | Kind | Reference images | Aspect ratios | Resolutions |
| --- | --- | --- | --- | --- | --- |
| `gemini-nano-banana-2.1` | Nano Banana 2.1 | image | up to 14 | auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9, 1:4, 4:1, 1:8, 8:1 | 1K, 2K, 4K |
| `gemini-3-pro-image` | Gemini 3 Pro Image | image | up to 6 | auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 | 1K, 2K, 4K |
| `gemini-3.1-flash-image` | Gemini 3.1 Flash Image | image | up to 14 | auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9, 1:4, 4:1, 1:8, 8:1 | 1K, 2K, 4K |
| `gemini-3.1-flash-lite-image` | Gemini 3.1 Flash Lite Image | image | up to 14 | auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 | 1K |
| `gemini-3.8-flash` | Gemini 3.8 Flash | chat | reads up to 8 images | | |
| `gemini-3.6-flash` | Gemini 3.6 Flash | chat | reads up to 8 images | | |
| `gemini-3.5-flash-lite` | Gemini 3.5 Flash-Lite | chat | reads up to 8 images | | |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro (preview) | chat | reads up to 8 images | | |
| `gemini-3-flash-preview` | Gemini 3 Flash (preview) | chat | reads up to 8 images | | |

- No video models.
- Google calls `gemini-nano-banana-2.1` Nano Banana 2.1, `gemini-3-pro-image` Nano Banana Pro, `gemini-3.1-flash-image` Nano Banana 2 and `gemini-3.1-flash-lite-image` Nano Banana 2 Lite. `gemini-3.1-flash-image` also has a 512 px size, which is not offered here.
- The list holds every text and image model that Google's models page shows as stable or preview and for which its deprecations page announces no shutdown date. Not listed, and available as custom models if you need them: `gemini-3.1-flash-lite` (shuts down 7 May 2027) and `gemini-2.5-flash-image` (15 March 2027); `gemini-3.7-flash` and `gemini-3.5-flash` (requests to them are routed to 3.8 Flash and 3.6 Flash, which are listed); `gemini-2.5-pro`, `gemini-2.5-flash` and `gemini-2.5-flash-lite` (Google limits them to accounts that already used them); Veo and Gemini Omni Flash (video, not implemented here); Live, TTS, transcription, embedding, music, robotics and agent models. Sources are in `server/src/providers/catalog/SOURCES.md`.
- Image models generate and edit: reference images are sent inline with the prompt.
- Chat takes text and images. A video is refused (`model.no_video_input`), so Gemini chat models are not offered in the Video analysis node.
- Like OpenAI, it is synchronous: the request waits for the result.

## Custom models

A custom model is a model the vendor's catalog does not list. It belongs to one provider.

To add one: **Settings → Models**, find the provider, click **Add custom model**.

| Field | Rules |
| --- | --- |
| Model name | Required. The model name in the upstream API, sent as is. Letters, digits and `. _ - : / @`, up to 120 characters. It cannot be edited later: delete the model and add it again. |
| Type | Required. Image or Chat, chosen by hand. There is no default, and LoomCanvas never guesses it from the name. |
| Display name | Optional. Defaults to the model name. |

Rules:

- A custom model cannot have the same name as a model in the vendor's catalog. If a later version adds a model to the catalog under a name you already use for a custom model, the catalog entry takes over: the model id stays the same, so its enabled state, order, display name and price are kept and canvases keep working; the model now has the capabilities the catalog states (a text-only one stops accepting images; of the Gaorui chat models only `gemini-3.5-flash-c` still accepts a video); the custom entry is removed when the server starts.
- Up to 100 custom models per provider.
- **Custom video models are refused for all three vendors.** Gaorui: every video model has its own request body, so there is no generic one to send. OpenAI and Gemini: video is not implemented through their official APIs here.
- The type and the display name can be edited. Deleting a custom model also deletes its price and display overrides; nodes that had it selected need another model.

A custom model does not get its own parameters. It gets the fixed set for its vendor and type:

| Vendor | Type | Sent as | Images | Aspect ratios | Other |
| --- | --- | --- | --- | --- | --- |
| Gaorui | Image | The nano-banana task API (`POST /v1/nano-banana`, then polled) | up to 8 reference images | auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 16:9, 9:16, 21:9 | Resolutions 1K, 2K, 4K |
| Gaorui | Chat | `POST /v1/chat/completions`, OpenAI format | reads up to 8 images | | A video is passed as an `image_url` part (the same way as for `gemini-3.5-flash-c` in the catalog), so the model is offered in the Video analysis node; whether the model can actually read a video is up to the upstream. The Gaorui chat models in the catalog are different: what each one reads is in the table above. |
| OpenAI | Image | `POST /images/generations`, or `POST /images/edits` when reference images are connected | up to 16 reference images | auto, 1:1, 3:2, 2:3 | Count 1 to 4. No resolution option. |
| OpenAI | Chat | `POST /chat/completions` | reads up to 8 images | | No video. |
| Gemini | Image | `generateContent` | up to 8 reference images | auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9 | No resolution option: the model's own default size is used. |
| Gemini | Chat | `generateContent` | reads up to 8 images | | No video. |

These sets are the `CUSTOM` constants in `server/src/providers/gaorui.js`, `openai.js` and `gemini.js`. If the model you added does not accept one of these parameters, the upstream's error is shown.

## Advanced: changing the address

Every vendor defaults to its official address. A provider stores no address of its own unless you change it.

To change it, open **Advanced** in the add or edit dialog and edit **Base URL**. **Use the official address** puts the default back. A provider with another address is marked **Non-official address** in the list.

- A different address (a proxy or a relay) must speak exactly the same API as the official one. LoomCanvas does not adapt to third-party private formats.
- For Gaorui there is usually no reason to change it.
- Accepted forms: for OpenAI, `https://host` and `https://host/v1` both work; for Gaorui a trailing `/v1` is ignored; for Gemini a trailing `/v1` or `/v1beta` is ignored.
- The address is set by the operator and is used as given, so it may point at a server on your local network. Requests to it do not follow redirects, so the API key never travels to another host.

## Upgrading from the previous version

The previous version had provider types (one of them called `openai-compatible`), free-text model fields, model lists fetched from the upstream, and model kinds guessed from names. Providers saved by it are converted automatically when the server starts, once per provider. You do not have to do anything. The server logs how many providers were upgraded and how many custom models were carried over.

What the upgrade does:

- A provider of type `openai-compatible` becomes an `openai` provider. Its slug stays the same, so model ids such as `openai-compatible:gpt-4o-mini` on canvases, in prices and in usage keep working.
- Models typed into the old fields become custom models. For OpenAI the two fields already said the kind (chat models, image models). Gemini had one field, so the old rule is applied one last time, inside the upgrade only: a name containing `image` or `banana` becomes an image model, anything else a chat model.
- Where the old version fetched the list from the upstream (Gaorui chat models; OpenAI and Gemini with the fields left empty) there is no stored list to convert. The models that were actually in use are recovered from recorded facts: the kind of each past run, and the kind of the canvas node a model is selected on. A model that was listed but never run and never selected on a canvas is not carried over; add it as a custom model if you need it.
- A name that is already in the vendor's catalog needs no custom entry and is skipped.
- A custom model can only be an image or a chat model, so a video model that existed only through an old field or an upstream list is not carried over.
- A Gaorui provider still called by the old default name, "Gaorui API" (「高瑞 API」 when it was added in Chinese), is renamed to today's default, "Gaorui" (「高瑞」). A name that is not exactly the old default is left alone, and so are the names of other vendors' providers. A provider that had already been upgraded by the steps above but still carries the old default name gets this one change on the next start; after that it is not checked again, so calling a provider "Gaorui API" on purpose later is kept.
- API keys, addresses, the enabled flag, the order and the model overrides (enabled state, names, prices) are not touched.

After the upgrade:

- Each provider also lists every catalog model of its vendor. Disable the ones you do not want under **Settings → Models**.
- An address you had entered is kept. For a provider that was `openai-compatible` and points at a relay, that relay must speak the official OpenAI API: a video in a chat request is now refused, and reference images now go to `/images/edits`.
- Check the kinds of the carried-over Gemini models under **Settings → Models**; the name rule could be wrong. The type of a custom model can be edited.

## Which node uses which model

| Node | Models offered |
| --- | --- |
| Image generation, Image edit | `image` models |
| Video generation | `video` models that are not video-edit models |
| Video edit | `video` models marked as video edit |
| Language model | `chat` models |
| Video analysis | `chat` models that accept video input (`acceptsVideo`) |

Video analysis sends the video to a chat model, so it lists only chat models that accept video input:

- `gemini-3.5-flash-c` from the Gaorui catalog;
- a **custom chat model of a Gaorui provider**. Whether it can actually read a video is up to the upstream.

OpenAI and Gemini chat models (catalog and custom ones) refuse a video, and the other four Gaorui catalog chat models take none, so they are not listed.

In the request to Gaorui the video goes into an **`image_url` content part** holding the video's public URL. It comes right after the text part; reference images follow it:

```json
{ "role": "user", "content": [
  { "type": "text", "text": "<prompt>" },
  { "type": "image_url", "image_url": { "url": "https://…/clip.mp4" } },
  { "type": "image_url", "image_url": { "url": "<reference image, optional>" } }
] }
```

- `video_url` is not used. The Gaorui relay drops a `video_url` part without an error, and the model then answers without having seen the video.
- The video needs a public URL, see [How media reaches the upstream](#how-media-reaches-the-upstream). Without one the run fails and says why; no request is sent.
- This is taken from what the Gaorui main site does in production: its video analysis uses `gemini-3.5-flash-c` and puts the video into `image_url`. LoomCanvas has only checked against a local fake upstream that the request it sends looks like the one above. **It has not been run from LoomCanvas against the real Gaorui API.**

The Language model node sends its connected images only to a chat model that reads images; see "Text-only chat models" under [Gaorui](#gaorui).

## How media reaches the upstream

Reference images and source videos on a canvas are files in **your** storage. The upstream model has to read them somehow. Each vendor uses one of three ways:

| Way | Used by | Without a public address |
| --- | --- | --- |
| Sent with the request | Gemini (always, as inline base64); OpenAI reference images (uploaded as file parts to `/images/edits`) | Works. Up to 20 MB each. |
| URL if there is a public one, otherwise an inline data URI | Gaorui image models (custom ones included), Omni Flash, Omni Flash Edit reference images, Sora 2; images in chat requests to OpenAI and Gaorui | Works. Images are sent inline, up to 20 MB each. |
| URL only | Omni Flash Edit **source video**, Grok Video reference images, video in chat (Gaorui `gemini-3.5-flash-c` and custom chat models) | **Fails** with "A publicly reachable URL is needed…". |

A "public address" is an `http(s)` URL that is not `localhost` and not a private IP. A file has one when:

- it is in an S3-compatible bucket whose endpoint is reachable from the internet. The upstream then receives the bucket's public address (with `redirect` delivery), or a presigned URL that is valid for one hour. The bucket can be private, and `PUBLIC_URL` is not needed; or
- `PUBLIC_URL` is your public address. It is added to the file's site-relative URL (`/files/<key>`) when the file is handed to the upstream. This is the only way for files on the local disk.

So for video editing and for image-to-video with URL-only models, either set `PUBLIC_URL` to a public address or keep files in a bucket (**Settings → Storage**). Switching storage does not move files that are already stored. See [Storage](storage.md#reference-media-for-upstream-models) and [Deployment](deployment.md#public_url).

A presigned URL is sent to the upstream and lets anyone who has it read that one file until it expires. It is never stored in canvases or run records.

Results always come back the same way: LoomCanvas downloads the upstream's result (through the [SSRF guard](security.md#ssrf-protection)) and stores it in your storage, with a thumbnail for images.

## Pricing

LoomCanvas does not know what your upstream charges. You enter the rates you pay, and it uses them to show an estimate next to each Run button and to total up usage. Prices never change what the upstream bills you.

![Models tab](images/08-settings-models.png)

*The prices in this screenshot were typed in for the screenshot. A new install has none.*

### Entering a price

Go to **Settings → Models**, find the model and click **Set price**.

| Field | Values | Meaning |
| --- | --- | --- |
| Currency | a code such as `CNY` or `USD` | Shown with the amount. Amounts in different currencies are never added together. |
| Billing unit | `per_image`, `per_video`, `per_second`, `per_1m_tokens` | What one price buys. |
| Price varies by (`by`) | none, `resolution`, `duration`, `resolution_duration` | Whether the price is flat or looked up in a table. |
| Price / table | a number ≥ 0, or rows of tier → price | The rate. |

With the billing unit "per 1M tokens", **Price varies by** is replaced by **Input and output**:

- **Priced separately**: an input price and an output price, each per million tokens. This is the default for a new chat model price.
- **Same price**: one rate for input and output.

In the model list a separately priced model reads "Input $1.50 / output $6.00 · per 1M tokens".

Table keys, matched case-insensitively against the run's parameters:

| `by` | Key | Example |
| --- | --- | --- |
| `resolution` | the resolution | `1K`, `720p` |
| `duration` | the duration in seconds | `6`, `10` |
| `resolution_duration` | `"<resolution>:<duration>"` | `720p:6`, `1080p:10` |

How the amount is calculated:

| Unit | Estimate |
| --- | --- |
| `per_image`, `per_video` | unit price × count |
| `per_second` | unit price × duration in seconds × count |
| `per_1m_tokens` | Not estimated before the run. After the run it is calculated from the token usage the upstream reports: input tokens × input price + output tokens × output price when priced separately, (input + output) × price with one rate, each divided by one million. In the API a separate price is `table: { "input": …, "output": … }` and a single one is `price`. |

The same structure through the API (the numbers are placeholders, not real prices):

```bash
curl -X PUT 'http://localhost:3000/api/admin/models/gaorui%3Anano-banana-2' \
  -H 'Content-Type: application/json' \
  -d '{"pricing":{"currency":"CNY","unit":"per_image","by":"resolution","table":{"1K":0.1,"2K":0.2,"4K":0.4}}}'
```

Send `"pricing": null` to remove your price again. The model id must be URL-encoded. Full reference: [API](api.md#models-admin).

### What "Cost unknown" means

A cost is **unknown** when it cannot be calculated:

- the model has no price,
- the price table has no row for the chosen resolution or duration,
- a per-second price is used with a model that has no duration, or
- the model is priced per token and the upstream did not report usage.

Unknown is never treated as zero or free. You can still run the model. In usage totals, runs with unknown cost are counted separately ("Plus N run(s) with unknown cost").

Tool nodes (slice, collage, watermark, resize, multi-platform export) run on your server, call no model and have no cost.

### What the recorded cost is

- For image and video runs, the cost stored with a run is the estimate made when the run was submitted.
- For chat runs with a per-token price, it is calculated from reported usage when the run finishes.
- It is an estimate from your price table. Your real bill comes from the upstream.

## Usage records

Every run is recorded: model, status, prompt (first 200 characters in the list), parameters, cost, failure reason and timestamps.

**Settings → Usage** shows:

- totals for a date range, by day or by model: runs, succeeded, failed, canceled, estimated spend per currency, and how many runs had unknown cost;
- the individual records, newest first.

Only **succeeded** runs with a **known** cost count towards spend. Records are kept even when `retentionDays` removes the result files.

The same data is available from `GET /api/admin/usage` and `GET /api/admin/usage/records`; see [API](api.md#usage).

## Adding another vendor

A model that one of the three vendors serves but the catalog does not list is a [custom model](#custom-models). A different vendor is a vendor module plus a catalog file: [Writing a provider](writing-a-provider.md). A vendor other than Gaorui goes through its official API only.
