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
  border: 1.5px dashed var(--frame-line);
  border-radius: 18px;
  background: var(--frame-fill);
  box-sizing: border-box;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.fr.selected {
  border-style: solid;
  border-color: var(--frame-line-sel);
  background: var(--frame-fill-sel);
  box-shadow: 0 0 0 3px var(--frame-ring);
}

/* 标题栏：悬浮在组左上角的一张小玻璃卡片 */
.fr-bar {
  position: absolute;
  top: -38px; left: -1px;
  display: inline-flex; align-items: center; gap: 6px;
  max-width: calc(100% + 2px);
  height: 30px;
  padding: 0 8px 0 8px;
  background: rgb(var(--c-glass) / .92);
  border: 1px solid var(--line-2);
  border-radius: 10px;
  box-shadow: var(--sh-1);
  cursor: grab;
}
.fr-bar:active { cursor: grabbing; }
.fr.selected .fr-bar { border-color: var(--line-3); }

.fr-grip {
  width: 10px; height: 16px;
  flex: none;
  fill: var(--text-3);
  opacity: .7;
}
.fr-bar:hover .fr-grip { opacity: 1; fill: var(--text-2); }

.fr-title {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--text);
  font: 600 12px/1.4 var(--f-disp);
  padding: 2px 6px;
  outline: none;
  cursor: text;
  min-width: 90px; max-width: 220px;
}
.fr-title::placeholder { font-weight: 400; color: var(--text-3); }
.fr-title:hover { background: rgb(var(--c-film) / .1); }
.fr-title:focus { background: var(--well); border-color: var(--cyan); }

.fr-count {
  font-size: 11px; white-space: nowrap;
  color: var(--text-2);
  background: rgb(var(--c-film) / .12);
  border-radius: 6px; padding: 2px 8px;
}
</style>
