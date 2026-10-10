<template>
  <div class="nf">
    <span class="code lc-gt">404</span>
    <h1>{{ t('app.notFound') }}</h1>
    <router-link :to="app.authed ? '/app' : '/'" class="lc-btn">{{ app.authed ? t('app.backWorkbench') : t('app.backHome') }}</router-link>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'

const { t } = useI18n()
const app = useAppStore()
</script>

<style scoped>
.nf { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; height: 100%; padding: 24px; text-align: center; }
.code { font: 700 72px/1 var(--f-disp); }
h1 { font: 600 20px/1.3 var(--f-disp); color: var(--text); }
</style>
