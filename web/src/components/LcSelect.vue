<template>
  <div ref="root" class="lcs" :class="{ auto: autoWidth, open }">
    <button
      :id="id"
      ref="btn"
      class="lc-input lcs-trigger"
      :class="{ sm: size === 'sm' }"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listId"
      :aria-activedescendant="open && activeIndex >= 0 ? optionId(activeIndex) : undefined"
      :aria-label="ariaLabel"
      :aria-labelledby="ariaLabelledby"
      :disabled="disabled"
      :title="selected ? selected.label : undefined"
      @click="toggle"
      @keydown="onKeydown"
      @blur="close"
    >
      <span class="lcs-value" :class="{ placeholder: !selected }">{{ selected ? selected.label : placeholder }}</span>
      <svg class="lcs-chevron" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <!-- Teleport 到 body：设置页的弹窗有自己的 overflow 与层级，菜单留在里面会被裁掉 -->
    <Teleport to="body">
      <div
        v-if="open"
        :id="listId"
        ref="menuEl"
        class="lc-menu lcs-menu"
        :class="{ sm: size === 'sm' }"
        role="listbox"
        :aria-label="ariaLabel"
        :aria-labelledby="ariaLabelledby"
        :style="menuStyle"
        @mousedown.prevent
      >
        <div
          v-for="(o, i) in options"
          :id="optionId(i)"
          :key="String(o.value)"
          class="lc-menu-item lcs-item"
          :class="{ active: o.value === modelValue, focused: i === activeIndex, disabled: o.disabled }"
          role="option"
          :aria-selected="o.value === modelValue"
          :aria-disabled="o.disabled || undefined"
          @mousemove="!o.disabled && (activeIndex = i)"
          @click="pick(i)"
        >
          <span class="lcs-item-main">
            <span class="lcs-item-label">{{ o.label }}</span>
            <span v-if="o.desc" class="lcs-item-desc">{{ o.desc }}</span>
          </span>
          <svg
            v-if="o.value === modelValue"
            class="lcs-check"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
          ><polyline points="20 6 9 17 4 12" /></svg>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts" generic="T extends string | number">
/**
 * 表单用的下拉选择，替代浏览器原生 <select>。
 *
 * 触发按钮直接套 .lc-input（高度、圆角、边框、聚焦、禁用都跟输入框是同一份样式）；
 * 弹出面板与画布上的 ChipSelect 共用 .lc-menu 外观和 useFloatingMenu 的弹层逻辑。
 * 键盘行为照 WAI-ARIA 的「只读 combobox + listbox」：焦点始终留在按钮上，
 * 当前项用 aria-activedescendant 指出去。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useFloatingMenu } from '@/composables/useFloatingMenu'

export interface LcSelectOption<V extends string | number = string | number> {
  value: V
  label: string
  disabled?: boolean
  /** 列表里显示在名称下面的一行说明 */
  desc?: string
}

const props = withDefaults(defineProps<{
  modelValue?: T
  options: LcSelectOption<T>[]
  placeholder?: string
  disabled?: boolean
  size?: 'md' | 'sm'
  /** 宽度跟着内容走；默认占满所在容器（与 .lc-input 一致） */
  autoWidth?: boolean
  /** 落在按钮上，<label for> 靠它关联 */
  id?: string
  ariaLabel?: string
  ariaLabelledby?: string
}>(), { size: 'md', placeholder: '' })

const emit = defineEmits<{
  (e: 'update:modelValue', v: T): void
  /** 只在值真的变了时触发（对应原生 select 的 change） */
  (e: 'change', v: T): void
}>()

const root = ref<HTMLDivElement | null>(null)
const btn = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLDivElement | null>(null)

const { id: menuId, open, menuStyle, show, close, toggle } = useFloatingMenu({
  trigger: btn, menu: menuEl, root,
  gap: 4, matchWidth: true, fitHeight: true, closeOnScroll: true,
})
const listId = `${menuId}-list`
const optionId = (i: number) => `${menuId}-opt-${i}`

const selectedIndex = computed(() => props.options.findIndex(o => o.value === props.modelValue))
const selected = computed(() => props.options[selectedIndex.value])

/** 键盘 / 鼠标当前指着的那一项；-1 = 没有 */
const activeIndex = ref(-1)

function enabledIndex(from: number, step: 1 | -1): number {
  for (let i = from; i >= 0 && i < props.options.length; i += step) {
    if (!props.options[i].disabled) return i
  }
  return -1
}

function setActive(i: number) {
  if (i < 0) return
  activeIndex.value = i
  nextTick(() => menuEl.value?.querySelector(`#${optionId(i)}`)?.scrollIntoView({ block: 'nearest' }))
}

watch(open, (v) => {
  if (!v) {
    activeIndex.value = -1
    return
  }
  setActive(selectedIndex.value >= 0 && !selected.value?.disabled ? selectedIndex.value : enabledIndex(0, 1))
})
watch(() => props.disabled, (v) => { if (v) close() })

function pick(i: number) {
  const o = props.options[i]
  if (!o || o.disabled) return
  close()
  if (o.value === props.modelValue) return
  emit('update:modelValue', o.value)
  emit('change', o.value)
}

// ---- 按首字母跳转：连续敲的字符拼成前缀，停半秒后重新开始 ----
let typed = ''
let typedAt = 0
function typeahead(ch: string): number {
  const now = Date.now()
  typed = now - typedAt > 500 ? ch : typed + ch
  typedAt = now
  const n = props.options.length
  const hit = (prefix: string, start: number) => {
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n
      const o = props.options[i]
      if (!o.disabled && o.label.toLowerCase().startsWith(prefix)) return i
    }
    return -1
  }
  const cur = open.value ? activeIndex.value : selectedIndex.value
  const prefix = typed.toLowerCase()
  // 反复敲同一个字母：在该字母开头的项之间轮换
  if (prefix.length > 1 && [...prefix].every(c => c === prefix[0])) return hit(prefix[0], cur + 1)
  return hit(prefix, prefix.length > 1 ? Math.max(cur, 0) : cur + 1)
}

function onKeydown(e: KeyboardEvent) {
  if (props.disabled || e.ctrlKey || e.metaKey || e.altKey && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const { key } = e
  const last = props.options.length - 1

  if (key.length === 1 && key !== ' ') {
    const i = typeahead(key)
    e.preventDefault()
    if (i < 0) return
    // 没展开时直接改值，与原生 select 一致
    if (open.value) setActive(i)
    else pick(i)
    return
  }

  if (!open.value) {
    if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
      e.preventDefault()
      show()
      if (key === 'Home') nextTick(() => setActive(enabledIndex(0, 1)))
      if (key === 'End') nextTick(() => setActive(enabledIndex(last, -1)))
    }
    return
  }

  switch (key) {
    case 'ArrowDown':
      e.preventDefault()
      setActive(enabledIndex(activeIndex.value + 1, 1))
      break
    case 'ArrowUp':
      e.preventDefault()
      setActive(enabledIndex(activeIndex.value - 1, -1))
      break
    case 'Home':
    case 'PageUp':
      e.preventDefault()
      setActive(enabledIndex(0, 1))
      break
    case 'End':
    case 'PageDown':
      e.preventDefault()
      setActive(enabledIndex(last, -1))
      break
    case 'Enter':
    case ' ':
      e.preventDefault()
      pick(activeIndex.value)
      break
    case 'Escape':
      // 只关菜单：不能让外层弹窗把这次 Esc 也当成关自己
      e.preventDefault()
      e.stopPropagation()
      close()
      break
    case 'Tab':
      // 与原生 select 一致：带着当前项离开
      pick(activeIndex.value)
      break
  }
}
</script>

<style scoped>
.lcs { position: relative; display: block; width: 100%; min-width: 0; }
.lcs.auto { display: inline-block; width: auto; max-width: 100%; }

.lcs-trigger {
  display: flex; align-items: center; gap: 8px;
  text-align: left; cursor: pointer;
}
.lcs-trigger:hover:not(:disabled) { border-color: var(--n-8); }
.lcs-trigger:focus-visible,
.lcs.open .lcs-trigger { border-color: var(--accent-line); box-shadow: 0 0 0 3px var(--accent-ghost); }
.lcs-value { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lcs-value.placeholder { color: var(--t-dim); opacity: .8; }
.lcs-chevron { flex: none; width: 11px; height: 11px; color: var(--t-dim); transition: transform .15s ease; }
.lcs.open .lcs-chevron { transform: rotate(180deg); }

/* 面板外观来自 base.css 的 .lc-menu；position / top / left / 宽高限制由内联样式给出 */
.lcs-menu { max-width: calc(100vw - 16px); max-height: min(320px, calc(100vh - 16px)); border-radius: 10px; padding: 4px; }
.lcs-item { gap: 10px; font-size: 13px; line-height: 1.4; border-radius: 6px; }
.lcs-menu.sm .lcs-item { font-size: 12px; padding: 6px 8px; }
/* 高亮跟着键盘 / 鼠标当前项走，不用 :hover：两者同时亮着会出现两条高亮 */
.lcs-item:hover { background: transparent; }
.lcs-item.active:hover { background: var(--accent-dim); }
.lcs-item.focused { background: var(--n-6); }
.lcs-item.active.focused { background: var(--accent-line); }
.lcs-item.disabled { opacity: .45; cursor: not-allowed; }
.lcs-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
/* 长名称在列表里折行，不截断：这里是唯一能看全的地方 */
.lcs-item-label { overflow-wrap: anywhere; }
.lcs-item-desc { font-size: 11.5px; color: var(--t-dim); overflow-wrap: anywhere; }
.lcs-check { flex: none; width: 14px; height: 14px; color: var(--accent-text); }
</style>
