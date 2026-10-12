import type { LoomCanvasFeatures } from './types'

export {}

declare module 'vue' {
  interface ComponentCustomProperties {
    /** Teleport 的去处：独立应用里是 'body'，嵌进别人的页面时是本产品根元素里的那一层（见 embed/mount.ts） */
    $lcPortal: HTMLElement | string
    /** 文档里存的媒体地址 → 浏览器能加载的地址（utils/mediaUrl.ts 的 mediaSrc） */
    /** 这一次挂载开着的功能（embed/types.ts 的 LoomCanvasFeatures）；关掉的功能入口用 v-if="$feat.xxx" 收起来 */
    $feat: LoomCanvasFeatures
    $src: (url: string | undefined | null) => string
  }
}
