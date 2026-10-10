<template>
  <div class="au">
    <header class="au-nav">
      <LcLogo :to="back ? '/' : undefined" />
      <span class="lc-sp" />
      <router-link v-if="back" to="/" class="lc-btn ghost back">{{ t('auth.backHome') }}</router-link>
      <LcSelect
        class="au-lang"
        size="sm"
        auto-width
        :model-value="app.locale"
        :options="LOCALE_OPTIONS"
        :aria-label="t('auth.language')"
        @update:model-value="app.setLocale"
      />
    </header>
    <div class="au-body">
      <section class="au-l">
        <slot name="aside" />
      </section>
      <section class="au-card lc-glass lc-gb">
        <slot />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { LOCALE_OPTIONS } from '@/locales'
import LcLogo from '@/components/LcLogo.vue'
import LcSelect from '@/components/LcSelect.vue'

/** back=false：没有「返回首页」（设置新密码那一屏哪儿也去不了，给个去不成的链接没意义） */
withDefaults(defineProps<{ back?: boolean }>(), { back: true })

const { t } = useI18n()
const app = useAppStore()
</script>

<style scoped>
.au { height: 100%; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; }
.au-nav { flex: none; height: 72px; display: flex; align-items: center; gap: 16px; padding: 0 120px; }
.au-lang :deep(.lcs-trigger) { min-width: 120px; }
.au-body {
  flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) 448px; gap: 112px; align-items: center;
  padding: 24px 120px 72px; max-width: 1440px; width: 100%; margin: 0 auto;
}
.au-nav { max-width: 1440px; width: 100%; margin: 0 auto; }
.au-card { padding: 40px; border-radius: 22px; box-shadow: var(--glow-l), var(--sh-2); min-width: 0; }

/* 左栏的陈述文字：两页共用 */
.au-l { min-width: 0; }
.au-l :deep(.kick) {
  display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 14px; border-radius: 15px;
  border: 1px solid var(--line-3); background: rgba(59, 123, 255, .12); color: var(--cyan-soft); font-size: 13px;
}
.au-l :deep(.kick i) { width: 6px; height: 6px; border-radius: 50%; background: var(--cyan); box-shadow: 0 0 8px var(--cyan); }
.au-l :deep(h1) { font: 700 44px/1.25 var(--f-disp); margin-top: 20px; color: var(--text); }
.au-l :deep(.lead) { color: var(--text-2); font-size: 16px; line-height: 1.8; margin-top: 16px; max-width: 520px; }

/* 卡片里的表单件：两页共用 */
.au-card :deep(h2) { font: 600 26px/1.3 var(--f-disp); color: var(--text); }
.au-card :deep(.sub) { color: var(--text-2); margin-top: 6px; }
.au-card :deep(form) { display: grid; gap: 18px; margin-top: 28px; }
.au-card :deep(.fld) { display: block; min-width: 0; }
.au-card :deep(.fld > span) { display: block; font-size: 13px; color: var(--text-2); margin-bottom: 6px; }
.au-card :deep(.fld .lc-help) { margin-top: 6px; }
.au-card :deep(.foot a) { margin-left: 6px; }
.au-card :deep(.foot) { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--line); text-align: center; color: var(--text-2); font-size: 14px; }

@media (max-width: 1240px) {
  .au-nav { padding: 0 48px; }
  .au-body { padding: 24px 48px 56px; gap: 56px; grid-template-columns: minmax(0, 1fr) 420px; }
  .au-l :deep(h1) { font-size: 36px; }
}
@media (max-width: 920px) {
  .au-body { grid-template-columns: minmax(0, 1fr); gap: 32px; align-items: start; max-width: 560px; }
  .au-card { order: -1; }
  .au-l :deep(h1) { font-size: 28px; }
}
@media (max-width: 600px) {
  .au-nav { padding: 0 16px; height: 60px; gap: 8px; }
  .au-nav .back { display: none; }
  .au-body { padding: 8px 16px 40px; gap: 28px; }
  .au-card { padding: 24px 20px; border-radius: 18px; box-shadow: var(--glow-m), var(--sh-1); }
  .au-card :deep(h2) { font-size: 22px; }
  .au-l :deep(h1) { font-size: 24px; }
  .au-l :deep(.lead) { font-size: 14px; }
}
</style>
