<template>
  <component :is="to ? 'router-link' : 'span'" :to="to" class="lc-logo">
    <img v-if="app.logoUrl" :src="app.logoUrl" class="lc-logo-img" alt="" />
    <svg v-else class="lc-logo-mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient :id="gid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" class="s1" /><stop offset=".5" class="s2" /><stop offset="1" class="s3" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" class="plate" :stroke="`url(#${gid})`" stroke-width="1.6" />
      <path d="M8 11h5c4 0 3 10 7 10h4M8 21h5c4 0 3-10 7-10h4" fill="none" :stroke="`url(#${gid})`" stroke-width="2" stroke-linecap="round" />
      <circle cx="8" cy="11" r="2" class="d1" /><circle cx="8" cy="21" r="2" class="d2" />
      <circle cx="24" cy="11" r="2" class="d3" /><circle cx="24" cy="21" r="2" class="d1" />
    </svg>
    <span v-if="!markOnly" class="lc-logo-name">{{ app.siteName }}</span>
  </component>
</template>

<script setup lang="ts">
import { useAppStore } from '@/stores/app'

defineProps<{ to?: string; markOnly?: boolean }>()
const app = useAppStore()
// 同一页可能出现两个 Logo（落地页的导航和页脚），渐变 id 不能撞
const gid = 'lcg' + Math.random().toString(36).slice(2, 8)
</script>

<style>
.lc-logo { display: inline-flex; align-items: center; gap: 10px; font: 600 17px/1 var(--f-disp); letter-spacing: .01em; color: var(--text); text-decoration: none; min-width: 0; }
.lc-logo:hover { text-decoration: none; }
.lc-logo-mark { width: 28px; height: 28px; flex: none; }
/* 标志的颜色走品牌色带令牌（SVG 属性不认 var()，所以写成类） */
.lc-logo-mark .plate { fill: var(--logo-plate); }
.lc-logo-mark .s1 { stop-color: var(--hue-cyan); }
.lc-logo-mark .s2 { stop-color: var(--hue-blue); }
.lc-logo-mark .s3 { stop-color: var(--hue-violet); }
.lc-logo-mark .d1 { fill: var(--hue-cyan); }
.lc-logo-mark .d2 { fill: var(--hue-sky); }
.lc-logo-mark .d3 { fill: var(--hue-lilac); }
.lc-logo-img { height: 28px; max-width: 132px; object-fit: contain; flex: none; }
.lc-logo-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
