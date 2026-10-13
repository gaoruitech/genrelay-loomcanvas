<template>
  <!-- 运行中：进度 + 取消 -->
  <template v-if="g.isRunning">
    <!-- 只读：进度照样看得到，取消不出现（那是改画布）；紧凑节点上那颗小方钮只有「取消」一个用处，整颗不出 -->
    <template v-if="variant === 'icon' && g.viewOnly" />
    <button
      v-else-if="variant === 'icon'"
      type="button" class="gf-ib nodrag" :disabled="!g.canCancel"
      v-tip="t('nodes.action.cancel')" :aria-label="t('nodes.action.cancel')"
      data-testid="gen-cancel" @click.stop="g.cancel()" @mousedown.stop
    ><LcIcon name="stop" size="s" /></button>
    <div v-else-if="variant !== 'chip'" class="gf-prog nodrag" :class="[variant, { indet: g.status === 'running' && !g.progress }]" data-testid="gen-progress">
      <i :style="g.progress ? { width: g.progress + '%' } : undefined" />
      <span>
        <b>{{ variant === 'bar' ? `${g.runningLabel} · ${g.modelLabel}` : g.runningLabel }}</b>
        <button v-if="g.canCancel" type="button" data-testid="gen-cancel" @click.stop="g.cancel()" @mousedown.stop>{{ t('nodes.action.cancel') }}</button>
      </span>
    </div>
  </template>
  <!-- 只读：没有运行这回事，按钮不出现（不是摆一颗点不动的） -->
  <button
    v-else-if="!g.viewOnly"
    type="button" class="gf-run nodrag" :class="variant"
    v-tip="variant === 'icon' ? g.runLabel : ''" :aria-label="variant === 'icon' ? g.runLabel : undefined"
    data-testid="gen-run" @click.stop="g.run()" @mousedown.stop
  >
    <LcIcon v-if="variant !== 'md'" name="play" size="s" /><span v-if="variant !== 'icon'">{{ g.runLabel }}</span>
  </button>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'
import LcIcon from '@/components/LcIcon.vue'

/**
 * 运行 / 重新运行；运行中换成进度和取消。
 * lg：输入条、属性面板；md：节点里的一行。有结果之后三种布局都写「重新运行」—— 同一颗按钮在不同布局下
 * 叫法不一样，会让人以为它们做的不是一件事（那一行放不放得下由 GenShellC 的压缩规则负责，不靠缩短这两个字）。
 * md 只有字、不带三角：那一行的宽度留给模型、参数和成本。以前是「放得下才带三角」，同一张画布上有的节点带、
 * 有的不带，像是两种按钮；带上就得更早把参数收成「第一项 +N」，所以布局 c 里所有节点一律不带；
 * bar：节点里通栏的进度条（运行中才有区别）；
 * icon：紧凑节点上的小方钮；chip：压在画面上的小胶囊（运行中不出现，画面上另有进度环）。
 */
defineProps<{ variant: 'lg' | 'md' | 'bar' | 'icon' | 'chip' }>()
const { t } = useI18n()
const g = useGenNodeState()
</script>
