/**
 * 画框的坐标计算。
 *
 * 单独抽出来是因为这里最容易错：一旦给节点设了 parentNode，vue-flow 就把它的
 * position 当作「相对父节点」来解释。圈框的时候如果不把绝对坐标换算成相对坐标，
 * 所有被圈的节点会当场跳到别的地方去；解散的时候不换回来，则会跳第二次。
 *
 * 纯函数，不碰 vue-flow，可以直接测。
 */

export interface FrameNodeLike {
  id: string
  position?: { x: number; y: number }
  dimensions?: { width: number; height: number }
  parentNode?: string
  [k: string]: any
}

/** 框住内容时四周留的边距；上边多留一点给标题栏 */
export const FRAME_PAD = 28
export const FRAME_PAD_TOP = 34

/** 节点还没被量过尺寸时的兜底值（vue-flow 未测量时 dimensions 是 0） */
const FALLBACK_W = 240
const FALLBACK_H = 160

function sizeOf(n: FrameNodeLike) {
  const w = Number(n.dimensions?.width) || FALLBACK_W
  const h = Number(n.dimensions?.height) || FALLBACK_H
  return { w, h }
}

export interface FramePlan {
  position: { x: number; y: number }
  w: number
  h: number
  /** 子节点换算后的相对坐标 */
  children: { id: string; position: { x: number; y: number } }[]
}

/**
 * 算出能框住这批节点的画框，以及每个子节点相对画框的坐标。
 *
 * 已经属于别的画框的节点会被跳过 —— vue-flow 不支持多层嵌套的干净语义，
 * 与其做半套嵌套不如明确不接。
 *
 * @returns null 表示没有可框的节点
 */
export function planFrame(nodes: FrameNodeLike[], ids: string[]): FramePlan | null {
  const set = new Set(ids)
  // 组本身也要排除：框选常常会把组一起选进来，不挡住的话圈出来的是「组套组」，
  // 而 vue-flow 的嵌套语义我们并不支持。要把组并到一起走 planMerge。
  const picked = nodes.filter((n) => set.has(n.id) && !n.parentNode && n.type !== 'frame')
  if (!picked.length) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of picked) {
    const x = Number(n.position?.x) || 0
    const y = Number(n.position?.y) || 0
    const { w, h } = sizeOf(n)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }

  const position = { x: minX - FRAME_PAD, y: minY - FRAME_PAD_TOP }
  return {
    position,
    w: Math.round(maxX - minX + FRAME_PAD * 2),
    h: Math.round(maxY - minY + FRAME_PAD_TOP + FRAME_PAD),
    children: picked.map((n) => ({
      id: n.id,
      // 相对父节点：绝对坐标减去画框自己的位置
      position: {
        x: (Number(n.position?.x) || 0) - position.x,
        y: (Number(n.position?.y) || 0) - position.y,
      },
    })),
  }
}

/**
 * 由 plan 造出「组」这个节点本身。planFrame 和 planMerge 两条路都走这里，
 * 因为下面两个字段少一个就是线上事故，不能靠调用方记得写。
 *
 * dimensions —— 必须在这里就写死，不能等 vue-flow 量。子节点带着 extent:'parent'
 *   挂上来的那一刻，vue-flow 会拿父组的 dimensions 去夹子节点坐标；新建的组还没
 *   渲染过，量出来是 0，夹出来的范围退化成一个点，每个子节点被推到相对坐标
 *   (-自身宽, -自身高) —— 表现就是一圈节点全叠到组的左上角外面。
 *
 * 组是个正常节点，照常吃鼠标事件：点一下选中它，拖着走整组一起动。
 * 代价是组盖住的那片画布按下鼠标永远是「拖这个组」，框选拉不起来 —— 这一条由
 * Canvas.vue 里的 .box-selecting 兜底：按住 Shift 时把组临时变穿透。
 */
export function frameNodeFrom(plan: FramePlan, id: string, label = '') {
  return {
    id,
    type: 'frame',
    position: { ...plan.position },
    data: { label, w: plan.w, h: plan.h },
    dimensions: { width: plan.w, height: plan.h },
    selectable: true,
  }
}

/**
 * 解散画框：把子节点的相对坐标换算回绝对坐标。
 *
 * 必须在移除 parentNode 的同时做，两步分开会让节点在中间那一帧跳一次。
 */
export function releaseFrame(nodes: FrameNodeLike[], frameId: string) {
  const frame = nodes.find((n) => n.id === frameId)
  if (!frame) return []
  const fx = Number(frame.position?.x) || 0
  const fy = Number(frame.position?.y) || 0
  return nodes
    .filter((n) => n.parentNode === frameId)
    .map((n) => ({
      id: n.id,
      position: {
        x: (Number(n.position?.x) || 0) + fx,
        y: (Number(n.position?.y) || 0) + fy,
      },
    }))
}

/**
 * 节点搜索的匹配。
 *
 * 搜的是用户认得出的东西：提示词、编辑指令、文本内容、模型名、节点类型的显示名（随界面语言）。
 * 不搜 id —— 那串 n_xxx 没人记得住，只会污染结果。
 */
export function matchNode(n: FrameNodeLike, kw: string, typeLabel: (t: string) => string): boolean {
  const q = kw.trim().toLowerCase()
  if (!q) return false
  const d = n.data || {}
  const hay = [
    d.prompt, d.instruction, d.text, d.label,
    d.model,
    typeLabel(String(n.type || '')),
  ]
  return hay.some((v) => typeof v === 'string' && v.toLowerCase().includes(q))
}

/* ==================== 合并 / 移出 ==================== */

/**
 * 节点的绝对坐标。
 *
 * 组里的子节点存的是「相对父组」的坐标，跨组计算（合并、移出）之前必须先还原
 * 成绝对坐标，否则两个组的子节点会被当成同一个坐标系里的点，算出来的包围盒
 * 完全是错的。
 */
export function absPos(n: FrameNodeLike, nodes: FrameNodeLike[]): { x: number; y: number } {
  const x = Number(n.position?.x) || 0
  const y = Number(n.position?.y) || 0
  if (!n.parentNode) return { x, y }
  const p = nodes.find((m) => m.id === n.parentNode)
  if (!p) return { x, y }
  // 只支持一层：画布上不会出现组套组（groupIntoFrame 拒绝已有父组的节点）
  return { x: x + (Number(p.position?.x) || 0), y: y + (Number(p.position?.y) || 0) }
}

/** 跟 FramePlan 同形，多带两个字段，好直接喂给 frameNodeFrom */
export interface MergePlan {
  position: { x: number; y: number }
  w: number
  h: number
  children: { id: string; position: { x: number; y: number } }[]
  /** 被合并掉、要删除的旧组 */
  removedFrameIds: string[]
  /** 新组沿用的名字：取第一个有名字的旧组 */
  label: string
}

/**
 * 把选中的东西合并成一个组。
 *
 * 选中集合里可以混着三种东西，都能处理：
 *   组          —— 它的全部子节点进新组，组本身删掉
 *   散节点      —— 直接进新组
 *   别的组里的节点 —— 从原组移出、进新组（这让「合并」顺带能当「挪节点」用）
 *
 * @returns null 表示凑不出至少两个成员，没有合并的必要
 */
export function planMerge(nodes: FrameNodeLike[], ids: string[]): MergePlan | null {
  const sel = new Set(ids)
  const frames = nodes.filter((n) => sel.has(n.id) && n.type === 'frame')
  const frameIds = new Set(frames.map((f) => f.id))

  // 成员 = 选中的非组节点 + 选中的组的全部子节点，按 id 去重
  const members = new Map<string, FrameNodeLike>()
  for (const n of nodes) {
    if (n.type === 'frame') continue
    if (sel.has(n.id) || (n.parentNode && frameIds.has(n.parentNode))) {
      members.set(n.id, n)
    }
  }
  if (members.size < 2) return null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const abs = new Map<string, { x: number; y: number }>()
  for (const n of members.values()) {
    const p = absPos(n, nodes)
    abs.set(n.id, p)
    const w = Number(n.dimensions?.width) || 240
    const h = Number(n.dimensions?.height) || 160
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x + w); maxY = Math.max(maxY, p.y + h)
  }

  const position = { x: minX - FRAME_PAD, y: minY - FRAME_PAD_TOP }
  return {
    position,
    w: Math.round(maxX - minX + FRAME_PAD * 2),
    h: Math.round(maxY - minY + FRAME_PAD_TOP + FRAME_PAD),
    children: [...members.keys()].map((id) => {
      const p = abs.get(id)!
      return { id, position: { x: p.x - position.x, y: p.y - position.y } }
    }),
    removedFrameIds: [...frameIds],
    label: frames.map((f) => String(f.data?.label || '')).find((s) => s) || '',
  }
}

/**
 * 把指定节点移出各自所在的组（坐标换算回绝对）。
 * 不在任何组里的节点会被忽略。
 */
export function planRelease(nodes: FrameNodeLike[], ids: string[]) {
  const sel = new Set(ids)
  return nodes
    .filter((n) => sel.has(n.id) && n.parentNode && n.type !== 'frame')
    .map((n) => ({ id: n.id, position: absPos(n, nodes) }))
}
