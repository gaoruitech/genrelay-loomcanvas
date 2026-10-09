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
        class="lc-menu chip-menu nodrag nowheel"
        :style="menuStyle"
        @mousedown.stop
        @wheel.stop
      >
        <slot name="menu" :close="close">
          <div
            v-for="o in (options || [])"
            :key="String(o.value)"
            class="lc-menu-item chip-item"
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
import { ref, computed } from 'vue'
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

/* Teleport 到 body 后的菜单 —— position/top/left/z-index 都由内联 menuStyle 提供；
   面板与菜单项的基础外观在 base.css 的 .lc-menu / .lc-menu-item，与表单下拉共用 */
.chip-menu {
  min-width: 150px;
  max-height: 62vh;
}
.chip-item { white-space: nowrap; }

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
