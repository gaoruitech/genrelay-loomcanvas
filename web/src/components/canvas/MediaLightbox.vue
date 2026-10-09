<template>
  <Teleport to="body">
    <div v-if="open" class="ml-mask" @click.self="emit('close')" @mousedown.self.stop @wheel.stop>
      <button class="ml-close" :title="t('common.close')" @click="emit('close')">×</button>
      <video
        v-if="type === 'video'"
        :src="url"
        class="ml-media"
        controls
        autoplay
        playsinline
      />
      <img v-else :src="url" class="ml-media" alt="" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const props = defineProps<{
  open: boolean
  url: string
  type: 'image' | 'video'
}>()
const emit = defineEmits<{ (e: 'close'): void }>()

// Esc 关闭：只在开着的时候监听
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); emit('close') }
}
watch(() => props.open, (open) => {
  if (open) window.addEventListener('keydown', onKeydown, true)
  else window.removeEventListener('keydown', onKeydown, true)
}, { immediate: true })
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<style scoped>
.ml-mask {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}
.ml-media {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 12px 60px var(--shadow-3);
}
.ml-close {
  position: fixed;
  top: 20px;
  right: 24px;
  width: 40px;
  height: 40px;
  background: var(--film-2);
  border: none;
  border-radius: 8px;
  color: var(--t-max);
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease;
}
.ml-close:hover { background: rgba(255, 255, 255, 0.22); }
</style>
