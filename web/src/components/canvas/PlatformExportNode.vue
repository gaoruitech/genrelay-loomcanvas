<template>
  <div class="cv-node cv-surface" :class="{ selected }">
    <Handle id="image-in" type="target" :position="Position.Left" class="h-image" :title="t('tools.input.hero')" />

    <div class="cv-head">
      <span class="cv-title">{{ t('nodes.title.platformExport') }}</span>
      <span class="cv-help" :title="t('tools.platformExport.help')">?</span>
      <span v-if="status === 'running'" class="cv-tag running">{{ t('tools.platformExport.running') }}</span>
      <span v-else-if="status === 'error'" class="cv-tag error">{{ t('nodes.status.error') }}</span>
      <span v-else-if="items.length" class="cv-tag done">{{ t('tools.platformExport.count', { n: items.length }) }}</span>
      <span class="cv-free" :title="t('cost.free')">{{ t('cost.free') }}</span>
    </div>

    <div class="cv-body nodrag nowheel" @mousedown.stop @click.stop>
      <div class="cv-group">
        <button
          v-for="g in GROUPS" :key="g.value"
          class="cv-gbtn" :class="{ on: group === g.value }"
          @click="group = g.value"
        >{{ g.label }}</button>
      </div>

      <div v-if="displayError" class="cv-err">{{ displayError }}</div>

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

    <Handle id="image-out" type="source" :position="Position.Right" class="h-image" :title="t('tools.platformExport.output')" />
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
.cv-node {
  width: 280px; height: 300px; display: flex; flex-direction: column;
  background: var(--n-3); border: 1.5px solid var(--n-5);
  border-radius: 10px; overflow: hidden; color: var(--t-body);
  box-shadow: 0 4px 16px var(--shadow-2);
}
.cv-node.selected { border-color: var(--accent-text); }

.cv-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--n-5); }
.cv-title { font-size: 12.5px; font-weight: 600; color: var(--t-max); white-space: nowrap; }
/* 标题和状态标签在英文下更长：让「无成本」这句先被截断，鼠标悬停看全文 */
.cv-free { margin-left: auto; font-size: 9.5px; color: var(--t-dim); min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cv-tag { font-size: 10px; padding: 1px 6px; border-radius: 100px; border: 1px solid var(--n-5); flex: none; white-space: nowrap; }
.cv-tag.running { color: var(--accent-text); border-color: var(--accent-text); }
.cv-tag.error { color: #e06a5c; border-color: #e06a5c; }
.cv-tag.done { color: var(--t-dim); }

.cv-body { padding: 9px 10px; display: flex; flex-direction: column; gap: 8px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }

.cv-group { display: flex; gap: 4px; }
.cv-gbtn {
  flex: 1; background: var(--n-2); border: 1px solid var(--n-5); border-radius: 5px;
  color: var(--t-dim); font-size: 11px; padding: 3px 0; cursor: pointer;
}
.cv-gbtn.on { border-color: var(--accent-text); color: var(--accent-text); }

.cv-err { font-size: 11px; color: #e06a5c; line-height: 1.6; }
.cv-empty { font-size: 11px; color: var(--t-dim); line-height: 1.6; padding: 6px 0; flex: 1 1 auto; display: flex; align-items: center; justify-content: center; text-align: center; }
.cv-help {margin-left:2px;width:14px;height:14px;border-radius:50%;border:1px solid var(--n-6);color:var(--t-dim);font-size:10px;line-height:12px;text-align:center;cursor:help;flex:none;}
.cv-help:hover { color: var(--accent-text); border-color: var(--accent-text); }

/* 结果多了（九宫格切片）只让这一块滚动，下面的运行 / 下载按钮始终留在节点里 */
.cv-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px;
  flex: 0 1 auto; min-height: 56px; overflow-y: auto;
}
.cv-cell {
  padding: 0; border: 1px solid var(--n-5); border-radius: 5px; overflow: hidden;
  background: var(--n-2); cursor: pointer; display: flex; flex-direction: column;
}
.cv-cell:hover { border-color: var(--accent-text); }
.cv-cell img { width: 100%; height: 40px; object-fit: cover; display: block; }
.cv-cap { font-size: 8.5px; color: var(--t-dim); padding: 2px 1px; line-height: 1.2; }

.cv-white { font-size: 10px; color: var(--t-dim); line-height: 1.6; }
.cv-white.bad { color: #d8a03a; }

.cv-actions { display: flex; gap: 6px; margin-top: auto; flex: none; }
.cv-run {
  flex: 1; background: transparent; color: var(--accent-text); border: 1.5px solid var(--accent-edge);
  border-radius: 8px; font-size: 12px; font-weight: 600; padding: 7px 0; cursor: pointer;
}
.cv-run:disabled { opacity: .6; cursor: not-allowed; }
.cv-dl {
  background: var(--n-2); border: 1px solid var(--n-5); border-radius: 6px;
  color: var(--t-body); font-size: 11.5px; padding: 4px 9px; cursor: pointer;
}
.cv-dl:hover { border-color: var(--accent-text); color: var(--accent-text); }

</style>
