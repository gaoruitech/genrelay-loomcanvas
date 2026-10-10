<template>
  <SettingsSection id="site" icon="site" :title="t('account.site.title')" :desc="t('account.site.desc')">
    <SettingsCard :title="t('account.site.registration')" :desc="t('account.site.registrationHelp')">
      <template v-if="!loading && !loadError" #aside>
        <span class="state" :class="{ on: open }">{{ open ? t('account.site.registrationOn') : t('account.site.registrationOff') }}</span>
        <button
          type="button"
          class="lc-switch"
          :class="{ on: open }"
          role="switch"
          :aria-checked="open"
          :aria-label="t('account.site.registration')"
          :disabled="saving"
          data-testid="site-registration"
          @click="toggle"
        />
      </template>

      <div v-if="loading" class="sk" aria-busy="true"><i /><i /></div>
      <div v-else-if="loadError" class="sec-state">
        <p class="lc-error-text">{{ loadError }}</p>
        <button class="lc-btn sm" @click="load">{{ t('common.retry') }}</button>
      </div>
      <!-- 两种状态各意味着什么；当前这一种亮着 -->
      <div v-else class="modes">
        <div class="mode" :class="{ on: open }" data-mode="open">
          <b><LcIcon name="users" size="s" />{{ t('account.site.whenOpenTitle') }}<span v-if="open" class="lc-tag ok">{{ t('account.site.now') }}</span></b>
          <p>{{ t('account.site.whenOpen') }}</p>
        </div>
        <div class="mode" :class="{ on: !open }" data-mode="closed">
          <b><LcIcon name="lock" size="s" />{{ t('account.site.whenClosedTitle') }}<span v-if="!open" class="lc-tag ok">{{ t('account.site.now') }}</span></b>
          <p>{{ t('account.site.whenClosed') }}</p>
        </div>
      </div>
      <template v-if="!loading && !loadError" #foot>
        <p class="lc-help foot-note">
          {{ t('account.site.usersHint') }}
          <router-link :to="{ name: 'settings', params: { section: 'users' } }">{{ t('settings.nav.users') }}</router-link>
        </p>
      </template>
    </SettingsCard>
  </SettingsSection>
</template>

<script setup lang="ts">
/** 站点（仅超级管理员）：是否开放注册。开关拨一下就保存，没有单独的「保存」。 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { ownerApi, unwrap, apiErrorMessage } from '@/utils/api'
import { useAppStore } from '@/stores/app'
import LcIcon from '@/components/LcIcon.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsCard from './SettingsCard.vue'

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
.state { font-size: 13px; color: var(--text-3); white-space: nowrap; }
.state.on { color: var(--ok); }
.modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.mode { padding: 14px 16px; border-radius: 12px; border: 1px solid var(--line); background: rgba(4, 9, 28, .25); transition: border-color .15s, background .15s; }
.mode.on { opacity: 1; border-color: var(--line-3); background: rgba(63, 216, 255, .05); }
.mode b { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-height: 22px; font-weight: 600; font-size: 14px; color: var(--text-2); }
.mode.on b { color: var(--text); }
.mode b .lc-tag { font-weight: 400; margin-left: auto; }
.mode.on b :deep(.lc-ic) { color: var(--cyan); }
.mode p { margin-top: 6px; font-size: 13px; line-height: 1.7; color: var(--text-2); }
.foot-note a { color: var(--cyan-soft); margin-left: 4px; }
@media (max-width: 600px) { .modes { grid-template-columns: minmax(0, 1fr); } }
</style>
