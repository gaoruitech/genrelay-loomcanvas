# Providers

[简体中文](providers.zh-CN.md)

LoomCanvas has no models of its own. A **provider** connects it to an upstream API with your key. This page covers the built-in provider types, the models they expose, how reference media reaches the upstream, and pricing.

> None of the built-in providers has been exercised against its real upstream as part of this project yet. Their request and response shapes are pinned by tests against a fake upstream (`server/test/providers.test.js`). Treat the first real run as a test, and report mismatches.

## Concepts

| Term | Meaning |
| --- | --- |
| Provider type | A plugin in `server/src/providers/`: it knows one API format. Three are built in. |
| Provider (instance) | A type plus your base URL and API key, added under **Settings → Providers**. You can add several of the same type, up to 50 in total. |
| Slug | A short id given to the instance when it is created, taken from the type: `gaorui`, then `gaorui-2`, and so on. It never changes. |
| Model id | `<slug>:<upstream model>`, for example `gaorui:nano-banana-2`. Canvases, prices and usage refer to models by this id. |

Things to know:

- The API key is encrypted before it is stored and is never returned by any endpoint. The interface shows only whether a key is set and its last four characters. When editing a provider, leave the key blank to keep the current one.
- **Test connection** asks the upstream for its model list. It checks the address and the key, not every model.
- Each provider's model list is cached for five minutes. Saving or testing the provider refreshes it. If the upstream cannot be reached, the last good list keeps being served.
- A disabled provider hides all its models from the canvas. Deleting a provider also deletes the price and display overrides of its models. Runs already recorded are kept.
- The base URL is set by the operator and is used as given, so it may point at a server on your local network. Requests to it do not follow redirects, so the API key never travels to another host.

## Built-in types

### Gaorui API

Recommended: one key covers the image and video models below plus chat models. Get a key at <https://gaorui.cc>.

| Field | Required | Default |
| --- | --- | --- |
| API key | yes | |
| Base URL | no | `https://gaorui.cc` |

Models come from a catalog shipped with LoomCanvas (`server/src/providers/catalog/gaorui.json`):

| Model id (after the slug) | Name | Kind | Reference images | Aspect ratios | Resolutions | Duration |
| --- | --- | --- | --- | --- | --- | --- |
| `nano-banana-pro` | Nano Banana Pro | image | up to 8 | auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 16:9, 9:16, 21:9 | 1K, 2K, 4K | |
| `nano-banana-2` | Nano Banana 2 | image | up to 8 | same | 1K, 2K, 4K | |
| `nano-banana-2.1` | Nano Banana 2.1 | image | up to 8 | same | 1K, 2K, 4K | |
| `nano-banana-2-lite` | Nano Banana 2 Lite | image | up to 8 | same | 1K | |
| `omni-flash` | Omni Flash | video | up to 5, or first + last frame | 16:9, 9:16 | 720p, 1080p, 4k | 6, 8, 10 s |
| `omni-flash-edit` | Omni Flash Edit | video edit | up to 5, plus a source video | 16:9, 9:16 | 720p, 1080p, 4k | |
| `sora-2-openai-12s` | Sora 2 (12s) | video | 1 | 9:16, 16:9 | | 12 s fixed |
| `grok-imagine-video-1.5-preview` | Grok Video 1.5 | video | up to 5 | 9:16, 16:9, 1:1, 3:2, 2:3 | 480p, 720p | 4, 6, 8, 10, 12, 15 s |

- These are asynchronous: LoomCanvas submits a task, then polls it.
- `omni-flash-edit` is the only model offered in the Video edit node.
- **Chat models** are discovered from the upstream's `/v1/models`. Because that list does not say what a model does, names that look like media models (image, video, audio, embedding and similar) are left out by a name pattern. Anything it gets wrong can be switched off under **Settings → Models**.
- The catalog carries no prices. See [Pricing](#pricing).

### OpenAI-compatible

For OpenAI itself, relays and self-hosted gateways that speak the OpenAI API.

| Field | Required | Notes |
| --- | --- | --- |
| Base URL | yes | `https://host` and `https://host/v1` both work. |
| API key | no | Leave empty for gateways without authentication. |
| Chat models | no | Comma-separated model names. |
| Image models | no | Comma-separated model names. |

Which models appear:

- If either list is filled in, exactly those models appear.
- If both are empty, the list is read from `GET /v1/models`. Names that look like image models (`dall-e`, `gpt-image`, `image`, `imagen`, `flux`, `stable-diffusion`, `sdxl`, `midjourney`, `seedream`, `kolors`) become image models; embedding, rerank, moderation, speech and video models are skipped; the rest become chat models.

Capabilities:

| Kind | Endpoint | What it supports |
| --- | --- | --- |
| Chat | `POST /chat/completions` | Text, plus up to 8 images as `image_url` parts, plus one video as a `video_url` part (Video analysis). |
| Image | `POST /images/generations` | **Text-to-image only.** Reference images are not sent; this provider does not call `/images/edits`. Aspect ratio `auto`, `1:1`, `3:2` or `2:3` (sent as `1024x1024`, `1536x1024`, `1024x1536`; `auto` sends no size). |

No video generation. The request waits for the finished image, so it runs under the image timeout rather than the short submit timeout.

### Google Gemini

For the Gemini API, or a proxy that speaks the same format.

| Field | Required | Default |
| --- | --- | --- |
| API key | yes | |
| Base URL | no | `https://generativelanguage.googleapis.com` |
| Models | no | Comma-separated. Empty means: ask the API. |

Which models appear:

- With the Models field empty, the list is read from the API (models that support `generateContent`).
- Names containing `image` (which covers `imagen`) or `banana` are treated as image models, the rest as chat models. The same rule applies to names you type in.

Capabilities:

| Kind | What it supports |
| --- | --- |
| Image | Generation and editing with up to 8 reference images. Aspect ratios: auto, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9. |
| Chat | Text plus up to 8 images. No video input: Gemini chat models are not offered in the Video analysis node, and a chat request with a video is refused (`model.no_video_input`). |

No video generation. Like the OpenAI-compatible type, it is synchronous.

## Which node uses which model

| Node | Models offered |
| --- | --- |
| Image generation, Image edit | `image` models |
| Video generation | `video` models that are not video-edit models |
| Video edit | `video` models marked as video edit |
| Language model | `chat` models |
| Video analysis | `chat` models that accept video input (`acceptsVideo`) |

Video analysis sends the video to a chat model. Among the built-in types, chat models of Gaorui and OpenAI-compatible providers report video input and pass the video as a `video_url` content part; Gemini chat models do not. That part is a common relay extension, not part of the OpenAI API, so whether it works depends on your upstream and the model: if the model does not understand it, the upstream's error is shown. It always needs a public URL.

## How media reaches the upstream

Reference images and source videos on a canvas are files in **your** storage. The upstream model has to read them somehow. Each provider uses one of three ways:

| Way | Used by | Without a public address |
| --- | --- | --- |
| Inline base64 | Gemini (always) | Works. |
| URL if there is a public one, otherwise an inline data URI | Gaorui image models, Omni Flash, Omni Flash Edit reference images, Sora 2; images in OpenAI-style chat | Works. Images are sent inline, up to 20 MB each. |
| URL only | Omni Flash Edit **source video**, Grok Video reference images, video in chat | **Fails** with "A publicly reachable URL is needed…". |

A "public address" is an `http(s)` URL that is not `localhost` and not a private IP. A file has one when:

- it is in an S3-compatible bucket whose endpoint is reachable from the internet. The upstream then receives the bucket's public address (with `redirect` delivery), or a presigned URL that is valid for one hour. The bucket can be private, and `PUBLIC_URL` is not needed; or
- `PUBLIC_URL` is your public address. It is added to the file's site-relative URL (`/files/<key>`) when the file is handed to the upstream. This is the only way for files on the local disk.

So for video editing and for image-to-video with URL-only models, either set `PUBLIC_URL` to a public address or keep files in a bucket (**Settings → Storage**). Switching storage does not move files that are already stored. See [Storage](storage.md#reference-media-for-upstream-models) and [Deployment](deployment.md#public_url).

A presigned URL is sent to the upstream provider and lets anyone who has it read that one file until it expires. It is never stored in canvases or run records.

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
| `per_1m_tokens` | Not estimated before the run. After the run it is calculated from the token usage the upstream reports. Enter either one flat price, or separate `input` and `output` prices through the API. |

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

## Adding another API format

If your upstream speaks none of these formats, write a provider plugin: [Writing a provider](writing-a-provider.md).
