<template>
  <div class="cv-node img-gen" :class="{
    selected,
    shaking,
    'has-validation-error': !!data.validationError,
    'has-runtime-error': status === 'error',
  }">
    <!-- 固定比例图片框：单击展开面板；成品图 hover 出放大看详情，角上常驻状态标 -->
    <div class="cv-frame" :style="boxStyle" @click.stop="togglePanel">
      <span v-if="statusLabel" class="cv-frame-status" :class="statusClass">{{ statusLabel }}</span>
      <button v-if="data.imageUrl" class="cv-frame-zoom nodrag" :title="t('nodes.action.detail')" @click.stop="onDetail" @mousedown.stop>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      </button>
      <img v-if="data.imageUrl" :src="canvasImageThumb(data.imageUrl, 260)" class="cv-frame-img" alt="" @load="onImgLoad" />
      <div v-else class="cv-frame-empty">
        <span class="cv-empty-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </span>
        <span>{{ t('nodes.action.clickToEdit') }}</span>
      </div>
      <span v-if="isRunning" class="cv-frame-running">{{ progress }}%</span>
      <button v-if="canCancel" class="cv-frame-cancel nodrag" @click.stop="handleCancel" @mousedown.stop>{{ t('nodes.action.cancel') }}</button>
    </div>

    <!-- 底部面板：点击图片时向下滑出 —— 多图选择 + 提示词 + 参数 + 运行 -->
    <div
      v-if="panelOpen"
      class="cv-prompt-popover nodrag nowheel"
      @mousedown.stop
      @click.stop
      @wheel.stop
    >
        <div
          v-if="imageList.length > 1"
          class="cv-thumb-strip"
          @click.stop
          @mousedown.stop
          @wheel.stop
        >
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

        <div v-if="brandKitCtx" class="cv-bk-row nodrag" @click.stop @mousedown.stop>
          <ChipSelect class="cv-bk-chip" label="" v-model="brandKitId" :options="brandKitOptions" />
          <span v-if="brandKitRefCount" class="cv-bk-hint">
            {{ t('gen.brandKit.refCount', { used: brandKitRefCount, max: brandKitMaxRefs }) }}
          </span>
          <button class="cv-bk-mng" :title="t('gen.brandKit.manage')" @click.stop="brandKitCtx.open()">{{ t('common.manage') }}</button>
        </div>

        <NodeResultHistory
          :node-id="id"
          :results="data.results"
          :result-index="data.resultIndex"
          kind="image"
        />

        <div v-if="displayError" class="cv-error">{{ displayError }}</div>

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
            v-model="prompt"
            class="cv-prompt-textarea"
            :placeholder="t('gen.node.imageGenPlaceholder')"
            rows="4"
            maxlength="5000"
            @input="mention.onInput"
            @keydown="mention.onKeydown"
            @blur="mention.close"
            @keydown.escape="panelOpen = false"
          />
          <div class="cv-textarea-footer">
            <button class="cv-clear-btn" :disabled="!prompt" @click.stop="prompt = ''">{{ t('common.clear') }}</button>
            <span class="cv-footer-right">
              <button class="cv-zoom-btn nodrag" :title="t('nodes.action.expand')" @click.stop="openExpand" @mousedown.stop>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
              <span class="cv-char-count">{{ prompt.length }} / 5000</span>
            </span>
          </div>
        </div>

        <div class="cv-popover-toolbar">
          <ChipSelect v-if="modelOpts.length" :label="t('nodes.field.model')" v-model="modelKey" :options="modelOpts" :display-value="modelLabel" />
          <span v-else class="cv-no-model">{{ t('models.none') }}</span>
          <ImageParamsChip
            v-if="adapter"
            :resolutions="adapter.options.resolutions"
            :aspect-ratios="adapter.options.aspectRatios"
            :counts="adapter.options.counts"
            v-model:resolution="resolution"
            v-model:aspect-ratio="aspectRatio"
            v-model:count="count"
          />
          <span v-if="estimateText" class="cv-run-cost" :title="t('cost.estimateTip')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /></svg>
            {{ estimateText }}
          </span>
          <button
            class="cv-run-icon nodrag"
            :disabled="isRunning"
            :title="isRunning ? t('nodes.action.running', { progress }) : t('nodes.action.run')"
            @click.stop="handleRun"
            @mousedown.stop
          >
            <span v-if="isRunning" class="cv-run-pct">{{ progress }}%</span>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="20" x2="12" y2="5" />
              <polyline points="6 11 12 5 18 11" />
            </svg>
          </button>
        </div>
    </div>

    <Handle id="text-in" type="target" :position="Position.Left" class="h-text" :style="{ top: '38%', left: handleInset }" />
    <Handle id="image-in" type="target" :position="Position.Left" class="h-image" :style="{ top: '50%', left: handleInset }" />
    <Handle id="image-out" type="source" :position="Position.Right" class="h-image" :style="{ right: handleInset }" />

    <!-- 放大编辑浮层：teleport 到 body 居中 -->
    <Teleport to="body">
      <div
        v-if="expanded"
        class="cv-prompt-popover expanded nodrag nowheel"
        @click.stop
        @mousedown.stop
        @wheel.stop
      >
        <button class="cv-popover-zoom" :title="t('nodes.action.collapse')" @click.stop="expanded = false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
        <div class="cv-textarea-wrap">
          <textarea
            ref="expandTextareaRef"
            v-model="prompt"
            class="cv-prompt-textarea"
            :placeholder="t('gen.node.imageGenPlaceholder')"
            maxlength="5000"
            @input="mention.onInput"
            @keydown="mention.onKeydown"
            @blur="mention.close"
            @keydown.escape="expanded = false"
          />
          <div class="cv-textarea-footer">
            <button class="cv-clear-btn" :disabled="!prompt" @click.stop="prompt = ''">{{ t('common.clear') }}</button>
            <span class="cv-char-count">{{ prompt.length }} / 5000</span>
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

    <TaskDetailModal
      :open="detailOpen"
      type="image-gen"
      :data="data"
      @close="detailOpen = false"
    />

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
import { formatEstimate } from '@/utils/cost'
import type { Cost } from '@/types'
import {
  defaultModelId, getAdapter, listFlatModels, modelKeyOf, alignParams,
} from '@/utils/canvasModels'
import ChipSelect from './ChipSelect.vue'
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
    prompt?: string
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

const { updateNodeData, onPaneClick, onNodeClick, onMoveStart } = useVueFlow()
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
const prompt = computed<string>({
  get: () => props.data.prompt || '',
  set: (v) => updateNodeData(props.id, { prompt: v })
})

const hasResult = computed(() => !!props.data.imageUrl)
const imageList = computed<string[]>(() => props.data.imageUrls || [])
// 运行按钮旁的预估成本：按当前参数运行一次要花多少，随模型/参数/数量实时变；
// 模型没配价格时显示「成本未知」
const estimateText = computed(() => formatEstimate(props.data.estimatedCost))

// ===== 固定比例图片框 =====
// 框按节点「比例」设置出尺寸（无黑边）；比例为 auto/未设时用图片真实比例兜底。
const FRAME_LONG = 240
const naturalRatio = ref(0) // 实际图片 宽/高
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
      ratioWH = naturalRatio.value || 1 // auto
    }
  }
  let width: number, height: number
  if (ratioWH >= 1) { width = FRAME_LONG; height = Math.round(FRAME_LONG / ratioWH) }
  else { height = FRAME_LONG; width = Math.round(FRAME_LONG * ratioWH) }
  return { width: `${width}px`, height: `${height}px` }
})

// 端口内缩：外框已裹住画面（内容宽=画面宽），端口只需内移一个内边距即贴到画面边缘。
const handleInset = '10px'

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
 * 缩略图条和 @ 候选都读执行器的 collectImageRefs —— 必须和真正送出去的那份
 * 同源，各算各的迟早会漂：界面标「图2」、实际发的是另一张，这种最难查。
 * 只读画布（分享页）没有 provide 执行器，退化成空数组，整块不渲染。
 */
const imageRefs = computed(() => executor?.collectImageRefs(props.id) || [])
const refsReorderable = computed(() => true)

const mention = useMentionInput({
  refs: () => imageRefs.value,
  get: () => prompt.value,
  set: (v: string) => { prompt.value = v },
})

function onRefsReorder(keys: string[]) {
  updateNodeData(props.id, { imageOrder: keys })
}
function onRefRename({ key, name }: { key: string; name: string }) {
  const names = { ...(props.data.imageNames || {}) } as Record<string, string>
  // 清空就把这一条删掉，别留一堆空字符串在节点数据里
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
  if (el.closest('.chip-menu')) return
  close()
}

// Vue Flow 的 pane 用 pointer capture，document mousedown 在画布内拿不到，用事件钩子兜底
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
  if (status.value === 'running') return `${progress.value}%`
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

// 校验失败：每次 validationStamp 变化都重启抖动；红边框由 has-validation-error 持续展示
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
</script>

<style scoped>
@import './node-shared.css';

/* 品牌包选择器：贴着面板顶部，一行放下下拉、额度提示和管理入口 */
.cv-bk-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.cv-bk-sel {
  flex: 1; min-width: 0; background: var(--n-2); border: 1px solid var(--n-5);
  border-radius: 5px; color: var(--t-body); font-size: 11.5px; padding: 3px 6px; outline: none;
}
.cv-bk-sel:focus { border-color: var(--accent-text); }
.cv-bk-hint { font-size: 10px; color: var(--t-dim); white-space: nowrap; }
.cv-bk-mng {
  background: none; border: 1px solid var(--n-5); border-radius: 5px;
  color: var(--t-dim); font-size: 10.5px; padding: 2px 7px; cursor: pointer; white-space: nowrap;
}
.cv-bk-mng:hover { border-color: var(--accent-text); color: var(--accent-text); }
/* 外框裹住图片：宽度跟着 .cv-frame（按图片真实比例出尺寸）走，
   覆盖 .cv-node 默认的 min-width:240，竖版/方图不再留大黑边 */
.img-gen { width: fit-content; min-width: 0; max-width: none; align-items: center; }
/* 外框收窄后，展开面板改固定宽度居中（left calc 居中，避开弹出动画的 transform 冲突） */
.img-gen .cv-prompt-popover:not(.expanded) {
  left: calc(50% - 240px);
  right: auto;
  width: 480px;
}
.img-gen .cv-top-panel {
  left: calc(50% - 160px);
  right: auto;
  width: 320px;
}

/* 角上常驻状态标 */
.cv-frame-status {
  position: absolute; top: 6px; right: 6px; z-index: 3;
  font-size: 10px; line-height: 1; padding: 3px 7px; border-radius: 999px;
  background: rgba(0,0,0,.5); color: #fff; pointer-events: none;
}
.cv-frame-status.done { background: color-mix(in srgb, var(--success, #16a34a) 82%, transparent); }
.cv-frame-status.running { background: color-mix(in srgb, var(--accent-text) 82%, transparent); color: var(--n-black, #111); }
.cv-frame-status.error { background: color-mix(in srgb, var(--danger, #dc2626) 85%, transparent); }
.cv-frame-status.stale { background: rgba(120,120,120,.7); }
/* hover 才出的放大按钮（看详情） */
.cv-frame-zoom {
  position: absolute; top: 6px; left: 6px; z-index: 3;
  width: 28px; height: 28px; border: 0; border-radius: 8px; cursor: pointer;
  background: rgba(0,0,0,.55); color: #fff; display: grid; place-items: center;
  opacity: 0; transition: opacity .15s ease;
}
.cv-frame-zoom svg { width: 15px; height: 15px; }
.cv-frame:hover .cv-frame-zoom { opacity: 1; }
.cv-frame-zoom:hover { background: rgba(0,0,0,.8); }
/* 文本域脚注：放大按钮贴着字数 */
.cv-footer-right { display: inline-flex; align-items: center; gap: 6px; }
.cv-zoom-btn {
  border: 0; background: transparent; color: var(--t-dim); cursor: pointer;
  width: 20px; height: 20px; display: grid; place-items: center; border-radius: 5px; pointer-events: auto;
}
.cv-zoom-btn:hover { color: var(--accent-text); background: var(--n-4); }
.cv-zoom-btn svg { width: 14px; height: 14px; }
/* 品牌包 chip 占满一行左侧 */
.cv-bk-chip { flex: 1; min-width: 0; }
/* 一个可用模型都没有时，顶替模型下拉的提示 */
.cv-no-model { font-size: 11px; color: var(--t-dim); white-space: nowrap; }
</style>
