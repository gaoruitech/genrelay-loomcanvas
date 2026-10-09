<template>
  <header class="topbar">
    <router-link to="/" class="brand">
      <img v-if="app.logoUrl" :src="app.logoUrl" class="brand-logo" alt="" />
      <span v-else class="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" /><path d="M9 4v16M15 4v16" opacity=".55" />
        </svg>
      </span>
      <span class="brand-name">{{ app.siteName }}</span>
    </router-link>

    <nav class="nav">
      <router-link to="/" class="nav-link" :class="{ active: route.name === 'canvas-list' || route.name === 'canvas' }">
        {{ t('app.navCanvases') }}
      </router-link>
      <router-link to="/settings" class="nav-link" :class="{ active: route.name === 'settings' }">
        {{ t('app.navSettings') }}
      </router-link>
    </nav>

    <div class="tools">
      <select
        class="lang"
        :value="app.locale"
        :title="t('app.language')"
        :aria-label="t('app.language')"
        @change="onLocale"
      >
        <option v-for="l in SUPPORTED_LOCALES" :key="l.code" :value="l.code">{{ l.label }}</option>
      </select>

      <button class="icon-btn" :title="themeTitle" :aria-label="themeTitle" @click="app.toggleTheme()">
        <svg v-if="app.resolvedTheme === 'dark'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </button>

      <button v-if="app.authRequired" class="icon-btn" :title="t('app.logout')" :aria-label="t('app.logout')" @click="app.logout()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { SUPPORTED_LOCALES } from '@/locales'
import type { LocaleCode } from '@/types'

const { t } = useI18n()
const route = useRoute()
const app = useAppStore()

const themeTitle = computed(() =>
  app.resolvedTheme === 'dark' ? t('app.themeToLight') : t('app.themeToDark'))

function onLocale(e: Event) {
  app.setLocale((e.target as HTMLSelectElement).value as LocaleCode)
}
</script>

<style scoped>
.topbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 24px;
  height: 52px;
  padding: 0 18px;
  background: var(--n-1);
  border-bottom: 1px solid var(--n-5);
}
.brand {
  display: inline-flex; align-items: center; gap: 9px;
  color: var(--t-max); font-weight: 700; font-size: 15px; letter-spacing: -.2px;
}
.brand:hover { text-decoration: none; }
.brand-logo { height: 24px; max-width: 120px; object-fit: contain; }
.brand-mark {
  display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px;
  background: var(--btn-bg); color: var(--btn-fg);
}
.brand-mark svg { width: 15px; height: 15px; }
.nav { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; }
.nav-link {
  padding: 6px 12px; border-radius: 8px; font-size: 13.5px; color: var(--t-dim);
  transition: background .15s ease, color .15s ease;
}
.nav-link:hover { background: var(--n-3); color: var(--t-max); text-decoration: none; }
.nav-link.active { background: var(--accent-dim); color: var(--accent-text); }
.tools { display: flex; align-items: center; gap: 6px; }
.lang {
  height: 30px; padding: 0 8px; border-radius: 8px;
  background: transparent; color: var(--t-body); border: 1px solid var(--n-5);
  font: inherit; font-size: 12.5px; cursor: pointer; outline: none;
}
.lang:hover { border-color: var(--n-8); }
.lang option { background: var(--n-2); color: var(--t-body); }
.icon-btn {
  display: grid; place-items: center; width: 30px; height: 30px;
  border: 0; border-radius: 8px; background: transparent; color: var(--t-dim); cursor: pointer;
}
.icon-btn:hover { background: var(--n-4); color: var(--t-max); }
.icon-btn svg { width: 17px; height: 17px; }

@media (max-width: 560px) {
  .topbar { gap: 10px; padding: 0 10px; }
  .brand-name { display: none; }
}
</style>
