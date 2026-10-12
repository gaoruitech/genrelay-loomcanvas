<template>
  <span v-if="g.costText" class="gf-cost" :class="{ unk: g.costUnknown }" :title="g.costIsActual ? t('cost.actual') : t('cost.estimateTip')" data-testid="gen-cost">
    <template v-if="long && !g.costUnknown">{{ g.costIsActual ? t('cost.actual') : t('cost.estimate') }} · </template><b>{{ g.costText }}</b>
  </span>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'

/**
 * 运行前一定看得到的预估成本；文本类节点跑过之后换成这一次的实际成本。
 * long：数字前面带「预估成本 ·」（「成本未知」四个字自己就说清楚了，不再加前缀）。
 */
defineProps<{ long?: boolean }>()
const { t } = useI18n()
const g = useGenNodeState()
</script>
