<template>
  <Teleport :to="$lcPortal">
    <div class="lc-mask lc-sheet" @click.self="emit('close')">
      <form v-dialog="{ onEscape: () => emit('close'), busy }" class="lc-dialog cn" role="dialog" aria-modal="true" :aria-label="title" @submit.prevent="submit">
        <div class="lc-dialog-head">
          <span>{{ title }}</span>
          <button class="lc-x" type="button" :aria-label="t('common.close')" @click="emit('close')">×</button>
        </div>
        <div class="lc-dialog-body">
          <slot />
          <div class="lc-field cn-last">
            <label :for="uid">{{ t('spaces.confirmName.label', { name }) }}</label>
            <input :id="uid" ref="inputEl" v-model="typed" class="lc-input" autocomplete="off" spellcheck="false" :placeholder="name" />
          </div>
          <p v-if="error" class="lc-error-text" role="alert">{{ error }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button class="lc-btn" :class="danger ? 'danger' : 'primary'" type="submit" :disabled="busy || !matches || disabled">{{ busy ? busyText || okText : okText }}</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 危险操作的确认：要把名字（团队名称）一字不差地敲一遍才能点确认。
 * 解散团队、转让团长、超级管理员永久删除团队都用它；弹窗里要说的话放在默认插槽里。
 * 点确认后发出 confirm（带着敲的那个名字，后端会再核对一遍）；请求由调用方发，busy / error 由调用方给。
 */
import { vDialog } from '@/directives/dialog'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(defineProps<{
  title: string
  /** 要敲的那个名字 */
  name: string
  okText: string
  busyText?: string
  danger?: boolean
  busy?: boolean
  /** 弹窗里别的东西还没填好（比如还没选接任的人） */
  disabled?: boolean
  error?: string
}>(), { busyText: '', danger: true, busy: false, disabled: false, error: '' })
const emit = defineEmits<{ (e: 'close'): void; (e: 'confirm', typed: string): void }>()

const { t } = useI18n()
const uid = `cn-${Math.random().toString(36).slice(2, 8)}`
const typed = ref('')
const inputEl = ref<HTMLInputElement | null>(null)
const matches = computed(() => typed.value.trim() === props.name.trim() && !!props.name.trim())

onMounted(async () => { await nextTick(); inputEl.value?.focus() })

function submit() {
  if (!matches.value || props.busy || props.disabled) return
  emit('confirm', typed.value.trim())
}
</script>

<style scoped>
.cn { width: 480px; }
.cn-last { margin: 16px 0 0; }
.lc-error-text { margin: 12px 0 0; }
</style>
