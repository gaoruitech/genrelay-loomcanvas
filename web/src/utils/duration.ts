import { t } from '@/locales'

/**
 * 时长怎么写，全站只有这一份 —— 每种语言一种写法，节点、输入条、属性面板、参数 chip、队列、任务详情、
 * 生成记录读出来的是同一句话：
 *
 *              片长（参数）   用时 / 已用时 / 还剩
 *   zh-CN      8 秒           42 秒 · 1 分 05 秒 · 1 小时 02 分 · <1 秒
 *   en         8s             42s · 1m 05s · 1h 02m · <1s
 *
 * 规则：
 *  - 带了「分」之后秒补成两位、带了「小时」之后分补成两位：一列时长上下对得齐，正在走的用时也不会来回变宽；
 *  - 满一小时就不写秒：跑了一个多小时的任务差几秒没有人在意，写全了一格放不下；
 *  - 不到一秒写「<1 秒」，不写 0：0 看起来像没跑；
 *  - 没有这个数（没跑完、没记下来）是一个破折号。
 * 导出的 CSV 不走这里：那里是给表格软件算的，一律是秒数（见 components/history/historyCsv.ts）。
 * 视频画面上压着的 0:08 是播放器的时间码（位置 / 总长），不是这里的「时长」，见 timecode。
 */

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 片长：视频生成的「时长」参数，以及模型选项里的每一档。8 → 「8 秒」/「8s」 */
export function clipLength(seconds: number | string): string {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return ''
  return t('duration.sec', { s: Number.isInteger(n) ? n : Number(n.toFixed(1)) })
}

export type SpanRounding = 'round' | 'floor' | 'ceil'

/**
 * 一段时间有多长（毫秒）。
 *   round  已经结束的用时（默认）
 *   floor  正在走的「已用时」：不提前跳到下一秒，从 0 秒起
 *   ceil   倒计时 / 还要等多久：还剩 0.2 秒也说「1 秒」
 */
export function spanText(ms: number | null | undefined, rounding: SpanRounding = 'round'): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'
  if (rounding === 'round' && ms < 1000) return t('duration.under')
  const total = rounding === 'floor' ? Math.floor(ms / 1000) : rounding === 'ceil' ? Math.max(1, Math.ceil(ms / 1000)) : Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return t('duration.hourMin', { h, m: pad2(m) })
  if (m) return t('duration.minSec', { m, s: pad2(s) })
  return t('duration.sec', { s })
}

/** 时间码：视频缩略图上压着的总长、播放位置。0:08 / 12:05 / 1:02:03 —— 两种语言一样 */
export function timecode(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = pad2(total % 60)
  return h ? `${h}:${pad2(m)}:${s}` : `${m}:${s}`
}
