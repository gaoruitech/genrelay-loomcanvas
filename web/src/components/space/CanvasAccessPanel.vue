<template>
  <div class="cap">
    <div class="cap-opts" role="radiogroup" :aria-label="t('spaces.visibility.label')">
      <button
        v-for="o in OPTIONS"
        :key="o.value"
        type="button"
        class="cap-opt"
        :class="{ on: modelValue === o.value }"
        role="radio"
        :aria-checked="modelValue === o.value"
        :disabled="readOnly"
        @click="emit('update:modelValue', o.value)"
      >
        <i class="cap-radio" aria-hidden="true" />
        <span class="cap-ic"><LcIcon :name="o.icon" /></span>
        <span class="cap-t">
          <b>{{ t(`spaces.visibility.${o.value}.label`) }}</b>
          <small>{{ t(`spaces.visibility.${o.value}.desc`) }}</small>
        </span>
      </button>
    </div>
    <p class="cap-note"><LcIcon name="shield" size="s" /><span>{{ t('spaces.visibility.ownerAlways') }}</span></p>
    <p v-if="readOnly" class="cap-note"><LcIcon name="lock" size="s" /><span>{{ t('spaces.access.readOnly') }}</span></p>
    <div v-if="lock" class="cap-lock">
      <SpaceAvatar shape="round" :name="lock.by.name" :seed="lock.by.id" :size="22" />
      <b>{{ lock.mine ? t('spaces.access.youEditing') : t('spaces.access.editing', { name: lock.by.name }) }}</b>
      <span>{{ t('spaces.access.othersReadOnly') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 团队画布「团队内」的可见范围：三张单选卡片（仅自己 / 团队可看 / 团队可改）、
 * 一句「团长始终可以查看」，以及现在谁在编辑。只管选，不管存：存由外面的弹窗做。
 */
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import SpaceAvatar from './SpaceAvatar.vue'
import type { CanvasLock, CanvasVisibility } from '@/types'

defineProps<{
  modelValue: CanvasVisibility
  /** 调用者不能改这张画布的可见范围（别人的画布）：照样显示，但点不动 */
  readOnly?: boolean
  /** 现在谁在编辑；没人就不显示那一行 */
  lock?: CanvasLock | null
}>()
const emit = defineEmits<{ (e: 'update:modelValue', v: CanvasVisibility): void }>()

const { t } = useI18n()
const OPTIONS: { value: CanvasVisibility; icon: string }[] = [
  { value: 'private', icon: 'lock' },
  { value: 'team_view', icon: 'eye' },
  { value: 'team_edit', icon: 'edit' },
]
</script>

<style scoped>
.cap-opts { display: flex; flex-direction: column; gap: 10px; }
.cap-opt {
  display: flex; align-items: flex-start; gap: 12px; width: 100%; padding: 14px 16px; text-align: left;
  border-radius: var(--r-md); border: 1px solid var(--line-2); background: rgb(var(--c-film) / .04); color: var(--text-2);
  transition: border-color .15s, background .15s;
}
.cap-opt:hover:not(:disabled) { border-color: var(--line-3); background: rgb(var(--c-film) / .08); }
.cap-opt:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.cap-opt.on { border-color: rgb(var(--c-cyan) / .7); background: rgb(var(--c-cyan) / .08); box-shadow: 0 0 0 1px rgb(var(--c-cyan) / .25) inset; }
.cap-opt:disabled { cursor: not-allowed; }
.cap-opt:disabled:not(.on) { opacity: .5; }
.cap-radio { flex: none; width: 16px; height: 16px; margin-top: 8px; border-radius: 50%; border: 2px solid var(--line-3); position: relative; }
.cap-opt.on .cap-radio { border-color: var(--cyan); }
.cap-opt.on .cap-radio::after { content: ''; position: absolute; inset: 3px; border-radius: 50%; background: var(--cyan); }
.cap-ic { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: rgb(var(--c-film) / .12); color: var(--text-2); }
.cap-opt.on .cap-ic { color: var(--cyan-soft); }
.cap-t { min-width: 0; }
.cap-t b { display: block; font-weight: 600; font-size: 14px; color: var(--text); line-height: 1.4; }
.cap-t small { display: block; font-size: 13px; color: var(--text-2); line-height: 1.6; margin-top: 2px; }
.cap-note { display: flex; gap: 8px; align-items: flex-start; margin: 14px 0 0; font-size: 13px; color: var(--text-3); line-height: 1.6; }
.cap-note .lc-ic { margin-top: 3px; }
.cap-lock {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 14px; padding: 10px 14px; border-radius: var(--r-sm);
  background: rgb(var(--c-film) / .08); font-size: 13px; color: var(--text-3);
}
.cap-lock b { color: var(--text); font-weight: 600; }
.cap-lock > span:last-child { margin-left: auto; }
</style>
