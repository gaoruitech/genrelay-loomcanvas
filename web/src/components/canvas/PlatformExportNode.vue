<template>
  <div class="cv-node cv-tool" :class="{ selected, 'is-running': status === 'running', 'has-runtime-error': status === 'error' }">
    <Handle id="image-in" type="target" :position="Position.Left" class="h-image h-top" :title="t('tools.input.hero')" />

    <div class="cv-head">
      <LcIcon name="share" />
      <span class="cv-title">{{ t('nodes.title.platformExport') }}</span>
      <span class="cv-help" :title="t('tools.platformExport.help')">?</span>
      <span v-if="status === 'running'" class="cv-tag running">{{ t('tools.platformExport.running') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
      <span v-else-if="items.length" class="cv-tag done">{{ t('tools.platformExport.count', { n: items.length }) }}</span>
      <span class="cv-head-x" :title="t('cost.free')">{{ t('cost.free') }}</span>
    </div>

    <div class="cv-body nodrag nowheel" @mousedown.stop @click.stop>
      <div class="cv-group">
        <button
          v-for="g in GROUPS" :key="g.value"
          class="cv-gbtn" :class="{ on: group === g.value }"
          @click="group = g.value"
        >{{ g.label }}</button>
      </div>

      <div v-if="displayError" class="cv-error"><div class="cv-error-msg">{{ displayError }}</div></div>

      <div v-if="items.length" class="cv-grid">
        <button
          v-for="it in items" :key="it.key"
          class="cv-cell" :title="`${itemLabel(it)} · ${it.width}×${it.height}`"
          @click="download(it)"
        >
          <img :src="canvasImageThumb(it.url, 120)" :alt="itemLabel(it)" />
          <span class="cv-cap">{{ itemLabel(it) }}</span>
        </button>
      </div>
      <div v-else class="cv-empty">{{ t('tools.platformExport.empty') }}</div>

      <div v-if="whiteBgCheck" class="cv-white" :class="{ bad: !whiteBgCheck.pure }">
        <template v-if="whiteBgCheck.pure">{{ t('tools.platformExport.whiteOk') }}</template>
        <template v-else>{{ t('tools.platformExport.whiteBad', { pct: Math.round((whiteBgCheck.score || 0) * 100) }) }}</template>
      </div>

      <div class="cv-actions">
        <button class="cv-run" :disabled="status === 'running'" @click="run">
          {{ status === 'running' ? t('tools.platformExport.runningBtn') : t('tools.platformExport.run') }}
        </button>
        <button v-if="items.length" class="cv-dl" @click="downloadAll">{{ t('tools.downloadAll') }}</button>
      </div>
    </div>

    <Handle id="image-out" type="source" :position="Position.Right" class="h-image h-top" :title="t('tools.platformExport.output')" />
  </div>
</template>

<script setup lang="ts">
/**
 * 多平台导出：一张主视觉出一整组平台主图。
 *
 * 尺寸表、白底净化、纯白检测三样都在后端做，这个节点只负责发起和展示。
 *
 * 全程本机像素处理、不调模型，所以没有成本 —— 这一点在界面上明说，
 * 免得用户以为点一下要花钱而不敢试。运行按钮也因此用描边样式
 * （实心 = 调用付费模型，描边 = 本机处理/免费）。
 */
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import LcIcon from '@/components/LcIcon.vue'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import {
  switchGroupPatch,
  type ExportItem, type ExportGroup, type GroupSnapshot,
} from '@/composables/platformExportGroups'

const props = defineProps<{
  id: string
  data: {
    group?: 'domestic' | 'overseas'
    status?: string
    errorMsg?: string
    validationError?: string
    imageUrl?: string
    imageUrls?: string[]
    exportItems?: ExportItem[]
    whiteBgCheck?: { pure: boolean; score: number } | null
    /** 两个分组各自的结果，换组时不互相冲掉 */
    exportByGroup?: Partial<Record<ExportGroup, GroupSnapshot>>
  }
  selected?: boolean
}>()

const { t, te } = useI18n()

// 尺寸的名字按 key 在前端出（后端返回的 label 是固定一种语言的）；认不出的 key 才用后端给的
function itemLabel(it: ExportItem): string {
  const key = `tools.platformExport.items.${it.key}`
  return te(key) ? t(key) : it.label
}

const GROUPS = computed(() => [
  { value: 'domestic' as const, label: t('tools.platformExport.domestic') },
  { value: 'overseas' as const, label: t('tools.platformExport.overseas') },
])

const { updateNodeData } = useVueFlow()
const executor = inject(CANVAS_EXECUTOR_KEY)

const status = computed(() => props.data.status || 'idle')
const items = computed<ExportItem[]>(() => props.data.exportItems || [])
const whiteBgCheck = computed(() => props.data.whiteBgCheck || null)
const displayError = computed(() => props.data.validationError || props.data.errorMsg || '')

const group = computed<ExportGroup>({
  get: () => (props.data.group === 'overseas' ? 'overseas' : 'domestic'),
  /**
   * 换组不清空另一组的结果。
   *
   * 早先这里是直接清空的（理由是「换组等于换一整套尺寸，旧结果作废」），
   * 结果导完跨境点回国内看一眼，跨境那一组就没了，等于白跑一次。
   * 现在切走时把当前这组收起来，切回来再放出来 —— 见 platformExportGroups.ts。
   */
  set: (v) => {
    const patch = switchGroupPatch(props.data, v)
    if (patch) updateNodeData(props.id, patch)
  },
})

function run() {
  void executor?.runNode(props.id)
}

function download(it: ExportItem) {
  void downloadCanvasAsset(it.url, `${it.key}_${it.width}x${it.height}`, 'image')
}

async function downloadAll() {
  // 一组最多四张，逐个下载可以接受，不必为它单开打包接口
  for (const it of items.value) {
    await downloadCanvasAsset(it.url, `${it.key}_${it.width}x${it.height}`, 'image')
  }
}
</script>

<style scoped>
@import './tool-node.css';
.cv-group { display: flex; gap: 6px; }
.cv-group .cv-gbtn { flex: 1; }
.cv-white { font-size: 11px; color: var(--text-3); line-height: 1.6; }
.cv-white.bad { color: var(--warn); }
</style>
