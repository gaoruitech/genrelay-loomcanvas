<template>
  <div class="cv-node cv-surface" :class="{ selected, 'has-image': !!imageUrl }">
    <div v-if="imageUrl" class="cv-image-wrap">
      <img :src="canvasImageThumb(imageUrl, 260)" alt="" class="cv-image" />
      <button
        v-if="editor"
        class="cv-image-edit nodrag"
        :title="t('nodeui.image.edit')"
        @click.stop="openEditor"
        @mousedown.stop
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 2v14a2 2 0 0 0 2 2h14" />
          <path d="M18 22V8a2 2 0 0 0-2-2H2" />
        </svg>
      </button>
      <button class="cv-image-clear nodrag" @click.stop="clearImage" :title="t('common.remove')">×</button>
    </div>

    <div v-else-if="uploading" class="cv-placeholder">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <span>{{ t('common.uploading') }}</span>
    </div>

    <template v-else>
      <label class="cv-upload-zone nodrag" @mousedown.stop>
        <input
          type="file"
          accept="image/*"
          style="display:none"
          @change="handleSelect"
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span>{{ t('nodeui.image.clickUpload') }}</span>
      </label>
      <button class="cv-pick-btn nodrag" @click.stop="pickFromLibrary" @mousedown.stop>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span>{{ t('nodes.action.pickFromLibrary') }}</span>
      </button>
    </template>

    <Handle id="image-out" type="source" :position="Position.Right" class="h-image" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { MessagePlugin } from 'tdesign-vue-next'
import { useI18n } from 'vue-i18n'
import { CANVAS_PICKER_KEY } from '@/composables/canvasPickerKey'
import { CANVAS_IMAGE_EDITOR_KEY } from '@/composables/canvasImageEditorKey'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import { apiErrorMessage } from '@/utils/api'
import { canvasImageThumb, registerThumb } from '@/utils/canvasMedia'

const props = defineProps<{
  id: string
  data: { imageUrl?: string }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData } = useVueFlow()
const picker = inject(CANVAS_PICKER_KEY)
// 分享页用的是只读 ShareNode，拿不到这个 provide，按钮自然不出现
const editor = inject(CANVAS_IMAGE_EDITOR_KEY, undefined)

const imageUrl = computed(() => props.data.imageUrl || '')
const uploading = ref(false)

async function handleSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploading.value = true
  try {
    const url = await uploadCanvasImage(file)
    updateNodeData(props.id, { imageUrl: url })
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('upload.failed')))
  } finally {
    uploading.value = false
  }
}

// 结果由画布统一处理（生成新节点 / 替换当前），这里只负责发起
function openEditor() {
  if (!editor || !imageUrl.value) return
  void editor.open({ url: imageUrl.value, nodeId: props.id })
}

function clearImage() {
  updateNodeData(props.id, { imageUrl: '' })
}

async function pickFromLibrary() {
  if (!picker) return
  const items = await picker.open({ mediaType: 'image', multiSelect: false })
  if (items.length > 0) {
    registerThumb(items[0].fileUrl, items[0].thumbnailUrl)
    updateNodeData(props.id, { imageUrl: items[0].fileUrl })
  }
}
</script>

<style scoped>
@import './node-shared.css';
.cv-node { min-width: 280px; max-width: 280px; height: 300px; }
.cv-upload-zone, .cv-placeholder, .cv-image-wrap { flex: 1 1 auto; min-height: 0; }
/* 有图时按图片宽度收缩，避免竖图两侧留出空隙 */
.cv-node.has-image { min-width: 0; width: fit-content; height: auto; }
/* 图片等比缩放、居中显示：去掉固定高度 / contain 留白 / 背景填充，限制最大高度避免竖图过大 */
.cv-image-wrap {
  min-height: 0;
  background: transparent;
  display: flex;
  justify-content: center;
}
/* 编辑按钮跟「移除」并排：移除在最右，编辑挨着它 */
.cv-image-edit {
  position: absolute;
  top: 6px;
  right: 32px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: var(--on-scrim);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}
.cv-image-edit svg { width: 13px; height: 13px; }
.cv-image-wrap:hover .cv-image-edit { opacity: 1; }
.cv-image-edit:hover { background: rgba(0, 0, 0, 0.75); }
.cv-image {
  width: auto;
  height: auto;
  min-height: 0;
  max-width: 100%;
  max-height: 220px;
  object-fit: contain;
}
</style>
