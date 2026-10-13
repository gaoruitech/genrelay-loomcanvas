<template>
  <div class="lb" :class="[meter.state, { compact }]" :data-state="meter.state">
    <div
      v-if="meter.limit != null"
      class="lb-track"
      role="progressbar"
      :aria-label="label || undefined"
      aria-valuemin="0"
      :aria-valuemax="meter.limit"
      :aria-valuenow="meter.used"
      :aria-valuetext="text"
    >
      <i :style="{ width: pct + '%' }" />
    </div>
    <span v-if="!hideText" class="lb-text lc-mono">{{ text }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * 每月上限的一根进度条：用了多少 / 上限多少。
 * 颜色跟着 meter.state 走（near 提醒色、reached 错误色）—— 那是服务端算好的，这里不自己按比例再判一次。
 * 没设上限（limit 为 null）不画条，写「804 次 · 不限」：没有上限也照样说用了多少。
 */
import { computed } from 'vue'
import { meterPercent, meterText } from '@/utils/budget'
import type { LimitMeterState } from '@/types'

const props = withDefaults(defineProps<{
  meter: LimitMeterState
  /** runs：次数；amount：预估金额（要给 currency） */
  unit?: 'runs' | 'amount'
  currency?: string
  label?: string
  compact?: boolean
  hideText?: boolean
}>(), { unit: 'runs', currency: 'CNY', label: '', compact: false, hideText: false })

const pct = computed(() => meterPercent(props.meter, props.meter.state))
const text = computed(() => meterText(props.meter, props.unit, props.currency))
</script>

<style scoped>
.lb { display: flex; align-items: center; gap: 12px; min-width: 0; }
.lb-track { flex: 1 1 80px; min-width: 48px; height: 6px; border-radius: 3px; background: rgb(var(--c-film) / .16); overflow: hidden; }
.lb-track i { display: block; height: 100%; border-radius: 3px; background: var(--cyan); transition: width .3s; }
.lb.near .lb-track i { background: var(--warn); }
.lb.reached .lb-track i { background: var(--err); }
.lb-text { flex: none; font-size: 12px; color: var(--text-2); white-space: nowrap; }
.lb.unlimited .lb-text { color: var(--text-3); }
.lb.near .lb-text { color: var(--warn); }
.lb.reached .lb-text { color: var(--err-soft); }
.lb.compact { gap: 8px; }
.lb.compact .lb-track { height: 4px; }
</style>
