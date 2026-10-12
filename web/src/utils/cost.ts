import { t, currentLocale } from '@/locales'
import type { Cost } from '@/types'
import { currentEmbed } from '@/embed/context'

/**
 * 金额格式化。按币种走 Intl.NumberFormat，小额保留到 4 位小数 ——
 * 单张图常常只有几分钱，按默认两位小数会被抹成 0.00。
 */
export function formatMoney(amount: number, currency: string): string {
  const n = Number(amount) || 0
  const digits = n !== 0 && Math.abs(n) < 0.1 ? 4 : 2
  try {
    return new Intl.NumberFormat(currentLocale(), {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: digits,
    }).format(n)
  } catch {
    // 币种代码不合法时 Intl 会抛，退回「数字 + 代码」
    return `${n.toFixed(digits)} ${currency || ''}`.trim()
  }
}

/** 已发生的花费：「¥0.12」或「成本未知」；没有记录返回空串 */
export function formatCost(cost?: Cost | null): string {
  // 集成方关了成本显示（features.cost）：哪儿都不出金额
  if (!cost || !currentEmbed().features.cost) return ''
  if (cost.unknown) return t('cost.unknown')
  return formatMoney(cost.amount, cost.currency)
}

/** 预估花费：「≈ ¥0.12」或「成本未知」；没有预估返回空串 */
export function formatEstimate(cost?: Cost | null): string {
  if (!currentEmbed().features.cost) return ''
  if (!cost) return ''
  if (cost.unknown) return t('cost.unknown')
  return t('cost.approx', { amount: formatMoney(cost.amount, cost.currency) })
}

/**
 * 多笔花费合计。任何一笔未知，整体就是未知 —— 报一个偏低的数字比报「未知」更误导。
 * 币种不一致时同样记为未知（不做汇率换算）。
 */
export function sumCosts(costs: Array<Cost | null | undefined>): Cost | null {
  const list = costs.filter((c): c is Cost => !!c)
  if (!list.length) return null
  const currency = list.find(c => !c.unknown)?.currency || list[0].currency || ''
  let amount = 0
  let unknown = false
  for (const c of list) {
    if (c.unknown || (c.currency && c.currency !== currency)) { unknown = true; continue }
    amount += Number(c.amount) || 0
  }
  return { amount: Math.round(amount * 1e6) / 1e6, currency, unknown }
}
