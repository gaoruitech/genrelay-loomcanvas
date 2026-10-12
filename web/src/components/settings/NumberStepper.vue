<template>
  <div class="stp" :class="{ 'is-err': invalid, 'is-disabled': disabled }">
    <button type="button" class="stp-b" :disabled="disabled || !canDec" :aria-label="decLabel" tabindex="-1" @click="step(-1)">
      <LcIcon name="minus" size="s" />
    </button>
    <input
      :id="id"
      class="stp-i"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      role="spinbutton"
      :aria-valuemin="min"
      :aria-valuemax="max"
      :aria-valuenow="isInt ? Number(modelValue) : undefined"
      :aria-invalid="invalid || undefined"
      :value="text"
      :disabled="disabled"
      @input="onInput"
      @keydown.up.prevent="step(1)"
      @keydown.down.prevent="step(-1)"
    />
    <button type="button" class="stp-b" :disabled="disabled || !canInc" :aria-label="incLabel" tabindex="-1" @click="step(1)">
      <LcIcon name="plus" size="s" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 整数步进器：− 数字 +。不用 type=number（各浏览器自带的上下箭头样式压不干净）。
 * 填了不是整数的东西时把 NaN 交出去，由表单自己的校验报错，这里不替用户改值。
 */
import { computed, ref, watch } from 'vue'
import LcIcon from '@/components/LcIcon.vue'

const props = defineProps<{
  modelValue: number
  min: number
  max: number
  id?: string
  disabled?: boolean
  decLabel?: string
  incLabel?: string
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>()

const text = ref(Number.isFinite(props.modelValue) ? String(props.modelValue) : '')
watch(() => props.modelValue, (v) => {
  // 外面换了值（加载完成、点了加减）才回写；用户正在输入的半成品不动
  if (Number.isFinite(v) && Number(text.value) !== v) text.value = String(v)
})

const isInt = computed(() => Number.isInteger(props.modelValue))
const invalid = computed(() => !isInt.value || props.modelValue < props.min || props.modelValue > props.max)
const canDec = computed(() => !isInt.value || props.modelValue > props.min)
const canInc = computed(() => !isInt.value || props.modelValue < props.max)

function onInput(e: Event) {
  text.value = (e.target as HTMLInputElement).value
  const s = text.value.trim()
  emit('update:modelValue', /^\d+$/.test(s) ? Number(s) : NaN)
}

function step(d: number) {
  if (props.disabled) return
  const base = isInt.value ? props.modelValue + d : props.min
  const next = Math.min(props.max, Math.max(props.min, base))
  text.value = String(next)
  emit('update:modelValue', next)
}
</script>

<style scoped>
.stp {
  display: inline-flex; align-items: center; width: 128px; height: 40px; flex: none;
  border-radius: var(--r-sm); border: 1px solid var(--line-2); background: var(--well);
  transition: border-color .15s, box-shadow .15s;
}
.stp:hover { border-color: var(--line-3); }
.stp:focus-within { border-color: var(--cyan); box-shadow: var(--ring); }
.stp.is-err { border-color: var(--err); box-shadow: var(--ring-err); }
.stp.is-disabled { opacity: .5; }
.stp-b {
  width: 36px; height: 100%; flex: none; border: 0; background: none; color: var(--text-3);
  display: grid; place-items: center; border-radius: var(--r-sm);
}
.stp-b:hover:not(:disabled) { color: var(--text); background: rgb(var(--c-film) / .1); }
.stp-b:disabled { opacity: .4; cursor: not-allowed; }
.stp-i {
  flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; color: var(--text);
  text-align: center; font: 500 14px var(--f-mono); font-variant-numeric: tabular-nums;
}
</style>
