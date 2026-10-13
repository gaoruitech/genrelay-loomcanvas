<template>
  <div class="cv-node cv-tool" :class="{ selected, 'is-running': status === 'running', 'has-runtime-error': status === 'error' }">
    <Handle id="image-in" type="target" :position="Position.Left" class="h-image h-top" v-tip="{ text: t('tools.input.many'), placement: 'left' }" />

    <div class="cv-head">
      <LcIcon name="layout" />
      <span class="cv-title">{{ t('nodes.title.collage') }}</span>
      <span class="cv-help" tabindex="0" role="note" v-tip="t('tools.collage.help')" :aria-label="t('tools.collage.help')">?</span>
      <span v-if="status === 'running'" class="cv-tag running">{{ t('tools.collage.running') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
      <span v-else-if="resultUrl" class="cv-tag done">{{ outW }}×{{ outH }}</span>
      <span v-tip="{ text: t('cost.free'), clipped: true }" class="cv-head-x">{{ t('cost.free') }}</span>
    </div>

    <div class="cv-body nodrag nowheel" @mousedown.stop @click.stop>
      <!-- 只读：设置一项一行，是字不是控件 -->
      <dl v-if="ro" class="cv-ro" data-testid="tool-ro">
        <div><dt>{{ t('nodeui.ro.grid') }}</dt><dd>{{ gridText }}</dd></div>
        <div><dt>{{ t('tools.collage.cell') }}</dt><dd>{{ ratioText }}</dd></div>
        <div><dt>{{ t('tools.collage.gap') }}</dt><dd>{{ gap }}px<i class="cv-swatch" role="img" :aria-label="t('tools.collage.bgColor', { color: bg })" v-tip="t('tools.collage.bgColor', { color: bg })" :style="{ background: bg }" /></dd></div>
      </dl>
      <template v-else>
      <div class="cv-presets">
        <button
          v-for="p in COLLAGE_PRESETS" :key="p.key"
          class="cv-gbtn" :class="{ on: p.cols === cols && p.rows === rows }"
          @click="patch({ cols: p.cols, rows: p.rows })"
        >{{ p.label }}</button>
      </div>

      <div class="cv-row">
        <span class="cv-label">{{ t('tools.collage.cell') }}</span>
        <ChipSelect field class="cv-chip" :model-value="ratio" :options="CELL_RATIO_OPTIONS" @update:model-value="(v) => patch({ ratio: String(v) })" />
      </div>

      <div class="cv-row">
        <span class="cv-label">{{ t('tools.collage.gap') }}</span>
        <input class="cv-range" type="range" min="0" max="40" :value="gap" :aria-label="t('tools.collage.gap')"
               @input="patch({ gap: Number(($event.target as HTMLInputElement).value) })" />
        <span class="cv-val">{{ gap }}px</span>
        <input class="cv-color" type="color" :value="bg"
               v-tip="t('tools.collage.bgColor', { color: bg })" :aria-label="t('tools.collage.bgColor', { color: bg })"
               @input="patch({ bg: ($event.target as HTMLInputElement).value })" />
      </div>
      </template>

      <div v-if="displayError" class="cv-error"><div class="cv-error-msg">{{ displayError }}</div></div>

      <button v-if="resultUrl" v-tip="previewTip" class="cv-preview" :aria-label="previewTip" @click="preview">
        <img :src="canvasImageThumb(resultUrl, 320)" :alt="t('tools.collage.resultAlt')" />
      </button>
      <div v-else class="cv-empty">{{ ro ? t('nodeui.share.noResult') : t('tools.collage.empty') }}</div>
      <div v-if="usedNote" class="cv-note">{{ usedNote }}</div>

      <div v-if="!ro || resultUrl" class="cv-actions" :class="{ ro }">
        <button v-if="!ro" class="cv-run" :disabled="status === 'running'" @click="run">
          {{ status === 'running' ? t('tools.collage.runningBtn') : t('nodes.title.collage') }}
        </button>
        <button v-if="resultUrl" class="cv-dl" @click="download">{{ t('common.download') }}</button>
      </div>
    </div>

    <Handle id="image-out" type="source" :position="Position.Right" class="h-image h-top" v-tip="{ text: t('tools.collage.output'), placement: 'right' }" />
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
import LcIcon from '@/components/LcIcon.vue'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { COLLAGE_PRESETS, CELL_RATIO_OPTIONS } from '@/composables/canvasToolsSpec'
import ChipSelect from './ChipSelect.vue'
import { useCanvasReadOnly, useCanvasViewer } from '@/composables/nodeLayout'

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
/** 只读（别人正在编辑、只有查看权）：能看结果、能下载，不能改设置、不能拼 */
const ro = useCanvasReadOnly()
const viewer = useCanvasViewer()

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

const gridText = computed(() => COLLAGE_PRESETS.find((p) => p.cols === cols.value && p.rows === rows.value)?.label || `${cols.value} × ${rows.value}`)
const ratioText = computed(() => CELL_RATIO_OPTIONS.find((o) => o.value === ratio.value)?.label || ratio.value)

/** 改任何参数都作废上一版结果，免得看着旧图以为是新参数出的 */
function patch(p: Record<string, any>) {
  if (ro.value) return
  updateNodeData(props.id, {
    ...p, imageUrl: '', imageUrls: [], outW: 0, outH: 0,
    usedCount: 0, skippedCount: 0, status: 'idle', errorMsg: '',
  })
}

function run() { if (!ro.value) void executor?.runNode(props.id) }
function download() {
  if (resultUrl.value) void downloadCanvasAsset(resultUrl.value, `collage_${cols.value}x${rows.value}`, 'image')
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
</style>
