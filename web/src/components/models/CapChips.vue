<template>
  <!-- 模型表「能力」一格：标签只占一行。放不下的收进末尾的「+N」，点它（或者键盘聚焦后回车 / 空格、手机上点一下）弹出剩下的。
       这样每一行都一样高；以前标签折行，行高跟着标签个数变。 -->
  <div ref="root" class="cc">
    <span
      v-for="(c, i) in head" :key="i" class="lc-chip" :class="{ o: c.outline, last: i === head.length - 1 && rest.length > 0 }"
    >{{ c.text }}</span>
    <button
      v-if="rest.length"
      ref="btn"
      type="button"
      class="lc-chip cc-more"
      :class="{ on: open }"
      :aria-expanded="open"
      :aria-controls="open ? popId : undefined"
      :aria-label="t('modelsPage.caps.more', { n: rest.length, list: rest.map(c => c.text).join(t('modelsPage.caps.sep')) })"
      data-act="caps-more"
      @click.stop="toggle"
      @keydown.esc="onEsc"
      @blur="onBlur"
    >+{{ rest.length }}</button>

    <!-- 量宽度用的影子：所有标签加一个「+N」，不可见、不占位 -->
    <div ref="ghost" class="cc-ghost" aria-hidden="true">
      <span v-for="(c, i) in chips" :key="i" class="lc-chip" :class="{ o: c.outline }">{{ c.text }}</span>
      <span class="lc-chip cc-more">+{{ chips.length }}</span>
    </div>

    <Teleport :to="$lcPortal">
      <div v-if="open" :id="popId" ref="pop" class="lc-menu cc-pop" role="group" :aria-label="t('modelsPage.caps.rest', { n: rest.length })" :style="menuStyle">
        <span class="cc-pop-h">{{ t('modelsPage.caps.rest', { n: rest.length }) }}</span>
        <span v-for="(c, i) in rest" :key="i" class="lc-chip" :class="{ o: c.outline }">{{ c.text }}</span>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFloatingMenu } from '@/composables/useFloatingMenu'
import { fitCount } from '@/components/models/modelMeta'

export interface CapChip { text: string; outline?: boolean }

const props = defineProps<{ chips: CapChip[] }>()
const { t } = useI18n()

const GAP = 6
const root = ref<HTMLElement | null>(null)
const btn = ref<HTMLButtonElement | null>(null)
const ghost = ref<HTMLElement | null>(null)
const pop = ref<HTMLElement | null>(null)
const popId = 'cc-' + Math.random().toString(36).slice(2, 8)

/** 这一行放得下前几个；量出来之前先全放（容器自己会裁掉多出来的） */
const shown = ref(props.chips.length)
const head = computed(() => props.chips.slice(0, shown.value))
const rest = computed(() => props.chips.slice(shown.value))

function fit() {
  const el = root.value
  const g = ghost.value
  if (!el || !g) return
  const kids = Array.from(g.children) as HTMLElement[]
  const widths = kids.slice(0, props.chips.length).map(k => k.getBoundingClientRect().width)
  const more = kids[props.chips.length]?.getBoundingClientRect().width || 0
  // 容器左右各有 3px 的内边距（给焦点圈留的），不算在可用宽度里
  const n = fitCount(widths, el.clientWidth - 6, GAP, more)
  if (n !== shown.value) shown.value = n
  if (n >= props.chips.length) close()
}

const { open, menuStyle, toggle, close } = useFloatingMenu({ trigger: btn, menu: pop, root, gap: 6, closeOnScroll: true })

function onEsc(e: KeyboardEvent) {
  if (!open.value) return
  e.stopPropagation()
  e.preventDefault()
  close()
}
/** 焦点离开按钮就收起（浮层里没有可聚焦的东西，Tab 是往下一个控件去了） */
function onBlur() { close() }

let ro: ResizeObserver | null = null
watch(() => props.chips, () => { shown.value = props.chips.length; void nextTick(fit) }, { deep: true })
onMounted(() => {
  fit()
  if (root.value && typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(fit)
    ro.observe(root.value)
  }
  // 字体到了之后宽度会变
  void document.fonts?.ready.then(fit).catch(() => undefined)
})
onBeforeUnmount(() => ro?.disconnect())
</script>

<style scoped>
.cc { position: relative; display: flex; flex-wrap: nowrap; align-items: center; gap: 6px; min-width: 0; flex: 1 1 0; overflow: hidden; padding: 3px; margin: -3px; }
.cc > .lc-chip { flex: none; }
/* 最后一个露出来的标签可以被压短（连一个都放不下的极窄情况），压短时用省略号 */
/* 只说标签（span）：「+N」是这一格里唯一的 button，不写 span 的话 :only-of-type 会把它也算进来，跟着被压扁 */
.cc > span.lc-chip.last, .cc > span.lc-chip:only-of-type { display: block; flex: 0 1 auto; min-width: 0; line-height: 22px; overflow: hidden; text-overflow: ellipsis; }
.cc-more {
  border: 0; cursor: pointer; font: inherit; font-size: 12px; line-height: 1; color: var(--cyan-soft);
  background: rgb(var(--c-cyan) / .12); font-variant-numeric: tabular-nums;
}
.cc-more:hover, .cc-more.on { background: rgb(var(--c-cyan) / .22); color: var(--text); }
.cc-more:focus-visible { outline: none; box-shadow: var(--ring); }
.cc-ghost { position: absolute; left: 0; top: 0; height: 0; overflow: hidden; visibility: hidden; display: flex; gap: 6px; white-space: nowrap; pointer-events: none; }
.cc-ghost > .lc-chip { flex: none; }
.cc-pop { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px 12px; max-width: min(280px, calc(calc(100 * var(--lc-vw)) - 16px)); }
.cc-pop-h { flex: 1 1 100%; font-size: 12px; line-height: 1.4; color: var(--text-3); }
/* 手指要点得中：「+N」自己长大（这一格 overflow: hidden，往外扩的隐形热区会被裁掉，只能让按钮本身够大）。
   量宽度用的那个影子同样是 .cc-more，所以「放得下几个」的计算跟着变 */
@media (pointer: coarse) {
  .cc-more { min-width: 44px; height: 32px; justify-content: center; border-radius: 8px; font-size: 13px; }
}
</style>
