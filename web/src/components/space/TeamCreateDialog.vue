<template>
  <Teleport :to="$lcPortal">
    <div class="lc-mask lc-sheet" @click.self="!busy && emit('close')">
      <div v-dialog="{ onEscape: () => emit('close'), busy }" class="lc-dialog tc" role="dialog" aria-modal="true" :aria-label="title">
        <div class="lc-dialog-head">
          <span>{{ title }}</span>
          <button class="lc-x" type="button" :aria-label="t('common.close')" @click="emit('close')">×</button>
        </div>

        <div v-if="loading" class="lc-dialog-body"><p class="lc-t3">{{ t('common.loading') }}</p></div>
        <div v-else-if="loadError" class="lc-dialog-body">
          <p class="lc-error-text">{{ loadError }}</p>
          <button class="lc-btn sm" type="button" @click="load">{{ t('common.retry') }}</button>
        </div>

        <!-- 可以创建 -->
        <template v-else-if="state?.canCreate">
          <form class="lc-dialog-body" @submit.prevent="create">
            <div class="lc-field">
              <label :for="uid + '-name'">{{ t('spaces.create.name') }}<span class="lc-required">*</span></label>
              <input :id="uid + '-name'" ref="nameEl" v-model="name" class="lc-input" :class="{ 'is-err': !!nameError }" maxlength="40" :placeholder="t('spaces.create.namePlaceholder')" autocomplete="off" />
              <p v-if="nameError" class="lc-help err">{{ nameError }}</p>
            </div>
            <div class="lc-field">
              <span class="lc-label">{{ t('spaces.create.avatar') }} <span class="lc-t3">· {{ t('common.optional') }}</span></span>
              <div class="tc-avatar">
                <SpaceAvatar v-if="!preview" :name="name || t('spaces.create.title')" :size="44" />
                <img v-else class="tc-preview" :src="preview" alt="" />
                <button class="lc-btn sm" type="button" @click="fileEl?.click()">{{ preview ? t('spaces.create.avatarChange') : t('spaces.create.avatarPick') }}</button>
                <button v-if="preview" class="lc-btn sm ghost" type="button" @click="clearAvatar">{{ t('common.remove') }}</button>
                <input ref="fileEl" class="tc-file" type="file" accept="image/png,image/jpeg,image/webp" tabindex="-1" :aria-label="t('spaces.create.avatarPick')" @change="onFile" />
              </div>
              <p class="lc-help">{{ t('spaces.create.avatarHint') }}</p>
            </div>
            <p class="lc-help tc-note">
              <LcIcon name="info" size="s" />
              <span>{{ t('spaces.create.zoneNote', { zone: zone || 'UTC' }) }} {{ t('spaces.create.quota', { left: Math.max(0, state.max - state.held), max: state.max, members: state.maxMembers }) }}</span>
            </p>
            <p v-if="error" class="lc-error-text" role="alert">{{ error }}</p>
          </form>
          <div class="lc-dialog-foot">
            <button class="lc-btn" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
            <button class="lc-btn primary" type="button" :disabled="busy" @click="create">{{ busy ? t('spaces.create.creating') : t('spaces.create.submit') }}</button>
          </div>
        </template>

        <!-- 有授权，但已经到数量上限 -->
        <template v-else-if="state?.authorised">
          <div class="lc-dialog-body">
            <div class="lc-alert warn"><LcIcon name="warn" /><div>
              <b>{{ t('spaces.create.fullTitle', { max: state.max }) }}</b>
              <p>{{ t('spaces.create.fullBody', { held: state.held, max: state.max }) }}</p>
            </div></div>
          </div>
          <div class="lc-dialog-foot"><button class="lc-btn" type="button" @click="emit('close')">{{ t('common.close') }}</button></div>
        </template>

        <!-- 没有授权：说明原因，可以提一条申请 -->
        <template v-else-if="state">
          <div class="lc-dialog-body">
            <p class="tc-why">{{ t('spaces.create.whyNeedAuth') }}</p>

            <div v-if="state.request?.status === 'pending'" class="tc-state">
              <span class="lc-st run">{{ t('spaces.create.pendingTitle') }}</span>
              <p class="lc-t2">{{ t('spaces.create.pendingBody', { time: formatDateTime(state.request.createdAt) }) }}</p>
              <p v-if="state.request.note" class="tc-quote">{{ state.request.note }}</p>
            </div>

            <template v-else>
              <div v-if="state.request?.status === 'rejected'" class="lc-alert tc-rejected"><LcIcon name="warn" /><div>
                <b>{{ t('spaces.create.rejectedTitle') }}</b>
                <p>{{ state.request.reason ? t('spaces.create.rejectedReason', { reason: state.request.reason }) : t('spaces.create.rejectedNoReason') }}</p>
              </div></div>
              <div class="lc-field tc-last">
                <label :for="uid + '-note'">{{ t('spaces.create.note') }} <span class="lc-t3">· {{ t('common.optional') }}</span></label>
                <textarea :id="uid + '-note'" v-model="note" class="lc-textarea" rows="3" maxlength="500" :placeholder="t('spaces.create.notePlaceholder')"></textarea>
                <p class="lc-help">{{ t('spaces.create.noteHint') }}</p>
              </div>
            </template>
            <p v-if="error" class="lc-error-text" role="alert">{{ error }}</p>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" type="button" @click="emit('close')">{{ t('common.close') }}</button>
            <button v-if="state.request?.status === 'pending'" class="lc-btn danger" type="button" :disabled="busy" @click="withdraw">{{ t('spaces.create.withdraw') }}</button>
            <button v-else class="lc-btn primary" type="button" :disabled="busy" @click="request">
              {{ state.request?.status === 'rejected' ? t('spaces.create.requestAgain') : t('spaces.create.requestSubmit') }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 「创建团队」那一个入口背后的全部状态：
 *  - 有授权、没到上限：填名称（和可选的头像）创建，时区取浏览器的；
 *  - 有授权、到了上限：说明最多能建几个；
 *  - 没有授权：说明为什么，提一条申请（可以附一句说明）；申请在等：显示并可以撤回；被拒绝：显示原因，可以再申请。
 */
import { vDialog } from '@/directives/dialog'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { teamApi, filesApi, unwrap, apiErrorMessage, apiErrorCode } from '@/utils/api'
import { useSpaceStore } from '@/stores/space'
import { MessagePlugin } from '@/utils/feedback'
import LcIcon from '@/components/LcIcon.vue'
import SpaceAvatar from './SpaceAvatar.vue'
import { browserZone, formatDateTime } from './format'
import type { TeamCreation } from '@/types'

const emit = defineEmits<{ (e: 'close'): void; (e: 'created', id: string): void }>()

const { t } = useI18n()
const space = useSpaceStore()
const uid = `tc-${Math.random().toString(36).slice(2, 8)}`
const zone = browserZone()

const state = ref<TeamCreation | null>(space.creation)
const loading = ref(!state.value)
const loadError = ref('')
const busy = ref(false)
const error = ref('')

const name = ref('')
const note = ref('')
// 头像：先在本机选好，团队建出来之后再传到团队名下（传在个人空间里的话，文件就不归团队了）
const fileEl = ref<HTMLInputElement | null>(null)
const avatarFile = ref<File | null>(null)
const preview = ref('')
function clearAvatar() {
  if (preview.value) URL.revokeObjectURL(preview.value)
  preview.value = ''
  avatarFile.value = null
  if (fileEl.value) fileEl.value.value = ''
}
function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { error.value = t('upload.notImage'); return }
  clearAvatar()
  error.value = ''
  avatarFile.value = f
  preview.value = URL.createObjectURL(f)
}
onBeforeUnmount(() => { if (preview.value) URL.revokeObjectURL(preview.value) })
const nameError = ref('')
const nameEl = ref<HTMLInputElement | null>(null)

const title = computed(() => (!state.value || state.value.authorised ? t('spaces.create.title') : t('spaces.create.requestTitle')))

async function load() {
  loadError.value = ''
  try {
    state.value = unwrap(await teamApi.creation())
  } catch (err) {
    if (!state.value) loadError.value = apiErrorMessage(err, t('common.loadFailed'))
  } finally {
    loading.value = false
    await nextTick()
    nameEl.value?.focus()
  }
}
onMounted(load)

async function create() {
  if (busy.value) return
  nameError.value = name.value.trim() ? '' : t('spaces.create.nameRequired')
  if (nameError.value) { nameEl.value?.focus(); return }
  busy.value = true
  error.value = ''
  try {
    const team = unwrap(await teamApi.create({ name: name.value.trim(), timezone: zone || undefined }))
    if (avatarFile.value) {
      // 团队已经建好了；头像没传上不算失败，之后在团队设置里还能换
      try {
        const up = unwrap(await filesApi.uploadTo(team.id, avatarFile.value, avatarFile.value.name))
        unwrap(await teamApi.update(team.id, { avatar: up.url }))
      } catch (err) {
        MessagePlugin.warning(t('spaces.create.avatarFailed', { reason: apiErrorMessage(err, t('upload.failed')) }))
      }
    }
    await space.refresh()
    MessagePlugin.success(t('spaces.create.created', { name: team.name }))
    emit('created', team.id)
  } catch (err) {
    // 开着弹窗的时候授权被收回了、或别处刚建满：按最新的状态重画
    if (['team.not_authorised', 'team.max_owned'].includes(apiErrorCode(err))) await load()
    error.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    busy.value = false
  }
}

async function request() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    state.value = unwrap(await teamApi.requestCreation(note.value.trim() || undefined))
    note.value = ''
    void space.refresh()
    MessagePlugin.success(t('spaces.create.requested'))
  } catch (err) {
    // 已经有授权了（刚被批准）、或已经有一条在等：按最新的状态重画
    if (['team.already_authorised', 'team.request_pending'].includes(apiErrorCode(err))) { await load(); void space.refresh() }
    else error.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    busy.value = false
  }
}

async function withdraw() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    state.value = unwrap(await teamApi.withdrawCreationRequest())
    void space.refresh()
    MessagePlugin.success(t('spaces.create.withdrawn'))
  } catch (err) {
    error.value = apiErrorMessage(err, t('common.operationFailed'))
    await load()
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.tc { width: 460px; }
.tc-avatar { display: flex; align-items: center; gap: 10px; }
.tc-preview { width: 44px; height: 44px; border-radius: 12px; object-fit: cover; background: var(--media-bg); flex: none; }
.tc-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.tc-note { display: flex; gap: 8px; align-items: flex-start; margin: 4px 0 0; }
.tc-note .lc-ic { margin-top: 2px; color: var(--text-3); }
.tc-why { color: var(--text-2); line-height: 1.7; margin: 0 0 16px; }
.tc-state { padding: 14px 16px; border-radius: var(--r-md); border: 1px solid var(--line); background: rgb(var(--c-film) / .05); }
.tc-state p { margin: 8px 0 0; line-height: 1.6; font-size: 13px; }
.tc-quote { padding: 8px 12px; border-left: 2px solid var(--line-3); color: var(--text-2); white-space: pre-wrap; word-break: break-word; }
.tc-rejected { margin-bottom: 16px; }
.tc-last { margin-bottom: 0; }
.lc-alert b { display: block; color: var(--text); font-weight: 600; }
.lc-alert p { margin: 4px 0 0; color: var(--text-2); line-height: 1.6; }
.lc-error-text { margin: 12px 0 0; }
</style>
