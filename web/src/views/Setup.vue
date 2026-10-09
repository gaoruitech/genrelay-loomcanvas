<template>
  <div class="setup-page">
    <div class="setup-inner">
      <header class="setup-head">
        <div class="setup-brand">{{ app.siteName }}</div>
        <div class="setup-tools">
          <LcSelect
            class="lang"
            size="sm"
            :model-value="app.locale"
            :options="LOCALE_OPTIONS"
            :aria-label="t('app.language')"
            @update:model-value="app.setLocale"
          />
        </div>
      </header>

      <p class="step">{{ t('setup.step') }}</p>
      <h1>{{ t('setup.title') }}</h1>
      <p class="lead">{{ t('setup.lead') }}</p>

      <div v-if="loading" class="lc-empty">{{ t('common.loading') }}</div>
      <div v-else-if="loadError" class="lc-empty">
        <p class="lc-error-text">{{ loadError }}</p>
        <button class="lc-btn sm retry" @click="load">{{ t('common.retry') }}</button>
      </div>

      <template v-else>
        <div class="cards" role="radiogroup" :aria-label="t('setup.title')">
          <button
            v-for="tp in types"
            :key="tp.type"
            class="card"
            :class="{ active: selected?.type === tp.type }"
            role="radio"
            :aria-checked="selected?.type === tp.type"
            :disabled="busy"
            @click="select(tp)"
          >
            <span class="card-top">
              <span class="card-name">{{ providerTypeLabel(tp) }}</span>
              <span v-if="isGaorui(tp)" class="lc-tag accent">{{ t('setup.recommended') }}</span>
            </span>
            <span class="card-desc">{{ t('setup.cards.' + providerFamily(tp)) }}</span>
          </button>
        </div>

        <form v-if="selected" class="lc-card form" @submit.prevent="submit">
          <div class="form-title">
            <span>{{ t('setup.formTitle', { name: providerTypeLabel(selected) }) }}</span>
            <a v-if="isGaorui(selected)" :href="GAORUI_URL" target="_blank" rel="noopener noreferrer" class="get-key">
              {{ t('setup.getKey') }}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </a>
          </div>

          <ProviderForm v-model="form" :type="selected" compact :disabled="busy" />

          <p v-if="error" class="lc-error-text err">{{ error }}</p>

          <div class="form-foot">
            <button class="lc-btn primary" type="submit" :disabled="busy">{{ busyText || t('setup.submit') }}</button>
            <span class="foot-hint">{{ t('setup.submitHint') }}</span>
          </div>
        </form>

        <p class="skip">
          <button class="link-btn" :disabled="busy" @click="skip">{{ t('setup.skip') }}</button>
          <span>{{ t('setup.skipHint') }}</span>
        </p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 首次使用引导：连接一个模型接入。
 *
 * 流程是「保存 → 连通性测试 → 进入画布」。后端的测试接口挂在已保存的实例上
 * （POST /api/admin/providers/:id/test），所以先建后测；测试没过就把刚建的删掉，
 * 不留一个不能用的接入在库里。
 */
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { adminApi, unwrap, apiErrorMessage } from '@/utils/api'
import { loadModels } from '@/utils/canvasModels'
import { useAppStore } from '@/stores/app'
import { skipSetup } from '@/router'
import { LOCALE_OPTIONS } from '@/locales'
import LcSelect from '@/components/LcSelect.vue'
import { GAORUI_URL, isGaorui, providerFamily, sortProviderTypes, providerTypeLabel, providerFieldLabel } from '@/utils/providerMeta'
import ProviderForm from '@/components/settings/ProviderForm.vue'
import { initialProviderForm, missingProviderField, providerPayload } from '@/components/settings/providerForm'
import type { ProviderType } from '@/types'

const { t } = useI18n()
const router = useRouter()
const app = useAppStore()

const types = ref<ProviderType[]>([])
const loading = ref(true)
const loadError = ref('')
const selected = ref<ProviderType | null>(null)
const form = ref<Record<string, any>>({})
const busy = ref(false)
const busyText = ref('')
const error = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    types.value = sortProviderTypes(unwrap(await adminApi.providerTypes()) || [])
    if (types.value.length) select(types.value[0])
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

function select(tp: ProviderType) {
  if (selected.value?.type === tp.type) return
  selected.value = tp
  form.value = initialProviderForm(tp)
  error.value = ''
}

async function submit() {
  const tp = selected.value
  if (!tp || busy.value) return
  const missing = missingProviderField(tp, form.value)
  if (missing) {
    error.value = t('settings.providers.fieldRequired', { field: providerFieldLabel(tp, missing) })
    return
  }
  busy.value = true
  error.value = ''
  let createdId = ''
  try {
    busyText.value = t('common.saving')
    const created = unwrap(await adminApi.createProvider(providerPayload(tp, form.value)))
    createdId = created?.id || ''
    if (!createdId) throw new Error(t('common.operationFailed'))

    busyText.value = t('settings.providers.testing')
    const result = unwrap(await adminApi.testProvider(createdId))
    if (!result?.ok) throw new Error(result?.message || t('settings.providers.testFailed'))

    createdId = ''
    await app.loadBootstrap()
    await loadModels().catch(() => undefined)
    MessagePlugin.success(
      typeof result.modelCount === 'number'
        ? t('settings.providers.testOkCount', { n: result.modelCount })
        : t('settings.providers.testOk'),
    )
    router.replace('/')
  } catch (err) {
    error.value = apiErrorMessage(err, t('settings.providers.testFailed'))
    if (createdId) await adminApi.removeProvider(createdId).catch(() => undefined)
  } finally {
    busy.value = false
    busyText.value = ''
  }
}

function skip() {
  skipSetup()
  router.replace('/')
}
</script>

<style scoped>
.setup-page { height: 100%; overflow-y: auto; }
.setup-inner { max-width: 860px; margin: 0 auto; padding: 28px 24px 60px; }
.setup-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 44px; }
.setup-brand { font-size: 16px; font-weight: 700; color: var(--t-max); }
.lang { width: 120px; }
.step { font-size: 12.5px; font-weight: 600; color: var(--accent-text); margin-bottom: 8px; }
h1 { font-size: 26px; font-weight: 700; color: var(--t-max); margin-bottom: 10px; }
.lead { color: var(--t-dim); line-height: 1.7; margin-bottom: 26px; max-width: 620px; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 16px; }
.card {
  display: flex; flex-direction: column; gap: 8px; text-align: left;
  padding: 16px; border-radius: var(--radius-lg);
  background: var(--n-2); border: 1px solid var(--n-5); color: inherit; font: inherit;
  cursor: pointer; transition: border-color .15s ease, background .15s ease;
}
.card:hover:not(:disabled) { border-color: var(--n-8); }
.card.active { border-color: var(--accent-edge); background: var(--accent-ghost); }
.card:disabled { cursor: not-allowed; opacity: .7; }
.card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.card-name { font-size: 15px; font-weight: 600; color: var(--t-max); }
.card-desc { font-size: 12.5px; color: var(--t-dim); line-height: 1.6; }

.form { padding: 22px; }
.form-title {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  font-size: 14.5px; font-weight: 600; color: var(--t-max); margin-bottom: 18px;
}
.get-key { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 500; }
.get-key svg { width: 13px; height: 13px; }
.form-foot { display: flex; align-items: center; gap: 14px; margin-top: 4px; }
.foot-hint { font-size: 12px; color: var(--t-dim); }
.err { margin-bottom: 14px; }
.skip { margin-top: 20px; font-size: 12.5px; color: var(--t-dim); display: flex; gap: 8px; flex-wrap: wrap; }
.link-btn { border: 0; background: none; color: var(--accent-text); font: inherit; cursor: pointer; padding: 0; }
.link-btn:hover:not(:disabled) { text-decoration: underline; }
.retry { margin-top: 12px; }
</style>
