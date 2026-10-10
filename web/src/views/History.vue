<template>
  <div class="lc-page">
    <div class="lc-page-inner">
      <div class="lc-page-head">
        <div class="hi-head-text">
          <h1 class="lc-ph1">{{ t('history.title') }}</h1>
          <p class="lc-ph-sub">{{ t('history.sub') }}</p>
        </div>
        <span class="lc-sp" />
        <div class="hi-head-acts">
          <button class="lc-btn ghost" type="button" @click="clearOpen = true"><LcIcon name="trash" />{{ t('history.clear') }}</button>
          <button class="lc-btn" type="button" :disabled="exporting || !total" @click="exportCsv">
            <LcIcon name="download" />{{ t('history.exportCsv') }}
          </button>
        </div>
      </div>

      <!-- 四个汇总数字：跟着筛选条走 -->
      <div class="hi-sum" :class="{ loading: summaryLoading && !totals }">
        <div class="lc-card hi-stat">
          <span><LcIcon name="bolt" size="s" />{{ t('history.tiles.runs') }}</span>
          <b>{{ totals ? totals.runs : '—' }}</b>
          <small>{{ runsNote }}</small>
        </div>
        <div class="lc-card hi-stat">
          <span><LcIcon name="check" size="s" />{{ t('history.tiles.succeeded') }}</span>
          <b>{{ totals ? totals.succeeded ?? 0 : '—' }}</b>
          <small>{{ successNote }}</small>
        </div>
        <div class="lc-card hi-stat">
          <span><LcIcon name="warn" size="s" />{{ t('history.tiles.failed') }}</span>
          <b>{{ totals ? totals.failed ?? 0 : '—' }}</b>
          <small>{{ failedNote }}</small>
        </div>
        <div class="lc-card hi-stat">
          <span><LcIcon name="key" size="s" />{{ t('history.tiles.cost') }}</span>
          <b :class="{ unk: costTile.unknown }">{{ costTile.text }}</b>
          <small>{{ costTile.note }}</small>
        </div>
      </div>

      <div class="lc-fbar hi-fbar">
        <t-date-range-picker
          v-model="range"
          class="lc-date hi-range"
          value-type="YYYY-MM-DD"
          format="YYYY-MM-DD"
          allow-input
          :clearable="false"
          :placeholder="[t('history.filter.from'), t('history.filter.to')]"
          :presets="rangePresets"
          :popup-props="DATE_POPUP"
        />
        <div class="lc-seg" role="group" :aria-label="t('history.filter.kind')">
          <button type="button" :class="{ on: kind === '' }" @click="kind = ''">{{ t('common.all') }}</button>
          <button v-for="k in KINDS" :key="k" type="button" :class="{ on: kind === k }" @click="kind = k">{{ t('history.kinds.' + k) }}</button>
        </div>
        <div class="hi-sel status">
          <LcSelect v-model="status" :options="statusOptions" size="sm" :aria-label="t('history.filter.status')" />
        </div>
        <div class="hi-sel model">
          <LcSelect v-model="model" :options="modelOptions" size="sm" :aria-label="t('history.filter.model')" />
        </div>
        <label class="lc-inp sm grow">
          <LcIcon name="search" size="s" />
          <input v-model.trim="q" type="search" :placeholder="t('history.filter.search')" :aria-label="t('history.filter.search')" />
        </label>
        <button class="lc-btn sm text hi-reset" type="button" :disabled="!filtered" @click="resetFilters">{{ t('history.filter.reset') }}</button>
      </div>

      <div v-if="loadError" class="lc-alert hi-error" role="alert">
        <LcIcon name="warn" />
        <span>{{ t('history.loadFailed') }}{{ loadError ? ' · ' + loadError : '' }}</span>
        <button class="lc-btn sm" type="button" @click="reload">{{ t('common.retry') }}</button>
      </div>

      <div class="lc-card hi-tbl">
        <div class="hi-th">
          <span>{{ t('history.col.preview') }}</span>
          <span>{{ t('history.col.prompt') }}</span>
          <span>{{ t('history.col.model') }}</span>
          <span>{{ t('history.col.kind') }}</span>
          <span>{{ t('history.col.status') }}</span>
          <span>{{ t('history.col.duration') }}</span>
          <span>{{ t('history.col.time') }}</span>
          <span>{{ t('history.col.cost') }}</span>
          <span class="right">{{ t('history.col.actions') }}</span>
        </div>

        <!-- 冷启动才用骨架；翻页 / 轮询时旧行留着 -->
        <template v-if="recordsLoading && !records.length">
          <div v-for="n in 6" :key="n" class="hi-tr skel-row" aria-hidden="true">
            <span class="skel thumb" /><span class="skel w60" /><span class="skel w70" /><span class="skel w80" />
            <span class="skel w60" /><span class="skel w50" /><span class="skel w80" /><span class="skel w70" /><span />
          </div>
        </template>

        <div v-else-if="!rows.length && !loadError" class="lc-empty hi-empty">
          <span class="hi-empty-ic"><LcIcon name="history" size="l" /></span>
          <p class="hi-empty-t">{{ emptyTitle }}</p>
          <template v-if="!total && !filtered">
            <p>{{ t('history.emptyHint') }}</p>
            <router-link class="lc-btn" to="/canvases"><LcIcon name="canvas" />{{ t('history.goCanvases') }}</router-link>
          </template>
          <button v-else-if="filtered" class="lc-btn sm" type="button" @click="resetFilters">{{ t('history.filter.reset') }}</button>
        </div>

        <div v-for="r in rows" v-else :key="r.id" class="hi-tr" :class="{ dim: recordsLoading }">
          <!-- 预览：运行中用进度环，失败 / 对话用图标，其余是结果缩略图 -->
          <div class="c-thumb">
            <span v-if="r.status === 'queued'" class="lc-thumb hi-thumb busy"><span class="lc-ring sm q" /></span>
            <span v-else-if="isActive(r.status)" class="lc-thumb hi-thumb busy">
              <span v-if="progressOf(r) > 0" class="lc-ring sm" :style="{ '--p': progressOf(r) }"><span>{{ progressOf(r) }}</span></span>
              <span v-else class="lc-ring sm spin" />
            </span>
            <span v-else-if="r.status === 'failed'" class="lc-thumb hi-thumb fail"><LcIcon name="warn" /></span>
            <span v-else-if="r.kind === 'chat'" class="lc-thumb hi-thumb chat"><LcIcon name="chat" /></span>
            <button
              v-else-if="firstOutput(r)" class="lc-thumb hi-thumb media" type="button"
              :title="t('history.detail.preview')" @click="preview(firstOutput(r)!)"
            >
              <img v-if="thumbIsImage(firstOutput(r)!)" :src="thumbSrc(firstOutput(r)!)" alt="" loading="lazy" />
              <video v-else :src="ensureHttps(firstOutput(r)!.url)" muted playsinline preload="metadata" />
              <span v-if="outputsOf(r).length > 1" class="more">{{ outputsOf(r).length }}</span>
            </button>
            <span v-else class="lc-thumb hi-thumb none"><LcIcon :name="r.kind === 'video' ? 'video' : 'image'" /></span>
          </div>

          <div class="c-prompt">
            <b :title="r.prompt || undefined" :class="{ 'lc-t3': !r.prompt }">{{ r.prompt || t('history.noPrompt') }}</b>
            <small v-if="r.status === 'failed' && r.error" class="err" :title="r.error">{{ r.error }}</small>
            <small v-else :title="canvasName(r)">{{ canvasName(r) }}</small>
          </div>

          <!-- 宽屏时这层不参与排版（display: contents），窄屏时把这几项收成一行可换行的小字 -->
          <div class="c-meta">
          <span class="c-model" :title="r.model">{{ r.modelLabel || r.model }}</span>
          <span class="c-kind"><span class="lc-bd" :class="r.kind">{{ t('history.kinds.' + r.kind) }}</span></span>
          <span class="c-status"><span class="lc-st" :class="statusClass(r.status)">{{ t('history.statuses.' + r.status) }}</span></span>
          <span class="c-dur num" :class="{ empty: durationMs(r) === null }">{{ formatDuration(durationMs(r)) }}</span>
          <span class="c-time num" :title="formatFull(r.createdAt)">{{ formatWhen(r.createdAt) }}</span>
          <span class="c-cost" :class="r.cost && !r.cost.unknown ? 'num known' : 'lc-unk'">{{ formatCost(r.cost) || '—' }}</span>
          </div>

          <div class="c-acts">
            <button class="lc-tb sm" type="button" :title="t('history.act.details')" :aria-label="t('history.act.details')" @click="detailId = r.id"><LcIcon name="eye" /></button>
            <router-link
              v-if="canvasExists(r)" class="lc-tb sm" :to="'/canvas/' + r.workflowId"
              :title="t('history.act.openCanvas')" :aria-label="t('history.act.openCanvas')"
            ><LcIcon name="canvas" /></router-link>
            <ConfirmPop
              v-if="isActive(r.status)"
              :text="t('history.cancelConfirm')" :hint="t('history.cancelHint')" :ok-text="t('history.act.cancel')"
              @ok="cancelRun(r)"
            >
              <button class="lc-tb sm" type="button" :title="t('history.act.cancel')" :aria-label="t('history.act.cancel')" :disabled="canceling === r.id"><LcIcon name="x" /></button>
            </ConfirmPop>
            <button
              v-else-if="firstOutput(r)" class="lc-tb sm" type="button"
              :title="t('history.act.download')" :aria-label="t('history.act.download')" @click="downloadAll(r)"
            ><LcIcon name="download" /></button>
            <button
              v-if="r.prompt" class="lc-tb sm" type="button"
              :title="t('history.act.copyPrompt')" :aria-label="t('history.act.copyPrompt')" @click="copyPrompt(r)"
            ><LcIcon name="copy" /></button>
          </div>
        </div>

        <div v-if="total > 0" class="lc-pager">
          <span>{{ t('history.range', { from: rangeFrom, to: rangeTo, total }) }}</span>
          <span v-if="q" class="lc-t3">{{ t('history.matched', { n: rows.length }) }}</span>
          <span class="lc-sp" />
          <template v-if="pages > 1">
            <button class="lc-pg" type="button" :disabled="page <= 1 || recordsLoading" :title="t('history.prev')" :aria-label="t('history.prev')" @click="goPage(page - 1)">
              <LcIcon name="chev" size="s" class="flip" />
            </button>
            <template v-for="(p, i) in pageList" :key="i">
              <span v-if="p === 0" class="lc-t3">…</span>
              <button v-else class="lc-pg" type="button" :class="{ on: p === page }" :aria-current="p === page ? 'page' : undefined" :disabled="recordsLoading && p !== page" @click="goPage(p)">{{ p }}</button>
            </template>
            <button class="lc-pg" type="button" :disabled="page >= pages || recordsLoading" :title="t('history.next')" :aria-label="t('history.next')" @click="goPage(page + 1)">
              <LcIcon name="chev" size="s" />
            </button>
          </template>
        </div>
      </div>
    </div>

    <HistoryDetailDialog
      v-if="detail"
      :record="detail"
      :run="runMap[detail.id]"
      :canvas-name="canvasName(detail)"
      :canvas-exists="canvasExists(detail)"
      @close="detailId = ''"
      @preview="preview"
      @download="(o, i) => downloadOutput(detail!, o, i)"
      @copy="copyPrompt"
    />
    <HistoryClearDialog v-if="clearOpen" @close="clearOpen = false" @cleared="onCleared" />
    <MediaLightbox :open="lightbox.open" :url="lightbox.url" :type="lightbox.type" @close="lightbox.open = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import ConfirmPop from '@/components/ConfirmPop.vue'
import MediaLightbox from '@/components/canvas/MediaLightbox.vue'
import HistoryDetailDialog from '@/components/history/HistoryDetailDialog.vue'
import HistoryClearDialog from '@/components/history/HistoryClearDialog.vue'
import {
  durationMs, formatDuration, formatFull, formatWhen, isActive, isoDate, statusClass,
} from '@/components/history/historyFormat'
import { adminApi, runsApi, workflowApi, unwrap, apiErrorMessage } from '@/utils/api'
import { formatCost, formatMoney } from '@/utils/cost'
import { ensureHttps } from '@/utils/mediaUrl'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { writeClipboard } from '@/utils/clipboard'
import type { ModelKind, Run, RunOutput, RunStatus, UsageRecord, UsageSummaryRow } from '@/types'

const { t, locale } = useI18n()
const route = useRoute()

const PAGE_SIZE = 20
const POLL_MS = 3000
/** 导出一次最多拉这么多条（接口每页上限 100） */
const EXPORT_CAP = 5000
const KINDS: ModelKind[] = ['image', 'video', 'chat']
const STATUSES: RunStatus[] = ['queued', 'running', 'archiving', 'succeeded', 'failed', 'canceled']

// ---- 筛选 ----
const today = new Date()
const todayText = isoDate(today)
const daysAgo = (n: number) => isoDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n))
const DEFAULT_FROM = daysAgo(29)

const from = ref(DEFAULT_FROM)
const to = ref(todayText)
// 别的页面可以带着筛选跳过来：/history?status=failed
const qs = (k: string) => (typeof route.query[k] === 'string' ? String(route.query[k]) : '')
const kind = ref<ModelKind | ''>(KINDS.includes(qs('kind') as ModelKind) ? qs('kind') as ModelKind : '')
const status = ref<RunStatus | ''>(STATUSES.includes(qs('status') as RunStatus) ? qs('status') as RunStatus : '')
const model = ref(qs('model'))
/** 接口不支持文字搜索：只在已加载的这一页里筛 */
const q = ref('')

/** 日历弹层挂在 body 上，靠这个类名套用整站的配色（见 base.css） */
const DATE_POPUP = { overlayClassName: 'lc-date-popup' }

/** 起止日期合成一个范围控件；请求参数仍然是 from / to 两个 YYYY-MM-DD */
const range = computed<string[]>({
  get: () => [from.value, to.value],
  set: (v) => {
    const [a, b] = v || []
    if (!a || !b) return
    // 手敲时可能把起止写反
    ;[from.value, to.value] = a <= b ? [a, b] : [b, a]
  },
})
const rangePresets = computed<Record<string, [string, string]>>(() => ({
  [t('history.filter.presetLast7')]: [daysAgo(6), todayText],
  [t('history.filter.presetLast30')]: [daysAgo(29), todayText],
  [t('history.filter.presetThisMonth')]: [isoDate(new Date(today.getFullYear(), today.getMonth(), 1)), todayText],
}))

const statusOptions = computed(() => [
  { value: '' as RunStatus | '', label: t('history.filter.statusAll') },
  ...STATUSES.map(s => ({ value: s as RunStatus | '', label: t('history.statuses.' + s) })),
])

/** 这段时间里真的用过的模型（不随类型 / 状态筛选变化） */
const usedModels = ref<UsageSummaryRow[]>([])
const modelOptions = computed(() => {
  const list = usedModels.value.map(m => ({ value: m.key, label: m.label || m.key }))
  if (model.value && !list.some(o => o.value === model.value)) list.push({ value: model.value, label: model.value })
  return [{ value: '', label: t('history.filter.modelAll') }, ...list]
})

const filtered = computed(() =>
  !!(kind.value || status.value || model.value || q.value || from.value !== DEFAULT_FROM || to.value !== todayText))

function resetFilters() {
  from.value = DEFAULT_FROM
  to.value = todayText
  kind.value = ''
  status.value = ''
  model.value = ''
  q.value = ''
}

const queryParams = () => ({
  from: from.value, to: to.value,
  ...(kind.value ? { kind: kind.value } : {}),
  ...(status.value ? { status: status.value } : {}),
  ...(model.value ? { model: model.value } : {}),
})

// ---- 汇总 ----
const totals = ref<UsageSummaryRow | null>(null)
const byKind = ref<Record<ModelKind, number> | null>(null)
const summaryLoading = ref(false)
let summarySeq = 0

async function loadSummary() {
  const seq = ++summarySeq
  summaryLoading.value = true
  try {
    const params = queryParams()
    // 类型没筛时再按类型各问一次，拼出「图片 x · 视频 y · 对话 z」；接口没有按类型分组
    const [all, ...kinds] = await Promise.all([
      adminApi.usage({ ...params, groupBy: 'model' }),
      ...(kind.value ? [] : KINDS.map(k => adminApi.usage({ ...params, kind: k, groupBy: 'model' }))),
    ])
    if (seq !== summarySeq) return
    const data = unwrap(all)
    totals.value = data?.totals || sumRows(data?.items || [])
    byKind.value = kinds.length
      ? Object.fromEntries(KINDS.map((k, i) => {
        const d = unwrap(kinds[i])
        return [k, Number((d?.totals || sumRows(d?.items || [])).runs) || 0]
      })) as Record<ModelKind, number>
      : null
  } catch (err) {
    if (seq !== summarySeq) return
    totals.value = null
    byKind.value = null
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    if (seq === summarySeq) summaryLoading.value = false
  }
}

/** 老版本后端不给 totals：自己把各行加起来 */
function sumRows(rows: UsageSummaryRow[]): UsageSummaryRow {
  const out: UsageSummaryRow = { key: 'total', runs: 0, succeeded: 0, failed: 0, canceled: 0, amount: 0, currency: '', unknownCount: 0, costs: {} }
  for (const r of rows) {
    out.runs += Number(r.runs) || 0
    out.succeeded! += Number(r.succeeded) || 0
    out.failed! += Number(r.failed) || 0
    out.canceled! += Number(r.canceled) || 0
    out.unknownCount! += Number(r.unknownCount) || 0
    const costs = r.costs || (r.currency ? { [r.currency]: r.amount } : {})
    for (const [cur, amount] of Object.entries(costs)) out.costs![cur] = (out.costs![cur] || 0) + (Number(amount) || 0)
  }
  return out
}

let modelsSeq = 0
async function loadUsedModels() {
  const seq = ++modelsSeq
  try {
    const data = unwrap(await adminApi.usage({ from: from.value, to: to.value, groupBy: 'model' }))
    if (seq === modelsSeq) usedModels.value = data?.items || []
  } catch { /* 模型下拉只是少了选项；真正的错误由列表请求报 */ }
}

const runsNote = computed(() => {
  if (!totals.value) return ' '
  if (!totals.value.runs) return t('history.tiles.noRuns')
  return byKind.value ? t('history.tiles.byKind', byKind.value) : ' '
})
const successNote = computed(() => {
  const s = Number(totals.value?.succeeded) || 0
  const f = Number(totals.value?.failed) || 0
  if (!totals.value || !(s + f)) return ' '
  const rate = new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }).format(s / (s + f))
  return t('history.tiles.successRate', { rate })
})
const failedNote = computed(() => {
  if (!totals.value) return ' '
  const c = Number(totals.value.canceled) || 0
  if (c) return t('history.tiles.canceled', { n: c })
  return totals.value.runs && !totals.value.failed ? t('history.tiles.noFailed') : ' '
})
/** 合计按币种分开列：不同币种不能相加。成功但没有价格的次数单独说明 */
const costTile = computed(() => {
  const tt = totals.value
  if (!tt) return { text: '—', note: ' ', unknown: false }
  const costs = Object.entries(tt.costs || (tt.currency ? { [tt.currency]: tt.amount } : {}))
  const unknown = Number(tt.unknownCount) || 0
  if (costs.length) {
    return {
      text: costs.map(([cur, amount]) => formatMoney(Number(amount) || 0, cur)).join(' + '),
      note: unknown ? t('history.tiles.costUnknownSome', { n: unknown }) : t('history.tiles.costSucceededOnly'),
      unknown: false,
    }
  }
  if (unknown) return { text: t('cost.unknown'), note: t('history.tiles.costUnknownAll', { n: unknown }), unknown: true }
  return { text: '—', note: t('history.tiles.costSucceededOnly'), unknown: false }
})

// ---- 记录 ----
const records = ref<UsageRecord[]>([])
const recordsLoading = ref(false)
const loadError = ref('')
const page = ref(1)
const total = ref(0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const rangeFrom = computed(() => (page.value - 1) * PAGE_SIZE + 1)
const rangeTo = computed(() => Math.min(total.value, (page.value - 1) * PAGE_SIZE + records.value.length))
let recordsSeq = 0

/** silent：轮询时的静默刷新，不动加载态，失败也不打扰 */
async function loadRecords(silent = false) {
  const seq = ++recordsSeq
  if (!silent) recordsLoading.value = true
  try {
    const data = unwrap(await adminApi.usageRecords({ ...queryParams(), page: page.value, pageSize: PAGE_SIZE }))
    if (seq !== recordsSeq) return
    records.value = data?.list || []
    total.value = Number(data?.total) || 0
    // 清理或筛选后这一页可能已经不存在
    if (!records.value.length && total.value && page.value > 1) {
      page.value = Math.max(1, Math.ceil(total.value / PAGE_SIZE))
      return loadRecords(silent)
    }
    if (!silent) loadError.value = ''
    void loadRuns()
  } catch (err) {
    if (seq !== recordsSeq || silent) return
    records.value = []
    total.value = 0
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    if (seq === recordsSeq && !silent) recordsLoading.value = false
    schedulePoll()
  }
}

/** 记录里没有结果文件和进度：按这一页的 id 批量查运行（接口一次最多 100 个；对话不在其中） */
const runMap = ref<Record<string, Run>>({})
async function loadRuns() {
  const ids = records.value
    .filter(r => r.kind !== 'chat' && (r.status === 'succeeded' || isActive(r.status)))
    .map(r => r.id)
  if (!ids.length) return
  try {
    const list = unwrap(await runsApi.status(ids)) || []
    const next: Record<string, Run> = {}
    for (const r of records.value) if (runMap.value[r.id]) next[r.id] = runMap.value[r.id]
    for (const run of list) next[run.id] = run
    runMap.value = next
  } catch { /* 缩略图拿不到就显示类型图标 */ }
}

const outputsOf = (r: UsageRecord): RunOutput[] => (r.status === 'succeeded' ? runMap.value[r.id]?.outputs || [] : [])
const firstOutput = (r: UsageRecord): RunOutput | undefined => outputsOf(r)[0]
/** 视频只有在后端真给了封面图时才用 <img>，否则让 <video> 自己出首帧 */
const thumbIsImage = (o: RunOutput) => o.type === 'image' || (!!o.thumbnailUrl && o.thumbnailUrl !== o.url)
const thumbSrc = (o: RunOutput) => ensureHttps(o.thumbnailUrl || o.url)
function progressOf(r: UsageRecord): number {
  const p = Math.round(Number(runMap.value[r.id]?.progress) || 0)
  return p > 0 && p < 100 ? p : 0
}

// ---- 画布名 ----
/** null = 画布列表还没拉到（这时不下「已删除」的结论） */
const canvases = ref<Map<string, string> | null>(null)
async function loadCanvases() {
  try {
    const list = unwrap(await workflowApi.list()) || []
    canvases.value = new Map(list.map(w => [w.id, w.name]))
  } catch { /* 拿不到就不显示画布名 */ }
}
const canvasExists = (r: UsageRecord) => !!r.workflowId && !!canvases.value?.has(r.workflowId)
function canvasName(r: UsageRecord): string {
  if (!r.workflowId) return t('history.noCanvas')
  if (!canvases.value) return ' '
  return canvases.value.get(r.workflowId) ?? t('history.canvasGone')
}

const rows = computed(() => {
  const kw = q.value.toLowerCase()
  if (!kw) return records.value
  return records.value.filter(r =>
    (r.prompt || '').toLowerCase().includes(kw) || (canvasExists(r) && canvasName(r).toLowerCase().includes(kw)))
})
const emptyTitle = computed(() => {
  if (q.value && records.value.length) return t('history.emptySearch', { q: q.value })
  return kind.value || status.value || model.value ? t('history.emptyFiltered') : t('history.empty')
})

/** 1 … 4 5 6 … 43；0 表示省略号 */
const pageList = computed(() => {
  const n = pages.value
  const cur = page.value
  if (n <= 7) return Array.from({ length: n }, (_, i) => i + 1)
  const out = [1]
  const lo = Math.max(2, Math.min(cur - 1, n - 3))
  const hi = Math.min(n - 1, Math.max(cur + 1, 4))
  if (lo > 2) out.push(0)
  for (let p = lo; p <= hi; p++) out.push(p)
  if (hi < n - 1) out.push(0)
  out.push(n)
  return out
})

function goPage(p: number) {
  const next = Math.min(pages.value, Math.max(1, p))
  if (next === page.value) return
  page.value = next
  loadRecords()
}

function reload() {
  page.value = 1
  loadError.value = ''
  loadSummary()
  loadRecords()
}

watch([from, to], loadUsedModels)
watch([from, to, kind, status, model], reload)

// ---- 轮询：只在这一页有没跑完的行、且页面可见时 ----
let pollTimer = 0
let alive = true
const hasActive = () => records.value.some(r => isActive(r.status))
function schedulePoll() {
  window.clearTimeout(pollTimer)
  if (!alive || document.hidden || !hasActive()) return
  pollTimer = window.setTimeout(async () => {
    const before = records.value.filter(r => isActive(r.status)).length
    await loadRecords(true)
    // 有行跑完了：汇总数字跟着变
    if (alive && records.value.filter(r => isActive(r.status)).length !== before) loadSummary()
  }, POLL_MS)
}
function onVisibility() {
  if (!document.hidden && hasActive()) void loadRecords(true)
  else schedulePoll()
}

// ---- 行操作 ----
const detailId = ref('')
/** 翻页或轮询把那一行换掉之后，详情仍然留着最后看到的那份 */
const detailSnap = ref<UsageRecord | null>(null)
const detail = computed<UsageRecord | null>(() => {
  if (!detailId.value) return null
  return records.value.find(r => r.id === detailId.value) || detailSnap.value
})
watch(detail, (d) => { detailSnap.value = d })

const lightbox = ref<{ open: boolean; url: string; type: 'image' | 'video' }>({ open: false, url: '', type: 'image' })
function preview(o: RunOutput) {
  lightbox.value = { open: true, url: ensureHttps(o.url), type: o.type }
}

function downloadOutput(r: UsageRecord, o: RunOutput, index: number) {
  return downloadCanvasAsset(o.url, `${r.id}_${index + 1}`, o.type)
}
async function downloadAll(r: UsageRecord) {
  const list = outputsOf(r)
  for (let i = 0; i < list.length; i++) await downloadOutput(r, list[i], i)
}

async function copyPrompt(r: UsageRecord) {
  try {
    await writeClipboard(r.prompt || '')
    MessagePlugin.success(t('history.promptCopied'))
  } catch {
    MessagePlugin.error(t('common.copyFailed'))
  }
}

const canceling = ref('')
async function cancelRun(r: UsageRecord) {
  if (canceling.value) return
  canceling.value = r.id
  try {
    unwrap(await runsApi.cancel(r.id))
    MessagePlugin.success(t('history.cancelDone'))
    await loadRecords(true)
    loadSummary()
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    canceling.value = ''
  }
}

const clearOpen = ref(false)
function onCleared() {
  clearOpen.value = false
  loadUsedModels()
  reload()
}

// ---- 导出：当前筛选下的全部记录（不只是这一页） ----
const exporting = ref(false)
function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v)
  // 表格软件会把 = + - @ 开头的格子当公式执行
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
async function exportCsv() {
  if (exporting.value) return
  exporting.value = true
  try {
    const all: UsageRecord[] = []
    let sum = 0
    for (let p = 1; all.length < EXPORT_CAP; p++) {
      const data = unwrap(await adminApi.usageRecords({ ...queryParams(), page: p, pageSize: 100 }))
      const list = data?.list || []
      sum = Number(data?.total) || 0
      all.push(...list)
      if (!list.length || all.length >= sum) break
    }
    const kw = q.value.toLowerCase()
    const list = (kw
      ? all.filter(r => (r.prompt || '').toLowerCase().includes(kw) || (canvasExists(r) && canvasName(r).toLowerCase().includes(kw)))
      : all).slice(0, EXPORT_CAP)
    if (!list.length) {
      MessagePlugin.warning(t('history.exportEmpty'))
      return
    }
    const head = ['time', 'model', 'modelId', 'kind', 'status', 'seconds', 'cost', 'currency', 'canvas', 'prompt', 'error', 'runId']
      .map(k => t('history.csv.' + k))
    const lines = list.map((r) => {
      const ms = durationMs(r)
      const known = r.cost && !r.cost.unknown
      return [
        r.createdAt, r.modelLabel || r.model, r.model, t('history.kinds.' + r.kind), t('history.statuses.' + r.status),
        ms === null ? '' : (ms / 1000).toFixed(1),
        known ? r.cost!.amount : t('cost.unknown'), known ? r.cost!.currency : '',
        r.workflowId ? canvasName(r).trim() : '', r.prompt || '', r.error || '', r.id,
      ].map(csvCell).join(',')
    })
    // 带 BOM：Excel 才会按 UTF-8 读
    const blob = new Blob(['﻿' + [head.map(csvCell).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${t('history.csv.file')}_${from.value}_${to.value}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
    if (sum > all.length) MessagePlugin.warning(t('history.exportCapped', { n: list.length }))
    else MessagePlugin.success(t('history.exported', { n: list.length }))
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  loadCanvases()
  loadUsedModels()
  reload()
})
onBeforeUnmount(() => {
  alive = false
  window.clearTimeout(pollTimer)
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<style scoped>
.hi-head-text { min-width: 0; flex: 1 1 320px; }
.hi-head-acts { display: flex; gap: 8px; flex-wrap: wrap; }

/* ---- 汇总 ---- */
.hi-sum { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-top: 24px; }
.hi-stat { padding: 18px 20px; min-width: 0; }
.hi-stat > span { color: var(--text-2); font-size: 13px; display: flex; align-items: center; gap: 8px; }
.hi-stat > span svg { color: var(--cyan); }
.hi-stat b { display: block; font: 600 28px/34px var(--f-disp); margin-top: 8px; color: var(--text); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.hi-stat b.unk { font-size: 22px; color: var(--text-2); }
.hi-stat small { display: block; color: var(--text-3); font-size: 12px; line-height: 1.5; min-height: 18px; white-space: pre-wrap; }
.hi-sum.loading b { color: var(--text-3); }

/* ---- 筛选条 ---- */
.hi-fbar { margin-top: 24px; }
.hi-range { width: 232px; flex: none; }
.hi-sel { flex: none; }
.hi-sel.status { width: 132px; }
.hi-sel.model { width: 176px; }
.hi-reset { height: 32px; }
.hi-error { margin-top: 16px; align-items: center; }
.hi-error > span { flex: 1; min-width: 0; }

/* ---- 表格 ---- */
.hi-tbl { margin-top: 16px; overflow: hidden; }
.hi-th, .hi-tr {
  display: grid; gap: 16px; align-items: center; padding: 0 20px;
  grid-template-columns: 64px minmax(0, 1fr) 148px 64px 92px 72px 116px 88px 124px;
}
.hi-th { height: 40px; font-size: 12px; color: var(--text-3); background: rgba(4, 9, 28, .35); }
.hi-th > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hi-th .right { text-align: right; }
.hi-tr { height: 64px; border-top: 1px solid var(--line); font-size: 13px; transition: background .15s, opacity .15s; }
.hi-tr:hover { background: rgba(124, 160, 255, .05); }
.hi-tr.dim { opacity: .6; }
.hi-tr > *, .c-meta > * { min-width: 0; }
.c-meta { display: contents; }

.hi-thumb { width: 64px; height: 44px; border-radius: 8px; border: 1px solid var(--line); display: grid; place-items: center; padding: 0; color: var(--text-3); }
.hi-thumb.media { cursor: zoom-in; }
.hi-thumb.media:hover { border-color: var(--line-3); }
.hi-thumb.media:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.hi-thumb.busy { background: linear-gradient(135deg, rgba(63, 216, 255, .1), rgba(138, 92, 255, .16)); }
.hi-thumb.busy .lc-ring { --s: 32px; font-size: 10px; }
.hi-thumb.fail { background: rgba(255, 107, 139, .08); color: var(--err-soft); }
.hi-thumb.chat { background: rgba(59, 123, 255, .14); color: var(--kind-chat-fg); }
.hi-thumb .more {
  position: absolute; right: 3px; bottom: 3px; min-width: 16px; padding: 0 4px; border-radius: 5px;
  font: 500 10px/16px var(--f-mono); background: rgba(4, 9, 28, .72); color: var(--text);
}

.c-prompt b { display: block; font-weight: 500; font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.c-prompt b.lc-t3 { color: var(--text-3); font-weight: 400; }
.c-prompt small { display: block; font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 19px; }
.c-prompt small.err { color: var(--err-soft); }
.c-model { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.num { font-family: var(--f-mono); font-size: 12px; color: var(--text-2); white-space: nowrap; }
.c-cost.known { color: var(--text); }
.c-acts { display: flex; gap: 4px; justify-content: flex-end; }
.c-acts a.lc-tb:hover { background: rgba(124, 160, 255, .12); color: var(--text); }
.flip { transform: rotate(180deg); }

/* 骨架行 */
.skel { display: block; height: 12px; border-radius: 6px; background: var(--skel-bg); animation: lc-pulse 1.6s ease-in-out infinite; }
.skel.thumb { width: 64px; height: 44px; border-radius: 8px; }
.skel.w50 { width: 50%; } .skel.w60 { width: 60%; } .skel.w70 { width: 70%; } .skel.w80 { width: 80%; }
.skel-row:hover { background: none; }

.hi-empty { padding: 56px 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; border-top: 1px solid var(--line); }
.hi-empty-ic { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; color: var(--text-3); background: rgba(124, 160, 255, .08); margin-bottom: 4px; }
.hi-empty-t { color: var(--text-2); font-size: 14px; }
.hi-empty .lc-btn { margin-top: 8px; }

/* ---- 中等宽度：先收掉次要的两列 ---- */
@media (max-width: 1360px) {
  .hi-th, .hi-tr { grid-template-columns: 64px minmax(0, 1fr) 132px 64px 92px 116px 88px 124px; }
  .hi-th > :nth-child(6), .c-dur { display: none; }
}
@media (max-width: 1100px) {
  .hi-sum { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* ---- 窄屏：每行变成一张卡 ---- */
@media (max-width: 900px) {
  .hi-th { display: none; }
  .hi-tr {
    height: auto; padding: 14px 16px; gap: 10px 12px;
    grid-template-columns: 64px minmax(0, 1fr);
    grid-template-areas: 'thumb prompt' 'meta meta' 'acts acts';
  }
  .hi-th + .hi-tr { border-top: 0; }
  .c-thumb { grid-area: thumb; align-self: start; }
  .c-prompt { grid-area: prompt; }
  .c-prompt b { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.5; }
  .c-prompt small { margin-top: 2px; }
  .c-meta { grid-area: meta; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
  .c-model { color: var(--text-2); max-width: 100%; }
  .c-dur { display: inline; }
  .c-dur.empty { display: none; }
  .c-acts { grid-area: acts; margin-top: -2px; }
  .c-acts .lc-tb.sm { width: 34px; height: 34px; }
  .lc-pager { padding: 12px 16px; }
}
@media (max-width: 600px) {
  .hi-sum { gap: 12px; margin-top: 20px; }
  .hi-stat { padding: 14px 14px; }
  .hi-stat b { font-size: 24px; line-height: 30px; }
  .hi-stat b.unk { font-size: 18px; }
  .hi-fbar { margin-top: 20px; }
  .hi-range { width: 100%; }
  .hi-sel.status, .hi-sel.model { flex: 1 1 140px; width: auto; min-width: 0; }
  .hi-head-acts { width: 100%; }
}
</style>
