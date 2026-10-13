import { onBeforeUnmount, onMounted, type Ref } from 'vue'
import { workflowApi, unwrap, type WorkflowListPoll, type WorkflowSummary } from '@/utils/api'
import type { CanvasLock } from '@/types'

/**
 * 团队的画布卡片上会变的东西 —— 谁正在编辑、别人改的名字、别人新建 / 保存 / 删掉 / 恢复的画布 —— 页面开着的时候
 * 隔一会儿问一次（GET /workflow/locks?since=…：回答里只有活着的锁和这段时间里变了的那几张，很小），
 * 把变了的那几张卡片就地换掉：不重拉整个列表，没变的卡片还是原来的对象，所以不会闪。
 * 可见范围的改动服务端不逐个列（变成「仅自己」的画布不能把名字告诉看不到它的人），只给一组张数；
 * 和手上的对不上才整个重取一次。页签在后台时不问；回到前台立刻问一次。多久问一次听服务端的（pollMs，现在是 10 秒）。
 */
const DEFAULT_POLL_MS = 10000

/** 两把锁在卡片上看起来是不是一样（谁、从什么时候起、是不是我） */
export function sameLock(a: CanvasLock | null | undefined, b: CanvasLock | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return a.by?.id === b.by?.id && a.by?.name === b.by?.name && a.at === b.at && !!a.mine === !!b.mine && !!a.sameUser === !!b.sameUser
}

/**
 * 把一次「活着的锁」的回答合到列表上。没有任何一张卡片变了就返回原来那个数组（不触发重绘）；
 * 变了的卡片换成新对象，其余还是原来的对象。锁还是同一把时只把到期时间悄悄更新上去（卡片按它判断过没过期）。
 */
export function applyLocks(list: WorkflowSummary[], locks: { id: string; lock: CanvasLock }[]): WorkflowSummary[] {
  const live = new Map(locks.map((l) => [l.id, l.lock]))
  let changed = false
  const next = list.map((w) => {
    const lock = live.get(w.id) || null
    if (sameLock(w.lock, lock)) {
      if (lock && w.lock) w.lock.expiresAt = lock.expiresAt
      return w
    }
    changed = true
    return { ...w, lock }
  })
  return changed ? next : list
}

/**
 * 把服务端给的这一行（fresh）合到手上这张卡片（have）上会不会改变什么。只看 fresh 带着的字段，
 * 锁不算在内：它有自己的比法（sameLock —— 到期时间每次心跳都在变，那不是变化）。
 */
export function sameCard(have: WorkflowSummary, fresh: WorkflowSummary): boolean {
  const a = have as unknown as Record<string, unknown>
  const b = fresh as unknown as Record<string, unknown>
  for (const k of Object.keys(b)) {
    if (k !== 'lock' && a[k] !== b[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false
  }
  return true
}

/**
 * 把「这段时间里变了的 / 没了的」合到列表上：已有的卡片内容不同才换成新对象，没见过的加进来，被删的拿掉。
 * 一张都没动就返回原来那个数组。order 给了就按它排（改了名的那张在按「最近改动」排的列表里会跟着挪位置）。
 * 先合 changed 再去掉 removed：同一次回答里两边都有的（刚保存完就被删了）以删掉为准。
 */
export function applyChanges(
  list: WorkflowSummary[],
  changed: WorkflowSummary[] = [],
  removed: string[] = [],
  order?: (a: WorkflowSummary, b: WorkflowSummary) => number,
): WorkflowSummary[] {
  if (!changed.length && !removed.length) return list
  const at = new Map(list.map((w, i) => [w.id, i]))
  const next = [...list]
  let touched = false
  for (const c of changed) {
    const i = at.get(c.id)
    if (i === undefined) {
      at.set(c.id, next.length)
      next.push(c)
      touched = true
    } else if (!sameCard(next[i], c)) {
      // 锁不在这里换：同一次回答里的 locks 由 applyLocks 接着处理
      next[i] = { ...next[i], ...c, lock: next[i].lock }
      touched = true
    }
  }
  const gone = new Set(removed.filter((id) => at.has(id)))
  if (!touched && !gone.size) return list
  const out = gone.size ? next.filter((w) => !gone.has(w.id)) : next
  return order ? out.sort(order) : out
}

/** 整个重取回来的列表合到手上这一份上：没变的卡片留着原来的对象；全都没变（连顺序）就返回原来那个数组 */
export function mergeList(old: WorkflowSummary[], fresh: WorkflowSummary[]): WorkflowSummary[] {
  const byId = new Map(old.map((w) => [w.id, w]))
  let same = old.length === fresh.length
  const next = fresh.map((w, i) => {
    const had = byId.get(w.id)
    const keep = had && sameCard(had, w) && sameLock(had.lock, w.lock) ? had : w
    if (had && keep === had && had.lock && w.lock) had.lock.expiresAt = w.lock.expiresAt
    if (keep !== old[i]) same = false
    return keep
  })
  return same ? old : next
}

type Counts = NonNullable<WorkflowListPoll['counts']>
const VISIBILITIES = ['private', 'team_view', 'team_edit'] as const
/** 手上这份列表的张数是不是服务端说的那样（一共几张、每档可见范围各几张） */
export function countsMatch(list: WorkflowSummary[], counts: Counts): boolean {
  if (list.length !== counts.total) return false
  return VISIBILITIES.every((v) => list.filter((w) => (w.visibility || 'private') === v).length === counts[v])
}

/** 从哪一刻问起：还没问过就从列表里最新的那次改动算起（那是服务端的时间，不用管本机的钟准不准） */
export function latestChange(list: WorkflowSummary[]): string | undefined {
  let max = 0
  for (const w of list) {
    const t = new Date(w.updatedAt || w.createdAt).getTime()
    if (t > max) max = t
  }
  return max ? new Date(max).toISOString() : undefined
}

export interface CanvasLocksOptions {
  enabled: () => boolean
  onTick?: () => void
  /** 整个重取列表（不出骨架、不清空）：张数对不上，或者服务端说变的太多、不逐个列了的时候 */
  reload?: () => unknown
  /** 列表保持的顺序：加进来新的、时间变了之后按它重排 */
  order?: (a: WorkflowSummary, b: WorkflowSummary) => number
}

export function useCanvasLocks(list: Ref<WorkflowSummary[]>, opts: CanvasLocksOptions) {
  let timer = 0
  let every = DEFAULT_POLL_MS
  let alive = false
  let asking = false
  /** 上一次回答里的 now */
  let since: string | undefined
  /** 上一次是为哪组张数重取的：重取之后还是对不上就不为同一组数反复重取 */
  let reloadedFor = ''

  async function refresh() {
    if (!alive || asking || !opts.enabled() || document.visibilityState !== 'visible') return
    asking = true
    try {
      const out = unwrap(await workflowApi.locks(since || latestChange(list.value)))
      if (!alive) return
      if (out?.pollMs) every = Math.max(3000, out.pollMs)
      if (out?.now) since = out.now
      opts.onTick?.()
      const next = applyLocks(applyChanges(list.value, out?.changed, out?.removed, opts.order), out?.locks || [])
      if (next !== list.value) list.value = next
      if (!opts.reload) return
      const off = out?.counts && !countsMatch(next, out.counts) ? JSON.stringify(out.counts) : ''
      if (out?.reload || (off && off !== reloadedFor)) {
        reloadedFor = off
        await opts.reload()
      } else if (!off) reloadedFor = ''
    } catch { /* 这一次没问到：下一次再问。空间没了之类的由外壳统一处理 */ } finally { asking = false }
  }
  function schedule() {
    window.clearTimeout(timer)
    if (!alive) return
    timer = window.setTimeout(async () => { await refresh(); schedule() }, every)
  }
  function onVisible() {
    if (document.visibilityState !== 'visible') { window.clearTimeout(timer); return }
    void refresh().then(schedule)
  }
  onMounted(() => {
    alive = true
    schedule()
    document.addEventListener('visibilitychange', onVisible)
  })
  onBeforeUnmount(() => {
    alive = false
    window.clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisible)
  })
  return { refresh }
}
