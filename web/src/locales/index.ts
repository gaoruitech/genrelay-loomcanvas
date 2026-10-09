import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'
import type { LocaleCode } from '@/types'

const KEY = 'loomcanvas-locale'

export const SUPPORTED_LOCALES: { code: LocaleCode; label: string }[] = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en', label: 'English' },
]

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
  try { return normalizeLocale(localStorage.getItem(KEY)) } catch { return null }
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
  document.documentElement.setAttribute('lang', code)
  if (persist) {
    try { localStorage.setItem(KEY, code) } catch { /* 隐私模式下写不进去，本次会话仍生效 */ }
  }
}
