<template>
  <label class="lc-inp li" :class="{ 'is-err': invalid, 'is-disabled': disabled }">
    <span v-if="kind === 'amount'" class="li-u" aria-hidden="true">{{ symbol }}</span>
    <input
      ref="el"
      :value="modelValue"
      type="text"
      :inputmode="kind === 'runs' ? 'numeric' : 'decimal'"
      autocomplete="off"
      :disabled="disabled"
      :placeholder="placeholder || t('spaces.limits.unlimited')"
      :aria-label="label"
      :aria-invalid="invalid || undefined"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <span class="li-u" aria-hidden="true">{{ kind === 'runs' ? t('team.limitInput.runsUnit') : t('team.limitInput.amountUnit') }}</span>
  </label>
</template>

<script setup lang="ts">
/** 一个上限的输入框：次数（整数）或预估金额。留空就是「不限」（或由调用方另作解释）；值的对错由调用方用 parseLimitText 判。 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { currencySymbol } from './context'

const props = withDefaults(defineProps<{
  modelValue: string
  kind: 'runs' | 'amount'
  currency?: string
  label: string
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
}>(), { currency: 'CNY', placeholder: '', invalid: false, disabled: false })
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const { t, locale } = useI18n()
const el = ref<HTMLInputElement | null>(null)
const symbol = computed(() => currencySymbol(props.currency, locale.value))
defineExpose({ focus: () => el.value?.focus() })
</script>

<style scoped>
.li { width: 132px; flex: none; }
.li input { font-family: var(--f-mono); font-variant-numeric: tabular-nums; }
.li input::placeholder { font-family: var(--f-body); }
.li-u { flex: none; color: var(--text-3); font-size: 13px; white-space: nowrap; }
</style>
