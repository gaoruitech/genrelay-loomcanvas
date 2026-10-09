<template>
  <section>
    <div class="tab-head">
      <div>
        <h2>{{ t('settings.appearance.title') }}</h2>
        <p class="tab-desc">{{ t('settings.appearance.desc') }}</p>
      </div>
    </div>

    <div v-if="loading" class="lc-empty">{{ t('common.loading') }}</div>
    <div v-else-if="loadError" class="lc-empty">
      <p class="lc-error-text">{{ loadError }}</p>
      <button class="lc-btn sm retry" @click="load">{{ t('common.retry') }}</button>
    </div>

    <form v-else class="lc-card" @submit.prevent="submit">
      <div class="lc-field">
        <label for="ap-name">{{ t('settings.appearance.siteName') }}</label>
        <input id="ap-name" v-model.trim="form.siteName" class="lc-input narrow" maxlength="40" placeholder="LoomCanvas" :disabled="saving" />
      </div>

      <div class="lc-field">
        <label for="ap-logo">{{ t('settings.appearance.logo') }}</label>
        <div class="logo-row">
          <span class="logo-preview">
            <img v-if="form.logoUrl" :src="form.logoUrl" alt="" />
          </span>
          <input id="ap-logo" v-model.trim="form.logoUrl" class="lc-input" :placeholder="t('settings.appearance.logoPlaceholder')" :disabled="saving" />
          <button type="button" class="lc-btn" :disabled="saving || uploading" @click="fileRef?.click()">
            {{ uploading ? t('common.uploading') : t('common.upload') }}
          </button>
          <input ref="fileRef" type="file" accept="image/*" hidden @change="onFile" />
        </div>
        <span class="lc-help">{{ t('settings.appearance.logoHelp') }}</span>
      </div>

      <div class="form-grid">
        <div class="lc-field">
          <label for="ap-theme">{{ t('settings.appearance.defaultTheme') }}</label>
          <LcSelect id="ap-theme" v-model="form.defaultTheme" :options="themeOptions" :disabled="saving" />
        </div>
        <div class="lc-field">
          <label for="ap-locale">{{ t('settings.appearance.defaultLocale') }}</label>
          <LcSelect id="ap-locale" v-model="form.defaultLocale" :options="LOCALE_OPTIONS" :disabled="saving" />
        </div>
      </div>
      <p class="lc-help">{{ t('settings.appearance.defaultsHelp') }}</p>

      <p v-if="error" class="lc-error-text err">{{ error }}</p>
      <div class="tab-foot">
        <button class="lc-btn primary" type="submit" :disabled="saving">
          {{ saving ? t('common.saving') : t('common.save') }}
        </button>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { apiErrorMessage } from '@/utils/api'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import { useAdminSettings } from '@/composables/useAdminSettings'
import { useAppStore } from '@/stores/app'
import { LOCALE_OPTIONS } from '@/locales'
import LcSelect from '@/components/LcSelect.vue'

const { t } = useI18n()
const app = useAppStore()

const { form, loading, loadError, saving, load, save } = useAdminSettings(
  ['siteName', 'logoUrl', 'defaultTheme', 'defaultLocale'] as const,
  { siteName: '', logoUrl: '', defaultTheme: 'dark', defaultLocale: 'zh-CN' },
)
onMounted(load)

const themeOptions = computed(() => [
  { value: 'dark', label: t('settings.appearance.themeDark') },
  { value: 'light', label: t('settings.appearance.themeLight') },
  { value: 'system', label: t('settings.appearance.themeSystem') },
])

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
@import './tab-shared.css';
.narrow { max-width: 360px; }
.logo-row { display: flex; align-items: center; gap: 10px; }
.logo-preview {
  flex: none; display: grid; place-items: center; width: 36px; height: 36px;
  border-radius: 8px; border: 1px dashed var(--n-7); background: var(--n-3); overflow: hidden;
}
.logo-preview img { max-width: 100%; max-height: 100%; object-fit: contain; }
.err { margin-top: 12px; }
.retry { margin-top: 12px; }
</style>
