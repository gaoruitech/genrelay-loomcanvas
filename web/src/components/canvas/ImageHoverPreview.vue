<template>
  <Teleport :to="$lcPortal">
    <img
      v-if="visible && src"
      :src="$src(src)"
      class="img-hover-preview"
      :style="{
        left: x + 'px',
        top: y + 'px',
        width: w + 'px',
        height: h + 'px',
      }"
      alt=""
    />
  </Teleport>
</template>

<script setup lang="ts">
import { useImageHoverPreviewState } from '@/composables/useImageHoverPreview'
const { visible, src, x, y, w, h } = useImageHoverPreviewState()
</script>

<style scoped>
.img-hover-preview {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  border-radius: 12px;
  background: var(--media-bg);
  border: 1px solid var(--line-2);
  box-shadow: var(--sh-2);
  object-fit: contain;
}
</style>
