<template>
  <div v-if="mode !== 'off' && mode !== 'mine' && mode !== 'pending'" class="clb-wrap" :style="wrapStyle">
  <div class="fl clb" :class="[mode, { self }]" role="status" aria-live="polite" data-testid="collab-bar" :data-mode="mode" :data-self="self ? '1' : undefined">
    <span class="clb-main">
    <!-- 另一个标签页里的是我自己：不摆「某某」的头像，摆一个窗口的图标 -->
    <LcIcon v-if="self && mode !== 'free'" name="monitor" class="clb-ic" />
    <SpaceAvatar v-else-if="holder && mode !== 'free'" shape="round" :name="holder.by.name" :seed="holder.by.id" :size="24" />
    <LcIcon v-else :name="mode === 'error' ? 'warn' : mode === 'free' ? 'check' : 'eye'" class="clb-ic" />
    <span class="clb-text" data-testid="collab-text">
      <template v-if="mode === 'error'">{{ errorMessage || t('canvas.collab.error') }}</template>
      <template v-else-if="mode === 'view' && (!holder || self)">{{ t('canvas.collab.view') }}</template>
      <template v-else-if="mode === 'free' && !holder">{{ t('canvas.collab.free') }}</template>
      <i18n-t v-else :keypath="textKey" tag="span" scope="global">
        <template #name><b>{{ who }}</b></template>
      </i18n-t>
    </span>
    </span>
    <span class="clb-ops">
      <!-- 丢了锁，手上还有没保存的改动：另存为副本，不会丢 -->
      <button v-if="mode === 'lost' && unsaved && canCopy" class="lc-btn sm primary quiet" type="button" :disabled="busy" data-testid="collab-save-copy" @click="emit('save-copy')">
        <LcIcon name="copy" size="s" />{{ t('canvas.collab.saveMine') }}
      </button>
      <button v-if="mode === 'lost'" class="lc-btn sm" type="button" :disabled="busy" data-testid="collab-reload" @click="emit('reload')">
        <LcIcon name="refresh" size="s" />{{ t('canvas.collab.reload') }}
      </button>
      <button v-if="(mode === 'held' || mode === 'view' || mode === 'free') && canCopy" class="lc-btn sm" type="button" :disabled="busy" data-testid="collab-copy" @click="emit('copy')">
        <LcIcon name="copy" size="s" />{{ t('canvas.collab.copy') }}
      </button>
      <ConfirmPop
        v-if="(mode === 'held' || mode === 'lost') && canTakeOver"
        :text="self ? t('canvas.collab.takeOverSelfConfirm') : t('canvas.collab.takeOverConfirm', { name: who })"
        :hint="self ? t('canvas.collab.takeOverSelfHint') : t('canvas.collab.takeOverHint')"
        :ok-text="takeOverLabel"
        :tone="self ? 'primary' : 'danger'"
        :disabled="busy"
        @ok="emit('take-over')"
      >
        <button class="lc-btn sm primary" type="button" :disabled="busy" data-testid="collab-takeover">{{ takeOverLabel }}</button>
      </ConfirmPop>
      <button v-if="mode === 'error'" class="lc-btn sm primary" type="button" :disabled="busy" @click="emit('retry')">{{ t('common.retry') }}</button>
      <button v-if="mode === 'free'" class="lc-btn sm primary" type="button" :disabled="busy" data-testid="collab-start" @click="emit('retry')">{{ t('canvas.collab.startEditing') }}</button>
    </span>
  </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 画布顶部正中的只读提示条：别的会话正在编辑（别人，或者我自己的另一个标签页）/ 我丢了锁（被接管、过期后被拿走）/
 * 对方走了可以开始编辑 / 我只有查看权 / 没拿到编辑锁。
 * 只读时什么都不保存，也不能运行；能做的在这一条上：复制一份、接管编辑（要确认一次）、把没保存的改动另存为副本。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import ConfirmPop from '@/components/ConfirmPop.vue'
import SpaceAvatar from '@/components/space/SpaceAvatar.vue'
import { personName } from '@/utils/person'
import type { CollabMode, LostHow } from '@/composables/useCanvasCollab'
import type { CanvasLockInfo } from '@/embed/types'

const props = defineProps<{
  mode: CollabMode
  holder: CanvasLockInfo | null
  /** 我是怎么丢的锁（mode 为 lost 时） */
  lostHow?: LostHow
  canTakeOver: boolean
  /** 后端能不能把一份文档另存成新画布 */
  canCopy: boolean
  /** 手上有没有没保存的改动 */
  unsaved: boolean
  busy: boolean
  errorMessage?: string
  /** 放在编辑区的哪一段里（相对编辑区的像素）：在这一段里居中。Canvas.vue 量出来的，见那边的 placeBar */
  place?: { top: number; left: number; right: number }
}>()
const emit = defineEmits<{
  (e: 'take-over'): void
  (e: 'copy'): void
  (e: 'save-copy'): void
  (e: 'reload'): void
  (e: 'retry'): void
}>()
const { t } = useI18n()

const wrapStyle = computed(() => {
  const p = props.place || { top: 16, left: 16, right: 16 }
  return { top: p.top + 'px', left: p.left + 'px', right: p.right + 'px' }
})
/** 拿着锁的是我自己这个账号的另一个标签页（或另一台设备） */
const self = computed(() => !!props.holder?.sameUser)
const who = computed(() => personName(props.holder?.by))
/** 这一条说什么。句子里的 {name} 由模板加粗填进去 */
const textKey = computed(() => {
  const s = self.value
  if (props.mode === 'held') return s ? 'canvas.collab.heldSelf' : 'canvas.collab.heldBy'
  if (props.mode === 'lost') {
    if (props.lostHow === 'expired') return s ? 'canvas.collab.lostExpiredSelf' : 'canvas.collab.lostExpiredBy'
    return s ? 'canvas.collab.lostSelf' : 'canvas.collab.lostBy'
  }
  if (props.mode === 'free') return s ? 'canvas.collab.freeSelf' : 'canvas.collab.freeBy'
  return 'canvas.collab.viewHeld'
})
const takeOverLabel = computed(() => (self.value ? t('canvas.collab.editHere') : t('canvas.collab.takeOver')))
</script>

<style scoped>
/* 外面这层只管占位（标题块右边剩下的那一段，或者第二行），不接鼠标；提示条在里面居中，放不下就折行 */
.clb-wrap { position: absolute; z-index: 6; display: flex; justify-content: center; pointer-events: none; }
.clb {
  position: relative; pointer-events: auto;
  display: flex; align-items: center; flex-wrap: wrap; justify-content: center; gap: 6px 10px; max-width: 100%; min-height: 44px; padding: 7px 8px 7px 12px;
  border-radius: 14px; border: 1px solid rgb(var(--c-warn) / .45); background: var(--glass-panel);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); box-shadow: var(--sh-1);
  font-size: 13px; color: var(--text-2);
}
.clb.view { border-color: var(--line-2); }
.clb.free { border-color: rgb(var(--c-ok) / .5); }
.clb.error { border-color: rgb(var(--c-err) / .5); }
/* 头像 / 图标和那句话是一组：放不下时整组占一行、话在组里折行，按钮换到下一行 */
.clb-main { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 0 1 auto; }
.clb-main > :first-child { flex: none; }
.clb-ic { flex: none; color: var(--text-3); }
.clb.error .clb-ic { color: var(--err-soft); }
.clb.free .clb-ic { color: var(--ok); }
.clb-text { min-width: 0; line-height: 1.5; }
.clb-text b { color: var(--text); font-weight: 600; }
.clb-ops { display: flex; align-items: center; gap: 8px; flex: none; margin-left: 4px; }
.clb-ops .lc-btn { gap: 6px; white-space: nowrap; }
.clb-ops { flex-wrap: wrap; justify-content: center; }
</style>
