<template>
  <div class="cv-node cv-surface" :class="{ selected }">
    <Handle id="image-in" type="target" :position="Position.Left" class="h-image" :title="t('tools.input.many')" />

    <div class="cv-head">
      <span class="cv-title">{{ t('nodes.title.collage') }}</span>
      <span class="cv-help" :title="t('tools.collage.help')">?</span>
      <span v-if="status === 'running'" class="cv-tag running">{{ t('tools.collage.running') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
      <span v-else-if="resultUrl" class="cv-tag done">{{ outW }}×{{ outH }}</span>
      <span class="cv-free" :title="t('cost.free')">{{ t('cost.free') }}</span>
    </div>

    <div class="cv-body nodrag" @mousedown.stop @click.stop>
      <div class="cv-presets">
        <button
          v-for="p in COLLAGE_PRESETS" :key="p.key"
          class="cv-gbtn" :class="{ on: p.cols === cols && p.rows === rows }"
          @click="patch({ cols: p.cols, rows: p.rows })"
        >{{ p.label }}</button>
      </div>

      <div class="cv-row">
        <span class="cv-label">{{ t('tools.collage.cell') }}</span>
        <ChipSelect class="cv-chip" :model-value="ratio" :options="CELL_RATIO_OPTIONS" @update:model-value="(v) => patch({ ratio: String(v) })" />
      </div>

      <div class="cv-row">
        <span class="cv-label">{{ t('tools.collage.gap') }}</span>
        <input class="cv-range" type="range" min="0" max="40" :value="gap"
               @input="patch({ gap: Number(($event.target as HTMLInputElement).value) })" />
        <span class="cv-val">{{ gap }}px</span>
        <input class="cv-color" type="color" :value="bg"
               :title="t('tools.collage.bgColor', { color: bg })"
               @input="patch({ bg: ($event.target as HTMLInputElement).value })" />
      </div>

      <div v-if="displayError" class="cv-err">{{ displayError }}</div>

      <button v-if="resultUrl" class="cv-preview" @click="download">
        <img :src="canvasImageThumb(resultUrl, 320)" :alt="t('tools.collage.resultAlt')" />
      </button>
      <div v-else class="cv-empty">{{ t('tools.collage.empty') }}</div>
      <div v-if="usedNote" class="cv-note">{{ usedNote }}</div>

      <div class="cv-actions">
        <button class="cv-run" :disabled="status === 'running'" @click="run">
          {{ status === 'running' ? t('tools.collage.runningBtn') : t('nodes.title.collage') }}
        </button>
        <button v-if="resultUrl" class="cv-dl" @click="download">{{ t('common.download') }}</button>
      </div>
    </div>

    <Handle id="image-out" type="source" :position="Position.Right" class="h-image" :title="t('tools.collage.output')" />
  </div>
</template>

<script setup lang="ts">
/**
 * 拼图：多张图拼成一张宫格图。切片的反向操作。
 *
 * 每格按 cover 填满而不是留白 —— 拼图好不好看全靠格子对齐，一格留白整张就散了。
 * 想保住完整画面的，先用「改尺寸」补白到统一比例再拼，这条在空态里写给用户看。
 */
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { COLLAGE_PRESETS, CELL_RATIO_OPTIONS } from '@/composables/canvasToolsSpec'
import ChipSelect from './ChipSelect.vue'

const props = defineProps<{
  id: string
  data: {
    cols?: number; rows?: number; gap?: number; bg?: string; ratio?: string
    status?: string; errorMsg?: string; validationError?: string
    imageUrl?: string; imageUrls?: string[]
    outW?: number; outH?: number; usedCount?: number; skippedCount?: number
  }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData } = useVueFlow()
const executor = inject(CANVAS_EXECUTOR_KEY)

const status = computed(() => props.data.status || 'idle')
const cols = computed(() => Number(props.data.cols) || 2)
const rows = computed(() => Number(props.data.rows) || 2)
const cells = computed(() => cols.value * rows.value)
const gap = computed(() => Number(props.data.gap) || 0)
const bg = computed(() => props.data.bg || '#ffffff')
const ratio = computed(() => props.data.ratio || '')
const resultUrl = computed(() => props.data.imageUrl || '')
const outW = computed(() => Number(props.data.outW) || 0)
const outH = computed(() => Number(props.data.outH) || 0)
const displayError = computed(() => props.data.validationError || props.data.errorMsg || '')

/** 跑完才知道实际用了几张 —— 丢掉的那几张一定要说，不然用户以为都拼进去了 */
const usedNote = computed(() => {
  const used = Number(props.data.usedCount) || 0
  if (!used) return ''
  const skipped = Number(props.data.skippedCount) || 0
  return skipped > 0 ? t('tools.collage.usedSkipped', { used, skipped }) : t('tools.collage.used', { used })
})

/** 改任何参数都作废上一版结果，免得看着旧图以为是新参数出的 */
function patch(p: Record<string, any>) {
  updateNodeData(props.id, {
    ...p, imageUrl: '', imageUrls: [], outW: 0, outH: 0,
    usedCount: 0, skippedCount: 0, status: 'idle', errorMsg: '',
  })
}

function run() { void executor?.runNode(props.id) }
function download() {
  if (resultUrl.value) void downloadCanvasAsset(resultUrl.value, `collage_${cols.value}x${rows.value}`, 'image')
}
</script>

<style scoped>
@import './tool-node.css';
/* 原生 <select> 替换为自定义下拉 ChipSelect，填满行、外观对齐原 cv-select */
.cv-chip { flex: 1; min-width: 0; }
.cv-chip :deep(.chip) {
  width: 100%;
  justify-content: space-between;
  background: var(--n-2);
  border: 1px solid var(--n-5);
  border-radius: 5px;
  padding: 3px 6px;
  font-size: 11px;
}
</style>
