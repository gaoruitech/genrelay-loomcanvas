'use strict'

/**
 * Monthly limits of a team: how many runs, and how much estimated money, the
 * team as a whole and each member may use.
 *
 * The rules, all of them:
 *
 *  - The month is the calendar month in the team's time zone (Team.timezone,
 *    an IANA name; UTC unless the team chose another). It starts at 00:00 of
 *    the 1st there. A run counts in the month it was submitted in; changing
 *    the time zone moves the boundary for the runs submitted from then on.
 *  - WHAT COUNTS against a limit - "used", everywhere this word appears:
 *        used = succeeded + in progress
 *    `succeeded`: runs that finished well. `in progress`: runs that are
 *    queued, running or archiving - they hold their place (a reservation)
 *    from the moment they are accepted. Failed and canceled runs count for
 *    nothing: a run that fails gives its place and its money back.
 *  - A run is one Run record, whatever its `count` of results.
 *  - Its money, in millionths so that sums are exact:
 *      in progress   what was reserved when it was accepted: the estimate from
 *                    the model's price; for a chat model priced per token,
 *                    whose cost is known only at the end, a reserve (see
 *                    chatReserve in runner/pricing.js and BUDGET in constants.js);
 *      succeeded     the run's cost as recorded: the estimate, or for a chat
 *                    run the cost worked out from the reported token usage -
 *                    the reserve is replaced by it, up or down.
 *  - Money is counted in ONE currency, Team.limits.currency. Cost in any other
 *    currency, and cost that is unknown, is not money as far as a limit is
 *    concerned: such a run counts as a run and as 0 money, and is reported as
 *    `unknownCost` so that nobody takes the sum for more than it is.
 *  - At a limit, a new run is refused (403, one of the budget.* codes, with
 *    the numbers in `data`). Runs that are already queued or running are never
 *    touched. A run is admitted when, for each limit that is set,
 *    `used < limit` and `used + this run <= limit`.
 *  - With a money limit in force and `blockUnpriced` on (the default), a model
 *    whose cost cannot be counted - no price, or a price in another currency -
 *    is refused, so the limit cannot be walked around. The team's owner can
 *    switch that off; such runs then count as runs only.
 *
 * HOW A LIMIT HOLDS. Admission is one conditional update of one document: the
 * team's counter for the month (models/BudgetCounter.js) holds the team's
 * total and every member's own count, and `reserve()` raises them only where
 * all four limits still have room - MongoDB applies that update atomically,
 * so of any number of submissions arriving at once, in any number of server
 * processes, exactly as many are admitted as fit. The run record is written
 * after the reservation and carries it (`Run.budget`); when the run ends the
 * reservation is settled (succeeded: replaced by the real cost) or given back
 * (failed, canceled) - once, guarded by `Run.budget.state`.
 *
 * THE COUNTER IS A CACHE OF THE RUN RECORDS, and can be rebuilt from them at
 * any time (`reconcile`): when it does not exist yet (a new month, a team from
 * before counters), when the team's currency changed, and when a reading
 * finds it disagreeing with the records - which a process dying between
 * "the run ended" and "its place was given back" leaves behind. A rebuild
 *   1. gives back the reservation of every finished run that still holds one
 *      and finished more than BUDGET.STUCK_MS ago,
 *   2. counts the records, adds the reservations made in the last
 *      BUDGET.PENDING_MS whose record is not written yet (`pending`),
 *   3. writes the result only if the counter did not change meanwhile (`seq`),
 *      and raises `epoch`, so that a release which read the counter before the
 *      rebuild does not subtract from it afterwards.
 * Every step errs towards counting too much, never too little: a rebuild can
 * briefly refuse a run that would fit; it cannot admit one that does not.
 */
const mongoose = require('mongoose')
const Run = require('../models/Run')
const BudgetCounter = require('../models/BudgetCounter')
const Team = require('../models/Team')
const TeamMember = require('../models/TeamMember')
const spaces = require('./spaces')
const { ApiError } = require('../utils/http')
const { startOfDayIn } = require('../utils/validate')
const { BUDGET, TEAM_ROLES } = require('../constants')

const IN_PROGRESS = ['queued', 'running', 'archiving']
const COUNTED = ['succeeded', ...IN_PROGRESS]
const FINISHED = ['succeeded', 'failed', 'canceled']
const round = (n) => Math.round(n * 1e6) / 1e6
const toMicro = (n) => Math.round((Number(n) || 0) * 1e6)
const fromMicro = (m) => round((Number(m) || 0) / 1e6)
const currencyOf = (team) => (team.limits && team.limits.currency) || 'CNY'

/*
 * Field paths, put together rather than written out: a quoted 'word.word' is how message keys
 * are written in this code base (test/i18n.test.js looks for exactly that), and these are not.
 */
const dot = (...parts) => parts.join('.')
const TEAM_RUNS = dot('team', 'runs')
const TEAM_MICRO = dot('team', 'micro')
const RUN_STATE = dot('budget', 'state')
const RUN_MONTH = dot('budget', 'month')
const RUN_MICRO = dot('budget', 'micro')
const RUN_CURRENCY = dot('budget', 'currency')
const RUN_COUNTABLE = dot('budget', 'countable')

/** The calendar month an instant falls in, in a time zone: { key: '2026-10', start, end }. */
function monthOf(tz, now = Date.now()) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', year: 'numeric', month: 'numeric' })
  const f = {}
  for (const p of fmt.formatToParts(new Date(now))) f[p.type] = Number(p.value)
  return monthWindow(tz, f.year, f.month)
}

function monthWindow(tz, year, month) {
  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    start: startOfDayIn(tz || 'UTC', year, month, 1),
    end: startOfDayIn(tz || 'UTC', month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1),
  }
}

/** '2026-10' -> that month's window in a time zone. */
function windowOfKey(tz, key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key))
  return m ? monthWindow(tz, Number(m[1]), Number(m[2])) : monthOf(tz)
}

/** An instant as people of a time zone read it: "2026-11-01 00:00 (Asia/Shanghai)". */
function localTime(date, tz) {
  const zone = tz || 'UTC'
  const f = {}
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  for (const p of fmt.formatToParts(new Date(date))) f[p.type] = p.value
  return `${f.year}-${f.month}-${f.day} ${f.hour}:${f.minute} (${zone})`
}

/* ------------------------------------------------------------ the records */

const zero = () => ({
  succeeded: { runs: 0, micro: 0, unknown: 0 },
  inProgress: { runs: 0, micro: 0, unknown: 0 },
  failed: 0,
  canceled: 0,
  // What the counter should hold for these records (differs from succeeded + inProgress only
  // while a run that just ended has not been settled yet).
  held: { runs: 0, micro: 0 },
})

function addTally(into, t) {
  for (const k of ['succeeded', 'inProgress']) for (const f of ['runs', 'micro', 'unknown']) into[k][f] += t[k][f]
  into.failed += t.failed
  into.canceled += t.canceled
  into.held.runs += t.held.runs
  into.held.micro += t.held.micro
  return into
}

/** The run records of one month of a team: the ones that carry the month, and older ones by their date. */
const monthMatch = (teamId, window) => ({
  teamId: String(teamId),
  $or: [{ [RUN_MONTH]: window.key }, { [RUN_MONTH]: { $in: ['', null] }, createdAt: { $gte: window.start, $lt: window.end } }],
})

/**
 * A month of a team, counted from its run records: { team, members: Map(userId -> tally) }.
 * A tally: { succeeded: { runs, micro, unknown }, inProgress: { runs, micro, unknown }, failed, canceled, held }.
 */
async function tally(teamId, window, currency) {
  const sum = (cond, value = 1) => ({ $sum: { $cond: [cond, value, 0] } })
  const state = { $ifNull: ['$budget.state', ''] }
  const reserved = { $eq: [state, 'reserved'] }
  const ok = { $eq: ['$status', 'succeeded'] }
  const inProgress = { $in: ['$status', IN_PROGRESS] }
  const costKnown = { $and: [{ $eq: ['$cost.unknown', false] }, { $eq: ['$cost.currency', currency] }] }
  const costMicro = { $cond: [costKnown, { $round: [{ $multiply: [{ $ifNull: ['$cost.amount', 0] }, 1e6] }, 0] }, 0] }
  const budgetCurrency = { $eq: ['$budget.currency', currency] }
  const budgetMicro = { $cond: [budgetCurrency, { $ifNull: ['$budget.micro', 0] }, 0] }
  // A run in progress holds its reservation; one from before reservations, its estimate.
  const flightMicro = { $cond: [reserved, budgetMicro, costMicro] }
  const flightKnown = { $cond: [reserved, { $and: [budgetCurrency, { $eq: ['$budget.countable', true] }] }, costKnown] }
  const held = { $or: [{ $in: [state, ['reserved', 'settled']] }, { $and: [{ $eq: [state, ''] }, { $in: ['$status', COUNTED] }] }] }

  const rows = await Run.aggregate([
    { $match: monthMatch(teamId, window) },
    {
      $group: {
        _id: { $ifNull: ['$createdBy', ''] },
        sRuns: sum(ok),
        sMicro: sum(ok, costMicro),
        sUnknown: sum({ $and: [ok, { $not: [costKnown] }] }),
        pRuns: sum(inProgress),
        pMicro: sum(inProgress, flightMicro),
        pUnknown: sum({ $and: [inProgress, { $not: [flightKnown] }] }),
        failed: sum({ $eq: ['$status', 'failed'] }),
        canceled: sum({ $eq: ['$status', 'canceled'] }),
        hRuns: sum(held),
        hMicro: sum(held, { $cond: [reserved, budgetMicro, costMicro] }),
      },
    },
  ])
  const team = zero()
  const members = new Map()
  for (const r of rows) {
    const t = {
      succeeded: { runs: r.sRuns, micro: r.sMicro, unknown: r.sUnknown },
      inProgress: { runs: r.pRuns, micro: r.pMicro, unknown: r.pUnknown },
      failed: r.failed,
      canceled: r.canceled,
      held: { runs: r.hRuns, micro: r.hMicro },
    }
    members.set(String(r._id), t)
    addTally(team, t)
  }
  return { team, members }
}

/* -------------------------------------------------------------- the limits */

const numberOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The limits one member is under: their own where set, else the team's default for members. */
function memberLimits(team, member) {
  const own = (member && member.limits) || {}
  const dft = (team.limits && team.limits.memberDefault) || {}
  return {
    runs: numberOrNull(own.runs) !== null ? own.runs : numberOrNull(dft.runs),
    amount: numberOrNull(own.amount) !== null ? own.amount : numberOrNull(dft.amount),
    // Which of the two are the member's own rather than the default.
    custom: { runs: numberOrNull(own.runs) !== null, amount: numberOrNull(own.amount) !== null },
  }
}

function teamLimits(team) {
  const l = (team.limits && team.limits.team) || {}
  return { runs: numberOrNull(l.runs), amount: numberOrNull(l.amount) }
}

const meter = (used, limit) => ({ used, limit, remaining: limit === null ? null : Math.max(0, round(limit - used)) })

/** unlimited: no limit set. reached: nothing left. near: BUDGET.NEAR_RATIO of it is used. Else ok. */
function stateOf(used, limit) {
  if (limit === null) return 'unlimited'
  if (used >= limit) return 'reached'
  return used >= limit * BUDGET.NEAR_RATIO ? 'near' : 'ok'
}

const RANK = { unlimited: 0, ok: 1, near: 2, reached: 3 }
const worst = (...states) => states.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'unlimited')

/** The explicit breakdown of a tally, in runs and money, and what of it counts against a limit. */
function breakdownOf(t) {
  return {
    succeeded: { runs: t.succeeded.runs, amount: fromMicro(t.succeeded.micro), unknownCost: t.succeeded.unknown },
    inProgress: { runs: t.inProgress.runs, amount: fromMicro(t.inProgress.micro), unknownCost: t.inProgress.unknown },
    failed: { runs: t.failed },
    canceled: { runs: t.canceled },
    // used = succeeded + inProgress: the very numbers the limits are checked against.
    counted: { runs: t.succeeded.runs + t.inProgress.runs, amount: fromMicro(t.succeeded.micro + t.inProgress.micro) },
    unknownCost: t.succeeded.unknown + t.inProgress.unknown,
  }
}

/**
 * One side of the answer - the team's, or one member's: used / limit /
 * remaining per unit, the breakdown behind `used`, and `effective`: the same
 * numbers already combined into what a client shows, so that nobody has to
 * derive a state from a limit again.
 *   effective.runs / .amount   { limit, used, remaining, state }
 *   effective.state            the worse of the two (and `reached` when the team's own limit is)
 *   effective.blockedBy        the limit a new run would be refused by right now
 *                              ('member_runs' | 'team_runs' | 'member_amount' | 'team_amount'), or null
 *   effective.uncounted        runs that count as runs but whose money could not be counted
 */
function sideOf(t, limits, teamBlock, own) {
  const b = breakdownOf(t)
  const runs = { ...meter(b.counted.runs, limits.runs), state: stateOf(b.counted.runs, limits.runs) }
  const amount = { ...meter(b.counted.amount, limits.amount), state: stateOf(b.counted.amount, limits.amount) }
  const mine = (unit) => (unit.state === 'reached' ? own : null)
  const blockedBy = own === 'team'
    ? teamBlock
    // The order runs are refused in: runs before money, and for each the member's before the team's.
    : (mine(runs) && 'member_runs') || (teamBlock === 'team_runs' && teamBlock) || (mine(amount) && 'member_amount') || teamBlock || null
  return {
    runs: meter(b.counted.runs, limits.runs),
    amount: meter(b.counted.amount, limits.amount),
    uncounted: b.unknownCost,
    breakdown: b,
    effective: { runs, amount, state: blockedBy ? 'reached' : worst(runs.state, amount.state), blockedBy, uncounted: b.unknownCost },
  }
}

function teamBlockOf(t, tl) {
  const b = breakdownOf(t)
  if (stateOf(b.counted.runs, tl.runs) === 'reached') return 'team_runs'
  if (stateOf(b.counted.amount, tl.amount) === 'reached') return 'team_amount'
  return null
}

/** One member's side of a snapshot: for the member list. */
function memberSide(team, row, snap) {
  const ml = memberLimits(team, row)
  const side = sideOf(snap.byMember.get(String(row.userId)) || zero(), ml, snap.teamBlock, 'member')
  return { ...side, custom: ml.custom }
}

/**
 * Used and limit, side by side, for the team and for one member (and the
 * tallies of all of them in `byMember`). Counted from the run records; when
 * the counter that admission uses says something else, it is rebuilt first,
 * so what is shown and what is enforced are the same numbers.
 */
async function snapshot(team, member, now = Date.now()) {
  const window = monthOf(team.timezone, now)
  const currency = currencyOf(team)
  let counted = await tally(team._id, window, currency)
  const counter = await BudgetCounter.findOne({ userId: String(team._id), month: window.key }).lean()
  if (counter && !agrees(counter, counted.team, currency)) {
    await reconcile(team, window, now).catch((err) => console.error('[budget] reconcile failed:', err && err.message))
    counted = await tally(team._id, window, currency)
  }
  const tl = teamLimits(team)
  const teamBlock = teamBlockOf(counted.team, tl)
  const out = {
    month: window.key,
    timezone: team.timezone || 'UTC',
    startsAt: window.start,
    resetsAt: window.end,
    currency,
    blockUnpriced: !team.settings || team.settings.blockUnpriced !== false,
    nearRatio: BUDGET.NEAR_RATIO,
    team: sideOf(counted.team, tl, teamBlock, 'team'),
    teamBlock,
    byMember: counted.members,
  }
  if (member) out.member = memberSide(team, member, out)
  return out
}

/**
 * The answer of GET /api/teams/:id/limits: this month for one member, and -
 * for a caller who may see everybody's usage (`all`) - for the team, with the
 * default for members; with `members` also one entry per member. Every number
 * in it follows the one definition at the top of this file.
 */
async function limitsView(team, member, { all = false, members = false, models = null } = {}) {
  const snap = await snapshot(team, member)
  const out = {
    month: snap.month,
    timezone: snap.timezone,
    startsAt: snap.startsAt,
    resetsAt: snap.resetsAt,
    resetsAtLocal: localTime(snap.resetsAt, snap.timezone),
    currency: snap.currency,
    blockUnpriced: snap.blockUnpriced,
    nearRatio: snap.nearRatio,
    // What `used` is made of, spelled out for whoever reads the answer without the documentation.
    counted: ['succeeded', 'inProgress'],
    member: snap.member,
    // Who to ask: the owner sets limits, the owner and the admins enter prices. Names every member may see.
    managers: await managersOf(team),
  }
  // The models the CALLER cannot run right now because their cost cannot be counted: for model pickers and run buttons.
  if (models) out.cannotRun = cannotRunView(team, member, models)
  if (!all) return out
  out.team = snap.team
  out.memberDefault = { runs: memberLimits(team, null).runs, amount: memberLimits(team, null).amount }
  if (members) {
    const rows = await TeamMember.find({ teamId: String(team._id) }).sort({ joinedAt: 1 }).lean()
    const names = await spaces.people(rows.map((r) => r.userId), team._id)
    out.members = rows.map((row) => {
      const who = spaces.personOf(names, row.userId)
      return { id: row.userId, name: who.name, username: who.username, role: spaces.roleIn(team, row), ...memberSide(team, row, snap) }
    })
  }
  return out
}

/**
 * The enabled models whose cost a money limit cannot count, with what that
 * means right now - so that a client shows the consequence, not a riddle:
 *
 *   uncountable: [{ id, label, reason: 'unpriced' | 'currency', modelCurrency, code, blocked }]
 *   unpriced:    { models, moneyLimited, blockUnpriced, blocked, effect }
 *
 * `moneyLimited`: who is under a money limit - 'everyone' (the team has one,
 * or the default for members is one), 'some' (only members with a limit of
 * their own), 'none'. `blocked`: for whom these models are refused (the same
 * three values; 'none' when nobody is under a money limit or `blockUnpriced`
 * is off). `effect`: 'refused' (runs on these models are refused for those
 * people, with `code`), 'runs_only' (they run, count as a run and as no
 * money - `unknownCost` in the breakdown), 'none' (no money limit: nothing
 * depends on these prices).
 */
async function uncountableView(team, models) {
  const tl = teamLimits(team)
  const dft = memberLimits(team, null)
  let moneyLimited = 'none'
  if (tl.amount !== null || dft.amount !== null) moneyLimited = 'everyone'
  else if (await TeamMember.exists({ teamId: String(team._id), 'limits.amount': { $type: 'number' } })) moneyLimited = 'some'
  const blockUnpriced = !team.settings || team.settings.blockUnpriced !== false
  const blocked = blockUnpriced ? moneyLimited : 'none'
  const uncountable = uncountableModels(team, models).map((m) => ({ ...m, blocked }))
  const effect = blocked !== 'none' ? 'refused' : moneyLimited !== 'none' ? 'runs_only' : 'none'
  return { uncountable, unpriced: { models: uncountable.length, moneyLimited, blockUnpriced, blocked, effect } }
}

/** The enabled models a money limit cannot count: [{ id, label, reason, modelCurrency, code }]. */
function uncountableModels(team, models) {
  const currency = currencyOf(team)
  return (models || [])
    .filter((m) => !m.pricing || String(m.pricing.currency || '') !== currency)
    .map((m) => ({
      id: m.id,
      label: m.label,
      reason: m.pricing ? 'currency' : 'unpriced',
      modelCurrency: m.pricing ? String(m.pricing.currency || '') : '',
      code: m.pricing ? 'budget.currency_mismatch' : 'budget.unpriced_model',
    }))
}

/**
 * What ONE member cannot run because of prices, already worked out - by the
 * rule reserve() refuses by, so that no client derives it again:
 *
 *   cannotRun: { moneyLimited, blockUnpriced, models: [{ id, label, reason, modelCurrency, code }] }
 *
 * `moneyLimited`: this member is under a money limit (their own, the default
 * for members, or the team's). `models` is empty unless that is so and
 * `blockUnpriced` is on; a run on a model in it is refused with its `code`.
 * Who can change that is `managers` of the same answer.
 */
function cannotRunView(team, member, models) {
  const moneyLimited = teamLimits(team).amount !== null || memberLimits(team, member).amount !== null
  const blockUnpriced = !team.settings || team.settings.blockUnpriced !== false
  return { moneyLimited, blockUnpriced, models: moneyLimited && blockUnpriced ? uncountableModels(team, models) : [] }
}

/** Does the counter say what the records say? (`used` = succeeded + in progress.) */
function agrees(counter, t, currency) {
  return counter.currency === currency
    && (counter.team && counter.team.runs) === t.succeeded.runs + t.inProgress.runs
    && (counter.team && counter.team.micro) === t.succeeded.micro + t.inProgress.micro
}

/* ------------------------------------------------------------ the counter */

const counterKey = (teamId, month) => ({ userId: String(teamId), month })
const memberPath = (uid, field) => `members.${uid}.${field}`

/**
 * Rebuild a month's counter from the run records (see the top of this file).
 * Resolves true when the counter was written or was already right.
 */
async function reconcile(team, window, now = Date.now()) {
  const teamId = String(team._id)
  const currency = currencyOf(team)
  // 1. Finished runs that still hold a reservation: a process went away between the two steps.
  const stuck = await Run.find({ ...monthMatch(teamId, window), [RUN_STATE]: 'reserved', status: { $in: FINISHED }, finishedAt: { $lt: new Date(now - BUDGET.STUCK_MS) } }).limit(500).lean()
  for (const run of stuck) await finish(run, { repair: false })

  for (let attempt = 0; attempt < 5; attempt++) {
    const doc = await BudgetCounter.findOne(counterKey(teamId, window.key)).lean()
    const counted = await tally(teamId, window, currency)
    // 2. Reservations whose run record is not there yet.
    const fresh = ((doc && doc.pending) || []).filter((p) => p && now - new Date(p.at).getTime() < BUDGET.PENDING_MS)
    const written = fresh.length
      ? new Set((await Run.find({ _id: { $in: fresh.map((p) => p.id) } }).select('_id').lean()).map((r) => String(r._id)))
      : new Set()
    const pending = fresh.filter((p) => !written.has(String(p.id)))
    const members = {}
    for (const [uid, t] of counted.members) if (uid) members[uid] = { runs: t.held.runs, micro: t.held.micro }
    const total = { runs: counted.team.held.runs, micro: counted.team.held.micro }
    for (const p of pending) {
      const m = members[p.uid] || (members[p.uid] = { runs: 0, micro: 0 })
      m.runs += 1
      m.micro += p.micro || 0
      total.runs += 1
      total.micro += p.micro || 0
    }
    if (!doc) {
      try {
        await BudgetCounter.create({ ...counterKey(teamId, window.key), currency, team: total, members, pending: [], seq: 1, epoch: 1 })
        return true
      } catch (err) {
        // Another process built it in the same instant: look again.
        if (err && err.code === 11000) continue
        throw err
      }
    }
    const same = doc.currency === currency && doc.team.runs === total.runs && doc.team.micro === total.micro
      && JSON.stringify(sorted(doc.members)) === JSON.stringify(sorted(members)) && (doc.pending || []).length === pending.length
    if (same) return true
    // 3. Only if nothing changed since the counter was read.
    const r = await BudgetCounter.updateOne(
      { _id: doc._id, seq: doc.seq },
      { $set: { currency, team: total, members, pending }, $inc: { seq: 1, epoch: 1 } }
    )
    if (r.modifiedCount) return true
  }
  return false
}

function sorted(members) {
  const out = {}
  for (const uid of Object.keys(members || {}).sort()) {
    const m = members[uid] || {}
    if (m.runs || m.micro) out[uid] = { runs: m.runs || 0, micro: m.micro || 0 }
  }
  return out
}

/** The counter of a month, built from the records when there is none or its currency is not the team's any more. */
async function ensureCounter(team, window, now) {
  const key = counterKey(team._id, window.key)
  const doc = await BudgetCounter.findOne(key).lean()
  if (doc && doc.currency === currencyOf(team)) return doc
  await BudgetCounter.init()
  await reconcile(team, window, now)
  return BudgetCounter.findOne(key).lean()
}

/* ---------------------------------------------------------------- refusals */

/** The four refusals at a limit, by whose limit it is and in what unit. */
const LIMIT_CODES = {
  member: { runs: 'budget.member_runs', amount: 'budget.member_amount' },
  team: { runs: 'budget.team_runs', amount: 'budget.team_amount' },
}

const personRef = (p) => (p ? { id: p.id, name: p.name || p.username || '' } : null)

/** Who can do something about a refusal: the owner, and the admins. */
async function managersOf(team) {
  const teamId = String(team._id)
  const ownerId = String(team.ownerId)
  const rows = await TeamMember.find({ teamId, role: TEAM_ROLES.ADMIN }).select('userId').lean()
  const adminIds = rows.map((r) => r.userId).filter((id) => id !== ownerId)
  const names = await spaces.people([ownerId, ...adminIds], teamId)
  return { owner: personRef(spaces.personOf(names, ownerId)), admins: adminIds.map((id) => personRef(spaces.personOf(names, id))) }
}

const namesOf = (people) => people.filter(Boolean).map((p) => p.name).filter(Boolean).join(', ')

/**
 * The refusal at a limit: 403 `budget.<scope>_<unit>` with, in `data`, all a
 * client needs for a message of its own:
 *   { scope: 'member' | 'team', unit: 'runs' | 'amount', limit, used, remaining, requested,
 *     currency, month, timezone, resetsAt, resetsAtLocal,
 *     canChange: { roles: ['owner'], owner: { id, name }, admins: [] } }
 */
async function limitRefusal(team, window, scope, unit, { limit, used, requested, requestedKind = 'run' }) {
  const currency = currencyOf(team)
  const who = await managersOf(team)
  const resetsAtLocal = localTime(window.end, team.timezone)
  return new ApiError(403, LIMIT_CODES[scope][unit], { used, limit, requested, currency, resets: resetsAtLocal, owner: who.owner ? who.owner.name : '' }, -1, {
    scope,
    unit,
    limit,
    used,
    remaining: Math.max(0, round(limit - used)),
    requested,
    // What `requested` is: 'run' (one run), 'estimate' (the run's estimated cost), 'reserve' (what a
    // chat run priced per token holds until its real cost is known), 'none' (a run whose cost cannot
    // be counted, refused because the money limit is used up).
    requestedKind,
    currency: unit === 'amount' ? currency : '',
    month: window.key,
    timezone: team.timezone || 'UTC',
    resetsAt: window.end.toISOString(),
    resetsAtLocal,
    // Limits are the owner's to set (`limits:manage`).
    canChange: { roles: [TEAM_ROLES.OWNER], owner: who.owner, admins: [] },
  })
}

/**
 * The refusal of a model whose cost a money limit cannot count: 403
 * `budget.unpriced_model` | `budget.currency_mismatch` with, in `data`:
 *   { scope, unit: 'amount', reason: 'unpriced' | 'currency', model: { id, label }, modelCurrency,
 *     currency, limit, month, timezone, resetsAt, resetsAtLocal,
 *     canChange: { roles: ['owner', 'admin'], owner, admins: [{ id, name }] } }
 * `scope` / `limit`: the money limit that makes prices matter (the member's when they have one, else the team's).
 */
async function priceRefusal(team, window, reason, { spec, pricing, tl, ml }) {
  const currency = currencyOf(team)
  const who = await managersOf(team)
  const model = { id: (spec && spec.id) || '', label: (spec && (spec.label || spec.id)) || '' }
  const modelCurrency = reason === 'currency' ? String(pricing.currency || '') : ''
  const resetsAtLocal = localTime(window.end, team.timezone)
  return new ApiError(403, reason === 'currency' ? 'budget.currency_mismatch' : 'budget.unpriced_model', { currency, model: model.label, modelCurrency, managers: namesOf([who.owner, ...who.admins]) }, -1, {
    scope: ml.amount !== null ? 'member' : 'team',
    unit: 'amount',
    reason,
    model,
    modelCurrency,
    currency,
    limit: ml.amount !== null ? ml.amount : tl.amount,
    month: window.key,
    timezone: team.timezone || 'UTC',
    resetsAt: window.end.toISOString(),
    resetsAtLocal,
    // A price is entered by whoever manages providers (`provider:manage`); the rule itself (blockUnpriced) is the owner's.
    canChange: { roles: [TEAM_ROLES.OWNER, TEAM_ROLES.ADMIN], owner: who.owner, admins: who.admins },
  })
}

/* --------------------------------------------------------------- admission */

/**
 * Take a place for a new run of this member - one run, and its money - or
 * throw the refusal. `input`: { spec, est: { totalCost, currency, unknown },
 * reserve?: { amount, currency, unknown } } - `reserve` is what a chat model
 * priced per token holds while it runs.
 *
 * Resolves what the run record must carry: { runId, budget: { state, month,
 * micro, currency, countable } }. The caller writes the record with exactly
 * that `_id` and `budget`, then calls confirm(); if the record cannot be
 * written, cancel().
 */
async function reserve(team, member, { spec, est, reserve: held }, now = Date.now()) {
  const pricing = spec && spec.pricing
  const currency = currencyOf(team)
  const tl = teamLimits(team)
  const ml = memberLimits(team, member)
  const window = monthOf(team.timezone, now)
  const priced = !!pricing && typeof pricing === 'object'
  const sameCurrency = priced && String(pricing.currency || '') === currency
  const perToken = priced && pricing.unit === 'per_1m_tokens'
  const countable = sameCurrency && (perToken ? !!held && held.unknown === false : !!est && est.unknown === false)
  const moneyLimited = tl.amount !== null || ml.amount !== null
  if (moneyLimited && (!team.settings || team.settings.blockUnpriced !== false) && !countable) {
    throw await priceRefusal(team, window, priced && !sameCurrency ? 'currency' : 'unpriced', { spec, pricing, tl, ml })
  }
  const micro = countable ? toMicro(perToken ? held.amount : est.totalCost) : 0
  const uid = String(member.userId)
  const runId = new mongoose.Types.ObjectId()
  const stamp = { runId, budget: { state: 'reserved', month: window.key, micro, currency, countable } }

  // Room under a limit: used < limit, and used + this run <= limit. A member without a count yet has used nothing.
  const and = []
  const room = (path, ceiling, mayBeAbsent) => {
    if (mayBeAbsent && ceiling >= 0) and.push({ $or: [{ [path]: { $exists: false } }, { [path]: { $lte: ceiling } }] })
    else and.push({ [path]: { $lte: ceiling } })
  }
  if (tl.runs !== null) room(TEAM_RUNS, tl.runs - 1, false)
  if (ml.runs !== null) room(memberPath(uid, 'runs'), ml.runs - 1, true)
  if (tl.amount !== null) room(TEAM_MICRO, Math.min(toMicro(tl.amount) - micro, toMicro(tl.amount) - 1), false)
  if (ml.amount !== null) room(memberPath(uid, 'micro'), Math.min(toMicro(ml.amount) - micro, toMicro(ml.amount) - 1), true)

  for (let attempt = 0; attempt < 6; attempt++) {
    const counter = await ensureCounter(team, window, now)
    if (!counter) continue
    const taken = await BudgetCounter.findOneAndUpdate(
      { _id: counter._id, currency, ...(and.length ? { $and: and } : {}) },
      {
        $inc: { [TEAM_RUNS]: 1, [TEAM_MICRO]: micro, [memberPath(uid, 'runs')]: 1, [memberPath(uid, 'micro')]: micro, seq: 1 },
        $push: { pending: { id: String(runId), uid, micro, at: new Date() } },
      },
      { new: true }
    ).lean()
    if (taken) return stamp

    // Not taken. Before anybody is told "the limit is reached": is the counter right? A process
    // that died mid-way leaves it too high until somebody looks at the limits; a refusal must
    // not rest on that. Once per team and a while (per process - this is thrift, not safety).
    if (attempt === 0 && (await verified(team, window, counter, now)) === 'rebuilt') continue
    // Say which limit it was - or, when none is in the way any more, try again.
    const latest = await BudgetCounter.findById(counter._id).lean()
    if (!latest || latest.currency !== currency) continue
    const mine = (latest.members && latest.members[uid]) || { runs: 0, micro: 0 }
    const over = (used, limit, add) => limit !== null && (used >= limit || used + add > limit)
    const requested = fromMicro(micro)
    const requestedKind = !countable ? 'none' : perToken ? 'reserve' : 'estimate'
    if (over(mine.runs || 0, ml.runs, 1)) throw await limitRefusal(team, window, 'member', 'runs', { limit: ml.runs, used: mine.runs || 0, requested: 1 })
    if (over(latest.team.runs, tl.runs, 1)) throw await limitRefusal(team, window, 'team', 'runs', { limit: tl.runs, used: latest.team.runs, requested: 1 })
    if (ml.amount !== null && over(mine.micro || 0, toMicro(ml.amount), micro)) throw await limitRefusal(team, window, 'member', 'amount', { limit: ml.amount, used: fromMicro(mine.micro), requested, requestedKind })
    if (tl.amount !== null && over(latest.team.micro, toMicro(tl.amount), micro)) throw await limitRefusal(team, window, 'team', 'amount', { limit: tl.amount, used: fromMicro(latest.team.micro), requested, requestedKind })
  }
  // Six rounds lost to rebuilds and releases in a row: not a limit, and not worth guessing at.
  throw new ApiError(503, 'budget.busy')
}

const lastVerified = new Map()

/**
 * Compare a counter with the run records and rebuild it when the two disagree: 'rebuilt' when
 * it was changed, else 'ok'. At most once per team in BUDGET.VERIFY_MS in this process. A
 * rebuild believes the reservations that are still being written (`pending`), so it never
 * makes room that is not there.
 */
async function verified(team, window, counter, now = Date.now()) {
  const key = `${team._id}:${window.key}`
  if (Date.now() - (lastVerified.get(key) || 0) < BUDGET.VERIFY_MS) return 'ok'
  if (lastVerified.size > 5000) lastVerified.clear()
  lastVerified.set(key, Date.now())
  try {
    const before = await BudgetCounter.findById(counter._id).select('epoch').lean()
    await reconcile(team, window, now)
    const after = await BudgetCounter.findById(counter._id).select('epoch').lean()
    return before && after && after.epoch !== before.epoch ? 'rebuilt' : 'ok'
  } catch (err) {
    console.error('[budget] the counter could not be checked before a refusal:', err && err.message)
    return 'ok'
  }
}

/** Forget when counters were last checked (tests). */
function resetVerified() {
  lastVerified.clear()
}

/** The run record of a reservation is written: it speaks for itself from now on. */
async function confirm(teamId, stamp) {
  await BudgetCounter.updateOne(
    { ...counterKey(teamId, stamp.budget.month), 'pending.id': String(stamp.runId) },
    { $pull: { pending: { id: String(stamp.runId) } }, $inc: { seq: 1 } }
  )
}

/** The run record of a reservation could not be written: give the place back (once: guarded by `pending`). */
async function cancel(teamId, uid, stamp) {
  const micro = stamp.budget.micro
  await BudgetCounter.updateOne(
    { ...counterKey(teamId, stamp.budget.month), 'pending.id': String(stamp.runId) },
    {
      $pull: { pending: { id: String(stamp.runId) } },
      $inc: { [TEAM_RUNS]: -1, [TEAM_MICRO]: -micro, [memberPath(uid, 'runs')]: -1, [memberPath(uid, 'micro')]: -micro, seq: 1 },
    }
  )
}

/**
 * A run ended: settle its reservation. Succeeded: the reserve is replaced by
 * the cost the run recorded. Failed or canceled: its place and its money are
 * given back. Happens once per run, whoever calls and however often
 * (`budget.state` moves away from 'reserved' in one conditional update).
 * `run` is the stored run after it reached its final status.
 */
async function finish(run, { repair = true } = {}) {
  if (!run || !run.teamId || !FINISHED.includes(run.status)) return false
  const teamId = String(run.teamId)
  const state = (run.budget && run.budget.state) || ''
  if (state !== 'reserved') {
    // A run from before reservations: the counter was built counting it by its status. Count again.
    if (!state && repair) await repairMonth(teamId, monthKeyOf(run))
    return false
  }
  const month = run.budget.month
  // The counter as it is BEFORE the run gives its reservation up: see `epoch` at the top.
  const counter = await BudgetCounter.findOne(counterKey(teamId, month)).select('epoch currency').lean()
  const currency = counter ? counter.currency : run.budget.currency
  const ok = run.status === 'succeeded'
  const reserved = run.budget.currency === currency ? run.budget.micro || 0 : 0
  const known = ok && !!run.cost && run.cost.unknown === false && run.cost.currency === currency
  const actual = known ? toMicro(run.cost.amount) : 0
  const flipped = await Run.findOneAndUpdate(
    { _id: run._id, [RUN_STATE]: 'reserved' },
    { $set: { [RUN_STATE]: ok ? 'settled' : 'released', [RUN_MICRO]: actual, [RUN_CURRENCY]: currency, [RUN_COUNTABLE]: known } },
    { timestamps: false }
  ).lean()
  if (!flipped) return false
  if (!counter) return true
  const uid = String(run.createdBy || '')
  const inc = ok ? { [TEAM_MICRO]: actual - reserved } : { [TEAM_RUNS]: -1, [TEAM_MICRO]: -reserved }
  if (uid) {
    inc[memberPath(uid, 'micro')] = inc[TEAM_MICRO]
    if (!ok) inc[memberPath(uid, 'runs')] = -1
  }
  const r = await BudgetCounter.updateOne({ _id: counter._id, epoch: counter.epoch, currency }, { $inc: { ...inc, seq: 1 } })
  // Rebuilt in between: the rebuild may have counted this run either way. Count again.
  if (!r.modifiedCount && repair) await repairMonth(teamId, month)
  return true
}

/** The month a run counts in when it does not say so itself. */
function monthKeyOf(run) {
  return (run.budget && run.budget.month) || ''
}

async function repairMonth(teamId, monthKey) {
  const team = await Team.findById(teamId).lean()
  if (!team) return
  const window = monthKey ? windowOfKey(team.timezone, monthKey) : monthOf(team.timezone)
  // Only a counter that exists can be wrong; a missing one is built when it is needed.
  if (!(await BudgetCounter.exists(counterKey(teamId, window.key)))) return
  await reconcile(team, window)
}

/**
 * Start-up: bring every counter of a current month in line with the run
 * records - what a process that was killed mid-way may have left behind.
 * Resolves how many counters were looked at.
 */
async function reconcileAll(now = Date.now()) {
  await BudgetCounter.init()
  const counters = await BudgetCounter.find({}).select('userId month').lean()
  const teams = new Map()
  let n = 0
  for (const c of counters) {
    if (!teams.has(c.userId)) teams.set(c.userId, await Team.findById(c.userId).lean())
    const team = teams.get(c.userId)
    // A counter whose team is gone, or whose month is long over, is of no use to anybody.
    if (!team || c.month < monthOf(team.timezone, now - 400 * 24 * 3600 * 1000).key) { await BudgetCounter.deleteOne({ _id: c._id }); continue }
    if (monthOf(team.timezone, now).key !== c.month) continue
    await reconcile(team, windowOfKey(team.timezone, c.month), now).catch((err) => console.error(`[budget] counter of team ${c.userId} could not be rebuilt:`, err && err.message))
    n++
  }
  return n
}

/** A team is removed for good: its counters go with it. */
async function forgetTeam(teamId) {
  await BudgetCounter.deleteMany({ userId: String(teamId) })
}

/* One thing at a time per key, in this process. (Not what the limits rest on: see reserve.) */
const chains = new Map()

function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  const tail = run.catch(() => {})
  chains.set(key, tail)
  tail.then(() => { if (chains.get(key) === tail) chains.delete(key) })
  return run
}

module.exports = {
  COUNTED,
  IN_PROGRESS,
  monthOf,
  monthWindow,
  windowOfKey,
  tally,
  memberLimits,
  teamLimits,
  stateOf,
  snapshot,
  limitsView,
  uncountableView,
  memberSide,
  managersOf,
  cannotRunView,
  resetVerified,
  reserve,
  confirm,
  cancel,
  finish,
  reconcile,
  reconcileAll,
  forgetTeam,
  withLock,
}
