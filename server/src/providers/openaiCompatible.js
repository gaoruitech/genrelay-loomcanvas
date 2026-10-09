'use strict'

/**
 * Provider for any OpenAI-compatible endpoint (OpenAI itself, relays,
 * self-hosted gateways).
 *
 *  chat    POST {base}/chat/completions       vision via image_url content parts
 *  image   POST {base}/images/generations     { model, prompt, n, size? }
 *          -> { data: [ { url } | { b64_json } ] }   (both forms are handled)
 *
 * Models come from the two text fields, or - when both are empty - from
 * GET {base}/models, where image models are recognised by name.
 * Image generation here is text-to-image only; this provider does not call
 * /images/edits.
 */
const { request, ProviderError, openaiBase, parseModelList } = require('./http')
const { chatCompletion, listModelIds, chatSpec, bearer, LONG_CALL_MS } = require('./openaiShared')

const IMAGE_NAME = /dall-e|gpt-image|image|imagen|flux|stable-diffusion|sdxl|midjourney|seedream|kolors/i
const NOT_GENERATIVE = /embedding|embed|rerank|moderation|whisper|tts|audio|speech|video|veo|sora/i

// Sizes of the OpenAI image API; "auto" (or an unknown ratio) sends no size.
const SIZES = { '1:1': '1024x1024', '3:2': '1536x1024', '2:3': '1024x1536' }

function imageSpec(id) {
  return {
    id,
    label: id,
    kind: 'image',
    acceptsImage: false,
    acceptsVideo: false,
    videoEdit: false,
    maxReferenceImages: 0,
    options: { aspectRatios: ['auto', '1:1', '3:2', '2:3'], counts: [1, 2, 3, 4] },
    defaults: { aspectRatio: 'auto', count: 1 },
  }
}

function configured(cfg) {
  return { chat: parseModelList(cfg.models), image: parseModelList(cfg.imageModels) }
}

function requireBase(cfg) {
  if (!cfg.baseUrl) throw new ProviderError('未配置接口地址')
}

module.exports = {
  type: 'openai-compatible',
  label: 'OpenAI 兼容接口',
  fields: [
    { key: 'baseUrl', label: '接口地址', required: true, placeholder: 'https://api.openai.com/v1' },
    { key: 'apiKey', label: 'API Key', secret: true, required: false },
    { key: 'models', label: '对话模型', type: 'textarea', placeholder: 'gpt-4o-mini, gpt-4o', help: '逗号分隔；与下一项都留空时自动从 /v1/models 读取' },
    { key: 'imageModels', label: '图片模型', type: 'textarea', placeholder: 'gpt-image-1', help: '逗号分隔' },
  ],
  defaultBaseUrl: '',
  // submit() returns the finished images, so it runs under the generation deadline.
  sync: true,

  async listModels(cfg, { signal } = {}) {
    requireBase(cfg)
    const { chat, image } = configured(cfg)
    if (chat.length || image.length) {
      const imageSet = new Set(image)
      return [...image.map(imageSpec), ...chat.filter((id) => !imageSet.has(id)).map(chatSpec)]
    }
    const ids = await listModelIds(cfg, { signal })
    const specs = []
    for (const id of ids) {
      if (IMAGE_NAME.test(id)) specs.push(imageSpec(id))
      else if (!NOT_GENERATIVE.test(id)) specs.push(chatSpec(id))
    }
    return specs
  },

  async test(cfg, { signal } = {}) {
    requireBase(cfg)
    const ids = await listModelIds(cfg, { signal })
    return { ok: true, message: '连接成功', modelCount: ids.length }
  },

  async submit(cfg, run) {
    requireBase(cfg)
    if (run.kind !== 'image') throw new ProviderError('该接入只支持图片生成和对话')
    if (!run.prompt) throw new ProviderError('请填写提示词')
    const p = run.params || {}
    const body = { model: run.model, prompt: run.prompt, n: Math.min(4, Math.max(1, Number(p.count) || 1)) }
    if (SIZES[p.aspectRatio]) body.size = SIZES[p.aspectRatio]

    const data = await request({
      method: 'POST',
      url: `${openaiBase(cfg.baseUrl)}/images/generations`,
      headers: { 'Content-Type': 'application/json', ...bearer(cfg.apiKey) },
      data: body,
      signal: run.signal,
      timeoutMs: LONG_CALL_MS,
    })
    if (data && data.error) {
      throw new ProviderError(`上游返回错误：${String(data.error.message || data.error).slice(0, 300)}`)
    }
    const outputs = []
    for (const item of (data && Array.isArray(data.data) ? data.data : [])) {
      if (item && typeof item.b64_json === 'string' && item.b64_json) outputs.push({ type: 'image', b64: item.b64_json })
      else if (item && typeof item.url === 'string' && item.url) outputs.push({ type: 'image', url: item.url })
    }
    if (!outputs.length) throw new ProviderError('上游没有返回图片')
    return { outputs }
  },

  async poll() {
    throw new ProviderError('该接入没有异步任务')
  },

  async chat(cfg, req) {
    requireBase(cfg)
    return chatCompletion(cfg, req)
  },
}
