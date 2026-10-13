import { t, currentLocale } from '@/locales'
import { formatCost, formatEstimate } from '@/utils/cost'
import { spanText } from '@/utils/duration'
import type { RunStatus, UsageRecord } from '@/types'

/** 还没结束的状态：这些行要轮询 */
export const ACTIVE_STATUSES: RunStatus[] = ['queued', 'running', 'archiving']

export function isActive(status: RunStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

/** 状态 → .lc-st 的颜色类 */
export function statusClass(status: RunStatus): string {
  if (status === 'succeeded') return 'ok'
  if (status === 'failed') return 'err'
  if (status === 'running' || status === 'archiving') return 'run'
  return 'wait'
}

/** 真实用时（结束 − 开始），毫秒；没跑完或没有时间戳返回 null。服务端算好了就用它的 */
export function durationMs(r: Pick<UsageRecord, 'startedAt' | 'finishedAt' | 'durationMs'>): number | null {
  if (typeof r.durationMs === 'number' && r.durationMs >= 0) return r.durationMs
  if (!r.startedAt || !r.finishedAt) return null
  const ms = new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

/**
 * 用时 / 排队多久：42 秒 · 1 分 52 秒 · 1 小时 02 分（英文 42s · 1m 52s · 1h 02m）；不到一秒写「<1 秒」，免得看起来像没跑；
 * 没有这个数是一个破折号。写法全站一份（utils/duration.ts）—— 和画布上的队列、节点读出来的是同一种。
 * 导出的 CSV 不走这里，那里是秒数（historyCsv.ts）。
 */
export function formatDuration(ms: number | null): string {
  return spanText(ms)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 表格里的短时间：今天 14:32 / 昨天 21:40 / 10-06 18:45 / 2025-12-31 08:00 */
export function formatWhen(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const now = new Date()
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((dayStart(now) - dayStart(d)) / 86400000)
  if (days === 0) return t('history.today', { time })
  if (days === 1) return t('history.yesterday', { time })
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return d.getFullYear() === now.getFullYear() ? `${md} ${time}` : `${d.getFullYear()}-${md} ${time}`
}

/** 完整时间（详情、悬停提示） */
export function formatFull(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeStyle: 'medium' }).format(d)
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/* ---- 这条记录花了多少 ---- */

/**
 * 「成本」一格写什么。记录上的 cost 是提交时估的，跑成了才是这次的花费：
 *  - spent    成功了并且有价格：这次的花费；
 *  - unknown  成功了但当时模型没有价格：成本未知（不是 0）；
 *  - estimate 还在排队 / 运行 / 转存：预估，跑完才算数；
 *  - none     失败、取消的：不计费（也不计入团队的每月上限），提交时估的那个数不再显示。
 */
export type CostKind = 'spent' | 'unknown' | 'estimate' | 'none'
export interface CostView {
  kind: CostKind
  /** 表格里的写法 */
  text: string
  /** 悬停 / 详情里的一句说明 */
  note: string
  /** 可以求和的金额；不计费是 0，成本未知、还在跑的是 null */
  amount: number | null
  currency: string
}

export function costOf(r: Pick<UsageRecord, 'status' | 'cost'>): CostView {
  const c = r.cost
  if (r.status === 'failed' || r.status === 'canceled') {
    return { kind: 'none', text: t('history.cost.none'), note: t('history.cost.noneNote'), amount: 0, currency: '' }
  }
  if (r.status === 'succeeded') {
    if (!c || c.unknown) return { kind: 'unknown', text: t('cost.unknown'), note: t('history.cost.unknownNote'), amount: null, currency: '' }
    return { kind: 'spent', text: formatCost(c) || '—', note: t('history.cost.spentNote'), amount: Number(c.amount) || 0, currency: c.currency || '' }
  }
  if (!c || c.unknown) return { kind: 'estimate', text: '—', note: t('history.cost.pendingUnknownNote'), amount: null, currency: '' }
  return { kind: 'estimate', text: formatEstimate(c) || '—', note: t('history.cost.estimateNote'), amount: null, currency: c.currency || '' }
}

/* ---- 这条记录有什么可以带走 ---- */

/** 成功的图片 / 视频运行还留着的文件数；对话记录是 0 */
export function fileCount(r: Pick<UsageRecord, 'status' | 'kind' | 'outputs'>): number {
  return r.status === 'succeeded' && r.kind !== 'chat' ? (r.outputs || []).length : 0
}
/** 打包下载时这条记录会变成几个文件：结果文件，或者对话的回复（一个 .txt）；没有可带走的是 0 */
export function zipFileCount(r: Pick<UsageRecord, 'status' | 'kind' | 'outputs' | 'text' | 'textLength'>): number {
  if (r.status !== 'succeeded') return 0
  if (r.kind === 'chat') return (r.textLength ?? (r.text || '').length) > 0 ? 1 : 0
  return (r.outputs || []).length
}

/** 12,345 */
export function formatInt(n: number): string {
  return new Intl.NumberFormat(currentLocale()).format(Math.round(Number(n) || 0))
}
/** 1.2 MB / 340 KB：下载进度用 */
export function formatBytes(n: number): string {
  const v = Math.max(0, Number(n) || 0)
  if (v < 1024 * 1024) return `${Math.max(1, Math.round(v / 1024))} KB`
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * 记录表排成哪一种（看的是表格自己有多宽，不是窗口）：
 *  - table 每项一列的表格。团队里多一列「成员」，要更宽才排得下；
 *  - list  一条记录两行：提示词占满一行，其余几项收成下面一行小字；
 *  - cards 手机上一条一张卡片。
 */
export type HistoryLayout = 'table' | 'list' | 'cards'
export const LAYOUT_MIN = { table: 980, tableWithMember: 1140, list: 640 }
export function historyLayout(width: number, withMember: boolean): HistoryLayout {
  // 量不到宽度（还没排版）：先按表格画
  if (!(width > 0)) return 'table'
  if (width >= (withMember ? LAYOUT_MIN.tableWithMember : LAYOUT_MIN.table)) return 'table'
  return width >= LAYOUT_MIN.list ? 'list' : 'cards'
}

/* ---- 团队里：记录是谁发起的 ---- */

/** 人怎么写全站只有一份：utils/person.ts（名字照旧 + 已离开团队 / 账号已删除） */
export { personName, personGone, personNote, personSub, personTitle } from '@/utils/person'
