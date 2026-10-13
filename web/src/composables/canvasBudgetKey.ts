import type { InjectionKey, Ref } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { TeamLimits } from '@/types'

/**
 * 团队每月上限在画布里的取用口。
 *
 * 与 CANVAS_EXECUTOR_KEY 同一个模式：画布取一次上限的答案（GET /api/teams/:id/limits），节点只消费 ——
 * 运行前的提醒、模型下拉里「不能运行」的标记、被拒绝之后的说明，读的都是这一份。
 * 「哪个模型因为没填价格跑不了」是服务端算好给的（cannotRun），这里和节点都不自己推。
 *
 * 个人空间、只读的分享页、嵌在别人页面里的编辑器没有这个 provide（或者 limits 是 null）：
 * 跟上限有关的东西自然都不出现。
 */
export interface CanvasBudgetApi {
  limits: Ref<TeamLimits | null>
  /** 看的人自己能不能改：团长能改上限；团长和管理员能填价格 */
  canSetLimits: Ref<boolean>
  canSetPrices: Ref<boolean>
  /** 去改的页面；没有这些页面时是 null */
  limitsTo: Ref<RouteLocationRaw | null>
  pricesTo: Ref<RouteLocationRaw | null>
  /** 重新取一次（被拒绝之后、有运行结束之后） */
  reload: () => void
}

export const CANVAS_BUDGET_KEY: InjectionKey<CanvasBudgetApi> = Symbol('canvas-budget')

/** 说明摆着的期间，隔多久重新取一次上限的答案 */
export const BUDGET_FRESH_MS = 30_000
/** 两次重新取之间至少隔这么久（回到标签页时 focus 和 visibilitychange 会前后脚一起来） */
const BUDGET_FRESH_GAP_MS = 2_000

const freshHolders = new WeakMap<CanvasBudgetApi, { n: number; stop: () => void }>()

/**
 * 有节点正摆着每月上限的说明（被拦下的那一句，或者运行前的提醒）时，上限的答案要跟得上：
 * 团长那边一提高上限、一填上价格，这里的说明就该撤掉，不该等到人再点一次运行或者刷新页面。
 * 画布自己只在运行开始 / 结束、被拒绝、打开队列时重新取；这里补两个时机 ——
 * 人回到这个标签页（或窗口）的那一刻，以及说明还摆着的期间每隔 BUDGET_FRESH_MS。标签页在后台时不取。
 *
 * 同一张画布上不管有多少个节点在摆说明，只有一份计时。返回「不用了」的函数（调几次都行）。
 */
export function holdBudgetFresh(api: CanvasBudgetApi): () => void {
  if (typeof window === 'undefined') return () => {}
  let h = freshHolders.get(api)
  if (!h) {
    let last = Date.now()
    const visible = () => document.visibilityState !== 'hidden'
    const reload = () => {
      const now = Date.now()
      if (!visible() || now - last < BUDGET_FRESH_GAP_MS) return
      last = now
      api.reload()
    }
    const timer = window.setInterval(reload, BUDGET_FRESH_MS)
    document.addEventListener('visibilitychange', reload)
    window.addEventListener('focus', reload)
    h = {
      n: 0,
      stop: () => {
        window.clearInterval(timer)
        document.removeEventListener('visibilitychange', reload)
        window.removeEventListener('focus', reload)
      },
    }
    freshHolders.set(api, h)
  }
  const held = h
  held.n++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--held.n <= 0) { held.stop(); freshHolders.delete(api) }
  }
}
