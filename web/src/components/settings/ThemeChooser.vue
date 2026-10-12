<template>
  <div class="thc" role="radiogroup" :aria-labelledby="labelledby">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="thc-card"
      :class="{ on: o.value === modelValue }"
      role="radio"
      :aria-checked="o.value === modelValue"
      :disabled="disabled"
      :data-testid="`theme-card-${o.value}`"
      @click="emit('update:modelValue', o.value)"
    >
      <!-- 预览图是画出来的示意，不是截图。每一半都套着那一套主题的整组令牌（.lc-theme-dark / .lc-theme-light），
           所以颜色永远和真实界面一致；「跟随系统」斜着各画一半。 -->
      <span class="thc-thumb" aria-hidden="true">
        <span v-for="side in o.sides" :key="side" class="thc-side" :class="[`lc-theme-${side}`, { half: o.sides.length > 1 }]">
          <svg viewBox="0 0 168 104" preserveAspectRatio="xMidYMid slice">
            <rect class="bg" width="168" height="104" />
            <path class="grid" d="M0 26h168M0 52h168M0 78h168M42 0v104M84 0v104M126 0v104" />
            <rect class="bar" width="168" height="14" />
            <rect class="logo" x="6" y="4" width="6" height="6" rx="2" />
            <path class="t3" d="M16 7h18" />
            <circle class="av" cx="158" cy="7" r="3.2" />
            <rect class="side" y="14" width="26" height="90" />
            <rect class="nav on" x="4" y="20" width="18" height="7" rx="2.5" />
            <path class="t3" d="M7 34.500h12M7 43.500h12M7 52.500h12" />
            <path class="t1" d="M36 25h34" />
            <rect class="btn" x="136" y="20" width="24" height="9" rx="3" />
            <rect class="card" x="36" y="36" width="58" height="60" rx="5" />
            <rect class="media" x="41" y="41" width="48" height="26" rx="3" />
            <path class="art" d="M41 61l10-9 8 6 9-10 21 15v1a3 3 0 0 1-3 3H44a3 3 0 0 1-3-3z" />
            <path class="t2" d="M41 75h30" /><path class="t3" d="M41 82h42M41 88h24" />
            <rect class="card" x="102" y="36" width="58" height="28" rx="5" />
            <circle class="ok" cx="109" cy="44" r="1.8" /><path class="t2" d="M114 44h26" /><path class="t3" d="M108 53h44" />
            <rect class="card" x="102" y="70" width="58" height="26" rx="5" />
            <rect class="well" x="107" y="75" width="48" height="8" rx="2.5" /><path class="t3" d="M107 90h20" />
            <path class="wire" d="M94 52c5 0 3-4 8-4" />
            <circle class="port" cx="94" cy="52" r="2" /><circle class="port" cx="102" cy="48" r="2" />
          </svg>
        </span>
      </span>
      <span class="thc-name"><LcIcon :name="o.icon" size="s" />{{ o.name }}<i v-if="o.value === 'dark'" class="lc-chip">{{ t('settings.appearance.themeDefault') }}</i></span>
      <span class="thc-desc">{{ o.desc }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * 「主题」三选一：每张卡片是这套主题的示意图 + 名字 + 一句话说明，点了就生效。和「节点布局」的选择卡是同一种样式。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import type { ThemeName, ThemePref } from '@/composables/useTheme'

defineProps<{ modelValue: ThemePref; disabled?: boolean; labelledby?: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: ThemePref): void }>()
const { t } = useI18n()

const options = computed<{ value: ThemePref; icon: string; name: string; desc: string; sides: ThemeName[] }[]>(() => [
  { value: 'dark', icon: 'moon', name: t('settings.appearance.themeDark'), desc: t('settings.appearance.themeDarkDesc'), sides: ['dark'] },
  { value: 'light', icon: 'sun', name: t('settings.appearance.themeLight'), desc: t('settings.appearance.themeLightDesc'), sides: ['light'] },
  { value: 'system', icon: 'monitor', name: t('settings.appearance.themeSystem'), desc: t('settings.appearance.themeSystemDesc'), sides: ['dark', 'light'] },
])
</script>

<style scoped>
.thc { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; width: 100%; }
.thc-card {
  display: grid; align-content: start; gap: 8px; min-width: 0; padding: 10px 10px 12px; border-radius: var(--r-md);
  border: 1px solid var(--line-2); background: rgb(var(--c-film) / .04); color: var(--text-2); text-align: left; cursor: pointer;
  transition: border-color .15s ease, background .15s ease, box-shadow .15s ease;
}
.thc-card:hover:not(:disabled) { border-color: var(--line-3); background: rgb(var(--c-film) / .08); }
.thc-card:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.thc-card.on { border-color: var(--cyan); background: rgb(var(--c-cyan) / .08); box-shadow: 0 0 0 1px var(--cyan) inset; }
.thc-card:disabled { opacity: .6; cursor: default; }

.thc-thumb { position: relative; display: block; aspect-ratio: 168 / 104; border-radius: 9px; overflow: hidden; border: 1px solid var(--line); }
.thc-side { position: absolute; inset: 0; display: block; }
/* 跟随系统：左上一半深色，右下一半浅色 */
.thc-side.half.lc-theme-dark { clip-path: polygon(0 0, 100% 0, 0 100%); }
.thc-side.half.lc-theme-light { clip-path: polygon(100% 0, 100% 100%, 0 100%); }
.thc-side svg { display: block; width: 100%; height: 100%; }
/* 下面的取值都落在 .thc-side 上的那一套令牌里，不跟页面当前的主题走 */
.thc-side .bg { fill: var(--bg-0); }
.thc-side .grid { fill: none; stroke: var(--grid-line); stroke-width: 1; }
.thc-side .bar { fill: var(--panel-solid); opacity: .82; }
.thc-side .side { fill: var(--panel-solid); opacity: .6; }
.thc-side .logo { fill: var(--logo-plate); stroke: var(--hue-cyan); stroke-width: 1; }
.thc-side .av { fill: var(--hue-violet); }
.thc-side .nav.on { fill: var(--kind-image-bg); stroke: var(--cyan); stroke-width: .8; }
.thc-side .card { fill: var(--mock-node); stroke: var(--line-2); stroke-width: 1; }
.thc-side .media { fill: var(--art-sky-1); }
.thc-side .art { fill: var(--art-sky-2); opacity: .85; }
.thc-side .well { fill: var(--well-solid); stroke: var(--line); stroke-width: .8; }
.thc-side .btn { fill: var(--btn-bg); }
.thc-side .ok { fill: var(--ok); }
.thc-side .t1, .thc-side .t2, .thc-side .t3 { fill: none; stroke-linecap: round; }
.thc-side .t1 { stroke: var(--text); stroke-width: 3; }
.thc-side .t2 { stroke: var(--text-2); stroke-width: 2; }
.thc-side .t3 { stroke: var(--text-3); stroke-width: 2; opacity: .6; }
.thc-side .wire { fill: none; stroke: var(--wire-image-a); stroke-width: 1.4; }
.thc-side .port { fill: var(--port-bg); stroke: var(--cyan); stroke-width: 1; }

.thc-name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; font-weight: 600; color: var(--text); }
.thc-name .lc-chip { flex: none; font-style: normal; font-weight: 400; height: 18px; padding: 0 6px; font-size: 11px; }
.thc-desc { font-size: 12px; line-height: 1.6; color: var(--text-3); }
@media (max-width: 720px) {
  .thc { grid-template-columns: 1fr; }
  .thc-card { grid-template-columns: 132px minmax(0, 1fr); grid-template-rows: auto 1fr; column-gap: 12px; row-gap: 4px; }
  .thc-thumb { grid-row: 1 / 3; }
}
@media (prefers-reduced-motion: reduce) { .thc-card { transition: none; } }
</style>
