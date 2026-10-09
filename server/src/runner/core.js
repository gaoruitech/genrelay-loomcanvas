'use strict'

/**
 * Run executor.
 *
 * An in-process queue with bounded concurrency. It owns the life cycle of a
 * run (queued -> running -> archiving -> succeeded | failed | canceled) and
 * nothing else: persistence, provider lookup, result transfer and billing are
 * injected, which is also what makes this file testable without a database.
 *
 * Rules it enforces:
 *  - every step has a hard total deadline (submit, poll, download, chat);
 *    a provider that never answers cannot hold a slot forever;
 *  - only errors that are safe to repeat are retried, a bounded number of times;
 *  - on shutdown, in-flight runs go back to `queued` so the next process
 *    resumes them (re-polling the upstream task when one was already created).
 *
 * Failure reasons are catalog messages (see ../i18n): a run stores the message
 * code and its parameters, and whoever reads the run later renders them in
 * their own language.
 *
 * Injected dependencies:
 *   store    { claim(id), get(id), update(id, patch), cancelQueued(id), recover() }
 *   resolve  async (run) -> { provider, cfg, request, sync? }
 *   transfer async (output, { signal, kind }) -> stored output
 *   billing  { beforeRun, afterRun, onFailed }
 *   settings () -> { concurrency, submitTimeoutMs, pollTimeoutMs:{image,video},
 *                    chatTimeoutMs, downloadTimeoutMs, retries }
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
    this.queue = []
    this.active = new Map() // runId -> { ctl, reason, promise }
    this.stopping = false
  }

  /** Recover unfinished runs from the store and start working. */
  async start() {
    const ids = await this.store.recover()
    for (const id of ids) this.enqueue(id)
    return ids.length
  }

  enqueue(id) {
    if (this.stopping) return
    const key = String(id)
    if (this.active.has(key) || this.queue.includes(key)) return
    this.queue.push(key)
    this._pump()
  }

  _pump() {
    const limit = Math.max(1, Number(this.settings().concurrency) || 1)
    while (!this.stopping && this.active.size < limit && this.queue.length) {
      const id = this.queue.shift()
      const entry = { ctl: new AbortController(), reason: null, promise: null }
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
    const idx = this.queue.indexOf(key)
    if (idx >= 0) this.queue.splice(idx, 1)
    await this.store.cancelQueued(key, { status: STATUS.CANCELED, ...storedError(CANCELED), finishedAt: new Date(this.now()) })
    return this.store.get(key)
  }

  /** Stop taking work and put in-flight runs back to `queued`. */
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
    const ctx = {
      runId: String(id),
      userId: run.userId,
      kind: run.kind,
      model: run.modelId,
      providerType: run.providerType,
      workflowId: run.workflowId || '',
      nodeId: run.nodeId || '',
      params: run.params || {},
      count: run.count || 1,
    }
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
        ? await this._chat(run, target, signal)
        : await this._generate(id, run, target, signal)

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
    } catch (err) {
      if (entry.reason === 'shutdown') {
        // Back to the queue; externalId (if any) is kept so the next process polls instead of resubmitting.
        await this.store.update(id, { status: STATUS.QUEUED }).catch((e) => this.log.error('[runner] requeue failed:', e.message))
        return
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

  async _chat(run, { provider, cfg, request }, signal) {
    if (typeof provider.chat !== 'function') throw new RunError('UNSUPPORTED', 'run.chat_unsupported')
    const cfgTimeout = this.settings().chatTimeoutMs
    const out = await withDeadline(
      (sig) => provider.chat(cfg, { ...request, signal: sig }),
      cfgTimeout, signal, 'run.timeout_chat'
    )
    const text = out && typeof out.text === 'string' ? out.text : ''
    if (!text) throw new RunError('EMPTY', 'upstream.no_text')
    const result = { text }
    if (out.usage) result.usage = out.usage
    if (out.cost) result.cost = out.cost
    return result
  }

  async _generate(id, run, target, signal) {
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
      for (const o of outputs) out.push(await this.transfer(o, { signal: sig, kind: run.kind }))
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
          (sig) => provider.submit(cfg, { ...request, signal: sig }),
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
          (sig) => provider.poll(cfg, { ...request, signal: sig }),
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
