<template>
  <div class="cv-node cv-media" :class="{ selected, 'has-image': !!imageUrl }">
    <div class="cv-head">
      <LcIcon name="image" />
      <span class="cv-title">{{ t('nodes.title.image') }}</span>
    </div>
    <div class="cv-body">
      <div v-if="imageUrl" class="cv-image-wrap">
        <img :src="canvasImageThumb(imageUrl, 260)" alt="" class="cv-image" draggable="false" />
        <!-- 只读：左上角是「查看大图」；裁剪、移除都是改画布，不出现 -->
        <button
          v-if="ro && viewer" type="button" class="cv-image-edit view nodrag"
          v-tip="t('gen.view.image')" :aria-label="t('gen.view.image')" data-testid="node-view"
          @click.stop="viewer(imageUrl, 'image')" @mousedown.stop @dblclick.stop
        ><LcIcon name="eye" size="s" /></button>
        <button
          v-else-if="editor && !ro"
          class="cv-image-edit nodrag"
          v-tip="t('nodeui.image.edit')" :aria-label="t('nodeui.image.edit')"
          @click.stop="openEditor"
          @mousedown.stop
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M6 2v14a2 2 0 0 0 2 2h14" />
            <path d="M18 22V8a2 2 0 0 0-2-2H2" />
          </svg>
        </button>
        <button v-if="!ro" class="cv-image-clear nodrag" v-tip="t('common.remove')" :aria-label="t('common.remove')" @click.stop="clearImage"><LcIcon name="x" size="s" /></button>
      </div>

      <div v-else-if="uploading" class="cv-placeholder">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
        </svg>
        <span>{{ t('common.uploading') }}</span>
      </div>

      <!-- 只读：没有图就是一句话，不摆上传区 -->
      <div v-else-if="ro" class="cv-placeholder">{{ t('nodeui.share.noImage') }}</div>

      <template v-else>
        <label class="cv-upload-zone nodrag" @mousedown.stop>
          <input
            type="file"
            accept="image/*"
            style="display:none"
            @change="handleSelect"
          />
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
        </svg>
          <span>{{ t('nodeui.image.clickUpload') }}</span>
        </label>
        <button v-if="$feat.assetLibrary" class="cv-pick-btn nodrag" @click.stop="pickFromLibrary" @mousedown.stop>
          <LcIcon name="folder" size="s" />
          <span>{{ t('nodes.action.pickFromLibrary') }}</span>
        </button>
      </template>
    </div>

    <Handle id="image-out" type="source" :position="Position.Right" class="h-image h-top" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { MessagePlugin } from '@/utils/feedback'
import { useI18n } from 'vue-i18n'
import { CANVAS_PICKER_KEY } from '@/composables/canvasPickerKey'
import { CANVAS_IMAGE_EDITOR_KEY } from '@/composables/canvasImageEditorKey'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import { apiErrorMessage } from '@/utils/api'
import { canvasImageThumb, registerThumb } from '@/utils/canvasMedia'
import LcIcon from '@/components/LcIcon.vue'
import { useCanvasReadOnly, useCanvasViewer } from '@/composables/nodeLayout'

const props = defineProps<{
  id: string
  data: { imageUrl?: string }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData } = useVueFlow()
const picker = inject(CANVAS_PICKER_KEY)
// 分享页用的是只读 ShareNode，拿不到这个 provide，按钮自然不出现；功能关着（features.imageEditor）时画布也不 provide
const editor = inject(CANVAS_IMAGE_EDITOR_KEY, undefined)
/** 只读（别人正在编辑、只有查看权）：能看大图，不能换图、裁剪、移除 */
const ro = useCanvasReadOnly()
const viewer = useCanvasViewer()

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
    // 传到一半丢了编辑权：不往节点里写
    if (!ro.value) updateNodeData(props.id, { imageUrl: url })
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('upload.failed')))
  } finally {
    uploading.value = false
  }
}

// 结果由画布统一处理（生成新节点 / 替换当前），这里只负责发起
function openEditor() {
  if (!editor || ro.value || !imageUrl.value) return
  void editor.open({ url: imageUrl.value, nodeId: props.id })
}

function clearImage() {
  if (!ro.value) updateNodeData(props.id, { imageUrl: '' })
}

async function pickFromLibrary() {
  if (!picker || ro.value) return
  const items = await picker.open({ mediaType: 'image', multiSelect: false })
  if (items.length > 0 && !ro.value) {
    registerThumb(items[0].fileUrl, items[0].thumbnailUrl)
    updateNodeData(props.id, { imageUrl: items[0].fileUrl })
  }
}
</script>

<style scoped>
@import './node-shared.css';
.cv-media { width: 280px; height: 300px; }
.cv-upload-zone, .cv-placeholder { flex: 1 1 auto; min-height: 0; }
/* 有图时高度跟着图走，竖图不留大块空白 */
.cv-media.has-image { height: auto; }
.cv-image-wrap { display: flex; justify-content: center; }
.cv-image { width: auto; max-width: 100%; max-height: 240px; }
/* 编辑按钮跟「移除」并排：移除在最右，编辑挨着它；悬停才出现 */
.cv-image-edit { right: 36px; opacity: 0; transition: opacity .15s ease, background .15s ease; }
.cv-image-edit svg { width: 13px; height: 13px; }
.cv-image-wrap:hover .cv-image-edit,
.cv-media.selected .cv-image-edit,
.cv-image-edit:focus-visible { opacity: 1; }
/* 只读时这个位置是「查看大图」，右边没有「移除」：贴到最右，而且一直看得见（触屏上没有悬停） */
.cv-image-edit.view { right: 6px; opacity: 1; }
.cv-image-edit.view svg { width: 14px; height: 14px; }
</style>
