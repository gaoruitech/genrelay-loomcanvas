<template>
  <div ref="el" class="sbar" :class="{ dirty }" data-testid="settings-savebar">
    <p class="sbar-note" :class="{ on: dirty }" aria-live="polite">
      <i v-if="dirty" aria-hidden="true" />{{ dirty ? t('settings.unsaved') : note }}
    </p>
    <div class="sbar-acts"><slot /></div>
  </div>
</template>

<script setup lang="ts">
/**
 * 有明确「保存」的分区底下那一条：页面长的时候贴在视口底部，滚到头就落回原位。
 * 它贴着的时候会盖住视口最底下的一条：把自己实际占的高度报给设置页（见 dirty.ts 的 useSaveBarSpace），
 * 设置页据此给滚动容器留出 scroll-padding-bottom，键盘走到底下那一格时不会停在它后面。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSaveBarSpace } from './dirty'

defineProps<{ dirty?: boolean; note?: string }>()
const { t } = useI18n()

const el = ref<HTMLElement | null>(null)
const report = useSaveBarSpace()
let ro: ResizeObserver | null = null
/** 高度会变（有改动时多一行提示、窄屏上按钮折行），离底边的距离随断点变：都按实际量 */
function measure() {
  const bar = el.value
  if (!bar) return
  const gap = parseFloat(getComputedStyle(bar).bottom) || 0
  report(Math.ceil(bar.offsetHeight + gap))
}
onMounted(() => {
  measure()
  if (el.value && typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(measure)
    ro.observe(el.value)
  }
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', measure)
  report(0)
})
</script>

<style scoped>
.sbar {
  position: sticky; bottom: 16px; z-index: 4;
  display: flex; align-items: center; gap: 12px 16px; flex-wrap: wrap;
  padding: 12px 16px 12px 20px; border-radius: var(--r-md);
  background: var(--panel-solid); border: 1px solid var(--line-2); box-shadow: var(--sh-1);
  transition: border-color .15s;
}
.sbar.dirty { border-color: rgb(var(--c-warn) / .5); }
.sbar-note { flex: 1 1 220px; min-width: 0; font-size: 12px; line-height: 1.6; color: var(--text-3); display: flex; align-items: center; gap: 8px; }
.sbar-note.on { color: var(--warn); font-size: 13px; }
.sbar-note i { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.sbar-acts { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-left: auto; }
@media (max-width: 600px) {
  .sbar { bottom: 8px; padding: 12px; }
  .sbar-note { flex-basis: 100%; }
  /* 手机上这一条挡的地方多：没改动时不占一行说明 */
  .sbar-note:not(.on) { display: none; }
  .sbar-acts { margin-left: 0; width: 100%; }
  .sbar-acts :deep(.lc-btn) { flex: 1 1 auto; }
}
</style>
