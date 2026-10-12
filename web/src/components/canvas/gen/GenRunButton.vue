<template>
  <!-- 运行中：进度 + 取消 -->
  <template v-if="g.isRunning">
    <button
      v-if="variant === 'icon'"
      type="button" class="gf-ib nodrag" :disabled="!g.canCancel"
      :title="t('nodes.action.cancel')" :aria-label="t('nodes.action.cancel')"
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
  <button
    v-else
    type="button" class="gf-run nodrag" :class="variant"
    :title="variant === 'icon' || variant === 'md' ? g.runLabel : undefined" :aria-label="variant === 'icon' ? g.runLabel : undefined"
    data-testid="gen-run" @click.stop="g.run()" @mousedown.stop
  >
    <LcIcon name="play" size="s" /><span v-if="variant !== 'icon'">{{ variant === 'md' ? g.runShort : g.runLabel }}</span>
  </button>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'
import LcIcon from '@/components/LcIcon.vue'

/**
 * 运行 / 重新运行；运行中换成进度和取消。
 * lg：输入条、属性面板；md：节点里的一行（地方窄，只写「运行」，悬停提示里是完整的「重新运行」）；
 * bar：节点里通栏的进度条（运行中才有区别）；
 * icon：紧凑节点上的小方钮；chip：压在画面上的小胶囊（运行中不出现，画面上另有进度环）。
 */
defineProps<{ variant: 'lg' | 'md' | 'bar' | 'icon' | 'chip' }>()
const { t } = useI18n()
const g = useGenNodeState()
</script>
