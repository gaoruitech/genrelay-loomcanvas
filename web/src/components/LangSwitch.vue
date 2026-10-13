<template>
  <div ref="rootEl" class="lgs" :class="{ open }">
    <button
      type="button"
      class="lgs-btn"
      :aria-label="t('shell.language')"
      v-tip="open ? '' : t('shell.language')"
      aria-haspopup="menu"
      :aria-expanded="open"
      data-testid="lang-switch"
      @click="open = !open"
    >
      <LcIcon name="globe" />
    </button>
    <div v-if="open" class="lgs-menu lc-menu" role="menu" :aria-label="t('shell.language')">
      <button
        v-for="l in LOCALE_OPTIONS"
        :key="l.value"
        type="button"
        class="lc-menu-item"
        :class="{ active: l.value === app.locale }"
        role="menuitemradio"
        :aria-checked="l.value === app.locale"
        :lang="l.value"
        :data-locale-opt="l.value"
        @click="pick(l.value)"
      >
        <span>{{ l.label }}</span>
        <LcIcon v-if="l.value === app.locale" class="lgs-check" name="check" size="s" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 语言切换的窄屏版：一颗图标钮，点开是语言列表。样子和旁边的主题切换（ThemeSwitch）是一对。
 * 只在顶栏放不下那个带文字的下拉、又没有用户菜单可以收进去的时候用（宿主管登录的嵌入：见 AppShell）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import { LOCALE_OPTIONS } from '@/locales'
import type { LocaleCode } from '@/types'
import LcIcon from '@/components/LcIcon.vue'

const { t } = useI18n()
const app = useAppStore()

const open = ref(false)
const rootEl = ref<HTMLElement | null>(null)

function pick(v: LocaleCode) {
  open.value = false
  app.setLocale(v)
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
.lgs { position: relative; flex: none; }
.lgs-btn {
  width: 36px; height: 36px; display: grid; place-items: center; padding: 0; border-radius: 10px;
  border: 1px solid var(--line); background: rgb(var(--c-film) / .05); color: var(--text-2); cursor: pointer;
  transition: border-color .15s, background .15s, color .15s;
}
.lgs-btn:hover, .lgs.open .lgs-btn { border-color: var(--line-3); background: rgb(var(--c-film) / .1); color: var(--text); }
.lgs-btn:focus-visible { outline: none; border-color: var(--cyan); box-shadow: var(--ring); }
.lgs-menu { position: absolute; right: 0; top: calc(100% + 8px); z-index: 60; min-width: 148px; }
.lgs-menu .lc-menu-item { width: 100%; gap: 10px; border: 0; background: none; font: inherit; font-size: 13px; text-align: left; white-space: nowrap; }
.lgs-menu .lc-menu-item:hover { background: rgb(var(--c-film) / .12); }
.lgs-menu .lc-menu-item.active { background: rgb(var(--c-cyan) / .12); }
.lgs-check { margin-left: auto; }
</style>
