'use strict'

/**
 * Provider for the 高睿 public API (default https://gaorui.cc).
 *
 * Three protocol families, selected per model by `_protocol` in the catalog:
 *
 *  nano-banana (images, asynchronous)
 *    POST /v1/nano-banana            header  Authorization: <key>   (no "Bearer")
 *      { model, prompt, imageSize, images[], webHook: '-1', shutProgress: false, aspectRatio? }
 *      -> { code: 0, data: { id } }
 *    GET  /v1/nano-banana/{id}
 *      -> { code: 0, data: { status, progress, image_url | imageUrl | url | output, error } }
 *
 *  videos-* (asynchronous)
 *    POST /v1/videos                 header  Authorization: Bearer <key>, JSON body (per model below)
 *    GET  /v1/videos/{id}
 *    GET  /v1/videos/{id}/content    authenticated stream, used when no direct link is returned
 *
 *  chat
 *    POST /v1/chat/completions       OpenAI-compatible; models discovered via GET /v1/models
 */
const catalog = require('./catalog/gaorui.json')
const { request, ProviderError, trimBase } = require('./http')
const { chatCompletion, listModelIds, chatSpec, bearer } = require('./openaiShared')

const DEFAULT_BASE_URL = 'https://gaorui.cc'

const byId = new Map(catalog.map((m) => [m.id, m]))

// Ids from /v1/models that are media models, not chat models. The list
// endpoint does not say what a model does, so this is a name heuristic;
// anything it gets wrong can be switched off in the model settings.
const NOT_CHAT = /nano-banana|banana|image|imagen|dall-e|flux|midjourney|stable-diffusion|sdxl|video|veo|sora|omni|grok-imagine|seedance|kling|wan\d|hailuo|runway|luma|pika|tts|whisper|audio|speech|embedding|embed|rerank|moderation|suno|music/i

function root(cfg) {
  return trimBase(cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/v1$/, '')
}

function requireKey(cfg) {
  if (!cfg.apiKey) throw new ProviderError('未配置 API Key')
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
  const images = []
  for (const url of (run.imageUrls || []).slice(0, 8)) images.push(await run.media.toRef(url))
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
    throw new ProviderError(`提交失败：${errorText(data && (data.msg || data.message)) || `code=${data && data.code}`}`)
  }
  const id = data.data && data.data.id
  if (!id) throw new ProviderError('提交失败：上游没有返回任务编号')
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
    throw new ProviderError(`查询失败：${errorText(data && (data.msg || data.message)) || `code=${data && data.code}`}`, { transient: true })
  }
  const d = data.data || {}
  const status = String(d.status || '').toLowerCase()
  if (IMAGE_DONE.has(status)) {
    const urls = [d.image_url, d.imageUrl, d.url, d.output].map(asList).find((l) => l.length) || []
    if (!urls.length) return { status: 'failed', error: '任务完成但上游没有返回图片地址' }
    return { status: 'succeeded', progress: 100, outputs: urls.map((url) => ({ type: 'image', url })) }
  }
  if (IMAGE_FAILED.has(status)) {
    return { status: 'failed', error: errorText(d.error || d.fail_reason || d.message) || '上游生成失败' }
  }
  return { status: 'running', progress: percent(d.progress) }
}

/* ------------------------------------------------------------------ videos */

const SIZE_16_9 = { '16:9': '1280x720', '9:16': '720x1280' }
const GROK_SIZES = { '9:16': '720x1280', '16:9': '1280x720', '1:1': '1024x1024', '3:2': '1792x1024', '2:3': '1024x1792' }
const OMNI_DURATIONS = new Set([6, 8, 10])
const OMNI_RESOLUTIONS = new Set(['720p', '1080p', '4k'])

async function refs(run, max) {
  const out = []
  for (const url of (run.imageUrls || []).slice(0, max)) out.push(await run.media.toRef(url))
  return out
}

/** One request body builder per video protocol. */
const VIDEO_BODY = {
  /**
   * Omni Flash generation. The duration is part of the model name.
   *   { model: 'omni_flash_{6|8|10}s', prompt, resolution: 720p|1080p|4k,
   *     aspect_ratio: 16:9|9:16, input_reference?: string[] (max 5),
   *     first_last_frame?: true (params.imgMode === 'frames'; input_reference = [first, last]) }
   */
  async 'videos-omni-flash'(run) {
    const p = run.params || {}
    const duration = OMNI_DURATIONS.has(Number(p.duration)) ? Number(p.duration) : 6
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
   *     aspect_ratio, resolution, input_reference?: string[] (max 5) }
   */
  async 'videos-omni-flash-edit'(run) {
    const p = run.params || {}
    const source = (run.videoUrls || [])[0]
    if (!source) throw new ProviderError('视频编辑需要先接入一段源视频')
    const body = {
      model: 'omni_flash_abra_edit',
      prompt: run.prompt,
      source_video_url: await run.media.toPublicUrl(source, '源视频'),
      aspect_ratio: SIZE_16_9[p.aspectRatio] ? p.aspectRatio : '16:9',
      resolution: OMNI_RESOLUTIONS.has(String(p.resolution)) ? String(p.resolution) : '720p',
    }
    const input = await refs(run, 5)
    if (input.length) body.input_reference = input
    return body
  },

  /**
   * Sora 2, OpenAI-style. The duration is fixed by the model name, so no
   * `seconds` field is sent.
   *   { model: 'sora-2-openai-12s', prompt, size: 1280x720|720x1280,
   *     input_reference?: string (one image, URL or data URI) }
   */
  async 'videos-sora-openai'(run) {
    const p = run.params || {}
    const body = { model: run.model, prompt: run.prompt, size: SIZE_16_9[p.aspectRatio] || '720x1280' }
    const input = await refs(run, 1)
    if (input.length) body.input_reference = input[0]
    return body
  },

  /**
   * Grok Video 1.5.
   *   { model, prompt, size, seconds: "<4-15>" (must be a string),
   *     resolution: 480p|720p, image_urls?: string[] (max 5, URLs) }
   * No image_urls = text-to-video.
   */
  async 'videos-grok-15'(run) {
    const p = run.params || {}
    const seconds = Math.min(15, Math.max(4, Math.round(Number(p.duration)) || 10))
    const body = {
      model: run.model,
      prompt: run.prompt,
      size: GROK_SIZES[p.aspectRatio] || '720x1280',
      seconds: String(seconds),
      resolution: ['480p', '720p'].includes(p.resolution) ? p.resolution : '480p',
    }
    const urls = []
    for (const url of (run.imageUrls || []).slice(0, 5)) urls.push(await run.media.toPublicUrl(url, '参考图'))
    if (urls.length) body.image_urls = urls
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
  if (!raw || typeof raw !== 'object') throw new ProviderError('上游返回了无法识别的内容', { transient: true })
  if (raw.code !== undefined && !OK_CODES.has(raw.code)) {
    throw new ProviderError(errorText(raw.message || raw.msg) || `上游返回错误（code=${raw.code}）`)
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
  if (!body.prompt) throw new ProviderError('请填写提示词')
  const raw = await request({
    method: 'POST',
    url: `${root(cfg)}/v1/videos`,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...bearer(cfg.apiKey) },
    data: body,
    signal: run.signal,
    timeoutMs: 60000,
  })
  const task = readVideoTask(raw)
  if (VIDEO_FAILED.has(task.status)) throw new ProviderError(task.error || '上游拒绝了任务')
  if (!task.id) throw new ProviderError('提交失败：上游没有返回任务编号')
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
  if (VIDEO_FAILED.has(task.status)) return { status: 'failed', error: task.error || '上游生成失败' }
  return { status: 'running', progress: task.progress }
}

/* ---------------------------------------------------------------- provider */

function protocolOf(run) {
  const entry = byId.get(run.model)
  if (!entry) throw new ProviderError(`模型 ${run.model} 不在该接入的支持列表中`)
  return entry._protocol
}

module.exports = {
  type: 'gaorui',
  label: '高睿 API',
  fields: [
    { key: 'apiKey', label: 'API Key', secret: true, required: true },
    { key: 'baseUrl', label: '接口地址', placeholder: DEFAULT_BASE_URL },
  ],
  defaultBaseUrl: DEFAULT_BASE_URL,

  /** Catalog models plus chat models discovered from GET /v1/models. */
  async listModels(cfg, { signal } = {}) {
    const specs = catalog.map((m) => ({ ...m }))
    if (!cfg.apiKey) return specs
    try {
      const ids = await listModelIds({ ...cfg, baseUrl: root(cfg) }, { signal })
      for (const id of ids) {
        if (byId.has(id) || NOT_CHAT.test(id)) continue
        specs.push(chatSpec(id))
      }
    } catch {
      // Discovery is best effort: the catalog models work without it.
    }
    return specs
  },

  async test(cfg, { signal } = {}) {
    requireKey(cfg)
    const ids = await listModelIds({ ...cfg, baseUrl: root(cfg) }, { signal })
    return { ok: true, message: '连接成功', modelCount: ids.length }
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
    return chatCompletion({ ...cfg, baseUrl: root(cfg) }, req)
  },

  // Exposed for unit tests.
  _internals: { readVideoTask, VIDEO_BODY, NOT_CHAT },
}
