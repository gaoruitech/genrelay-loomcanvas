'use strict'

/**
 * Vendor: OpenAI, through its official API (default https://api.openai.com/v1).
 *
 *  chat    POST {base}/chat/completions       images as image_url content parts
 *  image   POST {base}/images/generations     JSON { model, prompt, n, size? }
 *          POST {base}/images/edits           multipart: model, prompt, n, size?, image[] (files)
 *          -> { data: [ { b64_json } | { url } ] }   (both forms are handled)
 *
 * A run with reference images goes to /images/edits, one without to
 * /images/generations. Nothing outside the official API is sent: no video
 * input, no vendor-specific fields. A different base URL is fine as long as
 * what answers there speaks this same API.
 *
 * Supported models are listed in catalog/openai.json.
 */
const { request, ProviderError, openaiBase } = require('./http')
const { chatCompletion, listModelIds, bearer, LONG_CALL_MS } = require('./openaiShared')
const { loadCatalog } = require('./catalog')

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

// Sizes of the Image API; "auto" (or an unknown ratio) sends no size.
const SIZES = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' }
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** What a custom model gets: the same parameters as the catalog models of its kind. */
const CUSTOM = {
  image: {
    acceptsImage: true,
    acceptsVideo: false,
    videoEdit: false,
    maxReferenceImages: 16,
    options: { aspectRatios: ['auto', '1:1', '3:2', '2:3'], counts: [1, 2, 3, 4] },
    defaults: { aspectRatio: 'auto', count: 1 },
  },
  chat: {
    acceptsImage: true,
    acceptsVideo: false,
    videoEdit: false,
    maxReferenceImages: 8,
    options: {},
    defaults: {},
  },
}

function imagesFrom(data) {
  if (data && data.error) {
    throw new ProviderError('upstream.error_detail', { detail: String(data.error.message || data.error).slice(0, 300) })
  }
  const outputs = []
  for (const item of (data && Array.isArray(data.data) ? data.data : [])) {
    if (item && typeof item.b64_json === 'string' && item.b64_json) outputs.push({ type: 'image', b64: item.b64_json })
    else if (item && typeof item.url === 'string' && item.url) outputs.push({ type: 'image', url: item.url })
  }
  if (!outputs.length) throw new ProviderError('upstream.no_image')
  return { outputs }
}

module.exports = {
  type: 'openai',
  label: 'OpenAI',
  defaultBaseUrl: DEFAULT_BASE_URL,
  catalog: loadCatalog('openai'),
  customKinds: ['image', 'chat'],
  customSpec: (kind) => CUSTOM[kind],
  // submit() returns the finished images, so it runs under the generation deadline.
  sync: true,

  async test(cfg, { signal } = {}) {
    // Proves the address and the key. The list itself is not used: the models
    // of this vendor are the catalog plus what the user added by hand.
    await listModelIds(cfg, { signal })
    return { ok: true }
  },

  async submit(cfg, run) {
    if (run.kind !== 'image') throw new ProviderError('provider.image_chat_only')
    if (!run.prompt) throw new ProviderError('run.prompt_required')
    const p = run.params || {}
    const n = Math.min(10, Math.max(1, Number(p.count) || 1))
    const size = SIZES[p.aspectRatio]
    const base = openaiBase(cfg.baseUrl)
    const max = (run.spec && run.spec.maxReferenceImages) || CUSTOM.image.maxReferenceImages
    const refs = (run.imageUrls || []).slice(0, max)

    if (!refs.length) {
      const body = { model: run.model, prompt: run.prompt, n }
      if (size) body.size = size
      return imagesFrom(await request({
        method: 'POST',
        url: `${base}/images/generations`,
        headers: { 'Content-Type': 'application/json', ...bearer(cfg.apiKey) },
        data: body,
        signal: run.signal,
        timeoutMs: LONG_CALL_MS,
      }))
    }

    const form = new FormData()
    form.append('model', run.model)
    form.append('prompt', run.prompt)
    form.append('n', String(n))
    if (size) form.append('size', size)
    for (const [i, url] of refs.entries()) {
      const { mime, data } = await run.media.toBase64(url)
      form.append('image[]', new Blob([Buffer.from(data, 'base64')], { type: mime }), `image-${i + 1}.${EXT[mime] || 'png'}`)
    }
    return imagesFrom(await request({
      method: 'POST',
      url: `${base}/images/edits`,
      // No Content-Type here: the multipart boundary is set from the form.
      headers: bearer(cfg.apiKey),
      data: form,
      signal: run.signal,
      timeoutMs: LONG_CALL_MS,
    }))
  },

  async poll() {
    throw new ProviderError('provider.no_async')
  },

  async chat(cfg, req) {
    if (req.videoUrl) throw new ProviderError('model.no_video_input')
    return chatCompletion(cfg, req)
  },
}
