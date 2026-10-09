<template>
  <div class="cv-node coll" :class="{ selected }">
    <div class="cv-node-header">
      <span class="cv-count">{{ t('nodeui.collection.total', { n: totalCount }) }}</span>
    </div>

    <div class="grid nodrag" @mousedown.stop>
      <div v-for="(url, i) in internalUrls" :key="`int-${i}`" class="cell">
        <img :src="canvasImageThumb(url, 96)" alt="" />
        <button class="cell-x" @click.stop="removeInternal(i)" :title="t('common.remove')">×</button>
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
        <span class="plus">+</span>
        <span class="plus-label">{{ t('common.upload') }}</span>
      </label>

      <button class="cell add-cell pick-cell" :title="t('nodes.action.pickFromLibrary')" @click.stop="pickFromLibrary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <span class="plus-label">{{ t('nodeui.collection.library') }}</span>
      </button>
    </div>

    <Handle id="image-in" type="target" :position="Position.Left" class="h-image" />
    <Handle id="image-out" type="source" :position="Position.Right" class="h-image" />
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
.coll { min-width: 280px; max-width: 280px; height: 300px; }
.coll .grid { flex: 1 1 auto; align-content: start; }
.cv-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--t-dim);
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.cell {
  position: relative;
  aspect-ratio: 1;
  border-radius: 6px;
  overflow: hidden;
  background: var(--n-2);
  border: 1px solid var(--n-5);
}
.cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cell-x {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--scrim);
  border: none;
  color: var(--on-scrim);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cell-x:hover { background: rgba(0, 0, 0, 0.9); }

.upstream-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--info);
  background: rgba(74, 163, 255, 0.08);
  border-color: rgba(74, 163, 255, 0.3);
  font-size: 11px;
  font-weight: 500;
}
.upstream-cell svg {
  width: 18px;
  height: 18px;
}

.add-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--t-dim);
  border-style: dashed;
  transition: border-color 0.15s ease, color 0.15s ease;
  font-size: 11px;
  gap: 2px;
}
.add-cell:hover { border-color: var(--accent-text); color: var(--accent-text); }
.plus { font-size: 22px; line-height: 1; }
.plus-label { font-size: 10px; }

.pick-cell {
  background: transparent;
  font-family: inherit;
  padding: 0;
}
.pick-cell svg { width: 18px; height: 18px; }

.uploading-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--t-dim);
  border-style: dashed;
}
.uploading-cell .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--n-10);
  animation: cv-pulse 1s ease-in-out infinite;
}
@keyframes cv-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.85); }
  50%      { opacity: 1;   transform: scale(1.1); }
}
</style>
