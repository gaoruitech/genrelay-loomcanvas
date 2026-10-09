<template>
  <!-- 连不上服务端 -->
  <div v-if="!app.bootstrap" class="app-center">
    <div class="app-notice">
      <h1>{{ t('app.bootstrapFailed') }}</h1>
      <p>{{ t('app.bootstrapHint') }}</p>
      <p v-if="app.bootstrapError" class="app-notice-detail">{{ app.bootstrapError }}</p>
      <button class="lc-btn primary" :disabled="retrying" @click="retry">{{ t('common.retry') }}</button>
    </div>
  </div>

  <!-- 分享只读页：任何人都能看，不需要口令 -->
  <router-view v-else-if="route.meta.public" />

  <PasswordScreen v-else-if="!app.authed" />

  <div v-else class="app-shell">
    <AppTopBar v-if="!route.meta.bare && !app.immersive" />
    <main class="app-main">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { loadModels } from '@/utils/canvasModels'
import { ensureSetup } from '@/router'
import AppTopBar from '@/components/AppTopBar.vue'
import PasswordScreen from '@/components/PasswordScreen.vue'

const { t } = useI18n()
const route = useRoute()
const app = useAppStore()

const retrying = ref(false)
async function retry() {
  retrying.value = true
  try {
    await app.loadBootstrap()
    if (app.bootstrap && app.authed) {
      await loadModels().catch(() => undefined)
      ensureSetup()
    }
  } finally {
    retrying.value = false
  }
}
</script>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}
/* 页面各自管自己的滚动：画布编辑页要占满且不滚，列表 / 设置页自己 overflow-y:auto */
.app-main {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.app-center {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 24px;
}
.app-notice { max-width: 420px; text-align: center; }
.app-notice h1 { font-size: 20px; color: var(--t-max); margin-bottom: 10px; }
.app-notice p { color: var(--t-dim); line-height: 1.6; margin-bottom: 18px; }
.app-notice .app-notice-detail { font-size: 12px; color: var(--danger); word-break: break-word; }
</style>
