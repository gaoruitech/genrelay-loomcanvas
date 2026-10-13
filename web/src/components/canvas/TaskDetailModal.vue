<template>
  <Teleport :to="$lcPortal">
    <div
      v-if="open"
      class="lc-mask lc-sheet td-mask"
      @mousedown.self="close"
    >
      <!-- 只认按在遮罩上的那一下：在弹窗里拖选文字、松手落在遮罩上，不该把弹窗关掉。
           键盘和焦点归 v-dialog：焦点进弹窗、Tab 在里面转、Esc 关掉、关掉后焦点还给打开它的那个元素 -->
      <div
        v-dialog="close"
        class="lc-dialog td-modal"
        role="dialog"
        aria-modal="true"
        :aria-label="t('gen.detail.title', { type: typeLabel })"
        tabindex="-1"
        @click.stop
        @mousedown.stop
      >
        <div class="lc-dialog-head">
          <span>{{ t('gen.detail.title', { type: typeLabel }) }}</span>
          <button type="button" class="lc-x" :aria-label="t('common.close')" @click="close">×</button>
        </div>

        <div class="lc-dialog-body td-body">
          <div v-if="previewUrl" class="td-preview">
            <video v-if="isVideo" :src="$src(previewUrl)" controls playsinline class="td-media"></video>
            <img v-else :src="$src(previewUrl)" class="td-media" alt="" />
            <button type="button" class="lc-btn sm td-dl" @click="onDownload"><LcIcon name="download" size="s" />{{ t('common.download') }}</button>
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

          <!-- 比例在前、分辨率在后：和节点摘要、参数 chip、队列、生成记录同一个顺序 -->
          <div v-if="aspectRatioLabel" class="td-row">
            <span class="td-label">{{ t('nodes.field.aspectRatio') }}</span>
            <span class="td-value">{{ aspectRatioLabel }}</span>
          </div>

          <div v-if="resolutionLabel" class="td-row">
            <span class="td-label">{{ t('nodes.field.resolution') }}</span>
            <span class="td-value">{{ resolutionLabel }}</span>
          </div>

          <!-- 片长：和节点摘要、参数 chip、队列、生成记录同一种写法（utils/duration.ts） -->
          <div v-if="durationLabel" class="td-row" data-row="duration">
            <span class="td-label">{{ t('nodes.field.duration') }}</span>
            <span class="td-value">{{ durationLabel }}</span>
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

          <!-- 集成方关了成本显示（features.cost）：这一行不出（不然是一个标签配一个空值） -->
          <div v-if="$feat.cost" class="td-row">
            <span class="td-label">{{ actualCost ? t('cost.actual') : t('cost.estimate') }}</span>
            <span class="td-value">
              <template v-if="actualCost">{{ actualCost }}</template>
              <span v-else-if="estimateText" class="td-muted">{{ estimateText }}</span>
              <template v-else>—</template>
            </span>
          </div>

          <!-- 提示词整段都给：长了就在这一格里滚，不截断（以前只给前 100 个字，剩下的要悬停才看得到） -->
          <div class="td-row">
            <span class="td-label">{{ promptLabel }}</span>
            <span v-if="fullPromptText" class="td-value td-prompt">
              <span class="td-prompt-text" tabindex="0">{{ fullPromptText }}</span>
              <button v-tip="t('common.copy')" type="button" class="lc-tb sm" :aria-label="t('common.copy')" @click="copy(fullPromptText)"><LcIcon name="copy" size="s" /></button>
            </span>
            <span v-else class="td-value td-muted">{{ t('gen.detail.empty') }}</span>
          </div>

          <div v-if="taskId" class="td-row">
            <span class="td-label">{{ t('gen.detail.taskId') }}</span>
            <span class="td-value td-mono">
              <span class="td-id">{{ taskId }}</span>
              <button v-tip="t('common.copy')" type="button" class="lc-tb sm" :aria-label="t('common.copy')" @click="copy(taskId)"><LcIcon name="copy" size="s" /></button>
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
import { vDialog } from '@/directives/dialog'
import { MessagePlugin } from '@/utils/feedback'
import { refusalText, storedRefusal } from '@/utils/budget'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import { getAdapter } from '@/utils/canvasModels'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { formatCost, formatEstimate } from '@/utils/cost'
import { clipLength } from '@/utils/duration'

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
/** 视频生成的「时长」那一项：节点上存着的，没存就是模型固定的那一档 */
const durationLabel = computed(() => (props.type === 'video-gen'
  ? clipLength(Number(props.data?.duration) || adapter.value?.options.fixedDuration || 0)
  : ''))
const urlList = computed<string[]>(() => {
  if (isVideo.value) return props.data?.videoUrls || []
  return props.data?.imageUrls || []
})
const generatedCount = computed(() => urlList.value.length)

// 上一次运行真实花掉的；还没跑过就退回显示当前参数的预估
const actualCost = computed(() => formatCost(props.data?.cost))
const estimateText = computed(() => formatEstimate(props.data?.estimatedCost))
const taskId = computed(() => props.data?.taskId || '')
const errorMsg = computed(() => (storedRefusal(props.data?.refusal) ? refusalText(storedRefusal(props.data?.refusal)!).full : props.data?.errorMsg || ''))
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
/* 两列的小表：左边一列按最长的那个标签定宽，标签不换行（英文的「Aspect ratio」在手机上曾经折成两行），右边占剩下的 */
.td-body { display: grid; grid-template-columns: minmax(72px, max-content) minmax(0, 1fr); gap: 12px; align-items: start; }

.td-preview, .td-row-block > * { grid-column: 1 / -1; }
.td-preview {
  position: relative; border-radius: 12px; overflow: hidden; border: 1px solid var(--line);
  background: var(--media-bg); display: grid; place-items: center; margin-bottom: 4px;
}
.td-media { max-width: 100%; max-height: 320px; object-fit: contain; display: block; }
.td-dl { position: absolute; right: 8px; bottom: 8px; background: rgb(var(--c-glass) / .88); }

.td-row { display: contents; font-size: 13px; line-height: 1.7; }
.td-label { color: var(--text-3); white-space: nowrap; }
.td-value {
  min-width: 0; color: var(--text); word-break: break-word;
  display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.td-modal:focus { outline: none; }
.td-prompt { align-items: flex-start; flex-wrap: nowrap; }
.td-prompt-text {
  flex: 1; min-width: 0; max-height: 132px; overflow-y: auto; white-space: pre-wrap; color: var(--text-2);
  padding: 6px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--well);
  scrollbar-width: thin; scrollbar-color: var(--line-3) transparent;
}
.td-prompt-text:focus-visible { outline: none; border-color: var(--cyan); box-shadow: var(--ring); }
.td-mono { font: 12px/1.9 var(--f-mono); color: var(--text-2); flex-wrap: nowrap; }
.td-id { min-width: 0; overflow-wrap: anywhere; }
.td-warn { color: var(--warn); font-size: 12px; }
.td-muted { color: var(--text-3); }
.td-error { margin-top: -6px; word-break: break-word; }
/* 状态点的四种取值沿用节点上的叫法 */
.lc-st.done { color: var(--ok); }
.lc-st.running { color: var(--cyan); }
.lc-st.error { color: var(--err); }
.lc-st.stale { color: var(--warn); }
</style>
