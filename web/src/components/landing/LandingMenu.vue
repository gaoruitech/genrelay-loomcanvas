<template>
  <!-- 落地页窄屏（≤820px）的菜单：页头里只剩一颗按钮，点开是一张面板 ——
       手机上贴底通栏（全局的 .lc-mask.lc-sheet），平板宽度挂在页头右下角。
       页头在这个宽度收起来的东西全在里面：各节的入口、文档 / 源码、主题、语言、登录 / 注册。 -->
  <button
    ref="btn"
    type="button"
    class="lm-btn"
    :class="{ on: open }"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-controls="open ? panelId : undefined"
    :aria-label="t(open ? 'views.landingNav.close' : 'views.landingNav.open')"
    data-act="landing-menu"
    @click="open ? close() : show()"
  ><LcIcon :name="open ? 'x' : 'menu'" /></button>

  <Teleport :to="$lcPortal">
    <div v-if="open" class="lc-mask lc-sheet lm-mask" data-role="landing-menu-mask" @click.self="close()">
      <div :id="panelId" ref="panel" class="lc-dialog lm" role="dialog" aria-modal="true" :aria-label="t('views.landingNav.menu')" tabindex="-1">
        <div class="lc-dialog-head">
          <span>{{ t('views.landingNav.menu') }}</span>
          <button class="lc-x" type="button" :aria-label="t('views.landingNav.close')" data-act="landing-menu-close" @click="close()">×</button>
        </div>
        <div class="lc-dialog-body lm-body">
          <nav class="lm-nav" :aria-label="t('views.landingNav.sections')">
            <template v-for="l in links" :key="l.key">
              <a
                v-if="l.href" class="lm-link" :href="l.href" target="_blank" rel="noopener" :data-nav="l.key"
                :aria-label="t('views.landingNav.newTab', { name: l.label })" @click="close()"
              >
                <LcIcon :name="l.icon" /><span>{{ l.label }}</span><LcIcon name="external" size="s" class="ext" />
              </a>
              <a v-else class="lm-link" :href="'#' + l.anchor" :data-nav="l.key" @click.prevent="go(l.anchor!)">
                <LcIcon :name="l.icon" /><span>{{ l.label }}</span><LcIcon name="chev" size="s" class="ext" />
              </a>
            </template>
          </nav>

          <div v-if="theme" class="lm-set" data-set="theme">
            <span :id="panelId + '-th'" class="lm-lab">{{ t('shell.theme.label') }}</span>
            <div class="lc-seg" role="radiogroup" :aria-labelledby="panelId + '-th'" @keydown="onSeg($event, THEME_PREFS, app.theme, setTheme)">
              <button
                v-for="o in THEME_PREFS" :key="o" type="button" role="radio" :class="{ on: o === app.theme }"
                :aria-checked="o === app.theme" :tabindex="o === app.theme ? 0 : -1" :data-theme-opt="o" @click="setTheme(o)"
              ><LcIcon :name="THEME_ICON[o]" size="s" />{{ t('shell.theme.' + o) }}</button>
            </div>
          </div>
          <div v-if="language" class="lm-set" data-set="language">
            <span :id="panelId + '-lg'" class="lm-lab">{{ t('auth.language') }}</span>
            <div class="lc-seg" role="radiogroup" :aria-labelledby="panelId + '-lg'" @keydown="onSeg($event, LOCALES, app.locale, app.setLocale)">
              <button
                v-for="l in LOCALE_OPTIONS" :key="l.value" type="button" role="radio" :class="{ on: l.value === app.locale }"
                :aria-checked="l.value === app.locale" :tabindex="l.value === app.locale ? 0 : -1" :lang="l.value" :data-locale-opt="l.value"
                @click="app.setLocale(l.value)"
              >{{ l.label }}</button>
            </div>
          </div>
        </div>
        <div class="lc-dialog-foot lm-foot">
          <router-link class="lc-btn" :class="{ primary: !app.registrationOpen }" to="/login" data-nav="login" @click="close()">{{ t('landing.nav.login') }}</router-link>
          <router-link v-if="app.registrationOpen" class="lc-btn primary" to="/register" data-nav="register" @click="close()">{{ t('landing.nav.register') }}</router-link>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 焦点和键盘用全站共用的 composables/useDialogFocus：打开后进面板第一项，Tab / Shift+Tab 在面板里打转，
 * Esc、点遮罩、点 × 关掉并把焦点还给按钮；
 * 点某一节的入口：关掉，页面滚到那一节（节顶留在吸顶页头下面，见 Landing.vue 的 scroll-margin-top），焦点落到那一节上。
 * 滚动：面板 Teleport 在页面滚动容器（.lp）之外，遮罩盖住整个视口，滚轮和手指都够不着后面的页面；
 * 面板自己滚到头也不往外传（overscroll-behavior）。
 * 窗口拉宽到页头放得下那些链接时（>820px）自己关掉。
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { LOCALE_OPTIONS } from '@/locales'
import { MessagePlugin } from '@/utils/feedback'
import { apiErrorMessage } from '@/utils/api'
import { THEME_PREFS, type ThemePref } from '@/composables/useTheme'
import { useDialogFocus } from '@/composables/useDialogFocus'
import LcIcon from '@/components/LcIcon.vue'

export interface LandingMenuLink {
  key: string
  label: string
  icon: string
  /** 页内的一节（元素 id） */
  anchor?: string
  /** 站外链接，新标签页打开 */
  href?: string
}

/** theme / language：菜单里有没有主题、语言那两行（集成方关了 features.themeSwitch / localeSwitch 时没有）；不给就是有 */
withDefaults(defineProps<{ links: LandingMenuLink[]; theme?: boolean; language?: boolean }>(), { theme: true, language: true })
const emit = defineEmits<{ (e: 'go', anchor: string): void }>()

const { t } = useI18n()
const app = useAppStore()

const THEME_ICON: Record<ThemePref, string> = { dark: 'moon', light: 'sun', system: 'monitor' }
const LOCALES = LOCALE_OPTIONS.map(l => l.value)
const panelId = 'lm-' + Math.random().toString(36).slice(2, 8)

const open = ref(false)
const btn = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)

useDialogFocus(panel, {
  active: open,
  onEscape: () => close(),
  initialFocus: () => panel.value?.querySelector<HTMLElement>('.lm-link'),
})

function show() { open.value = true }
function close() { open.value = false }
/** 去页内的一节：先关（焦点先还给按钮），等这一轮更新完再让页面滚过去、把焦点放到那一节上 */
async function go(anchor: string) {
  close()
  await nextTick()
  emit('go', anchor)
}

/** 单选组：方向键换一个，焦点跟过去 */
function onSeg<T extends string>(e: KeyboardEvent, list: readonly T[], cur: T, pick: (v: T) => unknown) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  e.preventDefault()
  const group = e.currentTarget as HTMLElement
  const next = list[(list.indexOf(cur) + step + list.length) % list.length]
  void pick(next)
  void nextTick(() => group.querySelectorAll<HTMLElement>('[role="radio"]')[list.indexOf(next)]?.focus())
}

async function setTheme(v: ThemePref) {
  try {
    await app.setTheme(v)
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('shell.theme.failed')))
  }
}
// 拉宽到页头自己放得下：关掉
let wide: MediaQueryList | null = null
const onWide = () => { if (wide?.matches) close() }
onMounted(() => {
  wide = window.matchMedia?.('(min-width: 821px)') || null
  wide?.addEventListener?.('change', onWide)
})
onBeforeUnmount(() => wide?.removeEventListener?.('change', onWide))

defineExpose({ close })
</script>

<style scoped>
.lm-btn {
  width: 36px; height: 36px; flex: none; display: none; place-items: center; padding: 0; border-radius: 10px;
  border: 1px solid var(--line-2); background: rgb(var(--c-film) / .06); color: var(--text); cursor: pointer;
  transition: border-color .15s, background .15s;
}
.lm-btn:hover, .lm-btn.on { border-color: var(--line-3); background: rgb(var(--c-film) / .12); }
.lm-btn:focus-visible { outline: none; border-color: var(--cyan); box-shadow: var(--ring); }
@media (max-width: 820px) { .lm-btn { display: grid; } }
/* 手机上手指点：和旁边的按钮一起放大到 40 */
@media (max-width: 600px) { .lm-btn { width: 40px; height: 40px; } }

/* 平板宽度：挂在页头右下角的一张小面板；手机宽度由 .lc-sheet 接手，贴底通栏 */
.lm-mask { align-items: flex-start; justify-content: flex-end; padding: 80px 24px 24px; overscroll-behavior: contain; }
.lm { width: 360px; outline: none; overscroll-behavior: contain; animation: lm-in .18s ease-out; }
.lm-body { padding: 12px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; overscroll-behavior: contain; }
.lm-nav { display: grid; gap: 2px; padding-bottom: 8px; margin-bottom: 8px; border-bottom: 1px solid var(--line); }
/* 主题、语言两行都被集成方关掉时，入口下面什么也没有：不留那条分隔线 */
.lm-nav:last-child { padding-bottom: 0; margin-bottom: 0; border-bottom: 0; }
.lm-link {
  display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 0 12px; border-radius: 10px;
  color: var(--text); font-size: 15px; text-decoration: none;
}
.lm-link > svg:first-child { color: var(--cyan); flex: none; }
.lm-link > span { flex: 1; min-width: 0; }
.lm-link .ext { color: var(--text-3); flex: none; }
.lm-link:hover { background: rgb(var(--c-film) / .1); text-decoration: none; }
.lm-link:focus-visible { outline: none; background: rgb(var(--c-film) / .1); box-shadow: var(--ring); }
/* 一行放不下（320px 的手机 + 英文的三个主题选项）：选项折到标签下面一行，不把面板撑宽 */
.lm-set { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; min-height: 48px; padding: 4px 12px; }
.lm-lab { color: var(--text-2); font-size: 14px; flex: none; }
.lm-set .lc-seg { min-width: 0; }
.lm-set .lc-seg > button { height: 32px; }
.lm-set .lc-seg > button:focus-visible { outline: none; box-shadow: var(--ring); }
.lm-foot { gap: 12px; }
.lm-foot .lc-btn { flex: 1; height: 44px; font-size: 15px; }
@keyframes lm-in { from { opacity: 0; transform: translateY(-6px); } }

@media (max-width: 600px) {
  .lm-mask { align-items: flex-end; padding: 0; }
  .lm { animation-name: lm-up; padding-bottom: env(safe-area-inset-bottom, 0px); }
  /* 三个主题选项加图标在 360px 的手机上会挤：字号不动，收一点内边距 */
  .lm-set .lc-seg > button { padding: 0 10px; }
}
@keyframes lm-up { from { opacity: .6; transform: translateY(24px); } }
@media (prefers-reduced-motion: reduce) { .lm { animation: none; } }
</style>
