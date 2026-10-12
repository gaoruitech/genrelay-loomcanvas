import type { InjectionKey, Ref } from 'vue'
import type { BrandKit, NodeKitChoice } from './useBrandKits'

/**
 * 品牌包在节点里的取用口。
 *
 * 与 CANVAS_EXECUTOR_KEY 同一个模式：画布持有数据（品牌包列表、这张画布选的是哪个），节点只消费。
 * 节点自己去拉列表的话，画布上十几个生成节点就会各拉一次同样的接口。
 *
 * 分享页那种只读画布没有这个 provide，inject 得到 undefined，
 * 节点上跟品牌包有关的东西自然都不出现 —— 不用额外判断。
 */
export interface CanvasBrandKitApi {
  /** 当前账号的品牌包 */
  list: Ref<BrandKit[]>
  /** 这张画布选的品牌包 id；空串 = 没选 */
  canvasKitId: Ref<string>
  /** 一个节点实际用哪个：跟画布，还是它自己的例外 */
  resolve: (nodeData: any) => NodeKitChoice
  /** 改一个节点的例外：'' = 跟随画布，KIT_NONE = 此节点不套用，其余是品牌包 id */
  setNodeOverride: (nodeId: string, value: string) => void
}

export const CANVAS_BRAND_KIT_KEY: InjectionKey<CanvasBrandKitApi> = Symbol('canvas-brand-kit')
