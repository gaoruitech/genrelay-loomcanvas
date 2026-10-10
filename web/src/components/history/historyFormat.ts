import { t, currentLocale } from '@/locales'
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

/** 真实用时（结束 − 开始），毫秒；没跑完或没有时间戳返回 null */
export function durationMs(r: Pick<UsageRecord, 'startedAt' | 'finishedAt'>): number | null {
  if (!r.startedAt || !r.finishedAt) return null
  const ms = new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()
  return Number.isFinite(ms) && ms >= 0 ? ms : null
}

/** 1:52 / 1:02:08；不到一秒写成 <0:01，免得看起来像没跑 */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return '<0:01'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
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
