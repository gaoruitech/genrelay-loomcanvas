<template>
  <div ref="rootEl" class="sw" :class="{ static: !space.canSwitch }">
    <!-- 集成方把空间定死了、或关了切换：只显示在哪儿，不能点 -->
    <div v-if="!space.canSwitch" v-tip="currentName" class="sw-btn sw-static">
      <SpaceAvatar :name="avatarName" :src="space.team?.avatar" :seed="space.currentId || app.user?.id" :size="28" />
      <span class="sw-who">
        <b>{{ currentName }}</b>
        <small>{{ currentSub }}</small>
      </span>
    </div>
    <template v-else>
      <button
        ref="btnEl"
        class="sw-btn"
        type="button"
        aria-haspopup="menu"
        :aria-expanded="open"
        :aria-label="t('spaces.switcher.label', { name: currentName })"
        v-tip="open ? '' : currentName"
        @click="onBtnClick"
        @keydown.down.prevent="openAndFocus"
      >
        <SpaceAvatar :name="avatarName" :src="space.team?.avatar" :seed="space.currentId || app.user?.id" :size="28" />
        <span class="sw-who">
          <b>{{ currentName }}</b>
          <small>{{ currentSub }}</small>
        </span>
        <LcIcon name="chevd" size="s" class="sw-chev" />
        <i v-if="creationDot && manage" class="sw-dot" aria-hidden="true" />
      </button>

      <div v-if="open" ref="menuEl" class="sw-menu lc-menu" role="menu" :aria-label="t('spaces.switcher.menuLabel')" @keydown="onMenuKey">
        <div class="sw-h">{{ t('spaces.personal') }}</div>
        <button class="sw-item" :class="{ on: !space.isTeam }" role="menuitemradio" :aria-checked="!space.isTeam" type="button" @click="go('')">
          <SpaceAvatar :name="app.user?.username" :seed="app.user?.id" :size="28" />
          <span class="sw-it">
            <b>{{ t('spaces.personal') }}</b>
            <small>{{ t('spaces.switcher.personalSub', { name: app.user?.username || '' }) }}</small>
          </span>
          <LcIcon v-if="!space.isTeam" name="check" size="s" class="sw-check" />
        </button>

        <template v-if="space.teams.length">
          <div class="sw-h">{{ t('spaces.teams') }}</div>
          <button
            v-for="tm in space.teams"
            :key="tm.id"
            class="sw-item"
            :class="{ on: tm.id === space.currentId, closed: isClosed(tm) }"
            role="menuitemradio"
            :aria-checked="tm.id === space.currentId"
            type="button"
            @click="isClosed(tm) ? openClosed(tm) : go(tm.id)"
          >
            <SpaceAvatar :name="tm.name" :src="tm.avatar" :seed="tm.id" :size="28" />
            <span class="sw-it">
              <b>{{ tm.name }}</b>
              <small v-if="tm.status === 'dissolved'" class="warn">{{ t('spaces.switcher.dissolved', { time: untilText(tm.purgeAt) }) }}</small>
              <small v-else-if="tm.status === 'suspended'" class="warn">{{ t('spaces.switcher.suspended') }}</small>
              <small v-else-if="manage">{{ t('spaces.switcher.teamSub', { role: t('spaces.role.' + tm.role), n: tm.members ?? 0 }) }}</small>
              <small v-else>{{ t('spaces.role.' + tm.role) }}</small>
            </span>
            <LcIcon v-if="tm.id === space.currentId" name="check" size="s" class="sw-check" />
          </button>
        </template>

        <!-- 手机上侧栏只有六项，团队页的入口放在这里 -->
        <template v-if="space.isTeam && manage">
          <hr class="sw-hr sw-m-only" />
          <button class="sw-act sw-m-only" role="menuitem" type="button" @click="toTeamPage">
            <LcIcon name="users" size="s" />{{ t('spaces.switcher.teamPage') }}
          </button>
        </template>

        <!-- 创建团队、用邀请码加入：成员这件事由集成方自己管的时候（features.teamAdmin 关着 —— 没有团队页，建出来的团队也没处管）不给 -->
        <template v-if="manage">
          <hr class="sw-hr" />
          <button class="sw-act" role="menuitem" type="button" @click="openCreate">
            <LcIcon :name="creationIcon" size="s" />
            <span class="sw-act-t">{{ creationLabel }}</span>
            <span v-if="creationBadge" class="lc-tag" :class="creationBadge.cls">{{ creationBadge.text }}</span>
          </button>
          <!-- 填了邀请码是去「加入」那一页接着走的：集成方没开放那一页（pages 里没有 join）就没有这一项，不留一颗填完没反应的按钮 -->
          <button v-if="pages.has('join')" class="sw-act" role="menuitem" type="button" @click="openJoin">
            <LcIcon name="key" size="s" />{{ t('spaces.switcher.joinByCode') }}
          </button>
        </template>
      </div>
    </template>

    <TeamCreateDialog v-if="createOpen" @close="createOpen = false" @created="onCreated" />
    <JoinByCodeDialog v-if="joinOpen" @close="joinOpen = false" />
    <TeamClosedDialog v-if="closedTeam" :team="closedTeam" @close="closedTeam = null" />
  </div>
</template>

<script setup lang="ts">
/**
 * 顶栏里的空间切换器：现在在哪个空间、我在里面是什么角色；点开换空间、创建团队、用邀请码加入。
 * 账号按钮上的小字仍是站点角色（超级管理员 / 用户），团队角色只写在这里，两者不混。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useSpaceStore, spaceParam } from '@/stores/space'
import { useEmbed } from '@/embed/context'
import { usePageOpen } from '@/embed/links'
import LcIcon from '@/components/LcIcon.vue'
import SpaceAvatar from './SpaceAvatar.vue'
import TeamCreateDialog from './TeamCreateDialog.vue'
import JoinByCodeDialog from './JoinByCodeDialog.vue'
import TeamClosedDialog from './TeamClosedDialog.vue'
import { daysUntil } from './format'
import type { SpaceSummary } from '@/types'

const { t } = useI18n()
const router = useRouter()
const app = useAppStore()
const space = useSpaceStore()
const embed = useEmbed()
const pages = usePageOpen()
/** 团队这件事（成员、邀请、创建）在这次挂载里归不归 LoomCanvas 管：集成方关了 features.teamAdmin 就只剩「换空间」 */
const manage = computed(() => embed.features.teamAdmin)

const currentName = computed(() => (space.isTeam ? space.name : t('spaces.personal')))
const avatarName = computed(() => (space.isTeam ? space.name : app.user?.username || ''))
const currentSub = computed(() => (
  space.isTeam
    ? t('spaces.switcher.currentTeam', { role: t('spaces.role.' + space.role) })
    : t('spaces.switcher.currentPersonal', { name: app.user?.username || '' })
))

const isClosed = (tm: SpaceSummary) => !!tm.status && tm.status !== 'active'
const untilText = (iso?: string | null) => t('spaces.days', { n: daysUntil(iso) })

// ---- 创建团队那一行：按授权状态换说法 ----
const creation = computed(() => space.creation)
const creationLabel = computed(() => {
  const c = creation.value
  if (!c || c.canCreate) return t('spaces.create.title')
  if (c.authorised) return t('spaces.create.title')
  return t('spaces.create.requestTitle')
})
const creationIcon = computed(() => (creation.value && !creation.value.authorised ? 'shield' : 'plus'))
const creationBadge = computed<{ cls: string; text: string } | null>(() => {
  const c = creation.value
  if (!c) return null
  if (c.authorised) return c.canCreate ? null : { cls: 'warn', text: t('spaces.create.badgeFull') }
  if (c.request?.status === 'pending') return { cls: 'accent', text: t('spaces.create.badgePending') }
  if (c.request?.status === 'rejected') return { cls: 'err', text: t('spaces.create.badgeRejected') }
  return null
})
/** 申请有了结果（被拒绝）时在按钮上点一个小点 */
const creationDot = computed(() => creation.value?.request?.status === 'rejected' && !creation.value.authorised)

// ---- 菜单 ----
const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)
const btnEl = ref<HTMLElement | null>(null)
const menuEl = ref<HTMLElement | null>(null)

function toggle() {
  open.value = !open.value
  // 点开时顺手刷新一次：别人把我加进了团队、申请被批准了，都是这时候看到
  if (open.value) void space.refresh()
}
/** 用键盘点开（回车 / 空格，detail 为 0）：焦点直接进菜单，落在当前空间那一项上 */
function onBtnClick(e: MouseEvent) {
  if (e.detail === 0 && !open.value) void openAndFocus()
  else toggle()
}
async function openAndFocus() {
  if (!open.value) toggle()
  await nextTick()
  const list = items()
  ;(list.find((b) => b.getAttribute('aria-checked') === 'true') || list[0])?.focus()
}
function close(focusBack = false) {
  open.value = false
  if (focusBack) btnEl.value?.focus()
}
const items = () => Array.from(menuEl.value?.querySelectorAll<HTMLElement>('button') || []).filter((b) => b.offsetParent !== null)
function onMenuKey(e: KeyboardEvent) {
  const list = items()
  const i = list.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus() }
  else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus() }
  else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus() }
  else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus() }
  else if (e.key === 'Escape') { e.preventDefault(); close(true) }
  // Tab：收起，焦点先回到按钮上，浏览器再从按钮往下走（不然焦点留在一个已经消失的菜单项上）
  else if (e.key === 'Tab') close(true)
}
function onDocDown(e: MouseEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target as Node)) close()
}
function onDocKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && open.value) close(true)
}
onMounted(() => {
  document.addEventListener('mousedown', onDocDown)
  document.addEventListener('keydown', onDocKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  document.removeEventListener('keydown', onDocKey)
})

/** 换空间：落在那个空间的首页。空间总是明写在地址上（个人空间用 ?space=personal 这个记号，守卫会去掉它） */
async function go(id: string) {
  close()
  if (id === space.currentId) return
  await router.push(id ? { name: 'home', params: { space: spaceParam(id) } } : { name: 'home', query: { space: 'personal' } })
}
function toTeamPage() {
  close()
  void router.push({ name: 'team' })
}

const createOpen = ref(false)
const joinOpen = ref(false)
const closedTeam = ref<SpaceSummary | null>(null)
// 开弹窗之前焦点先回到按钮上：弹窗关掉后焦点还回这里（菜单项那时已经不在了）
function openCreate() { close(true); createOpen.value = true }
function openJoin() { close(true); joinOpen.value = true }
function openClosed(tm: SpaceSummary) { close(true); closedTeam.value = tm }
async function onCreated(id: string) {
  createOpen.value = false
  await router.push({ name: 'home', params: { space: spaceParam(id) } })
}
</script>

<style scoped>
/* 顶栏挤的时候先收它的文字（省略号），站点名称最后才动 */
.sw { position: relative; min-width: 0; flex: 0 100 auto; }
.sw-btn {
  position: relative; display: flex; align-items: center; gap: 10px; height: 40px; max-width: 260px; min-width: 0;
  padding: 0 10px 0 6px; border-radius: 12px; border: 1px solid var(--line-2); background: rgb(var(--c-film) / .06);
  color: var(--text-2); text-align: left; transition: border-color .15s, background .15s;
}
button.sw-btn:hover, .sw-btn[aria-expanded='true'] { border-color: rgb(var(--c-cyan) / .55); background: rgb(var(--c-film) / .12); }
button.sw-btn:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.sw-static { border-color: var(--line); background: none; }
.sw-who { min-width: 0; display: block; }
.sw-who b { display: block; font-weight: 600; font-size: 13px; color: var(--text); line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw-who small { display: block; font-size: 11px; color: var(--text-3); line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw-chev { color: var(--text-3); }
.sw-dot { position: absolute; top: -3px; right: -3px; width: 8px; height: 8px; border-radius: 50%; background: var(--err); box-shadow: 0 0 0 2px var(--bg-0); }

.sw-menu { position: absolute; left: 0; top: calc(100% + 8px); width: 304px; max-width: calc(calc(100 * var(--lc-vw)) - 24px); max-height: calc(calc(100 * var(--lc-vh)) - 96px); z-index: 60; }
.sw-h { padding: 8px 10px 4px; font-size: 11px; color: var(--text-3); }
.sw-item, .sw-act {
  display: flex; align-items: center; gap: 10px; width: 100%; border: 0; background: none; text-align: left;
  border-radius: 8px; color: var(--text-2); font-size: 13px; cursor: pointer;
}
.sw-item { padding: 6px 10px; }
.sw-act { padding: 9px 10px; gap: 12px; }
.sw-item:hover, .sw-act:hover, .sw-item:focus-visible, .sw-act:focus-visible { outline: none; background: rgb(var(--c-film) / .12); color: var(--text); }
.sw-item.on { background: rgb(var(--c-blue) / .2); }
.sw-item.closed { opacity: .75; }
.sw-it { flex: 1; min-width: 0; }
.sw-it b { display: block; font-weight: 500; color: var(--text); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw-it small { display: block; font-size: 11px; color: var(--text-3); line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw-it small.warn { color: var(--warn); }
.sw-check { color: var(--text); }
.sw-act-t { flex: 1; min-width: 0; }
.sw-act .lc-ic { color: var(--text-3); }
.sw-hr { border: 0; border-top: 1px solid var(--line); margin: 6px 4px; }
.sw-m-only { display: none; }
hr.sw-m-only { display: none; }

/* 手机：只剩头像方块，点开是同一个菜单 */
@media (max-width: 640px) {
  .sw-btn { padding: 0 5px; gap: 0; height: 38px; }
  .sw-who, .sw-chev { display: none; }
  .sw-menu { position: fixed; left: 12px; right: 12px; top: calc(var(--shell-top) + 4px); width: auto; max-width: none; }
  .sw-act.sw-m-only { display: flex; }
  hr.sw-m-only { display: block; }
}
</style>
