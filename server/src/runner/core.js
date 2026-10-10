'use strict'

/**
 * Run executor.
 *
 * An in-process queue with bounded concurrency, shared fairly between the
 * accounts that have work in it (see _pick). It owns the life cycle of a
 * run (queued -> running -> archiving -> succeeded | failed | canceled) and
 * nothing else: persistence, provider lookup, result transfer and billing are
 * injected, which is also what makes this file testable without a database.
 *
 * Rules it enforces:
 *  - every step has a hard total deadline (submit, poll, download, chat);
 *    a provider that never answers cannot hold a slot forever;
 *  - only errors that are safe to repeat are retried, a bounded number of times;
 *  - nothing is ever sent to an upstream twice. On shutdown, a run goes back to
 *    `queued` only when repeating it is known to be harmless: it has an upstream
 *    task to re-poll, or nothing was sent for it yet. A run caught in between
 *    (request sent, no task id back - every synchronous provider and every chat)
 *    fails with `run.interrupted`; the same goes for runs found mid-flight after
 *    a crash;
 *  - billing.onFailed is called for every run that billing.beforeRun allowed
 *    and that did not succeed, including the ones failed at start-up after a
 *    crash. That call is at-least-once: a crash between the hook and the record
 *    update repeats it at the next start, so hooks should key on ctx.runId.
 *
 * Failure reasons are catalog messages (see ../i18n): a run stores the message
 * code and its parameters, and whoever reads the run later renders them in
 * their own language.
 *
 * Injected dependencies:
 *   store    { claim(id), get(id), update(id, patch), cancelQueued(id),
 *              recover() -> { queued: [{ id, userId }], interrupted: run[] } }
 *   resolve  async (run) -> { provider, cfg, request, sync? }
 *   transfer async (output, { signal, kind, userId }) -> stored output
 *   billing  { beforeRun, afterRun, onFailed }
 *   settings () -> { concurrency, userConcurrency?, submitTimeoutMs,
 *                    pollTimeoutMs:{image,video}, chatTimeoutMs,
 *                    downloadTimeoutMs, retries }
 */

const { LocalizedError, RAW, isMessage, msg, messageOf, storedError } = require('../i18n')

const STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  ARCHIVING: 'archiving',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
}

/** An error whose message (a catalog key or message object) is meant for the user. */
class RunError extends LocalizedError {
  constructor(code, key, params = {}, extra = {}) {
    super(key, params, extra)
    this.name = 'RunError'
    this.code = code
  }
}

const CANCELED = msg('run.canceled')
const POLL_CALL_TIMEOUT_MS = 30 * 1000
const MAX_CONSECUTIVE_POLL_ERRORS = 5

/** What a failed run tells the user: the error's own message when it has one. */
function failureMessage(err) {
  return messageOf(err) || msg('run.failed')
}

/** Billing context of a run, as the hooks receive it. */
function billingContext(run) {
  return {
    runId: String(run._id || run.id),
    userId: run.userId,
    kind: run.kind,
    model: run.modelId,
    providerType: run.providerType,
    workflowId: run.workflowId || '',
    nodeId: run.nodeId || '',
    params: run.params || {},
    count: run.count || 1,
  }
}

/**
 * The request as one provider call sees it: with that call's abort signal, and
 * with media helpers bound to the same signal, so loading reference media stops
 * with the call (deadline, cancel, shutdown).
 */
function forCall(request, signal) {
  const { mediaFor, ...rest } = request
  return typeof mediaFor === 'function' ? { ...rest, signal, media: mediaFor(signal) } : { ...rest, signal }
}

function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Run fn(signal) with a hard deadline. Rejects when the deadline passes or the
 * parent signal aborts, even if fn ignores its signal.
 */
async function withDeadline(fn, ms, parent, timeoutKey) {
  if (parent.aborted) throw parent.reason
  if (!(ms > 0)) throw new RunError('TIMEOUT', timeoutKey)
  const ctl = new AbortController()
  const onParent = () => ctl.abort(parent.reason)
  parent.addEventListener('abort', onParent, { once: true })
  const timer = setTimeout(() => ctl.abort(new RunError('TIMEOUT', timeoutKey)), ms)
  try {
    const work = Promise.resolve().then(() => fn(ctl.signal))
    work.catch(() => {}) // a late rejection after the race is settled is not an unhandled one
    const aborted = new Promise((_, reject) => {
      ctl.signal.addEventListener('abort', () => reject(ctl.signal.reason), { once: true })
    })
    aborted.catch(() => {})
    return await Promise.race([work, aborted])
  } finally {
    clearTimeout(timer)
    parent.removeEventListener('abort', onParent)
  }
}

class Runner {
  constructor({ store, resolve, transfer, billing, settings, logger = console, now = () => Date.now(), pollIntervalMs = [2000, 8000] }) {
    this.store = store
    this.resolve = resolve
    this.transfer = transfer
    this.billing = billing
    this.settings = settings
    this.log = logger
    this.now = now
    this.pollIntervalMs = pollIntervalMs
    this.queue = [] // { id, userId }, oldest first
    this.active = new Map() // runId -> { ctl, reason, promise, sent, userId }
    this.lastTurn = new Map() // userId -> when that account last got a slot (a counter, not a time)
    this.turns = 0
    this.stopping = false
  }

  /**
   * Recover unfinished runs from the store and start working. Runs the last
   * process left mid-flight without an upstream task are failed here (nobody
   * knows whether the upstream took them), after telling the billing hook.
   */
  async start() {
    const { queued, interrupted } = await this.store.recover()
    for (const run of interrupted) {
      const error = new RunError('INTERRUPTED', 'run.interrupted')
      // Hook first, record second: a crash in between repeats the hook rather than losing it.
      if (run.billingStarted) await this._hook('onFailed', billingContext(run), error)
      await this.store.update(String(run._id || run.id), {
        status: STATUS.FAILED,
        ...storedError(failureMessage(error)),
        finishedAt: new Date(this.now()),
      })
    }
    for (const q of queued) {
      if (q && typeof q === 'object') this.enqueue(q.id, q.userId)
      else this.enqueue(q)
    }
    return queued.length
  }

  /** `userId` is whose run it is: the queue is shared out between accounts by it. */
  enqueue(id, userId = '') {
    if (this.stopping) return
    const key = String(id)
    if (this.active.has(key) || this.queue.some((q) => q.id === key)) return
    this.queue.push({ id: key, userId: String(userId || '') })
    this._pump()
  }

  /**
   * Index of the queued run to start next, or -1. The account with the fewest
   * runs in flight goes first; among those, the one that was given a slot
   * longest ago; within an account, its oldest run. An account at its own limit
   * waits. So one account with a hundred queued runs does not keep everybody
   * else waiting behind them, and with a single account this is plain FIFO.
   */
  _pick(perUser) {
    const busy = new Map()
    for (const e of this.active.values()) busy.set(e.userId, (busy.get(e.userId) || 0) + 1)
    let best = -1
    let bestBusy = Infinity
    let bestTurn = Infinity
    for (let i = 0; i < this.queue.length; i++) {
      const { userId } = this.queue[i]
      const n = busy.get(userId) || 0
      const turn = this.lastTurn.get(userId) || 0
      if (n >= perUser || n > bestBusy || (n === bestBusy && turn >= bestTurn)) continue
      best = i
      bestBusy = n
      bestTurn = turn
    }
    return best
  }

  _pump() {
    const s = this.settings()
    const limit = Math.max(1, Number(s.concurrency) || 1)
    const perUser = Math.max(1, Number(s.userConcurrency) || limit)
    while (!this.stopping && this.active.size < limit && this.queue.length) {
      const at = this._pick(perUser)
      if (at < 0) break // everything queued belongs to accounts that are at their limit
      const [{ id, userId }] = this.queue.splice(at, 1)
      if (this.lastTurn.size > 10000) this.lastTurn.clear()
      this.lastTurn.set(userId, ++this.turns)
      // `sent`: something of this run may have reached the upstream in this process.
      const entry = { ctl: new AbortController(), reason: null, promise: null, sent: false, userId }
      this.active.set(id, entry)
      entry.promise = this._execute(id, entry)
        .catch((err) => this.log.error(`[runner] run ${id} crashed:`, err))
        .finally(() => { this.active.delete(id); this._pump() })
    }
  }

  /** Re-evaluate the queue, e.g. after the concurrency setting grew. */
  kick() { this._pump() }

  /** Cancel a queued or in-flight run. Resolves the run as stored afterwards. */
  async cancel(id) {
    const key = String(id)
    const entry = this.active.get(key)
    if (entry) {
      if (!entry.reason) {
        entry.reason = 'cancel'
        entry.ctl.abort(new RunError('CANCELED', CANCELED))
      }
      await entry.promise
      return this.store.get(key)
    }
    const idx = this.queue.findIndex((q) => q.id === key)
    if (idx >= 0) this.queue.splice(idx, 1)
    await this.store.cancelQueued(key, { status: STATUS.CANCELED, ...storedError(CANCELED), finishedAt: new Date(this.now()) })
    return this.store.get(key)
  }

  /** Stop taking work; in-flight runs go back to `queued` or fail (see the rules at the top). */
  async shutdown() {
    this.stopping = true
    this.queue.length = 0
    const pending = []
    for (const entry of this.active.values()) {
      if (!entry.reason) {
        entry.reason = 'shutdown'
        entry.ctl.abort(new RunError('SHUTDOWN', 'run.restarting'))
      }
      pending.push(entry.promise)
    }
    await Promise.allSettled(pending)
  }

  async _hook(name, ...args) {
    try { await this.billing[name](...args) } catch (err) {
      this.log.error(`[runner] billing.${name} threw:`, err && err.message)
    }
  }

  async _execute(id, entry) {
    let run = await this.store.claim(id, { status: STATUS.RUNNING, startedAt: new Date(this.now()) })
    if (!run) return // already taken, finished or canceled
    const signal = entry.ctl.signal
    const ctx = { ...billingContext(run), runId: String(id) }
    let billed = !!run.billingStarted
    try {
      if (signal.aborted) throw signal.reason
      const target = await this.resolve(run)

      if (!billed) {
        let verdict
        try {
          verdict = await this.billing.beforeRun(ctx, run.cost)
        } catch (err) {
          this.log.error('[runner] billing.beforeRun threw:', err && err.message)
          throw new RunError('BILLING_ERROR', 'run.billing_error')
        }
        if (verdict && verdict.allow === false) {
          // The hook's own reason is free text and is shown as it is.
          throw new RunError('BILLING_DENIED', verdict.reason
            ? msg(RAW, { text: String(verdict.reason).slice(0, 300) })
            : msg('run.billing_denied'))
        }
        billed = true
        run = await this.store.update(id, { billingStarted: true })
        if (signal.aborted) throw signal.reason
      }

      const result = run.kind === 'chat'
        ? await this._chat(run, target, signal, entry)
        : await this._generate(id, run, target, signal, entry)

      await this.store.update(id, {
        ...result,
        status: STATUS.SUCCEEDED,
        progress: 100,
        error: '',
        errorCode: '',
        errorParams: {},
        finishedAt: new Date(this.now()),
      })
      await this._hook('afterRun', ctx, result)
    } catch (caught) {
      let err = caught
      if (entry.reason === 'shutdown') {
        const current = await this.store.get(id).catch(() => null)
        if ((current && current.externalId) || !entry.sent) {
          // Back to the queue: the next process polls the upstream task, or starts from scratch.
          await this.store.update(id, { status: STATUS.QUEUED }).catch((e) => this.log.error('[runner] requeue failed:', e.message))
          return
        }
        // Sent, and no task id to ask about: running it again could bill it twice.
        err = new RunError('INTERRUPTED', 'run.interrupted')
      }
      const canceled = entry.reason === 'cancel'
      if (!canceled && !(err && err.userFacing)) {
        this.log.error(`[runner] run ${id} failed:`, err)
      }
      await this.store.update(id, {
        status: canceled ? STATUS.CANCELED : STATUS.FAILED,
        ...storedError(canceled ? CANCELED : failureMessage(err)),
        finishedAt: new Date(this.now()),
      })
      if (billed) await this._hook('onFailed', ctx, canceled ? new RunError('CANCELED', CANCELED) : err)
    }
  }

  async _chat(run, { provider, cfg, request }, signal, entry) {
    if (typeof provider.chat !== 'function') throw new RunError('UNSUPPORTED', 'run.chat_unsupported')
    const cfgTimeout = this.settings().chatTimeoutMs
    entry.sent = true
    const out = await withDeadline(
      (sig) => provider.chat(cfg, forCall(request, sig)),
      cfgTimeout, signal, 'run.timeout_chat'
    )
    const text = out && typeof out.text === 'string' ? out.text : ''
    if (!text) throw new RunError('EMPTY', 'upstream.no_text')
    const result = { text }
    if (out.usage) result.usage = out.usage
    if (out.cost) result.cost = out.cost
    return result
  }

  async _generate(id, run, target, signal, entry) {
    const { provider, cfg, request } = target
    const s = this.settings()
    const pollTimeout = s.pollTimeoutMs[run.kind] || s.pollTimeoutMs.image
    let outputs = null
    let externalId = run.externalId || ''
    let submittedAt = run.submittedAt ? new Date(run.submittedAt).getTime() : null

    if (!externalId) {
      // A synchronous provider does all its work inside submit(), so it gets
      // the generation deadline instead of the short submit deadline.
      const budget = target.sync ? pollTimeout : s.submitTimeoutMs
      entry.sent = true
      const res = await this._submit(provider, cfg, request, budget, s.retries, signal, target.sync)
      if (res && Array.isArray(res.outputs) && res.outputs.length) {
        outputs = res.outputs
      } else if (res && res.externalId) {
        externalId = String(res.externalId)
        submittedAt = this.now()
        await this.store.update(id, { externalId, submittedAt: new Date(submittedAt), progress: Math.max(run.progress || 0, 5) })
      } else {
        throw new RunError('BAD_SUBMIT', 'upstream.no_task_id')
      }
    }

    if (!outputs) {
      // The deadline counts from the original submission, so restarts never extend it.
      const deadline = (submittedAt || this.now()) + pollTimeout
      outputs = await this._poll(id, run, provider, cfg, { ...request, externalId }, deadline, signal)
    }

    await this.store.update(id, { status: STATUS.ARCHIVING, progress: 95 })
    const stored = await withDeadline(async (sig) => {
      const out = []
      for (const o of outputs) out.push(await this.transfer(o, { signal: sig, kind: run.kind, userId: run.userId }))
      return out
    }, s.downloadTimeoutMs, signal, 'run.timeout_download')
    return { outputs: stored }
  }

  async _submit(provider, cfg, request, budgetMs, retries, signal, sync) {
    const deadline = this.now() + budgetMs
    const timeoutKey = sync ? 'run.timeout_generate' : 'run.timeout_submit'
    for (let attempt = 0; ; attempt++) {
      try {
        return await withDeadline(
          (sig) => provider.submit(cfg, forCall(request, sig)),
          deadline - this.now(), signal, timeoutKey
        )
      } catch (err) {
        // Only retry when the upstream certainly did not accept the task;
        // anything ambiguous could create (and bill) a duplicate.
        const repeatable = err && err.safeToResubmit === true
        if (!repeatable || attempt >= retries || signal.aborted) throw err
        const wait = Math.min(1000 * 2 ** attempt, 8000)
        if (this.now() + wait >= deadline) throw err
        await abortableSleep(wait, signal)
      }
    }
  }

  async _poll(id, run, provider, cfg, request, deadline, signal) {
    let lastProgress = run.progress || 0
    let errors = 0
    const [minGap, maxGap] = this.pollIntervalMs
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - this.now()
      if (remaining <= 0) throw new RunError('TIMEOUT', 'run.timeout_generate')
      await abortableSleep(Math.min(remaining, Math.min(maxGap, minGap * (1 + attempt * 0.5))), signal)
      if (deadline - this.now() <= 0) throw new RunError('TIMEOUT', 'run.timeout_generate')

      let res
      try {
        res = await withDeadline(
          (sig) => provider.poll(cfg, forCall(request, sig)),
          Math.min(POLL_CALL_TIMEOUT_MS, deadline - this.now()), signal, 'run.timeout_generate'
        )
        errors = 0
      } catch (err) {
        if (signal.aborted) throw signal.reason
        if (this.now() >= deadline) throw new RunError('TIMEOUT', 'run.timeout_generate')
        // A status query is always safe to repeat. Transient errors are ridden
        // out until the deadline; persistent hard errors give up early.
        if (err && (err.transient || err.code === 'TIMEOUT')) continue
        if (++errors >= MAX_CONSECUTIVE_POLL_ERRORS) throw err
        continue
      }

      const status = res && res.status
      if (status === 'succeeded') {
        if (!Array.isArray(res.outputs) || !res.outputs.length) throw new RunError('EMPTY', 'upstream.no_outputs')
        return res.outputs
      }
      if (status === 'failed') {
        // A provider reports either its own message or the upstream's free text,
        // which is passed on untranslated inside a sentence of ours.
        const reason = res.error
        if (isMessage(reason)) throw new RunError('UPSTREAM_FAILED', reason)
        throw new RunError('UPSTREAM_FAILED', reason
          ? msg('upstream.failed_detail', { detail: String(reason).slice(0, 400) })
          : msg('upstream.failed'))
      }
      const progress = Math.min(94, Math.max(lastProgress, Math.round(Number(res && res.progress) || 0)))
      if (progress > lastProgress) {
        lastProgress = progress
        await this.store.update(id, { progress })
      }
    }
  }
}

module.exports = { Runner, RunError, STATUS, withDeadline, abortableSleep, failureMessage }
