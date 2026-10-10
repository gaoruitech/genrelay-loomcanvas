<template>
  <div class="vp" role="radiogroup" :aria-label="t('settings.providers.pickVendor')">
    <button
      v-for="v in vendors"
      :key="v.type"
      type="button"
      class="vp-card"
      :class="{ active: modelValue === v.type }"
      role="radio"
      :aria-checked="modelValue === v.type"
      :disabled="disabled"
      @click="emit('update:modelValue', v.type)"
    >
      <span class="vp-top">
        <span class="vp-name">{{ vendorLabel(v) }}</span>
        <span v-if="v.recommended" class="lc-tag accent">{{ t('settings.providers.recommended') }}</span>
      </span>
      <span class="vp-desc">{{ vendorDesc(v) }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/** 选服务商的卡片组：后端给的顺序就是显示顺序（内置的高瑞排第一并带「推荐」）。设置页与引导页共用 */
import { useI18n } from 'vue-i18n'
import { vendorDesc, vendorLabel } from '@/utils/providerMeta'
import type { Vendor } from '@/types'

defineProps<{
  vendors: Vendor[]
  modelValue: string
  disabled?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const { t } = useI18n()
</script>

<style scoped>
.vp { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.vp-card {
  display: flex; flex-direction: column; gap: 6px; text-align: left; min-width: 0;
  padding: 13px 14px; border-radius: var(--radius-lg);
  background: var(--n-2); border: 1px solid var(--n-5); color: inherit; font: inherit;
  cursor: pointer; transition: border-color .15s ease, background .15s ease;
}
.vp-card:hover:not(:disabled) { border-color: var(--n-8); }
.vp-card.active { border-color: var(--accent-edge); background: var(--accent-ghost); }
.vp-card:disabled { cursor: not-allowed; opacity: .7; }
.vp-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.vp-name { font-size: 14.5px; font-weight: 600; color: var(--t-max); }
.vp-desc { font-size: 12px; color: var(--t-dim); line-height: 1.55; }
</style>
