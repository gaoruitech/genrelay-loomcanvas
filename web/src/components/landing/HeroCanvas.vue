<template>
  <!-- 首屏的产品示意图：纯装饰，数字都是示意。里面的字都是它本来的大小（不整体缩放——缩了字就看不清），
       窄了就少画几块、把剩下的排紧：≥900px 三列（素材 → 图生视频 → 预览 + 队列），620–899px 两列，再窄是手机那张小图。
       各块的位置由脚本里的 g 按容器宽度算出来。 -->
  <div ref="wrap" class="hv-wrap" :class="{ phone }" role="img" :aria-label="t(alt)" :data-variant="variant" :style="{ height: stageH + 'px' }">
    <div class="hv lc-glass lc-gb" aria-hidden="true" :style="{ width: stageW + 'px', height: stageH + 'px' }">
      <div class="hv-bar">
        <span class="dots"><i /><i /><i /></span>
        <b>{{ t('landing.hero.title') }}</b>
        <span class="lc-st ok">{{ t('landing.hero.saved') }}</span>
        <span class="lc-sp" />
        <span class="lc-chip o">{{ t('landing.hero.nodes', { n: variant === 'wide' ? 6 : variant === 'mid' ? 4 : 3 }) }}</span>
      </div>
      <div class="cv" :style="{ height: stageH - 44 + 'px' }">
        <svg class="wires" :viewBox="`0 0 ${stageW} ${stageH - 44}`">
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

        <!-- 手机：两张参考图并排在上，下面是图生视频节点，连线从上往下 -->
        <template v-if="phone">
          <!-- 两张并排的卡片窄（390px 的手机上每张 154px）：标题放不下「参考图 · 角色」的英文，窄的时候只写「角色参考」 -->
          <div class="nd" :style="box(PAD, 20, half)">
            <div class="nd-h"><LcIcon name="user" /><span>{{ t(half < 190 ? 'landing.hero.charRef' : 'landing.hero.refChar') }}</span></div>
            <div class="nd-b"><div class="nd-img" :style="{ height: refH + 'px' }"><ArtPortrait /></div></div>
          </div>
          <div class="nd" :style="box(PAD * 2 + half, 20, half)">
            <div class="nd-h"><LcIcon name="image" /><span>{{ t(half < 190 ? 'landing.hero.sceneRef' : 'landing.hero.refScene') }}</span></div>
            <div class="nd-b"><div class="nd-img" :style="{ height: refH + 'px' }"><ArtCity /></div></div>
          </div>
          <div class="nd sel lc-gb" :style="box(PAD, refH + 122, stageW - 2 - PAD * 2)">
            <div class="nd-h"><LcIcon name="video" /><span>{{ t('landing.hero.i2v') }}</span><span class="x">Veo 3.1</span></div>
            <div class="nd-b">
              <div class="kv"><span>{{ t('landing.hero.charRef') }}</span><b>{{ t('landing.hero.connected') }}</b></div>
              <div class="kv"><span>{{ t('landing.hero.sceneRef') }}</span><b>{{ t('landing.hero.connected') }}</b></div>
              <div class="kv sep"><span>{{ t('landing.hero.durRatio') }}</span><b>{{ t('landing.hero.durRatioV') }}</b></div>
              <div class="kv"><span>{{ t('landing.hero.cost') }}</span><span class="lc-unk">{{ t('landing.hero.costUnknown') }}</span></div>
              <span class="lc-btn primary sm run"><LcIcon name="play" size="s" />{{ t('landing.hero.run') }}</span>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="nd" :style="box(40, 40, g.sW)">
            <div class="nd-h"><LcIcon name="user" /><span>{{ t('landing.hero.refChar') }}</span></div>
            <div class="nd-b"><div class="nd-img" style="height:134px"><ArtPortrait /></div></div>
          </div>
          <div class="nd" :style="box(40, 244, g.sW)">
            <div class="nd-h"><LcIcon name="image" /><span>{{ t('landing.hero.refScene') }}</span></div>
            <div class="nd-b"><div class="nd-img" style="height:134px"><ArtCity /></div></div>
          </div>
          <div class="nd" :style="box(40, 448, g.sW)">
            <div class="nd-h"><LcIcon name="text" /><span>{{ t('landing.hero.prompt') }}</span></div>
            <div class="nd-b"><div class="nd-txt"><span>{{ t('landing.hero.promptText') }}</span></div></div>
          </div>

          <div class="nd sel lc-gb" :style="box(g.gX, 170, g.gW)">
            <div class="nd-h"><LcIcon name="video" /><span>{{ t('landing.hero.i2v') }}</span><span class="x">Veo 3.1</span></div>
            <div class="nd-b">
              <div class="kv"><span>{{ t('landing.hero.charRef') }}</span><b>{{ t('landing.hero.connected') }}</b></div>
              <div class="kv"><span>{{ t('landing.hero.sceneRef') }}</span><b>{{ t('landing.hero.connected') }}</b></div>
              <div class="kv"><span>{{ t('landing.hero.promptIn') }}</span><b>{{ t('landing.hero.connected') }}</b></div>
              <div class="kv sep"><span>{{ t('landing.hero.durRatio') }}</span><b>{{ t('landing.hero.durRatioV') }}</b></div>
              <div class="kv"><span>{{ t('landing.hero.cost') }}</span><span class="lc-unk">{{ t('landing.hero.costUnknown') }}</span></div>
              <span class="lc-btn primary sm run"><LcIcon name="play" size="s" />{{ t('landing.hero.run') }}</span>
            </div>
          </div>

          <!-- 第三列：放得下才画（≥900px）；预览图按列宽等比，队列里画得下几张卡片就画几张 -->
          <template v-if="g.wide">
            <div class="nd" :style="box(g.pX, g.pT, g.pW)">
              <div class="nd-h"><LcIcon name="play" /><span>{{ t('landing.hero.preview') }}</span><span class="x">{{ pixelSize(1920, 1080) }}</span></div>
              <div class="nd-b">
                <div class="nd-img lc-thumb" :style="{ height: g.imgH + 'px' }"><ArtCity /><span class="play big"><LcIcon name="play" /></span></div>
              </div>
            </div>
            <div class="nd" :style="box(g.pX, g.qT, g.pW)">
              <div class="nd-h"><LcIcon name="queue" /><span>{{ t('landing.hero.queue') }}</span></div>
              <div class="nd-b qrow">
                <div v-for="q in QUEUE.slice(0, g.cards)" :key="q.name" class="qcard">
                  <span v-if="q.p" class="lc-ring" :style="{ '--p': q.p, '--s': '48px' }">{{ q.p }}%</span>
                  <span v-else class="lc-ring q" style="--s:48px" />
                  <div><b>{{ t('landing.hero.' + q.name) }}</b><small>{{ t('landing.hero.' + q.state) }}</small><small>{{ q.note ? t('landing.hero.' + q.note) : q.spec }}</small></div>
                </div>
              </div>
            </div>
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import { pixelSize } from '@/utils/pixelSize'

const { t, locale } = useI18n()

interface Wire { x1: number; y1: number; x2: number; y2: number; v?: boolean; dash?: boolean; d: string }
function wire(x1: number, y1: number, x2: number, y2: number, v = false, dash = false): Wire {
  const k = Math.max(40, (x2 - x1) / 2)
  return { x1, y1, x2, y2, v, dash, d: `M${x1} ${y1}C${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}` }
}
/** 从上往下的连线（手机那张小图用） */
function wireDown(x1: number, y1: number, x2: number, y2: number): Wire {
  const k = (y2 - y1) / 2
  return { x1, y1, x2, y2, d: `M${x1} ${y1}C${x1} ${y1 + k} ${x2} ${y2 - k} ${x2} ${y2}` }
}
/** 生成队列里的三张卡片（示意）：前两张在跑，第三张在排队 */
const QUEUE = [
  { name: 'i2v', state: 'running', p: 68, note: 'durRatioV', spec: '' },
  { name: 'firstFrame', state: 'running', p: 42, note: '', spec: '2K · 16:9' },
  { name: 'vertical', state: 'queued', p: 0, note: 'waiting', spec: '' },
] as const

// 两张示意插画（矢量）。颜色全部是 --art-* 令牌，按类名取（见下面的样式）：深色主题是夜色霓虹街 / 逆光人像，
// 浅色主题是清晨的城市 / 柔光人像 —— 同一张画换一套光线，不是把深色的图贴在浅色页面上。
const art = (inner: string) => () => h('svg', { class: 'art', viewBox: '0 0 160 100', preserveAspectRatio: 'xMidYMid slice', innerHTML: inner })
const ArtCity = art('<defs><linearGradient id="hv-a1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="c-sky-0"/><stop offset=".6" class="c-sky-1"/><stop offset="1" class="c-sky-2"/></linearGradient></defs><rect width="160" height="100" fill="url(#hv-a1)"/><circle cx="118" cy="22" r="26" class="f-moon" opacity=".25"/><path d="M58 100V46h10v-6h8v60zM82 100V50h12v-8h10v58z" class="f-b1"/><path d="M0 100V38h14v-8h10v8h8v62z" class="f-b2"/><path d="M36 100V24h18v76z" class="f-b3"/><path d="M110 100V30h16v-6h8v6h6v70z" class="f-b4"/><path d="M144 100V44h16v56z" class="f-b3"/><g class="f-light" opacity=".55"><rect x="4" y="44" width="3" height="3"/><rect x="10" y="52" width="3" height="3"/><rect x="47" y="30" width="3" height="3"/><rect x="47" y="44" width="3" height="3"/><rect x="62" y="52" width="2" height="2"/><rect x="88" y="56" width="2" height="2"/><rect x="98" y="48" width="2" height="2"/><rect x="134" y="36" width="3" height="3"/><rect x="150" y="50" width="3" height="3"/><rect x="150" y="60" width="3" height="3"/></g><rect x="40" y="34" width="4" height="22" rx="1" class="f-pink"/><rect x="112" y="40" width="14" height="5" rx="1" class="f-cyan"/><rect x="20" y="50" width="8" height="4" class="f-amber"/><rect x="132" y="54" width="3" height="16" class="f-lilac"/><path d="M0 78h160v22H0z" class="f-ground"/><rect x="40" y="80" width="4" height="16" class="f-pink" opacity=".35"/><rect x="112" y="80" width="14" height="14" class="f-cyan" opacity=".25"/><rect x="20" y="80" width="8" height="10" class="f-amber" opacity=".25"/><rect x="132" y="80" width="3" height="12" class="f-lilac" opacity=".3"/><path d="M68 67a11 11 0 0 1 22 0z" class="f-figure"/><path d="M68 67a11 11 0 0 1 22 0" class="s-cyan" stroke-width=".9" fill="none" opacity=".9"/><path d="M79 67v6" class="s-figure" stroke-width="1"/><circle cx="79" cy="71" r="2.4" class="f-figure"/><path d="M75.5 74h7l1.5 14h-10z" class="f-figure"/><path d="M10 5l-4 16M50 0l-4 16M96 8l-4 16M140 2l-4 16M26 30l-3 12M124 58l-3 12M64 20l-3 12M104 70l-2 8M30 66l-2 8" class="s-light" stroke-width=".5" opacity=".35"/>')
const ArtPortrait = art('<defs><radialGradient id="hv-a3" cx=".5" cy=".35" r=".8"><stop offset="0" class="c-p0"/><stop offset="1" class="c-p1"/></radialGradient></defs><rect width="160" height="100" fill="url(#hv-a3)"/><circle cx="38" cy="30" r="32" class="f-cyan" opacity=".14"/><circle cx="128" cy="72" r="38" class="f-pink" opacity=".14"/><path d="M36 100c2-20 16-28 30-30h28c14 2 28 10 30 30z" class="f-body"/><path d="M72 74V60h16v14z" class="f-neck"/><ellipse cx="80" cy="44" rx="15" ry="19" class="f-face"/><path d="M63 48c-3-20 7-29 18-29s20 8 16 29c-2-11-8-16-17-16s-14 6-17 16z" class="f-hair"/><path d="M95 44c0 9-4 16-9 19" class="s-cyan" stroke-width="1.2" fill="none"/><path d="M65 44c0 8 3 14 7 17" class="s-pink" stroke-width="1" fill="none" opacity=".8"/><path d="M124 100c-2-18-14-27-30-30" class="s-cyan" stroke-width="1" fill="none" opacity=".7"/><path d="M36 100c2-18 14-27 30-30" class="s-pink" stroke-width="1" fill="none" opacity=".5"/>')

const wrap = ref<HTMLElement | null>(null)
/** 容器的实际宽度（量出来之前是 0：先按最宽的那一版画） */
const wrapW = ref(0)
const PAD = 16
const box = (left: number, top: number, width: number) => ({ left: left + 'px', top: top + 'px', width: width + 'px' })

/**
 * 手机和小平板（<620px）：三列、两列都排不下。按容器的实际宽度排一张小图：两张参考图并排、下面一个图生视频节点。
 */
const phone = computed(() => wrapW.value > 0 && wrapW.value < 620)
/** 手机那张图里参考图节点的宽度：两个并排，左右和中间各留 PAD（舞台有 1px 的边） */
const half = computed(() => Math.floor((wrapW.value - 2 - PAD * 3) / 2))
/** 参考图的高度跟着宽度走（390px 的手机上是 96，宽一些的屏幕上不至于扁成一条） */
const refH = computed(() => Math.round(Math.min(150, Math.max(96, half.value * 0.5))))

/**
 * 不是手机的那两版。所有尺寸都是画面上的真实像素，字不缩：
 *   两列（620–899px）：素材列和图生视频节点把宽度分掉（素材列 200 起、节点 240 起，多出来的宽度按 3 : 3 : 4 分给素材列、间隔、节点）；
 *   三列（≥900px）：素材列 200、节点 240 固定，剩下的全给第三列（预览 + 队列）。1200px 时就是原来那张完整的图。
 */
const g = computed(() => {
  const W = Math.min(1200, wrapW.value || 1200)
  const wide = W >= 900
  const extra = wide ? 0 : W - 600
  const sW = Math.round(200 + extra * 0.3)
  const gX = 40 + sW + Math.round(80 + extra * 0.3)
  const gW = wide ? 240 : W - 40 - gX
  const pX = gX + gW + 80
  const pW = W - 40 - pX
  // 预览图：1200px 时是 496 × 270，窄了等比；第三列整体在竖直方向居中（1200px 时顶在 40）
  const imgH = Math.round((pW - 24) * 270 / 496)
  const pT = 40 + Math.round((270 - imgH) / 2)
  const qT = pT + imgH + 76
  // 一张卡片至少 158 宽（进度环 + 三行字），卡片之间 10；英文的那几个词长（Image to video、Waiting for a slot），要 180
  const cardW = locale.value === 'en' ? 180 : 158
  const cards = Math.max(1, Math.min(3, Math.floor((pW - 24 + 10) / (cardW + 10))))
  return { W, wide, sW, gX, gW, pX, pW, imgH, pT, qT, cards }
})

const variant = computed(() => (phone.value ? 'phone' : g.value.wide ? 'wide' : 'mid'))
const alt = computed(() => (phone.value ? 'views.landingNav.heroAltPhone' : g.value.wide ? 'landing.hero.alt' : 'landing.hero.altMid'))
const stageW = computed(() => (phone.value ? wrapW.value : g.value.W))
const stageH = computed(() => (phone.value ? 406 + refH.value : 620))

const wires = computed<Wire[]>(() => {
  if (phone.value) {
    const mid = (stageW.value - 2) / 2
    const y1 = refH.value + 78
    return [
      wireDown(PAD + half.value / 2, y1, mid - 44, y1 + 44),
      wireDown(PAD * 2 + half.value * 1.5, y1, mid + 44, y1 + 44),
    ]
  }
  const { sW, gX, gW, pX, pT, qT, imgH, wide } = g.value
  const out: Wire[] = [wire(40 + sW, 138, gX, 250), wire(40 + sW, 342, gX, 290), wire(40 + sW, 500, gX, 330)]
  if (wide) out.push(wire(gX + gW, 300, pX, pT + Math.round((imgH + 58) / 2), true), wire(gX + gW, 300, pX, qT + 84, true, true))
  return out
})

let ro: ResizeObserver | null = null
onMounted(() => {
  const fit = () => { if (wrap.value) wrapW.value = wrap.value.clientWidth }
  fit()
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(fit)
    if (wrap.value) ro.observe(wrap.value)
  }
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<style scoped>
.hv-wrap { position: relative; width: 100%; max-width: 1200px; margin: 64px auto 0; }
.hv { position: relative; width: 100%; height: 620px; border-radius: 22px; text-align: left; box-shadow: var(--glow-l), var(--sh-2); }
.hv-bar { height: 44px; display: flex; align-items: center; gap: 12px; padding: 0 16px; border-bottom: 1px solid var(--line); font-size: 13px; white-space: nowrap; }
.hv-bar b { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.hv-bar .lc-chip, .hv-bar .dots, .hv-bar .lc-st { flex: none; }
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
/* 图里最小的字也是 12px：这张图不缩放，写多大就是多大 */
.nd-h .x { flex: none; margin-left: auto; color: var(--text-3); font-weight: 400; font-size: 12px; }
.nd-h > span:not(.x) { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* 手机那张图的标题栏只留标题和「已保存」：三个圆点和节点数放不下（320px 的屏幕上标题会被截掉） */
.phone .hv-bar { padding: 0 12px; gap: 8px; }
.phone .hv-bar .dots, .phone .hv-bar .lc-chip { display: none; }
.phone .nd-h { padding: 0 10px; gap: 6px; }
.phone .nd-b { padding: 10px; }
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
/* 提示词只露两行（英文那一句有三四行，会把这个节点撑出画面底边） */
.nd-txt > span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
.kv { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 28px; font-size: 12px; color: var(--text-2); white-space: nowrap; }
.kv b { font-weight: 500; color: var(--text); }
.kv.sep { border-top: 1px solid var(--line); margin-top: 6px; padding-top: 6px; height: 34px; }
.kv .lc-unk { font-size: 12px; }
.run { width: 100%; margin-top: 8px; pointer-events: none; }
.play.big { width: 52px; height: 52px; }
.qrow { display: flex; gap: 10px; }
.qcard { flex: 1; display: flex; gap: 10px; align-items: center; padding: 10px; border-radius: 11px; border: 1px solid var(--line); background: rgb(var(--c-well) / .45); min-width: 0; }
.qcard > div { min-width: 0; }
.qcard b { display: block; font-size: 12px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qcard small { display: block; font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
