<template>
  <TeamDialog :title="t('team.leave.title', { name: teamName })" :busy="busy" @close="emit('close')" @submit="submit">
    <p>{{ t('team.leave.body') }}</p>
    <ul>
      <li>{{ t('team.leave.stays') }}</li>
      <li>{{ t('team.leave.private') }}</li>
      <li>{{ t('team.leave.runs') }}</li>
      <li>{{ t('team.leave.back') }}</li>
    </ul>
    <p v-if="error" class="lc-error-text" role="alert">{{ error }}</p>
    <template #foot>
      <button class="lc-btn" type="button" :disabled="busy" data-autofocus @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="lc-btn danger" type="submit" :disabled="busy" data-act="leave-confirm">{{ busy ? t('team.leave.leaving') : t('team.leave.confirm') }}</button>
    </template>
  </TeamDialog>
</template>

<script setup lang="ts">
/** 退出团队（管理员、成员）。退出后这个空间对自己就不存在了：回到个人空间。 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { teamApi } from '@/utils/api'
import { MessagePlugin } from '@/utils/feedback'
import { useSpaceStore } from '@/stores/space'
import TeamDialog from './TeamDialog.vue'
import { useTeamPage, toPersonalSpace } from './context'

const emit = defineEmits<{ (e: 'close'): void }>()
const { t } = useI18n()
const router = useRouter()
const space = useSpaceStore()
const page = useTeamPage()

const teamName = space.name
const busy = ref(false)
const error = ref('')

async function submit() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await teamApi.leave(page.teamId)
  } catch (err) {
    error.value = page.explain(err)
    busy.value = false
    return
  }
  MessagePlugin.success(t('team.leave.done', { name: teamName }))
  await toPersonalSpace(router, space)
}
</script>
