<template>
  <!-- 团队里的「复制一份」「删除」：菜单已经收起，贴着按钮的气泡没处挂，用一个小确认框 -->
  <Teleport :to="$lcPortal">
    <div v-if="confirm" class="lc-mask lc-sheet" @click.self="closeConfirm">
      <div v-dialog="{ onEscape: closeConfirm, busy: working }" class="lc-dialog ca-confirm" :role="confirm.kind === 'delete' ? 'alertdialog' : 'dialog'" aria-modal="true" :aria-label="confirmText.title">
        <div class="lc-dialog-head">
          <span class="ca-h">{{ confirmText.title }}</span>
          <button class="lc-x" type="button" :aria-label="t('common.close')" :disabled="working" @click="closeConfirm">×</button>
        </div>
        <div class="lc-dialog-body"><p class="ca-hint">{{ confirmText.hint }}</p></div>
        <div class="lc-dialog-foot">
          <!-- 删除：焦点先落在「取消」上，回车不会误删；复制一份：落在「复制」上 -->
          <button class="lc-btn" type="button" :disabled="working" :data-autofocus="confirm.kind === 'delete' ? '' : undefined" @click="closeConfirm">{{ t('common.cancel') }}</button>
          <button class="lc-btn" :class="confirm.kind === 'delete' ? 'danger' : 'primary'" type="button" :disabled="working" :data-autofocus="confirm.kind === 'delete' ? undefined : ''" data-act="confirm-ok" @click="doConfirm">{{ confirmText.ok }}</button>
        </div>
      </div>
    </div>
  </Teleport>

  <CanvasNameDialog
    v-model="renameOpen"
    :title="t('views.list.renameTitle')"
    :initial="renameTarget?.name || ''"
    :ok-text="t('common.save')"
    :busy-text="t('common.saving')"
    :busy="renaming"
    @submit="submitRename"
  />
  <CopyToSpaceDialog v-if="copyTarget" kind="canvas" :id="copyTarget.id" :name="copyTarget.name" @close="copyTarget = null" @copied="loadCopyTargets" />
  <CanvasAccessDialog v-if="accessTarget" :canvas="accessTarget" @close="accessTarget = null" @saved="onAccessSaved" />
</template>

<script setup lang="ts">
/**
 * 画布卡片上能做的事，集中在一处：重命名、复制一份、复制到别的空间、团队权限、打包下载、删除。
 * 一页放一个（画布列表、团队首页各一个）：卡片的「…」菜单有哪几项问这里要（itemsOf），选了哪一项交回来（run）。
 *
 * 规矩：
 *  - 一项操作出不出现，只看这张画布自己的 access（服务端按「这个人对这张画布」算好的），不按角色猜。
 *  - 藏起来不算数：角色可能在页面开着的时候变了，服务端拒绝（team.forbidden）时把原话给用户，并让列表重取。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { workflowApi, teamApi, unwrap, apiErrorCode, apiErrorMessage, SPACE_GONE_CODES, type WorkflowSummary } from '@/utils/api'
import { useSpaceStore } from '@/stores/space'
import { useEmbed } from '@/embed/context'
import { vDialog } from '@/directives/dialog'
import type { ActionMenuItem } from '@/components/ActionMenu.vue'
import type { CopyTarget } from '@/types'
import CanvasNameDialog from '@/components/workbench/CanvasNameDialog.vue'
import CopyToSpaceDialog from '@/components/space/CopyToSpaceDialog.vue'
import CanvasAccessDialog from '@/components/space/CanvasAccessDialog.vue'

type ActionKey = 'rename' | 'duplicate' | 'copyTo' | 'access' | 'download' | 'delete'

const emit = defineEmits<{
  /** 列表要重取（多了一张、少了一张，或者权限变了） */
  (e: 'changed'): void
  /** 这一张就地改了（名字、可见范围），不用整页重取 */
  (e: 'patched', canvas: WorkflowSummary): void
}>()

const { t } = useI18n()
const space = useSpaceStore()

/* ===== 能复制到哪儿 =====
   问服务端（GET /api/spaces/copy-targets）：自己所在的每一个空间，去不了的也在里面、带着原因。
   只要除了当前空间之外还有别的空间，就出「复制到…」这一项——哪怕现在都去不了：弹窗里会逐个说明为什么。
   取不到（老服务端、断网）时按空间列表自己算，和以前一样。 */
const serverTargets = ref<CopyTarget[] | null>(null)
async function loadCopyTargets() {
  if (!space.teamsEnabled) { serverTargets.value = null; return }
  try { serverTargets.value = unwrap(await teamApi.copyTargets('canvas')).targets } catch { serverTargets.value = null }
}
onMounted(loadCopyTargets)
watch(() => [space.currentId, space.spaces.length, space.settings?.copyToPersonal], loadCopyTargets)

const others = computed<{ kind: string }[]>(() => {
  if (!space.teamsEnabled) return []
  if (serverTargets.value) return serverTargets.value.filter((s) => !s.current)
  const noPersonal = space.isTeam && !space.isTeamOwner && space.settings?.copyToPersonal === false
  return space.spaces.filter((s) => {
    if (s.kind !== 'team') return !!space.currentId && !noPersonal
    return s.id !== space.currentId && (s.status || 'active') === 'active'
  })
})
const canCopyTo = computed(() => others.value.length > 0)
const copyLabel = computed(() => {
  if (!space.isTeam) return t('views.team.copyToTeam')
  return others.value.some((s) => s.kind === 'team') ? t('views.team.copyToOther') : t('views.team.copyToPersonal')
})

/* ===== 菜单 ===== */
const downloadingId = ref('')
const canDownload = useEmbed().features.batchDownload
/** 这张画布的「…」里有哪几项：每一项出不出现只看这张画布自己的 access */
function itemsOf(w: WorkflowSummary): ActionMenuItem[] {
  // 个人空间的画布没有 access 之外的限制；老数据没带 access 时按「自己的」算
  const a = w.access
  const out: (ActionMenuItem & { key: ActionKey })[] = []
  if (!a || a.canEdit) out.push({ key: 'rename', icon: 'edit', label: t('views.team.rename') })
  out.push({ key: 'duplicate', icon: 'copy', label: t('views.team.duplicate') })
  if (canCopyTo.value) out.push({ key: 'copyTo', icon: 'external', label: copyLabel.value })
  if (space.isTeam) out.push({ key: 'access', icon: 'users', label: t('views.team.access') })
  // 打包下载是一项可以关掉的功能（features.batchDownload）
  if (canDownload) out.push({ key: 'download', icon: 'download', label: t('views.team.download'), disabled: !!downloadingId.value })
  if (!a || a.canDelete) out.push({ key: 'delete', icon: 'trash', label: t('common.delete'), danger: true })
  return out
}

/** 菜单里选了一项。菜单这时已经收起、焦点回到了「…」上：接下来开的弹窗关掉后，焦点就回到那儿 */
function run(key: string, w: WorkflowSummary) {
  if (!w) return
  if (key === 'rename') rename(w)
  else if (key === 'duplicate') confirm.value = { kind: 'duplicate', canvas: w }
  else if (key === 'copyTo') copyTo(w)
  else if (key === 'access') accessTarget.value = w
  else if (key === 'download') void download(w)
  else if (key === 'delete') confirm.value = { kind: 'delete', canvas: w }
}

/* ===== 出错 ===== */
function fail(err: any, fallback: string) {
  const code = apiErrorCode(err)
  // 整个空间没了的那三种，外壳会统一处理并说明原因，这里不再弹第二条
  if ((SPACE_GONE_CODES as readonly string[]).includes(code)) return
  MessagePlugin.error(apiErrorMessage(err, fallback))
  // 没权限（角色刚变过）或画布已经不在了：屏幕上的列表是旧的，重取
  // 被别人改过（409）、被别人锁着（423）也一样：卡片上的版本和「谁在编辑」已经过时
  if (code === 'team.forbidden' || [403, 404, 409, 423].includes(err?.response?.status)) emit('changed')
}

/* ===== 重命名 ===== */
const renameOpen = ref(false)
const renameTarget = ref<WorkflowSummary | null>(null)
const renaming = ref(false)
function rename(w: WorkflowSummary) {
  renameTarget.value = w
  renameOpen.value = true
}
async function submitRename(name: string) {
  const w = renameTarget.value
  if (!w || renaming.value) return
  if (name === w.name) { renameOpen.value = false; return }
  renaming.value = true
  try {
    // 名字不是内容：有编辑权就能改，不要编辑锁、不带版本、不会冲突——别人正在编辑这张画布时也一样。
    // 对方编辑器里的标题会在下一次心跳时跟着变，对方的下一次保存也不会因此冲突。
    const res = await workflowApi.rename(w.id, name)
    if (res.data.result !== 0) {
      MessagePlugin.error(res.data.message || t('views.list.renameFailed'))
      return
    }
    const saved = res.data.data
    // 列表里就地改名，不为这一个字段整页重拉。谁在编辑不受改名影响：照服务端说的来
    emit('patched', { ...w, ...(saved ? { updatedAt: saved.updatedAt, metaRevision: saved.metaRevision, lock: saved.lock ?? null } : {}), name: saved?.name || name })
    MessagePlugin.success(t('views.list.renamed'))
    renameOpen.value = false
  } catch (err) {
    fail(err, t('views.list.renameFailed'))
    // 这张卡片已经过时（没权限了、画布没了）：弹窗收起，列表会重取
    if ([403, 404].includes((err as any)?.response?.status)) renameOpen.value = false
  } finally {
    renaming.value = false
  }
}

/* ===== 复制一份 / 删除 ===== */
const duplicating = ref(false)
const deleting = ref(false)
const working = computed(() => duplicating.value || deleting.value)
const confirm = ref<{ kind: 'duplicate' | 'delete'; canvas: WorkflowSummary } | null>(null)
const confirmText = computed(() => {
  const c = confirm.value
  if (!c) return { title: '', hint: '', ok: '' }
  const name = c.canvas.name
  if (c.kind === 'duplicate') {
    return {
      title: t('views.list.duplicateConfirm', { name }),
      hint: space.isTeam ? t('views.team.duplicateHint') : t('views.list.duplicateHint'),
      ok: duplicating.value ? t('views.team.working') : t('common.copy'),
    }
  }
  return {
    title: t('views.list.deleteConfirm', { name }),
    hint: space.isTeam ? t('views.team.deleteHint') : t('views.list.deleteHint'),
    ok: deleting.value ? t('views.team.working') : t('common.delete'),
  }
})
function closeConfirm() { if (!working.value) confirm.value = null }
async function doConfirm() {
  const c = confirm.value
  if (!c) return
  if (c.kind === 'duplicate') await duplicate(c.canvas)
  else await remove(c.canvas)
  confirm.value = null
}

async function duplicate(w: WorkflowSummary) {
  if (!w || duplicating.value) return
  duplicating.value = true
  try {
    const res = await workflowApi.duplicate(w.id, t('common.copyName', { name: w.name }))
    if (res.data.result === 0) {
      MessagePlugin.success(space.isTeam ? t('views.team.duplicated') : t('views.list.duplicated'))
      emit('changed')
    } else {
      MessagePlugin.error(res.data.message || t('views.list.duplicateFailed'))
    }
  } catch (err) {
    fail(err, t('views.list.duplicateFailed'))
  } finally {
    duplicating.value = false
  }
}

/** 确认过了才会走到这里，所以这里不再自己弹确认 */
async function remove(w: WorkflowSummary) {
  if (!w || deleting.value) return
  deleting.value = true
  try {
    const res = await workflowApi.remove(w.id)
    if (res.data.result === 0) {
      MessagePlugin.success(t('views.list.deleted'))
      emit('changed')
    } else {
      MessagePlugin.error(res.data.message || t('views.list.deleteFailed'))
    }
  } catch (err) {
    fail(err, t('views.list.deleteFailed'))
  } finally {
    deleting.value = false
  }
}

/* ===== 复制到别的空间 / 团队权限 ===== */
const copyTarget = ref<WorkflowSummary | null>(null)
function copyTo(w: WorkflowSummary) { copyTarget.value = w }

const accessTarget = ref<WorkflowSummary | null>(null)
function onAccessSaved(canvas: WorkflowSummary) { emit('patched', canvas) }

/* ===== 打包下载 ===== */
/** 接口按 blob 收，出错时错误信息也裹在 blob 里，得自己拆出来 */
async function blobErrorMessage(data: unknown): Promise<string> {
  if (!(data instanceof Blob)) return ''
  try { return JSON.parse(await data.text())?.message || '' } catch { return '' }
}

/**
 * 整张画布打包下载：不传 urls，后端把画布里所有图片和视频打成一个 zip。
 * 打包是串行拉流，大画布会等比较久，loading 一直挂到 blob 落地为止。
 */
async function download(w: WorkflowSummary) {
  if (downloadingId.value) return
  downloadingId.value = w.id
  MessagePlugin.loading(t('views.list.downloading', { name: w.name }), 0)
  try {
    const resp = await workflowApi.downloadZip(w.id)
    const blob = resp.data as Blob
    // 空画布之类的情况后端可能回一个 JSON 而不是 zip
    if (blob.type.includes('json')) {
      throw new Error((await blobErrorMessage(blob)) || t('download.nothing'))
    }
    const safeName = (w.name || t('download.zipName')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
    const href = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = href
    a.download = `${safeName}.zip`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
    MessagePlugin.closeAll()
    MessagePlugin.success(t('download.zipDone'))
  } catch (err: any) {
    MessagePlugin.closeAll()
    const fromBlob = await blobErrorMessage(err?.response?.data)
    MessagePlugin.error(fromBlob || (err?.isAxiosError ? '' : err?.message) || t('download.zipFailed'))
    if (err?.response?.status === 403 || err?.response?.status === 404) emit('changed')
  } finally {
    downloadingId.value = ''
  }
}

defineExpose({ itemsOf, run, rename, duplicate, remove, copyTo, download, canCopyTo, canDownload, copyLabel, duplicating, deleting, downloadingId })
</script>

<style scoped>
.ca-confirm { width: 440px; }
.ca-h { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ca-hint { margin: 0; color: var(--text-2); line-height: 1.7; }
</style>
