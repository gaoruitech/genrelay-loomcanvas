<template>
  <div v-if="list.length > 1" class="rh" @click.stop @mousedown.stop @wheel.stop>
    <div class="rh-head">
      <span class="rh-title">{{ t('gen.history.title') }}</span>
      <span class="rh-hint">{{ t('gen.history.hint', { n: list.length }) }}</span>
    </div>
    <div class="rh-strip">
      <button
        v-for="(r, i) in list"
        :key="r.id || i"
        class="rh-item nodrag"
        :class="{ active: i === current }"
        :title="itemTitle(r, i)"
        @click.stop="select(i)"
        @mousedown.stop
      >
        <img v-if="kind === 'image' && firstUrl(r)" :src="canvasImageThumb(firstUrl(r), 96)" alt="" />
        <img v-else-if="canvasVideoPoster(firstUrl(r), 96)" :src="canvasVideoPoster(firstUrl(r), 96)" alt="" />
        <span v-else class="rh-film">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <line x1="8" y1="4" x2="8" y2="20" />
            <line x1="16" y1="4" x2="16" y2="20" />
          </svg>
        </span>
        <span class="rh-badge">{{ i === 0 ? t('gen.history.latest') : 'v' + (list.length - i) }}</span>
        <span v-if="(r.urls || []).length > 1" class="rh-count">{{ (r.urls || []).length }}</span>
      </button>
    </div>
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
import { canvasImageThumb, canvasVideoPoster } from '@/utils/canvasMedia'
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
.rh { margin-top: 8px; }

.rh-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 5px;
}
.rh-title { font-size: 11px; color: var(--t-body); }
.rh-hint { font-size: 10px; color: var(--t-dim); }

.rh-strip {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 3px;
}
/* 细滚动条：这条常常有七八版，默认滚动条会把条目挤矮 */
.rh-strip::-webkit-scrollbar { height: 4px; }
.rh-strip::-webkit-scrollbar-thumb { background: var(--n-5); border-radius: 2px; }

.rh-item {
  position: relative;
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 1.5px solid var(--n-5);
  border-radius: 6px;
  background: var(--n-3);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.rh-item:hover { border-color: var(--accent-text); }
.rh-item.active { border-color: var(--accent-text); }
.rh-item img { width: 100%; height: 100%; object-fit: cover; display: block; }

.rh-film {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--t-dim);
}
.rh-film svg { width: 20px; height: 20px; }

/* 版本号压在左下角，盖一层渐变免得压在亮图上看不清 */
.rh-badge {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 1px 0 2px;
  font-size: 9px;
  line-height: 1.2;
  text-align: center;
  color: #fff;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0));
}

/* 这一版有几张 */
.rh-count {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 13px;
  height: 13px;
  padding: 0 3px;
  border-radius: 7px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font-size: 9px;
  line-height: 13px;
  text-align: center;
}
</style>
