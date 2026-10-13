import { defineStore } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'
import { useAppStore } from '@/stores/app'
import { setSpaceGoneHandler, isTeamId } from '@/utils/api'
import { loadModels } from '@/utils/canvasModels'
import { resetSpaceState } from '@/utils/spaceScope'
import { lcLocal } from '@/utils/storage'
import { runtime } from '@/embed/runtime'
import { useEmbed } from '@/embed/context'
import type { CurrentSpace, SpaceErrorCode, SpacePermissions, SpaceSummary, TeamCreation, TeamRole, TeamSettings } from '@/types'

/** 为什么被送回了个人空间 */
export interface SpaceNotice {
  /** removed：不在这个团队了（被移出，或团队已被永久删除）；dissolved / suspended：团队关闭了；no_access：打开的链接指向一个进不去的团队 */
  kind: 'removed' | 'dissolved' | 'suspended' | 'no_access'
  teamName: string
}

const NOTICE_OF: Record<SpaceErrorCode, SpaceNotice['kind']> = {
  'team.not_found': 'removed',
  'team.dissolved': 'dissolved',
  'team.suspended': 'suspended',
}

/** 地址里空间那一段的写法：t-<团队 id>；个人空间不带 */
export const SPACE_PARAM_RE = 't-[0-9a-f]{24}'
export function spaceParam(id: string): string {
  return isTeamId(id) ? `t-${id}` : ''
}
export function spaceOfParam(v: unknown): string {
  const m = /^t-([0-9a-f]{24})$/i.exec(Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''))
  return m ? m[1].toLowerCase() : ''
}

/**
 * 空间：现在在哪个空间里干活（个人空间，或加入的某个团队），能进哪些，在里面能做什么。
 *
 * 几条规矩：
 *  - 真相在页面地址里：团队页面的地址以 /t-<团队 id> 开头，不带就是个人空间。路由守卫照着地址调 enter()。
 *  - 请求带哪个 X-Space 只由这里写的 runtime.space 决定，页面不自己拼请求头。
 *  - 换空间是一次「硬切」：先把页面拆掉，再换请求头、清缓存、重取启动信息（角色、权限、设置都按空间），
 *    然后才让新页面出来。任何一个空间的数据都不会在另一个空间里闪一下。
 *  - 权限以服务端给的那一列为准（bootstrap.space.permissions）；界面按它藏、按它灰，服务端照样会再拦一遍。
 */
export const useSpaceStore = defineStore('space', () => {
  const app = useAppStore()
  const embed = useEmbed()

  /** 当前空间：'' 是个人空间，否则是团队 id。和 runtime.space 始终一致 */
  const currentId = ref(runtime.space)
  /** 每换一次空间加一：外壳里的页面以它为 key 重建 */
  const epoch = ref(0)
  /** 正在换空间：这期间外壳里不放任何页面 */
  const switching = ref(false)
  /** 正在走的「进入空间」有几次（enter 里的请求还没回来）。见 settled */
  let entering = 0

  /** 集成方把空间定死了（mountLoomCanvas 的 space 选项）：null 表示没定 */
  const fixed = computed<string | null>(() => {
    const v = embed.space
    if (v == null) return null
    return isTeamId(v) ? v.toLowerCase() : ''
  })
  /** 有没有团队这回事：只嵌编辑器时没有（空间由适配器定） */
  const teamsEnabled = computed(() => embed.mode !== 'editor')
  /** 让不让用户自己换空间 */
  const canSwitch = computed(() => teamsEnabled.value && fixed.value === null && embed.features.spaceSwitch)

  const spaces = computed<SpaceSummary[]>(() => app.bootstrap?.spaces || [])
  const teams = computed(() => (teamsEnabled.value ? spaces.value.filter((s) => s.kind === 'team') : []))
  /** 当前团队在列表里的那一项（名字、头像、人数）；个人空间为 null */
  const team = computed<SpaceSummary | null>(() => (currentId.value ? spaces.value.find((s) => s.id === currentId.value) || null : null))
  const isTeam = computed(() => !!currentId.value)

  /** 启动信息里的 space 说的是不是当前这个空间（换空间途中两者会短暂对不上） */
  const fresh = computed(() => {
    const s = app.bootstrap?.space
    if (!s) return false
    return currentId.value ? s.id === currentId.value : s.kind === 'personal'
  })
  const current = computed<CurrentSpace>(() => {
    const s = app.bootstrap?.space
    if (s && fresh.value) return s
    // 还没拿到这个空间的启动信息：团队里先按「什么都不能做」，个人空间里什么都能做
    return {
      id: currentId.value || 'personal',
      kind: currentId.value ? 'team' : 'personal',
      name: team.value?.name || '',
      role: (team.value?.role || 'owner') as TeamRole,
      permissions: {},
      settings: null,
    }
  })
  const role = computed<TeamRole>(() => current.value.role)
  const name = computed(() => current.value.name || team.value?.name || '')
  const settings = computed<TeamSettings | null>(() => current.value.settings)
  const permissions = computed<SpacePermissions>(() => current.value.permissions || {})
  /** 团长或管理员 */
  const isManager = computed(() => isTeam.value && (role.value === 'owner' || role.value === 'admin'))
  const isTeamOwner = computed(() => isTeam.value && role.value === 'owner')

  /**
   * 这个操作在当前空间里能不能做（标识见 docs/api.zh-CN.md 的权限矩阵，如 'invite:manage'）。
   * 个人空间里只有自己一个人：都能。团队里只认服务端明确给的 true；
   * 值为 null（要看具体画布或成员）的不算能，那种要用 maybe()，再看具体对象上的 access。
   */
  function can(action: string): boolean {
    if (!isTeam.value) return true
    return permissions.value[action] === true
  }
  /** 可能能做：true，或要看具体对象（null）。用来决定「入口出不出现」，具体到某一项再看它的 access */
  function maybe(action: string): boolean {
    if (!isTeam.value) return true
    const v = permissions.value[action]
    return v === true || v === null
  }

  /** 调用者能不能创建团队、有没有申请在等着 */
  const creation = computed<TeamCreation | null>(() => (teamsEnabled.value ? app.bootstrap?.teams || null : null))

  // ---- 记住上次在哪个空间（按账号，存在这台浏览器上；接口没有存这一项的地方） ----
  const memoryKey = () => (app.user?.id ? `loomcanvas-space-${app.user.id}` : '')
  function remember(id: string) {
    const key = memoryKey()
    if (!key) return
    try { if (id) lcLocal.setItem(key, id); else lcLocal.removeItem(key) } catch { /* 存不了就算了 */ }
  }
  /** 上次在的那个团队，而且现在还进得去；否则 ''（个人空间） */
  function remembered(): string {
    const key = memoryKey()
    if (!key || !canSwitch.value) return ''
    try {
      const id = lcLocal.getItem(key) || ''
      return teams.value.some((t) => t.id === id && (t.status || 'active') === 'active') ? id : ''
    } catch { return '' }
  }

  // ---- 回到个人空间的原因 ----
  const notice = ref<SpaceNotice | null>(null)
  function clearNotice() { notice.value = null }
  /** 每被送回个人空间一次加一：App.vue 看着它把页面带回个人空间的首页 */
  const dropTick = ref(0)

  function apply(id: string) {
    runtime.space = id
    runtime.spaceEpoch++
    currentId.value = id
    epoch.value++
    resetSpaceState()
  }

  /**
   * 进入一个空间（'' = 个人空间）。只由路由守卫调：地址说在哪个空间，这里就进哪个。
   * 返回 false：进不去（不是成员、团队关闭了），这时人已经在个人空间，notice 里是原因。
   */
  async function enter(id: string, opts: { explain?: boolean } = {}): Promise<boolean> {
    const target = isTeamId(id) ? id.toLowerCase() : ''
    if (target === currentId.value && fresh.value) return true
    const listed = spaces.value.find((s) => s.id === target)
    const wantedName = listed?.name || ''
    switching.value = true
    entering++
    try {
      return await enterNow(target, listed, wantedName, opts)
    } finally {
      entering--
    }
  }
  async function enterNow(target: string, listed: SpaceSummary | undefined, wantedName: string, opts: { explain?: boolean }): Promise<boolean> {
    // 先让旧空间的页面拆掉，它收尾时发的请求（补存、归还编辑锁）还带着旧空间的请求头
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))
    apply(target)
    await app.loadBootstrap()
    const err = app.bootstrap?.spaceError
    if (target && (err || !fresh.value)) {
      // 进不去：留在个人空间。带着个人空间的请求头重取一遍（刚才那一份的 space 已经是个人空间，但 hasProvider 之类是按请求头算的）
      apply('')
      remember('')
      // 本来就不在我的团队列表里（打开了别人发来的链接）：说「进不去」；原来在的：说被移出 / 解散 / 停用
      const kind = !err || (err === 'team.not_found' && !listed) ? 'no_access' : NOTICE_OF[err] || 'removed'
      if (opts.explain !== false) notice.value = { kind, teamName: wantedName }
      await app.loadBootstrap()
      if (app.authed && !app.mustChangePassword) await loadModels().catch(() => undefined)
      return false
    }
    remember(target)
    // 模型清单是按空间的（团队空间里只有团队的服务商）
    if (app.authed && !app.mustChangePassword) await loadModels().catch(() => undefined)
    embed.emit('space', { id: target || 'personal', kind: target ? 'team' : 'personal', name: name.value, role: role.value })
    return true
  }

  /**
   * 导航走完了（成功、失败都算）：把页面放出来。由路由的 afterEach 调。
   * 还有一次「进入空间」没走完就先不放：被新导航顶掉的那次导航也会走到这里（切换空间的请求还在路上时又点了侧栏），
   * 那时放出来的是旧地址上的页面、取的却已经是新空间的数据 —— 个人空间的地址下面闪出团队的画布。等最后那次导航走完再放。
   */
  function settled() { if (!entering) switching.value = false }

  /**
   * 用着用着，接口说「这个空间对你已经不存在」（被移出团队、团队被解散或停用）：
   * 记下原因，回到个人空间。页面跳转由 App.vue 看着 dropTick 做。
   */
  let dropping = false
  function gone(code: string, space: string) {
    if (!currentId.value || space !== currentId.value || dropping) return
    dropping = true
    notice.value = { kind: NOTICE_OF[code as SpaceErrorCode] || 'removed', teamName: name.value }
    remember('')
    dropTick.value++
    // 一页同时发出去的几个请求会一起被拒：跳转完成之前只处理一次
    setTimeout(() => { dropping = false }, 1500)
  }
  setSpaceGoneHandler(gone)

  // 启动信息是带着团队的请求头取的，回来却说进不去（开着页面时被移出，之后刷新了启动信息）
  watch(() => app.bootstrap?.spaceError, (err) => {
    if (err && currentId.value && !switching.value) gone(err, currentId.value)
  })

  // 换了人（退出、令牌失效、换账号登录）：空间是跟着人的，回到个人空间，别把上一个人的团队 id 带进下一个人的请求
  watch(() => app.bootstrap?.user?.id || '', (now, before) => {
    if (now === before || app.hostAuth) return
    if (currentId.value) apply('')
    notice.value = null
  }, { flush: 'sync' })

  /** 团队列表、创建状态变了（建了团队、加入了、被批准了）：重取启动信息 */
  async function refresh() {
    await app.loadBootstrap()
  }

  return {
    currentId, epoch, switching, fixed, teamsEnabled, canSwitch,
    spaces, teams, team, isTeam, current, role, name, settings, permissions, isManager, isTeamOwner, fresh,
    can, maybe, creation,
    remember, remembered,
    notice, clearNotice, dropTick,
    enter, settled, gone, refresh,
  }
})
