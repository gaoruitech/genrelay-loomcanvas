<template>
  <div v-if="open" class="bd-mask" @click.self="close">
    <div class="bd-modal">
      <div class="bd-head">
        <span class="bd-title">{{ t('dialogs.download.title') }}</span>
        <span class="bd-count">{{ t('dialogs.download.selected', { n: selected.size, total: items.length }) }}</span>
        <button class="bd-close" :title="t('common.close')" @click="close">×</button>
      </div>

      <div v-if="items.length" class="bd-filters">
        <button
          v-for="f in filters"
          :key="f.value"
          class="bd-chip"
          :class="{ on: filter === f.value }"
          @click="filter = f.value"
        >{{ f.label }} {{ countOf(f.value) }}</button>
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
            <video v-else :src="it.url" muted playsinline preload="metadata" />
            <span class="bd-ck">
              <svg v-if="selected.has(it.url)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span class="bd-kind">{{ it.kind === 'video' ? t('nodes.title.video') : t('nodes.title.image') }}</span>
            <span class="bd-cap">{{ it.label }}</span>
          </button>
        </div>
      </div>

      <div class="bd-foot">
        <span class="bd-info">
          <template v-if="overLimit">{{ t('dialogs.download.overLimit', { max: MAX_ZIP_ITEMS }) }}</template>
          <template v-else-if="selected.size">
            {{ t('dialogs.download.zipAs') }} <b>{{ zipName }}.zip</b>
          </template>
          <template v-else>{{ t('download.selectFirst') }}</template>
        </span>
        <span class="bd-spacer" />
        <button class="bd-btn" :disabled="!visible.length" @click="selectAllVisible">{{ t('dialogs.download.selectAll') }}</button>
        <button class="bd-btn" :disabled="!selected.size" @click="clearAll">{{ t('common.clear') }}</button>
        <button
          class="bd-btn primary"
          :disabled="!selected.size || overLimit || downloading"
          @click="download"
        >{{ downloading ? t('dialogs.download.zipping') : t('dialogs.download.downloadZip', { n: selected.size }) }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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
  items.value = collectCanvasMedia(props.nodes)
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
.bd-mask {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: var(--scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.bd-modal {
  width: min(860px, 100%);
  max-height: min(78vh, 720px);
  display: flex;
  flex-direction: column;
  background: var(--n-2);
  border: 1px solid var(--n-5);
  border-radius: 14px;
  box-shadow: 0 18px 44px var(--shadow-3);
  overflow: hidden;
}
.bd-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--n-5);
}
.bd-title { font-size: 15px; font-weight: 600; color: var(--t-body); }
.bd-count { font-size: 12px; color: var(--t-dim); font-variant-numeric: tabular-nums; }
.bd-close {
  margin-left: auto;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--t-dim);
  font-size: 19px;
  line-height: 1;
  cursor: pointer;
}
.bd-close:hover { background: var(--n-4); color: var(--t-body); }

.bd-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--n-5);
}
.bd-chip {
  font-size: 12px;
  padding: 4px 11px;
  border-radius: 999px;
  border: 1px solid var(--n-5);
  background: var(--n-3);
  color: var(--t-dim);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.bd-chip:hover { color: var(--t-body); }
.bd-chip.on {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
}

.bd-body { flex: 1; overflow-y: auto; min-height: 160px; }
.bd-empty {
  padding: 48px 24px;
  text-align: center;
  color: var(--t-dim);
  font-size: 13px;
}
.bd-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  padding: 16px;
}
.bd-thumb {
  position: relative;
  aspect-ratio: 1;
  border-radius: 9px;
  overflow: hidden;
  border: 1px solid var(--n-5);
  background: var(--media-bg);
  padding: 0;
  cursor: pointer;
  transition: border-color 0.14s ease, box-shadow 0.14s ease;
}
.bd-thumb:hover { border-color: var(--n-7); }
.bd-thumb.sel {
  border-color: var(--accent);
  box-shadow: 0 0 0 1.5px var(--accent);
}
.bd-thumb:focus-visible { outline: 2px solid var(--accent-text); outline-offset: 2px; }
.bd-thumb img,
.bd-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
/* 视频只当封面用，点击要落到外层按钮上 */
.bd-thumb video { pointer-events: none; }
.bd-ck {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1.5px solid var(--on-scrim-dim);
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}
.bd-thumb.sel .bd-ck {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
}
.bd-ck svg { width: 11px; height: 11px; }
.bd-kind {
  position: absolute;
  top: 6px;
  right: 6px;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: var(--on-scrim);
}
.bd-cap {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 14px 8px 6px;
  font-size: 11px;
  text-align: left;
  color: var(--on-scrim);
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.78));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bd-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-top: 1px solid var(--n-5);
  background: var(--n-1);
}
.bd-info { font-size: 12.5px; color: var(--t-dim); }
.bd-info b { color: var(--t-body); font-weight: 500; }
.bd-spacer { flex: 1; min-width: 8px; }
.bd-btn {
  font-size: 13px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--n-5);
  background: var(--n-3);
  color: var(--t-body);
  cursor: pointer;
}
.bd-btn:hover:not(:disabled) { border-color: var(--n-7); }
.bd-btn:disabled { opacity: 0.45; cursor: default; }
.bd-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
}
.bd-btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
</style>
