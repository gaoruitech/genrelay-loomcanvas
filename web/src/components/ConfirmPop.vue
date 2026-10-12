<template>
  <span class="cp-wrap" ref="rootRef">
    <span class="cp-trigger" @click.stop="toggle"><slot /></span>

    <Teleport to="body">
      <div v-if="open" class="cp-pop" :style="popStyle" @click.stop>
        <p class="cp-text">{{ text }}</p>
        <p v-if="hint" class="cp-hint">{{ hint }}</p>
        <div class="cp-ops">
          <button class="lc-btn sm" @click="close">{{ t('common.cancel') }}</button>
          <button class="lc-btn sm danger" @click="confirm">{{ okText || t('common.delete') }}</button>
        </div>
      </div>
    </Teleport>
  </span>
</template>

<script setup lang="ts">
/**
 * 就地确认小气泡。
 *
 * 替掉 window.confirm：原生弹框是浏览器画的，深浅皮肤一概不认，
 * 位置永远在屏幕正中，跟点的那颗按钮没有视觉联系 —— 一批里有三个「删除」，
 * 弹出来根本分不清删的是哪个。气泡贴着按钮弹，指向明确。
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
  /** 确认按钮文案；不传就是「删除」 */
  okText?: string
  disabled?: boolean
}>(), { okText: '', hint: '' })

const emit = defineEmits<{ (e: 'ok'): void }>()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const popStyle = ref<Record<string, string>>({})

const POP_W = 232

function place() {
  const el = rootRef.value
  if (!el) return
  const r = el.getBoundingClientRect()
  // 默认弹在按钮上方；上面装不下就翻到下面
  const spaceAbove = r.top
  const below = spaceAbove < 150
  // 右对齐按钮，但不许超出视口
  let left = r.right - POP_W
  left = Math.max(10, Math.min(left, window.innerWidth - POP_W - 10))
  popStyle.value = below
    ? { left: `${left}px`, top: `${r.bottom + 8}px` }
    : { left: `${left}px`, bottom: `${window.innerHeight - r.top + 8}px` }
}

async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    await nextTick()
    place()
  }
}
function close() { open.value = false }
function confirm() { open.value = false; emit('ok') }

function onDocClick() { if (open.value) close() }
function onEsc(e: KeyboardEvent) { if (e.key === 'Escape' && open.value) close() }
// 滚动或改窗口大小时气泡会飘离按钮，直接收掉比追着重算稳妥
function onScroll() { if (open.value) close() }

document.addEventListener('click', onDocClick)
window.addEventListener('keydown', onEsc)
window.addEventListener('scroll', onScroll, true)
window.addEventListener('resize', onScroll)
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  window.removeEventListener('keydown', onEsc)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})
</script>

<style scoped>
.cp-wrap { display: inline-flex; }
.cp-trigger { display: inline-flex; }

/* 确认气泡：和下拉菜单同一种玻璃面板 */
.cp-pop {
  position: fixed; z-index: 3400; width: 240px; max-width: calc(100vw - 16px);
  background: var(--pop); border: 1px solid var(--line-2); border-radius: 12px;
  padding: 12px 12px 10px; box-shadow: var(--sh-1);
}
.cp-text { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text); }
.cp-hint { margin: 4px 0 0; font-size: 12px; line-height: 1.6; color: var(--text-3); }
.cp-ops { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
</style>
