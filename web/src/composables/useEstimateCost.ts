import { watch, type ComputedRef } from 'vue'
import { runsApi, type EstimateRequest } from '@/utils/api'
import type { Cost } from '@/types'

/**
 * 监听参数变化，debounced 调用 POST /api/runs/estimate，
 * 通过 onCost 回调把最新预估成本写回节点；参数不全时回调 null。
 *
 * 模型没配价格时后端返回 unknown=true，节点据此显示「成本未知」而不是 0。
 */
export function useEstimateCost(
  params: ComputedRef<EstimateRequest | null>,
  onCost: (cost: Cost | null) => void,
  enabled?: ComputedRef<boolean>
) {
  let timer: number | null = null
  let seq = 0
  // vue-flow 的 updateNodeData 每次都会替换 node.data 引用 —
  // 即便没有改 model 等字段，params 这个 computed 也会返回一个新对象，
  // 触发 deep watch。这里按值序列化去重，杜绝无意义的二次请求。
  let lastKey: string | null = null

  async function doFetch() {
    timer = null
    if ((enabled && !enabled.value) || !params.value) {
      if (lastKey !== null) onCost(null)
      lastKey = null
      return
    }
    const key = JSON.stringify(params.value)
    if (key === lastKey) return
    lastKey = key
    const my = ++seq
    try {
      const res = await runsApi.estimate(params.value)
      if (my !== seq) return
      if (res.data.result === 0 && res.data.data) {
        const d = res.data.data
        onCost({ amount: Number(d.totalCost) || 0, currency: d.currency || '', unknown: !!d.unknown })
      }
    } catch {
      // 估算失败静默，不影响主流程
      lastKey = null
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = window.setTimeout(doFetch, 400)
  }

  watch(params, schedule, { immediate: true, deep: true })
  if (enabled) watch(enabled, schedule)
}
