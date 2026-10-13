<template>
  <div ref="root" class="vp" role="radiogroup" :aria-label="t('modelsPage.provider.pickVendor')" @keydown="onKey">
    <button
      v-for="v in vendors"
      :key="v.type"
      type="button"
      class="vp-card"
      :class="{ active: modelValue === v.type }"
      role="radio"
      :aria-checked="modelValue === v.type"
      :tabindex="v.type === tabStop ? 0 : -1"
      :disabled="disabled"
      :data-vendor="v.type"
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
/**
 * 选服务商的卡片组：后端给的顺序就是显示顺序（内置的高瑞排第一并带「推荐」）。「模型管理」页与引导页共用。
 * 是一组单选：Tab 只停在选中的那一张上，方向键换一张（选中跟着走），Home / End 到头尾。
 */
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { vendorDesc, vendorLabel } from '@/utils/providerMeta'
import type { Vendor } from '@/types'

const props = defineProps<{
  vendors: Vendor[]
  modelValue: string
  disabled?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const { t } = useI18n()
const root = ref<HTMLElement | null>(null)
/** Tab 停在哪一张上：选中的那张；还没选（或选中的不在清单里）就是第一张 */
const tabStop = computed(() => (props.vendors.some(v => v.type === props.modelValue) ? props.modelValue : props.vendors[0]?.type))

function onKey(e: KeyboardEvent) {
  if (props.disabled || e.altKey || e.ctrlKey || e.metaKey) return
  const n = props.vendors.length
  if (!n) return
  const at = Math.max(0, props.vendors.findIndex(v => v.type === tabStop.value))
  const to = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % n
    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at - 1 + n) % n
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
  if (to < 0) return
  e.preventDefault()
  const type = props.vendors[to].type
  emit('update:modelValue', type)
  void nextTick(() => root.value?.querySelector<HTMLElement>(`[data-vendor="${CSS.escape(type)}"]`)?.focus())
}
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
.vp-card.active { border-color: var(--cyan); background: rgb(var(--c-cyan) / .08); }
.vp-card:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.vp-card:disabled { cursor: not-allowed; opacity: .6; }
.vp-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; }
.vp-name { font: 600 14px/1.4 var(--f-disp); color: var(--text); }
.vp-desc { font-size: 12px; color: var(--text-3); line-height: 1.55; }
</style>
