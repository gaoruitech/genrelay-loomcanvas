/**
 * 设置页有哪些分区、怎么分组、谁能看到。路由守卫和设置页共用这一份；
 * 这里不引用分区组件，免得把设置页的代码拖进首屏。
 */
export type SettingsSectionId = 'account' | 'appearance' | 'site' | 'users' | 'storage' | 'limits'
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
      { id: 'users', icon: 'users' },
      { id: 'storage', icon: 'disk' },
      { id: 'limits', icon: 'bolt' },
    ],
  },
]

export function settingsGroups(isOwner: boolean): SettingsGroupDef[] {
  return GROUPS.filter(g => !g.owner || isOwner)
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
  return allowed[0]
}
