import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../src/locales'
import { ACTIVITY_TYPES, activityPlain, actorName, describeActivity, priceText } from '../src/components/team/activityText'
import { personName, personNote, personState, personTitle } from '../src/utils/person'
import type { Person, TeamActivityItem } from '../src/types'
import { createEmbedContext, setCurrentEmbed } from '../src/embed/context'
import { resolveFeatures } from '../src/embed/options'

/**
 * The team activity log is written on the client from type + actor + target + detail
 * (components/team/activityText.ts): every type of the server contract (CONTRACT-S2 §7 / docs/api.md
 * "The activity log") renders in both languages, with before → after where the entry carries it, and an
 * entry the client cannot write (unknown type, old entry without the fields) falls back to the server's sentence.
 */
afterEach(() => setLocale('en', false))

const LOCALES = ['zh-CN', 'en'] as const
const person = (name: string, state: Person['state'] = 'active', id = 'a'.repeat(24)): Person => ({ id, username: name.toLowerCase(), name, state, left: state !== 'active', deleted: state === 'deleted' })
const zhouyu = person('周屿', 'active', 'b'.repeat(24))
const linzhou = person('林舟', 'active', 'a'.repeat(24))

let seq = 0
function entry(type: string, o: Partial<TeamActivityItem> = {}): TeamActivityItem {
  return {
    id: String(++seq), type, category: 'team', actor: { ...linzhou, system: false },
    target: null, detail: {}, message: `林舟 SERVER SENTENCE ${type}`, createdAt: '2026-10-12T08:15:02.000Z', ...o,
  }
}
const member = (p: Person) => ({ type: 'member', id: p.id, name: p.name, person: p })
const thing = (type: string, name: string) => ({ type, id: 'c'.repeat(24), name })
const limits = (teamRuns: number | null, teamAmount: number | null, defRuns: number | null, defAmount: number | null, currency = 'CNY', blockUnpriced = false) => ({
  team: { runs: teamRuns, amount: teamAmount }, memberDefault: { runs: defRuns, amount: defAmount }, currency, blockUnpriced,
})

/** One full entry per type of the contract table. */
const SAMPLES: Record<string, TeamActivityItem> = {
  'member:joined': entry('member:joined', { actor: { ...zhouyu, system: false }, target: member(zhouyu), detail: { inviterId: linzhou.id, inviterName: '林舟', invitationId: 'x' } }),
  'member:left': entry('member:left', { actor: { ...zhouyu, system: false }, target: member(zhouyu), detail: { role: 'admin', canvasesInherited: 3, runsCanceled: 1 } }),
  'member:removed': entry('member:removed', { target: member(person('陈默', 'left', 'd'.repeat(24))), detail: { role: 'member', canvasesInherited: 2, runsCanceled: 0, wasAdmin: false, accountDeleted: false } }),
  'member:promoted': entry('member:promoted', { target: member(zhouyu), detail: { from: 'member', to: 'admin' } }),
  'member:demoted': entry('member:demoted', { target: member(zhouyu), detail: { from: 'admin', to: 'member' } }),
  'member:renamed': entry('member:renamed', { target: member(zhouyu), detail: { from: '', to: 'Mia Chen', username: 'zhouyu' } }),
  'team:transferred': entry('team:transferred', { target: member(zhouyu), detail: { fromId: linzhou.id, fromName: '林舟' } }),
  'team:owner_appointed': entry('team:owner_appointed', { actor: { id: '', name: '超级管理员', system: true }, target: member(zhouyu), detail: { fromId: linzhou.id, fromName: '林舟' } }),
  'invite:created': entry('invite:created', { target: { type: 'invite', id: 'e'.repeat(24), name: '' }, detail: { maxUses: 10, expiresAt: '2026-10-19T08:15:02.000Z', expiresInDays: 7 } }),
  'invite:revoked': entry('invite:revoked', { target: { type: 'invite', id: 'e'.repeat(24), name: '' }, detail: { maxUses: 10, usedCount: 3, expiresAt: '2026-10-19T08:15:02.000Z', createdById: zhouyu.id, createdByName: '周屿' } }),
  'provider:created': entry('provider:created', { target: thing('provider', '高瑞中转'), detail: { vendor: 'openai', enabled: false } }),
  'provider:deleted': entry('provider:deleted', { target: thing('provider', '高瑞中转'), detail: { vendor: 'openai' } }),
  'provider:key_changed': entry('provider:key_changed', { target: thing('provider', '高瑞中转'), detail: { cleared: false } }),
  'provider:url_changed': entry('provider:url_changed', { target: thing('provider', '高瑞中转'), detail: { custom: true } }),
  'provider:updated': entry('provider:updated', { target: thing('provider', '高瑞中转二号'), detail: { enabled: false, renamed: true, from: '高瑞中转', to: '高瑞中转二号' } }),
  'provider:model_added': entry('provider:model_added', { target: thing('provider', '高瑞中转'), detail: { model: 'my-image-1', kind: 'image' } }),
  'provider:model_removed': entry('provider:model_removed', { target: thing('provider', '高瑞中转'), detail: { model: 'my-image-1' } }),
  'model:enabled': entry('model:enabled', { target: thing('model', 'nano-banana-2') }),
  'model:disabled': entry('model:disabled', { target: thing('model', 'nano-banana-2') }),
  'model:price_changed': entry('model:price_changed', {
    target: thing('model', 'nano-banana-2'),
    detail: {
      priced: true,
      before: { unit: 'per_image', currency: 'CNY', price: 0.5, by: '', tiers: 0, min: 0.5, max: 0.5, input: null, output: null },
      after: { unit: 'per_image', currency: 'CNY', price: null, by: 'resolution', tiers: 2, min: 0.2, max: 0.4, input: null, output: null },
    },
  }),
  'limits:team_changed': entry('limits:team_changed', { target: thing('team', '星河短片工作室'), detail: { before: limits(100, null, 50, 20), after: limits(200, 500, 50, 20) } }),
  'limits:member_changed': entry('limits:member_changed', { target: member(zhouyu), detail: { before: { runs: null, amount: null }, after: { runs: 30, amount: null } } }),
  'usage:records_deleted': entry('usage:records_deleted', { detail: { deleted: 1240, before: '2026-07-01T00:00:00.000Z' } }),
  'canvas:deleted': entry('canvas:deleted', { target: thing('canvas', '秋季新品主图') }),
  'canvas:restored': entry('canvas:restored', { target: thing('canvas', '秋季新品主图') }),
  'canvas:visibility_changed': entry('canvas:visibility_changed', { target: thing('canvas', '秋季新品主图'), detail: { from: 'private', to: 'team_view' } }),
  'canvas:taken_over': entry('canvas:taken_over', { target: thing('canvas', '秋季新品主图'), detail: { fromId: zhouyu.id, fromName: '周屿' } }),
  'canvas:overwritten': entry('canvas:overwritten', { target: thing('canvas', '秋季新品主图'), detail: { revision: 12 } }),
  'share:created': entry('share:created', { target: thing('share', '秋季新品主图'), detail: { expiresAt: null } }),
  'share:revoked': entry('share:revoked', { target: thing('share', '秋季新品主图'), detail: { expiresAt: '2026-11-01T00:00:00.000Z' } }),
  'team:created': entry('team:created', { target: thing('team', '星河短片工作室') }),
  'team:restored': entry('team:restored', { target: thing('team', '星河短片工作室') }),
  'team:suspended': entry('team:suspended', { actor: { id: '', name: '超级管理员', system: true }, target: thing('team', '星河短片工作室') }),
  'team:resumed': entry('team:resumed', { actor: { id: '', name: '超级管理员', system: true }, target: thing('team', '星河短片工作室') }),
  'team:renamed': entry('team:renamed', { target: thing('team', '星河短片工作室'), detail: { from: '星河工作室', to: '星河短片工作室' } }),
  'team:avatar_changed': entry('team:avatar_changed', { target: thing('team', '星河短片工作室'), detail: { removed: false } }),
  'team:settings_changed': entry('team:settings_changed', {
    target: thing('team', '星河短片工作室'),
    detail: {
      changed: ['timezone', 'defaultVisibility', 'publicShare', 'adminsSeeAll', 'copyToPersonal', 'blockUnpriced'],
      before: { timezone: 'UTC', defaultVisibility: 'private', publicShare: 'editors', adminsSeeAll: false, copyToPersonal: true, blockUnpriced: false },
      after: { timezone: 'Asia/Shanghai', defaultVisibility: 'team_edit', publicShare: 'managers', adminsSeeAll: true, copyToPersonal: false, blockUnpriced: true },
    },
  }),
  'team:dissolved': entry('team:dissolved', { target: thing('team', '星河短片工作室'), detail: { purgeAt: '2026-10-19T08:15:02.000Z' } }),
}

/** The contract table, typed out: a type added on the server has to be added here and to the renderer. */
const CONTRACT_TYPES = [
  'member:joined', 'member:left', 'member:removed', 'member:promoted', 'member:demoted', 'member:renamed',
  'team:transferred', 'team:owner_appointed', 'invite:created', 'invite:revoked',
  'provider:created', 'provider:deleted', 'provider:key_changed', 'provider:url_changed', 'provider:updated',
  'provider:model_added', 'provider:model_removed', 'model:enabled', 'model:disabled', 'model:price_changed',
  'limits:team_changed', 'limits:member_changed', 'usage:records_deleted',
  'canvas:deleted', 'canvas:restored', 'canvas:visibility_changed', 'canvas:taken_over', 'canvas:overwritten',
  'share:created', 'share:revoked',
  'team:created', 'team:restored', 'team:suspended', 'team:resumed', 'team:renamed', 'team:avatar_changed',
  'team:settings_changed', 'team:dissolved',
]

const plain = (type: string) => activityPlain(describeActivity(SAMPLES[type]))

describe('activity sentences', () => {
  it('knows exactly the types of the contract', () => {
    expect([...ACTIVITY_TYPES].sort()).toEqual([...CONTRACT_TYPES].sort())
    expect(Object.keys(SAMPLES).sort()).toEqual([...CONTRACT_TYPES].sort())
  })

  for (const locale of LOCALES) {
    it(`writes every type itself in ${locale}: no fallback, no leftover placeholder or key`, () => {
      setLocale(locale, false)
      for (const type of CONTRACT_TYPES) {
        const line = describeActivity(SAMPLES[type])
        const text = activityPlain(line)
        expect(line.fallback, type).toBe(false)
        expect(text, type).not.toMatch(/SERVER SENTENCE|team\.activity\.|spaces\.|\{[a-zA-Z]+\}|undefined|null|NaN|\[object/)
        // the actor has a column of its own: the sentence does not start with the name
        expect(line.text.startsWith('林舟'), type).toBe(false)
      }
    })
  }

  it('shows before → after (zh-CN)', () => {
    setLocale('zh-CN', false)
    expect(plain('member:promoted')).toBe('把 周屿 设为管理员 · 角色：成员 → 管理员')
    expect(plain('member:demoted')).toContain('角色：管理员 → 成员')
    expect(plain('member:renamed')).toBe('修改了 周屿 在团队里的显示名 · 显示名：（无） → Mia Chen')
    expect(plain('team:renamed')).toBe('修改了团队名称 · 团队名称：星河工作室 → 星河短片工作室')
    expect(plain('canvas:visibility_changed')).toBe('修改了画布「秋季新品主图」的可见范围 · 可见范围：仅自己 → 团队可看')
    expect(plain('model:price_changed')).toBe('修改了模型「nano-banana-2」的价格 · 价格：¥0.50/张 → ¥0.20–¥0.40/张（按分辨率，2 档）')
    expect(plain('limits:member_changed')).toBe('修改了 周屿 的每月上限 · 每月运行次数上限：跟随成员默认值 → 30 次')
    expect(plain('team:transferred')).toContain('团长：林舟 → 周屿')
    // a member's amount limit carries no currency: the team's current one is used when the caller knows it
    const amount = entry('limits:member_changed', { target: member(zhouyu), detail: { before: { runs: 30, amount: null }, after: { runs: 30, amount: 60 } } })
    expect(activityPlain(describeActivity(amount, { currency: 'CNY' }))).toBe('修改了 周屿 的每月上限 · 每月预估金额上限：跟随成员默认值 → ¥60.00')
    expect(activityPlain(describeActivity(amount))).toContain('跟随成员默认值 → 60')
    const team = describeActivity(SAMPLES['limits:team_changed'])
    // only what differs: team runs and team amount, not the member default, currency or the switch
    expect(team.changes).toEqual([
      { label: '团队每月运行次数上限', from: '100 次', to: '200 次' },
      { label: '团队每月预估金额上限', from: '不限', to: '¥500.00' },
    ])
    const settings = describeActivity(SAMPLES['team:settings_changed'])
    expect(settings.changes.map((c) => `${c.from}→${c.to}`)).toEqual(['UTC→Asia/Shanghai', '仅自己→团队可改', '能编辑画布的成员→仅团长和管理员', '关→开', '开→关', '关→开'])
    expect(settings.changes).toHaveLength(6)
  })

  it('shows before → after (en)', () => {
    setLocale('en', false)
    expect(plain('member:promoted')).toBe('made 周屿 an admin · Role: Member → Admin')
    expect(plain('member:renamed')).toBe('changed the display name of 周屿 in the team · Display name: (none) → Mia Chen')
    expect(plain('canvas:visibility_changed')).toContain('Visibility: Only me → Team can view')
    expect(plain('model:price_changed')).toContain('Price: CN¥0.50/image → CN¥0.20–CN¥0.40/image (by resolution, 2 tiers)')
    expect(describeActivity(SAMPLES['limits:team_changed']).changes.map((c) => c.to)).toEqual(['200 runs', 'CN¥500.00'])
  })

  it('adds the facts that came with the action', () => {
    setLocale('zh-CN', false)
    expect(plain('member:joined')).toBe('通过 林舟 的邀请链接加入了团队')
    expect(plain('member:left')).toBe('退出了团队 · 原为管理员 · 名下 3 张画布转给了团长 · 取消了 1 个进行中的运行')
    // a removed member keeps the name and says where they went
    expect(plain('member:removed')).toBe('把 陈默 · 已离开团队 移出了团队 · 名下 2 张画布转给了团长')
    expect(plain('invite:created')).toBe('创建了一条邀请链接 · 可用 10 次 · 2026-10-19 到期')
    expect(plain('invite:revoked')).toBe('撤销了 周屿 创建的一条邀请链接 · 已用 3 / 10 次 · 2026-10-19 到期')
    expect(plain('provider:created')).toBe('添加了服务商「高瑞中转」 · 暂未启用')
    expect(plain('provider:updated')).toBe('给服务商改了名，现在叫「高瑞中转二号」 · 名称：高瑞中转 → 高瑞中转二号 · 状态：启用 → 停用')
    expect(plain('provider:url_changed')).toBe('把「高瑞中转」的接口地址改成了自定义地址')
    expect(plain('provider:model_added')).toBe('在「高瑞中转」添加了自定义模型 my-image-1 · 图片模型')
    expect(plain('usage:records_deleted')).toBe('删除了 1,240 条生成记录 · 2026-07-01 之前的')
    expect(plain('canvas:taken_over')).toBe('从 周屿 手中接管了画布「秋季新品主图」的编辑')
    expect(plain('canvas:overwritten')).toContain('第 12 版')
    expect(plain('share:created')).toContain('长期有效')
    expect(plain('team:dissolved')).toContain('2026-10-19 永久删除')
  })

  it('branches on the detail', () => {
    setLocale('zh-CN', false)
    const text = (type: string, o: Partial<TeamActivityItem>) => activityPlain(describeActivity(entry(type, o)))
    const provider = thing('provider', '高瑞中转')
    expect(text('provider:key_changed', { target: provider, detail: { cleared: true } })).toBe('清除了「高瑞中转」的 API Key')
    expect(text('provider:url_changed', { target: provider, detail: { custom: false } })).toBe('把「高瑞中转」的接口地址改回了官方地址')
    expect(text('provider:updated', { target: provider, detail: { enabled: true } })).toBe('启用了服务商「高瑞中转」')
    expect(text('provider:updated', { target: provider, detail: { enabled: false } })).toBe('停用了服务商「高瑞中转」')
    expect(text('provider:updated', { target: provider, detail: {} })).toBe('修改了服务商「高瑞中转」')
    expect(text('team:avatar_changed', { detail: { removed: true } })).toBe('移除了团队头像')
    expect(text('member:renamed', { actor: { ...zhouyu, system: false }, target: member(zhouyu), detail: { from: 'Mia', to: '' } })).toBe('修改了自己在团队里的显示名 · 显示名：Mia → （无）')
    expect(text('member:removed', { actor: { id: '', name: '超级管理员', system: true }, target: member(person('沈青', 'deleted')), detail: { accountDeleted: true } }))
      .toBe('删除了 沈青 · 账号已删除 的账号，这个人随之离开了团队')
    expect(text('invite:created', { detail: { maxUses: 0 } })).toBe('创建了一条邀请链接 · 不限次数')
    // revoking your own link does not name you twice
    expect(text('invite:revoked', { detail: { createdById: linzhou.id, createdByName: '林舟', maxUses: 0, usedCount: 4 } })).toBe('撤销了一条邀请链接 · 已用 4 次，不限次数')
    expect(text('model:price_changed', { target: thing('model', 'gpt-x'), detail: { before: null, after: { unit: 'per_1m_tokens', currency: 'USD', price: null, by: '', tiers: 0, min: null, max: null, input: 2, output: 8 } } }))
      .toBe('修改了模型「gpt-x」的价格 · 价格：未定价 → 输入 US$2.00 / 输出 US$8.00 每百万 token')
  })

  it('falls back to the server sentence (without repeating the actor) for what it cannot write', () => {
    for (const locale of LOCALES) {
      setLocale(locale, false)
      // an unknown type
      const unknown = describeActivity(entry('billing:exported', { message: '林舟 exported the bill' }))
      expect(unknown).toEqual({ text: 'exported the bill', changes: [], notes: [], fallback: true })
      // limits saved without a difference; an old entry whose before/after only carry currency + blockUnpriced
      expect(describeActivity(entry('limits:team_changed', { detail: { before: limits(1, 2, 3, 4), after: limits(1, 2, 3, 4) } })).fallback).toBe(true)
      expect(describeActivity(entry('limits:team_changed', { detail: { before: { currency: 'CNY', blockUnpriced: false }, after: { currency: 'CNY', blockUnpriced: false } } })).fallback).toBe(true)
      // …but an old entry that did change the switch is written, and the missing numbers are not read as "no limit"
      const old = describeActivity(entry('limits:team_changed', { detail: { before: { currency: 'CNY', blockUnpriced: false }, after: { currency: 'CNY', blockUnpriced: true } } }))
      expect(old.fallback).toBe(false)
      expect(old.changes).toHaveLength(1)
      // old entries: no detail at all, a target without a name
      expect(describeActivity(entry('canvas:deleted', { target: null })).fallback).toBe(true)
      expect(describeActivity(entry('usage:records_deleted', { detail: {} })).fallback).toBe(true)
      expect(describeActivity(entry('member:promoted', { target: { type: 'member', id: 'x', name: '周屿' }, detail: {} })).fallback).toBe(false)
      expect(describeActivity(entry('team:settings_changed', { detail: {} }))).toMatchObject({ fallback: false, changes: [] })
      // no message either: the type itself rather than an empty row
      expect(describeActivity(entry('x:y', { message: '' })).text).toBe('x:y')
    }
  })

  it('names the actor: the site admin, a member as they are now, a nameless former member', () => {
    setLocale('zh-CN', false)
    expect(actorName(SAMPLES['team:suspended'])).toBe('超级管理员')
    expect(actorName(entry('team:created'))).toBe('林舟')
    expect(actorName(entry('team:created', { actor: { id: 'f'.repeat(24), username: '', name: '', state: 'left' } }))).toBe('前成员')
    setLocale('en', false)
    expect(actorName(SAMPLES['team:suspended'])).toBe('Super admin')
    expect(actorName(entry('team:created', { actor: { id: 'f'.repeat(24), username: '', name: '', state: 'deleted' } }))).toBe('Deleted account')
  })
})

describe('priceText', () => {
  it('writes single prices, ranges, token rates and no price', () => {
    setLocale('en', false)
    expect(priceText(null)).toBe('no price')
    expect(priceText({ unit: 'per_second', currency: 'USD', price: 0.05 })).toBe('$0.05/second')
    expect(priceText({ unit: 'per_video', currency: 'USD', price: null, by: 'duration', tiers: 3, min: 1, max: 3 })).toBe('$1.00–$3.00/video (by duration, 3 tiers)')
    expect(priceText({ unit: 'per_1m_tokens', currency: 'USD', price: 1.5 })).toBe('$1.50/1M tokens')
    expect(priceText({ unit: 'per_image', currency: 'USD', price: null, by: 'resolution_duration', tiers: 4, min: 2, max: 2 })).toBe('$2.00/image (by resolution and duration, 4 tiers)')
  })
})

describe('person (utils/person.ts)', () => {
  it('keeps the name and adds where they went; neutral label only when no name was kept', () => {
    setLocale('zh-CN', false)
    expect(personTitle(person('周屿'))).toBe('周屿')
    expect(personTitle(person('周屿', 'left'))).toBe('周屿 · 已离开团队')
    expect(personTitle(person('周屿', 'deleted'))).toBe('周屿 · 账号已删除')
    expect(personTitle({ id: 'x', username: '', name: '', state: 'left' })).toBe('前成员')
    expect(personTitle({ id: 'x', username: '', name: '', state: 'deleted' })).toBe('已删除的账号')
    expect(personName({ id: 'x', username: 'mia', name: '' })).toBe('mia')
    expect(personName(null)).toBe('未知成员')
    expect(personNote({ id: 'x', username: '', name: '', state: 'left' })).toBe('')
    setLocale('en', false)
    expect(personTitle(person('Mia', 'left'))).toBe('Mia · Left the team')
    expect(personTitle(person('Mia', 'deleted'))).toBe('Mia · Account deleted')
    expect(personTitle({ id: 'x', username: '', name: '', state: 'left' })).toBe('Former member')
    expect(personTitle({ id: 'x', username: '', name: '', state: 'deleted' })).toBe('Deleted account')
  })
  it('reads the old booleans when a server sends no state', () => {
    expect(personState({ id: 'x', username: 'a', name: 'A', left: true, deleted: true })).toBe('deleted')
    expect(personState({ id: 'x', username: 'a', name: 'A', left: true })).toBe('left')
    expect(personState({ id: 'x', username: 'a', name: 'A' })).toBe('active')
    expect(personState({ id: 'x', username: 'a', name: 'A', state: 'left', left: true, deleted: true })).toBe('left')
  })
})

describe('money is left out when the host switched cost off', () => {
  afterEach(() => setCurrentEmbed(null))

  it('says what was changed, without amounts, prices or the currency', () => {
    setCurrentEmbed(createEmbedContext({ mode: 'app', features: resolveFeatures({ cost: false }, { mode: 'app' }) }))
    setLocale('en', false)
    for (const type of ['model:price_changed', 'limits:team_changed', 'limits:member_changed']) {
      const text = plain(type)
      expect(text, type).not.toMatch(/[¥￥$€]|CN¥|CNY/)
      expect(text.length, type).toBeGreaterThan(8)
    }
    // run-count limits are not money: they stay
    expect(plain('limits:team_changed')).toMatch(/100 runs → 200 runs/)
    // with cost on (the default) the same entries carry the money
    setCurrentEmbed(null)
    expect(plain('model:price_changed')).toMatch(/¥/)
    expect(plain('limits:team_changed')).toMatch(/¥/)
  })
})
