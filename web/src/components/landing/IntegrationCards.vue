<template>
  <!-- 落地页「集成到你的产品」一节的主体：两张卡片（示意图 + 要点 + 代码），加一行文档 / 示例 / 许可。
       示意图是手画的内联 SVG，颜色全部按类名取令牌（SVG 的表现属性不认 var()），两套主题共用一张图。 -->
  <div class="ig">
    <div class="ig-grid">
      <article v-for="c in CARDS" :key="c.k" class="ig-card lc-glass">
        <div class="ig-art" role="img" :aria-label="t(`landing.integ.${c.k}.alt`)">
          <!-- 整站嵌入：宿主自己的顶栏和侧栏（中性色块），内容区里是 LoomCanvas 的画布列表页，没有它自己的外壳 -->
          <svg v-if="c.k === 'app'" viewBox="0 0 360 200" aria-hidden="true">
            <defs>
              <linearGradient id="ig-g1" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="g1" /><stop offset=".55" class="g2" /><stop offset="1" class="g3" /></linearGradient>
            </defs>
            <rect class="win" x=".5" y=".5" width="359" height="199" rx="12" />
            <path class="rule" d="M0 28.5h360M64.5 28v172" />
            <rect class="blk hi" x="12" y="9" width="10" height="10" rx="3" />
            <text class="lb" x="28" y="17.500">{{ t('landing.integ.art.host') }}</text>
            <rect v-for="x in [236, 268, 300]" :key="x" class="blk" :x="x" y="11" width="24" height="6" rx="3" />
            <circle class="blk" cx="342" cy="14" r="6" />
            <rect v-for="(w, i) in [40, 32, 36, 28, 34]" :key="i" class="blk" :class="{ hi: i === 1 }" x="12" :y="44 + i * 18" :width="w" height="7" rx="3.500" />

            <rect class="mount" x="74.500" y="40.500" width="275" height="149" rx="8" />
            <rect class="tag" x="84" y="33" width="94" height="15" rx="7.500" />
            <text class="lb tg" x="131" y="43.500" text-anchor="middle">{{ t('landing.integ.art.mount') }}</text>
            <rect class="blk hi" x="86" y="60" width="64" height="8" rx="4" />
            <rect class="go" x="300" y="56" width="38" height="14" rx="5" />
            <path class="plus" d="M319 59.500v7M315.500 63h7" />
            <g v-for="(p, i) in GRID" :key="i" :transform="`translate(${p[0]} ${p[1]})`">
              <rect class="nd" width="80" height="48" rx="6" />
              <rect class="th" x="4" y="4" width="72" height="27" rx="4" />
              <path class="wire" d="M16 23C32 23 40 12 62 12" />
              <rect class="dot" x="11" y="19" width="9" height="8" rx="2" />
              <rect class="dot v" x="58" y="8" width="9" height="8" rx="2" />
              <rect class="blk" x="4" y="37" :width="30 + (i % 3) * 8" height="5" rx="2.500" />
            </g>
          </svg>

          <!-- 只嵌编辑器：宿主页面里的一个框，框里只有画布；右边是宿主自己的面板，下面连到宿主的后端 -->
          <svg v-else viewBox="0 0 360 200" aria-hidden="true">
            <defs>
              <linearGradient id="ig-g2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" class="g1" /><stop offset=".55" class="g2" /><stop offset="1" class="g3" /></linearGradient>
              <pattern id="ig-dots" width="12" height="12" patternUnits="userSpaceOnUse"><circle class="pd" cx="1.500" cy="1.500" r=".8" /></pattern>
            </defs>
            <rect class="win" x=".5" y=".5" width="359" height="199" rx="12" />
            <path class="rule" d="M0 28.5h360" />
            <rect class="blk hi" x="12" y="9" width="10" height="10" rx="3" />
            <text class="lb" x="28" y="17.500">{{ t('landing.integ.art.host') }}</text>
            <rect v-for="x in [236, 268, 300]" :key="x" class="blk" :x="x" y="11" width="24" height="6" rx="3" />
            <circle class="blk" cx="342" cy="14" r="6" />

            <rect class="blk hi" x="16" y="40" width="84" height="8" rx="4" />
            <rect class="mount" x="16.500" y="62.500" width="219" height="125" rx="8" />
            <rect class="cv" x="17" y="63" width="218" height="124" rx="7.500" fill="url(#ig-dots)" />
            <rect class="tag" x="26" y="55" width="86" height="15" rx="7.500" />
            <text class="lb tg" x="69" y="65.500" text-anchor="middle">{{ t('landing.integ.art.editor') }}</text>
            <path class="wire two" d="M80 97C92 97 92 116 104 116M80 143C92 143 92 126 104 126M160 121h18" />
            <g v-for="(n, i) in NODES" :key="i" :transform="`translate(${n.x} ${n.y})`">
              <rect class="nd" :class="{ sel: n.sel }" :width="n.w" :height="n.h" rx="5" />
              <rect class="blk hi" x="6" y="6" :width="n.w * .4" height="4" rx="2" />
              <rect :class="n.out ? 'th' : 'blk'" x="6" y="14" :width="n.w - 12" :height="n.h - (n.sel ? 32 : 20)" rx="3" />
              <rect v-if="n.sel" class="go" x="6" :y="n.h - 13" :width="n.w - 12" height="7" rx="3.500" />
            </g>
            <circle v-for="(p, i) in PORTS" :key="i" class="port" :cx="p[0]" :cy="p[1]" r="2.600" />
            <rect class="bar" x="96" y="172" width="60" height="10" rx="5" />
            <circle v-for="x in [106, 116, 126, 136, 146]" :key="x" class="blk hi" :cx="x" cy="177" r="2" />

            <rect class="side" x="252.500" y="40.500" width="91" height="76" rx="8" />
            <rect class="blk hi" x="262" y="51" width="44" height="6" rx="3" />
            <rect v-for="(w, i) in [70, 58, 64, 40]" :key="i" class="blk" x="262" :y="66 + i * 12" :width="w" height="5" rx="2.500" />
            <path class="link" d="M236 152h16" />
            <rect class="srv" x="252.500" y="136.500" width="91" height="31" rx="8" />
            <path class="srv-i" d="M262 147.500h10M262 156.500h10" />
            <text class="lb" x="271" y="155.500">{{ t('landing.integ.art.backend') }}</text>
            <text class="lb dim" x="298" y="181" text-anchor="middle">{{ t('landing.integ.art.via') }}</text>
          </svg>
        </div>

        <span class="lc-bd" :class="c.badge">{{ t(`landing.integ.${c.k}.badge`) }}</span>
        <h3>{{ t(`landing.integ.${c.k}.title`) }}</h3>
        <p class="desc">{{ t(`landing.integ.${c.k}.desc`) }}</p>
        <ul>
          <li v-for="b in BULLETS" :key="b"><LcIcon name="check" size="s" /><span>{{ t(`landing.integ.${c.k}.${b}`) }}</span></li>
        </ul>

        <div class="ig-code">
          <div class="ig-code-h">
            <span class="lc-mono">{{ c.entry }}</span>
            <button type="button" class="lc-btn sm ghost" @click="copy(c.k)">
              <LcIcon :name="copied === c.k ? 'check' : 'copy'" size="s" />{{ t('landing.integ.copy') }}
            </button>
          </div>
          <pre tabindex="0" :aria-label="t('landing.integ.codeLabel', { name: t(`landing.integ.${c.k}.title`) })"><code><span v-for="(line, i) in tinted[c.k]" :key="i" class="ln"><span v-for="(p, j) in line" :key="j" :class="p.c">{{ p.s }}</span></span></code></pre>
        </div>
      </article>
    </div>

    <div class="ig-end">
      <div class="ig-act">
        <a class="lc-btn primary" :href="LINKS.integration" target="_blank" rel="noopener"><LcIcon name="book" />{{ t('landing.integ.docs') }}</a>
        <a class="lc-btn" :href="LINKS.examples" target="_blank" rel="noopener">{{ t('landing.integ.examples') }}</a>
      </div>
      <div class="ig-note">
        <p>{{ t('landing.integ.note') }}</p>
        <p>{{ license[0] }}<a :href="LINKS.commercial" target="_blank" rel="noopener">{{ t('landing.integ.licenseLink') }}</a>{{ license[1] }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { LINKS } from '@/utils/links'
import { MessagePlugin } from '@/utils/feedback'
import { writeClipboard } from '@/utils/clipboard'
import LcIcon from '@/components/LcIcon.vue'

const { t } = useI18n()

type Kind = 'app' | 'editor'
const CARDS = [
  { k: 'app', badge: 'img', entry: 'loomcanvas-web/app' },
  { k: 'editor', badge: 'vid', entry: 'loomcanvas-web/editor' },
] as const
const BULLETS = ['b1', 'b2', 'b3', 'b4'] as const

// 示意图里重复的小块
const GRID = [0, 1, 2, 3, 4, 5].map((i) => [86 + (i % 3) * 86, 78 + Math.floor(i / 3) * 54])
const NODES = [
  { x: 28, y: 80, w: 52, h: 34 }, { x: 28, y: 126, w: 52, h: 34 },
  { x: 104, y: 92, w: 56, h: 58, sel: true }, { x: 178, y: 96, w: 46, h: 50, out: true },
]
const PORTS = [[80, 97], [80, 143], [104, 116], [104, 126], [160, 121], [178, 121]]

/**
 * 两段示例代码。和公开 API（web/src/embed/app.ts、editor.ts，文档 docs/integration*.md）保持一致：
 * 改了那边的名字或选项，这里要跟着改。只有注释那一行随界面语言变。
 */
const SNIPPETS = computed<Record<Kind, string[]>>(() => ({
  app: [
    "import { mountLoomCanvas } from 'loomcanvas-web/app'",
    "import 'loomcanvas-web/app.css'",
    '',
    `// ${t('landing.integ.app.comment')}`,
    "mountLoomCanvas(document.getElementById('canvas'), {",
    "  apiBase: 'https://canvas.example.com/api',",
    '  getAuth: async () => ({',
    "    Authorization: 'Bearer ' + await mySession.token(),",
    '  }),',
    "  shell: 'none',",
    "  pages: ['canvases', 'canvas', 'assets'],",
    '})',
  ],
  editor: [
    "import { mountEditor, createHttpAdapter } from 'loomcanvas-web/editor'",
    "import 'loomcanvas-web/editor.css'",
    '',
    `// ${t('landing.integ.editor.comment')}`,
    "mountEditor(document.getElementById('editor'), {",
    '  adapter: createHttpAdapter({',
    "    apiBase: '/api',",
    "    getAuth: () => ({ Authorization: 'Bearer ' + token }),",
    '  }),',
    "  canvasId: 'abc',",
    '})',
  ],
}))

// 上色：注释 / 字符串 / 关键字 / 函数名 / 属性名，五类，一条正则；不引语法高亮库
const RE = /(\/\/.*$)|('[^']*')|\b(import|from|async|await)\b|([A-Za-z_$][\w$]*)(?=\()|([A-Za-z_$][\w$]*)(?=:)/g
function tint(line: string) {
  const out: { c: string; s: string }[] = []
  let last = 0
  for (const m of line.matchAll(RE)) {
    if (m.index > last) out.push({ c: '', s: line.slice(last, m.index) })
    out.push({ c: m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : m[4] ? 'f' : 'p', s: m[0] })
    last = m.index + m[0].length
  }
  if (last < line.length) out.push({ c: '', s: line.slice(last) })
  return out
}
const tinted = computed(() => ({ app: SNIPPETS.value.app.map(tint), editor: SNIPPETS.value.editor.map(tint) }))

/** 「……需要{link}。」拆成链接前后两段 */
const license = computed(() => t('landing.integ.license', { link: '\u0000' }).split('\u0000'))

const copied = ref<Kind | ''>('')
let timer = 0
async function copy(k: Kind) {
  try {
    await writeClipboard(SNIPPETS.value[k].join('\n') + '\n')
    MessagePlugin.success(t('landing.integ.copied'))
    copied.value = k
    window.clearTimeout(timer)
    timer = window.setTimeout(() => { copied.value = '' }, 2000)
  } catch {
    MessagePlugin.error(t('common.copyFailed'))
  }
}
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<style scoped>
.ig { margin-top: 48px; }
.ig-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
.ig-card { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; padding: 24px; }
.ig-card > * { max-width: 100%; }

.ig-art { align-self: stretch; margin-bottom: 20px; border-radius: 12px; border: 1px solid var(--line); background: rgb(var(--c-well) / .45); padding: 16px; }
.ig-art svg { display: block; width: 100%; max-width: 520px; height: auto; margin: 0 auto; }
.win { fill: var(--panel-solid); stroke: var(--line-2); }
.rule { fill: none; stroke: var(--line); }
.blk { fill: rgb(var(--c-film) / .2); }
.blk.hi { fill: rgb(var(--c-film) / .42); }
.lb { font: 500 9px var(--f-body); fill: var(--text-2); }
.lb.tg { fill: var(--cyan-soft); font-size: 8.5px; }
.lb.dim { fill: var(--text-3); font-size: 8.5px; }
.mount { fill: rgb(var(--c-cyan) / .06); stroke: var(--cyan); stroke-dasharray: 4 3; }
.cv { stroke: none; }
.pd { fill: rgb(var(--c-film) / .4); }
.tag { fill: var(--port-bg); stroke: var(--cyan); }
.nd { fill: var(--panel-2); stroke: var(--line-2); }
.nd.sel { stroke: var(--cyan); }
.th { fill: rgb(var(--c-violet) / .2); }
.g1 { stop-color: var(--hue-cyan); }
.g2 { stop-color: var(--hue-sky); }
.g3 { stop-color: var(--hue-lilac); }
.wire { fill: none; stroke: url(#ig-g1); stroke-width: 1.6; stroke-linecap: round; }
.wire.two { stroke: url(#ig-g2); }
.dot { fill: var(--port-bg); stroke: var(--cyan); }
.dot.v { stroke: var(--port-video); }
.port { fill: var(--port-bg); stroke: var(--cyan); stroke-width: 1.4; }
.go { fill: var(--btn-bg); }
.plus { fill: none; stroke: var(--btn-fg); stroke-width: 1.4; stroke-linecap: round; }
.bar { fill: var(--panel-2); stroke: var(--line-2); }
.side { fill: rgb(var(--c-film) / .06); stroke: var(--line); }
.srv { fill: rgb(var(--c-film) / .06); stroke: var(--line-3); }
.srv-i { fill: none; stroke: var(--text-3); stroke-width: 5; stroke-linecap: round; stroke-dasharray: .1 100; }
.link { fill: none; stroke: var(--cyan); stroke-width: 1.4; stroke-dasharray: 3 2.5; }

.ig-card h3 { font: 600 20px/1.4 var(--f-disp); color: var(--text); margin-top: 12px; }
.desc { color: var(--text-2); font-size: 14px; line-height: 1.7; margin-top: 6px; }
.ig-card ul { list-style: none; margin: 16px 0 24px; padding: 0; display: grid; gap: 8px; }
.ig-card li { display: flex; gap: 10px; color: var(--text-2); font-size: 14px; line-height: 1.6; }
.ig-card li svg { flex: none; margin-top: 4px; color: var(--cyan); }

.ig-code { align-self: stretch; margin-top: auto; border-radius: 10px; border: 1px solid var(--line); background: var(--well); min-width: 0; }
.ig-code-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 6px 6px 14px; border-bottom: 1px solid var(--line); color: var(--text-3); font-size: 12px; }
.ig-code-h span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ig-code pre { margin: 0; padding: 12px 14px; overflow-x: auto; font: 12px/1.7 var(--f-mono); color: var(--text-2); border-radius: 0 0 10px 10px; }
.ig-code pre:focus-visible { outline: none; box-shadow: var(--ring); }
.ig-code code { display: block; width: max-content; min-width: 100%; font: inherit; }
.ln { display: block; white-space: pre; min-height: 1.7em; }
.ln .c { color: var(--text-3); }
.ln .s { color: var(--ok); }
.ln .k { color: var(--kind-video-fg); }
.ln .f { color: var(--cyan-soft); }
.ln .p { color: var(--kind-chat-fg); }

.ig-end { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 16px 32px; margin-top: 28px; }
.ig-act { display: flex; gap: 12px; flex-wrap: wrap; }
.ig-note p { color: var(--text-3); font-size: 13px; line-height: 1.7; }
.ig-note a { color: var(--cyan-soft); }

@media (max-width: 820px) {
  .ig-grid { grid-template-columns: 1fr; }
  .ig-end { grid-template-columns: 1fr; }
}
@media (max-width: 600px) {
  .ig { margin-top: 28px; }
  .ig-grid { gap: 12px; }
  .ig-card { padding: 18px; }
  .ig-art { padding: 10px; margin-bottom: 16px; }
  .lb { font-size: 10px; }
  .lb.tg, .lb.dim { font-size: 9.5px; }
  .ig-act .lc-btn { flex: 1 1 auto; }
}
</style>
