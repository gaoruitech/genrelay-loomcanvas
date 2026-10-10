import type { ProviderInstance as PI, Vendor } from '@/types'
import { vendorLabel } from '@/utils/providerMeta'

export interface ProviderFormState {
  name: string
  apiKey: string
  baseUrl: string
  enabled: boolean
}

/** 新建 / 编辑时表单的初始值。地址预填官方地址，Key 永远从空开始（后端不回传明文） */
export function initialProviderForm(vendor: Vendor, existing?: PI | null): ProviderFormState {
  return {
    name: existing?.name || '',
    apiKey: '',
    baseUrl: existing?.baseUrl || vendor.defaultBaseUrl || '',
    enabled: existing ? !!existing.enabled : true,
  }
}

/** 还缺 API Key 吗？已保存过的留空算「不修改」 */
export function missingApiKey(form: ProviderFormState, existing?: PI | null): boolean {
  return !existing?.hasKey && !form.apiKey.trim()
}

/** 表单 → 提交给后端的请求体。留空的 Key 不带；地址清空表示回到官方地址 */
export function providerPayload(vendor: Vendor, form: ProviderFormState, existing?: PI | null): Record<string, any> {
  const body: Record<string, any> = {
    type: vendor.type,
    name: form.name.trim() || existing?.name || vendorLabel(vendor),
    enabled: form.enabled !== false,
    baseUrl: form.baseUrl.trim(),
  }
  const key = form.apiKey.trim()
  if (key) body.apiKey = key
  return body
}
