import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { Node } from '@vue-flow/core'
import { setLocale } from '../src/locales'
import { preflight, refreshRefusal, refusalText } from '../src/utils/budget'
import { BUDGET_FRESH_MS, holdBudgetFresh, type CanvasBudgetApi } from '../src/composables/canvasBudgetKey'
import { useCanvasExecutor } from '../src/composables/useCanvasExecutor'
import { effectiveModelId, loadModels } from '../src/utils/canvasModels'
import type { BudgetRefusal, LimitSide as Side, LimitState, TeamLimits } from '../src/types'

/**
 * 被每月上限拦下之后，节点上的那句说明要跟得上「现在」：
 *  - 团长提高了上限 / 填上了价格 / 月份翻篇了 → 说明撤掉，节点回到运行之前的样子；
 *  - 还拦着但数字变了、或者换了一项拦着 → 说明跟着换；
 *  - 答案里没有的（普通成员看不到团队的数字）不下结论；
 *  - 说明摆着的期间上限的答案自己会更新（回到标签页、每隔一会儿），不摆了就不再取；
 *  - 批量运行的预检按节点「眼下会用的模型」查，没选过模型的节点也查得到。
 */
vi.mock('../src/utils/canvasBackend', async (original) => {
  const real = await original<typeof import('../src/utils/canvasBackend')>()
  const spec = (id: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, kind, label: id, providerId: 'p', providerName: 'P', ...extra })
  return {
    ...real,
    modelsApi: {
      list: async () => ({
        data: {
          result: 0,
          data: [
            spec('p:image-a', 'image'), spec('p:image-b', 'image'),
            spec('p:video-a', 'video'), spec('p:video-edit-a', 'video', { videoEdit: true }),
            spec('p:chat-a', 'chat'), spec('p:chat-eyes', 'chat', { acceptsVideo: true }),
          ],
        },
      }),
    },
  }
})

beforeEach(() => setLocale('en', false))

const meter = (used: number, limit: number | null, state: LimitState) => ({ used, limit, remaining: limit == null ? null : Math.max(0, limit - used), state })
function side(o: { runs?: [number, number | null, LimitState]; amount?: [number, number | null, LimitState]; blockedBy?: Side['effective']['blockedBy'] } = {}): Side {
  const runs = meter(...(o.runs || [10, 30, 'ok']))
  const amount = meter(...(o.amount || [2, 10, 'ok']))
  return {
    runs, amount, uncounted: 0,
    breakdown: {
      succeeded: { runs: runs.used, amount: amount.used, unknownCost: 0 }, inProgress: { runs: 0, amount: 0, unknownCost: 0 },
      failed: { runs: 0 }, canceled: { runs: 0 }, counted: { runs: runs.used, amount: amount.used }, unknownCost: 0,
    },
    effective: { runs, amount, state: o.blockedBy ? 'reached' : 'ok', blockedBy: o.blockedBy ?? null, uncounted: 0 },
  }
}
const RESETS = '2026-10-31T16:00:00.000Z'
const limits = (o: Partial<TeamLimits> = {}): TeamLimits => ({
  month: '2026-10', timezone: 'Asia/Shanghai', resetsAt: RESETS, currency: 'CNY', blockUnpriced: true,
  member: side(), managers: { owner: { id: 'o', name: 'Lin Zhou' }, admins: [] },
  cannotRun: { moneyLimited: true, blockUnpriced: true, models: [] }, ...o,
})
const base = { month: '2026-10', timezone: 'Asia/Shanghai', resetsAt: RESETS, canChange: { roles: ['owner'], owner: { id: 'o', name: 'Lin Zhou' }, admins: [] } }
const R = {
  memberRuns: { code: 'budget.member_runs', data: { scope: 'member', unit: 'runs', limit: 30, used: 30, remaining: 0, requested: 1, requestedKind: 'run', ...base } },
  teamRuns: { code: 'budget.team_runs', data: { scope: 'team', unit: 'runs', limit: 2000, used: 2000, remaining: 0, requested: 1, requestedKind: 'run', ...base } },
  memberAmountFull: { code: 'budget.member_amount', data: { scope: 'member', unit: 'amount', limit: 10, used: 10, remaining: 0, requested: 0.5, requestedKind: 'estimate', currency: 'CNY', ...base } },
  memberAmountTight: { code: 'budget.member_amount', data: { scope: 'member', unit: 'amount', limit: 10, used: 9.8, remaining: 0.2, requested: 0.5, requestedKind: 'estimate', currency: 'CNY', ...base } },
  teamAmountTight: { code: 'budget.team_amount', data: { scope: 'team', unit: 'amount', limit: 500, used: 499.8, remaining: 0.2, requested: 0.8, requestedKind: 'reserve', currency: 'CNY', ...base } },
  unpriced: { code: 'budget.unpriced_model', data: { scope: 'team', unit: 'amount', reason: 'unpriced', model: { id: 'p:chat-a', label: 'Chat A' }, modelCurrency: '', currency: 'CNY', limit: 500, ...base } },
} satisfies Record<string, BudgetRefusal>
const blockedRuns = () => limits({ member: side({ runs: [30, 30, 'reached'], blockedBy: 'member_runs' }) })

describe('a stored refusal against the limits of the moment', () => {
  it('no answer: nothing is concluded', () => {
    expect(refreshRefusal(R.memberRuns, null)).toBe(R.memberRuns)
    expect(refreshRefusal(R.memberRuns, undefined)).toBe(R.memberRuns)
  })

  it('still used up, same numbers: the very same refusal; raised or a new month: gone', () => {
    expect(refreshRefusal(R.memberRuns, blockedRuns())).toBe(R.memberRuns)
    // The owner raised the member's limit from 30 to 40.
    expect(refreshRefusal(R.memberRuns, limits({ member: side({ runs: [30, 40, 'near'] }) }))).toBeNull()
    // A new month: counted from zero again.
    expect(refreshRefusal(R.memberRuns, limits({ month: '2026-11', resetsAt: '2026-11-30T16:00:00.000Z', member: side({ runs: [0, 30, 'ok'] }) }))).toBeNull()
    expect(refreshRefusal(R.memberAmountFull, limits())).toBeNull()
    expect(refreshRefusal(R.teamRuns, limits())).toBeNull()
  })

  it('still blocked, but by other numbers or by another limit: the notice follows', () => {
    // Raised from 30 to 31, and 31 are used by now: still nothing left, and the notice says 31 / 31.
    const more = refreshRefusal(R.memberRuns, limits({ member: side({ runs: [31, 31, 'reached'], blockedBy: 'member_runs' }) }))!
    expect([more.code, more.data.used, more.data.limit]).toEqual(['budget.member_runs', 31, 31])
    expect(refusalText(more).numbers).toContain('31 / 31')
    // The member's own limit was lifted, and now it is the team's that is used up.
    const team = refreshRefusal(R.memberRuns, limits({ member: side({ runs: [30, null, 'unlimited'], blockedBy: 'team_runs' }) }))!
    expect(team.code).toBe('budget.team_runs')
    // A member is not shown the team's numbers: the same limit still blocking is the same refusal.
    expect(refreshRefusal(R.teamRuns, limits({ member: side({ blockedBy: 'team_runs' }) }))).toBe(R.teamRuns)
    // "This run does not fit" becomes "used up" once nothing at all is left.
    const full = refreshRefusal(R.memberAmountTight, limits({ member: side({ amount: [10, 10, 'reached'], blockedBy: 'member_amount' }) }))!
    expect([full.code, full.data.remaining, full.data.requestedKind]).toEqual(['budget.member_amount', 0, 'none'])
    expect(refusalText(full).title).toBe(refusalText(preflight(limits({ member: side({ amount: [10, 10, 'reached'], blockedBy: 'member_amount' }) }))!).title)
  })

  it('"this run does not fit": gone once what is left is enough for it, kept (with today\'s numbers) while it is not', () => {
    // 0.5 was asked for with 0.2 left. Raised to 12: 2.2 left, it fits.
    expect(refreshRefusal(R.memberAmountTight, limits({ member: side({ amount: [9.8, 12, 'near'] }) }))).toBeNull()
    // The limit taken away altogether.
    expect(refreshRefusal(R.memberAmountTight, limits({ member: side({ amount: [9.8, null, 'unlimited'] }) }))).toBeNull()
    // Unchanged: the same refusal.
    expect(refreshRefusal(R.memberAmountTight, limits({ member: side({ amount: [9.8, 10, 'near'] }) }))).toBe(R.memberAmountTight)
    // Raised by too little (0.3 left, 0.5 wanted): still refused, with the numbers of now.
    const still = refreshRefusal(R.memberAmountTight, limits({ member: side({ amount: [9.8, 10.1, 'near'] }) }))!
    expect([still.code, still.data.limit, still.data.requested, Math.round(still.data.remaining! * 100)]).toEqual(['budget.member_amount', 10.1, 0.5, 30])
    // The team's limit: decided from the team's numbers when the answer has them ...
    expect(refreshRefusal(R.teamAmountTight, limits({ team: side({ amount: [499.8, 600, 'ok'] }) }))).toBeNull()
    expect(refreshRefusal(R.teamAmountTight, limits({ team: side({ amount: [499.8, 500, 'near'] }) }))).toBe(R.teamAmountTight)
    // ... and left alone when it has not (a plain member): nothing here says it stopped being true.
    expect(refreshRefusal(R.teamAmountTight, limits())).toBe(R.teamAmountTight)
  })

  it('a model without a usable price: gone once the server no longer lists it; follows a change of reason', () => {
    const listed = (reason: 'unpriced' | 'currency') => limits({
      team: side({ amount: [1, 500, 'ok'] }),
      cannotRun: { moneyLimited: true, blockUnpriced: true, models: [{ id: 'p:chat-a', label: 'Chat A', reason, modelCurrency: reason === 'currency' ? 'USD' : '', code: reason === 'currency' ? 'budget.currency_mismatch' : 'budget.unpriced_model' }] },
    })
    expect(refreshRefusal(R.unpriced, listed('unpriced'))).toBe(R.unpriced)
    expect(refreshRefusal(R.unpriced, limits())).toBeNull()
    // Somebody gave it a price, in the wrong currency.
    expect(refreshRefusal(R.unpriced, listed('currency'))!.code).toBe('budget.currency_mismatch')
    // The copy of the limits inside the team detail does not say which models cannot run: nothing is concluded.
    expect(refreshRefusal(R.unpriced, { ...limits(), cannotRun: undefined })).toBe(R.unpriced)
  })
})

describe('on the canvas: the executor takes stale notices off the nodes', () => {
  function canvas(list: Node[]) {
    const nodes = ref(list) as unknown as { value: Node[] }
    const patches: [string, Record<string, unknown>][] = []
    const executor = useCanvasExecutor({
      nodes: nodes as never, edges: ref([]) as never,
      updateNodeData: (id, patch) => { patches.push([id, patch]); const n = nodes.value.find((x) => x.id === id); if (n) n.data = { ...n.data, ...patch } },
    })
    return { nodes, patches, executor, data: (id: string) => nodes.value.find((n) => n.id === id)!.data }
  }
  const node = (id: string, type: string, data: Record<string, unknown>): Node => ({ id, type, position: { x: 0, y: 0 }, data })

  it('a lifted limit clears every node it stopped - back to how each was - and leaves the rest alone', () => {
    const c = canvas([
      node('never', 'image-gen', { status: 'error', errorMsg: '', refusal: R.memberRuns }),
      node('had', 'image-gen', { status: 'error', errorMsg: '', refusal: R.memberRuns, imageUrl: '/files/a.png' }),
      node('text', 'llm', { status: 'error', errorMsg: '', refusal: R.memberRuns, text: 'an answer' }),
      node('failed', 'image-gen', { status: 'error', errorMsg: 'The upstream said no', refusal: null }),
      node('fine', 'image-gen', { status: 'done', imageUrl: '/files/b.png' }),
      node('model', 'llm', { status: 'error', errorMsg: '', refusal: R.unpriced }),
    ])
    const stillListed = { moneyLimited: true, blockUnpriced: true, models: [{ id: 'p:chat-a', label: 'Chat A', reason: 'unpriced' as const, modelCurrency: '', code: 'budget.unpriced_model' as const }] }
    // Still blocked: nothing moves.
    c.executor.syncRefusals(limits({ ...blockedRuns(), cannotRun: stillListed }))
    expect(c.patches).toEqual([])
    // No answer at all (not in a team, not loaded): nothing moves either.
    c.executor.syncRefusals(null)
    expect(c.patches).toEqual([])

    c.executor.syncRefusals(limits({ member: side({ runs: [30, 40, 'near'] }), cannotRun: stillListed }))
    expect([c.data('never').status, c.data('never').refusal]).toEqual(['idle', null])
    expect([c.data('had').status, c.data('had').refusal]).toEqual(['done', null])
    expect([c.data('text').status, c.data('text').refusal]).toEqual(['done', null])
    expect([c.data('failed').status, c.data('failed').errorMsg]).toEqual(['error', 'The upstream said no'])
    expect(c.data('fine').status).toBe('done')
    expect([c.data('model').status, (c.data('model').refusal as BudgetRefusal).code]).toEqual(['error', 'budget.unpriced_model'])
    // The same answer again changes nothing more.
    const n = c.patches.length
    c.executor.syncRefusals(limits({ member: side({ runs: [30, 40, 'near'] }), cannotRun: stillListed }))
    expect(c.patches.length).toBe(n)
    // The price is filled in: the last notice goes too.
    c.executor.syncRefusals(limits({ member: side({ runs: [30, 40, 'near'] }) }))
    expect([c.data('model').status, c.data('model').refusal]).toEqual(['idle', null])
  })

  it('a notice that still holds gets the numbers of the moment', () => {
    const c = canvas([node('a', 'image-gen', { status: 'error', errorMsg: '', refusal: R.memberRuns })])
    c.executor.syncRefusals(limits({ member: side({ runs: [31, 31, 'reached'], blockedBy: 'member_runs' }) }))
    const r = c.data('a').refusal as BudgetRefusal
    expect([c.data('a').status, r.code, r.data.used, r.data.limit]).toEqual(['error', 'budget.member_runs', 31, 31])
  })
})

describe('the answer keeps itself fresh while a notice is on screen', () => {
  let visibility = 'visible'
  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
  })
  afterEach(() => { vi.useRealTimers() })
  const api = () => {
    const reload = vi.fn()
    const a: CanvasBudgetApi = { limits: shallowRef(null), canSetLimits: ref(false), canSetPrices: ref(false), limitsTo: ref(null), pricesTo: ref(null), reload }
    return { a, reload }
  }

  it('reloads every so often and when the tab comes back; never in the background; stops with the last holder', () => {
    const { a, reload } = api()
    const one = holdBudgetFresh(a)
    const two = holdBudgetFresh(a)
    expect(reload).toHaveBeenCalledTimes(0)
    vi.advanceTimersByTime(BUDGET_FRESH_MS + 10)
    expect(reload).toHaveBeenCalledTimes(1) // two holders, one timer

    // In the background: nothing.
    visibility = 'hidden'
    vi.advanceTimersByTime(BUDGET_FRESH_MS * 3)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(reload).toHaveBeenCalledTimes(1)
    // Back: at once - and the focus that comes with it does not ask a second time.
    visibility = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
    expect(reload).toHaveBeenCalledTimes(2)

    one()
    one() // releasing twice is one release
    vi.advanceTimersByTime(BUDGET_FRESH_MS + 10)
    expect(reload).toHaveBeenCalledTimes(3)
    two()
    vi.advanceTimersByTime(BUDGET_FRESH_MS * 3)
    window.dispatchEvent(new Event('focus'))
    expect(reload).toHaveBeenCalledTimes(3)

    // Somebody holds it again later: it starts over.
    const three = holdBudgetFresh(a)
    vi.advanceTimersByTime(BUDGET_FRESH_MS + 10)
    expect(reload).toHaveBeenCalledTimes(4)
    three()
  })
})

describe('the model a node would run on', () => {
  it('is the stored one, else the default the node falls back to - per kind of node', async () => {
    await loadModels()
    expect(effectiveModelId('image-gen', { model: 'p:image-b' })).toBe('p:image-b')
    expect(effectiveModelId('image-gen', {})).toBe('p:image-a')
    expect(effectiveModelId('image-edit', null)).toBe('p:image-a')
    expect(effectiveModelId('video-gen', { model: '' })).toBe('p:video-a')
    expect(effectiveModelId('video-edit', {})).toBe('p:video-edit-a')
    // Text nodes: a stored model that is no longer listed falls to the first one, as the executor does.
    expect(effectiveModelId('llm', { model: 'p:chat-eyes' })).toBe('p:chat-eyes')
    expect(effectiveModelId('llm', { model: 'p:gone' })).toBe('p:chat-a')
    expect(effectiveModelId('llm', {})).toBe('p:chat-a')
    expect(effectiveModelId('video-analysis', {})).toBe('p:chat-eyes')
    expect(effectiveModelId('video-analysis', { model: 'p:chat-a' })).toBe('p:chat-eyes')
  })

  it('so a batch preflight finds a model that cannot run on a node that never chose one', async () => {
    await loadModels()
    const l = limits({ cannotRun: { moneyLimited: true, blockUnpriced: true, models: [{ id: 'p:image-a', label: 'Image A', reason: 'unpriced', modelCurrency: '', code: 'budget.unpriced_model' }] } })
    // What the dialog used to ask (the stored model, empty) found nothing.
    expect(preflight(l, '')).toBeNull()
    expect(preflight(l, effectiveModelId('image-gen', {}))!.code).toBe('budget.unpriced_model')
    expect(preflight(l, effectiveModelId('image-gen', { model: 'p:image-b' }))).toBeNull()
  })
})
