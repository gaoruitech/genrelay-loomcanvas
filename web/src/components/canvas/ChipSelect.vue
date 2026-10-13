<template>
  <div ref="root" class="chip-select" :class="{ open, field }">
    <button
      ref="btn"
      class="chip nodrag"
      type="button"
      v-tip="open ? '' : title"
      :aria-haspopup="$slots.menu ? 'dialog' : 'listbox'"
      :aria-expanded="open"
      :aria-activedescendant="open && hi >= 0 ? `${uid}-o${hi}` : undefined"
      @click.stop="toggle"
      @mousedown.stop
      @keydown="onKey"
    >
      <span v-if="badge" class="lc-bd chip-badge" :class="badgeKind">{{ badge }}</span>
      <span v-else-if="label" class="chip-leading">{{ label }}</span>
      <span class="chip-value">{{ shownValue }}</span>
      <svg class="chip-chevron" :class="{ rotated: open }" viewBox="0 0 12 12">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <!-- Teleport 到 body 上、用 fixed 定位 —— 避免被其他 vue-flow 节点的堆叠上下文盖住 -->
    <Teleport :to="$lcPortal">
      <div
        v-if="open"
        ref="menuEl"
        class="lc-menu chip-menu nodrag nowheel"
        :style="menuStyle"
        :role="$slots.menu ? 'dialog' : 'listbox'"
        :aria-label="title || label || undefined"
        @mousedown.stop
        @wheel.stop
        @keydown="onMenuKey"
      >
        <slot name="menu" :close="close">
          <div
            v-for="(o, i) in (options || [])"
            :id="`${uid}-o${i}`"
            :key="String(o.value)"
            class="lc-menu-item chip-item"
            role="option"
            :aria-selected="String(o.value) === String(modelValue)"
            :class="{ active: String(o.value) === String(modelValue), rich: !!(o.desc || o.tag || o.icon), hi: i === hi }"
            @click.stop="select(o.value)"
            @mousemove="hi = i"
          >
            <span v-if="o.icon" class="chip-item-icon" v-html="o.icon" />
            <span class="chip-item-main">
              <span class="chip-item-label">{{ o.label }}</span>
              <span v-if="o.desc" class="chip-item-desc">{{ o.desc }}</span>
            </span>
            <span v-if="o.tag" class="chip-item-tag">{{ o.tag }}</span>
            <svg
              v-else-if="o.desc && String(o.value) === String(modelValue)"
              class="chip-item-check"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
              stroke-linecap="round" stroke-linejoin="round"
            ><polyline points="20 6 9 17 4 12" /></svg>
          </div>
        </slot>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, useSlots, watch } from 'vue'
import { useFloatingMenu } from '@/composables/useFloatingMenu'

interface Option {
  value: string | number
  label: string
  desc?: string
  tag?: string
  icon?: string
}

const props = defineProps<{
  modelValue?: string | number
  options?: Option[]
  label?: string
  /** 当使用自定义 menu slot 时，显式传入展示文本 */
  displayValue?: string
  title?: string
  /** 通栏表单样式（节点里的模型选择、工具节点的下拉），默认是小号描边 chip */
  field?: boolean
  /** 通栏样式里放在值前面的类型徽标文字（图片 / 视频 / 对话） */
  badge?: string
  badgeKind?: 'img' | 'vid' | 'chat'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string | number): void
}>()

const root = ref<HTMLDivElement | null>(null)
const btn = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLDivElement | null>(null)

// 定位、互斥展开、点外面关闭：与表单下拉 LcSelect 共用同一套弹层逻辑
const { open, menuStyle, toggle, close } = useFloatingMenu({ trigger: btn, menu: menuEl, root })

const shownValue = computed(() => {
  if (props.displayValue !== undefined) return props.displayValue
  const found = props.options?.find(o => String(o.value) === String(props.modelValue))
  return found ? found.label : String(props.modelValue ?? '')
})

function select(v: string | number) {
  emit('update:modelValue', v)
  close()
}

/* ── 键盘 ──
   以前只有鼠标能用：按钮能用回车打开，可里面的选项是一排不接焦点的 div，键盘走不进去，Esc 也不归它（会直接把
   外面的输入条收掉）。现在：
     选项列表  焦点留在按钮上，↑ ↓ Home End 挑，回车 / 空格选中，Esc 收起（只收这一层）
     自定义弹层（参数那一颗：里面是真的按钮）  ↓ 或 Tab 把焦点送进弹层，在里面 Tab 走到头就收起、焦点回到按钮；Esc 同上 */
const slots = useSlots()
const uid = 'cs' + Math.random().toString(36).slice(2, 8)
const hi = ref(-1)
watch(open, (v) => {
  if (!v) { hi.value = -1; return }
  hi.value = (props.options || []).findIndex(o => String(o.value) === String(props.modelValue))
})
const inner = () => Array.from(menuEl.value?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])
function scrollHi() {
  void nextTick(() => menuEl.value?.querySelector('.chip-item.hi')?.scrollIntoView({ block: 'nearest' }))
}
function onKey(e: KeyboardEvent) {
  if (e.isComposing) return
  if (!open.value) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); toggle() }
    return
  }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
  if (slots.menu) {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      const first = inner()[0]
      if (first) { e.preventDefault(); e.stopPropagation(); first.focus() }
    } else if (e.key === 'Tab') close()
    return
  }
  const list = props.options || []
  if (e.key === 'Tab') { close(); return }
  if (!list.length) return
  const move = (to: number) => { e.preventDefault(); e.stopPropagation(); hi.value = Math.max(0, Math.min(list.length - 1, to)); scrollHi() }
  if (e.key === 'ArrowDown') move(hi.value + 1)
  else if (e.key === 'ArrowUp') move(hi.value < 0 ? list.length - 1 : hi.value - 1)
  else if (e.key === 'Home') move(0)
  else if (e.key === 'End') move(list.length - 1)
  else if ((e.key === 'Enter' || e.key === ' ') && hi.value >= 0) { e.preventDefault(); e.stopPropagation(); select(list[hi.value].value) }
}
/** 焦点在自定义弹层里：Esc 收起并把焦点还给按钮；Tab 走出两头也一样（弹层挂在页面末尾，不拦的话焦点会掉到页面外） */
function onMenuKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); btn.value?.focus(); return }
  if (e.key !== 'Tab') return
  const list = inner()
  const at = list.indexOf(document.activeElement as HTMLElement)
  if ((e.shiftKey && at <= 0) || (!e.shiftKey && at === list.length - 1)) { e.preventDefault(); close(); btn.value?.focus() }
}
</script>

<style scoped>
.chip-select { position: relative; display: inline-block; min-width: 0; }
.chip-select.field { display: block; width: 100%; }

/* 默认：描边小 chip（参数、比例之类） */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  max-width: 220px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: none;
  box-shadow: 0 0 0 1px var(--line-2) inset;
  color: var(--text-2);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: box-shadow .13s ease, color .13s ease, background .13s ease;
}
.chip:hover { box-shadow: 0 0 0 1px var(--line-3) inset; color: var(--text); }
.chip-select.open .chip { box-shadow: 0 0 0 1px var(--cyan) inset; color: var(--text); }

/* 通栏：和 .lc-input.sm 一个样子，前面可以带类型徽标 */
.chip-select.field .chip {
  width: 100%;
  max-width: none;
  height: 32px;
  gap: 8px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--well);
  box-shadow: 0 0 0 1px var(--line-2) inset;
  color: var(--text);
  font-size: 13px;
}
.chip-select.field .chip:hover { box-shadow: 0 0 0 1px var(--line-3) inset; }
.chip-select.field.open .chip { box-shadow: 0 0 0 1px var(--cyan) inset, var(--ring); }
.chip-select.field .chip-value { flex: 1; text-align: left; }
.chip-select.field .chip-chevron { width: 11px; height: 11px; }
.chip-badge { height: 18px; padding: 0 6px; flex: none; }

.chip-leading { color: var(--text-3); font-size: 11px; flex-shrink: 0; }
.chip-value { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; line-height: 1.4; }
.chip-chevron {
  width: 9px;
  height: 9px;
  flex-shrink: 0;
  color: var(--text-3);
  transition: transform .15s ease;
}
.chip-chevron.rotated { transform: rotate(180deg); }

/* Teleport 到 body 后的菜单 —— position/top/left/z-index 都由内联 menuStyle 提供；
   面板与菜单项的基础外观在 base.css 的 .lc-menu / .lc-menu-item，与表单下拉共用 */
.chip-menu { min-width: 150px; max-height: calc(62 * var(--lc-vh)); max-width: calc(calc(100 * var(--lc-vw)) - 16px); }
.chip-item { white-space: nowrap; }
/* 键盘挑到的那一项（焦点留在按钮上，见 onKey）：和鼠标悬停同一个样子 */
.chip-item.hi { background: rgb(var(--c-film) / .12); color: var(--text); }
.chip-item.hi.active { background: rgb(var(--c-cyan) / .18); }

/* 富行：图标 + 标题 + 描述 + 标签（模型下拉） */
.chip-item.rich { gap: 10px; padding: 8px 10px; min-width: 232px; }
.chip-item-icon {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgb(var(--c-film) / .1);
  color: var(--cyan-soft);
}
.chip-item-icon :deep(svg) { width: 17px; height: 17px; }
.chip-item-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.chip-item-label { font-size: 13px; font-weight: 500; color: var(--text); line-height: 1.3; }
.chip-item.active .chip-item-label { color: var(--cyan-soft); }
.chip-item-desc {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip-item-tag {
  flex-shrink: 0;
  align-self: center;
  height: 18px;
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border-radius: 9px;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--text-2);
  background: rgb(var(--c-film) / .12);
}
.chip-item-check { width: 15px; height: 15px; flex-shrink: 0; color: var(--cyan); }
</style>
