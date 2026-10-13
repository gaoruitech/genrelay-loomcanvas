<template>
  <div
    v-show="shown.visible || phone"
    ref="rootRef"
    class="st"
    :class="{ phone }"
    :style="phone ? phoneStyle : { transform: `translate3d(${shown.x}px, ${shown.y}px, 0)` }"
    role="toolbar"
    :aria-label="t('canvas.sel.label')"
    data-testid="sel-toolbar"
    :data-side="shown.side"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @mousedown.stop
    @keydown="onKeydown"
    @focusin="onFocusIn"
  >
    <span class="st-n" data-testid="sel-count">{{ t('canvas.sel.count', { n: count }) }}</span>
    <button
      ref="alignBtn"
      type="button"
      class="st-lk"
      :class="{ on: alignOpen }"
      aria-haspopup="menu"
      :aria-expanded="alignOpen"
      data-testid="sel-align"
      data-st
      @click="toggleAlign()"
    >{{ t('canvas.sel.align') }}<LcIcon name="chevd" size="s" /></button>
    <button
      v-tip="t(merge ? 'canvas.sel.mergeTip' : 'canvas.sel.groupTip')"
      type="button"
      class="st-lk"
      :aria-disabled="busy"
      data-testid="sel-group"
      data-st
      @click="act(() => emit('group'))"
    >{{ t(merge ? 'canvas.sel.merge' : 'canvas.sel.group') }}</button>
    <button
      v-if="ungroup"
      v-tip="t(ungroup === 'frame' ? 'canvas.sel.ungroupTip' : 'canvas.sel.releaseTip')"
      type="button"
      class="st-lk"
      :aria-disabled="busy"
      data-testid="sel-ungroup"
      data-st
      @click="act(() => emit('ungroup'))"
    >{{ t(ungroup === 'frame' ? 'canvas.sel.ungroup' : 'canvas.sel.release') }}</button>
    <button
      v-tip="runTip"
      type="button"
      class="lc-btn primary quiet sm st-run"
      :aria-disabled="runOff"
      :class="{ off: runOff }"
      data-testid="sel-run"
      data-st
      @click="onRun"
    ><LcIcon name="play" size="s" />{{ running ? t('canvas.topbar.running') : t('canvas.sel.run') }}</button>
    <span class="st-sep" aria-hidden="true" />
    <button
      v-tip="t('canvas.sel.deleteTip')"
      type="button"
      class="lc-tb sm st-del"
      :aria-label="t('canvas.sel.delete', { n: count })"
      :aria-disabled="busy"
      data-testid="sel-delete"
      data-st
      @click="act(() => emit('delete'))"
    ><LcIcon name="trash" size="s" /></button>

    <!-- 对齐 / 分布：一排图标，开在工具条背着选区的那一侧，不盖住正在对齐的节点 -->
    <div
      v-if="alignOpen"
      ref="popRef"
      class="st-pop lc-menu"
      :class="popUp ? 'up' : 'down'"
      :style="{ left: popLeft + 'px' }"
      role="menu"
      :aria-label="t('canvas.sel.alignMenu')"
      data-testid="sel-align-menu"
    >
      <button
        v-for="a in ALIGNS"
        :key="a.mode"
        v-tip="{ text: t(a.label), placement: popUp ? 'top' : 'bottom' }"
        type="button"
        class="lc-tb sm"
        role="menuitem"
        :aria-label="t(a.label)"
        :aria-disabled="busy"
        :data-align="a.mode"
        @click="act(() => emit('align', a.mode))"
      ><svg class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="a.icon" /></button>
      <hr />
      <button
        v-for="d in DISTS"
        :key="d.axis"
        v-tip="{ text: count >= 3 ? t(d.label) : t('canvas.sel.distNeedThree'), placement: popUp ? 'top' : 'bottom' }"
        type="button"
        class="lc-tb sm"
        :class="{ off: count < 3 }"
        role="menuitem"
        :aria-label="t(d.label)"
        :aria-disabled="count < 3 || busy"
        :data-dist="d.axis"
        @click="count >= 3 && act(() => emit('distribute', d.axis))"
      ><svg class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="d.icon" /></button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 多选工具条：选中两个及以上节点时出现（三种节点布局都一样），取代单选时的输入条 / 属性面板。
 * 「已选 N 个节点 · 对齐 · 编组 · 运行所选」—— 对齐点开是一排图标（六种对齐 + 两种等距分布）。
 *
 * 浮在画布上面、贴着选区：默认在选区上方居中，上方放不下换到下方；压着工具面板、生成队列圆钮、
 * 小地图、标题块、底部工具条时沿着选区的边滑开（utils/floatSpot.ts 的 placeNear）。大小是屏幕像素，
 * 不跟画布缩放。选区整个在视野外时不出现。手机宽度下固定在工具面板那一横条的下面。
 *
 * 动作都由画布来做（对齐 / 编组各记一笔历史，运行走执行器），这里只负责摆位置和键盘：
 * Tab 进来只停一次，← → 在按钮之间走；对齐菜单里 ← → 走图标，Esc 收起并回到「对齐」上。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import { placeNear, watchRects, type Rect, type Side } from '@/utils/floatSpot'
import type { AlignMode, DistributeAxis } from '@/composables/useAutoLayout'

const props = defineProps<{
  /** 选中了几个节点 */
  count: number
  /** 其中能运行的有几个 */
  runnable: number
  /** 选中的这些正在跑 */
  running?: boolean
  /** 现在运行会被团队的每月上限整批拦下：那一句说明（空串 = 不会）。按钮置灰，提示里写它 */
  blocked?: string
  /** 整理 / 对齐的动画还没走完：这期间不再接新的 */
  busy?: boolean
  /** 选中的里面已经有组：「编组」变成「合并为一组」 */
  merge?: boolean
  /** 选中的里面有组：多一颗「解散组」（frame）；没有组、但有节点待在组里：多一颗「移出组」（release） */
  ungroup?: '' | 'frame' | 'release'
  /** 要绕开的矩形（相对编辑区）：工具面板要去的位置。别的悬浮块这里自己量 */
  avoid?: Rect[]
}>()
const emit = defineEmits<{
  (e: 'align', mode: AlignMode): void
  (e: 'distribute', axis: DistributeAxis): void
  (e: 'group'): void
  (e: 'ungroup'): void
  (e: 'run'): void
  (e: 'delete'): void
}>()

const { t } = useI18n()
const { viewport, getSelectedNodes, getNodes } = useVueFlow()

const ALIGNS: { mode: AlignMode; label: string; icon: string }[] = [
  { mode: 'left', label: 'canvas.menu.alignLeft', icon: '<path d="M4 3v18"/><rect x="8" y="6" width="9" height="4" rx="1"/><rect x="8" y="14" width="13" height="4" rx="1"/>' },
  { mode: 'hcenter', label: 'canvas.menu.alignHCenter', icon: '<path d="M12 3v18"/><rect x="6" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>' },
  { mode: 'right', label: 'canvas.menu.alignRight', icon: '<path d="M20 3v18"/><rect x="7" y="6" width="9" height="4" rx="1"/><rect x="3" y="14" width="13" height="4" rx="1"/>' },
  { mode: 'top', label: 'canvas.menu.alignTop', icon: '<path d="M3 4h18"/><rect x="6" y="8" width="4" height="9" rx="1"/><rect x="14" y="8" width="4" height="13" rx="1"/>' },
  { mode: 'vcenter', label: 'canvas.menu.alignVCenter', icon: '<path d="M3 12h18"/><rect x="6" y="6" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>' },
  { mode: 'bottom', label: 'canvas.menu.alignBottom', icon: '<path d="M3 20h18"/><rect x="6" y="7" width="4" height="9" rx="1"/><rect x="14" y="3" width="4" height="13" rx="1"/>' },
]
const DISTS: { axis: DistributeAxis; label: string; icon: string }[] = [
  { axis: 'h', label: 'canvas.menu.distH', icon: '<path d="M4 3v18M20 3v18"/><rect x="10" y="8" width="4" height="8" rx="1"/>' },
  { axis: 'v', label: 'canvas.menu.distV', icon: '<path d="M3 4h18M3 20h18"/><rect x="8" y="10" width="8" height="4" rx="1"/>' },
]

/* ── 位置 ── */
const rootRef = ref<HTMLElement | null>(null)
const own = reactive({ w: 340, h: 40 })
const host = reactive({ w: 1200, h: 800 })
const phone = computed(() => host.w <= 640)
const fixed = shallowRef<Rect[]>([])

/** 选区在屏幕上的包围盒（相对编辑区） */
const bounds = computed<Rect | null>(() => {
  const z = viewport.value.zoom || 1
  let l = Infinity, t0 = Infinity, r = -Infinity, b = -Infinity
  for (const n of getSelectedNodes.value as any[]) {
    const x = viewport.value.x + (n.computedPosition?.x ?? n.position?.x ?? 0) * z
    const y = viewport.value.y + (n.computedPosition?.y ?? n.position?.y ?? 0) * z
    const w = (n.dimensions?.width || 240) * z, h = (n.dimensions?.height || 160) * z
    l = Math.min(l, x); t0 = Math.min(t0, y); r = Math.max(r, x + w); b = Math.max(b, y + h)
  }
  return Number.isFinite(l) ? { l, t: t0, r, b } : null
})

const spot = computed<{ x: number; y: number; side: Side; visible: boolean }>(() => {
  const a = bounds.value
  if (!a) return { x: 0, y: 0, side: 'above', visible: false }
  const visible = a.r > 0 && a.l < host.w && a.b > 0 && a.t < host.h
  // 没选中的节点（组是一大片底板，不算）：能不压就不压 —— 上方压着别的节点、下方空着就去下方
  const z = viewport.value.zoom || 1
  const others: Rect[] = []
  for (const o of getNodes.value as any[]) {
    if (o.selected || o.type === 'frame') continue
    const ox = viewport.value.x + (o.computedPosition?.x ?? o.position?.x ?? 0) * z
    const oy = viewport.value.y + (o.computedPosition?.y ?? o.position?.y ?? 0) * z
    const ow = (o.dimensions?.width || 0) * z, oh = (o.dimensions?.height || 0) * z
    if (ow > 0 && oh > 0) others.push({ l: ox, t: oy, r: ox + ow, b: oy + oh })
  }
  const at = placeNear(a, own, host, [...(props.avoid || []), ...fixed.value], { order: ['above', 'below'], gap: 12, attach: 64, soft: others })
  return { x: at.x, y: at.y, side: at.side, visible }
})

/**
 * 窄编辑区里工具条固定排在顶上那几排下面（样式里的 --ed-top）。工具面板要是也横着停在那儿，再往下让到它下面：
 * 编辑区窄而窗口不窄时（侧栏占掉一截）面板不是手机上那一横条，可以被拖成横排停在顶边 —— 以前按写死的 108px 排，
 * 正好叠在它身上。只看和工具条横向搭着的、确实在顶上的那一块。
 */
const phoneStyle = computed(() => {
  const l = host.w / 2 - own.w / 2 - 6, r = host.w / 2 + own.w / 2 + 6
  const rows = (props.avoid || []).filter((a) => a.t < Math.min(220, host.h / 2) && a.r - a.l > a.b - a.t && a.r > l && a.l < r)
  if (!rows.length) return undefined
  return { top: `max(calc(var(--ed-top, 102px) + 6px), ${Math.round(Math.max(...rows.map((a) => a.b)) + 6)}px)` }
})

/**
 * 画出来的位置。指针停在工具条（或它的菜单）上的时候不跟着算出来的位置走：点「对齐」节点会动、标题块的宽度会随
 * 「未保存 / 已保存 · 12:30」变，工具条跟着一挪，手底下的按钮就换了一颗 —— 连点两次对齐、把鼠标移到菜单上都会点错。
 * 指针离开之后再跟上去。
 */
const shown = shallowRef(spot.value)
const hovered = ref(false)
let leaveTimer: number | null = null
function onPointerEnter() {
  if (leaveTimer !== null) { clearTimeout(leaveTimer); leaveTimer = null }
  hovered.value = true
}
function onPointerLeave() {
  // 从工具条挪到菜单要经过中间那 8px 的缝：稍等一下再放开
  if (leaveTimer !== null) clearTimeout(leaveTimer)
  leaveTimer = window.setTimeout(() => { leaveTimer = null; hovered.value = false }, 240)
}
watch([spot, hovered], () => { if (!hovered.value) shown.value = spot.value }, { flush: 'sync' })

let ro: ResizeObserver | null = null
let stopRects: (() => void) | null = null
function measure() {
  const el = rootRef.value, parent = el?.parentElement
  if (!el || !parent) return
  own.w = el.offsetWidth || own.w
  own.h = el.offsetHeight || own.h
  host.w = parent.clientWidth || host.w
  host.h = parent.clientHeight || host.h
}
onMounted(() => {
  const el = rootRef.value, parent = el?.parentElement
  if (!el || !parent) return
  measure()
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(measure)
    ro.observe(el)
    ro.observe(parent)
  }
  // 别的悬浮块（圆钮可以拖走，小地图 / 工具条会随窗口变）：隔一会儿量一次，变了才更新
  stopRects = watchRects(() => rootRef.value?.parentElement, '.qf, .vue-flow__minimap, .ed-tools, .ed-title, .ed-hint, .ed-undo, .clb', (r) => { fixed.value = r })
  document.addEventListener('mousedown', onDocDown, true)
})
onBeforeUnmount(() => {
  ro?.disconnect(); ro = null
  stopRects?.(); stopRects = null
  document.removeEventListener('mousedown', onDocDown, true)
  if (leaveTimer !== null) clearTimeout(leaveTimer)
})

/* ── 对齐菜单 ── */
const alignOpen = ref(false)
const alignBtn = ref<HTMLButtonElement | null>(null)
const popRef = ref<HTMLElement | null>(null)
const popLeft = ref(0)
/** 工具条在选区上方时菜单朝上开（顶上放不下就朝下）；在下方时朝下开 */
const popUp = computed(() => (phone.value ? false : shown.value.side === 'above' ? shown.value.y >= 56 : shown.value.y + own.h + 56 > host.h))
function placePop() {
  const bar = rootRef.value, btn = alignBtn.value, pop = popRef.value
  if (!bar || !btn || !pop) return
  popLeft.value = Math.max(0, Math.min(btn.offsetLeft - 6, bar.offsetWidth - pop.offsetWidth))
}
function toggleAlign(focusFirst = false) {
  alignOpen.value = !alignOpen.value
  if (!alignOpen.value) return
  void nextTick(() => {
    placePop()
    if (focusFirst) popRef.value?.querySelector<HTMLElement>('button')?.focus()
  })
}
function closeAlign(refocus = false) {
  if (!alignOpen.value) return
  alignOpen.value = false
  if (refocus) alignBtn.value?.focus()
}
function onDocDown(e: MouseEvent) {
  if (alignOpen.value && !rootRef.value?.contains(e.target as Node)) closeAlign()
}
watch(() => props.count, () => closeAlign())

/**
 * 对齐的动画还没走完（busy）时不接新的动作。不用 disabled：按钮一禁用焦点就掉到 body 上，
 * 键盘用户刚按完回车就丢了位置 —— 按钮留着、可聚焦，只是这一下不触发。
 */
function act(fn: () => void) {
  if (props.busy) return
  fn()
}

/** 没有可运行的 / 正在跑 / 被每月上限拦着：按钮保持可聚焦（提示里写着原因），只是不触发 */
const runOff = computed(() => !props.runnable || !!props.running || !!props.blocked)
const runTip = computed(() => (!props.runnable ? t('canvas.sel.runNone') : props.blocked || t('canvas.sel.runTip', { n: props.runnable })))
function onRun() {
  if (runOff.value) return
  emit('run')
}

/* ── 键盘：Tab 只停一次，← → 在按钮之间走 ── */
const barButtons = () => Array.from(rootRef.value?.querySelectorAll<HTMLButtonElement>('[data-st]') || [])
const popButtons = () => Array.from(popRef.value?.querySelectorAll<HTMLButtonElement>('button') || [])
function syncTabStops(cur?: HTMLElement | null) {
  const list = barButtons()
  const keep = cur && list.includes(cur as HTMLButtonElement) ? cur : list.find((b) => b.tabIndex === 0) || list[0]
  for (const b of list) b.tabIndex = b === keep ? 0 : -1
}
function onFocusIn(e: FocusEvent) {
  const el = e.target as HTMLElement
  if (el.hasAttribute('data-st')) syncTabStops(el)
}
function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  const inPop = !!target.closest('.st-pop')
  if (e.key === 'Escape') {
    if (!alignOpen.value) return
    e.preventDefault(); e.stopPropagation()
    closeAlign(true)
    return
  }
  // 「对齐」上按 ↓ / Enter / 空格：打开并把焦点放进菜单
  if (target === alignBtn.value && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault(); e.stopPropagation()
    if (alignOpen.value) popButtons()[0]?.focus()
    else toggleAlign(true)
    return
  }
  const prev = e.key === 'ArrowLeft', next = e.key === 'ArrowRight'
  if (!prev && !next && e.key !== 'Home' && e.key !== 'End') {
    // 回车 / 空格是按钮自己的；别让它们漏到画布的快捷键上去
    if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
    return
  }
  const list = inPop ? popButtons() : barButtons()
  if (!list.length) return
  e.preventDefault(); e.stopPropagation()
  const i = list.indexOf(target as HTMLButtonElement)
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (next ? 1 : -1) + list.length) % list.length
  list[to].focus()
}
onMounted(() => syncTabStops())
watch(() => props.ungroup, () => { void nextTick(() => syncTabStops()) }, { flush: 'post' })

defineExpose({ focus: () => { (barButtons().find((b) => b.tabIndex === 0) || barButtons()[0])?.focus() } })
</script>

<style scoped>
/* 和设计稿里的 .selbar 是同一条：40 高的一块玻璃，左边一句话，中间文字钮，右边一颗主按钮 */
.st {
  position: absolute; left: 0; top: 0; z-index: 7;
  display: inline-flex; align-items: center; gap: 4px; height: 40px; padding: 0 6px 0 16px;
  border-radius: 12px; border: 1px solid var(--line-2);
  background: rgb(var(--c-glass) / .92); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  box-shadow: var(--sh-1); color: var(--text); font-size: 12px; white-space: nowrap;
  max-width: calc(100% - 16px); will-change: transform;
  animation: st-in .16s ease-out;
}
/* 平移 / 缩放画布时要跟手，不加过渡；只在换边（上 ↔ 下）这种跳变时也不值得滑 —— 所以只做淡入 */
@keyframes st-in { from { opacity: 0; } to { opacity: 1; } }
.st-n { margin-right: 8px; font-variant-numeric: tabular-nums; }
.st-lk {
  display: inline-flex; align-items: center; gap: 2px; height: 28px; padding: 0 8px; flex: none;
  border: 0; border-radius: 8px; background: none; color: var(--text-2); font-size: 12px; cursor: pointer;
  transition: background .12s, color .12s;
}
.st-lk .lc-ic { width: 12px; height: 12px; color: var(--text-3); transition: transform .15s; }
.st-lk.on .lc-ic { transform: rotate(180deg); }
.st-lk:hover, .st-lk.on { background: rgb(var(--c-film) / .12); color: var(--text); }
.st [aria-disabled='true']:not(.st-run) { opacity: .45; cursor: not-allowed; }
.st-lk:focus-visible, .st-pop .lc-tb:focus-visible { outline: none; box-shadow: var(--ring); }
.st-run { margin-left: 6px; flex: none; }
.st-run .lc-ic { width: 12px; height: 12px; fill: currentColor; }
.st-run.off { opacity: .5; cursor: not-allowed; }
/* 删除：和前面的动作隔一道线，悬停才变成警示色 —— 平时不抢「运行所选」的眼 */
.st-sep { width: 1px; height: 18px; margin: 0 2px 0 6px; background: var(--line-2); flex: none; }
.st-del { flex: none; color: var(--text-3); }
.st-del:hover { background: var(--danger-dim); color: var(--err-soft); }
.st-del:focus-visible { outline: none; box-shadow: var(--ring); }

.st-pop {
  position: absolute; z-index: 1; display: flex; align-items: center; gap: 2px; padding: 4px; overflow: visible;
}
.st-pop.up { bottom: calc(100% + 8px); }
.st-pop.down { top: calc(100% + 8px); }
.st-pop hr { width: 1px; height: 18px; margin: 0 3px; border: 0; background: var(--line-2); flex: none; }
.st-pop .lc-tb.off { opacity: .4; cursor: not-allowed; }

/* 手机宽度：固定在工具面板那一横条下面，居中；不跟着选区走（屏幕太窄，跟着走会挡住正在看的节点） */
/* 窄编辑区：固定排在顶上那几排（标题块、手机上工具面板的一横条、只读提示条……）下面。它们到哪儿为止由画布量好放在
   --ed-top 里（以前写死 108px）。能拖动的工具面板横着停在顶边时，再让到它下面（见 phoneStyle） */
.st.phone {
  left: 50%; top: calc(var(--ed-top, 102px) + 6px); transform: translateX(-50%); padding: 0 6px 0 12px; gap: 2px;
  max-width: calc(100% - 16px);
}
.st.phone .st-n { margin-right: 4px; }
.st.phone .st-lk { padding: 0 6px; }
@media (prefers-reduced-motion: reduce) {
  .st { animation: none; }
}
</style>
