<template>
  <Teleport to="body">
    <div v-if="open" class="ml-mask" @click.self="emit('close')" @mousedown.self.stop @wheel.stop>
      <button class="ml-close" :title="t('common.close')" @click="emit('close')"><LcIcon name="x" /></button>
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
import LcIcon from '@/components/LcIcon.vue'

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
  background: rgb(var(--c-void) / .88);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}
.ml-media {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 12px;
  border: 1px solid var(--line-2);
  box-shadow: var(--sh-2);
  background: var(--player-bg);
}
.ml-close {
  position: fixed;
  top: 16px;
  right: 16px;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  background: rgb(var(--c-glass) / .88);
  border: 1px solid var(--line-2);
  border-radius: 10px;
  color: var(--text-2);
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.ml-close:hover { background: var(--pop-hover); border-color: var(--line-3); color: var(--text); }
@media (max-width: 600px) {
  .ml-mask { padding: 64px 12px 24px; }
}
</style>
