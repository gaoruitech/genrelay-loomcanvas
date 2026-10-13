/**
 * 「团队」页有哪些页签、谁能看到。路由守卫和团队页共用这一份；
 * 这里不引用页签组件，免得把团队页的代码拖进首屏。
 */
export type TeamTabId = 'members' | 'usage' | 'activity' | 'settings'

export interface TeamTabDef {
  id: TeamTabId
  icon: string
}

/** 判断要用到的那一点空间信息（stores/space 的实例满足它） */
interface SpaceLike {
  can(action: string): boolean
}

const TABS: (TeamTabDef & { needs?: string })[] = [
  // 名单所有成员都能看；管理操作在页签里按权限出现
  { id: 'members', icon: 'users' },
  // 成员看到的是只有自己的那一版
  { id: 'usage', icon: 'bolt' },
  { id: 'activity', icon: 'history', needs: 'activity:view' },
  // 团长和管理员；管理员只能改名称和头像，其余是只读的
  { id: 'settings', icon: 'settings', needs: 'team:rename' },
]

export function teamTabs(space: SpaceLike): TeamTabDef[] {
  return TABS.filter((t) => !t.needs || space.can(t.needs)).map(({ id, icon }) => ({ id, icon }))
}

/** 地址里要的那个页签；不认识的、或者这个人看不到的，落到第一个 */
export function resolveTeamTab(space: SpaceLike, asked: unknown): TeamTabId {
  const allowed = teamTabs(space).map((t) => t.id)
  const id = String(Array.isArray(asked) ? asked[0] : asked ?? '') as TeamTabId
  return allowed.includes(id) ? id : allowed[0]
}
