<template>
  <!-- 首屏的产品示意图：纯装饰，数字都是示意。固定按 1200×620 画，再整体等比缩到容器宽度。 -->
  <div ref="wrap" class="hv-wrap" :class="{ compact }" role="img" :aria-label="t('landing.hero.alt')" :style="{ height: Math.ceil(620 * scale) + 'px' }">
    <div class="hv lc-glass lc-gb" aria-hidden="true" :style="{ transform: `scale(${scale})`, width: stageW + 'px' }">
      <div class="hv-bar">
        <span class="dots"><i /><i /><i /></span>
        <b>{{ t('landing.hero.title') }}</b>
        <span class="lc-st ok">{{ t('landing.hero.saved') }}</span>
        <span class="lc-sp" />
        <span class="lc-chip o">{{ t('landing.hero.nodes') }}</span>
      </div>
      <div class="cv">
        <svg class="wires" viewBox="0 0 1200 576">
          <defs>
            <linearGradient id="hv-wg" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" class="wg1" /><stop offset=".55" class="wg2" /><stop offset="1" class="wg3" />
            </linearGradient>
          </defs>
          <template v-for="(w, i) in wires" :key="i">
            <path class="w" :class="{ dash: w.dash }" :d="w.d" />
            <path v-if="!w.dash" class="wf" :d="w.d" />
          </template>
          <template v-for="(w, i) in wires" :key="'c' + i">
            <circle :class="{ v: w.v }" :cx="w.x1" :cy="w.y1" r="4.5" />
            <circle :class="{ v: w.v }" :cx="w.x2" :cy="w.y2" r="4.5" />
          </template>
        </svg>

        <div class="nd" style="left:40px;top:40px;width:200px">
          <div class="nd-h"><LcIcon name="user" />{{ t('landing.hero.refChar') }}</div>
          <div class="nd-b"><div class="nd-img" style="height:134px"><ArtPortrait /></div></div>
        </div>
        <div class="nd" style="left:40px;top:244px;width:200px">
          <div class="nd-h"><LcIcon name="image" />{{ t('landing.hero.refScene') }}</div>
          <div class="nd-b"><div class="nd-img" style="height:134px"><ArtCity /></div></div>
        </div>
        <div class="nd" style="left:40px;top:448px;width:200px">
          <div class="nd-h"><LcIcon name="text" />{{ t('landing.hero.prompt') }}</div>
          <div class="nd-b"><div class="nd-txt">{{ t('landing.hero.promptText') }}</div></div>
        </div>

        <div class="nd sel lc-gb" style="left:320px;top:170px;width:240px">
          <div class="nd-h"><LcIcon name="video" />{{ t('landing.hero.i2v') }}<span class="x">Veo 3.1</span></div>
          <div class="nd-b">
            <div class="kv"><span>{{ t('landing.hero.charRef') }}</span><b>{{ t('landing.hero.connected') }}</b></div>
            <div class="kv"><span>{{ t('landing.hero.sceneRef') }}</span><b>{{ t('landing.hero.connected') }}</b></div>
            <div class="kv"><span>{{ t('landing.hero.promptIn') }}</span><b>{{ t('landing.hero.connected') }}</b></div>
            <div class="kv sep"><span>{{ t('landing.hero.durRatio') }}</span><b>{{ t('landing.hero.durRatioV') }}</b></div>
            <div class="kv"><span>{{ t('landing.hero.cost') }}</span><span class="lc-unk">{{ t('landing.hero.costUnknown') }}</span></div>
            <span class="lc-btn primary sm run"><LcIcon name="play" size="s" />{{ t('landing.hero.run') }}</span>
          </div>
        </div>

        <div v-if="!compact" class="nd" style="left:640px;top:40px;width:520px">
          <div class="nd-h"><LcIcon name="play" />{{ t('landing.hero.preview') }}<span class="x">1920 × 1080</span></div>
          <div class="nd-b">
            <div class="nd-img lc-thumb" style="height:270px"><ArtCity /><span class="play big"><LcIcon name="play" /></span></div>
          </div>
        </div>
        <div v-if="!compact" class="nd" style="left:640px;top:386px;width:520px">
          <div class="nd-h"><LcIcon name="queue" />{{ t('landing.hero.queue') }}</div>
          <div class="nd-b qrow">
            <div class="qcard"><span class="lc-ring" style="--p:68;--s:48px">68%</span><div><b>{{ t('landing.hero.i2v') }}</b><small>{{ t('landing.hero.running') }}</small><small>{{ t('landing.hero.durRatioV') }}</small></div></div>
            <div class="qcard"><span class="lc-ring" style="--p:42;--s:48px">42%</span><div><b>{{ t('landing.hero.firstFrame') }}</b><small>{{ t('landing.hero.running') }}</small><small>2K · 16:9</small></div></div>
            <div class="qcard"><span class="lc-ring q" style="--s:48px" /><div><b>{{ t('landing.hero.vertical') }}</b><small>{{ t('landing.hero.queued') }}</small><small>{{ t('landing.hero.waiting') }}</small></div></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'

const { t } = useI18n()

interface Wire { x1: number; y1: number; x2: number; y2: number; v?: boolean; dash?: boolean; d: string }
function wire(x1: number, y1: number, x2: number, y2: number, v = false, dash = false): Wire {
  const k = Math.max(40, (x2 - x1) / 2)
  return { x1, y1, x2, y2, v, dash, d: `M${x1} ${y1}C${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}` }
}
const WIRES: Wire[] = [
  wire(240, 138, 320, 250), wire(240, 342, 320, 290), wire(240, 500, 320, 330),
  wire(560, 300, 640, 205, true), wire(560, 300, 640, 470, true, true),
]

// 两张示意插画（矢量）。颜色全部是 --art-* 令牌，按类名取（见下面的样式）：深色主题是夜色霓虹街 / 逆光人像，
// 浅色主题是清晨的城市 / 柔光人像 —— 同一张画换一套光线，不是把深色的图贴在浅色页面上。
const art = (inner: string) => () => h('svg', { class: 'art', viewBox: '0 0 160 100', preserveAspectRatio: 'xMidYMid slice', innerHTML: inner })
const ArtCity = art('<defs><linearGradient id="hv-a1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="c-sky-0"/><stop offset=".6" class="c-sky-1"/><stop offset="1" class="c-sky-2"/></linearGradient></defs><rect width="160" height="100" fill="url(#hv-a1)"/><circle cx="118" cy="22" r="26" class="f-moon" opacity=".25"/><path d="M58 100V46h10v-6h8v60zM82 100V50h12v-8h10v58z" class="f-b1"/><path d="M0 100V38h14v-8h10v8h8v62z" class="f-b2"/><path d="M36 100V24h18v76z" class="f-b3"/><path d="M110 100V30h16v-6h8v6h6v70z" class="f-b4"/><path d="M144 100V44h16v56z" class="f-b3"/><g class="f-light" opacity=".55"><rect x="4" y="44" width="3" height="3"/><rect x="10" y="52" width="3" height="3"/><rect x="47" y="30" width="3" height="3"/><rect x="47" y="44" width="3" height="3"/><rect x="62" y="52" width="2" height="2"/><rect x="88" y="56" width="2" height="2"/><rect x="98" y="48" width="2" height="2"/><rect x="134" y="36" width="3" height="3"/><rect x="150" y="50" width="3" height="3"/><rect x="150" y="60" width="3" height="3"/></g><rect x="40" y="34" width="4" height="22" rx="1" class="f-pink"/><rect x="112" y="40" width="14" height="5" rx="1" class="f-cyan"/><rect x="20" y="50" width="8" height="4" class="f-amber"/><rect x="132" y="54" width="3" height="16" class="f-lilac"/><path d="M0 78h160v22H0z" class="f-ground"/><rect x="40" y="80" width="4" height="16" class="f-pink" opacity=".35"/><rect x="112" y="80" width="14" height="14" class="f-cyan" opacity=".25"/><rect x="20" y="80" width="8" height="10" class="f-amber" opacity=".25"/><rect x="132" y="80" width="3" height="12" class="f-lilac" opacity=".3"/><path d="M68 67a11 11 0 0 1 22 0z" class="f-figure"/><path d="M68 67a11 11 0 0 1 22 0" class="s-cyan" stroke-width=".9" fill="none" opacity=".9"/><path d="M79 67v6" class="s-figure" stroke-width="1"/><circle cx="79" cy="71" r="2.4" class="f-figure"/><path d="M75.5 74h7l1.5 14h-10z" class="f-figure"/><path d="M10 5l-4 16M50 0l-4 16M96 8l-4 16M140 2l-4 16M26 30l-3 12M124 58l-3 12M64 20l-3 12M104 70l-2 8M30 66l-2 8" class="s-light" stroke-width=".5" opacity=".35"/>')
const ArtPortrait = art('<defs><radialGradient id="hv-a3" cx=".5" cy=".35" r=".8"><stop offset="0" class="c-p0"/><stop offset="1" class="c-p1"/></radialGradient></defs><rect width="160" height="100" fill="url(#hv-a3)"/><circle cx="38" cy="30" r="32" class="f-cyan" opacity=".14"/><circle cx="128" cy="72" r="38" class="f-pink" opacity=".14"/><path d="M36 100c2-20 16-28 30-30h28c14 2 28 10 30 30z" class="f-body"/><path d="M72 74V60h16v14z" class="f-neck"/><ellipse cx="80" cy="44" rx="15" ry="19" class="f-face"/><path d="M63 48c-3-20 7-29 18-29s20 8 16 29c-2-11-8-16-17-16s-14 6-17 16z" class="f-hair"/><path d="M95 44c0 9-4 16-9 19" class="s-cyan" stroke-width="1.2" fill="none"/><path d="M65 44c0 8 3 14 7 17" class="s-pink" stroke-width="1" fill="none" opacity=".8"/><path d="M124 100c-2-18-14-27-30-30" class="s-cyan" stroke-width="1" fill="none" opacity=".7"/><path d="M36 100c2-18 14-27 30-30" class="s-pink" stroke-width="1" fill="none" opacity=".5"/>')

const wrap = ref<HTMLElement | null>(null)
const scale = ref(1)
/** 手机上整张图缩到三百多像素就看不清了：只画左半边（三个素材节点连到生成节点），放大一倍 */
const compact = ref(false)
const stageW = computed(() => (compact.value ? 600 : 1200))
const wires = computed(() => (compact.value ? WIRES.filter(w => !w.v) : WIRES))
let ro: ResizeObserver | null = null
onMounted(() => {
  const fit = () => {
    if (!wrap.value) return
    const w = wrap.value.clientWidth
    compact.value = w < 620
    scale.value = Math.min(1, w / (compact.value ? 600 : 1200))
  }
  fit()
  ro = new ResizeObserver(fit)
  if (wrap.value) ro.observe(wrap.value)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<style scoped>
.hv-wrap { position: relative; width: 100%; max-width: 1200px; margin: 64px auto 0; }
.hv { position: absolute; left: 0; top: 0; width: 1200px; height: 620px; transform-origin: 0 0; border-radius: 22px; text-align: left; box-shadow: var(--glow-l), var(--sh-2); }
.hv-bar { height: 44px; display: flex; align-items: center; gap: 12px; padding: 0 16px; border-bottom: 1px solid var(--line); font-size: 13px; }
.hv-bar b { font-weight: 600; }
.hv-bar .lc-st { font-size: 12px; }
.dots { display: flex; gap: 6px; }
.dots i { width: 9px; height: 9px; border-radius: 50%; background: rgb(var(--c-film) / .3); }
.cv { position: relative; overflow: hidden; height: 576px; border-radius: 0 0 22px 22px; background-image: radial-gradient(rgb(var(--c-film) / .2) 1px, transparent 1px); background-size: 24px 24px; }
.wires { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; z-index: 2; }
.wires .wg1 { stop-color: var(--hue-cyan); }
.wires .wg2 { stop-color: var(--hue-sky); }
.wires .wg3 { stop-color: var(--hue-lilac); }
.wires .w { fill: none; stroke: url(#hv-wg); stroke-width: var(--wire-w); filter: drop-shadow(0 0 4px rgb(var(--g-cyan) / .65)); }
.wires .wf { fill: none; stroke: var(--wire-flow); stroke-width: 2; stroke-dasharray: 4 20; stroke-linecap: round; opacity: .7; animation: hv-flow 2.8s linear infinite; }
.wires .dash { stroke-dasharray: 5 6; opacity: .7; }
.wires circle { fill: var(--port-bg); stroke: var(--cyan); stroke-width: 2; }
.wires circle.v { stroke: var(--port-video); }
@keyframes hv-flow { to { stroke-dashoffset: -48; } }

.nd { position: absolute; border-radius: 14px; border: 1px solid var(--line-2); background: var(--grad-node); box-shadow: var(--sh-1); font-size: 12px; line-height: 1.5; }
.nd.sel { border-color: transparent; box-shadow: var(--glow-m), var(--sh-1); }
.nd-h { height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 12px; font-weight: 600; font-size: 13px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.nd-h :deep(.lc-ic) { color: var(--cyan); width: 16px; height: 16px; }
.nd-h .x { margin-left: auto; color: var(--text-3); font-weight: 400; font-size: 11px; }
.nd-b { padding: 10px 12px; }
.nd-img { border-radius: 9px; overflow: hidden; border: 1px solid var(--line); }
.nd-img :deep(.art) { display: block; width: 100%; height: 100%; }
/* 插画的颜色：f- 填充 / s- 描边 / c- 渐变色标，各对应一个 --art-* 令牌 */
.nd-img :deep(.f-sky-0) { fill: var(--art-sky-0); }
.nd-img :deep(.f-sky-1) { fill: var(--art-sky-1); }
.nd-img :deep(.f-sky-2) { fill: var(--art-sky-2); }
.nd-img :deep(.f-moon) { fill: var(--art-moon); }
.nd-img :deep(.f-b1) { fill: var(--art-b1); }
.nd-img :deep(.f-b2) { fill: var(--art-b2); }
.nd-img :deep(.f-b3) { fill: var(--art-b3); }
.nd-img :deep(.f-b4) { fill: var(--art-b4); }
.nd-img :deep(.f-light) { fill: var(--art-light); }
.nd-img :deep(.f-pink) { fill: var(--art-pink); }
.nd-img :deep(.f-cyan) { fill: var(--art-cyan); }
.nd-img :deep(.f-amber) { fill: var(--art-amber); }
.nd-img :deep(.f-lilac) { fill: var(--art-lilac); }
.nd-img :deep(.f-ground) { fill: var(--art-ground); }
.nd-img :deep(.f-figure) { fill: var(--art-figure); }
.nd-img :deep(.f-p0) { fill: var(--art-p0); }
.nd-img :deep(.f-p1) { fill: var(--art-p1); }
.nd-img :deep(.f-body) { fill: var(--art-body); }
.nd-img :deep(.f-neck) { fill: var(--art-neck); }
.nd-img :deep(.f-face) { fill: var(--art-face); }
.nd-img :deep(.f-hair) { fill: var(--art-hair); }
.nd-img :deep(.s-cyan) { stroke: var(--art-cyan); }
.nd-img :deep(.s-pink) { stroke: var(--art-pink); }
.nd-img :deep(.s-light) { stroke: var(--art-light); }
.nd-img :deep(.s-figure) { stroke: var(--art-figure); }
.nd-img :deep(.c-sky-0) { stop-color: var(--art-sky-0); }
.nd-img :deep(.c-sky-1) { stop-color: var(--art-sky-1); }
.nd-img :deep(.c-sky-2) { stop-color: var(--art-sky-2); }
.nd-img :deep(.c-p0) { stop-color: var(--art-p0); }
.nd-img :deep(.c-p1) { stop-color: var(--art-p1); }
.nd-txt { border-radius: 9px; background: var(--well); border: 1px solid var(--line); padding: 8px 10px; color: var(--text-2); font-size: 12px; line-height: 1.6; }
.kv { display: flex; align-items: center; justify-content: space-between; height: 28px; font-size: 12px; color: var(--text-2); }
.kv b { font-weight: 500; color: var(--text); }
.kv.sep { border-top: 1px solid var(--line); margin-top: 6px; padding-top: 6px; height: 34px; }
.kv .lc-unk { font-size: 12px; }
.run { width: 100%; margin-top: 8px; pointer-events: none; }
.play.big { width: 52px; height: 52px; }
.qrow { display: flex; gap: 10px; }
.qcard { flex: 1; display: flex; gap: 10px; align-items: center; padding: 10px; border-radius: 11px; border: 1px solid var(--line); background: rgb(var(--c-well) / .45); min-width: 0; }
.qcard b { display: block; font-size: 12px; font-weight: 600; white-space: nowrap; }
.qcard small { display: block; font-size: 11px; color: var(--text-3); white-space: nowrap; }
</style>
