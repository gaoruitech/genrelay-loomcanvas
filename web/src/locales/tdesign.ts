import zhCN from 'tdesign-vue-next/es/locale/zh_CN'
import enUS from 'tdesign-vue-next/es/locale/en_US'
import type { GlobalConfigProvider } from 'tdesign-vue-next'
import type { LocaleCode } from '@/types'

/**
 * TDesign 组件自带的文案（日历的月份 / 星期、占位、「确定」等）跟着界面语言走。
 * App.vue 用 <t-config-provider> 把当前语言对应的那一份发下去。
 */
// 语言包导出的是只读字面量类型，与 GlobalConfigProvider 的可变数组对不上，只能经 unknown 转一下
export const TDESIGN_LOCALES: Record<LocaleCode, GlobalConfigProvider> = {
  'zh-CN': zhCN as unknown as GlobalConfigProvider,
  en: enUS as unknown as GlobalConfigProvider,
}
