<template>
  <div class="lc-mask" @click.self="close">
    <form class="lc-dialog" @submit.prevent="submit">
      <div class="lc-dialog-head">
        <span>{{ existing ? t('settings.models.editCustom') : t('settings.models.addCustom') }}</span>
        <button type="button" class="lc-x" :aria-label="t('common.close')" @click="close">×</button>
      </div>

      <div class="lc-dialog-body">
        <p class="hint">
          <span class="hint-provider">{{ providerTitle }}</span>
          {{ t('settings.models.customHint') }}
        </p>

        <div class="lc-field">
          <label :for="uid + '-model'">{{ t('settings.models.customName') }}<span v-if="!existing" class="lc-required">*</span></label>
          <input
            :id="uid + '-model'"
            v-model.trim="model"
            class="lc-input mono"
            maxlength="120"
            autocomplete="off"
            spellcheck="false"
            :disabled="saving || !!existing"
          />
          <span class="lc-help">{{ existing ? t('settings.models.customNameFixed') : t('settings.models.customNameHelp') }}</span>
        </div>

        <div class="lc-field">
          <label :for="uid + '-kind'">{{ t('settings.models.customKind') }}<span class="lc-required">*</span></label>
          <LcSelect
            :id="uid + '-kind'"
            v-model="kind"
            :options="kindOptions"
            :placeholder="t('settings.models.customKindPlaceholder')"
            :disabled="saving"
          />
          <span v-if="missingKinds" class="lc-help">{{ t('settings.models.customNoKind', { kinds: missingKinds }) }}</span>
        </div>

        <div v-if="caps.length" class="caps">
          <div class="caps-title">{{ t('settings.models.customCaps') }}</div>
          <ul>
            <li v-for="c in caps" :key="c">{{ c }}</li>
          </ul>
        </div>

        <div class="lc-field">
          <label :for="uid + '-label'">{{ t('settings.models.customLabel') }}</label>
          <input
            :id="uid + '-label'"
            v-model.trim="label"
            class="lc-input"
            maxlength="80"
            :placeholder="t('settings.models.customLabelPlaceholder')"
            :disabled="saving"
          />
        </div>

        <p v-if="error" class="lc-error-text">{{ error }}</p>
      </div>

      <div class="lc-dialog-foot">
        <button type="button" class="lc-btn" :disabled="saving" @click="close">{{ t('common.cancel') }}</button>
        <button type="submit" class="lc-btn primary" :disabled="saving">{{ saving ? t('common.saving') : t('common.save') }}</button>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
/**
 * 添加 / 编辑一个自定义模型：模型名、类型、显示名称。
 *
 * 类型没有默认值，必须由人选 —— 这是整个功能的前提：模型是什么类型，只听用户说的，
 * 不从名字里猜。服务商的官方接口做不了的类型不在选项里，并在下面说明。
 */
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { capsSummary } from '@/utils/modelCaps'
import { vendorLabel, isVendorDefaultName } from '@/utils/providerMeta'
import LcSelect from '@/components/LcSelect.vue'
import type { CustomModel, ModelKind, ProviderInstance, Vendor } from '@/types'

const props = defineProps<{
  provider: ProviderInstance
  vendor: Vendor
  /** 编辑时传入；模型名不可改 */
  existing?: CustomModel | null
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', provider: ProviderInstance): void
}>()

const { t } = useI18n()
const uid = useId()

const ALL_KINDS: ModelKind[] = ['image', 'video', 'chat']
const model = ref(props.existing?.model || '')
const kind = ref<ModelKind | undefined>(props.existing?.kind)
const label = ref(props.existing?.label || '')
const saving = ref(false)
const error = ref('')

const kindOptions = computed(() => props.vendor.customKinds.map(k => ({ value: k, label: t('settings.models.kinds.' + k) })))
const missingKinds = computed(() => ALL_KINDS
  .filter(k => !props.vendor.customKinds.includes(k))
  .map(k => t('settings.models.kinds.' + k))
  .join(' / '))
const caps = computed(() => {
  const d = kind.value && props.vendor.customDefaults[kind.value]
  return d ? capsSummary(d) : []
})

// 服务商名；实例名是用户自己起的（比如同一家加了两个）才带上实例名
const providerTitle = computed(() => {
  const v = vendorLabel(props.vendor)
  return isVendorDefaultName(props.vendor, props.provider.name) ? v : `${v} · ${props.provider.name}`
})

// 改了任何一项，上一次的报错就不再成立
watch([model, kind, label], () => { error.value = '' })

function close() {
  if (!saving.value) emit('close')
}

async function submit() {
  if (!model.value) { error.value = t('settings.models.customNameRequired'); return }
  if (!kind.value) { error.value = t('settings.models.customKindRequired'); return }
  saving.value = true
  error.value = ''
  try {
    const saved = props.existing
      ? unwrap(await adminApi.updateCustomModel(props.provider.id, props.existing.model, { kind: kind.value, label: label.value }))
      : unwrap(await adminApi.addCustomModel(props.provider.id, { model: model.value, kind: kind.value, label: label.value }))
    emit('saved', saved)
  } catch (err) {
    error.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.hint { font-size: 12.5px; color: var(--t-dim); line-height: 1.6; margin-bottom: 16px; }
.hint-provider { display: block; font-size: 13px; font-weight: 600; color: var(--t-strong); margin-bottom: 2px; }
.mono { font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
.caps {
  margin: -4px 0 16px; padding: 10px 12px; border-radius: 8px;
  background: var(--n-1); border: 1px solid var(--line-1); font-size: 12px; color: var(--t-body); line-height: 1.6;
}
.caps-title { color: var(--t-dim); margin-bottom: 2px; }
.caps ul { margin: 0; padding-left: 18px; }
</style>
