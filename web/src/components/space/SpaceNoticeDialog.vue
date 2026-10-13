<template>
  <Teleport :to="$lcPortal">
    <div v-if="space.notice" class="lc-mask">
      <div v-dialog="() => space.clearNotice()" class="lc-dialog sn" role="alertdialog" aria-modal="true" :aria-label="title" :aria-describedby="uid">
        <div class="lc-dialog-body sn-body">
          <span class="sn-ic"><LcIcon name="users" size="l" /></span>
          <h2>{{ title }}</h2>
          <p :id="uid">{{ body }}</p>
          <p class="sn-now">{{ t('spaces.notice.nowPersonal') }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button ref="okEl" class="lc-btn primary" type="button" @click="space.clearNotice()">{{ t('spaces.notice.ok') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 被送回个人空间时说清楚为什么：被移出团队、团队被解散、被超级管理员停用，
 * 或者打开的链接指向一个自己进不去的团队。人此刻已经在个人空间里了。
 */
import { vDialog } from '@/directives/dialog'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSpaceStore } from '@/stores/space'
import LcIcon from '@/components/LcIcon.vue'

const { t } = useI18n()
const space = useSpaceStore()
const uid = `sn-${Math.random().toString(36).slice(2, 8)}`
const okEl = ref<HTMLButtonElement | null>(null)

const named = computed(() => !!space.notice?.teamName)
const title = computed(() => (space.notice ? t(`spaces.notice.${space.notice.kind}.title`) : ''))
const body = computed(() => {
  const n = space.notice
  if (!n) return ''
  return named.value ? t(`spaces.notice.${n.kind}.body`, { name: n.teamName }) : t(`spaces.notice.${n.kind}.bodyNoName`)
})

watch(() => space.notice, async (n) => {
  if (!n) return
  await nextTick()
  okEl.value?.focus()
}, { immediate: true })
</script>

<style scoped>
.sn { width: 440px; }
.sn-body { text-align: center; padding: 28px 28px 20px; }
.sn-ic { display: inline-grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; color: var(--warn); background: var(--warning-dim); margin-bottom: 14px; }
.sn-body h2 { font: 600 18px/1.4 var(--f-disp); color: var(--text); margin: 0 0 8px; }
.sn-body p { color: var(--text-2); line-height: 1.7; margin: 0; }
.sn-body .sn-now { color: var(--text-3); font-size: 13px; margin-top: 8px; }
.lc-dialog-foot { justify-content: center; }
</style>
