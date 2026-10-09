<template>
  <div class="cv-node output-node cv-surface" :class="{ selected }">
    <div class="cv-node-header">
      <span v-if="status === 'stale'" class="cv-tag stale">{{ t('nodes.status.stale') }}</span>
      <span v-else-if="status === 'running'" class="cv-tag running">{{ t('nodes.status.running') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
    </div>

    <!-- 成品九宫格 -->
    <div
      v-if="outputItems.length"
      class="cv-grid-wrap nodrag"
      :style="{ gridTemplateColumns: `repeat(${cols}, 1fr)` }"
      @mousedown.stop
    >
      <div
        v-for="(it, i) in visibleItems"
        :key="it.url + i"
        class="cv-grid-cell"
        @click.stop="onCellClick(it, i)"
      >
        <img v-if="it.type === 'image'" :src="canvasImageThumb(it.url, 160)" alt="" />
        <template v-else>
          <img v-if="canvasVideoPoster(it.url, 240)" :src="canvasVideoPoster(it.url, 240)" alt="" />
          <video v-else :src="it.url" muted preload="metadata" />
          <span class="cv-cell-play">
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>
          </span>
        </template>
        <div v-if="isOverflow && i === MAX - 1" class="cv-cell-more">
          <span class="cv-cell-more-n">+{{ overflowCount }}</span>
          <span class="cv-cell-more-t">{{ t('nodeui.output.more') }}</span>
        </div>
      </div>
    </div>
    <div v-else class="cv-output-slot empty">
      <span class="cv-empty-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      </span>
      <span>{{ hasUpstream ? t('nodeui.output.waiting') : t('nodeui.output.connect') }}</span>
    </div>

    <button
      class="cv-run-active nodrag"
      :disabled="branchRunning"
      @click.stop="handleRun"
      @mousedown.stop
    >
      <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>
      <span>{{ branchRunning ? t('nodeui.output.branchRunning') : t('nodeui.output.runBranch') }}</span>
    </button>

    <div v-if="costBreakdown.total" class="cv-total-cost" :class="{ estimate: !costBreakdown.actual }">
      <span class="cv-total-cost-label">
        {{ costBreakdown.actual ? t('nodeui.output.chainCost') : t('cost.estimate') }}
      </span>
      <span class="cv-total-cost-value">
        {{ costBreakdown.estimated ? formatEstimate(costBreakdown.total) : formatCost(costBreakdown.total) }}
      </span>
    </div>
    <div v-if="costBreakdown.actual && costBreakdown.estimated" class="cv-total-cost-sub">
      {{ t('nodeui.output.breakdown', { actual: formatCost(costBreakdown.actual), estimated: formatEstimate(costBreakdown.estimated) }) }}
    </div>

    <Handle id="image-in" type="target" :position="Position.Left" class="h-image" :style="{ top: '38%' }" />
    <Handle id="video-in" type="target" :position="Position.Left" class="h-video" :style="{ top: '50%' }" />

    <!-- 查看更多：素材库式网格弹窗 -->
    <Teleport to="body">
      <div v-if="galleryOpen" class="cv-gal-mask" @click.self="galleryOpen = false" @mousedown.self.stop @wheel.stop>
        <div class="cv-gal-box">
          <div class="cv-gal-head">
            <span>{{ t('nodeui.output.galleryTitle', { n: outputItems.length }) }}</span>
            <button class="cv-gal-close" :title="t('common.close')" @click="galleryOpen = false">×</button>
          </div>
          <div class="cv-gal-grid">
            <div
              v-for="(it, i) in outputItems"
              :key="it.url + i"
              class="cv-gal-item"
              @click="openLightbox(it)"
            >
              <img v-if="it.type === 'image'" :src="canvasImageThumb(it.url, 240)" alt="" loading="lazy" />
              <template v-else>
                <img v-if="canvasVideoPoster(it.url, 320)" :src="canvasVideoPoster(it.url, 320)" alt="" loading="lazy" />
                <video v-else :src="it.url" muted preload="metadata" />
                <span class="cv-cell-play">
                  <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>
                </span>
              </template>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <MediaLightbox
      :open="!!lightbox"
      :url="lightbox?.url || ''"
      :type="lightbox?.type || 'image'"
      @close="lightbox = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import MediaLightbox from './MediaLightbox.vue'
import { canvasImageThumb, canvasVideoPoster } from '@/utils/canvasMedia'
import { formatCost, formatEstimate, sumCosts } from '@/utils/cost'
import type { Cost } from '@/types'

interface OutItem { url: string; type: 'image' | 'video' }

const props = defineProps<{
  id: string
  data: { imageUrl?: string; videoUrl?: string; status?: string }
  selected?: boolean
}>()

const { t } = useI18n()
const executor = inject(CANVAS_EXECUTOR_KEY)
const { nodes, edges } = useVueFlow()

const status = computed(() => props.data.status || 'idle')
const MAX = 9

// 出一组图的节点：生成类（数量 > 1）、切片、多平台导出；其余工具节点只出一张
const MULTI_IMAGE_TYPES = ['image-gen', 'image-edit', 'slice', 'platform-export']
const SINGLE_IMAGE_TYPES = ['collage', 'watermark', 'fit-size']

// 沿上游 image 边递归收集「全部」图片（图片 / 图片集合 / 生成类 / 工具节点），
// 口径与执行器的 getImageOutputs 一致：下游能拿到什么，这里就显示什么
function collectImages(startId: string, visited: Set<string>): string[] {
  if (visited.has(startId)) return []
  visited.add(startId)
  const n = nodes.value.find((x) => x.id === startId)
  if (!n) return []
  const d = n.data || {}
  if (n.type === 'image') return d.imageUrl ? [d.imageUrl] : []
  if (MULTI_IMAGE_TYPES.includes(n.type as string)) {
    if (Array.isArray(d.imageUrls) && d.imageUrls.length) return d.imageUrls
    return d.imageUrl ? [d.imageUrl] : []
  }
  if (SINGLE_IMAGE_TYPES.includes(n.type as string)) return d.imageUrl ? [d.imageUrl] : []
  if (n.type === 'image-collection') {
    const res: string[] = Array.isArray(d.imageUrls) ? [...d.imageUrls] : []
    for (const e of edges.value.filter(
      (e) => e.target === startId && String(e.sourceHandle || '').startsWith('image-')
    )) {
      res.push(...collectImages(e.source, visited))
    }
    return res
  }
  return []
}

function collectVideos(startId: string, visited: Set<string>): string[] {
  if (visited.has(startId)) return []
  visited.add(startId)
  const n = nodes.value.find((x) => x.id === startId)
  if (!n) return []
  const d = n.data || {}
  if (n.type === 'video-gen' || n.type === 'video-edit') {
    if (Array.isArray(d.videoUrls) && d.videoUrls.length) return d.videoUrls
    return d.videoUrl ? [d.videoUrl] : []
  }
  if (n.type === 'video') return d.videoUrl ? [d.videoUrl] : []
  return []
}

// 把连入的全部上游成品平铺；无上游时回落到自身持久化的 url（DB 恢复兜底）
const outputItems = computed<OutItem[]>(() => {
  const imgs: string[] = []
  for (const e of edges.value.filter((e) => e.target === props.id && e.targetHandle === 'image-in')) {
    imgs.push(...collectImages(e.source, new Set()))
  }
  const vids: string[] = []
  for (const e of edges.value.filter((e) => e.target === props.id && e.targetHandle === 'video-in')) {
    vids.push(...collectVideos(e.source, new Set()))
  }
  if (!imgs.length && props.data.imageUrl) imgs.push(props.data.imageUrl)
  if (!vids.length && props.data.videoUrl) vids.push(props.data.videoUrl)

  const seen = new Set<string>()
  const items: OutItem[] = []
  for (const u of imgs) if (u && !seen.has(u)) { seen.add(u); items.push({ url: u, type: 'image' }) }
  for (const u of vids) if (u && !seen.has(u)) { seen.add(u); items.push({ url: u, type: 'video' }) }
  return items
})

const isOverflow = computed(() => outputItems.value.length > MAX)
const visibleItems = computed(() => outputItems.value.slice(0, MAX))
const overflowCount = computed(() => outputItems.value.length - MAX)

// 智能列数：1→1，2→2，4→2(2x2)，3 与 5~9→3 列
const cols = computed(() => {
  const n = visibleItems.value.length
  if (n <= 1) return 1
  if (n === 2) return 2
  if (n === 4) return 2
  return 3
})

const hasUpstream = computed(() => edges.value.some((e) => e.target === props.id))

// 本分支是否正在运行：沿上游找任一会「运行」的节点处于 running/queued 即为「运行中」。
// 只禁用本分支的按钮，不再全局禁用 —— 这样多条分支可以同时点、同时跑。
const BRANCH_RUN_TYPES = [
  'image-gen', 'image-edit', 'video-gen', 'video-edit', 'video-analysis', 'llm',
  ...MULTI_IMAGE_TYPES, ...SINGLE_IMAGE_TYPES,
]
const branchRunning = computed(() => {
  const visited = new Set<string>()
  let active = false
  function dfs(id: string) {
    if (active || visited.has(id)) return
    visited.add(id)
    const n = nodes.value.find((x) => x.id === id)
    if (n && BRANCH_RUN_TYPES.includes(n.type as string)) {
      const s = n.data?.status
      if (s === 'running' || s === 'queued') { active = true; return }
    }
    for (const e of edges.value.filter((e) => e.target === id)) dfs(e.source)
  }
  for (const e of edges.value.filter((e) => e.target === props.id)) dfs(e.source)
  return active
})

// 查看大图 / 查看更多
const lightbox = ref<OutItem | null>(null)
const galleryOpen = ref(false)
function openLightbox(it: OutItem) { lightbox.value = it }
function onCellClick(it: OutItem, i: number) {
  if (isOverflow.value && i === MAX - 1) { galleryOpen.value = true; return }
  openLightbox(it)
}

function asCost(v: unknown): Cost | null {
  return v && typeof v === 'object' ? (v as Cost) : null
}

// 上游节点成本：已跑的用实际成本 data.cost，没跑的用预估 data.estimatedCost。
// 金额为 0 且已知的（本机处理的工具节点）不计入，免得整条链路只显示一个 ¥0.00。
const costBreakdown = computed(() => {
  const visited = new Set<string>()
  const actual: Cost[] = []
  const estimated: Cost[] = []
  const worth = (c: Cost | null): c is Cost => !!c && (c.unknown || Number(c.amount) > 0)
  function dfs(id: string) {
    if (visited.has(id)) return
    visited.add(id)
    const n = nodes.value.find((x) => x.id === id)
    if (!n) return
    const used = asCost(n.data?.cost)
    if (used) {
      if (worth(used)) actual.push(used)
    } else {
      const est = asCost(n.data?.estimatedCost)
      if (worth(est)) estimated.push(est)
    }
    for (const e of edges.value.filter((e) => e.target === id)) dfs(e.source)
  }
  for (const e of edges.value.filter((e) => e.target === props.id)) dfs(e.source)
  return {
    actual: sumCosts(actual),
    estimated: sumCosts(estimated),
    total: sumCosts([...actual, ...estimated]),
  }
})

async function handleRun() {
  if (!executor) return
  await executor.runSubtree(props.id)
}
</script>

<style scoped>
@import './node-shared.css';
.output-node { min-width: 280px; max-width: 280px; min-height: 300px; }
.cv-grid-wrap, .cv-output-slot { flex: 1 1 auto; min-height: 0; }

/* 成品九宫格 */
.cv-grid-wrap {
  display: grid;
  gap: 4px;
  width: 100%;
}
.cv-grid-cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  background: var(--n-0);
  border: 1px solid var(--n-4);
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.cv-grid-cell:hover { border-color: var(--n-7); }
.cv-grid-cell img,
.cv-grid-cell video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cv-cell-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--on-scrim);
  opacity: 0.85;
  background: var(--scrim-soft);
  pointer-events: none;
}
.cv-cell-play svg { width: 22px; height: 22px; }
.cv-cell-more {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: var(--scrim);
  color: var(--on-scrim);
}
.cv-cell-more-n { font-size: 18px; font-weight: 700; }
.cv-cell-more-t { font-size: 11px; opacity: 0.85; }

/* 空态槽 */
.cv-output-slot.empty {
  position: relative;
  width: 100%;
  min-height: 160px;
  border-radius: 8px;
  background: var(--n-2);
  border: 1px solid var(--n-4);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--t-dim);
  font-size: 12px;
  user-select: none;
}
.cv-output-slot.empty .cv-empty-icon { width: 38px; height: 38px; color: var(--n-8); }
.cv-output-slot.empty .cv-empty-icon svg { width: 100%; height: 100%; }

/* 链路成本 */
.cv-total-cost {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  font-size: 11px;
  color: var(--accent-text);
  padding: 6px 10px;
  background: var(--accent-ghost);
  border: 1px solid transparent;
  border-radius: 8px;
}
.cv-total-cost-label { color: var(--t-dim); }
.cv-total-cost-value { font-weight: 600; }
.cv-total-cost.estimate {
  color: var(--warning);
  background: rgba(255, 170, 0, 0.08);
  border-color: rgba(255, 170, 0, 0.25);
}
.cv-total-cost-sub {
  font-size: 10px;
  color: var(--t-dim);
  text-align: right;
  padding: 2px 4px 0;
}

/* 查看更多弹窗 */
.cv-gal-mask {
  position: fixed; inset: 0; z-index: 9500;
  background: var(--scrim);
  display: flex; align-items: center; justify-content: center;
  padding: 40px;
}
.cv-gal-box {
  width: min(900px, 100%);
  max-height: calc(100vh - 80px);
  background: var(--n-2);
  border: 1px solid var(--n-5);
  border-radius: 14px;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.cv-gal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--n-4);
  color: var(--t-strong); font-size: 14px;
}
.cv-gal-close {
  background: transparent; border: none; color: var(--t-dim);
  font-size: 24px; cursor: pointer; line-height: 1;
}
.cv-gal-close:hover { color: var(--t-max); }
.cv-gal-grid {
  padding: 16px 18px;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.cv-gal-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--n-0);
  border: 1px solid var(--n-4);
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease;
}
.cv-gal-item:hover { border-color: var(--accent-text); transform: translateY(-2px); }
.cv-gal-item img,
.cv-gal-item video { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
