<template>
  <div ref="root" class="chip-select" :class="{ open }">
    <button
      ref="btn"
      class="chip nodrag"
      type="button"
      :title="title"
      @click.stop="toggle"
      @mousedown.stop
    >
      <span v-if="label" class="chip-leading">{{ label }}</span>
      <span class="chip-value">{{ shownValue }}</span>
      <svg class="chip-chevron" :class="{ rotated: open }" viewBox="0 0 12 12">
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <!-- Teleport 到 body 上、用 fixed 定位 —— 避免被其他 vue-flow 节点的堆叠上下文盖住 -->
    <Teleport to="body">
      <div
        v-if="open"
        ref="menuEl"
        class="chip-menu nodrag nowheel"
        :style="menuStyle"
        @mousedown.stop
        @wheel.stop
      >
        <slot name="menu" :close="close">
          <div
            v-for="o in (options || [])"
            :key="String(o.value)"
            class="chip-item"
            :class="{ active: String(o.value) === String(modelValue), rich: !!(o.desc || o.tag || o.icon) }"
            @click.stop="select(o.value)"
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
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch, type CSSProperties } from 'vue'

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
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string | number): void
}>()

// 模块级单例：全局只允许一个 chip 同时展开
const ACTIVE_ID = ((): { value: string | null } => {
  const w = window as any
  if (!w.__cvChipActive) w.__cvChipActive = ref<string | null>(null)
  return w.__cvChipActive
})()

let _seq = 0
const myId = `cs-${++_seq}-${Math.random().toString(36).slice(2, 7)}`

const root = ref<HTMLDivElement | null>(null)
const btn = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLDivElement | null>(null)
const open = computed(() => ACTIVE_ID.value === myId)

// 菜单跟随按钮位置（视口坐标系）
const menuPos = ref({ top: 0, left: 0 })
const menuStyle = computed<CSSProperties>(() => ({
  position: 'fixed',
  top: `${menuPos.value.top}px`,
  left: `${menuPos.value.left}px`,
  zIndex: 9999,
}))

function updateMenuPos() {
  const b = btn.value
  if (!b) return
  const rect = b.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const SAFE = 8
  // 默认放在按钮下方
  let top = rect.bottom + 6
  let left = rect.left
  // 菜单已挂载 → 根据实际尺寸做翻转 / 横向收缩，避免出屏被裁
  const menu = menuEl.value
  if (menu) {
    const mh = menu.offsetHeight
    const mw = menu.offsetWidth
    // 下方放不下且上方放得下 → 翻到按钮上方
    if (top + mh > vh - SAFE && rect.top - mh - 6 >= SAFE) {
      top = rect.top - mh - 6
    }
    // 横向溢出右边 → 向左对齐到视口右边
    if (left + mw > vw - SAFE) {
      left = vw - mw - SAFE
    }
    if (left < SAFE) left = SAFE
  }
  menuPos.value = { top, left }
}

watch(open, async (v) => {
  if (!v) return
  updateMenuPos()
  await nextTick()
  updateMenuPos()
})

function onWinChange() {
  if (open.value) updateMenuPos()
}

const shownValue = computed(() => {
  if (props.displayValue !== undefined) return props.displayValue
  const found = props.options?.find(o => String(o.value) === String(props.modelValue))
  return found ? found.label : String(props.modelValue ?? '')
})

function toggle() { ACTIVE_ID.value = open.value ? null : myId }
function close() { if (open.value) ACTIVE_ID.value = null }

function select(v: string | number) {
  emit('update:modelValue', v)
  close()
}

function onDocMousedown(e: MouseEvent) {
  if (!open.value) return
  const t = e.target as Node
  // 菜单已经 Teleport 到 body，单纯判 root.contains 会把"点菜单内部"也算成外面
  if (root.value && root.value.contains(t)) return
  if (menuEl.value && menuEl.value.contains(t)) return
  close()
}

// capture 阶段：先于 Vue Flow 的 pane mousedown 触发，
// 避免被 stopPropagation 屏蔽导致点外面关不上
onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown, true)
  window.addEventListener('scroll', onWinChange, true)
  window.addEventListener('resize', onWinChange)
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown, true)
  window.removeEventListener('scroll', onWinChange, true)
  window.removeEventListener('resize', onWinChange)
  if (open.value) close()
})
</script>

<style scoped>
.chip-select {
  position: relative;
  display: inline-block;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--t-body);
  font-size: 11px;
  font-family: inherit;
  cursor: pointer;
  transition: background 0.13s ease;
  max-width: 220px;
  height: 28px;
  box-sizing: border-box;
}
.chip:hover { background: var(--n-6); }
.chip-select.open .chip { background: var(--n-7); }

.chip-leading {
  color: var(--t-dim);
  font-size: 10px;
  flex-shrink: 0;
}
.chip-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.chip-chevron {
  width: 9px;
  height: 9px;
  opacity: 0.65;
  flex-shrink: 0;
  transition: transform 0.15s ease;
  color: currentColor;
}
.chip-chevron.rotated { transform: rotate(180deg); }

/* Teleport 到 body 后的菜单 —— position/top/left/z-index 都由内联 menuStyle 提供 */
.chip-menu {
  min-width: 150px;
  max-height: 62vh;
  overflow-y: auto;
  background: var(--n-4);
  border: 1px solid var(--n-6);
  border-radius: 12px;
  padding: 6px;
  box-shadow: 0 14px 40px var(--shadow-2);
}
/* 细滚动条 */
.chip-menu::-webkit-scrollbar { width: 6px; }
.chip-menu::-webkit-scrollbar-thumb { background: var(--n-7); border-radius: 3px; }

.chip-item {
  display: flex;
  align-items: center;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--t-body);
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease;
}
.chip-item:hover { background: var(--n-5); }
.chip-item.active {
  color: var(--accent-text);
  background: var(--accent-dim);
}

/* ===== 富行：图标 + 标题 + 描述 + 标签（模型下拉） ===== */
.chip-item.rich {
  gap: 10px;
  padding: 9px 10px;
  border-radius: 10px;
  min-width: 232px;
}
.chip-item.rich:hover { background: var(--n-6); }
.chip-item.rich.active { color: var(--t-strong); background: var(--n-6); }
.chip-item-icon {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--n-7);
  color: var(--t-body);
}
.chip-item.rich.active .chip-item-icon { background: var(--n-8); color: var(--t-max); }
.chip-item-icon :deep(svg) { width: 17px; height: 17px; }
.chip-item-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.chip-item-label { font-size: 13px; font-weight: 600; color: var(--t-strong); line-height: 1.2; }
.chip-item-desc {
  font-size: 11px;
  color: var(--t-dim);
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip-item-tag {
  flex-shrink: 0;
  align-self: center;
  padding: 2px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  color: var(--t-dim);
  background: var(--accent-dim);
}
.chip-item-check { width: 15px; height: 15px; flex-shrink: 0; color: var(--accent-text); }
</style>
