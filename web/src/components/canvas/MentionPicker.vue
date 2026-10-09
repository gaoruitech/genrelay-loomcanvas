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
.cv-mention {
  position: fixed; z-index: 10050;
  max-height: 232px; overflow-y: auto;
  background: var(--n-1); border: 1px solid var(--n-5); border-radius: 10px;
  padding: 4px; box-shadow: 0 10px 28px rgba(0, 0, 0, .28);
}
.cv-mention-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 4px 6px; border: none; border-radius: 7px; background: none;
  color: var(--t-max); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer;
}
.cv-mention-item.on { background: var(--n-3); }
.cv-mention-item img {
  width: 28px; height: 28px; object-fit: cover; border-radius: 5px;
  border: 1px solid var(--n-5); flex: 0 0 auto;
}
.cv-mention-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-mention-idx { font-size: 11px; color: var(--t-dim); font-variant-numeric: tabular-nums; }
.cv-mention-warn { font-size: 10.5px; color: var(--warning); }
</style>
