<template>
  <div class="cv-node cv-gen img-edit" :class="{
    selected,
    shaking,
    'is-running': isRunning,
    'has-validation-error': !!data.validationError,
    'has-runtime-error': status === 'error',
  }">
    <div class="cv-head">
      <LcIcon name="edit" />
      <span class="cv-title">{{ t('nodes.title.imageEdit') }}</span>
      <span v-if="statusLabel" class="cv-tag" :class="statusClass">{{ statusLabel }}</span>
    </div>

    <div class="cv-body">
      <!-- 输入口：端口就在这一行的左边缘，右侧写明接了几个 -->
      <div class="cv-in">
        <Handle id="image-in" type="target" :position="Position.Left" class="h-image" :title="t('gen.node.imageIn')" />
        {{ t('gen.node.sourceImage') }}<em :class="{ on: imageRefs.length > 0 }">{{ imageRefs.length ? (maxRefs ? t('gen.node.connectedOf', { n: imageRefs.length, max: maxRefs }) : t('gen.node.connected', { n: imageRefs.length })) : t('gen.node.notConnected') }}</em>
      </div>
      <div class="cv-in">
        <Handle id="text-in" type="target" :position="Position.Left" class="h-text" :title="t('gen.node.promptIn')" />
        {{ t('gen.detail.instruction') }}<em :class="{ on: textInCount > 0 }">{{ textInCount ? t('gen.node.connected', { n: textInCount }) : t('gen.node.notConnected') }}</em>
      </div>

      <!-- 提示词摘要：点开在节点下方编辑（带参考图条和 @ 指代） -->
      <button type="button" class="cv-well nodrag" :class="{ open: panelOpen }" @click.stop="togglePanel" @mousedown.stop>
        <span class="cv-well-text" :class="{ ph: !instruction }">{{ instruction || t('gen.node.imageEditPlaceholder') }}</span>
      </button>

      <div class="nodrag" @click.stop @mousedown.stop>
        <ChipSelect v-if="modelOpts.length" field :badge="t('gen.node.kindImage')" badge-kind="img" v-model="modelKey" :options="modelOpts" :display-value="modelLabel" />
        <div v-else class="cv-hint">{{ t('models.none') }}</div>
      </div>
      <div v-if="adapter" class="cv-kv nodrag" @click.stop @mousedown.stop>
        <span>{{ t('gen.node.params') }}</span>
        <ImageParamsChip
          :resolutions="adapter.options.resolutions"
          :aspect-ratios="adapter.options.aspectRatios"
          :counts="adapter.options.counts"
          v-model:resolution="resolution"
          v-model:aspect-ratio="aspectRatio"
          v-model:count="count"
        />
      </div>
      <div v-if="brandKitCtx" class="cv-kv nodrag" @click.stop @mousedown.stop>
        <span>{{ t('gen.node.brandKit') }}</span>
        <span class="cv-kv-val">
          <ChipSelect label="" v-model="brandKitId" :options="brandKitOptions" />
          <button class="cv-link" :title="t('gen.brandKit.manage')" @click.stop="brandKitCtx.open()">{{ t('common.manage') }}</button>
        </span>
      </div>
      <div v-if="brandKitCtx && brandKitRefCount" class="cv-hint">
        {{ t('gen.brandKit.refCount', { used: brandKitRefCount, max: brandKitMaxRefs }) }}
      </div>

      <!-- 画面：按比例出框；成品悬停出「放大看详情」 -->
      <div class="cv-frame" :class="{ empty: !hasResult }" :style="hasResult ? boxStyle : undefined" @click.stop="togglePanel">
        <button v-if="hasResult" class="cv-frame-zoom nodrag" :title="t('nodes.action.detail')" @click.stop="onDetail" @mousedown.stop>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
        <img v-if="data.imageUrl" :src="canvasImageThumb(data.imageUrl, 260)" class="cv-frame-img" alt="" @load="onImgLoad" />
        <div v-else class="cv-frame-empty">
          <span class="cv-empty-icon"><LcIcon name="image" /></span>
          <span>{{ t('gen.node.emptyImage') }}</span>
        </div>
        <span v-if="isRunning" class="cv-frame-running" />
      </div>

      <div v-if="imageList.length > 1" class="cv-thumb-strip nodrag nowheel" @click.stop @mousedown.stop @wheel.stop>
        <button
          v-for="(url, i) in imageList"
          :key="url + i"
          class="cv-thumb"
          :class="{ active: url === data.imageUrl }"
          :title="t('gen.node.nthImage', { n: i + 1 })"
          @click.stop="selectImage(url)"
        >
          <img :src="canvasImageThumb(url, 96)" alt="" />
        </button>
      </div>

      <NodeResultHistory :node-id="id" :results="data.results" :result-index="data.resultIndex" kind="image" />

      <div v-if="displayError" class="cv-error nodrag" @click.stop @mousedown.stop>
        <div class="cv-error-msg nowheel">{{ displayError }}</div>
        <button v-if="status === 'error'" class="cv-retry" @click.stop="handleRun">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="publicUrlNotice" class="cv-notice clamp" :title="publicUrlNotice"><span>{{ publicUrlNotice }}</span></div>

      <!-- 预估成本固定在运行按钮正上方：运行前一定看得到 -->
      <div v-if="estimateText" class="cv-kv" :title="t('cost.estimateTip')">
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
      <button v-else class="cv-run nodrag" @click.stop="handleRun" @mousedown.stop>
        <LcIcon name="play" size="s" />{{ hasResult ? t('nodes.action.rerun') : t('nodes.action.run') }}
      </button>
    </div>

    <!-- 提示词面板：点提示词或画面时在节点下方滑出 -->
    <div v-if="panelOpen" class="cv-prompt-popover nodrag nowheel" @mousedown.stop @click.stop @wheel.stop>
      <NodeImageRefs
        :refs="imageRefs"
        :reorderable="refsReorderable"
        @insert="mention.insertAtEnd"
        @reorder="onRefsReorder"
        @rename="onRefRename"
      />
      <div class="cv-textarea-wrap">
        <textarea
          ref="promptInputRef"
          v-model="instruction"
          class="cv-prompt-textarea"
          :placeholder="t('gen.node.imageEditPlaceholder')"
          rows="5"
          maxlength="5000"
          @input="mention.onInput"
          @keydown="mention.onKeydown"
          @blur="mention.close"
          @keydown.escape="panelOpen = false"
        />
        <div class="cv-textarea-footer">
          <button class="cv-clear-btn" :disabled="!instruction" @click.stop="instruction = ''">{{ t('common.clear') }}</button>
          <span class="cv-footer-right">
            <button class="cv-zoom-btn nodrag" :title="t('nodes.action.expand')" @click.stop="openExpand" @mousedown.stop>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
            </button>
            <span class="cv-char-count">{{ instruction.length }} / 5000</span>
          </span>
        </div>
      </div>
    </div>

    <Handle id="image-out" type="source" :position="Position.Right" class="h-image h-top" />

    <!-- 放大编辑浮层：teleport 到 body 居中 -->
    <Teleport to="body">
      <div v-if="expanded" class="cv-prompt-popover expanded nodrag nowheel" @click.stop @mousedown.stop @wheel.stop>
        <button class="cv-popover-zoom" :title="t('nodes.action.collapse')" @click.stop="expanded = false">
          <LcIcon name="x" size="s" />
        </button>
        <div class="cv-textarea-wrap">
          <textarea
            ref="expandTextareaRef"
            v-model="instruction"
            class="cv-prompt-textarea"
            :placeholder="t('gen.node.imageEditPlaceholder')"
            maxlength="5000"
            @input="mention.onInput"
            @keydown="mention.onKeydown"
            @blur="mention.close"
            @keydown.escape="expanded = false"
          />
          <div class="cv-textarea-footer">
            <button class="cv-clear-btn" :disabled="!instruction" @click.stop="instruction = ''">{{ t('common.clear') }}</button>
            <span class="cv-char-count">{{ instruction.length }} / 5000</span>
          </div>
        </div>
      </div>
    </Teleport>

    <MentionPicker
      :open="mention.picker.open"
      :items="mention.matches()"
      :active="mention.picker.active"
      :x="mention.picker.x"
      :y="mention.picker.y"
      :width="mention.picker.width"
      @pick="mention.pick"
      @hover="mention.picker.active = $event"
    />

    <TaskDetailModal :open="detailOpen" type="image-edit" :data="data" @close="detailOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import NodeImageRefs from '@/components/canvas/NodeImageRefs.vue'
import MentionPicker from '@/components/canvas/MentionPicker.vue'
import { useMentionInput } from '@/composables/useMentionInput'
import { useEstimateCost } from '@/composables/useEstimateCost'
import { usePublicUrlNotice } from '@/composables/usePublicUrlNotice'
import { formatEstimate } from '@/utils/cost'
import type { Cost } from '@/types'
import {
  defaultModelId, getAdapter, listFlatModels, modelKeyOf, alignParams,
} from '@/utils/canvasModels'
import ChipSelect from './ChipSelect.vue'
import LcIcon from '@/components/LcIcon.vue'
import ImageParamsChip from './ImageParamsChip.vue'
import TaskDetailModal from './TaskDetailModal.vue'
import { canvasImageThumb } from '@/utils/canvasMedia'

import { CANVAS_BRAND_KIT_KEY } from '@/composables/canvasBrandKitKey'
import NodeResultHistory from './NodeResultHistory.vue'

const props = defineProps<{
  id: string
  data: {
    model?: string
    resolution?: string
    aspectRatio?: string
    count?: number
    instruction?: string
    status?: string
    progress?: number
    errorMsg?: string
    /** 上一次运行的实际成本，执行器写入 */
    cost?: Cost | null
    /** 按当前参数运行一次的预估成本 */
    estimatedCost?: Cost | null
    imageUrl?: string
    imageUrls?: string[]
    taskId?: string
    runPending?: boolean
    // 历次运行的产物，新的在最前；resultIndex 指向当前展示的是第几版
    results?: any[]
    resultIndex?: number
    // 挂在这个节点上的品牌包 id；空 = 不套用
    brandKitId?: string
    validationError?: string
    validationStamp?: number
    /** 输入图的顺序（存 ref key），用户在缩略图条上拖出来的 */
    imageOrder?: string[]
    /** 输入图的别名：ref key → 名字，提示词里 @ 用 */
    imageNames?: Record<string, string>
  }
  selected?: boolean
}>()

const { updateNodeData, onPaneClick, onNodeClick, onMoveStart, edges } = useVueFlow()
const executor = inject(CANVAS_EXECUTOR_KEY)
const { t } = useI18n()

// 模型清单来自后端、异步加载，下拉和默认模型都放在 computed 里跟着它变
const modelOpts = computed(() => listFlatModels('image'))
const fallbackModel = computed(() => defaultModelId('image'))
const currentModel = computed(() => props.data.model || fallbackModel.value)
const adapter = computed(() => getAdapter(currentModel.value))

// 节点还没选过模型时，把默认模型写进 data —— 执行器只认 data.model
watch(fallbackModel, (id) => {
  if (id && !props.data.model) updateNodeData(props.id, { model: id })
}, { immediate: true })

/**
 * 品牌包。分享页那种只读画布没有这个 provide，inject 得到 undefined，
 * 下面的选择器整块不渲染 —— 不用另外判断只读态。
 */
const brandKitCtx = inject(CANVAS_BRAND_KIT_KEY, undefined)
const brandKitList = computed(() => brandKitCtx?.list.value || [])
const brandKitId = computed<string>({
  // 挂着的品牌包已经被删了就显示「不套用」（执行器同样会当没挂），而不是露出一串 id
  get: () => {
    const id = props.data.brandKitId || ''
    return brandKitList.value.some((k: any) => k.id === id) ? id : ''
  },
  set: (v) => updateNodeData(props.id, { brandKitId: v }),
})
const brandKitRefCount = computed(() => {
  const k = brandKitList.value.find((x: any) => x.id === brandKitId.value)
  return k ? (k.refImages || []).length : 0
})
const brandKitMaxRefs = computed(() => adapter.value?.options.maxReferenceImages || 1)
const brandKitOptions = computed(() => [
  { value: '', label: t('gen.brandKit.none') },
  ...brandKitList.value.map((k: any) => ({ value: k.id, label: k.name })),
])

// 模型下拉：每个模型平铺一项
const modelKey = computed<string>({
  get: () => modelKeyOf(currentModel.value),
  set: (key) => {
    const opt = modelOpts.value.find(m => m.value === key)
    if (!opt || opt.modelId === props.data.model) return
    // 保留已生成的结果（主图/多图/成本）用于展示，只换模型并套用新模型的默认参数。
    // 已有产物时标记 stale：否则重新运行会因 isAlreadyDone 命中旧产物而被跳过（换了模型却没重跑）。
    updateNodeData(props.id, {
      ...(getAdapter(opt.modelId)?.defaults || {}),
      model: opt.modelId,
      ...(props.data.imageUrl ? { status: 'stale' } : {}),
    })
  }
})
// 节点上存的模型已经不在清单里（接入被停用等）时，下拉上照样显示它的标识，而不是空白
const modelLabel = computed(() =>
  modelOpts.value.find(m => m.value === modelKey.value)?.label || currentModel.value
)

const resolution = computed<string>({
  get: () => props.data.resolution || '',
  set: (v) => updateNodeData(props.id, { resolution: v })
})
const aspectRatio = computed<string>({
  get: () => props.data.aspectRatio || '',
  set: (v) => updateNodeData(props.id, { aspectRatio: v })
})
const count = computed<number>({
  get: () => Number(props.data.count) || 1,
  set: (v) => updateNodeData(props.id, { count: Number(v) || 1 })
})
const instruction = computed<string>({
  get: () => props.data.instruction || '',
  set: (v) => updateNodeData(props.id, { instruction: v })
})

const hasResult = computed(() => !!props.data.imageUrl)
const imageList = computed<string[]>(() => props.data.imageUrls || [])
// 运行按钮旁的预估成本：按当前参数运行一次要花多少，随模型/参数/数量实时变；
// 模型没配价格时显示「成本未知」
const estimateText = computed(() => formatEstimate(props.data.estimatedCost))

// ===== 固定比例图片框 =====
const FRAME_LONG = 230
const FRAME_MAX_H = 172
const naturalRatio = ref(0)
function onImgLoad(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) naturalRatio.value = img.naturalWidth / img.naturalHeight
}
const boxStyle = computed(() => {
  let ratioWH: number
  if (props.data.imageUrl && naturalRatio.value > 0) {
    // 已有产物：框贴合图片真实比例，不再受「比例」设置束缚
    ratioWH = naturalRatio.value
  } else {
    // 生成前的占位：按「比例」设置出框，未设时回退图片真实比例 / 1:1
    const r = aspectRatio.value
    if (r && r.includes(':')) {
      const [w, h] = r.split(':').map(Number)
      ratioWH = (w && h) ? w / h : (naturalRatio.value || 1)
    } else {
      ratioWH = naturalRatio.value || 1
    }
  }
  // 横图撑满卡片内宽；方图 / 竖图限高，免得一个节点占掉半屏
  let width = FRAME_LONG
  let height = Math.round(FRAME_LONG / ratioWH)
  if (height > FRAME_MAX_H) { height = FRAME_MAX_H; width = Math.round(FRAME_MAX_H * ratioWH) }
  return { width: `${width}px`, height: `${height}px` }
})

function selectImage(url: string) {
  if (!url || url === props.data.imageUrl) return
  updateNodeData(props.id, { imageUrl: url })
}

const detailOpen = ref(false)
function onDetail() { detailOpen.value = true }

// ===== 上下面板（同一个开关，点击图片切换）=====
const panelOpen = ref(false)
/* ── 输入图与 @ 指代 ── */
/**
 * 缩略图条和 @ 候选都读执行器的 collectImageRefs —— 必须和真正送出去的那份同源。
 * 各算各的迟早会漂：界面标「图2」、实际发的是另一张，这种 bug 最难查。
 * 只读画布（分享页）没有 provide 执行器，退化成空数组，整块不渲染。
 */
const imageRefs = computed(() => executor?.collectImageRefs(props.id) || [])
// 参考素材只能按公网地址交给上游、而实例没有公网地址：运行之前就说明
const publicUrlNotice = usePublicUrlNotice(props.id, adapter, imageRefs)
const refsReorderable = computed(() => true)

const mention = useMentionInput({
  refs: () => imageRefs.value,
  get: () => instruction.value,
  set: (v: string) => { instruction.value = v },
})

function onRefsReorder(keys: string[]) {
  updateNodeData(props.id, { imageOrder: keys })
}
function onRefRename({ key, name }: { key: string; name: string }) {
  const names = { ...(props.data.imageNames || {}) } as Record<string, string>
  // 清空就把这一条删掉，别在节点数据里留一堆空字符串
  if (name) names[key] = name
  else delete names[key]
  updateNodeData(props.id, { imageNames: names })
}

const promptInputRef = ref<HTMLTextAreaElement | null>(null)

// 放大编辑
const expanded = ref(false)
const expandTextareaRef = ref<HTMLTextAreaElement | null>(null)
function openExpand() {
  expanded.value = true
  nextTick(() => {
    const el = expandTextareaRef.value
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  })
}

// 面板收起时连带关掉放大编辑。面板开着时节点要压在别的节点上面，见 styles/base.css
watch(panelOpen, (v) => { if (!v) expanded.value = false })

function close() { panelOpen.value = false }

function togglePanel() {
  panelOpen.value = !panelOpen.value
  if (panelOpen.value) {
    nextTick(() => promptInputRef.value?.focus())
  }
}

function onDocClickClose(e: MouseEvent) {
  if (!panelOpen.value) return
  const el = e.target as HTMLElement
  if (el.closest('.cv-prompt-popover')) return
  // @ 候选框 Teleport 在 body，DOM 上不在气泡里，但点它不该算"点了外面"
  if (el.closest('.cv-mention')) return
  if (el.closest('.cv-top-panel')) return
  if (el.closest('.cv-frame')) return
  if (el.closest('.cv-well')) return
  if (el.closest('.chip-menu')) return
  close()
}

onPaneClick(() => close())
onMoveStart(() => close())
onNodeClick(({ node }) => { if (node.id !== props.id) close() })

onMounted(() => document.addEventListener('mousedown', onDocClickClose))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClickClose))

useEstimateCost(
  computed(() => {
    // 只估已经写进 data 的模型：执行器提交的也是 data 里那一份
    if (!props.data.model || !adapter.value) return null
    const params: Record<string, any> = {}
    if (props.data.resolution) params.resolution = props.data.resolution
    if (props.data.aspectRatio) params.aspectRatio = props.data.aspectRatio
    return { model: props.data.model, params, count: count.value }
  }),
  (cost) => updateNodeData(props.id, { estimatedCost: cost }),
)

const status = computed(() => props.data.status || 'idle')
const progress = computed(() => props.data.progress || 0)
const displayError = computed(() => props.data.validationError || props.data.errorMsg || '')
const isRunning = computed(() => status.value === 'running' || status.value === 'queued')
// 角上常驻状态标（顶部面板撤掉后，用户仍能一眼看出状态）
// 任务已经提交到后端、还没出结果时才有东西可取消（排队等上游、正在提交的那一小段没有）
const canCancel = computed(() => status.value === 'running' && props.data.runPending === true)
const statusLabel = computed(() => {
  if (status.value === 'stale') return t('nodes.status.stale')
  if (status.value === 'canceled') return t('nodes.status.canceled')
  if (status.value === 'queued') return t('nodes.status.queued')
  if (status.value === 'running') return t('nodes.status.running')
  if (status.value === 'error') return t('nodes.status.error')
  if (status.value === 'done' || hasResult.value) return t('nodes.status.done')
  return ''
})
const statusClass = computed(() => {
  if (status.value === 'error') return 'error'
  if (status.value === 'running' || status.value === 'queued') return 'running'
  if (status.value === 'stale' || status.value === 'canceled') return 'stale'
  return 'done'
})

const shaking = ref(false)
let shakeTimer: number | null = null
watch(() => props.data.validationStamp, (val) => {
  if (!val) return
  shaking.value = true
  if (shakeTimer) window.clearTimeout(shakeTimer)
  shakeTimer = window.setTimeout(() => { shaking.value = false; shakeTimer = null }, 1000)
})
onBeforeUnmount(() => { if (shakeTimer) window.clearTimeout(shakeTimer) })

watch(adapter, (a) => {
  if (!a) return
  const patch = alignParams(a, props.data)
  if (Object.keys(patch).length > 0) updateNodeData(props.id, patch)
}, { immediate: true })

async function handleRun() {
  if (!executor) return
  await executor.runSubtree(props.id)
}
function handleCancel() {
  void executor?.cancelNode(props.id)
}

/* ── 表头下方「输入口」各行的已连接数：只读，数的是真实连线 / 真正会送出去的图 ── */
const inCount = (handle: string) => edges.value.filter(e => e.target === props.id && e.targetHandle === handle).length
const textInCount = computed(() => inCount('text-in'))
const maxRefs = computed(() => adapter.value?.options.maxReferenceImages || 0)
const runningLabel = computed(() => {
  if (status.value === 'queued') return t('nodes.status.queued')
  // 上游报了进度才显示百分比；没报就只说「生成中」，不编数字
  return progress.value ? t('nodes.action.running', { progress: progress.value }) : t('gen.node.runningPlain')
})
</script>


<style scoped>
@import './node-shared.css';
.cv-gen { width: 256px; }
</style>
