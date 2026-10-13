<template>
  <span class="cp-wrap" ref="rootRef">
    <span class="cp-trigger" @click.stop="toggle"><slot /></span>

    <Teleport :to="$lcPortal">
      <div
        v-if="open" ref="popEl" class="cp-pop" :role="tone === 'danger' ? 'alertdialog' : 'dialog'" :data-tone="tone" :aria-label="text" :style="popStyle"
        @click.stop @keydown.tab="onTab"
      >
        <p class="cp-text">{{ text }}</p>
        <p v-if="hint" class="cp-hint">{{ hint }}</p>
        <div class="cp-ops">
          <button ref="cancelEl" type="button" class="lc-btn sm" @click="closeAndReturn">{{ t('common.cancel') }}</button>
          <button type="button" class="lc-btn sm" :class="tone === 'danger' ? 'danger' : 'primary'" data-act="confirm-ok" @click="confirm">{{ okText || t(tone === 'danger' ? 'common.delete' : 'common.confirm') }}</button>
        </div>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
import { frameOf } from '@/utils/frame'
/**
 * 就地确认小气泡。
 *
 * 替掉 window.confirm：原生弹框是浏览器画的，深浅皮肤一概不认，
 * 位置永远在屏幕正中，跟点的那颗按钮没有视觉联系 —— 一批里有三个「删除」，
 * 弹出来根本分不清删的是哪个。气泡贴着按钮弹，指向明确。
 *
 * 键盘：弹出后焦点在「取消」上，Tab 只在两颗按钮之间走，Esc 收掉并把焦点还给触发它的按钮
 * （这一下 Esc 不再往下传：气泡开在弹窗里时，弹窗不跟着关）。
 *
 * 用 Teleport 挂到 body：触发按钮多半在 overflow:hidden 的卡片里，
 * 就地展开会被裁掉。位置按触发元素的实际坐标算，跟着滚动重算。
 */
import { ref, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  /** 主问句 */
  text: string
  /** 补一句后果，比如「删掉就找不回来」 */
  hint?: string
  /** 确认按钮文案；不传就是「删除」（tone 为 primary 时是「确认」） */
  okText?: string
  /**
   * 确认按钮的颜色。danger（默认）：删除、撤销这类回不去的事；
   * primary：只是「确认一下再做」、做了也能再改回来的事（把编辑接到这个标签页、复制一份）——不该画成警告的红色。
   */
  tone?: 'danger' | 'primary'
  disabled?: boolean
}>(), { okText: '', hint: '', tone: 'danger' })

const emit = defineEmits<{ (e: 'ok'): void }>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const popStyle = ref<Record<string, string>>({})
const popEl = ref<HTMLElement | null>(null)
const cancelEl = ref<HTMLButtonElement | null>(null)
/** 触发它的那个元素（插槽里的按钮）：收掉后焦点还给它 */
let opener: HTMLElement | null = null

const POP_W = 232

function place() {
  const el = rootRef.value
  if (!el) return
  // 气泡是 fixed 的：坐标相对「画框」（utils/frame.ts）
  const fr = frameOf(el)
  const raw = el.getBoundingClientRect()
  const r = { top: raw.top - fr.y, bottom: raw.bottom - fr.y, right: raw.right - fr.x }
  // 默认弹在按钮上方；上面装不下就翻到下面
  const spaceAbove = r.top
  const below = spaceAbove < 150
  // 右对齐按钮，但不许超出视口
  let left = r.right - POP_W
  left = Math.max(10, Math.min(left, fr.w - POP_W - 10))
  popStyle.value = below
    ? { left: `${left}px`, top: `${r.bottom + 8}px` }
    : { left: `${left}px`, bottom: `${fr.h - r.top + 8}px` }
}

async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    const cur = document.activeElement as HTMLElement | null
    opener = cur && rootRef.value?.contains(cur) ? cur : rootRef.value?.querySelector<HTMLElement>('button, a[href], [tabindex]') || null
    await nextTick()
    place()
    cancelEl.value?.focus({ preventScroll: true })
  }
}
function close() { open.value = false }
function closeAndReturn() {
  close()
  if (opener?.isConnected) opener.focus({ preventScroll: true })
}
function confirm() { open.value = false; emit('ok') }

function onDocClick() { if (open.value) close() }
function onEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !open.value) return
  e.stopPropagation()
  e.preventDefault()
  closeAndReturn()
}
/** Tab 只在气泡的按钮之间走（气泡挂在页面末尾，放出去就走丢了） */
function onTab(e: KeyboardEvent) {
  const list = Array.from(popEl.value?.querySelectorAll<HTMLElement>('button') || [])
  if (!list.length) return
  const at = list.indexOf(document.activeElement as HTMLElement)
  e.preventDefault()
  list[(at + (e.shiftKey ? -1 : 1) + list.length) % list.length].focus({ preventScroll: true })
}
// 滚动或改窗口大小时气泡会飘离按钮，直接收掉比追着重算稳妥
function onScroll() { if (open.value) close() }

document.addEventListener('click', onDocClick)
// capture：抢在弹窗自己的 Esc 处理之前
document.addEventListener('keydown', onEsc, true)
window.addEventListener('scroll', onScroll, true)
window.addEventListener('resize', onScroll)
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onEsc, true)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})
</script>

<style scoped>
.cp-wrap { display: inline-flex; }
.cp-trigger { display: inline-flex; }

/* 确认气泡：和下拉菜单同一种玻璃面板 */
.cp-pop {
  position: fixed; z-index: 3400; width: 240px; max-width: calc(calc(100 * var(--lc-vw)) - 16px);
  background: var(--pop); border: 1px solid var(--line-2); border-radius: 12px;
  padding: 12px 12px 10px; box-shadow: var(--sh-1);
}
.cp-text { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text); }
.cp-hint { margin: 4px 0 0; font-size: 12px; line-height: 1.6; color: var(--text-3); }
.cp-ops { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
</style>
