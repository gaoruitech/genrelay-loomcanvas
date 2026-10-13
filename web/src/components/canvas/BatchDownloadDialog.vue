<template>
  <div v-if="open" class="lc-mask lc-sheet bd-mask" @click.self="close">
    <div v-dialog="close" class="lc-dialog bd-modal" role="dialog" aria-modal="true" :aria-label="t('dialogs.download.title')">
      <div class="lc-dialog-head">
        <span class="bd-title">{{ t('dialogs.download.title') }}<span class="bd-count">{{ t('dialogs.download.selected', { n: selected.size, total: items.length }) }}</span></span>
        <button class="lc-x" :aria-label="t('common.close')" @click="close">×</button>
      </div>

      <div v-if="items.length" class="bd-filters">
        <div class="lc-seg">
          <button
            v-for="f in filters"
            :key="f.value"
            :class="{ on: filter === f.value }"
            @click="filter = f.value"
          >{{ f.label }} <span class="lc-mono">{{ countOf(f.value) }}</span></button>
        </div>
      </div>

      <div class="bd-body">
        <div v-if="!items.length" class="bd-empty">{{ t('dialogs.download.empty') }}</div>
        <div v-else-if="!visible.length" class="bd-empty">{{ t('dialogs.download.emptyFilter') }}</div>
        <div v-else class="bd-grid">
          <button
            v-for="it in visible"
            :key="it.url"
            class="bd-thumb"
            :class="{ sel: selected.has(it.url) }"
            :aria-pressed="selected.has(it.url)"
            @click="toggle(it.url)"
          >
            <img v-if="thumbOf(it)" :src="thumbOf(it)" alt="" loading="lazy" />
            <!-- 视频没有登记过封面：让浏览器只取元数据，自己显示首帧 -->
            <video v-else :src="$src(it.url)" muted playsinline preload="metadata" />
            <span class="lc-cb bd-ck" :class="{ on: selected.has(it.url) }" />
            <span class="lc-bd bd-kind" :class="it.kind === 'video' ? 'vid' : 'img'">{{ it.kind === 'video' ? t('nodes.title.video') : t('nodes.title.image') }}</span>
            <span class="bd-cap">{{ it.label }}</span>
          </button>
        </div>
      </div>

      <div class="lc-dialog-foot bd-foot">
        <span class="bd-info">
          <template v-if="overLimit">{{ t('dialogs.download.overLimit', { max: MAX_ZIP_ITEMS }) }}</template>
          <template v-else-if="selected.size">
            {{ t('dialogs.download.zipAs') }} <b>{{ zipName }}.zip</b>
          </template>
          <template v-else>{{ t('download.selectFirst') }}</template>
        </span>
        <span class="bd-spacer" />
        <button class="lc-btn" :disabled="!visible.length" @click="selectAllVisible">{{ t('dialogs.download.selectAll') }}</button>
        <button class="lc-btn" :disabled="!selected.size" @click="clearAll">{{ t('common.clear') }}</button>
        <button
          class="lc-btn primary quiet"
          :disabled="!selected.size || overLimit || downloading"
          @click="download"
        >{{ downloading ? t('dialogs.download.zipping') : t('dialogs.download.downloadZip', { n: selected.size }) }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { vDialog } from '@/directives/dialog'
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { collectCanvasMedia, canvasImageThumb, canvasVideoPoster, type CanvasMediaItem } from '@/utils/canvasMedia'
import { downloadCanvasBatch } from '@/utils/canvasDownload'

/** 与后端 MAX_ZIP_ITEMS 保持一致 */
const MAX_ZIP_ITEMS = 100

const { t } = useI18n()

type FilterKey = 'all' | 'image' | 'video' | 'output'
const filters = computed<{ value: FilterKey; label: string }[]>(() => [
  { value: 'all', label: t('common.all') },
  { value: 'image', label: t('nodes.title.image') },
  { value: 'video', label: t('nodes.title.video') },
  { value: 'output', label: t('dialogs.download.outputOnly') },
])

const props = defineProps<{
  open: boolean
  nodes: any[]
  /** 用来判断哪些节点直接连进了成品节点（「仅成品」筛选） */
  edges?: any[]
  workflowId: string
  workflowName: string
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const items = ref<CanvasMediaItem[]>([])
const selected = ref<Set<string>>(new Set())
const filter = ref<FilterKey>('all')
const downloading = ref(false)

const zipName = computed(() => (props.workflowName || '').trim() || t('dialogs.download.untitled'))
const overLimit = computed(() => selected.value.size > MAX_ZIP_ITEMS)

function matches(it: CanvasMediaItem, f: FilterKey): boolean {
  if (f === 'all') return true
  if (f === 'output') return it.isOutput
  return it.kind === f
}
const visible = computed(() => items.value.filter((it) => matches(it, filter.value)))
function countOf(f: FilterKey): number {
  return items.value.filter((it) => matches(it, f)).length
}

function thumbOf(it: CanvasMediaItem): string {
  return it.kind === 'image' ? canvasImageThumb(it.url, 150) : canvasVideoPoster(it.url, 300)
}

// 每次打开都按当前画布重新扫一遍：节点可能刚跑出新结果
watch(() => props.open, (open) => {
  if (!open) return
  items.value = collectCanvasMedia(props.nodes, props.edges)
  // 默认全选，但不超过上限 —— 一进来就是红字提示很劝退
  selected.value = new Set(items.value.slice(0, MAX_ZIP_ITEMS).map((it) => it.url))
  filter.value = 'all'
}, { immediate: true })

function toggle(url: string) {
  const next = new Set(selected.value)
  if (next.has(url)) next.delete(url)
  else next.add(url)
  selected.value = next
}
function selectAllVisible() {
  const next = new Set(selected.value)
  for (const it of visible.value) next.add(it.url)
  selected.value = next
}
function clearAll() {
  selected.value = new Set()
}
function close() {
  if (downloading.value) return
  emit('close')
}

async function download() {
  if (!selected.value.size || overLimit.value) return
  downloading.value = true
  try {
    // 按清单顺序传，跟 zip 里的序号对得上
    const urls = items.value.filter((it) => selected.value.has(it.url)).map((it) => it.url)
    const ok = await downloadCanvasBatch(props.workflowId, urls, zipName.value)
    if (ok) emit('close')
  } finally {
    downloading.value = false
  }
}
</script>

<style scoped>
.bd-mask { z-index: 3100; }
.bd-modal { width: min(860px, 100%); max-height: min(calc(80 * var(--lc-vh)), 720px); }
.bd-title { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.bd-count { font: 400 12px var(--f-mono); color: var(--text-3); white-space: nowrap; }
.bd-filters { flex: none; padding: 12px 20px 0; }

.bd-body { flex: 1; overflow-y: auto; min-height: 160px; }
.bd-empty { padding: 48px 24px; text-align: center; color: var(--text-3); font-size: 13px; }
.bd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
  gap: 10px;
  padding: 16px 20px;
}
.bd-thumb {
  position: relative;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: var(--media-bg);
  padding: 0;
  cursor: pointer;
  transition: border-color .14s ease, box-shadow .14s ease;
}
.bd-thumb:hover { border-color: var(--line-3); }
.bd-thumb.sel { border-color: rgb(var(--c-cyan) / .7); box-shadow: var(--glow-s); }
.bd-thumb:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
.bd-thumb img,
.bd-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
/* 视频只当封面用，点击要落到外层按钮上 */
.bd-thumb video { pointer-events: none; }
.bd-ck { position: absolute; top: 8px; left: 8px; width: 18px; height: 18px; background: rgb(var(--c-scrim) / .6); }
.bd-kind { position: absolute; top: 7px; right: 7px; height: 20px; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.bd-kind.img { background: var(--kind-image-scrim); }
.bd-kind.vid { background: var(--kind-video-scrim); }
/* 图注压在画面上：底是恒暗渐变，字固定用浅色 */
.bd-cap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 16px 8px 6px;
  font-size: 11px;
  text-align: left;
  color: var(--on-scrim);
  background: linear-gradient(transparent, rgb(var(--c-scrim) / .85));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bd-foot { align-items: center; flex-wrap: wrap; }
.bd-info { font-size: 13px; color: var(--text-3); min-width: 0; }
.bd-info b { color: var(--text-2); font-weight: 500; font-family: var(--f-mono); font-size: 12px; word-break: break-all; }
.bd-spacer { flex: 1; min-width: 8px; }
@media (max-width: 600px) {
  .bd-modal { max-height: calc(92 * var(--lc-vh)); max-height: calc(92 * var(--lc-dvh)); }
  .bd-filters { padding: 12px 16px 0; }
  .bd-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 12px 16px; }
  .bd-foot { padding: 12px 16px; }
  .bd-info { flex-basis: 100%; }
  .bd-spacer { display: none; }
  .bd-foot .lc-btn { flex: 1; padding: 0 10px; }
  .bd-foot .lc-btn.primary { flex-basis: 100%; }
}
</style>
