import { describe, expect, it, beforeEach } from 'vitest'
import { setLocale } from '../src/locales'
import { capChips, fitCount, pricingParts, pricingView } from '../src/components/models/modelMeta'

// 模型表「能力」一格只占一行：放不下的收进「+N」
describe('fitCount (capability chips on one line)', () => {
  const W = [60, 80, 40, 70] // 加 3 个间距 6 = 268

  it('shows every chip, and no "+N", when they all fit', () => {
    expect(fitCount(W, 268, 6, 30)).toBe(4)
    expect(fitCount(W, 400, 6, 30)).toBe(4)
  })

  it('keeps room for the "+N" chip when something has to go', () => {
    // 60 + 6 + 80 + 6 = 152，再加「+N」30 = 182 放得下；第三个 40 + 6 → 228 也放得下；第四个放不下
    expect(fitCount(W, 267, 6, 30)).toBe(3)
    expect(fitCount(W, 200, 6, 30)).toBe(2)
    expect(fitCount(W, 182, 6, 30)).toBe(2)
    expect(fitCount(W, 181, 6, 30)).toBe(1)
  })

  it('always shows at least one chip (the caller lets it shrink) and never hides everything behind "+N"', () => {
    expect(fitCount(W, 50, 6, 30)).toBe(1)
    expect(fitCount([300], 100, 6, 30)).toBe(1)
  })

  it('never hides exactly zero chips behind a "+N": if not all fit, at least one is hidden', () => {
    // 三个放得下、加上「+N」放不下第四个：结果不能是 4
    for (let avail = 1; avail < 268; avail++) expect(fitCount(W, avail, 6, 30)).toBeLessThan(4)
  })

  it('shows everything while the width is unknown', () => {
    expect(fitCount(W, 0, 6, 30)).toBe(4)
    expect(fitCount([], 100, 6, 30)).toBe(0)
  })
})

describe('pricingView (the price cell)', () => {
  beforeEach(() => setLocale('en', false))

  it('token pricing is a pair: input and output stay together, the unit is separate', () => {
    const p = { currency: 'USD', unit: 'per_1m_tokens' as const, table: { input: 2.5, output: 10 } }
    expect(pricingView(p)).toEqual({ kind: 'token', input: '$2.50', output: '$10.00', unit: 'per 1M tokens' })
    setLocale('zh-CN', false)
    expect(pricingView(p)).toEqual({ kind: 'token', input: 'US$2.50', output: 'US$10.00', unit: '每百万 token' })
  })

  it('a flat price is an amount and a unit', () => {
    expect(pricingView({ currency: 'USD', unit: 'per_image', price: 0.04 })).toEqual({ kind: 'flat', amount: '$0.04', unit: 'per image' })
    // 按 token 计价但只填了一个单价（没有输入 / 输出之分）
    expect(pricingView({ currency: 'USD', unit: 'per_1m_tokens', price: 30 })).toEqual({ kind: 'flat', amount: '$30.00', unit: 'per 1M tokens' })
  })

  it('a price table collapses to a range', () => {
    expect(pricingView({ currency: 'USD', unit: 'per_image', by: 'resolution', table: { '1K': 0.3, '2K': 0.9 } }))
      .toEqual({ kind: 'flat', amount: '$0.30 – $0.90', unit: 'per image' })
    expect(pricingView({ currency: 'USD', unit: 'per_image', by: 'resolution', table: { '1K': 0.3, '2K': 0.3 } }))
      .toEqual({ kind: 'flat', amount: '$0.30', unit: 'per image' })
  })

  it('no price, an empty table or a broken token table is "not set" — in step with pricingParts', () => {
    const cases = [
      null,
      { currency: 'USD', unit: 'per_image' as const, by: 'resolution' as const, table: {} },
      { currency: 'USD', unit: 'per_1m_tokens' as const, table: { input: 1 } as Record<string, number> },
    ]
    for (const p of cases) {
      expect(pricingView(p)).toBeNull()
      expect(pricingParts(p)).toEqual([])
    }
  })
})

// 价格写成一句话（悬停提示、成员看的那一列）：每种语言用自己的说法，不是把中文的「金额 / 单位」照搬过去
describe('pricingParts (the price as a sentence)', () => {
  it('English reads as English: "$0.04 per image", "$2.50 per 1M input tokens"', () => {
    setLocale('en', false)
    expect(pricingParts({ currency: 'USD', unit: 'per_image', price: 0.04 })).toEqual(['$0.04 per image'])
    expect(pricingParts({ currency: 'USD', unit: 'per_video', price: 3.5 })).toEqual(['$3.50 per video'])
    expect(pricingParts({ currency: 'USD', unit: 'per_second', price: 0.05 })).toEqual(['$0.05 per second'])
    expect(pricingParts({ currency: 'USD', unit: 'per_1m_tokens', price: 30 })).toEqual(['$30.00 per 1M tokens'])
    expect(pricingParts({ currency: 'USD', unit: 'per_1m_tokens', table: { input: 0.15, output: 0.6 } }))
      .toEqual(['$0.15 per 1M input tokens', '$0.60 per 1M output tokens'])
    expect(pricingParts({ currency: 'USD', unit: 'per_image', by: 'resolution', table: { '1K': 0.3, '2K': 0.9 } })).toEqual(['$0.30 – $0.90 per image'])
    // 不该出现中文的写法
    for (const p of [{ currency: 'USD', unit: 'per_image' as const, price: 0.04 }, { currency: 'USD', unit: 'per_1m_tokens' as const, price: 30 }]) {
      expect(pricingParts(p).join(' ')).not.toMatch(/\/ per/)
    }
  })

  it('Chinese keeps its own form', () => {
    setLocale('zh-CN', false)
    expect(pricingParts({ currency: 'CNY', unit: 'per_image', price: 0.2 })).toEqual(['¥0.20 / 每张'])
    expect(pricingParts({ currency: 'CNY', unit: 'per_1m_tokens', table: { input: 1, output: 2 } })).toEqual(['输入 ¥1.00', '输出 ¥2.00', '每百万 token'])
  })
})

describe('capability chips: counts are pluralised in English', () => {
  const model = (refs: number, ratios: string[]) => ({ kind: 'image' as const, acceptsImage: true, acceptsVideo: false, videoEdit: false, maxReferenceImages: refs, options: { aspectRatios: ratios } })

  it('1 ref image / 8 ref images; 1 ratio / 11 ratios', () => {
    setLocale('en', false)
    expect(capChips(model(1, ['1:1']))).toEqual(['1 ref image', '1 ratio'])
    expect(capChips(model(8, Array.from({ length: 11 }, (_, i) => `${i + 1}:1`)))).toEqual(['8 ref images', '11 ratios'])
    setLocale('zh-CN', false)
    expect(capChips(model(1, ['1:1']))).toEqual(['参考图 1 张', '1 种比例'])
  })
})
