<template>
  <div class="cv-node cv-media" :class="{ selected, 'has-video': !!videoUrl }">
    <div class="cv-head">
      <LcIcon name="video" />
      <span class="cv-title">{{ t('nodes.title.video') }}</span>
    </div>
    <div class="cv-body">
      <div v-if="videoUrl" class="cv-image-wrap">
        <video :src="$src(videoUrl)" class="cv-video" controls preload="metadata" />
        <button class="cv-image-clear nodrag" :title="t('common.remove')" @click.stop="clearVideo"><LcIcon name="x" size="s" /></button>
      </div>

      <div v-else-if="uploading" class="cv-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
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
          <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
        </svg>
          <span>{{ t('nodeui.video.clickUpload') }}</span>
        </label>
        <button v-if="$feat.assetLibrary" class="cv-pick-btn nodrag" @click.stop="pickFromLibrary" @mousedown.stop>
          <LcIcon name="folder" size="s" />
          <span>{{ t('nodes.action.pickFromLibrary') }}</span>
        </button>
      </template>
    </div>

    <Handle id="video-out" type="source" :position="Position.Right" class="h-video h-top" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { MessagePlugin } from '@/utils/feedback'
import { useI18n } from 'vue-i18n'
import { CANVAS_PICKER_KEY } from '@/composables/canvasPickerKey'
import { uploadCanvasVideo } from '@/utils/canvasUpload'
import { registerThumb } from '@/utils/canvasMedia'
import { apiErrorMessage } from '@/utils/api'
import LcIcon from '@/components/LcIcon.vue'

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
.cv-media { width: 280px; height: 300px; }
.cv-media.has-video { height: auto; }
.cv-upload-zone, .cv-placeholder { flex: 1 1 auto; min-height: 0; }
.cv-video { width: 100%; display: block; background: var(--player-bg); }
</style>
