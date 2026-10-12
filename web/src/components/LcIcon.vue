<template>
  <!-- eslint-disable-next-line vue/no-v-html : 内容是本文件里写死的路径，不含任何用户输入 -->
  <svg class="lc-ic" :class="size" viewBox="0 0 24 24" aria-hidden="true" v-html="ICONS[name] || ''" />
</template>

<script lang="ts">
const P = (d: string) => `<path d="${d}"/>`
const C = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}"/>`
const R = (x: number, y: number, w: number, h: number, r = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`

/** 整站线性图标（24 网格，1.6 描边）。和设计稿里的那一套一一对应。 */
const ICONS: Record<string, string> = {
  home: P('M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z'),
  canvas: R(3, 4, 7, 6, 1.5) + R(14, 14, 7, 6, 1.5) + P('M10 7h3a3 3 0 0 1 3 3v4'),
  assets: R(3, 5, 18, 14, 2) + C(8.5, 10, 1.5) + P('M21 16l-5-5-8 8'),
  image: R(3, 5, 18, 14, 2) + C(8.5, 10, 1.5) + P('M21 16l-5-5-8 8'),
  models: P('M12 3l9 4.5-9 4.5-9-4.5zM3 12l9 4.5 9-4.5M3 16.5l9 4.5 9-4.5'),
  history: C(12, 12, 9) + P('M12 7v5l3 2'),
  settings: P('M4 7h10M18 7h2M4 17h2M10 17h10') + C(16, 7, 2) + C(8, 17, 2),
  search: C(11, 11, 6) + P('M20 20l-4.5-4.5'),
  bell: P('M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0'),
  plus: P('M12 5v14M5 12h14'),
  minus: P('M5 12h14'),
  play: P('M8 5l11 7-11 7z'),
  pause: P('M8 5v14M16 5v14'),
  stop: R(6, 6, 12, 12, 2),
  video: R(3, 6, 13, 12, 2) + P('M16 10l5-3v10l-5-3'),
  text: P('M5 6h14M12 6v13M9 19h6'),
  chat: P('M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H6a2 2 0 0 1-2-2z'),
  arrow: P('M5 12h14M13 6l6 6-6 6'),
  undo: P('M9 6L4 11l5 5M4 11h10a5 5 0 0 1 0 10h-2'),
  redo: P('M15 6l5 5-5 5M20 11H10a5 5 0 0 0 0 10h2'),
  layout: R(3, 3, 7, 7, 1.5) + R(14, 3, 7, 7, 1.5) + R(14, 14, 7, 7, 1.5) + R(3, 14, 7, 7, 1.5),
  list: P('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'),
  zin: C(11, 11, 6) + P('M20 20l-4.5-4.5M11 8.5v5M8.5 11h5'),
  zout: C(11, 11, 6) + P('M20 20l-4.5-4.5M8.5 11h5'),
  fit: P('M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4'),
  check: P('M5 12.5l4.5 4.5L19 7.5'),
  key: C(8, 15, 4) + P('M11 12l9-9M16 7l3 3'),
  upload: P('M12 16V4M7 9l5-5 5 5M4 20h16'),
  download: P('M12 4v12M7 11l5 5 5-5M4 20h16'),
  trash: P('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13'),
  more: C(5, 12, 1) + C(12, 12, 1) + C(19, 12, 1),
  grip: C(5, 8.5, .9) + C(12, 8.5, .9) + C(19, 8.5, .9) + C(5, 15.5, .9) + C(12, 15.5, .9) + C(19, 15.5, .9),
  // 工具面板换方向：竖排 → 横排 / 横排 → 竖排（一根拐弯的箭头）
  turnh: P('M6 3v8a5 5 0 0 0 5 5h9M16 12l4 4-4 4'),
  turnv: P('M3 18h8a5 5 0 0 0 5-5V4M12 8l4-4 4 4'),
  eye: P('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z') + C(12, 12, 3),
  eyeoff: P('M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3.2 3.9M6.5 6.6C3.7 8.5 2 12 2 12s4 7 10 7c1.7 0 3.2-.5 4.5-1.200M9.900 9.900a3 3 0 0 0 4.200 4.200'),
  lock: R(5, 11, 14, 10, 2) + P('M8 11V8a4 4 0 0 1 8 0v3'),
  user: C(12, 8, 4) + P('M4 21a8 8 0 0 1 16 0'),
  users: C(9, 8, 3.5) + P('M2.500 20a6.500 6.500 0 0 1 13 0M16 4.700a3.500 3.500 0 0 1 0 6.600M18 14.200A6.500 6.500 0 0 1 21.500 20'),
  mail: R(3, 5, 18, 14, 2) + P('M3 7l9 6 9-6'),
  warn: P('M12 3l10 18H2zM12 10v5M12 18v.5'),
  info: C(12, 12, 9) + P('M12 11v6M12 7.500v.5'),
  branch: C(6, 5, 2) + C(6, 19, 2) + C(18, 8, 2) + P('M6 7v10M18 10c0 4-12 2-12 6'),
  server: R(3, 4, 18, 7, 2) + R(3, 13, 18, 7, 2) + P('M7 7.5h.01M7 16.5h.01'),
  queue: P('M4 6h16M4 12h9M4 18h6') + C(17.5, 16.5, 3.5),
  tool: P('M14.5 5.5a4.5 4.5 0 0 0-4.2 6.1L4 18v2h2l6.4-6.3a4.5 4.5 0 0 0 6.1-4.2l-2.6 2.6-2.4-.6-.6-2.4 2.6-2.6a4.5 4.5 0 0 0-1-1z'),
  infinite: P('M7 9a3 3 0 1 0 0 6c3 0 7-6 10-6a3 3 0 1 1 0 6c-3 0-7-6-10-6z'),
  chev: P('M9 6l6 6-6 6'),
  chevd: P('M6 9l6 6 6-6'),
  cal: R(3, 5, 18, 16, 2) + P('M3 10h18M8 3v4M16 3v4'),
  share: C(6, 12, 2.5) + C(18, 6, 2.5) + C(18, 18, 2.5) + P('M8.2 10.9l7.6-3.8M8.2 13.1l7.6 3.8'),
  star: P('M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'),
  x: P('M6 6l12 12M18 6L6 18'),
  folder: P('M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  copy: R(8, 8, 12, 12, 2) + P('M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2'),
  shield: P('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2.2 2.2L15 10.5'),
  globe: C(12, 12, 9) + P('M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18'),
  disk: R(4, 4, 16, 16, 2) + P('M8 4v5h8V4M8 20v-6h8v6'),
  edit: P('M4 20h4L19 9l-4-4L4 16z'),
  refresh: P('M20 11a8 8 0 0 0-14.3-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.5L20 16M20 20v-4h-4'),
  bolt: P('M13 3L5 13h6l-1 8 8-10h-6z'),
  logout: P('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9'),
  menu: P('M4 7h16M4 12h16M4 17h16'),
  external: P('M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'),
  book: P('M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11'),
  panel: R(3, 4, 18, 16, 2) + P('M15 4v16'),
  site: C(12, 12, 9) + P('M12 3v18M3.600 9h16.800M3.600 15h16.800'),
  monitor: R(3, 4, 18, 12, 2) + P('M8 20h8M12 16v4'),
  phone: R(7, 3, 10, 18, 2.5) + P('M11 17.500h2'),
}
export type IconName = keyof typeof ICONS
</script>

<script setup lang="ts">
defineProps<{ name: string; size?: 's' | 'l' | 'xl' }>()
</script>

<style>
.lc-ic { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.lc-ic.s { width: 14px; height: 14px; }
.lc-ic.l { width: 22px; height: 22px; }
.lc-ic.xl { width: 26px; height: 26px; }
</style>
