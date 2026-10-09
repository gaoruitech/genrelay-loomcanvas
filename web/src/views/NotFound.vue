<template>
  <div class="nf">
    <h1>{{ t('app.notFound') }}</h1>
    <router-link to="/" class="lc-btn">{{ t('app.backHome') }}</router-link>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<style scoped>
.nf {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
  height: 100%;
}
h1 { font-size: 18px; color: var(--t-max); }
.nf a:hover { text-decoration: none; }
</style>
