<template>
  <div class="lc-page">
    <div class="lc-page-inner tm">
      <div class="lc-page-head">
        <div class="tm-head">
          <h1 class="lc-ph1">{{ t('team.title') }}</h1>
          <p class="lc-ph-sub">{{ space.name }} · {{ t(tabs.length > 2 ? 'team.sub.manager' : 'team.sub.member') }}</p>
        </div>
      </div>

      <nav class="tm-tabs" :aria-label="t('team.tabsLabel')">
        <router-link
          v-for="tab in tabs"
          :key="tab.id"
          class="tm-tab"
          :class="{ on: tab.id === current }"
          :to="{ name: 'team', params: { tab: tab.id } }"
          :aria-current="tab.id === current ? 'page' : undefined"
          :data-tab="tab.id"
        >
          <LcIcon :name="tab.icon" size="s" />{{ t('team.tabs.' + tab.id) }}
        </router-link>
      </nav>

      <div v-if="loadError" class="lc-alert tm-error" role="alert">
        <LcIcon name="warn" />
        <span>{{ loadError }}</span>
        <button class="lc-btn sm" type="button" @click="load">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="!detail" class="tm-sk" aria-busy="true"><i /><i /><i /></div>
      <component :is="TAB_VIEWS[current]" v-else :key="tabKey" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 「团队」页：成员 / 用量 / 动态 / 团队设置四个页签。
 * 哪些页签看得到由 components/team/tabs.ts 按权限定；团队详情在这里取一次，交给页签共用。
 */
import { computed, defineAsyncComponent, onMounted, ref, watch, type Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useSpaceStore } from '@/stores/space'
import { teamApi, unwrap, apiErrorCode, apiErrorMessage, SPACE_GONE_CODES } from '@/utils/api'
import { MessagePlugin } from '@/utils/feedback'
import LcIcon from '@/components/LcIcon.vue'
import { teamTabs, resolveTeamTab, type TeamTabId } from '@/components/team/tabs'
import { provideTeamPage } from '@/components/team/context'
import type { TeamDetail } from '@/types'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const space = useSpaceStore()

const TAB_VIEWS: Record<TeamTabId, Component> = {
  members: defineAsyncComponent(() => import('@/components/team/MembersTab.vue')),
  usage: defineAsyncComponent(() => import('@/components/team/UsageTab.vue')),
  activity: defineAsyncComponent(() => import('@/components/team/ActivityTab.vue')),
  settings: defineAsyncComponent(() => import('@/components/team/SettingsTab.vue')),
}

const teamId = space.currentId
const tabs = computed(() => teamTabs(space))
const current = computed<TeamTabId>(() => resolveTeamTab(space, route.params.tab))

// 开着页面时角色变了（被取消管理员、转让了团长）：地址上那个页签可能已经看不到了，落到看得到的第一个
watch([current, () => route.params.tab], ([tab, asked]) => {
  if (route.name === 'team' && space.isTeam && space.currentId === teamId && asked !== tab) router.replace({ name: 'team', params: { tab } })
})

/** 角色或「能不能看全队」变了，页签整个重来：名单、用量都要按新的身份重读 */
const tabKey = computed(() => `${current.value}:${space.role}:${space.can('usage:view_all')}`)

const detail = ref<TeamDetail | null>(null)
const loadError = ref('')
const gone = (err: unknown) => (SPACE_GONE_CODES as readonly string[]).includes(apiErrorCode(err))

async function load() {
  loadError.value = ''
  try {
    detail.value = unwrap(await teamApi.detail(teamId))
  } catch (err) {
    // 团队没了由外壳统一处理（送回个人空间并说明原因）
    if (!gone(err) && !detail.value) loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  }
}
onMounted(load)

/** 服务端那句话不够用、这里换成自己说法的错误码 */
const OWN_WORDS = [
  'team.confirm_mismatch', 'team.member_not_found', 'team.new_owner_unusable', 'team.owner_cannot_leave',
  'team.owner_role_fixed', 'team.use_leave', 'team.changed', 'team.forbidden',
]

function explain(err: unknown, fallback?: string): string {
  const code = apiErrorCode(err)
  if (gone(err)) return ''
  // 角色在页面开着的时候变了：重取权限，页签和按钮跟着变
  if (code === 'team.forbidden') {
    // 出错的那块界面（弹窗、邀请链接）可能随着权限一起消失，这句话单独弹出来
    MessagePlugin.warning(t('team.errors.forbidden'), 6000)
    void space.refresh().then(load)
    return t('team.errors.forbidden')
  }
  if (code === 'team.changed') void load()
  if (OWN_WORDS.includes(code)) return t('team.errors.' + code.slice(5))
  return apiErrorMessage(err, fallback || t('common.operationFailed'))
}

provideTeamPage({
  teamId,
  detail,
  reload: load,
  explain,
  fail: (err, fallback) => {
    const msg = explain(err, fallback)
    // team.forbidden 那一句 explain 已经弹过了
    if (msg && apiErrorCode(err) !== 'team.forbidden') MessagePlugin.error(msg)
  },
})
</script>

<style scoped>
.tm-head { min-width: 0; }
.tm-tabs {
  display: flex; gap: 4px; margin: 24px 0 20px; border-bottom: 1px solid var(--line);
  overflow-x: auto; scrollbar-width: none;
}
.tm-tabs::-webkit-scrollbar { display: none; }
.tm-tab {
  flex: none; display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 16px;
  color: var(--text-2); font-size: 14px; text-decoration: none; white-space: nowrap;
  border-bottom: 2px solid transparent; border-radius: 8px 8px 0 0;
  transition: color .15s, border-color .15s;
}
.tm-tab:hover { color: var(--text); text-decoration: none; }
.tm-tab:focus-visible { outline: 2px solid var(--cyan); outline-offset: -2px; }
.tm-tab.on { color: var(--text); font-weight: 600; border-bottom-color: var(--cyan); }
.tm-error { align-items: center; }
.tm-error span { flex: 1; min-width: 0; }
.tm-sk { display: grid; gap: 14px; padding: 8px 0; }
.tm-sk i { display: block; height: 16px; border-radius: 6px; background: rgb(var(--c-film) / .1); animation: lc-pulse 1.6s ease-in-out infinite; }
.tm-sk i:nth-child(1) { width: 38%; } .tm-sk i:nth-child(2) { width: 64%; } .tm-sk i:nth-child(3) { width: 52%; }
@media (max-width: 600px) {
  .tm-tabs { margin: 16px -16px; padding: 0 16px; }
  .tm-tab { padding: 0 12px; }
}
</style>
