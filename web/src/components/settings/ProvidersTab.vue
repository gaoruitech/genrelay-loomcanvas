<template>
  <section>
    <div class="tab-head">
      <div>
        <h2>{{ t('settings.providers.title') }}</h2>
        <p class="tab-desc">{{ t('settings.providers.desc') }}</p>
      </div>
      <button class="lc-btn primary" :disabled="!types.length" @click="openAdd">{{ t('settings.providers.add') }}</button>
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
            <span class="lc-tag">{{ typeLabel(p.type) }}</span>
            <span class="lc-tag" :class="p.enabled ? 'ok' : ''">{{ p.enabled ? t('common.enabled') : t('common.disabled') }}</span>
          </div>
          <div class="prov-meta">
            <span>{{ p.hasKey
              ? (p.keyTail ? t('settings.providers.secretSetTail', { tail: p.keyTail }) : t('settings.providers.secretSet'))
              : t('settings.providers.secretUnset') }}</span>
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
      <div class="lc-dialog">
        <div class="lc-dialog-head">
          <span>{{ dialog.existing ? t('settings.providers.editTitle') : t('settings.providers.addTitle') }}</span>
          <button class="lc-x" :aria-label="t('common.close')" @click="closeDialog">×</button>
        </div>
        <div class="lc-dialog-body">
          <div class="lc-field">
            <label>{{ t('settings.providers.type') }}</label>
            <select v-model="dialog.typeId" class="lc-select" :disabled="!!dialog.existing || saving" @change="onTypeChange">
              <option v-for="tp in types" :key="tp.type" :value="tp.type">{{ tp.label }}</option>
            </select>
            <span v-if="dialogType && isGaorui(dialogType)" class="lc-help">
              <a :href="GAORUI_URL" target="_blank" rel="noopener noreferrer">{{ t('setup.getKey') }}</a>
            </span>
          </div>

          <ProviderForm
            v-if="dialogType"
            v-model="dialog.form"
            :type="dialogType"
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

          <p v-if="dialogError" class="lc-error-text dialog-error">{{ dialogError }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="saving" @click="closeDialog">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary" :disabled="saving" @click="save">
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
import { GAORUI_URL, isGaorui } from '@/utils/providerMeta'
import ProviderForm from './ProviderForm.vue'
import { initialProviderForm, missingProviderField, providerPayload } from './providerForm'
import type { ProviderInstance, ProviderTestResult, ProviderType } from '@/types'

const { t } = useI18n()
const app = useAppStore()

const types = ref<ProviderType[]>([])
const providers = ref<ProviderInstance[]>([])
const loading = ref(true)
const loadError = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const [tp, list] = await Promise.all([adminApi.providerTypes(), adminApi.providers()])
    types.value = unwrap(tp) || []
    providers.value = unwrap(list) || []
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

function typeLabel(type: string): string {
  return types.value.find(x => x.type === type)?.label || type
}

/** 接入变了：启动信息里的 hasProvider 和画布用的模型清单都要跟着刷新 */
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
  if (!r.ok) return r.message || t('settings.providers.testFailed')
  return typeof r.modelCount === 'number'
    ? t('settings.providers.testOkCount', { n: r.modelCount })
    : (r.message || t('settings.providers.testOk'))
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
  typeId: string
  form: Record<string, any>
}
const dialog = ref<DialogState | null>(null)
const dialogError = ref('')
const saving = ref(false)
const dialogType = computed(() => types.value.find(x => x.type === dialog.value?.typeId) || null)

function openAdd() {
  const first = types.value[0]
  if (!first) return
  dialogError.value = ''
  dialog.value = { existing: null, typeId: first.type, form: initialProviderForm(first) }
}

function openEdit(p: ProviderInstance) {
  const tp = types.value.find(x => x.type === p.type)
  if (!tp) {
    MessagePlugin.error(t('settings.providers.unknownType', { type: p.type }))
    return
  }
  dialogError.value = ''
  dialog.value = { existing: p, typeId: tp.type, form: initialProviderForm(tp, p) }
}

function onTypeChange() {
  if (dialog.value && dialogType.value) dialog.value.form = initialProviderForm(dialogType.value)
}

function closeDialog() {
  if (!saving.value) dialog.value = null
}

async function save() {
  const d = dialog.value
  const tp = dialogType.value
  if (!d || !tp) return
  const missing = missingProviderField(tp, d.form, d.existing)
  if (missing) {
    dialogError.value = t('settings.providers.fieldRequired', { field: missing.label })
    return
  }
  saving.value = true
  dialogError.value = ''
  try {
    const body = providerPayload(tp, d.form, d.existing)
    if (d.existing) unwrap(await adminApi.updateProvider(d.existing.id, body))
    else unwrap(await adminApi.createProvider(body))
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
.enable-row { display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--t-body); cursor: pointer; }
.dialog-error { margin-top: 14px; }
.retry { margin-top: 12px; }
.confirm { width: 420px; }
.confirm p { line-height: 1.6; }

@media (max-width: 640px) {
  .prov { flex-direction: column; }
}
</style>
