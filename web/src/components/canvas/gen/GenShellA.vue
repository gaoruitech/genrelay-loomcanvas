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
      <button v-if="g.canCancel" v-tip="t('nodes.action.cancel')" type="button" class="gn-lk nodrag" data-testid="gen-cancel" @click.stop="g.cancel()" @mousedown.stop>{{ t('common.cancel') }}</button>
    </template>
    <template v-else-if="g.displayError">
      <span class="er">{{ g.failed ? t('nodes.status.error') : t('gen.foot.cantRun') }}</span><i>·</i>
      <span v-tip="{ text: g.displayError, clipped: true }" class="gn-foot-t">{{ g.displayError }}</span>
    </template>
    <template v-else>
      <!-- 这一行谁先让位：模型名最后才收缩。先走的是「成本未知」（它什么也没说），再是参数；算得出的成本一直留着。
           参数和「成本未知」放在一个只露一行的换行容器里：放不下的那一块整块换到第二行，看不见（样式见 .gn-foot-rest），
           不会剩下半个词或一个孤零零的「·」。被收掉 / 截断时悬停这一段看得到完整的。
           英文界面下 272px 的节点上以前是模型名被截成「Nano Banana ...」，后面却完整地写着「Cost unknown」 -->
      <b v-tip="{ text: g.modelLabel || g.modelNoneText, clipped: true }">{{ g.modelLabel || g.modelNoneText }}</b>
      <span v-if="restText" v-tip="{ text: restText, clipped: true }" class="gn-foot-rest" data-testid="gen-foot-rest">
        <span v-if="g.paramsSummary" class="gn-foot-p"><i>·</i><span>{{ g.paramsSummary }}</span></span>
        <span v-if="g.costText && g.costUnknown" class="gn-foot-c"><i>·</i><GenCost /></span>
      </span>
      <template v-if="g.costText && !g.costUnknown"><i>·</i><GenCost /></template>
    </template>
  </div>

  <!-- 分享页的快照：没有输入条，把当时用的提示词写在节点底下（编辑器里的只读不走这里：选中节点照样出输入条，只是不能改） -->
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
/** 页脚里放不下时会让位的那一段：参数，加上「成本未知」（算得出的成本不在里面，它不让位） */
const restText = computed(() => [g.paramsSummary, g.costUnknown ? g.costText : ''].filter(Boolean).join(' · '))
</script>
