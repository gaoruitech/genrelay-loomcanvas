<template>
  <!-- 看不见的厚轨道，扩大点击命中区，便于点选 / hover -->
  <path :d="d" class="cv-edge-hit" fill="none" />
  <path :d="d" class="cv-edge-base" fill="none" :marker-end="markerEnd" />
  <path :d="d" class="cv-edge-flow" :class="{ selected }" :style="{ color: edgeColor }" fill="none" />

  <EdgeLabelRenderer>
    <div
      v-if="selected"
      class="cv-edge-cut nodrag nopan"
      :style="{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }"
      @mousedown.stop
      @click.stop="onCut"
      :title="t('nodeui.edge.remove')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6"  cy="6"  r="3" />
        <circle cx="6"  cy="18" r="3" />
        <line x1="20" y1="4"  x2="8.12" y2="15.88" />
        <line x1="14.47" y1="14.48" x2="20" y2="20" />
        <line x1="8.12" y1="8.12" x2="12" y2="12" />
      </svg>
    </div>
  </EdgeLabelRenderer>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { getBezierPath, useVueFlow, EdgeLabelRenderer, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  id: string
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
const { removeEdges } = useVueFlow()

// 连线颜色跟随数据类型，与两端连接点(handle)配色一致：
// 文本=蓝、图片=绿、视频=橙。取 handle id 前缀（如 image-out → image）判定。
const edgeColor = computed(() => {
  const raw = props.sourceHandleId || props.targetHandleId || ''
  const kind = raw.split('-')[0]
  if (kind === 'image') return 'var(--accent-text)'
  if (kind === 'video') return 'var(--lane-shop)'
  return 'var(--info)' // text 及兜底
})

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

/* 静态底线：细、暗、不闪 */
.cv-edge-base {
  stroke: rgba(170, 170, 180, 0.35);
  stroke-width: 1.2;
  pointer-events: none;
}

/* 连接线高亮层：
   默认（非选中）为静态柔光实线 —— 不跑动画。
   之前每条边都常驻流光动画，边一多就持续占用 GPU 合成，是大画布卡顿的元凶之一。
   仅在选中时才启用流光动画，兼顾观感与性能。 */
/* stroke / glow 都用 currentColor —— 颜色由行内 :style="{ color: edgeColor }" 按数据类型注入 */
.cv-edge-flow {
  stroke: currentColor;
  stroke-width: 2.2;
  stroke-linecap: round;
  /* 静态虚线（不跑动画）：6px 线 + 6px 空 */
  stroke-dasharray: 6 6;
  filter: drop-shadow(0 0 3px currentColor);
  opacity: 0.85;
  pointer-events: none;
}

.cv-edge-flow.selected {
  /* 选中：同色系加亮 + 流光动画，靠动画/更强发光区分，不改色相 */
  stroke-width: 2.6;
  opacity: 1;
  /* 18px 亮 + 56px 暗 = 74px 周期，配合负向 dashoffset 形成流向 target 的流光 */
  stroke-dasharray: 18 56;
  stroke-dashoffset: 0;
  filter:
    drop-shadow(0 0 5px currentColor)
    drop-shadow(0 0 12px currentColor);
  animation: cv-edge-flow 0.9s linear infinite;
}

@keyframes cv-edge-flow {
  from { stroke-dashoffset: 0; }
  to   { stroke-dashoffset: -74; }
}

/* 选中后中点的剪刀按钮 */
.cv-edge-cut {
  position: absolute;
  pointer-events: all;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--n-3);
  border: 1px solid var(--accent);
  color: var(--accent-text);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 10px var(--shadow-2);
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
  z-index: 10;
}
/* chip 底配 chip 字：亮色下 --chip-bg 是浅绿半透，配 --n-0 (#f9fafa) 等于
   浅字压浅底，鼠标一放上去这颗按钮就消失了 */
.cv-edge-cut:hover {
  background: var(--chip-bg);
  color: var(--chip-fg);
}
.cv-edge-cut svg { width: 12px; height: 12px; }
</style>
