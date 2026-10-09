<template>
  <div v-if="batch.open.value" class="br-mask" @click.self="requestClose">
    <div class="br-modal">
      <div class="br-head">
        <span class="br-title">{{ t('dialogs.batch.title') }}</span>
        <span class="br-sub">{{ t('dialogs.batch.subtitle') }}</span>
        <button class="br-close" :title="t('common.close')" @click="requestClose">×</button>
      </div>

      <!-- ========== 配置阶段 ========== -->
      <div v-if="!batch.items.value.length" class="br-body">
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
            <button class="br-btn" :disabled="picking" @click="pickFromLibrary">{{ t('nodes.action.pickFromLibrary') }}</button>
            <button class="br-btn" :disabled="uploading" @click="fileInput?.click()">
              {{ uploading ? t('common.uploading') : t('dialogs.batch.uploadLocal') }}
            </button>
            <button
              v-if="batch.sources.value.length"
              class="br-btn ghost"
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
            <span class="br-cost-n">{{ totalText }}</span>
            <span class="br-cost-u">{{ t('cost.estimate') }}</span>
          </div>
          <div v-if="batch.costIsPartial.value" class="br-cost-hint">{{ t('dialogs.batch.costUnknownHint') }}</div>
          <div class="br-cost-sub">{{ breakdownText }}</div>
        </div>

        <div v-if="problem" class="br-warn">{{ problem }}</div>
      </div>

      <!-- ========== 运行 / 结果阶段 ========== -->
      <div v-else class="br-body">
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

      <div class="br-foot">
        <template v-if="!batch.items.value.length">
          <button class="br-btn" @click="requestClose">{{ t('common.cancel') }}</button>
          <button class="br-btn primary" :disabled="!!problem" @click="batch.start()">
            {{ t('dialogs.batch.start') }}
          </button>
        </template>
        <template v-else>
          <button
            v-if="batch.running.value"
            class="br-btn"
            :disabled="batch.stopping.value"
            @click="batch.stop()"
          >{{ batch.stopping.value ? t('dialogs.batch.stopping') : t('dialogs.batch.stop') }}</button>
          <template v-else>
            <button class="br-btn" @click="batch.reset()">{{ t('dialogs.batch.reconfigure') }}</button>
            <button
              v-if="batch.originalUrl.value"
              class="br-btn"
              @click="batch.restoreVarNode()"
            >{{ t('dialogs.batch.restoreVar') }}</button>
            <button
              class="br-btn primary"
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
import { MessagePlugin, DialogPlugin } from 'tdesign-vue-next'
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
.br-mask {
  position: fixed; inset: 0; z-index: 9000;
  background: var(--scrim);
  display: flex; align-items: center; justify-content: center;
}
.br-modal {
  width: 620px; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px);
  display: flex; flex-direction: column;
  background: var(--n-3); border: 1px solid var(--n-5); border-radius: 12px;
  color: var(--t-strong); overflow: hidden;
}

.br-head {
  display: flex; align-items: baseline; gap: 10px;
  padding: 16px 20px; border-bottom: 1px solid var(--n-5);
}
.br-title { font-weight: 600; color: var(--t-max); }
.br-sub { font-size: 12px; color: var(--t-dim); }
.br-close {
  margin-left: auto; background: none; border: none;
  color: var(--t-dim); font-size: 22px; line-height: 1; cursor: pointer;
}

.br-body { padding: 18px 20px; overflow-y: auto; }
.br-tip { margin: 0 0 16px; font-size: 12px; line-height: 1.7; color: var(--t-dim); }

.br-step { margin-bottom: 20px; }
.br-step-h {
  display: flex; align-items: baseline; gap: 10px; margin-bottom: 9px;
  font-size: 13px; color: var(--t-body);
}
.br-step-h b { color: var(--t-max); }
.br-step-h span { font-size: 11.5px; color: var(--t-dim); }

.br-empty {
  font-size: 12px; color: var(--t-dim); line-height: 1.7;
  padding: 12px 14px; border: 1px dashed var(--n-5); border-radius: 8px;
}

.br-varlist { display: flex; flex-wrap: wrap; gap: 8px; }
.br-var {
  position: relative; width: 62px; height: 62px; padding: 0;
  border: 2px solid var(--n-5); border-radius: 8px; background: var(--n-2);
  overflow: hidden; cursor: pointer; transition: border-color .15s ease;
}
.br-var:hover { border-color: var(--accent-text); }
.br-var.on { border-color: var(--accent-text); }
.br-var img { width: 100%; height: 100%; object-fit: cover; display: block; }
.br-var-blank {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; font-size: 12px; color: var(--t-dim);
}
.br-var-cap {
  position: absolute; left: 0; right: 0; bottom: 0;
  padding: 1px 0 2px; font-size: 9px; text-align: center; color: #fff;
  background: linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,0));
}

.br-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }

.br-srcgrid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 6px; max-height: 190px; overflow-y: auto;
}
.br-src { position: relative; aspect-ratio: 1; border-radius: 6px; overflow: hidden; background: var(--n-2); }
.br-src img { width: 100%; height: 100%; object-fit: cover; display: block; }
.br-src-x {
  position: absolute; top: 2px; right: 2px; width: 16px; height: 16px;
  border: none; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff;
  font-size: 12px; line-height: 16px; padding: 0; cursor: pointer;
}

.br-cost {
  padding: 12px 14px; border: 1px solid var(--n-5); border-radius: 8px; background: var(--n-2);
}
.br-cost-main { display: flex; align-items: baseline; gap: 6px; }
.br-cost-n { font-size: 24px; font-weight: 700; color: var(--t-max); }
.br-cost-u { font-size: 12px; color: var(--t-body); }
.br-cost-hint { margin-top: 2px; font-size: 11px; color: var(--t-dim); }
.br-cost-sub { margin-top: 4px; font-size: 11.5px; color: var(--t-dim); line-height: 1.6; }

.br-warn {
  margin-top: 12px; padding: 9px 12px; border-radius: 7px;
  background: var(--n-2); border: 1px solid var(--n-5);
  font-size: 12px; color: var(--t-body);
}

/* ── 运行 / 结果 ── */
.br-progress { margin-bottom: 14px; }
.br-progress-bar { height: 4px; border-radius: 2px; background: var(--n-5); overflow: hidden; }
.br-progress-fill { height: 100%; background: var(--accent-text); transition: width .3s ease; }
.br-progress-txt { margin-top: 7px; font-size: 12px; color: var(--t-body); }

.br-rows { display: flex; flex-direction: column; gap: 8px; }
.br-row {
  display: flex; gap: 10px; padding: 9px 10px;
  border: 1px solid var(--n-5); border-radius: 8px; background: var(--n-2);
}
.br-row.running { border-color: var(--accent-text); }
.br-row-src { width: 42px; height: 42px; border-radius: 6px; object-fit: cover; flex: 0 0 auto; }
.br-row-mid { min-width: 0; flex: 1; }
.br-row-top { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
.br-row-n { color: var(--t-dim); }
.br-row-st { color: var(--t-body); }
.br-row-pt { margin-left: auto; color: var(--t-dim); font-size: 11px; }
.br-row-err { margin-top: 4px; font-size: 11.5px; line-height: 1.6; color: var(--t-dim); }

.br-outs { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.br-out {
  width: 38px; height: 38px; padding: 0; border: 1px solid var(--n-5);
  border-radius: 5px; overflow: hidden; background: var(--n-3); cursor: pointer;
}
.br-out:hover { border-color: var(--accent-text); }
.br-out img { width: 100%; height: 100%; object-fit: cover; display: block; }
.br-out-film {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; font-size: 10px; color: var(--t-dim);
}

/* ── 底栏 ── */
.br-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 13px 20px; border-top: 1px solid var(--n-5);
}
.br-btn {
  padding: 7px 14px; border-radius: 8px; font-size: 13px; cursor: pointer;
  background: var(--n-3); border: 1px solid var(--n-5); color: var(--t-body);
  transition: all .15s ease;
}
.br-btn:hover:not(:disabled) { border-color: var(--accent-text); color: var(--accent-text); }
.br-btn:disabled { opacity: .5; cursor: not-allowed; }
.br-btn.primary { background: var(--btn-bg); color: var(--btn-fg); border-color: var(--accent-text); }
.br-btn.primary:hover:not(:disabled) { background: var(--btn-bg-hover); color: var(--btn-fg); }
.br-btn.ghost { background: transparent; }
</style>
