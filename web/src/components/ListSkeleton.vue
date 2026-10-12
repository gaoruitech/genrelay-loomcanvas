<template>
  <!-- 画布卡：16:10 缩略图 + 名称/时间（对齐 CanvasList.vue 的 .card） -->
  <div
    v-for="n in count"
    :key="n"
    class="skel-canvas-card"
    :class="{ 'skel-leave': leaving }"
    aria-hidden="true"
  >
    <div class="skel skel-canvas-thumb"></div>
    <div class="skel-canvas-meta">
      <span class="skel" style="width:62%; height:12px;"></span>
      <span class="skel" style="width:38%; height:10px;"></span>
    </div>
  </div>
</template>

<script setup lang="ts">
/*
 * 列表骨架屏。
 *
 * 只在「冷启动」用 —— 屏幕上确实没有任何可信内容可展示的时候。
 * 已经有内容时的刷新不该出现骨架。
 *
 * ⚠️ 这个组件是**多根 fragment**，故意不套外层容器：
 *    直接放进页面自己的网格容器里，骨架卡就成了那个容器的直接子项，
 *    列宽、间距、行为跟真卡片完全一致，数据到位替换时零布局位移。
 *
 * 配色也贴着真卡片走：卡片底色一样，图片区是近黑（真图没加载出来时本来就是黑的），
 * 只有文字条是浅一档。整体读起来像「一排还没亮起来的卡」，而不是一片灰方块。
 */
withDefaults(defineProps<{
  /** 目前只有画布卡这一种版式 */
  variant?: 'canvas'
  /** 给到首屏可见数就够，多给只会显得吵 */
  count?: number
  /** 置 true 播放淡出，父级等 220ms 再换成真内容 */
  leaving?: boolean
}>(), {
  variant: 'canvas',
  count: 6,
  leaving: false
})

// 多根节点没法自动继承外部属性，显式关掉，免得开发时冒出 extraneous attrs 警告
defineOptions({ inheritAttrs: false })
</script>

<style scoped>
/* ── 骨架块 ── */
.skel {
  background: var(--skel-bg);
  border-radius: 6px;
  position: relative;
  overflow: hidden;
  display: block;
}
.skel::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgb(var(--c-film) / .1) 45%, rgb(var(--c-film) / .1) 55%, transparent);
  animation: skel-shimmer 1.45s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
@keyframes skel-shimmer {
  to { transform: translateX(100%); }
}
/* 骨架淡出：先让位 220ms，真内容再进，不硬切 */
.skel-leave { animation: skel-out 0.22s ease forwards; }
@keyframes skel-out {
  to { opacity: 0; transform: translateY(-4px); }
}

/* ── 画布卡：和真卡片（.lc-card）同一个外形，换成真内容时不跳 ── */
.skel-canvas-card {
  background: var(--grad-card);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.skel-canvas-thumb {
  width: 100%;
  aspect-ratio: 16 / 10;
  border-radius: 0;
  --skel-bg: rgb(var(--c-well) / .5);
}
.skel-canvas-meta {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
