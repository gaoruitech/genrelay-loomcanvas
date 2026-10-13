<template>
  <div class="lc-page">
    <div class="lc-page-inner">
      <div class="lc-page-head">
        <div class="hi-head-text">
          <h1 class="lc-ph1">{{ t('history.title') }}</h1>
          <p class="lc-ph-sub">{{ space.isTeam ? t('history.team.sub', { team: space.name }) : t('history.sub') }}</p>
          <!-- 团队里：成员（以及团长没放开时的管理员）只看得到自己的记录，这句话说在最前面 -->
          <p v-if="space.isTeam && scope === 'own'" class="lc-ph-sub hi-own" data-testid="hi-own">{{ t('history.team.own') }}</p>
        </div>
        <span class="lc-sp" />
        <div class="hi-head-acts">
          <button v-if="canClear" class="lc-btn ghost" type="button" data-testid="hi-clear" @click="clearOpen = true"><LcIcon name="trash" />{{ t('history.clear') }}</button>
          <button class="lc-btn" type="button" :disabled="!!exporting || !total" :aria-busy="!!exporting" data-testid="hi-export" @click="exportCsv">
            <LcIcon :name="exporting ? 'refresh' : 'download'" :class="{ spinning: !!exporting }" />
            <span class="hi-num">{{ exporting ? t('history.exporting', exporting) : t('history.exportCsv') }}</span>
          </button>
        </div>
      </div>

      <!--
        四个汇总数字，跟着筛选条走。说的是同一件事的四个面：一共几条记录、跑成了几条、没跑成几条、花了多少。
        花费只算跑成了的（加上还在跑的占着的那一份）：失败、取消的不计费，团队里也不计入每月上限。
      -->
      <div class="hi-sum" :class="{ loading: summaryLoading && !totals, 'no-cost': !$feat.cost }" data-testid="hi-tiles">
        <div class="lc-card hi-stat" data-tile="records">
          <span><LcIcon name="history" size="s" />{{ t('history.tiles.records') }}</span>
          <b>{{ totals ? formatInt(totals.runs) : '—' }}</b>
          <small>{{ recordsNote }}</small>
          <small v-if="inProgress">{{ t('history.tiles.inProgress', { n: formatInt(inProgress) }) }}</small>
        </div>
        <div class="lc-card hi-stat" data-tile="succeeded">
          <span><LcIcon name="check" size="s" />{{ t('history.tiles.succeeded') }}</span>
          <b>{{ totals ? formatInt(totals.succeeded ?? 0) : '—' }}</b>
          <small>{{ successNote }}</small>
          <small v-if="space.isTeam && totals && counted" data-testid="hi-counted">{{ t('history.tiles.counted', { n: formatInt(counted) }) }}</small>
        </div>
        <div class="lc-card hi-stat" data-tile="notSucceeded">
          <span><LcIcon name="x" size="s" />{{ t('history.tiles.notSucceeded') }}</span>
          <b>{{ totals ? formatInt(notSucceeded) : '—' }}</b>
          <small>{{ notSucceededNote }}</small>
          <small v-if="totals && notSucceeded">{{ t(space.isTeam ? 'history.tiles.freeTeam' : 'history.tiles.free') }}</small>
        </div>
        <!-- 花费：集成方关了成本显示（features.cost）时，这一块、表里那一列、详情里那一行、导出里那三列都不出 -->
        <div v-if="$feat.cost" class="lc-card hi-stat" data-tile="cost">
          <span><LcIcon name="key" size="s" />{{ t('history.tiles.cost') }}</span>
          <b :class="{ unk: costTile.unknown }">{{ costTile.text }}</b>
          <small>{{ costTile.note }}</small>
          <small v-if="costTile.extra" data-testid="hi-cost-unknown">{{ costTile.extra }}</small>
        </div>
      </div>

      <div class="lc-fbar hi-fbar" :class="{ 'with-member': showMembers }">
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
          <button type="button" :class="{ on: kind === '' }" :aria-pressed="kind === ''" @click="kind = ''">{{ t('common.all') }}</button>
          <button v-for="k in KINDS" :key="k" type="button" :class="{ on: kind === k }" :aria-pressed="kind === k" :data-kind="k" @click="kind = k">{{ t('history.kinds.' + k) }}</button>
        </div>
        <div class="hi-sel status">
          <LcSelect v-model="status" :options="statusOptions" size="sm" :aria-label="t('history.filter.status')" />
        </div>
        <div class="hi-sel model">
          <LcSelect v-model="model" :options="modelOptions" size="sm" :aria-label="t('history.filter.model')" />
        </div>
        <div v-if="showMembers" class="hi-sel member" data-testid="hi-member">
          <LcSelect
            v-model="member" :options="memberOptions" size="sm" :aria-label="t('history.filter.member')"
            :searchable="memberOptions.length > 9" :search-placeholder="t('history.filter.memberSearch')"
          />
        </div>
        <label class="lc-inp sm hi-search">
          <LcIcon name="search" size="s" />
          <input
            v-model="q" type="search" :maxlength="SEARCH_MAX" :placeholder="t('history.filter.searchShort')" :aria-label="t('history.filter.search')"
            data-testid="hi-search" @keydown.enter.prevent="applySearch"
          />
        </label>
        <button class="lc-btn sm text hi-reset" type="button" :disabled="!filtered" data-testid="hi-reset" @click="resetFilters">{{ t('history.filter.reset') }}</button>
      </div>

      <!-- 勾了几条：结果打成一个压缩包带走（集成方关了打包下载 features.batchDownload：没有勾选，也就没有这一条） -->
      <div v-if="$feat.batchDownload && selected.size" class="hi-selbar" role="region" :aria-label="t('history.sel.count', { n: selected.size })" data-testid="hi-selbar">
        <b>{{ t('history.sel.count', { n: selected.size }) }}</b>
        <span class="lc-t2 hi-selbar-sub" v-tip="t('history.zip.hint')">{{ t('history.sel.files', { n: selectedFiles }, selectedFiles) }}</span>
        <span v-if="selectedFiles > ZIP_MAX_FILES" class="hi-selbar-warn" role="alert" data-testid="hi-sel-over"><LcIcon name="warn" size="s" />{{ t('history.sel.tooManyFiles', { max: ZIP_MAX_FILES, n: selectedFiles }) }}</span>
        <span class="lc-sp" />
        <div class="hi-selbar-acts">
          <span v-if="zipping === 'selection'" class="hi-selbar-prog hi-num" role="status">{{ zipProgress }}</span>
          <button
            class="lc-btn sm primary quiet" type="button" :disabled="!!zipping || selectedFiles > ZIP_MAX_FILES" :aria-busy="zipping === 'selection'"
            data-testid="hi-zip" @click="downloadSelected"
          >
            <LcIcon :name="zipping === 'selection' ? 'refresh' : 'download'" size="s" :class="{ spinning: zipping === 'selection' }" />
            {{ zipping === 'selection' ? t('history.sel.zipping') : t('history.sel.zip') }}
          </button>
          <button class="lc-btn sm text" type="button" :disabled="zipping === 'selection'" data-testid="hi-sel-clear" @click="clearSelection">{{ t('history.sel.clear') }}</button>
        </div>
      </div>

      <div v-if="loadError" class="lc-alert hi-error" role="alert">
        <LcIcon name="warn" />
        <span>{{ t('history.loadFailed') }}{{ loadError ? ' · ' + loadError : '' }}</span>
        <button class="lc-btn sm" type="button" @click="reload">{{ t('common.retry') }}</button>
      </div>

      <div ref="tblEl" class="lc-card hi-tbl" :class="['is-' + layout, { 'with-member': showMembers, 'no-cost': !$feat.cost, 'no-pick': !$feat.batchDownload }]" :data-layout="layout" data-testid="hi-table">
        <div class="hi-th">
          <!-- 勾选只为打包下载：features.batchDownload 关了，表头和每一行的勾选框都不出 -->
          <span v-if="$feat.batchDownload" class="h-ck">
            <button
              class="lc-cb" :class="{ on: pageAllSelected }" type="button" role="checkbox" :aria-checked="pageAllSelected"
              :disabled="!pageSelectable.length" :aria-label="pageCheckLabel" v-tip="pageCheckLabel" data-testid="hi-check-page" @click="togglePage"
            />
            <span class="h-ck-t">{{ pageCheckLabel }}</span>
          </span>
          <span class="h-col">{{ t('history.col.preview') }}</span>
          <span class="h-col">{{ t('history.col.prompt') }}</span>
          <span v-if="showMembers" class="h-col">{{ t('history.col.member') }}</span>
          <span class="h-col">{{ t('history.col.model') }}</span>
          <span class="h-col">{{ t('history.col.status') }}</span>
          <span class="h-col">{{ t('history.col.duration') }}</span>
          <span class="h-col">{{ t('history.col.time') }}</span>
          <span v-if="$feat.cost" class="h-col h-right">{{ t('history.col.cost') }}</span>
          <span class="h-col h-right">{{ t('history.col.actions') }}</span>
        </div>

        <!-- 冷启动才用骨架；翻页 / 轮询时旧行留着 -->
        <template v-if="recordsLoading && !records.length">
          <div v-for="n in 6" :key="n" class="hi-sk" aria-hidden="true">
            <span class="skel thumb" /><span class="skel-lines"><span class="skel w60" /><span class="skel w40" /></span><span class="skel w80 sk-end" />
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

        <div
          v-for="r in rows" v-else :key="r.id" class="hi-tr" :class="{ dim: recordsLoading, sel: selected.has(r.id) }"
          :data-id="r.id" :data-status="r.status" :data-kind="r.kind"
        >
          <div v-if="$feat.batchDownload" class="c-ck">
            <button
              class="lc-cb" :class="{ on: selected.has(r.id) }" type="button" role="checkbox" :aria-checked="selected.has(r.id)"
              :disabled="!zipFileCount(r)" :aria-label="checkLabel(r)" v-tip="checkLabel(r)" @click="toggleRow(r)"
            />
          </div>

          <!-- 预览：运行中用进度环，失败 / 对话用图标，其余是结果缩略图（文件就在记录里，不用再问一次） -->
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
              v-tip="t('history.detail.preview')" :aria-label="t('history.detail.preview')" @click="preview(firstOutput(r)!)"
            >
              <img v-if="thumbIsImage(firstOutput(r)!)" :src="thumbSrc(firstOutput(r)!)" alt="" loading="lazy" />
              <video v-else :src="ensureHttps(firstOutput(r)!.url)" muted playsinline preload="metadata" />
              <span v-if="outputsOf(r).length > 1" class="more">{{ outputsOf(r).length }}</span>
            </button>
            <span v-else-if="r.filesPurged" v-tip="t('history.filesPurged')" class="lc-thumb hi-thumb none purged" data-testid="hi-purged"><LcIcon name="trash" /></span>
            <span v-else class="lc-thumb hi-thumb none"><LcIcon :name="r.kind === 'video' ? 'video' : 'image'" /></span>
          </div>

          <div class="c-prompt">
            <b v-tip="{ text: r.prompt, clipped: true }" :class="{ 'lc-t3': !r.prompt }">{{ r.prompt || t('history.noPrompt') }}</b>
            <small v-if="r.status === 'failed' && r.error" class="err" v-tip="{ text: r.error, clipped: true }">{{ r.error }}</small>
            <!-- 不是人点的取消（发起人被移出团队、账号被停用、团队关了）：后端给了原因，写出来 -->
            <small v-else-if="canceledWhy(r)" class="why" v-tip="{ text: r.error, clipped: true }" data-testid="cancel-why">{{ r.error }}</small>
            <small v-else v-tip="{ text: canvasName(r), clipped: true }">{{ canvasName(r) }}</small>
          </div>

          <!-- 表格里这层不参与排版（display: contents）；排成两行 / 卡片时把这几项收成一行可换行的小字 -->
          <div class="c-meta">
            <span v-if="showMembers" class="c-member"><PersonName :person="r.createdBy" :avatar="22" stack /></span>
            <span class="c-model">
              <span class="c-model-n" v-tip="r.model">{{ r.modelLabel || r.model }}</span>
              <span class="lc-bd" :class="r.kind">{{ t('history.kinds.' + r.kind) }}</span>
            </span>
            <span class="c-status"><span class="lc-st" :class="statusClass(r.status)">{{ t('history.statuses.' + r.status) }}</span></span>
            <span class="c-dur num" :class="{ empty: durationMs(r) === null }" v-tip="t('history.col.duration')">{{ formatDuration(durationMs(r)) }}</span>
            <span class="c-time num" v-tip="formatFull(r.createdAt)">{{ formatWhen(r.createdAt) }}</span>
            <!-- 这一格的说明悬停时给；键盘和触屏上同一句话在详情里（每行多一个 Tab 停靠点不值得） -->
            <span v-if="$feat.cost" v-tip="costOf(r).note" class="c-cost" :class="'k-' + costOf(r).kind" :data-cost="costOf(r).kind">{{ costOf(r).text }}</span>
          </div>

          <div class="c-acts">
            <button class="lc-tb sm" type="button" v-tip="t('history.act.details')" :aria-label="t('history.act.details')" data-act="details" @click="detailId = r.id"><LcIcon name="eye" /></button>
            <router-link
              v-if="canvasExists(r)" class="lc-tb sm" :to="'/canvas/' + r.workflowId"
              v-tip="t('history.act.openCanvas')" :aria-label="t('history.act.openCanvas')"
            ><LcIcon name="canvas" /></router-link>
            <ConfirmPop
              v-if="isActive(r.status)"
              :text="t('history.cancelConfirm')" :hint="t('history.cancelHint')" :ok-text="t('history.act.cancel')"
              @ok="cancelRun(r)"
            >
              <button class="lc-tb sm" type="button" v-tip="t('history.act.cancel')" :aria-label="t('history.act.cancel')" :disabled="canceling === r.id"><LcIcon name="x" /></button>
            </ConfirmPop>
            <button
              v-else-if="firstOutput(r)" class="lc-tb sm" type="button" :disabled="zipping === r.id || (!!zipping && fileCount(r) > 1)"
              v-tip="downloadLabel(r)" :aria-label="downloadLabel(r)" data-act="download" @click="downloadAll(r)"
            ><LcIcon :name="zipping === r.id ? 'refresh' : 'download'" :class="{ spinning: zipping === r.id }" /></button>
            <button
              v-if="r.prompt" class="lc-tb sm" type="button"
              v-tip="t('history.act.copyPrompt')" :aria-label="t('history.act.copyPrompt')" data-act="copy-prompt" @click="copyPrompt(r)"
            ><LcIcon name="copy" /></button>
          </div>
        </div>

        <div v-if="total > 0" class="lc-pager">
          <span>{{ t('history.range', { from: rangeFrom, to: rangeTo, total }) }}</span>
          <span v-if="search" class="lc-t3" data-testid="hi-matched">{{ t('history.matched', { q: search }) }}</span>
          <span class="lc-sp" />
          <template v-if="pages > 1">
            <button class="lc-pg" type="button" :disabled="page <= 1 || recordsLoading" v-tip="t('history.prev')" :aria-label="t('history.prev')" @click="goPage(page - 1)">
              <LcIcon name="chev" size="s" class="flip" />
            </button>
            <template v-for="(p, i) in pageList" :key="i">
              <span v-if="p === 0" class="lc-t3">…</span>
              <button v-else class="lc-pg" type="button" :class="{ on: p === page }" :aria-current="p === page ? 'page' : undefined" :disabled="recordsLoading && p !== page" @click="goPage(p)">{{ p }}</button>
            </template>
            <button class="lc-pg" type="button" :disabled="page >= pages || recordsLoading" v-tip="t('history.next')" :aria-label="t('history.next')" @click="goPage(page + 1)">
              <LcIcon name="chev" size="s" />
            </button>
          </template>
        </div>
      </div>
    </div>

    <HistoryDetailDialog
      v-if="detail"
      :record="detail"
      :canvas-name="canvasName(detail)"
      :canvas-exists="canvasExists(detail)"
      :show-member="space.isTeam"
      :zipping="zipping === detail.id"
      @close="detailId = ''"
      @preview="preview"
      @download="(o, i) => downloadOutput(detail!, o, i)"
      @download-all="downloadAll(detail!)"
      @loaded="onFullLoaded"
    />
    <HistoryClearDialog v-if="clearOpen && canClear" @close="clearOpen = false" @cleared="onCleared" />
    <MediaLightbox :open="lightbox.open" :url="lightbox.url" :type="lightbox.type" @close="lightbox.open = false" />
  </div>
</template>

<script setup lang="ts">
/**
 * 「生成记录」页：这个空间里的每一次运行。
 *
 * - 记录本身带着结果文件（outputs）、进度、对话的回复（前一段），列表不再为它们多问一次；
 *   只有这一页还有没跑完的行时才隔几秒重取这一页。
 * - 汇总数字和每一行的「成本」用同一个口径：花费只算跑成了的（加上还在跑的占着的那一份），
 *   失败、取消的不计费——提交时估的那个数不再显示成「成本」。团队里「计入每月上限」= 已成功 + 进行中。
 * - 勾选几条（最多 100 条、100 个文件），结果打成一个 zip 一次下载；一条记录有几个文件时那一行的「下载」也是一个 zip。
 * - 导出的 CSV 是当前筛选下的全部记录（不只是这一页），对话记录带全文。
 * - 表格排成哪一种看它自己有多宽（见 historyFormat 的 historyLayout）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import ConfirmPop from '@/components/ConfirmPop.vue'
import PersonName from '@/components/PersonName.vue'
import MediaLightbox from '@/components/canvas/MediaLightbox.vue'
import HistoryDetailDialog from '@/components/history/HistoryDetailDialog.vue'
import HistoryClearDialog from '@/components/history/HistoryClearDialog.vue'
import {
  costOf, durationMs, fileCount, formatBytes, formatDuration, formatFull, formatInt, formatWhen, historyLayout, isActive, isoDate,
  statusClass, zipFileCount, type HistoryLayout,
} from '@/components/history/historyFormat'
import { recordsToCsv } from '@/components/history/historyCsv'
import { downloadRecordsZip, ZIP_MAX_FILES, ZIP_MAX_RECORDS } from '@/components/history/historyZip'
import { adminApi, runsApi, teamApi, workflowApi, unwrap, apiErrorMessage } from '@/utils/api'
import { useSpaceStore } from '@/stores/space'
import { formatMoney } from '@/utils/cost'
import { featureOn } from '@/utils/canvasBackend'
import { personName, personNote, personState } from '@/utils/person'
import { ensureHttps } from '@/utils/mediaUrl'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { writeClipboard } from '@/utils/clipboard'
import type { ModelKind, Person, RunOutput, RunStatus, TeamMember, UsageRecord, UsageSummaryRow } from '@/types'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const space = useSpaceStore()

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
/**
 * 团队里按成员筛（账号 id）。只对看得到全队的人有效：别人传了服务端也会忽略，界面上就不给这个筛选。
 * 团队用量页的每一行会带着 ?member=<id> 跳过来。
 */
const member = ref(space.isTeam && /^[0-9a-f]{24}$/i.test(qs('member')) ? qs('member').toLowerCase() : '')
/** 服务端说这次给的是谁的记录：all 全队的，own 只有调用者自己的。个人空间里没有这一项 */
const scope = ref<'all' | 'own' | ''>('')
const showMembers = computed(() => space.isTeam && scope.value === 'all')
/** 团队里清理记录只有团长可以（limits:manage）；个人空间照旧 */
const canClear = computed(() => !space.isTeam || space.can('limits:manage'))
/**
 * 文字搜索。q 是输入框里的字；停下来一会儿（或者按回车）才变成 search，真正拿去问服务端 ——
 * 服务端在提示词、模型（名称和 id）、画布名里找，按字面、不分大小写，筛的是这段时间的全部记录，不只是眼前这一页；
 * 汇总和导出用的也是同一个条件。
 */
const q = ref('')
const search = ref('')
/** 和服务端的上限是同一个数（超过它服务端会拒绝） */
const SEARCH_MAX = 100
const SEARCH_DELAY = 300
let searchTimer = 0
function applySearch() {
  window.clearTimeout(searchTimer)
  search.value = q.value.trim().slice(0, SEARCH_MAX)
}
// 清空立刻生效；输入中等人停下来
watch(q, (v) => {
  window.clearTimeout(searchTimer)
  if (!v.trim()) applySearch()
  else searchTimer = window.setTimeout(applySearch, SEARCH_DELAY)
})

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

const teamMembers = ref<TeamMember[]>([])
/** 这段时间里有记录的人（含已经离开团队、账号已删除的：成员名单里没有他们，记录还在） */
const recordPeople = ref<Person[]>([])
let membersAsked = false
/** 成员下拉的名单：只在确实看得到全队时才去取 */
async function loadMembers() {
  if (membersAsked || !space.isTeam) return
  membersAsked = true
  try {
    teamMembers.value = unwrap(await teamApi.members(space.currentId))?.members || []
  } catch { membersAsked = false /* 名单拿不到：下拉里只剩「全部成员」、有记录的人和当前选中的那一个 */ }
}
let peopleSeq = 0
async function loadRecordPeople() {
  if (!space.isTeam || scope.value !== 'all') return
  const seq = ++peopleSeq
  try {
    const data = unwrap(await adminApi.usage({ from: from.value, to: to.value, groupBy: 'member' }))
    if (seq === peopleSeq) recordPeople.value = (data?.items || []).map(i => i.member).filter((p): p is Person => !!p && !!p.id)
  } catch { /* 少了已离开的人这几项；筛选照常用 */ }
}
/**
 * 成员筛选的选项：现在的成员，后面跟着这段时间有记录、但已经不在团队里的人（名字照旧，下面一行写去向）。
 * 带着链接进来的那个人两边都没有时：用记录上的名字，再不行就是中性的称呼。
 */
const memberOptions = computed(() => {
  // locale：切换语言时「已离开团队」这些字跟着变
  void locale.value
  const list: { value: string; label: string; desc?: string }[] = teamMembers.value.map(m => ({
    value: m.id, label: m.name || m.username, ...(m.username && m.name && m.name !== m.username ? { desc: '@' + m.username } : {}),
  }))
  const add = (p?: Partial<Person> | null) => {
    if (!p?.id || list.some(o => o.value === p.id)) return
    // 名单还没到（或者拿不到）时，还在团队里的人也从这里补上
    const gone = personState(p) !== 'active'
    list.push({ value: p.id, label: personName(p), ...(gone ? { desc: personNote(p) || undefined } : p.username && p.name !== p.username ? { desc: '@' + p.username } : {}) })
  }
  for (const p of recordPeople.value) add(p)
  if (member.value && !list.some(o => o.value === member.value)) {
    const p = records.value.find(r => r.createdBy?.id === member.value)?.createdBy
    if (p) add(p)
    else list.push({ value: member.value, label: t('spaces.person.unknown') })
  }
  return [{ value: '', label: t('history.filter.memberAll') }, ...list]
})

const filtered = computed(() =>
  !!(kind.value || status.value || model.value || member.value || q.value || search.value || from.value !== DEFAULT_FROM || to.value !== todayText))

function resetFilters() {
  from.value = DEFAULT_FROM
  to.value = todayText
  kind.value = ''
  status.value = ''
  model.value = ''
  member.value = ''
  q.value = ''
  applySearch()
}

const queryParams = () => ({
  from: from.value, to: to.value,
  ...(kind.value ? { kind: kind.value } : {}),
  ...(status.value ? { status: status.value } : {}),
  ...(model.value ? { model: model.value } : {}),
  ...(member.value ? { member: member.value } : {}),
  ...(search.value ? { q: search.value } : {}),
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
  const out: UsageSummaryRow = { key: 'total', runs: 0, succeeded: 0, failed: 0, canceled: 0, inProgress: 0, amount: 0, currency: '', unknownCount: 0, costs: {}, reserved: {} }
  for (const r of rows) {
    out.runs += Number(r.runs) || 0
    out.succeeded! += Number(r.succeeded) || 0
    out.failed! += Number(r.failed) || 0
    out.canceled! += Number(r.canceled) || 0
    out.inProgress! += Number(r.inProgress) || 0
    out.unknownCount! += Number(r.unknownCount) || 0
    const costs = r.costs || (r.currency ? { [r.currency]: r.amount } : {})
    for (const [cur, amount] of Object.entries(costs)) out.costs![cur] = (out.costs![cur] || 0) + (Number(amount) || 0)
    for (const [cur, amount] of Object.entries(r.reserved || {})) out.reserved![cur] = (out.reserved![cur] || 0) + (Number(amount) || 0)
  }
  return out
}

let modelsSeq = 0
async function loadUsedModels() {
  const seq = ++modelsSeq
  try {
    const data = unwrap(await adminApi.usage({ from: from.value, to: to.value, groupBy: 'model', ...(member.value ? { member: member.value } : {}) }))
    if (seq === modelsSeq) usedModels.value = data?.items || []
  } catch { /* 模型下拉只是少了选项；真正的错误由列表请求报 */ }
}

/** 还在排队 / 运行 / 转存的条数（老服务端不给：用 全部 − 成功 − 失败 − 取消） */
const inProgress = computed(() => {
  const tt = totals.value
  if (!tt) return 0
  return Math.max(0, tt.inProgress ?? tt.runs - (tt.succeeded || 0) - (tt.failed || 0) - (tt.canceled || 0))
})
/** 团队里计入每月上限的次数 = 已成功 + 进行中 */
const counted = computed(() => totals.value?.counted?.runs ?? (totals.value?.succeeded || 0) + inProgress.value)
const notSucceeded = computed(() => (totals.value?.failed || 0) + (totals.value?.canceled || 0))

const recordsNote = computed(() => {
  if (!totals.value) return ' '
  if (!totals.value.runs) return t('history.tiles.noRuns')
  return byKind.value ? t('history.tiles.byKind', Object.fromEntries(KINDS.map(k => [k, formatInt(byKind.value![k])]))) : ' '
})
const successNote = computed(() => {
  const s = Number(totals.value?.succeeded) || 0
  const f = Number(totals.value?.failed) || 0
  if (!totals.value || !(s + f)) return ' '
  const rate = new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }).format(s / (s + f))
  return t('history.tiles.successRate', { rate })
})
const notSucceededNote = computed(() => {
  if (!totals.value) return ' '
  if (!notSucceeded.value) return totals.value.runs ? t('history.tiles.noFailed') : ' '
  return t('history.tiles.breakdown', { failed: formatInt(totals.value.failed || 0), canceled: formatInt(totals.value.canceled || 0) })
})
const moneyList = (m: Record<string, number>) => Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
/**
 * 预估花费 = 已成功且有价格的运行，加上还在跑的运行占着的（和团队用量页是同一个算法）。按币种分开列：不同币种不能相加。
 * 成功了但当时没有价格的次数单独说，不算成 0。
 */
const costTile = computed(() => {
  const tt = totals.value
  if (!tt) return { text: '—', note: ' ', extra: '', unknown: false }
  const sum: Record<string, number> = { ...(tt.costs || (tt.currency ? { [tt.currency]: tt.amount } : {})) }
  for (const [cur, v] of Object.entries(tt.reserved || {})) sum[cur] = Math.round(((sum[cur] || 0) + v) * 1e6) / 1e6
  const costs = moneyList(sum)
  const held = moneyList(tt.reserved || {}).map(([cur, v]) => formatMoney(v, cur)).join(' + ')
  const unknown = Number(tt.unknownCount) || 0
  if (costs.length) {
    return {
      text: costs.map(([cur, amount]) => formatMoney(amount, cur)).join(' + '),
      note: held ? t('history.tiles.costHeld', { held }) : t('history.tiles.costNote'),
      extra: unknown ? t('history.tiles.costUnknownSome', { n: formatInt(unknown) }, unknown) : '',
      unknown: false,
    }
  }
  if (unknown) return { text: t('cost.unknown'), note: t('history.tiles.costUnknownAll', { n: formatInt(unknown) }, unknown), extra: '', unknown: true }
  return { text: '—', note: t('history.tiles.costNote'), extra: '', unknown: false }
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
    scope.value = space.isTeam ? (data?.scope === 'own' ? 'own' : 'all') : ''
    // 清理或筛选后这一页可能已经不存在
    if (!records.value.length && total.value && page.value > 1) {
      page.value = Math.max(1, Math.ceil(total.value / PAGE_SIZE))
      return loadRecords(silent)
    }
    if (!silent) loadError.value = ''
    remember(records.value)
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

const outputsOf = (r: UsageRecord): RunOutput[] => (r.status === 'succeeded' && r.kind !== 'chat' ? r.outputs || [] : [])
const firstOutput = (r: UsageRecord): RunOutput | undefined => outputsOf(r)[0]
/** 视频只有在后端真给了封面图时才用 <img>，否则让 <video> 自己出首帧 */
const thumbIsImage = (o: RunOutput) => o.type === 'image' || (!!o.thumbnailUrl && o.thumbnailUrl !== o.url)
const thumbSrc = (o: RunOutput) => ensureHttps(o.thumbnailUrl || o.url)
function progressOf(r: UsageRecord): number {
  const p = Math.round(Number(r.progress) || 0)
  return p > 0 && p < 100 ? p : 0
}
/** 不是人点的取消：有原因可说 */
const canceledWhy = (r: UsageRecord) => r.status === 'canceled' && !!r.error && !!r.errorCode && r.errorCode !== 'run.canceled'

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

/** 这一页的行：筛选（包括文字搜索）都是服务端做的，这里不再筛一遍 */
const rows = computed(() => records.value)
const emptyTitle = computed(() => {
  if (search.value) return t('history.emptySearch', { q: search.value })
  return kind.value || status.value || model.value || member.value ? t('history.emptyFiltered') : t('history.empty')
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

watch([from, to, member], loadUsedModels)
watch([from, to], loadRecordPeople)
watch([from, to, kind, status, model, member, search], reload)

// 看得到全队：取成员名单。只看得到自己的：地址里带来的成员筛选不作数，去掉
watch(scope, (s) => {
  if (s === 'all') { void loadMembers(); void loadRecordPeople() }
  else if (s === 'own' && member.value) member.value = ''
})
// 成员筛选和地址保持一致：能把「只看某个人」的这一页发给别人，刷新也还在
watch(member, (id) => {
  const cur = typeof route.query.member === 'string' ? route.query.member : ''
  if (cur === id) return
  const query = { ...route.query }
  if (id) query.member = id
  else delete query.member
  void router.replace({ query }).catch(() => undefined)
})

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

// ---- 表格排成哪一种：看它自己有多宽 ----
const tblEl = ref<HTMLElement | null>(null)
const tblWidth = ref(0)
const layout = computed<HistoryLayout>(() => historyLayout(tblWidth.value, showMembers.value))
let ro: ResizeObserver | null = null
function measure() {
  if (tblEl.value) tblWidth.value = tblEl.value.clientWidth
}

// ---- 勾选 ----
/** 选中的记录 id → 它会变成几个文件。翻页、换筛选都留着（选的是记录，不是这一页的行） */
const selected = ref(new Map<string, number>())
const selectedFiles = computed(() => { let n = 0; for (const v of selected.value.values()) n += v; return n })
const pageSelectable = computed(() => rows.value.filter(r => zipFileCount(r) > 0))
const pageAllSelected = computed(() => pageSelectable.value.length > 0 && pageSelectable.value.every(r => selected.value.has(r.id)))
const pageCheckLabel = computed(() => pageSelectable.value.length
  ? t('history.sel.page', { n: pageSelectable.value.length }, pageSelectable.value.length)
  : t('history.sel.pageNone'))
const checkLabel = (r: UsageRecord) => (zipFileCount(r) ? t('history.sel.pick') : t('history.sel.nothing'))

function toggleRow(r: UsageRecord) {
  const n = zipFileCount(r)
  if (!n) return
  const next = new Map(selected.value)
  if (next.has(r.id)) next.delete(r.id)
  else if (next.size >= ZIP_MAX_RECORDS) { MessagePlugin.warning(t('history.sel.max', { max: ZIP_MAX_RECORDS })); return }
  else next.set(r.id, n)
  selected.value = next
}
function togglePage() {
  const next = new Map(selected.value)
  if (pageAllSelected.value) {
    for (const r of pageSelectable.value) next.delete(r.id)
  } else {
    for (const r of pageSelectable.value) {
      if (next.has(r.id)) continue
      if (next.size >= ZIP_MAX_RECORDS) { MessagePlugin.warning(t('history.sel.max', { max: ZIP_MAX_RECORDS })); break }
      next.set(r.id, zipFileCount(r))
    }
  }
  selected.value = next
}
function clearSelection() {
  selected.value = new Map()
}

// ---- 打包下载：一次只打一个包 ----
/** 正在打的是哪一个：'selection' 是勾选的那几条，其余是某一条记录的 id；空串 = 没在打 */
const zipping = ref('')
const zipLoaded = ref(0)
const zipProgress = computed(() => (zipLoaded.value > 0 ? t('history.sel.received', { size: formatBytes(zipLoaded.value) }) : ''))
const zipName = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t('history.csv.file')}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
async function zip(key: string, ids: string[], files: number): Promise<boolean> {
  if (zipping.value || !ids.length) return false
  zipping.value = key
  zipLoaded.value = 0
  try {
    const out = await downloadRecordsZip(ids, { name: zipName(), onProgress: (n) => { zipLoaded.value = n } })
    if (out.ok) {
      MessagePlugin.success(t('history.zip.done', { n: files }, files))
      return true
    }
    // 服务端说了为什么（文件太多、没有可下载的、已经有几个包在打）：照它的话说；否则是打到一半断了
    MessagePlugin.error(out.refusal?.message || t('history.zip.failed'))
    // 记录在这期间被清理、文件到了保留期：列表上的状态跟着更新
    if (out.refusal?.code === 'run.nothing_to_download') void loadRecords(true)
    return false
  } finally {
    zipping.value = ''
  }
}
async function downloadSelected() {
  if (selectedFiles.value > ZIP_MAX_FILES) return
  if (await zip('selection', [...selected.value.keys()], selectedFiles.value)) clearSelection()
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
/** 集成方关了打包下载（features.batchDownload）：不提 ZIP，几个文件就一个一个地下 */
const downloadLabel = (r: UsageRecord) => {
  const n = fileCount(r)
  if (n <= 1) return t('history.act.download')
  return t(featureOn('batchDownload') ? 'history.act.downloadZip' : 'history.act.downloadEach', { n })
}
/** 一个文件直接下；几个文件打成一个 zip（一次请求），不再一个一个地弹下载。打包下载关着时才挨个下 */
async function downloadAll(r: UsageRecord) {
  const list = outputsOf(r)
  if (list.length === 1) return downloadOutput(r, list[0], 0)
  if (list.length < 1) return
  if (featureOn('batchDownload')) { await zip(r.id, [r.id], list.length); return }
  if (zipping.value) return
  zipping.value = r.id
  try {
    for (let i = 0; i < list.length; i++) await downloadOutput(r, list[i], i)
  } finally {
    zipping.value = ''
  }
}

/**
 * 记录的全文（完整的提示词、回复）。列表里超过 200 个字符的提示词是截过的：复制之前先把全文取来。
 * 详情弹窗读到的全文也记在这里，同一条不取第二次。
 */
const fullRecords = new Map<string, UsageRecord>()
/** 这一页的记录换了：已经不是那个状态的全文不能再用 */
function remember(list: UsageRecord[]) {
  for (const r of list) {
    const full = fullRecords.get(r.id)
    if (full && full.status !== r.status) fullRecords.delete(r.id)
  }
}
function onFullLoaded(r: UsageRecord) {
  fullRecords.set(r.id, r)
}
async function fullOf(r: UsageRecord): Promise<UsageRecord> {
  if (!r.promptTruncated && !r.textTruncated) return r
  const hit = fullRecords.get(r.id)
  if (hit) return hit
  const full = unwrap(await adminApi.usageRecord(r.id))
  fullRecords.set(r.id, full)
  return full
}

async function copyPrompt(r: UsageRecord) {
  try {
    const full = await fullOf(r).catch(() => r)
    await writeClipboard(full.prompt || '')
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
  // 选中的记录可能已经被清掉了
  clearSelection()
  fullRecords.clear()
  loadUsedModels()
  void loadRecordPeople()
  reload()
}

// ---- 导出：当前筛选下的全部记录（不只是这一页），每条都是全文 ----
const exporting = ref<{ done: number; total: number } | null>(null)
async function exportCsv() {
  if (exporting.value) return
  exporting.value = { done: 0, total: total.value }
  try {
    const all: UsageRecord[] = []
    let sum = 0
    for (let p = 1; all.length < EXPORT_CAP; p++) {
      const data = unwrap(await adminApi.usageRecords({ ...queryParams(), page: p, pageSize: 100, full: 1 }))
      const list = data?.list || []
      sum = Number(data?.total) || 0
      all.push(...list)
      exporting.value = { done: Math.min(all.length, EXPORT_CAP), total: Math.min(sum, EXPORT_CAP) }
      if (!list.length || all.length >= sum) break
    }
    const list = all.slice(0, EXPORT_CAP)
    if (!list.length) {
      MessagePlugin.warning(t('history.exportEmpty'))
      return
    }
    const csv = recordsToCsv(list, { withMember: space.isTeam, withCost: featureOn('cost'), canvasName: r => (r.workflowId ? canvasName(r).trim() : '') })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `${t('history.csv.file')}_${from.value}_${to.value}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    if (sum > all.length) MessagePlugin.warning(t('history.exportCapped', { n: list.length }))
    else MessagePlugin.success(t('history.exported', { n: list.length }, list.length))
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    exporting.value = null
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibility)
  measure()
  if (tblEl.value && typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(measure)
    ro.observe(tblEl.value)
  }
  loadCanvases()
  loadUsedModels()
  reload()
})
onBeforeUnmount(() => {
  alive = false
  window.clearTimeout(pollTimer)
  window.clearTimeout(searchTimer)
  ro?.disconnect()
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<style scoped>
.hi-head-text { min-width: 0; flex: 1 1 320px; }
.hi-head-acts { display: flex; gap: 8px; flex-wrap: wrap; }
.hi-num { font-variant-numeric: tabular-nums; }
.spinning { animation: spin 1s linear infinite; }

/* ---- 汇总 ---- */
.hi-sum { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin-top: 24px; }
.hi-sum.no-cost { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.hi-stat { padding: 18px 20px; min-width: 0; }
.hi-stat > span { color: var(--text-2); font-size: 13px; display: flex; align-items: center; gap: 8px; }
.hi-stat > span svg { color: var(--cyan); }
.hi-stat b { display: block; font: 600 28px/34px var(--f-disp); margin: 8px 0 2px; color: var(--text); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.hi-stat b.unk { font-size: 22px; color: var(--text-2); }
.hi-stat small { display: block; color: var(--text-3); font-size: 12px; line-height: 1.6; min-height: 19px; white-space: pre-wrap; }
.hi-sum.loading b { color: var(--text-3); }

/* ---- 筛选条：1440 宽的窗口里连「成员」和「重置筛选」在内排成一行 ---- */
.hi-fbar { margin-top: 24px; }
.hi-range { width: 232px; flex: none; }
.hi-sel { flex: none; }
.hi-sel.status { width: 120px; }
.hi-sel.model { width: 164px; }
.hi-sel.member { width: 140px; }
.hi-fbar.with-member .hi-sel.model { width: 148px; }
.hi-search { flex: 1 1 140px; min-width: 0; }
.hi-own { color: var(--text-3); font-size: 13px; }
.hi-reset { height: 32px; flex: none; white-space: nowrap; }
.hi-error { margin-top: 16px; align-items: center; }
.hi-error > span { flex: 1; min-width: 0; }

/* ---- 选中条：往下翻着勾的时候它跟着停在顶上，数目和「下载」一直看得见 ---- */
.hi-selbar {
  position: sticky; top: 12px; z-index: 20;
  display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; margin-top: 16px;
  min-height: 48px; padding: 8px 8px 8px 16px; border-radius: 12px;
  border: 1px solid rgb(var(--c-cyan) / .45);
  background: linear-gradient(rgb(var(--c-cyan) / .1), rgb(var(--c-cyan) / .1)), var(--panel-solid);
  box-shadow: var(--sh-1);
}
.hi-selbar b { font-weight: 600; font-variant-numeric: tabular-nums; }
.hi-selbar-sub { font-size: 13px; font-variant-numeric: tabular-nums; }
.hi-selbar-warn { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--warn); min-width: 0; }
.hi-selbar-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.hi-selbar-prog { font-size: 12px; color: var(--text-2); }

/* ---- 记录表 ---- */
.hi-tbl { margin-top: 16px; overflow: hidden; }
.hi-th, .hi-tr { display: grid; gap: 12px; align-items: center; padding: 0 20px; }
.hi-th { min-height: 40px; font-size: 12px; color: var(--text-3); background: rgb(var(--c-well) / .35); }
.hi-th > .h-col { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.h-right { text-align: right; }
.h-ck { display: flex; align-items: center; gap: 10px; min-width: 0; }
.h-ck-t { display: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hi-tbl .lc-cb { cursor: pointer; }
.hi-tbl .lc-cb:disabled { opacity: .35; cursor: not-allowed; }
.hi-tr { border-top: 1px solid var(--line); font-size: 13px; transition: background .15s, opacity .15s; }
.hi-tr:hover { background: rgb(var(--c-film) / .05); }
.hi-tr.sel { background: rgb(var(--c-cyan) / .06); }
.hi-tr.dim { opacity: .6; }
.hi-tr > *, .c-meta > * { min-width: 0; }
.c-ck { display: flex; }

.hi-thumb { width: 64px; height: 44px; border-radius: 8px; border: 1px solid var(--line); display: grid; place-items: center; padding: 0; color: var(--text-3); }
.hi-thumb.media { cursor: zoom-in; }
.hi-thumb.media:hover { border-color: var(--line-3); }
.hi-thumb.media:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.hi-thumb.busy { background: linear-gradient(135deg, rgb(var(--c-cyan) / .1), rgb(var(--c-violet) / .16)); }
.hi-thumb.busy .lc-ring { --s: 32px; font-size: 10px; }
.hi-thumb.fail { background: rgb(var(--c-err) / .08); color: var(--err-soft); }
.hi-thumb.chat { background: rgb(var(--c-blue) / .14); color: var(--kind-chat-fg); }
.hi-thumb.purged { border-style: dashed; cursor: help; }
.hi-thumb .more {
  position: absolute; right: 3px; bottom: 3px; min-width: 16px; padding: 0 4px; border-radius: 5px;
  font: 500 10px/16px var(--f-mono); background: rgb(var(--c-scrim) / .72); color: var(--on-media);
}

.c-prompt b { display: block; font-weight: 500; font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.c-prompt b.lc-t3 { color: var(--text-3); font-weight: 400; }
.c-prompt small { display: block; font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 19px; }
.c-prompt small.err { color: var(--err-soft); }
.c-member { display: flex; min-width: 0; font-size: 13px; color: var(--text); }
.c-member :deep(.pn-tag) { height: 18px; padding: 0 6px; font-size: 11px; }
.c-model { display: grid; gap: 3px; justify-items: start; min-width: 0; }
.c-model-n { max-width: 100%; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.c-model .lc-bd { height: 18px; padding: 0 6px; font-size: 11px; }
.num { font-family: var(--f-mono); font-size: 12px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.c-cost { font: 12px var(--f-mono); color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-radius: 4px; }
.c-cost.k-none, .c-cost.k-unknown { font: 12px var(--f-body); color: var(--text-3); }
.c-cost.k-estimate { color: var(--text-2); }
.c-acts { display: flex; gap: 4px; justify-content: flex-end; }
.c-acts a.lc-tb:hover { background: rgb(var(--c-film) / .12); color: var(--text); }
.flip { transform: rotate(180deg); }

/* 一、表格：每项一列。团队里多一列「成员」 */
/* 用时一列 80px：写成「12 分 05 秒」/「1m 05s」（utils/duration.ts，全站一种写法），不再是 1:52 */
.is-table .hi-th, .is-table .hi-tr { grid-template-columns: 20px 64px minmax(0, 1fr) 140px 88px 80px 112px 92px 124px; }
.is-table.with-member .hi-th, .is-table.with-member .hi-tr { grid-template-columns: 20px 64px minmax(0, 1fr) 128px 128px 84px 80px 112px 88px 124px; }
/* 没有「成本」一列（features.cost 关了）：少一列，其余的列宽不变 */
.is-table.no-cost .hi-th, .is-table.no-cost .hi-tr { grid-template-columns: 20px 64px minmax(0, 1fr) 140px 88px 80px 112px 124px; }
.is-table.no-cost.with-member .hi-th, .is-table.no-cost.with-member .hi-tr { grid-template-columns: 20px 64px minmax(0, 1fr) 128px 128px 84px 80px 112px 124px; }
/* 没有勾选那一列（features.batchDownload 关了：勾选只为打包下载）：去掉最前面的 20px，其余的列宽不变 */
.no-pick.is-table .hi-th, .no-pick.is-table .hi-tr { grid-template-columns: 64px minmax(0, 1fr) 140px 88px 80px 112px 92px 124px; }
.no-pick.is-table.with-member .hi-th, .no-pick.is-table.with-member .hi-tr { grid-template-columns: 64px minmax(0, 1fr) 128px 128px 84px 80px 112px 88px 124px; }
.no-pick.is-table.no-cost .hi-th, .no-pick.is-table.no-cost .hi-tr { grid-template-columns: 64px minmax(0, 1fr) 140px 88px 80px 112px 124px; }
.no-pick.is-table.no-cost.with-member .hi-th, .no-pick.is-table.no-cost.with-member .hi-tr { grid-template-columns: 64px minmax(0, 1fr) 128px 128px 84px 80px 112px 124px; }
.is-table .hi-tr { min-height: 64px; padding-top: 8px; padding-bottom: 8px; }
.is-table .c-meta { display: contents; }
.is-table .c-cost { text-align: right; }

/* 二、两行：提示词占满一行，其余几项收成下面一行小字（1100px 宽的窗口、平板） */
.is-list .hi-th, .is-cards .hi-th { grid-template-columns: minmax(0, 1fr); }
.is-list .h-col, .is-cards .h-col { display: none; }
.is-list .h-ck-t, .is-cards .h-ck-t { display: block; }
.is-list .hi-tr {
  grid-template-columns: 20px 64px minmax(0, 1fr) auto; gap: 4px 12px; padding: 12px 20px;
  grid-template-areas: 'ck thumb prompt acts' 'ck thumb meta acts';
}
.is-list .c-ck, .is-cards .c-ck { grid-area: ck; align-self: start; padding-top: 14px; }
.is-list .c-thumb, .is-cards .c-thumb { grid-area: thumb; align-self: start; }
.is-list .c-prompt, .is-cards .c-prompt { grid-area: prompt; }
.is-list .c-acts { grid-area: acts; align-self: start; padding-top: 8px; }
.is-list .c-meta, .is-cards .c-meta { grid-area: meta; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
.is-list .c-model, .is-cards .c-model { display: flex; align-items: center; gap: 8px; }
.is-list .c-model-n, .is-cards .c-model-n { color: var(--text-2); }
.is-list .c-member, .is-cards .c-member { max-width: 100%; }
.is-list .c-member :deep(.pn.stack), .is-cards .c-member :deep(.pn.stack) { flex-wrap: nowrap; }
.is-list .c-dur.empty, .is-cards .c-dur.empty { display: none; }

/* 三、卡片：手机上一条一张 */
.is-cards .hi-th { padding: 0 16px; }
.is-cards .hi-tr {
  grid-template-columns: 20px 64px minmax(0, 1fr); gap: 10px 12px; padding: 14px 16px;
  grid-template-areas: 'ck thumb prompt' 'meta meta meta' 'acts acts acts';
}
/* 两行 / 卡片里表头只有「选中本页」那一格：没有勾选时整条表头不出，行里也少掉那一列 */
.no-pick.is-list .hi-th, .no-pick.is-cards .hi-th { display: none; }
.no-pick.is-list .hi-th + .hi-tr, .no-pick.is-cards .hi-th + .hi-tr { border-top: 0; }
.no-pick.is-list .hi-tr { grid-template-columns: 64px minmax(0, 1fr) auto; grid-template-areas: 'thumb prompt acts' 'thumb meta acts'; }
.no-pick.is-cards .hi-tr { grid-template-columns: 64px minmax(0, 1fr); grid-template-areas: 'thumb prompt' 'meta meta' 'acts acts'; }
.is-cards .c-prompt b { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.5; }
.is-cards .c-prompt small { margin-top: 2px; }
.is-cards .c-acts { grid-area: acts; margin-top: -2px; }
.is-cards .c-acts .lc-tb.sm { width: 34px; height: 34px; }
.is-cards .lc-pager { padding: 12px 16px; }
@media (pointer: coarse) {
  .hi-tbl .lc-cb { position: relative; }
  .hi-tbl .lc-cb::before { content: ''; position: absolute; inset: -10px; }
}

/* 骨架行 */
.hi-sk { display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 20px; border-top: 1px solid var(--line); }
.skel { display: block; height: 12px; border-radius: 6px; background: var(--skel-bg); animation: lc-pulse 1.6s ease-in-out infinite; }
.skel.thumb { width: 64px; height: 44px; border-radius: 8px; flex: none; }
.skel-lines { flex: 1; min-width: 0; display: grid; gap: 8px; }
.skel.w40 { width: 40%; } .skel.w60 { width: 60%; } .skel.w80 { width: 80px; }
.sk-end { flex: none; }

.hi-empty { padding: 56px 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; border-top: 1px solid var(--line); }
.hi-empty-ic { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; color: var(--text-3); background: rgb(var(--c-film) / .08); margin-bottom: 4px; }
.hi-empty-t { color: var(--text-2); font-size: 14px; }
.hi-empty .lc-btn { margin-top: 8px; }

@media (max-width: 1100px) {
  .hi-sum { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hi-sum.no-cost { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 720px) {
  /* 三块排两列：最后一块占满一行，不留半个空位 */
  .hi-sum.no-cost { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hi-sum.no-cost > :last-child { grid-column: 1 / -1; }
}
@media (max-width: 600px) {
  .hi-sum { gap: 12px; margin-top: 20px; }
  .hi-stat { padding: 14px 14px; }
  .hi-stat b { font-size: 24px; line-height: 30px; }
  .hi-stat b.unk { font-size: 18px; }
  .hi-fbar { margin-top: 20px; }
  .hi-range { width: 100%; }
  .hi-sel.status, .hi-sel.model, .hi-sel.member, .hi-fbar.with-member .hi-sel.model { flex: 1 1 140px; width: auto; min-width: 0; }
  .hi-search { flex-basis: 100%; }
  .hi-head-acts { width: 100%; }
  .hi-selbar { padding: 10px 12px; }
  .hi-selbar-acts { width: 100%; }
}
</style>
