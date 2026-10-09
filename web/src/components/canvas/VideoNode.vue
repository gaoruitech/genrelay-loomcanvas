<template>
  <div class="cv-node cv-surface" :class="{ selected }">
    <div v-if="videoUrl" class="cv-video-wrap">
      <video :src="videoUrl" class="cv-video" controls preload="metadata" />
      <button class="cv-image-clear nodrag" @click.stop="clearVideo" :title="t('common.remove')">×</button>
    </div>

    <div v-else-if="uploading" class="cv-placeholder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <span>{{ uploadPct > 0 ? t('nodeui.video.uploadingPct', { pct: uploadPct }) : t('common.uploading') }}</span>
    </div>

    <template v-else>
      <label class="cv-upload-zone nodrag" @mousedown.stop>
        <input
          type="file"
          accept="video/*"
          style="display:none"
          @change="handleSelect"
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>{{ t('nodeui.video.clickUpload') }}</span>
      </label>
      <button class="cv-pick-btn nodrag" @click.stop="pickFromLibrary" @mousedown.stop>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="23 7 16 12 23 17 23 7" />
          <rect x="1" y="5" width="15" height="14" rx="2" />
        </svg>
        <span>{{ t('nodes.action.pickFromLibrary') }}</span>
      </button>
    </template>

    <Handle id="video-out" type="source" :position="Position.Right" class="h-video" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { MessagePlugin } from 'tdesign-vue-next'
import { useI18n } from 'vue-i18n'
import { CANVAS_PICKER_KEY } from '@/composables/canvasPickerKey'
import { uploadCanvasVideo } from '@/utils/canvasUpload'
import { registerThumb } from '@/utils/canvasMedia'
import { apiErrorMessage } from '@/utils/api'

const props = defineProps<{
  id: string
  data: { videoUrl?: string }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData } = useVueFlow()
const picker = inject(CANVAS_PICKER_KEY)

const videoUrl = computed(() => props.data.videoUrl || '')
const uploading = ref(false)
const uploadPct = ref(0)

async function handleSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  uploadPct.value = 0
  try {
    const url = await uploadCanvasVideo(file, (pct) => { uploadPct.value = Math.round(pct) })
    updateNodeData(props.id, { videoUrl: url })
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('upload.failed')))
  } finally {
    uploading.value = false
  }
}

function clearVideo() {
  updateNodeData(props.id, { videoUrl: '' })
}

async function pickFromLibrary() {
  if (!picker) return
  const items = await picker.open({ mediaType: 'video', multiSelect: false })
  if (items.length > 0) {
    registerThumb(items[0].fileUrl, items[0].thumbnailUrl)
    updateNodeData(props.id, { videoUrl: items[0].fileUrl })
  }
}
</script>

<style scoped>
@import './node-shared.css';
.cv-node { min-width: 280px; max-width: 280px; height: 300px; }
.cv-node:has(.cv-video-wrap) { height: auto; }
.cv-video-wrap, .cv-upload-zone, .cv-placeholder { flex: 1 1 auto; min-height: 0; }
.cv-video-wrap { position: relative; }
.cv-video { width: 100%; border-radius: 8px; display: block; background: var(--player-bg); }
</style>
