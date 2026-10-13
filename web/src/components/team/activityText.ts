import { t, currentLocale } from '@/locales'
import { formatMoney } from '@/utils/cost'
import { currentEmbed } from '@/embed/context'
import { formatDate } from '@/components/space/format'
import { personName, personTitle } from '@/utils/person'
import type { Person, TeamActivityItem } from '@/types'

/**
 * 动态里的一条怎么写成人话。在前端写（不用服务端那句 message）：这样才能说出「从什么改成了什么」，
 * 而且人名是此刻的名字、带着已离开团队 / 账号已删除的标记。
 *
 * 一条分三块：
 *  - text：做了什么。不带操作人——操作人在列表里单独一列；
 *  - changes：改之前 → 改之后（角色、显示名、上限、可见范围、价格、设置……）；
 *  - notes：补充的事实（链接能用几次、哪天到期、带走了几张画布……）。
 * 不认识的类型、写不出来的老记录：fallback 为 true，text 是服务端按当前语言写好的那句话。
 * 每个类型带哪些 detail 见 docs/api.md「The activity log」；detail 的每一项都可能没有。
 */

export interface ActivityChange { label: string; from: string; to: string }
export interface ActivityLine {
  text: string
  changes: ActivityChange[]
  notes: string[]
  fallback: boolean
}

type Detail = Record<string, any>
/** currency：团队现在用的币种。成员上限那一条里只有数字，没有币种——给了就按它写金额 */
export interface ActivityContext { currency?: string }
type Writer = (e: TeamActivityItem, d: Detail, ctx: ActivityContext) => Partial<ActivityLine> | null

const k = (key: string, named: Record<string, unknown> = {}) => t('team.activity.log.' + key, named)
const has = (v: unknown) => v !== undefined && v !== null && v !== ''
const isObj = (v: unknown): v is Detail => !!v && typeof v === 'object' && !Array.isArray(v)

/** 对象的名字：成员写此刻的名字（带去向），别的用引号括起来；没留下名字时用类别的统称 */
export function targetName(e: TeamActivityItem): string {
  const target = e.target
  if (!target) return ''
  if (target.type === 'member') return target.person ? personTitle(target.person) : target.name || personName({ state: 'left' } as Partial<Person>)
  return target.name ? k('quote', { name: target.name }) : ''
}
/** 操作人就是对象本人（自己改自己的显示名、自己加入、自己退出） */
const self = (e: TeamActivityItem) => !!e.actor?.id && e.target?.type === 'member' && e.target.id === e.actor.id

const role = (r: unknown) => (r === 'admin' || r === 'member' || r === 'owner' ? t('spaces.role.' + r) : '')
const visibility = (v: unknown) => (v === 'private' || v === 'team_view' || v === 'team_edit' ? t(`spaces.visibility.${v}.label`) : '')
const onOff = (v: unknown) => k(v ? 'on' : 'off')
const count = (n: unknown) => new Intl.NumberFormat(currentLocale()).format(Number(n) || 0)
const runsLimit = (v: unknown) => (v === null ? t('spaces.limits.unlimited') : t('spaces.limits.runs', { n: count(v) }))
const amountLimit = (v: unknown, currency: string) => (v === null ? t('spaces.limits.unlimited') : formatMoney(Number(v) || 0, currency))

function change(out: ActivityChange[], label: string, from: string, to: string) {
  if (from !== to && (from || to)) out.push({ label, from: from || k('none'), to: to || k('none') })
}

/* ---- 价格：¥0.50/张 · ¥0.20–0.40/张（按分辨率，2 档）· 输入 ¥2.00 / 输出 ¥8.00 每百万 token ---- */
const PRICE_UNITS = ['per_image', 'per_video', 'per_second', 'per_1m_tokens']
export function priceText(p: unknown): string {
  if (!isObj(p)) return k('price.none')
  const currency = String(p.currency || '')
  const unit = PRICE_UNITS.includes(p.unit) ? k('price.unit.' + p.unit) : ''
  const money = (n: unknown) => formatMoney(Number(n) || 0, currency)
  const per = (s: string) => (unit ? k('price.per', { price: s, unit }) : s)
  if (typeof p.price === 'number') return per(money(p.price))
  if (typeof p.input === 'number' || typeof p.output === 'number') {
    return k('price.tokens', { input: typeof p.input === 'number' ? money(p.input) : k('none'), output: typeof p.output === 'number' ? money(p.output) : k('none') })
  }
  if (typeof p.min === 'number' && typeof p.max === 'number') {
    const range = p.min === p.max ? per(money(p.min)) : per(k('price.range', { min: money(p.min), max: money(p.max) }))
    const by = ['resolution', 'duration', 'resolution_duration'].includes(p.by) ? k('price.by.' + p.by) : ''
    const tiers = Number(p.tiers) || 0
    if (by && tiers) return k('price.tiered', { range, by, n: tiers })
    return by ? k('price.tieredBy', { range, by }) : range
  }
  return k('price.none')
}

/* ---- 团队设置里的一项：名字和值 ---- */
const SETTING_LABEL: Record<string, string> = {
  timezone: 'team.settings.basic.zone',
  defaultVisibility: 'team.settings.defaults.visibility',
  publicShare: 'team.settings.defaults.share',
  adminsSeeAll: 'team.settings.defaults.adminsSeeAll',
  copyToPersonal: 'team.settings.defaults.copyToPersonal',
  blockUnpriced: 'team.settings.limits.blockUnpriced',
}
function settingValue(key: string, v: unknown): string {
  if (!has(v)) return ''
  if (key === 'defaultVisibility') return visibility(v) || String(v)
  if (key === 'publicShare') return v === 'editors' || v === 'managers' ? t('team.settings.defaults.sharers.' + v) : String(v)
  if (typeof v === 'boolean') return onOff(v)
  return String(v)
}

/** 集成方关了成本显示（features.cost）：动态里照样说「改了上限」「改了价格」，金额那几项（金额上限、币种、价格）不写 */
const moneyShown = () => !!currentEmbed().features.cost

/** 上限的前后两份里不一样的那几项。老记录缺 team / memberDefault：当「不知道」，不当「不限」 */
function teamLimitChanges(before: unknown, after: unknown): ActivityChange[] {
  const out: ActivityChange[] = []
  if (!isObj(before) || !isObj(after)) return out
  const currency = String(after.currency || before.currency || '')
  for (const [side, runsKey, amountKey] of [['team', 'teamRuns', 'teamAmount'], ['memberDefault', 'defRuns', 'defAmount']] as const) {
    const a = before[side]
    const b = after[side]
    if (!isObj(a) || !isObj(b)) continue
    if ('runs' in a && 'runs' in b) change(out, t('team.settings.limits.' + runsKey), runsLimit(a.runs), runsLimit(b.runs))
    if (moneyShown() && 'amount' in a && 'amount' in b && a.amount !== b.amount) change(out, t('team.settings.limits.' + amountKey), amountLimit(a.amount, String(before.currency || currency)), amountLimit(b.amount, currency))
  }
  if (moneyShown() && has(before.currency) && has(after.currency)) change(out, t('team.settings.limits.currency'), String(before.currency), String(after.currency))
  if (moneyShown() && typeof before.blockUnpriced === 'boolean' && typeof after.blockUnpriced === 'boolean') change(out, t('team.settings.limits.blockUnpriced'), onOff(before.blockUnpriced), onOff(after.blockUnpriced))
  return out
}

/** 离开 / 被移除时顺带发生的事 */
function departureNotes(d: Detail): string[] {
  const notes: string[] = []
  if (d.role === 'admin' || d.wasAdmin) notes.push(k('note.wasAdmin'))
  if (Number(d.canvasesInherited) > 0) notes.push(k('note.canvasesInherited', { n: count(d.canvasesInherited) }))
  if (Number(d.runsCanceled) > 0) notes.push(k('note.runsCanceled', { n: count(d.runsCanceled) }))
  return notes
}
function inviteNotes(d: Detail, used: boolean): string[] {
  const notes: string[] = []
  if (typeof d.maxUses === 'number') {
    if (used && typeof d.usedCount === 'number') notes.push(d.maxUses ? k('note.usedOf', { used: count(d.usedCount), max: count(d.maxUses) }) : k('note.usedUnlimited', { used: count(d.usedCount) }))
    else notes.push(d.maxUses ? k('note.uses', { n: count(d.maxUses) }) : k('note.usesUnlimited'))
  }
  if (has(d.expiresAt) && formatDate(d.expiresAt)) notes.push(k('note.expires', { date: formatDate(d.expiresAt) }))
  return notes
}
const shareNotes = (d: Detail) => ('expiresAt' in d ? [d.expiresAt && formatDate(d.expiresAt) ? k('note.expires', { date: formatDate(d.expiresAt) }) : k('note.noExpiry')] : [])

const simple = (key: string): Writer => (e) => ({ text: k(key, { target: targetName(e) }) })
/** 句子里要提到对象：对象没留下名字的老记录写不出来，交回给 message */
const withTarget = (key: string, extra: (e: TeamActivityItem, d: Detail, ctx: ActivityContext) => Partial<ActivityLine> = () => ({})): Writer => (e, d, ctx) => {
  const target = targetName(e)
  return target ? { text: k(key, { target }), ...extra(e, d, ctx) } : null
}

const WRITERS: Record<string, Writer> = {
  'member:joined': (_e, d) => ({ text: d.inviterName ? k('member.joinedBy', { inviter: d.inviterName }) : k('member.joined') }),
  'member:left': (_e, d) => ({ text: k('member.left'), notes: departureNotes(d) }),
  'member:removed': withTarget('member.removed', (e, d) => ({
    ...(d.accountDeleted ? { text: k('member.accountDeleted', { target: targetName(e) }) } : {}),
    notes: departureNotes(d),
  })),
  'member:promoted': withTarget('member.promoted', (_e, d) => {
    const changes: ActivityChange[] = []
    change(changes, k('label.role'), role(d.from ?? 'member'), role(d.to ?? 'admin'))
    return { changes }
  }),
  'member:demoted': withTarget('member.demoted', (_e, d) => {
    const changes: ActivityChange[] = []
    change(changes, k('label.role'), role(d.from ?? 'admin'), role(d.to ?? 'member'))
    return { changes }
  }),
  'member:renamed': (e, d) => {
    const target = targetName(e)
    if (!self(e) && !target) return null
    const changes: ActivityChange[] = []
    if (typeof d.from === 'string' && typeof d.to === 'string') change(changes, k('label.displayName'), d.from, d.to)
    return { text: self(e) ? k('member.renamedSelf') : k('member.renamed', { target }), changes }
  },
  'team:transferred': withTarget('member.transferred', (e, d) => {
    const changes: ActivityChange[] = []
    if (d.fromName) change(changes, t('spaces.role.owner'), String(d.fromName), e.target?.name || '')
    return { changes }
  }),
  'team:owner_appointed': withTarget('member.ownerAppointed', (e, d) => {
    const changes: ActivityChange[] = []
    if (d.fromName) change(changes, t('spaces.role.owner'), String(d.fromName), e.target?.name || '')
    return { changes }
  }),

  'invite:created': (_e, d) => ({ text: k('invite.created'), notes: inviteNotes(d, false) }),
  'invite:revoked': (e, d) => ({
    text: d.createdByName && d.createdById !== e.actor?.id ? k('invite.revokedOf', { name: d.createdByName }) : k('invite.revoked'),
    notes: inviteNotes(d, true),
  }),

  'provider:created': withTarget('provider.created', (_e, d) => ({ notes: d.enabled === false ? [k('note.notEnabled')] : [] })),
  'provider:deleted': withTarget('provider.deleted'),
  'provider:key_changed': withTarget('provider.keyChanged', (e, d) => (d.cleared === true ? { text: k('provider.keyCleared', { target: targetName(e) }) } : {})),
  'provider:url_changed': withTarget('provider.urlChanged', (e, d) => (typeof d.custom === 'boolean'
    ? { text: k(d.custom ? 'provider.urlCustom' : 'provider.urlOfficial', { target: targetName(e) }) }
    : {})),
  'provider:updated': (e, d) => {
    const target = targetName(e)
    const renamed = d.renamed && has(d.from) && has(d.to)
    if (!target && !renamed) return null
    const switched = typeof d.enabled === 'boolean'
    if (renamed) {
      const changes: ActivityChange[] = []
      change(changes, k('label.name'), String(d.from), String(d.to))
      if (switched) change(changes, k('label.status'), k(d.enabled ? 'disabled' : 'enabled'), k(d.enabled ? 'enabled' : 'disabled'))
      return { text: k('provider.renamed', { target: k('quote', { name: d.to }) }), changes }
    }
    if (switched) return { text: k(d.enabled ? 'provider.enabled' : 'provider.disabled', { target }) }
    return { text: k('provider.updated', { target }) }
  },
  'provider:model_added': withTarget('provider.modelAdded', (e, d) => (has(d.model)
    ? { text: k('provider.modelAddedNamed', { target: targetName(e), model: d.model }), notes: ['image', 'video', 'chat'].includes(d.kind) ? [k('kind.' + d.kind)] : [] }
    : {})),
  'provider:model_removed': withTarget('provider.modelRemoved', (e, d) => (has(d.model) ? { text: k('provider.modelRemovedNamed', { target: targetName(e), model: d.model }) } : {})),
  'model:enabled': withTarget('model.enabled'),
  'model:disabled': withTarget('model.disabled'),
  'model:price_changed': withTarget('model.priceChanged', (_e, d) => {
    const changes: ActivityChange[] = []
    if (moneyShown() && ('before' in d || 'after' in d)) change(changes, k('label.price'), priceText(d.before), priceText(d.after))
    return { changes }
  }),

  // 每次保存都会记一条，前后一样的也记：没有差别就写不出「改了什么」，交回给 message
  'limits:team_changed': (_e, d) => {
    const changes = teamLimitChanges(d.before, d.after)
    return changes.length ? { text: k('limits.team'), changes } : null
  },
  'limits:member_changed': withTarget('limits.member', (_e, d, ctx) => {
    const changes: ActivityChange[] = []
    const one = (v: unknown, kind: 'runs' | 'amount') => (v === null ? k('followDefault') : kind === 'runs' ? t('spaces.limits.runs', { n: count(v) }) : ctx.currency ? formatMoney(Number(v) || 0, ctx.currency) : count(v))
    if (isObj(d.before) && isObj(d.after)) {
      if ('runs' in d.before && 'runs' in d.after) change(changes, k('label.memberRuns'), one(d.before.runs, 'runs'), one(d.after.runs, 'runs'))
      if (moneyShown() && 'amount' in d.before && 'amount' in d.after) change(changes, k('label.memberAmount'), one(d.before.amount, 'amount'), one(d.after.amount, 'amount'))
    }
    return { changes }
  }),
  'usage:records_deleted': (_e, d) => (typeof d.deleted === 'number'
    ? { text: k('usage.recordsDeleted', { n: count(d.deleted) }, ), notes: has(d.before) && formatDate(d.before) ? [k('note.olderThan', { date: formatDate(d.before) })] : [] }
    : null),

  'canvas:deleted': withTarget('canvas.deleted'),
  'canvas:restored': withTarget('canvas.restored'),
  'canvas:visibility_changed': withTarget('canvas.visibilityChanged', (_e, d) => {
    const changes: ActivityChange[] = []
    if (visibility(d.from) && visibility(d.to)) change(changes, t('spaces.visibility.label'), visibility(d.from), visibility(d.to))
    return { changes }
  }),
  'canvas:taken_over': withTarget('canvas.takenOver', (e, d) => (d.fromName ? { text: k('canvas.takenOverFrom', { target: targetName(e), from: d.fromName }) } : {})),
  'canvas:overwritten': withTarget('canvas.overwritten', (_e, d) => ({ notes: typeof d.revision === 'number' ? [k('note.revision', { n: d.revision })] : [] })),

  'share:created': withTarget('share.created', (_e, d) => ({ notes: shareNotes(d) })),
  'share:revoked': withTarget('share.revoked'),

  'team:created': simple('team.created'),
  'team:restored': simple('team.restored'),
  'team:suspended': simple('team.suspended'),
  'team:resumed': simple('team.resumed'),
  'team:renamed': (_e, d) => {
    const changes: ActivityChange[] = []
    if (has(d.from) && has(d.to)) change(changes, k('label.teamName'), String(d.from), String(d.to))
    return { text: k('team.renamed'), changes }
  },
  'team:avatar_changed': (_e, d) => ({ text: k(d.removed === true ? 'team.avatarRemoved' : 'team.avatarChanged') }),
  'team:settings_changed': (_e, d) => {
    const changes: ActivityChange[] = []
    const before = isObj(d.before) ? d.before : {}
    const after = isObj(d.after) ? d.after : {}
    for (const key of Array.isArray(d.changed) ? d.changed : []) {
      if (!SETTING_LABEL[key] || !(key in before) || !(key in after)) continue
      change(changes, t(SETTING_LABEL[key]), settingValue(key, before[key]), settingValue(key, after[key]))
    }
    return { text: k('team.settingsChanged'), changes }
  },
  'team:dissolved': (_e, d) => ({ text: k('team.dissolved'), notes: has(d.purgeAt) && formatDate(d.purgeAt) ? [k('note.purgeAt', { date: formatDate(d.purgeAt) })] : [] }),
}

/** 这份代码认识的全部类型（测试用它核对「合同里的每一种都写得出来」） */
export const ACTIVITY_TYPES = Object.keys(WRITERS)

/** 服务端那句话以操作人开头，而操作人已经单独一列：开头那个名字不重复写 */
function fromMessage(e: TeamActivityItem): string {
  const msg = e.message || ''
  const who = e.actor?.name || ''
  return who && msg.startsWith(who + ' ') ? msg.slice(who.length + 1) : msg
}

export function describeActivity(e: TeamActivityItem, ctx: ActivityContext = {}): ActivityLine {
  const writer = WRITERS[e.type]
  let out: Partial<ActivityLine> | null = null
  if (writer) {
    try { out = writer(e, isObj(e.detail) ? e.detail : {}, ctx) } catch { out = null }
  }
  if (!out || !out.text) return { text: fromMessage(e) || e.type, changes: [], notes: [], fallback: true }
  return { text: out.text, changes: out.changes || [], notes: out.notes || [], fallback: false }
}

/** 一行写完（导出、无障碍读屏、测试用）：做了什么 · 角色：成员 → 管理员 · 可用 10 次 */
export function activityPlain(line: ActivityLine): string {
  return [line.text, ...line.changes.map((c) => k('change', { label: c.label, from: c.from, to: c.to })), ...line.notes].join(' · ')
}

/** 操作人这一列写什么：站点的超级管理员从外面做的写「超级管理员」，否则是这个人此刻的名字 */
export function actorName(e: TeamActivityItem): string {
  if (e.actor?.system) return t('team.activity.log.siteAdmin')
  return personName(e.actor)
}
