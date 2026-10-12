<template>
  <div v-if="batch.open.value" class="lc-mask lc-sheet br-mask" @click.self="requestClose">
    <div class="lc-dialog br-modal">
      <div class="lc-dialog-head">
        <span class="br-title">{{ t('dialogs.batch.title') }}<span class="br-sub">{{ t('dialogs.batch.subtitle') }}</span></span>
        <button class="lc-x" :title="t('common.close')" @click="requestClose">×</button>
      </div>

      <!-- ========== 配置阶段 ========== -->
      <div v-if="!batch.items.value.length" class="lc-dialog-body br-body">
        <p class="br-tip">{{ t('dialogs.batch.intro') }}</p>

        <div class="br-step">
          <div class="br-step-h"><b>{{ t('dialogs.batch.varSlot') }}</b><span>{{ t('dialogs.batch.varSlotHint') }}</span></div>
          <div v-if="!batch.varCandidates.value.length" class="br-empty">
            {{ t('dialogs.batch.noImageNode') }}
          </div>
          <div v-else class="br-varlist">
            <button
              v-for="(n, i) in batch.varCandidates.value"
              :key="n.id"
              class="br-var"
              :class="{ on: batch.varNodeId.value === n.id }"
              @click="batch.varNodeId.value = n.id"
            >
              <img v-if="n.data?.imageUrl" :src="canvasImageThumb(n.data.imageUrl, 96)" alt="" />
              <span v-else class="br-var-blank">{{ t('dialogs.batch.blank') }}</span>
              <span class="br-var-cap">{{ t('dialogs.batch.imageN', { n: i + 1 }) }}</span>
            </button>
          </div>
        </div>

        <div class="br-step">
          <div class="br-step-h">
            <b>{{ t('dialogs.batch.sources') }}</b>
            <span>{{ t('dialogs.batch.sourcesCount', { n: batch.sources.value.length, max: MAX_BATCH_SOURCES }) }}</span>
          </div>
          <div class="br-actions">
            <button v-if="$feat.assetLibrary" class="lc-btn sm" :disabled="picking" @click="pickFromLibrary">{{ t('nodes.action.pickFromLibrary') }}</button>
            <button class="lc-btn sm" :disabled="uploading" @click="fileInput?.click()">
              {{ uploading ? t('common.uploading') : t('dialogs.batch.uploadLocal') }}
            </button>
            <button
              v-if="batch.sources.value.length"
              class="lc-btn sm ghost"
              @click="batch.clearSources()"
            >{{ t('common.clear') }}</button>
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              multiple
              hidden
              @change="onFiles"
            />
          </div>
          <div v-if="batch.sources.value.length" class="br-srcgrid">
            <div v-for="s in batch.sources.value" :key="s.url" class="br-src">
              <img :src="canvasImageThumb(s.url, 96)" :alt="s.name" />
              <button class="br-src-x" :title="t('common.remove')" @click="batch.removeSource(s.url)">×</button>
            </div>
          </div>
        </div>

        <div class="br-cost">
          <div class="br-cost-main">
            <span class="br-cost-u">{{ t('cost.estimate') }}</span>
            <span class="br-cost-n">{{ totalText }}</span>
          </div>
          <div v-if="batch.costIsPartial.value" class="br-cost-hint">{{ t('dialogs.batch.costUnknownHint') }}</div>
          <div class="br-cost-sub">{{ breakdownText }}</div>
        </div>

        <div v-if="problem" class="lc-alert warn br-warn">{{ problem }}</div>
      </div>

      <!-- ========== 运行 / 结果阶段 ========== -->
      <div v-else class="lc-dialog-body br-body">
        <div class="br-progress">
          <div class="br-progress-bar">
            <div class="br-progress-fill" :style="{ width: progressPct + '%' }" />
          </div>
          <div class="br-progress-txt">
            <span v-if="batch.running.value">
              {{ t('dialogs.batch.progressRunning', { current: batch.currentIndex.value + 1, total: batch.items.value.length }) }}<template v-if="batch.stopping.value">{{ t('dialogs.batch.stoppingAfterRound') }}</template>
            </span>
            <span v-else>
              {{ t('dialogs.batch.finished', { done: batch.doneCount.value, failed: batch.failedCount.value }) }}<template v-if="spentText">{{ t('dialogs.batch.spent', { cost: spentText }) }}</template>
            </span>
          </div>
        </div>

        <p v-if="batch.running.value" class="br-tip">{{ t('dialogs.batch.runningTip') }}</p>

        <div class="br-rows">
          <div
            v-for="(it, i) in batch.items.value"
            :key="it.url + i"
            class="br-row"
            :class="it.status"
          >
            <img class="br-row-src" :src="canvasImageThumb(it.url, 96)" alt="" />
            <div class="br-row-mid">
              <div class="br-row-top">
                <span class="br-row-n">#{{ i + 1 }}</span>
                <span class="br-row-st">{{ statusText(it.status) }}</span>
                <span v-if="it.cost" class="br-row-pt">{{ formatCost(it.cost) }}</span>
              </div>
              <div v-if="it.error" class="br-row-err">{{ it.error }}</div>
              <div v-else-if="it.outputs.length" class="br-outs">
                <button
                  v-for="(o, k) in it.outputs"
                  :key="o.url + k"
                  class="br-out"
                  :title="t('dialogs.batch.downloadItem')"
                  @click="downloadOne(o, i, k)"
                >
                  <img v-if="o.kind === 'image'" :src="canvasImageThumb(o.url, 96)" alt="" />
                  <span v-else class="br-out-film">{{ t('nodes.title.video') }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="lc-dialog-foot br-foot">
        <template v-if="!batch.items.value.length">
          <button class="lc-btn" @click="requestClose">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary quiet" :disabled="!!problem" @click="batch.start()">
            {{ t('dialogs.batch.start') }}
          </button>
        </template>
        <template v-else>
          <button
            v-if="batch.running.value"
            class="lc-btn"
            :disabled="batch.stopping.value"
            @click="batch.stop()"
          >{{ batch.stopping.value ? t('dialogs.batch.stopping') : t('dialogs.batch.stop') }}</button>
          <template v-else>
            <button class="lc-btn" @click="batch.reset()">{{ t('dialogs.batch.reconfigure') }}</button>
            <button
              v-if="batch.originalUrl.value"
              class="lc-btn"
              @click="batch.restoreVarNode()"
            >{{ t('dialogs.batch.restoreVar') }}</button>
            <button
              class="lc-btn primary quiet"
              :disabled="!batch.allOutputs.value.length || downloading"
              @click="downloadAll"
            >
              {{ downloading ? t('dialogs.batch.downloading') : t('dialogs.batch.downloadAll', { n: batch.allOutputs.value.length }) }}
            </button>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 批量运行的配置 + 进度 + 结果面板。
 *
 * 只做界面，编排全在 useCanvasBatch 里 —— 那边由画布实例化并把整个对象传进来，
 * 和执行器走同一个模式（画布持有、组件消费），免得这里再 useVueFlow 一次
 * 拿到另一个 store 实例。
 */
import { ref, computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin, DialogPlugin } from '@/utils/feedback'
import { canvasImageThumb } from '@/utils/canvasMedia'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { MAX_BATCH_SOURCES, type CanvasBatch, type BatchOutput, type BatchItem } from '@/composables/useCanvasBatch'
import { CANVAS_PICKER_KEY } from '@/composables/canvasPickerKey'
import { formatCost, formatEstimate } from '@/utils/cost'

const { t } = useI18n()

const props = defineProps<{ batch: CanvasBatch }>()
const batch = props.batch

const picker = inject(CANVAS_PICKER_KEY, undefined)

const fileInput = ref<HTMLInputElement | null>(null)
const picking = ref(false)
const uploading = ref(false)
const downloading = ref(false)

const STATUS_KEY: Record<BatchItem['status'], string> = {
  pending: 'dialogs.batch.statusPending',
  running: 'nodes.status.running',
  done: 'nodes.status.done',
  error: 'nodes.status.error',
}
function statusText(status: BatchItem['status']): string {
  return t(STATUS_KEY[status])
}

/** 预估总成本；还没有可重跑的生成节点时显示占位 */
const totalText = computed(() => formatEstimate(batch.totalCost.value) || '—')
const spentText = computed(() => formatCost(batch.spentCost.value))
const breakdownText = computed(() => {
  const n = batch.sources.value.length
  const nodes = batch.affectedGenNodes.value.length
  const unit = batch.unitCost.value
  // 单价未知时不把「成本未知」再拼进算式里，上面一行已经说明了
  return unit && !unit.unknown
    ? t('dialogs.batch.costBreakdown', { n, unit: formatCost(unit), nodes })
    : t('dialogs.batch.costBreakdownNoUnit', { n, nodes })
})

/** 配置阶段的拦截理由；有值就不让开跑，也直接显示给用户看 */
const problem = computed(() => batch.validate())

const progressPct = computed(() => {
  const total = batch.items.value.length
  if (!total) return 0
  const settled = batch.doneCount.value + batch.failedCount.value
  return Math.round((settled / total) * 100)
})

function requestClose() {
  if (batch.running.value) {
    MessagePlugin.warning(t('dialogs.batch.closeWhileRunning'))
    return
  }
  batch.open.value = false
}

async function pickFromLibrary() {
  if (!picker) { MessagePlugin.warning(t('dialogs.batch.pickerUnavailable')); return }
  picking.value = true
  try {
    const chosen = await picker.open({ mediaType: 'image', multiSelect: true })
    batch.addSources(
      chosen
        .filter((c) => !!c.fileUrl)
        .map((c) => ({ url: c.fileUrl, name: c.name || c.id }))
    )
  } finally {
    picking.value = false
  }
}

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  uploading.value = true
  const added: { url: string; name: string }[] = []
  // 逐个传、逐个报错：一张不合规不该把其余几十张一起废掉
  for (const f of files) {
    try {
      added.push({ url: await uploadCanvasImage(f), name: f.name })
    } catch (err: any) {
      MessagePlugin.error(t('dialogs.batch.fileError', { name: f.name, reason: err?.message || t('common.uploadFailed') }))
    }
  }
  uploading.value = false
  if (added.length) batch.addSources(added)
}

function downloadOne(o: BatchOutput, i: number, k: number) {
  void downloadCanvasAsset(o.url, `batch_${i + 1}_${k + 1}`, o.kind)
}

async function downloadAll() {
  const outs = batch.allOutputs.value
  if (!outs.length) return
  // 浏览器一项一个下载动作，几十项会连弹几十次 —— 先说清楚再开始
  if (outs.length > 8) {
    const ok = await new Promise<boolean>((resolve) => {
      const dlg = DialogPlugin.confirm({
        header: t('dialogs.batch.confirmTitle'),
        body: t('dialogs.batch.confirmBody', { n: outs.length }),
        confirmBtn: t('dialogs.batch.confirmContinue'),
        cancelBtn: t('common.cancel'),
        onConfirm: () => { dlg.destroy(); resolve(true) },
        onCancel: () => { dlg.destroy(); resolve(false) },
      })
    })
    if (!ok) return
  }
  downloading.value = true
  try {
    for (let i = 0; i < outs.length; i++) {
      await downloadCanvasAsset(outs[i].url, `batch_${i + 1}`, outs[i].kind)
    }
  } finally {
    downloading.value = false
  }
}
</script>

<style scoped>
.br-mask { z-index: 9000; }
.br-modal { width: 640px; }
.br-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; min-width: 0; }
.br-sub { font: 400 12px var(--f-body); color: var(--text-3); }
.br-tip { margin: 0 0 16px; font-size: 13px; line-height: 1.7; color: var(--text-2); }

.br-step { margin-bottom: 20px; }
.br-step-h { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; font-size: 13px; }
.br-step-h b { color: var(--text); font-weight: 600; }
.br-step-h span { font-size: 12px; color: var(--text-3); }

.br-empty {
  font-size: 13px; color: var(--text-3); line-height: 1.7;
  padding: 12px 14px; border: 1px dashed var(--line-2); border-radius: 10px;
}

.br-varlist { display: flex; flex-wrap: wrap; gap: 8px; }
.br-var {
  position: relative; width: 64px; height: 64px; padding: 0;
  border: 1px solid var(--line-2); border-radius: 10px; background: var(--media-bg);
  overflow: hidden; cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease;
}
.br-var:hover { border-color: var(--line-3); }
.br-var.on { border-color: rgb(var(--c-cyan) / .7); box-shadow: var(--glow-s); }
.br-var img { width: 100%; height: 100%; object-fit: cover; display: block; }
.br-var-blank {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; font-size: 12px; color: var(--text-3);
}
/* 图注压在画面上：底是恒暗渐变，字固定用浅色 */
.br-var-cap {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 6px 0 2px; font-size: 10px; text-align: center; color: var(--on-scrim);
  background: linear-gradient(to top, rgb(var(--c-scrim) / .85), rgb(var(--c-scrim) / 0));
}

.br-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }

.br-srcgrid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 6px; max-height: 190px; overflow-y: auto;
}
.br-src { position: relative; aspect-ratio: 1; border-radius: 8px; overflow: hidden; background: var(--media-bg); border: 1px solid var(--line); }
.br-src img { width: 100%; height: 100%; object-fit: cover; display: block; }
.br-src-x {
  position: absolute; top: 2px; right: 2px; width: 18px; height: 18px;
  border: none; border-radius: 5px; background: rgb(var(--c-scrim) / .7); color: var(--on-scrim);
  font-size: 13px; line-height: 18px; padding: 0; cursor: pointer;
}

.br-cost { padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--well); }
.br-cost-main { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.br-cost-n { font: 600 20px var(--f-disp); color: var(--text); }
.br-cost-u { font-size: 13px; color: var(--text-2); }
.br-cost-hint { margin-top: 4px; font-size: 12px; color: var(--text-3); }
.br-cost-sub { margin-top: 4px; font-size: 12px; color: var(--text-3); line-height: 1.6; }
.br-warn { margin-top: 12px; }

/* ── 运行 / 结果 ── */
.br-progress { margin-bottom: 14px; }
.br-progress-bar { height: 6px; border-radius: 3px; background: rgb(var(--c-film) / .14); overflow: hidden; }
.br-progress-fill { height: 100%; border-radius: 3px; background: var(--grad); transition: width .3s ease; }
.br-progress-txt { margin-top: 8px; font-size: 13px; color: var(--text-2); }

.br-rows { display: flex; flex-direction: column; gap: 8px; }
.br-row {
  display: flex; gap: 10px; padding: 10px;
  border: 1px solid var(--line); border-radius: 12px; background: rgb(var(--c-well) / .45);
}
.br-row.running { border-color: rgb(var(--c-cyan) / .5); }
.br-row.failed, .br-row.error { border-color: rgb(var(--c-err) / .4); }
.br-row-src { width: 44px; height: 44px; border-radius: 8px; object-fit: cover; flex: 0 0 auto; }
.br-row-mid { min-width: 0; flex: 1; }
.br-row-top { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
.br-row-n { color: var(--text-3); font: 12px var(--f-mono); }
.br-row-st { color: var(--text); }
.br-row.running .br-row-st { color: var(--cyan); }
.br-row-pt { margin-left: auto; color: var(--text-2); font-size: 12px; }
.br-row-err { margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--err-soft); word-break: break-word; }

.br-outs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.br-out {
  width: 40px; height: 40px; padding: 0; border: 1px solid var(--line);
  border-radius: 7px; overflow: hidden; background: var(--media-bg); cursor: pointer;
}
.br-out:hover { border-color: var(--cyan); }
.br-out img { width: 100%; height: 100%; object-fit: cover; display: block; }
.br-out-film {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; font-size: 10px; color: var(--kind-video-fg);
}
.br-foot { flex-wrap: wrap; }
@media (max-width: 600px) {
  .br-foot .lc-btn { flex: 1; padding: 0 10px; }
}
</style>
