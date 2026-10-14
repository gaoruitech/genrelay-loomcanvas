import { ref, watch, type Ref } from 'vue'

/**
 * 触屏上的「多选」模式（只在主设备是手指时出现：鼠标有 Shift 框选、Ctrl 点选，键盘有 Ctrl+A）。
 *
 * 开着的时候点节点 = 把它加入 / 移出选择，不再打开输入条 / 属性面板。实现上就是一直按着 vue-flow 的多选键：
 * 它的点选逻辑（handleNodeClick）在多选键按下时本来就是「没选就加、选了就去掉」，选中两个及以上时多选工具条照常出现。
 *
 * 自己关掉的时机：点「完成」、按 Esc、选择被清空（点了画布空白处，或者一个个都去掉了）、不该有这个模式了（变成只读）。
 */
export function useTouchMultiSelect(o: {
  /** 眼下能不能用（主设备是手指、画布可编辑） */
  enabled: () => boolean
  /** 选中了几个节点 */
  count: () => number
  /** vue-flow 的 multiSelectionActive（多选键是否按着） */
  active: Ref<boolean>
}) {
  const on = ref(false)
  const toggle = () => { if (on.value || o.enabled()) on.value = !on.value }
  const done = () => { on.value = false }
  watch(on, (v) => { o.active.value = v })
  // vue-flow 在多选键（Ctrl / Cmd）松开时会把它写回 false：模式开着就再写回来
  watch(o.active, (v) => { if (on.value && !v) o.active.value = true })
  watch(o.count, (n, prev) => { if (on.value && n === 0 && prev > 0) on.value = false })
  watch(o.enabled, (v) => { if (!v) on.value = false })
  return { on, toggle, done }
}
