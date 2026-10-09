'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Runner, RunError, withDeadline } = require('../src/runner/core')
const { createMemoryStore } = require('../src/runner/memoryStore')

const silent = { error() {}, warn() {}, log() {} }

function baseSettings(over = {}) {
  return () => ({
    concurrency: 2,
    submitTimeoutMs: 200,
    pollTimeoutMs: { image: 400, video: 400 },
    chatTimeoutMs: 200,
    downloadTimeoutMs: 200,
    retries: 2,
    ...over,
  })
}

/** Billing hook that records every call. */
function recordingBilling(verdict = { allow: true }) {
  const calls = []
  return {
    calls,
    async beforeRun(ctx, cost) { calls.push(['beforeRun', ctx.runId, cost]); return verdict },
    async afterRun(ctx) { calls.push(['afterRun', ctx.runId]) },
    async onFailed(ctx, err) { calls.push(['onFailed', ctx.runId, err && err.code]) },
  }
}

function setup({ provider, settings, billing, transfer, sync = false, runs = [] } = {}) {
  const store = createMemoryStore(runs)
  const bill = billing || recordingBilling()
  const runner = new Runner({
    store,
    resolve: async () => ({ provider, cfg: { apiKey: 'k' }, request: { model: 'm', prompt: 'p' }, sync }),
    transfer: transfer || (async (o) => ({ type: o.type, url: `stored:${o.url}`, thumbnailUrl: `thumb:${o.url}` })),
    billing: bill,
    settings: settings || baseSettings(),
    logger: silent,
    pollIntervalMs: [5, 10],
  })
  return { store, runner, billing: bill }
}

function newRun(store, over = {}) {
  return store.insert({ kind: 'image', modelId: 'p:m', providerType: 'fake', cost: { amount: 1, currency: 'CNY', unknown: false }, ...over })
}

/** Poll the store until the run reaches a final state. */
async function settled(store, id, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const run = await store.get(id)
    if (['succeeded', 'failed', 'canceled'].includes(run.status)) return run
    if (Date.now() > end) throw new Error(`run ${id} still ${run.status}`)
    await new Promise((r) => setTimeout(r, 5))
  }
}

async function until(fn, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs
  while (!(await fn())) {
    if (Date.now() > end) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 5))
  }
}

test('async provider: submit, poll with progress, archive, succeed', async () => {
  let polls = 0
  const seen = []
  const provider = {
    async submit() { return { externalId: 'ext-1' } },
    async poll(_cfg, req) {
      seen.push(req.externalId)
      polls++
      if (polls < 3) return { status: 'running', progress: polls * 30 }
      return { status: 'succeeded', outputs: [{ type: 'image', url: 'https://up/a.png' }] }
    },
  }
  const { store, runner, billing } = setup({ provider })
  const id = newRun(store)
  runner.enqueue(id)
  const run = await settled(store, id)

  assert.equal(run.status, 'succeeded')
  assert.equal(run.progress, 100)
  assert.equal(run.externalId, 'ext-1')
  assert.deepEqual(run.outputs, [{ type: 'image', url: 'stored:https://up/a.png', thumbnailUrl: 'thumb:https://up/a.png' }])
  assert.ok(run.startedAt && run.finishedAt && run.submittedAt)
  assert.deepEqual(seen, ['ext-1', 'ext-1', 'ext-1'])
  assert.deepEqual(billing.calls.map((c) => c[0]), ['beforeRun', 'afterRun'])
  assert.deepEqual(billing.calls[0][2], { amount: 1, currency: 'CNY', unknown: false })
})

test('sync provider: outputs straight from submit, never polled', async () => {
  const provider = {
    async submit() { return { outputs: [{ type: 'image', b64: 'AAAA' }] } },
    async poll() { throw new Error('must not be called') },
  }
  const { store, runner } = setup({ provider, sync: true, transfer: async (o) => ({ type: 'image', url: `stored:${o.b64}` }) })
  const id = newRun(store)
  runner.enqueue(id)
  const run = await settled(store, id)
  assert.equal(run.status, 'succeeded')
  assert.equal(run.outputs[0].url, 'stored:AAAA')
  assert.equal(run.externalId, '')
})

test('upstream reports failure: run fails with the upstream reason, onFailed fires', async () => {
  const provider = {
    async submit() { return { externalId: 'x' } },
    async poll() { return { status: 'failed', error: '内容违规' } },
  }
  const { store, runner, billing } = setup({ provider })
  const id = newRun(store)
  runner.enqueue(id)
  const run = await settled(store, id)
  assert.equal(run.status, 'failed')
  // The upstream's words are kept as a parameter of our own message.
  assert.equal(run.errorCode, 'upstream.failed_detail')
  assert.deepEqual(run.errorParams, { detail: '内容违规' })
  assert.ok(run.error.includes('内容违规'))
  assert.deepEqual(billing.calls.map((c) => c[0]), ['beforeRun', 'onFailed'])
})

test('internal errors are not leaked to the user', async () => {
  const provider = {
    async submit() { throw new Error('ENOENT: /srv/secret/path sk-live-123') },
    async poll() {},
  }
  const { store, runner } = setup({ provider })
  const id = newRun(store)
  runner.enqueue(id)
  const run = await settled(store, id)
  assert.equal(run.status, 'failed')
  assert.ok(!run.error.includes('secret') && !run.error.includes('sk-live'))
})

test('submit that never answers hits the submit deadline', async () => {
  const provider = { submit: () => new Promise(() => {}), async poll() {} }
  const { store, runner } = setup({ provider, settings: baseSettings({ submitTimeoutMs: 60 }) })
  const id = newRun(store)
  const t0 = Date.now()
  runner.enqueue(id)
  const run = await settled(store, id)
  assert.equal(run.status, 'failed')
  assert.equal(run.errorCode, 'run.timeout_submit')
  assert.ok(Date.now() - t0 < 1000, 'failed promptly')
})

test('a task that never finishes hits the poll deadline', async () => {
  let polls = 0
  const provider = {
    async submit() { return { externalId: 'slow' } },
    async poll() { polls++; return { status: 'running', progress: 10 } },
  }
  const { store, runner } = setup({ provider, settings: baseSettings({ pollTimeoutMs: { image: 80, video: 80 } }) })
  const id = newRun(store)
  runner.enqueue(id)
  const run = await settled(store, id)
  assert.equal(run.status, 'failed')
  assert.equal(run.errorCode, 'run.timeout_generate')
  assert.ok(polls >= 2)
})

test('a poll call that hangs cannot outlive the poll deadline', async () => {
  const provider = {
    async submit() { return { externalId: 'hang' } },
    poll: () => new Promise(() => {}),
  }
  const { store, runner } = setup({ provider, settings: baseSettings({ pollTimeoutMs: { image: 80, video: 80 } }) })
  const id = newRun(store)
  runner.enqueue(id)
  const run = await settled(store, id)
  assert.equal(run.status, 'failed')
  assert.equal(run.errorCode, 'run.timeout_generate')
})

test('download that hangs hits the download deadline', async () => {
  const provider = {
    async submit() { return { externalId: 'd' } },
    async poll() { return { status: 'succeeded', outputs: [{ type: 'video', url: 'https://up/v.mp4' }] } },
  }
  const { store, runner } = setup({
    provider,
    transfer: () => new Promise(() => {}),
    settings: baseSettings({ downloadTimeoutMs: 60 }),
  })
  const id = newRun(store, { kind: 'video' })
  runner.enqueue(id)
  const run = await settled(store, id)
  assert.equal(run.status, 'failed')
  assert.equal(run.errorCode, 'run.timeout_download')
})

test('cancel while polling: aborts the provider call, marks canceled, refunds', async () => {
  let aborted = false
  let polling = false
  const provider = {
    async submit() { return { externalId: 'c' } },
    poll: (_cfg, req) => new Promise((_, reject) => {
      polling = true
      req.signal.addEventListener('abort', () => { aborted = true; reject(req.signal.reason) })
    }),
  }
  const { store, runner, billing } = setup({ provider, settings: baseSettings({ pollTimeoutMs: { image: 5000, video: 5000 } }) })
  const id = newRun(store)
  runner.enqueue(id)
  await until(() => polling)
  const after = await runner.cancel(id)
  assert.equal(after.status, 'canceled')
  assert.equal(aborted, true)
  assert.deepEqual(billing.calls.at(-1), ['onFailed', id, 'CANCELED'])
  assert.equal(runner.active.size, 0)
})

test('cancel while queued: never starts, no billing calls', async () => {
  let submits = 0
  const gate = { release: null }
  const provider = {
    submit: () => { submits++; return new Promise((resolve) => { gate.release = () => resolve({ outputs: [{ type: 'image', url: 'u' }] }) }) },
    async poll() {},
  }
  const { store, runner, billing } = setup({ provider, sync: true, settings: baseSettings({ concurrency: 1 }) })
  const first = newRun(store)
  const second = newRun(store)
  runner.enqueue(first)
  runner.enqueue(second)
  await until(() => submits === 1)
  const canceled = await runner.cancel(second)
  assert.equal(canceled.status, 'canceled')
  gate.release()
  await settled(store, first)
  assert.equal(submits, 1, 'the canceled run was never submitted')
  assert.ok(!billing.calls.some((c) => c[1] === second))
})

test('billing hook can deny a run; nothing is sent upstream', async () => {
  let submits = 0
  const provider = { async submit() { submits++; return { externalId: 'x' } }, async poll() {} }
  const billing = recordingBilling({ allow: false, reason: '余额不足' })
  const { store, runner } = setup({ provider, billing })
  const id = newRun(store)
  runner.enqueue(id)
  const run = await settled(store, id)
  assert.equal(run.status, 'failed')
  assert.equal(run.error, '余额不足')
  assert.equal(submits, 0)
  // Denied before anything was charged: no onFailed either.
  assert.deepEqual(billing.calls.map((c) => c[0]), ['beforeRun'])
})

test('submit retries only errors that are safe to resubmit, within the retry budget', async () => {
  const transient = () => Object.assign(new Error('refused'), { userFacing: true, transient: true, safeToResubmit: true })
  let calls = 0
  const provider = {
    async submit() { calls++; if (calls < 3) throw transient(); return { outputs: [{ type: 'image', url: 'ok' }] } },
    async poll() {},
  }
  const fast = setup({ provider, sync: true, settings: baseSettings({ pollTimeoutMs: { image: 8000, video: 8000 }, retries: 2 }) })
  const id = newRun(fast.store)
  fast.runner.enqueue(id)
  assert.equal((await settled(fast.store, id, 6000)).status, 'succeeded')
  assert.equal(calls, 3)

  // Ambiguous failure (may have reached the upstream): never repeated.
  let ambiguousCalls = 0
  const ambiguous = {
    async submit() { ambiguousCalls++; throw Object.assign(new Error('连接中断'), { userFacing: true, transient: true }) },
    async poll() {},
  }
  const b = setup({ provider: ambiguous })
  const id2 = newRun(b.store)
  b.runner.enqueue(id2)
  const run2 = await settled(b.store, id2)
  assert.equal(run2.status, 'failed')
  assert.equal(run2.error, '连接中断')
  assert.equal(ambiguousCalls, 1)
})

test('transient poll errors are ridden out; hard poll errors give up after a few', async () => {
  let polls = 0
  const flaky = {
    async submit() { return { externalId: 'f' } },
    async poll() {
      polls++
      if (polls <= 4) throw Object.assign(new Error('502'), { userFacing: true, transient: true })
      return { status: 'succeeded', outputs: [{ type: 'image', url: 'u' }] }
    },
  }
  const a = setup({ provider: flaky, settings: baseSettings({ pollTimeoutMs: { image: 3000, video: 3000 } }) })
  const id = newRun(a.store)
  a.runner.enqueue(id)
  assert.equal((await settled(a.store, id)).status, 'succeeded')

  let hardPolls = 0
  const broken = {
    async submit() { return { externalId: 'h' } },
    async poll() { hardPolls++; throw Object.assign(new Error('任务不存在'), { userFacing: true }) },
  }
  const b = setup({ provider: broken, settings: baseSettings({ pollTimeoutMs: { image: 3000, video: 3000 } }) })
  const id2 = newRun(b.store)
  b.runner.enqueue(id2)
  const run = await settled(b.store, id2)
  assert.equal(run.status, 'failed')
  assert.equal(run.error, '任务不存在')
  assert.equal(hardPolls, 5)
})

test('shutdown re-queues in-flight runs; a new runner resumes polling without resubmitting', async () => {
  let submits = 0
  let finish = false
  const provider = {
    async submit() { submits++; return { externalId: 'keep-me' } },
    async poll() {
      return finish ? { status: 'succeeded', outputs: [{ type: 'image', url: 'u' }] } : { status: 'running', progress: 40 }
    },
  }
  const a = setup({ provider, settings: baseSettings({ pollTimeoutMs: { image: 5000, video: 5000 } }) })
  const id = newRun(a.store)
  a.runner.enqueue(id)
  await until(async () => (await a.store.get(id)).progress === 40)
  await a.runner.shutdown()

  const parked = await a.store.get(id)
  assert.equal(parked.status, 'queued')
  assert.equal(parked.externalId, 'keep-me')
  assert.equal(parked.billingStarted, true)
  // No failure/refund hook for a run that is merely parked.
  assert.deepEqual(a.billing.calls.map((c) => c[0]), ['beforeRun'])

  // "Next process": same store, fresh runner.
  finish = true
  const billing2 = recordingBilling()
  const runner2 = new Runner({
    store: a.store,
    resolve: async () => ({ provider, cfg: {}, request: {} }),
    transfer: async (o) => ({ type: o.type, url: o.url }),
    billing: billing2,
    settings: baseSettings({ pollTimeoutMs: { image: 5000, video: 5000 } }),
    logger: silent,
    pollIntervalMs: [5, 10],
  })
  assert.equal(await runner2.start(), 1)
  const done = await settled(a.store, id)
  assert.equal(done.status, 'succeeded')
  assert.equal(submits, 1, 'not submitted a second time')
  // Already charged before the restart: beforeRun is not called again.
  assert.deepEqual(billing2.calls.map((c) => c[0]), ['afterRun'])
})

test('recover(): interrupted runs with an upstream task resume, without one they fail', async () => {
  const store = createMemoryStore([
    { id: 'a', kind: 'image', status: 'running', externalId: 'ext', createdAt: new Date(1) },
    { id: 'b', kind: 'image', status: 'running', externalId: '', createdAt: new Date(2) },
    { id: 'c', kind: 'image', status: 'archiving', externalId: 'ext2', createdAt: new Date(3) },
    { id: 'd', kind: 'image', status: 'queued', createdAt: new Date(0) },
    { id: 'e', kind: 'image', status: 'succeeded', createdAt: new Date(4) },
  ])
  assert.deepEqual(await store.recover(), ['d', 'a', 'c'])
  assert.equal((await store.get('b')).status, 'failed')
  assert.equal((await store.get('e')).status, 'succeeded')
})

test('the poll deadline counts from the original submission, across restarts', async () => {
  const provider = {
    async submit() { throw new Error('must not resubmit') },
    async poll() { return { status: 'running' } },
  }
  const { store, runner } = setup({ provider, settings: baseSettings({ pollTimeoutMs: { image: 1000, video: 1000 } }) })
  // Submitted long ago, then the process restarted.
  const id = newRun(store, { externalId: 'old', submittedAt: new Date(Date.now() - 60000) })
  runner.enqueue(id)
  const run = await settled(store, id)
  assert.equal(run.status, 'failed')
  assert.equal(run.errorCode, 'run.timeout_generate')
})

test('concurrency limit is respected', async () => {
  let running = 0
  let peak = 0
  const provider = {
    async submit() {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 20))
      running--
      return { outputs: [{ type: 'image', url: 'u' }] }
    },
    async poll() {},
  }
  const { store, runner } = setup({ provider, sync: true, settings: baseSettings({ concurrency: 2 }) })
  const ids = Array.from({ length: 6 }, () => newRun(store))
  ids.forEach((id) => runner.enqueue(id))
  for (const id of ids) assert.equal((await settled(store, id)).status, 'succeeded')
  assert.equal(peak, 2)
})

test('chat runs: text result, chat deadline', async () => {
  const ok = setup({ provider: { async chat(_c, req) { return { text: `echo:${req.prompt}`, usage: { inputTokens: 1, outputTokens: 2 } } } } })
  const id = newRun(ok.store, { kind: 'chat' })
  ok.runner.enqueue(id)
  const run = await settled(ok.store, id)
  assert.equal(run.status, 'succeeded')
  assert.equal(run.text, 'echo:p')
  assert.deepEqual(run.usage, { inputTokens: 1, outputTokens: 2 })

  const slow = setup({ provider: { chat: () => new Promise(() => {}) }, settings: baseSettings({ chatTimeoutMs: 50 }) })
  const id2 = newRun(slow.store, { kind: 'chat' })
  slow.runner.enqueue(id2)
  const run2 = await settled(slow.store, id2)
  assert.equal(run2.status, 'failed')
  assert.equal(run2.errorCode, 'run.timeout_chat')
})

test('withDeadline rejects on timeout even when the work ignores its signal', async () => {
  const parent = new AbortController()
  await assert.rejects(
    withDeadline(() => new Promise(() => {}), 20, parent.signal, 'too slow'),
    (err) => err instanceof RunError && err.code === 'TIMEOUT' && err.message === 'too slow'
  )
  assert.equal(await withDeadline(async () => 7, 1000, parent.signal, 'x'), 7)
})
