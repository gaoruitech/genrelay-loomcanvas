<template>
  <div class="pw-page">
    <form class="pw-card lc-card" @submit.prevent="submit">
      <div class="pw-brand">{{ app.siteName }}</div>
      <h1>{{ t('auth.title') }}</h1>
      <p class="pw-sub">{{ t('auth.subtitle') }}</p>

      <div class="lc-field">
        <label for="pw-input">{{ t('auth.password') }}</label>
        <input
          id="pw-input"
          ref="inputRef"
          v-model="password"
          class="lc-input"
          type="password"
          autocomplete="current-password"
          :disabled="busy"
        />
        <span v-if="error" class="lc-error-text">{{ error }}</span>
      </div>

      <button class="lc-btn primary pw-submit" type="submit" :disabled="busy">
        {{ busy ? t('auth.submitting') : t('auth.submit') }}
      </button>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { loadModels } from '@/utils/canvasModels'
import { ensureSetup } from '@/router'

const { t } = useI18n()
const app = useAppStore()

const password = ref('')
const busy = ref(false)
const error = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

onMounted(() => inputRef.value?.focus())

async function submit() {
  if (!password.value) {
    error.value = t('auth.required')
    return
  }
  busy.value = true
  error.value = ''
  try {
    await app.login(password.value)
    await loadModels().catch(() => undefined)
    ensureSetup()
  } catch (err: any) {
    const status = err?.response?.status
    error.value = status === 401 || status === 403
      ? t('auth.wrong')
      : (err?.response?.data?.message || err?.message || t('common.networkError'))
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.pw-page {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; padding: 24px;
}
.pw-card { width: 360px; max-width: 100%; padding: 28px; }
.pw-brand { font-size: 13px; font-weight: 700; color: var(--accent-text); margin-bottom: 14px; }
h1 { font-size: 18px; color: var(--t-max); margin-bottom: 6px; }
.pw-sub { color: var(--t-dim); font-size: 13px; margin-bottom: 22px; }
.pw-submit { width: 100%; height: 38px; }
</style>
