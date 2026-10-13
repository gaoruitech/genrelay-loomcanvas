<template>
  <div class="cv-node cv-tool" :class="{ selected, 'is-running': status === 'running', 'has-runtime-error': status === 'error' }">
    <Handle id="image-in" type="target" :position="Position.Left" class="h-image h-top" v-tip="{ text: t('tools.input.one'), placement: 'left' }" />

    <div class="cv-head">
      <LcIcon name="layout" />
      <span class="cv-title">{{ t('nodes.title.slice') }}</span>
      <span class="cv-help" tabindex="0" role="note" v-tip="t('tools.slice.help')" :aria-label="t('tools.slice.help')">?</span>
      <span v-if="status === 'running'" class="cv-tag running">{{ t('tools.slice.running') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
      <span v-else-if="items.length" class="cv-tag done">{{ t('tools.slice.count', { n: items.length }) }}</span>
      <span v-tip="{ text: t('cost.free'), clipped: true }" class="cv-head-x">{{ t('cost.free') }}</span>
    </div>

    <div class="cv-body nodrag nowheel" @mousedown.stop @click.stop>
      <!-- 只读：设置是一行字（切成几乘几、共几块），不摆点不动的预设和输入框 -->
      <dl v-if="ro" class="cv-ro" data-testid="tool-ro">
        <div><dt>{{ t('nodeui.ro.grid') }}</dt><dd>{{ gridText }} · {{ t('tools.slice.count', { n: count }) }}</dd></div>
      </dl>
      <template v-else>
      <div class="cv-presets">
        <button
          v-for="p in SLICE_PRESETS" :key="p.key"
          class="cv-gbtn" :class="{ on: p.cols === cols && p.rows === rows }"
          @click="setGrid(p.cols, p.rows)"
        >{{ p.label }}</button>
      </div>

      <div class="cv-row">
        <span class="cv-label">{{ t('tools.slice.custom') }}</span>
        <input class="cv-num" type="number" min="1" max="6" :value="cols" :aria-label="t('nodeui.ro.cols')" @change="onNum('cols', $event)" />
        <span class="cv-val" style="width:12px">×</span>
        <input class="cv-num" type="number" min="1" max="6" :value="rows" :aria-label="t('nodeui.ro.rows')" @change="onNum('rows', $event)" />
        <span class="cv-val cv-val-auto">{{ t('tools.slice.count', { n: count }) }}</span>
      </div>
      </template>

      <div v-if="displayError" class="cv-error"><div class="cv-error-msg">{{ displayError }}</div></div>

      <div v-if="items.length" class="cv-grid">
        <button
          v-for="(it, i) in items" :key="it.key"
          class="cv-cell" v-tip="`${cellLabel(i)} · ${it.width}×${it.height} · ${t('common.download')}`" :aria-label="`${cellLabel(i)} · ${it.width}×${it.height} · ${t('common.download')}`"
          @click="download(it)"
        >
          <img :src="canvasImageThumb(it.url, 120)" :alt="cellLabel(i)" />
          <span class="cv-cap">{{ cellLabel(i) }}</span>
        </button>
      </div>
      <div v-else class="cv-empty">{{ ro ? t('nodeui.share.noResult') : t('tools.slice.empty') }}</div>

      <div v-if="!ro || items.length" class="cv-actions" :class="{ ro }">
        <button v-if="!ro" class="cv-run" :disabled="status === 'running'" @click="run">
          {{ status === 'running' ? t('tools.slice.runningBtn') : t('nodes.title.slice') }}
        </button>
        <button v-if="items.length" class="cv-dl" @click="downloadAll">{{ t('tools.downloadAll') }}</button>
      </div>
    </div>

    <Handle id="image-out" type="source" :position="Position.Right" class="h-image h-top" v-tip="{ text: t('tools.slice.output'), placement: 'right' }" />
  </div>
</template>

<script setup lang="ts">
/**
 * 切片：把一张图等分成 N 块。
 *
 * 等分边界在后端用 round(i*总长/份数) 累进算，各块加起来正好是原图，边缘不丢像素。
 *
 * 这里只做「把图剁开」这一件事 —— 发小红书九宫格那种用法，原图是什么内容都成立。
 * 它不负责「把 AI 生成的宫格图还原成单张产品图」：那个要求原图真的是规整网格，
 * 自由排布的拼贴切出来全是废的。
 */
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import LcIcon from '@/components/LcIcon.vue'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { SLICE_PRESETS, sliceCount } from '@/composables/canvasToolsSpec'
import { useCanvasReadOnly } from '@/composables/nodeLayout'

interface SliceItem { key: string; label: string; url: string; width: number; height: number }

const props = defineProps<{
  id: string
  data: {
    cols?: number
    rows?: number
    status?: string
    errorMsg?: string
    validationError?: string
    imageUrl?: string
    imageUrls?: string[]
    sliceItems?: SliceItem[]
  }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData } = useVueFlow()
const executor = inject(CANVAS_EXECUTOR_KEY)
/** 只读（别人正在编辑、只有查看权）：能看结果、能下载，不能改份数、不能切 */
const ro = useCanvasReadOnly()

const status = computed(() => props.data.status || 'idle')
const cols = computed(() => Number(props.data.cols) || 3)
const rows = computed(() => Number(props.data.rows) || 3)
const count = computed(() => sliceCount(cols.value, rows.value))
const items = computed<SliceItem[]>(() => props.data.sliceItems || [])
const displayError = computed(() => props.data.validationError || props.data.errorMsg || '')

// 格子的名字按顺序在前端出（后端返回的 label 是固定一种语言的），切语言跟着变
const cellLabel = (i: number) => t('tools.slice.cell', { n: i + 1 })

/** 换了份数，之前切的那批就对不上了，一起清掉 —— 留着会让人以为那是新份数的产物 */
/** 「九宫格」这样的叫法；不是预设里的就写 4 × 2 */
const gridText = computed(() => SLICE_PRESETS.find((p) => p.cols === cols.value && p.rows === rows.value)?.label || `${cols.value} × ${rows.value}`)

function setGrid(c: number, r: number) {
  if (ro.value || (c === cols.value && r === rows.value)) return
  updateNodeData(props.id, {
    cols: c, rows: r,
    sliceItems: [], imageUrls: [], imageUrl: '',
    status: 'idle', errorMsg: '',
  })
}

function onNum(field: 'cols' | 'rows', e: Event) {
  const v = Math.min(6, Math.max(1, Math.round(Number((e.target as HTMLInputElement).value) || 1)))
  setGrid(field === 'cols' ? v : cols.value, field === 'rows' ? v : rows.value)
}

function run() { if (!ro.value) void executor?.runNode(props.id) }

function download(it: SliceItem) {
  void downloadCanvasAsset(it.url, `${it.key}_${it.width}x${it.height}`, 'image')
}
async function downloadAll() {
  for (const it of items.value) {
    await downloadCanvasAsset(it.url, `${it.key}_${it.width}x${it.height}`, 'image')
  }
}
</script>

<style scoped>
@import './tool-node.css';
/* 「N 块」在英文下比固定宽度长，放开宽度 */
.cv-val-auto { width: auto; white-space: nowrap; }
</style>
