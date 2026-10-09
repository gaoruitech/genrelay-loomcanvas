'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const registry = require('../src/providers')
const catalog = require('../src/providers/catalog/gaorui.json')

const instance = { id: 'abc123', slug: 'gaorui', name: '高睿', type: 'gaorui' }

test('every built-in provider type is registered with the plugin contract', () => {
  const types = registry.listTypes()
  assert.deepEqual(types.map((t) => t.type).sort(), ['gaorui', 'gemini', 'openai-compatible'])
  for (const t of types) {
    const plugin = registry.getType(t.type)
    for (const fn of ['listModels', 'test', 'submit', 'poll', 'chat']) assert.equal(typeof plugin[fn], 'function', `${t.type}.${fn}`)
    assert.ok(t.fields.some((f) => f.key === 'apiKey' && f.secret), `${t.type} declares a secret apiKey field`)
  }
  assert.equal(registry.getType('gaorui').defaultBaseUrl, 'https://gaorui.cc')
  assert.equal(registry.getType('gaorui').label, 'Gaorui API')
  assert.equal(registry.getType('nope'), null)
})

test('register() rejects incomplete plugins', () => {
  assert.throws(() => registry.register({ type: 'x' }), /missing listModels/)
  assert.throws(() => registry.register({ type: 'Bad Type' }), /lowercase/)
})

test('buildSpecs prefixes ids, attaches the provider and drops private fields', () => {
  const specs = registry.buildSpecs(instance, catalog)
  assert.equal(specs.length, catalog.length)
  const nb = specs.find((s) => s.id === 'gaorui:nano-banana-2.1')
  assert.ok(nb)
  assert.equal(nb.providerId, 'abc123')
  assert.equal(nb.kind, 'image')
  assert.equal(nb.maxReferenceImages, 8)
  assert.deepEqual(nb.options.resolutions, ['1K', '2K', '4K'])
  assert.ok(nb.options.aspectRatios.includes('auto') && nb.options.aspectRatios.includes('21:9'))
  for (const s of specs) {
    assert.ok(!Object.keys(s).some((k) => k.startsWith('_')), 'no private fields leak')
    assert.equal(s.pricing, undefined, 'the catalog ships no prices')
  }
  assert.deepEqual(specs.find((s) => s.id === 'gaorui:nano-banana-2-lite').options.resolutions, ['1K'])
})

test('buildSpecs skips malformed and duplicate entries', () => {
  const specs = registry.buildSpecs(instance, [
    { id: 'a', kind: 'image' },
    { id: 'a', kind: 'image', label: 'dup' },
    { id: '', kind: 'image' },
    { id: 'b', kind: 'audio' },
    null,
    { kind: 'chat' },
    { id: 'c', kind: 'chat', options: { durations: ['5', 'x', 10] } },
  ])
  assert.deepEqual(specs.map((s) => s.id), ['gaorui:a', 'gaorui:c'])
  assert.deepEqual(specs[1].options.durations, [5, 10])
  assert.deepEqual(registry.buildSpecs(instance, null), [])
})

test('mergeOverrides: enabled, label, sort, defaults and pricing', () => {
  const specs = registry.buildSpecs(instance, [
    { id: 'a', kind: 'image', label: 'A', defaults: { aspectRatio: '1:1', resolution: '1K' } },
    { id: 'b', kind: 'image', label: 'B', pricing: { currency: 'CNY', unit: 'per_image', price: 1 } },
    { id: 'c', kind: 'video', label: 'C' },
  ])
  const merged = registry.mergeOverrides(specs, [
    { modelId: 'gaorui:a', label: '  Renamed  ', defaults: { resolution: '2K' }, pricing: { currency: 'USD', unit: 'per_image', price: 0.05 } },
    { modelId: 'gaorui:b', enabled: false },
    { modelId: 'gaorui:c', sort: -10 },
    { modelId: 'gaorui:ghost', enabled: false },
  ])
  assert.deepEqual(merged.map((m) => m.id), ['gaorui:c', 'gaorui:a', 'gaorui:b'], 'sorted by sort, then declaration order')
  const [c, a, b] = merged
  assert.equal(a.label, 'Renamed')
  assert.deepEqual(a.defaults, { aspectRatio: '1:1', resolution: '2K' }, 'defaults merge key by key')
  assert.deepEqual(a.pricing, { currency: 'USD', unit: 'per_image', price: 0.05 })
  assert.equal(a.enabled, true)
  assert.equal(b.enabled, false)
  assert.equal(b.label, 'B')
  assert.deepEqual(b.pricing, { currency: 'CNY', unit: 'per_image', price: 1 }, 'declared pricing kept when not overridden')
  assert.equal(c.sort, -10)
  // Inputs are not mutated.
  assert.equal(specs[0].label, 'A')
  assert.deepEqual(specs[0].defaults, { aspectRatio: '1:1', resolution: '1K' })
})

test('mergeOverrides without overrides enables everything in declaration order', () => {
  const specs = registry.buildSpecs(instance, [{ id: 'x', kind: 'chat' }, { id: 'y', kind: 'chat' }])
  const merged = registry.mergeOverrides(specs, [])
  assert.deepEqual(merged.map((m) => [m.id, m.enabled, m.sort]), [['gaorui:x', true, 0], ['gaorui:y', true, 0]])
  assert.equal(registry.mergeOverrides(specs, null).length, 2)
})

test('mergeOverrides: empty label is ignored, pricing null removes a declared price', () => {
  const specs = registry.buildSpecs(instance, [{ id: 'p', kind: 'image', label: 'P', pricing: { currency: 'CNY', unit: 'per_image', price: 1 } }])
  const [m] = registry.mergeOverrides(specs, [{ modelId: 'gaorui:p', label: '   ', pricing: null }])
  assert.equal(m.label, 'P')
  assert.equal(m.pricing, undefined)
})

test('splitModelId splits at the first colon only', () => {
  assert.deepEqual(registry.splitModelId('gaorui:nano-banana-2.1'), { slug: 'gaorui', model: 'nano-banana-2.1' })
  assert.deepEqual(registry.splitModelId('ollama:llama3:8b'), { slug: 'ollama', model: 'llama3:8b' })
  for (const bad of ['', 'nocolon', ':model', 'slug:', null, undefined]) assert.equal(registry.splitModelId(bad), null)
})
