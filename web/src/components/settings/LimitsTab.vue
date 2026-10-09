<template>
  <section>
    <div class="tab-head">
      <div>
        <h2>{{ t('settings.limits.title') }}</h2>
        <p class="tab-desc">{{ t('settings.limits.desc') }}</p>
      </div>
    </div>

    <div v-if="loading" class="lc-empty">{{ t('common.loading') }}</div>
    <div v-else-if="loadError" class="lc-empty">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <form v-else class="lc-card" @submit.prevent="submit">
      <div class="form-grid">
        <div v-for="f in FIELDS" :key="f.key" class="lc-field">
          <label :for="'limit-' + f.key">{{ t('settings.limits.' + f.key) }}</label>
          <input
            :id="'limit-' + f.key"
            v-model.number="form[f.key]"
            class="lc-input"
            type="number"
            :min="f.min"
            :max="f.max"
            step="1"
            :disabled="saving"
          />
          <span class="lc-help">{{ t('settings.limits.' + f.key + 'Help') }}</span>
        </div>
      </div>

      <p v-if="error" class="lc-error-text">{{ error }}</p>
      <div class="tab-foot">
        <button class="lc-btn primary" type="submit" :disabled="saving">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { apiErrorMessage } from '@/utils/api'
import { useAdminSettings } from '@/composables/useAdminSettings'

const { t } = useI18n()

type LimitKey = 'concurrency' | 'imageTimeoutMinutes' | 'videoTimeoutMinutes' | 'maxRetries' | 'retentionDays'

const FIELDS: { key: LimitKey; min: number; max: number }[] = [
  { key: 'concurrency', min: 1, max: 64 },
  { key: 'maxRetries', min: 0, max: 10 },
  { key: 'imageTimeoutMinutes', min: 1, max: 240 },
  { key: 'videoTimeoutMinutes', min: 1, max: 720 },
  { key: 'retentionDays', min: 0, max: 3650 },
]

const { form, loading, loadError, saving, load, save } = useAdminSettings(
  FIELDS.map(f => f.key),
  { concurrency: 4, imageTimeoutMinutes: 10, videoTimeoutMinutes: 30, maxRetries: 0, retentionDays: 0 },
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
@import './tab-shared.css';
.retry { margin-top: 12px; }
</style>
