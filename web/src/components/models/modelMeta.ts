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
  if (m.acceptsImage && refs) out.push(t('modelsPage.chips.refs', { n: refs }))
  if (o.resolutions?.length) {
    out.push(o.resolutions.length === 1
      ? t('modelsPage.chips.resolutionOnly', { v: o.resolutions[0] })
      : o.resolutions.join(' / '))
  }
  if (o.imgModes?.includes('frames')) out.push(t('modelsPage.chips.frames'))
  // 视频模型的比例只有横竖两三种，全写在悬停提示里；图片模型的比例多，给个数
  if (m.kind === 'image' && o.aspectRatios?.length) out.push(t('modelsPage.chips.ratios', { n: o.aspectRatios.length }))
  if (o.counts && o.counts.length > 1) out.push(t('modelsPage.chips.counts', { n: Math.max(...o.counts) }))
  return out
}

/**
 * 价格摘要，按「·」拆成几段（放不下一行时在段与段之间换行，不把一截价格或单位拆开）。
 * 空数组 = 没设置价格。
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
  if (!p.by) return [`${formatMoney(Number(p.price) || 0, p.currency)} / ${unit}`]
  const values = Object.values(p.table || {}).map(Number).filter(v => Number.isFinite(v))
  if (!values.length) return []
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = min === max
    ? formatMoney(min, p.currency)
    : `${formatMoney(min, p.currency)} – ${formatMoney(max, p.currency)}`
  return [`${range} / ${unit}`]
}
