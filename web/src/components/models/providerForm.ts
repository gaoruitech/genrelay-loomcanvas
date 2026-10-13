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

/** 两个地址是不是同一个：末尾多一个斜杠、主机名大小写不同都算同一个（和后端的判断一致） */
export function sameAddress(a: string, b: string): boolean {
  const norm = (v: string) => {
    const raw = String(v || '').trim()
    try {
      const u = new URL(raw)
      return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`
    } catch {
      return raw.replace(/\/+$/, '')
    }
  }
  return norm(a) === norm(b)
}

/**
 * 表单里的地址和保存着的「实际使用的地址」不一样了吗？
 * 实际使用的地址 = 保存的那个；没保存过（空）就是服务商的官方地址。所以把自定义地址改回官方地址也算改了。
 */
export function addressChanged(vendor: Vendor, form: ProviderFormState, existing?: PI | null): boolean {
  if (!existing) return false
  const official = vendor.defaultBaseUrl || ''
  return !sameAddress(existing.baseUrl || official, form.baseUrl.trim() || official)
}

/**
 * 改了地址、而这个服务商存着 Key：必须重新填 Key。
 * 已保存的 Key 只会发往保存时的那个地址，后端不带 Key 就拒绝（provider.key_required_for_url）。
 */
export function keyNeededForAddress(vendor: Vendor, form: ProviderFormState, existing?: PI | null): boolean {
  return !!existing?.hasKey && addressChanged(vendor, form, existing)
}

/** 还缺 API Key 吗？已保存过的留空算「不修改」，除非同时改了地址（传了 vendor 才判断这一条） */
export function missingApiKey(form: ProviderFormState, existing?: PI | null, vendor?: Vendor | null): boolean {
  if (form.apiKey.trim()) return false
  if (!existing?.hasKey) return true
  return !!vendor && keyNeededForAddress(vendor, form, existing)
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
