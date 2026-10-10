<template>
  <div class="cv-node cv-chat llm-node" :class="{
    selected,
    shaking,
    'is-running': isRunning,
    'has-validation-error': !!data.validationError,
    'has-runtime-error': status === 'error',
  }">
    <div class="cv-head">
      <LcIcon name="chat" />
      <span class="cv-title">{{ t('nodes.title.llm') }}</span>
      <span v-if="status === 'stale'" class="cv-tag stale">{{ t('nodes.status.stale') }}</span>
      <span v-else-if="status === 'queued'" class="cv-tag running">{{ t('nodes.status.queued') }}</span>
      <span v-else-if="status === 'running'" class="cv-tag running">{{ t('nodeui.llm.statusRunning') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
      <span v-else-if="status === 'canceled'" class="cv-tag stale">{{ t('nodes.status.canceled') }}</span>
      <span v-else-if="status === 'done' || !!data.text" class="cv-tag done">{{ t('nodes.status.done') }}</span>
    </div>

    <div class="cv-body">
      <div class="cv-in">
        <Handle id="text-in" type="target" :position="Position.Left" class="h-text" :title="t('nodeui.llm.textIn')" />
        {{ t('nodes.field.prompt') }}<em :class="{ on: textCount > 0 }">{{ textCount ? t('gen.node.connected', { n: textCount }) : t('gen.node.notConnected') }}</em>
      </div>
      <!-- 纯文本模型：图片口变灰且不再接受新连线 -->
      <div class="cv-in" :class="{ off: !readsImages }">
        <Handle id="image-in" type="target" :position="Position.Left" class="h-image" :class="{ 'h-off': !readsImages }" :connectable="readsImages" :title="readsImages ? t('nodeui.llm.imageIn') : t('nodeui.llm.imageInOff')" />
        {{ t('gen.node.refImages') }}<em :class="{ on: imageCount > 0 && readsImages }">{{ imageCount ? t('gen.node.connected', { n: imageCount }) : t('common.optional') }}</em>
      </div>

      <!-- 模型选择：已启用的对话类模型 -->
      <div class="nodrag" @mousedown.stop @click.stop>
        <ChipSelect v-if="modelOpts.length" field :badge="t('gen.node.kindChat')" badge-kind="chat" :model-value="model" :options="modelOpts" @update:model-value="v => selectModel(String(v))" />
        <div v-else class="cv-hint">{{ t('executor.noChatModel') }}</div>
      </div>
      <!-- 纯文本模型却连着图片：说清楚这些图不会发出去 -->
      <div v-if="!readsImages && imageCount" class="cv-hint warn">{{ t('nodeui.llm.imagesIgnored', { n: imageCount }) }}</div>
      <!-- 多条文本输入的拼接顺序 -->
      <div v-if="textInputs.length > 1" class="llm-order nodrag" @mousedown.stop>
        <div class="cv-hint">{{ t('nodeui.llm.textOrder') }}</div>
        <div v-for="(it, i) in textInputs" :key="it.sourceId" class="llm-order-item">
          <span class="llm-order-idx">{{ i + 1 }}</span>
          <span class="llm-order-snip">{{ it.snippet || t('nodeui.llm.emptyText') }}</span>
          <span class="llm-order-btns">
            <button :disabled="i === 0" :title="t('nodeui.llm.moveUp')" @click.stop="moveText(i, -1)" @mousedown.stop>↑</button>
            <button :disabled="i === textInputs.length - 1" :title="t('nodeui.llm.moveDown')" @click.stop="moveText(i, 1)" @mousedown.stop>↓</button>
          </span>
        </div>
      </div>

      <!-- 结果（可编辑，作为 text-out 喂给下游） -->
      <div class="cv-textarea-wrap nodrag nowheel" @mousedown.stop @wheel.stop>
        <textarea
          v-model="promptText"
          class="cv-textarea"
          :placeholder="isRunning ? t('nodeui.llm.statusRunning') : t('nodeui.llm.placeholder')"
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
      <button v-else class="cv-run nodrag" :title="t('nodeui.llm.runTitle')" @click.stop="onClickRun" @mousedown.stop>
        <LcIcon name="play" size="s" />{{ t('nodeui.llm.run') }}
      </button>
    </div>

    <Handle id="text-out" type="source" :position="Position.Right" class="h-text h-top" />

    <!-- 放大查看 -->
    <Teleport to="body">
      <div v-if="expanded" class="lc-mask lc-sheet" @click.self="expanded = false" @wheel.stop @mousedown.stop>
        <div class="lc-dialog va-modal">
          <div class="lc-dialog-head">
            <span>{{ t('nodeui.llm.modalTitle') }}</span>
            <button class="lc-x" :title="t('common.close')" @click="expanded = false">×</button>
          </div>
          <div class="lc-dialog-body va-modal-body">
            <div class="lc-field">
              <label class="lc-label">{{ t('nodeui.llm.systemPrompt') }}</label>
              <textarea
                v-model="systemPrompt"
                class="lc-textarea va-modal-system"
                :placeholder="t('nodeui.llm.systemPromptPlaceholder')"
                :disabled="isRunning"
                maxlength="5000"
              />
            </div>
            <div class="lc-field va-modal-grow">
              <label class="lc-label">{{ t('nodeui.llm.result') }}</label>
              <textarea v-model="promptText" class="lc-textarea va-modal-textarea" :disabled="isRunning" maxlength="5000" />
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
import LcIcon from '@/components/LcIcon.vue'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { useEstimateCost } from '@/composables/useEstimateCost'
import { chatReadsImages, listChatModels, modelTag } from '@/utils/canvasModels'
import { capsSummary } from '@/utils/modelCaps'
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
    systemPrompt?: string
    textOrder?: string[]
    validationError?: string
    validationStamp?: number
  }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData, edges, findNode } = useVueFlow()
const executor = inject(CANVAS_EXECUTOR_KEY)

const status = computed(() => props.data.status || 'idle')
const progress = computed(() => props.data.progress || 0)
const isRunning = computed(() => status.value === 'running' || status.value === 'queued')
// 任务已经提交到后端、还没出结果时才有东西可取消
const canCancel = computed(() => status.value === 'running' && props.data.runPending === true)
const charCount = computed(() => (props.data.text || '').length)

const expanded = ref(false)

// 可选模型：设置里已启用的对话类模型
// 每行副标题：模型自己的一句话说明 + 它读不读图（「纯文本」/「可读图片，最多 N 张」）
const modelOpts = computed(() => listChatModels().map(m => ({
  value: m.id,
  label: m.label || m.id,
  desc: [localizedModelDesc(m.id, m.desc), capsSummary(m)[0]].filter(Boolean).join(' · '),
  tag: modelTag(m),
})))
// 当前生效的模型：存的那个还在清单里就用它，否则落到第一个（与执行器的回退一致）
const model = computed(() => {
  const chosen = props.data.model || ''
  if (chosen && modelOpts.value.some(o => o.value === chosen)) return chosen
  return modelOpts.value[0]?.value || ''
})
// 当前模型读不读图；纯文本模型时图片口关掉，已连着的图片数量用来提示
const readsImages = computed(() => !model.value || chatReadsImages(model.value))
const imageCount = computed(() => edges.value.filter((e: any) => e.target === props.id && e.targetHandle === 'image-in').length)
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

const systemPrompt = computed({
  get: () => props.data.systemPrompt || '',
  set: (v) => updateNodeData(props.id, { systemPrompt: v }),
})

// 已连的文本输入（可多条），按 textOrder 排序，供节点内调序
const textInputs = computed(() => {
  const es = edges.value.filter((e: any) => e.target === props.id && e.targetHandle === 'text-in')
  const items = es.map((e: any) => {
    const src = findNode(e.source)
    const txt = (((src?.data?.text as string) || '')).replace(/\s+/g, ' ').trim()
    return { sourceId: e.source as string, snippet: txt.slice(0, 16) }
  })
  const order = (props.data.textOrder as string[]) || []
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? 9999 : i }
  return [...items].sort((a, b) => rank(a.sourceId) - rank(b.sourceId))
})
function moveText(idx: number, dir: number) {
  const arr = textInputs.value.map(it => it.sourceId)
  const j = idx + dir
  if (j < 0 || j >= arr.length) return
  const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp
  updateNodeData(props.id, { textOrder: arr })
}

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
  return progress.value ? t('nodes.action.running', { progress: progress.value }) : t('nodeui.llm.statusRunning')
})
</script>

<style scoped>
@import './node-shared.css';
.cv-chat { width: 280px; min-height: 340px; }
.cv-textarea-wrap { flex: 1 1 auto; min-height: 96px; display: flex; flex-direction: column; }
.cv-textarea-wrap .cv-textarea { flex: 1 1 auto; min-height: 96px; }

.llm-order { display: flex; flex-direction: column; gap: 4px; }
.llm-order-item { display: flex; align-items: center; gap: 8px; height: 26px; padding: 0 6px 0 8px; border-radius: 7px; background: var(--well); border: 1px solid var(--line); }
.llm-order-idx { width: 16px; height: 16px; border-radius: 4px; background: var(--kind-chat-bg); color: var(--kind-chat-fg); font: 500 10px var(--f-mono); display: grid; place-items: center; flex: none; }
.llm-order-snip { flex: 1; min-width: 0; font-size: 11px; color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.llm-order-btns { display: flex; gap: 2px; }
.llm-order-btns button { width: 20px; height: 20px; border: 0; background: none; color: var(--text-2); border-radius: 5px; cursor: pointer; font-size: 11px; line-height: 1; padding: 0; }
.llm-order-btns button:hover:not(:disabled) { background: rgba(124, 160, 255, .12); color: var(--text); }
.llm-order-btns button:disabled { opacity: .35; cursor: default; }

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
