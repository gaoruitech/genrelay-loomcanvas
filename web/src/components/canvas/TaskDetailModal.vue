<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="td-mask"
      @click.self="close"
      @mousedown.self="close"
    >
      <div class="td-modal" @click.stop @mousedown.stop>
        <div class="td-header">
          <span class="td-title">{{ t('gen.detail.title', { type: typeLabel }) }}</span>
          <button class="td-close" :title="t('common.close')" @click="close">×</button>
        </div>

        <div class="td-body">
          <div v-if="previewUrl" class="td-preview">
            <video v-if="isVideo" :src="previewUrl" controls playsinline class="td-media"></video>
            <img v-else :src="previewUrl" class="td-media" alt="" />
            <button class="td-dl" @click="onDownload">{{ t('common.download') }}</button>
          </div>
          <div class="td-row">
            <span class="td-label">{{ t('gen.detail.status') }}</span>
            <span class="td-value">
              <span class="td-tag" :class="statusTagClass">{{ statusText }}</span>
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
              <button class="td-copy" :title="t('common.copy')" @click="copy(taskId)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </span>
          </div>

          <div v-if="errorMsg" class="td-row td-row-block">
            <span class="td-label">{{ t('gen.detail.error') }}</span>
            <div class="td-value td-error">{{ errorMsg }}</div>
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
.td-mask {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  backdrop-filter: blur(4px);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.td-modal {
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  background: var(--n-3);
  border: 1px solid var(--n-5);
  border-radius: 12px;
  box-shadow: 0 20px 60px var(--shadow-2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.td-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--n-5);
  flex-shrink: 0;
}
.td-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--t-max);
}
.td-close {
  background: transparent;
  border: none;
  color: var(--t-dim);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0 6px;
  transition: color 0.15s ease;
}
.td-close:hover { color: var(--t-max); }

.td-body {
  padding: 14px 18px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.td-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  font-size: 13px;
}
.td-row-block { flex-direction: column; gap: 6px; }
.td-label {
  flex: 0 0 80px;
  color: var(--t-dim);
  padding-top: 2px;
}
.td-value {
  flex: 1;
  color: var(--t-body);
  word-break: break-word;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.td-row-block .td-value { display: block; }

.td-prompt {
  word-break: break-word;
  line-height: 1.5;
  font-size: 12.5px;
}
.td-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.td-warn { color: var(--warning); font-size: 12px; }
.td-muted { color: var(--t-dim); }
.td-error {
  background: rgba(255, 80, 80, 0.08);
  border: 1px solid rgba(255, 80, 80, 0.25);
  border-radius: 6px;
  padding: 8px 10px;
  color: var(--danger);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.td-tag {
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.td-tag.done { background: rgba(80, 200, 120, 0.15); color: #5fcf80; }
.td-tag.running { background: rgba(0, 150, 255, 0.15); color: var(--info); }
.td-tag.error { background: rgba(255, 80, 80, 0.15); color: var(--danger); }
.td-tag.stale { background: rgba(255, 170, 0, 0.15); color: var(--warning); }

.td-copy {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: var(--t-dim);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.td-copy:hover { background: var(--n-5); color: var(--accent-text); }
.td-copy svg { width: 13px; height: 13px; }

.td-preview { position: relative; margin-bottom: 12px; border-radius: 10px; overflow: hidden; background: var(--n-2, #000); display: grid; place-items: center; }
.td-media { max-width: 100%; max-height: 320px; object-fit: contain; display: block; }
.td-dl { position: absolute; right: 8px; bottom: 8px; border: 0; border-radius: 8px; padding: 6px 14px; font-size: 12px; font-weight: 600; cursor: pointer; background: var(--btn-bg, var(--accent-text)); color: var(--btn-fg, #111); }
</style>
