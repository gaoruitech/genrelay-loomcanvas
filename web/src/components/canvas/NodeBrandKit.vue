<template>
  <!-- 表头上的标记：这个节点这次运行套不套品牌包、套哪个、起不起作用，一眼看得出；点开能看会加什么、能改 -->
  <!-- 品牌包整个关着（features.brandKit）时连隐藏的按钮都不留：v-if；其余「这一刻不该露面」的情况是 v-show（位置留着，表头不跳） -->
  <span v-if="mark && feat.brandKit" v-show="showMark" ref="rootEl" class="cv-kit-mk">
    <button
      ref="btnEl"
      type="button"
      class="cv-kit-mark nodrag"
      :class="[`s-${state}`, { open }]"
      v-tip="open ? '' : markTip"
      :aria-label="markTip"
      aria-haspopup="dialog"
      :aria-expanded="open"
      data-testid="kit-mark"
      :data-state="state"
      @click.stop="toggle"
      @mousedown.stop
      @dblclick.stop
    ><LcIcon name="star" size="s" /></button>

    <Teleport :to="$lcPortal">
      <!-- 键盘和焦点归 v-dialog（modal: false，不挡画布）：打开时焦点进面板（落在当前选中的那一项上），Tab 在里面转，
           关掉后焦点回到标记上。面板挂在页面末尾，不接管的话键盘打得开、却走不到里面的选项 -->
      <div
        v-if="open"
        ref="popEl"
        v-dialog="{ onEscape: closeAndRefocus, modal: false, fallbackFocus: () => btnEl }"
        class="lc-menu cv-kit-pop nodrag nowheel"
        :style="menuStyle"
        role="dialog"
        :aria-label="t('brandKit.node.popTitle')"
        data-testid="kit-pop"
        @mousedown.stop
        @wheel.stop
        @keydown.esc.stop="closeAndRefocus"
      >
        <div class="cv-kit-pop-h">{{ t('brandKit.node.popTitle') }}</div>
        <p class="cv-kit-pop-s" :class="{ warn: weak }" data-testid="kit-pop-status">{{ lineText }}</p>
        <p v-if="skippedText" class="cv-kit-note" data-testid="kit-note"><LcIcon name="warn" size="s" /><span>{{ skippedText }}</span></p>

        <!-- 只读：能看这次会套哪个、会加什么；换不了，所以这组选项不出现（不是摆着点不动） -->
        <template v-if="!readOnly">
          <div class="cv-kit-pop-k">{{ t('brandKit.node.popChoose') }}</div>
          <div class="cv-kit-opts" role="radiogroup" :aria-label="t('brandKit.node.popChoose')" @keydown="onOptsKey">
            <button
              v-for="o in options" :key="o.value"
              type="button" role="radio" class="lc-menu-item cv-kit-opt" :class="{ active: o.value === override }"
              :aria-checked="o.value === override" :data-value="o.value || 'follow'"
              :data-autofocus="o.value === override ? '' : undefined"
              @click.stop="override = o.value"
            ><i aria-hidden="true" /><span>{{ o.label }}</span></button>
          </div>
        </template>

        <BrandKitEffectPreview v-if="shown && !hollow" :effect="shown.effect" />
      </div>
    </Teleport>
  </span>

  <!-- 改提示词的地方的一行：这次运行套用哪个品牌包、会加什么、这个节点要不要例外 -->
  <div v-else-if="showLine" class="cv-kit" data-testid="kit-line" :data-state="state">
    <div class="cv-kit-row">
      <button v-if="shown" type="button" class="cv-kit-t on" :aria-expanded="lineOpen" data-testid="kit-applied" @click.stop="lineOpen = !lineOpen">
        <BrandKitThumbs :images="shown.kit.refImages" />
        <span class="cv-kit-name">{{ lineText }}</span>
        <span class="cv-kit-more">{{ lineOpen ? t('brandKit.node.hide') : t('brandKit.node.show') }}</span>
      </button>
      <span v-else class="cv-kit-t">{{ lineText }}</span>
      <ChipSelect v-if="!readOnly" :label="t('brandKit.node.scope')" v-model="override" :options="options" :display-value="overrideLabel" :title="t('brandKit.node.menuTitle')" />
    </div>

    <!-- 参考图发不出去：不用点开就看得到，不能让人以为它们也跟着发了 -->
    <p v-if="skippedText && !lineOpen" class="cv-kit-note" data-testid="kit-note"><LcIcon name="warn" size="s" /><span>{{ skippedText }}</span></p>

    <BrandKitEffectPreview v-if="lineOpen && shown" :effect="shown.effect" :skipped="skippedText" />
  </div>
</template>

<script setup lang="ts">
/**
 * 生成节点上跟品牌包有关的两样东西：
 *  - mark：表头上的小标记。这次运行会套品牌包、或者这个节点有例外时出现（三种布局都有，不占高度）；
 *    悬停读得出是哪个品牌包、参考图发不发得出去，点开是一个小面板：会加什么、这个节点要不要例外。
 *    布局 c 没有别的地方放品牌包那一行（放在节点里会让节点选中后变高、连线跟着跳），所以那里只要
 *    账号有品牌包，就留着一个入口（entry）；没有品牌包要套用时它平时不露面，指针移到节点上或选中节点时才出现。
 *  - 默认：改提示词的地方（布局 a 的输入条 / b 的属性面板，见 gen/GenNotes.vue）的一行，写明这次运行套用哪个
 *    品牌包，点开能看到会原样加上的文字和参考图，右边可以让这个节点例外。
 *
 * 「会加什么」直接问执行器（executor.brandKitEffect），那是提交时用的同一份推导，不是另算的一份。
 * 「选了」和「起作用」分开说（kitRunState）：首尾帧模式、不接收参考图的模型下参考图发不出去，照实写出来。
 */
import { computed, inject, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import ChipSelect from '@/components/canvas/ChipSelect.vue'
import BrandKitThumbs from '@/components/brandkit/BrandKitThumbs.vue'
import BrandKitEffectPreview from '@/components/brandkit/BrandKitEffectPreview.vue'
import { CANVAS_BRAND_KIT_KEY } from '@/composables/canvasBrandKitKey'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { useFloatingMenu } from '@/composables/useFloatingMenu'
import { KIT_NONE, kitRunState } from '@/composables/useBrandKits'
import { getAdapter } from '@/utils/canvasModels'
import { useEmbed } from '@/embed/context'
import { vDialog } from '@/directives/dialog'

const { t } = useI18n()

const props = defineProps<{
  nodeId: string
  data: any
  mark?: boolean
  /** mark：没有品牌包要套用时也留着标记（弱化），作为给这个节点单独选一个的入口 */
  entry?: boolean
  /** 只读（别人正在编辑、只有查看权）：看得到套的是哪个、会加什么，换不了 */
  readOnly?: boolean
}>()

// 品牌包整个关着（features.brandKit）：这里什么都不画 —— 标记、那一行、入口都没有
const feat = useEmbed().features
const ctx = inject(CANVAS_BRAND_KIT_KEY, undefined)
const executor = inject(CANVAS_EXECUTOR_KEY, undefined)

const kits = computed(() => ctx?.list.value || [])
const choice = computed(() => ctx?.resolve(props.data) || { kit: null, own: false, missing: false })

/** 现在运行的话会套用的品牌包，以及它会加什么 */
const shown = computed(() => (choice.value.kit ? executor?.brandKitEffect(props.nodeId) || null : null))
const state = computed(() => kitRunState(choice.value, shown.value?.effect))
/** 选了，但这次什么都加不上 */
const hollow = computed(() => state.value === 'noEffect' || state.value === 'empty')
/** 选了，但没有完全起作用 */
const weak = computed(() => hollow.value || state.value === 'textOnly' || state.value === 'partial')

/** 一个品牌包都没有、节点也没有例外：整行不出现，面板保持原样 */
// 只读时那一行只在真有东西可说的时候出（套了某个、或者这个节点有例外）：光有「可以选」不算
const showLine = computed(() => feat.brandKit && !props.mark && !!ctx && (props.readOnly ? state.value !== 'none' : kits.value.length > 0 || choice.value.own))
const showMark = computed(() => feat.brandKit && !!props.mark && !!ctx && (state.value !== 'none' || (!props.readOnly && !!props.entry && kits.value.length > 0)))
const lineOpen = ref(false)

/** 「N 张参考图不会发出：原因」；没有被跳过的图就是空串 */
const skippedText = computed(() => {
  const e = shown.value?.effect
  const n = e?.skippedImages.length || 0
  if (!e || !n) return ''
  const a = getAdapter(props.data?.model || '')
  const model = a?.label || t('brandKit.preview.thisModel')
  if (e.skipReason === 'frames') return t('brandKit.preview.skippedFrames', { n }, n)
  if (e.skipReason === 'noRefs') return t('brandKit.preview.skippedNoRefs', { n, model }, n)
  const max = a?.options.maxReferenceImages || 0
  return e.addedImages.length
    ? t('brandKit.preview.skippedFull', { n, model, max })
    : t('brandKit.preview.skippedFullAll', { n, model, max }, n)
})

/** 那一行（和小面板最上面）的一句话 */
const lineText = computed(() => {
  const name = choice.value.kit?.name || ''
  const own = choice.value.own
  switch (state.value) {
    case 'missing': return t('brandKit.node.missingLine')
    case 'off': return t('brandKit.node.offLine')
    case 'none': return t('brandKit.node.notApplied')
    case 'noEffect': return t('brandKit.node.noEffect', { name })
    case 'empty': return t('brandKit.node.emptyKit', { name })
    case 'textOnly': return own ? t('brandKit.node.appliedOwnTextOnly', { name }) : t('brandKit.node.appliedTextOnly', { name })
    default: return own ? t('brandKit.node.appliedOwn', { name }) : t('brandKit.node.applied', { name })
  }
})

/** 标记的悬停提示，同时是它的无障碍名字 */
const markTip = computed(() => {
  const name = choice.value.kit?.name || ''
  switch (state.value) {
    case 'missing': return t('brandKit.node.markMissing')
    case 'off': return t('brandKit.node.markOff')
    case 'none': return t('brandKit.node.tipNone')
    case 'empty': return t('brandKit.node.tipEmpty', { name })
    case 'noEffect': return `${t('brandKit.node.tipNoEffect', { name })} · ${skippedText.value}`
    default: {
      const base = choice.value.own ? t('brandKit.node.markKit', { name }) : t('brandKit.node.tipKit', { name })
      return skippedText.value ? `${base} · ${skippedText.value}` : base
    }
  }
})

/* ── 这个节点的例外 ── */
const canvasKit = computed(() => kits.value.find((k) => k.id === ctx?.canvasKitId.value) || null)
const override = computed<string>({
  get: () => (typeof props.data?.brandKitOverride === 'string' ? props.data.brandKitOverride : ''),
  set: (v) => { if (!props.readOnly && v !== override.value) ctx?.setNodeOverride(props.nodeId, v) },
})
const options = computed(() => [
  { value: '', label: canvasKit.value ? t('brandKit.node.followWith', { name: canvasKit.value.name }) : t('brandKit.node.followNone') },
  { value: KIT_NONE, label: t('brandKit.node.off') },
  ...kits.value.map((k) => ({ value: k.id, label: t('brandKit.node.useKit', { name: k.name }) })),
])
const overrideLabel = computed(() => {
  if (!override.value) return t('brandKit.node.follow')
  if (override.value === KIT_NONE) return t('brandKit.pop.none')
  return choice.value.kit?.name || t('brandKit.pop.none')
})

/* ── 标记点开的小面板：和节点上别的下拉共用一套弹层逻辑（同一时刻只开一个、点外面关、跟着按钮走） ── */
const rootEl = ref<HTMLElement | null>(null)
const btnEl = ref<HTMLElement | null>(null)
const popEl = ref<HTMLElement | null>(null)
const { open, menuStyle, toggle, close } = useFloatingMenu({ trigger: btnEl, menu: popEl, root: rootEl, fitHeight: true })
function closeAndRefocus() { close(); btnEl.value?.focus() }
/** 那一组单选：↑ ↓ 在选项之间走（Home / End 到头尾），回车 / 空格选中是按钮自己的 */
function onOptsKey(e: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const list = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="radio"]'))
  if (!list.length) return
  e.preventDefault(); e.stopPropagation()
  const i = list.indexOf(document.activeElement as HTMLElement)
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
  list[to].focus()
}
</script>

<style scoped>
/* ── 表头标记 ── */
.cv-kit-mk { flex: none; display: inline-flex; }
.cv-kit-mark {
  position: relative; flex: none; width: 20px; height: 20px; display: grid; place-items: center; padding: 0;
  border: 0; border-radius: 6px; color: var(--cyan-soft); background: rgb(var(--c-cyan) / .14); cursor: pointer;
  transition: background .15s ease, color .15s ease, box-shadow .15s ease;
}
.cv-kit-mark :deep(svg) { width: 12px; height: 12px; }
.cv-kit-mark:hover { background: rgb(var(--c-cyan) / .24); }
.cv-kit-mark.open { box-shadow: 0 0 0 1px var(--cyan) inset; }
.cv-kit-mark:focus-visible { outline: none; box-shadow: var(--ring); }
/* 没有品牌包要套用（只是个入口，布局 c）：平时不露面 —— 画布上没有品牌包时，每个节点都挂一颗星只是噪音。
   指针移到这个节点上、选中它、键盘聚焦到它、或者它的面板开着时才出现；位置一直留着，出现时表头不会跟着动。
   真有品牌包要套用、或者节点有例外时，标记是别的状态（见下），一直都在 */
/* 看不见的时候也不接指针：触屏上没有悬停，点表头那一下不该正好点开一颗看不见的按钮 —— 第一下选中节点（标记这才出现），
   第二下才是点它。键盘不受影响（Tab 照样停得上来，一停上来它就显出来） */
.cv-kit-mark.s-none { color: var(--text-3); background: none; opacity: 0; pointer-events: none; transition: opacity .15s ease, background .15s ease, color .15s ease; }
.gn:hover .cv-kit-mark.s-none, .gn.selected .cv-kit-mark.s-none, .cv-kit-mark.s-none:focus-visible, .cv-kit-mark.s-none.open { opacity: 1; pointer-events: auto; }
.cv-kit-mark.s-none:hover { color: var(--text); background: rgb(var(--c-film) / .12); }
/* 这个节点不套用 / 单独选的那个被删了：灰，划一道斜线。星形退到后面、斜线压在最上面 ——
   两样一样重的话，这么小的一块里只剩一团看不清的线 */
.cv-kit-mark.s-off, .cv-kit-mark.s-missing { color: var(--text-2); background: rgb(var(--c-film) / .1); }
.cv-kit-mark.s-off:hover, .cv-kit-mark.s-missing:hover { color: var(--text); background: rgb(var(--c-film) / .18); }
.cv-kit-mark.s-off :deep(svg), .cv-kit-mark.s-missing :deep(svg) { opacity: .45; }
.cv-kit-mark.s-off::after, .cv-kit-mark.s-missing::after {
  content: ''; position: absolute; left: 2px; right: 2px; top: 50%; height: 1.5px; margin-top: -.75px; border-radius: 1px;
  background: currentColor; transform: rotate(-45deg);
}
/* 选了但参考图没全发出去：右上角一个提醒色的小点 */
.cv-kit-mark.s-textOnly::after, .cv-kit-mark.s-partial::after {
  content: ''; position: absolute; top: -2px; right: -2px; width: 7px; height: 7px; border-radius: 50%;
  background: var(--warn); box-shadow: 0 0 0 1.5px var(--panel-solid);
}
/* 选了但这次什么都加不上：整颗换成提醒色 */
.cv-kit-mark.s-noEffect, .cv-kit-mark.s-empty { color: var(--warn); background: rgb(var(--c-warn) / .16); }
.cv-kit-mark.s-noEffect:hover, .cv-kit-mark.s-empty:hover { background: rgb(var(--c-warn) / .26); }

/* ── 标记点开的小面板 ── */
.cv-kit-pop { width: 300px; max-width: calc(calc(100 * var(--lc-vw)) - 16px); padding: 12px; display: grid; gap: 8px; overflow-y: auto; }
.cv-kit-pop-h { font-size: 13px; font-weight: 600; color: var(--text); }
.cv-kit-pop-s { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-2); overflow-wrap: anywhere; }
.cv-kit-pop-s.warn { color: var(--text); }
.cv-kit-pop-k { margin-top: 2px; font-size: 11px; color: var(--text-3); }
.cv-kit-opts { display: grid; gap: 2px; }
.cv-kit-opt { width: 100%; gap: 8px; border: 0; background: none; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.cv-kit-opt span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cv-kit-opt i { flex: none; width: 14px; height: 14px; border-radius: 50%; border: 1.5px solid var(--line-3); }
.cv-kit-opt.active i { border-color: var(--cyan); background: radial-gradient(circle, var(--cyan) 0 3.5px, transparent 4px); }
.cv-kit-opt:focus-visible { outline: none; box-shadow: var(--ring); }

/* ── 改提示词处的那一行 ── */
.cv-kit { display: grid; gap: 8px; min-width: 0; }
/* 放不下时「此节点」那颗下拉换到下一行，名字不被挤没 */
.cv-kit-row { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; min-width: 0; min-height: 24px; }
.cv-kit-t {
  flex: 1 1 220px; min-width: 0; display: inline-flex; align-items: center; gap: 6px; padding: 0;
  border: 0; background: none; color: var(--text-3); font: inherit; font-size: 12px; text-align: left;
}
button.cv-kit-t { cursor: pointer; color: var(--text-2); }
.cv-kit-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
.cv-kit-more { flex: none; color: var(--cyan-soft); font-size: 11px; white-space: nowrap; }
button.cv-kit-t:hover .cv-kit-more { text-decoration: underline; text-underline-offset: 3px; }
button.cv-kit-t:focus-visible { outline: none; box-shadow: var(--ring); border-radius: 6px; }
.cv-kit-note { display: flex; gap: 6px; margin: 0; font-size: 11px; line-height: 1.6; color: var(--alert-warn-fg); overflow-wrap: anywhere; }
.cv-kit-note :deep(svg) { flex: none; width: 13px; height: 13px; margin-top: 2px; color: var(--warn); }
</style>
