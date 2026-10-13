<template>
  <img v-if="src && !broken" class="sav" :class="[shape, 'has-img']" :style="box" :src="$src(src)" alt="" @error="broken = true" />
  <span v-else class="sav" :class="[shape, 'tone-' + tone]" :style="box" aria-hidden="true">{{ initial }}</span>
</template>

<script setup lang="ts">
/**
 * 头像方块 / 圆：团队和空间用圆角方块，人用圆。
 * 没有图片时显示名字的第一个字，底色按名字（或给定的 seed）从几组令牌渐变里固定挑一组：
 * 同一个人、同一个团队在哪儿都是同一个颜色，不同的人大多不一样。
 */
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  name?: string
  /** 图片地址；加载不出来就退回首字 */
  src?: string
  /** 边长，像素 */
  size?: number
  /** square：团队 / 空间；round：人 */
  shape?: 'square' | 'round'
  /** 用什么定颜色；不给就用 name */
  seed?: string
}>(), { name: '', src: '', size: 28, shape: 'square', seed: '' })

const broken = ref(false)
watch(() => props.src, () => { broken.value = false })

const initial = computed(() => {
  const s = (props.name || '').trim()
  return s ? Array.from(s)[0].toUpperCase() : '?'
})
const tone = computed(() => {
  const s = props.seed || props.name || ''
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 6
})
const box = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.max(10, Math.round(props.size * 0.46))}px`,
  borderRadius: props.shape === 'round' ? '50%' : `${Math.max(6, Math.round(props.size * 0.28))}px`,
}))
</script>

<style scoped>
.sav {
  flex: none; display: inline-grid; place-items: center; color: var(--text-inv);
  font-family: var(--f-disp); font-weight: 600; line-height: 1; object-fit: cover; user-select: none;
}
.sav.has-img { background: var(--media-bg); }
.tone-0 { background: linear-gradient(135deg, rgb(var(--c-blue)), rgb(var(--c-violet))); }
.tone-1 { background: linear-gradient(135deg, rgb(var(--c-cyan)), rgb(var(--c-blue))); }
.tone-2 { background: linear-gradient(135deg, rgb(var(--c-ok)), rgb(var(--c-cyan))); }
.tone-3 { background: linear-gradient(135deg, rgb(var(--c-violet)), var(--magenta)); }
.tone-4 { background: linear-gradient(135deg, rgb(var(--c-warn)), rgb(var(--c-err))); }
.tone-5 { background: linear-gradient(135deg, var(--magenta), rgb(var(--c-warn))); }
</style>
