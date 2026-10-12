<template>
  <!-- 分组：只画一个带标题的框，尺寸来自节点数据 -->
  <div v-if="type === 'frame'" class="sn-frame" :style="frameStyle">
    <span v-if="data.label" class="sn-frame-title">{{ data.label }}</span>
  </div>

  <div v-else class="cv-node share-node" :class="`sn-${type}`">
    <div class="cv-head">
      <LcIcon :name="iconName" />
      <span class="cv-title">{{ typeLabel }}</span>
      <span v-if="modelName" class="cv-head-x" :title="modelName">{{ modelName }}</span>
    </div>

    <div class="cv-body">
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
          <span v-else class="sn-empty">{{ t('nodeui.share.noResult') }}</span>
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
          <span v-else class="sn-empty">{{ t('nodeui.share.noResult') }}</span>
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
import LcIcon from '@/components/LcIcon.vue'

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

// 表头图标：和编辑态各节点用的是同一套
const ICONS: Record<string, string> = {
  'text': 'text', 'llm': 'chat', 'image-edit': 'edit', 'image-collection': 'layout', 'output': 'check',
  'slice': 'layout', 'collage': 'layout', 'watermark': 'shield', 'fit-size': 'fit', 'platform-export': 'share',
}
const iconName = computed(() => ICONS[props.type] || (VIDEO_TYPES.has(props.type) || props.type === 'video-analysis' ? 'video' : 'image'))

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
// 表头右侧的副标：生成类节点用的是哪个模型
const GEN_TYPES = new Set(['image-gen', 'image-edit', 'video-gen', 'video-edit'])
// 看分享的人没有发布者的服务商（多半连账号都没有），模型标识对他们没有意义，也查不出名字：
// 显示发布时随快照存下的显示名；快照里没有（发布者已经删掉了这个模型）就写一个中性的说法，不露出标识。
const modelName = computed(() => {
  const m = props.data.model
  if (!m || !GEN_TYPES.has(props.type)) return ''
  const stored = typeof props.data.modelLabel === 'string' ? props.data.modelLabel.trim() : ''
  return stored || t('nodeui.share.modelUnlisted')
})

interface H { id: string; type: 'source' | 'target'; position: Position; cls: string; style?: Record<string, string> }

const HANDLES: Record<string, H[]> = {
  'text': [
    { id: 'text-out', type: 'source', position: Position.Right, cls: 'h-text h-top' },
  ],
  'image': [
    { id: 'image-out', type: 'source', position: Position.Right, cls: 'h-image h-top' },
  ],
  'image-collection': [
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image' },
    { id: 'image-out', type: 'source', position: Position.Right, cls: 'h-image h-top' },
  ],
  'image-gen': [
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text' },
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image' },
    { id: 'image-out', type: 'source', position: Position.Right, cls: 'h-image h-top' },
  ],
  'image-edit': [
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image' },
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text' },
    { id: 'image-out', type: 'source', position: Position.Right, cls: 'h-image h-top' },
  ],
  'video-gen': [
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text' },
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image' },
    { id: 'video-out', type: 'source', position: Position.Right, cls: 'h-video h-top' },
  ],
  'video': [
    { id: 'video-out', type: 'source', position: Position.Right, cls: 'h-video h-top' },
  ],
  'video-edit': [
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text' },
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image' },
    { id: 'video-in', type: 'target', position: Position.Left, cls: 'h-video' },
    { id: 'video-out', type: 'source', position: Position.Right, cls: 'h-video h-top' },
  ],
  'video-analysis': [
    { id: 'video-in', type: 'target', position: Position.Left, cls: 'h-video' },
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image' },
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text' },
    { id: 'text-out', type: 'source', position: Position.Right, cls: 'h-text h-top' },
  ],
  'llm': [
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image' },
    { id: 'text-in', type: 'target', position: Position.Left, cls: 'h-text' },
    { id: 'text-out', type: 'source', position: Position.Right, cls: 'h-text h-top' },
  ],
  'output': [
    { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image' },
    { id: 'video-in', type: 'target', position: Position.Left, cls: 'h-video' },
  ],
}
// 五个工具节点的端口一样：左进一张（或一组）图，右出图
const TOOL_HANDLES: H[] = [
  { id: 'image-in', type: 'target', position: Position.Left, cls: 'h-image' },
  { id: 'image-out', type: 'source', position: Position.Right, cls: 'h-image h-top' },
]
// 输入口从表头下方起自上而下排开（多个输入口各占一行的高度），输出口在表头那一行
const handles = computed<H[]>(() => {
  const list = TOOL_TYPES.has(props.type) ? TOOL_HANDLES : (HANDLES[props.type] || [])
  const targets = list.filter(h => h.type === 'target')
  if (targets.length < 2) return list.map(h => (h.type === 'target' ? { ...h, cls: h.cls + ' h-top' } : h))
  let i = 0
  return list.map(h => (h.type === 'target' ? { ...h, style: { top: `${52 + 22 * i++}px` } } : h))
})
</script>

<style scoped>
@import './node-shared.css';
/* 只读节点：和编辑态同一种卡片，去掉全部控件，只留内容 */
.share-node { width: 240px; min-height: 104px; cursor: default; }

/* 分组：只画一个带标题的虚线框 */
.sn-frame {
  position: relative;
  border: 1.5px dashed rgb(var(--c-cyan) / .4);
  border-radius: 18px;
  background: rgb(var(--c-cyan) / .04);
  box-sizing: border-box;
}
.sn-frame-title {
  position: absolute; top: -32px; left: 0;
  max-width: 100%; height: 26px; padding: 0 10px; display: inline-flex; align-items: center;
  background: rgb(var(--c-glass) / .92); border: 1px solid var(--line-2); border-radius: 9px;
  font: 600 12px var(--f-body); color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.sn-text,
.sn-prompt {
  margin: 0;
  border-radius: 9px;
  background: var(--well);
  border: 1px solid var(--line);
  padding: 8px 10px;
  color: var(--text-2);
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}
.sn-text { max-height: 180px; }
.sn-prompt { max-height: 96px; }
.sn-media { border-radius: 9px; border: 1px solid var(--line); overflow: hidden; background: var(--media-bg); }
.sn-media img, .sn-media video { width: 100%; display: block; }
.sn-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.sn-grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); display: block; }
.sn-empty {
  display: block; text-align: center; color: var(--text-3); font-size: 12px; padding: 20px 8px;
}
.sn-grid .sn-empty { grid-column: 1 / -1; border: 1px dashed var(--line-2); border-radius: 9px; }
</style>
