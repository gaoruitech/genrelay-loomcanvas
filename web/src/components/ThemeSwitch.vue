<template>
  <div ref="rootEl" class="ths" :class="{ open, plain }">
    <button
      type="button"
      class="ths-btn"
      :aria-label="t('shell.theme.label')"
      :title="t('shell.theme.title', { name: t('shell.theme.' + app.theme) })"
      aria-haspopup="menu"
      :aria-expanded="open"
      data-testid="theme-switch"
      @click="open = !open"
    >
      <LcIcon :name="ICON[app.theme]" />
    </button>
    <div v-if="open" class="ths-menu lc-menu" role="menu" :aria-label="t('shell.theme.label')">
      <button
        v-for="o in THEME_PREFS"
        :key="o"
        type="button"
        class="lc-menu-item"
        :class="{ active: o === app.theme }"
        role="menuitemradio"
        :aria-checked="o === app.theme"
        :data-testid="`theme-${o}`"
        @click="pick(o)"
      >
        <LcIcon :name="ICON[o]" size="s" />
        <span>{{ t('shell.theme.' + o) }}</span>
        <LcIcon v-if="o === app.theme" class="ths-check" name="check" size="s" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 主题切换：一颗图标钮（图标是当前的选择），点开是「深色 / 浅色 / 跟随系统」三项。
 * 顶栏、落地页 / 登录页 / 分享页的页头用的都是它；设置 → 外观里另有一组带预览图的卡片（ThemeChooser）。
 * 选了立刻生效；登录着就同时存到账号上（见 stores/app.ts 的 setTheme）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { useAppStore } from '@/stores/app'
import { apiErrorMessage } from '@/utils/api'
import { THEME_PREFS, type ThemePref } from '@/composables/useTheme'
import LcIcon from '@/components/LcIcon.vue'

/** plain：不带描边和底（落地页的页头里和旁边的文字链接放在一起） */
defineProps<{ plain?: boolean }>()

const { t } = useI18n()
const app = useAppStore()

const ICON: Record<ThemePref, string> = { dark: 'moon', light: 'sun', system: 'monitor' }

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

async function pick(v: ThemePref) {
  open.value = false
  try {
    await app.setTheme(v)
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('shell.theme.failed')))
  }
}

function onDocDown(e: MouseEvent) {
  if (open.value && rootEl.value && !rootEl.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => {
  document.addEventListener('mousedown', onDocDown)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown)
  document.removeEventListener('keydown', onKey)
})
</script>

<style scoped>
.ths { position: relative; flex: none; }
.ths-btn {
  width: 36px; height: 36px; display: grid; place-items: center; padding: 0; border-radius: 10px;
  border: 1px solid var(--line); background: rgb(var(--c-film) / .05); color: var(--text-2); cursor: pointer;
  transition: border-color .15s, background .15s, color .15s;
}
.ths-btn:hover, .ths.open .ths-btn { border-color: var(--line-3); background: rgb(var(--c-film) / .1); color: var(--text); }
.ths-btn:focus-visible { outline: none; border-color: var(--cyan); box-shadow: var(--ring); }
.ths.plain .ths-btn { border-color: transparent; background: none; }
.ths.plain .ths-btn:hover, .ths.plain.open .ths-btn { background: rgb(var(--c-film) / .1); }
.ths-menu { position: absolute; right: 0; top: calc(100% + 8px); z-index: 60; min-width: 168px; }
.ths-menu .lc-menu-item { width: 100%; gap: 10px; border: 0; background: none; font: inherit; font-size: 13px; text-align: left; white-space: nowrap; }
.ths-menu .lc-menu-item:hover { background: rgb(var(--c-film) / .12); }
.ths-menu .lc-menu-item.active { background: rgb(var(--c-cyan) / .12); }
.ths-check { margin-left: auto; }
</style>
