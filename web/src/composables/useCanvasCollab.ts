import { computed, ref, shallowRef, watch } from 'vue'
import { adapterError, canvasLockApi, hasCanvasLock, type CanvasMeta } from '@/utils/canvasBackend'
import type { CanvasLockInfo, CanvasPerson, SaveCanvasOptions } from '@/embed/types'

/**
 * 多人轮流改一张画布时编辑器要守的那几条规矩（docs/api.zh-CN.md「编辑锁」「保存与冲突」）：
 *
 *  - 编辑锁属于一次编辑会话——一个标签页，不属于账号：打开时拿锁，拿到了才可编辑，之后每隔 heartbeatMs 续一次；
 *    别的会话拿着（别人，或者自己的另一个标签页）就只读。能接管的人可以接管；被接管的一方在下一次心跳或保存时
 *    得知，立刻变只读，不重试保存。
 *  - 标签页放到后台：浏览器会把后台页的定时器放慢（藏了五分钟以后一分钟才跑一次），心跳跟不上，锁就过期了——
 *    这是有意的，没人在看的标签页不该占着画布。回到前台的那一刻立刻补一次心跳：没人拿走就接着用（reacquired），
 *    被别人拿走了就变只读并说明原因。
 *  - 只读等着的时候（标签页在前台）每隔几秒看一眼锁：对方走了就摆出「开始编辑」，不用刷新页面，也不替用户悄悄拿。
 *    顺便跟上改名和对方新保存的内容。
 *  - 版本：每次保存内容带上「我是基于哪一版改的」（baseRevision），用返回的新版本作下一次的依据。
 *    服务端说版本对不上（冲突）：停止保存，交给用户选。
 *  - 改名不是内容：不要锁、不带版本、不会冲突（见 Canvas.vue 的 commitName）。别人改了名，心跳 / 探锁带回新名字。
 *  - 只读时内容什么都不往外存（视口也不存），也不能运行。
 *
 * 这些都只在后端有这回事时才生效：适配器没有 acquireLock 就从不拿锁，载入时没给 revision 就不带 baseRevision，
 * 那样编辑器和以前一模一样（单人、后写覆盖）。
 *
 * 这里只管状态和规矩；提示条、冲突弹窗、「另存为副本」这些界面上的事在 Canvas.vue。
 */

/**
 * off：这张画布不用锁（个人空间、没有锁的后端）——可编辑
 * pending：正在拿锁——先按只读
 * mine：锁在我手里——可编辑
 * held：别的会话正在编辑（holder.sameUser：是我自己的另一个标签页）——只读，能接管的可以接管
 * lost：我本来在编辑，锁被拿走了（lostHow：被接管 / 过期后被别人拿走）——只读
 * view：我对这张画布只有查看权——只读，不拿锁
 * error：没拿到锁，也不是因为别人拿着（网络断了、服务端出错）——只读，可以重试
 * free：刚才拿着锁的人已经走了，现在没人在编辑——还是只读，点「开始编辑」才拿锁（不替用户悄悄拿）
 */
export type CollabMode = 'off' | 'pending' | 'mine' | 'held' | 'lost' | 'view' | 'error' | 'free'

/** 我是怎么丢的锁：被人接管 / 我的锁过期了（标签页在后台、断网）之后别人开始编辑 / 说不上来 */
export type LostHow = 'taken_over' | 'expired' | ''

export interface SaveConflict {
  /** 现在存着的是谁在什么时候保存的 */
  by: CanvasPerson | null
  at: string | null
  revision: number
  /** 能不能用我的版本覆盖 */
  canOverwrite: boolean
}

export type SaveFailure = 'conflict' | 'locked' | 'forbidden' | ''

/** 后端没说的时候多久续一次锁（和原装后端一致，见 server/src/constants.js 的 EDIT_LOCK） */
const DEFAULT_HEARTBEAT_MS = 12000
/** 只读等着的时候多久看一次锁（后端没说的时候）；没有 peekLock、只能整张重新载入的后端问得稀一些 */
const DEFAULT_POLL_MS = 5000
const FALLBACK_POLL_MS = 20000

function personOf(p: any): CanvasPerson | null {
  return p && typeof p === 'object' ? { id: String(p.id || ''), name: String(p.name || p.username || '') } : null
}
function lockOf(l: any): CanvasLockInfo | null {
  return l && l.by ? { by: personOf(l.by)!, at: l.at, expiresAt: l.expiresAt, mine: !!l.mine, sameUser: !!l.sameUser } : null
}

export interface CanvasCollabOptions {
  /** 现在开着的画布 */
  canvasId: () => string | null
  /**
   * 手上的内容已经不是最新的一版：重新载入内容，返回载入到的版本。
   * quiet：人正只读看着（不是刚拿到锁）——别动他的视野和选中。
   */
  reload: (opts?: { quiet?: boolean }) => Promise<number | undefined>
  /** 手上有没有没保存的改动。有的话不重新载入（那会把改动冲掉），留给下一次保存去报冲突 */
  hasUnsaved?: () => boolean
  /** 从只读变成可编辑的那一刻（拿到锁、接管成功） */
  onEditable?: () => void
  /** 本来在编辑，现在不能了（丢了锁、编辑权被收回） */
  onLost?: () => void
  /** 画布在别处被改了名（心跳 / 探锁带回来的）：标题跟着变 */
  onRenamed?: (name: string) => void
}

export function useCanvasCollab(opts: CanvasCollabOptions) {
  const mode = ref<CollabMode>('off')
  const meta = shallowRef<CanvasMeta>({})
  /** 内容的版本；undefined = 这个后端不记版本 */
  const revision = ref<number | undefined>(undefined)
  /** 改名的计数；undefined = 这个后端不记 */
  const metaRevision = ref<number | undefined>(undefined)
  /** 谁拿着锁（held / lost / view 时；free 时是刚走的那位） */
  const holder = shallowRef<CanvasLockInfo | null>(null)
  const lostHow = ref<LostHow>('')
  const canTakeOver = ref(false)
  /** 没拿到锁的原因（error 时），已是界面语言 */
  const errorMessage = ref('')
  const conflict = shallowRef<SaveConflict | null>(null)
  const busy = ref(false)

  /** 不能改、不能存、不能运行 */
  const readOnly = computed(() => mode.value !== 'off' && mode.value !== 'mine')
  /** 有一个没处理的保存冲突：在用户选完之前不再保存 */
  const blocked = computed(() => !!conflict.value)
  /** 只读等着：隔一会儿看一眼锁 */
  const waiting = () => mode.value === 'held' || mode.value === 'lost' || mode.value === 'free' || mode.value === 'view'

  let timer: ReturnType<typeof setInterval> | null = null
  /** 换画布、离开编辑器时加一：之前发出去的请求回来就不算数了 */
  let generation = 0
  const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

  function stopHeartbeat() {
    if (timer) { clearInterval(timer); timer = null }
  }
  function startHeartbeat(ms?: number) {
    stopHeartbeat()
    const every = Math.max(3000, Number(ms) || DEFAULT_HEARTBEAT_MS)
    timer = setInterval(() => { void heartbeat() }, every)
  }

  /** 心跳 / 探锁 / 载入带回来的名字：计数变了才算「被改名了」 */
  function noteName(name: unknown, rev: unknown) {
    if (typeof rev !== 'number') return
    const moved = metaRevision.value !== undefined && rev !== metaRevision.value
    metaRevision.value = rev
    if (moved && typeof name === 'string' && name) opts.onRenamed?.(name)
  }

  // ---- 只读等着的时候：隔一会儿看一眼锁 ----
  let peekTimer: ReturnType<typeof setTimeout> | null = null
  let peekEvery = DEFAULT_POLL_MS
  let peeking = false
  async function peek() {
    if (!waiting() || hidden() || peeking) return
    const id = opts.canvasId()
    if (!id) return
    const gen = generation
    peeking = true
    try {
      const p = await canvasLockApi.peek(id)
      if (gen !== generation || !waiting()) return
      if (p.pollMs) peekEvery = Math.max(2000, p.pollMs)
      noteName(p.name, p.metaRevision)
      if (typeof p.canTakeOver === 'boolean') canTakeOver.value = p.canTakeOver
      const lock = p.lock && !p.lock.mine ? p.lock : null
      if (p.canEdit === false) {
        // 编辑权没了（或者本来就没有）：只读地看着，谁在编辑照样说
        mode.value = 'view'
        holder.value = lock
      } else if (lock) {
        holder.value = lock
        // 我只有查看权时别人给了我编辑权，或者刚空出来又有人开始编辑了
        if (mode.value === 'free' || mode.value === 'view') mode.value = 'held'
      } else if (mode.value !== 'free') {
        // 没人在编辑了。holder 留着：提示条上还要说「某某 已经离开」
        if (mode.value === 'view') holder.value = null
        mode.value = 'free'
      }
      // 对方又保存了：我手上没有没存的东西，就悄悄换成最新的（不动视野）；有的话留给以后的保存去报冲突
      if (typeof p.revision === 'number' && revision.value !== undefined && p.revision !== revision.value && !opts.hasUnsaved?.()) {
        const fresh = await opts.reload({ quiet: true })
        if (gen !== generation) return
        revision.value = typeof fresh === 'number' ? fresh : p.revision
      }
    } catch { /* 这一次没问到，下一次再问 */ } finally { peeking = false }
  }
  function schedulePeek() {
    if (peekTimer) { clearTimeout(peekTimer); peekTimer = null }
    if (!waiting()) return
    peekTimer = setTimeout(async () => { peekTimer = null; await peek(); schedulePeek() }, canvasLockApi.canPeek() ? peekEvery : Math.max(peekEvery, FALLBACK_POLL_MS))
  }

  // ---- 标签页回到前台：立刻续一次锁（后台时心跳被浏览器放慢，锁可能已经过期）；只读等着的立刻看一眼 ----
  let listening = false
  function onVisibility() {
    if (hidden()) return
    if (mode.value === 'mine') void heartbeat()
    else if (waiting()) { void peek().then(schedulePeek) }
  }
  function syncListeners() {
    const want = mode.value !== 'off'
    if (typeof document === 'undefined' || want === listening) return
    listening = want
    if (want) document.addEventListener('visibilitychange', onVisibility)
    else document.removeEventListener('visibilitychange', onVisibility)
  }
  watch(mode, () => { syncListeners(); schedulePeek() }, { flush: 'sync' })

  /** 被告知「别的会话拿着锁」：记下是谁；我本来在编辑的话就是丢了锁 */
  function lockedBy(data: Record<string, any>, wasMine: boolean) {
    stopHeartbeat()
    holder.value = lockOf(data.lock)
    canTakeOver.value = !!data.canTakeOver
    lostHow.value = wasMine ? (data.lost === 'taken_over' || data.lost === 'expired' ? data.lost : '') : ''
    mode.value = wasMine ? 'lost' : 'held'
    if (wasMine) opts.onLost?.()
  }

  async function acquire(takeover: boolean): Promise<boolean> {
    const id = opts.canvasId()
    if (!id) return false
    const gen = generation
    const wasMine = mode.value === 'mine'
    try {
      const out = await canvasLockApi.acquire(id, takeover)
      if (gen !== generation) return false
      errorMessage.value = ''
      holder.value = null
      lostHow.value = ''
      if (out.lock) { mode.value = 'mine'; if (!wasMine || !timer) startHeartbeat(out.heartbeatMs ?? (out.heartbeatSeconds ? out.heartbeatSeconds * 1000 : undefined)) }
      else { mode.value = 'off'; stopHeartbeat() }
      noteName(out.name, out.metaRevision)
      // 载入之后、拿到锁之前别人存过；接管之后对方可能刚存过；我的锁过期期间别人来改过又走了：手上的内容已经旧了
      if (typeof out.revision === 'number' && revision.value !== undefined && out.revision !== revision.value) {
        // 手上有没保存的改动：不重新载入，版本也不动，下一次保存会被判成冲突，由用户选怎么处理
        if (!opts.hasUnsaved?.()) {
          const fresh = await opts.reload()
          if (gen !== generation) return false
          revision.value = typeof fresh === 'number' ? fresh : out.revision
        }
      } else if (typeof out.revision === 'number') {
        revision.value = out.revision
      }
      if (!wasMine) opts.onEditable?.()
      return true
    } catch (err) {
      if (gen !== generation) return false
      const e = adapterError(err)
      if (e.code === 'canvas.locked') { lockedBy(e.data, wasMine); return false }
      if (e.status === 403) {
        // 编辑权没了（画布被改成「团队可看」、角色变了）
        stopHeartbeat()
        holder.value = null
        mode.value = 'view'
        if (wasMine) opts.onLost?.()
        return false
      }
      // 心跳偶尔失败（网络抖了一下）不算丢锁：锁还有几十秒，下一次再续；真过期了下一次心跳会说
      if (wasMine) return true
      mode.value = 'error'
      errorMessage.value = e.message
      return false
    }
  }

  let beating = false
  async function heartbeat() {
    if (mode.value !== 'mine' || beating) return
    beating = true
    try { await acquire(false) } finally { beating = false }
  }

  /**
   * 画布载入之后调：按载入时带回来的信息决定怎么开。
   * 返回时 mode 已经定了（pending 只在这个函数执行期间出现）。
   */
  async function begin(m: CanvasMeta | undefined): Promise<void> {
    generation++
    stopHeartbeat()
    meta.value = m || {}
    revision.value = typeof m?.revision === 'number' ? m.revision : undefined
    metaRevision.value = typeof m?.metaRevision === 'number' ? m.metaRevision : undefined
    conflict.value = null
    errorMessage.value = ''
    lostHow.value = ''
    peekEvery = DEFAULT_POLL_MS
    holder.value = m?.lock && !m.lock.mine ? m.lock : null
    canTakeOver.value = !!m?.access?.canTakeOver
    // 没有编辑权：只读，不碰锁
    if (m?.access && m.access.canEdit === false) { mode.value = 'view'; return }
    // 这个后端没有锁，或者这张画布在个人空间里（那里只有自己一个人）：直接可编辑
    if (!hasCanvasLock() || m?.spaceId === 'personal') { mode.value = 'off'; return }
    // 载入时就看到别的会话正拿着锁：直接只读，不去碰一鼻子灰（那一次 423 什么都不会多告诉我）。
    // 对方这时刚好走了也不要紧：下面每隔几秒看一眼锁，空出来就摆出「开始编辑」
    if (holder.value) { mode.value = 'held'; return }
    mode.value = 'pending'
    await acquire(false)
  }

  /** 接管别的会话正在编辑的画布 */
  async function takeOver(): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    try { return await acquire(true) } finally { busy.value = false }
  }

  /** 再试一次拿锁（error 时；或者对方已经走了，点了「开始编辑」） */
  async function retry(): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    try { return await acquire(false) } finally { busy.value = false }
  }

  /**
   * 离开这张画布：停心跳，把锁还回去（尽力而为）。
   * unloading：页面本身要没了（关标签页、刷新、跳走）——普通请求不保证发得出去，交给适配器用 sendBeacon。
   */
  function end(o?: { unloading?: boolean }) {
    generation++
    stopHeartbeat()
    const id = opts.canvasId()
    if (id && mode.value === 'mine') void canvasLockApi.release(id, !!o?.unloading)
    mode.value = 'off'
    conflict.value = null
    holder.value = null
    lostHow.value = ''
  }

  /** 保存内容时带什么：有版本就带上「基于哪一版」 */
  function saveOptions(force = false): SaveCanvasOptions | undefined {
    if (revision.value === undefined && !force) return undefined
    return { ...(revision.value !== undefined ? { baseRevision: revision.value } : {}), ...(force ? { force: true } : {}) }
  }

  /** 保存成功：记下新版本 */
  function saved(out: { revision?: number } | null | undefined) {
    if (typeof out?.revision === 'number') revision.value = out.revision
    conflict.value = null
  }

  /**
   * 保存被拒绝：是不是这里管的那几种。是的话状态已经改好，返回是哪一种（调用方不要再弹「保存失败」，也不要重试）；
   * 不是返回空串，照常当保存失败处理。
   */
  function saveFailed(err: unknown): SaveFailure {
    const e = adapterError(err)
    if (e.code === 'canvas.conflict') {
      conflict.value = {
        by: personOf(e.data.lastEditedBy),
        at: e.data.lastEditedAt || e.data.updatedAt || null,
        revision: Number(e.data.revision) || 0,
        canOverwrite: !!e.data.canOverwrite,
      }
      return 'conflict'
    }
    if (e.code === 'canvas.locked') {
      lockedBy(e.data, true)
      return 'locked'
    }
    if (e.code === 'team.forbidden') {
      stopHeartbeat()
      const was = mode.value === 'mine' || mode.value === 'off'
      holder.value = null
      mode.value = 'view'
      if (was) opts.onLost?.()
      return 'forbidden'
    }
    return ''
  }

  /** 用户放弃了自己的版本、重新载入之后调 */
  function clearConflict() { conflict.value = null }

  return {
    mode, meta, revision, metaRevision, holder, lostHow, canTakeOver, errorMessage, conflict, busy, readOnly, blocked,
    begin, takeOver, retry, end, saveOptions, saved, saveFailed, clearConflict,
    /** 现在就看一眼锁（测试用，也给「刚回到这张画布」这类时刻用） */
    peekNow: peek,
  }
}

/**
 * 一次只跑一个：后来的排在前一个后面。同一张画布的内容保存必须这样发——
 * 两个保存同时在路上，第二个带的版本号正要被第一个替换，会被自己的前一次保存判成冲突。
 */
export function createSerialQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  let pending = 0
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      pending++
      // 队上没人：这一个现在就开始（同步跑到它的第一个 await），不等下一个微任务。
      // 离开画布时补存的那一次要靠这个：它得在编辑器卸载的那一刻就把请求交给适配器，
      // 晚一拍页面上的适配器可能已经换成下一个编辑器的了（只嵌编辑器、宿主紧接着又挂了一个时）。
      const p = pending === 1 ? new Promise<T>((resolve) => { resolve(task()) }) : tail.then(task, task)
      tail = p.then(() => { pending-- }, () => { pending-- })
      return p
    },
    /** 有没有在跑的或在排的 */
    get busy() { return pending > 0 },
  }
}
