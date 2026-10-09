<template>
  <div class="cv-node cv-surface" :class="{ selected }">
    <Handle id="image-in" type="target" :position="Position.Left" class="h-image" :title="t('tools.input.base')" />

    <div class="cv-head">
      <span class="cv-title">{{ t('nodes.title.watermark') }}</span>
      <span class="cv-help" :title="t('tools.watermark.help')">?</span>
      <span v-if="status === 'running'" class="cv-tag running">{{ t('tools.processing') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
      <span v-else-if="resultUrl" class="cv-tag done">{{ t('tools.watermark.done') }}</span>
      <span class="cv-free" :title="t('cost.free')">{{ t('cost.free') }}</span>
    </div>

    <div class="cv-body nodrag" @mousedown.stop @click.stop>
      <!-- 水印图就存在这个节点里，不用另外拉一个图片节点连过来 -->
      <div v-if="uploading" class="cv-mark-empty">{{ t('common.uploading') }}</div>
      <div v-else-if="markUrl" class="cv-mark-row">
        <img class="cv-mark-img" :src="canvasImageThumb(markUrl, 120)" :alt="t('tools.watermark.markAlt')" />
        <label class="cv-dl">
          {{ t('nodes.action.replace') }}
          <input type="file" accept="image/*" style="display:none" @change="onPick" />
        </label>
        <button class="cv-dl" @click="clearMark">{{ t('common.remove') }}</button>
      </div>
      <div v-else class="cv-mark-actions">
        <label class="cv-mark-btn">
          {{ t('tools.watermark.uploadLogo') }}
          <input type="file" accept="image/*" style="display:none" @change="onPick" />
        </label>
        <button v-if="picker" class="cv-mark-btn" @click="pickFromLibrary">{{ t('tools.watermark.pickFromLibrary') }}</button>
      </div>

      <div class="cv-row">
        <span class="cv-label">{{ t('tools.watermark.position') }}</span>
        <ChipSelect class="cv-chip" :model-value="position" :options="WATERMARK_POSITIONS" @update:model-value="(v) => patch({ position: String(v) })" />
      </div>

      <div class="cv-row">
        <span class="cv-label">{{ t('tools.watermark.size') }}</span>
        <input class="cv-range" type="range" min="5" max="60" :value="scalePct"
               @input="patch({ scalePct: Number(($event.target as HTMLInputElement).value) })" />
        <span class="cv-val">{{ scalePct }}%</span>
      </div>
      <div class="cv-row">
        <span class="cv-label">{{ t('tools.watermark.opacity') }}</span>
        <input class="cv-range" type="range" min="10" max="100" :value="opacity"
               @input="patch({ opacity: Number(($event.target as HTMLInputElement).value) })" />
        <span class="cv-val">{{ opacity }}%</span>
      </div>
      <div class="cv-row">
        <span class="cv-label">{{ t('tools.watermark.margin') }}</span>
        <input class="cv-range" type="range" min="0" max="20" :value="marginPct"
               @input="patch({ marginPct: Number(($event.target as HTMLInputElement).value) })" />
        <span class="cv-val">{{ marginPct }}%</span>
      </div>

      <div v-if="displayError" class="cv-err">{{ displayError }}</div>

      <button v-if="resultUrl" class="cv-preview" @click="download">
        <img :src="canvasImageThumb(resultUrl, 320)" :alt="t('tools.watermark.resultAlt')" />
      </button>
      <div v-else class="cv-empty">{{ t('tools.watermark.empty') }}</div>

      <div class="cv-actions">
        <button class="cv-run" :disabled="status === 'running'" @click="run">
          {{ status === 'running' ? t('tools.processingBtn') : t('nodes.title.watermark') }}
        </button>
        <button v-if="resultUrl" class="cv-dl" @click="download">{{ t('common.download') }}</button>
      </div>
    </div>

    <Handle id="image-out" type="source" :position="Position.Right" class="h-image" :title="t('tools.watermark.output')" />
  </div>
</template>

<script setup lang="ts">
/**
 * 加水印：底图 + logo → 合成图。
 *
 * 第一版做成了「两个输入口，下面那个接水印」—— 那意味着用户得先建一个图片节点、
 * 传上 logo、再把线拉到第二个口上，三步才能开始，而且两个绿口挨在一起谁也分不清。
 * 现在 logo 直接存在这个节点里：一个输入口接底图，logo 在节点上传，一步到位。
 *
 * 大小和边距都用底图宽度的百分比，不用绝对像素：同一套参数换到别的尺寸的底图上
 * 观感一致，否则 4K 图上的 100px logo 小得看不见。
 */
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { MessagePlugin } from 'tdesign-vue-next'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { CANVAS_PICKER_KEY } from '@/composables/canvasPickerKey'
import { WATERMARK_POSITIONS } from '@/composables/canvasToolsSpec'
import ChipSelect from './ChipSelect.vue'

const props = defineProps<{
  id: string
  data: {
    markUrl?: string
    position?: string; scalePct?: number; opacity?: number; marginPct?: number
    status?: string; errorMsg?: string; validationError?: string
    imageUrl?: string; imageUrls?: string[]
  }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData } = useVueFlow()
const executor = inject(CANVAS_EXECUTOR_KEY)
// 分享页是只读的 ShareNode，拿不到这个 provide，「从素材库选」自然不出现
const picker = inject(CANVAS_PICKER_KEY, undefined)

const status = computed(() => props.data.status || 'idle')
const markUrl = computed(() => props.data.markUrl || '')
const position = computed(() => props.data.position || 'br')
const scalePct = computed(() => Number(props.data.scalePct) || 20)
const opacity = computed(() => Number(props.data.opacity) || 70)
const marginPct = computed(() => (props.data.marginPct == null ? 3 : Number(props.data.marginPct)))
const resultUrl = computed(() => props.data.imageUrl || '')
const displayError = computed(() => props.data.validationError || props.data.errorMsg || '')
const uploading = ref(false)

/** 改任何参数都作废上一版结果，免得看着旧图以为是新参数出的 */
function patch(p: Record<string, any>) {
  updateNodeData(props.id, { ...p, imageUrl: '', imageUrls: [], status: 'idle', errorMsg: '' })
}

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    patch({ markUrl: await uploadCanvasImage(file), validationError: '' })
  } catch (err: any) {
    MessagePlugin.error(err?.message || t('common.uploadFailed'))
  } finally {
    uploading.value = false
  }
}

async function pickFromLibrary() {
  if (!picker) return
  const items = await picker.open({ mediaType: 'image', multiSelect: false })
  if (items.length > 0) patch({ markUrl: items[0].fileUrl, validationError: '' })
}

function clearMark() { patch({ markUrl: '' }) }

function run() { void executor?.runNode(props.id) }
function download() {
  if (resultUrl.value) void downloadCanvasAsset(resultUrl.value, 'watermarked', 'image')
}
</script>

<style scoped>
@import './tool-node.css';
.cv-chip { flex: 1; min-width: 0; }
/* 英文标签（Position / Opacity）比两个汉字宽，这个节点的标签列放宽一点 */
.cv-row .cv-label { width: 52px; }

.cv-mark-row { display: flex; align-items: center; gap: 6px; }
.cv-mark-img {
  width: 54px; height: 34px; object-fit: contain; flex: none;
  border: 1px solid var(--n-5); border-radius: 5px; background: var(--n-2);
}
.cv-mark-actions { display: flex; gap: 6px; }
.cv-mark-btn {
  flex: 1; text-align: center;
  background: var(--n-2); border: 1px dashed var(--n-5); border-radius: 6px;
  color: var(--t-dim); font-size: 11px; padding: 6px 0; cursor: pointer;
}
.cv-mark-btn:hover { border-color: var(--accent-text); color: var(--accent-text); }
.cv-mark-empty { font-size: 11px; color: var(--t-dim); padding: 6px 0; }
</style>
