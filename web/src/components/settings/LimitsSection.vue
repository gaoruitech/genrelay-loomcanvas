<template>
  <SettingsSection id="limits" icon="bolt" :title="t('settings.limits.title')" :desc="t('settings.limits.desc')">
    <SettingsCard v-if="loading">
      <div class="sk" aria-busy="true"><i /><i /><i /></div>
    </SettingsCard>
    <SettingsCard v-else-if="loadError">
      <div class="sec-state">
        <p class="lc-error-text">{{ loadError }}</p>
        <button class="lc-btn sm" @click="load">{{ t('common.retry') }}</button>
      </div>
    </SettingsCard>

    <form v-else class="stack" novalidate @submit.prevent="submit">
      <SettingsCard
        v-for="g in GROUPS"
        :key="g.id"
        :title="t('settings.limits.groups.' + g.id + '.title')"
        :desc="t('settings.limits.groups.' + g.id + '.desc')"
        :data-group="g.id"
      >
        <div v-for="f in g.fields" :key="f.key" class="srow">
          <div class="k"><label :for="'limit-' + f.key">{{ t('settings.limits.' + f.key) }}</label></div>
          <div class="v">
            <div class="inline">
              <NumberStepper
                :id="'limit-' + f.key"
                v-model="form[f.key]"
                :min="f.min"
                :max="f.max"
                :disabled="saving"
                :dec-label="t('settings.limits.decrease')"
                :inc-label="t('settings.limits.increase')"
              />
              <span class="unit">{{ t('settings.limits.units.' + f.unit) }}</span>
              <span class="range">{{ t('settings.limits.range', { min: f.min, max: f.max }) }}</span>
            </div>
            <span class="lc-help">{{ t('settings.limits.' + f.key + 'Help') }}</span>
          </div>
        </div>
      </SettingsCard>

      <p v-if="error" class="lc-error-text sec-err" role="alert">{{ error }}</p>
      <SaveBar :dirty="dirty" :note="t('settings.limits.saveNote')">
        <button v-if="dirty" class="lc-btn ghost" type="button" :disabled="saving" data-testid="limits-reset" @click="discard">
          {{ t('settings.discard') }}
        </button>
        <button class="lc-btn primary quiet" type="submit" :disabled="saving || !dirty" data-testid="limits-save">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </SaveBar>
    </form>
  </SettingsSection>
</template>

<script setup lang="ts">
/** 运行限制（仅超级管理员）：并发与排队、各种超时、重试与保留，分三张卡片；改完点底下那条里的「保存」。 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { apiErrorMessage } from '@/utils/api'
import { useAdminSettings } from '@/composables/useAdminSettings'
import SettingsSection from './SettingsSection.vue'
import SettingsCard from './SettingsCard.vue'
import SaveBar from './SaveBar.vue'
import NumberStepper from './NumberStepper.vue'
import { useSectionDirty } from './dirty'

const { t } = useI18n()

type LimitKey = 'concurrency' | 'userConcurrency' | 'userQueueLimit' | 'teamConcurrency' | 'imageTimeoutMinutes' | 'videoTimeoutMinutes' | 'maxRetries' | 'retentionDays'
  | 'submitTimeoutSec' | 'chatTimeoutSec' | 'downloadTimeoutSec'
type Unit = 'runs' | 'times' | 'minutes' | 'seconds' | 'days'
interface Field { key: LimitKey; min: number; max: number; unit: Unit }

// 范围与后端 services/settings.js 的校验一致：这里放得比后端宽，填进去就只能等后端报错
const GROUPS: { id: 'capacity' | 'timeouts' | 'upkeep'; fields: Field[] }[] = [
  {
    id: 'capacity',
    fields: [
      { key: 'concurrency', min: 1, max: 32, unit: 'runs' },
      { key: 'userConcurrency', min: 1, max: 32, unit: 'runs' },
      { key: 'userQueueLimit', min: 1, max: 500, unit: 'runs' },
      { key: 'teamConcurrency', min: 1, max: 32, unit: 'runs' },
    ],
  },
  {
    id: 'timeouts',
    fields: [
      { key: 'imageTimeoutMinutes', min: 1, max: 120, unit: 'minutes' },
      { key: 'videoTimeoutMinutes', min: 1, max: 240, unit: 'minutes' },
      { key: 'chatTimeoutSec', min: 10, max: 3600, unit: 'seconds' },
      { key: 'submitTimeoutSec', min: 5, max: 600, unit: 'seconds' },
      { key: 'downloadTimeoutSec', min: 10, max: 3600, unit: 'seconds' },
    ],
  },
  {
    id: 'upkeep',
    fields: [
      { key: 'maxRetries', min: 0, max: 5, unit: 'times' },
      { key: 'retentionDays', min: 0, max: 3650, unit: 'days' },
    ],
  },
]
const FIELDS = GROUPS.flatMap(g => g.fields)

const { form, loading, loadError, saving, dirty, load, save, reset } = useAdminSettings(
  FIELDS.map(f => f.key),
  {
    concurrency: 4, userConcurrency: 4, userQueueLimit: 200, teamConcurrency: 4, imageTimeoutMinutes: 10, videoTimeoutMinutes: 30, maxRetries: 2, retentionDays: 0,
    submitTimeoutSec: 60, chatTimeoutSec: 300, downloadTimeoutSec: 300,
  },
)
onMounted(load)
useSectionDirty(() => dirty.value)

const error = ref('')

function discard() {
  error.value = ''
  reset()
}

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
.stack { display: grid; gap: 24px; min-width: 0; }
.unit { min-width: 44px; color: var(--text-2); }
.range { font: 12px var(--f-mono); color: var(--text-3); }
@media (max-width: 600px) { .stack { gap: 16px; } }
</style>
