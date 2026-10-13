import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { i18n, setLocale } from '../src/locales'
import { blockedText, countedText, meterPercent, meterText, modelBlock, nodeErrorText, notCountedText, preflight, refusalOf, refusalText, resetText, storedRefusal } from '../src/utils/budget'
import LimitBar from '../src/components/space/LimitBar.vue'
import LimitSide from '../src/components/space/LimitSide.vue'
import BudgetNotice from '../src/components/space/BudgetNotice.vue'
import MemberLimitCell from '../src/components/space/MemberLimitCell.vue'
import type { BudgetRefusal, BudgetRefusalCode, LimitSide as Side, LimitState, TeamLimits } from '../src/types'

/**
 * 团队每月上限在界面上的说法：
 *  - 口径只有一个（已用 = 已成功 + 进行中），失败、取消的另列并写明不计入；
 *  - 状态（ok / near / reached / unlimited）取服务端给的 effective，前端不从 used / limit 再算；
 *  - 六种拒绝各有一段具体的话：哪一项、数字、什么时候重新计数、该找谁 —— 中英文都有；
 *  - 「这个模型因为没价格跑不了」读服务端的 cannotRun，不看价格自己推。
 */
let app: App | null = null
beforeEach(() => setLocale('en', false))
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ''; setLocale('en', false) })

const meter = (used: number, limit: number | null, state: LimitState) => ({ used, limit, remaining: limit == null ? null : Math.max(0, limit - used), state })
function side(o: { runs?: [number, number | null, LimitState]; amount?: [number, number | null, LimitState]; blockedBy?: Side['effective']['blockedBy']; state?: LimitState; failed?: number; canceled?: number; going?: number; unknown?: number; held?: number } = {}): Side {
  const runs = meter(...(o.runs || [804, 2000, 'ok']))
  const amount = meter(...(o.amount || [388.2, 500, 'ok']))
  const going = o.going ?? 3
  return {
    runs, amount, uncounted: o.unknown ?? 0,
    breakdown: {
      succeeded: { runs: runs.used - going, amount: amount.used - (o.held ?? 0), unknownCost: o.unknown ?? 0 },
      inProgress: { runs: going, amount: o.held ?? 0, unknownCost: 0 },
      failed: { runs: o.failed ?? 12 }, canceled: { runs: o.canceled ?? 4 },
      counted: { runs: runs.used, amount: amount.used }, unknownCost: o.unknown ?? 0,
    },
    effective: { runs, amount, state: o.state || 'ok', blockedBy: o.blockedBy ?? null, uncounted: o.unknown ?? 0 },
  }
}
const limits = (o: Partial<TeamLimits> = {}): TeamLimits => ({
  month: '2026-10', timezone: 'Asia/Shanghai', resetsAt: '2026-10-31T16:00:00.000Z', currency: 'CNY', blockUnpriced: true,
  member: side(), managers: { owner: { id: 'o', name: 'Lin Zhou' }, admins: [{ id: 'a', name: 'Zhou Yu' }] },
  cannotRun: { moneyLimited: true, blockUnpriced: true, models: [] }, ...o,
})
const base = { month: '2026-10', timezone: 'Asia/Shanghai', resetsAt: '2026-10-31T16:00:00.000Z', resetsAtLocal: '2026-11-01 00:00 (Asia/Shanghai)' }
const owner = { id: 'o', name: 'Lin Zhou' }
const ownerOnly = { roles: ['owner'], owner, admins: [] }
const managers = { roles: ['owner', 'admin'], owner, admins: [{ id: 'a', name: 'Zhou Yu' }] }
const SIX: Record<BudgetRefusalCode, BudgetRefusal> = {
  'budget.member_runs': { code: 'budget.member_runs', data: { scope: 'member', unit: 'runs', limit: 30, used: 30, remaining: 0, requested: 1, requestedKind: 'run', currency: '', ...base, canChange: ownerOnly } },
  'budget.team_runs': { code: 'budget.team_runs', data: { scope: 'team', unit: 'runs', limit: 2000, used: 2000, remaining: 0, requested: 1, requestedKind: 'run', currency: '', ...base, canChange: ownerOnly } },
  'budget.member_amount': { code: 'budget.member_amount', data: { scope: 'member', unit: 'amount', limit: 10, used: 9.8, remaining: 0.2, requested: 0.5, requestedKind: 'estimate', currency: 'CNY', ...base, canChange: ownerOnly } },
  'budget.team_amount': { code: 'budget.team_amount', data: { scope: 'team', unit: 'amount', limit: 500, used: 499.8, remaining: 0.2, requested: 0.81925, requestedKind: 'reserve', currency: 'CNY', ...base, canChange: ownerOnly } },
  'budget.unpriced_model': { code: 'budget.unpriced_model', data: { scope: 'team', unit: 'amount', reason: 'unpriced', model: { id: 'gaorui:talker', label: 'Talker' }, modelCurrency: '', currency: 'CNY', limit: 500, ...base, canChange: managers } },
  'budget.currency_mismatch': { code: 'budget.currency_mismatch', data: { scope: 'member', unit: 'amount', reason: 'currency', model: { id: 'gaorui:nano', label: 'Nano' }, modelCurrency: 'USD', currency: 'CNY', limit: 10, ...base, canChange: managers } },
}

describe('one definition of "used"', () => {
  it('says what used is made of, and lists failed and canceled apart as not counting', () => {
    const b = side().breakdown
    expect(countedText(b)).toBe('804 runs used = 801 succeeded + 3 in progress')
    expect(notCountedText(b)).toBe('Also 12 failed and 4 canceled, which do not count')
    expect(notCountedText(side({ failed: 0, canceled: 0 }).breakdown)).toBe('')
    setLocale('zh-CN', false)
    expect(countedText(b)).toBe('已用 804 次 = 已成功 801 + 进行中 3')
    expect(notCountedText(b)).toBe('另有失败 12 次、取消 4 次，不计入上限')
  })

  it('writes a limit with what is used even when there is none', () => {
    expect(meterText({ used: 804, limit: 2000 }, 'runs')).toBe('804 / 2,000 runs')
    expect(meterText({ used: 804, limit: null }, 'runs')).toBe('804 runs · no limit')
    expect(meterText({ used: 388.2, limit: 500 }, 'amount', 'CNY')).toMatch(/388\.20 \/ .*500\.00/)
  })

  it('writes the reset in the team time zone, zone named', () => {
    expect(resetText('2026-10-31T16:00:00.000Z', 'Asia/Shanghai')).toBe('November 1 at 00:00 (Asia/Shanghai)')
    expect(resetText('2026-10-31T16:00:00.000Z', 'UTC')).toBe('October 31 at 16:00 (UTC)')
    setLocale('zh-CN', false)
    expect(resetText('2026-10-31T16:00:00.000Z', 'Asia/Shanghai')).toBe('11月1日 00:00（Asia/Shanghai）')
  })
})

describe('the state comes from the server', () => {
  function mount(comp: any, props: Record<string, unknown>) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp({ render: () => h(comp, props) })
    app.use(i18n)
    app.use(createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }, { path: '/t', name: 'team', component: { render: () => null } }] }))
    app.mount(host)
    return host
  }

  it('a bar takes its colour from effective.state, whatever the numbers would suggest', () => {
    // 10 / 100 used but the server says `reached` (e.g. the next run would not fit): the bar is the server's.
    const host = mount(LimitBar, { meter: meter(10, 100, 'reached') })
    expect(host.querySelector('.lb')!.getAttribute('data-state')).toBe('reached')
    expect(host.querySelector<HTMLElement>('.lb-track i')!.style.width).toBe('100%')
    app!.unmount()
    // 99 / 100 used and the server says `ok`: no warning colour made up here.
    const again = mount(LimitBar, { meter: meter(99, 100, 'ok') })
    expect(again.querySelector('.lb')!.className).toContain('ok')
    expect(again.querySelector('.lb')!.className).not.toContain('near')
    expect(meterPercent({ used: 99, limit: 100 }, 'ok')).toBe(99)
  })

  it('no limit: no bar, and the usage is still written', () => {
    const host = mount(LimitBar, { meter: meter(804, null, 'unlimited') })
    expect(host.querySelector('.lb-track')).toBeNull()
    expect(host.textContent).toContain('804 runs · no limit')
  })

  it('one side, in full: bars, what is left, the breakdown, unknown cost, the reset - and a team limit that blocks a member', async () => {
    const s = side({ runs: [132, 400, 'ok'], amount: [61.4, null, 'unlimited'], state: 'reached', blockedBy: 'team_runs', unknown: 3, held: 1 })
    const host = mount(LimitSide, { side: s, currency: 'CNY', resetsAt: '2026-10-31T16:00:00.000Z', timezone: 'Asia/Shanghai', member: true })
    await nextTick()
    const note = (k: string) => host.querySelector(`[data-note="${k}"]`)?.textContent || ''
    expect(host.querySelector('[data-unit="runs"]')!.textContent).toContain('132 / 400 runs')
    expect(host.querySelector('[data-unit="runs"]')!.textContent).toContain('268 runs left')
    expect(host.querySelector('[data-unit="amount"]')!.textContent).toContain('no limit')
    expect(note('counted')).toBe('132 runs used = 129 succeeded + 3 in progress')
    expect(note('not-counted')).toBe('Also 12 failed and 4 canceled, which do not count')
    expect(note('held')).toContain('held by runs in progress')
    expect(note('unknown')).toBe('Plus 3 runs of unknown cost: counted as runs, and as 0 in the amount')
    expect(note('reset')).toBe('Starts again on November 1 at 00:00 (Asia/Shanghai)')
    expect(note('team-block')).toContain('The team has used all its runs for this month')
    expect(host.querySelector('.ls')!.getAttribute('data-state')).toBe('reached')
  })

  it('a member row: bars only for what is limited, and a tag that names the team when it is the team that blocks', () => {
    const e = side({ runs: [10, 100, 'ok'], amount: [1, null, 'unlimited'], state: 'reached', blockedBy: 'team_amount' }).effective
    const host = mount(MemberLimitCell, { effective: e })
    expect(host.querySelectorAll('.lb').length).toBe(1)
    expect(host.querySelector('[data-testid="member-limit-state"]')!.textContent).toBe('Team amount limit reached')
    app!.unmount()
    const none = mount(MemberLimitCell, { effective: side({ runs: [10, null, 'unlimited'], amount: [1, null, 'unlimited'], state: 'unlimited' }).effective })
    expect(none.textContent).toBe('No limit')
    expect(blockedText(null)).toBe('')
  })

  it('the notice shows all four parts and stays; whoever can change it gets the way there instead of a name', async () => {
    const host = mount(BudgetNotice, { refusal: SIX['budget.member_amount'] })
    const part = (k: string) => host.querySelector(`[data-part="${k}"]`)?.textContent?.trim() || ''
    expect(host.querySelector('.bn-title')!.textContent).toBe('This run does not fit into your amount limit for this month')
    expect(part('numbers')).toMatch(/estimated at .*0\.50; only .*0\.20 is left \(.*9\.80 \/ .*10\.00 used\)/)
    expect(part('reset')).toBe('The count starts again on November 1 at 00:00 (Asia/Shanghai)')
    expect(part('ask')).toBe('Only the owner, Lin Zhou, can raise your limit')
    expect(host.querySelector('[data-act="budget-go"]')).toBeNull()
    expect(host.querySelector('[role="alert"]')).not.toBeNull()
    app!.unmount()
    const mine = mount(BudgetNotice, { refusal: SIX['budget.team_runs'], canSetLimits: true, limitsTo: { name: 'team' } })
    await nextTick()
    expect(mine.querySelector('[data-part="ask"]')!.textContent).toContain('You are the owner')
    expect(mine.querySelector('[data-act="budget-go"]')!.textContent).toBe('Change the limits')
  })
})

describe('the six refusals', () => {
  it.each(Object.keys(SIX) as BudgetRefusalCode[])('%s: which limit, the numbers, who to ask - in both languages', (code) => {
    for (const locale of ['en', 'zh-CN'] as const) {
      setLocale(locale, false)
      const x = refusalText(SIX[code])
      expect(x.title, `${code} ${locale} title`).not.toBe('')
      expect(x.numbers, `${code} ${locale} numbers`).not.toBe('')
      expect(x.ask, `${code} ${locale} ask`).toContain('Lin Zhou')
      // Nothing left unfilled, and no message key showing through.
      expect(x.full).not.toMatch(/\{|\}|spaces\.|budget\./)
      const price = code === 'budget.unpriced_model' || code === 'budget.currency_mismatch'
      // A price refusal does not go away next month; a limit refusal says when the count starts again, in the team zone.
      expect(x.reset.includes('Asia/Shanghai')).toBe(!price)
      if (price) expect(x.ask).toContain('Zhou Yu')
      if (price) expect(x.title).toContain(SIX[code].data.model!.label)
    }
  })

  it('each of the six says something of its own', () => {
    const titles = (Object.keys(SIX) as BudgetRefusalCode[]).map((c) => refusalText(SIX[c]).title)
    expect(new Set(titles).size).toBe(6)
    setLocale('zh-CN', false)
    expect(refusalText(SIX['budget.member_runs']).full).toBe('你本月的运行次数已用完 · 已用 30 / 30 次（已成功 + 进行中） · 11月1日 00:00（Asia/Shanghai） 重新开始计数 · 只有团长 Lin Zhou 能提高你的上限')
    expect(refusalText(SIX['budget.team_amount']).numbers).toContain('对话模型运行前先按最长回答预留')
    expect(refusalText(SIX['budget.currency_mismatch']).title).toBe('「Nano」的价格是 USD，金额上限按 CNY 计，不能运行')
    expect(refusalText(SIX['budget.unpriced_model']).ask).toBe('请团长 Lin Zhou 或管理员 Zhou Yu 为它填写 CNY 价格')
  })

  it('a money limit that is simply used up says so, not "this run does not fit"', () => {
    const full: BudgetRefusal = { code: 'budget.team_amount', data: { ...SIX['budget.team_amount'].data, used: 500, remaining: 0, requested: 0, requestedKind: 'none' } }
    expect(refusalText(full).title).toBe('The team has used up its amount limit for this month')
  })

  it('names fall back to roles, and a bare message from another backend is shown as it is', () => {
    const noNames: BudgetRefusal = { code: 'budget.member_runs', data: { ...SIX['budget.member_runs'].data, canChange: { roles: ['owner'], owner: null, admins: [] } } }
    expect(refusalText(noNames).ask).toBe('Only the team owner can raise your limit')
    expect(refusalText({ code: 'budget.unpriced_model', data: {} }).ask).toBe('Ask the owner or an admin to give it a price in ')
    expect(refusalOf({ response: { data: { code: 'run.not_found', message: 'x' } } })).toBeNull()
    const got = refusalOf({ response: { status: 403, data: { code: 'budget.team_runs', message: 'The team has used all its runs', data: SIX['budget.team_runs'].data } } })
    expect(got?.code).toBe('budget.team_runs')
    expect(got?.data.limit).toBe(2000)
  })

  it('on a node: the refusal is written fresh in the language of the moment; nothing else is touched', () => {
    const data = { errorMsg: '', refusal: SIX['budget.member_runs'] }
    expect(nodeErrorText(data)).toContain('You have used all your runs for this month')
    setLocale('zh-CN', false)
    expect(nodeErrorText(data)).toContain('你本月的运行次数已用完')
    expect(nodeErrorText({ errorMsg: 'upstream said no' })).toBe('upstream said no')
    expect(storedRefusal({ code: 'something.else', data: {} })).toBeNull()
  })
})

describe('before running: the server\'s answer, not a guess', () => {
  it('a limit that is reached is told from effective.blockedBy - with the team\'s numbers only when they are in the answer', () => {
    expect(preflight(limits())).toBeNull()
    const mine = preflight(limits({ member: side({ runs: [30, 30, 'reached'], state: 'reached', blockedBy: 'member_runs' }) }))!
    expect([mine.code, mine.data.used, mine.data.limit]).toEqual(['budget.member_runs', 30, 30])
    expect(refusalText(mine).ask).toBe('Only the owner, Lin Zhou, can raise your limit')
    // A member is not shown the team's numbers: the notice goes without them, and still says which limit and who.
    const team = preflight(limits({ member: side({ state: 'reached', blockedBy: 'team_amount' }) }))!
    expect([team.code, team.data.used]).toEqual(['budget.team_amount', undefined])
    const said = refusalText(team)
    expect([said.title, said.numbers]).toEqual(['The team has used up its amount limit for this month', ''])
    expect(said.reset).toContain('November 1')
  })

  it('a model that cannot run is one the server listed - never worked out from a price here', () => {
    const l = limits({ cannotRun: { moneyLimited: true, blockUnpriced: true, models: [{ id: 'gaorui:talker', label: 'Talker', reason: 'unpriced', modelCurrency: '', code: 'budget.unpriced_model' }] } })
    expect(modelBlock(l, 'gaorui:other')).toBeNull()
    const hit = modelBlock(l, 'gaorui:talker')!
    expect(hit.code).toBe('budget.unpriced_model')
    expect(refusalText(hit).full).toContain('Talker has no price yet, so it cannot run')
    expect(refusalText(hit).ask).toBe('Ask the owner, Lin Zhou, or an admin (Zhou Yu) to give it a price in CNY')
    expect(refusalText(hit, { canSetPrices: true }).ask).toBe('You can give it a price in CNY under Models')
    // No `cannotRun` in the answer (the copy inside the team detail): nothing is claimed.
    expect(modelBlock({ ...l, cannotRun: undefined }, 'gaorui:talker')).toBeNull()
    // The limit comes first when both apply: that is what the next click would be refused with.
    expect(preflight({ ...l, member: side({ state: 'reached', blockedBy: 'member_runs', runs: [30, 30, 'reached'] }) }, 'gaorui:talker')!.code).toBe('budget.member_runs')
  })
})
