<template>
  <div class="cv-node output-node" :class="{ selected, 'is-running': branchRunning }">
    <div class="cv-head">
      <LcIcon name="check" />
      <span class="cv-title">{{ t('nodes.title.output') }}</span>
      <span v-if="status === 'stale'" class="cv-tag stale">{{ t('nodes.status.stale') }}</span>
      <span v-else-if="status === 'running'" class="cv-tag running">{{ t('nodes.status.running') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
      <span v-else-if="outputItems.length" class="cv-head-x">{{ outputItems.length }}</span>
    </div>

    <div class="cv-body">
      <div class="cv-in">
        <Handle id="image-in" type="target" :position="Position.Left" class="h-image" />
        {{ t('nodes.title.image') }}<em :class="{ on: inCount('image-in') > 0 }">{{ inCount('image-in') ? t('gen.node.connected', { n: inCount('image-in') }) : t('gen.node.notConnected') }}</em>
      </div>
      <div class="cv-in">
        <Handle id="video-in" type="target" :position="Position.Left" class="h-video" />
        {{ t('nodes.title.video') }}<em :class="{ on: inCount('video-in') > 0 }">{{ inCount('video-in') ? t('gen.node.connected', { n: inCount('video-in') }) : t('gen.node.notConnected') }}</em>
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
      <span class="cv-empty-icon"><LcIcon name="image" /></span>
      <span>{{ hasUpstream ? t('nodeui.output.waiting') : t('nodeui.output.connect') }}</span>
    </div>

      <!-- 链路成本固定在运行按钮正上方 -->
      <div v-if="costBreakdown.total" class="cv-kv">
        <span>{{ costBreakdown.actual ? t('nodeui.output.chainCost') : t('cost.estimate') }}</span>
        <span v-if="costBreakdown.total.unknown" class="cv-unk">{{ costBreakdown.estimated ? formatEstimate(costBreakdown.total) : formatCost(costBreakdown.total) }}</span>
        <b v-else>{{ costBreakdown.estimated ? formatEstimate(costBreakdown.total) : formatCost(costBreakdown.total) }}</b>
      </div>
      <div v-if="costBreakdown.actual && costBreakdown.estimated" class="cv-hint cv-cost-sub">
        {{ t('nodeui.output.breakdown', { actual: formatCost(costBreakdown.actual), estimated: formatEstimate(costBreakdown.estimated) }) }}
      </div>

      <button
        class="cv-run nodrag"
        :disabled="branchRunning"
        @click.stop="handleRun"
        @mousedown.stop
      >
        <LcIcon name="play" size="s" />
        <span>{{ branchRunning ? t('nodeui.output.branchRunning') : t('nodeui.output.runBranch') }}</span>
      </button>
    </div>

    <!-- 查看更多：素材库式网格弹窗 -->
    <Teleport to="body">
      <div v-if="galleryOpen" class="lc-mask lc-sheet cv-gal-mask" @click.self="galleryOpen = false" @mousedown.self.stop @wheel.stop>
        <div class="lc-dialog cv-gal-box">
          <div class="lc-dialog-head">
            <span>{{ t('nodeui.output.galleryTitle', { n: outputItems.length }) }}</span>
            <button class="lc-x" :title="t('common.close')" @click="galleryOpen = false">×</button>
          </div>
          <div class="lc-dialog-body cv-gal-grid">
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
import LcIcon from '@/components/LcIcon.vue'
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
// 表头下方两个输入口各接了几根线
const inCount = (handle: string) => edges.value.filter(e => e.target === props.id && e.targetHandle === handle).length
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
.output-node { width: 280px; min-height: 300px; }
.cv-grid-wrap, .cv-output-slot { flex: 1 1 auto; min-height: 0; }

/* 成品九宫格 */
.cv-grid-wrap { display: grid; gap: 4px; width: 100%; align-content: start; }
.cv-grid-cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--media-bg);
  border: 1px solid var(--line);
  cursor: pointer;
  transition: border-color .15s ease;
}
.cv-grid-cell:hover { border-color: var(--line-3); }
.cv-grid-cell img,
.cv-grid-cell video { display: block; width: 100%; height: 100%; object-fit: cover; }
/* 压在画面上的件：底是恒暗遮罩，字固定用浅色 */
.cv-cell-play {
  position: absolute;
  inset: 0;
  margin: auto;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, .35);
  background: rgba(4, 9, 28, .6);
  color: var(--on-scrim);
  pointer-events: none;
}
.cv-cell-play svg { width: 11px; height: 11px; margin-left: 1px; }
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
.cv-cell-more-n { font: 600 18px var(--f-disp); }
.cv-cell-more-t { font-size: 11px; color: var(--on-scrim-dim); }

/* 空态槽 */
.cv-output-slot.empty {
  min-height: 120px;
  border-radius: 9px;
  border: 1px dashed var(--line-2);
  background: rgba(4, 9, 28, .3);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  color: var(--text-3);
  font-size: 12px;
  text-align: center;
  user-select: none;
}
.cv-cost-sub { text-align: right; margin-top: -6px; }

/* 查看更多：通用弹窗外壳 + 缩略图网格 */
.cv-gal-mask { z-index: 9500; }
.cv-gal-box { width: min(900px, 100%); }
.cv-gal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.cv-gal-item {
  position: relative;
  aspect-ratio: 1;
  border-radius: 10px;
  overflow: hidden;
  background: var(--media-bg);
  border: 1px solid var(--line);
  cursor: pointer;
  transition: border-color .15s ease;
}
.cv-gal-item:hover { border-color: var(--cyan); }
.cv-gal-item img,
.cv-gal-item video { width: 100%; height: 100%; object-fit: cover; display: block; }
@media (max-width: 600px) {
  .cv-gal-grid { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
}
</style>
