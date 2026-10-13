<template>
  <!-- 只读：一段字，不是下拉（不摆一颗点不开的 chip） -->
  <span v-if="g.viewOnly" v-tip="{ text: g.modelLabel || g.modelNoneText, clipped: true }" class="gf-ro m" :class="variant" data-testid="gen-model">
    <span v-if="variant === 'field' && g.modelLabel" class="lc-bd" :class="g.badgeKind">{{ g.badge }}</span><b>{{ g.modelLabel || g.modelNoneText }}</b>
  </span>
  <div v-else-if="g.modelOpts.length" class="gf-model nodrag" :class="variant" data-testid="gen-model" @click.stop @mousedown.stop>
    <ChipSelect
      v-if="variant === 'field'"
      field
      :badge="g.badge"
      :badge-kind="g.badgeKind"
      v-model="g.modelValue"
      :options="g.modelOpts"
      :display-value="g.modelLabel"
    />
    <ChipSelect v-else v-model="g.modelValue" :options="g.modelOpts" :display-value="g.modelLabel" :title="t('nodes.field.model')" />
  </div>
  <span v-else class="gf-hint">{{ g.modelNoneText }}</span>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useGenNodeState } from '@/composables/useGenNode'
import ChipSelect from '../ChipSelect.vue'

/** 模型选择。chip：工具条里的一颗；field：属性面板里通栏的一行（前面带类型徽标） */
defineProps<{ variant: 'chip' | 'chip-sm' | 'field' }>()
const { t } = useI18n()
const g = useGenNodeState()
</script>
