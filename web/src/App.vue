<template>
  <!-- TDesign 组件（日期选择、确认弹窗）的内置文案跟随界面语言 -->
  <t-config-provider :global-config="tdConfig">
    <!-- 连不上服务端：没有账号可依，语言和主题只记在这台浏览器上 -->
    <BarePage v-if="!app.bootstrap">
      <div class="app-notice lc-glass" role="alert" data-testid="app-unreachable">
        <LcIcon name="warn" size="xl" class="app-notice-ic" />
        <h1>{{ t('app.bootstrapFailed') }}</h1>
        <p>{{ t('app.bootstrapHint') }}</p>
        <p v-if="app.bootstrapError" class="app-notice-detail">{{ app.bootstrapError }}</p>
        <button class="lc-btn primary" :disabled="retrying" data-testid="app-retry" @click="retry">{{ t('common.retry') }}</button>
      </div>
    </BarePage>

    <!-- 第一次导航还没走完（路由还是空的，不知道这一页有没有外壳）：接着显示启动时的那个转圈（index.html 里的同一个位置、同一个样子）。
         不这样的话，落地页 / 登录页 / 404 这些没有外壳的页面会先画一帧登录后的外壳。 -->
    <div v-else-if="!route.matched.length" class="app-boot" role="status" :aria-label="t('common.loading')" data-testid="app-boot"><i /></div>

    <!-- 落地页 / 登录 / 注册 / 分享只读页 / 引导页 / 设置新密码：自己占满整屏 -->
    <!-- 集成方不要外壳（shell: 'none'）：每一页都只出内容，导航由宿主页面提供 -->
    <router-view v-else-if="route.meta.public || route.meta.shell === 'none' || embed.shell === 'none'" />

    <!-- 外壳里的页面以空间为 key：换空间时整页重建，上一个空间的任何状态都带不过来。
         正在换的那一小段时间里不放页面（旧页面已经拆了，新空间的启动信息还没回来）。 -->
    <AppShell v-else>
      <div v-if="space.switching" class="app-switching" role="status" aria-live="polite"><span class="lc-ring sm spin"><i /></span></div>
      <router-view v-else :key="space.epoch" />
    </AppShell>

    <!-- 被送回个人空间的原因（被移出团队、团队被解散或停用） -->
    <SpaceNoticeDialog v-if="app.bootstrap && app.authed" />
  </t-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useSpaceStore } from '@/stores/space'
import { loadModels } from '@/utils/canvasModels'
import { TDESIGN_LOCALES } from '@/locales/tdesign'
import AppShell from '@/components/AppShell.vue'
import SpaceNoticeDialog from '@/components/space/SpaceNoticeDialog.vue'
import LcIcon from '@/components/LcIcon.vue'
import BarePage from '@/components/auth/BarePage.vue'
import { useEmbed } from '@/embed/context'
import { pageOfRoute } from '@/embed/options'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const app = useAppStore()
const space = useSpaceStore()
const embed = useEmbed()

// 用着用着，当前这个团队对我不存在了（被移出、团队被解散或停用）：回个人空间的首页。
// 原因由 SpaceNoticeDialog 说；守卫看到 ?space=personal 会把空间换回来并去掉这个记号。
watch(() => space.dropTick, () => {
  if (route.meta.public) return
  void router.replace({ name: 'home', query: { space: 'personal' } })
})

// 嵌进别人的页面时，TDesign 的弹层（日期选择的日历等）也得挂在本产品自己的根元素里面
const tdConfig = computed(() => (
  embed.embedded && embed.portal !== 'body'
    ? { ...TDESIGN_LOCALES[app.locale], attach: () => embed.portal as HTMLElement }
    : TDESIGN_LOCALES[app.locale]
))

// 每次导航之后告诉宿主（embed/app.ts 把它接到 route 事件和 onNavigate 上）；独立应用里是个空函数
function announceRoute(to: typeof route) {
  const params: Record<string, string> = {}
  for (const [k, v] of Object.entries(to.params)) params[k] = Array.isArray(v) ? v.join('/') : String(v ?? '')
  embed.emit('route', { name: pageOfRoute(to.name) || String(to.name || ''), path: to.fullPath, params })
}
router.afterEach((to, _from, failure) => {
  // 登录时拿在手里的账号主题：和新页面同一帧上色（见 stores/app.ts 的 applyHeldTheme）。导航没成也要放下来
  app.applyHeldTheme()
  if (!failure) announceRoute(to as typeof route)
})
// 不碰地址栏的那种路由（memory）在挂载之前就走完了第一次导航，上面那个钩子赶不上
onMounted(() => { if (route.matched.length) announceRoute(route) })

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
  // 宿主管登录：没有「去登录页」这回事（401 交给宿主的 onAuthRequired）
  if (embed.hostAuth) return
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
.app-notice { width: 440px; max-width: 100%; padding: 32px; text-align: center; }
.app-notice-ic { color: var(--warn); margin-bottom: 12px; }
.app-notice h1 { font: 600 20px/1.3 var(--f-disp); color: var(--text); margin-bottom: 10px; }
.app-notice p { color: var(--text-2); line-height: 1.7; margin-bottom: 18px; }
.app-notice .app-notice-detail { font-size: 12px; color: var(--err-soft); word-break: break-word; }
.app-switching { width: 100%; height: 100%; display: grid; place-items: center; }
/* 和 index.html 里样式表到之前的那一屏是同一个转圈（28px、居中），换过来看不出接缝；颜色在这里已经读得到令牌了 */
.app-boot { width: 100%; height: 100%; display: grid; place-items: center; }
.app-boot i {
  width: 28px; height: 28px; border-radius: 50%; border: 3px solid rgb(var(--c-film) / .2); border-top-color: var(--cyan);
  animation: spin .8s linear infinite;
}
@media (prefers-reduced-motion: reduce) { .app-boot i { animation-duration: 2.4s; } }
</style>
