<template>
  <Teleport :to="$lcPortal">
  <div class="lc-mask lc-sheet" @mousedown="downOnMask = $event.target === $event.currentTarget" @click.self="downOnMask && close()">
    <form v-dialog="{ onEscape: close, busy: !!saving, initialFocus: () => labelEl }" class="lc-dialog me" role="dialog" aria-modal="true" :aria-labelledby="uid + '-title'" novalidate data-testid="model-edit-dialog" @submit.prevent="submit">
      <div class="lc-dialog-head">
        <span :id="uid + '-title'" class="me-title">{{ t('modelsPage.edit.title', { model: model.label || name }) }}</span>
        <button type="button" class="lc-x" :aria-label="t('common.close')" :disabled="saving" @click="close">×</button>
      </div>
      <div class="lc-dialog-body">
        <p class="me-id">{{ name }}</p>
        <div class="lc-field">
          <label :for="uid + '-label'">{{ t('modelsPage.edit.label') }}</label>
          <input :id="uid + '-label'" ref="labelEl" v-model.trim="label" class="lc-input" maxlength="80" :disabled="saving" />
          <span class="lc-help">{{ t('modelsPage.edit.labelHelp') }}</span>
        </div>
        <div class="lc-field">
          <label :for="uid + '-sort'">{{ t('modelsPage.edit.sort') }}</label>
          <input :id="uid + '-sort'" v-model="sort" class="lc-input sort" type="number" step="1" :disabled="saving" />
          <span class="lc-help">{{ t('modelsPage.edit.sortHelp') }}</span>
        </div>
        <p v-if="error" class="lc-error-text" role="alert">{{ error }}</p>
      </div>
      <div class="lc-dialog-foot">
        <button type="button" class="lc-btn" :disabled="saving" @click="close">{{ t('common.cancel') }}</button>
        <button type="submit" class="lc-btn primary quiet" :disabled="saving">{{ saving ? t('common.saving') : t('common.save') }}</button>
      </div>
    </form>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 一个模型的显示名称和排序。两者都只是覆盖项：名称是画布下拉里显示的那个，
 * 排序决定它在同一个服务商里排第几（数字小的在前）。只把改过的那几项交出去。
 */
import { onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { vDialog } from '@/directives/dialog'
import { upstreamName } from './modelMeta'
import type { AdminModel } from '@/types'

const props = defineProps<{ model: AdminModel; saving?: boolean }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', data: { label?: string; sort?: number }): void
}>()

const { t } = useI18n()
const uid = useId()
const name = upstreamName(props.model)

const label = ref(props.model.label || '')
const sort = ref<number | string>(props.model.sort ?? 0)
const error = ref('')
const labelEl = ref<HTMLInputElement | null>(null)
// 焦点由 v-dialog 放到名称框上；顺手全选，直接敲新名字就行
onMounted(() => labelEl.value?.select())
/** 按下和松开都在遮罩上才算「点外面」：在输入框里拖选文字、松手时滑到外面不算 */
const downOnMask = ref(false)

function close() {
  if (!props.saving) emit('close')
}

function submit() {
  error.value = ''
  if (!label.value) { error.value = t('modelsPage.edit.labelRequired'); return }
  const n = Number(sort.value)
  if (sort.value === '' || !Number.isFinite(n)) { error.value = t('modelsPage.edit.sortInvalid'); return }
  const data: { label?: string; sort?: number } = {}
  if (label.value !== props.model.label) data.label = label.value
  if (n !== (props.model.sort ?? 0)) data.sort = n
  if (!Object.keys(data).length) { emit('close'); return }
  emit('save', data)
}
</script>

<style scoped>
.me { width: 440px; }
.me-title { min-width: 0; overflow-wrap: anywhere; }
.me-id { font: 12px/1.5 var(--f-mono); color: var(--text-3); margin-bottom: 14px; word-break: break-all; }
.sort { width: 120px; }
</style>
