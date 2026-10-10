'use strict'

/**
 * Vendor registry.
 *
 * A VENDOR is a module (gaorui.js, openai.js, gemini.js): how to talk to one
 * company's API, plus a catalog stating which models it supports.
 * A provider INSTANCE is a row in `providers`: a vendor plus the user's key,
 * optionally another address, and the custom models the user added by hand.
 *
 * The model list of an instance is never fetched and never inferred:
 *
 *   vendor catalog  +  instance.customModels   ->  raw specs
 *   + instance                                 ->  id "<slug>:<model>", providerId
 *   + ModelOverride                            ->  enabled / label / sort / defaults / pricing
 */
const Provider = require('../models/Provider')
const ModelOverride = require('../models/ModelOverride')
const { getConfig } = require('../config')
const { decrypt } = require('../utils/crypto')
const { ApiError } = require('../utils/http')
const { LocalizedError, has, t } = require('../i18n')
const { LOCAL_USER } = require('../constants')
const { KINDS: KIND_LIST, MODEL_NAME } = require('./catalog')

const VENDORS = new Map()
const REQUIRED_FUNCTIONS = ['customSpec', 'test', 'submit', 'poll', 'chat']

function register(plugin) {
  if (!plugin || typeof plugin.type !== 'string' || !/^[a-z0-9-]+$/.test(plugin.type)) {
    throw new Error('vendor module needs a lowercase `type`')
  }
  for (const fn of REQUIRED_FUNCTIONS) {
    if (typeof plugin[fn] !== 'function') throw new Error(`vendor "${plugin.type}" is missing ${fn}()`)
  }
  if (!Array.isArray(plugin.catalog)) throw new Error(`vendor "${plugin.type}" needs a catalog`)
  if (!Array.isArray(plugin.customKinds) || plugin.customKinds.some((k) => !KIND_LIST.includes(k) || !plugin.customSpec(k))) {
    throw new Error(`vendor "${plugin.type}" needs customKinds, each with a customSpec()`)
  }
  VENDORS.set(plugin.type, plugin)
}

// Registration order is display order: the built-in vendor first.
register(require('./gaorui'))
register(require('./openai'))
register(require('./gemini'))

function getType(type) {
  return VENDORS.get(type) || null
}

/** The vendor's name in the reader's language (`provider.<vendor>.label`), else as declared. */
function typeLabel(plugin, locale) {
  const key = `provider.${plugin.type}.label`
  return has(key) ? t(locale, key) : (plugin.label || plugin.type)
}

/** The part of a raw spec that describes the model itself, with private fields dropped. */
function describe(raw, vendor, locale) {
  const [spec] = buildSpecs({ id: '', slug: '_', name: '', type: vendor }, [raw])
  const { id, providerId, providerName, providerType, ...rest } = localizeSpec(spec, locale)
  return { ...rest, model: raw.id }
}

/**
 * What the settings page needs to offer a vendor: its name, official address,
 * every model it supports, and what a custom model of each allowed kind gets.
 */
function listVendors(locale) {
  return [...VENDORS.values()].map((p) => ({
    type: p.type,
    label: typeLabel(p, locale),
    recommended: p.recommended === true,
    keyUrl: p.keyUrl || '',
    defaultBaseUrl: p.defaultBaseUrl || '',
    models: p.catalog.map((m) => describe(m, p.type, locale)),
    customKinds: [...p.customKinds],
    customDefaults: Object.fromEntries(p.customKinds.map((kind) => {
      const { model, label, ...caps } = describe({ ...p.customSpec(kind), id: 'x', kind, custom: true }, p.type, locale)
      return [kind, caps]
    })),
  }))
}

/**
 * A ModelSpec with its one-line description in the reader's language, for the
 * catalog models that have one (`model.<vendor>.<model>.desc`).
 */
function localizeSpec(spec, locale) {
  const parts = spec && splitModelId(spec.id)
  const key = parts && !spec.custom ? `model.${spec.providerType}.${parts.model}.desc` : ''
  return has(key) ? { ...spec, desc: t(locale, key) } : spec
}

const KINDS = new Set(KIND_LIST)
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
      // Added by the user rather than taken from the vendor's catalog.
      custom: raw.custom === true,
      maxReferenceImages: Number.isInteger(raw.maxReferenceImages) ? raw.maxReferenceImages : 0,
      options,
      defaults: raw.defaults && typeof raw.defaults === 'object' ? { ...raw.defaults } : {},
    }
    // Reference images go to the upstream as public URLs only (see catalog/index.js).
    if (raw.imageByUrlOnly === true && spec.acceptsImage) spec.imageByUrlOnly = true
    // Catalog entries only: the day the project ran this model against the real service.
    if (!spec.custom && typeof raw.verified === 'string' && raw.verified) spec.verified = raw.verified
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

/* ------------------------------------------------------------- instances */

/**
 * Check one custom model against its vendor. Returns the stored form, or
 * throws an ApiError (400) naming what is wrong.
 */
function checkCustomModel(plugin, input) {
  const fail = (key, params) => new ApiError(400, key, params)
  const id = typeof input.id === 'string' ? input.id.trim() : ''
  if (!id) throw fail('provider.custom_name_required')
  if (!MODEL_NAME.test(id)) throw fail('provider.custom_bad_name')
  if (!KIND_LIST.includes(input.kind)) throw fail('provider.custom_kind_required')
  if (!plugin.customKinds.includes(input.kind)) throw fail('provider.custom_kind_unsupported', { kind: input.kind })
  if (plugin.catalog.some((m) => m.id === id)) throw fail('provider.custom_in_catalog', { model: id })
  if (input.label !== undefined && input.label !== null && typeof input.label !== 'string') throw fail('validation.string', { field: 'label' })
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 80) : ''
  return { id, kind: input.kind, label }
}

/** Raw specs of one instance: the vendor's catalog, then the instance's custom models. */
function rawSpecsFor(doc) {
  const plugin = getType(doc.type)
  if (!plugin) return []
  const taken = new Set(plugin.catalog.map((m) => m.id))
  const custom = []
  for (const c of Array.isArray(doc.customModels) ? doc.customModels : []) {
    // Stored entries were checked on the way in; this guards hand-edited rows.
    if (!c || typeof c.id !== 'string' || taken.has(c.id) || !plugin.customKinds.includes(c.kind)) continue
    taken.add(c.id)
    custom.push({ ...plugin.customSpec(c.kind), id: c.id, kind: c.kind, label: c.label || c.id, custom: true })
  }
  return [...plugin.catalog, ...custom]
}

function specsForInstance(doc) {
  return buildSpecs({ id: String(doc._id), slug: doc.slug, name: doc.name, type: doc.type }, rawSpecsFor(doc))
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
  return { baseUrl: doc.baseUrl || (plugin && plugin.defaultBaseUrl) || '', apiKey }
}

async function loadInstances({ enabledOnly }) {
  const filter = { userId: LOCAL_USER }
  if (enabledOnly) filter.enabled = true
  return Provider.find(filter).select('+apiKeyEnc').sort({ sort: 1, createdAt: 1 }).lean()
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
  const lists = instances.map((doc) => specsForInstance(doc).map((s) => ({ ...s, providerEnabled: doc.enabled !== false })))
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
  const specs = specsForInstance(doc)
  const override = await ModelOverride.findOne({ modelId: fullId }).lean()
  const base = specs.find((s) => s.id === fullId) || null
  const spec = base ? mergeOverrides([base], override ? [override] : [])[0] : null
  if (requireEnabled && spec && !spec.enabled) throw fail('model.disabled')
  return { doc, plugin, cfg: configFor(doc), spec, model: parts.model }
}

module.exports = {
  register,
  getType,
  listVendors,
  typeLabel,
  localizeSpec,
  buildSpecs,
  mergeOverrides,
  splitModelId,
  checkCustomModel,
  specsForInstance,
  configFor,
  listModels,
  resolveModel,
}
