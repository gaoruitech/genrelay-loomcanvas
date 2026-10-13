'use strict'

/**
 * Cost estimation from a ModelSpec's pricing block.
 *
 *   pricing = {
 *     currency: 'CNY',
 *     unit: 'per_image' | 'per_video' | 'per_second' | 'per_1m_tokens',
 *     by?:  'resolution' | 'duration' | 'resolution_duration',
 *     price?: 0.12,                       // when `by` is absent
 *     table?: { '1K': 0.12 }              // when `by` is set
 *   }
 *
 * `resolution_duration` tables may be flat ({ '720p:5': 1.2 }) or nested
 * ({ '720p': { '5': 1.2 } }). A missing price never becomes zero: the result
 * is flagged `unknown` so the UI can say "cost unknown" instead of "free".
 */

const { LocalizedError } = require('../i18n')

const UNITS = new Set(['per_image', 'per_video', 'per_second', 'per_1m_tokens'])
const BYS = new Set(['resolution', 'duration', 'resolution_duration'])

function isPrice(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/** Case-insensitive own-property lookup. */
function pick(table, key) {
  if (!table || typeof table !== 'object' || key === undefined || key === null || key === '') return undefined
  const want = String(key).toLowerCase()
  for (const k of Object.keys(table)) {
    if (k.toLowerCase() === want) return table[k]
  }
  return undefined
}

function lookupUnitPrice(pricing, params) {
  if (!pricing.by) return pricing.price
  const res = params.resolution
  const dur = params.duration
  if (pricing.by === 'resolution') return pick(pricing.table, res)
  if (pricing.by === 'duration') return pick(pricing.table, dur)
  if (pricing.by === 'resolution_duration') {
    // "720p:5" is what the settings page writes; "720p_5" and nested tables also work.
    for (const key of [`${res}:${dur}`, `${res}_${dur}`]) {
      const flat = pick(pricing.table, key)
      if (flat !== undefined && typeof flat !== 'object') return flat
    }
    return pick(pick(pricing.table, res), dur)
  }
  return undefined
}

function round(n) {
  return Math.round(n * 1e6) / 1e6
}

/**
 * @param {object|null} spec   ModelSpec (already merged with overrides)
 * @param {object} params      run params; missing ones fall back to spec.defaults
 * @param {number} count       how many results are requested
 * @returns {{ unitCost:number, totalCost:number, currency:string, unknown:boolean }}
 */
function estimateCost(spec, params = {}, count = 1) {
  const n = Number.isInteger(count) && count > 0 ? count : 1
  const pricing = spec && spec.pricing
  const currency = (pricing && typeof pricing.currency === 'string' && pricing.currency) || ''
  const unknown = { unitCost: 0, totalCost: 0, currency, unknown: true }
  if (!pricing || typeof pricing !== 'object' || !UNITS.has(pricing.unit)) return unknown
  // Token-priced models can only be costed after the fact, from reported usage.
  if (pricing.unit === 'per_1m_tokens') return unknown

  const merged = { ...((spec && spec.defaults) || {}), ...(params || {}) }
  let unit = lookupUnitPrice(pricing, merged)
  if (!isPrice(unit)) return unknown

  if (pricing.unit === 'per_second') {
    const seconds = Number(merged.duration)
    if (!Number.isFinite(seconds) || seconds <= 0) return unknown
    unit *= seconds
  }
  return { unitCost: round(unit), totalCost: round(unit * n), currency, unknown: false }
}

/** Cost of a chat completion from reported token usage. */
function tokenCost(spec, usage) {
  const pricing = spec && spec.pricing
  const currency = (pricing && pricing.currency) || ''
  if (!pricing || pricing.unit !== 'per_1m_tokens' || !usage) return { amount: 0, currency, unknown: true }
  const input = Number(usage.inputTokens) || 0
  const output = Number(usage.outputTokens) || 0
  const t = pricing.table || {}
  let amount
  if (isPrice(t.input) && isPrice(t.output)) amount = (input * t.input + output * t.output) / 1e6
  else if (isPrice(pricing.price)) amount = ((input + output) * pricing.price) / 1e6
  else return { amount: 0, currency, unknown: true }
  return { amount: round(amount), currency, unknown: false }
}

/**
 * What a chat run priced per token may cost at most, as far as can be told
 * before it runs: the price of its input, estimated from what is sent, plus
 * the price of the longest answer assumed (the spec's `maxOutputTokens`, else
 * `limits.outputTokens`). A team's money limit holds this much for the run
 * while it is in flight and swaps it for the real cost when it is done
 * (services/budget.js). `unknown` when the model has no usable per-token price.
 *
 * `input`: { prompt, systemPrompt, imageUrls, videoUrls };
 * `limits`: { outputTokens, tokensPerChar, tokensPerImage, tokensPerVideo }.
 */
function chatReserve(spec, input = {}, limits = {}) {
  const chars = String(input.prompt || '').length + String(input.systemPrompt || '').length
  const inputTokens = Math.ceil(chars * (limits.tokensPerChar || 1))
    + (input.imageUrls || []).length * (limits.tokensPerImage || 0)
    + (input.videoUrls || []).length * (limits.tokensPerVideo || 0)
  const own = spec && Number.isInteger(spec.maxOutputTokens) && spec.maxOutputTokens > 0 ? spec.maxOutputTokens : 0
  const outputTokens = own || limits.outputTokens || 0
  return { ...tokenCost(spec, { inputTokens, outputTokens }), inputTokens, outputTokens }
}

/** Validate a pricing object from an admin override. Returns a clean copy or throws a LocalizedError. */
function normalizePricing(input) {
  if (input === null) return null
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new LocalizedError('validation.object_or_null', { field: 'pricing' })
  if (!UNITS.has(input.unit)) throw new LocalizedError('validation.invalid', { field: 'pricing.unit' })
  const out = { currency: String(input.currency || 'CNY').trim().toUpperCase().slice(0, 8), unit: input.unit }
  const cleanTable = (table, depth) => {
    if (!table || typeof table !== 'object' || Array.isArray(table)) throw new LocalizedError('validation.object', { field: 'pricing.table' })
    const entries = Object.entries(table)
    if (!entries.length || entries.length > 200) throw new LocalizedError('price.table_size')
    const res = {}
    for (const [k, v] of entries) {
      if (k.length > 40 || k.startsWith('$') || k.includes('.')) throw new LocalizedError('price.table_key')
      if (isPrice(v)) res[k] = v
      else if (depth > 0 && v && typeof v === 'object') res[k] = cleanTable(v, depth - 1)
      else throw new LocalizedError('validation.non_negative', { field: `pricing.table["${k}"]` })
    }
    return res
  }
  if (input.unit === 'per_1m_tokens') {
    if (input.table !== undefined) {
      const t = cleanTable(input.table, 0)
      if (!isPrice(t.input) || !isPrice(t.output)) throw new LocalizedError('price.token_table')
      out.table = { input: t.input, output: t.output }
    } else if (isPrice(input.price)) out.price = input.price
    else throw new LocalizedError('validation.non_negative', { field: 'pricing.price' })
    return out
  }
  if (input.by !== undefined && input.by !== null && input.by !== '') {
    if (!BYS.has(input.by)) throw new LocalizedError('validation.invalid', { field: 'pricing.by' })
    out.by = input.by
    out.table = cleanTable(input.table, input.by === 'resolution_duration' ? 1 : 0)
  } else {
    if (!isPrice(input.price)) throw new LocalizedError('validation.non_negative', { field: 'pricing.price' })
    out.price = input.price
  }
  return out
}

module.exports = { estimateCost, tokenCost, chatReserve, normalizePricing }
