import { useI18n } from 'vue-i18n'
import type { CanvasLock } from '@/types'

/** 一个人在界面上叫什么：全站只有一份，见 utils/person.ts */
export { personName, personTitle } from '@/utils/person'

/** 这把编辑锁现在还算不算数（过期的锁服务端不会主动清掉） */
export function lockActive(lock: CanvasLock | null | undefined, now = Date.now()): boolean {
  if (!lock) return false
  const until = new Date(lock.expiresAt).getTime()
  return Number.isFinite(until) && until > now
}

/**
 * 团队画布卡片上的时间：说的是「最近一次改动」，所以越近越口语 ——
 * 刚刚 / 12 分钟前 / 今天 10:24 / 昨天 21:40 / 10-09 17:30 / 2025-12-30。
 */
export function useCanvasTime() {
  const { t } = useI18n()
  const pad = (n: number) => String(n).padStart(2, '0')
  function recent(v: string | null | undefined, now = Date.now()): string {
    if (!v) return ''
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return ''
    const mins = Math.floor((now - d.getTime()) / 60000)
    if (mins < 1) return t('views.team.justNow')
    if (mins < 60) return t('views.team.minutesAgo', { n: mins })
    const n = new Date(now)
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
    const diff = Math.round((day(n) - day(d)) / 86400000)
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (diff === 0) return t('views.list.today', { time: hm })
    if (diff === 1) return t('views.list.yesterday', { time: hm })
    const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return d.getFullYear() === n.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}-${md}`
  }
  return { recent }
}
