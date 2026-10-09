<template>
  <section>
    <div class="tab-head">
      <div>
        <h2>{{ t('settings.usage.title') }}</h2>
        <p class="tab-desc">{{ t('settings.usage.desc') }}</p>
      </div>
      <form class="range" @submit.prevent="reload">
        <input v-model="from" class="lc-input sm" type="date" :max="to" :aria-label="t('settings.usage.from')" />
        <span class="range-sep">–</span>
        <input v-model="to" class="lc-input sm" type="date" :min="from" :aria-label="t('settings.usage.to')" />
        <button class="lc-btn sm" type="submit" :disabled="loading">{{ t('settings.usage.query') }}</button>
      </form>
    </div>

    <p v-if="loadError" class="lc-error-text err">{{ loadError }}</p>

    <div class="totals">
      <div class="lc-card total">
        <div class="total-label">{{ t('settings.usage.totalRuns') }}</div>
        <div class="total-value">{{ totalRuns }}</div>
      </div>
      <div class="lc-card total">
        <div class="total-label">{{ t('settings.usage.totalCost') }}</div>
        <div class="total-value">{{ totalCostText }}</div>
        <div v-if="totalUnknown" class="total-note">{{ t('settings.usage.unknownNote', { n: totalUnknown }) }}</div>
      </div>
    </div>

    <div class="summaries">
      <div class="lc-card">
        <h3 class="section-title first">{{ t('settings.usage.byDay') }}</h3>
        <SummaryTable :rows="byDay" :key-title="t('settings.usage.date')" :loading="loading" />
      </div>
      <div class="lc-card">
        <h3 class="section-title first">{{ t('settings.usage.byModel') }}</h3>
        <SummaryTable :rows="byModel" :key-title="t('settings.usage.model')" :loading="loading" />
      </div>
    </div>

    <h3 class="section-title">{{ t('settings.usage.records') }}</h3>
    <div class="lc-card lc-table-wrap">
      <table class="lc-table">
        <thead>
          <tr>
            <th>{{ t('settings.usage.time') }}</th>
            <th>{{ t('settings.usage.model') }}</th>
            <th>{{ t('settings.usage.kind') }}</th>
            <th>{{ t('settings.usage.status') }}</th>
            <th class="num">{{ t('settings.usage.cost') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in records" :key="r.id">
            <td class="nowrap">{{ formatTime(r.createdAt) }}</td>
            <td>{{ r.model }}</td>
            <td><span class="lc-tag">{{ t('settings.models.kinds.' + r.kind) }}</span></td>
            <td><span class="lc-tag" :class="statusClass(r.status)">{{ t('settings.usage.statuses.' + r.status) }}</span></td>
            <td class="num">{{ formatCost(r.cost) || '—' }}</td>
          </tr>
          <tr v-if="!records.length">
            <td colspan="5" class="lc-empty">{{ recordsLoading ? t('common.loading') : t('settings.usage.noRecords') }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="total > PAGE_SIZE" class="pager">
      <button class="lc-btn sm" :disabled="page <= 1 || recordsLoading" @click="goPage(page - 1)">{{ t('settings.usage.prev') }}</button>
      <span>{{ t('settings.usage.pageOf', { page, pages }) }}</span>
      <button class="lc-btn sm" :disabled="page >= pages || recordsLoading" @click="goPage(page + 1)">{{ t('settings.usage.next') }}</button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { formatCost, formatMoney } from '@/utils/cost'
import SummaryTable from './UsageSummaryTable.vue'
import type { RunStatus, UsageRecord, UsageSummaryRow } from '@/types'

const { t, locale } = useI18n()

const PAGE_SIZE = 20

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const today = new Date()
const to = ref(isoDate(today))
const from = ref(isoDate(new Date(today.getTime() - 29 * 86400000)))

const byDay = ref<UsageSummaryRow[]>([])
const byModel = ref<UsageSummaryRow[]>([])
const loading = ref(false)
const loadError = ref('')

const records = ref<UsageRecord[]>([])
const recordsLoading = ref(false)
const page = ref(1)
const total = ref(0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

const totalRuns = computed(() => byModel.value.reduce((s, r) => s + (Number(r.runs) || 0), 0))
const totalUnknown = computed(() => byModel.value.reduce((s, r) => s + (Number(r.unknownCount) || 0), 0))

/** 合计按币种分开列：不同币种不能相加 */
const totalCostText = computed(() => {
  const sums = new Map<string, number>()
  for (const r of byModel.value) {
    if (!r.currency) continue
    sums.set(r.currency, (sums.get(r.currency) || 0) + (Number(r.amount) || 0))
  }
  if (!sums.size) return '—'
  return [...sums.entries()].map(([cur, amount]) => formatMoney(amount, cur)).join(' + ')
})

async function loadSummary() {
  loading.value = true
  loadError.value = ''
  try {
    const range = { from: from.value, to: to.value }
    const [d, m] = await Promise.all([
      adminApi.usage({ ...range, groupBy: 'day' }),
      adminApi.usage({ ...range, groupBy: 'model' }),
    ])
    byDay.value = unwrap(d)?.items || []
    byModel.value = unwrap(m)?.items || []
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}

async function loadRecords() {
  recordsLoading.value = true
  try {
    const data = unwrap(await adminApi.usageRecords({
      from: from.value, to: to.value, page: page.value, pageSize: PAGE_SIZE,
    }))
    records.value = data?.list || []
    total.value = Number(data?.total) || 0
  } catch (err) {
    records.value = []
    total.value = 0
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    recordsLoading.value = false
  }
}

function reload() {
  page.value = 1
  loadSummary()
  loadRecords()
}

function goPage(p: number) {
  page.value = Math.min(pages.value, Math.max(1, p))
  loadRecords()
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso || ''
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }).format(d)
}

function statusClass(s: RunStatus): string {
  if (s === 'succeeded') return 'ok'
  if (s === 'failed') return 'err'
  if (s === 'canceled') return ''
  return 'warn'
}

onMounted(reload)
</script>

<style scoped>
@import './tab-shared.css';

.range { display: flex; align-items: center; gap: 8px; flex: none; }
.range .lc-input { width: 140px; }
.range-sep { color: var(--t-dim); }
.totals { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 12px; }
.total-label { font-size: 12px; color: var(--t-dim); margin-bottom: 6px; }
.total-value { font-size: 22px; font-weight: 600; color: var(--t-max); font-variant-numeric: tabular-nums; }
.total-note { margin-top: 4px; font-size: 12px; color: var(--t-dim); }
.summaries { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
.section-title.first { margin-top: 0; }
.nowrap { white-space: nowrap; }
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 12px; font-size: 12.5px; color: var(--t-dim); }
.err { margin-bottom: 12px; }

@media (max-width: 720px) {
  .tab-head { flex-direction: column; }
}
</style>
