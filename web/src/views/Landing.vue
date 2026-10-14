<template>
  <div ref="lp" class="lp">
    <header class="lp-nav">
      <LcLogo to="/" />
      <nav class="lp-links" :aria-label="t('shell.navLabel')">
        <a href="#features">{{ t('landing.nav.features') }}</a>
        <a href="#integration">{{ t('landing.nav.integration') }}</a>
        <a v-if="$feat.externalLinks" :href="LINKS.docs" target="_blank" rel="noopener">{{ t('landing.nav.docs') }}</a>
        <a href="#open-source">{{ t('landing.nav.open') }}</a>
      </nav>
      <span class="lc-sp" />
      <!-- 语言、主题、站外链接都听集成方的开关（features.localeSwitch / themeSwitch / externalLinks）：关了的这一页上哪儿都不出现 -->
      <LcSelect
        v-if="$feat.localeSwitch"
        class="lp-lang" size="sm" auto-width :model-value="app.locale" :options="LOCALE_OPTIONS"
        :aria-label="t('auth.language')" @update:model-value="app.setLocale"
      />
      <ThemeSwitch v-if="$feat.themeSwitch" class="lp-theme" plain />
      <a v-if="$feat.externalLinks" class="lc-btn ghost src" :href="LINKS.repo" target="_blank" rel="noopener"><LcIcon name="branch" />{{ t('landing.nav.source') }}</a>
      <!-- 注册关着的时候「登录」是页头上唯一的去处：给它主按钮的样子 -->
      <router-link class="lc-btn login" :class="{ only: !app.registrationOpen, primary: !app.registrationOpen }" to="/login">{{ t('landing.nav.login') }}</router-link>
      <router-link v-if="app.registrationOpen" class="lc-btn primary" to="/register">{{ t('landing.nav.register') }}</router-link>
      <!-- ≤820px：上面的链接、语言、主题、源码都收进这个菜单 -->
      <LandingMenu :links="menuLinks" :theme="$feat.themeSwitch" :language="$feat.localeSwitch" @go="goSection" />
    </header>

    <section class="lp-hero">
      <span class="kick"><i />{{ t('landing.kick') }}</span>
      <h1>{{ t('landing.h1a') }}<br /><span class="lc-gt">{{ t('landing.h1b') }}</span></h1>
      <p class="lead">{{ t('landing.lead') }}</p>
      <div class="lp-cta">
        <router-link class="lc-btn primary lg" :to="startTo">{{ t('landing.start') }}<LcIcon name="arrow" /></router-link>
        <a v-if="$feat.externalLinks" class="lc-btn lg" :href="LINKS.docs" target="_blank" rel="noopener">{{ t('landing.viewDocs') }}</a>
      </div>
      <div class="lp-meta">
        <span><LcIcon name="check" size="s" />{{ t('landing.meta1') }}</span>
        <span><LcIcon name="check" size="s" />{{ t('landing.meta2') }}</span>
        <span><LcIcon name="check" size="s" />{{ t('landing.metaTeam') }}</span>
        <span><LcIcon name="check" size="s" />{{ t('landing.meta3') }}</span>
        <span><LcIcon name="check" size="s" />{{ t('landing.meta4') }}</span>
      </div>
      <HeroCanvas />
    </section>

    <section id="features" class="lp-sec" tabindex="-1">
      <div class="eyebrow">{{ t('landing.featEyebrow') }}</div>
      <h2>{{ t('landing.featTitle') }}</h2>
      <div class="tiles">
        <div v-for="f in FEATS" :key="f.k" class="tile lc-glass">
          <span class="ti"><LcIcon :name="f.icon" size="l" /></span>
          <div><h3>{{ t(`landing.feats.${f.k}T`) }}</h3><p>{{ t(`landing.feats.${f.k}D`) }}</p></div>
        </div>
      </div>
      <!-- 八块正好排满四列 / 两列 / 一列，哪个宽度都不留孤块；「可集成」在它们下面单独占一整行 -->
      <div class="tile lc-glass wide">
        <span class="ti"><LcIcon name="panel" size="l" /></span>
        <div><h3>{{ t('landing.feats.embedT') }}</h3><p>{{ t('landing.feats.embedD') }}</p></div>
        <a class="lc-btn" href="#integration">{{ t('landing.feats.embedLink') }}<LcIcon name="arrow" /></a>
      </div>
    </section>

    <section id="integration" class="lp-sec" tabindex="-1">
      <div class="eyebrow">{{ t('landing.integ.eyebrow') }}</div>
      <h2>{{ t('landing.integ.title') }}</h2>
      <p class="sub">{{ t('landing.integ.sub') }}</p>
      <IntegrationCards />
    </section>

    <section class="lp-sec">
      <div class="eyebrow">{{ t('landing.stepsEyebrow') }}</div>
      <h2>{{ t('landing.stepsTitle') }}</h2>
      <div class="steps">
        <div class="step">
          <span class="no">1</span>
          <div class="lc-glass card">
            <h3>{{ t('landing.steps.t1') }}</h3><p>{{ t('landing.steps.d1') }}</p>
            <div class="code"><span class="c">$</span> docker compose up -d<br /><span class="c">{{ t('landing.steps.open') }}</span></div>
          </div>
        </div>
        <div class="step">
          <span class="no">2</span>
          <div class="lc-glass card">
            <h3>{{ t('landing.steps.t2') }}</h3><p>{{ t('landing.steps.d2') }}</p>
            <div class="lc-row demo" aria-hidden="true">
              <div class="lc-inp fake"><LcIcon name="key" /><span class="lc-mono">sk-··············1234</span></div>
              <span class="lc-st ok">{{ t('landing.steps.keyOk') }}</span>
            </div>
          </div>
        </div>
        <div class="step">
          <span class="no">3</span>
          <div class="lc-glass card">
            <h3>{{ t('landing.steps.t3') }}</h3><p>{{ t('landing.steps.d3') }}</p>
            <div class="lc-row demo chain" aria-hidden="true">
              <span class="lc-chip o"><LcIcon name="text" size="s" />{{ t('landing.steps.chipPrompt') }}</span>
              <LcIcon name="arrow" size="s" class="arr" />
              <span class="lc-chip o"><LcIcon name="image" size="s" />{{ t('landing.steps.chipImage') }}</span>
              <LcIcon name="arrow" size="s" class="arr" />
              <span class="lc-chip o"><LcIcon name="video" size="s" />{{ t('landing.steps.chipVideo') }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section id="open-source" class="lp-sec" tabindex="-1">
      <div class="oss lc-glass lc-gb">
        <div>
          <div class="eyebrow">{{ t('landing.ossEyebrow') }}</div>
          <h2>{{ t('landing.ossTitle') }}</h2>
          <p class="sub">{{ t('landing.ossSub') }}</p>
          <div v-if="$feat.externalLinks" class="lc-row oss-act">
            <a class="lc-btn primary" :href="LINKS.repo" target="_blank" rel="noopener"><LcIcon name="branch" />{{ t('landing.ossSource') }}</a>
            <a class="lc-btn" :href="LINKS.commercial" target="_blank" rel="noopener">{{ t('landing.ossCommercial') }}</a>
          </div>
        </div>
        <div class="lic"><span class="lc-bd img">{{ t('landing.licBadge') }}</span><h3>AGPL-3.0</h3><p>{{ t('landing.licBody') }}</p></div>
        <div class="lic"><span class="lc-bd vid">{{ t('landing.comBadge') }}</span><h3>{{ t('landing.comTitle') }}</h3><p>{{ t('landing.comBody') }}</p></div>
      </div>
    </section>

    <!-- 站外链接关了：页脚只剩页内的那一栏（「资源」「开源」两栏全是站外链接，整栏不出） -->
    <footer class="lp-foot" :class="{ few: !$feat.externalLinks }">
      <div><LcLogo /><p class="blurb">{{ t('landing.foot.blurb') }}</p></div>
      <div><h4>{{ t('landing.foot.product') }}</h4><a href="#features">{{ t('landing.foot.features') }}</a><a v-if="!$feat.externalLinks" href="#integration">{{ t('landing.nav.integration') }}</a><a v-if="$feat.externalLinks" :href="LINKS.changelog" target="_blank" rel="noopener">{{ t('landing.foot.changelog') }}</a></div>
      <div v-if="$feat.externalLinks"><h4>{{ t('landing.foot.resources') }}</h4><a :href="LINKS.docs" target="_blank" rel="noopener">{{ t('landing.foot.docs') }}</a><a :href="LINKS.deployment" target="_blank" rel="noopener">{{ t('landing.foot.deploy') }}</a><a :href="LINKS.faq" target="_blank" rel="noopener">{{ t('landing.foot.faq') }}</a></div>
      <div v-if="$feat.externalLinks"><h4>{{ t('landing.foot.open') }}</h4><a :href="LINKS.repo" target="_blank" rel="noopener">{{ t('landing.foot.source') }}</a><a :href="LINKS.license" target="_blank" rel="noopener">{{ t('landing.foot.license') }}</a><a :href="LINKS.commercial" target="_blank" rel="noopener">{{ t('landing.foot.commercial') }}</a></div>
      <div class="copy">
        <span>{{ t('landing.foot.copy', { year: YEAR }) }}</span>
        <span v-if="$feat.localeSwitch" class="langs">
          <button v-for="l in LOCALE_OPTIONS" :key="l.value" :class="{ on: app.locale === l.value }" @click="app.setLocale(l.value)">{{ l.label }}</button>
        </span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { LOCALE_OPTIONS } from '@/locales'
import { LINKS } from '@/utils/links'
import LcLogo from '@/components/LcLogo.vue'
import ThemeSwitch from '@/components/ThemeSwitch.vue'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import HeroCanvas from '@/components/landing/HeroCanvas.vue'
import IntegrationCards from '@/components/landing/IntegrationCards.vue'
import LandingMenu, { type LandingMenuLink } from '@/components/landing/LandingMenu.vue'
import { useEmbed } from '@/embed/context'

const { t } = useI18n()
const app = useAppStore()
const embed = useEmbed()

/** 八块：4 / 2 / 1 列都能排满。加减一块之前先想好孤块怎么办 */
const FEATS = [
  { k: 'canvas', icon: 'infinite' }, { k: 'key', icon: 'key' }, { k: 'gen', icon: 'video' }, { k: 'team', icon: 'users' },
  { k: 'queue', icon: 'queue' }, { k: 'tool', icon: 'tool' }, { k: 'look', icon: 'settings' }, { k: 'host', icon: 'server' },
] as const
const YEAR = new Date().getFullYear()

/** 能注册就去注册，注册关了就去登录 */
const startTo = computed(() => (app.registrationOpen ? '/register' : '/login'))

/** 窄屏菜单里的入口：和页头那一排是同一组，多一个「源码」。站外的两项听 features.externalLinks */
const menuLinks = computed<LandingMenuLink[]>(() => [
  { key: 'features', label: t('landing.nav.features'), icon: 'bolt', anchor: 'features' },
  { key: 'integration', label: t('landing.nav.integration'), icon: 'panel', anchor: 'integration' },
  { key: 'open', label: t('landing.nav.open'), icon: 'shield', anchor: 'open-source' },
  ...(embed.features.externalLinks ? [
    { key: 'docs', label: t('landing.nav.docs'), icon: 'book', href: LINKS.docs },
    { key: 'source', label: t('landing.nav.source'), icon: 'branch', href: LINKS.repo },
  ] : []),
])

/**
 * 从菜单去某一节：滚过去（节顶停在吸顶页头下面，靠 .lp-sec 的 scroll-margin-top），地址栏带上 #，
 * 焦点落到那一节上 —— 菜单关了以后键盘和读屏都从那一节接着往下走。
 */
const lp = ref<HTMLElement | null>(null)
function goSection(id: string) {
  const el = lp.value?.querySelector<HTMLElement>('#' + CSS.escape(id))
  if (!el) return
  const calm = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' })
  el.focus({ preventScroll: true })
  try { history.replaceState(history.state, '', '#' + id) } catch { /* 改不了地址栏不影响滚动 */ }
}
</script>

<style scoped>
.lp { height: 100%; overflow-y: auto; overflow-x: hidden; scroll-behavior: smooth; }
.lp-nav {
  position: sticky; top: 0; z-index: 30; height: 72px; display: flex; align-items: center; gap: 12px; padding: 0 max(24px, calc((100% - 1200px) / 2));
  border-bottom: 1px solid var(--line); background: rgb(var(--c-chrome-0) / .72);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
}
.lp-links { display: flex; gap: 32px; margin-left: 44px; }
.lp-links a { color: var(--text-2); font-size: 14px; }
.lp-links a:hover { color: var(--text); text-decoration: none; }
.lp-lang :deep(.lcs-trigger) { background: none; border-color: transparent; color: var(--text-2); }

.lp-hero { padding: 80px max(24px, calc((100% - 1200px) / 2)) 0; text-align: center; }
.kick {
  display: inline-flex; align-items: center; gap: 8px; min-height: 30px; padding: 4px 14px; border-radius: 15px;
  border: 1px solid var(--line-3); background: rgb(var(--c-blue) / .12); color: var(--cyan-soft); font-size: 13px;
}
.kick i { width: 6px; height: 6px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 8px rgb(var(--g-cyan)); flex: none; }
.lp-hero h1 { font: 700 60px/1.18 var(--f-disp); letter-spacing: -.01em; margin-top: 24px; color: var(--text); }
.lead { font-size: 18px; line-height: 1.75; color: var(--text-2); max-width: 720px; margin: 24px auto 0; }
.lp-cta { display: flex; justify-content: center; gap: 16px; margin-top: 40px; flex-wrap: wrap; }
.lp-meta { display: flex; justify-content: center; gap: 8px 24px; margin-top: 24px; color: var(--text-3); font-size: 13px; flex-wrap: wrap; }
.lp-meta span { display: inline-flex; align-items: center; gap: 6px; }
.lp-meta svg { color: var(--cyan); }

/* 节顶自带一大段留白：滚到某一节时让标题落在吸顶页头下面一点，而不是把整段留白都露出来 */
.lp-sec { padding: 112px max(24px, calc((100% - 1200px) / 2)) 0; scroll-margin-top: 40px; }
.lp-sec:focus { outline: none; }
.eyebrow { font: 500 12px var(--f-mono); letter-spacing: .16em; color: var(--cyan); }
.lp-sec h2 { font: 600 34px/1.3 var(--f-disp); margin-top: 12px; color: var(--text); }
.sub { color: var(--text-2); font-size: 16px; margin-top: 12px; max-width: 640px; }

/* 八块：宽屏四列两排，≤1100px 两列四排，手机一列。grid-auto-rows 让每一排一样高 */
.tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: 1fr; gap: 24px; margin-top: 48px; }
/* 四列时一块不到 290px 宽：图标放在文字上面，文字用满整块的宽度；两列、一列时图标回到左边 */
.tile { display: flex; flex-direction: column; gap: 16px; padding: 24px; }
.tile > div { min-width: 0; }
.ti {
  width: 48px; height: 48px; border-radius: 14px; flex: none; display: grid; place-items: center; color: var(--cyan);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .18), rgb(var(--c-violet) / .22)); box-shadow: 0 0 0 1px rgb(var(--c-cyan) / .35) inset;
}
.tile h3 { font: 600 17px/1.4 var(--f-disp); color: var(--text); }
.tile p { color: var(--text-2); font-size: 14px; line-height: 1.7; margin-top: 6px; }
.tile.wide { flex-direction: row; align-items: center; margin-top: 24px; }
.tile.wide > div { flex: 1; min-width: 0; }
.tile.wide .lc-btn { flex: none; }

.steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin-top: 48px; position: relative; }
.steps::before { content: ''; position: absolute; left: 44px; right: 44px; top: 20px; height: 2px; background: var(--grad); opacity: .5; }
.step { min-width: 0; }
.no {
  position: relative; width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center;
  font: 600 15px var(--f-disp); background: var(--port-bg); border: 1px solid var(--cyan); color: var(--cyan-soft); box-shadow: 0 0 16px rgb(var(--g-cyan) / .35);
}
.step .card { margin-top: 20px; padding: 24px; min-height: 176px; border-radius: var(--r-md); }
.step h3 { font: 600 18px/1.4 var(--f-disp); color: var(--text); }
.step p { color: var(--text-2); margin-top: 6px; }
.code { margin-top: 16px; border-radius: 10px; background: var(--well); border: 1px solid var(--line); padding: 12px 14px; font: 13px/1.7 var(--f-mono); color: var(--cyan-soft); overflow-x: auto; white-space: nowrap; }
.code .c { color: var(--text-3); }
.demo { margin-top: 16px; flex-wrap: wrap; }
.fake { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; }
.chain { gap: 10px; }
.arr { color: var(--cyan); }

.oss { display: grid; grid-template-columns: minmax(0, 1fr) 320px 320px; gap: 24px; padding: 40px; border-radius: 22px; align-items: stretch; }
.oss h2 { margin-top: 12px; }
.oss-act { margin-top: 28px; gap: 12px; flex-wrap: wrap; }
.lic { padding: 24px; border-radius: 14px; border: 1px solid var(--line-2); background: rgb(var(--c-well) / .4); }
.lic h3 { font: 600 18px var(--f-disp); margin-top: 12px; color: var(--text); }
.lic p { color: var(--text-2); font-size: 13px; line-height: 1.7; margin-top: 8px; }

.lp-foot {
  margin-top: 112px; padding: 48px max(24px, calc((100% - 1200px) / 2)) 40px; border-top: 1px solid var(--line); background: rgb(var(--c-chrome-0) / .6);
  display: grid; grid-template-columns: minmax(0, 1fr) 160px 160px 160px; gap: 32px;
}
.blurb { margin-top: 12px; font-size: 13px; max-width: 320px; color: var(--text-3); }
.lp-foot h4 { font: 600 13px var(--f-disp); color: var(--text); margin-bottom: 12px; }
.lp-foot a { display: block; color: var(--text-2); font-size: 13px; line-height: 2.1; }
.lp-foot a:hover { color: var(--cyan-soft); text-decoration: none; }
.copy { grid-column: 1 / -1; border-top: 1px solid var(--line); padding-top: 24px; color: var(--text-3); font-size: 12px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.langs { display: flex; gap: 4px; }
.langs button { border: 0; background: none; color: var(--text-3); font-size: 12px; padding: 0 6px; border-radius: 6px; }
.langs button:hover, .langs button.on { color: var(--text); }

.lp-foot.few { grid-template-columns: minmax(0, 1fr) 160px; }

@media (max-width: 1100px) {
  .lp-hero h1 { font-size: 46px; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tile { flex-direction: row; }
  .oss { grid-template-columns: 1fr 1fr; }
  .oss > :first-child { grid-column: 1 / -1; }
  .lp-links { margin-left: 16px; gap: 20px; }
}
@media (max-width: 820px) {
  .lp-nav .lp-links, .lp-nav .src, .lp-nav .lp-lang, .lp-nav .lp-theme { display: none; }
  .steps { grid-template-columns: 1fr; }
  .steps::before { display: none; }
  .lp-sec { padding-top: 72px; }
  .lp-foot { grid-template-columns: 1fr 1fr 1fr; margin-top: 72px; }
  .lp-foot.few { grid-template-columns: 1fr; }
  .lp-foot > :first-child { grid-column: 1 / -1; }
}
@media (max-width: 600px) {
  .lp-nav { height: 60px; padding: 0 16px; gap: 8px; }
  .lp-nav .lc-btn { height: 40px; padding: 0 14px; }
  /* 手机上页头只留一个去处（能注册就是注册），登录在菜单里 */
  .lp-nav .login:not(.only) { display: none; }
  .lp-hero { padding: 40px 16px 0; }
  .lp-hero h1 { font-size: 30px; line-height: 1.25; }
  .lead { font-size: 15px; margin-top: 16px; }
  .lp-cta { margin-top: 28px; gap: 12px; }
  .lp-cta .lc-btn { flex: 1 1 100%; }
  /* 五项在手机上折成两三行：列间距收一点，中文正好 3 + 2 */
  .lp-meta { column-gap: 16px; }
  .lp-sec { padding: 56px 16px 0; }
  .lp-sec h2 { font-size: 24px; }
  .tiles { grid-template-columns: 1fr; grid-auto-rows: auto; gap: 12px; margin-top: 28px; }
  .tile { padding: 18px; }
  .tile.wide { flex-wrap: wrap; align-items: flex-start; margin-top: 12px; }
  .tile.wide > div { flex: 1 1 0; }
  .tile.wide .lc-btn { flex: 1 1 100%; }
  .steps { margin-top: 28px; }
  .oss { grid-template-columns: 1fr; padding: 24px 20px; }
  .lp-foot { padding: 32px 16px 28px; grid-template-columns: 1fr 1fr; gap: 24px; }
  .lp-foot.few { grid-template-columns: 1fr; }
}
</style>
