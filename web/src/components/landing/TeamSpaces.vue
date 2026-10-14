<template>
  <!-- 落地页「团队空间」一节的主体：左边是画出来的团队首页（空间切换器、成员和本月用量、一张有人正在编辑的画布、团队的服务商），
       右边五条要点，下面一排三条「先说清楚」。图是 HTML / CSS 画的，字都是本来的大小（最小 12px），颜色全部取令牌。
       这里的每一条都要对得上产品（docs/user-guide 的「团队」一章）：团队那边的规则改了，这里跟着改。 -->
  <div class="tm">
    <div class="tm-main">
      <div class="tm-win lc-glass" role="img" :aria-label="t('landing.team.alt')">
        <div aria-hidden="true">
          <div class="tm-bar">
            <span class="tm-sw"><i class="ava sq">{{ first(t('landing.team.art.name')) }}</i><b>{{ t('landing.team.art.name') }}</b><LcIcon name="chevd" size="s" /></span>
            <span class="lc-tag accent">{{ t('landing.team.art.owner') }}</span>
            <span class="lc-sp" />
            <span class="tm-n"><LcIcon name="users" size="s" />{{ t('landing.team.art.members', { n: 3 }) }}</span>
          </div>
          <div class="tm-body">
            <div class="tm-blk">
              <div class="tm-lab">{{ t('landing.team.art.usage') }}</div>
              <div v-for="m in MEMBERS" :key="m.k" class="tm-m" :class="{ near: m.near }">
                <i class="ava">{{ first(t(`landing.team.art.${m.k}`)) }}</i>
                <span class="who"><b>{{ t(`landing.team.art.${m.k}`) }}</b><span class="lc-tag" :class="{ accent: m.role === 'owner' }">{{ t(`landing.team.art.${m.role}`) }}</span></span>
                <span class="bar"><i :style="{ width: m.used + '%' }" /></span>
                <span class="num">{{ t('landing.team.art.runs', { used: m.used, limit: 100 }) }}</span>
              </div>
            </div>
            <div class="tm-blk cv">
              <div class="tm-cv">
                <svg class="pic" viewBox="0 0 120 60" preserveAspectRatio="xMidYMid slice">
                  <rect class="p-sky" width="120" height="60" /><circle class="p-moon" cx="92" cy="16" r="6" />
                  <path class="p-far" d="M0 44l22-16 16 10 20-18 26 20 14-8 22 14v14H0z" /><path class="p-near" d="M0 52l30-12 24 8 28-12 38 14v10H0z" />
                </svg>
                <div class="tm-cv-t">
                  <b>{{ t('landing.team.art.canvas') }}</b>
                  <span class="lc-chip o"><LcIcon name="users" size="s" />{{ t('landing.team.art.teamEdit') }}</span>
                </div>
              </div>
              <div class="tm-lock">
                <i class="ava">{{ first(t('landing.team.art.m2')) }}</i>
                <span>{{ t('landing.team.art.editing', { name: t('landing.team.art.m2') }) }}</span>
                <span class="lc-btn sm">{{ t('landing.team.art.takeOver') }}</span>
              </div>
            </div>
            <div class="tm-blk tm-prov">
              <LcIcon name="key" /><b>OpenAI</b><span class="lc-st ok">{{ t('landing.team.art.usable') }}</span>
              <span class="lc-sp" /><span class="lc-chip">{{ t('landing.team.art.keyByTeam') }}</span>
            </div>
          </div>
        </div>
      </div>

      <ul class="tm-pts">
        <li v-for="p in POINTS" :key="p.k">
          <span class="pi"><LcIcon :name="p.icon" /></span>
          <div><h3>{{ t(`landing.team.${p.k}T`) }}</h3><p>{{ t(`landing.team.${p.k}D`) }}</p></div>
        </li>
      </ul>
    </div>

    <ul class="tm-notes">
      <li v-for="n in NOTES" :key="n.k"><LcIcon :name="n.icon" /><div><b>{{ t(`landing.team.${n.k}T`) }}</b><p>{{ t(`landing.team.${n.k}D`) }}</p></div></li>
    </ul>

    <!-- 站外链接听集成方的开关（features.externalLinks）：关了就没有这一行 -->
    <div v-if="$feat.externalLinks" class="tm-end">
      <a class="lc-btn" :href="LINKS.teams" target="_blank" rel="noopener"><LcIcon name="book" />{{ t('landing.team.link') }}</a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { LINKS } from '@/utils/links'
import LcIcon from '@/components/LcIcon.vue'

const { t } = useI18n()

/** 图里的三个人：用量是示意的，「接近上限」那一位用琥珀色（产品里用到上限的 80% 起就是这个颜色） */
const MEMBERS = [
  { k: 'm1', role: 'owner', used: 24, near: false },
  { k: 'm2', role: 'admin', used: 62, near: false },
  { k: 'm3', role: 'member', used: 91, near: true },
] as const
const POINTS = [
  { k: 'p1', icon: 'users' }, { k: 'p2', icon: 'key' }, { k: 'p3', icon: 'folder' }, { k: 'p4', icon: 'edit' }, { k: 'p5', icon: 'history' },
] as const
const NOTES = [{ k: 'n1', icon: 'info' }, { k: 'n2', icon: 'mail' }, { k: 'n3', icon: 'lock' }] as const

/** 头像上的那一个字 */
const first = (s: string) => [...s][0] || ''
</script>

<style scoped>
.tm { margin-top: 48px; }
.tm-main { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); gap: 48px; align-items: center; }

/* ---- 左：团队首页的示意 ---- */
.tm-win { min-width: 0; overflow: hidden; box-shadow: var(--sh-2); font-size: 13px; }
.tm-bar { min-height: 52px; display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 8px 16px; border-bottom: 1px solid var(--line); }
.tm-sw { display: inline-flex; align-items: center; gap: 8px; height: 34px; min-width: 0; padding: 0 10px 0 5px; border-radius: 10px; border: 1px solid var(--line-2); background: rgb(var(--c-film) / .06); color: var(--text-3); }
.tm-sw b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; color: var(--text); }
.tm-n { display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 12px; white-space: nowrap; }
.ava { width: 26px; height: 26px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--grad-avatar); color: var(--text-inv); font: 600 12px/1 var(--f-disp); }
.ava.sq { width: 24px; height: 24px; border-radius: 7px; }
.tm-body { display: grid; gap: 12px; padding: 16px; }
.tm-blk { min-width: 0; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: rgb(var(--c-well) / .45); }
.tm-lab { margin-bottom: 4px; color: var(--text-3); font-size: 12px; }
.tm-m { display: grid; grid-template-columns: 26px 136px minmax(32px, 1fr) auto; align-items: center; gap: 10px; min-height: 40px; }
.tm-m + .tm-m { border-top: 1px solid var(--line); }
.who { display: flex; align-items: center; gap: 8px; min-width: 0; }
.who b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; color: var(--text); }
.who .lc-tag { flex: none; }
.bar { height: 6px; border-radius: 3px; background: rgb(var(--c-film) / .14); overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 3px; background: var(--cyan); }
.num { color: var(--text-2); font: 12px/1 var(--f-mono); white-space: nowrap; text-align: right; }
.tm-m.near .bar i { background: var(--warn); }
.tm-m.near .num { color: var(--warn); }

.tm-blk.cv { padding: 0; overflow: hidden; }
.tm-cv { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
.pic { width: 84px; height: 54px; flex: none; border-radius: 8px; }
.p-sky { fill: var(--art-sky-1); }
.p-moon { fill: var(--art-moon); }
.p-far { fill: var(--art-b1); }
.p-near { fill: var(--art-b2); }
.tm-cv-t { min-width: 0; display: grid; justify-items: start; gap: 8px; }
.tm-cv-t b { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 14px; color: var(--text); }
/* 「某某 正在编辑」那一条：和编辑器里只读提示条一样，琥珀色的边 */
.tm-lock { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 8px 10px 8px 14px; border-top: 1px solid rgb(var(--c-warn) / .45); background: rgb(var(--c-warn) / .08); color: var(--text); }
.tm-lock > span:not(.lc-btn) { flex: 1 1 auto; min-width: 0; }
.tm-lock .lc-btn { pointer-events: none; flex: none; }
.tm-prov { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; }
.tm-prov > :deep(.lc-ic) { color: var(--cyan); flex: none; }
.tm-prov b { font-weight: 600; color: var(--text); }
.tm-prov .lc-st { font-size: 12px; }

/* ---- 右：五条要点 ---- */
.tm-pts { list-style: none; margin: 0; padding: 0; display: grid; gap: 22px; min-width: 0; }
.tm-pts li { display: flex; gap: 16px; min-width: 0; }
.tm-pts li > div { min-width: 0; }
.pi {
  width: 40px; height: 40px; flex: none; border-radius: 12px; display: grid; place-items: center; color: var(--cyan);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .18), rgb(var(--c-violet) / .22)); box-shadow: 0 0 0 1px rgb(var(--c-cyan) / .35) inset;
}
.tm-pts h3 { font: 600 17px/1.4 var(--f-disp); color: var(--text); }
.tm-pts p { margin-top: 4px; color: var(--text-2); font-size: 14px; line-height: 1.7; }

/* ---- 下：三条「先说清楚」 ---- */
.tm-notes { list-style: none; margin: 40px 0 0; padding: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
.tm-notes li { display: flex; gap: 12px; min-width: 0; padding: 16px 18px; border-radius: 14px; border: 1px solid var(--line-2); background: rgb(var(--c-well) / .4); }
.tm-notes li > :deep(.lc-ic) { flex: none; margin-top: 2px; color: var(--text-3); }
.tm-notes b { font: 600 15px/1.4 var(--f-disp); color: var(--text); }
.tm-notes p { margin-top: 4px; color: var(--text-2); font-size: 13px; line-height: 1.7; }
.tm-end { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 28px; }

@media (max-width: 1100px) {
  .tm-main { gap: 32px; }
  .tm-notes { gap: 16px; }
}
@media (max-width: 820px) {
  .tm-main { grid-template-columns: minmax(0, 1fr); }
  .tm-notes { grid-template-columns: minmax(0, 1fr); gap: 12px; margin-top: 32px; }
}
@media (max-width: 600px) {
  .tm { margin-top: 28px; }
  .tm-main { gap: 28px; }
  .tm-bar { padding: 8px 12px; }
  .tm-body { padding: 12px; gap: 10px; }
  .tm-blk { padding: 10px 12px; }
  /* 手机上一行放不下「名字 + 角色 + 进度条 + 数字」：进度条换到第二行 */
  .tm-m { grid-template-columns: 26px minmax(0, 1fr) auto; gap: 6px 10px; padding: 8px 0; }
  .tm-m .bar { grid-column: 2 / -1; grid-row: 2; }
  .tm-cv { padding: 10px 12px; }
  .tm-lock { padding: 8px 10px 8px 12px; }
  .tm-pts { gap: 18px; }
  .tm-pts li { gap: 12px; }
  .tm-end .lc-btn { flex: 1 1 auto; }
}
</style>
