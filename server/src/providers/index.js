'use strict'

/**
 * Provider registry.
 *
 * A provider TYPE is a plugin module (gaorui.js, openaiCompatible.js, ...).
 * A provider INSTANCE is a row in `providers`: a type plus the user's base URL
 * and key. The registry turns instances into the public model list:
 *
 *   plugin.listModels(cfg)  ->  raw specs (ids local to the provider)
 *   + instance              ->  id "<slug>:<model>", providerId
 *   + ModelOverride         ->  enabled / label / sort / defaults / pricing
 */
const Provider = require('../models/Provider')
const ModelOverride = require('../models/ModelOverride')
const { getConfig } = require('../config')
const { decrypt } = require('../utils/crypto')
const { ApiError } = require('../utils/http')
const { LocalizedError, has, t } = require('../i18n')
const { LOCAL_USER } = require('../constants')

const TYPES = new Map()
const REQUIRED_FUNCTIONS = ['listModels', 'test', 'submit', 'poll', 'chat']

function register(plugin) {
  if (!plugin || typeof plugin.type !== 'string' || !/^[a-z0-9-]+$/.test(plugin.type)) {
    throw new Error('provider plugin needs a lowercase `type`')
  }
  for (const fn of REQUIRED_FUNCTIONS) {
    if (typeof plugin[fn] !== 'function') throw new Error(`provider "${plugin.type}" is missing ${fn}()`)
  }
  if (!Array.isArray(plugin.fields)) throw new Error(`provider "${plugin.type}" needs a fields array`)
  TYPES.set(plugin.type, plugin)
}

register(require('./gaorui'))
register(require('./openaiCompatible'))
register(require('./gemini'))

function getType(type) {
  return TYPES.get(type) || null
}

/** First of the catalog keys that exists, rendered; otherwise the plugin's own text. */
function localized(locale, keys, own) {
  const key = keys.find(has)
  return key ? t(locale, key) : (own || '')
}

/**
 * Display names of a plugin and its form fields. The catalog is looked up by
 * stable identifiers - `provider.<type>.label`, `provider.<type>.field.<key>.label|help`,
 * then `provider.field.<key>.label` shared by all types - so a plugin without
 * catalog entries simply shows the text it declares.
 */
function typeLabel(plugin, locale) {
  return localized(locale, [`provider.${plugin.type}.label`], plugin.label)
}

function fieldText(plugin, field, part, locale) {
  return localized(locale, [`provider.${plugin.type}.field.${field.key}.${part}`, `provider.field.${field.key}.${part}`], field[part])
}

/** What the settings page needs to render the "add provider" form. */
function listTypes(locale) {
  return [...TYPES.values()].map((p) => ({
    type: p.type,
    label: typeLabel(p, locale),
    defaultBaseUrl: p.defaultBaseUrl || '',
    fields: p.fields.map((f) => ({
      key: f.key,
      label: fieldText(p, f, 'label', locale),
      type: f.type || (f.secret ? 'password' : 'text'),
      secret: !!f.secret,
      required: !!f.required,
      placeholder: f.placeholder || '',
      help: fieldText(p, f, 'help', locale),
    })),
  }))
}

/**
 * A ModelSpec with its one-line description in the reader's language, for the
 * built-in models that have one in the catalog (`model.<type>.<model>.desc`).
 */
function localizeSpec(spec, locale) {
  const parts = spec && splitModelId(spec.id)
  const key = parts ? `model.${spec.providerType}.${parts.model}.desc` : ''
  return has(key) ? { ...spec, desc: t(locale, key) } : spec
}

const KINDS = new Set(['image', 'video', 'chat'])
const strings = (v, max) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length <= 20).slice(0, max) : undefined)
const numbers = (v, max) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, max) : undefined)

/**
 * Raw plugin specs -> public ModelSpecs for one instance. Pure.
 * Drops malformed entries and private (underscore) fields.
 */
function buildSpecs(instance, rawSpecs) {
  const out = []
  const seen = new Set()
  for (const raw of Array.isArray(rawSpecs) ? rawSpecs : []) {
    if (!raw || typeof raw.id !== 'string' || !raw.id || !KINDS.has(raw.kind)) continue
    const id = `${instance.slug}:${raw.id}`
    if (seen.has(id)) continue
    seen.add(id)
    const o = raw.options && typeof raw.options === 'object' ? raw.options : {}
    const options = {}
    if (strings(o.aspectRatios, 30)) options.aspectRatios = strings(o.aspectRatios, 30)
    if (strings(o.resolutions, 20)) options.resolutions = strings(o.resolutions, 20)
    if (numbers(o.durations, 30)) options.durations = numbers(o.durations, 30)
    if (numbers(o.counts, 10)) options.counts = numbers(o.counts, 10)
    // Image input modes: "multi" (reference images) / "frames" (first + last frame).
    if (strings(o.imgModes, 5)) options.imgModes = strings(o.imgModes, 5)
    const spec = {
      id,
      providerId: String(instance.id),
      providerName: instance.name || '',
      providerType: instance.type || '',
      label: String(raw.label || raw.id),
      kind: raw.kind,
      acceptsImage: !!raw.acceptsImage,
      acceptsVideo: !!raw.acceptsVideo,
      videoEdit: !!raw.videoEdit,
      maxReferenceImages: Number.isInteger(raw.maxReferenceImages) ? raw.maxReferenceImages : 0,
      options,
      defaults: raw.defaults && typeof raw.defaults === 'object' ? { ...raw.defaults } : {},
    }
    if (raw.desc) spec.desc = String(raw.desc)
    if (raw.tag) spec.tag = String(raw.tag)
    if (raw.pricing && typeof raw.pricing === 'object') spec.pricing = { ...raw.pricing }
    out.push(spec)
  }
  return out
}

/**
 * Layer admin overrides over specs. Pure.
 * Each result carries `enabled` and `sort`; order is sort, then declaration order.
 */
function mergeOverrides(specs, overrides) {
  const byId = new Map((overrides || []).map((o) => [o.modelId, o]))
  const merged = specs.map((spec, index) => {
    const o = byId.get(spec.id)
    const out = { ...spec, enabled: true, sort: 0 }
    if (o) {
      if (typeof o.enabled === 'boolean') out.enabled = o.enabled
      if (typeof o.label === 'string' && o.label.trim()) out.label = o.label.trim()
      if (typeof o.sort === 'number' && Number.isFinite(o.sort)) out.sort = o.sort
      if (o.defaults && typeof o.defaults === 'object') out.defaults = { ...spec.defaults, ...o.defaults }
      // null removes a declared price; an object replaces it entirely.
      if (o.pricing === null) delete out.pricing
      else if (o.pricing && typeof o.pricing === 'object') out.pricing = o.pricing
    }
    return { out, index }
  })
  merged.sort((a, b) => (a.out.sort - b.out.sort) || (a.index - b.index))
  return merged.map((m) => m.out)
}

/** Split "<slug>:<model>" at the first colon (model ids may contain colons). */
function splitModelId(fullId) {
  const s = String(fullId || '')
  const i = s.indexOf(':')
  if (i <= 0 || i === s.length - 1) return null
  return { slug: s.slice(0, i), model: s.slice(i + 1) }
}

/* ---------------------------------------------------------------- database */

const CACHE_TTL_MS = 5 * 60 * 1000
const LIST_TIMEOUT_MS = 12 * 1000
const cache = new Map() // providerId -> { at, specs }

function invalidate(providerId) {
  if (providerId) cache.delete(String(providerId))
  else cache.clear()
}

/** Plugin config for an instance, with the key decrypted. Needs apiKeyEnc selected. */
function configFor(doc) {
  const plugin = getType(doc.type)
  let apiKey = ''
  if (doc.apiKeyEnc) {
    try {
      apiKey = decrypt(doc.apiKeyEnc, getConfig().secretKey)
    } catch {
      throw new LocalizedError('provider.key_undecryptable')
    }
  }
  return {
    ...(doc.options && typeof doc.options === 'object' ? doc.options : {}),
    baseUrl: doc.baseUrl || (plugin && plugin.defaultBaseUrl) || '',
    apiKey,
  }
}

async function loadInstances({ enabledOnly }) {
  const filter = { userId: LOCAL_USER }
  if (enabledOnly) filter.enabled = true
  return Provider.find(filter).select('+apiKeyEnc').sort({ sort: 1, createdAt: 1 }).lean()
}

async function specsForInstance(doc) {
  const key = String(doc._id)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.specs
  const plugin = getType(doc.type)
  if (!plugin) return []
  const instance = { id: key, slug: doc.slug, name: doc.name, type: doc.type }
  let raw
  try {
    raw = await plugin.listModels(configFor(doc), { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
  } catch (err) {
    // Keep serving the last good list rather than emptying the model picker
    // because the upstream had a bad minute.
    if (hit) return hit.specs
    console.warn(`[providers] listModels failed for "${doc.name}": ${err && err.message}`)
    return []
  }
  const specs = buildSpecs(instance, raw)
  cache.set(key, { at: Date.now(), specs })
  return specs
}

/**
 * All models across instances, merged with overrides.
 * @param {{ includeDisabled?: boolean, kind?: string }} opts
 */
async function listModels({ includeDisabled = false, kind } = {}) {
  const [instances, overrides] = await Promise.all([
    loadInstances({ enabledOnly: !includeDisabled }),
    ModelOverride.find({ userId: LOCAL_USER }).lean(),
  ])
  const lists = await Promise.all(instances.map(async (doc) => {
    const specs = await specsForInstance(doc)
    return specs.map((s) => ({ ...s, providerEnabled: doc.enabled !== false }))
  }))
  let models = mergeOverrides(lists.flat(), overrides)
  if (kind) models = models.filter((m) => m.kind === kind)
  if (!includeDisabled) models = models.filter((m) => m.enabled && m.providerEnabled)
  return models
}

/**
 * Everything needed to run one model. Throws a user-facing error when the
 * model, its provider or its key is not usable.
 */
async function resolveModel(fullId, { requireEnabled = true } = {}) {
  const fail = (key, params) => new ApiError(400, key, params)
  const parts = splitModelId(fullId)
  if (!parts) throw fail('model.bad_id')
  const doc = await Provider.findOne({ userId: LOCAL_USER, slug: parts.slug }).select('+apiKeyEnc').lean()
  if (!doc) throw fail('model.provider_missing')
  if (requireEnabled && doc.enabled === false) throw fail('model.provider_disabled')
  const plugin = getType(doc.type)
  if (!plugin) throw fail('provider.type_unsupported_named', { type: doc.type })
  const specs = await specsForInstance(doc)
  const override = await ModelOverride.findOne({ modelId: fullId }).lean()
  const base = specs.find((s) => s.id === fullId) || null
  const spec = base ? mergeOverrides([base], override ? [override] : [])[0] : null
  if (requireEnabled && spec && !spec.enabled) throw fail('model.disabled')
  return { doc, plugin, cfg: configFor(doc), spec, model: parts.model }
}

module.exports = {
  register,
  getType,
  listTypes,
  typeLabel,
  localizeSpec,
  buildSpecs,
  mergeOverrides,
  splitModelId,
  configFor,
  listModels,
  resolveModel,
  invalidate,
}
