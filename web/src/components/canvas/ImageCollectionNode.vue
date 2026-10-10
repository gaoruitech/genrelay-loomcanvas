<template>
  <div class="cv-node coll" :class="{ selected }">
    <div class="cv-head">
      <LcIcon name="layout" />
      <span class="cv-title">{{ t('nodes.title.imageCollection') }}</span>
      <span class="cv-head-x">{{ t('nodeui.collection.total', { n: totalCount }) }}</span>
    </div>

    <div class="cv-body">
    <div class="grid nodrag nowheel" @mousedown.stop>
      <div v-for="(url, i) in internalUrls" :key="`int-${i}`" class="cell">
        <img :src="canvasImageThumb(url, 96)" alt="" />
        <button class="cell-x" :title="t('common.remove')" @click.stop="removeInternal(i)"><LcIcon name="x" size="s" /></button>
      </div>

      <div v-for="i in uploadingCount" :key="`up-${i}`" class="cell uploading-cell">
        <span class="dot"></span>
      </div>

      <div v-if="upstreamCount > 0" class="cell upstream-cell" :title="t('nodeui.collection.upstream', { n: upstreamCount })">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
        <span>{{ upstreamCount }}</span>
      </div>

      <label class="cell add-cell">
        <input
          type="file"
          accept="image/*"
          multiple
          style="display:none"
          @change="handleSelect"
        />
        <LcIcon name="plus" />
        <span class="plus-label">{{ t('common.upload') }}</span>
      </label>

      <button class="cell add-cell pick-cell" :title="t('nodes.action.pickFromLibrary')" @click.stop="pickFromLibrary">
        <LcIcon name="folder" />
        <span class="plus-label">{{ t('nodeui.collection.library') }}</span>
      </button>
    </div>
    </div>

    <Handle id="image-in" type="target" :position="Position.Left" class="h-image h-top" />
    <Handle id="image-out" type="source" :position="Position.Right" class="h-image h-top" />
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { Handle, Position, useVueFlow } from '@vue-flow/core'
import { MessagePlugin } from 'tdesign-vue-next'
import { useI18n } from 'vue-i18n'
import { CANVAS_PICKER_KEY } from '@/composables/canvasPickerKey'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import { apiErrorMessage } from '@/utils/api'
import { canvasImageThumb, registerThumb } from '@/utils/canvasMedia'
import LcIcon from '@/components/LcIcon.vue'

const props = defineProps<{
  id: string
  data: { imageUrls?: string[] }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData, edges } = useVueFlow()
const picker = inject(CANVAS_PICKER_KEY)

const internalUrls = computed<string[]>(() => props.data.imageUrls || [])
const uploadingCount = ref(0)

const upstreamCount = computed(() =>
  edges.value.filter(e =>
    e.target === props.id && (e.sourceHandle || '').startsWith('image-')
  ).length
)

const totalCount = computed(() => internalUrls.value.length + upstreamCount.value)

async function handleSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (!input.files || input.files.length === 0) return
  const files = Array.from(input.files)
  input.value = ''

  // 并发上传；成功的逐张追加到 imageUrls，失败的 toast 报错
  uploadingCount.value += files.length
  await Promise.all(files.map(async (file) => {
    try {
      const url = await uploadCanvasImage(file)
      updateNodeData(props.id, { imageUrls: [...(props.data.imageUrls || []), url] })
    } catch (err: any) {
      MessagePlugin.error(apiErrorMessage(err, t('upload.failed')))
    } finally {
      uploadingCount.value--
    }
  }))
}

function removeInternal(i: number) {
  const next = [...internalUrls.value]
  next.splice(i, 1)
  updateNodeData(props.id, { imageUrls: next })
}

async function pickFromLibrary() {
  if (!picker) return
  const items = await picker.open({ mediaType: 'image', multiSelect: true })
  if (items.length > 0) {
    for (const it of items) registerThumb(it.fileUrl, it.thumbnailUrl)
    const next = [...internalUrls.value, ...items.map(it => it.fileUrl)]
    updateNodeData(props.id, { imageUrls: next })
  }
}
</script>

<style scoped>
@import './node-shared.css';
.coll { width: 280px; height: 300px; }
.grid {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  align-content: start;
}
.cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: 8px;
  overflow: hidden;
  background: var(--media-bg);
  border: 1px solid var(--line);
}
.cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
.cell-x {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: rgba(4, 9, 28, .66);
  color: var(--on-scrim);
  cursor: pointer;
}
.cell-x:hover { background: rgba(4, 9, 28, .9); }
.cell-x svg { width: 11px; height: 11px; }

.upstream-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--kind-image-fg);
  background: var(--kind-image-bg);
  border-color: rgba(63, 216, 255, .3);
  font: 500 12px var(--f-mono);
}
.upstream-cell svg { width: 16px; height: 16px; }

.add-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0;
  cursor: pointer;
  color: var(--text-3);
  background: rgba(4, 9, 28, .3);
  border: 1px dashed var(--line-2);
  font: inherit;
  transition: border-color .15s ease, color .15s ease;
}
.add-cell:hover { border-color: var(--cyan); color: var(--cyan-soft); }
.plus-label { font-size: 11px; }

.uploading-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  border-style: dashed;
  border-color: var(--line-2);
}
.uploading-cell .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cyan);
  animation: cv-pulse 1s ease-in-out infinite;
}
@keyframes cv-pulse {
  0%, 100% { opacity: .3; transform: scale(.85); }
  50% { opacity: 1; transform: scale(1.1); }
}
</style>
