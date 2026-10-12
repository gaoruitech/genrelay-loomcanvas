import { lcLocal } from '@/utils/storage'
import { runtime } from '@/embed/runtime'
import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'
import type { LocaleCode } from '@/types'

const KEY = 'loomcanvas-locale'

export const SUPPORTED_LOCALES: { code: LocaleCode; label: string }[] = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: 'English' },
]

/** 语言下拉用的选项（顶栏、引导页、外观设置） */
export const LOCALE_OPTIONS = SUPPORTED_LOCALES.map(l => ({ value: l.code, label: l.label }))

/** 把任意语言标识归到我们支持的两种之一；认不出来返回 null */
export function normalizeLocale(v?: string | null): LocaleCode | null {
  if (!v) return null
  const s = v.toLowerCase()
  if (s.startsWith('zh')) return 'zh-CN'
  if (s.startsWith('en')) return 'en'
  return null
}

/** 用户自己选过的语言；没选过返回 null，由调用方落到站点默认值 */
export function savedLocale(): LocaleCode | null {
  try { return normalizeLocale(lcLocal.getItem(KEY)) } catch { return null }
}

export const i18n = createI18n({
  legacy: false,
  locale: savedLocale() || normalizeLocale(navigator.language) || 'en',
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN, en },
})

/**
 * 组件之外（composables / utils）取文案用这个。
 * 组件里用 useI18n() 的 t —— 两者读的是同一个全局实例。
 */
export const t = i18n.global.t

export function currentLocale(): LocaleCode {
  return i18n.global.locale.value as LocaleCode
}

/** persist=false 用于套用站点默认语言：不能把默认值写成「用户的选择」 */
export function setLocale(code: LocaleCode, persist = true) {
  i18n.global.locale.value = code
  // 嵌进别人的页面：<html lang> 是宿主的，写在本产品自己的根元素上
  if (runtime.embedded) { for (const el of runtime.roots) el.setAttribute('lang', code) }
  else document.documentElement.setAttribute('lang', code)
  if (persist) {
    try { lcLocal.setItem(KEY, code) } catch { /* 隐私模式下写不进去，本次会话仍生效 */ }
  }
}

/**
 * 集成方覆盖文案：按语言给一棵和内置文案同结构的子树，逐键盖上去（没给的键不动）。
 */
export function mergeMessages(overrides?: Partial<Record<LocaleCode, Record<string, unknown>>>) {
  if (!overrides) return
  for (const code of Object.keys(overrides) as LocaleCode[]) {
    const tree = overrides[code]
    if (tree && typeof tree === 'object') i18n.global.mergeLocaleMessage(code, tree as any)
  }
}
