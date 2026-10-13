'use strict'

/**
 * The monthly limits of a team, held to what they promise:
 *
 *  - a limit is exact however many server processes share the database: TWO
 *    processes (this one, and a second one spawned on the same database, each
 *    with its own runner) are fired at together, and of any burst exactly as
 *    many runs are admitted as fit - for the team's limit and a member's, in
 *    runs and in money;
 *  - "used" has one definition - succeeded + in progress - and the limits
 *    answer, the member list and the usage answer all say the same numbers,
 *    with the breakdown behind them;
 *  - the counter admission uses is a cache of the run records: thrown away,
 *    falsified or left behind by a dead process, it is put right from them;
 *  - a chat run priced per token holds a reserve while it runs and is settled
 *    to its real cost when it is done;
 *  - each of the six refusals carries what a client needs for a message of
 *    its own; a disabled account's queued runs are canceled.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { boot } = require('./support/teamHarness')
const { start: startSecond } = require('./support/secondInstance')
const { BUDGET } = require('../src/constants')

const MODEL = 'gaorui:nano-banana-2'
const CHAT = 'gaorui:talker'
const path = (model) => `/api/admin/models/${encodeURIComponent(model)}`

test('team budgets: exact across processes, one definition of used, self-repairing counters, chat reserves, refusals that explain themselves', async (t) => {
  const h = await boot(t, 'budget')
  if (!h) return t.skip('no MongoDB available (set TEST_MONGODB_URI)')
  const { root, db, upstream } = h
  const { ObjectId } = h.mongoose.Types

  const ann = await h.register('ann') // owner
  const amy = await h.register('amy') // admin
  const al = await h.register('alan')
  const cam = await h.register('cam')
  const team = await h.createTeam(ann, 'Alpha', { timezone: 'Asia/Shanghai' })
  await h.join(ann, team.id, amy, { admin: true })
  await h.join(ann, team.id, al)
  await h.join(ann, team.id, cam)
  const T = `/api/teams/${team.id}`
  const inT = (c) => c.in(team.id)
  const provider = await h.addProvider(inT(ann), 'sk-team-budget-key-0000aaaa')
  await inT(ann).data('POST', `/api/admin/providers/${provider.id}/models`, { model: 'talker', kind: 'chat' })
  await inT(ann).data('PUT', path(MODEL), { pricing: { currency: 'CNY', unit: 'per_image', price: 0.5 } })
  await root.data('PUT', '/api/admin/settings', { concurrency: 32, userConcurrency: 32, teamConcurrency: 32 })

  const second = await startSecond(h)
  t.after(() => second.stop())

  const limits = (c = ann, q = '') => c.data('GET', `${T}/limits${q}`)
  const counter = async () => db.collection('budgetcounters').findOne({ userId: team.id, month: (await limits()).month })
  const setLimits = (body) => ann.data('PUT', `${T}/limits`, body)
  const own = (c, body) => ann.data('PATCH', `${T}/members/${c.user.id}`, { limits: body })
  /** `n` submissions at the same moment, alternating between the two processes and round the given people. */
  const burst = (n, people, prompt = 'burst') => Promise.all(Array.from({ length: n }, (_, i) => {
    const who = inT(people[i % people.length])
    const body = { model: MODEL, prompt: `${prompt} ${i}` }
    return i % 2 ? second.call(who, 'POST', '/api/runs', body) : who.call('POST', '/api/runs', body)
  }))
  const admitted = (rs) => rs.filter((r) => r.status === 200)
  const refusedCodes = (rs) => [...new Set(rs.filter((r) => r.status !== 200).map((r) => `${r.status} ${r.body.code}`))]
  /** The counter says what the records say, and the limits answer says the same. */
  const consistent = async (label) => {
    const l = await limits()
    const c = await counter()
    assert.deepEqual([c.team.runs, c.team.micro / 1e6], [l.team.runs.used, l.team.amount.used], `${label}: counter and answer`)
    const b = l.team.breakdown
    assert.deepEqual([l.team.runs.used, l.team.amount.used], [b.succeeded.runs + b.inProgress.runs, Math.round((b.succeeded.amount + b.inProgress.amount) * 1e6) / 1e6], `${label}: used = succeeded + in progress`)
    assert.deepEqual(b.counted, { runs: l.team.runs.used, amount: l.team.amount.used })
    return l
  }

  await t.test('two processes, one limit: exactly as many runs as fit - the team\'s runs, a member\'s runs, the team\'s money, a member\'s money', async () => {
    assert.notEqual(second.base, h.base)
    assert.equal((await second.call(inT(al), 'GET', '/api/models')).status, 200, 'the second process serves the same team')

    // The team's runs. Held at the upstream, so every admitted run is still in progress.
    upstream.hold()
    await setLimits({ team: { runs: 5 } })
    const a = await burst(40, [al, cam, amy, ann])
    assert.equal(admitted(a).length, 5, String(a.map((r) => r.status)))
    assert.deepEqual(refusedCodes(a), ['403 budget.team_runs'])
    let l = await consistent('team runs')
    assert.deepEqual([l.team.runs, l.team.breakdown.inProgress.runs, l.team.effective.state, l.team.effective.blockedBy], [{ used: 5, limit: 5, remaining: 0 }, 5, 'reached', 'team_runs'])
    // Both processes took part in refusing (and, a few lines down, in admitting).
    assert.ok(a.filter((_, i) => i % 2 === 1).some((r) => r.status === 403) && a.filter((_, i) => i % 2 === 0).some((r) => r.status === 403))

    // A member's runs: 3 more for alan, while the team has room for many.
    await setLimits({ team: { runs: 1000 } })
    const alUsed = (await limits(al)).member.runs.used
    await own(al, { runs: alUsed + 3 })
    const b = await burst(30, [al])
    assert.equal(admitted(b).length, 3, String(b.map((r) => r.status)))
    assert.deepEqual(refusedCodes(b), ['403 budget.member_runs'])
    assert.deepEqual((await limits(al)).member.runs, { used: alUsed + 3, limit: alUsed + 3, remaining: 0 })
    // Another member has their own count - and two of these four went to each process.
    const viaBoth = await burst(4, [cam])
    assert.deepEqual(viaBoth.map((r) => r.status), [200, 200, 200, 200])
    const where = await db.collection('runs').find({ _id: { $in: viaBoth.map((r) => new ObjectId(r.body.data.runId)) } }).toArray()
    assert.equal(where.every((r) => r.budget.state === 'reserved' && r.budget.micro === 500000 && r.budget.month === l.month), true)
    await own(al, { runs: null })
    await consistent('member runs')

    // The team's money: each run is 0.5; room for exactly 4 more.
    const spent = (await limits()).team.amount.used
    await setLimits({ team: { runs: null, amount: spent + 2.2 } })
    const c = await burst(30, [al, cam, amy])
    assert.equal(admitted(c).length, 4, String(c.map((r) => r.status)))
    assert.deepEqual(refusedCodes(c), ['403 budget.team_amount'])
    l = await consistent('team amount')
    assert.deepEqual(l.team.amount, { used: spent + 2, limit: spent + 2.2, remaining: 0.2 })
    assert.equal(l.team.effective.amount.state, 'near')

    // A member's money: room for exactly 2 more for cam.
    await setLimits({ team: { amount: null } })
    const camSpent = (await limits(cam)).member.amount.used
    await own(cam, { amount: camSpent + 1 })
    const d = await burst(24, [cam])
    assert.equal(admitted(d).length, 2, String(d.map((r) => r.status)))
    assert.deepEqual(refusedCodes(d), ['403 budget.member_amount'])
    assert.deepEqual((await limits(cam)).member.amount, { used: camSpent + 1, limit: camSpent + 1, remaining: 0 })
    assert.equal((await limits(cam)).member.effective.blockedBy, 'member_amount')
    await own(cam, { amount: null })

    // Everything admitted runs to its end - in whichever process took it - and still counts, now as succeeded.
    const before = await consistent('in progress')
    upstream.release()
    await h.idle(team.id)
    const after = await consistent('all done')
    assert.deepEqual([after.team.runs.used, after.team.amount.used], [before.team.runs.used, before.team.amount.used])
    assert.deepEqual([after.team.breakdown.inProgress.runs, after.team.breakdown.succeeded.runs, after.team.breakdown.failed.runs], [0, before.team.runs.used, 0])
    assert.equal(await db.collection('runs').countDocuments({ teamId: team.id, 'budget.state': { $ne: 'settled' } }), 0)
    assert.deepEqual((await counter()).pending, [])
  })

  await t.test('one definition of "used": the limits answer, the member list and the usage answer say the same numbers', async () => {
    // One run in progress, one canceled, on top of what succeeded.
    upstream.hold()
    const going = (await inT(al).data('POST', '/api/runs', { model: MODEL, prompt: 'going' })).runId
    const dropped = (await inT(al).data('POST', '/api/runs', { model: MODEL, prompt: 'dropped' })).runId
    await inT(al).data('POST', `/api/runs/${dropped}/cancel`)
    const l = await consistent('mixed')
    const b = l.team.breakdown
    assert.deepEqual([b.inProgress, b.canceled.runs, b.failed.runs, b.unknownCost], [{ runs: 1, amount: 0.5, unknownCost: 0 }, 1, 0, 0])
    assert.deepEqual(l.counted, ['succeeded', 'inProgress'])
    assert.equal(l.nearRatio, BUDGET.NEAR_RATIO)
    assert.equal(new Date(l.startsAt) < new Date() && new Date(l.resetsAt) > new Date(), true)
    assert.match(l.resetsAtLocal, /^\d{4}-\d{2}-01 00:00 \(Asia\/Shanghai\)$/)

    // Per member, three ways: in the limits answer, in the member list, and for the member themself.
    const all = await limits(ann, '?members=1')
    const members = (await ann.data('GET', `${T}/members`)).members
    for (const c of [ann, amy, al, cam]) {
      const inLimits = all.members.find((m) => m.id === c.user.id)
      const inList = members.find((m) => m.id === c.user.id)
      const self = (await limits(c)).member
      assert.deepEqual([inLimits.runs.used, inLimits.amount.used, inLimits.breakdown], [self.runs.used, self.amount.used, self.breakdown], c.user.username)
      assert.deepEqual([inList.usage.runs, inList.usage.amount, inList.usage.breakdown, inList.effective], [self.runs.used, self.amount.used, self.breakdown, self.effective], c.user.username)
      assert.deepEqual(inLimits.effective, self.effective)
    }
    assert.equal(all.members.reduce((n, m) => n + m.runs.used, 0), all.team.runs.used, 'the members add up to the team')
    assert.equal(Math.round(all.members.reduce((n, m) => n + m.amount.used, 0) * 1e6) / 1e6, all.team.amount.used)
    assert.deepEqual(all.members.find((m) => m.id === al.user.id).breakdown.canceled, { runs: 1 })
    // What a member is not shown stays unshown: no team side, no member list.
    const mine = await limits(al, '?members=1')
    assert.deepEqual([Object.hasOwn(mine, 'team'), Object.hasOwn(mine, 'members'), Object.hasOwn(mine, 'uncountable')], [false, false, false])

    // The usage answer for the month, with the limits in the same call.
    const usage = await ann.data('GET', `${T}/usage?groupBy=member&from=${encodeURIComponent(new Date(l.startsAt).toISOString())}&limits=1`)
    assert.deepEqual(usage.limits.team, all.team)
    assert.deepEqual([usage.totals.counted.runs, usage.totals.inProgress, usage.totals.canceled], [all.team.runs.used, 1, 1])
    assert.equal(Math.round(((usage.totals.costs.CNY || 0) + (usage.totals.reserved.CNY || 0)) * 1e6) / 1e6, all.team.amount.used)
    assert.equal(usage.totals.runs, usage.totals.succeeded + usage.totals.failed + usage.totals.canceled + usage.totals.inProgress)
    for (const item of usage.items) {
      const m = all.members.find((x) => x.id === item.key)
      assert.deepEqual([item.counted.runs, item.succeeded, item.inProgress], [m.runs.used, m.breakdown.succeeded.runs, m.breakdown.inProgress.runs], item.label)
    }
    assert.equal(Object.hasOwn(await ann.data('GET', `${T}/usage`), 'limits'), false, 'only when asked for')

    // The state a client shows, ready made.
    await own(al, { runs: (await limits(al)).member.runs.used + 1 })
    const near = (await limits(al)).member
    assert.deepEqual([near.effective.runs.state, near.effective.amount.state, near.effective.state, near.effective.blockedBy], ['near', 'unlimited', 'near', null])
    await setLimits({ team: { runs: all.team.runs.used } })
    const blocked = (await limits(al)).member
    assert.deepEqual([blocked.effective.runs.state, blocked.effective.state, blocked.effective.blockedBy], ['near', 'reached', 'team_runs'], 'the team\'s limit stops a member whose own has room')
    await setLimits({ team: { runs: null } })
    await own(al, { runs: null })
    assert.deepEqual((await limits(al)).member.effective.state, 'unlimited')

    upstream.release()
    await h.waitRun(inT(al), going)
  })

  await t.test('the counter is a cache of the run records: missing, falsified or left behind by a dead process, it is put right', async () => {
    await h.idle(team.id)
    const truth = await consistent('before')
    const key = { userId: team.id, month: truth.month }
    const counters = db.collection('budgetcounters')

    // Falsified upwards and downwards: the next reading rebuilds it.
    for (const wrong of [{ 'team.runs': 7, 'team.micro': 3500000 }, { 'team.runs': -3, 'team.micro': -1500000 }]) {
      await counters.updateOne(key, { $inc: wrong })
      const l = await consistent('repaired')
      assert.deepEqual([l.team.runs.used, l.team.amount.used], [truth.team.runs.used, truth.team.amount.used])
    }
    // A member's share falsified while the total is right is caught by the rebuild at start-up.
    await counters.updateOne(key, { $inc: { [`members.${al.user.id}.runs`]: 5 } })
    assert.equal(await require('../src/services/budget').reconcileAll(), 1)
    assert.equal((await counter()).members[al.user.id].runs, (await limits(al)).member.runs.used)

    // Gone altogether (a team from before counters, a new month): the next submission builds it from the records.
    await counters.deleteOne(key)
    await setLimits({ team: { runs: truth.team.runs.used + 1 } })
    assert.equal((await inT(al).call('POST', '/api/runs', { model: MODEL, prompt: 'rebuilds' })).status, 200)
    assert.deepEqual(await inT(cam).refused('POST', '/api/runs', { model: MODEL, prompt: 'one too many' }), [403, 'budget.team_runs'], 'the records from before the counter count')
    await h.idle(team.id)
    await consistent('rebuilt')
    await setLimits({ team: { runs: null } })

    // A process died between "the run failed" and "its place was given back": the record says failed,
    // the reservation is still held. Once it is old enough to be sure, the rebuild gives it back.
    upstream.hold()
    const lost = (await inT(al).data('POST', '/api/runs', { model: MODEL, prompt: 'never' })).runId
    const held = await consistent('held')
    await h.getRunner().cancel(lost).catch(() => {})
    await second.call(inT(al), 'POST', `/api/runs/${lost}/cancel`)
    upstream.release()
    await h.idle(team.id)
    assert.equal((await limits()).team.runs.used, held.team.runs.used - 1)
    // Put the dead process's leftovers back by hand: failed, but still 'reserved' and still counted.
    await db.collection('runs').updateOne({ _id: new ObjectId(lost) }, { $set: { status: 'failed', 'budget.state': 'reserved', 'budget.micro': 500000, finishedAt: new Date() } })
    await counters.updateOne(key, { $inc: { 'team.runs': 1, 'team.micro': 500000, [`members.${al.user.id}.runs`]: 1, [`members.${al.user.id}.micro`]: 500000 } })
    // Too fresh to be called dead: it may be a run that is being settled right now. Nothing is given back yet.
    await limits()
    assert.equal((await counter()).team.runs, held.team.runs.used, 'never less than what is held')
    await db.collection('runs').updateOne({ _id: new ObjectId(lost) }, { $set: { finishedAt: new Date(Date.now() - BUDGET.STUCK_MS - 1000) } })
    const healed = await consistent('healed')
    assert.equal(healed.team.runs.used, held.team.runs.used - 1)
    assert.equal((await db.collection('runs').findOne({ _id: new ObjectId(lost) })).budget.state, 'released')

    // A reservation whose record never appeared (the process died right after taking it) is forgotten
    // once it is older than a record takes to be written - and believed until then.
    const ghost = { id: String(new ObjectId()), uid: al.user.id, micro: 500000, at: new Date() }
    await counters.updateOne(key, { $inc: { 'team.runs': 1, 'team.micro': 500000 }, $push: { pending: ghost } })
    await limits()
    assert.equal((await counter()).team.runs, healed.team.runs.used + 1, 'a fresh reservation is believed')
    await counters.updateOne({ ...key, 'pending.id': ghost.id }, { $set: { 'pending.$.at': new Date(Date.now() - BUDGET.PENDING_MS - 1000) } })
    const forgotten = await consistent('ghost forgotten')
    assert.equal(forgotten.team.runs.used, healed.team.runs.used)
    assert.deepEqual((await counter()).pending, [])

    // Changing the currency of the limits recounts everything in the new one.
    await setLimits({ currency: 'USD' })
    const usd = await limits()
    assert.deepEqual([usd.currency, usd.team.amount.used, usd.team.uncounted], ['USD', 0, usd.team.runs.used])
    await setLimits({ currency: 'CNY' })
    assert.equal((await consistent('currency back')).team.amount.used, healed.team.amount.used)
  })

  await t.test('a chat run priced per token holds a reserve while it runs and is settled to its real cost', async () => {
    await h.idle(team.id)
    // 100 per million tokens out, 10 in: the reserve for a 5-character prompt is (5 x 10 + 8192 x 100) / 1e6.
    await inT(ann).data('PUT', path(CHAT), { pricing: { currency: 'CNY', unit: 'per_1m_tokens', table: { input: 10, output: 100 } } })
    const reserve = Math.round((5 * 10 + BUDGET.CHAT_RESERVE_OUTPUT_TOKENS * 100)) / 1e6
    assert.equal(BUDGET.CHAT_RESERVE_OUTPUT_TOKENS, 8192)
    const start = (await limits()).team.amount.used
    const ask = (c) => c.call('POST', '/api/llm/tasks', { model: CHAT, prompt: 'hello' })

    // Less room than the reserve: refused up front, although the real cost would be a fraction of it.
    await setLimits({ team: { amount: Math.round((start + reserve - 0.01) * 1e6) / 1e6 } })
    const no = await ask(inT(al))
    assert.deepEqual([no.status, no.body.code, no.body.data.requested, no.body.data.requestedKind, no.body.data.unit, no.body.data.scope], [403, 'budget.team_amount', reserve, 'reserve', 'amount', 'team'])
    // Room for exactly one reserve: of a burst over both processes, one chat run is admitted.
    await setLimits({ team: { amount: Math.round((start + reserve) * 1e6) / 1e6 } })
    const asks = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? second.call(inT(cam), 'POST', '/api/llm/tasks', { model: CHAT, prompt: 'hello' }) : ask(inT(al)))))
    assert.equal(admitted(asks).length, 1, String(asks.map((r) => r.status)))
    assert.deepEqual(refusedCodes(asks), ['403 budget.team_amount'])
    const taskId = admitted(asks)[0].body.data.taskId
    await h.idle(team.id)
    // Settled: the upstream reported 10 tokens in and 10 out = 0.0011, and that is all that stays counted.
    const run = await db.collection('runs').findOne({ _id: new ObjectId(taskId) })
    assert.deepEqual([run.status, run.cost, run.budget.state, run.budget.micro], ['succeeded', { amount: 0.0011, currency: 'CNY', unknown: false }, 'settled', 1100])
    const l = await consistent('chat settled')
    assert.equal(l.team.amount.used, Math.round((start + 0.0011) * 1e6) / 1e6)
    // The room the reserve held is back, all but the real cost: with 0.01 more a second one fits -
    // which it would not if the first still held its 0.81925.
    assert.deepEqual(await inT(al).refused('POST', '/api/llm/tasks', { model: CHAT, prompt: 'hello' }), [403, 'budget.team_amount'])
    await setLimits({ team: { amount: Math.round((start + reserve + 0.01) * 1e6) / 1e6 } })
    assert.equal((await ask(inT(al))).status, 200)
    await h.idle(team.id)
    await consistent('second chat')

    // A chat model with no price at all stays what it was: refused under a money limit, or - once the
    // owner lifts that rule - a run of unknown cost that counts as a run and as no money.
    await inT(ann).data('PUT', path(CHAT), { pricing: null })
    assert.deepEqual(await inT(al).refused('POST', '/api/llm/tasks', { model: CHAT, prompt: 'hello' }), [403, 'budget.unpriced_model'])
    await setLimits({ blockUnpriced: false })
    const before = await limits()
    assert.equal((await ask(inT(al))).status, 200)
    await h.idle(team.id)
    const after = await consistent('unpriced chat')
    assert.deepEqual([after.team.runs.used, after.team.amount.used, after.team.uncounted, after.team.breakdown.succeeded.unknownCost], [before.team.runs.used + 1, before.team.amount.used, before.team.uncounted + 1, before.team.breakdown.succeeded.unknownCost + 1])
    // With the money limit used up, a run of unknown cost is refused like any other: it asks for no money, and none is left.
    await setLimits({ team: { amount: after.team.amount.used } })
    const full = await ask(inT(al))
    assert.deepEqual([full.status, full.body.code, full.body.data.requested, full.body.data.requestedKind], [403, 'budget.team_amount', 0, 'none'])
    await setLimits({ blockUnpriced: true, team: { amount: null } })

    // A chat run that is canceled, and one that fails, give their reserve back in full.
    await inT(ann).data('PUT', path(CHAT), { pricing: { currency: 'CNY', unit: 'per_1m_tokens', table: { input: 10, output: 100 } } })
    const calm = await consistent('before the canceled chat')
    upstream.chat('hold')
    const held = (await ask(inT(al))).body.data.taskId
    for (let i = 0; i < 100 && (await db.collection('runs').findOne({ _id: new ObjectId(held) })).status !== 'running'; i++) await h.sleep(30)
    assert.deepEqual((await limits()).team.breakdown.inProgress, { runs: 1, amount: reserve, unknownCost: 0 }, 'in flight it holds the reserve')
    assert.equal(Math.round(((await limits()).team.amount.used - calm.team.amount.used) * 1e6) / 1e6, reserve)
    await inT(al).data('POST', `/api/runs/${held}/cancel`)
    upstream.chat('ok')
    await h.idle(team.id)
    const back = await consistent('chat canceled')
    assert.deepEqual([back.team.amount.used, back.team.runs.used, back.team.breakdown.canceled.runs], [calm.team.amount.used, calm.team.runs.used, calm.team.breakdown.canceled.runs + 1])
    assert.equal((await db.collection('runs').findOne({ _id: new ObjectId(held) })).budget.state, 'released')
    upstream.chat('fail')
    const bad = (await ask(inT(al))).body.data.taskId
    await h.idle(team.id)
    upstream.chat('ok')
    const failed = await db.collection('runs').findOne({ _id: new ObjectId(bad) })
    assert.deepEqual([failed.status, failed.budget.state, failed.budget.micro], ['failed', 'released', 0])
    const afterFail = await consistent('chat failed')
    assert.deepEqual([afterFail.team.amount.used, afterFail.team.runs.used, afterFail.team.breakdown.failed.runs], [calm.team.amount.used, calm.team.runs.used, calm.team.breakdown.failed.runs + 1])

    // The upstream reports no token usage: the run succeeded, its cost is unknown - a run, and no money.
    upstream.chat('no-usage')
    const mute = (await ask(inT(al))).body.data.taskId
    await h.idle(team.id)
    upstream.chat('ok')
    const silent = await db.collection('runs').findOne({ _id: new ObjectId(mute) })
    assert.deepEqual([silent.status, silent.cost.unknown, silent.budget.state, silent.budget.micro, silent.budget.countable], ['succeeded', true, 'settled', 0, false])
    const afterMute = await consistent('chat without usage')
    assert.deepEqual([afterMute.team.amount.used, afterMute.team.runs.used, afterMute.team.uncounted], [calm.team.amount.used, calm.team.runs.used + 1, calm.team.uncounted + 1])
    await inT(ann).data('PUT', path(CHAT), { pricing: null })
  })

  await t.test('a refusal never rests on a counter that is wrong: it is checked against the records first', async () => {
    await h.idle(team.id)
    const budget = require('../src/services/budget')
    const truth = await consistent('before')
    const key = { userId: team.id, month: truth.month }
    // What a process that died right after taking a place leaves: the counter one too high, long ago, and nobody looked since.
    await setLimits({ team: { runs: truth.team.runs.used + 1 } })
    await db.collection('budgetcounters').updateOne(key, { $inc: { 'team.runs': 1, [`members.${al.user.id}.runs`]: 1 } })
    budget.resetVerified()
    const r = await inT(cam).call('POST', '/api/runs', { model: MODEL, prompt: 'the place that was never used' })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    // And the next one is refused for good reason, with the true numbers.
    budget.resetVerified()
    const no = await inT(cam).call('POST', '/api/runs', { model: MODEL, prompt: 'x' })
    assert.deepEqual([no.status, no.body.code, no.body.data.used, no.body.data.limit], [403, 'budget.team_runs', truth.team.runs.used + 1, truth.team.runs.used + 1])
    await h.idle(team.id)
    await consistent('after')
    await setLimits({ team: { runs: null } })
  })

  await t.test('the six refusals carry what a message needs: which limit, the numbers, when it starts again, who can change it', async () => {
    await h.idle(team.id)
    const run = (c, model = MODEL) => inT(c).call('POST', '/api/runs', { model, prompt: 'x' })
    const now = await limits()
    const base = { month: now.month, timezone: 'Asia/Shanghai', resetsAt: new Date(now.resetsAt).toISOString(), resetsAtLocal: now.resetsAtLocal }
    const owner = { id: ann.user.id, name: 'ann' }
    const ownerOnly = { roles: ['owner'], owner, admins: [] }
    const managers = { roles: ['owner', 'admin'], owner, admins: [{ id: amy.user.id, name: 'amy' }] }
    const alNow = (await limits(al)).member

    await own(al, { runs: alNow.runs.used })
    let r = await run(al)
    assert.deepEqual([r.status, r.body.code, r.body.data], [403, 'budget.member_runs', { scope: 'member', unit: 'runs', limit: alNow.runs.used, used: alNow.runs.used, remaining: 0, requested: 1, requestedKind: 'run', currency: '', ...base, canChange: ownerOnly }])
    assert.match(r.body.message, new RegExp(`${alNow.runs.used} / ${alNow.runs.used}.*${now.resetsAtLocal.slice(0, 10)}.*ann`))
    await own(al, { runs: null })

    await setLimits({ team: { runs: now.team.runs.used } })
    r = await inT(al).call('POST', '/api/runs', { model: MODEL, prompt: 'x' }, { 'X-Locale': 'en' })
    assert.deepEqual([r.status, r.body.code, r.body.data], [403, 'budget.team_runs', { scope: 'team', unit: 'runs', limit: now.team.runs.used, used: now.team.runs.used, remaining: 0, requested: 1, requestedKind: 'run', currency: '', ...base, canChange: ownerOnly }])
    assert.match(r.body.message, /The team has used all its runs for this month.*starts again on \d{4}-\d{2}-01 00:00 \(Asia\/Shanghai\).*team owner \(ann\)/)
    await setLimits({ team: { runs: null } })

    await own(al, { amount: alNow.amount.used + 0.3 })
    r = await run(al)
    assert.deepEqual([r.status, r.body.code, r.body.data], [403, 'budget.member_amount', { scope: 'member', unit: 'amount', limit: Math.round((alNow.amount.used + 0.3) * 1e6) / 1e6, used: alNow.amount.used, remaining: 0.3, requested: 0.5, requestedKind: 'estimate', currency: 'CNY', ...base, canChange: ownerOnly }])
    assert.match(r.body.message, /0\.5 CNY/)
    await own(al, { amount: null })

    await setLimits({ team: { amount: now.team.amount.used + 0.1 } })
    r = await run(cam)
    assert.deepEqual([r.status, r.body.code, r.body.data], [403, 'budget.team_amount', { scope: 'team', unit: 'amount', limit: Math.round((now.team.amount.used + 0.1) * 1e6) / 1e6, used: now.team.amount.used, remaining: 0.1, requested: 0.5, requestedKind: 'estimate', currency: 'CNY', ...base, canChange: ownerOnly }])

    // No price / a price in another currency, under a money limit: whoever manages providers can fix it.
    const priceData = { scope: 'team', unit: 'amount', currency: 'CNY', limit: Math.round((now.team.amount.used + 0.1) * 1e6) / 1e6, ...base, canChange: managers }
    const chatLabel = (await inT(al).data('GET', '/api/models?kind=chat')).find((m) => m.id === CHAT).label
    r = await inT(al).call('POST', '/api/llm/tasks', { model: CHAT, prompt: 'x' })
    assert.deepEqual([r.status, r.body.code, r.body.data], [403, 'budget.unpriced_model', { ...priceData, reason: 'unpriced', model: { id: CHAT, label: chatLabel }, modelCurrency: '' }])
    assert.ok(r.body.message.includes(chatLabel) && r.body.message.includes('ann, amy'), r.body.message)
    await inT(amy).data('PUT', path(MODEL), { pricing: { currency: 'USD', unit: 'per_image', price: 0.5 } })
    r = await run(al)
    assert.equal(r.body.data.model.id, MODEL)
    assert.deepEqual([r.status, r.body.code, { ...r.body.data, model: null }], [403, 'budget.currency_mismatch', { ...priceData, reason: 'currency', model: null, modelCurrency: 'USD' }])
    assert.match(r.body.message, /USD/)

    // Every member is told what THEY cannot run and who to ask - worked out by the server, per model.
    const forAl = await limits(al)
    assert.deepEqual(forAl.managers, { owner, admins: [{ id: amy.user.id, name: 'amy' }] })
    assert.deepEqual([forAl.cannotRun.moneyLimited, forAl.cannotRun.blockUnpriced], [true, true])
    assert.deepEqual(forAl.cannotRun.models.find((m) => m.id === MODEL), { id: MODEL, label: forAl.cannotRun.models.find((m) => m.id === MODEL).label, reason: 'currency', modelCurrency: 'USD', code: 'budget.currency_mismatch' })
    assert.deepEqual(forAl.cannotRun.models.find((m) => m.id === CHAT), { id: CHAT, label: chatLabel, reason: 'unpriced', modelCurrency: '', code: 'budget.unpriced_model' })
    assert.equal(Object.hasOwn(forAl, 'uncountable'), false)
    // It is the list of what is refused, model for model: every enabled model, tried.
    await setLimits({ team: { amount: 100000 } })
    upstream.hold()
    for (const m of await inT(al).data('GET', '/api/models')) {
      const listed = forAl.cannotRun.models.find((x) => x.id === m.id)
      const res = m.kind === 'chat' ? await inT(al).call('POST', '/api/llm/tasks', { model: m.id, prompt: 'x' }) : await run(al, m.id)
      const refusedForPrice = res.status === 403 && ['budget.unpriced_model', 'budget.currency_mismatch'].includes(res.body.code)
      assert.equal(refusedForPrice ? res.body.code : '', listed ? listed.code : '', m.id)
      if (res.status === 200) await inT(al).call('POST', `/api/runs/${res.body.data.runId || res.body.data.taskId}/cancel`)
    }
    upstream.release()
    await h.idle(team.id)

    // What the owner and admins are shown about such models says what it means right now.
    let seen = await limits(amy)
    assert.deepEqual(seen.unpriced, { models: seen.uncountable.length, moneyLimited: 'everyone', blockUnpriced: true, blocked: 'everyone', effect: 'refused' })
    assert.deepEqual(seen.uncountable.find((m) => m.id === MODEL), { id: MODEL, label: seen.uncountable.find((m) => m.id === MODEL).label, reason: 'currency', modelCurrency: 'USD', code: 'budget.currency_mismatch', blocked: 'everyone' })
    assert.deepEqual(seen.uncountable.find((m) => m.id === CHAT), { id: CHAT, label: chatLabel, reason: 'unpriced', modelCurrency: '', code: 'budget.unpriced_model', blocked: 'everyone' })
    await setLimits({ blockUnpriced: false })
    seen = await limits(amy)
    assert.deepEqual([seen.unpriced.blocked, seen.unpriced.effect, seen.uncountable[0].blocked], ['none', 'runs_only', 'none'])
    await setLimits({ blockUnpriced: true, team: { amount: null } })
    seen = await limits(amy)
    assert.deepEqual([seen.unpriced.moneyLimited, seen.unpriced.blocked, seen.unpriced.effect], ['none', 'none', 'none'], 'no money limit: nothing depends on these prices')
    assert.deepEqual((await limits(al)).cannotRun, { moneyLimited: false, blockUnpriced: true, models: [] })
    await own(cam, { amount: 1000 })
    seen = await limits(amy)
    assert.deepEqual([seen.unpriced.moneyLimited, seen.unpriced.blocked, seen.unpriced.effect], ['some', 'some', 'refused'])
    // 'some' is cam and nobody else: each is told their own answer.
    assert.deepEqual([(await limits(cam)).cannotRun.models.length, (await limits(al)).cannotRun.models.length, (await limits(amy)).cannotRun.models.length], [seen.uncountable.length, 0, 0])
    await setLimits({ blockUnpriced: false })
    assert.deepEqual((await limits(cam)).cannotRun, { moneyLimited: true, blockUnpriced: false, models: [] })
    await setLimits({ blockUnpriced: true })
    await own(cam, { amount: null })
    await inT(amy).data('PUT', path(MODEL), { pricing: { currency: 'CNY', unit: 'per_image', price: 0.5 } })
  })

  await t.test('a disabled account: what it had waiting is canceled, what was running finishes, and nothing new of it is sent', async () => {
    await h.idle()
    await root.data('PATCH', `/api/admin/teams/${team.id}`, { concurrency: 1 })
    upstream.hold()
    const ids = []
    for (const prompt of ['running', 'queued 1', 'queued 2']) ids.push((await inT(cam).data('POST', '/api/runs', { model: MODEL, prompt })).runId)
    const statuses = async (list = ids) => (await db.collection('runs').find({ _id: { $in: list.map((id) => new ObjectId(id)) } }).sort({ _id: 1 }).toArray()).map((r) => r.status)
    const until = async (want, list) => { for (let i = 0; i < 100 && JSON.stringify(await statuses(list)) !== JSON.stringify(want); i++) await h.sleep(50); return statuses(list) }
    assert.deepEqual(await until(['running', 'queued', 'queued']), ['running', 'queued', 'queued'])
    const before = await consistent('queued')

    const out = await root.data('PATCH', `/api/admin/users/${cam.user.id}`, { disabled: true })
    assert.deepEqual([out.disabled, out.runsCanceled], [true, 2])
    assert.deepEqual(await statuses(), ['running', 'canceled', 'canceled'])
    // Each says why, in the reader's language, wherever its record is read.
    const why = await db.collection('runs').findOne({ _id: new ObjectId(ids[1]) })
    assert.equal(why.errorCode, 'run.canceled_account_disabled')
    const seenBy = async (locale) => (await inT(ann).call('GET', `${T}/usage/records?pageSize=50`, undefined, { 'X-Locale': locale })).body.data.list.find((x) => x.id === ids[1])
    const inEn = await seenBy('en')
    assert.deepEqual([inEn.status, inEn.error, inEn.errorCode], ['canceled', 'Canceled while it was waiting: the super admin disabled the account that started it', 'run.canceled_account_disabled'])
    assert.equal((await seenBy('zh-CN')).error, '排队时被取消：发起人的账号被超级管理员停用了')
    assert.equal((await inT(ann).call('GET', `/api/runs/${ids[1]}`, undefined, { 'X-Locale': 'en' })).body.data.error, inEn.error)
    const after = await consistent('after disabling')
    assert.equal(after.team.runs.used, before.team.runs.used - 2, 'the canceled runs gave their places back')
    assert.equal((await ann.data('GET', `${T}/members`)).members.find((m) => m.id === cam.user.id).disabled, true)
    assert.equal(await inT(cam).status('POST', '/api/runs', { model: MODEL, prompt: 'x' }), 401)

    // The run that slipped in at the same instant - still queued when the account went - is not sent either.
    const calls = upstream.calls.length
    const late = new ObjectId()
    const first = await db.collection('runs').findOne({ _id: new ObjectId(ids[0]) })
    await db.collection('runs').insertOne({ ...first, _id: late, status: 'queued', prompt: 'slipped in', externalId: '', startedAt: null, budget: { state: '', month: '', micro: 0, currency: '', countable: false }, createdAt: new Date(), updatedAt: new Date() })
    h.getRunner().enqueue(String(late), cam.user.id, team.id)
    upstream.release()
    assert.equal((await h.waitRun(inT(ann), ids[0])).status, 'succeeded', 'what had started is left to finish')
    const refused = await h.waitRun(inT(ann), String(late))
    assert.deepEqual([refused.status, refused.errorCode], ['failed', 'run.account_disabled'])
    assert.equal(upstream.calls.slice(calls).some((c) => c.body && c.body.prompt === 'slipped in'), false)

    // Enabled again, the account works as before; a deleted one goes the way a removed member does.
    await root.data('PATCH', `/api/admin/users/${cam.user.id}`, { disabled: false })
    h.auth.resetRateLimits()
    const again = h.client((await h.anon.data('POST', '/api/auth/login', { account: 'cam', password: 'cam-password-1' })).token, team.id, cam.user)
    upstream.hold()
    const more = []
    for (const prompt of ['running', 'queued']) more.push((await again.data('POST', '/api/runs', { model: MODEL, prompt })).runId)
    assert.deepEqual(await until(['running', 'queued'], more), ['running', 'queued'])
    await root.data('DELETE', `/api/admin/users/${cam.user.id}?confirm=cam`)
    assert.deepEqual(await statuses(more), ['running', 'canceled'])
    upstream.release()
    await h.idle(team.id)
    await consistent('after deleting the account')
    await root.data('PATCH', `/api/admin/teams/${team.id}`, { concurrency: null })
  })
})
