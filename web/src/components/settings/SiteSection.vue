<template>
  <SettingsSection id="site" icon="site" :title="t('account.site.title')" :desc="t('account.site.desc')">
    <div v-if="loading" class="sk" aria-busy="true"><i /><i /></div>
    <div v-else-if="loadError" class="sec-state">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm" @click="load">{{ t('common.retry') }}</button>
    </div>
    <div v-else class="srow">
      <div class="k">
        <b id="site-reg-lbl">{{ t('account.site.registration') }}</b>
        <small>{{ t('account.site.registrationHelp') }}</small>
      </div>
      <div class="v inline">
        <button
          type="button"
          class="lc-switch"
          :class="{ on: open }"
          role="switch"
          :aria-checked="open"
          aria-labelledby="site-reg-lbl"
          :disabled="saving"
          data-testid="site-registration"
          @click="toggle"
        />
        <span>{{ open ? t('account.site.registrationOn') : t('account.site.registrationOff') }}</span>
      </div>
    </div>
  </SettingsSection>
</template>

<script setup lang="ts">
/** 站点（仅所有者）：是否开放注册。开关拨一下就保存。 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { ownerApi, unwrap, apiErrorMessage } from '@/utils/api'
import { useAppStore } from '@/stores/app'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const app = useAppStore()

const open = ref(false)
const loading = ref(true)
const loadError = ref('')
const saving = ref(false)

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    open.value = !!unwrap(await ownerApi.site()).registrationOpen
  } catch (err) {
    loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function toggle() {
  const next = !open.value
  saving.value = true
  try {
    open.value = !!unwrap(await ownerApi.updateSite({ registrationOpen: next })).registrationOpen
    MessagePlugin.success(open.value ? t('account.site.savedOn') : t('account.site.savedOff'))
    // 首页 / 注册页上的入口跟着这个开关走
    void app.loadBootstrap()
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
@import './section-shared.css';
</style>
