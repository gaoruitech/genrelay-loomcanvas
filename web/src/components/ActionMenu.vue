<template>
  <span ref="root" class="am">
    <button
      ref="btn"
      type="button"
      class="lc-tb sm am-btn"
      :class="{ on: open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-label="label"
      v-tip="open ? '' : label"
      :disabled="disabled"
      data-act="row-menu"
      @click="toggle"
      @keydown.down.prevent="openAndFocus(0)"
      @keydown.up.prevent="openAndFocus(-1)"
      @keydown.esc="onEsc"
    ><LcIcon name="more" size="s" /></button>
    <Teleport :to="$lcPortal">
      <div
        v-if="open" ref="menuEl" class="lc-menu am-menu" role="menu" :aria-label="label" :style="menuStyle"
        @keydown.esc.stop.prevent="closeAndReturn"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.home.prevent="focusItem(0)"
        @keydown.end.prevent="focusItem(-1)"
        @keydown.tab="closeAndReturn"
        @keydown="onType"
      >
        <button
          v-for="it in items"
          :key="it.key"
          type="button"
          class="lc-menu-item am-item"
          :class="{ danger: it.danger }"
          role="menuitem"
          :disabled="it.disabled"
          :data-act="it.key"
          @click="pick(it.key)"
        >
          <LcIcon :name="it.icon" size="s" />{{ it.label }}
        </button>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
/**
 * 表格行、卡片最右边的「更多」菜单：全站共用这一个（设置页、团队成员、模型管理、画布卡片、素材分组）。
 * 弹层逻辑用 useFloatingMenu，外观是全局的 .lc-menu。
 * 键盘：打开后焦点进菜单第一项，上下键 / Home / End 在各项之间走（跳过不能点的），敲字母跳到以它开头的那一项，
 * Esc 关掉并把焦点还给按钮，Tab 关掉、焦点先回到按钮再照常往下走。
 * 选了一项：先把焦点还给按钮再发 pick——这一项要是打开一个弹窗，弹窗关掉后焦点就回到这个按钮上。
 * （菜单 Teleport 到了页面末尾，不这样做的话键盘从按钮是走不进菜单的。）
 */
import { nextTick, ref, watch } from 'vue'
import { useFloatingMenu } from '@/composables/useFloatingMenu'
import LcIcon from '@/components/LcIcon.vue'

export interface ActionMenuItem { key: string; label: string; icon: string; danger?: boolean; disabled?: boolean }

defineProps<{ items: ActionMenuItem[]; label: string; disabled?: boolean }>()
const emit = defineEmits<{ (e: 'pick', key: string): void }>()

const root = ref<HTMLElement | null>(null)
const btn = ref<HTMLButtonElement | null>(null)
const menuEl = ref<HTMLDivElement | null>(null)
const { open, menuStyle, show, close, toggle } = useFloatingMenu({ trigger: btn, menu: menuEl, root, gap: 4, closeOnScroll: true })

const nodes = () => Array.from(menuEl.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || [])
function focusItem(i: number) {
  const list = nodes()
  list[i < 0 ? list.length + i : i]?.focus({ preventScroll: true })
}
function move(d: number) {
  const list = nodes()
  if (!list.length) return
  const at = list.indexOf(document.activeElement as HTMLElement)
  list[(at + d + list.length) % list.length].focus({ preventScroll: true })
}
/** 敲一个字符：跳到下一个以它开头的项（从当前项的后面找起，找到头再绕回来） */
function onType(e: KeyboardEvent) {
  if (e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) return
  const list = nodes()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const ch = e.key.toLowerCase()
  for (let k = 1; k <= list.length; k++) {
    const el = list[(at + k + list.length) % list.length]
    if ((el.textContent || '').trim().toLowerCase().startsWith(ch)) { el.focus({ preventScroll: true }); e.preventDefault(); return }
  }
}
/** 打开后把焦点放进菜单（鼠标点开也一样：之后的方向键、Esc 才有着落） */
let first = 0
watch(open, async (v) => {
  if (!v) return
  await nextTick()
  await nextTick()
  focusItem(first)
  first = 0
})
function openAndFocus(i: number) {
  first = i
  if (open.value) focusItem(i)
  else show()
}
function closeAndReturn() {
  close()
  btn.value?.focus({ preventScroll: true })
}
function onEsc(e: KeyboardEvent) {
  if (!open.value) return
  e.stopPropagation()
  close()
}
function pick(key: string) {
  closeAndReturn()
  emit('pick', key)
}
</script>

<style scoped>
.am { display: inline-flex; }
.am-menu { min-width: 168px; max-width: calc(calc(100 * var(--lc-vw)) - 16px); }
.am-item {
  width: 100%; gap: 8px; border: 0; background: none; font: inherit; font-size: 13px; text-align: left; white-space: nowrap;
}
.am-item:focus-visible { outline: none; background: rgb(var(--c-film) / .12); color: var(--text); box-shadow: 0 0 0 1px var(--line-3) inset; }
.am-item:disabled { opacity: .45; cursor: not-allowed; }
.am-item.danger { color: var(--err-soft); }
.am-item.danger:hover:not(:disabled), .am-item.danger:focus-visible { background: rgb(var(--c-err) / .12); color: var(--err-soft); }
</style>
