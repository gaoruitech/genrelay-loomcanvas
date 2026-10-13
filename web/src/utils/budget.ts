import { t, currentLocale } from '@/locales'
import { formatMoney } from '@/utils/cost'
import { currentEmbed } from '@/embed/context'
import type {
  BudgetRefusal, BudgetRefusalCode, BudgetRefusalData, LimitBreakdown, LimitMeterState, LimitSide, LimitState, PersonRef, TeamLimits,
} from '@/types'

/**
 * 团队每月上限在界面上的说法，全站只有这一处。
 *
 * 口径只有一个，服务端定的（services/budget.js）：已用 = 已成功 + 进行中；失败、取消的不计。
 * 状态（ok / near / reached / unlimited）也是服务端给的（effective），这里不从 used / limit 再算一遍 ——
 * 进度条画多宽是画图，不是判断。
 */

const CODES: BudgetRefusalCode[] = [
  'budget.member_runs', 'budget.team_runs', 'budget.member_amount', 'budget.team_amount',
  'budget.unpriced_model', 'budget.currency_mismatch',
]
const isCode = (v: unknown): v is BudgetRefusalCode => typeof v === 'string' && (CODES as string[]).includes(v)

const intText = (n: number) => {
  try { return new Intl.NumberFormat(currentLocale()).format(Number(n) || 0) } catch { return String(n) }
}

/** 一次请求的失败是不是每月上限的拒绝（403 budget.*）；是就取出它带的数据 */
export function refusalOf(err: any): BudgetRefusal | null {
  const body = err?.response?.data
  const code = body?.code ?? err?.code
  if (!isCode(code)) return null
  const data = body?.data ?? err?.data
  return { code, data: data && typeof data === 'object' ? data as BudgetRefusalData : {}, message: String(body?.message || err?.message || '') }
}

/** 节点上存的那一份（画布数据是别处来的，先认一下） */
export function storedRefusal(v: unknown): BudgetRefusal | null {
  const r = v as BudgetRefusal | null | undefined
  if (!r || typeof r !== 'object' || !isCode(r.code)) return null
  return { code: r.code, data: r.data && typeof r.data === 'object' ? r.data : {}, message: typeof r.message === 'string' ? r.message : '' }
}

/**
 * 重新开始计数的那一刻，按团队的时区写：「11月1日 00:00（Asia/Shanghai）」。
 * 时区名总是带着：团队的月份不一定是看的人电脑上的月份。
 */
export function resetText(resetsAt?: string | null, timezone?: string | null, withZone = true): string {
  if (!resetsAt) return ''
  const d = new Date(resetsAt)
  if (Number.isNaN(d.getTime())) return ''
  const zone = timezone || 'UTC'
  let when = ''
  try {
    when = new Intl.DateTimeFormat(currentLocale(), { timeZone: zone, month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
  } catch {
    when = d.toISOString().slice(0, 16).replace('T', ' ')
  }
  return withZone ? t('spaces.limits.when', { when, zone }) : when
}

/** 「2026年10月」；认不出来就原样 */
export function monthText(key?: string | null): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''))
  if (!m) return String(key || '')
  try {
    return new Intl.DateTimeFormat(currentLocale(), { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)))
  } catch { return String(key) }
}

export function amountText(n: number, currency: string): string {
  return formatMoney(n, currency || 'CNY')
}

/** 一项上限写成字：「804 / 2,000 次」「≈ ¥388.20 / ¥500.00」；没设上限：「804 次 · 不限」 */
export function meterText(m: { used: number; limit: number | null }, unit: 'runs' | 'amount', currency = 'CNY'): string {
  if (unit === 'runs') {
    return m.limit == null
      ? t('spaces.limits.runsFree', { used: intText(m.used) })
      : t('spaces.limits.runsOf', { used: intText(m.used), limit: intText(m.limit) })
  }
  return m.limit == null
    ? t('spaces.limits.amountFree', { used: amountText(m.used, currency) })
    : t('spaces.limits.amountOf', { used: amountText(m.used, currency), limit: amountText(m.limit, currency) })
}

/** 还剩多少：「还剩 1,196 次」「还剩 ¥111.80」；没设上限返回空串 */
export function remainingText(m: { remaining: number | null }, unit: 'runs' | 'amount', currency = 'CNY'): string {
  if (m.remaining == null) return ''
  return t('spaces.limits.left', { n: unit === 'runs' ? t('spaces.limits.runs', { n: intText(m.remaining) }) : amountText(m.remaining, currency) })
}

/** 进度条画多宽（0-100）。只是画图：状态看 effective.state */
export function meterPercent(m: { used: number; limit: number | null }, state: LimitState): number {
  if (m.limit == null) return 0
  if (state === 'reached') return 100
  const ratio = m.limit > 0 ? m.used / m.limit : 0
  return Math.max(m.used > 0 ? 2 : 0, Math.min(100, Math.round(ratio * 100)))
}

export function stateLabel(state: LimitState): string {
  return state === 'reached' ? t('spaces.limits.reached') : state === 'near' ? t('spaces.limits.near') : state === 'unlimited' ? t('spaces.limits.unlimited') : t('spaces.limits.ok')
}

/**
 * 「已用」是怎么来的，一句话：「已用 804 次 = 已成功 801 + 进行中 3」。
 * 失败、取消的另起一句（notCountedText），不混在一起。
 */
export function countedText(b: LimitBreakdown): string {
  return t('spaces.limits.counted', { used: intText(b.counted.runs), ok: intText(b.succeeded.runs), going: intText(b.inProgress.runs) })
}
/** 「失败 12 次、取消 4 次，不计入」；都没有返回空串 */
export function notCountedText(b: LimitBreakdown): string {
  const failed = b.failed.runs
  const canceled = b.canceled.runs
  if (!failed && !canceled) return ''
  if (failed && canceled) return t('spaces.limits.notCountedBoth', { failed: intText(failed), canceled: intText(canceled) })
  return failed ? t('spaces.limits.notCountedFailed', { failed: intText(failed) }) : t('spaces.limits.notCountedCanceled', { canceled: intText(canceled) })
}
/** 金额里有多少是进行中的运行占着的：「其中 ≈ ¥1.00 是进行中的运行占着的，结束后按实际结算」；没有返回空串 */
export function heldText(b: LimitBreakdown, currency: string): string {
  return b.inProgress.amount > 0 ? t('spaces.limits.held', { amount: amountText(b.inProgress.amount, currency) }) : ''
}
/** 「另有 3 次运行费用未知：只计次数，金额按 0 算」；没有返回空串 */
export function unknownText(n: number): string {
  return n > 0 ? t('spaces.limits.unknownCost', { n: intText(n) }) : ''
}

/** 现在会被哪一项拦下，一句短话（成员名单、用量表里的小标签）；没被拦返回空串 */
export function blockedText(side: Pick<LimitSide, 'effective'> | null | undefined): string {
  const by = side?.effective?.blockedBy
  return by ? t(`spaces.limits.blocked.${by}`) : ''
}

/* ------------------------------------------------------------------ 拒绝 */

const names = (people: (PersonRef | null | undefined)[]) => [...new Set(people.map((p) => p?.name || '').filter(Boolean))]
const listText = (items: string[]) => items.join(t('spaces.refusal.sep'))

/** 该找谁：有名字写名字，没有就只写角色 */
function askText(r: BudgetRefusal, self: { canSetLimits?: boolean; canSetPrices?: boolean }): string {
  const price = r.code === 'budget.unpriced_model' || r.code === 'budget.currency_mismatch'
  const who = r.data.canChange
  const owner = who?.owner?.name || ''
  if (price) {
    if (self.canSetPrices) return t('spaces.refusal.ask.priceSelf', { currency: r.data.currency || '' })
    const admins = names(who?.admins || []).filter((n) => n !== owner)
    if (owner && admins.length) return t('spaces.refusal.ask.priceBoth', { owner, admins: listText(admins), currency: r.data.currency || '' })
    if (owner) return t('spaces.refusal.ask.priceOwner', { owner, currency: r.data.currency || '' })
    return t('spaces.refusal.ask.priceRoles', { currency: r.data.currency || '' })
  }
  if (self.canSetLimits) return t('spaces.refusal.ask.limitSelf')
  const mine = r.data.scope !== 'team'
  if (owner) return t(mine ? 'spaces.refusal.ask.limitOwnerMine' : 'spaces.refusal.ask.limitOwnerTeam', { owner })
  return t(mine ? 'spaces.refusal.ask.limitRoleMine' : 'spaces.refusal.ask.limitRoleTeam')
}

export interface RefusalText {
  /** 是哪一项上限，一句话 */
  title: string
  /** 数字：用了多少、上限多少、这次要多少 */
  numbers: string
  /** 什么时候重新开始计数（缺价格的两种没有：等到下个月也跑不了） */
  reset: string
  /** 该找谁 */
  ask: string
  /** 一行里放得下的说法：标题 + 数字 */
  line: string
  /** 整段连起来（title、aria、导出用） */
  full: string
}

/**
 * 六种拒绝各自的话。`self`：看的人自己能不能改（团长能改上限；团长和管理员能填价格）——
 * 能改的人看到的是「去哪儿改」，不是「去找谁」。
 */
export function refusalText(r: BudgetRefusal, self: { canSetLimits?: boolean; canSetPrices?: boolean } = {}): RefusalText {
  const d = r.data || {}
  const cur = d.currency || 'CNY'
  const money = (n: number | null | undefined) => amountText(Number(n) || 0, cur)
  const has = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  // 集成方关了成本显示（features.cost）：是哪一项上限、找谁照样说，金额不写
  const showMoney = !!currentEmbed().features.cost
  let title = ''
  let numbers = ''
  let reset = d.resetsAt ? t('spaces.refusal.reset', { when: resetText(d.resetsAt, d.timezone) }) : ''
  const model = d.model?.label || d.model?.id || t('spaces.refusal.thisModel')

  switch (r.code) {
    case 'budget.member_runs':
    case 'budget.team_runs': {
      title = t(r.code === 'budget.member_runs' ? 'spaces.refusal.title.member_runs' : 'spaces.refusal.title.team_runs')
      if (has(d.used) && has(d.limit)) numbers = t('spaces.refusal.numbers.runs', { used: intText(d.used), limit: intText(d.limit) })
      break
    }
    case 'budget.member_amount':
    case 'budget.team_amount': {
      const mine = r.code === 'budget.member_amount'
      const full = has(d.remaining) ? d.remaining <= 0 : d.requestedKind === 'none'
      title = t(`spaces.refusal.title.${mine ? 'member' : 'team'}_amount${full ? '_full' : ''}`)
      if (showMoney && has(d.used) && has(d.limit)) {
        const base = { used: money(d.used), limit: money(d.limit), left: money(d.remaining), need: money(d.requested) }
        numbers = full || !has(d.requested) || d.requestedKind === 'none'
          ? t('spaces.refusal.numbers.amountFull', base)
          : t(d.requestedKind === 'reserve' ? 'spaces.refusal.numbers.amountReserve' : 'spaces.refusal.numbers.amountEstimate', base)
      }
      break
    }
    case 'budget.unpriced_model': {
      title = t('spaces.refusal.title.unpriced', { model })
      numbers = showMoney && has(d.limit)
        ? t(d.scope === 'member' ? 'spaces.refusal.numbers.unpricedMine' : 'spaces.refusal.numbers.unpricedTeam', { limit: money(d.limit) })
        : t('spaces.refusal.numbers.unpricedPlain')
      reset = ''
      break
    }
    case 'budget.currency_mismatch': {
      title = t('spaces.refusal.title.currency', { model, modelCurrency: d.modelCurrency || '?', currency: cur })
      numbers = t('spaces.refusal.numbers.currency', { currency: cur })
      reset = ''
      break
    }
  }
  const ask = askText(r, self)
  // data 不全（宿主自己的后端只给了一句话）：那句话就是全部
  if (!title) title = r.message || t('spaces.refusal.generic')
  const line = [title, numbers].filter(Boolean).join(t('spaces.refusal.join'))
  const full = [title, numbers, reset, ask].filter(Boolean).join(t('spaces.refusal.join'))
  return { title, numbers, reset, ask, line, full }
}

/**
 * 还没点运行就知道跑不了的：按服务端给的上限答案（effective.blockedBy、cannotRun）拼出同一种东西，
 * 这样「运行前提醒」和「被拒绝之后的说明」是同一套话。答案里没有的数字就不写。
 */
export function preflight(limits: TeamLimits | null | undefined, modelId?: string | null): BudgetRefusal | null {
  if (!limits) return null
  const base: BudgetRefusalData = { currency: limits.currency, month: limits.month, timezone: limits.timezone, resetsAt: limits.resetsAt }
  const managers = limits.managers || { owner: null, admins: [] }
  const by = limits.member?.effective?.blockedBy
  if (by) {
    const [scope, unit] = by.split('_') as ['member' | 'team', 'runs' | 'amount']
    // 团队的数字只有看得到全队用量的人才有
    const side = scope === 'member' ? limits.member : limits.team
    const m: LimitMeterState | undefined = side?.effective?.[unit]
    return {
      code: `budget.${by}` as BudgetRefusalCode,
      data: {
        ...base, scope, unit,
        ...(m ? { used: m.used, limit: m.limit, remaining: m.remaining ?? 0 } : {}),
        requestedKind: unit === 'runs' ? 'run' : 'none',
        canChange: { roles: ['owner'], owner: managers.owner, admins: [] },
      },
    }
  }
  return modelBlock(limits, modelId)
}

/** 只看模型：这个模型「我」现在是不是因为价格跑不了（服务端给的 cannotRun 里有没有它） */
export function modelBlock(limits: TeamLimits | null | undefined, modelId?: string | null): BudgetRefusal | null {
  const hit = limits && modelId ? limits.cannotRun?.models.find((x) => x.id === modelId) : null
  if (!limits || !hit) return null
  const managers = limits.managers || { owner: null, admins: [] }
  const own = limits.member?.amount?.limit
  return {
    code: hit.code,
    data: {
      currency: limits.currency, month: limits.month, timezone: limits.timezone, resetsAt: limits.resetsAt,
      unit: 'amount', reason: hit.reason, model: { id: hit.id, label: hit.label }, modelCurrency: hit.modelCurrency,
      scope: own != null ? 'member' : 'team',
      limit: own != null ? own : limits.team?.amount.limit ?? undefined,
      canChange: { roles: ['owner', 'admin'], owner: managers.owner, admins: managers.admins },
    },
  }
}

/**
 * 节点上记着的那一次拒绝，拿上限最新的答案再对一遍：
 *   null          拦下它的那一项已经不成立了（团长提高了上限、填上了价格、月份翻篇了）—— 说明该撤了；
 *   同一个对象     还成立，数字也没变；
 *   一份新的拒绝   还拦着，但换了一项或者数字变了（已用、上限、还剩）—— 说明跟着换。
 * 判断用的全是服务端给的答案：effective.blockedBy（此刻被哪一项拦着）、各项还剩多少、cannotRun（哪些模型因为价格
 * 跑不了）。这里只是拿它和记着的那一次对一对，不自己算上限。答案里没有的（普通成员看不到团队的数字）就不下结论，
 * 原样留着。
 */
export function refreshRefusal(r: BudgetRefusal, limits: TeamLimits | null | undefined): BudgetRefusal | null {
  if (!limits) return r
  const d = r.data || {}
  const has = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

  if (r.code === 'budget.unpriced_model' || r.code === 'budget.currency_mismatch') {
    const id = d.model?.id
    // 不知道是哪个模型，或者答案里没有「哪些模型跑不了」这一项：没法对
    if (!id || !limits.cannotRun) return r
    const now = modelBlock(limits, id)
    if (!now) return null
    // 还列着、原因也没变：就是记着的那一次（它的数字是服务端当时给的）；原因换了（填了价格，但币种不对）才换
    return now.code === r.code ? r : now
  }

  /** 记着的那次是不是「已经用完」的说法（次数的都是；金额的要看当时还剩不剩） */
  const wasFull = r.code.endsWith('_runs') || (has(d.remaining) ? d.remaining <= 0 : d.requestedKind === 'none')
  // 此刻整体上被哪一项拦着（次数 / 金额已经用完）：有的话，说明就是它，数字用现在的
  const blocked = preflight(limits)
  if (blocked) {
    const b = blocked.data
    const same = wasFull && blocked.code === r.code && b.resetsAt === d.resetsAt
      // 团队的数字普通成员看不到（答案里没有）：那就只比是哪一项
      && (b.used === undefined || (b.used === d.used && (b.limit ?? null) === (d.limit ?? null)))
    return same ? r : blocked
  }
  // 现在没有哪一项是用完的：「已经用完」的拒绝不成立了
  if (wasFull) return null
  // 「这一次的预估超出了剩下的额度」：看现在剩下的放不放得下这一次
  const side = r.code === 'budget.member_amount' ? limits.member : limits.team
  const m = side?.effective?.amount
  if (!m) return r
  if (m.limit == null || m.remaining == null) return null
  if (!has(d.requested) || d.requested <= m.remaining) return null
  // 「还剩」是从已用和上限算出来的，比这两个就够了（不拿两个浮点数的差去比）
  if (m.used === d.used && m.limit === d.limit && limits.resetsAt === d.resetsAt) return r
  return { ...r, data: { ...d, used: m.used, limit: m.limit, remaining: m.remaining, month: limits.month, timezone: limits.timezone, resetsAt: limits.resetsAt } }
}

/** 节点上该显示的那句错误：被上限拒绝的按当前语言现写，其余是后端给的原话 */
export function nodeErrorText(data: any): string {
  const r = storedRefusal(data?.refusal)
  if (r) return refusalText(r).line
  return String(data?.errorMsg || '')
}
