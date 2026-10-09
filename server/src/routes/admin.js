'use strict'

/** Settings page backend: providers, model overrides, site settings, usage (contract section 5). */
const express = require('express')
const Provider = require('../models/Provider')
const ModelOverride = require('../models/ModelOverride')
const Run = require('../models/Run')
const registry = require('../providers')
const settings = require('../services/settings')
const storageSettings = require('../services/storageSettings')
const { getConfig } = require('../config')
const { encrypt, keyTail } = require('../utils/crypto')
const { normalizePricing } = require('../runner/pricing')
const { ok, wrap, badRequest, notFound, ApiError } = require('../utils/http')
const { requireObjectId, isPlainObject, pageParams, parseDate, text } = require('../utils/validate')
const { t, render, messageOf, renderStored } = require('../i18n')
const { LOCAL_USER, RUN_KINDS, RUN_STATUS } = require('../constants')

const router = express.Router()

const MAX_PROVIDERS = 50
const TEST_TIMEOUT_MS = 20 * 1000

/* ------------------------------------------------------------ providers */

/** Never includes the key: only whether one is set and its last four characters. */
function serializeProvider(doc) {
  const plugin = registry.getType(doc.type)
  return {
    // Type-specific fields at the top level too, the way the form posts them.
    ...(doc.options || {}),
    id: String(doc._id),
    type: doc.type,
    name: doc.name,
    slug: doc.slug,
    // Empty in the database means "the type's default".
    baseUrl: doc.baseUrl || (plugin && plugin.defaultBaseUrl) || '',
    options: doc.options || {},
    enabled: doc.enabled !== false,
    sort: doc.sort || 0,
    hasKey: !!doc.hasKey,
    keyTail: doc.keyTail || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
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

/**
 * Type-specific non-secret fields. They may arrive at the top level of the
 * body (as the form posts them) or nested under `options`.
 */
function parseOptions(plugin, body) {
  const nested = isPlainObject(body.options) ? body.options : {}
  const out = {}
  for (const f of plugin.fields) {
    if (f.secret || f.key === 'baseUrl' || f.key === 'apiKey') continue
    const v = body[f.key] !== undefined ? body[f.key] : nested[f.key]
    if (v === undefined) continue
    if (typeof v !== 'string') throw badRequest('validation.string', { field: f.key })
    if (v.length > 5000) throw badRequest('validation.too_long', { field: f.key })
    out[f.key] = v.trim()
  }
  return out
}

async function uniqueSlug(wanted) {
  const base = wanted.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'provider'
  for (let i = 1; i <= MAX_PROVIDERS + 1; i++) {
    const slug = i === 1 ? base : `${base}-${i}`
    if (!(await Provider.exists({ slug }))) return slug
  }
  throw new ApiError(409, 'provider.slug_exhausted')
}

/** GET /api/admin/provider-types */
router.get('/provider-types', wrap(async (req, res) => {
  ok(res, registry.listTypes(req.locale))
}))

/** GET /api/admin/providers */
router.get('/providers', wrap(async (_req, res) => {
  const list = await Provider.find({ userId: LOCAL_USER }).sort({ sort: 1, createdAt: 1 }).lean()
  ok(res, list.map(serializeProvider))
}))

/** POST /api/admin/providers { type, name, baseUrl?, apiKey, enabled, ...type fields } */
router.post('/providers', wrap(async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {}
  const plugin = registry.getType(body.type)
  if (!plugin) throw badRequest('provider.type_unsupported')
  if ((await Provider.countDocuments({ userId: LOCAL_USER })) >= MAX_PROVIDERS) {
    throw badRequest('provider.max', { max: MAX_PROVIDERS })
  }
  const name = text(body.name, 60) || registry.typeLabel(plugin, req.locale)
  const baseUrl = parseBaseUrl(body.baseUrl)
  const apiKey = body.apiKey === undefined || body.apiKey === null ? '' : parseApiKey(body.apiKey)
  for (const f of plugin.fields) {
    if (!f.required) continue
    if (f.key === 'apiKey' && !apiKey) throw badRequest('provider.api_key_required')
    if (f.key === 'baseUrl' && !baseUrl && !plugin.defaultBaseUrl) throw badRequest('provider.base_url_required')
  }
  const slugSource = typeof body.slug === 'string' && body.slug.trim() ? body.slug : plugin.type
  const doc = await Provider.create({
    userId: LOCAL_USER,
    type: plugin.type,
    name,
    slug: await uniqueSlug(slugSource),
    baseUrl,
    apiKeyEnc: apiKey ? encrypt(apiKey, getConfig().secretKey) : '',
    hasKey: !!apiKey,
    keyTail: keyTail(apiKey),
    options: parseOptions(plugin, body),
    enabled: body.enabled !== false,
    sort: Number.isFinite(Number(body.sort)) ? Number(body.sort) : 0,
  })
  ok(res, serializeProvider(doc.toObject()))
}))

/** PUT /api/admin/providers/:id - partial update; omit apiKey (or send '') to keep the stored one */
router.put('/providers/:id', wrap(async (req, res) => {
  requireObjectId(req.params.id)
  const body = isPlainObject(req.body) ? req.body : {}
  const doc = await Provider.findOne({ _id: req.params.id, userId: LOCAL_USER }).select('+apiKeyEnc')
  if (!doc) throw notFound('provider.not_found')
  const plugin = registry.getType(doc.type)
  if (!plugin) throw badRequest('provider.type_gone')

  if (body.name !== undefined) {
    const name = text(body.name, 60)
    if (!name) throw badRequest('common.name_required')
    doc.name = name
  }
  if (body.baseUrl !== undefined) {
    const baseUrl = parseBaseUrl(body.baseUrl)
    const needsBase = plugin.fields.some((f) => f.key === 'baseUrl' && f.required)
    if (!baseUrl && needsBase && !plugin.defaultBaseUrl) throw badRequest('provider.base_url_required')
    doc.baseUrl = baseUrl
  }
  if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
    const apiKey = parseApiKey(body.apiKey)
    doc.apiKeyEnc = encrypt(apiKey, getConfig().secretKey)
    doc.hasKey = true
    doc.keyTail = keyTail(apiKey)
  } else if (body.clearKey === true) {
    doc.apiKeyEnc = ''
    doc.hasKey = false
    doc.keyTail = ''
  }
  if (body.enabled !== undefined) doc.enabled = body.enabled !== false
  if (body.sort !== undefined && Number.isFinite(Number(body.sort))) doc.sort = Number(body.sort)
  const options = parseOptions(plugin, body)
  if (Object.keys(options).length) {
    doc.options = { ...(doc.options || {}), ...options }
    doc.markModified('options')
  }
  await doc.save()
  registry.invalidate(doc._id)
  ok(res, serializeProvider(doc.toObject()))
}))

/** DELETE /api/admin/providers/:id - also drops the overrides of its models */
router.delete('/providers/:id', wrap(async (req, res) => {
  requireObjectId(req.params.id)
  const doc = await Provider.findOneAndDelete({ _id: req.params.id, userId: LOCAL_USER }).lean()
  if (!doc) throw notFound('provider.not_found')
  await ModelOverride.deleteMany({ modelId: { $regex: `^${doc.slug}:` } })
  registry.invalidate(doc._id)
  ok(res, { id: String(doc._id) })
}))

/** POST /api/admin/providers/:id/test -> { ok, message, modelCount? } */
router.post('/providers/:id/test', wrap(async (req, res) => {
  requireObjectId(req.params.id)
  const doc = await Provider.findOne({ _id: req.params.id, userId: LOCAL_USER }).select('+apiKeyEnc').lean()
  if (!doc) throw notFound('provider.not_found')
  const plugin = registry.getType(doc.type)
  if (!plugin) return ok(res, { ok: false, message: t(req.locale, 'provider.type_gone') })
  try {
    const out = await plugin.test(registry.configFor(doc), { signal: AbortSignal.timeout(TEST_TIMEOUT_MS) })
    registry.invalidate(doc._id)
    const message = out.message ? render(req.locale, out.message) : t(req.locale, out.ok !== false ? 'provider.test_ok' : 'provider.test_failed')
    ok(res, { ok: out.ok !== false, message, ...(Number.isInteger(out.modelCount) ? { modelCount: out.modelCount } : {}) })
  } catch (err) {
    // A failed test is a normal answer, not a server error.
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError')
    const reason = timedOut ? null : messageOf(err)
    ok(res, { ok: false, message: reason ? render(req.locale, reason) : t(req.locale, timedOut ? 'provider.test_timeout' : 'provider.test_failed') })
  }
}))

/* --------------------------------------------------------------- models */

/** GET /api/admin/models - every model incl. disabled ones, with its override */
router.get('/models', wrap(async (req, res) => {
  const [models, overrides] = await Promise.all([
    registry.listModels({ includeDisabled: true }),
    ModelOverride.find({ userId: LOCAL_USER }).lean(),
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
router.put('/models/:modelId(*)', wrap(async (req, res) => {
  const modelId = String(req.params.modelId || '')
  if (!modelId || modelId.length > 200 || !registry.splitModelId(modelId)) throw badRequest('model.bad_id')
  const body = isPlainObject(req.body) ? req.body : {}
  const { spec } = await registry.resolveModel(modelId, { requireEnabled: false })
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
    // pricing: null here means "back to what the provider declared".
    try { put('pricing', normalizePricing(body.pricing)) } catch (err) {
      if (!err.i18n) throw err
      throw badRequest(err.i18n)
    }
  }
  if (!Object.keys(set).length && !Object.keys(unset).length) throw badRequest('common.nothing_to_update')

  const update = { $setOnInsert: { userId: LOCAL_USER } }
  if (Object.keys(set).length) update.$set = set
  if (Object.keys(unset).length) update.$unset = unset
  await ModelOverride.updateOne({ modelId }, update, { upsert: true })

  const { spec: merged } = await registry.resolveModel(modelId, { requireEnabled: false })
  ok(res, registry.localizeSpec(merged, req.locale))
}))

/* ------------------------------------------------------------- settings */

router.get('/settings', wrap(async (_req, res) => {
  ok(res, settings.getAll())
}))

router.put('/settings', wrap(async (req, res) => {
  ok(res, await settings.update(req.body))
}))

/* -------------------------------------------------------------- storage */

/** A connection test in the reader's language: per-step results plus one actionable sentence. */
function serializeStorageTest(result, locale) {
  return {
    ok: result.ok,
    steps: result.steps,
    message: result.ok ? t(locale, 'storage.test_ok') : render(locale, result.error),
    code: result.ok ? '' : result.error.code,
  }
}

/** GET /api/admin/storage - the storage in use, where that was decided, and the S3 form's values (no secret) */
router.get('/storage', wrap(async (_req, res) => {
  ok(res, storageSettings.status())
}))

/** POST /api/admin/storage/test { s3 } - real round trip with the submitted, unsaved configuration */
router.post('/storage/test', wrap(async (req, res) => {
  const body = isPlainObject(req.body) ? req.body : {}
  ok(res, serializeStorageTest(await storageSettings.test(body.s3), req.locale))
}))

/**
 * PUT /api/admin/storage { driver: 'local' } | { driver: 's3', s3, force? }
 * Takes effect at once. An S3 configuration is tested first; when the test
 * fails nothing is saved and the answer is 400 with the test in `data`, unless
 * `force` is true.
 */
router.put('/storage', wrap(async (req, res) => {
  const out = await storageSettings.save(req.body)
  if (out.saved) return ok(res, out.status)
  const test = serializeStorageTest(out.test, req.locale)
  res.status(400).json({ result: -1, message: t(req.locale, 'storage.save_needs_test', { reason: test.message }), code: 'storage.save_needs_test', data: { test } })
}))

/* ---------------------------------------------------------------- usage */

function usageMatch(query) {
  const match = { userId: LOCAL_USER }
  const from = parseDate(query.from, 'from')
  const to = parseDate(query.to, 'to')
  if (from || to) {
    match.createdAt = {}
    if (from) match.createdAt.$gte = from
    if (to) {
      // A bare date ("2025-01-31") means "through the end of that day".
      const end = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to)) ? new Date(to.getTime() + 24 * 3600 * 1000) : to
      match.createdAt.$lt = end
    }
    if (from && match.createdAt.$lt && from >= match.createdAt.$lt) throw badRequest('validation.from_before_to')
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

const flag = (cond) => ({ $sum: { $cond: [cond, 1, 0] } })

/**
 * GET /api/admin/usage?from&to&groupBy=day|model[&tz=Asia/Shanghai]
 * Cost is summed over succeeded runs with a known cost, per currency.
 */
router.get('/usage', wrap(async (req, res) => {
  const groupBy = req.query.groupBy === 'model' ? 'model' : 'day'
  const tz = typeof req.query.tz === 'string' && /^[A-Za-z_+\-/0-9:]{1,40}$/.test(req.query.tz) ? req.query.tz : 'UTC'
  const match = usageMatch(req.query)
  const key = groupBy === 'model'
    ? '$modelId'
    : { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: tz } }
  const costed = { $and: [{ $eq: ['$status', 'succeeded'] }, { $eq: ['$cost.unknown', false] }] }

  let rows
  try {
    rows = await Run.aggregate([
      { $match: match },
      {
        $group: {
          _id: { key, currency: { $cond: [costed, '$cost.currency', ''] } },
          count: { $sum: 1 },
          succeeded: flag({ $eq: ['$status', 'succeeded'] }),
          failed: flag({ $eq: ['$status', 'failed'] }),
          canceled: flag({ $eq: ['$status', 'canceled'] }),
          unknownCost: flag({ $and: [{ $eq: ['$status', 'succeeded'] }, { $ne: ['$cost.unknown', false] }] }),
          cost: { $sum: { $cond: [costed, '$cost.amount', 0] } },
          label: { $last: '$modelLabel' },
        },
      },
    ])
  } catch (err) {
    if (/time ?zone/i.test(String(err && err.message))) throw badRequest('validation.bad_timezone')
    throw err
  }

  // Fold the per-currency groups into one row per key.
  const blank = () => ({ count: 0, succeeded: 0, failed: 0, canceled: 0, unknownCost: 0, costs: {} })
  const byKey = new Map()
  const totals = blank()
  for (const r of rows) {
    const k = r._id.key
    if (!byKey.has(k)) byKey.set(k, { key: k, ...(groupBy === 'model' ? { label: r.label || k } : {}), ...blank() })
    for (const target of [byKey.get(k), totals]) {
      for (const f of ['count', 'succeeded', 'failed', 'canceled', 'unknownCost']) target[f] += r[f]
      if (r._id.currency && r.cost) {
        target.costs[r._id.currency] = Math.round(((target.costs[r._id.currency] || 0) + r.cost) * 1e6) / 1e6
      }
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
      amount,
      currency,
      unknownCount: r.unknownCost,
      costs: r.costs,
    }
  }
  const items = [...byKey.values()].map(shape)
  if (groupBy === 'day') items.sort((a, b) => (a.key < b.key ? -1 : 1))
  else items.sort((a, b) => b.runs - a.runs)
  ok(res, { groupBy, timezone: tz, totals: shape({ key: 'total', ...totals }), items })
}))

/** GET /api/admin/usage/records?page&pageSize&from&to&kind&status&model */
router.get('/usage/records', wrap(async (req, res) => {
  const { page, pageSize, skip } = pageParams(req.query, { defaultSize: 20, maxSize: 100 })
  const match = usageMatch(req.query)
  const [total, runs] = await Promise.all([
    Run.countDocuments(match),
    Run.find(match)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .select('kind status modelId modelLabel providerType prompt params count cost error errorCode errorParams workflowId nodeId createdAt startedAt finishedAt')
      .lean(),
  ])
  ok(res, {
    list: runs.map((r) => ({
      id: String(r._id),
      kind: r.kind,
      status: r.status,
      model: r.modelId,
      modelLabel: r.modelLabel || '',
      providerType: r.providerType || '',
      prompt: (r.prompt || '').slice(0, 200),
      params: r.params || {},
      count: r.count || 1,
      cost: { amount: (r.cost && r.cost.amount) || 0, currency: (r.cost && r.cost.currency) || '', unknown: !r.cost || r.cost.unknown !== false },
      error: renderStored(req.locale, r),
      workflowId: r.workflowId || '',
      nodeId: r.nodeId || '',
      createdAt: r.createdAt,
      startedAt: r.startedAt || null,
      finishedAt: r.finishedAt || null,
    })),
    total,
    page,
    pageSize,
  })
}))

/** A record in one of these states is history; anything else is still being worked on. */
const FINISHED = [RUN_STATUS.SUCCEEDED, RUN_STATUS.FAILED, RUN_STATUS.CANCELED]

/**
 * DELETE /api/admin/usage/records?before=<date> -> { deleted }
 * Removes the usage records created before that moment ("2025-01-31" = before
 * the start of that day, UTC). Queued and running records are kept whatever
 * their age, and so are the generated files: canvases may still show them.
 */
router.delete('/usage/records', wrap(async (req, res) => {
  const raw = req.query.before
  if (raw === undefined || raw === '') throw badRequest('validation.required', { field: 'before' })
  if (typeof raw !== 'string') throw badRequest('validation.bad_date', { field: 'before' })
  const before = parseDate(raw, 'before')
  const r = await Run.deleteMany({ userId: LOCAL_USER, status: { $in: FINISHED }, createdAt: { $lt: before } })
  ok(res, { deleted: r.deletedCount || 0 })
}))

module.exports = router
