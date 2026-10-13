<template>
  <div class="bp">
    <header class="bp-nav">
      <LcLogo :to="home" />
      <span class="lc-sp" />
      <LcSelect
        v-if="embed.features.localeSwitch"
        class="bp-lang"
        size="sm"
        auto-width
        :model-value="app.locale"
        :options="LOCALE_OPTIONS"
        :aria-label="t('auth.language')"
        data-testid="bare-language"
        @update:model-value="app.setLocale"
      />
      <ThemeSwitch v-if="embed.features.themeSwitch" />
    </header>
    <main class="bp-body"><slot /></main>
  </div>
</template>

<script setup lang="ts">
/**
 * 没有外壳、也不是登录 / 注册的整屏页面（404、连不上服务端）：顶上一条只有 Logo、语言和主题。
 * 这两屏没有账号可依：语言和主题都只记在这台浏览器上（app.setLocale / app.setTheme 在没登录时本来就是这样）。
 */
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { useEmbed } from '@/embed/context'
import { LOCALE_OPTIONS } from '@/locales'
import LcLogo from '@/components/LcLogo.vue'
import LcSelect from '@/components/LcSelect.vue'
import ThemeSwitch from '@/components/ThemeSwitch.vue'

/** Logo 点了去哪儿；不给就只是个标志（连不上服务端时哪儿也去不了） */
defineProps<{ home?: string }>()

const { t } = useI18n()
const app = useAppStore()
const embed = useEmbed()
</script>

<style scoped>
.bp { height: 100%; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; }
.bp-nav { flex: none; height: 72px; display: flex; align-items: center; gap: 16px; padding: 0 48px; width: 100%; max-width: 1440px; margin: 0 auto; }
.bp-lang :deep(.lcs-trigger) { min-width: 120px; }
.bp-body { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; padding: 24px 24px 96px; }
@media (max-width: 600px) {
  .bp-nav { height: 60px; padding: 0 16px; gap: 8px; }
  .bp-body { padding: 16px 16px 64px; }
}
</style>
