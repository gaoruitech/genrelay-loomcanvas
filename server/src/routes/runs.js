'use strict'

/** Models, cost estimates, runs and chat tasks (contract section 4). */
const express = require('express')
const Run = require('../models/Run')
const registry = require('../providers')
const { getRunner, createRun, serializeRun } = require('../runner')
const { estimateCost } = require('../runner/pricing')
const { ok, wrap, badRequest, notFound } = require('../utils/http')
const { requireObjectId, isObjectId, isPlainObject, isMediaUrl, clampInt } = require('../utils/validate')
const { LOCAL_USER, RUN_KINDS } = require('../constants')

const router = express.Router()

const MAX_PROMPT = 20000
const MAX_IDS = 100

/** ModelSpec as the canvas sees it: no admin-only bookkeeping. */
function publicSpec(m) {
  const { enabled, providerEnabled, sort, ...spec } = m
  return spec
}

function modelIdOf(body) {
  const id = body && body.model
  if (typeof id !== 'string' || !id || id.length > 200) throw badRequest('缺少 model')
  return id
}

/** Params are a flat bag of small primitives; anything else is dropped. */
function cleanParams(input) {
  if (input === undefined || input === null) return {}
  if (!isPlainObject(input)) throw badRequest('params 必须是对象')
  const out = {}
  for (const [k, v] of Object.entries(input).slice(0, 30)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)) continue
    if (typeof v === 'string' && v.length <= 200) out[k] = v
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'boolean') out[k] = v
  }
  if (out.count !== undefined) out.count = clampInt(out.count, 1, 8, 1)
  return out
}

function mediaList(v, name, max) {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) throw badRequest(`${name} 必须是数组`)
  if (v.length > max) throw badRequest(`${name} 最多 ${max} 项`)
  for (const u of v) if (!isMediaUrl(u)) throw badRequest(`${name} 中有无效的地址`)
  return v
}

function promptOf(v, name = 'prompt') {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw badRequest(`${name} 必须是字符串`)
  if (v.length > MAX_PROMPT) throw badRequest(`${name} 过长`)
  return v
}

function attribution(body) {
  const workflowId = typeof body.workflowId === 'string' && isObjectId(body.workflowId) ? body.workflowId : ''
  const nodeId = typeof body.nodeId === 'string' ? body.nodeId.slice(0, 100) : ''
  return { workflowId, nodeId }
}

async function findRun(id, kindFilter) {
  requireObjectId(id, 'id')
  const run = await Run.findOne({ _id: id, userId: LOCAL_USER, ...kindFilter }).lean()
  if (!run) throw notFound('运行记录不存在')
  return run
}

const MEDIA = { kind: { $in: ['image', 'video'] } }
const CHAT = { kind: 'chat' }

/** GET /api/models?kind=image */
router.get('/models', wrap(async (req, res) => {
  const kind = req.query.kind
  if (kind !== undefined && !RUN_KINDS.includes(kind)) throw badRequest('kind 只能是 image / video / chat')
  const models = await registry.listModels({ kind })
  ok(res, models.map(publicSpec))
}))

/** POST /api/runs/estimate { model, params, count } */
router.post('/runs/estimate', wrap(async (req, res) => {
  const body = req.body || {}
  const { spec } = await registry.resolveModel(modelIdOf(body))
  if (!spec) throw badRequest('模型不存在或已下线')
  const params = cleanParams(body.params)
  const count = clampInt(body.count !== undefined ? body.count : params.count, 1, 100, 1)
  ok(res, estimateCost(spec, params, count))
}))

/** POST /api/runs -> { runId } */
router.post('/runs', wrap(async (req, res) => {
  const body = req.body || {}
  const run = await createRun({
    kind: 'media',
    model: modelIdOf(body),
    prompt: promptOf(body.prompt),
    imageUrls: mediaList(body.imageUrls, 'imageUrls', 16),
    videoUrls: mediaList(body.videoUrls, 'videoUrls', 4),
    params: cleanParams(body.params),
    ...attribution(body),
  })
  ok(res, { runId: String(run._id) })
}))

/** POST /api/runs/status { ids: [] } -> Run[] (batch polling) */
router.post('/runs/status', wrap(async (req, res) => {
  const ids = req.body && req.body.ids
  if (!Array.isArray(ids)) throw badRequest('ids 必须是数组')
  if (ids.length > MAX_IDS) throw badRequest(`一次最多查询 ${MAX_IDS} 条`)
  const valid = [...new Set(ids.filter(isObjectId))]
  const runs = valid.length ? await Run.find({ _id: { $in: valid }, userId: LOCAL_USER, ...MEDIA }).lean() : []
  const byId = new Map(runs.map((r) => [String(r._id), r]))
  // Same order as requested; unknown ids are simply absent.
  ok(res, valid.filter((id) => byId.has(id)).map((id) => serializeRun(byId.get(id))))
}))

/** GET /api/runs/:id */
router.get('/runs/:id', wrap(async (req, res) => {
  ok(res, serializeRun(await findRun(req.params.id, MEDIA)))
}))

/** POST /api/runs/:id/cancel */
router.post('/runs/:id/cancel', wrap(async (req, res) => {
  const run = await findRun(req.params.id, {})
  if (['succeeded', 'failed', 'canceled'].includes(run.status)) return ok(res, serializeRun(run), '运行已结束')
  const after = await getRunner().cancel(String(run._id))
  ok(res, serializeRun(after || run))
}))

/** POST /api/llm/tasks { model, prompt, systemPrompt?, imageUrls?, videoUrl? } -> { taskId } */
router.post('/llm/tasks', wrap(async (req, res) => {
  const body = req.body || {}
  const prompt = promptOf(body.prompt)
  const imageUrls = mediaList(body.imageUrls, 'imageUrls', 16)
  let videoUrls = []
  if (body.videoUrl !== undefined && body.videoUrl !== null && body.videoUrl !== '') {
    if (!isMediaUrl(body.videoUrl)) throw badRequest('videoUrl 不是有效的地址')
    videoUrls = [body.videoUrl]
  }
  if (!prompt.trim() && !imageUrls.length && !videoUrls.length) throw badRequest('请填写提示词')
  const run = await createRun({
    kind: 'chat',
    model: modelIdOf(body),
    prompt,
    systemPrompt: promptOf(body.systemPrompt, 'systemPrompt'),
    imageUrls,
    videoUrls,
    params: {},
    ...attribution(body),
  })
  ok(res, { taskId: String(run._id) })
}))

/** GET /api/llm/tasks/:id -> { status, text, error, cost } */
router.get('/llm/tasks/:id', wrap(async (req, res) => {
  const run = await findRun(req.params.id, CHAT)
  const s = serializeRun(run)
  ok(res, { id: s.id, status: s.status, progress: s.progress, text: s.text, error: s.error, cost: s.cost, model: s.model })
}))

module.exports = router
