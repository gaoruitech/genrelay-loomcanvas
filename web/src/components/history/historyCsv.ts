import { t } from '@/locales'
import { personTitle } from '@/utils/person'
import { costOf, durationMs, fileCount } from './historyFormat'
import type { UsageRecord } from '@/types'

/**
 * 生成记录导出成 CSV：一条记录一行，对话记录的提示词、系统提示词和回复都是全文。
 *
 * 格式上要照顾的几件事（Excel / WPS / Numbers 直接双击打开就对）：
 *  - 开头带 BOM，否则 Excel 不按 UTF-8 读，中文全是乱码；行尾用 CRLF；
 *  - 有逗号、引号、换行的格子用双引号包起来，里面的引号写两遍；
 *  - 以 = + - @（或制表符、回车）开头的文字，表格软件会当公式执行：前面垫一个单引号。数字不垫；
 *  - 一个格子最多 32767 个字符（Excel 的上限，超了会把后面的内容挤进下一行）：太长的回复截断并注明全文多长。
 */

export const CSV_BOM = '﻿'
/** Excel 一个格子的上限是 32767；留一点给截断说明 */
export const CSV_CELL_MAX = 32000

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v)
  if (s.length > CSV_CELL_MAX) s = s.slice(0, CSV_CELL_MAX) + t('history.csv.cut', { n: s.length })
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildCsv(rows: unknown[][]): string {
  return CSV_BOM + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

const pad = (n: number) => String(n).padStart(2, '0')
/**
 * 2026-10-13 13:51:00，按浏览器所在的时区：表格软件认得这种写法，能当时间排序、筛选
 * （带 T 和 Z 的 ISO 写法它只当一串字，而且是 UTC，不是人看的那个钟点）。是哪个时区写在表头里。
 */
export function localStamp(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function timeZoneName(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || '' } catch { return '' }
}

const seconds = (ms: number | null | undefined) => (typeof ms === 'number' && ms >= 0 ? Number((ms / 1000).toFixed(1)) : '')

/** 列的顺序。member / username 只有团队里才有 */
export const CSV_COLUMNS = [
  'time', 'member', 'username', 'model', 'modelId', 'kind', 'status',
  'queuedSeconds', 'seconds', 'cost', 'currency', 'costNote', 'inputTokens', 'outputTokens',
  'canvas', 'prompt', 'systemPrompt', 'text', 'files', 'errorCode', 'error', 'runId',
] as const
export type CsvColumn = typeof CSV_COLUMNS[number]

export interface CsvContext {
  /** 团队里：带上「成员」「用户名」两列 */
  withMember: boolean
  /** false：不带「成本」「币种」「成本说明」三列（集成方关了成本显示 features.cost）。不给就是带 */
  withCost?: boolean
  /** 记录所在画布的名字（没关联画布、画布删了由调用处决定写什么） */
  canvasName: (r: UsageRecord) => string
}

function costCells(r: UsageRecord): [number | string, string, string] {
  const c = costOf(r)
  if (c.kind === 'spent') return [c.amount ?? '', c.currency, '']
  if (c.kind === 'none') return [0, '', t('history.csv.costNone')]
  if (c.kind === 'unknown') return ['', '', t('history.csv.costUnknown')]
  // 还没跑完：写预估的那个数，并且说明它只是预估
  const known = r.cost && !r.cost.unknown
  return [known ? Number(r.cost!.amount) || 0 : '', known ? r.cost!.currency || '' : '', t('history.csv.costEstimate')]
}

export function recordCells(r: UsageRecord, ctx: CsvContext): Record<CsvColumn, unknown> {
  const [cost, currency, costNote] = costCells(r)
  const ended = r.status === 'failed' || r.status === 'canceled'
  const files = r.kind === 'chat' ? '' : r.filesPurged ? t('history.filesPurged') : r.status === 'succeeded' ? fileCount(r) : ''
  return {
    time: localStamp(r.createdAt),
    member: personTitle(r.createdBy),
    username: r.createdBy?.username || '',
    model: r.modelLabel || r.model,
    modelId: r.model,
    kind: t('history.kinds.' + r.kind),
    status: t('history.statuses.' + r.status),
    queuedSeconds: seconds(r.queuedMs),
    seconds: seconds(durationMs(r)),
    cost,
    currency,
    costNote,
    inputTokens: r.usage ? r.usage.inputTokens : '',
    outputTokens: r.usage ? r.usage.outputTokens : '',
    canvas: ctx.canvasName(r),
    prompt: r.prompt || '',
    systemPrompt: r.systemPrompt || '',
    text: r.text || '',
    files,
    errorCode: ended ? r.errorCode || '' : '',
    error: ended ? r.error || '' : '',
    runId: r.id,
  }
}

export function recordsToCsv(list: UsageRecord[], ctx: CsvContext): string {
  const cols = CSV_COLUMNS
    .filter(c => ctx.withMember || (c !== 'member' && c !== 'username'))
    .filter(c => ctx.withCost !== false || (c !== 'cost' && c !== 'currency' && c !== 'costNote'))
  const tz = timeZoneName()
  const rows: unknown[][] = [cols.map(c => (c === 'time' && tz ? t('history.csv.timeIn', { tz }) : t('history.csv.' + c)))]
  for (const r of list) {
    const cells = recordCells(r, ctx)
    rows.push(cols.map(c => cells[c]))
  }
  return buildCsv(rows)
}
