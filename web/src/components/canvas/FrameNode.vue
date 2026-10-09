<template>
  <div class="fr" :class="{ selected }" :style="{ width: w + 'px', height: h + 'px' }">
    <!--
      标题栏也是拖拽把手：不加 nodrag，正是要让 vue-flow 的拖拽在这里生效，
      只有输入框自己用 nodrag 挡住。组身本来就能拖，这里只是给一个明确的抓手。
    -->
    <div class="fr-bar" :title="t('nodeui.frame.dragTip')">
      <svg class="fr-grip" viewBox="0 0 10 16" aria-hidden="true">
        <circle cx="3" cy="4" r="1.1" /><circle cx="7" cy="4" r="1.1" />
        <circle cx="3" cy="8" r="1.1" /><circle cx="7" cy="8" r="1.1" />
        <circle cx="3" cy="12" r="1.1" /><circle cx="7" cy="12" r="1.1" />
      </svg>
      <input
        v-model="label"
        class="fr-title nodrag"
        maxlength="40"
        :placeholder="t('nodeui.frame.namePlaceholder')"
        @mousedown.stop
        @click.stop
        @keydown.enter="($event.target as HTMLInputElement).blur()"
      />
      <span class="fr-count">{{ t('nodeui.frame.count', { n: childCount }) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 组：把一批节点圈在一起，拖动时整体带走。
 *
 * 用的是 vue-flow 原生的 parentNode + extent:'parent'，子节点的坐标是它做的，
 * 这里不实现任何拖拽逻辑；这个节点本身只负责「画一个带标题的框」。
 *
 * 组是个正常节点：点一下选中，拖组身或标题栏都能整组移动，右键出组的菜单。
 * 组里的节点照样点得到 —— 它们是画布上另外的 DOM，z-index 比组高，压在组上面。
 * 唯一的例外是框选：组铺得大，鼠标在它上面按下会被判成「拖这个组」，所以
 * Canvas.vue 在按住 Shift 时会给外层挂 .box-selecting，临时把组变穿透。
 */
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  id: string
  data: { label?: string; w?: number; h?: number }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData, getNodes } = useVueFlow()

const w = computed(() => Number(props.data.w) || 320)
const h = computed(() => Number(props.data.h) || 240)

const label = computed<string>({
  get: () => props.data.label || '',
  set: (v) => updateNodeData(props.id, { label: v }),
})

const childCount = computed(
  () => getNodes.value.filter((n: any) => n.parentNode === props.id).length
)
</script>

<style scoped>
.fr {
  border: 1.5px dashed color-mix(in srgb, var(--accent-text) 55%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--accent-text) 5%, transparent);
  box-sizing: border-box;
  transition: border-color .15s, box-shadow .15s;
}
.fr.selected {
  border-style: solid;
  border-color: var(--accent-text);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-text) 16%, transparent);
}

/* 标题栏：悬浮在组左上角的一张小卡片 */
.fr-bar {
  position: absolute;
  top: -36px; left: -1px;
  display: inline-flex; align-items: center; gap: 7px;
  max-width: calc(100% + 2px);
  padding: 5px 9px 5px 7px;
  background: var(--n-2);
  border: 1px solid var(--n-5);
  border-radius: 11px;
  box-shadow: 0 6px 18px rgba(0,0,0,.14);
  cursor: grab;
}
.fr-bar:active { cursor: grabbing; }

.fr-grip {
  width: 10px; height: 16px;
  flex: none;
  fill: var(--t-dim);
  opacity: 0.55;
}
.fr-bar:hover .fr-grip { opacity: 1; }

.fr-title {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--t-max);
  font-size: 12.5px; font-weight: 700;
  padding: 2px 6px;
  outline: none;
  cursor: text;
  min-width: 90px; max-width: 220px;
}
.fr-title::placeholder { font-weight: 400; color: var(--t-dim); }
.fr-title:hover { background: var(--n-3); }
.fr-title:focus { background: var(--n-3); border-color: var(--accent-text); }

.fr-count {
  font-size: 10.5px; font-weight: 600; white-space: nowrap;
  color: var(--accent-text);
  background: color-mix(in srgb, var(--accent-text) 13%, transparent);
  border-radius: 999px; padding: 2px 9px;
}
</style>
