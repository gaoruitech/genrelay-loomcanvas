'use strict'

/**
 * Settings page backend (contract section 5). Two kinds of thing live under
 * /api/admin:
 *
 *  - per space, for every signed-in user: vendors, providers and their keys,
 *    custom models, model overrides (enabled, order, price) and usage. Each
 *    query below carries the id of the space the request acts in (the
 *    caller's personal space, or a team named by X-Space); a row of another
 *    space is a 404. In a team only the owner and admins change any of it,
 *    and nobody else is shown a key's last characters or a provider's address.
 *  - the site, for the owner only: settings (appearance, limits, retention)
 *    and storage. Those routes carry `requireOwner`; accounts and registration
 *    are in adminUsers.js.
 */
const express = require('express')
const Provider = require('../models/Provider')
const ModelOverride = require('../models/ModelOverride')
const Run = require('../models/Run')
const Workflow = require('../models/Workflow')
const registry = require('../providers')
const settings = require('../services/settings')
const storageSettings = require('../services/storageSettings')
const { getConfig } = require('../config')
const { encrypt, keyTail } = require('../utils/crypto')
const { normalizePricing } = require('../runner/pricing')
const { ok, wrap, badRequest, notFound, ApiError } = require('../utils/http')
const { requireObjectId, isPlainObject, pageParams, parseDate, parseTimeZone, parseDayOrInstant, text, escapeRegExp } = require('../utils/validate')
const { t, render, messageOf, renderStored, storedError, isMessage, msg, RAW } = require('../i18n')
const { requireOwner } = require('../middleware/auth')
const spaces = require('../services/spaces')
const permissions = require('../services/permissions')
const activity = require('../services/activity')
const budget = require('../services/budget')
const { RUN_KINDS, RUN_STATUS } = require('../constants')

const router = express.Router()

const MAX_PROVIDERS = 50
const MAX_CUSTOM_MODELS = 100
const TEST_TIMEOUT_MS = 20 * 1000

/* ------------------------------------------------------------ providers */

/** Team spaces: write one entry of the activity log. Nothing happens in a personal space. */
function logActivity(req, type, target, detail) {
  if (!spaces.isTeam(req)) return null
  return activity.record(req.spaceId, { id: req.userId, name: req.user.username }, type, target, detail)
}

const providerTarget = (doc) => ({ type: 'provider', id: doc._id, name: doc.name })

/**
 * Never includes the key: only whether one is set and its last four characters.
 * `restricted` (a team member who does not manage providers): not even those,
 * and not the address the key is sent to.
 */
function serializeProvider(doc, { restricted = false, names = null, locale = '', keyUnreadable = false } = {}) {
  const plugin = registry.getType(doc.type)
  // Who to ask about this provider: whoever changed it last (before that was kept: who entered
  // the key, or who made it). A name, which everybody in the team may see.
  const maintainer = names ? spaces.personOf(names, maintainerIdOf(doc)) : null
  if (restricted) {
    return {
      maintainer,
      // The result of a connection test may quote the upstream: for those who manage providers only.
      lastTest: null,
      id: String(doc._id),
      type: doc.type,
      name: doc.name,
      slug: doc.slug,
      baseUrl: '',
      customBaseUrl: false,
      customModels: (doc.customModels || []).map((m) => ({ model: m.id, kind: m.kind, label: m.label || '' })),
      enabled: doc.enabled !== false,
      sort: doc.sort || 0,
      hasKey: !!doc.hasKey,
      keyTail: '',
      // The stored key cannot be decrypted (SECRET_KEY changed): unusable until it is entered again.
      keyUnreadable,
      restricted: true,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }
  }
  return {
    maintainer,
    lastTest: serializeLastTest(doc.lastTest, locale),
    id: String(doc._id),
    type: doc.type,
    name: doc.name,
    slug: doc.slug,
    // Empty in the database means "the vendor's official address".
    baseUrl: doc.baseUrl || (plugin && plugin.defaultBaseUrl) || '',
    customBaseUrl: !!doc.baseUrl && !!plugin && doc.baseUrl !== plugin.defaultBaseUrl,
    customModels: (doc.customModels || []).map((m) => ({ model: m.id, kind: m.kind, label: m.label || '' })),
    enabled: doc.enabled !== false,
    sort: doc.sort || 0,
    hasKey: !!doc.hasKey,
    keyTail: doc.keyTail || '',
    // The stored key cannot be decrypted (SECRET_KEY changed): unusable until it is entered again.
    keyUnreadable,
    restricted: false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

const maintainerIdOf = (doc) => doc.updatedBy || doc.keySetBy || permissions.creatorOf(doc)

/** `lastTest` as the API gives it: { ok, at, message } with the message in the reader's language, or null. */
function serializeLastTest(last, locale) {
  if (!last || !last.at) return null
  return { ok: !!last.ok, at: last.at, message: renderStored(locale, last) }
}

/** One provider or several as the caller may see them, with the people they name looked up once. */
async function presentProviders(req, docs) {
  const restricted = !permissions.can(req.space, 'provider:manage')
  const names = await spaces.people(docs.map(maintainerIdOf), spaces.isTeam(req) ? req.spaceId : '')
  // Whether each stored key can still be decrypted. Asked for separately: the key is not part of `docs`.
  const keyed = docs.length ? await Provider.find({ _id: { $in: docs.map((d) => d._id) }, userId: req.spaceId }).select('+apiKeyEnc').lean() : []
  const unreadable = new Set(keyed.filter((d) => registry.keyUnreadable(d)).map((d) => String(d._id)))
  return docs.map((doc) => serializeProvider(doc, { restricted, names, locale: req.locale, keyUnreadable: unreadable.has(String(doc._id)) }))
}
const presentProvider = async (req, doc) => (await presentProviders(req, [doc]))[0]

/** A price as an activity entry keeps it: enough to say "from X to Y", never the whole table. */
function priceSummary(pricing) {
  if (!pricing || typeof pricing !== 'object') return null
  const flat = []
  const walk = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) flat.push(v)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  const table = pricing.table && typeof pricing.table === 'object' ? pricing.table : null
  if (table) walk(table)
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    unit: String(pricing.unit || ''),
    currency: String(pricing.currency || ''),
    // One price for everything, or null when the price depends on something.
    price: table ? null : num(pricing.price),
    // What a price table is keyed by ('' = it is not one), how many prices it has, the lowest and the highest.
    by: String(pricing.by || ''),
    tiers: flat.length,
    min: flat.length ? Math.min(...flat) : null,
    max: flat.length ? Math.max(...flat) : null,
    // Per-token prices with separate rates: per million tokens in and out.
    input: table && !pricing.by ? num(table.input) : null,
    output: table && !pricing.by ? num(table.output) : null,
  }
}

/** Two addresses a key would be sent to: the same place, or not? Anything that differs counts. */
function sameAddress(a, b) {
  const norm = (v) => {
    try {
      const u = new URL(String(v || ''))
      return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`
    } catch {
      return String(v || '').trim().replace(/\/+$/, '')
    }
  }
  return norm(a) === norm(b)
}

function parseBaseUrl(v) {
  if (v === undefined || v === null || v === '') return ''
  if (typeof v !== 'string' || v.length > 500) throw badRequest('validation.bad_format', { field: 'baseUrl' })
  let u
  try { u = new URL(v.trim()) } catch { throw badRequest('validation.bad_url', { field: 'baseUrl' }) }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw badRequest('provider.base_url_scheme')
  if (u.username || u.password) throw badRequest('provider.base_url_credentials')
  return v.trim().replace(/\/+$/, '')
}

function parseApiKey(v) {
  if (typeof v !== 'string') throw badRequest('validation.string', { field: 'apiKey' })
  const key = v.trim()
  if (key.length > 4000 || /[\r\n]/.test(key)) throw badRequest('validation.bad_format', { field: 'apiKey' })
  return key
}

/** A slug no other provider of this space has. Other spaces' slugs do not matter. */
async function uniqueSlug(userId, wanted) {
  const base = wanted.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'provider'
  for (let i = 1; i <= MAX_PROVIDERS + 1; i++) {
    const slug = i === 1 ? base : `${base}-${i}`
    if (!(await Provider.exists({ userId, slug }))) return slug
  }
  throw new ApiError(409, 'provider.slug_exhausted')
}

/** GET /api/admin/vendors - every vendor with the models it supports */
router.get('/vendors', wrap(async (req, res) => {
  ok(res, registry.listVendors(req.locale))
}))

/** GET /api/admin/providers */
router.get('/providers', wrap(async (req, res) => {
  const list = await Provider.find({ userId: req.spaceId }).sort({ sort: 1, createdAt: 1 }).lean()
  ok(res, await presentProviders(req, list))
}))

const manageProviders = spaces.requireCan('provider:manage')

/** POST /api/admin/providers { type, apiKey, name?, baseUrl?, enabled? } - `type` is the vendor id */
router.post('/providers', manageProviders, wrap(async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {}
  const plugin = registry.getType(body.type)
  if (!plugin) throw badRequest('provider.type_unsupported')
  if ((await Provider.countDocuments({ userId: req.spaceId })) >= MAX_PROVIDERS) {
    throw badRequest('provider.max', { max: MAX_PROVIDERS })
  }
  const name = text(body.name, 60) || registry.typeLabel(plugin, req.locale)
  const baseUrl = parseBaseUrl(body.baseUrl)
  const apiKey = body.apiKey === undefined || body.apiKey === null ? '' : parseApiKey(body.apiKey)
  if (!apiKey) throw badRequest('provider.api_key_required')
  const slugSource = typeof body.slug === 'string' && body.slug.trim() ? body.slug : plugin.type
  const doc = await Provider.create({
    userId: req.spaceId,
    createdBy: req.userId,
    keySetBy: req.userId,
    updatedBy: req.userId,
    type: plugin.type,
    name,
    slug: await uniqueSlug(req.spaceId, slugSource),
    // The official address is stored as "none", so it follows the vendor module.
    baseUrl: baseUrl === plugin.defaultBaseUrl ? '' : baseUrl,
    apiKeyEnc: encrypt(apiKey, getConfig().secretKey),
    hasKey: true,
    keyTail: keyTail(apiKey),
    enabled: body.enabled !== false,
    sort: Number.isFinite(Number(body.sort)) ? Number(body.sort) : 0,
  })
  await logActivity(req, 'provider:created', providerTarget(doc), { vendor: doc.type, enabled: doc.enabled !== false })
  ok(res, await presentProvider(req, doc.toObject()))
}))

/**
 * PUT /api/admin/providers/:id - partial update; omit apiKey (or send '') to keep the stored one.
 *
 * The stored key is only ever sent to the address it was saved with. A
 * request that changes the address has to bring the key along (`apiKey`), or
 * give the stored one up (`clearKey: true`); otherwise it is refused with 400
 * `provider.key_required_for_url`. Without that rule, whoever may edit a
 * provider could point it at a server of their own and collect a key they
 * were never shown. The vendor - the other thing that decides where and how
 * the key travels - cannot be changed at all.
 */
router.put('/providers/:id', manageProviders, wrap(async (req, res) => {
  requireObjectId(req.params.id)
  const body = isPlainObject(req.body) ? req.body : {}
  const doc = await Provider.findOne({ _id: req.params.id, userId: req.spaceId }).select('+apiKeyEnc')
  if (!doc) throw notFound('provider.not_found')
  const plugin = registry.getType(doc.type)
  if (!plugin) throw badRequest('provider.type_gone')
  // Model ids, prices and canvases hang off the vendor; it is fixed at creation.
  if (body.type !== undefined && body.type !== doc.type) throw badRequest('provider.vendor_fixed')

  const events = []
  const before = { name: doc.name, enabled: doc.enabled !== false }
  if (body.name !== undefined) {
    const name = text(body.name, 60)
    if (!name) throw badRequest('common.name_required')
    doc.name = name
  }
  const newKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? parseApiKey(body.apiKey) : ''
  if (body.baseUrl !== undefined) {
    const baseUrl = parseBaseUrl(body.baseUrl)
    const next = baseUrl === plugin.defaultBaseUrl ? '' : baseUrl
    const official = plugin.defaultBaseUrl || ''
    if (!sameAddress(doc.baseUrl || official, next || official)) {
      // The key that is stored was entered for the old address and goes nowhere else.
      if (doc.hasKey && !newKey && body.clearKey !== true) throw badRequest('provider.key_required_for_url')
      events.push(['provider:url_changed', { custom: !!next }])
    }
    doc.baseUrl = next
  }
  if (newKey) {
    doc.apiKeyEnc = encrypt(newKey, getConfig().secretKey)
    doc.hasKey = true
    doc.keyTail = keyTail(newKey)
    doc.keySetBy = req.userId
    events.push(['provider:key_changed', { cleared: false }])
  } else if (body.clearKey === true) {
    doc.apiKeyEnc = ''
    doc.hasKey = false
    doc.keyTail = ''
    doc.keySetBy = ''
    events.push(['provider:key_changed', { cleared: true }])
  }
  // The last connection test was of another key or another address: it says nothing about this one.
  if (events.length) doc.lastTest = null
  if (body.enabled !== undefined) doc.enabled = body.enabled !== false
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) doc.sort = Number(body.sort)
  const after = { name: doc.name, enabled: doc.enabled !== false }
  // Whoever really changed something is the provider's maintainer from now on; a save of what was there is not a change.
  if (doc.isModified()) doc.updatedBy = req.userId
  await doc.save()
  if (before.name !== after.name || before.enabled !== after.enabled) {
    events.push(['provider:updated', {
      ...(before.enabled !== after.enabled ? { enabled: after.enabled } : {}),
      ...(before.name !== after.name ? { renamed: true, from: before.name, to: after.name } : {}),
    }])
  }
  for (const [type, detail] of events) await logActivity(req, type, providerTarget(doc), detail)
  ok(res, await presentProvider(req, doc.toObject()))
}))

/** DELETE /api/admin/providers/:id - also drops the overrides of its models */
router.delete('/providers/:id', manageProviders, wrap(async (req, res) => {
  requireObjectId(req.params.id)
  const doc = await Provider.findOneAndDelete({ _id: req.params.id, userId: req.spaceId }).lean()
  if (!doc) throw notFound('provider.not_found')
  await ModelOverride.deleteMany({ userId: req.spaceId, modelId: { $regex: `^${doc.slug}:` } })
  await logActivity(req, 'provider:deleted', providerTarget(doc), { vendor: doc.type })
  ok(res, { id: String(doc._id) })
}))

/**
 * POST /api/admin/providers/:id/test -> { ok, message }
 * Tests the provider as it is saved: the stored key, sent to the stored
 * address. Nothing in the request can redirect it - the body is not read.
 */
router.post('/providers/:id/test', manageProviders, wrap(async (req, res) => {
  requireObjectId(req.params.id)
  const doc = await Provider.findOne({ _id: req.params.id, userId: req.spaceId }).select('+apiKeyEnc').lean()
  if (!doc) throw notFound('provider.not_found')
  const plugin = registry.getType(doc.type)
  // What the test said, as a catalog message: it is answered in the caller's language and kept
  // on the provider (`lastTest`) to be read later in anybody's.
  let passed = false
  let said
  if (!plugin) said = msg('provider.type_gone')
  else {
    try {
      const out = await plugin.test(registry.configFor(doc), { signal: AbortSignal.timeout(TEST_TIMEOUT_MS) })
      passed = out.ok !== false
      said = out.message ? asMessage(out.message) : msg(passed ? 'provider.test_ok' : 'provider.test_failed')
    } catch (err) {
      // A failed test is a normal answer, not a server error.
      const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError')
      said = (timedOut ? null : messageOf(err)) || msg(timedOut ? 'provider.test_timeout' : 'provider.test_failed')
    }
  }
  const at = new Date()
  // Guarded by the key and address that were tested: a provider changed in the meantime keeps no
  // result of the old one. Not an edit: `updatedAt` and the maintainer stay.
  await Provider.updateOne(
    { _id: doc._id, userId: req.spaceId, apiKeyEnc: doc.apiKeyEnc || '', baseUrl: doc.baseUrl || '' },
    { $set: { lastTest: { ok: passed, at, by: req.userId, ...storedError(said) } } },
    { timestamps: false }
  )
  // The answer keeps its two fields; the same result, with its time, is `lastTest` of the provider from now on.
  ok(res, { ok: passed, message: render(req.locale, said).slice(0, 500) })
}))

/** A plugin's own test message: a catalog message as it is, plain text wrapped so it can be stored. */
const asMessage = (m) => (isMessage(m) ? m : msg(RAW, { text: String(m).slice(0, 500) }))

/* -------------------------------------------------------- custom models */

/*
 * A custom model is one the vendor's catalog does not list. The user states
 * its upstream name and its kind; the kind is never worked out from the name.
 * What parameters it gets is fixed per vendor and kind (customSpec()).
 */

async function providerForCustom(req) {
  requireObjectId(req.params.id)
  spaces.assertCan(req, 'provider:manage')
  const doc = await Provider.findOne({ _id: req.params.id, userId: req.spaceId })
  if (!doc) throw notFound('provider.not_found')
  const plugin = registry.getType(doc.type)
  if (!plugin) throw badRequest('provider.type_gone')
  return { doc, plugin }
}

/** POST /api/admin/providers/:id/models { model, kind, label? } */
router.post('/providers/:id/models', wrap(async (req, res) => {
  const { doc, plugin } = await providerForCustom(req)
  const body = isPlainObject(req.body) ? req.body : {}
  const entry = registry.checkCustomModel(plugin, { id: body.model, kind: body.kind, label: body.label })
  if (doc.customModels.some((m) => m.id === entry.id)) throw badRequest('provider.custom_exists', { model: entry.id })
  if (doc.customModels.length >= MAX_CUSTOM_MODELS) throw badRequest('provider.custom_max', { max: MAX_CUSTOM_MODELS })
  doc.customModels.push(entry)
  doc.updatedBy = req.userId
  await doc.save()
  await logActivity(req, 'provider:model_added', providerTarget(doc), { model: entry.id, kind: entry.kind })
  ok(res, await presentProvider(req, doc.toObject()))
}))

/**
 * PUT /api/admin/providers/:id/models/:model { kind?, label? }
 * The name is the model's identity (canvases and prices refer to it), so it
 * cannot be edited: delete the entry and add the right one instead.
 */
router.put('/providers/:id/models/:model(*)', wrap(async (req, res) => {
  const { doc, plugin } = await providerForCustom(req)
  const body = isPlainObject(req.body) ? req.body : {}
  const current = doc.customModels.find((m) => m.id === req.params.model)
  if (!current) throw notFound('provider.custom_not_found')
  if (body.model !== undefined && body.model !== current.id) throw badRequest('provider.custom_name_fixed')
  const entry = registry.checkCustomModel(plugin, {
    id: current.id,
    kind: body.kind === undefined ? current.kind : body.kind,
    label: body.label === undefined ? current.label : body.label,
  })
  current.kind = entry.kind
  current.label = entry.label
  if (doc.isModified()) doc.updatedBy = req.userId
  await doc.save()
  // A name typed into the model list earlier would otherwise hide this one.
  if (body.label !== undefined) await ModelOverride.updateOne({ userId: req.spaceId, modelId: `${doc.slug}:${current.id}` }, { $unset: { label: '' } })
  ok(res, await presentProvider(req, doc.toObject()))
}))

/** DELETE /api/admin/providers/:id/models/:model - also drops its override (enabled, order, price) */
router.delete('/providers/:id/models/:model(*)', wrap(async (req, res) => {
  const { doc } = await providerForCustom(req)
  const before = doc.customModels.length
  doc.customModels = doc.customModels.filter((m) => m.id !== req.params.model)
  if (doc.customModels.length === before) throw notFound('provider.custom_not_found')
  doc.updatedBy = req.userId
  await doc.save()
  await ModelOverride.deleteOne({ userId: req.spaceId, modelId: `${doc.slug}:${req.params.model}` })
  await logActivity(req, 'provider:model_removed', providerTarget(doc), { model: String(req.params.model).slice(0, 120) })
  ok(res, await presentProvider(req, doc.toObject()))
}))

/* --------------------------------------------------------------- models */

/** GET /api/admin/models - every model incl. disabled ones, with its override */
router.get('/models', wrap(async (req, res) => {
  const [models, overrides] = await Promise.all([
    registry.listModels({ userId: req.spaceId, includeDisabled: true }),
    ModelOverride.find({ userId: req.spaceId }).lean(),
  ])
  const byId = new Map(overrides.map((o) => [o.modelId, o]))
  ok(res, models.map((m) => {
    const o = byId.get(m.id)
    return {
      ...registry.localizeSpec(m, req.locale),
      override: o
        ? { enabled: o.enabled, label: o.label, sort: o.sort, defaults: o.defaults, pricing: o.pricing }
        : null,
    }
  }))
}))

function cleanDefaults(input) {
  if (input === null) return null
  if (!isPlainObject(input)) throw badRequest('validation.object_or_null', { field: 'defaults' })
  const out = {}
  for (const [k, v] of Object.entries(input).slice(0, 20)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)) throw badRequest('validation.bad_key', { field: 'defaults' })
    if ((typeof v === 'string' && v.length <= 100) || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean') out[k] = v
    else throw badRequest('validation.invalid', { field: `defaults.${k}` })
  }
  return out
}

/**
 * PUT /api/admin/models/:modelId { enabled?, label?, sort?, defaults?, pricing? }
 * Sending null for a field removes that part of the override.
 * The id contains ":" and possibly "/", so the client must URL-encode it.
 */
router.put('/models/:modelId(*)', manageProviders, wrap(async (req, res) => {
  const modelId = String(req.params.modelId || '')
  if (!modelId || modelId.length > 200 || !registry.splitModelId(modelId)) throw badRequest('model.bad_id')
  const body = isPlainObject(req.body) ? req.body : {}
  const { spec } = await registry.resolveModel(modelId, { userId: req.spaceId, requireEnabled: false })
  if (!spec) throw notFound('model.not_found')

  const set = {}
  const unset = {}
  const put = (key, value) => { if (value === null) unset[key] = '' ; else set[key] = value }

  if (body.enabled !== undefined) {
    if (body.enabled !== null && typeof body.enabled !== 'boolean') throw badRequest('validation.boolean', { field: 'enabled' })
    put('enabled', body.enabled)
  }
  if (body.label !== undefined) {
    if (body.label !== null && typeof body.label !== 'string') throw badRequest('validation.string', { field: 'label' })
    put('label', body.label === null || !body.label.trim() ? null : body.label.trim().slice(0, 80))
  }
  if (body.sort !== undefined) {
    if (body.sort !== null && !(typeof body.sort === 'number' && Number.isFinite(body.sort))) throw badRequest('validation.number', { field: 'sort' })
    put('sort', body.sort)
  }
  if (body.defaults !== undefined) put('defaults', cleanDefaults(body.defaults))
  if (body.pricing !== undefined) {
    // pricing: null removes the price (catalogs declare none, so the cost becomes unknown).
    try { put('pricing', normalizePricing(body.pricing)) } catch (err) {
      if (!err.i18n) throw err
      throw badRequest(err.i18n)
    }
  }
  if (!Object.keys(set).length && !Object.keys(unset).length) throw badRequest('common.nothing_to_update')

  const update = {}
  if (Object.keys(set).length) update.$set = set
  if (Object.keys(unset).length) update.$unset = unset
  await ModelOverride.updateOne({ userId: req.spaceId, modelId }, { ...update, $setOnInsert: { createdBy: req.userId } }, { upsert: true })

  const { spec: merged } = await registry.resolveModel(modelId, { userId: req.spaceId, requireEnabled: false })
  const target = { type: 'model', id: modelId, name: merged.label || modelId }
  if (body.enabled !== undefined && merged.enabled !== spec.enabled) await logActivity(req, merged.enabled ? 'model:enabled' : 'model:disabled', target)
  if (body.pricing !== undefined) await logActivity(req, 'model:price_changed', target, { priced: !!merged.pricing, before: priceSummary(spec.pricing), after: priceSummary(merged.pricing) })
  ok(res, registry.localizeSpec(merged, req.locale))
}))

/* ------------------------------------------- site settings (owner only) */

router.get('/settings', requireOwner, wrap(async (_req, res) => {
  ok(res, settings.getAll())
}))

router.put('/settings', requireOwner, wrap(async (req, res) => {
  ok(res, await settings.update(req.body))
}))

/* ------------------------------------------------- storage (owner only) */

/** A connection test in the reader's language: per-step results plus one actionable sentence. */
function serializeStorageTest(result, locale) {
  return {
    ok: result.ok,
    steps: result.steps,
    message: result.ok ? t(locale, 'storage.test_ok') : render(locale, result.error),
    code: result.ok ? '' : result.error.code,
  }
}

/**
 * GET /api/admin/storage - the storage in use, where that was decided, and the S3 form's values (no secret).
 * With `?probe=1` every bucket is first asked whether it can be reached (a few seconds at most), so the
 * states in `buckets` are current rather than what the last file request happened to find.
 */
router.get('/storage', requireOwner, wrap(async (req, res) => {
  ok(res, req.query.probe === '1' ? await storageSettings.probe() : storageSettings.status())
}))

/** POST /api/admin/storage/test { s3 } - real round trip with the submitted, unsaved configuration */
router.post('/storage/test', requireOwner, wrap(async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {}
  ok(res, serializeStorageTest(await storageSettings.test(body.s3), req.locale))
}))

/**
 * PUT /api/admin/storage { driver: 'local' } | { driver: 's3', s3, force? }
 * Takes effect at once. An S3 configuration is tested first; when the test
 * fails nothing is saved and the answer is 400 with the test in `data`, unless
 * `force` is true.
 */
router.put('/storage', requireOwner, wrap(async (req, res) => {
  const out = await storageSettings.save(req.body)
  if (out.saved) return ok(res, out.status)
  const test = serializeStorageTest(out.test, req.locale)
  res.status(400).json({ result: -1, message: t(req.locale, 'storage.save_needs_test', { reason: test.message }), code: 'storage.save_needs_test', data: { test } })
}))

/**
 * DELETE /api/admin/storage/buckets/:id - stop reading a bucket that is no longer written to
 * (`id` and `removable` are in the `buckets` of GET /api/admin/storage). Nothing is deleted from
 * the bucket; its files stop loading. Answers the new status.
 */
router.delete('/storage/buckets/:id', requireOwner, wrap(async (req, res) => {
  ok(res, await storageSettings.forget(String(req.params.id)))
}))

/* ------------------------------------------------- usage (the caller's) */

/**
 * `from` / `to` of the usage queries. A bare date ("2025-01-31") is a calendar
 * day in the caller's time zone (`tz`, an IANA name; UTC when absent, which is
 * what it always meant before `tz` was read here): `from` starts with that day
 * and `to` runs through the end of it. A full instant is taken as it is.
 */
function usageMatch(req, tz = parseTimeZone(req.query.tz)) {
  const { query } = req
  const match = { userId: req.spaceId }
  if (spaces.isTeam(req)) {
    // Whose records: everybody's for the owner (and for admins the owner let), with an optional
    // `member` filter; one's own for everybody else - decided here, whatever the query asks for.
    if (!permissions.can(req.space, 'usage:view_all')) match.createdBy = req.userId
    else if (query.member !== undefined && query.member !== '') match.createdBy = requireObjectId(query.member, 'member')
  }
  const from = parseDayOrInstant(query.from, 'from', tz)
  const to = parseDayOrInstant(query.to, 'to', tz, 1)
  if (from || to) {
    match.createdAt = {}
    if (from) match.createdAt.$gte = from.date
    // Bare date: before the start of the next day. Instant: before that instant.
    if (to) match.createdAt.$lt = to.bare ? to.date : parseDate(query.to, 'to')
    if (from && to && match.createdAt.$gte >= match.createdAt.$lt) throw badRequest('validation.from_before_to')
  }
  if (query.kind !== undefined && query.kind !== '') {
    if (!RUN_KINDS.includes(query.kind)) throw badRequest('validation.invalid', { field: 'kind' })
    match.kind = query.kind
  }
  if (query.status !== undefined && query.status !== '') {
    if (!Object.values(RUN_STATUS).includes(query.status)) throw badRequest('validation.invalid', { field: 'status' })
    match.status = query.status
  }
  if (query.model !== undefined && query.model !== '') {
    if (typeof query.model !== 'string' || query.model.length > 200) throw badRequest('validation.invalid', { field: 'model' })
    match.modelId = query.model
  }
  return match
}

/** The longest text `q` may carry; a longer one is refused rather than silently cut. */
const USAGE_SEARCH_MAX = 100
/** How many canvases a search matches by name at most (the newest ones). */
const USAGE_SEARCH_CANVASES = 200

/**
 * `q` of the usage queries: a piece of text looked for - as it is, whatever case - in the prompt,
 * in the model's name and id, and in the name of the canvas the run came from. Resolves the `$or`
 * of the Run filter, or null without a `q`.
 *
 * It only narrows what usageMatch lets the caller see: the filter is added to that one, never
 * instead of it. Canvases are matched by name among the ones the caller may see (a member does not
 * find a run through the name of somebody's private canvas), and not among deleted ones.
 */
async function usageSearch(req) {
  const raw = req.query.q
  if (raw === undefined || raw === '') return null
  if (typeof raw !== 'string') throw badRequest('validation.invalid', { field: 'q' })
  const q = raw.trim()
  if (q.length > USAGE_SEARCH_MAX) throw badRequest('validation.max_length', { field: 'q', max: USAGE_SEARCH_MAX })
  if (!q) return null
  const re = new RegExp(escapeRegExp(q), 'i')
  const or = [{ prompt: re }, { modelLabel: re }, { modelId: re }]
  const canvases = await Workflow.find({ userId: req.spaceId, isDeleted: false, name: re, ...permissions.visibleCanvasFilter(req.space) })
    .select('_id').sort({ createdAt: -1 }).limit(USAGE_SEARCH_CANVASES).lean()
  if (canvases.length) or.push({ workflowId: { $in: canvases.map((c) => String(c._id)) } })
  return or
}

/** usageMatch narrowed by `q`. */
async function usageFilter(req, tz) {
  const match = usageMatch(req, tz)
  const search = await usageSearch(req)
  if (search) match.$or = search
  return match
}

const flag = (cond) => ({ $sum: { $cond: [cond, 1, 0] } })

/** 'all': the records of everybody in the space; 'own': the caller's only (a team member who is not shown the rest). */
const usageScope = (req) => (spaces.isTeam(req) && !permissions.can(req.space, 'usage:view_all') ? 'own' : 'all')

/**
 * GET /api/admin/usage?from&to&groupBy=day|model|member[&tz=Asia/Shanghai][&member=<account id>][&q=<text>]
 * Cost is summed over succeeded runs with a known cost, per currency.
 * In a team, `tz` defaults to the team's time zone, `groupBy=member` gives one
 * row per member, and who sees whose records is decided by usageMatch.
 */
async function usageSummary(req, res) {
  const team = spaces.isTeam(req) ? req.space.team : null
  const groupBy = req.query.groupBy === 'model' ? 'model' : (req.query.groupBy === 'member' && team ? 'member' : 'day')
  const tz = parseTimeZone(req.query.tz === undefined && team ? team.timezone : req.query.tz)
  const match = await usageFilter(req, tz)
  const key = groupBy === 'model'
    ? '$modelId'
    : groupBy === 'member'
      ? { $ifNull: ['$createdBy', ''] }
      : { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } }
  const costed = { $and: [{ $eq: ['$status', 'succeeded'] }, { $eq: ['$cost.unknown', false] }] }
  // What the runs still in progress hold: a team run its reservation (Run.budget), any other its estimate.
  const reservedRun = { $eq: ['$budget.state', 'reserved'] }
  const heldCurrency = { $cond: [reservedRun, '$budget.currency', { $cond: [{ $eq: ['$cost.unknown', false] }, '$cost.currency', ''] }] }
  const heldMicro = { $cond: [reservedRun, { $ifNull: ['$budget.micro', 0] }, { $cond: [{ $eq: ['$cost.unknown', false] }, { $round: [{ $multiply: [{ $ifNull: ['$cost.amount', 0] }, 1e6] }, 0] }, 0] }] }

  let rows
  let held
  try {
    held = await Run.aggregate([
      { $match: { $and: [match, { status: { $in: budget.IN_PROGRESS } }] } },
      { $group: { _id: { key, currency: heldCurrency }, micro: { $sum: heldMicro } } },
    ])
    rows = await Run.aggregate([
      { $match: match },
      {
        $group: {
          _id: { key, currency: { $cond: [costed, '$cost.currency', ''] } },
          count: { $sum: 1 },
          succeeded: flag({ $eq: ['$status', 'succeeded'] }),
          failed: flag({ $eq: ['$status', 'failed'] }),
          canceled: flag({ $eq: ['$status', 'canceled'] }),
          inProgress: flag({ $in: ['$status', budget.IN_PROGRESS] }),
          unknownCost: flag({ $and: [{ $eq: ['$status', 'succeeded'] }, { $ne: ['$cost.unknown', false] }] }),
          cost: { $sum: { $cond: [costed, '$cost.amount', 0] } },
          label: { $last: '$modelLabel' },
        },
      },
    ])
  } catch (err) {
    if (/time ?zone/i.test(String(err && err.message))) throw badRequest('validation.invalid', { field: 'tz' })
    throw err
  }

  // Fold the per-currency groups into one row per key.
  const blank = () => ({ count: 0, succeeded: 0, failed: 0, canceled: 0, inProgress: 0, unknownCost: 0, costs: {}, reservedMicro: {} })
  const byKey = new Map()
  const totals = blank()
  for (const r of rows) {
    const k = r._id.key
    if (!byKey.has(k)) byKey.set(k, { key: k, ...(groupBy === 'model' ? { label: r.label || k } : {}), ...blank() })
    for (const target of [byKey.get(k), totals]) {
      for (const f of ['count', 'succeeded', 'failed', 'canceled', 'inProgress', 'unknownCost']) target[f] += r[f]
      if (r._id.currency && r.cost) {
        target.costs[r._id.currency] = Math.round(((target.costs[r._id.currency] || 0) + r.cost) * 1e6) / 1e6
      }
    }
  }
  for (const h of held) {
    if (!h._id.currency || !h.micro) continue
    for (const target of [byKey.get(h._id.key), totals]) {
      if (target) target.reservedMicro[h._id.currency] = (target.reservedMicro[h._id.currency] || 0) + h.micro
    }
  }
  // One row per key. A row shows a single amount; with several currencies in
  // one row the largest is shown and the full breakdown stays in `costs`.
  const shape = (r) => {
    const [currency = '', amount = 0] = Object.entries(r.costs).sort((a, b) => b[1] - a[1])[0] || []
    return {
      key: r.key,
      ...(r.label ? { label: r.label } : {}),
      runs: r.count,
      succeeded: r.succeeded,
      failed: r.failed,
      canceled: r.canceled,
      // Queued, running or archiving right now; `reserved` is what they hold, per currency (an
      // estimate - for a chat model priced per token, its reserve - until they are done).
      inProgress: r.inProgress,
      reserved: Object.fromEntries(Object.entries(r.reservedMicro).map(([c, m]) => [c, m / 1e6])),
      // What a team's monthly limits count: succeeded + in progress (see services/budget.js).
      // Its money, in the limit's currency C, is costs[C] + reserved[C].
      counted: { runs: r.succeeded + r.inProgress },
      amount,
      currency,
      unknownCount: r.unknownCost,
      costs: r.costs,
    }
  }
  const items = [...byKey.values()].map(shape)
  if (groupBy === 'day') items.sort((a, b) => (a.key < b.key ? -1 : 1))
  else items.sort((a, b) => b.runs - a.runs)
  if (groupBy === 'member') {
    const names = await spaces.people(items.map((i) => i.key), req.spaceId)
    for (const item of items) {
      item.member = spaces.personOf(names, item.key)
      item.label = (item.member && item.member.name) || ''
    }
  }
  // `limits=1` (team): this month against the limits, in the same call and by the same definition
  // (the object GET /api/teams/:id/limits answers with), so a page never mixes two countings.
  const limits = team && (req.query.limits === '1' || req.query.limits === 'true')
    ? { limits: await budget.limitsView(team, req.space.member, { all: permissions.can(req.space, 'usage:view_all'), members: groupBy === 'member' }) }
    : {}
  ok(res, { groupBy, timezone: tz, ...(team ? { scope: usageScope(req) } : {}), totals: shape({ key: 'total', ...totals }), items, ...limits })
}
router.get('/usage', wrap(usageSummary))

/**
 * GET /api/admin/usage/records?page&pageSize&from&to&kind&status&model[&member][&q=<text>][&full=1]
 * `q`: only the records whose prompt, model (name or id) or canvas name has that text in it (see usageSearch).
 * `full=1`: every record as GET .../records/:recordId gives it - the whole prompt and text
 * answer, the system prompt, what was sent along. For an export; a page of the list does not need it.
 */
async function usageRecords(req, res) {
  const team = spaces.isTeam(req) ? req.space.team : null
  const full = req.query.full === '1' || req.query.full === 'true'
  const { page, pageSize, skip } = pageParams(req.query, { defaultSize: 20, maxSize: 100 })
  const match = await usageFilter(req, parseTimeZone(req.query.tz === undefined && team ? team.timezone : req.query.tz))
  const [total, runs] = await Promise.all([
    Run.countDocuments(match),
    Run.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .select(RECORD_FIELDS)
      .lean(),
  ])
  const names = team ? await spaces.people(runs.map((r) => r.createdBy || r.userId), req.spaceId) : null
  ok(res, {
    ...(team ? { scope: usageScope(req) } : {}),
    list: runs.map((r) => serializeRecord(r, { locale: req.locale, names, full })),
    total,
    page,
    pageSize,
  })
}
router.get('/usage/records', wrap(usageRecords))

const RECORD_FIELDS = 'userId createdBy kind status progress modelId modelLabel providerType prompt systemPrompt imageUrls videoUrls params count cost usage text outputs filesPurged error errorCode errorParams workflowId nodeId createdAt startedAt finishedAt'
/** How much of a prompt and of a text answer a row of the list carries; the whole of both is in the record itself. */
const RECORD_EXCERPT = { prompt: 200, text: 500 }

/** Tokens in and out as the upstream reported them, or null when it reported none (media runs, some chat upstreams). */
function tokenUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const n = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : 0)
  const inputTokens = n(usage.inputTokens)
  const outputTokens = n(usage.outputTokens)
  if (!inputTokens && !outputTokens) return null
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
}

/**
 * One run as a history record. In the list a long prompt or text answer is cut
 * (`promptTruncated` / `textTruncated` say so, `promptLength` / `textLength`
 * how long the whole is); `full` - one record read by its id - gives all of
 * both, the system prompt and the addresses of what was sent along.
 */
function serializeRecord(r, { locale, names = null, full = false }) {
  const prompt = r.prompt || ''
  const answer = r.text || ''
  const cut = (s, max) => (full ? s : s.slice(0, max))
  const started = r.startedAt ? new Date(r.startedAt).getTime() : null
  const finished = r.finishedAt ? new Date(r.finishedAt).getTime() : null
  const created = new Date(r.createdAt).getTime()
  const images = r.imageUrls || []
  const videos = r.videoUrls || []
  return {
    id: String(r._id),
    // In a team: whose run it was.
    ...(names ? { createdBy: spaces.personOf(names, r.createdBy || r.userId) } : {}),
    kind: r.kind,
    status: r.status,
    progress: r.progress || 0,
    model: r.modelId,
    modelLabel: r.modelLabel || '',
    providerType: r.providerType || '',
    prompt: cut(prompt, RECORD_EXCERPT.prompt),
    promptLength: prompt.length,
    promptTruncated: !full && prompt.length > RECORD_EXCERPT.prompt,
    params: r.params || {},
    count: r.count || 1,
    // What was sent along with the prompt: how many, and in a full record which.
    inputs: { images: images.length, videos: videos.length },
    cost: { amount: (r.cost && r.cost.amount) || 0, currency: (r.cost && r.cost.currency) || '', unknown: !r.cost || r.cost.unknown !== false },
    usage: tokenUsage(r.usage),
    // The text answer of a chat run ('' for image and video runs, and until it has succeeded).
    text: cut(answer, RECORD_EXCERPT.text),
    textLength: answer.length,
    textTruncated: !full && answer.length > RECORD_EXCERPT.text,
    // The files of an image or video run. [] with `filesPurged: true`: there were some, retention removed them.
    outputs: (r.outputs || []).map((o) => ({ type: o.type, url: o.url, thumbnailUrl: o.thumbnailUrl || '', ...(o.width ? { width: o.width, height: o.height } : {}) })),
    filesPurged: !!r.filesPurged,
    error: renderStored(locale, r),
    errorCode: r.errorCode || '',
    workflowId: r.workflowId || '',
    nodeId: r.nodeId || '',
    createdAt: r.createdAt,
    startedAt: r.startedAt || null,
    finishedAt: r.finishedAt || null,
    // Waiting in the queue, then running; null while that phase is not over.
    queuedMs: started === null ? null : Math.max(0, started - created),
    durationMs: started === null || finished === null ? null : Math.max(0, finished - started),
    ...(full ? { systemPrompt: r.systemPrompt || '', imageUrls: images, videoUrls: videos } : {}),
  }
}

/**
 * The records of this space the caller may read: everybody's for one person in their own space
 * and for whoever has `usage:view_all` in a team; only their own for every other team member.
 */
function readableRecords(req) {
  const filter = { userId: req.spaceId }
  if (spaces.isTeam(req) && !permissions.can(req.space, 'usage:view_all')) filter.createdBy = req.userId
  return filter
}

/**
 * GET /api/admin/usage/records/:recordId - one record in full: the whole prompt, the system
 * prompt, the whole text answer, the files, tokens, cost and timing. A record the caller may
 * not read (somebody else's, in a team, without `usage:view_all`) is a 404 like one that does not exist.
 */
async function usageRecord(req, res) {
  const id = requireObjectId(req.params.recordId, 'recordId')
  const run = await Run.findOne({ _id: id, ...readableRecords(req) }).select(RECORD_FIELDS).lean()
  if (!run) throw notFound('run.not_found')
  const names = spaces.isTeam(req) ? await spaces.people([run.createdBy || run.userId], req.spaceId) : null
  ok(res, serializeRecord(run, { locale: req.locale, names, full: true }))
}
router.get('/usage/records/:recordId', wrap(usageRecord))

/** A record in one of these states is history; anything else is still being worked on. */
const FINISHED = [RUN_STATUS.SUCCEEDED, RUN_STATUS.FAILED, RUN_STATUS.CANCELED]

/**
 * DELETE /api/admin/usage/records?before=<date> -> { deleted }
 * Removes the usage records created before that moment ("2025-01-31" = before
 * the start of that day, UTC). Queued and running records are kept whatever
 * their age, and so are the generated files: canvases may still show them.
 *
 * In a team this is the owner's alone, and the records of the current month
 * stay whatever is asked: they are what the monthly limits are counted from.
 */
router.delete('/usage/records', spaces.requireCan('limits:manage'), wrap(async (req, res) => {
  const raw = req.query.before
  if (raw === undefined || raw === '') throw badRequest('validation.required', { field: 'before' })
  if (typeof raw !== 'string') throw badRequest('validation.bad_date', { field: 'before' })
  // A bare date is the start of that day in the caller's time zone (`tz`; UTC when absent).
  const team = spaces.isTeam(req) ? req.space.team : null
  const before = parseDayOrInstant(raw, 'before', parseTimeZone(req.query.tz === undefined && team ? team.timezone : req.query.tz)).date
  if (team && before > budget.monthOf(team.timezone).start) throw badRequest('usage.current_month')
  const r = await Run.deleteMany({ userId: req.spaceId, status: { $in: FINISHED }, createdAt: { $lt: before } })
  await logActivity(req, 'usage:records_deleted', null, { deleted: r.deletedCount || 0, before })
  ok(res, { deleted: r.deletedCount || 0 })
}))

module.exports = router
module.exports.usageSummary = usageSummary
module.exports.usageRecords = usageRecords
module.exports.usageRecord = usageRecord
module.exports.readableRecords = readableRecords
