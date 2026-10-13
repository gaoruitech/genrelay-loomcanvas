<template>
  <div class="bn" :class="[tone, { tight }]" role="alert" :data-code="refusal.code" data-testid="budget-notice">
    <LcIcon :name="price ? 'key' : 'shield'" size="s" />
    <div class="bn-body">
      <b class="bn-title">{{ text.title }}</b>
      <p v-if="text.numbers" class="bn-line" data-part="numbers">{{ text.numbers }}</p>
      <p v-if="text.reset" class="bn-line" data-part="reset">{{ text.reset }}</p>
      <p class="bn-line bn-ask" data-part="ask">
        {{ text.ask }}
        <!-- 在画布里点过去会离开正在编辑的画布：开新标签页。嵌在别人页面里、地址栏不归本产品管（memory 路由）时
             新标签页打不开应用里的地址，就在原地跳（有没保存的改动时画布自己会先问） -->
        <RouterLink v-if="go" class="bn-go" :to="go.to" :target="pages.newTab ? '_blank' : undefined" :rel="pages.newTab ? 'noopener' : undefined" data-act="budget-go">{{ go.label }}</RouterLink>
      </p>
      <div v-if="$slots.default" class="bn-acts"><slot /></div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 一次运行被团队的每月上限拦下时（或者还没点就知道会被拦时）显示的那一块：
 * 是哪一项上限、数字、什么时候重新计数、该找谁。六种拒绝码都从这里出，中英文都是现写的
 * （不是把服务端当时那句话存下来），所以换语言跟着换。
 *
 * 它是一块留在原地的说明，不是一闪而过的轻提示：人得有时间把它读完。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, type RouteLocationRaw } from 'vue-router'
import LcIcon from '@/components/LcIcon.vue'
import { refusalText } from '@/utils/budget'
import { usePageOpen } from '@/embed/links'
import type { BudgetRefusal } from '@/types'

const props = withDefaults(defineProps<{
  refusal: BudgetRefusal
  /** err：刚被拒绝；warn：还没运行，先提醒 */
  tone?: 'err' | 'warn'
  /** 节点里地方小：字小一号、行距紧一点 */
  tight?: boolean
  /** 看的人自己能改：团长能改上限，团长和管理员能填价格 —— 给他去改的入口，而不是让他去找别人 */
  canSetLimits?: boolean
  canSetPrices?: boolean
  /** 去改的地方；不给就只有文字（嵌在别人页面里没有这些页面） */
  limitsTo?: RouteLocationRaw | null
  pricesTo?: RouteLocationRaw | null
}>(), { tone: 'err', tight: false, canSetLimits: false, canSetPrices: false, limitsTo: null, pricesTo: null })

const { t, locale } = useI18n()
const price = computed(() => props.refusal.code === 'budget.unpriced_model' || props.refusal.code === 'budget.currency_mismatch')
const text = computed(() => (void locale.value, refusalText(props.refusal, { canSetLimits: props.canSetLimits, canSetPrices: props.canSetPrices })))
const pages = usePageOpen()
const go = computed(() => {
  const to = price.value ? (props.canSetPrices ? props.pricesTo : null) : (props.canSetLimits ? props.limitsTo : null)
  // 那一页在这次挂载里不存在（集成方没开放模型管理 / 团队管理，或者只嵌了编辑器）：只留文字，不给一个点了没反应的链接
  if (!to || !pages.to(to)) return null
  return { to, label: t(price.value ? 'spaces.refusal.go.prices' : 'spaces.refusal.go.limits') }
})
</script>

<style scoped>
.bn {
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border-radius: 10px; min-width: 0;
  border: 1px solid rgb(var(--c-err) / .4); background: rgb(var(--c-err) / .1); color: var(--alert-err-fg);
  font-size: 12px; line-height: 1.6; text-align: left; user-select: text; cursor: auto;
}
.bn > :deep(svg) { flex: none; margin-top: 3px; color: var(--err); }
.bn.warn { border-color: rgb(var(--c-warn) / .4); background: rgb(var(--c-warn) / .1); color: var(--alert-warn-fg); }
.bn.warn > :deep(svg) { color: var(--warn); }
.bn-body { display: grid; gap: 2px; min-width: 0; flex: 1; }
.bn-title { font-weight: 600; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.bn-line { margin: 0; overflow-wrap: anywhere; opacity: .92; }
.bn-go { margin-left: 6px; color: inherit; font-weight: 600; text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; }
.bn-go:focus-visible { outline: none; box-shadow: var(--ring); border-radius: 4px; }
.bn-acts { display: flex; gap: 8px; margin-top: 6px; }
.bn.tight { padding: 8px 10px; gap: 8px; }
.bn.tight .bn-title { font-size: 12px; }
</style>
