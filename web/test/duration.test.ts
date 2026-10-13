import { afterEach, describe, expect, it } from 'vitest'
import { setLocale } from '../src/locales'
import { clipLength, spanText, timecode } from '../src/utils/duration'
import { formatDuration } from '../src/components/history/historyFormat'

/**
 * 时长的写法全站只有一份（utils/duration.ts）：每种语言一种写法，节点、队列、任务详情、生成记录读出来的是同一句话。
 *   zh-CN  8 秒 · 42 秒 · 1 分 05 秒 · 1 小时 02 分 · <1 秒
 *   en     8s · 42s · 1m 05s · 1h 02m · <1s
 */
afterEach(() => setLocale('en', false))

describe('clip length (the video-length parameter)', () => {
  it('zh-CN: 「8 秒」, with the space the rest of the interface uses', () => {
    setLocale('zh-CN', false)
    expect(clipLength(8)).toBe('8 秒')
    expect(clipLength('10')).toBe('10 秒')
    expect(clipLength(5.5)).toBe('5.5 秒')
  })
  it('en: "8s"', () => {
    setLocale('en', false)
    expect(clipLength(8)).toBe('8s')
    expect(clipLength(15)).toBe('15s')
  })
  it('nothing to say for a missing or zero length', () => {
    expect(clipLength(0)).toBe('')
    expect(clipLength('')).toBe('')
    expect(clipLength(Number.NaN)).toBe('')
  })
})

describe('time taken / elapsed / remaining', () => {
  it('zh-CN: seconds, then minutes with two-digit seconds, then hours without seconds', () => {
    setLocale('zh-CN', false)
    expect(spanText(24000)).toBe('24 秒')
    expect(spanText(65000)).toBe('1 分 05 秒')
    expect(spanText(112000)).toBe('1 分 52 秒')
    expect(spanText(3600000 + 2 * 60000 + 8000)).toBe('1 小时 02 分')
    expect(spanText(400)).toBe('<1 秒')
  })
  it('en: the same shape', () => {
    setLocale('en', false)
    expect(spanText(24000)).toBe('24s')
    expect(spanText(65000)).toBe('1m 05s')
    expect(spanText(12 * 60000 + 5000)).toBe('12m 05s')
    expect(spanText(3600000 + 2 * 60000 + 8000)).toBe('1h 02m')
    expect(spanText(400)).toBe('<1s')
  })
  it('no number is a dash, in both languages', () => {
    for (const code of ['zh-CN', 'en'] as const) {
      setLocale(code, false)
      expect(spanText(null)).toBe('—')
      expect(spanText(undefined)).toBe('—')
      expect(spanText(-5)).toBe('—')
    }
  })
  it('a finished run rounds; a running clock never jumps ahead; a countdown never says zero', () => {
    setLocale('en', false)
    expect(spanText(59600)).toBe('1m 00s')
    expect(spanText(59600, 'floor')).toBe('59s')
    expect(spanText(0, 'floor')).toBe('0s')
    expect(spanText(900, 'floor')).toBe('0s')
    expect(spanText(200, 'ceil')).toBe('1s')
    expect(spanText(59001, 'ceil')).toBe('1m 00s')
    setLocale('zh-CN', false)
    expect(spanText(900, 'floor')).toBe('0 秒')
    expect(spanText(61000, 'floor')).toBe('1 分 01 秒')
  })
  it('the history table and detail use the same formatter', () => {
    setLocale('zh-CN', false)
    expect(formatDuration(112000)).toBe('1 分 52 秒')
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(300)).toBe('<1 秒')
    setLocale('en', false)
    expect(formatDuration(112000)).toBe('1m 52s')
  })
})

describe('timecode (the length shown on a video thumbnail)', () => {
  it('is m:ss / h:mm:ss in every language', () => {
    for (const code of ['zh-CN', 'en'] as const) {
      setLocale(code, false)
      expect(timecode(8)).toBe('0:08')
      expect(timecode(65.4)).toBe('1:05')
      expect(timecode(3723)).toBe('1:02:03')
      expect(timecode(0)).toBe('0:00')
    }
  })
})
