<template>
  <Teleport :to="$lcPortal">
    <div class="lc-mask lc-sheet td-mask" @mousedown="downOnMask = $event.target === $event.currentTarget" @click.self="onMaskClick">
      <form
        ref="box"
        class="lc-dialog td"
        :role="role"
        aria-modal="true"
        :aria-labelledby="headId"
        :style="{ width: width + 'px' }"
        tabindex="-1"
        novalidate
        v-bind="$attrs"
        @submit.prevent="emit('submit')"
      >
        <div class="lc-dialog-head">
          <span :id="headId" class="td-title">{{ title }}</span>
          <button v-if="!persistent" class="lc-x" type="button" :aria-label="t('common.close')" :disabled="busy" @click="tryClose">×</button>
        </div>
        <div class="lc-dialog-body td-body"><slot /></div>
        <div v-if="$slots.foot" class="lc-dialog-foot td-foot"><slot name="foot" /></div>
      </form>
    </div>
  </Teleport>
</template>

<script lang="ts">
let seq = 0
</script>

<script setup lang="ts">
/**
 * 小弹窗共用的壳（团队页、设置页、登录页都用它）：标题、正文、底部按钮；手机上贴底。
 * 回车提交（submit），Esc / 点外面 / 右上角的 × 关闭（busy 时都不关）；persistent 的弹窗只能用底部的按钮关。
 * 焦点：打开时进弹窗（data-autofocus → 第一个输入框 → 弹窗自己），Tab 在里面循环，关掉后还给打开它的元素，
 * 见 composables/useDialogFocus.ts。写在壳上的属性（data-testid、class）落在弹窗盒子上。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDialogFocus } from '@/composables/useDialogFocus'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  title: string
  width?: number
  busy?: boolean
  /** alertdialog：要人立刻回答的确认（没保存就离开之类） */
  role?: 'dialog' | 'alertdialog'
  /** 不能用 Esc / 点外面 / × 关掉，只能点底部的按钮（只显示一次的临时密码） */
  persistent?: boolean
  /** 关掉后打开它的元素已经不在了（那一行被删了）时，焦点放到哪儿 */
  fallbackFocus?: () => HTMLElement | null | undefined
}>(), { width: 460, busy: false, role: 'dialog', persistent: false, fallbackFocus: undefined })
const emit = defineEmits<{ (e: 'close'): void; (e: 'submit'): void }>()
const { t } = useI18n()
const box = ref<HTMLFormElement | null>(null)
const headId = `lc-dlg-h-${++seq}`

function tryClose() {
  if (!props.busy && !props.persistent) emit('close')
}
/** 按下和松开都在遮罩上才算「点外面」：在输入框里拖选文字、松手时滑到外面不算 */
const downOnMask = ref(false)
function onMaskClick() {
  if (downOnMask.value) tryClose()
  downOnMask.value = false
}

const focus = useDialogFocus(box, { onEscape: tryClose, busy: () => props.busy, fallbackFocus: () => props.fallbackFocus?.() })
defineExpose({ focusFirst: focus.focusFirst })
</script>

<style scoped>
.td-mask { overscroll-behavior: contain; }
.td { outline: none; }
.td-title { min-width: 0; overflow-wrap: anywhere; }
.td-body { color: var(--text-2); font-size: 14px; line-height: 1.7; overscroll-behavior: contain; }
.td-body :deep(p + p) { margin-top: 10px; }
.td-body :deep(.lc-field:last-child) { margin-bottom: 0; }
.td-body :deep(b) { color: var(--text); font-weight: 600; }
.td-body :deep(ul) { margin: 10px 0 0; padding-left: 18px; display: grid; gap: 4px; }
.td-body :deep(.lc-alert:not(:first-child)) { margin-top: 14px; }
.td-body :deep(.lc-error-text:not(:first-child)) { margin-top: 12px; }
/* 手机上按钮多了放不下一行：折行，各占满 */
@media (max-width: 600px) {
  .td-foot { flex-wrap: wrap; }
  .td-foot :deep(.lc-btn) { flex: 1 1 auto; }
}
</style>
