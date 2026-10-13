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
      @click="toggle"
      @keydown="onKeydown"
      @blur="onTriggerBlur"
    >
      <!-- 选中的那一项太长被截断时，悬停看全文（列表开着的时候不出，免得盖住选项） -->
      <span v-tip="{ text: selected && !open ? selected.label : '', clipped: true }" class="lcs-value" :class="{ placeholder: !selected }">{{ selected ? selected.label : placeholder }}</span>
      <svg class="lcs-chevron" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <!-- Teleport 到 body：设置页的弹窗有自己的 overflow 与层级，菜单留在里面会被裁掉 -->
    <Teleport :to="$lcPortal">
      <div
        v-if="open"
        :id="listId"
        ref="menuEl"
        class="lc-menu lcs-menu"
        :class="{ sm: size === 'sm' }"
        role="listbox"
        :aria-label="ariaLabel"
        :aria-labelledby="ariaLabelledby"
        :style="[menuStyle, heldHeight ? { minHeight: heldHeight + 'px' } : null]"
        @mousedown.prevent
      >
        <!-- 选项多的下拉（时区）：顶上一个搜索框。焦点在搜索框里，上下键照样在选项之间走 -->
        <div v-if="searchable" class="lcs-search" role="presentation">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input
            ref="searchEl"
            v-model="query"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            :aria-controls="listId"
            :aria-activedescendant="activeIndex >= 0 ? optionId(activeIndex) : undefined"
            :aria-label="searchPlaceholder || t('common.search')"
            :placeholder="searchPlaceholder || t('common.search')"
            data-lc-select-search
            @mousedown.stop
            @keydown="onSearchKeydown"
            @blur="onSearchBlur"
          />
        </div>
        <div v-if="searchable && !shown.length" class="lcs-none" role="status">{{ t('common.noMatch') }}</div>
        <div
          v-for="(o, i) in shown"
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
 *
 * searchable：选项很多时（时区有四百多个）在列表顶上加一个搜索框。展开后焦点进搜索框，边敲边筛
 * （名称、说明、值都算，不分大小写，下划线当空格），上下键 / Home / End / PageUp / PageDown 在筛出来的选项之间走，
 * 回车选中，Esc 收起，收起后焦点回到按钮上。在收起的按钮上直接敲字，会展开并把这个字带进搜索框。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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
  /** 列表顶上带一个搜索框（选项多的时候用） */
  searchable?: boolean
  searchPlaceholder?: string
}>(), { size: 'md', placeholder: '', searchable: false, searchPlaceholder: '' })

const { t } = useI18n()

const emit = defineEmits<{
  (e: 'update:modelValue', v: T): void
  /** 只在值真的变了时触发（对应原生 select 的 change） */
  (e: 'change', v: T): void
}>()

/** 面板最高多高（像素） */
const MENU_MAX = 320

const root = ref<HTMLDivElement | null>(null)
const btn = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLDivElement | null>(null)

const { id: menuId, open, menuStyle, show, close, toggle } = useFloatingMenu({
  trigger: btn, menu: menuEl, root,
  // maxHeight 和下面样式里 .lcs-menu 的 max-height 是同一个数
  gap: 4, matchWidth: true, fitHeight: true, closeOnScroll: true, maxHeight: MENU_MAX,
})
const listId = `${menuId}-list`
const optionId = (i: number) => `${menuId}-opt-${i}`

const selected = computed(() => props.options.find(o => o.value === props.modelValue))

// ---- 搜索（searchable）----
const searchEl = ref<HTMLInputElement | null>(null)
const query = ref('')
const fold = (s: unknown) => String(s ?? '').toLowerCase().replace(/[_\s]+/g, ' ').trim()
/** 列表里现在显示的选项：没开搜索、或者没敲字时就是全部 */
const shown = computed(() => {
  const q = props.searchable ? fold(query.value) : ''
  if (!q) return props.options
  const words = q.split(' ')
  return props.options.filter((o) => {
    const hay = fold(o.label) + ' ' + fold(o.desc) + ' ' + fold(o.value)
    return words.every(w => hay.includes(w))
  })
})
/** 当前值在显示的那一份里排第几 */
const selectedIndex = computed(() => shown.value.findIndex(o => o.value === props.modelValue))

/** 键盘 / 鼠标当前指着的那一项；-1 = 没有 */
const activeIndex = ref(-1)

function enabledIndex(from: number, step: 1 | -1): number {
  for (let i = from; i >= 0 && i < shown.value.length; i += step) {
    if (!shown.value[i].disabled) return i
  }
  return -1
}

function setActive(i: number) {
  if (i < 0) return
  activeIndex.value = i
  nextTick(() => menuEl.value?.querySelector(`#${optionId(i)}`)?.scrollIntoView({ block: 'nearest' }))
}

/** 带搜索的面板展开后定下来的高度（像素）；0 = 不定 */
const heldHeight = ref(0)
/** 展开前在按钮上敲的那个字：展开后带进搜索框 */
let seed = ''
watch(open, (v) => {
  if (!v) {
    activeIndex.value = -1
    query.value = ''
    heldHeight.value = 0
    return
  }
  query.value = seed
  seed = ''
  setActive(selectedIndex.value >= 0 && !selected.value?.disabled ? selectedIndex.value : enabledIndex(0, 1))
  // 两拍：菜单先定位好再给焦点，免得页面跟着滚
  if (props.searchable) {
    void nextTick(() => nextTick(() => {
      // 面板开着的时候高度不变：边敲边筛、选项变少时，面板（和正在敲字的搜索框）不会跟着跳位置
      heldHeight.value = menuEl.value?.offsetHeight || 0
      searchEl.value?.focus({ preventScroll: true })
    }))
  }
})
// 选完之后外面常常会把下拉禁用一小会儿（正在保存）：被禁用的按钮留不住焦点。记下来，恢复可用时把焦点还给它
let refocus = false
watch(() => props.disabled, (v) => {
  if (v) {
    refocus = !!btn.value && document.activeElement === btn.value
    close()
  } else if (refocus) {
    refocus = false
    void nextTick(() => {
      const cur = document.activeElement
      if (!cur || cur === document.body) btn.value?.focus({ preventScroll: true })
    })
  }
}, { flush: 'pre' })
// 筛选变了：指着的那一项多半已经不在原来的位置，回到第一项（没敲字时回到当前值）
watch(query, () => {
  if (!open.value) return
  activeIndex.value = -1
  setActive(!fold(query.value) && selectedIndex.value >= 0 ? selectedIndex.value : enabledIndex(0, 1))
})

/** 收起并把焦点还给按钮（搜索框在 Teleport 出去的菜单里，焦点留在那儿就丢了） */
function closeToTrigger() {
  const hadFocus = !!searchEl.value && document.activeElement === searchEl.value
  close()
  if (hadFocus) btn.value?.focus({ preventScroll: true })
}
function onTriggerBlur(e: FocusEvent) {
  // 焦点是去了自己的搜索框：不算离开
  if (props.searchable && menuEl.value?.contains(e.relatedTarget as Node | null)) return
  close()
}
function onSearchBlur(e: FocusEvent) {
  if (e.relatedTarget === btn.value) return
  close()
}

function pick(i: number) {
  const o = shown.value[i]
  if (!o || o.disabled) return
  closeToTrigger()
  emitPick(o)
}
function emitPick(o?: LcSelectOption<T>) {
  if (!o || o.disabled || o.value === props.modelValue) return
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
  const n = shown.value.length
  const hit = (prefix: string, start: number) => {
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n
      const o = shown.value[i]
      if (!o.disabled && o.label.toLowerCase().startsWith(prefix)) return i
    }
    return -1
  }
  const cur = open.value ? activeIndex.value : props.options.findIndex(o => o.value === props.modelValue)
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
    e.preventDefault()
    // 带搜索的：敲字就是搜（展开，并把这个字带进搜索框）
    if (props.searchable) {
      if (open.value) { query.value += key; searchEl.value?.focus({ preventScroll: true }) }
      else { seed = key; show() }
      return
    }
    const i = typeahead(key)
    if (i < 0) return
    // 没展开时直接改值，与原生 select 一致
    if (open.value) setActive(i)
    else emitPick(props.options[i])
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

  listKey(e)
}

/** 搜索框里的键：字符归输入框，其余和按钮上一样 */
function onSearchKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.ctrlKey || e.metaKey) return
  // Home / End 在有字的搜索框里是挪光标
  if ((e.key === 'Home' || e.key === 'End') && query.value) return
  if (e.key === ' ' || e.key.length === 1) return
  listKey(e)
}

/** 展开着的时候，在选项之间走 / 选中 / 收起 */
function listKey(e: KeyboardEvent) {
  const { key } = e
  const last = shown.value.length - 1
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
      closeToTrigger()
      break
    case 'Tab':
      // 与原生 select 一致：带着当前项离开。焦点先回到按钮，浏览器再从按钮往下（上）走
      if (props.searchable && !fold(query.value)) closeToTrigger()
      else if (activeIndex.value >= 0) pick(activeIndex.value)
      else closeToTrigger()
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
.lcs-menu { max-width: calc(calc(100 * var(--lc-vw)) - 16px); max-height: min(320px, calc(calc(100 * var(--lc-vh)) - 16px)); border-radius: 10px; padding: 4px; }
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
/* 搜索框：粘在列表顶上，列表在它下面滚 */
.lcs-search {
  position: sticky; top: -4px; z-index: 1; display: flex; align-items: center; gap: 8px; margin: -4px -4px 4px; padding: 8px 12px;
  background: var(--pop); border-bottom: 1px solid var(--line-2); border-radius: 10px 10px 0 0;
}
.lcs-search svg { flex: none; width: 14px; height: 14px; color: var(--t-dim); }
.lcs-search input {
  flex: 1; min-width: 0; height: 24px; padding: 0; border: 0; outline: none; background: none; color: var(--text); font: inherit; font-size: 13px;
}
.lcs-search input::placeholder { color: var(--t-dim); opacity: .8; }
.lcs-search:focus-within { border-bottom-color: var(--accent-line); }
.lcs-none { padding: 14px 12px; color: var(--text-3); font-size: 13px; text-align: center; }
</style>
