<template>
  <div v-if="show" class="gf-notes" :class="{ tight }" @mousedown.stop @click.stop>
    <!-- 被团队的每月上限拦下（没有发出去）：是哪一项上限、数字、什么时候重新计数、该找谁 -->
    <BudgetNotice
      v-if="g.refusal" class="nodrag nowheel" :refusal="g.refusal" :tight="tight" data-testid="gen-error"
      :can-set-limits="g.budget?.canSetLimits" :can-set-prices="g.budget?.canSetPrices"
      :limits-to="g.budget?.limitsTo" :prices-to="g.budget?.pricesTo"
      @wheel.stop
    >
      <button v-if="!g.viewOnly" type="button" class="gf-err-retry" data-act="budget-retry" @click.stop="g.run()">{{ t('common.retry') }}</button>
    </BudgetNotice>
    <!-- 校验没过 / 运行失败：原因原样写出来 -->
    <div v-else-if="g.displayError" class="gf-err nodrag" data-testid="gen-error">
      <div class="gf-err-msg nowheel" @wheel.stop>{{ g.displayError }}</div>
      <button v-if="g.failed && !g.viewOnly" type="button" class="gf-err-retry" @click.stop="g.run()">{{ t('common.retry') }}</button>
    </div>

    <!-- 还没点运行就知道跑不了：上限已经用完，或者选的模型没有价格。同一块说明，提醒色 -->
    <BudgetNotice
      v-if="g.preflightRefusal && !g.displayError" class="nodrag nowheel" tone="warn" :refusal="g.preflightRefusal" :tight="tight" data-testid="gen-preflight"
      :can-set-limits="g.budget?.canSetLimits" :can-set-prices="g.budget?.canSetPrices"
      :limits-to="g.budget?.limitsTo" :prices-to="g.budget?.pricesTo"
      @wheel.stop
    />

    <!-- 运行前就要说的话：参考图只能给公网地址、纯文本模型不读图…… -->
    <div v-for="(n, i) in g.notices" :key="i" class="gf-notice" :class="{ clamp: tight }" data-testid="gen-notice"><span v-tip="{ text: n, clipped: true }">{{ n }}</span><NoticeGo v-if="g.noticeGo?.[i]" :go="g.noticeGo[i]!" /></div>

    <!-- 多条文本输入的拼接顺序 -->
    <div v-if="g.textInputs.length > 1" class="gf-order nodrag">
      <div class="gf-hint">{{ t('nodeui.llm.textOrder') }}</div>
      <div v-for="(it, i) in g.textInputs" :key="it.sourceId" class="gf-order-item">
        <span class="gf-order-idx">{{ i + 1 }}</span>
        <span class="gf-order-snip">{{ it.snippet || t('nodeui.llm.emptyText') }}</span>
        <!-- 只读：顺序照样看得到，调序的两颗不出现 -->
        <span v-if="!g.viewOnly" class="gf-order-btns">
          <button type="button" :disabled="i === 0" v-tip="t('nodeui.llm.moveUp')" :aria-label="t('nodeui.llm.moveUp')" @click.stop="g.moveText(i, -1)">↑</button>
          <button type="button" :disabled="i === g.textInputs.length - 1" v-tip="t('nodeui.llm.moveDown')" :aria-label="t('nodeui.llm.moveDown')" @click.stop="g.moveText(i, 1)">↓</button>
        </span>
      </div>
    </div>

    <!-- 这次运行套用哪个品牌包、会加什么、这个节点要不要例外（文本类节点不套品牌包） -->
    <NodeBrandKit v-if="kit && !g.isText" :read-only="g.viewOnly" :node-id="g.id" :data="g.data" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'
import { CANVAS_BRAND_KIT_KEY } from '@/composables/canvasBrandKitKey'
import NodeBrandKit from '../NodeBrandKit.vue'
import NoticeGo from '../NoticeGo.vue'
import BudgetNotice from '@/components/space/BudgetNotice.vue'

/**
 * 提示词和工具条之间的那几行说明：报错、运行前提示、文本拼接顺序、品牌包。
 * 三种布局都把它放在「改设置的地方」—— a 的输入条、b 的属性面板、c 的节点里。
 */
const props = defineProps<{
  /** 带不带品牌包那一行 */
  kit?: boolean
  /** 节点里地方小：长说明收成三行 */
  tight?: boolean
}>()
const { t } = useI18n()
const g = useGenNodeState()
const kits = inject(CANVAS_BRAND_KIT_KEY, undefined)

// 品牌包那一行自己会在「一个品牌包都没有、节点也没有例外」时不出现，这里按同一个条件决定整块要不要占位
const kitLine = computed(() => {
  if (!props.kit || g.isText || !kits) return false
  return kits.list.value.length > 0 || !!kits.resolve(g.data).own
})
const show = computed(() => !!g.displayError || !!g.preflightRefusal || g.notices.length > 0 || g.textInputs.length > 1 || kitLine.value)
</script>
