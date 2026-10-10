'use strict'

/**
 * The vendor model: explicit catalogs, custom models with a hand-picked kind,
 * and the one-time upgrade of providers stored in the old shape.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const registry = require('../src/providers')
const { validateCatalog, loadCatalog, KINDS } = require('../src/providers/catalog')
const { plan, parseModelList } = require('../src/services/providerMigration')

const SRC = path.join(__dirname, '..', 'src')
const VENDORS = ['gaorui', 'openai', 'gemini']

test('catalogs: every vendor file loads, validates and states all three kinds', () => {
  for (const vendor of VENDORS) {
    const raw = require(`../src/providers/catalog/${vendor}.json`)
    assert.deepEqual(Object.keys(raw), KINDS, `${vendor}: sections`)
    const list = loadCatalog(vendor)
    assert.equal(list.length, KINDS.reduce((n, k) => n + raw[k].length, 0))
    for (const m of list) {
      assert.ok(raw[m.kind].some((e) => e.id === m.id), `${vendor}:${m.id} takes its kind from its section`)
      assert.equal(m.pricing, undefined, 'catalogs carry no prices')
    }
    assert.deepEqual(registry.getType(vendor).catalog, list)
  }
  // What each catalog holds today. Changing a catalog means changing this on purpose.
  const ids = (vendor, kind) => loadCatalog(vendor).filter((m) => m.kind === kind).map((m) => m.id)
  assert.deepEqual(ids('gaorui', 'image'), ['nano-banana-pro', 'nano-banana-2', 'nano-banana-2.1', 'nano-banana-2-lite'])
  assert.deepEqual(ids('gaorui', 'video'), ['omni-flash', 'omni-flash-edit', 'veo-3.1', 'grok-imagine-video-1.5-preview', 'grok-imagine-1.0-video'])
  assert.deepEqual(ids('gaorui', 'chat'), ['deepseek-v4-pro', 'gpt-5.5', 'glm-5.3', 'gpt-6-astra', 'gemini-3.5-flash-c'])
  assert.deepEqual(ids('openai', 'image'), ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2'])
  assert.deepEqual(ids('openai', 'video'), [])
  assert.deepEqual(ids('openai', 'chat'), [
    'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
    'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.2', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini',
  ])
  assert.deepEqual(ids('gemini', 'image'), ['gemini-nano-banana-2.1', 'gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image'])
  assert.deepEqual(ids('gemini', 'video'), [])
  assert.deepEqual(ids('gemini', 'chat'), ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview'])
  assert.equal(loadCatalog('gaorui').find((m) => m.id === 'omni-flash-edit').videoEdit, true)
  // What is offered for the options that have had values removed (a stored value that is gone falls back; see providers.test.js).
  const opt = (id) => loadCatalog('gaorui').find((m) => m.id === id).options
  assert.deepEqual([opt('omni-flash').resolutions, opt('omni-flash').durations], [['720p', '1080p'], [8, 10]])
  assert.deepEqual(opt('omni-flash-edit').resolutions, ['720p'])
  assert.deepEqual(opt('grok-imagine-video-1.5-preview').durations, [6, 8, 10, 12, 15])
  assert.deepEqual([opt('grok-imagine-1.0-video').resolutions, opt('grok-imagine-1.0-video').durations], [['480p'], [6, 10, 15]])
  // The models whose reference images go out as public URLs only.
  const urlOnly = (vendor) => loadCatalog(vendor).filter((m) => m.imageByUrlOnly).map((m) => m.id)
  assert.deepEqual(urlOnly('gaorui'), ['nano-banana-pro', 'nano-banana-2', 'nano-banana-2.1', 'nano-banana-2-lite', 'veo-3.1', 'grok-imagine-video-1.5-preview', 'grok-imagine-1.0-video'])
  assert.deepEqual([urlOnly('openai'), urlOnly('gemini')], [[], []])
})

test('catalogs: the 高瑞 chat models, text-only or image-reading as stated, and the one that takes a video', () => {
  const chat = (locale) => registry.listVendors(locale).find((v) => v.type === 'gaorui').models.filter((m) => m.kind === 'chat')
  assert.deepEqual(chat('zh-CN').map((m) => [m.model, m.label, m.desc, m.acceptsImage, m.maxReferenceImages, m.acceptsVideo]), [
    ['deepseek-v4-pro', 'DeepSeek V4 Pro', '通用 · 智能推理', false, 0, false],
    ['gpt-5.5', 'GPT 5.5', '通用 · 快速', false, 0, false],
    ['glm-5.3', 'GLM 5.3', '智谱 · 超强推理', false, 0, false],
    ['gpt-6-astra', 'GPT 6 Astra', '通用 · 快速', true, 8, false],
    ['gemini-3.5-flash-c', 'Gemini 3.5 Flash', '看图 · 快速', true, 8, true],
  ])
  assert.deepEqual(chat('en').map((m) => m.desc), ['General · reasoning', 'General · fast', 'Zhipu · strongest reasoning', 'General · fast', 'Vision · fast'])
  // Every catalog model of every vendor has its one-line description in both languages.
  for (const locale of ['zh-CN', 'en']) {
    for (const v of registry.listVendors(locale)) for (const m of v.models) assert.ok(m.desc, `${locale}: ${v.type}:${m.model} has no description`)
  }
})

test('a custom model whose name the catalog now lists: the catalog entry is served, under the same model id', () => {
  // An instance upgraded from the version in which 高瑞 chat models were added by hand.
  const doc = { _id: 'p', slug: 'gaorui', name: '高瑞', type: 'gaorui', customModels: [
    { id: 'gpt-5.5', kind: 'chat', label: 'My GPT' },
    { id: 'deepseek-v4-pro', kind: 'image', label: '' },
    { id: 'fake-chat-1', kind: 'chat', label: '' },
  ] }
  const specs = registry.specsForInstance(doc)
  const of = (id) => specs.filter((s) => s.id === id)
  assert.equal(of('gaorui:gpt-5.5').length, 1, 'served once')
  // The custom row said "reads 8 images, takes a video"; the catalog says text only.
  const gpt = of('gaorui:gpt-5.5')[0]
  assert.deepEqual([gpt.custom, gpt.label, gpt.acceptsImage, gpt.acceptsVideo], [false, 'GPT 5.5', false, false])
  const deepseek = of('gaorui:deepseek-v4-pro')[0]
  assert.deepEqual([deepseek.kind, deepseek.custom], ['chat', false], 'the kind is the catalog section, not what the row said')
  assert.deepEqual(specs.filter((s) => s.custom).map((s) => s.id), ['gaorui:fake-chat-1'], 'a custom model the catalog does not list stays')
  // Same id, so what the user set for it still applies: off, moved, renamed, priced.
  const pricing = { currency: 'CNY', unit: 'per_1m_tokens', table: { input: 1, output: 2 } }
  const [merged] = registry.mergeOverrides([gpt], [{ modelId: 'gaorui:gpt-5.5', enabled: false, sort: 7, label: 'Renamed', pricing }])
  assert.deepEqual([merged.enabled, merged.sort, merged.label, merged.pricing], [false, 7, 'Renamed', pricing])
})

test('catalogs: the provider docs name every catalog model, in both languages', () => {
  for (const file of ['providers.md', 'providers.zh-CN.md']) {
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', file), 'utf8')
    for (const vendor of VENDORS) {
      for (const m of loadCatalog(vendor)) assert.ok(text.includes('`' + m.id + '`'), `docs/${file} does not list ${vendor} model ${m.id}`)
    }
  }
})

test('catalogs: "verified" is the day a model was really run, and is only ever on catalog models that were', () => {
  const day = (vendor) => Object.fromEntries(loadCatalog(vendor).map((m) => [m.id, m.verified]))
  // Every 高瑞 entry completed a real run on 2026-10-10 (catalog/SOURCES.md says which). Adding a model does not add a date.
  assert.deepEqual(Object.entries(day('gaorui')).filter(([, d]) => d !== '2026-10-10'), [])
  // Nothing of OpenAI or Gemini has been run against the real API.
  for (const vendor of ['openai', 'gemini']) assert.deepEqual(Object.values(day(vendor)).filter(Boolean), [], vendor)

  // Served with the vendor's model list and with an instance's models...
  const vendors = registry.listVendors('en')
  assert.equal(vendors.find((v) => v.type === 'gaorui').models.find((m) => m.model === 'veo-3.1').verified, '2026-10-10')
  assert.equal(vendors.find((v) => v.type === 'openai').models.some((m) => 'verified' in m), false)
  const instance = { id: '1', slug: 'gaorui', name: '', type: 'gaorui' }
  const [spec] = registry.buildSpecs(instance, [loadCatalog('gaorui').find((m) => m.id === 'omni-flash')])
  assert.equal(spec.verified, '2026-10-10')
  // ...and never for a custom model, whatever its stored row says.
  const [custom] = registry.buildSpecs(instance, [{ id: 'mine', kind: 'chat', custom: true, verified: '2026-10-10' }])
  assert.equal('verified' in custom, false)
})

test('catalogs: the validator refuses anything half-declared', () => {
  const ok = { id: 'm', label: 'M', acceptsImage: true, acceptsVideo: false, videoEdit: false, maxReferenceImages: 2, options: { aspectRatios: ['1:1'] }, defaults: { aspectRatio: '1:1' } }
  const wrap = (entry, kind = 'image') => ({ image: [], video: [], chat: [], [kind]: [entry] })
  assert.deepEqual(validateCatalog('t', wrap(ok)), [{ ...ok, kind: 'image' }])
  const bad = [
    [{ image: [], video: [] }, /section "chat" is missing/],
    [{ image: [], video: [], chat: [], audio: [] }, /unknown section "audio"/],
    [wrap({ ...ok, kind: 'video' }), /the section decides the kind/],
    [wrap({ ...ok, id: 'has space' }), /bad model id/],
    [{ image: [ok, ok], video: [], chat: [] }, /listed twice/],
    [{ image: [ok], video: [], chat: [ok] }, /listed twice/],
    [wrap({ ...ok, label: '' }), /label is required/],
    [wrap({ ...ok, acceptsVideo: undefined }), /acceptsVideo must be true or false/],
    [wrap({ ...ok, maxReferenceImages: 0 }), /disagree/],
    [wrap({ ...ok, videoEdit: true }), /videoEdit needs a video model/],
    [wrap({ ...ok, options: { ratios: ['1:1'] } }), /unknown option "ratios"/],
    [wrap({ ...ok, options: { durations: ['5'] }, defaults: {} }), /list of numbers/],
    [wrap({ ...ok, defaults: { aspectRatio: '16:9' } }), /not one of options.aspectRatios/],
    [wrap({ ...ok, defaults: { resolution: '1K' } }), /not one of options.resolutions/],
    [wrap({ ...ok, pricing: {} }), /unknown field "pricing"/],
    [wrap({ ...ok, verified: true }), /verified must be a date/],
    [wrap({ ...ok, verified: '2026-13-01' }), /verified must be a date/],
    [wrap({ ...ok, verified: '10/10/2026' }), /verified must be a date/],
    [wrap({ ...ok, imageByUrlOnly: false }), /imageByUrlOnly is either true/],
    [wrap({ ...ok, acceptsImage: false, maxReferenceImages: 0, imageByUrlOnly: true }), /imageByUrlOnly is either true/],
  ]
  for (const [data, message] of bad) assert.throws(() => validateCatalog('t', data), message)
  // Private fields are for the vendor module and pass through.
  assert.equal(validateCatalog('t', wrap({ ...ok, _protocol: 'x' }))[0]._protocol, 'x')
})

test('no kind is inferred from a name: a custom model is exactly the kind it was given', () => {
  // Names that the old rules would have classified one way or the other.
  const names = ['gpt-image-chat', 'veo-video-banana', 'text-embedding-flux', 'sora-2', 'plain']
  for (const vendor of VENDORS) {
    const plugin = registry.getType(vendor)
    assert.equal(plugin.listModels, undefined, `${vendor}: nothing lists models from an upstream`)
    for (const kind of plugin.customKinds) {
      const doc = { _id: 'p1', slug: 's', name: 'n', type: vendor, customModels: names.map((id) => ({ id, kind, label: '' })) }
      const specs = registry.specsForInstance(doc)
      assert.equal(specs.length, plugin.catalog.length + names.length)
      for (const id of names) {
        const spec = specs.find((s) => s.id === `s:${id}`)
        assert.deepEqual([spec.kind, spec.custom, spec.label], [kind, true, id], `${vendor} ${kind} ${id}`)
      }
    }
    // Catalog models keep the kind of their section, custom or not.
    for (const s of registry.specsForInstance({ _id: 'p1', slug: 's', name: 'n', type: vendor, customModels: [] })) {
      assert.equal(s.kind, plugin.catalog.find((m) => `s:${m.id}` === s.id).kind)
      assert.equal(s.custom, false)
    }
  }
})

test('no kind inference remains in the source: no name patterns outside the migration', () => {
  const files = [
    ...fs.readdirSync(path.join(SRC, 'providers')).filter((f) => f.endsWith('.js')).map((f) => path.join(SRC, 'providers', f)),
    path.join(SRC, 'providers', 'catalog', 'index.js'),
    path.join(SRC, 'routes', 'admin.js'),
    path.join(SRC, 'runner', 'index.js'),
  ]
  // A regex literal that mentions model families is the signature of a name rule.
  const NAME_RULE = /\/[^/\n]*\b(image|banana|imagen|dall-e|flux|embedding|whisper|veo|sora|chat)\b[^/\n]*\/[gimsuy]*\s*\.test\(/
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    assert.equal(NAME_RULE.test(text), false, `${path.basename(file)} tests a model name against a pattern`)
    for (const gone of ['NOT_CHAT', 'IMAGE_NAME', 'NOT_GENERATIVE', 'isImageModel', 'parseModelList']) {
      assert.equal(text.includes(gone), false, `${path.basename(file)} still has ${gone}`)
    }
  }
  // The check above does catch the retired rule where it is allowed to live.
  assert.equal(NAME_RULE.test(fs.readFileSync(path.join(SRC, 'services', 'providerMigration.js'), 'utf8')), true)
})

test('custom models: validation per vendor', () => {
  const check = (vendor, input) => registry.checkCustomModel(registry.getType(vendor), input)
  const code = (fn) => { try { fn() } catch (e) { return e.i18n && e.i18n.code } return null }
  assert.deepEqual(check('openai', { id: ' my-model ', kind: 'chat', label: '  Mine ' }), { id: 'my-model', kind: 'chat', label: 'Mine' })
  assert.deepEqual(check('gaorui', { id: 'org/model:tag@v1.2', kind: 'image' }), { id: 'org/model:tag@v1.2', kind: 'image', label: '' })
  assert.equal(code(() => check('openai', { id: '', kind: 'chat' })), 'provider.custom_name_required')
  assert.equal(code(() => check('openai', { id: 'has space', kind: 'chat' })), 'provider.custom_bad_name')
  assert.equal(code(() => check('openai', { id: 'x'.repeat(121), kind: 'chat' })), 'provider.custom_bad_name')
  assert.equal(code(() => check('openai', { id: 'm' })), 'provider.custom_kind_required', 'the kind is never defaulted')
  assert.equal(code(() => check('openai', { id: 'm', kind: 'audio' })), 'provider.custom_kind_required')
  for (const vendor of VENDORS) {
    assert.equal(code(() => check(vendor, { id: 'm', kind: 'video' })), 'provider.custom_kind_unsupported', `${vendor}: no custom video models`)
    const first = registry.getType(vendor).catalog[0]
    assert.equal(code(() => check(vendor, { id: first.id, kind: 'chat' })), 'provider.custom_in_catalog', 'a catalog model cannot be shadowed')
  }
  assert.equal(code(() => check('openai', { id: 'm', kind: 'chat', label: 5 })), 'validation.string')
  // A stored entry that shadows the catalog (hand-edited row) is ignored, not served twice.
  const specs = registry.specsForInstance({ _id: 'p', slug: 's', name: '', type: 'gaorui', customModels: [{ id: 'nano-banana-2', kind: 'chat' }, { id: 'v', kind: 'video' }, { id: 'ok', kind: 'chat' }, { id: 'ok', kind: 'image' }] })
  assert.deepEqual(specs.filter((s) => s.custom).map((s) => [s.id, s.kind]), [['s:ok', 'chat']])
  assert.equal(specs.find((s) => s.id === 's:nano-banana-2').kind, 'image')
})

test('custom models: what each vendor gives one', () => {
  const caps = (vendor, kind) => {
    const { options, maxReferenceImages, acceptsImage, acceptsVideo } = registry.listVendors('en').find((v) => v.type === vendor).customDefaults[kind]
    return { options, maxReferenceImages, acceptsImage, acceptsVideo }
  }
  assert.deepEqual(caps('gaorui', 'image'), {
    options: { aspectRatios: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '16:9', '9:16', '21:9'], resolutions: ['1K', '2K', '4K'] },
    maxReferenceImages: 8, acceptsImage: true, acceptsVideo: false,
  })
  assert.deepEqual(caps('gaorui', 'chat'), { options: {}, maxReferenceImages: 8, acceptsImage: true, acceptsVideo: true })
  assert.deepEqual(caps('openai', 'image'), { options: { aspectRatios: ['auto', '1:1', '3:2', '2:3'], counts: [1, 2, 3, 4] }, maxReferenceImages: 16, acceptsImage: true, acceptsVideo: false })
  assert.deepEqual(caps('openai', 'chat'), { options: {}, maxReferenceImages: 8, acceptsImage: true, acceptsVideo: false })
  assert.deepEqual(caps('gemini', 'image'), {
    options: { aspectRatios: ['auto', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] },
    maxReferenceImages: 8, acceptsImage: true, acceptsVideo: false,
  })
  assert.deepEqual(caps('gemini', 'chat'), { options: {}, maxReferenceImages: 8, acceptsImage: true, acceptsVideo: false })
})

test('migration plan: the old type is renamed and typed lists become custom models', () => {
  const openai = plan({ type: 'openai-compatible', slug: 'openai-compatible', name: 'Relay', options: { models: 'my-old-llm, my-llm, gpt-6-luna, gpt-4o-mini, shared', imageModels: 'my-image\nshared' } }, [{ id: 'from-history', kind: 'chat' }])
  assert.deepEqual(openai.set, { type: 'openai', schemaVersion: 3 }, 'no slug in the update: model ids stay as they are')
  assert.deepEqual(openai.customModels, [
    { id: 'my-image', kind: 'image', label: '' },
    { id: 'shared', kind: 'image', label: '' },
    { id: 'my-old-llm', kind: 'chat', label: '' },
    { id: 'my-llm', kind: 'chat', label: '' },
  ], 'the two fields said the kind; a catalog model (gpt-6-luna, gpt-4o-mini) needs no entry; a typed list is not topped up from history')

  // Gemini had one field for both kinds: the retired name rule is applied here one last time.
  const gemini = plan({ type: 'gemini', slug: 'gemini', name: 'G', options: { models: 'gemini-nano-banana-2.1, my-image-model, my-banana, gemini-2.5-pro' } }, [])
  assert.deepEqual(gemini.customModels, [
    { id: 'my-image-model', kind: 'image', label: '' },
    { id: 'my-banana', kind: 'image', label: '' },
    { id: 'gemini-2.5-pro', kind: 'chat', label: '' },
  ])
  assert.equal(gemini.set.type, 'gemini')
})

test('migration plan: where the list used to be fetched, models in use are recovered with their recorded kind', () => {
  const used = [
    { id: 'gpt-4o-mini', kind: 'chat' },
    { id: 'nano-banana-2', kind: 'image' },
    { id: 'some-image-model', kind: 'chat' },
    { id: 'gpt-4o-mini', kind: 'chat' },
    { id: 'old-video', kind: 'video' },
    { id: 'bad name', kind: 'chat' },
  ]
  const gaorui = plan({ type: 'gaorui', slug: 'gaorui', name: '\u9ad8\u777f API', options: {} }, used)
  assert.deepEqual(gaorui.customModels, [
    { id: 'gpt-4o-mini', kind: 'chat', label: '' },
    { id: 'some-image-model', kind: 'chat', label: '' },
  ], 'catalog models, kinds the vendor cannot take and bad names are left out; the kind is the recorded one')
  assert.equal(gaorui.set.name, '高瑞', 'the brand spelling is corrected, and the old default name becomes the default of today')

  const emptyOpenai = plan({ type: 'openai-compatible', slug: 'x', name: 'n', options: { models: '', imageModels: '' } }, used)
  assert.deepEqual(emptyOpenai.customModels.map((m) => m.id), ['nano-banana-2', 'some-image-model'], 'gpt-4o-mini is in the OpenAI catalog')
  // Custom models already on the row are kept, and nothing is added twice.
  const again = plan({ type: 'gaorui', slug: 'gaorui', name: 'n', customModels: [{ id: 'gpt-4o-mini', kind: 'image', label: 'Mine' }] }, used)
  assert.deepEqual(again.customModels[0], { id: 'gpt-4o-mini', kind: 'image', label: 'Mine' })
  assert.equal(again.customModels.filter((m) => m.id === 'gpt-4o-mini').length, 1)
  // An unknown type is marked done and otherwise left alone.
  assert.deepEqual(plan({ type: 'mystery', slug: 'm', name: 'n' }, used), { set: { type: 'mystery', schemaVersion: 3 }, customModels: null })
  assert.deepEqual(parseModelList('a,a , b'), ['a', 'b'])
})

test('migration plan: the old default name of a 高瑞 provider becomes the vendor name, any other name stays', () => {
  const OLD = '\u9ad8\u777f'
  const name = (doc) => plan({ type: 'gaorui', slug: 'gaorui', ...doc }, []).set.name
  // From the version before the vendor model (no schemaVersion): old default, with either spelling.
  assert.equal(name({ name: '高瑞 API' }), '高瑞')
  assert.equal(name({ name: `${OLD} API` }), '高瑞')
  assert.equal(name({ name: 'Gaorui API' }), 'Gaorui', 'the old default where the provider was added in English')
  // Exactly the old default, nothing looser.
  for (const kept of ['高瑞', 'Gaorui', '高瑞 API 2', '高瑞 API（备用）', '高瑞API', ' 高瑞 API', 'gaorui api', '我的中转', '']) {
    assert.equal(name({ name: kept }), undefined, JSON.stringify(kept))
  }
  assert.equal(name({ name: `${OLD} API（备用）` }), '高瑞 API（备用）', 'only the spelling is corrected in a name the user chose')
  // Only for this vendor: another vendor's provider may be called anything.
  assert.equal(plan({ type: 'openai', slug: 'o', name: '高瑞 API' }, []).set.name, undefined)
  assert.equal(plan({ type: 'openai-compatible', slug: 'o', name: 'Gaorui API' }, []).set.name, undefined)

  // Version 2 (written by a build that already had the vendor model): the name is all that changes.
  const used = [{ id: 'from-history', kind: 'chat' }]
  assert.deepEqual(plan({ type: 'gaorui', slug: 'gaorui', name: '高瑞 API', schemaVersion: 2, customModels: [{ id: 'fake-chat-1', kind: 'chat', label: '' }] }, used),
    { set: { schemaVersion: 3, name: '高瑞' }, customModels: null }, 'custom models are not rebuilt, nothing is recovered from history again')
  assert.deepEqual(plan({ type: 'gaorui', slug: 'gaorui-2', name: '备用 Key', schemaVersion: 2 }, used), { set: { schemaVersion: 3 }, customModels: null })
  assert.deepEqual(plan({ type: 'openai', slug: 'openai', name: 'OpenAI', schemaVersion: 2 }, used), { set: { schemaVersion: 3 }, customModels: null })
})
