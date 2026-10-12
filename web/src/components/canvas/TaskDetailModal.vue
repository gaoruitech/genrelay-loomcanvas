<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="lc-mask lc-sheet td-mask"
      @click.self="close"
      @mousedown.self="close"
    >
      <div class="lc-dialog td-modal" @click.stop @mousedown.stop>
        <div class="lc-dialog-head">
          <span>{{ t('gen.detail.title', { type: typeLabel }) }}</span>
          <button class="lc-x" :title="t('common.close')" @click="close">×</button>
        </div>

        <div class="lc-dialog-body td-body">
          <div v-if="previewUrl" class="td-preview">
            <video v-if="isVideo" :src="previewUrl" controls playsinline class="td-media"></video>
            <img v-else :src="previewUrl" class="td-media" alt="" />
            <button class="lc-btn sm td-dl" @click="onDownload"><LcIcon name="download" size="s" />{{ t('common.download') }}</button>
          </div>
          <div class="td-row">
            <span class="td-label">{{ t('gen.detail.status') }}</span>
            <span class="td-value">
              <span class="lc-st" :class="statusTagClass">{{ statusText }}</span>
            </span>
          </div>

          <div class="td-row">
            <span class="td-label">{{ t('nodes.field.model') }}</span>
            <span class="td-value">{{ modelText }}</span>
          </div>

          <div v-if="resolutionLabel" class="td-row">
            <span class="td-label">{{ t('nodes.field.resolution') }}</span>
            <span class="td-value">{{ resolutionLabel }}</span>
          </div>

          <div v-if="aspectRatioLabel" class="td-row">
            <span class="td-label">{{ t('nodes.field.aspectRatio') }}</span>
            <span class="td-value">{{ aspectRatioLabel }}</span>
          </div>

          <div class="td-row">
            <span class="td-label">{{ t('nodes.field.count') }}</span>
            <span class="td-value">
              {{ t(isVideo ? 'gen.detail.requestedVideos' : 'gen.detail.requestedImages', { n: requestedCount }) }}
              <template v-if="generatedCount > 0">
                · {{ t(isVideo ? 'gen.detail.generatedVideos' : 'gen.detail.generatedImages', { n: generatedCount }) }}
                <template v-if="generatedCount < requestedCount">
                  <span class="td-warn">{{ t(isVideo ? 'gen.detail.failedVideos' : 'gen.detail.failedImages', { n: requestedCount - generatedCount }) }}</span>
                </template>
              </template>
            </span>
          </div>

          <div class="td-row">
            <span class="td-label">{{ actualCost ? t('cost.actual') : t('cost.estimate') }}</span>
            <span class="td-value">
              <template v-if="actualCost">{{ actualCost }}</template>
              <span v-else-if="estimateText" class="td-muted">{{ estimateText }}</span>
              <template v-else>—</template>
            </span>
          </div>

          <div class="td-row">
            <span class="td-label">{{ promptLabel }}</span>
            <span class="td-value td-prompt" :title="fullPromptText || ''">
              {{ displayPromptText || t('gen.detail.empty') }}
            </span>
          </div>

          <div v-if="taskId" class="td-row">
            <span class="td-label">{{ t('gen.detail.taskId') }}</span>
            <span class="td-value td-mono">
              {{ taskId }}
              <button class="lc-tb sm" :title="t('common.copy')" @click="copy(taskId)"><LcIcon name="copy" size="s" /></button>
            </span>
          </div>

          <div v-if="errorMsg" class="td-row td-row-block">
            <span class="td-label">{{ t('gen.detail.error') }}</span>
            <div class="lc-alert td-error">{{ errorMsg }}</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import { getAdapter } from '@/utils/canvasModels'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { formatCost, formatEstimate } from '@/utils/cost'

type NodeKind = 'image-gen' | 'image-edit' | 'video-gen' | 'video-edit'

const props = defineProps<{
  open: boolean
  type: NodeKind
  data: any
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()

function close() { emit('close') }

const typeLabel = computed(() => {
  if (props.type === 'image-gen') return t('nodes.title.imageGen')
  if (props.type === 'image-edit') return t('nodes.title.imageEdit')
  if (props.type === 'video-edit') return t('nodes.title.videoEdit')
  return t('nodes.title.videoGen')
})

const promptLabel = computed(() => (props.type === 'image-edit' ? t('gen.detail.instruction') : t('nodes.field.prompt')))
// 优先取本次执行时落库的 lastPrompt（上游文本节点的覆盖也在内）；
// 老任务没存就回退到节点当前 prompt/instruction
const fullPromptText = computed(() => {
  const last = props.data?.lastPrompt
  if (typeof last === 'string' && last) return last
  return props.type === 'image-edit' ? (props.data?.instruction || '') : (props.data?.prompt || '')
})
const PROMPT_PREVIEW_MAX = 100
const displayPromptText = computed(() => {
  const text = fullPromptText.value
  if (!text) return ''
  return text.length > PROMPT_PREVIEW_MAX ? text.slice(0, PROMPT_PREVIEW_MAX) + '…' : text
})

const status = computed<string>(() => props.data?.status || 'idle')
const statusText = computed(() => {
  switch (status.value) {
    case 'done': return t('nodes.status.done')
    case 'running': return t('nodes.status.running')
    case 'queued': return t('nodes.status.queued')
    case 'error': return t('nodes.status.error')
    case 'stale': return t('nodes.status.stale')
    default: return t('nodes.status.idle')
  }
})
const statusTagClass = computed(() => {
  switch (status.value) {
    case 'done': return 'done'
    case 'running':
    case 'queued': return 'running'
    case 'error': return 'error'
    case 'stale': return 'stale'
    default: return ''
  }
})

const adapter = computed(() => getAdapter(props.data?.model || ''))

// 在 adapter.options 的选项表里反查 label，找不到就回退为原 value
function lookupLabel(list: { value: string; label: string }[] | undefined, value: any): string {
  if (!list || value === undefined || value === '' || value === null) return ''
  const found = list.find(o => o.value === value)
  return found ? found.label : String(value)
}

const modelText = computed(() => adapter.value?.label || props.data?.model || '—')

const resolutionLabel = computed(() =>
  lookupLabel(adapter.value?.options.resolutions, props.data?.resolution)
)
const aspectRatioLabel = computed(() =>
  lookupLabel(adapter.value?.options.aspectRatios, props.data?.aspectRatio)
)

const requestedCount = computed(() => Math.max(1, Number(props.data?.count) || 1))
const isVideo = computed(() => props.type === 'video-gen' || props.type === 'video-edit')
const urlList = computed<string[]>(() => {
  if (isVideo.value) return props.data?.videoUrls || []
  return props.data?.imageUrls || []
})
const generatedCount = computed(() => urlList.value.length)

// 上一次运行真实花掉的；还没跑过就退回显示当前参数的预估
const actualCost = computed(() => formatCost(props.data?.cost))
const estimateText = computed(() => formatEstimate(props.data?.estimatedCost))
const taskId = computed(() => props.data?.taskId || '')
const errorMsg = computed(() => props.data?.errorMsg || '')
const previewUrl = computed<string>(() => {
  if (isVideo.value) return props.data?.videoUrl || (props.data?.videoUrls || [])[0] || ''
  return props.data?.imageUrl || (props.data?.imageUrls || [])[0] || ''
})
function onDownload() {
  if (!previewUrl.value) return
  downloadCanvasAsset(previewUrl.value, `detail_${Date.now()}`, isVideo.value ? 'video' : 'image')
}

async function copy(s: string) {
  try {
    await navigator.clipboard.writeText(s)
    MessagePlugin.success(t('common.copied'))
  } catch {
    MessagePlugin.error(t('common.copyFailed'))
  }
}
</script>

<style scoped>
.td-mask { z-index: 10000; }
.td-modal { width: 560px; }
.td-body { display: flex; flex-direction: column; gap: 12px; }

.td-preview {
  position: relative; border-radius: 12px; overflow: hidden; border: 1px solid var(--line);
  background: var(--media-bg); display: grid; place-items: center; margin-bottom: 4px;
}
.td-media { max-width: 100%; max-height: 320px; object-fit: contain; display: block; }
.td-dl { position: absolute; right: 8px; bottom: 8px; background: rgb(var(--c-glass) / .88); }

.td-row { display: flex; align-items: flex-start; gap: 12px; font-size: 13px; line-height: 1.7; }
.td-row-block { flex-direction: column; gap: 6px; }
.td-label { flex: 0 0 88px; color: var(--text-3); }
.td-value {
  flex: 1; min-width: 0; color: var(--text); word-break: break-word;
  display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.td-prompt { color: var(--text-2); }
.td-mono { font: 12px/1.9 var(--f-mono); color: var(--text-2); }
.td-warn { color: var(--warn); font-size: 12px; }
.td-muted { color: var(--text-3); }
.td-error { align-self: stretch; word-break: break-word; }
/* 状态点的四种取值沿用节点上的叫法 */
.lc-st.done { color: var(--ok); }
.lc-st.running { color: var(--cyan); }
.lc-st.error { color: var(--err); }
.lc-st.stale { color: var(--warn); }
@media (max-width: 600px) {
  .td-label { flex-basis: 72px; }
}
</style>
