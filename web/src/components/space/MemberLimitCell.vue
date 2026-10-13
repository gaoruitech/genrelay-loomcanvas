<template>
  <span v-if="!effective" class="lc-t3">—</span>
  <div v-else class="mlc" :data-state="effective.state" data-testid="member-limit">
    <LimitBar
      v-for="u in limited" :key="u" compact :meter="effective[u]" :unit="u" :currency="currency"
      :label="t(u === 'runs' ? 'spaces.limits.runsLabel' : 'spaces.limits.amountLabel')"
    />
    <span v-if="!limited.length" class="lc-t3">{{ t('spaces.limits.unlimited') }}</span>
    <span v-if="tag" class="lc-tag" :class="effective.state === 'reached' ? 'err' : 'warn'" data-testid="member-limit-state">{{ tag }}</span>
  </div>
</template>

<script setup lang="ts">
/**
 * 表格里一名成员的本月上限：设了上限的那几项各一根细条，接近或到了上限带一个小标签。
 * 状态取服务端给的 effective（成员自己的上限还有余量、团队的用完了，也是 reached，标签写明是团队的）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LimitBar from './LimitBar.vue'
import { blockedText } from '@/utils/budget'
import type { LimitEffective } from '@/types'
import { useEmbed } from '@/embed/context'

const props = withDefaults(defineProps<{ effective?: LimitEffective | null; currency?: string }>(), { effective: null, currency: 'CNY' })
const { t, locale } = useI18n()

/** 集成方关了成本显示（features.cost）：金额那一根条不出 */
const costOn = useEmbed().features.cost
const limited = computed(() => (['runs', 'amount'] as const).filter((u) => (u === 'runs' || costOn) && props.effective && props.effective[u].limit != null))
const tag = computed(() => {
  void locale.value
  const e = props.effective
  if (!e) return ''
  if (e.blockedBy) return blockedText({ effective: e })
  return e.state === 'near' ? t('spaces.limits.near') : ''
})
</script>

<style scoped>
.mlc { display: grid; gap: 6px; justify-items: start; min-width: 0; }
.mlc :deep(.lb) { width: 100%; }
/* 条可以让给字：英文带货币代码的金额（CN¥150.00 / CN¥800.00）比中文长得多 */
.mlc :deep(.lb-track) { flex: 0 1 96px; min-width: 36px; }
</style>
