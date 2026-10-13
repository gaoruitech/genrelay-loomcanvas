<template>
  <TeamDialog :title="t('assetsPage.folders.title')" :width="520" :busy="busy" data-testid="folder-dialog" @close="emit('close')" @submit="create">
    <div class="af-new">
      <label class="lc-inp af-inp">
        <LcIcon name="folder" />
        <input
          ref="nameEl" v-model.trim="name" maxlength="120" autocomplete="off" data-autofocus :disabled="busy"
          :placeholder="t('assetsPage.folders.newPlaceholder')" :aria-label="t('assetsPage.folders.newLabel')" data-testid="folder-new-name"
        />
      </label>
      <button class="lc-btn primary quiet" type="submit" :disabled="busy || !name" data-act="folder-create"><LcIcon name="plus" size="s" />{{ t('assetsPage.folders.create') }}</button>
    </div>
    <p v-if="createError" class="lc-error-text" role="alert">{{ createError }}</p>

    <p v-if="!folders.length" class="lc-empty af-empty" data-testid="folder-empty">{{ t('assetsPage.folders.empty') }}</p>
    <div v-else ref="listEl" class="af-list" role="list" :aria-label="t('assetsPage.folders.title')">
      <div v-for="f in folders" :key="f.name" class="af-row" role="listitem" :class="{ open: asking?.name === f.name }" :data-folder="f.name">
        <div class="af-line">
          <LcIcon name="folder" class="af-ic" />
          <b v-tip="{ text: f.name, clipped: true }">{{ f.name }}</b>
          <span class="lc-tag af-n" :class="{ dim: f.empty }">{{ f.empty ? t('assetsPage.folders.isEmpty') : t('assetsPage.folders.count', { n: formatInt(f.count) }, f.count) }}</span>
          <ActionMenu v-if="menuOf(f).length" :items="menuOf(f)" :label="t('assetsPage.folders.moreOf', { name: f.name })" :disabled="busy" @pick="(k) => onPick(f, k)" />
          <span v-else class="af-nomenu" aria-hidden="true" />
        </div>

        <!-- 删一个空分组：就地确认 -->
        <div v-if="asking?.name === f.name && asking.step === 'confirm'" class="af-ask" role="group" :aria-label="t('assetsPage.folders.deleteAsk', { name: f.name })">
          <p>{{ t('assetsPage.folders.deleteAsk', { name: f.name }) }}</p>
          <div class="af-ops">
            <button class="lc-btn sm" type="button" data-first :disabled="busy" @click="asking = null">{{ t('common.cancel') }}</button>
            <button class="lc-btn sm danger" type="button" :disabled="busy" data-act="folder-delete-ok" @click="remove(f)">{{ t('assetsPage.folders.delete') }}</button>
          </div>
        </div>

        <!-- 里面还有素材：说明，并给出路。这一块是界面自己出的（数量就在这一行上），不拿一次注定被拒绝的删除请求去换 -->
        <div v-else-if="asking?.name === f.name && asking.step === 'notEmpty'" class="af-ask warn" role="alert" data-testid="folder-not-empty">
          <p>{{ asking.message || notEmptyText(f) }}</p>
          <p class="af-ask-sub">{{ canDissolve ? t('assetsPage.folders.notEmptyHintManager') : t('assetsPage.folders.notEmptyHint') }}</p>
          <div class="af-ops">
            <button class="lc-btn sm text" type="button" :disabled="busy" @click="asking = null">{{ t('common.cancel') }}</button>
            <button class="lc-btn sm" type="button" data-first :disabled="busy" data-act="folder-view" @click="emit('view', f.name)">{{ t('assetsPage.folders.viewAssets') }}</button>
            <button v-if="canDissolve" class="lc-btn sm danger" type="button" :disabled="busy" data-act="folder-dissolve" @click="dissolve(f)">{{ t('assetsPage.folders.dissolve') }}</button>
          </div>
        </div>
      </div>
    </div>
    <p class="lc-help af-help">{{ t('assetsPage.folders.help') }}</p>

    <template #foot>
      <button class="lc-btn" type="button" :disabled="busy" @click="emit('close')">{{ t('common.close') }}</button>
    </template>
  </TeamDialog>
</template>

<script setup lang="ts">
/**
 * 素材分组：新建、看每个分组里有几个素材、删除空的分组。
 * 分组是独立存在的——里面的素材都移走了它也还在，不用了要手动删；里面还有素材的分组删不了（服务端会用
 * 409 asset.folder_not_empty 拒绝）。数量界面上本来就有，所以不空的分组不去发那次注定被拒绝的请求——
 * 浏览器会把每一次 4xx 都记成一条控制台错误——而是直接说明，并给两条出路：去看这些素材（自己移走 / 删掉），
 * 或者——团长、管理员，以及个人空间里——解散分组：分组没了，素材留着，变成不在任何分组里。
 * 真发出去的删除只针对界面上是空的分组；那一刻正好有人往里放了东西，服务端的 409 照样接得住。
 * 团队里成员只能删自己建的空分组（接口给的 canDelete 说了算）。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { userAssetApi, unwrap, apiErrorCode, apiErrorMessage } from '@/utils/api'
import { MessagePlugin } from '@/utils/feedback'
import { useSpaceStore } from '@/stores/space'
import { formatInt } from '@/components/space/format'
import LcIcon from '@/components/LcIcon.vue'
import ActionMenu, { type ActionMenuItem } from '@/components/ActionMenu.vue'
import TeamDialog from '@/components/team/TeamDialog.vue'
import type { AssetFolder } from '@/types'

const props = defineProps<{ folders: AssetFolder[] }>()
const emit = defineEmits<{
  (e: 'close'): void
  /** 分组变了（多了、少了、解散了）：外面重取列表 */
  (e: 'changed', what: { created?: string; removed?: string }): void
  /** 去看这个分组里的素材：外面把筛选切过去并关掉弹窗 */
  (e: 'view', name: string): void
}>()

const { t } = useI18n()
const space = useSpaceStore()
/** 解散（分组没了、素材留着）：个人空间里随便，团队里要团长、管理员 */
const canDissolve = computed(() => !space.isTeam || space.can('asset:manage_all'))

const busy = ref(false)

// ---- 新建 ----
const name = ref('')
const nameEl = ref<HTMLInputElement | null>(null)
const createError = ref('')
async function create() {
  if (busy.value || !name.value) return
  busy.value = true
  createError.value = ''
  try {
    const out = unwrap(await userAssetApi.createFolder(name.value))
    MessagePlugin[out.existed ? 'info' : 'success'](t(out.existed ? 'assetsPage.folders.existed' : 'assetsPage.folders.created', { name: out.name }))
    emit('changed', { created: out.name })
    name.value = ''
  } catch (err) {
    // 名字不合适、分组数到顶了（asset.folder_max）：服务端的话留在输入框下面
    createError.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    busy.value = false
    void nextTick(() => nameEl.value?.focus({ preventScroll: true }))
  }
}

// ---- 每一行的菜单 ----
function menuOf(f: AssetFolder): ActionMenuItem[] {
  const items: ActionMenuItem[] = []
  if (!f.empty) items.push({ key: 'view', icon: 'eye', label: t('assetsPage.folders.viewAssets') })
  // 空的：删得了才出（团队里成员只能删自己建的）。
  // 不空的：能解散的人（个人空间、团长、管理员）也给这一项——点了就地说明它为什么删不了，并给出「解散」这条路；
  // 成员对不空的分组什么也做不了，就不摆一个注定被拒绝的按钮。
  if (f.canDelete || (!f.empty && canDissolve.value)) items.push({ key: 'delete', icon: 'trash', label: t('assetsPage.folders.delete'), danger: true })
  return items
}
/** message：服务端拒绝时说的那句话（只有真的被拒绝过才有）；空着就用界面自己的那一句（notEmptyText） */
const asking = ref<{ name: string; step: 'confirm' | 'notEmpty'; message: string } | null>(null)
const notEmptyText = (f: AssetFolder) => t('assetsPage.folders.notEmpty', { name: f.name, n: formatInt(f.count) }, f.count)
/** 就地那一块出来之后，焦点放到它里面（取消 / 查看素材）；收起之后回到这一行的「更多」上 */
const listEl = ref<HTMLElement | null>(null)
watch(asking, async (v, old) => {
  await nextTick()
  if (v) listEl.value?.querySelector<HTMLElement>('.af-ask [data-first]')?.focus({ preventScroll: true })
  // 那一行已经没了（删掉了、解散了）：焦点回到新建的输入框，别掉到页面上去
  else if (old) (rowOf(old.name)?.querySelector<HTMLElement>('[data-act="row-menu"]') || nameEl.value)?.focus({ preventScroll: true })
})
// 列表重取之后：展开着的那一块跟上新的数量（刚被别人搬空了 → 改成问「删除空分组？」；刚有人放了东西进来 → 改成说明；
// 分组没了 → 收起）；原来有焦点的那一行可能已经不在了（删掉了、解散了）：焦点回到新建的输入框，别掉到页面上去
watch(() => props.folders, async (list) => {
  const a = asking.value
  if (a && !busy.value) {
    const f = list.find((x) => x.name === a.name)
    if (!f) asking.value = null
    else if (a.step === 'notEmpty' && f.empty) asking.value = f.canDelete ? { name: a.name, step: 'confirm', message: '' } : null
    else if (a.step === 'confirm' && !f.empty) asking.value = canDissolve.value ? { name: a.name, step: 'notEmpty', message: '' } : null
    // 数量变了但还是不空：服务端当时说的那个数过时了，换回界面自己的那一句（跟着这一行的数量走）
    else if (a.step === 'notEmpty' && a.message) asking.value = { ...a, message: '' }
  }
  await nextTick()
  const box = nameEl.value?.closest('[role="dialog"]')
  if (box && !box.contains(document.activeElement)) nameEl.value?.focus({ preventScroll: true })
})
const rowOf = (folder: string) => Array.from(listEl.value?.querySelectorAll<HTMLElement>('.af-row') || []).find((el) => el.dataset.folder === folder)
function onPick(f: AssetFolder, key: string) {
  if (key === 'view') { emit('view', f.name); return }
  if (key !== 'delete') return
  // 空的先问一句。不空的不发删除请求（注定是 409）：就地说明并给出路，顺手让外面重取一次——
  // 屏幕上的数字要是过时了，这一块会跟着新的数量变（见上面对 props.folders 的 watch）
  if (f.empty) { asking.value = { name: f.name, step: 'confirm', message: '' }; return }
  asking.value = { name: f.name, step: 'notEmpty', message: '' }
  emit('changed', {})
}

async function remove(f: AssetFolder) {
  if (busy.value) return
  busy.value = true
  try {
    await userAssetApi.removeFolder(f.name)
    asking.value = null
    MessagePlugin.success(t('assetsPage.folders.deleted', { name: f.name }))
    emit('changed', { removed: f.name })
  } catch (err) {
    const code = apiErrorCode(err)
    if (code === 'asset.folder_not_empty') {
      // 界面上是空的，可就在这一刻有人往里放了东西：服务端的话里有现在的数量；外面重取之后换回界面自己的那一句
      asking.value = { name: f.name, step: 'notEmpty', message: apiErrorMessage(err, '') }
      emit('changed', {})
    } else {
      asking.value = null
      MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
      // 已经被别人删了、或者不是自己建的：列表重取
      emit('changed', code === 'asset.folder_not_found' ? { removed: f.name } : {})
    }
  } finally {
    busy.value = false
  }
}

async function dissolve(f: AssetFolder) {
  if (busy.value) return
  busy.value = true
  try {
    const out = unwrap(await userAssetApi.deleteFolder({ name: f.name }))
    asking.value = null
    MessagePlugin.success(t('assetsPage.folders.dissolved', { name: f.name, n: Number(out?.moved) || 0 }))
    emit('changed', { removed: f.name })
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
    emit('changed', {})
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.af-new { display: flex; gap: 8px; }
.af-inp { flex: 1; min-width: 0; }
.af-empty { margin-top: 16px; }
.af-list { margin: 16px 0 0; border: 1px solid var(--line); border-radius: var(--r-md); max-height: min(340px, calc(calc(100 * var(--lc-vh)) - 380px)); min-height: 52px; overflow-y: auto; overscroll-behavior: contain; }
.af-row + .af-row { border-top: 1px solid var(--line); }
.af-row.open { background: rgb(var(--c-film) / .04); }
.af-line { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; min-height: 44px; }
.af-ic { flex: none; color: var(--text-3); }
.af-line b { flex: 1; min-width: 0; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.af-n { flex: none; font-variant-numeric: tabular-nums; }
.af-n.dim { color: var(--text-3); }
.af-nomenu { flex: none; width: 28px; }
.af-ask { margin: 0 14px 12px; padding: 10px 12px; border-radius: var(--r-md); background: var(--danger-dim); font-size: 13px; line-height: 1.6; }
.af-ask.warn { background: var(--warning-dim); }
.af-ask p { margin: 0; color: var(--text); overflow-wrap: anywhere; }
.af-ask p.af-ask-sub { margin-top: 4px; color: var(--text-2); font-size: 12px; }
.af-ops { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 10px; }
.af-help { margin: 12px 0 0; }
@media (max-width: 600px) {
  .af-new { flex-wrap: wrap; }
  .af-inp { flex: 1 1 100%; }
  .af-new .lc-btn { flex: 1 1 auto; }
}
</style>
