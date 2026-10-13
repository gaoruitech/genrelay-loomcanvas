<template>
  <Teleport :to="$lcPortal">
    <div class="lc-mask lc-sheet" @click.self="emit('close')">
      <div v-dialog="() => emit('close')" class="lc-dialog td" role="dialog" aria-modal="true" :aria-label="t('views.trash.title')">
        <div class="lc-dialog-head">
          <span>{{ t('views.trash.title') }}</span>
          <button ref="closeBtn" class="lc-x" type="button" :aria-label="t('common.close')" @click="emit('close')">×</button>
        </div>
        <div class="lc-dialog-body td-body">
          <p class="td-note">{{ space.isTeam ? t('views.trash.noteTeam') : t('views.trash.note') }}</p>

          <div v-if="state === 'loading'" class="td-skel" aria-hidden="true"><i v-for="n in 3" :key="n" /></div>
          <div v-else-if="state === 'error'" class="lc-empty td-state">
            <p>{{ errorText || t('views.trash.loadFailed') }}</p>
            <button class="lc-btn sm" type="button" @click="load">{{ t('common.retry') }}</button>
          </div>
          <div v-else-if="!list.length" class="lc-empty td-state">
            <span class="td-ic"><LcIcon name="trash" size="l" /></span>
            <p>{{ t('views.trash.empty') }}</p>
          </div>
          <ul v-else class="td-list">
            <li v-for="w in list" :key="w.id" class="td-row">
              <div class="td-main">
                <b v-tip="{ text: w.name, clipped: true }">{{ w.name }}</b>
                <small>
                  <template v-if="space.isTeam">{{ t('views.trash.deletedBy', { name: personTitle(w.deletedBy) }) }} · </template>{{ t('views.trash.deletedAt', { time: formatDateTime(w.deletedAt) }) }}
                </small>
              </div>
              <span class="lc-tag td-left" :class="{ warn: daysUntil(w.restorableUntil) <= 3 }">{{ t('views.trash.daysLeft', { n: daysUntil(w.restorableUntil) }) }}</span>
              <button class="lc-btn sm" type="button" :disabled="!!restoringId" @click="restore(w)">
                {{ restoringId === w.id ? t('views.trash.restoring') : t('views.trash.restore') }}
              </button>
            </li>
          </ul>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" type="button" @click="emit('close')">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 回收站：最近 30 天删掉的画布，可以恢复。
 * 个人空间里是自己删的；团队里只有团长和管理员进得来（管理员只看得到删除前自己看得到的那些）。
 */
import { vDialog } from '@/directives/dialog'
import { nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { workflowApi, unwrap, apiErrorCode, apiErrorMessage, SPACE_GONE_CODES, type TrashedWorkflow } from '@/utils/api'
import { useSpaceStore } from '@/stores/space'
import { daysUntil, formatDateTime } from '@/components/space/format'
import LcIcon from '@/components/LcIcon.vue'
import { personTitle } from './canvasMeta'

const emit = defineEmits<{ (e: 'close'): void; (e: 'restored'): void }>()

const { t } = useI18n()
const space = useSpaceStore()

const list = ref<TrashedWorkflow[]>([])
const state = ref<'loading' | 'ready' | 'error'>('loading')
const errorText = ref('')
const closeBtn = ref<HTMLButtonElement | null>(null)

async function load() {
  state.value = 'loading'
  errorText.value = ''
  try {
    list.value = unwrap(await workflowApi.trash()) || []
    state.value = 'ready'
  } catch (err) {
    // 没权限时把服务端的原话摆出来（管理员刚被改回成员）
    errorText.value = apiErrorCode(err) === 'team.forbidden' ? apiErrorMessage(err, '') : ''
    state.value = 'error'
  }
}

const restoringId = ref('')
async function restore(w: TrashedWorkflow) {
  if (restoringId.value) return
  restoringId.value = w.id
  try {
    unwrap(await workflowApi.restore(w.id))
    MessagePlugin.success(t('views.trash.restored', { name: w.name }))
    list.value = list.value.filter((it) => it.id !== w.id)
    emit('restored')
  } catch (err: any) {
    const code = apiErrorCode(err)
    if ((SPACE_GONE_CODES as readonly string[]).includes(code)) return
    if (err?.response?.status === 404) {
      // 过了 30 天，或者已经被别人恢复了：这一行不该再留着
      MessagePlugin.error(t('views.trash.expired'))
      void load()
    } else {
      MessagePlugin.error(apiErrorMessage(err, t('views.trash.restoreFailed')))
      if (code === 'team.forbidden') void load()
    }
  } finally {
    restoringId.value = ''
  }
}

onMounted(() => {
  void load()
  nextTick(() => closeBtn.value?.focus())
})
</script>

<style scoped>
.td { width: 640px; }
.td-body { min-height: 200px; }
.td-note { margin: 0 0 12px; color: var(--text-3); font-size: 13px; line-height: 1.6; }
.td-list { list-style: none; margin: 0; padding: 0; }
.td-row { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
.td-row:first-child { border-top: 0; }
.td-main { flex: 1; min-width: 0; }
.td-main b { display: block; font-weight: 600; font-size: 14px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.td-main small { display: block; margin-top: 2px; font-size: 12px; color: var(--text-3); overflow-wrap: anywhere; }
.td-left { flex: none; }
.td-row .lc-btn { flex: none; }
.td-state { display: grid; justify-items: center; gap: 10px; }
.td-state p { margin: 0; }
.td-ic {
  width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; color: var(--text-3);
  background: rgb(var(--c-film) / .08);
}
.td-skel { display: grid; gap: 14px; padding-top: 6px; }
.td-skel i { display: block; height: 36px; border-radius: 8px; background: var(--skel-bg); animation: lc-pulse 1.6s ease-in-out infinite; }

@media (max-width: 600px) {
  .td-row { flex-wrap: wrap; }
  .td-main { flex-basis: 100%; }
  .td-left { margin-right: auto; }
}
</style>
