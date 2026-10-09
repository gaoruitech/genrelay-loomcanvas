<template>
  <div class="cv-node video-analysis" :class="{
    selected,
    shaking,
    'has-validation-error': !!data.validationError,
    'has-runtime-error': status === 'error',
  }">
    <div class="cv-node-header">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" />
        <path d="M6 9.5h5M6 12.5h4" />
      </svg>
      <span>{{ t('nodes.title.videoAnalysis') }}</span>
      <div class="cv-header-actions">
        <span v-if="status === 'stale'" class="cv-tag stale">{{ t('nodes.status.stale') }}</span>
        <span v-else-if="status === 'queued'" class="cv-tag running">{{ t('nodes.status.queued') }}</span>
        <span v-else-if="status === 'running'" class="cv-tag running">{{ t('nodeui.analysis.statusRunning') }}</span>
        <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
        <span v-else-if="status === 'canceled'" class="cv-tag stale">{{ t('nodes.status.canceled') }}</span>
        <span v-else-if="status === 'done' || !!data.text" class="cv-tag done">{{ t('nodes.status.done') }}</span>
      </div>
    </div>

    <div class="va-body nodrag nowheel" @mousedown.stop @wheel.stop>
      <!-- 模型选择：设置里已启用的对话类模型 -->
      <div class="va-section">
        <ChipSelect v-if="modelOpts.length" :label="t('nodes.field.model')" :model-value="model" :options="modelOpts" @update:model-value="v => selectModel(String(v))" />
        <div v-else class="va-hint">{{ t('executor.noVideoChatModel') }}</div>
      </div>
      <!-- 分析结果（可编辑，作为 text-out 喂给下游） -->
      <div class="va-section">
        <div class="cv-textarea-wrap">
          <textarea
            v-model="promptText"
            class="cv-prompt-textarea va-textarea"
            :placeholder="isRunning ? t('nodeui.analysis.runningPlaceholder', { progress }) : t('nodeui.analysis.placeholder')"
            :disabled="isRunning"
            maxlength="5000"
          />
          <div class="cv-textarea-footer">
            <button class="cv-clear-btn nodrag" :disabled="!promptText || isRunning" @click.stop="promptText = ''" @mousedown.stop>{{ t('common.clear') }}</button>
            <span class="cv-footer-right">
              <button class="cv-zoom-btn nodrag" :title="t('nodes.action.expand')" @click.stop="expanded = true" @mousedown.stop>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
              <span class="cv-char-count">{{ charCount }} / 5000</span>
            </span>
          </div>
        </div>
      </div>
      <div v-if="status === 'error' && data.errorMsg" class="va-error">{{ data.errorMsg }}</div>
    </div>

    <div class="va-footer">
      <span v-if="actualText" class="va-cost" :title="t('cost.actual')">{{ actualText }}</span>
      <div class="va-run-wrap">
        <span v-if="!actualText && estimateText" class="va-est" :title="t('cost.estimateTip')">{{ estimateText }}</span>
        <button v-if="canCancel" class="va-cancel-btn nodrag" @click.stop="handleCancel" @mousedown.stop>{{ t('nodes.action.cancel') }}</button>
        <button
          class="va-run-btn nodrag"
          :disabled="isRunning"
          :title="isRunning ? t('nodeui.analysis.runningTitle', { progress }) : t('nodeui.analysis.runTitle')"
          @click.stop="onClickRun"
          @mousedown.stop
        >
          <span v-if="isRunning">{{ progress }}%</span>
          <span v-else>{{ t('nodeui.analysis.run') }}</span>
        </button>
      </div>
    </div>

    <Handle id="video-in" type="target" :position="Position.Left" class="h-video" :style="{ top: '30%' }" :title="t('nodeui.analysis.videoIn')" />
    <Handle id="image-in" type="target" :position="Position.Left" class="h-image" :style="{ top: '52%' }" :title="t('nodeui.llm.imageIn')" />
    <Handle id="text-in" type="target" :position="Position.Left" class="h-text" :style="{ top: '74%' }" :title="t('nodeui.llm.textIn')" />
    <Handle id="text-out" type="source" :position="Position.Right" class="h-text" />

    <!-- 放大查看 -->
    <Teleport to="body">
      <div v-if="expanded" class="va-modal-mask" @click.self="expanded = false" @wheel.stop @mousedown.stop>
        <div class="va-modal">
          <div class="va-modal-head">
            <span>{{ t('nodeui.analysis.modalTitle') }}</span>
            <button class="va-modal-close" :title="t('common.close')" @click="expanded = false">✕</button>
          </div>
          <div class="va-modal-body">
            <div class="va-modal-section">
              <textarea
                v-model="promptText"
                class="va-modal-textarea"
                :disabled="isRunning"
                maxlength="5000"
              />
            </div>
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
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { useEstimateCost } from '@/composables/useEstimateCost'
import { listVideoChatModels } from '@/utils/canvasModels'
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
const { updateNodeData } = useVueFlow()
const executor = inject(CANVAS_EXECUTOR_KEY)

const status = computed(() => props.data.status || 'idle')
const progress = computed(() => props.data.progress || 0)
const isRunning = computed(() => status.value === 'running' || status.value === 'queued')
// 任务已经提交到后端、还没出结果时才有东西可取消
const canCancel = computed(() => status.value === 'running' && props.data.runPending === true)
const charCount = computed(() => (props.data.text || '').length)

const expanded = ref(false)

// 可选模型：设置里已启用、且能读视频的对话类模型
const modelOpts = computed(() => listVideoChatModels().map(m => ({ value: m.id, label: m.label || m.id, desc: localizedModelDesc(m.id, m.desc), tag: m.tag })))
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
</script>

<style scoped>
@import './node-shared.css';

.video-analysis { min-width: 280px; max-width: 280px; height: 300px; }

.va-body { display: flex; flex-direction: column; gap: 10px; flex: 1 1 auto; min-height: 0; }
.va-section { display: flex; flex-direction: column; gap: 6px; }

.va-textarea {
  width: 100%;
  min-height: 140px;
  max-height: 300px;
  resize: vertical;
  box-sizing: border-box;
}
.va-error {
  font-size: 12px;
  color: var(--danger);
  line-height: 1.4;
}

.va-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 2px;
}
.va-hint { font-size: 11px; color: var(--t-dim); line-height: 1.5; }
.va-cost { font-size: 11px; color: var(--accent-text); white-space: nowrap; }
.va-footer .va-run-wrap { margin-left: auto; }

.va-run-btn {
  padding: 8px 20px;
  border-radius: 8px;
  border: 1px solid var(--accent);
  background: var(--btn-bg);
  color: var(--btn-fg);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.va-run-btn:hover:not(:disabled) { background: var(--btn-bg-hover); }
.va-run-btn:disabled { opacity: 0.6; cursor: default; }
.va-cancel-btn {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--line-2);
  background: transparent;
  color: var(--t-body);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}
.va-cancel-btn:hover { border-color: var(--danger); color: var(--danger); }

.va-run-wrap { position: relative; display: inline-flex; align-items: center; gap: 8px; }
.va-est {
  font-size: 12px;
  color: var(--warning);
  white-space: nowrap;
}

.va-expand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: var(--film-2);
  color: var(--t-body);
  cursor: pointer;
}
.va-expand:hover { background: rgba(255, 255, 255, 0.16); color: var(--t-max); }
.va-expand svg { width: 13px; height: 13px; }

/* 放大查看弹窗 */
.va-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: var(--scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.va-modal {
  width: min(1040px, 94vw);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  background: var(--n-3);
  border: 1px solid var(--line-2);
  border-radius: 14px;
  overflow: hidden;
}
.va-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  font-size: 15px;
  font-weight: 600;
  color: var(--t-max);
  border-bottom: 1px solid var(--line-1);
}
.va-modal-close {
  border: none;
  background: transparent;
  color: var(--t-dim);
  font-size: 16px;
  cursor: pointer;
}
.va-modal-close:hover { color: var(--t-max); }
.va-modal-body { padding: 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 20px; }
.va-modal-section { display: flex; flex-direction: column; gap: 10px; }
.va-modal-label { font-size: 13px; font-weight: 600; color: var(--t-body); }
.va-modal-seg { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px dashed var(--line-1); }
.va-modal-seg-time { flex: 0 0 74px; color: var(--info); font-size: 13px; font-variant-numeric: tabular-nums; }
.va-modal-seg-desc { flex: 1; }
.va-modal-seg-desc p { margin: 0 0 4px; font-size: 13px; line-height: 1.6; color: var(--t-body); }
.va-modal-seg-desc .va-modal-sub { color: var(--t-dim); font-size: 12px; }
.va-modal-textarea {
  width: 100%;
  min-height: 60vh;
  resize: vertical;
  box-sizing: border-box;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--line-2);
  background: var(--film-1);
  color: var(--t-strong);
  font-size: 13px;
  line-height: 1.6;
}
</style>
