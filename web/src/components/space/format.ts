import { currentLocale } from '@/locales'

/** 到那一刻还有几天（向上取整，至少 0） */
export function daysUntil(iso?: string | null): number {
  if (!iso) return 0
  const ms = new Date(iso).getTime() - Date.now()
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 86400000)) : 0
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 2026-10-18 */
export function formatDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 2026-10-18 14:32 */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${formatDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 14:32 */
export function formatClock(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 今天的只写时分，更早的带上日期：「14:32」/「10-11 18:02」 */
export function formatRecent(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = formatClock(iso)
  if (d.toDateString() === new Date().toDateString()) return time
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return `${sameYear ? '' : d.getFullYear() + '-'}${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
}

/** 浏览器所在的 IANA 时区；取不到返回空串 */
export function browserZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' }
}

/** 从用户粘贴的东西里取邀请码：整条链接（…/join/<码>）或者码本身 */
export function inviteTokenOf(input: string): string {
  const s = String(input || '').trim()
  if (!s) return ''
  const m = /\/join\/([A-Za-z0-9_-]{16,})/.exec(s)
  if (m) return m[1]
  return /^[A-Za-z0-9_-]{16,}$/.test(s) ? s : ''
}

/** 按界面语言排列的整数写法（1,486） */
export function formatInt(n: number): string {
  try { return new Intl.NumberFormat(currentLocale()).format(Number(n) || 0) } catch { return String(n) }
}
