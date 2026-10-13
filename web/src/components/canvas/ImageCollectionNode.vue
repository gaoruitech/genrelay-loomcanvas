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
        <!-- 点缩略图放大看（可编辑时也一样：小图看不清内容）；移除只在可编辑时有 -->
        <button v-if="viewer" type="button" class="cell-v" v-tip="t('gen.view.image')" :aria-label="t('gen.node.nthImage', { n: i + 1 }) + ' · ' + t('gen.view.image')" data-testid="node-view" @click.stop="viewer(url, 'image')">
          <img :src="canvasImageThumb(url, 96)" alt="" />
        </button>
        <img v-else :src="canvasImageThumb(url, 96)" alt="" />
        <button v-if="!ro" class="cell-x" v-tip="t('common.remove')" :aria-label="t('common.remove')" @click.stop="removeInternal(i)"><LcIcon name="x" size="s" /></button>
      </div>

      <div v-for="i in uploadingCount" :key="`up-${i}`" class="cell uploading-cell">
        <span class="dot"></span>
      </div>

      <div v-if="upstreamCount > 0" class="cell upstream-cell" v-tip="t('nodeui.collection.upstream', { n: upstreamCount })">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
        <span>{{ upstreamCount }}</span>
      </div>

      <!-- 只读：没有上传、没有从素材库选；一张都没有时写一句话 -->
      <span v-if="ro && !totalCount" class="coll-none">{{ t('nodeui.share.noImage') }}</span>
      <label v-if="!ro" class="cell add-cell">
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

      <button v-if="$feat.assetLibrary && !ro" class="cell add-cell pick-cell" v-tip="t('nodes.action.pickFromLibrary')" :aria-label="t('nodes.action.pickFromLibrary')" @click.stop="pickFromLibrary">
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
import { MessagePlugin } from '@/utils/feedback'
import { useI18n } from 'vue-i18n'
import { CANVAS_PICKER_KEY } from '@/composables/canvasPickerKey'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import { apiErrorMessage } from '@/utils/api'
import { canvasImageThumb, registerThumb } from '@/utils/canvasMedia'
import LcIcon from '@/components/LcIcon.vue'
import { useCanvasReadOnly, useCanvasViewer } from '@/composables/nodeLayout'

const props = defineProps<{
  id: string
  data: { imageUrls?: string[] }
  selected?: boolean
}>()

const { t } = useI18n()
const { updateNodeData, edges } = useVueFlow()
const picker = inject(CANVAS_PICKER_KEY)
/** 只读（别人正在编辑、只有查看权）：能点开看大图，不能加、不能移除 */
const ro = useCanvasReadOnly()
const viewer = useCanvasViewer()

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
      // 传到一半丢了编辑权：不往节点里写
      if (!ro.value) updateNodeData(props.id, { imageUrls: [...(props.data.imageUrls || []), url] })
    } catch (err: any) {
      MessagePlugin.error(apiErrorMessage(err, t('upload.failed')))
    } finally {
      uploadingCount.value--
    }
  }))
}

function removeInternal(i: number) {
  if (ro.value) return
  const next = [...internalUrls.value]
  next.splice(i, 1)
  updateNodeData(props.id, { imageUrls: next })
}

async function pickFromLibrary() {
  if (!picker || ro.value) return
  const items = await picker.open({ mediaType: 'image', multiSelect: true })
  if (items.length > 0 && !ro.value) {
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
/* 缩略图本身是一颗按钮：点开看大图 */
.cell-v { display: block; width: 100%; height: 100%; padding: 0; border: 0; border-radius: inherit; background: none; cursor: zoom-in; }
.cell-v:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--cyan); }
/* 只读、一张图都没有 */
.coll-none { grid-column: 1 / -1; padding: 20px 12px; border: 1px dashed var(--line-2); border-radius: 9px; color: var(--text-3); font-size: 12px; text-align: center; }
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
  background: rgb(var(--c-scrim) / .66);
  color: var(--on-scrim);
  cursor: pointer;
}
.cell-x:hover { background: var(--scrim-danger); color: var(--on-scrim-max); }
.cell-x:focus-visible { outline: none; opacity: 1; box-shadow: 0 0 0 2px var(--on-scrim-line-2); }
.cell-x svg { width: 11px; height: 11px; }

.upstream-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--kind-image-fg);
  background: var(--kind-image-bg);
  border-color: rgb(var(--c-cyan) / .3);
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
  background: rgb(var(--c-well) / .3);
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
