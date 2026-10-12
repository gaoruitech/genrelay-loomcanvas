<template>
  <div class="lc-mask" @click.self="close" @keydown.esc="close">
    <div class="lc-dialog pd" role="dialog" aria-modal="true" :aria-labelledby="uid + '-title'">
      <div class="lc-dialog-head">
        <span :id="uid + '-title'">{{ existing ? t('modelsPage.provider.editTitle') : t('modelsPage.provider.addTitle') }}</span>
        <button class="lc-x" :aria-label="t('common.close')" @click="close">×</button>
      </div>
      <div class="lc-dialog-body">
        <!-- 第一步：选服务商。编辑时固定，不能换 -->
        <div v-if="existing && vendor" class="lc-field">
          <span class="lc-label">{{ t('modelsPage.provider.vendor') }}</span>
          <div class="vendor-fixed">
            <span class="vendor-fixed-name">{{ vendorLabel(vendor) }}</span>
            <span class="lc-help">{{ t('modelsPage.provider.vendorFixed') }}</span>
          </div>
        </div>
        <div v-else class="lc-field">
          <span class="lc-label">{{ t('modelsPage.provider.pickVendor') }}</span>
          <VendorPicker v-model="vendorId" :vendors="vendors" :disabled="saving" @update:model-value="onVendorChange" />
        </div>

        <template v-if="vendor">
          <VendorModels :key="vendor.type" :vendor="vendor" :expanded="!existing" />

          <ProviderForm
            :key="'f-' + vendor.type"
            v-model="form"
            :vendor="vendor"
            :existing="existing"
            :disabled="saving"
          />

          <div class="enable-row">
            <button
              :id="uid + '-enabled'"
              type="button"
              class="lc-switch"
              :class="{ on: form.enabled }"
              :disabled="saving"
              role="switch"
              :aria-checked="!!form.enabled"
              :aria-labelledby="uid + '-enabled-label'"
              @click="form.enabled = !form.enabled"
            />
            <label :id="uid + '-enabled-label'" :for="uid + '-enabled'">{{ t('modelsPage.provider.enabledLabel') }}</label>
          </div>

          <p class="lc-help key-note">{{ t('modelsPage.provider.keyNote') }}</p>
        </template>

        <p v-if="error" class="lc-error-text dialog-error" role="alert">{{ error }}</p>
      </div>
      <div class="lc-dialog-foot">
        <button v-if="existing" class="lc-btn danger remove" :disabled="saving" data-act="delete-provider" @click="removing = true">
          <LcIcon name="trash" size="s" />{{ t('modelsPage.provider.delete') }}
        </button>
        <button class="lc-btn" :disabled="saving" @click="close">{{ t('common.cancel') }}</button>
        <button class="lc-btn primary quiet" :disabled="saving || !vendor" data-act="save-provider" @click="save">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="removing && existing" class="lc-mask" @click.self="cancelRemove" @keydown.esc.stop="cancelRemove">
      <div class="lc-dialog confirm" role="alertdialog" aria-modal="true">
        <div class="lc-dialog-head"><span>{{ t('modelsPage.provider.deleteTitle') }}</span></div>
        <div class="lc-dialog-body">
          <p>{{ t('modelsPage.provider.deleteText', { name: existing.name }) }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="deleting" @click="cancelRemove">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" :disabled="deleting" data-act="confirm-delete" @click="confirmRemove">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 添加 / 编辑一个服务商：选服务商 → 看它支持的模型 → 填 Key（名称、地址可选）。
 * 编辑时左下角可以删除这个服务商（要再确认一次）。
 * 保存、删除都在这里发请求；成功后把结果交给页面去刷新列表。
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { vendorLabel } from '@/utils/providerMeta'
import LcIcon from '@/components/LcIcon.vue'
import ProviderForm from './ProviderForm.vue'
import VendorPicker from './VendorPicker.vue'
import VendorModels from './VendorModels.vue'
import { initialProviderForm, missingApiKey, providerPayload, type ProviderFormState } from './providerForm'
import type { ProviderInstance, Vendor } from '@/types'

const props = defineProps<{
  vendors: Vendor[]
  /** 编辑时传入 */
  existing?: ProviderInstance | null
  /** 添加时先选中的服务商；不传就是清单里的第一家 */
  presetVendor?: string
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', provider: ProviderInstance | null, created: boolean): void
  (e: 'removed', id: string): void
}>()

const { t } = useI18n()
const uid = useId()

const vendorOf = (type: string) => props.vendors.find(v => v.type === type) || null

const vendorId = ref(props.existing?.type || (props.presetVendor && vendorOf(props.presetVendor) ? props.presetVendor : props.vendors[0]?.type) || '')
const vendor = computed(() => vendorOf(vendorId.value))
const form = ref<ProviderFormState>(vendor.value
  ? initialProviderForm(vendor.value, props.existing)
  : { name: '', apiKey: '', baseUrl: '', enabled: true })
const error = ref('')
const saving = ref(false)

function onVendorChange() {
  error.value = ''
  if (vendor.value) form.value = initialProviderForm(vendor.value)
}

function close() {
  if (!saving.value && !deleting.value) emit('close')
}

async function save() {
  const v = vendor.value
  if (!v) return
  if (missingApiKey(form.value, props.existing)) {
    error.value = t('modelsPage.provider.apiKeyRequired')
    return
  }
  saving.value = true
  error.value = ''
  try {
    const { type, ...rest } = providerPayload(v, form.value, props.existing)
    // 服务商在添加时定下，编辑时不带 type
    const saved = props.existing
      ? unwrap(await adminApi.updateProvider(props.existing.id, rest))
      : unwrap(await adminApi.createProvider({ type, ...rest }))
    MessagePlugin.success(t('common.saved'))
    emit('saved', saved || null, !props.existing)
  } catch (err) {
    error.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    saving.value = false
  }
}

// ---- 删除 ----
const removing = ref(false)
const deleting = ref(false)

function cancelRemove() {
  if (!deleting.value) removing.value = false
}

async function confirmRemove() {
  const p = props.existing
  if (!p) return
  deleting.value = true
  try {
    unwrap(await adminApi.removeProvider(p.id))
    emit('removed', p.id)
  } catch (err) {
    removing.value = false
    error.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
.pd { width: 640px; }
.vendor-fixed { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; }
.vendor-fixed-name { font: 600 15px/1.4 var(--f-disp); color: var(--text); }
.enable-row { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-2); }
.enable-row label { cursor: pointer; }
.key-note { margin-top: 14px; }
.dialog-error { margin-top: 14px; }
.remove { margin-right: auto; }
.confirm { width: 420px; }
.confirm p { line-height: 1.7; color: var(--text-2); }

@media (max-width: 560px) {
  .pd .lc-dialog-foot { flex-wrap: wrap; }
}
</style>
