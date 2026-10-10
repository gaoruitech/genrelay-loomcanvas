<template>
  <div v-if="list.length > 1" class="rh nodrag nowheel" :title="t('gen.history.hint', { n: list.length })" @click.stop @mousedown.stop @wheel.stop>
    <button
      v-for="(r, i) in list"
      :key="r.id || i"
      class="rh-item"
      :class="{ active: i === current }"
      :title="itemTitle(r, i)"
      @click.stop="select(i)"
      @mousedown.stop
    >
      {{ t('gen.history.nthTitle', { n: list.length - i }) }}
      <span v-if="(r.urls || []).length > 1" class="rh-count">×{{ (r.urls || []).length }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 一个生成节点的历史版本条。
 *
 * 在这之前，重跑一次就把上一版直接覆盖了 —— 想对比两次出图只能手动复制节点，
 * 而复制出来的节点又不带上一版的产物，等于没法比。
 *
 * 只负责「切换当前展示的是哪一版」。历史由执行器在出图成功时写进
 * node.data.results（新的在最前），这里不产生也不删除数据。
 *
 * 一版可能有多张（节点的「数量」参数 > 1），所以每条存的是 urls 数组，
 * 切过去之后节点原有的那条「多图选择」条会接着显示这一版的全部张数。
 */
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { formatCost } from '@/utils/cost'
import type { Cost } from '@/types'

interface ResultEntry {
  id?: string
  at?: number
  urls?: string[]
  cost?: Cost | null
  model?: string
  prompt?: string
}

const { t } = useI18n()

const props = defineProps<{
  nodeId: string
  results?: ResultEntry[]
  resultIndex?: number
  kind: 'image' | 'video'
}>()

const { updateNodeData } = useVueFlow()

const list = computed<ResultEntry[]>(() => (Array.isArray(props.results) ? props.results : []))
const current = computed(() => {
  const i = Number(props.resultIndex)
  return Number.isFinite(i) && i >= 0 && i < list.value.length ? i : 0
})

function firstUrl(r: ResultEntry): string {
  return (r.urls && r.urls[0]) || ''
}

function itemTitle(r: ResultEntry, i: number): string {
  const parts: string[] = [i === 0 ? t('gen.history.latestTitle') : t('gen.history.nthTitle', { n: list.value.length - i })]
  if (r.at) {
    const d = new Date(r.at)
    const pad = (n: number) => String(n).padStart(2, '0')
    parts.push(`${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`)
  }
  const cost = formatCost(r.cost)
  if (cost) parts.push(cost)
  if (r.prompt) parts.push(r.prompt.slice(0, 40))
  return parts.join(' · ')
}

function select(i: number) {
  const r = list.value[i]
  const urls = (r?.urls || []).filter(Boolean)
  if (!urls.length) return
  const field = props.kind === 'image' ? 'imageUrl' : 'videoUrl'
  const arrField = props.kind === 'image' ? 'imageUrls' : 'videoUrls'
  updateNodeData(props.nodeId, {
    [field]: urls[0],
    [arrField]: urls,
    // 「实际成本」跟着切换走：这里问的是「这一版花了多少」，不是历次累计。
    // 显示累计反而会让人以为最后一次就这么贵。
    cost: r.cost ?? null,
    status: 'done',
    errorMsg: '',
    resultIndex: i,
  })
}
</script>

<style scoped>
/* 一排版本 chip：当前这一版实心蓝，其余描边；版本多了横向滚动 */
.rh { flex: none; display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
.rh::-webkit-scrollbar { height: 4px; }
.rh-item {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: none;
  box-shadow: 0 0 0 1px var(--line-2) inset;
  color: var(--text-2);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.rh-item:hover { box-shadow: 0 0 0 1px var(--line-3) inset; color: var(--text); }
.rh-item.active { background: rgba(59, 123, 255, .3); box-shadow: none; color: var(--text); }
.rh-count { font: 500 10.5px var(--f-mono); color: var(--text-3); }
.rh-item.active .rh-count { color: var(--text-2); }
</style>
