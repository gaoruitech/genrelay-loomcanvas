<template>
  <div v-if="modelValue" class="lc-mask" @click.self="close">
    <div class="lc-dialog cnd" role="dialog" aria-modal="true" :aria-label="title">
      <div class="lc-dialog-head">
        <span>{{ title }}</span>
        <button class="lc-x" :title="t('common.close')" :aria-label="t('common.close')" @click="close">
          <LcIcon name="x" size="s" />
        </button>
      </div>
      <div class="lc-dialog-body">
        <div class="lc-field cnd-field">
          <label for="cnd-name">{{ t('views.list.nameLabel') }}</label>
          <input
            id="cnd-name"
            ref="inputRef"
            v-model="draft"
            class="lc-input"
            :placeholder="t('views.list.namePlaceholder')"
            maxlength="80"
            autocomplete="off"
            @keydown.enter="submit"
            @keydown.escape="close"
          />
        </div>
      </div>
      <div class="lc-dialog-foot">
        <button class="lc-btn" :disabled="busy" @click="close">{{ t('common.cancel') }}</button>
        <button class="lc-btn primary quiet" :disabled="busy" @click="submit">{{ busy ? busyText : okText }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 给画布起名的小弹窗：新建和重命名共用。名字为空时自己提示，不往外抛 */
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import LcIcon from '@/components/LcIcon.vue'

const props = defineProps<{
  modelValue: boolean
  title: string
  /** 打开时填进输入框的名字（重命名时是原名） */
  initial?: string
  okText: string
  busyText: string
  busy?: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'submit', name: string): void
}>()

const { t } = useI18n()
const draft = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

watch(() => props.modelValue, (open) => {
  if (!open) return
  draft.value = props.initial || ''
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
})

function close() {
  if (props.busy) return
  emit('update:modelValue', false)
}

function submit() {
  if (props.busy) return
  const name = draft.value.trim()
  if (!name) {
    MessagePlugin.warning(t('views.list.nameRequired'))
    return
  }
  emit('submit', name)
}
</script>

<style scoped>
.cnd { width: 440px; }
.cnd-field { margin-bottom: 0; }
</style>
