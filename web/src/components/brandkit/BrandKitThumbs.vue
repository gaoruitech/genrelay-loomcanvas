<template>
  <span class="bkt" :class="[size, { empty: !shown.length }]" aria-hidden="true">
    <img v-for="u in shown" :key="u" :src="canvasImageThumb(u, 96)" alt="" loading="lazy" />
    <LcIcon v-if="!shown.length" name="star" size="s" />
  </span>
</template>

<script setup lang="ts">
/**
 * 品牌包的「长相」：它的头几张参考图叠在一起；一张图都没有就是一个图标。
 * 品牌包没有 Logo 和品牌色这两样东西，参考图是它唯一能看的部分。
 */
import { computed } from 'vue'
import LcIcon from '@/components/LcIcon.vue'
import { canvasImageThumb } from '@/utils/canvasMedia'

const props = withDefaults(defineProps<{ images?: string[]; size?: 's' | 'm'; max?: number }>(), { images: () => [], size: 's', max: 3 })
const shown = computed(() => (props.images || []).filter(Boolean).slice(0, props.max))
</script>

<style scoped>
.bkt { display: inline-flex; align-items: center; flex: none; }
.bkt img {
  width: 20px; height: 20px; border-radius: 6px; object-fit: cover; display: block;
  background: var(--media-bg); box-shadow: 0 0 0 1.5px #131f4a;
}
.bkt img + img { margin-left: -7px; }
.bkt.empty {
  width: 20px; height: 20px; border-radius: 6px; justify-content: center;
  background: rgba(124, 160, 255, .12); color: var(--text-3);
}
.bkt.m img { width: 32px; height: 32px; border-radius: 8px; }
.bkt.m img + img { margin-left: -10px; }
.bkt.m.empty { width: 32px; height: 32px; border-radius: 8px; }
</style>
