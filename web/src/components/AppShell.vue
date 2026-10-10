<template>
  <div class="shell" :class="{ mini, immersive: hidden }">
    <header v-if="!hidden" class="shell-top">
      <LcLogo to="/app" />
      <span class="tagline">{{ t('shell.tagline') }}</span>
      <span class="lc-sp" />
      <LcSelect
        class="lang"
        size="sm"
        auto-width
        :model-value="app.locale"
        :options="LOCALE_OPTIONS"
        :aria-label="t('shell.language')"
        @update:model-value="app.setLocale"
      />
      <div ref="userEl" class="user-wrap">
        <button class="user" :aria-expanded="menuOpen" aria-haspopup="menu" @click="menuOpen = !menuOpen">
          <span class="avatar" aria-hidden="true">{{ initial }}</span>
          <span class="who">
            <b>{{ app.user?.username }}</b>
            <small>{{ app.isOwner ? t('shell.roleOwner') : t('shell.roleUser') }}</small>
          </span>
          <LcIcon name="chevd" size="s" />
        </button>
        <div v-if="menuOpen" class="user-menu lc-menu" role="menu">
          <div class="um-head">
            <b>{{ app.user?.username }}</b>
            <small>{{ app.user?.email }}</small>
          </div>
          <router-link class="lc-menu-item" role="menuitem" :to="{ name: 'settings', hash: '#account' }" @click="menuOpen = false">
            <LcIcon name="shield" size="s" />{{ t('shell.account') }}
          </router-link>
          <a class="lc-menu-item" role="menuitem" :href="LINKS.docs" target="_blank" rel="noopener" @click="menuOpen = false">
            <LcIcon name="book" size="s" />{{ t('shell.docs') }}
          </a>
          <button class="lc-menu-item danger" role="menuitem" @click="logout">
            <LcIcon name="logout" size="s" />{{ t('shell.logout') }}
          </button>
        </div>
      </div>
    </header>

    <nav v-if="!hidden" class="shell-side" :aria-label="t('shell.navLabel')">
      <template v-for="(n, i) in NAV" :key="n.key">
        <hr v-if="i === 1" />
        <router-link
          :to="n.to"
          class="nav"
          :class="{ on: route.meta.nav === n.key }"
          :title="t('shell.nav.' + n.key)"
          :aria-current="route.meta.nav === n.key ? 'page' : undefined"
        >
          <LcIcon :name="n.icon" /><span>{{ t('shell.nav.' + n.key) }}</span>
        </router-link>
      </template>
      <div class="side-foot">
        <b>{{ t('shell.selfHosted') }}</b>
        <span v-if="app.bootstrap?.version">{{ t('shell.version', { v: app.bootstrap.version }) }}</span>
        <span class="links">
          <a :href="LINKS.docs" target="_blank" rel="noopener">{{ t('shell.docs') }}</a> ·
          <a :href="LINKS.repo" target="_blank" rel="noopener">{{ t('shell.source') }}</a>
        </span>
      </div>
    </nav>

    <main class="shell-main">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { LOCALE_OPTIONS } from '@/locales'
import { LINKS } from '@/utils/links'
import LcSelect from '@/components/LcSelect.vue'
import LcIcon from '@/components/LcIcon.vue'
import LcLogo from '@/components/LcLogo.vue'

const { t } = useI18n()
const route = useRoute()
const app = useAppStore()

const NAV = [
  { key: 'home', to: '/app', icon: 'home' },
  { key: 'canvases', to: '/canvases', icon: 'canvas' },
  { key: 'assets', to: '/assets', icon: 'assets' },
  { key: 'models', to: '/models', icon: 'models' },
  { key: 'history', to: '/history', icon: 'history' },
  { key: 'settings', to: '/settings', icon: 'settings' },
] as const

/** 画布编辑器里侧栏收成图标栏，把宽度让给画布 */
const mini = computed(() => route.meta.shell === 'mini')
/** 编辑器的「沉浸模式」：外壳整个收起 */
const hidden = computed(() => mini.value && app.immersive)

const initial = computed(() => (app.user?.username || '?').slice(0, 1).toUpperCase())

const menuOpen = ref(false)
const userEl = ref<HTMLElement | null>(null)
function onDocDown(e: MouseEvent) {
  if (menuOpen.value && userEl.value && !userEl.value.contains(e.target as Node)) menuOpen.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') menuOpen.value = false
}
onMounted(() => {
  document.addEventListener('mousedown', onDocDown)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  document.removeEventListener('keydown', onKey)
})

async function logout() {
  menuOpen.value = false
  await app.logout()
}
</script>

<style scoped>
.shell {
  display: grid; width: 100%; height: 100%;
  grid-template-columns: var(--shell-side) minmax(0, 1fr);
  grid-template-rows: var(--shell-top) minmax(0, 1fr);
}
.shell.mini { grid-template-columns: var(--shell-side-mini) minmax(0, 1fr); }
.shell.immersive { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }

.shell-top {
  grid-column: 1 / -1; display: flex; align-items: center; gap: 16px; padding: 0 20px 0 16px; min-width: 0;
  border-bottom: 1px solid var(--line); background: rgba(7, 13, 36, .78);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  position: relative; z-index: 20;
}
.tagline { font-size: 12px; color: var(--text-3); padding-left: 16px; border-left: 1px solid var(--line-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.lang :deep(.lcs-trigger) { background: rgba(124, 160, 255, .05); border-color: var(--line); height: 36px; border-radius: 10px; }

.user-wrap { position: relative; flex: none; }
.user {
  display: flex; align-items: center; gap: 10px; padding: 3px 10px 3px 4px; border-radius: 20px;
  border: 1px solid var(--line); background: rgba(124, 160, 255, .05); color: var(--text-2); text-align: left;
  transition: border-color .15s, background .15s;
}
.user:hover, .user[aria-expanded='true'] { border-color: var(--line-3); background: rgba(124, 160, 255, .1); }
.avatar {
  width: 28px; height: 28px; border-radius: 50%; flex: none; display: grid; place-items: center;
  background: linear-gradient(135deg, #3fd8ff, #8a5cff); color: var(--text-inv); font: 600 13px/1 var(--f-disp);
}
.who b { display: block; font-weight: 500; font-size: 13px; color: var(--text); line-height: 1.25; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.who small { display: block; font-size: 11px; color: var(--text-3); line-height: 1.2; }
.user-menu { position: absolute; right: 0; top: calc(100% + 8px); min-width: 220px; z-index: 50; }
.um-head { padding: 8px 10px 10px; margin-bottom: 4px; border-bottom: 1px solid var(--line); }
.um-head b { display: block; font-size: 13px; color: var(--text); }
.um-head small { display: block; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; }
.user-menu .lc-menu-item { gap: 10px; width: 100%; border: 0; background: none; text-decoration: none; text-align: left; }
.user-menu .lc-menu-item.danger { color: var(--err-soft); }
.user-menu .lc-menu-item.danger:hover { background: rgba(255, 107, 139, .12); }

.shell-side {
  border-right: 1px solid var(--line); background: rgba(7, 13, 36, .55);
  padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; min-height: 0; overflow-y: auto; overflow-x: hidden;
}
.nav {
  display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 12px; border-radius: 12px; flex: none;
  color: var(--text-2); font-size: 14px; border: 1px solid transparent; white-space: nowrap; text-decoration: none;
  transition: background .15s, color .15s;
}
.nav:hover { color: var(--text); background: rgba(124, 160, 255, .08); text-decoration: none; }
.nav.on {
  color: var(--text);
  background: linear-gradient(135deg, rgba(63, 216, 255, .2), rgba(59, 123, 255, .22) 55%, rgba(138, 92, 255, .24));
  border-color: rgba(63, 216, 255, .5);
  box-shadow: 0 0 20px rgba(59, 123, 255, .35), 0 0 0 1px rgba(63, 216, 255, .12) inset;
}
.nav.on .lc-ic { color: var(--cyan); }
.shell-side hr { border: 0; border-top: 1px solid var(--line); margin: 8px 4px; flex: none; }
.side-foot {
  margin-top: auto; padding: 12px; border-radius: 12px; border: 1px solid var(--line);
  background: rgba(124, 160, 255, .05); font-size: 12px; color: var(--text-3); line-height: 1.6;
  display: flex; flex-direction: column;
}
.side-foot b { color: var(--text-2); font-weight: 500; }
.side-foot a { color: var(--text-3); }
.side-foot a:hover { color: var(--cyan-soft); }

.shell-main { position: relative; min-width: 0; min-height: 0; overflow: hidden; }

/* 图标栏：编辑器里，或者窗口窄于 1100 */
.shell.mini .shell-side { padding: 16px 8px; align-items: center; }
.shell.mini .nav { width: 44px; padding: 0; justify-content: center; }
.shell.mini .nav span, .shell.mini .side-foot, .shell.mini .tagline { display: none; }
.shell.mini .shell-side hr { align-self: stretch; }
@media (max-width: 1100px) {
  .shell:not(.immersive) { grid-template-columns: var(--shell-side-mini) minmax(0, 1fr); }
  .shell-side { padding: 16px 8px; align-items: center; }
  .nav { width: 44px; padding: 0; justify-content: center; }
  .nav span, .side-foot { display: none; }
  .shell-side hr { align-self: stretch; }
}
@media (max-width: 760px) { .tagline { display: none; } }

/* 手机：侧栏变成底部导航；编辑器里不显示（画布要用整屏，顶栏的 Logo 可以回工作台） */
@media (max-width: 640px) {
  .shell:not(.immersive) {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: var(--shell-top) minmax(0, 1fr) auto;
  }
  .shell-top { padding: 0 12px; gap: 8px; }
  .who, .user > .lc-ic { display: none; }
  .user { padding: 3px; }
  .shell-side {
    grid-row: 3; flex-direction: row; align-items: stretch; justify-content: space-around; gap: 0;
    padding: 4px 4px calc(4px + env(safe-area-inset-bottom)); border-right: 0; border-top: 1px solid var(--line);
    background: rgba(7, 13, 36, .92); overflow: visible;
  }
  .shell-side hr { display: none; }
  .nav { flex: 1 1 0; width: auto; min-width: 0; height: 50px; flex-direction: column; gap: 3px; padding: 0 2px; border-radius: 10px; font-size: 10.5px; }
  .nav span { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; line-height: 1.1; }
  .nav.on { box-shadow: 0 0 0 1px rgba(63, 216, 255, .12) inset; }
  .shell.mini .shell-side { display: none; }
  .shell.mini:not(.immersive) { grid-template-rows: var(--shell-top) minmax(0, 1fr); }
}
</style>
