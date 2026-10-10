<template>
  <div class="vp" role="radiogroup" :aria-label="t('modelsPage.provider.pickVendor')">
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
        <span v-if="v.recommended" class="lc-bd rec">{{ t('modelsPage.provider.recommended') }}</span>
      </span>
      <span class="vp-desc">{{ vendorDesc(v) }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/** 选服务商的卡片组：后端给的顺序就是显示顺序（内置的高瑞排第一并带「推荐」）。「模型管理」页与引导页共用 */
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
.vp { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
.vp-card {
  display: flex; flex-direction: column; gap: 6px; text-align: left; min-width: 0;
  padding: 13px 14px; border-radius: var(--r-md);
  background: var(--well); border: 1px solid var(--line-2); color: inherit; font: inherit;
  cursor: pointer; transition: border-color .15s ease, background .15s ease;
}
.vp-card:hover:not(:disabled) { border-color: var(--line-3); }
.vp-card.active { border-color: var(--cyan); background: rgba(63, 216, 255, .08); }
.vp-card:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.vp-card:disabled { cursor: not-allowed; opacity: .6; }
.vp-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; }
.vp-name { font: 600 14px/1.4 var(--f-disp); color: var(--text); }
.vp-desc { font-size: 12px; color: var(--text-3); line-height: 1.55; }
</style>
