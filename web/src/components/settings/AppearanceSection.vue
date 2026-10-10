<template>
  <SettingsSection id="appearance" icon="eye" :title="t('settings.appearance.title')" :desc="app.isOwner ? t('settings.appearance.descOwner') : t('settings.appearance.desc')">
    <!-- 每个人自己的：只存在这台浏览器里 -->
    <div class="srow">
      <div class="k">
        <b id="ap-lang-lbl">{{ t('settings.appearance.language') }}</b>
        <small>{{ t('settings.appearance.languageHelp') }}</small>
      </div>
      <div class="v lang">
        <LcIcon name="globe" />
        <LcSelect
          :model-value="app.locale"
          :options="LOCALE_OPTIONS"
          aria-labelledby="ap-lang-lbl"
          data-testid="appearance-language"
          @update:model-value="app.setLocale($event)"
        />
      </div>
    </div>

    <!-- 所有者：这台实例的默认值 -->
    <template v-if="app.isOwner">
      <div v-if="loading" class="sk" aria-busy="true"><i /><i /><i /></div>
      <div v-else-if="loadError" class="sec-state">
        <p class="lc-error-text">{{ loadError }}</p>
        <button class="lc-btn sm" @click="load">{{ t('common.retry') }}</button>
      </div>

      <form v-else @submit.prevent="submit">
        <div class="srow">
          <div class="k">
            <b><label for="ap-name">{{ t('settings.appearance.siteName') }}</label></b>
            <small>{{ t('settings.appearance.siteNameHelp') }}</small>
          </div>
          <div class="v narrow">
            <input id="ap-name" v-model.trim="form.siteName" class="lc-input" maxlength="40" placeholder="LoomCanvas" :disabled="saving" />
          </div>
        </div>

        <div class="srow">
          <div class="k">
            <b><label for="ap-logo">{{ t('settings.appearance.logo') }}</label></b>
            <small>{{ t('settings.appearance.logoHelp') }}</small>
          </div>
          <div class="v logo-row">
            <span class="logo-preview">
              <img v-if="form.logoUrl" :src="form.logoUrl" alt="" />
              <LcIcon v-else name="image" />
            </span>
            <input id="ap-logo" v-model.trim="form.logoUrl" class="lc-input" :placeholder="t('settings.appearance.logoPlaceholder')" :disabled="saving" />
            <button type="button" class="lc-btn" :disabled="saving || uploading" @click="fileRef?.click()">
              <LcIcon name="upload" size="s" />{{ uploading ? t('common.uploading') : t('common.upload') }}
            </button>
            <input ref="fileRef" type="file" accept="image/*" hidden @change="onFile" />
          </div>
        </div>

        <div class="srow">
          <div class="k">
            <b id="ap-locale-lbl">{{ t('settings.appearance.defaultLocale') }}</b>
            <small>{{ t('settings.appearance.defaultsHelp') }}</small>
          </div>
          <div class="v lang">
            <LcIcon name="globe" />
            <LcSelect v-model="form.defaultLocale" :options="LOCALE_OPTIONS" :disabled="saving" aria-labelledby="ap-locale-lbl" />
          </div>
        </div>

        <p v-if="error" class="lc-error-text sec-err" role="alert">{{ error }}</p>
        <div class="sec-foot">
          <button class="lc-btn primary quiet" type="submit" :disabled="saving" data-testid="appearance-save">
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </form>
    </template>
  </SettingsSection>
</template>

<script setup lang="ts">
/**
 * 外观：界面语言（每个人自己的，存在浏览器里），以及所有者才能改的实例默认值（站点名称、Logo、默认语言）。
 * 界面只有一套霓虹深色主题，所以这里没有主题选项；服务端已经没有「默认主题」这个设置项。
 */
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { apiErrorMessage } from '@/utils/api'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import { useAdminSettings } from '@/composables/useAdminSettings'
import { useAppStore } from '@/stores/app'
import { LOCALE_OPTIONS } from '@/locales'
import LcSelect from '@/components/LcSelect.vue'
import LcIcon from '@/components/LcIcon.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const app = useAppStore()

const { form, loading, loadError, saving, load, save } = useAdminSettings(
  ['siteName', 'logoUrl', 'defaultLocale'] as const,
  { siteName: '', logoUrl: '', defaultLocale: 'zh-CN' },
)
// 实例设置只有所有者能读（其他人 403），不是所有者就不去取
onMounted(() => { if (app.isOwner) void load() })

const error = ref('')
const uploading = ref(false)
const fileRef = ref<HTMLInputElement | null>(null)

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    form.value.logoUrl = await uploadCanvasImage(file)
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.uploadFailed')))
  } finally {
    uploading.value = false
  }
}

async function submit() {
  error.value = ''
  try {
    await save()
    // 站点名称 / Logo 在顶栏上，存完立刻刷新启动信息
    await app.loadBootstrap()
    MessagePlugin.success(t('common.saved'))
  } catch (err) {
    error.value = apiErrorMessage(err, t('common.operationFailed'))
  }
}
</script>

<style scoped>
@import './section-shared.css';
.lang { position: relative; max-width: 220px; }
.lang > .lc-ic { position: absolute; left: 12px; top: 11px; color: var(--text-3); pointer-events: none; z-index: 1; }
.lang :deep(.lcs-trigger) { padding-left: 38px; }
.logo-row { display: flex; align-items: center; gap: 10px; }
.logo-row .lc-input { flex: 1; min-width: 0; }
.logo-preview {
  flex: none; display: grid; place-items: center; width: 40px; height: 40px; color: var(--text-3);
  border-radius: var(--r-sm); border: 1px dashed var(--line-3); background: var(--well); overflow: hidden;
}
.logo-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
form > .srow:last-of-type { margin-bottom: 0; }
.sec-foot { margin-top: 0; }
@media (max-width: 900px) { .lang { max-width: 320px; } }
@media (max-width: 600px) {
  .lang { max-width: none; }
  .logo-row { flex-wrap: wrap; }
  .logo-row .lc-input { flex: 1 1 60%; }
}
</style>
