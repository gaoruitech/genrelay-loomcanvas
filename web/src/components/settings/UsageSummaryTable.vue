<template>
  <div class="lc-table-wrap">
    <table class="lc-table">
      <thead>
        <tr>
          <th>{{ keyTitle }}</th>
          <th class="num">{{ t('settings.usage.runs') }}</th>
          <th class="num">{{ t('settings.usage.failed') }}</th>
          <th class="num">{{ t('settings.usage.cost') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.key">
          <td>
            <div class="key">{{ r.label || r.key }}</div>
            <div class="bar"><span :style="{ width: barWidth(r) }" /></div>
          </td>
          <td class="num">{{ r.runs }}</td>
          <td class="num">{{ r.failed ?? 0 }}</td>
          <td class="num">{{ r.currency ? formatMoney(r.amount, r.currency) : '—' }}</td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="4" class="lc-empty">{{ loading ? t('common.loading') : t('settings.usage.noData') }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatMoney } from '@/utils/cost'
import type { UsageSummaryRow } from '@/types'

const props = defineProps<{
  rows: UsageSummaryRow[]
  keyTitle: string
  loading?: boolean
}>()

const { t } = useI18n()

const maxRuns = computed(() => Math.max(1, ...props.rows.map(r => Number(r.runs) || 0)))

function barWidth(r: UsageSummaryRow): string {
  return `${Math.round(((Number(r.runs) || 0) / maxRuns.value) * 100)}%`
}
</script>

<style scoped>
.key { color: var(--t-strong); word-break: break-all; }
.bar { margin-top: 5px; height: 3px; border-radius: 2px; background: var(--n-4); overflow: hidden; }
.bar span { display: block; height: 100%; background: var(--accent-veil); }
</style>
