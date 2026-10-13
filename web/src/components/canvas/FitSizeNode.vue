<template>
  <div class="cv-node cv-tool" :class="{ selected, 'is-running': status === 'running', 'has-runtime-error': status === 'error' }">
    <Handle id="image-in" type="target" :position="Position.Left" class="h-image h-top" v-tip="{ text: t('tools.input.one'), placement: 'left' }" />

    <div class="cv-head">
      <LcIcon name="fit" />
      <span class="cv-title">{{ t('nodes.title.fitSize') }}</span>
      <span class="cv-help" tabindex="0" role="note" v-tip="t('tools.fitSize.help')" :aria-label="t('tools.fitSize.help')">?</span>
      <span v-if="status === 'running'" class="cv-tag running">{{ t('tools.processing') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
      <span v-else-if="resultUrl" class="cv-tag done">{{ outW }}×{{ outH }}</span>
      <span v-tip="{ text: t('cost.free'), clipped: true }" class="cv-head-x">{{ t('cost.free') }}</span>
    </div>

    <div class="cv-body nodrag nowheel" @mousedown.stop @click.stop>
      <!-- 只读：设置一项一行，是字不是控件 -->
      <dl v-if="ro" class="cv-ro" data-testid="tool-ro">
        <div><dt>{{ t('tools.fitSize.ratio') }}</dt><dd>{{ ratioText }}<i class="cv-swatch" role="img" :aria-label="t('tools.fitSize.padColor', { color: bg })" v-tip="t('tools.fitSize.padColor', { color: bg })" :style="{ background: bg }" /></dd></div>
        <div><dt>{{ t('tools.fitSize.format') }}</dt><dd>{{ formatText }}</dd></div>
        <div v-if="format !== 'png'"><dt>{{ t('tools.fitSize.quality') }}</dt><dd>{{ quality }}</dd></div>
        <div><dt>{{ t('tools.fitSize.maxSize') }}</dt><dd>{{ maxKb ? `${maxKb} KB` : t('nodeui.ro.noLimit') }}</dd></div>
      </dl>
      <template v-else>
      <div class="cv-row">
        <span class="cv-label">{{ t('tools.fitSize.ratio') }}</span>
        <ChipSelect field class="cv-chip" :model-value="ratio" :options="RATIO_OPTIONS" @update:model-value="(v) => patch({ ratio: String(v) })" />
        <input class="cv-color" type="color" :value="bg" v-tip="t('tools.fitSize.padColor', { color: bg })" :aria-label="t('tools.fitSize.padColor', { color: bg })"
               @input="patch({ bg: ($event.target as HTMLInputElement).value })" />
      </div>

      <div class="cv-row">
        <span class="cv-label">{{ t('tools.fitSize.format') }}</span>
        <ChipSelect field class="cv-chip" :model-value="format" :options="FORMAT_OPTIONS" @update:model-value="(v) => patch({ format: String(v) })" />
      </div>

      <div v-if="format !== 'png'" class="cv-row">
        <span class="cv-label">{{ t('tools.fitSize.quality') }}</span>
        <input class="cv-range" type="range" min="40" max="95" :value="quality" :aria-label="t('tools.fitSize.quality')"
               @input="patch({ quality: Number(($event.target as HTMLInputElement).value) })" />
        <span class="cv-val">{{ quality }}</span>
      </div>

      <div class="cv-row">
        <span class="cv-label">{{ t('tools.fitSize.maxSize') }}</span>
        <input class="cv-num" type="number" min="0" max="20480" :value="maxKb" :aria-label="t('tools.fitSize.maxSize')"
               @change="patch({ maxKb: Math.max(0, Math.round(Number(($event.target as HTMLInputElement).value) || 0)) })" />
        <span class="cv-val" style="width:auto">{{ t('tools.fitSize.maxSizeUnit') }}</span>
      </div>
      </template>

      <div v-if="displayError" class="cv-error"><div class="cv-error-msg">{{ displayError }}</div></div>

      <button v-if="resultUrl" v-tip="previewTip" class="cv-preview" :aria-label="previewTip" @click="preview">
        <img :src="canvasImageThumb(resultUrl, 320)" :alt="t('tools.fitSize.resultAlt')" />
      </button>
      <div v-else class="cv-empty">{{ ro ? t('nodeui.share.noResult') : t('tools.fitSize.empty') }}</div>

      <div v-if="resultUrl" class="cv-note" :class="{ 'cv-err': overLimit }">
        {{ humanSize(bytes) }}<template v-if="overLimit">{{ t('tools.fitSize.overLimit', { kb: maxKb }) }}</template>
      </div>

      <div v-if="!ro || resultUrl" class="cv-actions" :class="{ ro }">
        <button v-if="!ro" class="cv-run" :disabled="status === 'running'" @click="run">
          {{ status === 'running' ? t('tools.processingBtn') : t('tools.fitSize.run') }}
        </button>
        <button v-if="resultUrl" class="cv-dl" @click="download">{{ t('common.download') }}</button>
      </div>
    </div>

    <Handle id="image-out" type="source" :position="Position.Right" class="h-image h-top" v-tip="{ text: t('tools.fitSize.output'), placement: 'right' }" />
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
import { useCanvasReadOnly, useCanvasViewer } from '@/composables/nodeLayout'

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
/** 只读（别人正在编辑、只有查看权）：能看结果、能下载，不能改设置、不能处理 */
const ro = useCanvasReadOnly()
const viewer = useCanvasViewer()

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
  if (ro.value) return
  updateNodeData(props.id, {
    ...p, imageUrl: '', imageUrls: [], outW: 0, outH: 0, bytes: 0,
    overLimit: false, status: 'idle', errorMsg: '',
  })
}

const ratioText = computed(() => RATIO_OPTIONS.find((o) => o.value === ratio.value)?.label || ratio.value)
const formatText = computed(() => FORMAT_OPTIONS.find((o) => o.value === format.value)?.label || format.value)

function run() { if (!ro.value) void executor?.runNode(props.id) }
function download() {
  if (resultUrl.value) void downloadCanvasAsset(resultUrl.value, 'fit_' + outW.value + 'x' + outH.value, 'image')
}
/** 点结果图：有画布的大图预览就放大看（下载在旁边那颗按钮上），没有才直接下载 */
const previewTip = computed(() => (viewer ? t('gen.view.image') : t('common.download')))
function preview() {
  if (!resultUrl.value) return
  if (viewer) viewer(resultUrl.value, 'image')
  else download()
}
</script>

<style scoped>
@import './tool-node.css';
/* 英文标签（Max size / Quality）比两三个汉字宽，这个节点的标签列放宽一点 */
.cv-row .cv-label { width: 56px; }
</style>
