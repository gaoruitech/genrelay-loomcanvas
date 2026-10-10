<template>
  <div class="cv-node cv-chat video-analysis" :class="{
    selected,
    shaking,
    'is-running': isRunning,
    'has-validation-error': !!data.validationError,
    'has-runtime-error': status === 'error',
  }">
    <div class="cv-head">
      <LcIcon name="video" />
      <span class="cv-title">{{ t('nodes.title.videoAnalysis') }}</span>
      <span v-if="status === 'stale'" class="cv-tag stale">{{ t('nodes.status.stale') }}</span>
      <span v-else-if="status === 'queued'" class="cv-tag running">{{ t('nodes.status.queued') }}</span>
      <span v-else-if="status === 'running'" class="cv-tag running">{{ t('nodeui.analysis.statusRunning') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
      <span v-else-if="status === 'canceled'" class="cv-tag stale">{{ t('nodes.status.canceled') }}</span>
      <span v-else-if="status === 'done' || !!data.text" class="cv-tag done">{{ t('nodes.status.done') }}</span>
    </div>

    <div class="cv-body">
      <div class="cv-in">
        <Handle id="video-in" type="target" :position="Position.Left" class="h-video" :title="t('nodeui.analysis.videoIn')" />
        {{ t('nodes.title.video') }}<em :class="{ on: videoCount > 0 }">{{ videoCount ? t('gen.node.connectedOne') : t('gen.node.notConnected') }}</em>
      </div>
      <div class="cv-in">
        <Handle id="text-in" type="target" :position="Position.Left" class="h-text" :title="t('nodeui.llm.textIn')" />
        {{ t('nodes.field.prompt') }}<em :class="{ on: textCount > 0 }">{{ textCount ? t('gen.node.connected', { n: textCount }) : t('gen.node.notConnected') }}</em>
      </div>
      <div class="cv-in">
        <Handle id="image-in" type="target" :position="Position.Left" class="h-image" :title="t('nodeui.llm.imageIn')" />
        {{ t('gen.node.refImages') }}<em :class="{ on: imageCount > 0 }">{{ imageCount ? t('gen.node.connected', { n: imageCount }) : t('common.optional') }}</em>
      </div>

      <!-- 模型选择：已启用的对话类模型 -->
      <div class="nodrag" @mousedown.stop @click.stop>
        <ChipSelect v-if="modelOpts.length" field :badge="t('gen.node.kindChat')" badge-kind="chat" :model-value="model" :options="modelOpts" @update:model-value="v => selectModel(String(v))" />
        <div v-else class="cv-hint">{{ t('executor.noVideoChatModel') }}</div>
      </div>

      <!-- 结果（可编辑，作为 text-out 喂给下游） -->
      <div class="cv-textarea-wrap nodrag nowheel" @mousedown.stop @wheel.stop>
        <textarea
          v-model="promptText"
          class="cv-textarea"
          :placeholder="isRunning ? t('nodeui.analysis.statusRunning') : t('nodeui.analysis.placeholder')"
          :disabled="isRunning"
          maxlength="5000"
        />
        <div class="cv-textarea-footer">
          <button class="cv-clear-btn" :disabled="!promptText || isRunning" @click.stop="promptText = ''" @mousedown.stop>{{ t('common.clear') }}</button>
          <span class="cv-footer-right">
            <button class="cv-zoom-btn" :title="t('nodes.action.expand')" @click.stop="expanded = true" @mousedown.stop>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            </button>
            <span class="cv-char-count">{{ charCount }} / 5000</span>
          </span>
        </div>
      </div>

      <div v-if="displayError" class="cv-error nodrag" @click.stop @mousedown.stop>
        <div class="cv-error-msg nowheel">{{ displayError }}</div>
        <button v-if="status === 'error'" class="cv-retry" @click.stop="onClickRun">{{ t('common.retry') }}</button>
      </div>

      <!-- 成本固定在运行按钮正上方：跑过显示实际成本，没跑过显示预估 -->
      <div v-if="actualText" class="cv-kv" :title="t('cost.actual')">
        <span>{{ t('cost.actual') }}</span>
        <span v-if="data.cost?.unknown" class="cv-unk">{{ actualText }}</span>
        <b v-else>{{ actualText }}</b>
      </div>
      <div v-else-if="estimateText" class="cv-kv" :title="t('cost.estimateTip')">
        <span>{{ t('cost.estimate') }}</span>
        <span v-if="data.estimatedCost?.unknown" class="cv-unk">{{ estimateText }}</span>
        <b v-else>{{ estimateText }}</b>
      </div>

      <div v-if="isRunning" class="cv-progress nodrag" :class="{ indet: status === 'running' && !progress }">
        <i :style="progress ? { width: progress + '%' } : undefined" />
        <span>
          <b>{{ runningLabel }}</b>
          <button v-if="canCancel" class="cv-progress-cancel" @click.stop="handleCancel" @mousedown.stop>{{ t('nodes.action.cancel') }}</button>
        </span>
      </div>
      <button v-else class="cv-run nodrag" :title="t('nodeui.analysis.runTitle')" @click.stop="onClickRun" @mousedown.stop>
        <LcIcon name="play" size="s" />{{ t('nodeui.analysis.run') }}
      </button>
    </div>

    <Handle id="text-out" type="source" :position="Position.Right" class="h-text h-top" />

    <!-- 放大查看 -->
    <Teleport to="body">
      <div v-if="expanded" class="lc-mask lc-sheet" @click.self="expanded = false" @wheel.stop @mousedown.stop>
        <div class="lc-dialog va-modal">
          <div class="lc-dialog-head">
            <span>{{ t('nodeui.analysis.modalTitle') }}</span>
            <button class="lc-x" :title="t('common.close')" @click="expanded = false">×</button>
          </div>
          <div class="lc-dialog-body va-modal-body">
            <textarea v-model="promptText" class="lc-textarea va-modal-textarea" :disabled="isRunning" maxlength="5000" />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import ChipSelect from './ChipSelect.vue'
import LcIcon from '@/components/LcIcon.vue'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { useEstimateCost } from '@/composables/useEstimateCost'
import { listVideoChatModels, modelTag } from '@/utils/canvasModels'
import { localizedModelDesc } from '@/utils/builtinContent'
import { formatCost, formatEstimate } from '@/utils/cost'
import type { Cost } from '@/types'

const props = defineProps<{
  id: string
  data: {
    text?: string
    status?: string
    progress?: number
    errorMsg?: string
    cost?: Cost | null
    estimatedCost?: Cost | null
    taskId?: string
    runPending?: boolean
    model?: string
    validationError?: string
    validationStamp?: number
  }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData, edges } = useVueFlow()
const executor = inject(CANVAS_EXECUTOR_KEY)

const status = computed(() => props.data.status || 'idle')
const progress = computed(() => props.data.progress || 0)
const isRunning = computed(() => status.value === 'running' || status.value === 'queued')
// 任务已经提交到后端、还没出结果时才有东西可取消
const canCancel = computed(() => status.value === 'running' && props.data.runPending === true)
const charCount = computed(() => (props.data.text || '').length)

const expanded = ref(false)

// 可选模型：设置里已启用、且能读视频的对话类模型
const modelOpts = computed(() => listVideoChatModels().map(m => ({ value: m.id, label: m.label || m.id, desc: localizedModelDesc(m.id, m.desc), tag: modelTag(m) })))
// 当前生效的模型：存的那个还在清单里就用它，否则落到第一个（与执行器的回退一致）
const model = computed(() => {
  const chosen = props.data.model || ''
  if (chosen && modelOpts.value.some(o => o.value === chosen)) return chosen
  return modelOpts.value[0]?.value || ''
})
function selectModel(v: string) {
  updateNodeData(props.id, { model: v })
}
// 没选过模型时把默认值落到节点上；清单是异步加载的，所以用 watch 而不是只在挂载时做一次
watch(model, (m) => {
  if (m && !props.data.model) updateNodeData(props.id, { model: m })
}, { immediate: true })

// 预估成本 / 实际成本
useEstimateCost(
  computed(() => (model.value ? { model: model.value, count: 1 } : null)),
  (cost) => updateNodeData(props.id, { estimatedCost: cost }),
)
const actualText = computed(() => formatCost(props.data.cost))
const estimateText = computed(() => formatEstimate(props.data.estimatedCost))

const promptText = computed({
  get: () => props.data.text || '',
  set: (v) => updateNodeData(props.id, { text: v }),
})

// 校验失败抖动动画（与其他节点一致）
const shaking = ref(false)
let shakeTimer: number | null = null
watch(() => props.data.validationStamp, (val) => {
  if (!val) return
  shaking.value = true
  if (shakeTimer) window.clearTimeout(shakeTimer)
  shakeTimer = window.setTimeout(() => { shaking.value = false; shakeTimer = null }, 1000)
})

onBeforeUnmount(() => {
  if (shakeTimer) window.clearTimeout(shakeTimer)
})

// 已有结果时的重跑确认由执行器统一处理（见 useRerunConfirm），这里只管发起
function onClickRun() {
  if (isRunning.value) return
  void doRun()
}
async function doRun() {
  if (!executor) return
  await executor.runSubtree(props.id)
}
function handleCancel() {
  void executor?.cancelNode(props.id)
}

/* 表头下方各输入口的已连接数（真实连线） */
const inCount = (handle: string) => edges.value.filter((e: any) => e.target === props.id && e.targetHandle === handle).length
const textCount = computed(() => inCount('text-in'))
const displayError = computed(() => props.data.validationError || (status.value === 'error' ? props.data.errorMsg : '') || '')
const runningLabel = computed(() => {
  if (status.value === 'queued') return t('nodes.status.queued')
  // 上游报了进度才显示百分比；没报就只说状态，不编数字
  return progress.value ? t('nodes.action.running', { progress: progress.value }) : t('nodeui.analysis.statusRunning')
})
const videoCount = computed(() => inCount('video-in'))
const imageCount = computed(() => inCount('image-in'))
</script>

<style scoped>
@import './node-shared.css';
.cv-chat { width: 280px; min-height: 340px; }
.cv-textarea-wrap { flex: 1 1 auto; min-height: 96px; display: flex; flex-direction: column; }
.cv-textarea-wrap .cv-textarea { flex: 1 1 auto; min-height: 96px; }

/* 放大查看：通用弹窗外壳，文本域撑满 */
.va-modal { width: min(1040px, 100%); }
.va-modal-body { display: flex; flex-direction: column; gap: 16px; }
.va-modal-body .lc-field { margin-bottom: 0; }
.va-modal-system { min-height: 88px; }
.va-modal-textarea { min-height: min(52vh, 480px); }
@media (max-width: 600px) {
  .va-modal-textarea { min-height: 40vh; }
}
</style>
