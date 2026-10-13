import { beforeEach, describe, expect, it } from 'vitest'
import { setLocale } from '../src/locales'
import { costOf, durationMs, fileCount, historyLayout, LAYOUT_MIN, zipFileCount } from '../src/components/history/historyFormat'
import { buildCsv, csvCell, CSV_BOM, CSV_CELL_MAX, localStamp, recordCells, recordsToCsv } from '../src/components/history/historyCsv'
import { filenameFromDisposition, readRefusal, safeFilename } from '../src/components/history/historyZip'
import type { UsageRecord } from '../src/types'

const base: UsageRecord = {
  id: '6acdc6c49d149bc183c3b8f3', createdAt: '2026-10-13T05:51:00.000Z', model: 'gaorui:gpt-5.5', modelLabel: 'GPT 5.5', kind: 'chat', status: 'succeeded',
  cost: { amount: 0.0005, currency: 'CNY', unknown: false }, prompt: 'hello', text: 'world', textLength: 5,
  usage: { inputTokens: 412, outputTokens: 1286, totalTokens: 1698 }, startedAt: '2026-10-13T05:51:01.000Z', finishedAt: '2026-10-13T05:51:03.500Z',
  queuedMs: 1000, durationMs: 2500, outputs: [],
}
const rec = (over: Partial<UsageRecord>): UsageRecord => ({ ...base, ...over })
const ctx = { withMember: true, canvasName: () => 'Night rain' }

/** 把一份 CSV 重新拆回格子（RFC 4180），用来验证写出去的东西别的程序读得回来 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const s = text.startsWith(CSV_BOM) ? text.slice(1) : text
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++ }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

describe('what a record cost (the list, the detail and the CSV say the same)', () => {
  beforeEach(() => setLocale('en', false))

  it('a succeeded run with a price: its cost', () => {
    expect(costOf(rec({}))).toMatchObject({ kind: 'spent', amount: 0.0005, currency: 'CNY' })
    expect(costOf(rec({})).text).toContain('0.0005')
  })
  it('a succeeded run without a price is "cost unknown", never 0', () => {
    const c = costOf(rec({ cost: { amount: 0, currency: '', unknown: true } }))
    expect(c).toMatchObject({ kind: 'unknown', amount: null, text: 'Cost unknown' })
  })
  it('a failed or canceled run costs nothing: the estimate from submit time is not shown as its cost', () => {
    for (const status of ['failed', 'canceled'] as const) {
      const c = costOf(rec({ status, cost: { amount: 0.3, currency: 'CNY', unknown: false } }))
      expect(c).toMatchObject({ kind: 'none', amount: 0, text: 'No charge' })
      expect(c.text).not.toContain('0.3')
    }
  })
  it('a run still in progress shows the estimate, marked as one', () => {
    for (const status of ['queued', 'running', 'archiving'] as const) {
      const c = costOf(rec({ status, cost: { amount: 0.3, currency: 'CNY', unknown: false } }))
      expect(c.kind).toBe('estimate')
      expect(c.text.startsWith('≈')).toBe(true)
      expect(c.amount).toBeNull()
    }
    expect(costOf(rec({ status: 'running', cost: { amount: 0, currency: '', unknown: true } })).text).toBe('—')
  })
})

describe('what a record has to take away', () => {
  it('files of a succeeded image / video run; a chat answer is one text file', () => {
    const img = rec({ kind: 'image', text: '', textLength: 0, outputs: [{ type: 'image', url: '/files/a.png' }, { type: 'image', url: '/files/b.png' }] })
    expect([fileCount(img), zipFileCount(img)]).toEqual([2, 2])
    expect([fileCount(rec({})), zipFileCount(rec({}))]).toEqual([0, 1])
    expect(zipFileCount(rec({ text: '', textLength: 0 }))).toBe(0)
    // 列表里的回复是截过的：有没有回复看 textLength
    expect(zipFileCount(rec({ text: '', textLength: 900 }))).toBe(1)
  })
  it('nothing for runs that did not succeed or whose files were purged', () => {
    expect(zipFileCount(rec({ kind: 'image', status: 'failed', outputs: [] }))).toBe(0)
    expect(zipFileCount(rec({ kind: 'image', status: 'running', outputs: [] }))).toBe(0)
    expect(zipFileCount(rec({ kind: 'image', text: '', outputs: [], filesPurged: true }))).toBe(0)
  })
  it('duration: the server\'s number when it gives one, else finished - started', () => {
    expect(durationMs(rec({}))).toBe(2500)
    expect(durationMs(rec({ durationMs: undefined }))).toBe(2500)
    expect(durationMs(rec({ durationMs: null, finishedAt: null }))).toBeNull()
  })
})

describe('historyLayout (by the width of the table itself)', () => {
  it('a table when every column fits; the member column needs more room', () => {
    expect(historyLayout(1176, true)).toBe('table') // 1440 宽的窗口，团队里
    expect(historyLayout(1176, false)).toBe('table')
    expect(historyLayout(LAYOUT_MIN.tableWithMember, true)).toBe('table')
    expect(historyLayout(LAYOUT_MIN.tableWithMember - 1, true)).toBe('list')
    expect(historyLayout(LAYOUT_MIN.tableWithMember - 1, false)).toBe('table')
    expect(historyLayout(LAYOUT_MIN.table - 1, false)).toBe('list')
  })
  it('two-line rows in between, cards on a phone', () => {
    expect(historyLayout(972, true)).toBe('list') // 1100 宽的窗口
    expect(historyLayout(LAYOUT_MIN.list, true)).toBe('list')
    expect(historyLayout(LAYOUT_MIN.list - 1, false)).toBe('cards')
    expect(historyLayout(358, true)).toBe('cards') // 390 宽的手机
  })
  it('a table until the width is known', () => {
    expect(historyLayout(0, true)).toBe('table')
  })
})

describe('CSV cells', () => {
  beforeEach(() => setLocale('en', false))

  it('quotes what has a comma, a quote or a line break, and doubles the quotes', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"')
    expect(csvCell('line 1\r\nline 2')).toBe('"line 1\r\nline 2"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })
  it('text that a spreadsheet would run as a formula gets a leading apostrophe', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"')
    expect(csvCell('+1+1')).toBe("'+1+1")
    expect(csvCell('-2+3')).toBe("'-2+3")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('\tcmd')).toBe("'\tcmd")
    expect(csvCell('\r=1')).toBe('"\'\r=1"')
    // 不在开头的不动
    expect(csvCell('a=b')).toBe('a=b')
  })
  it('numbers stay numbers (negative ones too): they are data, not text', () => {
    expect(csvCell(0.0005)).toBe('0.0005')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(-3)).toBe('-3')
    expect(csvCell(NaN)).toBe('')
  })
  it('a cell longer than a spreadsheet cell can hold is cut, and says how long the whole was', () => {
    const long = 'x'.repeat(CSV_CELL_MAX + 500)
    const out = csvCell(long)
    expect(out.length).toBeLessThan(32767)
    expect(out).toContain(String(long.length))
  })
  it('the file starts with a BOM, uses CRLF and ends with one', () => {
    const csv = buildCsv([['a', 'b'], [1, 'x,y']])
    expect(csv).toBe(CSV_BOM + 'a,b\r\n1,"x,y"\r\n')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
  })
})

describe('a history record as a CSV row', () => {
  beforeEach(() => setLocale('en', false))

  it('a chat run: prompt, system prompt, tokens, timings, cost and the whole answer', () => {
    const r = rec({
      prompt: 'Write three lines,\nwith a "quote"', systemPrompt: 'Be brief', text: 'Line one\nLine two, with a comma',
      createdBy: { id: 'u1', username: 'chenmo', name: '陈墨', state: 'active', left: false, deleted: false },
    })
    const c = recordCells(r, ctx)
    expect(c).toMatchObject({
      time: localStamp('2026-10-13T05:51:00.000Z'), member: '陈墨', username: 'chenmo', model: 'GPT 5.5', modelId: 'gaorui:gpt-5.5', kind: 'Chat', status: 'Succeeded',
      queuedSeconds: 1, seconds: 2.5, cost: 0.0005, currency: 'CNY', costNote: '', inputTokens: 412, outputTokens: 1286,
      canvas: 'Night rain', prompt: 'Write three lines,\nwith a "quote"', systemPrompt: 'Be brief', text: 'Line one\nLine two, with a comma',
      files: '', errorCode: '', error: '', runId: r.id,
    })
  })
  it('the time is local wall-clock time a spreadsheet can read, and the header says which zone', () => {
    expect(localStamp('2026-10-13T05:51:00.000Z')).toMatch(/^2026-10-1[34] \d\d:\d\d:00$/)
    expect(localStamp(null)).toBe('')
    const head = parseCsv(recordsToCsv([rec({})], ctx))[0]
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    expect(head[0]).toBe(tz ? `Time (${tz})` : 'Time')
  })
  it('round-trips through a CSV parser: no cell leaks into its neighbour', () => {
    const list = [
      rec({ prompt: '=HYPERLINK("http://example.com/x","click") starts like a formula', text: 'ok' }),
      rec({ id: 'b', prompt: 'say: "new, 20% off"\nsecond line', text: 'a\r\nb' }),
    ]
    const rows = parseCsv(recordsToCsv(list, ctx))
    expect(rows).toHaveLength(3)
    const head = rows[0]
    expect(new Set(rows.map(r => r.length))).toEqual(new Set([head.length]))
    const col = (name: string) => head.indexOf(name)
    expect(rows[1][col('Prompt')]).toBe('\'=HYPERLINK("http://example.com/x","click") starts like a formula')
    expect(rows[2][col('Prompt')]).toBe('say: "new, 20% off"\nsecond line')
    expect(rows[2][col('Reply (chat)')]).toBe('a\r\nb')
    expect(rows[1][col('Input tokens')]).toBe('412')
    expect(rows[1][col('Duration (s)')]).toBe('2.5')
  })
  it('failed and canceled runs: cost 0 with the reason, the stable error code and the message', () => {
    const failed = recordCells(rec({ status: 'failed', text: '', usage: null, error: 'The model did not answer in time', errorCode: 'run.timeout_chat', cost: { amount: 0.3, currency: 'CNY', unknown: false } }), ctx)
    expect(failed).toMatchObject({ cost: 0, currency: '', costNote: 'No charge (failed or canceled)', errorCode: 'run.timeout_chat', error: 'The model did not answer in time', inputTokens: '', outputTokens: '' })
    const canceled = recordCells(rec({ status: 'canceled', kind: 'image', text: '', error: 'Canceled while queued: the account was disabled', errorCode: 'run.canceled_account_disabled' }), ctx)
    expect(canceled).toMatchObject({ cost: 0, costNote: 'No charge (failed or canceled)', errorCode: 'run.canceled_account_disabled', error: 'Canceled while queued: the account was disabled' })
  })
  it('unknown cost is an empty cell with a note - not a 0 that sums as free; a running one is marked an estimate', () => {
    expect(recordCells(rec({ cost: { amount: 0, currency: '', unknown: true } }), ctx)).toMatchObject({ cost: '', costNote: 'Cost unknown (no price at the time)' })
    expect(recordCells(rec({ status: 'running', cost: { amount: 0.3, currency: 'CNY', unknown: false } }), ctx)).toMatchObject({ cost: 0.3, currency: 'CNY', costNote: 'Estimate (not finished yet)' })
  })
  it('an image run: how many files, or that retention removed them', () => {
    const img = rec({ kind: 'image', text: '', usage: null, outputs: [{ type: 'image', url: '/files/a.png' }, { type: 'image', url: '/files/b.png' }] })
    expect(recordCells(img, ctx).files).toBe(2)
    expect(recordCells({ ...img, outputs: [], filesPurged: true }, ctx).files).toBe('Files removed by the retention period')
  })
  it('somebody who left the team or whose account is gone keeps the name, with the state next to it', () => {
    const left = recordCells(rec({ createdBy: { id: 'u2', username: 'guanyue', name: '关月', state: 'left', left: true, deleted: false } }), ctx)
    expect([left.member, left.username]).toEqual(['关月 · Left the team', 'guanyue'])
    const deleted = recordCells(rec({ createdBy: { id: 'u3', username: 'baiyu', name: '白榆', state: 'deleted', left: true, deleted: true } }), ctx)
    expect(deleted.member).toBe('白榆 · Account deleted')
  })
  it('a personal space has no member columns', () => {
    const rows = parseCsv(recordsToCsv([rec({})], { withMember: false, canvasName: () => '' }))
    expect(rows[0]).not.toContain('Member')
    expect(rows[0]).not.toContain('Username')
    expect(rows[1]).toHaveLength(rows[0].length)
  })
  it('both languages have every column header', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      setLocale(locale, false)
      const head = parseCsv(recordsToCsv([rec({})], ctx))[0]
      expect(head.every(h => h && !h.startsWith('history.csv.'))).toBe(true)
    }
  })
})

describe('the zip download', () => {
  it('reads the archive name from Content-Disposition, the UTF-8 form first', () => {
    expect(filenameFromDisposition(`attachment; filename="download.zip"; filename*=UTF-8''%E7%94%9F%E6%88%90%E8%AE%B0%E5%BD%95_20261013-1405.zip`)).toBe('生成记录_20261013-1405.zip')
    expect(filenameFromDisposition('attachment; filename="history-20261013-140500.zip"')).toBe('history-20261013-140500.zip')
    expect(filenameFromDisposition(undefined)).toBe('')
    expect(filenameFromDisposition(`attachment; filename="download.zip"; filename*=UTF-8''%E7%ZZ`)).toBe('download.zip')
  })
  it('never saves under a name with a path in it', () => {
    expect(safeFilename('../../x.zip', 'history.zip')).toBe('_.._x.zip')
    expect(safeFilename('', 'history.zip')).toBe('history.zip')
    expect(safeFilename('a:b*c?.zip', 'h.zip')).toBe('a_b_c_.zip')
  })
  it('a refusal comes back as JSON inside the blob: its code and message are read out', async () => {
    const body = JSON.stringify({ result: -1, code: 'run.zip_max', message: 'One archive holds up to 100 files, but the selected records have 240. Download them in batches' })
    expect(await readRefusal(new Blob([body], { type: 'application/json' }), 400)).toEqual({ code: 'run.zip_max', message: JSON.parse(body).message, status: 400 })
    // 压缩包本身不是拒绝
    expect(await readRefusal(new Blob([new Uint8Array(5000)], { type: 'application/zip' }), 200)).toBeNull()
    expect(await readRefusal(new Blob(['PK\u0003\u0004'], { type: 'application/zip' }), 200)).toBeNull()
    expect(await readRefusal(undefined)).toBeNull()
  })
})
