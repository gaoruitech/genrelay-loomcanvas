<template>
  <nav class="at" :aria-label="t('assetsPage.title')">
    <router-link :to="{ name: 'assets' }" class="at-tab" :class="{ on: current === 'assets' }" :aria-current="current === 'assets' ? 'page' : undefined" data-tab="assets">
      <LcIcon name="assets" size="s" />{{ t('brandKit.page.tabAssets') }}
    </router-link>
    <router-link :to="{ name: 'brand-kits' }" class="at-tab" :class="{ on: current === 'brand-kits' }" :aria-current="current === 'brand-kits' ? 'page' : undefined" data-tab="brand-kits">
      <LcIcon name="star" size="s" />{{ t('brandKit.page.tabKits') }}
    </router-link>
  </nav>
</template>

<script setup lang="ts">
/** 素材库页头下面的两个页签：素材（上传和存下来的图片 / 视频）与品牌包。各有自己的地址。 */
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'

defineProps<{ current: 'assets' | 'brand-kits' }>()
const { t } = useI18n()
</script>

<style scoped>
.at { display: flex; gap: 4px; margin-top: 20px; border-bottom: 1px solid var(--line); }
.at-tab {
  position: relative; display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 14px;
  color: var(--text-2); font-size: 14px; text-decoration: none; border-radius: 8px 8px 0 0;
  transition: color .15s, background .15s;
}
.at-tab:hover { color: var(--text); background: rgba(124, 160, 255, .08); text-decoration: none; }
.at-tab:focus-visible { outline: none; box-shadow: var(--ring); }
.at-tab.on { color: var(--text); font-weight: 600; }
.at-tab.on :deep(svg) { color: var(--cyan); }
.at-tab.on::after {
  content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px; border-radius: 2px;
  background: var(--cyan); box-shadow: 0 0 8px rgba(63, 216, 255, .6);
}
</style>
