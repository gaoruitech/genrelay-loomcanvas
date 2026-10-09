<template>
  <Teleport to="body">
    <img
      v-if="visible && src"
      :src="src"
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
  border-radius: 8px;
  background: var(--n-0);
  border: 1px solid var(--n-5);
  box-shadow: 0 16px 48px var(--shadow-3);
  object-fit: contain;
}
</style>
