import type { Vendor } from '@/types'
import { i18n } from '@/locales'

/*
 * 服务商的名字和一句话介绍。后端也会按请求语言给名字，但那是请求那一刻的语言；
 * 内置的三家在语言文件里各有一份（settings.vendors.<标识>），切语言后立刻跟着变。
 * 语言文件里没有的（以后新加的服务商）用后端给的。
 */
function localized(key: string, fallback: string): string {
  const { te, t } = i18n.global
  return te(key) ? t(key) : fallback
}

export function vendorLabel(v: Pick<Vendor, 'type' | 'label'>): string {
  return localized(`settings.vendors.${v.type}.label`, v.label)
}

/**
 * 这个名称是不是服务商自己的名字（任何一种界面语言下的）。
 * 添加服务商时不填名称，存下来的就是当时界面语言里的服务商名；之后换了语言，
 * 两者字面上不再相等，但它仍然只是默认名，界面上不必在服务商名后面再重复一遍。
 */
export function isVendorDefaultName(v: Pick<Vendor, 'type' | 'label'>, name: string | undefined | null): boolean {
  if (!name || name === v.label) return true
  const key = `settings.vendors.${v.type}.label`
  const { availableLocales, te, t } = i18n.global
  return availableLocales.some(locale => te(key, locale) && t(key, {}, { locale }) === name)
}

export function vendorDesc(v: Pick<Vendor, 'type'>): string {
  return localized(`settings.vendors.${v.type}.desc`, '')
}
