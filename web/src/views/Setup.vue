<template>
  <div class="su">
    <header class="su-nav">
      <LcLogo />
      <span class="lc-sp" />
      <LcSelect
        class="su-lang"
        size="sm"
        auto-width
        :model-value="app.locale"
        :options="LOCALE_OPTIONS"
        :aria-label="t('shell.language')"
        @update:model-value="app.setLocale"
      />
    </header>

    <main class="su-body">
      <section class="su-card lc-glass lc-gb">
        <span class="su-kick"><i />{{ t('setup.step') }}</span>
        <h1>{{ t('setup.title') }}</h1>
        <p class="su-lead">{{ t('setup.lead') }}</p>

        <div v-if="loading" class="su-loading" aria-hidden="true">
          <div class="su-skel-row"><i v-for="n in 3" :key="n" class="su-skel card" /></div>
          <i class="su-skel block" />
        </div>
        <div v-else-if="loadError" class="su-state">
          <div class="lc-alert"><LcIcon name="warn" /><span>{{ loadError }}</span></div>
          <button class="lc-btn sm" @click="load">{{ t('common.retry') }}</button>
        </div>

        <template v-else>
          <VendorPicker class="su-vendors" :vendors="vendors" :model-value="selected?.type || ''" :disabled="busy" @update:model-value="select" />

          <form v-if="selected" class="su-form" @submit.prevent="submit">
            <div class="su-form-title">
              <span>{{ t('setup.formTitle', { name: vendorLabel(selected) }) }}</span>
              <a v-if="selected.keyUrl" :href="selected.keyUrl" target="_blank" rel="noopener noreferrer" class="su-get-key">
                {{ t('setup.getKey') }}<LcIcon name="external" size="s" />
              </a>
            </div>

            <VendorModels :key="selected.type" :vendor="selected" />

            <ProviderForm :key="'f-' + selected.type" v-model="form" :vendor="selected" compact :disabled="busy" />

            <div v-if="error" class="lc-alert su-err" role="alert"><LcIcon name="warn" /><span>{{ error }}</span></div>

            <div class="su-foot">
              <button class="lc-btn primary su-submit" type="submit" :disabled="busy">{{ busyText || t('setup.submit') }}</button>
              <span class="su-foot-hint">{{ t('setup.submitHint') }}</span>
            </div>
          </form>
        </template>

        <p class="su-skip">
          <button class="lc-btn text sm" :disabled="busy" @click="skip">{{ t('setup.skip') }}</button>
          <span>{{ t('setup.skipHint') }}</span>
        </p>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
/**
 * 首次使用引导：添加一个服务商。服务商是按账号的，所以每个账号第一次登录、
 * 自己名下还没有服务商时都会来这里：超级管理员第一次登录是这样，之后注册的每个用户也是。
 *
 * 流程是「保存 → 连通性测试 → 进入工作台」。后端的测试接口挂在已保存的实例上
 * （POST /api/admin/providers/:id/test），所以先建后测；测试没过就把刚建的删掉，
 * 不留一个不能用的服务商在库里。
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
import LcLogo from '@/components/LcLogo.vue'
import LcIcon from '@/components/LcIcon.vue'
import { vendorLabel } from '@/utils/providerMeta'
import ProviderForm from '@/components/models/ProviderForm.vue'
import VendorPicker from '@/components/models/VendorPicker.vue'
import VendorModels from '@/components/models/VendorModels.vue'
import { initialProviderForm, missingApiKey, providerPayload, type ProviderFormState } from '@/components/models/providerForm'
import type { Vendor } from '@/types'

const { t } = useI18n()
const router = useRouter()
const app = useAppStore()

const vendors = ref<Vendor[]>([])
const loading = ref(true)
const loadError = ref('')
const selected = ref<Vendor | null>(null)
const form = ref<ProviderFormState>({ name: '', apiKey: '', baseUrl: '', enabled: true })
const busy = ref(false)
const busyText = ref('')
const error = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    // 后端给的顺序就是显示顺序：内置的高瑞排第一
    vendors.value = unwrap(await adminApi.vendors()) || []
    if (vendors.value.length) select(vendors.value[0].type)
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

function select(type: string) {
  const v = vendors.value.find(x => x.type === type)
  if (!v || selected.value?.type === v.type) return
  selected.value = v
  form.value = initialProviderForm(v)
  error.value = ''
}

async function submit() {
  const v = selected.value
  if (!v || busy.value) return
  if (missingApiKey(form.value)) {
    error.value = t('setup.apiKeyRequired')
    return
  }
  busy.value = true
  error.value = ''
  let createdId = ''
  try {
    busyText.value = t('common.saving')
    const created = unwrap(await adminApi.createProvider(providerPayload(v, form.value)))
    createdId = created?.id || ''
    if (!createdId) throw new Error(t('common.operationFailed'))

    busyText.value = t('setup.testing')
    const result = unwrap(await adminApi.testProvider(createdId))
    if (!result?.ok) throw new Error(result?.message || t('setup.testFailed'))

    createdId = ''
    await app.loadBootstrap()
    await loadModels().catch(() => undefined)
    MessagePlugin.success(result.message || t('setup.testOk'))
    router.replace('/app')
  } catch (err) {
    error.value = apiErrorMessage(err, t('setup.testFailed'))
    if (createdId) await adminApi.removeProvider(createdId).catch(() => undefined)
  } finally {
    busy.value = false
    busyText.value = ''
  }
}

function skip() {
  skipSetup()
  router.replace('/app')
}
</script>

<style scoped>
/* 和登录 / 注册页一个调子：霓虹底上一张居中的玻璃卡片 */
.su { height: 100%; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; }
.su-nav { flex: none; height: 72px; display: flex; align-items: center; gap: 16px; padding: 0 120px; max-width: 1440px; width: 100%; margin: 0 auto; }
.su-lang :deep(.lcs-trigger) { min-width: 120px; }
.su-body { flex: 1; display: flex; justify-content: center; align-items: flex-start; padding: 24px 24px 72px; }
.su-card { width: 100%; max-width: 760px; padding: 40px; border-radius: 22px; box-shadow: var(--glow-l), var(--sh-2); min-width: 0; }

.su-kick {
  display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 14px; border-radius: 15px;
  border: 1px solid var(--line-3); background: rgba(59, 123, 255, .12); color: var(--cyan-soft); font-size: 13px;
}
.su-kick i { width: 6px; height: 6px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 8px var(--cyan); }
h1 { font: 600 26px/1.3 var(--f-disp); color: var(--text); margin-top: 16px; }
.su-lead { color: var(--text-2); line-height: 1.75; margin-top: 8px; max-width: 620px; }

.su-vendors { margin-top: 28px; }
.su-form { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--line); }
.su-form-title {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  font: 600 16px/1.4 var(--f-disp); color: var(--text); margin-bottom: 16px;
}
.su-get-key { display: inline-flex; align-items: center; gap: 6px; font: 500 13px/1.4 var(--f-body); }
.su-err { margin-bottom: 16px; }
.su-foot { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-top: 4px; }
.su-submit { height: 40px; padding: 0 20px; }
.su-foot-hint { font-size: 12px; color: var(--text-3); flex: 1 1 200px; min-width: 0; }

.su-skip {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 13px; color: var(--text-3);
}
.su-skip .lc-btn { font-size: 13px; }

.su-state { margin-top: 28px; display: grid; gap: 12px; justify-items: start; }
.su-loading { margin-top: 28px; }
.su-skel { display: block; border-radius: var(--r-sm); background: var(--skel-bg); animation: lc-pulse 1.6s ease-in-out infinite; }
.su-skel-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.su-skel.card { height: 76px; }
.su-skel.block { height: 180px; margin-top: 20px; }

@media (max-width: 1240px) { .su-nav { padding: 0 48px; } }
@media (max-width: 600px) {
  .su-nav { padding: 0 16px; height: 60px; }
  .su-body { padding: 8px 16px 40px; }
  .su-card { padding: 24px 20px; border-radius: 18px; box-shadow: var(--glow-m), var(--sh-1); }
  h1 { font-size: 22px; }
  .su-submit { width: 100%; }
  .su-skel-row { grid-template-columns: minmax(0, 1fr); }
}
</style>
