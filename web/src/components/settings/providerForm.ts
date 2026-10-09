import type { ProviderField as PF, ProviderInstance as PI, ProviderType as PT } from '@/types'

/** 新建 / 编辑时表单的初始值 */
export function initialProviderForm(type: PT, existing?: PI | null): Record<string, any> {
  const form: Record<string, any> = {
    name: existing?.name || '',
    baseUrl: existing?.baseUrl || '',
    enabled: existing ? !!existing.enabled : true,
  }
  for (const f of type.fields) {
    if (f.secret) form[f.key] = ''
    else if (form[f.key] === undefined) form[f.key] = existing?.[f.key] ?? ''
  }
  return form
}

/** 必填但没填的第一个字段；都填了返回 null。已保存过的密钥留空算「不修改」 */
export function missingProviderField(type: PT, form: Record<string, any>, existing?: PI | null): PF | null {
  for (const f of type.fields) {
    if (!f.required) continue
    if (f.secret && existing?.hasKey) continue
    if (!String(form[f.key] ?? '').trim()) return f
  }
  return null
}

/** 表单 → 提交给后端的请求体。留空的密钥、留空的可选项不带 */
export function providerPayload(type: PT, form: Record<string, any>, existing?: PI | null): Record<string, any> {
  const body: Record<string, any> = {
    type: type.type,
    name: String(form.name || '').trim() || existing?.name || type.label,
    enabled: form.enabled !== false,
  }
  const baseUrl = String(form.baseUrl || '').trim()
  if (baseUrl) body.baseUrl = baseUrl
  else if (existing?.baseUrl) body.baseUrl = ''
  for (const f of type.fields) {
    const v = String(form[f.key] ?? '').trim()
    if (f.secret) { if (v) body[f.key] = v }
    else if (f.key !== 'name' && f.key !== 'baseUrl' && (v || existing)) body[f.key] = v
  }
  return body
}
