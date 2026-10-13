<template>
  <span class="vis" :class="[value, { plain }]" v-tip="title ? t('spaces.visibility.' + value + '.hint') : undefined">
    <LcIcon :name="ICON[value]" size="s" /><span>{{ t('spaces.visibility.' + value + '.label') }}</span>
  </span>
</template>

<script setup lang="ts">
/**
 * 团队画布的可见范围标签：仅自己 / 团队可看 / 团队可改。
 * 三档各有自己的图标（锁 / 眼睛 / 笔），不只靠颜色区分。
 */
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import type { CanvasVisibility } from '@/types'

withDefaults(defineProps<{
  value: CanvasVisibility
  /** 压在封面图上时用实底；plain 是放在普通面板上的浅底版本 */
  plain?: boolean
  /** 鼠标停上去说明这一档是什么意思 */
  title?: boolean
}>(), { plain: false, title: true })

const { t } = useI18n()
const ICON: Record<CanvasVisibility, string> = { private: 'lock', team_view: 'eye', team_edit: 'edit' }
</script>

<style scoped>
.vis {
  display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px 0 7px; border-radius: 8px;
  font-size: 12px; line-height: 1; white-space: nowrap; color: var(--on-scrim);
  background: rgb(var(--c-scrim) / .72); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.vis.plain { color: var(--text-2); background: rgb(var(--c-film) / .1); -webkit-backdrop-filter: none; backdrop-filter: none; }
.vis.plain.team_view { color: var(--kind-chat-fg); background: var(--kind-chat-bg); }
.vis.plain.team_edit { color: var(--kind-image-fg); background: var(--kind-image-bg); }
.vis.plain .lc-ic { color: inherit; }
</style>
