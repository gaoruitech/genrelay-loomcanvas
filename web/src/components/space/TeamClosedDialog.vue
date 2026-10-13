<template>
  <Teleport :to="$lcPortal">
    <div class="lc-mask lc-sheet" @click.self="!busy && emit('close')">
      <div v-dialog="{ onEscape: () => emit('close'), busy }" class="lc-dialog tcl" role="dialog" aria-modal="true" :aria-label="team.name">
        <div class="lc-dialog-head">
          <span class="tcl-h"><SpaceAvatar :name="team.name" :src="team.avatar" :seed="team.id" :size="28" />{{ team.name }}</span>
          <button class="lc-x" type="button" :aria-label="t('common.close')" @click="emit('close')">×</button>
        </div>
        <div class="lc-dialog-body">
          <template v-if="team.status === 'dissolved'">
            <div class="lc-alert warn"><LcIcon name="warn" /><div>
              <b>{{ t('spaces.closed.dissolvedTitle') }}</b>
              <p>{{ t('spaces.closed.dissolvedBody', { n: daysUntil(team.purgeAt), date: formatDateTime(team.purgeAt) }) }}</p>
            </div></div>
            <p class="lc-help tcl-p">{{ t('spaces.closed.restoreHint') }}</p>
          </template>
          <template v-else>
            <div class="lc-alert warn"><LcIcon name="warn" /><div>
              <b>{{ t('spaces.closed.suspendedTitle') }}</b>
              <p>{{ t('spaces.closed.suspendedBody') }}</p>
            </div></div>
          </template>
          <p v-if="error" class="lc-error-text" role="alert">{{ error }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" type="button" @click="emit('close')">{{ t('common.close') }}</button>
          <button v-if="team.status === 'dissolved'" class="lc-btn primary" type="button" :disabled="busy" @click="restore">
            {{ busy ? t('spaces.closed.restoring') : t('spaces.closed.restore') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 团长点开一个已经关闭的团队（切换器里只对团长列出）：
 * 已解散的说明还剩几天、可以恢复；被超级管理员停用的说明要找谁。
 */
import { vDialog } from '@/directives/dialog'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { teamApi, unwrap, apiErrorMessage } from '@/utils/api'
import { useSpaceStore, spaceParam } from '@/stores/space'
import { MessagePlugin } from '@/utils/feedback'
import LcIcon from '@/components/LcIcon.vue'
import SpaceAvatar from './SpaceAvatar.vue'
import { daysUntil, formatDateTime } from './format'
import type { SpaceSummary } from '@/types'

const props = defineProps<{ team: SpaceSummary }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useI18n()
const router = useRouter()
const space = useSpaceStore()
const busy = ref(false)
const error = ref('')

async function restore() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    unwrap(await teamApi.restore(props.team.id))
    await space.refresh()
    MessagePlugin.success(t('spaces.closed.restored', { name: props.team.name }))
    emit('close')
    await router.push({ name: 'home', params: { space: spaceParam(props.team.id) } })
  } catch (err) {
    error.value = apiErrorMessage(err, t('common.operationFailed'))
    void space.refresh()
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.tcl { width: 460px; }
.tcl-h { display: flex; align-items: center; gap: 10px; min-width: 0; }
.tcl-p { margin: 12px 0 0; }
.lc-alert b { display: block; color: var(--text); font-weight: 600; }
.lc-alert p { margin: 4px 0 0; color: var(--text-2); line-height: 1.6; }
.lc-error-text { margin: 12px 0 0; }
</style>
