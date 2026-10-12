import type { InjectionKey, Ref } from 'vue'

/**
 * 生成节点的三种布局。选哪种是账号的偏好（服务端存 user.prefs.nodeLayout），
 * 分享页不看偏好、一律用 a 的只读形态。
 *
 *  a  结果优先：节点就是结果，选中后在节点下方出一条输入条
 *  b  紧凑节点：节点只留摘要，选中后设置在画布右缘的属性面板里
 *  c  一体化卡片：所有东西都在节点上
 */
export type NodeLayout = 'a' | 'b' | 'c'
export const NODE_LAYOUTS: NodeLayout[] = ['a', 'b', 'c']
export const DEFAULT_NODE_LAYOUT: NodeLayout = 'a'

export function normalizeNodeLayout(v: unknown): NodeLayout {
  return v === 'b' || v === 'c' ? v : DEFAULT_NODE_LAYOUT
}

/** 走这三种布局的节点类型；其余节点（素材 / 工具 / 成品 / 组）各自保持原来的形态 */
export const GEN_NODE_KINDS = ['image-gen', 'image-edit', 'video-gen', 'video-edit', 'llm', 'video-analysis'] as const
export type GenNodeKind = typeof GEN_NODE_KINDS[number]
const GEN_KIND_SET = new Set<string>(GEN_NODE_KINDS)
export const isGenNodeKind = (type: unknown): type is GenNodeKind => typeof type === 'string' && GEN_KIND_SET.has(type)

/** 属性面板（布局 b）的宽度，以及它和画布右缘的间距。「适应屏幕」、新节点落点、队列圆钮都按这两个数让位 */
export const INSPECTOR_WIDTH = 320
export const INSPECTOR_GAP = 12

/**
 * 各布局下节点的宽度，和没量过尺寸时估的高度（出了结果、不带报错的常见大小，偏大一点）。
 * 节点从没进过视野（only-render-visible-elements）就量不到，自动整理、查重叠、内置模板的间距
 * 都按这张表；服务端的模板测试里有同一组数（server/test/seed.test.js）。
 */
export const GEN_NODE_SIZE: Record<NodeLayout, { media: { w: number; h: number }; text: { w: number; h: number } }> = {
  a: { media: { w: 272, h: 344 }, text: { w: 272, h: 280 } },
  b: { media: { w: 240, h: 200 }, text: { w: 240, h: 200 } },
  c: { media: { w: 328, h: 460 }, text: { w: 328, h: 460 } },
}

export function genNodeSize(type: string, layout: NodeLayout): { w: number; h: number } {
  const s = GEN_NODE_SIZE[layout] || GEN_NODE_SIZE[DEFAULT_NODE_LAYOUT]
  return type === 'llm' || type === 'video-analysis' ? s.text : s.media
}

/**
 * 画布给生成节点和它们的面板（输入条 / 属性面板）的上下文。
 * 只读画布（分享页）不 provide：节点按 a 的只读形态渲染。
 */
export interface CanvasNodeUi {
  layout: Ref<NodeLayout>
  /** 布局 c：节点把「聚焦自己的提示词框」登记上来，画布上选中后直接打字时用 */
  registerPromptFocus: (nodeId: string, focus: (() => void) | null) => void
}

export const CANVAS_NODE_UI_KEY: InjectionKey<CanvasNodeUi> = Symbol('canvas-node-ui')
