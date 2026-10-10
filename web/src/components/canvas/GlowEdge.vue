<template>
  <!-- 渐变沿连线方向走（起点色 → 终点色），所以每条线一份 userSpaceOnUse 的渐变 -->
  <defs>
    <linearGradient :id="gradId" gradientUnits="userSpaceOnUse" :x1="sourceX" :y1="sourceY" :x2="targetX" :y2="targetY">
      <stop offset="0" :stop-color="palette.from" />
      <stop offset="1" :stop-color="palette.to" />
    </linearGradient>
  </defs>
  <!-- 看不见的厚轨道，扩大点击命中区，便于点选 / hover -->
  <path :d="d" class="cv-edge-hit" fill="none" />
  <path
    :d="d"
    class="cv-edge-line"
    :class="{ selected }"
    :style="{ '--edge-glow': palette.glow }"
    :stroke="`url(#${gradId})`"
    fill="none"
    :marker-end="markerEnd"
  />
  <!-- 流光：只有下游节点正在运行（数据正往那边送）或这条线被选中时才画，平时不占合成 -->
  <path v-if="flowing || selected" :d="d" class="cv-edge-flow" fill="none" />

  <EdgeLabelRenderer>
    <button
      v-if="selected"
      type="button"
      class="cv-edge-cut nodrag nopan"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
      :title="t('nodeui.edge.remove')"
      :aria-label="t('nodeui.edge.remove')"
      @mousedown.stop
      @click.stop="onCut"
    >
      <LcIcon name="x" size="s" />
    </button>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getBezierPath, useVueFlow, EdgeLabelRenderer, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'

// 根是多个 <path>（片段），vue-flow 传下来的其余连线属性不往下挂
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  id: string
  target: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  selected?: boolean
  markerEnd?: string
  sourceHandleId?: string | null
  targetHandleId?: string | null
}>()

const { t } = useI18n()
const { removeEdges, findNode } = useVueFlow()

// 连线颜色跟随数据类型，与两端端口（handle）配色一致：
// 图片=青→紫、视频=紫、文本=蓝→青。取 handle id 前缀（如 image-out → image）判定。
const PALETTES = {
  image: { from: '#3fd8ff', to: '#8a5cff', glow: 'rgba(63, 216, 255, .65)' },
  video: { from: '#c7b3ff', to: '#8a5cff', glow: 'rgba(138, 92, 255, .75)' },
  text: { from: '#7db2ff', to: '#3fd8ff', glow: 'rgba(90, 155, 255, .65)' },
} as const
const palette = computed(() => {
  const raw = props.sourceHandleId || props.targetHandleId || ''
  const kind = raw.split('-')[0]
  if (kind === 'image' || kind === 'video') return PALETTES[kind]
  return PALETTES.text // text 及兜底
})

// 渐变的 id 要能放进 url(#…)：连线 id 里可能带冒号等字符
const gradId = computed(() => 'cv-eg-' + props.id.replace(/[^\w-]/g, '_'))

// 下游节点在跑：这条线正在「送数据」
const flowing = computed(() => findNode(props.target)?.data?.status === 'running')

const bezier = computed(() => {
  const r = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetX: props.targetX,
    targetY: props.targetY,
    sourcePosition: props.sourcePosition,
    targetPosition: props.targetPosition,
  })
  // vue-flow 的 getBezierPath 返回 [path, labelX, labelY, offsetX, offsetY]
  if (Array.isArray(r)) return { d: r[0], labelX: r[1], labelY: r[2] }
  return { d: r as unknown as string, labelX: (props.sourceX + props.targetX) / 2, labelY: (props.sourceY + props.targetY) / 2 }
})
const d = computed(() => bezier.value.d)
const labelX = computed(() => bezier.value.labelX)
const labelY = computed(() => bezier.value.labelY)

function onCut() {
  removeEdges([props.id])
}
</script>

<style scoped>
/* 透明加宽 hit 路径，让边更容易被点中 */
.cv-edge-hit {
  stroke: transparent;
  stroke-width: 18;
  cursor: pointer;
  pointer-events: stroke;
}

/* 主线：2px 渐变 + 一圈柔光。静态，不跑动画 —— 边一多，常驻动画是大画布卡顿的元凶之一 */
.cv-edge-line {
  stroke-width: 2;
  stroke-linecap: round;
  filter: drop-shadow(0 0 4px var(--edge-glow));
  pointer-events: none;
  transition: stroke-width .12s ease;
}
.cv-edge-hit:hover + .cv-edge-line { stroke-width: 2.6; }
.cv-edge-line.selected {
  stroke-width: 3;
  filter: drop-shadow(0 0 5px var(--edge-glow)) drop-shadow(0 0 12px var(--edge-glow));
}

/* 流光：亮色短划沿线流向下游 */
.cv-edge-flow {
  stroke: #dff8ff;
  stroke-width: 2;
  stroke-dasharray: 4 20;
  stroke-linecap: round;
  opacity: .7;
  pointer-events: none;
}
@media (prefers-reduced-motion: no-preference) {
  .cv-edge-flow { animation: cv-edge-flow 2.8s linear infinite; }
}
@keyframes cv-edge-flow {
  to { stroke-dashoffset: -48; }
}

/* 选中后中点的断开按钮 */
.cv-edge-cut {
  position: absolute;
  pointer-events: all;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 50%;
  background: #131f4a;
  border: 1px solid var(--line-3);
  color: var(--text-2);
  display: grid;
  place-items: center;
  cursor: pointer;
  box-shadow: var(--sh-1);
  transition: background .15s ease, color .15s ease, border-color .15s ease;
  z-index: 10;
}
.cv-edge-cut:hover {
  background: rgba(255, 107, 139, .18);
  border-color: rgba(255, 107, 139, .6);
  color: var(--err-soft);
}
</style>
