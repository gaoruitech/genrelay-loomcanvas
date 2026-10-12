<template>
  <GenHead mode="dot" version />

  <div class="gn-stage">
    <GenMedia layout="a" :selected="selected" @detail="emit('detail')" @expand="emit('expand')" />
    <!-- 端口挂在画面两侧；名字平时不占地方，悬停或选中节点时才出现 -->
    <GenHandle v-for="(p, i) in inputs" :key="p.id" :port="p" label="pill" :style="{ top: `calc(50% + ${offset(i, inputs.length, 32)}px)` }" />
    <GenHandle v-if="output" :port="output" />
  </div>

  <!-- 一行安静的摘要：模型 · 参数 · 成本；运行中 / 失败时换成状态 -->
  <div class="gn-foot">
    <template v-if="g.isRunning">
      <span class="rn">{{ g.runningPlain }}</span><i>·</i><b>{{ g.modelLabel }}</b>
      <span class="gn-sp" />
      <button v-if="g.canCancel" type="button" class="gn-lk nodrag" :title="t('nodes.action.cancel')" data-testid="gen-cancel" @click.stop="g.cancel()" @mousedown.stop>{{ t('common.cancel') }}</button>
    </template>
    <template v-else-if="g.displayError">
      <span class="er">{{ g.failed ? t('nodes.status.error') : t('gen.foot.cantRun') }}</span><i>·</i>
      <span class="gn-foot-t" :title="g.displayError">{{ g.displayError }}</span>
    </template>
    <template v-else>
      <b>{{ g.modelLabel || g.modelNoneText }}</b>
      <template v-if="g.paramsSummary"><i>·</i><span>{{ g.paramsSummary }}</span></template>
      <template v-if="g.costText"><i>·</i><GenCost /></template>
    </template>
  </div>

  <!-- 只读画布：没有输入条，把当时用的提示词写在节点底下 -->
  <p v-if="g.readonly && roPrompt" class="gn-ro-prompt nowheel" @wheel.stop>{{ roPrompt }}</p>
</template>

<script setup lang="ts">
/**
 * 布局 a · 结果优先：节点基本就是成品本身。提示词、模型、参数、运行都在选中后节点下方的
 * 那条输入条里（GenComposer，整张画布只有一条），节点里没有提示词框。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'
import GenHead from './GenHead.vue'
import GenMedia from './GenMedia.vue'
import GenHandle from './GenHandle.vue'
import GenCost from './GenCost.vue'

defineProps<{ selected?: boolean }>()
const emit = defineEmits<{ (e: 'detail'): void; (e: 'expand'): void }>()
const { t } = useI18n()
const g = useGenNodeState()

const inputs = computed(() => g.ports.filter(p => p.type === 'target'))
const output = computed(() => g.ports.find(p => p.type === 'source'))
/** 第 i 个输入口相对画面中线的偏移：几个口上下对称排开 */
const offset = (i: number, n: number, step: number) => Math.round((i - (n - 1) / 2) * step)
const roPrompt = computed(() => (g.isText ? '' : g.prompt))
</script>
