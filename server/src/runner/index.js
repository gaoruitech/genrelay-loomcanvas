'use strict'

/**
 * The application's runner instance: core.js wired to MongoDB, the provider
 * registry, storage and the billing hook. Also the one place where a Run
 * document is created, so cost and validation rules live next to execution.
 */
const Run = require('../models/Run')
const registry = require('../providers')
const settings = require('../services/settings')
const { createMediaHelpers } = require('../services/media')
const { getConfig } = require('../config')
const { loadBillingHook } = require('../billing')
const { Runner, RunError } = require('./core')
const { createMongoStore } = require('./mongoStore')
const { transferOutput } = require('./transfer')
const { estimateCost, tokenCost } = require('./pricing')
const { ApiError } = require('../utils/http')
const { messageOf, renderStored } = require('../i18n')
const { LOCAL_USER } = require('../constants')

let runner = null

/**
 * Runs that are queued or in flight at the same time. Past this, new ones are
 * refused instead of piling up in the queue (and at the upstream).
 */
const limits = { unfinishedRuns: 500 }
const UNFINISHED = ['queued', 'running', 'archiving']

/** core.js `resolve`: a stored run -> the plugin call it needs. */
async function resolveRun(run) {
  let target
  try {
    // A run that was accepted keeps running even if its model was disabled meanwhile.
    target = await registry.resolveModel(run.modelId, { requireEnabled: false })
  } catch (err) {
    throw new RunError('NO_PROVIDER', messageOf(err) || 'run.no_provider')
  }
  const { plugin, cfg, spec } = target
  const request = {
    id: String(run._id || run.id),
    kind: run.kind,
    model: run.upstreamModel,
    spec,
    prompt: run.prompt || '',
    systemPrompt: run.systemPrompt || '',
    imageUrls: run.imageUrls || [],
    videoUrls: run.videoUrls || [],
    videoUrl: (run.videoUrls || [])[0] || '',
    params: run.params || {},
    externalId: run.externalId || '',
    // Built per provider call, bound to that call's abort signal (see core.js forCall).
    mediaFor: (signal) => createMediaHelpers(signal),
  }
  const provider = run.kind === 'chat'
    ? {
      ...plugin,
      // Token-priced models are costed after the fact, from reported usage.
      async chat(c, req) {
        const out = await plugin.chat(c, req)
        if (out && out.usage) {
          const cost = tokenCost(spec, out.usage)
          if (!cost.unknown) out.cost = cost
        }
        return out
      },
    }
    : plugin
  return { provider, cfg, request, sync: plugin.sync === true }
}

function getRunner() {
  if (!runner) {
    runner = new Runner({
      store: createMongoStore(),
      resolve: resolveRun,
      transfer: (output, { signal }) => transferOutput(output, { signal, timeoutMs: settings.runnerSettings().downloadTimeoutMs }),
      billing: loadBillingHook(getConfig().billingHook),
      settings: settings.runnerSettings,
    })
    // A raised concurrency limit takes effect without waiting for the next run.
    settings.onChange(() => runner.kick())
  }
  return runner
}

/**
 * Validate against the ModelSpec, price, persist and enqueue.
 * `input` is already shape-checked by the route.
 */
async function createRun(input) {
  const { doc, spec, model } = await registry.resolveModel(input.model)
  if (!spec) throw new ApiError(400, 'model.unavailable')
  // input.kind is 'chat' (LLM task endpoint) or 'media' (run endpoint).
  const wantsChat = input.kind === 'chat'
  if (wantsChat !== (spec.kind === 'chat')) {
    throw new ApiError(400, wantsChat ? 'model.not_chat' : 'model.chat_only')
  }
  // Said up front, rather than quietly answering about a video the model never saw.
  if (wantsChat && (input.videoUrls || []).length && !spec.acceptsVideo) {
    throw new ApiError(400, 'model.no_video_input')
  }
  // The same for pictures: a text-only chat model is told so, not handed a
  // prompt about images that were dropped on the way.
  if (wantsChat && (input.imageUrls || []).length && !spec.acceptsImage) {
    throw new ApiError(400, 'model.no_image_input')
  }
  if ((await Run.countDocuments({ userId: LOCAL_USER, status: { $in: UNFINISHED } })) >= limits.unfinishedRuns) {
    throw new ApiError(429, 'run.queue_full', { max: limits.unfinishedRuns })
  }
  const params = { ...spec.defaults, ...input.params }
  const count = Number.isInteger(params.count) && params.count > 0 ? params.count : 1
  const est = estimateCost(spec, params, count)

  const run = await Run.create({
    userId: LOCAL_USER,
    kind: spec.kind,
    modelId: spec.id,
    modelLabel: spec.label,
    providerId: doc._id,
    providerType: doc.type,
    upstreamModel: model,
    prompt: input.prompt || '',
    systemPrompt: input.systemPrompt || '',
    imageUrls: (input.imageUrls || []).slice(0, Math.max(spec.maxReferenceImages || 0, spec.acceptsImage ? 1 : 0)),
    videoUrls: spec.acceptsVideo ? (input.videoUrls || []).slice(0, 1) : [],
    params,
    count,
    workflowId: input.workflowId || '',
    nodeId: input.nodeId || '',
    cost: { amount: est.totalCost, currency: est.currency, unknown: est.unknown },
  })
  getRunner().enqueue(String(run._id))
  return run
}

/** Run document -> the contract's Run shape, its failure reason in the reader's language. */
function serializeRun(run, locale) {
  return {
    id: String(run._id),
    status: run.status,
    progress: run.progress || 0,
    outputs: (run.outputs || []).map((o) => ({
      type: o.type,
      url: o.url,
      thumbnailUrl: o.thumbnailUrl || '',
      ...(o.width ? { width: o.width, height: o.height } : {}),
    })),
    text: run.text || '',
    error: renderStored(locale, run),
    errorCode: run.errorCode || '',
    cost: {
      amount: (run.cost && run.cost.amount) || 0,
      currency: (run.cost && run.cost.currency) || '',
      unknown: !run.cost || run.cost.unknown !== false,
    },
    model: run.modelId,
    modelLabel: run.modelLabel || '',
    kind: run.kind,
    workflowId: run.workflowId || '',
    nodeId: run.nodeId || '',
    createdAt: run.createdAt,
    startedAt: run.startedAt || null,
    finishedAt: run.finishedAt || null,
  }
}

module.exports = { getRunner, createRun, serializeRun, resolveRun, limits }
