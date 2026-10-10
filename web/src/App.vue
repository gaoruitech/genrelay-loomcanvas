<template>
  <!-- TDesign 组件（日期选择、确认弹窗）的内置文案跟随界面语言 -->
  <t-config-provider :global-config="TDESIGN_LOCALES[app.locale]">
    <!-- 连不上服务端 -->
    <div v-if="!app.bootstrap" class="app-center">
      <div class="app-notice lc-glass">
        <LcIcon name="warn" size="xl" class="app-notice-ic" />
        <h1>{{ t('app.bootstrapFailed') }}</h1>
        <p>{{ t('app.bootstrapHint') }}</p>
        <p v-if="app.bootstrapError" class="app-notice-detail">{{ app.bootstrapError }}</p>
        <button class="lc-btn primary" :disabled="retrying" @click="retry">{{ t('common.retry') }}</button>
      </div>
    </div>

    <!-- 落地页 / 登录 / 注册 / 分享只读页 / 引导页 / 设置新密码：自己占满整屏 -->
    <router-view v-else-if="route.meta.public || route.meta.shell === 'none'" />

    <AppShell v-else>
      <router-view />
    </AppShell>
  </t-config-provider>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { loadModels } from '@/utils/canvasModels'
import { TDESIGN_LOCALES } from '@/locales/tdesign'
import AppShell from '@/components/AppShell.vue'
import LcIcon from '@/components/LcIcon.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const app = useAppStore()

const retrying = ref(false)
async function retry() {
  retrying.value = true
  try {
    await app.loadBootstrap()
    if (app.bootstrap) {
      if (app.authed && !app.mustChangePassword) await loadModels().catch(() => undefined)
      // 连不上的时候守卫没做判断，连上以后按当前地址重新走一遍
      await router.replace({ path: route.fullPath, force: true })
    }
  } finally {
    retrying.value = false
  }
}

// 登录状态变了（登录成功、退出、令牌失效被接口打回 401）：
// 模型清单是按账号的要重取；人在需要登录的页面上就送去登录页，并记下回来的地址。
watch(() => app.authed, (authed) => {
  if (authed) {
    // 还在用临时密码时接口只放行改密码，模型清单等改完再取
    if (!app.mustChangePassword) loadModels().catch(() => undefined)
    return
  }
  if (app.leaving) {
    app.leaving = false
    router.replace('/')
    return
  }
  if (app.bootstrap && !route.meta.public) {
    router.replace({ name: 'login', query: { redirect: route.fullPath } })
  }
})

// 账号被要求先改密码（登录时就带着这个标记的由路由守卫处理；这里管的是用着用着被接口打回 403 的）：
// 送去「设置新密码」，改完回到现在这一页。标记清掉以后把按账号的模型清单补上。
watch(() => app.mustChangePassword, (must) => {
  if (!app.authed) return
  if (!must) {
    loadModels().catch(() => undefined)
    return
  }
  if (route.name !== 'change-password') {
    router.replace({ name: 'change-password', query: route.meta.guestOnly ? {} : { redirect: route.fullPath } })
  }
})
</script>

<style scoped>
.app-center {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; padding: 24px;
}
.app-notice { max-width: 440px; padding: 32px; text-align: center; }
.app-notice-ic { color: var(--warn); margin-bottom: 12px; }
.app-notice h1 { font: 600 20px/1.3 var(--f-disp); color: var(--text); margin-bottom: 10px; }
.app-notice p { color: var(--text-2); line-height: 1.7; margin-bottom: 18px; }
.app-notice .app-notice-detail { font-size: 12px; color: var(--err-soft); word-break: break-word; }
</style>
