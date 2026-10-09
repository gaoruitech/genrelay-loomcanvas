<template>
  <!-- 分组：只画一个带标题的框，尺寸来自节点数据 -->
  <div v-if="type === 'frame'" class="sn-frame" :style="frameStyle">
    <span v-if="data.label" class="sn-frame-title">{{ data.label }}</span>
  </div>

  <div v-else class="share-node" :class="`sn-${type}`">
    <div class="sn-head">
      <span class="sn-dot" :class="dotClass" />
      <span class="sn-title">{{ typeLabel }}</span>
    </div>

    <div class="sn-body">
      <!-- 文本 / 大语言模型的回答 / 视频分析的结论 -->
      <p v-if="TEXT_TYPES.has(type)" class="sn-text">{{ data.text || t('nodeui.share.emptyText') }}</p>

      <!-- 单图 -->
      <div v-else-if="type === 'image'" class="sn-media">
        <img v-if="data.imageUrl" :src="https(data.imageUrl)" alt="" />
        <span v-else class="sn-empty">{{ t('nodeui.share.noImage') }}</span>
      </div>

      <!-- 图片集合 -->
      <div v-else-if="type === 'image-collection'" class="sn-grid">
        <img v-for="(u, i) in (data.imageUrls || [])" :key="i" :src="https(u)" alt="" />
        <span v-if="!(data.imageUrls && data.imageUrls.length)" class="sn-empty">{{ t('nodeui.share.noImage') }}</span>
      </div>

      <!-- 图片生成 / 图片编辑 -->
      <template v-else-if="type === 'image-gen' || type === 'image-edit'">
        <div v-if="promptText" class="sn-prompt">{{ promptText }}</div>
        <div class="sn-media">
          <img v-if="data.imageUrl" :src="https(data.imageUrl)" alt="" />
          <span v-else class="sn-empty">{{ modelLabel }}</span>
        </div>
      </template>

      <!-- 视频 -->
      <div v-else-if="type === 'video'" class="sn-media">
        <video v-if="data.videoUrl" :src="https(data.videoUrl)" muted preload="metadata" controls />
        <span v-else class="sn-empty">{{ t('nodeui.share.noResult') }}</span>
      </div>

      <!-- 工具节点：切片 / 多平台导出出一组图，其余出一张 -->
      <template v-else-if="TOOL_TYPES.has(type)">
        <div v-if="toolImages.length > 1" class="sn-grid">
          <img v-for="(u, i) in toolImages" :key="i" :src="https(u)" alt="" />
        </div>
        <div v-else class="sn-media">
          <img v-if="toolImages[0]" :src="https(toolImages[0])" alt="" />
          <span v-else class="sn-empty">{{ t('nodeui.share.noResult') }}</span>
        </div>
      </template>

      <!-- 视频生成 / 视频编辑 -->
      <template v-else-if="type === 'video-gen' || type === 'video-edit'">
        <div v-if="data.prompt" class="sn-prompt">{{ data.prompt }}</div>
        <div class="sn-media">
          <video v-if="data.videoUrl" :src="https(data.videoUrl)" muted preload="metadata" controls />
          <span v-else class="sn-empty">{{ modelLabel }}</span>
        </div>
      </template>

      <!-- 成品 -->
      <div v-else-if="type === 'output'" class="sn-media">
        <img v-if="data.imageUrl" :src="https(data.imageUrl)" alt="" />
        <video v-else-if="data.videoUrl" :src="https(data.videoUrl)" muted preload="metadata" controls />
        <span v-else class="sn-empty">{{ t('nodes.title.output') }}</span>
      </div>
    </div>

    <!-- 连接点（与编辑态一致，保证连线正确渲染） -->
    <Handle
      v-for="h in handles"
      :key="h.id"
      :id="h.id"
      :type="h.type"
      :position="h.position"
      :class="h.cls"
      :style="h.style"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { ensureHttps } from '@/utils/mediaUrl'
import { getAdapter } from '@/utils/canvasModels'

const props = defineProps<{
  id: string
  type: string
  data: Record<string, any>
}>()

const https = (u: string) => (u ? ensureHttps(u) : u)

const { t } = useI18n()

const LABEL_KEYS: Record<string, string> = {
  'text': 'nodes.title.text',
  'image': 'nodes.title.image',
  'image-collection': 'nodes.title.imageCollection',
  'image-gen': 'nodes.title.imageGen',
  'image-edit': 'nodes.title.imageEdit',
  'video': 'nodes.title.video',
  'video-gen': 'nodes.title.videoGen',
  'video-edit': 'nodes.title.videoEdit',
  'video-analysis': 'nodes.title.videoAnalysis',
  'llm': 'nodes.title.llm',
  'output': 'nodes.title.output',
  'platform-export': 'nodes.title.platformExport',
  'slice': 'nodes.title.slice',
  'collage': 'nodes.title.collage',
  'watermark': 'nodes.title.watermark',
  'fit-size': 'nodes.title.fitSize',
}

const TEXT_TYPES = new Set(['text', 'llm', 'video-analysis'])
const VIDEO_TYPES = new Set(['video', 'video-gen', 'video-edit'])
const TOOL_TYPES = new Set(['platform-export', 'slice', 'collage', 'watermark', 'fit-size'])
const typeLabel = computed(() => (LABEL_KEYS[props.type] ? t(LABEL_KEYS[props.type]) : props.type))

const dotClass = computed(() => {
  if (TEXT_TYPES.has(props.type)) return 'd-text'
  if (VIDEO_TYPES.has(props.type)) return 'd-video'
  return 'd-image'
})

const toolImages = computed<string[]>(() => {
  const list = Array.isArray(props.data.imageUrls) ? props.data.imageUrls.filter(Boolean) : []
  if (list.length) return list
  return props.data.imageUrl ? [props.data.imageUrl] : []
})

const frameStyle = computed(() => ({
  width: `${Number(props.data.w) || 320}px`,
  height: `${Number(props.data.h) || 240}px`,
}))

const promptText = computed(() => props.data.prompt || props.data.instruction || '')
const modelLabel = computed(() => {
  const m = props.data.model
  return m ? t('nodeui.share.model', { model: getAdapter(m)?.label || m }) : t('nodeui.share.noResult')
})

interface H { id: string; type: 'source' | 'target'; position: Position; cls: string; style?: Record<string, string> }

const HANDLES: Record<string, H[]> = {
  'text': [
    { id: 'text-out', type: 'source', position: Position.Right, cls: 'h-text' },
  ],
  'image': [
    { id: 'image-out', type: 'source', position: Position.Right, cls: 'h-image' },
  ],
  'image-collection': [
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image' },
    { id: 'image-out', type: 'source', position: Position.Right, cls: 'h-image' },
  ],
  'image-gen': [
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text', style: { top: '38%' } },
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image', style: { top: '50%' } },
    { id: 'image-out', type: 'source', position: Position.Right, cls: 'h-image' },
  ],
  'image-edit': [
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image', style: { top: '38%' } },
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text', style: { top: '50%' } },
    { id: 'image-out', type: 'source', position: Position.Right, cls: 'h-image' },
  ],
  'video-gen': [
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text', style: { top: '38%' } },
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image', style: { top: '50%' } },
    { id: 'video-out', type: 'source', position: Position.Right, cls: 'h-video' },
  ],
  'video': [
    { id: 'video-out', type: 'source', position: Position.Right, cls: 'h-video' },
  ],
  'video-edit': [
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text', style: { top: '38%' } },
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image', style: { top: '50%' } },
    { id: 'video-in', type: 'target', position: Position.Left, cls: 'h-video', style: { top: '62%' } },
    { id: 'video-out', type: 'source', position: Position.Right, cls: 'h-video' },
  ],
  'video-analysis': [
    { id: 'video-in', type: 'target', position: Position.Left, cls: 'h-video', style: { top: '30%' } },
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image', style: { top: '52%' } },
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text', style: { top: '74%' } },
    { id: 'text-out', type: 'source', position: Position.Right, cls: 'h-text' },
  ],
  'llm': [
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image', style: { top: '38%' } },
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text', style: { top: '66%' } },
    { id: 'text-out', type: 'source', position: Position.Right, cls: 'h-text' },
  ],
  'output': [
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image', style: { top: '38%' } },
    { id: 'video-in', type: 'target', position: Position.Left, cls: 'h-video', style: { top: '50%' } },
  ],
}
// 五个工具节点的端口一样：左进一张（或一组）图，右出图
const TOOL_HANDLES: H[] = [
  { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image' },
  { id: 'image-out', type: 'source', position: Position.Right, cls: 'h-image' },
]
const handles = computed<H[]>(() =>
  TOOL_TYPES.has(props.type) ? TOOL_HANDLES : (HANDLES[props.type] || []))
</script>

<style scoped>
.share-node {
  width: 220px;
  background: var(--n-3);
  border: 1px solid var(--n-6);
  border-radius: 12px;
  color: var(--t-strong);
  font-size: 13px;
  overflow: hidden;
}
.sn-frame {
  position: relative;
  border: 1.5px dashed color-mix(in srgb, var(--accent-text) 55%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--accent-text) 5%, transparent);
  box-sizing: border-box;
}
.sn-frame-title {
  position: absolute; top: -30px; left: 0;
  max-width: 100%; padding: 4px 10px;
  background: var(--n-2); border: 1px solid var(--n-5); border-radius: 9px;
  font-size: 12px; font-weight: 600; color: var(--t-strong);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sn-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; border-bottom: 1px solid var(--n-5);
  font-weight: 600; font-size: 12px;
}
.sn-dot { width: 8px; height: 8px; border-radius: 50%; }
.d-text { background: var(--info); }
.d-image { background: var(--accent); }
.d-video { background: #ff9d5c; }
.sn-body { padding: 10px 12px; }
.sn-text {
  margin: 0; white-space: pre-wrap; word-break: break-word;
  max-height: 160px; overflow: auto; line-height: 1.5; color: var(--t-body);
}
.sn-prompt {
  margin-bottom: 8px; color: var(--t-dim); line-height: 1.5;
  max-height: 96px; overflow: auto; word-break: break-word;
}
.sn-media img, .sn-media video {
  width: 100%; border-radius: 8px; display: block; background: var(--n-0);
}
.sn-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px;
}
.sn-grid img { width: 100%; border-radius: 6px; display: block; }
.sn-empty {
  display: block; text-align: center; color: var(--t-dim); font-size: 12px;
  padding: 18px 0; border: 1px dashed var(--n-6); border-radius: 8px;
}
:deep(.h-text) { background: var(--info) !important; }
:deep(.h-image) { background: var(--accent) !important; }
:deep(.h-video) { background: #ff9d5c !important; }
</style>
