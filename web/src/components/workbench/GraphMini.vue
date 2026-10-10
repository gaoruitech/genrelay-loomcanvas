<template>
  <svg class="gm" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path v-for="(d, i) in layout.wires" :key="'w' + i" class="gm-w" :d="d" />
    <rect
      v-for="(n, i) in layout.boxes"
      :key="'n' + i"
      class="gm-n"
      :class="n.kind"
      :x="n.x" :y="n.y" :width="n.w" :height="n.h" rx="3"
    />
  </svg>
</template>

<script setup lang="ts">
/**
 * 节点图的示意缩略图：按模板里节点的真实位置和连线画一张小地图。
 * 内置模板没有封面图，用它代替 —— 画的是这个模板真实的结构，不是装饰画。
 */
import { computed } from 'vue'

const props = defineProps<{ graph?: { nodes?: any[]; edges?: any[] } | null }>()

const W = 160
const H = 72
/** 画布坐标里一个节点大致的占地（节点本身没有存尺寸） */
const NODE_W = 280
const NODE_H = 170

function kindOf(type: string): string {
  const s = String(type || '').toLowerCase()
  if (s.includes('video')) return 'video'
  if (s.includes('text') || s.includes('llm')) return 'chat'
  return 'image'
}

const layout = computed(() => {
  const nodes = (props.graph?.nodes || []).filter((n: any) => n && n.id)
  if (!nodes.length) return { boxes: [], wires: [] }
  const xs = nodes.map((n: any) => Number(n.position?.x) || 0)
  const ys = nodes.map((n: any) => Number(n.position?.y) || 0)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const spanX = Math.max(...xs) - minX + NODE_W
  const spanY = Math.max(...ys) - minY + NODE_H
  const pad = 8
  const k = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY)
  const ox = (W - spanX * k) / 2
  const oy = (H - spanY * k) / 2
  const at = new Map<string, { x: number; y: number; w: number; h: number; kind: string }>()
  nodes.forEach((n: any, i: number) => {
    at.set(n.id, { x: ox + (xs[i] - minX) * k, y: oy + (ys[i] - minY) * k, w: NODE_W * k, h: NODE_H * k, kind: kindOf(n.type) })
  })
  const wires: string[] = []
  for (const e of props.graph?.edges || []) {
    const a = at.get(e.source)
    const b = at.get(e.target)
    if (!a || !b) continue
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2
    const c = Math.max(6, Math.abs(x2 - x1) / 2)
    wires.push(`M${x1.toFixed(1)} ${y1.toFixed(1)}C${(x1 + c).toFixed(1)} ${y1.toFixed(1)} ${(x2 - c).toFixed(1)} ${y2.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`)
  }
  return { boxes: [...at.values()], wires }
})
</script>

<style scoped>
.gm { display: block; width: 100%; height: 100%; }
.gm-w { fill: none; stroke: var(--cyan); stroke-width: 1.2; opacity: .75; }
.gm-n { stroke-width: 1; fill: var(--kind-image-bg); stroke: var(--kind-image-fg); }
.gm-n.video { fill: var(--kind-video-bg); stroke: var(--kind-video-fg); }
.gm-n.chat { fill: var(--kind-chat-bg); stroke: var(--kind-chat-fg); }
</style>
