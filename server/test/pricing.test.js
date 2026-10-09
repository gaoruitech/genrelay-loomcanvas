'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { estimateCost, tokenCost, normalizePricing } = require('../src/runner/pricing')

const spec = (pricing, defaults = {}) => ({ id: 'p:m', defaults, pricing })

test('no pricing: cost is unknown, never zero-as-free', () => {
  assert.deepEqual(estimateCost({ id: 'x' }, {}, 2), { unitCost: 0, totalCost: 0, currency: '', unknown: true })
  assert.equal(estimateCost(null, {}, 1).unknown, true)
  assert.equal(estimateCost(spec({ currency: 'CNY', unit: 'bogus', price: 1 })).unknown, true)
})

test('flat price times count', () => {
  const s = spec({ currency: 'CNY', unit: 'per_image', price: 0.12 })
  assert.deepEqual(estimateCost(s, {}, 1), { unitCost: 0.12, totalCost: 0.12, currency: 'CNY', unknown: false })
  assert.deepEqual(estimateCost(s, {}, 4), { unitCost: 0.12, totalCost: 0.48, currency: 'CNY', unknown: false })
  // Invalid counts fall back to one.
  assert.equal(estimateCost(s, {}, 0).totalCost, 0.12)
  assert.equal(estimateCost(s, {}, 2.5).totalCost, 0.12)
})

test('a price of zero is a known cost', () => {
  const out = estimateCost(spec({ currency: 'USD', unit: 'per_image', price: 0 }), {}, 3)
  assert.deepEqual(out, { unitCost: 0, totalCost: 0, currency: 'USD', unknown: false })
})

test('by resolution: case-insensitive lookup, defaults fill missing params', () => {
  const s = spec({ currency: 'CNY', unit: 'per_image', by: 'resolution', table: { '1K': 0.1, '2K': 0.2, '4K': 0.4 } }, { resolution: '1K' })
  assert.equal(estimateCost(s, { resolution: '2K' }, 3).totalCost, 0.6)
  assert.equal(estimateCost(s, { resolution: '4k' }, 1).unitCost, 0.4)
  assert.equal(estimateCost(s, {}, 1).unitCost, 0.1, 'falls back to spec default')
  assert.equal(estimateCost(s, { resolution: '8K' }, 1).unknown, true, 'unlisted option is unknown')
})

test('by duration', () => {
  const s = spec({ currency: 'CNY', unit: 'per_video', by: 'duration', table: { 5: 1, 10: 1.8 } })
  assert.equal(estimateCost(s, { duration: 10 }, 1).unitCost, 1.8)
  assert.equal(estimateCost(s, { duration: '5' }, 2).totalCost, 2)
  assert.equal(estimateCost(s, {}, 1).unknown, true)
})

test('by resolution_duration: flat and nested tables', () => {
  const flat = spec({ currency: 'CNY', unit: 'per_video', by: 'resolution_duration', table: { '720p_6': 1.5, '1080p_6': 3 } })
  assert.equal(estimateCost(flat, { resolution: '720p', duration: 6 }).unitCost, 1.5)
  assert.equal(estimateCost(flat, { resolution: '1080P', duration: 6 }).unitCost, 3)
  assert.equal(estimateCost(flat, { resolution: '720p', duration: 8 }).unknown, true)

  const colon = spec({ currency: 'CNY', unit: 'per_video', by: 'resolution_duration', table: { '720p:5': 1.2 } })
  assert.equal(estimateCost(colon, { resolution: '720p', duration: 5 }).unitCost, 1.2)

  const nested = spec({ currency: 'CNY', unit: 'per_video', by: 'resolution_duration', table: { '720p': { 6: 1.5, 10: 2.5 } } })
  assert.equal(estimateCost(nested, { resolution: '720p', duration: 10 }).unitCost, 2.5)
  assert.equal(estimateCost(nested, { resolution: '4k', duration: 10 }).unknown, true)
})

test('per_second multiplies by the duration', () => {
  const s = spec({ currency: 'USD', unit: 'per_second', by: 'resolution', table: { '720p': 0.1, '1080p': 0.25 } })
  assert.deepEqual(estimateCost(s, { resolution: '1080p', duration: 8 }, 2), { unitCost: 2, totalCost: 4, currency: 'USD', unknown: false })
  assert.equal(estimateCost(s, { resolution: '720p' }, 1).unknown, true, 'no duration, no price')
})

test('floating point noise is rounded away', () => {
  const s = spec({ currency: 'CNY', unit: 'per_image', price: 0.1 })
  assert.equal(estimateCost(s, {}, 3).totalCost, 0.3)
})

test('token-priced models are unknown up front and costed from usage', () => {
  const s = spec({ currency: 'USD', unit: 'per_1m_tokens', table: { input: 2, output: 8 } })
  assert.equal(estimateCost(s, {}, 1).unknown, true)
  assert.deepEqual(tokenCost(s, { inputTokens: 500000, outputTokens: 250000 }), { amount: 3, currency: 'USD', unknown: false })
  const single = spec({ currency: 'USD', unit: 'per_1m_tokens', price: 4 })
  assert.equal(tokenCost(single, { inputTokens: 250000, outputTokens: 250000 }).amount, 2)
  assert.equal(tokenCost(s, null).unknown, true)
  assert.equal(tokenCost(spec({ currency: 'CNY', unit: 'per_image', price: 1 }), { inputTokens: 1, outputTokens: 1 }).unknown, true)
})

test('normalizePricing accepts valid shapes and strips unknown fields', () => {
  assert.deepEqual(
    normalizePricing({ currency: 'cny', unit: 'per_image', price: 0.5, evil: true }),
    { currency: 'CNY', unit: 'per_image', price: 0.5 }
  )
  assert.deepEqual(
    normalizePricing({ unit: 'per_image', by: 'resolution', table: { '1K': 1 } }),
    { currency: 'CNY', unit: 'per_image', by: 'resolution', table: { '1K': 1 } }
  )
  assert.equal(normalizePricing(null), null)
  assert.deepEqual(
    normalizePricing({ currency: 'USD', unit: 'per_video', by: 'resolution_duration', table: { '720p': { 6: 1 } } }).table,
    { '720p': { 6: 1 } }
  )
})

test('normalizePricing rejects bad input', () => {
  for (const bad of [
    'free', [], { unit: 'per_day', price: 1 }, { unit: 'per_image' }, { unit: 'per_image', price: -1 },
    { unit: 'per_image', price: '1' }, { unit: 'per_image', price: Infinity },
    { unit: 'per_image', by: 'size', table: { a: 1 } }, { unit: 'per_image', by: 'resolution' },
    { unit: 'per_image', by: 'resolution', table: {} }, { unit: 'per_image', by: 'resolution', table: { '1K': 'x' } },
    { unit: 'per_image', by: 'resolution', table: { $where: 1 } }, { unit: 'per_image', by: 'resolution', table: { 'a.b': 1 } },
    { unit: 'per_image', by: 'resolution', table: { '1K': { nested: 1 } } },
    { unit: 'per_1m_tokens', table: { input: 1 } },
  ]) assert.throws(() => normalizePricing(bad), undefined, JSON.stringify(bad))
})
