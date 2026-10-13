<template>
  <Teleport :to="$lcPortal">
  <div class="lc-mask lc-sheet" @mousedown="downOnMask = $event.target === $event.currentTarget" @click.self="downOnMask && close()">
    <div v-dialog="{ onEscape: close, busy: saving || deleting }" class="lc-dialog pd" role="dialog" aria-modal="true" :aria-labelledby="uid + '-title'" data-testid="provider-dialog">
      <div class="lc-dialog-head">
        <span :id="uid + '-title'">{{ existing ? t('modelsPage.provider.editTitle') : t('modelsPage.provider.addTitle') }}</span>
        <button class="lc-x" type="button" :aria-label="t('common.close')" :disabled="saving" @click="close">×</button>
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
          <!-- 存着的 Key 服务端解不开了：先说这件事，下面的 Key 一栏就是要填的地方 -->
          <div v-if="existing?.keyUnreadable" class="lc-alert warn key-lost" role="status" data-role="key-unreadable">
            <LcIcon name="warn" size="s" /><span>{{ t('modelsPage.provider.keyLostAlert') }}</span>
          </div>
          <VendorModels :key="vendor.type" :vendor="vendor" :expanded="!existing" />

          <ProviderForm
            :key="'f-' + vendor.type"
            v-model="form"
            :vendor="vendor"
            :existing="existing"
            :disabled="saving"
            :key-error="keyError"
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
        <button v-if="existing" class="lc-btn danger remove" type="button" :disabled="saving" data-act="delete-provider" @click="removing = true">
          <LcIcon name="trash" size="s" />{{ t('modelsPage.provider.delete') }}
        </button>
        <button class="lc-btn" type="button" :disabled="saving" @click="close">{{ t('common.cancel') }}</button>
        <button class="lc-btn primary quiet" type="button" :disabled="saving || !vendor || keyBlocked" v-tip="keyBlocked ? t('modelsPage.provider.keyAgainShort') : undefined" data-act="save-provider" @click="save">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </div>
  </div>

  <!-- 删除确认：摞在上面的另一层，Esc / 取消只关这一层 -->
  <div v-if="removing && existing" class="lc-mask lc-sheet" @click.self="cancelRemove">
    <div
      v-dialog="{ onEscape: cancelRemove, busy: deleting }" class="lc-dialog confirm" role="alertdialog" aria-modal="true"
      :aria-labelledby="uid + '-del-title'" :aria-describedby="uid + '-del-text'" data-testid="provider-delete-dialog"
    >
      <div class="lc-dialog-head"><span :id="uid + '-del-title'">{{ t('modelsPage.provider.deleteTitle') }}</span></div>
      <div class="lc-dialog-body">
        <p :id="uid + '-del-text'">{{ t('modelsPage.provider.deleteText', { name: existing.name }) }}</p>
      </div>
      <div class="lc-dialog-foot">
        <button class="lc-btn" type="button" :disabled="deleting" data-autofocus @click="cancelRemove">{{ t('common.cancel') }}</button>
        <button class="lc-btn danger" type="button" :disabled="deleting" data-act="confirm-delete" @click="confirmRemove">{{ t('common.delete') }}</button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 添加 / 编辑一个服务商：选服务商 → 看它支持的模型 → 填 Key（名称、地址可选）。
 * 编辑时左下角可以删除这个服务商（要再确认一次）。
 * 保存、删除都在这里发请求；成功后把结果交给页面去刷新列表。
 * 键盘和焦点交给 v-dialog：打开时焦点落在 API Key 上，Tab 圈在弹窗里，Esc 关最上面那一层，关掉后焦点还给打开它的按钮。
 */
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { adminApi, unwrap, apiErrorMessage, apiErrorCode, SPACE_GONE_CODES } from '@/utils/api'
import { vendorLabel } from '@/utils/providerMeta'
import LcIcon from '@/components/LcIcon.vue'
import { vDialog } from '@/directives/dialog'
import ProviderForm from './ProviderForm.vue'
import VendorPicker from './VendorPicker.vue'
import VendorModels from './VendorModels.vue'
import { initialProviderForm, keyNeededForAddress, missingApiKey, providerPayload, type ProviderFormState } from './providerForm'
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
  /** 后端说调用者已经不能管理服务商了（团队里被降成了成员）：交给页面去刷新权限 */
  (e: 'forbidden', message: string): void
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
/** 按下和松开都在遮罩上才算「点外面」：在输入框里拖选文字、松手时滑到外面不算 */
const downOnMask = ref(false)

/** 后端拒绝过一次「改地址不带 Key」：它的原话，标在 Key 那一栏上，填了 Key 就消失 */
const keyError = ref('')
watch(() => form.value.apiKey, (v) => { if (v.trim()) keyError.value = '' })
/** 改了地址（或后端这么要求）而 Key 还空着：先不让保存 */
const keyBlocked = computed(() => {
  if (!props.existing?.hasKey || form.value.apiKey.trim()) return false
  return !!keyError.value || (!!vendor.value && keyNeededForAddress(vendor.value, form.value, props.existing))
})

/** 这几种错误不在弹窗里再说一遍：空间没了由全局处理，角色变了交给页面 */
function handled(err: unknown): boolean {
  const code = apiErrorCode(err)
  if ((SPACE_GONE_CODES as readonly string[]).includes(code)) { emit('close'); return true }
  if (code === 'team.forbidden') { emit('forbidden', apiErrorMessage(err, t('common.operationFailed'))); return true }
  return false
}

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
  if (keyBlocked.value) return
  if (missingApiKey(form.value, props.existing, v)) {
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
    saving.value = false
    if (handled(err)) return
    // 别人刚改过这个服务商的地址：本地看不出来，后端要求把 Key 重新填上
    if (apiErrorCode(err) === 'provider.key_required_for_url') keyError.value = apiErrorMessage(err, t('modelsPage.provider.keyAgain'))
    else error.value = apiErrorMessage(err, t('common.operationFailed'))
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
    deleting.value = false
    if (handled(err)) return
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
.key-lost { margin-bottom: 16px; }
.dialog-error { margin-top: 14px; }
.remove { margin-right: auto; }
.confirm { width: 420px; }
.confirm p { line-height: 1.7; color: var(--text-2); }

@media (max-width: 560px) {
  .pd .lc-dialog-foot { flex-wrap: wrap; }
}
</style>
