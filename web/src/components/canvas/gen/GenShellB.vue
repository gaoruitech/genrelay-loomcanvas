<template>
  <GenHead mode="dot" line />

  <div class="gn-stage">
    <GenMedia layout="b" :selected="selected" @detail="emit('detail')" @expand="emit('expand')" />
    <GenHandle v-for="(p, i) in inputs" :key="p.id" :port="p" label="pill" :style="{ top: `calc(50% + ${offset(i, inputs.length)}px)` }" />
    <GenHandle v-if="output" :port="output" />
  </div>

  <!-- 一行摘要 + 一颗小运行钮；运行中 / 失败在节点上看得见，完整设置在右侧的属性面板里 -->
  <div class="gn-foot">
    <span v-if="g.isRunning" class="gn-sum rn" :title="`${g.runningLabel} · ${g.modelLabel}`">{{ g.runningLabel }} · {{ g.modelLabel }}</span>
    <span v-else-if="g.displayError" class="gn-sum er" :title="g.displayError" data-testid="gen-error-line">{{ g.failed ? t('nodes.status.error') : t('gen.foot.cantRun') }} · {{ g.displayError }}</span>
    <span v-else class="gn-sum" :title="summary">{{ summary }}</span>
    <GenRunButton v-if="!g.readonly" variant="icon" />
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

defineProps<{ selected?: boolean }>()
const emit = defineEmits<{ (e: 'detail'): void; (e: 'expand'): void }>()
const { t } = useI18n()
const g = useGenNodeState()

const inputs = computed(() => g.ports.filter(p => p.type === 'target'))
const output = computed(() => g.ports.find(p => p.type === 'source'))
const offset = (i: number, n: number) => Math.round((i - (n - 1) / 2) * 28)
const summary = computed(() => [g.modelLabel || g.modelNoneText, g.paramsSummary].filter(Boolean).join(' · '))
</script>
