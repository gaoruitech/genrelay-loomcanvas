'use strict'

/**
 * Vendor: Google Gemini, through its official API
 * (default https://generativelanguage.googleapis.com).
 *
 *  POST {base}/v1beta/models/{model}:generateContent    header x-goog-api-key
 *
 * Google now documents the Interactions API first ("the new standard") and
 * says generateContent "remains fully supported"; this module uses
 * generateContent.
 *
 *  image generation / editing
 *    { contents: [{ role: 'user', parts: [{ text }, { inlineData: { mimeType, data } }...] }],
 *      generationConfig: { responseModalities: ['TEXT','IMAGE'], imageConfig?: { aspectRatio?, imageSize? } } }
 *    The image is accepted in any of the forms seen in the wild:
 *      parts[].inlineData { mimeType, data }  (also snake_case inline_data)
 *      parts[].fileData   { fileUri }         (also file_data.file_uri)
 *      an image URL inside a text part (markdown image or bare link)
 *
 *  chat: the same endpoint without responseModalities.
 *
 * Reference images are always sent inline as base64, so they work from local
 * storage without a public address.
 *
 * Supported models are listed in catalog/gemini.json.
 */
const { request, ProviderError, trimBase } = require('./http')
const { loadCatalog } = require('./catalog')
const { LONG_CALL_MS } = require('./openaiShared')
const { msg } = require('../i18n')

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com'
const RATIOS = ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']

function base(cfg) {
  return trimBase(cfg.baseUrl || DEFAULT_BASE_URL).replace(/\/v1(beta)?$/, '')
}

function headers(cfg) {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey }
}

function requireKey(cfg) {
  if (!cfg.apiKey) throw new ProviderError('provider.api_key_missing')
}

/**
 * What a custom model gets. No resolution option: which sizes a model takes
 * differs per model, so a custom one is left at the model's own default.
 */
const CUSTOM = {
  image: {
    acceptsImage: true,
    acceptsVideo: false,
    videoEdit: false,
    maxReferenceImages: 8,
    options: { aspectRatios: RATIOS },
    defaults: { aspectRatio: 'auto', count: 1 },
  },
  chat: {
    acceptsImage: true,
    // chat() sends text and images only; a video is refused, not dropped.
    acceptsVideo: false,
    videoEdit: false,
    maxReferenceImages: 8,
    options: {},
    defaults: {},
  },
}

/** GET {base}/v1beta/models: only to prove that the address and the key work. */
async function ping(cfg, signal) {
  const data = await request({
    url: `${base(cfg)}/v1beta/models`,
    headers: headers(cfg),
    params: { pageSize: 1 },
    signal,
    timeoutMs: 15000,
  })
  if (!data || !Array.isArray(data.models)) throw new ProviderError('upstream.bad_model_list')
}

const IMAGE_URL_IN_TEXT = /https?:\/\/[^\s)"'<>]+/g

/** Collect every image the response carries, in whichever form. */
function imagesFromResponse(data) {
  const outputs = []
  const texts = []
  for (const cand of (data && Array.isArray(data.candidates) ? data.candidates : [])) {
    const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : []
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue
      const inline = part.inlineData || part.inline_data
      const file = part.fileData || part.file_data
      if (inline && typeof inline.data === 'string' && inline.data) {
        outputs.push({ type: 'image', b64: inline.data, mime: inline.mimeType || inline.mime_type || '' })
      } else if (file && (file.fileUri || file.file_uri)) {
        outputs.push({ type: 'image', url: String(file.fileUri || file.file_uri) })
      } else if (typeof part.text === 'string') {
        texts.push(part.text)
      }
    }
  }
  if (!outputs.length) {
    // Some proxies return the picture as a link in the text. Only take links
    // that look like images (markdown image syntax or an image extension).
    for (const text of texts) {
      for (const m of text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)) outputs.push({ type: 'image', url: m[1] })
      if (outputs.length) continue
      for (const url of text.match(IMAGE_URL_IN_TEXT) || []) {
        if (/\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(url)) outputs.push({ type: 'image', url })
      }
    }
  }
  return { outputs, text: texts.join('').trim() }
}

function refusal(data) {
  const block = data && data.promptFeedback && data.promptFeedback.blockReason
  if (block) return msg('upstream.blocked', { reason: block })
  const cand = data && Array.isArray(data.candidates) && data.candidates[0]
  const reason = cand && cand.finishReason
  if (reason && reason !== 'STOP') return msg('upstream.no_result_reason', { reason })
  return null
}

async function generate(cfg, model, body, signal) {
  return request({
    method: 'POST',
    url: `${base(cfg)}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: headers(cfg),
    data: body,
    signal,
    timeoutMs: LONG_CALL_MS,
  })
}

async function userParts(req) {
  const parts = []
  if (req.prompt) parts.push({ text: req.prompt })
  const max = (req.spec && req.spec.maxReferenceImages) || 8
  for (const url of (req.imageUrls || []).slice(0, max)) {
    const { mime, data } = await req.media.toBase64(url)
    parts.push({ inlineData: { mimeType: mime, data } })
  }
  return parts
}

module.exports = {
  type: 'gemini',
  label: 'Google Gemini',
  defaultBaseUrl: DEFAULT_BASE_URL,
  catalog: loadCatalog('gemini'),
  customKinds: ['image', 'chat'],
  customSpec: (kind) => CUSTOM[kind],
  sync: true,

  async test(cfg, { signal } = {}) {
    requireKey(cfg)
    await ping(cfg, signal)
    return { ok: true }
  },

  async submit(cfg, run) {
    requireKey(cfg)
    if (run.kind !== 'image') throw new ProviderError('provider.image_chat_only')
    const parts = await userParts(run)
    if (!parts.length) throw new ProviderError('run.prompt_or_image_required')
    const p = run.params || {}
    const imageConfig = {}
    if (p.aspectRatio && p.aspectRatio !== 'auto') imageConfig.aspectRatio = p.aspectRatio
    if (p.resolution) imageConfig.imageSize = p.resolution
    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] }
    if (Object.keys(imageConfig).length) generationConfig.imageConfig = imageConfig

    const data = await generate(cfg, run.model, { contents: [{ role: 'user', parts }], generationConfig }, run.signal)
    const { outputs, text } = imagesFromResponse(data)
    if (!outputs.length) {
      throw new ProviderError(refusal(data) || (text ? msg('upstream.text_only', { text: text.slice(0, 200) }) : msg('upstream.no_image')))
    }
    return { outputs }
  },

  async poll() {
    throw new ProviderError('provider.no_async')
  },

  async chat(cfg, req) {
    requireKey(cfg)
    if (req.videoUrl) throw new ProviderError('model.no_video_input')
    const parts = await userParts(req)
    if (!parts.length) throw new ProviderError('run.prompt_required')
    const body = { contents: [{ role: 'user', parts }] }
    if (req.systemPrompt) body.systemInstruction = { parts: [{ text: req.systemPrompt }] }
    const data = await generate(cfg, req.model, body, req.signal)
    const { text } = imagesFromResponse(data)
    if (!text) throw new ProviderError(refusal(data) || 'upstream.no_text')
    const u = data && data.usageMetadata
    return {
      text,
      usage: u ? { inputTokens: Number(u.promptTokenCount) || 0, outputTokens: Number(u.candidatesTokenCount) || 0 } : null,
    }
  },

  _internals: { imagesFromResponse },
}
