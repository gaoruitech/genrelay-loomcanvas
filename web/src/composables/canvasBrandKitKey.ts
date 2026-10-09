import type { InjectionKey, Ref } from 'vue'
import type { BrandKit } from './useBrandKits'

/**
 * 品牌包在节点里的取用口。
 *
 * 与 CANVAS_EXECUTOR_KEY 同一个模式：画布持有数据，节点只消费。
 * 节点自己去拉列表的话，画布上十几个生成节点就会各拉一次同样的接口。
 *
 * 分享页那种只读画布拿不到这个 provide，inject 的默认值是 undefined，
 * 节点上的选择器自然就不出现 —— 不用额外判断。
 */
export interface CanvasBrandKitApi {
  /** 当前用户可用的品牌包（自己的 + 团队共享的） */
  list: Ref<BrandKit[]>
  /** 打开管理弹窗 */
  open: () => void
}

export const CANVAS_BRAND_KIT_KEY: InjectionKey<CanvasBrandKitApi> = Symbol('canvas-brand-kit')
