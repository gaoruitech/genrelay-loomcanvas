<template>
  <SettingsSection id="limits" icon="bolt" :title="t('settings.limits.title')" :desc="t('settings.limits.desc')">
    <div v-if="loading" class="sk" aria-busy="true"><i /><i /><i /></div>
    <div v-else-if="loadError" class="sec-state">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm" @click="load">{{ t('common.retry') }}</button>
    </div>

    <form v-else novalidate @submit.prevent="submit">
      <div v-for="f in FIELDS" :key="f.key" class="srow">
        <div class="k">
          <b><label :for="'limit-' + f.key">{{ t('settings.limits.' + f.key) }}</label></b>
          <small>{{ t('settings.limits.' + f.key + 'Help') }}</small>
        </div>
        <div class="v inline">
          <NumberStepper
            :id="'limit-' + f.key"
            v-model="form[f.key]"
            :min="f.min"
            :max="f.max"
            :disabled="saving"
            :dec-label="t('settings.limits.decrease')"
            :inc-label="t('settings.limits.increase')"
          />
          <span>{{ t('settings.limits.units.' + f.unit) }}</span>
          <span class="range">{{ f.min }}–{{ f.max }}</span>
        </div>
      </div>

      <p v-if="error" class="lc-error-text sec-err" role="alert">{{ error }}</p>
      <div class="sec-foot">
        <button class="lc-btn primary quiet" type="submit" :disabled="saving">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </form>
  </SettingsSection>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { apiErrorMessage } from '@/utils/api'
import { useAdminSettings } from '@/composables/useAdminSettings'
import SettingsSection from './SettingsSection.vue'
import NumberStepper from './NumberStepper.vue'

const { t } = useI18n()

type LimitKey = 'concurrency' | 'userConcurrency' | 'userQueueLimit' | 'imageTimeoutMinutes' | 'videoTimeoutMinutes' | 'maxRetries' | 'retentionDays'
  | 'submitTimeoutSec' | 'chatTimeoutSec' | 'downloadTimeoutSec'
type Unit = 'runs' | 'times' | 'minutes' | 'seconds' | 'days'

// 范围与后端 services/settings.js 的校验一致：这里放得比后端宽，填进去就只能等后端报错
const FIELDS: { key: LimitKey; min: number; max: number; unit: Unit }[] = [
  { key: 'concurrency', min: 1, max: 32, unit: 'runs' },
  { key: 'userConcurrency', min: 1, max: 32, unit: 'runs' },
  { key: 'userQueueLimit', min: 1, max: 500, unit: 'runs' },
  { key: 'maxRetries', min: 0, max: 5, unit: 'times' },
  { key: 'imageTimeoutMinutes', min: 1, max: 120, unit: 'minutes' },
  { key: 'videoTimeoutMinutes', min: 1, max: 240, unit: 'minutes' },
  { key: 'chatTimeoutSec', min: 10, max: 3600, unit: 'seconds' },
  { key: 'submitTimeoutSec', min: 5, max: 600, unit: 'seconds' },
  { key: 'downloadTimeoutSec', min: 10, max: 3600, unit: 'seconds' },
  { key: 'retentionDays', min: 0, max: 3650, unit: 'days' },
]

const { form, loading, loadError, saving, load, save } = useAdminSettings(
  FIELDS.map(f => f.key),
  {
    concurrency: 4, userConcurrency: 4, userQueueLimit: 200, imageTimeoutMinutes: 10, videoTimeoutMinutes: 30, maxRetries: 2, retentionDays: 0,
    submitTimeoutSec: 60, chatTimeoutSec: 300, downloadTimeoutSec: 300,
  },
)
onMounted(load)

const error = ref('')

async function submit() {
  error.value = ''
  for (const f of FIELDS) {
    const v = Number(form.value[f.key])
    if (!Number.isInteger(v) || v < f.min || v > f.max) {
      error.value = t('settings.limits.outOfRange', {
        field: t('settings.limits.' + f.key), min: f.min, max: f.max,
      })
      return
    }
  }
  try {
    await save()
    MessagePlugin.success(t('common.saved'))
  } catch (err) {
    error.value = apiErrorMessage(err, t('common.operationFailed'))
  }
}
</script>

<style scoped>
@import './section-shared.css';
.k label { cursor: default; }
.range { font: 12px var(--f-mono); color: var(--text-3); margin-left: auto; }
form > .srow:last-of-type { margin-bottom: 16px; }
.sec-err { margin-top: -4px; }
@media (max-width: 900px) { .range { margin-left: 0; } }
</style>
