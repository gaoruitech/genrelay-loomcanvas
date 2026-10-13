<template>
  <SettingsCard :title="t('settings.teams.feature.title')" data-testid="teams-feature">
    <div v-if="loading" class="sk" aria-busy="true"><i /><i /><i /></div>
    <div v-else-if="loadError" class="sec-state">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm" type="button" @click="load">{{ t('common.retry') }}</button>
    </div>

    <form v-else novalidate @submit.prevent="submit">
      <p class="how"><LcIcon name="info" size="s" /><span>{{ t('settings.teams.feature.how') }}</span></p>
      <div v-for="f in FIELDS" :key="f.key" class="frow">
        <div class="fk">
          <label :for="'team-set-' + f.key">{{ t('settings.teams.feature.' + f.key) }}</label>
          <small>{{ t('settings.teams.feature.' + f.key + 'Help') }}</small>
        </div>
        <div class="fv">
          <NumberStepper
            :id="'team-set-' + f.key"
            v-model="form[f.key]"
            :min="f.min"
            :max="f.max"
            :disabled="saving"
            :dec-label="t('settings.limits.decrease')"
            :inc-label="t('settings.limits.increase')"
          />
          <span class="unit">{{ t('settings.teams.feature.units.' + f.unit) }}</span>
        </div>
      </div>

      <p v-if="error" class="lc-error-text err" role="alert">{{ error }}</p>
      <div class="foot">
        <p class="state" :class="{ on: dirty }" aria-live="polite">{{ dirty ? t('settings.unsaved') : t('settings.teams.feature.saveNote') }}</p>
        <button v-if="dirty" class="lc-btn ghost" type="button" :disabled="saving" data-testid="teams-feature-reset" @click="discard">{{ t('settings.discard') }}</button>
        <button class="lc-btn primary quiet" type="submit" :disabled="saving || !dirty" data-testid="teams-feature-save">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </form>
  </SettingsCard>
</template>

<script setup lang="ts">
/**
 * 团队功能：三个站点级的数字。创建团队按账号授权（用户管理里设，或批准申请），这里没有「谁可以创建」的总开关。
 * 团队并发上限的默认值在「运行限制」里。
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { apiErrorMessage } from '@/utils/api'
import { useAdminSettings } from '@/composables/useAdminSettings'
import LcIcon from '@/components/LcIcon.vue'
import SettingsCard from './SettingsCard.vue'
import NumberStepper from './NumberStepper.vue'
import { useSectionDirty } from './dirty'

const emit = defineEmits<{ (e: 'saved'): void }>()
const { t } = useI18n()

type Key = 'teamMaxPerUser' | 'teamMaxMembers' | 'teamActivityDays'
// 范围与后端 services/settings.js 一致
const FIELDS: { key: Key; min: number; max: number; unit: 'teams' | 'people' | 'days' }[] = [
  { key: 'teamMaxPerUser', min: 1, max: 100, unit: 'teams' },
  { key: 'teamMaxMembers', min: 1, max: 1000, unit: 'people' },
  { key: 'teamActivityDays', min: 0, max: 3650, unit: 'days' },
]

const { form, loading, loadError, saving, dirty, load, save, reset } = useAdminSettings(
  FIELDS.map(f => f.key),
  { teamMaxPerUser: 3, teamMaxMembers: 50, teamActivityDays: 365 },
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
      error.value = t('settings.limits.outOfRange', { field: t('settings.teams.feature.' + f.key), min: f.min, max: f.max })
      return
    }
  }
  try {
    await save()
    MessagePlugin.success(t('common.saved'))
    emit('saved')
  } catch (err) {
    error.value = apiErrorMessage(err, t('common.operationFailed'))
  }
}
</script>

<style scoped>
@import './section-shared.css';
.how { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; line-height: 1.7; color: var(--text-2); margin: 0 0 6px; max-width: 720px; }
.how :deep(.lc-ic) { flex: none; margin-top: 4px; color: var(--cyan); }
.frow { display: flex; align-items: center; gap: 12px 24px; padding: 16px 0; border-top: 1px solid var(--line); }
.fk { flex: 1 1 auto; min-width: 0; }
.fk label { display: block; font-size: 14px; font-weight: 500; color: var(--text); cursor: default; }
.fk small { display: block; margin-top: 2px; font-size: 12px; line-height: 1.6; color: var(--text-3); }
.fv { flex: none; display: flex; align-items: center; gap: 10px; }
.unit { min-width: 28px; font-size: 13px; color: var(--text-2); }
.err { margin: 0 0 12px; }
.foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding-top: 16px; border-top: 1px solid var(--line); }
.state { flex: 1 1 200px; min-width: 0; font-size: 12px; color: var(--text-3); }
.state.on { color: var(--warn); font-size: 13px; }
@media (max-width: 600px) {
  .frow { flex-wrap: wrap; padding: 14px 0; }
  .fk { flex-basis: 100%; }
  .foot :deep(.lc-btn), .foot .lc-btn { flex: 1 1 auto; }
  .state:not(.on) { display: none; }
}
</style>
