import type { InjectionKey, Ref } from 'vue'
import type { ImageRef } from '@/composables/canvasImageRefs'
import type { RunOptions } from '@/composables/useCanvasExecutor'

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
  resumeIncompleteTasks: () => void
}

export const CANVAS_EXECUTOR_KEY: InjectionKey<CanvasExecutorApi> = Symbol('canvas-executor')
