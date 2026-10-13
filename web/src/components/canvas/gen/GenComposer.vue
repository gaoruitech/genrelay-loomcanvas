<template>
  <div
    ref="rootRef"
    class="gc nodrag nowheel"
    :class="{ sheet, dock: docked && !phone, flipped: place.flipped && !sheet, off: !place.visible && !sheet, over: place.over && !sheet }"
    :data-side="place.side"
    :style="sheet ? undefined : { transform: `translate3d(${place.left}px, ${place.top}px, 0)`, width: place.width + 'px' }"
    role="group"
    :aria-label="t(g.viewOnly ? 'gen.composer.labelView' : 'gen.composer.label', { name: g.title })"
    :data-view="g.viewOnly ? '1' : undefined"
    data-testid="gen-composer"
    @keydown.capture="onKeyCapture"
    @keydown.esc.stop="emit('close')"
    @mousedown.stop
    @wheel.stop
  >
    <div class="gc-card">
      <div class="gc-grip">
        <button v-tip="t('common.close')" type="button" class="gf-ib-plain" :aria-label="t('common.close')" @click="emit('close')"><LcIcon name="x" size="s" /></button>
      </div>
      <GenPromptField ref="promptRef" variant="composer" meta @escape="emit('close')" />
      <GenNotes kit />
      <!-- 只读：模型、参数是一行字，没有运行钮（GenModelField / GenParamsField / GenRunButton 各自看 g.viewOnly） -->
      <div class="gc-bar" :class="{ ro: g.viewOnly }">
        <GenModelField variant="chip" />
        <GenParamsField variant="chip" />
        <span class="gn-sp" />
        <GenCost long />
        <GenRunButton variant="lg" />
      </div>
    </div>
    <div v-if="!sheet && place.keys" class="gc-keys" aria-hidden="true">
      <template v-if="!g.viewOnly">
        <span v-if="g.hasOwnPrompt && g.imageRefs.length"><kbd>@</kbd> {{ t('gen.composer.keyAt') }}</span>
        <span><kbd>{{ modKey }}</kbd> <kbd>Enter</kbd> {{ t('gen.composer.keyRun') }}</span>
      </template>
      <span><kbd>Esc</kbd> {{ t('gen.composer.keyClose') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 布局 a 的输入条：整张画布只有这一条，选中哪一个生成节点就编辑哪一个。
 *
 * 浮在画布上面（不在节点里），所以开合不会改动节点的大小和位置。跟着节点走：平移、缩放、
 * 拖动节点时位置实时重算；大小固定为屏幕像素，不跟画布缩放 —— 这是打字的地方，缩到 30%
 * 就没法用了。手机宽度改成贴底的抽屉；桌面上编辑区小到「节点 + 输入条」横着竖着都摆不开时也用这个抽屉
 * （.dock：居中、限宽），节点挪到抽屉上面看得见的地方 —— 不让输入条压在它正在编辑的节点上。
 *
 * 放在哪（utils/floatSpot.ts 的 placeNear）：默认在节点正下方；下方放不下、或者会压着工具面板、生成队列圆钮、
 * 小地图、标题块、底部工具条时，先沿着节点的底边横向滑开，滑不开换到上方，再不行换到右边 / 左边。
 * 节点自己的端口（和端口旁的名字）任何时候都不盖；四边都放不下时把画布平移一小段腾出一边（makeRoom）。压着别的节点是允许的 —— 画布上到处是节点，躲不开 ——
 * 这时加深底色和影子（.over），让它读起来是浮在上面的一层。
 *
 * 状态是自己另起的一份 useGenNode（由父级按节点 id 加 key，换节点就整个重建）：
 * 开着 only-render-visible-elements，被选中的节点可能没渲染，不能指望节点组件替它算。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, shallowRef, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { useGenNode, GEN_NODE_KEY } from '@/composables/useGenNode'
import type { GenNodeKind } from '@/composables/nodeLayout'
import { clampNum, fitInArea, isFree, overlapArea, placeNear, watchRects, type Rect, type Side } from '@/utils/floatSpot'
import LcIcon from '@/components/LcIcon.vue'
import GenPromptField from './GenPromptField.vue'
import GenNotes from './GenNotes.vue'
import GenModelField from './GenModelField.vue'
import GenParamsField from './GenParamsField.vue'
import GenCost from './GenCost.vue'
import GenRunButton from './GenRunButton.vue'

const props = defineProps<{
  nodeId: string
  kind: GenNodeKind
  /** 要绕开的矩形（相对编辑区）：工具面板要去的位置。别的悬浮块这里自己量 */
  avoid?: Rect[]
}>()
const emit = defineEmits<{
  (e: 'close'): void
  /**
   * 贴底抽屉形态时它占的矩形（相对编辑区）；不是抽屉（浮在节点旁边）、或者卸掉了，是 null。
   * 画布据此把底部工具条、小地图收起来，让生成队列圆钮和工具面板绕开它 —— 抽屉是压在最上面的一层，
   * 底下的东西不让位就是被它盖住一半。
   */
  (e: 'sheet', rect: Rect | null): void
}>()

const { t } = useI18n()
const { viewport, findNode, getNodes, setViewport, minZoom } = useVueFlow()
const node = computed(() => findNode(props.nodeId))
const g = useGenNode({ kind: props.kind, id: props.nodeId, data: () => node.value?.data || {} })
provide(GEN_NODE_KEY, g)

const modKey = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'

/* ── 位置 ── */
const rootRef = ref<HTMLElement | null>(null)
const own = reactive({ h: 150 })
const host = reactive({ w: 1200, h: 800 })
const phone = computed(() => host.w <= 640)
/** 桌面宽度，但编辑区放不下「节点 + 输入条」：也用贴底的抽屉（见 makeRoom） */
const docked = ref(false)
const sheet = computed(() => phone.value || docked.value)
/** 浮着的时候卡片有多高。抽屉形态下 own.h 量到的是抽屉的高，判断「浮着放不放得下」还得用这个数 */
const floatH = ref(150)
const WIDTH = 480, GAP = 12, SIDE_GAP = 20, EDGE = 8
/** 别的固定悬浮块占的矩形（相对编辑区），定时量（见 watchRects） */
const fixed = shallowRef<Rect[]>([])
/** 这个节点自己的端口和端口旁的名字：相对节点左上角、没乘缩放的矩形 */
const ports = shallowRef<Rect[]>([])

/** 卡片下面那行快捷键提示占的高度（含它和卡片之间的空隙）。它是挂在卡片外面的，不算进卡片的大小 */
const KEYS_H = 32
/**
 * 假如画布再平移 (dx, dy)，输入条会落在哪。(0, 0) 就是现在；makeRoom 用别的数试「挪一下能不能放好」。
 * 固定的悬浮块不跟着画布走，节点、端口、别的节点都跟着走。
 */
function solve(dx: number, dy: number) {
  const n = node.value
  const width = Math.min(WIDTH, host.w - EDGE * 2)
  if (!n) return null
  const z = viewport.value.zoom || 1
  const vx = viewport.value.x + dx, vy = viewport.value.y + dy
  const x = vx + (n.computedPosition?.x ?? n.position.x) * z
  const y = vy + (n.computedPosition?.y ?? n.position.y) * z
  const w = (n.dimensions?.width || 272) * z
  const h = (n.dimensions?.height || 272) * z
  const keep = ports.value.map((p) => ({ l: x + p.l * z - 2, t: y + p.t * z - 2, r: x + p.r * z + 2, b: y + p.b * z + 2 }))
  const size = { w: width, h: floatH.value }
  // 画布上别的节点（组是一大片底板，不算）：能不压就不压
  const others: Rect[] = []
  for (const o of getNodes.value as any[]) {
    if (o.id === n.id || o.type === 'frame') continue
    const ox = vx + (o.computedPosition?.x ?? o.position?.x ?? 0) * z
    const oy = vy + (o.computedPosition?.y ?? o.position?.y ?? 0) * z
    const ow = (o.dimensions?.width || 0) * z, oh = (o.dimensions?.height || 0) * z
    if (ow > 0 && oh > 0) others.push({ l: ox, t: oy, r: ox + ow, b: oy + oh })
  }
  const obstacles = [...(props.avoid || []), ...fixed.value]
  const rect: Rect = { l: x, t: y, r: x + w, b: y + h }
  const at = placeNear(rect, size, host, obstacles, {
    order: ['below', 'above', 'right', 'left'], gap: GAP, sideGap: SIDE_GAP, edge: EDGE, keep, soft: others, attach: 96,
  })
  return { at, rect, size, width, others, obstacles }
}

const place = computed<{ left: number; top: number; width: number; flipped: boolean; visible: boolean; over: boolean; keys: boolean; side: Side }>(() => {
  const s = solve(0, 0)
  if (!s) return { left: 0, top: 0, width: Math.min(WIDTH, host.w - EDGE * 2), flipped: false, visible: false, over: false, keys: false, side: 'below' }
  const { at, rect, size, width, others, obstacles } = s
  // 节点整个在视野外：不出现（否则会孤零零贴在画布边上）
  const visible = rect.r > 0 && rect.l < host.w && rect.b > 0 && rect.t < host.h
  // 还是压着别的节点了，或者连自己的节点都不得不压：换成更实的一层
  const over = !at.clear || others.some((r) => overlapArea(at.x, at.y, size, r) > 0)
  // 快捷键提示挂在卡片背着节点的那一侧（在上方时挂在卡片上面）：那里放得下、不压别的悬浮块才出
  const flipped = at.side === 'above'
  const ky = flipped ? at.y - KEYS_H : at.y + size.h
  const keys = ky >= EDGE && ky + KEYS_H <= host.h - EDGE && isFree(at.x + 80, ky, { w: size.w - 160, h: KEYS_H }, obstacles, 0)
  return { left: at.x, top: at.y, width, flipped, visible, over, keys, side: at.side }
})

/**
 * 节点四周哪一边都放不下输入条（窗口矮、节点又靠边）时，placeNear 只能退而求其次，压着节点自己、甚至盖住它的端口。
 * 这里先算有没有别的出路：
 *   'ok'        现在就放得好（或者节点不在视野里，输入条根本不出现）
 *   { dx, dy }  把画布平移这么多就放得好 —— 只挪刚好够的距离，挪完节点整个在编辑区里、不在别的悬浮块底下
 *   null        怎么挪都不行：编辑区比「节点 + 输入条」还小（横着竖着都摆不开）
 */
function roomPlan(): 'ok' | { dx: number; dy: number } | null {
  const cur = solve(0, 0)
  if (!cur) return 'ok'
  const { rect: a, size, obstacles } = cur
  if (!(a.r > 0 && a.l < host.w && a.b > 0 && a.t < host.h) || cur.at.clear) return 'ok'
  const OG = 8
  const w = a.r - a.l, h = a.b - a.t
  // 节点有一截在编辑区外面：先算把它整个挪进来要多少，下面的挪法都从这儿起算
  const bx = clampNum(a.l, EDGE, Math.max(EDGE, host.w - EDGE - w)) - a.l
  const by = clampNum(a.t, EDGE, Math.max(EDGE, host.h - EDGE - h)) - a.t
  const l0 = a.l + bx, t0 = a.t + by
  // 让某一边正好放得下：输入条贴着编辑区的边，或者贴着某个悬浮块的边
  const xs = new Set<number>([0]), ys = new Set<number>([0])
  for (const right of [host.w - EDGE, ...obstacles.map((r) => r.l - OG)]) xs.add(Math.floor(right - size.w - SIDE_GAP - (l0 + w)))
  for (const left of [EDGE, ...obstacles.map((r) => r.r + OG)]) xs.add(Math.ceil(left + size.w + SIDE_GAP - l0))
  for (const bottom of [host.h - EDGE, ...obstacles.map((r) => r.t - OG)]) ys.add(Math.floor(bottom - size.h - GAP - (t0 + h)))
  for (const top of [EDGE, ...obstacles.map((r) => r.b + OG)]) ys.add(Math.ceil(top + size.h + GAP - t0))
  let best: { dx: number; dy: number; d: number } | null = null
  const tryPan = (dx: number, dy: number) => {
    const d = Math.hypot(dx, dy)
    if (!d || (best && d >= best.d)) return
    const l = a.l + dx, t = a.t + dy
    if (l < EDGE || t < EDGE || l + w > host.w - EDGE || t + h > host.h - EDGE) return
    if (!isFree(l, t, { w, h }, obstacles, 0)) return
    if (solve(dx, dy)?.at.clear) best = { dx, dy, d }
  }
  for (const dx of xs) tryPan(bx + dx, by)
  for (const dy of ys) tryPan(bx, by + dy)
  const pan = best as { dx: number; dy: number } | null
  return pan ? { dx: pan.dx, dy: pan.dy } : null
}
function panBy(dx: number, dy: number) {
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return
  const vp = viewport.value
  const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  void setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom || 1 }, { duration: still ? 0 : 240 })
}
/**
 * 给输入条腾地方（和布局 b 选中被属性面板挡住的节点时是同一个做法）：能平移就平移一小段；怎么挪都放不下就换成
 * 贴底的抽屉，再把节点挪到抽屉上面看得见的那一块里。只是换了视野，不进撤销。返回有没有动。
 */
function makeRoom(): boolean {
  measurePorts()
  // 手机宽度：本来就是抽屉，要做的只有把节点让到抽屉上面
  if (phone.value) { void nextTick(revealAbove); return true }
  // 一挂上就判定放不下、已经是抽屉了：不再重新算「浮着放不放得下」—— 抽屉开着时底部工具条、小地图、被挤住的工具面板
  // 都收起来了，这会儿量到的空地是假的（照它放回去，它们一回来就叠在一起）。只把节点让到抽屉上面
  if (docked.value) { void nextTick(revealAbove); return true }
  const plan = roomPlan()
  if (plan === 'ok') { docked.value = false; return false }
  if (plan) { docked.value = false; panBy(plan.dx, plan.dy); return true }
  docked.value = true
  // 等抽屉画出来、量得到它有多高
  void nextTick(revealAbove)
  return true
}
/**
 * 抽屉形态（手机宽度，或桌面上放不下时）：把节点摆进抽屉上面剩下的那一块里 —— 连同它两侧的端口和端口旁的名字。
 * 挪得最少，已经在里面、不压别的悬浮块就不动；压着了（标题块、工具面板、挪到抽屉上面来的生成队列圆钮）挪到最近的空地。
 * 那一块比节点还小（手机上常见：节点 344 高，抽屉上面只剩一百多）时把画布缩小到刚好放得下再摆 ——
 * 不然只能露出节点的一截，端口和结果总有一部分压在抽屉底下。只是换了视野，不进撤销。算法在 utils/floatSpot.ts 的 fitInArea。
 */
function revealAbove() {
  const el = rootRef.value
  const s = solve(0, 0)
  if (!el || !s || !sheet.value) return
  const a = s.rect
  // 节点整个不在视野里：输入条本来就不该为它挪画布（是用户自己平移走的）；手机上抽屉一直在，照样把它请回来
  if (!phone.value && !(a.r > 0 && a.l < host.w && a.b > 0 && a.t < host.h)) return
  const z = viewport.value.zoom || 1
  // 端口和名字小签比节点宽出去的那一截（相对节点、没乘缩放）
  const padL = Math.max(0, -Math.min(0, ...ports.value.map((p) => p.l))) * z
  const padR = Math.max(0, Math.max(0, ...ports.value.map((p) => p.r)) * z - (a.r - a.l))
  const rect = { l: a.l - padL, t: a.t, r: a.r + padR, b: a.b }
  const opts = { gap: 8, minScale: (minZoom.value || 0.2) / z }
  // 顶上那几排（标题块、横排在顶边的工具面板、只读提示条）：手机上它们铺满一整行，直接从它们下面起算；
  // 桌面上先按整块算（节点可以待在标题块右边），摆不开 —— 落点还压着它们 —— 再退到它们下面那一块
  // （只算横着的那几排：竖排贴边的工具面板不是「一排」，它由找空地那一步去绕）
  const topRows = s.obstacles.filter((r) => r.t < 150 && r.r - r.l > r.b - r.t)
  const bottom = host.h - el.offsetHeight - GAP
  const top = Math.max(EDGE, ...topRows.map((r) => r.b + 8))
  const whole = () => fitInArea(rect, { l: EDGE, t: EDGE, r: host.w - EDGE, b: bottom }, s.obstacles, opts)
  // 它们下面要是连一小条都不剩（抽屉几乎顶到了它们）：还是按整块算，压着标题块也比压在抽屉底下强
  const below = () => (bottom - top >= 48 ? fitInArea(rect, { l: EDGE, t: top, r: host.w - EDGE, b: bottom }, s.obstacles.filter((r) => !topRows.includes(r)), opts) : whole())
  let fit = phone.value ? below() : whole()
  if (!phone.value && topRows.length) {
    const at = fit || { x: rect.l, y: rect.t, scale: 1 }
    if (!isFree(at.x, at.y, { w: (rect.r - rect.l) * at.scale, h: (rect.b - rect.t) * at.scale }, s.obstacles, 0)) fit = below()
  }
  if (!fit) return
  const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const nz = z * fit.scale
  // 节点在画布里的坐标不变；算出让它落在 (fit.x + 左边那一截, fit.y) 的视口
  const fx = (a.l - viewport.value.x) / z, fy = (a.t - viewport.value.y) / z
  const x = Math.round(fit.x + padL * fit.scale - fx * nz), y = Math.round(fit.y - fy * nz)
  if (Math.abs(x - viewport.value.x) < 1 && Math.abs(y - viewport.value.y) < 1 && Math.abs(nz - z) < 0.001) return
  void setViewport({ x, y, zoom: nz }, { duration: still ? 0 : 240 })
}

/** 量这个节点的端口：端口圆点本身，加上选中时出现在旁边的名字小签 */
function measurePorts() {
  const parent = rootRef.value?.parentElement
  const n = node.value
  if (!parent || !n) return
  const el = parent.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(props.nodeId)}"]`)
  if (!el) { ports.value = []; return }
  const z = viewport.value.zoom || 1
  const nr = el.getBoundingClientRect()
  // 记成相对节点左上角、除掉缩放的数：之后平移 / 缩放画布时按视口换算就行，不用重量
  ports.value = Array.from(el.querySelectorAll<HTMLElement>('.vue-flow__handle, .gn-pl')).map((p) => {
    const r = p.getBoundingClientRect()
    return { l: (r.left - nr.left) / z, t: (r.top - nr.top) / z, r: (r.right - nr.left) / z, b: (r.bottom - nr.top) / z }
  }).filter((r) => r.r > r.l && r.b > r.t)
}

let ro: ResizeObserver | null = null
let stopRects: (() => void) | null = null
let portsTimer: number | null = null
onMounted(() => {
  const el = rootRef.value
  const parent = el?.parentElement
  if (!el || !parent) return
  const measure = () => {
    own.h = el.offsetHeight || own.h
    if (!sheet.value) floatH.value = own.h
    host.w = parent.clientWidth || host.w
    host.h = parent.clientHeight || host.h
  }
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(parent)
  }
  measure()
  reportSheet()
  stopRects = watchRects(() => rootRef.value?.parentElement, '.qf, .vue-flow__minimap, .ed-tools, .ed-title, .ed-hint, .ed-undo, .clb', (r) => { fixed.value = r })
  measurePorts()
  // 一上来就知道怎么挪都放不下：直接用抽屉，不先浮出来压着节点闪一下（挪节点等手松开，由画布来叫 makeRoom）
  if (!phone.value && roomPlan() === null) docked.value = true
  // 端口旁的名字小签是选中之后才淡入的，节点也可能这一拍才画出来：稍后再量一次
  portsTimer = window.setTimeout(() => { portsTimer = null; measurePorts() }, 240)
  window.setTimeout(() => { settled = true }, 0)
})
onBeforeUnmount(() => {
  emit('sheet', null)
  ro?.disconnect(); ro = null
  stopRects?.(); stopRects = null
  if (portsTimer !== null) clearTimeout(portsTimer)
  if (recheckTimer !== null) clearTimeout(recheckTimer)
  if (revealTimer !== null) clearTimeout(revealTimer)
  if (undockTimer !== null) clearTimeout(undockTimer)
})
// 抽屉的高度变了（字体就位、提示词多打了一行、多出一条提醒）：节点要是被挡住了就再让一让
let revealTimer: number | null = null
watch(() => own.h, () => {
  if (!sheet.value) return
  if (revealTimer !== null) clearTimeout(revealTimer)
  revealTimer = window.setTimeout(() => { revealTimer = null; revealAbove() }, 120)
})
// 抽屉开着、位置和大小定下来之后告诉画布（post：这时 DOM 已经是抽屉的样子，量得到）
function reportSheet() {
  const el = rootRef.value, parent = el?.parentElement
  if (!sheet.value || !el || !parent) { emit('sheet', null); return }
  // 用排版的位置，不用 getBoundingClientRect：抽屉有一段从下往上滑的入场动画，动画途中量到的矩形是偏下的
  emit('sheet', { l: el.offsetLeft, t: el.offsetTop, r: el.offsetLeft + el.offsetWidth, b: el.offsetTop + el.offsetHeight })
}
watch(() => [sheet.value, phone.value, own.h, host.w, host.h], () => { void nextTick(reportSheet) }, { flush: 'post' })
// 抽屉一开，生成队列圆钮会挪到它上面去，工具面板也可能从抽屉底下挪上来：要是正好落在节点（的端口）上，再把节点让一让
watch([fixed, () => (props.avoid || []).map((r) => `${r.l},${r.t},${r.r},${r.b}`).join('|')], () => {
  if (!sheet.value) return
  if (revealTimer !== null) clearTimeout(revealTimer)
  revealTimer = window.setTimeout(() => { revealTimer = null; revealAbove() }, 160)
})
// 编辑区的大小、画布的缩放变了（拖窗口、滚轮缩放）：放不放得下可能跟着变，停下来之后重新看一次。
// 挂载那一下量出真实尺寸也会走到这儿，不算（那一次由画布在手松开之后叫）
let settled = false
let recheckTimer: number | null = null
/** 试过从抽屉放回浮着的、不行：编辑区的大小再变之前不再试（不然每缩放一下就来回翻一次） */
let dockLock = false
let undockTimer: number | null = null
watch(() => [host.w, host.h, Math.round((viewport.value.zoom || 1) * 100)], (now, old) => {
  if (!settled) return
  const resized = !old || now[0] !== old[0] || now[1] !== old[1]
  if (resized) dockLock = false
  if (recheckTimer !== null) clearTimeout(recheckTimer)
  recheckTimer = window.setTimeout(() => { recheckTimer = null; recheck(resized) }, 260)
})
/**
 * 缩放 / 改窗口大小之后放不下了：不替用户平移画布（刚缩放完画布自己又动一下很怪），直接换成抽屉；
 * 节点要是被抽屉挡住了才挪它（revealAbove 只在必要时动）。又放得下了就变回浮着的。
 *
 * 已经是抽屉时要小心：抽屉开着，底部工具条、小地图、被挤住的工具面板都收起来了，这时算出来的「放得下」不作数。
 * 所以只有编辑区变大了才试着放回去（缩放变了不算 —— 多半是我们自己为了让节点露出来缩的），而且放回去之后
 * 等那几块回来再核一次，还是放不下就退回抽屉。
 */
function recheck(resized: boolean) {
  if (phone.value || !rootRef.value) return
  measurePorts()
  if (docked.value) {
    if (!resized || dockLock) { void nextTick(revealAbove); return }
    docked.value = false
    if (undockTimer !== null) clearTimeout(undockTimer)
    undockTimer = window.setTimeout(() => {
      undockTimer = null
      if (!rootRef.value || docked.value || phone.value) return
      measurePorts()
      if (roomPlan() !== 'ok') { dockLock = true; docked.value = true; void nextTick(revealAbove) }
    }, 480)
    return
  }
  const fits = roomPlan() === 'ok'
  docked.value = !fits
  if (!fits) void nextTick(revealAbove)
}
// 端口的个数、节点的大小变了（换模式多出一个尾帧口、出了结果节点变高）：重量
watch(() => [g.ports.length, node.value?.dimensions?.width, node.value?.dimensions?.height], () => { void nextTick(measurePorts) })

/**
 * 输入法正在组字时，回车是「上屏」、Esc 是「取消组字」、方向键是「挑候选」—— 都是输入法的键。
 * 拦在捕获阶段：提示词框自己的按键处理（Ctrl+Enter 运行、Esc 收起、@ 候选）这时就收不到，不会误触发。
 */
function onKeyCapture(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) e.stopPropagation()
}

const promptRef = ref<InstanceType<typeof GenPromptField> | null>(null)
/** 画布上选中节点后直接打字：把焦点放进提示词框 */
function focusPrompt() { return promptRef.value?.focus() || false }
defineExpose({ focusPrompt, makeRoom, run: () => g.run() })
</script>

<style scoped>
/* 压在别的节点上（或者实在躲不开自己的节点）时：底更实、描边更亮、影子更深，外面再垫一圈很淡的底色，
   把它和底下的节点分开 —— 读起来是浮在上面的一层，而不是和下面那个节点长在一起 */
.gc.over .gc-card {
  background: linear-gradient(180deg, rgb(var(--c-glass-hi) / .98), rgb(var(--c-glass) / .98));
  border-color: var(--line-3);
  box-shadow: 0 0 0 5px rgb(var(--c-chrome-0) / .42), var(--sh-2);
}
.gc.over .gc-keys { background: rgb(var(--c-chrome-0) / .9); box-shadow: 0 0 0 1px var(--line); }
/* 快捷键提示挂在卡片外面（不占输入条的大小，摆位置只按卡片算）：默认在卡片下面，输入条在节点上方时挂到卡片上面 */
.gc:not(.sheet) { display: block; }
/* 桌面宽度下的抽屉（编辑区放不下「节点 + 输入条」时）：居中、限宽，不铺满一整条 */
.gc.sheet.dock { left: 0; right: 0; margin: 0 auto; width: min(560px, 100%); }
.gc.sheet.dock .gc-card { border-width: 1px 1px 0; }
/* 这是桌面：底下那一行还是一行（模型、参数、成本、运行），不用手机上那种通栏大按钮 —— 抽屉矮一截，上面多露出一点节点 */
.gc.sheet.dock .gc-bar { flex-wrap: nowrap; }
.gc.sheet.dock .gc-bar .gn-sp { display: block; }
.gc.sheet.dock .gc-bar :deep(.gf-cost) { flex: 0 10 auto; }
.gc.sheet.dock .gc-bar :deep(.gf-run), .gc.sheet.dock .gc-bar :deep(.gf-prog) { flex: none; height: 32px; font-size: 13px; margin-top: 0; }
.gc:not(.sheet) .gc-keys { position: absolute; left: 50%; top: calc(100% + 8px); transform: translateX(-50%); margin: 0; max-width: calc(100% - 24px); }
.gc.flipped:not(.sheet) .gc-keys { top: auto; bottom: calc(100% + 8px); }
</style>
