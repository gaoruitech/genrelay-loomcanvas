<template>
  <div class="settings-page">
    <div class="settings-inner">
      <h1 class="page-title">{{ t('settings.title') }}</h1>

      <div class="tabs" role="tablist">
        <button
          v-for="tab in TABS"
          :key="tab"
          class="tab"
          :class="{ active: active === tab }"
          role="tab"
          :aria-selected="active === tab"
          @click="select(tab)"
        >{{ t('settings.tabs.' + tab) }}</button>
      </div>

      <ProvidersTab v-if="active === 'providers'" />
      <ModelsTab v-else-if="active === 'models'" />
      <LimitsTab v-else-if="active === 'limits'" />
      <AppearanceTab v-else-if="active === 'appearance'" />
      <UsageTab v-else />

      <p v-if="app.bootstrap?.version" class="version">LoomCanvas {{ app.bootstrap.version }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import ProvidersTab from '@/components/settings/ProvidersTab.vue'
import ModelsTab from '@/components/settings/ModelsTab.vue'
import LimitsTab from '@/components/settings/LimitsTab.vue'
import AppearanceTab from '@/components/settings/AppearanceTab.vue'
import UsageTab from '@/components/settings/UsageTab.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const app = useAppStore()

const TABS = ['providers', 'models', 'limits', 'appearance', 'usage'] as const
type TabKey = typeof TABS[number]

// 当前标签页放在 ?tab= 里：刷新不丢，也能从别处直接链到某一页
const active = computed<TabKey>(() => {
  const q = String(route.query.tab || '')
  return (TABS as readonly string[]).includes(q) ? (q as TabKey) : 'providers'
})

function select(tab: TabKey) {
  if (tab !== active.value) router.replace({ query: { ...route.query, tab } })
}
</script>

<style scoped>
.settings-page { height: 100%; overflow-y: auto; }
.settings-inner { max-width: 1040px; margin: 0 auto; padding: 28px 24px 60px; }
.page-title { font-size: 22px; font-weight: 700; color: var(--t-max); margin-bottom: 18px; }
.tabs {
  display: flex; gap: 4px; margin-bottom: 24px; padding-bottom: 0;
  border-bottom: 1px solid var(--n-5); overflow-x: auto;
}
.tab {
  position: relative; padding: 10px 14px; border: 0; background: transparent;
  color: var(--t-dim); font: inherit; font-size: 13.5px; white-space: nowrap; cursor: pointer;
}
.tab:hover { color: var(--t-max); }
.tab.active { color: var(--accent-text); font-weight: 600; }
.tab.active::after {
  content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 2px;
  background: var(--accent-text); border-radius: 2px;
}
.version { margin-top: 36px; font-size: 12px; color: var(--t-dim); }
</style>
