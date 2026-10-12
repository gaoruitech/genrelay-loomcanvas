import type { InjectionKey, Ref } from 'vue'
import type { ImageRef } from '@/composables/canvasImageRefs'
import type { RunOptions } from '@/composables/useCanvasExecutor'
import type { BrandKit, BrandKitEffect } from '@/composables/useBrandKits'

export interface CanvasExecutorApi {
  running: Ref<boolean>
  runningNodeId: Ref<string | null>
  runNode: (nodeId: string) => Promise<boolean>
  runSubtree: (targetId: string) => Promise<void>
  runAll: (opts?: RunOptions) => Promise<void>
  attachTask: (nodeId: string) => Promise<boolean>
  /** 取消该节点正在跑的运行（已提交、还没出结果的那些） */
  cancelNode: (nodeId: string) => Promise<void>
  /** 该节点当前会送出去的图，按最终顺序。缩略图条和 @ 候选都读它 */
  collectImageRefs: (nodeId: string) => ImageRef[]
  /** 该节点现在运行的话，品牌包会往请求里加什么（与真正发出去的同一份推导）；不套用返回 null */
  brandKitEffect: (nodeId: string) => { kit: BrandKit; effect: BrandKitEffect } | null
  resumeIncompleteTasks: () => void
}

export const CANVAS_EXECUTOR_KEY: InjectionKey<CanvasExecutorApi> = Symbol('canvas-executor')
