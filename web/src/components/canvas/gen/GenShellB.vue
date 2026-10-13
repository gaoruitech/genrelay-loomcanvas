<template>
  <GenHead mode="dot" line />

  <div class="gn-stage">
    <GenMedia layout="b" :selected="selected" @detail="emit('detail')" @expand="emit('expand')" />
    <GenHandle v-for="(p, i) in inputs" :key="p.id" :port="p" label="pill" :style="{ top: `calc(50% + ${offset(i, inputs.length)}px)` }" />
    <GenHandle v-if="output" :port="output" />
  </div>

  <!-- 一行摘要 + 一颗小运行钮；运行中 / 失败在节点上看得见，完整设置在右侧的属性面板里 -->
  <div class="gn-foot">
    <span v-if="g.isRunning" v-tip="{ text: `${g.runningLabel} · ${g.modelLabel}`, clipped: true }" class="gn-sum rn">{{ g.runningLabel }} · {{ g.modelLabel }}</span>
    <span v-else-if="g.displayError" v-tip="{ text: g.displayError, clipped: true }" class="gn-sum er" data-testid="gen-error-line">{{ g.failed ? t('nodes.status.error') : t('gen.foot.cantRun') }} · {{ g.displayError }}</span>
    <span v-else v-tip="{ text: summary, clipped: true }" class="gn-sum">{{ summary }}</span>
    <!-- 只读时这颗钮自己不出现（GenRunButton 里看 g.viewOnly） -->
    <GenRunButton v-if="!g.readonly" variant="icon" />
    <!-- 只读的人没有属性面板可开：文本类节点（大语言模型 / 视频分析）的结果在这么小的节点里只露出几行，
         给一颗「放大查看」，和布局 a / c 结果框右上角那颗是同一个动作、同一个名字。它占的正是运行钮空出来的位置 -->
    <button
      v-if="canExpandText" type="button" class="gf-ib-plain nodrag"
      v-tip="t('nodeui.ro.expand')" :aria-label="t('nodeui.ro.expand')" data-testid="gen-text-expand"
      @click.stop="emit('expand')" @mousedown.stop
    ><GenIconExpand /></button>
  </div>
</template>

<script setup lang="ts">
/**
 * 布局 b · 紧凑节点：表头、缩略图、一行摘要、一颗小运行钮。
 * 选中一个节点时，它的全部设置出现在画布右缘的属性面板里（GenInspector，整张画布只有一个）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'
import GenHead from './GenHead.vue'
import GenMedia from './GenMedia.vue'
import GenHandle from './GenHandle.vue'
import GenRunButton from './GenRunButton.vue'
import GenIconExpand from './GenIconExpand.vue'

defineProps<{ selected?: boolean }>()
const emit = defineEmits<{ (e: 'detail'): void; (e: 'expand'): void }>()
const { t } = useI18n()
const g = useGenNodeState()

const inputs = computed(() => g.ports.filter(p => p.type === 'target'))
const output = computed(() => g.ports.find(p => p.type === 'source'))
const offset = (i: number, n: number) => Math.round((i - (n - 1) / 2) * 28)
const summary = computed(() => [g.modelLabel || g.modelNoneText, g.paramsSummary].filter(Boolean).join(' · '))
/** 编辑器里的只读（不是分享页的快照：那边没有放大查看的弹窗，见 GenNode） */
const canExpandText = computed(() => g.isText && g.viewOnly && !g.readonly)
</script>
