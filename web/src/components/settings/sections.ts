import { currentEmbed } from '@/embed/context'
import type { LoomCanvasFeatures } from '@/embed/types'
/**
 * 设置页有哪些分区、怎么分组、谁能看到。路由守卫和设置页共用这一份；
 * 这里不引用分区组件，免得把设置页的代码拖进首屏。
 */
export type SettingsSectionId = 'account' | 'appearance' | 'site' | 'users' | 'teams' | 'storage' | 'limits'
export type SettingsGroupId = 'personal' | 'site'

export interface SettingsSectionDef {
  id: SettingsSectionId
  icon: string
}

export interface SettingsGroupDef {
  id: SettingsGroupId
  /** 只有超级管理员（接口里的 owner）看得到这一组 */
  owner: boolean
  items: SettingsSectionDef[]
}

const GROUPS: SettingsGroupDef[] = [
  {
    id: 'personal',
    owner: false,
    items: [
      { id: 'account', icon: 'shield' },
      { id: 'appearance', icon: 'eye' },
    ],
  },
  {
    id: 'site',
    owner: true,
    items: [
      { id: 'site', icon: 'site' },
      { id: 'users', icon: 'user' },
      { id: 'teams', icon: 'users' },
      { id: 'storage', icon: 'disk' },
      { id: 'limits', icon: 'bolt' },
    ],
  },
]

/**
 * 「外观」里有没有这个人能动的东西：语言、主题、节点布局三个开关（集成方可以各自关掉）里还开着一个，
 * 或者他是超级管理员（站点品牌那张卡片总在）。
 */
export function hasPersonalAppearance(f: LoomCanvasFeatures = currentEmbed().features): boolean {
  return f.localeSwitch || f.themeSwitch || f.nodeLayoutSwitch
}

export function settingsGroups(isOwner: boolean, features: LoomCanvasFeatures = currentEmbed().features): SettingsGroupDef[] {
  // 宿主自己管登录（嵌入时关了 features.account）：没有「账号与安全」这一分区
  const account = features.account
  // 语言 / 主题 / 节点布局三个开关都关了：不是超级管理员的人在「外观」里什么也没有，这一分区就不列
  const appearance = isOwner || hasPersonalAppearance(features)
  const shown = (s: SettingsSectionDef) => (s.id === 'account' ? account : s.id === 'appearance' ? appearance : true)
  return GROUPS
    .filter(g => !g.owner || isOwner)
    .map(g => ({ ...g, items: g.items.filter(shown) }))
    .filter(g => g.items.length)
}

/**
 * 设置页页头下面那一句用哪一条文案（settings.lead.<键>）：只说这个人在这里看得到的东西。
 * 宿主管登录时没有「账号」；语言 / 主题 / 节点布局都被关掉、又不是超级管理员时没有「界面」。
 */
export type SettingsLeadKey = 'ownerAccount' | 'owner' | 'accountLook' | 'account' | 'look'
export function settingsLeadKey(isOwner: boolean, features: LoomCanvasFeatures = currentEmbed().features): SettingsLeadKey {
  if (isOwner) return features.account ? 'ownerAccount' : 'owner'
  if (!features.account) return 'look'
  return hasPersonalAppearance(features) ? 'accountLook' : 'account'
}

/**
 * 地址里要的那个分区；不认识的、或者这个人看不到的，落到他能看到的第一个。
 * 老链接 /settings#account 里的锚点也认。
 */
export function resolveSettingsSection(isOwner: boolean, ...asked: unknown[]): SettingsSectionId {
  const allowed = settingsGroups(isOwner).flatMap(g => g.items.map(s => s.id))
  for (const a of asked) {
    const id = String(a ?? '').replace(/^#/, '') as SettingsSectionId
    if (allowed.includes(id)) return id
  }
  // 一个分区都没有的人进不了设置页（embed/links.ts 的 isSettingsOpen，路由守卫用它）
  return allowed[0]
}
