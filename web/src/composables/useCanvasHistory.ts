import { ref, computed, type Ref } from 'vue'

/**
 * 画布的撤销 / 重做。
 *
 * ── 为什么是「操作前记录」而不是「监听变化自动记录」 ──────────────
 * nodes/edges 是深度监听的（autoSave 就挂在上面），但 node.data 在生成期间
 * 每 1.5 秒就被轮询改一次（progress / status）。要是照着 watch 自动入栈，
 * 一次生成能塞进去几十个快照，用户按一次 Ctrl+Z 只会看到进度条倒退一格。
 * 所以改成显式的：每个会改变画布结构的操作，动手之前先调一次 record()。
 *
 * ── 为什么撤销时要把「生成结果」捞回来 ──────────────────────────
 * 快照是操作发生那一刻拍的。设想：A 节点正在出图 → 用户加了个文本节点
 * （此刻拍下快照，里面 A 还是 running、没有图）→ 图出来了 → 用户 Ctrl+Z。
 * 如果原样还原快照，那张刚出的图连同已经花掉的成本记录就一起没了。
 *
 * 所以 apply 时分两种情况：
 *   节点现在还在  → 结构（位置/连线/提示词）用快照的，产物和运行态用当前的
 *   节点是被删掉后恢复的 → 现场没有可捞的，整份用快照的（快照里存了产物）
 *
 * 哪些字段算「产物」跟节点类型有关，不能一刀切：text 对 text 节点是用户写的
 * 内容，对 llm / video-analysis 节点却是模型吐出来的结果。
 */

/** 与类型无关的运行时字段：状态、进度、任务 id、实际成本、结果历史 */
const VOLATILE_COMMON = [
  'status', 'progress', 'taskId', 'taskIds', 'runPending', 'cost', 'generatedCount',
  'errorMsg', 'errorRunId', 'results', 'resultIndex', 'validationError', 'validationStamp',
]

/** 各类型节点的「产物」字段 —— 只有生成类节点才有，输入类节点的同名字段是用户内容 */
// editHistory 必须跟 imageUrl 同进退：它存的是这张图被替换前的地址，
// 一个按快照回退、另一个保留现场的话，两边会对不上。
const VOLATILE_BY_TYPE: Record<string, string[]> = {
  'image-gen': ['imageUrl', 'imageUrls', 'editHistory'],
  'image-edit': ['imageUrl', 'imageUrls', 'editHistory'],
  'video-gen': ['videoUrl', 'videoUrls'],
  'video-edit': ['videoUrl', 'videoUrls'],
  'video-analysis': ['text'],
  'llm': ['text'],
  // 成品节点的内容全是上游推过来的，一项都不属于用户
  'output': ['imageUrl', 'imageUrls', 'videoUrl', 'videoUrls', 'editHistory'],
}

/** 栈深。再深的历史没人会用，反而一直占着内存 */
const MAX_DEPTH = 50

/**
 * 总量阀门。快照里存着结果历史（一串 URL），大画布上 50 层能堆到几十 MB。
 * 超了就从最老的开始丢 —— 丢掉的是没人会回去的那一头。
 */
const MAX_TOTAL_CHARS = 12_000_000

interface Options {
  nodes: Ref<any[]>
  edges: Ref<any[]>
  /**
   * 节点和连线之外、也要跟着撤销 / 重做走的画布级状态（这张画布套用的品牌包）。
   * get 给出一份可 JSON 化的值，set 把它放回去。老快照里没有这一项时不调 set。
   */
  extra?: { get: () => unknown; set: (value: any) => void }
}

export function useCanvasHistory({ nodes, edges, extra }: Options) {
  const past = ref<string[]>([])
  const future = ref<string[]>([])

  /**
   * apply 自己也会改 nodes/edges。不挡一下的话，undo 里调用的 record（如果有人
   * 顺手加了）会把撤销本身也记成一次操作，Ctrl+Z 就会在两个状态之间来回跳。
   */
  let applying = false

  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  function snapshot(): string {
    // 与 buildSavePayload 同一套序列化路径（那条链路每 1.5 秒在生产上跑一次，
    // 能确认这些对象是可 JSON 化的、没有循环引用）
    return JSON.stringify({ nodes: nodes.value, edges: edges.value, ...(extra ? { extra: extra.get() } : {}) })
  }

  /** 掉队的老快照先走，直到总量回到阀门以下 */
  function trim() {
    while (past.value.length > MAX_DEPTH) past.value.shift()
    let total = 0
    for (const s of past.value) total += s.length
    while (past.value.length > 1 && total > MAX_TOTAL_CHARS) {
      total -= past.value[0].length
      past.value.shift()
    }
  }

  /**
   * 动手之前调它。记下「现在」，之后 undo 就回到这里。
   * 新操作一旦发生，redo 链就断了 —— 这是所有编辑器的共同约定。
   */
  function record() {
    if (applying) return
    past.value.push(snapshot())
    future.value = []
    trim()
  }

  /**
   * 丢掉最近一条记录，但不还原。
   * 给「整理」用：它自己有一套带动画的位置撤销，用户点了那个胶囊之后画布已经
   * 回到 record() 时的样子了，历史栈顶那条就成了原地踏步的一格，留着只会让
   * 第一次 Ctrl+Z 看起来没反应。
   */
  function drop() {
    past.value.pop()
  }

  function apply(raw: string) {
    let parsed: { nodes?: any[]; edges?: any[]; extra?: unknown }
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    const liveById = new Map<string, any>()
    for (const n of nodes.value) liveById.set(n.id, n)

    const next = (parsed.nodes || []).map((n: any) => {
      const live = liveById.get(n.id)
      // 恢复一个被删掉的节点：现场没有更新的产物，快照里存了什么就是什么
      if (!live) return n
      const keep = VOLATILE_COMMON.concat(VOLATILE_BY_TYPE[n.type as string] || [])
      const data = { ...(n.data || {}) }
      for (const k of keep) {
        if (live.data && Object.prototype.hasOwnProperty.call(live.data, k)) {
          data[k] = live.data[k]
        }
      }
      return { ...n, data }
    })

    applying = true
    nodes.value = next
    edges.value = parsed.edges || []
    if (extra && parsed.extra !== undefined) extra.set(parsed.extra)
    // 同步解锁：nodes/edges 是同一个 tick 内赋值的，watch 回调在之后跑但不会
    // 再调 record（record 只由用户操作显式触发），这里不需要 nextTick
    applying = false
  }

  function undo(): boolean {
    if (!past.value.length) return false
    const cur = snapshot()
    const prev = past.value.pop() as string
    future.value.push(cur)
    if (future.value.length > MAX_DEPTH) future.value.shift()
    apply(prev)
    return true
  }

  function redo(): boolean {
    if (!future.value.length) return false
    const cur = snapshot()
    const next = future.value.pop() as string
    past.value.push(cur)
    trim()
    apply(next)
    return true
  }

  /** 加载完画布 / 切换画布时清空 —— 别让上一张画布的历史串到这一张来 */
  function reset() {
    past.value = []
    future.value = []
  }

  return { record, drop, undo, redo, reset, canUndo, canRedo }
}
