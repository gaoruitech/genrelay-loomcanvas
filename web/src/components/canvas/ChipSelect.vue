<template>
  <div ref="root" class="chip-select" :class="{ open, field }">
    <button
      ref="btn"
      class="chip nodrag"
      type="button"
      :title="title"
      @click.stop="toggle"
      @mousedown.stop
    >
      <span v-if="badge" class="lc-bd chip-badge" :class="badgeKind">{{ badge }}</span>
      <span v-else-if="label" class="chip-leading">{{ label }}</span>
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
.chip-menu { min-width: 150px; max-height: 62vh; max-width: calc(100vw - 16px); }
.chip-item { white-space: nowrap; }

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
  background: rgba(124, 160, 255, .1);
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
  background: rgba(124, 160, 255, .12);
}
.chip-item-check { width: 15px; height: 15px; flex-shrink: 0; color: var(--cyan); }
</style>
