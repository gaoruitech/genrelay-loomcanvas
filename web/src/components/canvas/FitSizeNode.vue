<template>
  <div class="cv-node cv-tool" :class="{ selected, 'is-running': status === 'running', 'has-runtime-error': status === 'error' }">
    <Handle id="image-in" type="target" :position="Position.Left" class="h-image h-top" :title="t('tools.input.one')" />

    <div class="cv-head">
      <LcIcon name="fit" />
      <span class="cv-title">{{ t('nodes.title.fitSize') }}</span>
      <span class="cv-help" :title="t('tools.fitSize.help')">?</span>
      <span v-if="status === 'running'" class="cv-tag running">{{ t('tools.processing') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
      <span v-else-if="resultUrl" class="cv-tag done">{{ outW }}×{{ outH }}</span>
      <span class="cv-head-x" :title="t('cost.free')">{{ t('cost.free') }}</span>
    </div>

    <div class="cv-body nodrag nowheel" @mousedown.stop @click.stop>
      <div class="cv-row">
        <span class="cv-label">{{ t('tools.fitSize.ratio') }}</span>
        <ChipSelect field class="cv-chip" :model-value="ratio" :options="RATIO_OPTIONS" @update:model-value="(v) => patch({ ratio: String(v) })" />
        <input class="cv-color" type="color" :value="bg" :title="t('tools.fitSize.padColor', { color: bg })"
               @input="patch({ bg: ($event.target as HTMLInputElement).value })" />
      </div>

      <div class="cv-row">
        <span class="cv-label">{{ t('tools.fitSize.format') }}</span>
        <ChipSelect field class="cv-chip" :model-value="format" :options="FORMAT_OPTIONS" @update:model-value="(v) => patch({ format: String(v) })" />
      </div>

      <div v-if="format !== 'png'" class="cv-row">
        <span class="cv-label">{{ t('tools.fitSize.quality') }}</span>
        <input class="cv-range" type="range" min="40" max="95" :value="quality"
               @input="patch({ quality: Number(($event.target as HTMLInputElement).value) })" />
        <span class="cv-val">{{ quality }}</span>
      </div>

      <div class="cv-row">
        <span class="cv-label">{{ t('tools.fitSize.maxSize') }}</span>
        <input class="cv-num" type="number" min="0" max="20480" :value="maxKb"
               @change="patch({ maxKb: Math.max(0, Math.round(Number(($event.target as HTMLInputElement).value) || 0)) })" />
        <span class="cv-val" style="width:auto">{{ t('tools.fitSize.maxSizeUnit') }}</span>
      </div>

      <div v-if="displayError" class="cv-error"><div class="cv-error-msg">{{ displayError }}</div></div>

      <button v-if="resultUrl" class="cv-preview" @click="download">
        <img :src="canvasImageThumb(resultUrl, 320)" :alt="t('tools.fitSize.resultAlt')" />
      </button>
      <div v-else class="cv-empty">{{ t('tools.fitSize.empty') }}</div>

      <div v-if="resultUrl" class="cv-note" :class="{ 'cv-err': overLimit }">
        {{ humanSize(bytes) }}<template v-if="overLimit">{{ t('tools.fitSize.overLimit', { kb: maxKb }) }}</template>
      </div>

      <div class="cv-actions">
        <button class="cv-run" :disabled="status === 'running'" @click="run">
          {{ status === 'running' ? t('tools.processingBtn') : t('tools.fitSize.run') }}
        </button>
        <button v-if="resultUrl" class="cv-dl" @click="download">{{ t('common.download') }}</button>
      </div>
    </div>

    <Handle id="image-out" type="source" :position="Position.Right" class="h-image h-top" :title="t('tools.fitSize.output')" />
  </div>
</template>

<script setup lang="ts">
/**
 * 改尺寸 / 压缩：补白到指定比例 + 转格式 + 限体积。
 *
 * 这三件事做成一个节点，是因为它们基本总是一起调 —— 「传某个平台之前把图弄合规」
 * 是一件事，不是三件；拆成三个节点只会让画布上多两条线。
 *
 * 补白而不裁切：平台卡比例时裁掉的往往正是主体。真要裁的话，图片节点上本来就有
 * 「编辑图片（裁剪 / 旋转）」。
 */
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import LcIcon from '@/components/LcIcon.vue'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { RATIO_OPTIONS, FORMAT_OPTIONS, humanSize } from '@/composables/canvasToolsSpec'
import ChipSelect from './ChipSelect.vue'

const props = defineProps<{
  id: string
  data: {
    ratio?: string; bg?: string; format?: string; quality?: number; maxKb?: number
    status?: string; errorMsg?: string; validationError?: string
    imageUrl?: string; imageUrls?: string[]
    outW?: number; outH?: number; bytes?: number; overLimit?: boolean
  }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData } = useVueFlow()
const executor = inject(CANVAS_EXECUTOR_KEY)

const status = computed(() => props.data.status || 'idle')
const ratio = computed(() => props.data.ratio || '')
const bg = computed(() => props.data.bg || '#ffffff')
const format = computed(() => props.data.format || 'auto')
const quality = computed(() => Number(props.data.quality) || 88)
const maxKb = computed(() => Number(props.data.maxKb) || 0)
const resultUrl = computed(() => props.data.imageUrl || '')
const outW = computed(() => Number(props.data.outW) || 0)
const outH = computed(() => Number(props.data.outH) || 0)
const bytes = computed(() => Number(props.data.bytes) || 0)
const overLimit = computed(() => !!props.data.overLimit)
const displayError = computed(() => props.data.validationError || props.data.errorMsg || '')

/** 改任何参数都作废上一版结果，免得看着旧图以为是新参数出的 */
function patch(p: Record<string, any>) {
  updateNodeData(props.id, {
    ...p, imageUrl: '', imageUrls: [], outW: 0, outH: 0, bytes: 0,
    overLimit: false, status: 'idle', errorMsg: '',
  })
}

function run() { void executor?.runNode(props.id) }
function download() {
  if (resultUrl.value) void downloadCanvasAsset(resultUrl.value, 'fit_' + outW.value + 'x' + outH.value, 'image')
}
</script>

<style scoped>
@import './tool-node.css';
/* 英文标签（Max size / Quality）比两三个汉字宽，这个节点的标签列放宽一点 */
.cv-row .cv-label { width: 56px; }
</style>
