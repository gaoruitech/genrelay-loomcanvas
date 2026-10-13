import { t } from '@/locales'
import { formatMoney } from '@/utils/cost'
import type { AdminModel, ModelPricing, ModelSpec } from '@/types'

type Caps = Pick<ModelSpec, 'kind' | 'acceptsImage' | 'acceptsVideo' | 'videoEdit' | 'maxReferenceImages' | 'options'>

/** 模型标识去掉「服务商实例:」前缀，剩下的就是发给上游的模型名 */
export function upstreamName(m: Pick<AdminModel, 'id'>): string {
  return m.id.slice(m.id.indexOf(':') + 1)
}

/**
 * 模型表「能力」一列的短标签。内容只来自模型声明本身（与 utils/modelCaps 的长句同源），
 * 这里只是写得更短，好让一行放下三四个。
 */
export function capChips(m: Caps): string[] {
  const o = m.options || {}
  const out: string[] = []
  const refs = Math.max(0, Number(m.maxReferenceImages) || 0)
  if (m.kind === 'chat') {
    out.push(t('modelsPage.chips.text'))
    if (m.acceptsImage && refs) out.push(t('modelsPage.chips.readsImages'))
    if (m.acceptsVideo) out.push(t('modelsPage.chips.readsVideo'))
    return out
  }
  if (m.videoEdit) out.push(t('modelsPage.chips.videoEdit'))
  if (o.durations?.length) {
    out.push(o.durations.length === 1
      ? t('modelsPage.chips.durationFixed', { v: o.durations[0] })
      : t('modelsPage.chips.durations', { list: o.durations.join(' / ') }))
  }
  if (m.acceptsImage && refs) out.push(t('modelsPage.chips.refs', { n: refs }, refs))
  if (o.resolutions?.length) {
    out.push(o.resolutions.length === 1
      ? t('modelsPage.chips.resolutionOnly', { v: o.resolutions[0] })
      : o.resolutions.join(' / '))
  }
  if (o.imgModes?.includes('frames')) out.push(t('modelsPage.chips.frames'))
  // 视频模型的比例只有横竖两三种，全写在悬停提示里；图片模型的比例多，给个数
  if (m.kind === 'image' && o.aspectRatios?.length) out.push(t('modelsPage.chips.ratios', { n: o.aspectRatios.length }, o.aspectRatios.length))
  if (o.counts && o.counts.length > 1) out.push(t('modelsPage.chips.counts', { n: Math.max(...o.counts) }))
  return out
}

/**
 * 价格摘要，按「·」拆成几段（放不下一行时在段与段之间换行，不把一截价格或单位拆开）。
 * 空数组 = 没设置价格。
 * 「金额」和「单位」怎么连成一句话各语言不一样（中文「¥0.20 / 每张」，英文「$0.04 per image」、
 * 「$2.50 per 1M input tokens」），所以整句都在语言文件里（modelsPage.row.flatPricing / tokenPricing），这里不拼。
 */
export function pricingParts(p?: ModelPricing | null): string[] {
  if (!p) return []
  const unit = t('modelsPage.pricing.units.' + p.unit)
  // 按 token 计价可以输入、输出各一个单价（存在 table.input / table.output 里）
  if (p.unit === 'per_1m_tokens' && p.table) {
    const input = Number(p.table.input)
    const output = Number(p.table.output)
    if (!Number.isFinite(input) || !Number.isFinite(output)) return []
    return t('modelsPage.row.tokenPricing', { input: formatMoney(input, p.currency), output: formatMoney(output, p.currency), unit }).split(' · ')
  }
  const flat = (amount: string) => [t('modelsPage.row.flatPricing', { amount, unit })]
  if (!p.by) return flat(formatMoney(Number(p.price) || 0, p.currency))
  const values = Object.values(p.table || {}).map(Number).filter(v => Number.isFinite(v))
  if (!values.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  return flat(min === max ? formatMoney(min, p.currency) : `${formatMoney(min, p.currency)} – ${formatMoney(max, p.currency)}`)
}

/**
 * 价格一格里要显示的东西，拆成结构（表格里按这个排版；pricingParts 是它的一行文字版，给悬停提示用）。
 * - token：输入、输出各一个单价，上下两行对齐成一对，单位另起一行 —— 一对价格不会被折行拆开；
 * - flat：一个金额（或者「最低 – 最高」），下面一行单位。
 * null = 没设置价格。
 */
export type PricingView =
  | { kind: 'token'; input: string; output: string; unit: string }
  | { kind: 'flat'; amount: string; unit: string }

export function pricingView(p?: ModelPricing | null): PricingView | null {
  if (!p) return null
  const unit = t('modelsPage.pricing.units.' + p.unit)
  if (p.unit === 'per_1m_tokens' && p.table) {
    const input = Number(p.table.input)
    const output = Number(p.table.output)
    if (!Number.isFinite(input) || !Number.isFinite(output)) return null
    return { kind: 'token', input: formatMoney(input, p.currency), output: formatMoney(output, p.currency), unit }
  }
  if (!p.by) return { kind: 'flat', amount: formatMoney(Number(p.price) || 0, p.currency), unit }
  const values = Object.values(p.table || {}).map(Number).filter(v => Number.isFinite(v))
  if (!values.length) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  return { kind: 'flat', amount: min === max ? formatMoney(min, p.currency) : `${formatMoney(min, p.currency)} – ${formatMoney(max, p.currency)}`, unit }
}

/**
 * 一行里放得下前几个标签。widths 是各标签的宽度，avail 是这一行的宽度，gap 是间距，more 是「+N」那一个的宽度。
 * 全放得下就全放（不出「+N」）；否则留出「+N」的位置，能放几个放几个 —— 至少放一个（那一个由调用处压短）。
 */
export function fitCount(widths: number[], avail: number, gap: number, more: number): number {
  const n = widths.length
  if (!n) return 0
  // 量不到宽度（还没排版、或者元素不可见）：先全放
  if (!(avail > 0)) return n
  const total = widths.reduce((s, w) => s + w, 0) + gap * (n - 1)
  if (total <= avail + 0.5) return n
  let used = 0
  let k = 0
  for (; k < n; k++) {
    const next = used + widths[k] + gap
    if (next + more > avail + 0.5) break
    used = next
  }
  return Math.max(1, Math.min(k, n - 1))
}
