import type { ProviderType } from '@/types'

/** 「高睿 API」申请 Key 的地址 */
export const GAORUI_URL = 'https://gaorui.cc'

export type ProviderFamily = 'gaorui' | 'openai' | 'gemini' | 'other'

/** 按类型标识归到几个已知家族，用于引导页的排序与说明文案 */
export function providerFamily(type: ProviderType | string): ProviderFamily {
  const id = (typeof type === 'string' ? type : type.type).toLowerCase()
  if (id.includes('gaorui')) return 'gaorui'
  if (id.includes('openai')) return 'openai'
  if (id.includes('gemini')) return 'gemini'
  return 'other'
}

export function isGaorui(type: ProviderType | string): boolean {
  return providerFamily(type) === 'gaorui'
}

const ORDER: Record<ProviderFamily, number> = { gaorui: 0, openai: 1, gemini: 2, other: 3 }

/** 引导页卡片顺序：高睿 API 排第一，其余保持后端给的顺序 */
export function sortProviderTypes(types: ProviderType[]): ProviderType[] {
  return types
    .map((tp, i) => ({ tp, i }))
    .sort((a, b) => (ORDER[providerFamily(a.tp)] - ORDER[providerFamily(b.tp)]) || (a.i - b.i))
    .map(x => x.tp)
}
