import { ref, computed, type Ref } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import { DEFAULT_NODE_LAYOUT, genNodeSize, isGenNodeKind, type NodeLayout } from '@/composables/nodeLayout'

/**
 * 画布自动整理。
 *
 * 设计取向：画布是有向图，整理就该顺着连线走 —— 谁在前、谁在后一眼看出来。
 * 排成一个整齐的方阵反而把「数据流」这个唯一有价值的信息抹掉了。
 *
 * 三条硬约束：
 *  1. 只写 node.position，别的字段一个都不碰 —— 保证整理绝不会毁掉正在跑的任务。
 *  2. 层内顺序尽量保留用户原来的上下关系，整理完还得认得出是原来那张图。
 *  3. 必须能反悔：整理前压一份位置快照，撤销一次还原。
 */

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
export type DistributeAxis = 'h' | 'v'

interface Options {
  nodes: Ref<Node[]>
  edges: Ref<Edge[]>
  /** vue-flow 的 getNodes：带实测 dimensions 和选中态。注意开了 only-render-visible-elements 之后它只给视野里的节点 */
  getNodes: Ref<any[]>
  /**
   * 某个节点的实测宽高（问 vue-flow 要）。视野外的节点没渲染过、量不到，返回 null，
   * 这时按节点类型估一个（见 estimateNodeSize）。整理全图必须覆盖全部节点，不能只排看得见的那几个。
   */
  measure?: (id: string) => { width: number; height: number } | null | undefined
  /** 生成节点现在用的布局：量不到尺寸时按它估（三种布局下节点大小差得很远） */
  nodeLayout?: () => NodeLayout
  updateNode: (id: string, update: any) => void
  fitView?: (opts?: any) => void
}

interface Pos { x: number; y: number }
interface Box { id: string; x: number; y: number; w: number; h: number }

const LAYER_GAP = 160   // 层与层的横向间隙
const ROW_GAP = 60      // 同层节点的纵向间隙
const ORPHAN_GAP = 96   // 孤儿区与主图的间隙
const ORPHAN_ROW = 6    // 孤儿区每行几个
const GRID = 20         // 网格吸附粒度，与 Background 的 gap 一致
const DURATION = 500
/** 超过这个数量就不做过渡动画：几百个节点逐帧改位置会把低配机器拖垮 */
const MAX_ANIMATE = 120
/** 超过这个数量先弹确认，交给调用方决定 */
export const LAYOUT_CONFIRM_THRESHOLD = 200

/** 素材、成品和工具节点都是 280 x 300 上下 */
const FALLBACK_SIZE = { w: 280, h: 320 }

/**
 * 量不到尺寸时按类型估的宽高。只在节点从没进过视野（或上次量是在另一种布局下）时用到；
 * 宁可估大一点 —— 估小了整理完还会叠。生成节点的大小跟着布局走，见 nodeLayout.ts 的 GEN_NODE_SIZE。
 */
export function estimateNodeSize(type: string | undefined, layout: NodeLayout = DEFAULT_NODE_LAYOUT): { w: number; h: number } {
  return type && isGenNodeKind(type) ? genNodeSize(type, layout) : FALLBACK_SIZE
}

export interface LayoutBox { id: string; x: number; y: number; w: number; h: number }

/**
 * 有没有两个节点叠在一起。只看同一层级里的散节点（组和组内子节点不参与整理，也不在这里查）。
 * `tolerance`：两边各让出这么多像素才算叠 —— 贴边、压一条描边不算，
 * 否则用户特意排得很紧的画布也会被判成「重叠」。
 */
export function boxesOverlap(list: LayoutBox[], tolerance = 12): boolean {
  const sorted = [...list].sort((a, b) => a.x - b.x)
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]
      if (b.x >= a.x + a.w - tolerance) break // 按 x 排过序：后面的都在 a 右边了
      if (b.y < a.y + a.h - tolerance && a.y < b.y + b.h - tolerance) return true
    }
  }
  return false
}

export function useAutoLayout(opts: Options) {
  const { nodes, edges, getNodes, updateNode, fitView, measure } = opts
  const layoutOf = () => opts.nodeLayout?.() || DEFAULT_NODE_LAYOUT

  const running = ref(false)
  /** 上一次整理前的位置快照；撤销后清空 */
  const snapshot = ref<Record<string, Pos> | null>(null)
  const canUndo = computed(() => !!snapshot.value)

  const selectedCount = computed(() => getNodes.value.filter((n: any) => n.selected).length)

  function reduceMotion(): boolean {
    return typeof window !== 'undefined'
      && !!window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  /** 画布上的全部节点（v-model 的那份），不受「只渲染视野内」的影响 */
  const allNodes = (): any[] => nodes.value as any[]

  function boxes(list?: any[]): Box[] {
    const src = list || allNodes()
    return src.map((n: any) => {
      const m = measure?.(n.id)
      const est = estimateNodeSize(n.type, layoutOf())
      // 生成节点：调用方说量不到（没渲染过，或那是在另一种布局下量的），就不要再去翻节点上存着的旧尺寸
      const stored = measure && isGenNodeKind(n.type) ? null : n.dimensions
      return {
        id: n.id,
        x: n.position?.x ?? 0,
        y: n.position?.y ?? 0,
        w: m?.width || stored?.width || (typeof n.width === 'number' ? n.width : 0) || est.w,
        h: m?.height || stored?.height || (typeof n.height === 'number' ? n.height : 0) || est.h,
      }
    })
  }

  function takeSnapshot() {
    const snap: Record<string, Pos> = {}
    for (const n of allNodes()) snap[n.id] = { x: n.position?.x ?? 0, y: n.position?.y ?? 0 }
    snapshot.value = snap
  }

  /** easeOutCubic —— 起步快、末尾缓，跟设计稿里的 cubic-bezier(.22,.61,.36,1) 观感一致 */
  function ease(t: number): number {
    return 1 - Math.pow(1 - t, 3)
  }

  function applyPositions(targets: Record<string, Pos>) {
    for (const id of Object.keys(targets)) {
      updateNode(id, { position: { x: targets[id].x, y: targets[id].y } })
    }
  }

  /**
   * 过渡到目标位置。瞬移会让用户彻底丢失方位感 —— 这是整理功能最常见的差评来源，
   * 所以动画不是锦上添花，是这个功能能不能用的一部分。
   */
  function animateTo(targets: Record<string, Pos>): Promise<void> {
    const ids = Object.keys(targets)
    if (!ids.length) return Promise.resolve()

    if (reduceMotion() || ids.length > MAX_ANIMATE) {
      applyPositions(targets)
      return Promise.resolve()
    }

    const from: Record<string, Pos> = {}
    for (const n of allNodes()) {
      if (targets[n.id]) from[n.id] = { x: n.position?.x ?? 0, y: n.position?.y ?? 0 }
    }

    return new Promise<void>((resolve) => {
      const start = performance.now()
      running.value = true
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / DURATION)
        const k = ease(t)
        for (const id of ids) {
          const a = from[id]
          const b = targets[id]
          if (!a || !b) continue
          updateNode(id, { position: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k } })
        }
        if (t < 1) {
          requestAnimationFrame(step)
        } else {
          applyPositions(targets)   // 收尾对齐到精确值，避免插值残留小数
          running.value = false
          resolve()
        }
      }
      requestAnimationFrame(step)
    })
  }

  /** 能参与整理的节点：排除组容器(frame)和已入组的子节点(有 parentNode)。
   *  组是用户特意圈好的版块，整理时要整体保持原样，不能被拆开重排。 */
  function isArrangeable(n: any): boolean {
    return n.type !== 'frame' && !n.parentNode
  }

  // ==================== 按数据流分层 ====================

  /**
   * 层号 = 最长入边路径深度。先跑一遍 Kahn 拓扑序，环里的节点排在最后按原顺序补上
   * —— 画布理论上不该有环（连线时有校验），但脏数据不该把整理搞死循环。
   */
  function computeLayers(ids: string[], incoming: Map<string, string[]>, outgoing: Map<string, string[]>): Map<string, number> {
    const indeg = new Map<string, number>()
    for (const id of ids) indeg.set(id, (incoming.get(id) || []).length)

    const queue = ids.filter((id) => (indeg.get(id) || 0) === 0)
    const order: string[] = []
    while (queue.length) {
      const id = queue.shift() as string
      order.push(id)
      for (const nxt of outgoing.get(id) || []) {
        const d = (indeg.get(nxt) || 0) - 1
        indeg.set(nxt, d)
        if (d === 0) queue.push(nxt)
      }
    }
    for (const id of ids) if (!order.includes(id)) order.push(id)  // 环里的补在最后

    const layer = new Map<string, number>()
    for (const id of order) {
      let l = 0
      for (const prev of incoming.get(id) || []) {
        const pl = layer.get(prev)
        if (pl !== undefined) l = Math.max(l, pl + 1)
      }
      layer.set(id, l)
    }
    return layer
  }

  function computeFlowLayout(): Record<string, Pos> {
    // 只整理散节点：组容器和组内子节点整体保持原样
    const all = boxes(allNodes().filter(isArrangeable))
    if (!all.length) return {}
    const boxById = new Map(all.map((b) => [b.id, b]))

    const incoming = new Map<string, string[]>()
    const outgoing = new Map<string, string[]>()
    const linked = new Set<string>()
    for (const e of edges.value) {
      const s = e.source, t = e.target
      if (!boxById.has(s) || !boxById.has(t) || s === t) continue
      if (!outgoing.has(s)) outgoing.set(s, [])
      if (!incoming.has(t)) incoming.set(t, [])
      outgoing.get(s)!.push(t)
      incoming.get(t)!.push(s)
      linked.add(s); linked.add(t)
    }

    const connected = all.filter((b) => linked.has(b.id))
    // 没连过线的节点大多是随手拖进来的素材，不该被塞进流程里
    const orphans = all.filter((b) => !linked.has(b.id))

    // 整个图的左上角保持不动，否则整理完画布会整体"瞬移"到别处
    const originX = Math.min(...all.map((b) => b.x))
    const originY = Math.min(...all.map((b) => b.y))

    const targets: Record<string, Pos> = {}
    let mainBottom = originY

    if (connected.length) {
      const ids = connected.map((b) => b.id)
      const layer = computeLayers(ids, incoming, outgoing)

      const byLayer = new Map<number, string[]>()
      for (const id of ids) {
        const l = layer.get(id) || 0
        if (!byLayer.has(l)) byLayer.set(l, [])
        byLayer.get(l)!.push(id)
      }
      const layerKeys = Array.from(byLayer.keys()).sort((a, b) => a - b)

      // 层内排序：先按现有 y 定基准序，再做一轮 barycenter 减少连线交叉。
      // 没有前驱的节点保持基准序 —— 用户手摆的上下关系是有意图的，别打乱。
      const rankInLayer = new Map<string, number>()
      for (const l of layerKeys) {
        const list = byLayer.get(l)!
        list.sort((a, b) => (boxById.get(a)!.y - boxById.get(b)!.y))
        const base = new Map(list.map((id, i) => [id, i]))
        const bc = new Map<string, number>()
        for (const id of list) {
          const preds = (incoming.get(id) || []).filter((p) => (layer.get(p) ?? -1) === l - 1)
          if (preds.length) {
            const sum = preds.reduce((acc, p) => acc + (rankInLayer.get(p) ?? 0), 0)
            bc.set(id, sum / preds.length)
          } else {
            bc.set(id, base.get(id) as number)
          }
        }
        list.sort((a, b) => (bc.get(a)! - bc.get(b)!) || (base.get(a)! - base.get(b)!))
        list.forEach((id, i) => rankInLayer.set(id, i))
      }

      // 各层横向位置：列宽取层内最宽节点，窄节点在列内居中，左右边缘才对得齐
      const layerX = new Map<number, number>()
      const layerColW = new Map<number, number>()
      let xCursor = originX
      for (const l of layerKeys) {
        const colW = Math.max(...byLayer.get(l)!.map((id) => boxById.get(id)!.w))
        layerX.set(l, xCursor)
        layerColW.set(l, colW)
        xCursor += colW + LAYER_GAP
      }

      // 纵向位置：每个节点的中心尽量对齐它前驱的中心，让连线尽量水平 ——
      // 「顺着数据流一眼看懂」和「排版好看」靠的就是这个，而不是把每层各自居中。
      // 先算期望中心，再按层内顺序消重叠（最小 ROW_GAP），最后整层平移贴回期望中心，
      // 避免一层层往下漂。
      const yTop = new Map<string, number>()
      const centerOf = (id: string) => yTop.get(id)! + boxById.get(id)!.h / 2
      for (const l of layerKeys) {
        const list = byLayer.get(l)!
        const desiredTop = list.map((id) => {
          const preds = (incoming.get(id) || []).filter((p) => yTop.has(p))
          if (!preds.length) return null
          const c = preds.reduce((acc, p) => acc + centerOf(p), 0) / preds.length
          return c - boxById.get(id)!.h / 2
        })
        const tops: number[] = []
        let cursor = -Infinity
        for (let i = 0; i < list.length; i++) {
          const h = boxById.get(list[i])!.h
          let t = desiredTop[i]
          if (t == null) t = i > 0 ? tops[i - 1] + boxById.get(list[i - 1])!.h + ROW_GAP : originY
          if (t < cursor) t = cursor
          tops[i] = t
          cursor = t + h + ROW_GAP
        }
        // 把整层平移，使「有前驱的节点」实际中心的平均贴回期望中心的平均
        let sumD = 0, sumA = 0, cnt = 0
        for (let i = 0; i < list.length; i++) {
          const d = desiredTop[i]
          if (d != null) {
            sumD += d + boxById.get(list[i])!.h / 2
            sumA += tops[i] + boxById.get(list[i])!.h / 2
            cnt++
          }
        }
        if (cnt) {
          const shift = (sumD - sumA) / cnt
          for (let i = 0; i < tops.length; i++) tops[i] += shift
        }
        list.forEach((id, i) => yTop.set(id, tops[i]))
      }

      // 整图回锚：最上沿对齐 originY，画布不整体上下漂
      const minTop = Math.min(...Array.from(yTop.values()))
      const dy = originY - minTop
      for (const l of layerKeys) {
        const colX = layerX.get(l)!, colW = layerColW.get(l)!
        for (const id of byLayer.get(l)!) {
          const b = boxById.get(id)!
          const y = yTop.get(id)! + dy
          targets[id] = { x: colX + (colW - b.w) / 2, y }
          mainBottom = Math.max(mainBottom, y + b.h)
        }
      }
    }

    if (orphans.length) {
      // 孤儿区收到主图下方单独一带，横向按现有顺序平铺
      orphans.sort((a, b) => (a.y - b.y) || (a.x - b.x))
      const rowH = Math.max(...orphans.map((b) => b.h))
      let ox = originX
      let oy = connected.length ? mainBottom + ORPHAN_GAP : originY
      orphans.forEach((b, i) => {
        if (i > 0 && i % ORPHAN_ROW === 0) {
          ox = originX
          oy += rowH + ROW_GAP
        }
        targets[b.id] = { x: ox, y: oy }
        ox += b.w + ROW_GAP
      })
    }

    // 收尾吸附到网格：位置全落在 GRID 上，边缘更齐（容差 <10px，远小于间隙，不造成重叠）
    for (const id of Object.keys(targets)) {
      targets[id] = {
        x: Math.round(targets[id].x / GRID) * GRID,
        y: Math.round(targets[id].y / GRID) * GRID,
      }
    }

    return targets
  }

  // ==================== 对外动作 ====================

  /**
   * 散节点里有没有互相压着的（按实测尺寸，量不到的按类型估）。
   * 改版前排的画布第一次打开时用它决定要不要整理：没叠就一个位置都不动。
   */
  function hasOverlap(): boolean {
    return boxesOverlap(boxes(allNodes().filter(isArrangeable)))
  }

  /** 按数据流整理全图。返回是否真的动了。 */
  async function arrange(): Promise<boolean> {
    if (running.value) return false
    const targets = computeFlowLayout()
    if (!Object.keys(targets).length) return false
    takeSnapshot()
    await animateTo(targets)
    fitView?.({ padding: 0.2, duration: reduceMotion() ? 0 : 300 })
    return true
  }

  /** 全部吸附到 GRID 网格 */
  async function snapToGrid(): Promise<boolean> {
    if (running.value) return false
    const targets: Record<string, Pos> = {}
    let moved = false
    for (const b of boxes(allNodes().filter(isArrangeable))) {
      const x = Math.round(b.x / GRID) * GRID
      const y = Math.round(b.y / GRID) * GRID
      if (x !== b.x || y !== b.y) moved = true
      targets[b.id] = { x, y }
    }
    if (!moved) return false
    takeSnapshot()
    await animateTo(targets)
    return true
  }

  /** 对齐所选（至少 2 个） */
  async function alignSelected(mode: AlignMode): Promise<boolean> {
    if (running.value) return false
    const sel = boxes(getNodes.value.filter((n: any) => n.selected))
    if (sel.length < 2) return false

    const left = Math.min(...sel.map((b) => b.x))
    const right = Math.max(...sel.map((b) => b.x + b.w))
    const top = Math.min(...sel.map((b) => b.y))
    const bottom = Math.max(...sel.map((b) => b.y + b.h))
    const cx = (left + right) / 2
    const cy = (top + bottom) / 2

    const targets: Record<string, Pos> = {}
    for (const b of sel) {
      let { x, y } = b
      if (mode === 'left') x = left
      else if (mode === 'right') x = right - b.w
      else if (mode === 'hcenter') x = cx - b.w / 2
      else if (mode === 'top') y = top
      else if (mode === 'bottom') y = bottom - b.h
      else if (mode === 'vcenter') y = cy - b.h / 2
      targets[b.id] = { x, y }
    }
    takeSnapshot()
    await animateTo(targets)
    return true
  }

  /** 所选等距分布（至少 3 个）：两端不动，中间按中心点均分 */
  async function distributeSelected(axis: DistributeAxis): Promise<boolean> {
    if (running.value) return false
    const sel = boxes(getNodes.value.filter((n: any) => n.selected))
    if (sel.length < 3) return false

    const center = (b: Box) => (axis === 'h' ? b.x + b.w / 2 : b.y + b.h / 2)
    sel.sort((a, b) => center(a) - center(b))
    const first = center(sel[0])
    const last = center(sel[sel.length - 1])
    const step = (last - first) / (sel.length - 1)

    const targets: Record<string, Pos> = {}
    sel.forEach((b, i) => {
      const c = first + step * i
      targets[b.id] = axis === 'h'
        ? { x: c - b.w / 2, y: b.y }
        : { x: b.x, y: c - b.h / 2 }
    })
    takeSnapshot()
    await animateTo(targets)
    return true
  }

  /** 撤销上一次整理 */
  async function undo(): Promise<boolean> {
    const snap = snapshot.value
    if (!snap || running.value) return false
    snapshot.value = null
    await animateTo(snap)
    return true
  }

  function nodeCount(): number {
    return nodes.value.length
  }

  return {
    hasOverlap,
    running,
    canUndo,
    selectedCount,
    nodeCount,
    arrange,
    snapToGrid,
    alignSelected,
    distributeSelected,
    undo,
  }
}
