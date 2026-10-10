<template>
  <section :id="id" class="lc-card set-sec" :aria-labelledby="id + '-h'">
    <h2 :id="id + '-h'"><LcIcon :name="icon" />{{ title }}</h2>
    <p class="d"><slot name="desc">{{ desc }}</slot></p>
    <slot />
  </section>
</template>

<script setup lang="ts">
/** 设置页的一个分区：图标 + 标题 + 一句说明，下面是若干行。id 同时是锚点。 */
import LcIcon from '@/components/LcIcon.vue'

defineProps<{ id: string; icon: string; title: string; desc?: string }>()
</script>

<style scoped>
.set-sec { padding: 24px; margin-bottom: 20px; min-width: 0; scroll-margin-top: 24px; }
.set-sec h2 { font: 600 17px/1.4 var(--f-disp); color: var(--text); display: flex; align-items: center; gap: 10px; }
.set-sec h2 :deep(.lc-ic) { color: var(--cyan); }
.d { color: var(--text-2); font-size: 13px; line-height: 1.7; margin: 4px 0 16px; max-width: 720px; }
/* 窄屏上目录贴在顶上，浏览器自己按锚点滚动时也要把它让出来 */
@media (max-width: 900px) { .set-sec { scroll-margin-top: 66px; } }
@media (max-width: 600px) {
  .set-sec { padding: 18px 16px; margin-bottom: 16px; }
}
</style>
