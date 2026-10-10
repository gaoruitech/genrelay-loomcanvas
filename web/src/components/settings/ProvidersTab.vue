<template>
  <section>
    <div class="tab-head">
      <div>
        <h2>{{ t('settings.providers.title') }}</h2>
        <p class="tab-desc">{{ t('settings.providers.desc') }}</p>
      </div>
      <button class="lc-btn primary" :disabled="!vendors.length" @click="openAdd">{{ t('settings.providers.add') }}</button>
    </div>

    <div v-if="loading" class="lc-empty">{{ t('common.loading') }}</div>
    <div v-else-if="loadError" class="lc-empty">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="!providers.length" class="lc-card lc-empty">{{ t('settings.providers.empty') }}</div>

    <div v-else class="prov-list">
      <div v-for="p in providers" :key="p.id" class="lc-card prov">
        <div class="prov-main">
          <div class="prov-title">
            <span class="prov-name">{{ p.name }}</span>
            <span class="lc-tag">{{ labelOf(p.type) }}</span>
            <span class="lc-tag" :class="p.enabled ? 'ok' : ''">{{ p.enabled ? t('common.enabled') : t('common.disabled') }}</span>
            <span v-if="p.customBaseUrl" class="lc-tag warn">{{ t('settings.providers.customAddress') }}</span>
          </div>
          <div class="prov-meta">
            <span>{{ p.hasKey
              ? (p.keyTail ? t('settings.providers.secretSetTail', { tail: p.keyTail }) : t('settings.providers.secretSet'))
              : t('settings.providers.secretUnset') }}</span>
            <span v-if="countText(p)">{{ countText(p) }}</span>
            <span v-if="p.baseUrl" class="prov-url">{{ p.baseUrl }}</span>
          </div>
          <div v-if="testResult[p.id]" class="prov-test" :class="testResult[p.id].ok ? 'ok' : 'err'">
            {{ testMessage(testResult[p.id]) }}
          </div>
        </div>
        <div class="prov-ops">
          <button class="lc-btn sm" :disabled="testing === p.id" @click="test(p)">
            {{ testing === p.id ? t('settings.providers.testing') : t('settings.providers.test') }}
          </button>
          <button class="lc-btn sm" @click="openEdit(p)">{{ t('common.edit') }}</button>
          <button class="lc-btn sm danger" @click="removing = p">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>

    <!-- 新增 / 编辑 -->
    <div v-if="dialog" class="lc-mask" @click.self="closeDialog">
      <div class="lc-dialog prov-dialog">
        <div class="lc-dialog-head">
          <span>{{ dialog.existing ? t('settings.providers.editTitle') : t('settings.providers.addTitle') }}</span>
          <button class="lc-x" :aria-label="t('common.close')" @click="closeDialog">×</button>
        </div>
        <div class="lc-dialog-body">
          <!-- 第一步：选服务商。编辑时固定，不能换 -->
          <div v-if="dialog.existing && dialogVendor" class="lc-field">
            <span class="lc-label">{{ t('settings.providers.vendor') }}</span>
            <div class="vendor-fixed">
              <span class="vendor-fixed-name">{{ vendorLabel(dialogVendor) }}</span>
              <span class="lc-help">{{ t('settings.providers.vendorFixed') }}</span>
            </div>
          </div>
          <div v-else class="lc-field">
            <span class="lc-label">{{ t('settings.providers.pickVendor') }}</span>
            <VendorPicker v-model="dialog.vendorId" :vendors="vendors" :disabled="saving" @update:model-value="onVendorChange" />
          </div>

          <template v-if="dialogVendor">
            <VendorModels :key="dialogVendor.type" :vendor="dialogVendor" :expanded="!dialog.existing" />

            <ProviderForm
              :key="'f-' + dialogVendor.type"
              v-model="dialog.form"
              :vendor="dialogVendor"
              :existing="dialog.existing"
              :disabled="saving"
            />

            <label class="enable-row">
              <button
                type="button"
                class="lc-switch"
                :class="{ on: dialog.form.enabled }"
                :disabled="saving"
                role="switch"
                :aria-checked="!!dialog.form.enabled"
                @click="dialog.form.enabled = !dialog.form.enabled"
              />
              <span>{{ t('settings.providers.enabledLabel') }}</span>
            </label>
          </template>

          <p v-if="dialogError" class="lc-error-text dialog-error">{{ dialogError }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="saving" @click="closeDialog">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary" :disabled="saving || !dialogVendor" @click="save">
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 删除确认 -->
    <div v-if="removing" class="lc-mask" @click.self="removing = null">
      <div class="lc-dialog confirm">
        <div class="lc-dialog-head"><span>{{ t('settings.providers.deleteTitle') }}</span></div>
        <div class="lc-dialog-body">
          <p>{{ t('settings.providers.deleteText', { name: removing.name }) }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="deleting" @click="removing = null">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" :disabled="deleting" @click="confirmRemove">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { loadModels } from '@/utils/canvasModels'
import { useAppStore } from '@/stores/app'
import { vendorLabel } from '@/utils/providerMeta'
import ProviderForm from './ProviderForm.vue'
import VendorPicker from './VendorPicker.vue'
import VendorModels from './VendorModels.vue'
import { initialProviderForm, missingApiKey, providerPayload, type ProviderFormState } from './providerForm'
import type { ProviderInstance, ProviderTestResult, Vendor } from '@/types'

const { t } = useI18n()
const app = useAppStore()

const vendors = ref<Vendor[]>([])
const providers = ref<ProviderInstance[]>([])
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [vs, list] = await Promise.all([adminApi.vendors(), adminApi.providers()])
    vendors.value = unwrap(vs) || []
    providers.value = unwrap(list) || []
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

const vendorOf = (type: string) => vendors.value.find(x => x.type === type) || null

function labelOf(type: string): string {
  const v = vendorOf(type)
  return v ? vendorLabel(v) : type
}

/** 「8 个模型，其中 2 个自定义」：服务商清单里的，加上这个实例自己添加的 */
function countText(p: ProviderInstance): string {
  const v = vendorOf(p.type)
  if (!v) return ''
  const custom = p.customModels?.length || 0
  const n = v.models.length + custom
  return custom ? t('settings.providers.modelCountCustom', { n, custom }) : t('settings.providers.modelCount', { n })
}

/** 服务商变了：启动信息里的 hasProvider 和画布用的模型清单都要跟着刷新 */
async function refreshAfterChange() {
  await Promise.all([
    app.loadBootstrap(),
    loadModels().catch(() => undefined),
  ])
}

// ---- 连通性测试 ----
const testing = ref('')
const testResult = reactive<Record<string, ProviderTestResult>>({})

function testMessage(r: ProviderTestResult): string {
  return r.message || t(r.ok ? 'settings.providers.testOk' : 'settings.providers.testFailed')
}

async function test(p: ProviderInstance) {
  testing.value = p.id
  try {
    testResult[p.id] = unwrap(await adminApi.testProvider(p.id))
  } catch (err) {
    testResult[p.id] = { ok: false, message: apiErrorMessage(err, t('settings.providers.testFailed')) }
  } finally {
    testing.value = ''
  }
}

// ---- 新增 / 编辑 ----
interface DialogState {
  existing: ProviderInstance | null
  vendorId: string
  form: ProviderFormState
}
const dialog = ref<DialogState | null>(null)
const dialogError = ref('')
const saving = ref(false)
const dialogVendor = computed(() => vendorOf(dialog.value?.vendorId || ''))

function openAdd() {
  const first = vendors.value[0]
  if (!first) return
  dialogError.value = ''
  dialog.value = { existing: null, vendorId: first.type, form: initialProviderForm(first) }
}

function openEdit(p: ProviderInstance) {
  const v = vendorOf(p.type)
  if (!v) {
    MessagePlugin.error(t('settings.providers.unknownType', { type: p.type }))
    return
  }
  dialogError.value = ''
  dialog.value = { existing: p, vendorId: v.type, form: initialProviderForm(v, p) }
}

function onVendorChange() {
  dialogError.value = ''
  if (dialog.value && dialogVendor.value) dialog.value.form = initialProviderForm(dialogVendor.value)
}

function closeDialog() {
  if (!saving.value) dialog.value = null
}

async function save() {
  const d = dialog.value
  const v = dialogVendor.value
  if (!d || !v) return
  if (missingApiKey(d.form, d.existing)) {
    dialogError.value = t('settings.providers.apiKeyRequired')
    return
  }
  saving.value = true
  dialogError.value = ''
  try {
    const { type, ...rest } = providerPayload(v, d.form, d.existing)
    // 服务商在添加时定下，编辑时不带 type
    if (d.existing) unwrap(await adminApi.updateProvider(d.existing.id, rest))
    else unwrap(await adminApi.createProvider({ type, ...rest }))
    dialog.value = null
    MessagePlugin.success(t('common.saved'))
    await load()
    await refreshAfterChange()
  } catch (err) {
    dialogError.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    saving.value = false
  }
}

// ---- 删除 ----
const removing = ref<ProviderInstance | null>(null)
const deleting = ref(false)

async function confirmRemove() {
  const p = removing.value
  if (!p) return
  deleting.value = true
  try {
    unwrap(await adminApi.removeProvider(p.id))
    removing.value = null
    delete testResult[p.id]
    await load()
    await refreshAfterChange()
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    deleting.value = false
  }
}
</script>

<style scoped>
@import './tab-shared.css';

.prov-list { display: flex; flex-direction: column; gap: 12px; }
.prov { display: flex; align-items: flex-start; gap: 16px; }
.prov-main { flex: 1; min-width: 0; }
.prov-title { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
.prov-name { font-size: 14.5px; font-weight: 600; color: var(--t-max); }
.prov-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12.5px; color: var(--t-dim); }
.prov-url { word-break: break-all; }
.prov-test { margin-top: 8px; font-size: 12.5px; }
.prov-test.ok { color: var(--success); }
.prov-test.err { color: var(--danger); }
.prov-ops { display: flex; gap: 8px; flex: none; }
.prov-dialog { width: 640px; }
.vendor-fixed { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; }
.vendor-fixed-name { font-size: 14.5px; font-weight: 600; color: var(--t-max); }
.enable-row { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--t-body); cursor: pointer; }
.dialog-error { margin-top: 14px; }
.retry { margin-top: 12px; }
.confirm { width: 420px; }
.confirm p { line-height: 1.6; }

@media (max-width: 640px) {
  .prov { flex-direction: column; }
}
</style>
