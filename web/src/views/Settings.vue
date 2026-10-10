<template>
  <div ref="pageEl" class="lc-page">
    <div class="lc-page-inner">
      <div class="lc-page-head">
        <div class="lc-sp">
          <h1 class="lc-ph1">{{ t('settings.title') }}</h1>
          <p class="lc-ph-sub">{{ app.isOwner ? t('settings.subOwner') : t('settings.sub') }}</p>
        </div>
      </div>

      <div class="set">
        <nav ref="navEl" class="set-nav" :aria-label="t('settings.navLabel')">
          <div v-for="g in groups" :key="g.id" class="grp" role="group" :aria-labelledby="'set-grp-' + g.id">
            <p :id="'set-grp-' + g.id" class="grp-h">
              {{ t('settings.group.' + g.id) }}
              <span v-if="g.owner" class="only">{{ t('shell.roleOwner') }}</span>
            </p>
            <router-link
              v-for="s in g.items"
              :key="s.id"
              :to="{ name: 'settings', params: { section: s.id } }"
              class="item"
              :class="{ on: current === s.id }"
              :aria-current="current === s.id ? 'page' : undefined"
              :data-nav="s.id"
            ><LcIcon :name="s.icon" />{{ t('settings.nav.' + s.id) }}</router-link>
          </div>
        </nav>

        <div class="set-main" :class="{ wide: current === 'users' }">
          <!-- 一次只有一个分区；换分区就是换地址 -->
          <component :is="SECTIONS[current]" :key="current" />
          <p v-if="app.bootstrap?.version" class="version">LoomCanvas {{ app.bootstrap.version }}</p>
        </div>
      </div>
    </div>

    <!-- 有没保存的修改就离开 -->
    <div v-if="asking" class="lc-mask" @click.self="answer(false)">
      <div class="lc-dialog leave" role="alertdialog" aria-modal="true" aria-labelledby="set-leave-h" data-testid="settings-leave">
        <div class="lc-dialog-head"><span id="set-leave-h">{{ t('settings.leave.title') }}</span></div>
        <div class="lc-dialog-body"><p>{{ t('settings.leave.text', { section: t('settings.nav.' + current) }) }}</p></div>
        <div class="lc-dialog-foot">
          <button ref="stayBtn" class="lc-btn" data-testid="settings-leave-stay" @click="answer(false)">{{ t('settings.leave.stay') }}</button>
          <button class="lc-btn danger" data-testid="settings-leave-discard" @click="answer(true)">{{ t('settings.leave.discard') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 设置：左边是分组的导航（「个人」人人都有，「站点管理」只有超级管理员有），右边一次只显示一个分区。
 * 当前分区写在地址里（/settings/<分区>，由路由守卫补全和纠正），所以能直接打开某个分区，浏览器的前进 / 后退也照常。
 * 分区里有改了没保存的东西时，换分区或离开设置页之前先问一句。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import LcIcon from '@/components/LcIcon.vue'
import StorageSection from '@/components/settings/StorageSection.vue'
import LimitsSection from '@/components/settings/LimitsSection.vue'
import AppearanceSection from '@/components/settings/AppearanceSection.vue'
import AccountSection from '@/components/settings/AccountSection.vue'
import SiteSection from '@/components/settings/SiteSection.vue'
import UsersSection from '@/components/settings/UsersSection.vue'
import { provideSectionDirty } from '@/components/settings/dirty'
import { resolveSettingsSection, settingsGroups, type SettingsSectionId } from '@/components/settings/sections'

const { t } = useI18n()
const route = useRoute()
const app = useAppStore()

const SECTIONS: Record<SettingsSectionId, Component> = {
  account: AccountSection,
  appearance: AppearanceSection,
  site: SiteSection,
  users: UsersSection,
  storage: StorageSection,
  limits: LimitsSection,
}

const groups = computed(() => settingsGroups(app.isOwner))
const current = computed(() => resolveSettingsSection(app.isOwner, route.params.section))

const pageEl = ref<HTMLElement | null>(null)
const navEl = ref<HTMLElement | null>(null)

/** 窄屏的横向导航：当前项滚到看得见的地方 */
function revealNav() {
  const nav = navEl.value
  const item = nav?.querySelector<HTMLElement>('a.on')
  if (!nav || !item || nav.scrollWidth <= nav.clientWidth) return
  const box = nav.getBoundingClientRect()
  const it = item.getBoundingClientRect()
  if (it.left < box.left + 16) nav.scrollLeft -= box.left + 16 - it.left
  else if (it.right > box.right - 16) nav.scrollLeft += it.right - (box.right - 16)
}
watch(current, () => {
  // 新的分区从头看起
  pageEl.value?.scrollTo({ top: 0 })
  void nextTick(revealNav)
})
onMounted(() => void nextTick(revealNav))

// ---- 没保存就离开 ----
const { isDirty } = provideSectionDirty()
const asking = ref(false)
const stayBtn = ref<HTMLButtonElement | null>(null)
let settle: ((leave: boolean) => void) | null = null

function answer(leave: boolean) {
  asking.value = false
  settle?.(leave)
  settle = null
}

function confirmLeave(): boolean | Promise<boolean> {
  // 登录已经失效（被送去登录页）时不拦：留下来也存不了
  if (!app.authed || !isDirty()) return true
  // 上一次还没答就又来了一次导航（比如连按后退）：前一次算「留下」
  settle?.(false)
  asking.value = true
  void nextTick(() => stayBtn.value?.focus())
  return new Promise<boolean>((resolve) => { settle = resolve })
}

onBeforeRouteUpdate((to, from) => (to.params.section === from.params.section ? true : confirmLeave()))
onBeforeRouteLeave(() => confirmLeave())

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && asking.value) answer(false)
}
/** 关标签页 / 刷新：只能交给浏览器自己的提示 */
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (isDirty()) e.preventDefault()
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('beforeunload', onBeforeUnload)
  settle?.(true)
})
</script>

<style scoped>
.lc-page-inner { max-width: 1240px; }
.set { display: grid; grid-template-columns: 216px minmax(0, 1fr); gap: 36px; margin-top: 28px; align-items: start; }

.set-nav { display: grid; gap: 20px; position: sticky; top: 24px; }
.grp { display: grid; gap: 2px; }
.grp-h {
  display: flex; align-items: center; gap: 8px; min-height: 22px; padding: 0 12px; margin-bottom: 6px;
  font-size: 12px; color: var(--text-3); white-space: nowrap;
}
.only { padding: 2px 6px; border-radius: 6px; font-size: 11px; color: var(--cyan-soft); background: rgba(63, 216, 255, .1); white-space: nowrap; }
.item {
  height: 38px; display: flex; align-items: center; gap: 10px; padding: 0 12px; border-radius: 10px;
  color: var(--text-2); text-decoration: none; font-size: 14px; border-left: 2px solid transparent; white-space: nowrap;
  transition: background .15s, color .15s;
}
.item:hover { color: var(--text); background: rgba(124, 160, 255, .08); text-decoration: none; }
.item:focus-visible { outline: none; box-shadow: var(--ring); }
.item.on { color: var(--text); background: rgba(59, 123, 255, .14); border-left-color: var(--cyan); }
.item.on :deep(.lc-ic) { color: var(--cyan); }

/* 表单不跟着宽屏无限拉长；用户表格多给一点 */
.set-main { min-width: 0; max-width: 880px; }
.set-main.wide { max-width: 960px; }
.version { margin-top: 32px; font: 12px var(--f-mono); color: var(--text-3); }

.leave { width: 440px; }
.leave p { line-height: 1.7; color: var(--text-2); }

@media (max-width: 900px) {
  .set { grid-template-columns: minmax(0, 1fr); gap: 20px; margin-top: 16px; }
  /* 导航变成贴在顶上的一排选择条，自己横向滚动，页面不跟着变宽 */
  .set-nav {
    display: flex; align-items: center; gap: 8px; top: 0; z-index: 5; margin: 0 -20px; padding: 10px 20px;
    overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none;
    background: var(--bg-0); border-bottom: 1px solid var(--line);
  }
  .set-nav::-webkit-scrollbar { display: none; }
  .grp { display: flex; align-items: center; gap: 8px; flex: none; }
  .grp + .grp { padding-left: 12px; margin-left: 4px; border-left: 1px solid var(--line-2); }
  .grp-h { padding: 0; margin: 0; flex: none; }
  .only { display: none; }
  .item {
    flex: none; height: 32px; padding: 0 12px; gap: 6px; border-radius: 16px; font-size: 13px;
    border: 1px solid var(--line-2);
  }
  .item.on { border-color: var(--cyan); background: rgba(63, 216, 255, .1); }
  .item :deep(.lc-ic) { width: 14px; height: 14px; }
  .set-main, .set-main.wide { max-width: none; }
}
@media (max-width: 600px) {
  .set-nav { margin: 0 -16px; padding: 10px 16px; }
  .version { margin-top: 24px; }
}
</style>
