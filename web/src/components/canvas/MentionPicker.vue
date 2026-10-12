<template>
  <Teleport to="body">
    <div
      v-if="open && items.length"
      class="cv-mention nodrag nowheel"
      :style="{ left: x + 'px', top: y + 'px', width: width + 'px' }"
      @mousedown.stop.prevent
      @click.stop
    >
      <button
        v-for="(r, i) in items" :key="r.key"
        type="button" class="cv-mention-item" :class="{ on: i === active }"
        @click="emit('pick', r)"
        @mouseenter="emit('hover', i)"
      >
        <img :src="canvasImageThumb(r.url, 28)" loading="lazy" alt="" />
        <span class="cv-mention-label">{{ r.label }}</span>
        <span v-if="r.name" class="cv-mention-idx">{{ t('gen.refs.defaultName', { n: r.index }) }}</span>
        <span v-if="r.overCap" class="cv-mention-warn">{{ t('gen.refs.overCap') }}</span>
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * @ 候选框。
 *
 * Teleport 到 body：它挂在节点卡片里的话会被画布的 transform 缩放跟着缩，
 * 画布缩小时字就糊了；而且卡片有 overflow 裁切，弹出层会被切掉半截。
 */
import { useI18n } from 'vue-i18n'
import type { ImageRef } from '@/composables/canvasImageRefs'
import { canvasImageThumb } from '@/utils/canvasMedia'

const { t } = useI18n()

defineProps<{
  open: boolean
  items: ImageRef[]
  active: number
  x: number
  y: number
  width: number
}>()

const emit = defineEmits<{
  (e: 'pick', ref: ImageRef): void
  (e: 'hover', index: number): void
}>()
</script>

<style scoped>
/* @ 候选框：和下拉菜单同一种玻璃面板 */
.cv-mention {
  position: fixed; z-index: 10050;
  max-height: 232px; overflow-y: auto;
  background: var(--pop); border: 1px solid var(--line-2); border-radius: 12px;
  padding: 6px; box-shadow: var(--sh-1);
}
.cv-mention-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 5px 8px; border: none; border-radius: 8px; background: none;
  color: var(--text-2); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.cv-mention-item.on { background: rgb(var(--c-cyan) / .12); color: var(--text); }
.cv-mention-item img {
  width: 28px; height: 28px; object-fit: cover; border-radius: 6px;
  border: 1px solid var(--line); flex: 0 0 auto;
}
.cv-mention-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-mention-idx { font: 11px var(--f-mono); color: var(--text-3); }
.cv-mention-warn { font-size: 11px; color: var(--warn); }
</style>
