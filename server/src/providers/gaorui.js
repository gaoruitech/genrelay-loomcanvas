'use strict'

/**
 * Vendor: 高瑞 (default https://gaorui.cc). The built-in vendor; its API is
 * our own and not bound to anyone's standard.
 *
 * Supported models are listed in catalog/gaorui.json. Three protocol
 * families, selected per model by `_protocol` there. What was run against the
 * real service is listed in catalog/SOURCES.md, and the recorded answers are
 * the fixtures of the "real service" tests in test/providers.test.js.
 *
 *  nano-banana (images, asynchronous)
 *    POST /v1/nano-banana            header  Authorization: <key>   (no "Bearer")
 *      { model, prompt, imageSize, images[], webHook: '-1', shutProgress: false, aspectRatio? }
 *      -> { code: 0, msg, data: { id, type } }
 *      `images` are http(s) URLs. A base64 data URI is refused with HTTP 400,
 *      error code image_must_be_url.
 *    GET  /v1/nano-banana/{id}
 *      -> { code: 0, data: { status: pending|processing|succeeded, progress, url }, ... }
 *      The real service puts the result in data.url. The other names read
 *      below (image_url, imageUrl, output) have not been seen from it.
 *
 *  videos-* (asynchronous)
 *    POST /v1/videos                 header  Authorization: Bearer <key>, JSON body (per model below)
 *      -> { id, object: 'video', status: 'queued', progress }
 *    GET  /v1/videos/{id}
 *      -> { id, status: queued|in_progress|completed, progress, video_url, url, output_url, metadata: { url } }
 *      Seen for grok-imagine-video-1.5-preview, grok-imagine-1.0-video,
 *      omni_flash_8s, omni_flash_abra_edit and the three veo_3_1 models. The
 *      link is a plain public address.
 *    GET  /v1/videos/{id}/content    authenticated stream, used when no direct link is returned
 *
 *  chat
 *    POST /v1/chat/completions       OpenAI format
 *      A video to read goes in as an `image_url` content part holding a
 *      public URL, placed right after the text part:
 *        content: [ { type: 'text', text }, { type: 'image_url', image_url: { url: <video URL> } }, ...images ]
 *      That is what the main site sends in production (model
 *      gemini-3.5-flash-c). A `video_url` part is dropped by the relay without
 *      an error, and the model then answers without having seen the video.
 *      Both statements were checked against the real API on 2026-10-10.
 *
 * A custom model (one the user added by hand) is a chat model, or an image
 * model sent through the nano-banana task API. A custom video model is not
 * possible: every video model has its own request body, written out below.
 */
const { loadCatalog } = require('./catalog')
const { request, ProviderError, trimBase } = require('./http')
const { msg } = require('../i18n')
const { chatCompletion, listModelIds, bearer } = require('./openaiShared')

const DEFAULT_BASE_URL = 'https://gaorui.cc'

const catalog = loadCatalog('gaorui')
const byId = new Map(catalog.map((m) => [m.id, m]))

const RATIOS = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9']

/** What a custom model gets. */
const CUSTOM = {
  // Same parameters as the catalog's nano-banana models.
  image: {
    acceptsImage: true,
    imageByUrlOnly: true,
    acceptsVideo: false,
    videoEdit: false,
    maxReferenceImages: 8,
    options: { aspectRatios: RATIOS, resolutions: ['1K', '2K', '4K'] },
    defaults: { aspectRatio: 'auto', resolution: '1K', count: 1 },
  },
  chat: {
    acceptsImage: true,
    // A video goes in as an `image_url` part (see the header). Whether a
    // given model actually reads it is the upstream's call.
    acceptsVideo: true,
    videoEdit: false,
    maxReferenceImages: 8,
    options: {},
    defaults: {},
  },
}

function root(cfg) {
  return trimBase(cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/v1$/, '')
}

function requireKey(cfg) {
  if (!cfg.apiKey) throw new ProviderError('provider.api_key_missing')
}

function asList(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x)
  return typeof v === 'string' && v ? [v] : []
}

function percent(v) {
  const n = typeof v === 'string' ? parseInt(v.replace('%', ''), 10) : Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
}

function errorText(v) {
  if (!v) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'object') return String(v.message || v.code || '')
  return String(v)
}

/* ------------------------------------------------------------------ images */

async function submitNanoBanana(cfg, run) {
  // Reference images must be http(s) URLs the upstream can fetch. A base64
  // data URI is refused (HTTP 400, error code image_must_be_url), so an image
  // that only exists on this machine is refused here, with what to do about it.
  const images = []
  for (const url of (run.imageUrls || []).slice(0, 8)) images.push(await run.media.toPublicUrl(url, msg('noun.reference_image')))
  const params = run.params || {}
  const body = {
    model: run.model,
    prompt: String(run.prompt || '').trim(),
    imageSize: params.resolution || '1K',
    images,
    webHook: '-1',
    shutProgress: false,
  }
  // "auto" means: let the model decide, i.e. do not send the field at all.
  if (params.aspectRatio && params.aspectRatio !== 'auto') body.aspectRatio = params.aspectRatio

  const data = await request({
    method: 'POST',
    url: `${root(cfg)}/v1/nano-banana`,
    headers: { Authorization: cfg.apiKey, 'Content-Type': 'application/json' },
    data: body,
    signal: run.signal,
    timeoutMs: 60000,
  })
  if (!data || data.code !== 0) {
    throw new ProviderError('upstream.submit_failed_detail', { detail: errorText(data && (data.msg || data.message)) || `code=${data && data.code}` })
  }
  const id = data.data && data.data.id
  if (!id) throw new ProviderError('upstream.no_task_id')
  return { externalId: String(id) }
}

const IMAGE_DONE = new Set(['completed', 'success', 'finish', 'succeeded'])
const IMAGE_FAILED = new Set(['failed', 'error'])

async function pollNanoBanana(cfg, run) {
  const data = await request({
    url: `${root(cfg)}/v1/nano-banana/${encodeURIComponent(run.externalId)}`,
    headers: { Authorization: cfg.apiKey },
    signal: run.signal,
    timeoutMs: 20000,
  })
  if (!data || data.code !== 0) {
    throw new ProviderError('upstream.query_failed_detail', { detail: errorText(data && (data.msg || data.message)) || `code=${data && data.code}` }, { transient: true })
  }
  const d = data.data || {}
  const status = String(d.status || '').toLowerCase()
  if (IMAGE_DONE.has(status)) {
    const urls = [d.image_url, d.imageUrl, d.url, d.output].map(asList).find((l) => l.length) || []
    if (!urls.length) return { status: 'failed', error: msg('upstream.no_image_url') }
    return { status: 'succeeded', progress: 100, outputs: urls.map((url) => ({ type: 'image', url })) }
  }
  if (IMAGE_FAILED.has(status)) {
    // The upstream's own words; the runner wraps them (or says "failed" when there are none).
    return { status: 'failed', error: errorText(d.error || d.fail_reason || d.message) }
  }
  return { status: 'running', progress: percent(d.progress) }
}

/* ------------------------------------------------------------------ videos */

const SIZE_16_9 = { '16:9': '1280x720', '9:16': '720x1280' }
// Only these three are served: on 2026-10-10 Grok 1.5 refused 3:2 ("aspect_ratio must be one
// of: 1:1, 16:9, 9:16") and Grok 1.0 accepted it but returned a 16:9 clip.
const GROK_SIZES = { '9:16': '720x1280', '16:9': '1280x720', '1:1': '1024x1024' }
// omni_flash_6s is still listed by the upstream but no channel serves it
// (HTTP 503 model_not_found on 2026-10-10), so 6 s is not offered.
const OMNI_DURATIONS = [8, 10]
const VEO_RESOLUTIONS = new Set(['lite', '720p', '1080p', '4k'])
// The upstream also takes 4k for Omni Flash; it is not offered (the main
// site hides it too). A node that stored 4k gets 720p.
const OMNI_RESOLUTIONS = new Set(['720p', '1080p'])
// Grok Video 1.0 comes in fixed lengths.
const GROK_10_DURATIONS = [6, 10, 15]

/**
 * The offered length closest to the one asked for (the shorter one on a tie);
 * the first when nothing usable was asked for. A canvas saved before a length
 * was withdrawn still stores it, and the canvas UI picks the same way.
 */
function nearestDuration(list, value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return list[0]
  return list.reduce((best, d) => (Math.abs(d - n) < Math.abs(best - n) ? d : best))
}

async function refs(run, max) {
  const out = []
  for (const url of (run.imageUrls || []).slice(0, max)) out.push(await run.media.toRef(url))
  return out
}

/** One request body builder per video protocol. */
const VIDEO_BODY = {
  /**
   * Omni Flash generation. The duration is part of the model name.
   *   { model: 'omni_flash_{8|10}s', prompt, resolution: 720p|1080p,
   *     aspect_ratio: 16:9|9:16, input_reference?: string[] (max 5),
   *     first_last_frame?: true (params.imgMode === 'frames'; input_reference = [first, last]) }
   */
  async 'videos-omni-flash'(run) {
    const p = run.params || {}
    const duration = nearestDuration(OMNI_DURATIONS, p.duration)
    const frames = p.imgMode === 'frames'
    const body = {
      model: `omni_flash_${duration}s`,
      prompt: run.prompt,
      resolution: OMNI_RESOLUTIONS.has(String(p.resolution)) ? String(p.resolution) : '720p',
      aspect_ratio: SIZE_16_9[p.aspectRatio] ? p.aspectRatio : '16:9',
    }
    const input = await refs(run, frames ? 2 : 5)
    if (input.length) body.input_reference = input
    if (frames) body.first_last_frame = true
    return body
  },

  /**
   * Omni Flash video edit.
   *   { model: 'omni_flash_abra_edit', prompt, source_video_url (required),
   *     aspect_ratio, resolution: '720p', input_reference?: string[] (max 5) }
   * There is no resolution to choose: the main site always sends 720p for an
   * edit, and so do we, whatever the node stored.
   */
  async 'videos-omni-flash-edit'(run) {
    const p = run.params || {}
    const source = (run.videoUrls || [])[0]
    if (!source) throw new ProviderError('provider.video_edit_needs_source')
    const body = {
      model: 'omni_flash_abra_edit',
      prompt: run.prompt,
      source_video_url: await run.media.toPublicUrl(source, msg('noun.source_video')),
      aspect_ratio: SIZE_16_9[p.aspectRatio] ? p.aspectRatio : '16:9',
      resolution: '720p',
    }
    const input = await refs(run, 5)
    if (input.length) body.input_reference = input
    return body
  },

  /**
   * Veo 3.1. Three upstream models, chosen by what the run carries:
   *   no image                         veo_3_1
   *   images, params.imgMode 'frames'  veo_3_1-fl          images = [first, last?]  (max 2)
   *   images, otherwise                veo_3_1-components  images = references      (max 3)
   *   { model, prompt, resolution: lite|720p|1080p|4k, aspect_ratio: 16:9|9:16,
   *     images?: string[] (http(s) URLs) }
   * The clip is always 8 s; there is no duration field.
   */
  async 'videos-veo-31'(run) {
    const p = run.params || {}
    const frames = p.imgMode === 'frames'
    const images = []
    for (const url of (run.imageUrls || []).slice(0, frames ? 2 : 3)) images.push(await run.media.toPublicUrl(url, msg('noun.reference_image')))
    const body = {
      model: !images.length ? 'veo_3_1' : frames ? 'veo_3_1-fl' : 'veo_3_1-components',
      prompt: run.prompt,
      resolution: VEO_RESOLUTIONS.has(String(p.resolution)) ? String(p.resolution) : 'lite',
      aspect_ratio: SIZE_16_9[p.aspectRatio] ? p.aspectRatio : '16:9',
    }
    if (images.length) body.images = images
    return body
  },

  /**
   * Grok Video 1.5.
   *   { model, prompt, size, seconds: "<6-15>" (must be a string),
   *     resolution: 480p|720p, image_urls?: string[] (max 5, URLs) }
   * No image_urls = text-to-video. The shortest clip is 6 s: asked for 4,
   * the service returned 6 (2026-10-10).
   */
  async 'videos-grok-15'(run) {
    const p = run.params || {}
    const seconds = Math.min(15, Math.max(6, Math.round(Number(p.duration)) || 10))
    const body = {
      model: run.model,
      prompt: run.prompt,
      size: GROK_SIZES[p.aspectRatio] || '720x1280',
      seconds: String(seconds),
      resolution: ['480p', '720p'].includes(p.resolution) ? p.resolution : '480p',
    }
    const urls = []
    for (const url of (run.imageUrls || []).slice(0, 5)) urls.push(await run.media.toPublicUrl(url, msg('noun.reference_image')))
    if (urls.length) body.image_urls = urls
    return body
  },

  /**
   * Grok Video 1.0.
   *   { model: 'grok-imagine-1.0-video', prompt, size, seconds: "6"|"10"|"15" (a string),
   *     quality: 'standard', resolution: '480p', image_urls?: string[] (max 3, URLs) }
   * 480p is the only tier offered (as on the main site); the main site names
   * it in both `quality` and `resolution`, and so do we. No image_urls =
   * text-to-video.
   */
  async 'videos-grok-10'(run) {
    const p = run.params || {}
    const body = {
      model: run.model,
      prompt: run.prompt,
      size: GROK_SIZES[p.aspectRatio] || '720x1280',
      seconds: String(nearestDuration(GROK_10_DURATIONS, p.duration)),
      quality: 'standard',
      resolution: '480p',
    }
    const urls = []
    for (const url of (run.imageUrls || []).slice(0, 3)) urls.push(await run.media.toPublicUrl(url, msg('noun.reference_image')))
    if (urls.length) body.image_urls = urls
    // The main site caps the clip at 10 s once there is more than one reference image.
    if (urls.length > 1 && body.seconds === '15') body.seconds = '10'
    return body
  },
}

const OK_CODES = new Set(['success', 0, 200])

/**
 * The create/status responses come in two shapes:
 *   wrapped: { code, message, data: { task_id, status, progress, fail_reason, data: { ... } } }
 *            (data may also be a one-element array)
 *   flat:    { id, status, progress, metadata: { url }, error }
 * Returns the fields we care about from whichever arrived.
 */
function readVideoTask(raw) {
  if (!raw || typeof raw !== 'object') throw new ProviderError('upstream.unrecognized', {}, { transient: true })
  if (raw.code !== undefined && !OK_CODES.has(raw.code)) {
    const detail = errorText(raw.message || raw.msg)
    throw new ProviderError(detail ? 'upstream.error_detail' : 'upstream.error_code', { detail, code: raw.code })
  }
  let outer = raw.code !== undefined || (raw.data && raw.data.status !== undefined) ? raw.data : raw
  if (Array.isArray(outer)) outer = outer[0]
  if (!outer || typeof outer !== 'object') outer = {}
  const inner = outer.data && typeof outer.data === 'object' ? outer.data : {}
  const meta = { ...(raw.metadata || {}), ...(inner.metadata || {}), ...(outer.metadata || {}) }
  return {
    id: outer.task_id || outer.id || inner.id || raw.id || raw.task_id || '',
    status: String(outer.status || inner.status || raw.status || '').toLowerCase(),
    progress: percent(outer.progress !== undefined ? outer.progress : inner.progress),
    // While a task is still running these are empty strings, hence the || chain.
    url: outer.video_url || outer.output_url || inner.video_url || inner.output_url || meta.url || meta.video_url || '',
    error: errorText(outer.fail_reason || outer.error || inner.error || outer.error_message || raw.error),
  }
}

const VIDEO_DONE = new Set(['completed', 'success', 'succeeded', 'done', 'successful'])
const VIDEO_FAILED = new Set(['failed', 'failure', 'error', 'cancelled', 'canceled'])

async function submitVideo(cfg, run, protocol) {
  const body = await VIDEO_BODY[protocol](run)
  if (!body.prompt) throw new ProviderError('run.prompt_required')
  const raw = await request({
    method: 'POST',
    url: `${root(cfg)}/v1/videos`,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...bearer(cfg.apiKey) },
    data: body,
    signal: run.signal,
    timeoutMs: 60000,
  })
  const task = readVideoTask(raw)
  if (VIDEO_FAILED.has(task.status)) throw new ProviderError(task.error ? 'upstream.rejected_detail' : 'upstream.rejected', { detail: task.error })
  if (!task.id) throw new ProviderError('upstream.no_task_id')
  return { externalId: String(task.id) }
}

async function pollVideo(cfg, run) {
  const base = `${root(cfg)}/v1/videos/${encodeURIComponent(run.externalId)}`
  const raw = await request({
    url: base,
    headers: { Accept: 'application/json', ...bearer(cfg.apiKey) },
    signal: run.signal,
    timeoutMs: 20000,
  })
  const task = readVideoTask(raw)
  if (VIDEO_DONE.has(task.status)) {
    // A direct link is a signed CDN address and must be fetched WITHOUT our
    // key; the /content fallback is on the API host and needs it.
    const output = task.url
      ? { type: 'video', url: task.url }
      : { type: 'video', url: `${base}/content`, headers: bearer(cfg.apiKey) }
    return { status: 'succeeded', progress: 100, outputs: [output] }
  }
  if (VIDEO_FAILED.has(task.status)) return { status: 'failed', error: task.error }
  return { status: 'running', progress: task.progress }
}

/* ---------------------------------------------------------------- provider */

function protocolOf(run) {
  const entry = byId.get(run.model)
  if (entry) return entry._protocol
  // Not in the catalog: a custom model. Only images have a generic protocol.
  if (run.kind === 'image') return 'nano-banana'
  throw new ProviderError('provider.model_not_supported', { model: run.model })
}

module.exports = {
  type: 'gaorui',
  label: 'Gaorui',
  // Listed first and marked as the recommended choice.
  recommended: true,
  keyUrl: DEFAULT_BASE_URL,
  defaultBaseUrl: DEFAULT_BASE_URL,
  catalog,
  customKinds: ['image', 'chat'],
  customSpec: (kind) => CUSTOM[kind],

  async test(cfg, { signal } = {}) {
    requireKey(cfg)
    // Proves the address and the key; the list itself is not used.
    await listModelIds({ ...cfg, baseUrl: root(cfg) }, { signal })
    return { ok: true }
  },

  async submit(cfg, run) {
    requireKey(cfg)
    const protocol = protocolOf(run)
    if (protocol === 'nano-banana') return submitNanoBanana(cfg, run)
    return submitVideo(cfg, run, protocol)
  },

  async poll(cfg, run) {
    requireKey(cfg)
    return protocolOf(run) === 'nano-banana' ? pollNanoBanana(cfg, run) : pollVideo(cfg, run)
  },

  async chat(cfg, req) {
    requireKey(cfg)
    return chatCompletion({ ...cfg, baseUrl: root(cfg) }, req, { videoAsImageUrl: true })
  },

  // Exposed for unit tests.
  _internals: { readVideoTask, VIDEO_BODY },
}
