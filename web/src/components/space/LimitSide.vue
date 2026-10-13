<template>
  <div class="ls" :class="{ dense, split }" :data-state="side.effective.state" data-testid="limit-side">
    <div class="ls-rows">
      <div v-for="u in UNITS" :key="u" class="ls-row" :data-unit="u">
        <span class="ls-l">{{ t(u === 'runs' ? 'spaces.limits.runsLabel' : 'spaces.limits.amountLabel') }}</span>
        <LimitBar :meter="side.effective[u]" :unit="u" :currency="currency" :label="t(u === 'runs' ? 'spaces.limits.runsLabel' : 'spaces.limits.amountLabel')" />
        <span v-if="side.effective[u].limit != null" class="ls-left" :class="side.effective[u].state">
          <template v-if="side.effective[u].state === 'reached'">{{ t('spaces.limits.reached') }}</template>
          <template v-else>{{ remainingText(side.effective[u], u, currency) }}<template v-if="side.effective[u].state === 'near'"> · {{ t('spaces.limits.near') }}</template></template>
        </span>
      </div>
    </div>

    <ul class="ls-notes">
      <!-- 自己的上限还有余量，但团队的用完了：照样跑不了，要说 -->
      <li v-if="teamBlocks" class="err" data-note="team-block"><LcIcon name="warn" size="s" />{{ t('spaces.limits.teamBlocks.' + side.effective.blockedBy) }}</li>
      <li data-note="counted"><LcIcon name="check" size="s" />{{ countedText(side.breakdown) }}</li>
      <li v-if="notCounted" class="mute" data-note="not-counted"><LcIcon name="x" size="s" />{{ notCounted }}</li>
      <li v-if="held" class="mute" data-note="held"><LcIcon name="queue" size="s" />{{ held }}</li>
      <li v-if="unknown" class="warn" data-note="unknown"><LcIcon name="warn" size="s" />{{ unknown }}</li>
      <li v-if="reset" class="mute" data-note="reset"><LcIcon name="refresh" size="s" />{{ t('spaces.limits.resetsAt', { when: reset }) }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * 每月上限的一侧（团队的，或者一名成员的），画全：两根条、还剩多少，以及「已用」是怎么来的。
 *
 * 全站凡是要把上限的数字讲清楚的地方（团队首页、团队 → 用量、成员的上限对话框）都用这一块，
 * 所以数字的口径只会有一种说法：已用 = 已成功 + 进行中；失败、取消的另列一行并写明不计入；
 * 金额算不出来的运行单独点出来；什么时候重新计数按团队的时区写。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import LimitBar from './LimitBar.vue'
import { countedText, heldText, notCountedText, remainingText, resetText, unknownText } from '@/utils/budget'
import type { LimitSide } from '@/types'
import { useEmbed } from '@/embed/context'

const props = withDefaults(defineProps<{
  side: LimitSide
  currency?: string
  /** 重新计数的那一刻和团队时区；不给就不写那一行 */
  resetsAt?: string
  timezone?: string
  /** 这一侧是不是某个成员的（团队的上限也会拦住他） */
  member?: boolean
  dense?: boolean
  /** 地方宽的时候条在左、说明在右 */
  split?: boolean
}>(), { currency: 'CNY', resetsAt: '', timezone: '', member: false, dense: false, split: false })

const { t, locale } = useI18n()
/** 集成方关了成本显示（features.cost）：只有次数那一根条，金额那一根和跟金额有关的两行说明都不出 */
const costOn = useEmbed().features.cost
const UNITS = (costOn ? ['runs', 'amount'] : ['runs']) as readonly ('runs' | 'amount')[]

// 文案里的数字写法跟着界面语言走：语言一换整块重算
const notCounted = computed(() => (void locale.value, notCountedText(props.side.breakdown)))
const held = computed(() => (void locale.value, costOn ? heldText(props.side.breakdown, props.currency) : ''))
const unknown = computed(() => (void locale.value, costOn ? unknownText(props.side.breakdown.unknownCost) : ''))
const reset = computed(() => (void locale.value, resetText(props.resetsAt, props.timezone)))
const teamBlocks = computed(() => props.member && /^team_/.test(props.side.effective.blockedBy || ''))
</script>

<style scoped>
.ls { display: grid; gap: 14px; min-width: 0; }
/* 两行共用一套列：标签那一列按最长的那个字（英文的 Estimated amount 比中文长得多）定宽，两根条才对得齐 */
.ls-rows { display: grid; grid-template-columns: max-content minmax(0, 1fr) auto; align-items: center; gap: 10px 14px; min-width: 0; }
.ls-row { display: contents; }
/* 没设上限的那一行没有「还剩多少」：每样东西钉在自己的列上，行才不会串 */
.ls-l { grid-column: 1; }
.ls-row :deep(.lb) { grid-column: 2; }
.ls-left { grid-column: 3; }
.ls-l { color: var(--text-2); font-size: 13px; white-space: nowrap; }
.ls-left { font-size: 12px; color: var(--text-3); white-space: nowrap; text-align: right; }
.ls-left.near { color: var(--warn); }
.ls-left.reached { color: var(--err-soft); font-weight: 500; }
.ls-notes { list-style: none; margin: 0; padding: 12px 0 0; display: grid; gap: 6px; border-top: 1px solid var(--line); }
.ls-notes li { display: flex; align-items: flex-start; gap: 8px; color: var(--text-2); font-size: 12px; line-height: 1.6; min-width: 0; overflow-wrap: anywhere; }
.ls-notes li :deep(svg) { flex: none; margin-top: 3px; color: var(--text-3); }
.ls-notes li.mute { color: var(--text-3); }
.ls-notes li.warn { color: var(--warn); }
.ls-notes li.warn :deep(svg) { color: var(--warn); }
.ls-notes li.err { color: var(--err-soft); }
.ls-notes li.err :deep(svg) { color: var(--err); }
.ls.dense { gap: 12px; }
.ls.dense .ls-rows { row-gap: 8px; }
.ls.dense .ls-notes { padding-top: 10px; gap: 4px; }
@media (min-width: 901px) {
  .ls.split { grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 28px; align-items: start; }
  .ls.split .ls-notes { border-top: 0; border-left: 1px solid var(--line); padding: 0 0 0 28px; }
}
@media (max-width: 600px) {
  /* 手机上一项占两行：上面是名字和「还剩多少」，下面是通栏的条 */
  .ls-rows { grid-template-columns: minmax(0, 1fr) auto; gap: 6px 12px; }
  .ls-row { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; gap: 6px 12px; }
  .ls-row + .ls-row { margin-top: 8px; }
  .ls-l { grid-column: 1; grid-row: 1; }
  .ls-left { grid-column: 2; grid-row: 1; }
  .ls-row :deep(.lb) { grid-column: 1 / -1; grid-row: 2; }
}
</style>
