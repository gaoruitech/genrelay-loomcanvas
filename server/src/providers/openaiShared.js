'use strict'

/**
 * Pieces of the OpenAI wire format shared by more than one provider:
 * chat completions (with vision parts), model discovery and generic specs.
 */
const { request, ProviderError, openaiBase } = require('./http')
const { msg } = require('../i18n')

const LONG_CALL_MS = 30 * 60 * 1000 // the runner's deadline is the real limit

function bearer(apiKey) {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
}

function chatSpec(id) {
  return {
    id,
    label: id,
    kind: 'chat',
    acceptsImage: true,
    acceptsVideo: false,
    videoEdit: false,
    maxReferenceImages: 8,
    options: {},
    defaults: {},
  }
}

/** choices[0].message.content may be a string or an array of typed parts. */
function textFromChoice(data) {
  const msg = data && data.choices && data.choices[0] && data.choices[0].message
  if (!msg) return ''
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content.map((p) => (typeof p === 'string' ? p : (p && p.text) || '')).join('')
  }
  return ''
}

function usageFrom(data) {
  const u = data && data.usage
  if (!u || typeof u !== 'object') return null
  return {
    inputTokens: Number(u.prompt_tokens) || 0,
    outputTokens: Number(u.completion_tokens) || 0,
  }
}

/**
 * POST {base}/chat/completions.
 * Images go in as `image_url` content parts (a public URL, or a data URI when
 * the image only exists in local storage). A video is sent as a `video_url`
 * part, which is a common relay extension rather than part of the OpenAI API.
 */
async function chatCompletion(cfg, req) {
  const parts = []
  if (req.prompt) parts.push({ type: 'text', text: req.prompt })
  for (const url of req.imageUrls || []) {
    parts.push({ type: 'image_url', image_url: { url: await req.media.toRef(url) } })
  }
  if (req.videoUrl) {
    parts.push({ type: 'video_url', video_url: { url: await req.media.toPublicUrl(req.videoUrl, msg('noun.video')) } })
  }
  const plain = parts.length === 1 && parts[0].type === 'text'
  const messages = []
  if (req.systemPrompt) messages.push({ role: 'system', content: req.systemPrompt })
  messages.push({ role: 'user', content: plain ? req.prompt : parts })

  const data = await request({
    method: 'POST',
    url: `${openaiBase(cfg.baseUrl)}/chat/completions`,
    headers: { 'Content-Type': 'application/json', ...bearer(cfg.apiKey) },
    data: { model: req.model, messages, stream: false },
    signal: req.signal,
    timeoutMs: LONG_CALL_MS,
  })
  if (data && data.error) {
    throw new ProviderError('upstream.error_detail', { detail: String(data.error.message || data.error).slice(0, 300) })
  }
  const text = textFromChoice(data)
  if (!text) throw new ProviderError('upstream.no_text')
  return { text, usage: usageFrom(data) }
}

/** GET {base}/models -> array of model id strings. */
async function listModelIds(cfg, { signal, timeoutMs = 15000 } = {}) {
  const data = await request({
    url: `${openaiBase(cfg.baseUrl)}/models`,
    headers: bearer(cfg.apiKey),
    signal,
    timeoutMs,
  })
  const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : null)
  if (!list) throw new ProviderError('upstream.bad_model_list')
  const ids = []
  for (const m of list) {
    const id = typeof m === 'string' ? m : m && m.id
    if (typeof id === 'string' && id && id.length <= 120) ids.push(id)
  }
  return [...new Set(ids)].slice(0, 500)
}

module.exports = { chatCompletion, listModelIds, chatSpec, bearer, LONG_CALL_MS }
