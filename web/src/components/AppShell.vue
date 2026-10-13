<template>
  <div class="shell" :class="{ mini, immersive: hidden }">
    <header v-if="!hidden" class="shell-top">
      <LcLogo v-if="embed.brand !== false" to="/app" />
      <!-- 空间切换器占的是原来那句标语的位置；没有团队这回事时（宿主管登录而后端不认识这个人）还是标语 -->
      <SpaceSwitcher v-if="showSwitcher" />
      <span v-else-if="embed.brand === undefined" class="tagline">{{ t('shell.tagline') }}</span>
      <span class="lc-sp" />
      <!-- 窄于 760px 顶栏放不下这么多：有用户菜单时语言收进菜单里（见下面的 um-lang），产品名才写得全；
           没有用户菜单时（宿主管登录）换成一颗图标钮（LangSwitch） -->
      <LcSelect
        v-if="embed.features.localeSwitch"
        class="lang"
        :class="embed.features.account ? 'in-menu' : 'to-icon'"
        size="sm"
        auto-width
        :model-value="app.locale"
        :options="LOCALE_OPTIONS"
        :aria-label="t('shell.language')"
        @update:model-value="app.setLocale"
      />
      <LangSwitch v-if="embed.features.localeSwitch && !embed.features.account" class="lang-icon" />
      <ThemeSwitch v-if="embed.features.themeSwitch" />
      <div v-if="embed.features.account" ref="userEl" class="user-wrap">
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
          <!-- 语言：只在窄于 760px 时出现（顶栏上的那个下拉这时收起来了） -->
          <div v-if="embed.features.localeSwitch" class="um-lang" role="group" :aria-label="t('shell.language')" data-testid="user-menu-language">
            <span class="um-lab"><LcIcon name="globe" size="s" />{{ t('shell.language') }}</span>
            <span class="lc-seg">
              <button
                v-for="l in LOCALE_OPTIONS" :key="l.value" type="button" role="menuitemradio" :class="{ on: l.value === app.locale }"
                :aria-checked="l.value === app.locale" :lang="l.value" :data-locale-opt="l.value" @click="app.setLocale(l.value)"
              >{{ l.label }}</button>
            </span>
          </div>
          <router-link class="lc-menu-item" role="menuitem" :to="{ name: 'settings', params: { section: 'account' } }" @click="menuOpen = false">
            <LcIcon name="shield" size="s" />{{ t('shell.account') }}
          </router-link>
          <a v-if="embed.features.externalLinks" class="lc-menu-item" role="menuitem" :href="LINKS.docs" target="_blank" rel="noopener" @click="menuOpen = false">
            <LcIcon name="book" size="s" />{{ t('shell.docs') }}
          </a>
          <button class="lc-menu-item danger" role="menuitem" @click="logout">
            <LcIcon name="logout" size="s" />{{ t('shell.logout') }}
          </button>
        </div>
      </div>
      <!-- 宿主管登录：只显示是谁，没有菜单（退出、账号设置都是宿主的事） -->
      <div v-else-if="app.user?.username" class="user host-user">
        <img v-if="app.avatarUrl" class="avatar" :src="app.avatarUrl" alt="" />
        <span v-else class="avatar" aria-hidden="true">{{ initial }}</span>
        <span class="who"><b>{{ app.user.username }}</b></span>
      </div>
    </header>

    <nav v-if="!hidden" class="shell-side" :aria-label="t('shell.navLabel')">
      <template v-for="(n, i) in nav" :key="n.key">
        <hr v-if="i === 1 && nav[0].key === 'home'" />
        <router-link
          :to="n.to"
          class="nav"
          :class="{ on: route.meta.nav === n.key, 'nav-team': n.key === 'team', 'has-short': !!navShort(n.key) }"
          v-tip="{ text: iconOnly ? navLabel(n.key) : '', placement: 'right' }"
          :aria-label="navLabel(n.key)"
          :aria-current="route.meta.nav === n.key ? 'page' : undefined"
        >
          <LcIcon :name="n.icon" /><span>{{ navLabel(n.key) }}</span><span v-if="navShort(n.key)" class="nav-short" aria-hidden="true">{{ navShort(n.key) }}</span>
        </router-link>
      </template>
      <div v-if="embed.features.externalLinks" class="side-foot">
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
import { useSpaceStore } from '@/stores/space'
import { LOCALE_OPTIONS } from '@/locales'
import { LINKS } from '@/utils/links'
import LcSelect from '@/components/LcSelect.vue'
import LcIcon from '@/components/LcIcon.vue'
import LcLogo from '@/components/LcLogo.vue'
import ThemeSwitch from '@/components/ThemeSwitch.vue'
import LangSwitch from '@/components/LangSwitch.vue'
import SpaceSwitcher from '@/components/space/SpaceSwitcher.vue'
import { useEmbed } from '@/embed/context'
import { isPageOpen } from '@/embed/options'
import { isSettingsOpen } from '@/embed/links'

const { t } = useI18n()
const route = useRoute()
const app = useAppStore()
const space = useSpaceStore()
const embed = useEmbed()

/** 有空间可说（后端认识这个人），并且要么能换、要么正待在某个团队里（空间被集成方定死时只显示在哪儿） */
const showSwitcher = computed(() => space.teamsEnabled && !!app.bootstrap?.spaces?.length && (space.canSwitch || space.isTeam))

const NAV = [
  { key: 'home', to: '/app', icon: 'home' },
  { key: 'canvases', to: '/canvases', icon: 'canvas' },
  { key: 'assets', to: '/assets', icon: 'assets' },
  { key: 'models', to: '/models', icon: 'models' },
  { key: 'history', to: '/history', icon: 'history' },
  { key: 'team', to: '/team', icon: 'users' },
  { key: 'settings', to: '/settings', icon: 'settings' },
] as const
type NavKey = typeof NAV[number]['key']

/**
 * 侧栏里只列这次挂载里存在的页面（独立应用里是全部）：集成方没列进 pages 的、所属功能被关掉的
 * （features.assetLibrary / brandKit / modelManagement / teamAdmin，见 embed/options.ts 的 isPageOpen）都不列。
 * 「团队」只在团队空间里有；「设置」里一个能看的分区都没有时也不列。
 */
const NAV_PAGE = { home: 'home', canvases: 'canvases', assets: 'assets', models: 'models', history: 'history', team: 'team', settings: 'settings' } as const
/** 素材库关了、品牌包还开着：「素材」那一项换成直接去品牌包（它本来是素材库的第二个页签） */
const kitsOnly = computed(() => !isPageOpen(embed, 'assets') && isPageOpen(embed, 'brand-kits'))
interface NavItem { key: NavKey; to: string; icon: string }
const nav = computed<NavItem[]>(() => NAV.flatMap((n): NavItem[] => {
  if (n.key === 'assets' && kitsOnly.value) return [{ ...n, to: '/assets/brand-kits' }]
  if (n.key === 'team') return space.isTeam && isPageOpen(embed, 'team') ? [n] : []
  if (n.key === 'settings') return isSettingsOpen(embed, app.isOwner) ? [n] : []
  return isPageOpen(embed, NAV_PAGE[n.key]) ? [n] : []
}))
/** 团队空间里「工作台」叫「团队首页」 */
const navLabel = (key: NavKey) => {
  if (key === 'assets' && kitsOnly.value) return t('brandKit.page.tabKits')
  return t(key === 'home' && space.isTeam ? 'shell.nav.teamHome' : 'shell.nav.' + key)
}
/**
 * 手机底部导航一格只有五六十像素：「Team home」「Workbench」放不下，那里用短的叫法（读屏读的仍是全称）。
 * 短叫法和全称一样（中文的「工作台」）就不另起。
 */
const navShort = (key: NavKey) => {
  if (key !== 'home') return ''
  const short = t(space.isTeam ? 'shell.nav.teamHomeShort' : 'shell.nav.homeShort')
  return short !== navLabel(key) ? short : ''
}

/** 画布编辑器里侧栏收成图标栏，把宽度让给画布 */
const mini = computed(() => route.meta.shell === 'mini')
/** 编辑器的「沉浸模式」：外壳整个收起。集成方关了这个功能（features.immersive）时，上次记下的「沉浸」不算数 —— 不然外壳收着，却没有把它叫回来的开关 */
const hidden = computed(() => mini.value && app.immersive && embed.features.immersive)

/**
 * 侧栏只剩图标的时候（编辑器里，或者窗口不够宽 —— 和下面样式里的断点是同一组数），导航项的名字靠悬停提示（v-tip）给；
 * 名字本来就摆着的时候不重复一遍。
 */
const narrowSide = ref(false)
let sideMq: MediaQueryList | null = null
const onSideMq = () => { narrowSide.value = !!sideMq?.matches }
onMounted(() => {
  if (typeof window.matchMedia !== 'function') return
  sideMq = window.matchMedia('(min-width: 641px) and (max-width: 1100px)')
  onSideMq()
  sideMq.addEventListener('change', onSideMq)
})
onBeforeUnmount(() => sideMq?.removeEventListener('change', onSideMq))
const iconOnly = computed(() => mini.value || narrowSide.value)

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
  border-bottom: 1px solid var(--line); background: rgb(var(--c-chrome) / .78);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
  position: relative; z-index: 20;
}
.tagline { font-size: 12px; color: var(--text-3); padding-left: 16px; border-left: 1px solid var(--line-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.lang :deep(.lcs-trigger) { background: rgb(var(--c-film) / .05); border-color: var(--line); height: 36px; border-radius: 10px; }
/* 图标钮版的语言切换：只在窄屏、没有用户菜单时出现（见下面 760px 那一段） */
.lang-icon { display: none; }

.user-wrap { position: relative; flex: none; }
.user {
  display: flex; align-items: center; gap: 10px; padding: 3px 10px 3px 4px; border-radius: 20px;
  border: 1px solid var(--line); background: rgb(var(--c-film) / .05); color: var(--text-2); text-align: left;
  transition: border-color .15s, background .15s;
}
.user:hover, .user[aria-expanded='true'] { border-color: var(--line-3); background: rgb(var(--c-film) / .1); }
.avatar {
  width: 28px; height: 28px; border-radius: 50%; flex: none; display: grid; place-items: center;
  background: var(--grad-avatar); color: var(--text-inv); font: 600 13px/1 var(--f-disp);
}
.who b { display: block; font-weight: 500; font-size: 13px; color: var(--text); line-height: 1.25; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.who small { display: block; font-size: 11px; color: var(--text-3); line-height: 1.2; }
.user-menu { position: absolute; right: 0; top: calc(100% + 8px); min-width: 220px; z-index: 50; }
.um-head { padding: 8px 10px 10px; margin-bottom: 4px; border-bottom: 1px solid var(--line); }
.um-head b { display: block; font-size: 13px; color: var(--text); }
.um-head small { display: block; font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; }
.user-menu .lc-menu-item { gap: 10px; width: 100%; border: 0; background: none; text-decoration: none; text-align: left; }
.user-menu .lc-menu-item.danger { color: var(--err-soft); }
.user-menu .lc-menu-item.danger:hover { background: rgb(var(--c-err) / .12); }
/* 菜单里的语言：桌面宽度上顶栏有下拉，这里不出现 */
.um-lang { display: none; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 10px 10px; margin-bottom: 4px; border-bottom: 1px solid var(--line); }
.um-lab { display: inline-flex; align-items: center; gap: 10px; font-size: 13px; color: var(--text-2); white-space: nowrap; }
.um-lang .lc-seg > button { height: 30px; padding: 0 10px; }
.um-lang .lc-seg > button:focus-visible { outline: none; box-shadow: var(--ring); }

.shell-side {
  border-right: 1px solid var(--line); background: rgb(var(--c-chrome) / .55);
  padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; min-height: 0; overflow-y: auto; overflow-x: hidden;
}
.nav {
  display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 12px; border-radius: 12px; flex: none;
  color: var(--text-2); font-size: 14px; border: 1px solid transparent; white-space: nowrap; text-decoration: none;
  transition: background .15s, color .15s;
}
.nav:hover { color: var(--text); background: rgb(var(--c-film) / .08); text-decoration: none; }
.nav.on {
  color: var(--text);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .2), rgb(var(--c-blue) / .22) 55%, rgb(var(--c-violet) / .24));
  border-color: rgb(var(--c-cyan) / .5);
  box-shadow: 0 0 20px rgb(var(--g-blue) / .35), 0 0 0 1px rgb(var(--c-cyan) / .12) inset;
}
.nav.on .lc-ic { color: var(--cyan); }
.shell-side hr { border: 0; border-top: 1px solid var(--line); margin: 8px 4px; flex: none; }
.side-foot {
  margin-top: auto; padding: 12px; border-radius: 12px; border: 1px solid var(--line);
  background: rgb(var(--c-film) / .05); font-size: 12px; color: var(--text-3); line-height: 1.6;
  display: flex; flex-direction: column;
}
.side-foot b { color: var(--text-2); font-weight: 500; }
.side-foot a { color: var(--text-3); }
.side-foot a:hover { color: var(--cyan-soft); }

.shell-main { position: relative; min-width: 0; min-height: 0; overflow: hidden; }

/* 图标栏：编辑器里，或者窗口窄于 1100 */
.shell.mini .shell-side { padding: 16px 8px; align-items: center; }
.shell.mini .nav { width: 44px; padding: 0; justify-content: center; }
.nav .nav-short { display: none; }
.shell.mini .nav span, .shell.mini .side-foot, .shell.mini .tagline { display: none; }
.shell.mini .shell-side hr { align-self: stretch; }
@media (max-width: 1100px) {
  .shell:not(.immersive) { grid-template-columns: var(--shell-side-mini) minmax(0, 1fr); }
  .shell-side { padding: 16px 8px; align-items: center; }
  .nav { width: 44px; padding: 0; justify-content: center; }
  .nav span, .side-foot { display: none; }
  .shell-side hr { align-self: stretch; }
}
/* 顶栏放不下这么多的宽度（手机，以及刚过手机断点的那一段）：标语不要，语言收进用户菜单 ——
   顶栏只剩 Logo + 名称、空间、主题、头像，产品名写得全，语言下拉也不会被挤扁 */
@media (max-width: 760px) {
  .tagline { display: none; }
  .lang.in-menu, .lang.to-icon { display: none; }
  .lang-icon { display: block; }
  .um-lang { display: flex; }
  .user-menu { min-width: 248px; }
}

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
    background: rgb(var(--c-chrome) / .92); overflow: visible;
  }
  .shell-side hr { display: none; }
  .nav { flex: 1 1 0; width: auto; min-width: 0; height: 50px; flex-direction: column; gap: 3px; padding: 0; border-radius: 10px; font-size: 10.5px; }
  .nav span { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; line-height: 1.1; }
  .nav.has-short span:not(.nav-short) { display: none; }
  .nav .nav-short { display: block; }
  .nav.on { box-shadow: 0 0 0 1px rgb(var(--c-cyan) / .12) inset; }
  /* 底部导航保持六项：「团队」的入口在空间切换器的菜单里 */
  .nav.nav-team { display: none; }
  .shell.mini .shell-side { display: none; }
  .shell.mini:not(.immersive) { grid-template-rows: var(--shell-top) minmax(0, 1fr); }
}
/* 宿主管登录时右上角那一块只是「现在是谁」（没有菜单）：手机宽度上把位置让给宿主的 Logo 和名称 */
@media (max-width: 480px) {
  .user.host-user { display: none; }
}
</style>
