import type { InjectionKey, Ref } from 'vue'
import type { ImageRef } from '@/composables/canvasImageRefs'

export interface CanvasExecutorApi {
  running: Ref<boolean>
  runningNodeId: Ref<string | null>
  runNode: (nodeId: string) => Promise<boolean>
  runSubtree: (targetId: string) => Promise<void>
  runAll: () => Promise<void>
  attachTask: (nodeId: string) => Promise<boolean>
  /** 该节点当前会送出去的图，按最终顺序。缩略图条和 @ 候选都读它 */
  collectImageRefs: (nodeId: string) => ImageRef[]
  resumeIncompleteTasks: () => void
}

export const CANVAS_EXECUTOR_KEY: InjectionKey<CanvasExecutorApi> = Symbol('canvas-executor')
