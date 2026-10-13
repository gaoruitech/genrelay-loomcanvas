'use strict'

/**
 * The application's runner instance: core.js wired to MongoDB, the provider
 * registry, storage and the billing hook. Also the one place where a Run
 * document is created, so cost and validation rules live next to execution.
 *
 * A run belongs to a space (`userId`: an account's personal space, or a
 * team): it is resolved against that space's provider and key and its files go
 * under that space's key prefix. Who started it is `createdBy`: the queue is
 * fair per person by it, a team's limits count it per member, and the billing
 * hook is told both.
 */
const Run = require('../models/Run')
const registry = require('../providers')
const settings = require('../services/settings')
const { createMediaHelpers } = require('../services/media')
const { getStorage } = require('../storage')
const { getConfig } = require('../config')
const { loadBillingHook } = require('../billing')
const { Runner, RunError } = require('./core')
const { createMongoStore } = require('./mongoStore')
const { transferOutput } = require('./transfer')
const { estimateCost, tokenCost, chatReserve } = require('./pricing')
const { ApiError } = require('../utils/http')
const { messageOf, renderStored } = require('../i18n')
const User = require('../models/User')
const Team = require('../models/Team')
const TeamMember = require('../models/TeamMember')
const teams = require('../services/teams')
const budget = require('../services/budget')
const { BUDGET } = require('../constants')

let runner = null

/**
 * Runs that are queued or in flight at the same time, across all accounts.
 * Past this, new ones are refused instead of piling up in the queue (and at
 * the upstream). One account's own ceiling is the `userQueueLimit` setting.
 */
const limits = { unfinishedRuns: 500 }
const UNFINISHED = ['queued', 'running', 'archiving']

/** core.js `resolve`: a stored run -> the plugin call it needs. */
async function resolveRun(run) {
  // A team's run that has not reached the upstream yet is not sent for a team that was closed
  // or for somebody who is no longer in it. (Leaving and closing cancel what is queued; this
  // catches the run that was submitted in the same instant.)
  if (run.teamId && !run.externalId) {
    const [team, member] = await Promise.all([
      Team.findById(run.teamId).select('status').lean(),
      TeamMember.exists({ teamId: run.teamId, userId: run.createdBy }),
    ])
    if (!team || team.status !== 'active') throw new RunError('TEAM_CLOSED', 'run.team_closed')
    if (!member) throw new RunError('NOT_MEMBER', 'run.member_removed')
  }
  // Nor is anything sent for an account that was disabled while its run waited. (Disabling
  // cancels what is queued; this catches the run that was submitted in the same instant.)
  if (run.createdBy && !run.externalId && /^[0-9a-f]{24}$/i.test(String(run.createdBy))) {
    const starter = await User.findById(run.createdBy).select('disabled').lean()
    if (starter && starter.disabled) throw new RunError('ACCOUNT_DISABLED', 'run.account_disabled')
  }
  // Nor when the result could not be kept: the bucket in use cannot be written to (its saved
  // secret cannot be read). Said before the upstream is paid, not after it delivered.
  if (run.kind !== 'chat' && !run.externalId) {
    try { getStorage().assertWritable() } catch (err) { throw new RunError('NO_STORAGE', messageOf(err) || 'run.failed') }
  }
  let target
  try {
    // A run that was accepted keeps running even if its model was disabled meanwhile.
    // Looked up in the run's own space: the slug in the model id means nothing without it.
    target = await registry.resolveModel(run.modelId, { userId: run.userId, requireEnabled: false })
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

/**
 * The billing hook with the acting account filled in: `ctx.userId` is the id
 * of the account that started the run, `ctx.username` its current name ('' when
 * the account is gone or the run predates accounts). `ctx.spaceId` and
 * `ctx.teamId` (set by core.js) say where it runs.
 */
function withUser(hook) {
  const names = new Map() // userId -> { name, at }
  const NAME_TTL_MS = 60 * 1000
  async function usernameOf(userId) {
    const hit = names.get(userId)
    if (hit && Date.now() - hit.at < NAME_TTL_MS) return hit.name
    let name = ''
    if (/^[0-9a-f]{24}$/i.test(String(userId))) {
      const user = await User.findById(userId).select('username').lean().catch(() => null)
      name = (user && user.username) || ''
    }
    if (names.size > 1000) names.clear()
    names.set(userId, { name, at: Date.now() })
    return name
  }
  const wrap = (fn) => async (ctx, arg) => fn({ ...ctx, username: await usernameOf(ctx.userId) }, arg)
  return { beforeRun: wrap(hook.beforeRun), afterRun: wrap(hook.afterRun), onFailed: wrap(hook.onFailed) }
}

function getRunner() {
  if (!runner) {
    runner = new Runner({
      store: createMongoStore(),
      resolve: resolveRun,
      transfer: (output, { signal, userId }) => transferOutput(output, { signal, userId, timeoutMs: settings.runnerSettings().downloadTimeoutMs }),
      billing: withUser(loadBillingHook(getConfig().billingHook)),
      settings: settings.runnerSettings,
      groupLimit: teams.concurrencyOf,
    })
    // A raised concurrency limit takes effect without waiting for the next run.
    settings.onChange(() => runner.kick())
  }
  return runner
}

/**
 * Validate against the ModelSpec, price, persist and enqueue - as `user`, the
 * account making the request, in `space` (req.space: their personal space or
 * a team they are in). `input` is already shape-checked by the route.
 *
 * The model, its provider and its key are the space's: inside a team only the
 * team's providers exist, and a member's personal ones are never looked at.
 */
async function createRun(user, space, input) {
  const actorId = String(user._id)
  const userId = space ? String(space.id) : actorId
  const team = space && space.kind === 'team' ? space.team : null
  const { doc, spec, model } = await registry.resolveModel(input.model, { userId })
  if (!spec) throw new ApiError(400, 'model.unavailable')
  // input.kind is 'chat' (LLM task endpoint) or 'media' (run endpoint).
  const wantsChat = input.kind === 'chat'
  if (wantsChat !== (spec.kind === 'chat')) {
    throw new ApiError(400, wantsChat ? 'model.not_chat' : 'model.chat_only')
  }
  // An image or a video has to be stored: refused here (503) while storage cannot take it.
  if (!wantsChat) getStorage().assertWritable()
  // Said up front, rather than quietly answering about a video the model never saw.
  if (wantsChat && (input.videoUrls || []).length && !spec.acceptsVideo) {
    throw new ApiError(400, 'model.no_video_input')
  }
  // The same for pictures: a text-only chat model is told so, not handed a
  // prompt about images that were dropped on the way.
  if (wantsChat && (input.imageUrls || []).length && !spec.acceptsImage) {
    throw new ApiError(400, 'model.no_image_input')
  }
  // The person's own ceiling first (whichever spaces their runs are in), then the one for the whole instance.
  const own = settings.get('userQueueLimit')
  if ((await Run.countDocuments({ $or: [{ createdBy: actorId }, { userId: actorId }], status: { $in: UNFINISHED } })) >= own) {
    throw new ApiError(429, 'run.queue_full', { max: own })
  }
  if ((await Run.countDocuments({ status: { $in: UNFINISHED } })) >= limits.unfinishedRuns) {
    throw new ApiError(429, 'run.queue_full', { max: limits.unfinishedRuns })
  }
  const params = { ...spec.defaults, ...input.params }
  const count = Number.isInteger(params.count) && params.count > 0 ? params.count : 1
  const est = estimateCost(spec, params, count)

  const record = (extra) => Run.create({
    ...extra,
    userId,
    createdBy: actorId,
    teamId: team ? userId : '',
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
  let run
  if (team) {
    const fresh = await Team.findById(userId).lean()
    const member = await TeamMember.findOne({ teamId: userId, userId: actorId }).lean()
    if (!fresh || fresh.status !== 'active' || !member) throw new ApiError(404, 'team.not_found')
    // The team's monthly limits. A place is taken in the team's counter first - one atomic
    // update that only goes through while every limit has room, so of any number of
    // submissions at the same moment, in any number of processes, exactly as many are
    // accepted as fit (services/budget.js) - and the run is written with what it holds.
    // A chat model priced per token is costed when it is done; until then it holds a reserve.
    const reserve = spec.kind === 'chat'
      ? chatReserve(spec, input, {
        outputTokens: BUDGET.CHAT_RESERVE_OUTPUT_TOKENS,
        tokensPerChar: BUDGET.CHAT_RESERVE_TOKENS_PER_CHAR,
        tokensPerImage: BUDGET.CHAT_RESERVE_TOKENS_PER_IMAGE,
        tokensPerVideo: BUDGET.CHAT_RESERVE_TOKENS_PER_VIDEO,
      })
      : null
    const stamp = await budget.reserve(fresh, member, { spec, est, reserve })
    try {
      run = await record({ _id: stamp.runId, budget: stamp.budget })
    } catch (err) {
      await budget.cancel(userId, actorId, stamp).catch(() => {})
      throw err
    }
    await budget.confirm(userId, stamp).catch(() => {})
  } else {
    run = await record({})
  }
  getRunner().enqueue(String(run._id), actorId, team ? userId : '')
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
