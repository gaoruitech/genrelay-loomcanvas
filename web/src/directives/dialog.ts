import type { ObjectDirective } from 'vue'
import { createDialogFocus, type DialogFocus, type DialogFocusOptions } from '@/composables/useDialogFocus'

/**
 * v-dialog：写在弹窗的盒子上（.lc-dialog / role="dialog" 的那个元素），键盘和焦点就归
 * composables/useDialogFocus.ts 管了：打开时焦点进弹窗，Tab 在里面循环，Esc 关掉最上面一层，
 * 关掉后焦点还给打开它的元素。弹窗多半是「父组件模板里一段 v-if」，没有自己的 setup 可以调
 * useDialogFocus，所以给一个指令——元素挂上就是开了，卸掉就是关了。
 *
 *   <div v-if="open" class="lc-mask lc-sheet" @click.self="close">
 *     <div v-dialog="close" class="lc-dialog" role="dialog" aria-modal="true" …>
 *
 *   <form v-dialog="{ onEscape: close, busy: saving }" class="lc-dialog" …>
 *
 * 值：一个函数（按 Esc 时调），或者一个对象：
 *   onEscape      按 Esc 时调（不给 = Esc 不关，比如只能点按钮回答的提示）
 *   busy          正在提交：Esc 不关。布尔值或函数
 *   initialFocus  打开时焦点放哪儿；不给就按 data-autofocus → 第一个输入控件 → 弹窗自己
 *   returnFocus   false = 关掉后不还焦点
 *   fallbackFocus 打开它的元素已经不在了（那一行被删了）时焦点放哪儿
 *   modal         false = 不挡页面的弹出面板（点外面就收起的那种）：焦点去了别处不往回拉
 * 遮罩上不要再写 @keydown.esc（会关两次）。弹窗摞弹窗不用特别处理：后挂上的在上面。
 * 用法：<script setup> 里 import { vDialog } from '@/directives/dialog'。
 */

export type DialogBinding =
  | (() => void)
  | (Omit<DialogFocusOptions, 'busy'> & { busy?: boolean | (() => boolean) })
  | null
  | undefined

interface Held { focus: DialogFocus; value: DialogBinding }
const held = new WeakMap<HTMLElement, Held>()

const optsOf = (v: DialogBinding) => (typeof v === 'function' ? { onEscape: v } : v || {})

export const vDialog: ObjectDirective<HTMLElement, DialogBinding> = {
  mounted(el, binding) {
    // 每次渲染绑定的值都是新的（内联函数、busy 的当前值）：这里只存一份，用的时候现取
    const h: Held = { value: binding.value, focus: null as unknown as DialogFocus }
    const cur = () => optsOf(h.value)
    h.focus = createDialogFocus(() => (el.isConnected ? el : null), {
      onEscape: () => cur().onEscape?.(),
      busy: () => { const b = cur().busy; return typeof b === 'function' ? b() : !!b },
      initialFocus: () => cur().initialFocus?.(),
      fallbackFocus: () => cur().fallbackFocus?.(),
      get returnFocus() { return cur().returnFocus },
      get modal() { return cur().modal },
    })
    held.set(el, h)
    h.focus.activate()
  },
  updated(el, binding) {
    const h = held.get(el)
    if (h) h.value = binding.value
  },
  beforeUnmount(el) {
    held.get(el)?.focus.deactivate()
    held.delete(el)
  },
}

/** 内容换了一屏（表单 → 结果）之后，把焦点重新放到初始位置 */
export function refocusDialog(el: HTMLElement | null | undefined) {
  if (el) held.get(el)?.focus.focusFirst()
}
