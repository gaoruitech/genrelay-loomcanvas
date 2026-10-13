<template>
  <div
    ref="pageEl" class="lc-page as-page"
    @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop"
  >
    <div class="lc-page-inner">
      <div class="lc-page-head">
        <div class="as-head-text">
          <h1 class="lc-ph1">{{ t('assetsPage.title') }}</h1>
          <p class="lc-ph-sub">{{ space.isTeam ? t('assetsPage.team.sub', { team: space.name }) : t('assetsPage.sub') }}</p>
        </div>
        <span class="lc-sp" />
        <button class="lc-btn primary as-upload-btn" type="button" :disabled="uploading" @click="pickFiles">
          <LcIcon name="upload" />{{ uploading ? t('common.uploading') : t('assetsPage.upload') }}
        </button>
        <input ref="fileInput" class="as-file" type="file" accept="image/*,video/*" multiple tabindex="-1" @change="onFileInput" />
      </div>

      <AssetsTabs current="assets" />

      <!-- 团队里：这是全队共用的一个库，谁能动什么先说清楚 -->
      <p v-if="space.isTeam" class="as-rule" data-testid="as-team-rule"><LcIcon name="users" size="s" />{{ t('assetsPage.team.rule') }}</p>
      <!-- 个人空间里、而人又在某个团队里：这里的素材团队里看不到，要用得复制过去 -->
      <p v-else-if="inTeams" class="as-rule" data-testid="as-personal-hint"><LcIcon name="info" size="s" />{{ t('assetsPage.team.personalHint') }}</p>

      <div class="lc-fbar as-fbar">
        <div class="lc-seg" role="group" :aria-label="t('assetsPage.filter.kind')">
          <button type="button" :class="{ on: kind === '' }" @click="kind = ''">
            {{ t('common.all') }}<span v-if="counts" class="n">{{ countAll }}</span>
          </button>
          <button v-for="k in KINDS" :key="k" type="button" :class="{ on: kind === k }" @click="kind = k">
            {{ t('assetsPage.kinds.' + k) }}<span v-if="counts" class="n">{{ counts[k] }}</span>
          </button>
        </div>
        <div class="as-sel">
          <LcSelect v-model="type" :options="typeOptions" size="sm" :aria-label="t('assetsPage.filter.type')" />
        </div>
        <div v-if="folderList.length || folder" class="as-sel wide">
          <LcSelect v-model="folder" :options="folderOptions" :searchable="folderOptions.length > 9" size="sm" :aria-label="t('assetsPage.filter.folder')" data-testid="as-folder-filter" />
        </div>
        <!-- 分组：新建、看数量、删空的。一个分组都没有时这颗按钮直接叫「新建分组」 -->
        <button class="lc-btn sm as-folders-btn" type="button" data-act="folders" @click="foldersOpen = true">
          <LcIcon :name="folderList.length ? 'folder' : 'plus'" size="s" />{{ folderList.length ? t('assetsPage.folders.manage') : t('assetsPage.folders.create') }}
        </button>
        <label class="lc-inp sm grow">
          <LcIcon name="search" size="s" />
          <input v-model="searchText" type="search" :placeholder="t('assetsPage.filter.search')" :aria-label="t('assetsPage.filter.search')" />
        </label>
        <button v-if="filtered" class="lc-btn sm text as-reset" type="button" @click="resetFilters">{{ t('assetsPage.filter.reset') }}</button>
      </div>

      <!-- 批量操作条：选中了才出现 -->
      <div v-if="selectedItems.length" class="as-selbar">
        <button
          class="lc-cb" :class="{ on: allSelected }" type="button" role="checkbox" :aria-checked="allSelected"
          v-tip="allSelected ? t('assetsPage.sel.cancel') : t('common.all')"
          :aria-label="allSelected ? t('assetsPage.sel.cancel') : t('common.all')" @click="toggleAll"
        />
        <b>{{ t('assetsPage.sel.count', { n: selectedItems.length }) }}</b>
        <span class="lc-t2 as-selbar-sub">{{ t('assetsPage.sel.breakdown', selBreakdown) }}</span>
        <span v-if="lockedCount" class="as-selbar-lock" data-testid="as-locked"><LcIcon name="lock" size="s" />{{ t('assetsPage.team.locked', { n: lockedCount }) }}</span>
        <span class="lc-sp" />
        <div class="as-selbar-acts">
          <button class="lc-btn sm" type="button" :disabled="busy" @click="downloadSelected"><LcIcon name="download" size="s" />{{ t('assetsPage.sel.download') }}</button>
          <button v-if="canManageSel" class="lc-btn sm" type="button" :disabled="busy" data-act="move" @click="openMove"><LcIcon name="folder" size="s" />{{ t('assetsPage.sel.move') }}</button>
          <button v-if="canManageSel && selectedItems.length === 1" class="lc-btn sm" type="button" :disabled="busy" data-act="rename" @click="openRename"><LcIcon name="edit" size="s" />{{ t('assetsPage.sel.rename') }}</button>
          <button v-if="selectedItems.length === 1" class="lc-btn sm" type="button" @click="copyLink"><LcIcon name="copy" size="s" />{{ t('assetsPage.sel.copyLink') }}</button>
          <button v-if="canCopyOut && selectedItems.length === 1" class="lc-btn sm" type="button" :disabled="busy" data-act="copy-to" @click="copyTo = selectedItems[0]"><LcIcon name="arrow" size="s" />{{ t('assetsPage.team.copyTo') }}</button>
          <button v-if="canManageSel" class="lc-btn sm danger" type="button" :disabled="busy" data-act="delete" @click="removeOpen = true"><LcIcon name="trash" size="s" />{{ t('assetsPage.sel.delete') }}</button>
          <button class="lc-btn sm text" type="button" @click="clearSelection">{{ t('assetsPage.sel.cancel') }}</button>
        </div>
      </div>

      <div v-if="loadError" class="lc-alert as-error" role="alert">
        <LcIcon name="warn" />
        <span>{{ t('assetsPage.loadFailed') }} · {{ loadError }}</span>
        <button class="lc-btn sm" type="button" @click="reloadAll">{{ t('common.retry') }}</button>
      </div>

      <!-- 一张都没有：整块空态，不摆网格 -->
      <div v-else-if="!loading && !items.length && !filtered && !uploading" class="lc-card as-empty">
        <span class="as-ti"><LcIcon name="assets" size="l" /></span>
        <h2>{{ space.isTeam ? t('assetsPage.team.empty') : t('assetsPage.empty') }}</h2>
        <p>{{ space.isTeam ? t('assetsPage.team.emptyHint') : t('assetsPage.emptyHint') }}</p>
        <button class="lc-btn primary" type="button" @click="pickFiles"><LcIcon name="upload" />{{ t('assetsPage.upload') }}</button>
        <small>{{ limitText }}</small>
      </div>

      <template v-else>
        <div class="as-grid">
          <!-- 第一格固定是上传区（整页也接受拖入） -->
          <button class="lc-card as as-up" type="button" :disabled="uploading" @click="pickFiles">
            <template v-if="uploading">
              <span class="lc-ring" :style="{ '--p': upload.pct }"><span>{{ upload.pct }}%</span></span>
              <span class="as-up-t">{{ t('assetsPage.drop.uploading', { i: upload.index, n: upload.count }) }}</span>
              <span class="as-up-s one">{{ upload.name }}</span>
            </template>
            <template v-else>
              <span class="as-ti"><LcIcon name="upload" size="l" /></span>
              <span class="as-up-t">{{ t('assetsPage.drop.title') }}</span>
              <span class="as-up-s">{{ t('assetsPage.drop.pick') }}<br />{{ t('assetsPage.drop.formats') }}<template v-if="maxMb"><br />{{ t('assetsPage.drop.limit', { mb: maxMb }) }}</template></span>
            </template>
          </button>

          <template v-if="loading && !items.length">
            <div v-for="n in 11" :key="'s' + n" class="lc-card as skel-card" aria-hidden="true">
              <div class="skel thumb" /><div class="meta"><span class="skel w70" /><span class="skel w50" /></div>
            </div>
          </template>

          <div
            v-for="it in shown" :key="it.id" class="lc-card as" :class="{ on: selected.has(it.id) }"
          >
            <button
              class="lc-thumb as-thumb" type="button"
              v-tip="selected.size ? t('assetsPage.select') : t('assetsPage.preview')"
              :aria-label="(selected.size ? t('assetsPage.select') : t('assetsPage.preview')) + ' ' + nameOf(it)"
              @click="onCardClick(it)"
            >
              <img v-if="it.nodeType === 'IMAGE' || hasOwnPoster(it)" :src="ensureHttps(it.thumbnailUrl || it.mediaUrl)" alt="" loading="lazy" />
              <video v-else :src="ensureHttps(it.mediaUrl)" muted playsinline preload="metadata" />
              <span class="lc-bd tag" :class="it.nodeType === 'VIDEO' ? 'vid' : 'img'">{{ t('assetsPage.types.' + (it.nodeType === 'VIDEO' ? 'video' : 'image')) }}</span>
            </button>
            <button
              class="as-pick" type="button" role="checkbox" :aria-checked="selected.has(it.id)"
              v-tip="selected.has(it.id) ? t('assetsPage.deselect') : t('assetsPage.select')"
              :aria-label="(selected.has(it.id) ? t('assetsPage.deselect') : t('assetsPage.select')) + ' ' + nameOf(it)"
              @click="toggle(it)"
            ><LcIcon v-if="selected.has(it.id)" name="check" size="s" /></button>
            <div class="meta">
              <b v-tip="{ text: nameOf(it), clipped: true }">{{ nameOf(it) }}</b>
              <small v-tip="{ text: metaOf(it), clipped: true }">{{ metaOf(it) }}</small>
              <!-- 团队里：谁加的 -->
              <small v-if="it.scope === 'team'" class="as-by">
                <template v-if="it.mine">
                  <SpaceAvatar shape="round" :size="16" :name="personName(uploaderOf(it))" :seed="it.createdBy?.id" />
                  <span>{{ t('assetsPage.team.byMe') }}</span>
                </template>
                <PersonName v-else :person="uploaderOf(it)" :avatar="16" />
              </small>
            </div>
          </div>
        </div>

        <!-- 选中的分组是空的：说清楚它是空的（而不是「没有符合条件的」），并且可以就地删掉 -->
        <div v-if="!loading && !shown.length && emptyFolder" class="lc-empty as-none" data-testid="as-empty-folder">
          <p>{{ t('assetsPage.folders.emptyHere', { name: emptyFolder.name }) }}</p>
          <small>{{ t('assetsPage.folders.emptyHereHint') }}</small>
          <div class="as-none-ops">
            <button class="lc-btn sm" type="button" @click="resetFilters">{{ t('assetsPage.filter.reset') }}</button>
            <button v-if="emptyFolder.canDelete" class="lc-btn sm danger" type="button" :disabled="busy" data-act="folder-delete-here" @click="removeEmptyFolder(emptyFolder.name)">{{ t('assetsPage.folders.delete') }}</button>
          </div>
        </div>
        <div v-else-if="!loading && !shown.length" class="lc-empty as-none">
          <p>{{ filtered && !(kind && !type && !folder && !search) ? t('assetsPage.emptyFiltered') : t('assetsPage.emptyKind') }}</p>
          <button v-if="filtered" class="lc-btn sm" type="button" @click="resetFilters">{{ t('assetsPage.filter.reset') }}</button>
        </div>

        <div v-if="items.length" ref="moreEl" class="as-foot">
          <span>{{ footText }}</span>
          <button v-if="hasMore" class="lc-btn sm" type="button" :disabled="loadingMore" @click="loadMore">
            {{ loadingMore ? t('common.loading') : t('assetsPage.loadMore') }}
          </button>
        </div>
      </template>
    </div>

    <!-- 整页拖入时的提示 -->
    <div v-if="dragging" class="as-dropmask" aria-hidden="true">
      <div class="as-dropbox"><span class="as-ti"><LcIcon name="upload" size="l" /></span><b>{{ t('assetsPage.drop.release') }}</b><small>{{ t('assetsPage.drop.into', { kind: t('assetsPage.kinds.' + uploadKind) }) }}</small></div>
    </div>

    <!-- 重命名 -->
    <div v-if="renameOpen" class="lc-mask" @click.self="closeDialogs">
      <form v-dialog="closeDialogs" class="lc-dialog as-dialog" role="dialog" aria-modal="true" :aria-label="t('assetsPage.renameDialog.title')" @submit.prevent="confirmRename">
        <div class="lc-dialog-head"><span>{{ t('assetsPage.renameDialog.title') }}</span><button class="lc-x" type="button" :aria-label="t('common.close')" @click="closeDialogs">×</button></div>
        <div class="lc-dialog-body">
          <div class="lc-field as-last">
            <label for="as-rename">{{ t('assetsPage.renameDialog.label') }}</label>
            <input id="as-rename" ref="renameInput" v-model.trim="renameText" class="lc-input" maxlength="300" autocomplete="off" />
          </div>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" type="button" :disabled="busy" @click="closeDialogs">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary quiet" type="submit" :disabled="busy || !renameText">{{ t('common.save') }}</button>
        </div>
      </form>
    </div>

    <!-- 移动到分组：写一个新名字，移过去时分组就建好了（也可以先在「分组」里建一个空的） -->
    <div v-if="moveOpen" class="lc-mask" @click.self="closeDialogs">
      <form v-dialog="closeDialogs" class="lc-dialog as-dialog" role="dialog" aria-modal="true" :aria-label="t('assetsPage.moveDialog.title')" @submit.prevent="confirmMove(moveText)">
        <div class="lc-dialog-head"><span>{{ t('assetsPage.moveDialog.title') }}</span><button class="lc-x" type="button" :aria-label="t('common.close')" @click="closeDialogs">×</button></div>
        <div class="lc-dialog-body">
          <div class="lc-field">
            <label for="as-move">{{ t('assetsPage.moveDialog.label') }}</label>
            <label class="lc-inp">
              <LcIcon name="folder" />
              <input id="as-move" ref="moveInput" v-model.trim="moveText" maxlength="120" autocomplete="off" :placeholder="t('assetsPage.moveDialog.placeholder')" />
            </label>
          </div>
          <template v-if="folderList.length">
            <div class="lc-label">{{ t('assetsPage.moveDialog.existing') }}</div>
            <div class="as-folders">
              <button v-for="f in folderList" :key="f.name" class="lc-chip o" :class="{ on: moveText === f.name }" type="button" :aria-pressed="moveText === f.name" @click="moveText = f.name">
                <LcIcon name="folder" size="s" /><span>{{ f.name }}</span><i>{{ formatInt(f.count) }}</i>
              </button>
            </div>
          </template>
          <p v-else class="lc-help">{{ t('assetsPage.moveDialog.none') }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button v-if="selectedItems.some(i => i.folder)" class="lc-btn ghost as-out" type="button" :disabled="busy" @click="confirmMove('')">{{ t('assetsPage.moveDialog.out') }}</button>
          <button class="lc-btn" type="button" :disabled="busy" @click="closeDialogs">{{ t('common.cancel') }}</button>
          <button class="lc-btn primary quiet" type="submit" :disabled="busy || !moveText">{{ t('assetsPage.moveDialog.confirm') }}</button>
        </div>
      </form>
    </div>

    <!-- 删除确认 -->
    <div v-if="removeOpen" class="lc-mask" @click.self="closeDialogs">
      <div v-dialog="closeDialogs" class="lc-dialog as-dialog" role="alertdialog" aria-modal="true" :aria-label="t('assetsPage.removeDialog.title')">
        <div class="lc-dialog-head"><span>{{ t('assetsPage.removeDialog.title') }}</span><button class="lc-x" type="button" :aria-label="t('common.close')" @click="closeDialogs">×</button></div>
        <div class="lc-dialog-body">
          <p class="as-confirm">{{ selectedItems.length === 1
            ? t('assetsPage.removeDialog.one', { name: nameOf(selectedItems[0]) })
            : t('assetsPage.removeDialog.many', { n: selectedItems.length }) }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" type="button" :disabled="busy" @click="closeDialogs">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" type="button" :disabled="busy" @click="confirmRemove">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>

    <CopyToSpaceDialog v-if="copyTo" kind="asset" :id="copyTo.id" :name="nameOf(copyTo)" :asset-kind="copyTo.kind" @close="copyTo = null" />

    <AssetFolderDialog v-if="foldersOpen" :folders="folderList" @close="foldersOpen = false" @changed="onFoldersChanged" @view="viewFolder" />

    <MediaLightbox :open="lightbox.open" :url="lightbox.url" :type="lightbox.type" @close="lightbox.open = false" />
  </div>
</template>

<script setup lang="ts">
import { vDialog } from '@/directives/dialog'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import AssetsTabs from '@/components/AssetsTabs.vue'
import MediaLightbox from '@/components/canvas/MediaLightbox.vue'
import SpaceAvatar from '@/components/space/SpaceAvatar.vue'
import PersonName from '@/components/PersonName.vue'
import { personName } from '@/utils/person'
import CopyToSpaceDialog from '@/components/space/CopyToSpaceDialog.vue'
import AssetFolderDialog from '@/components/assets/AssetFolderDialog.vue'
import { formatInt } from '@/components/space/format'
import { filesApi, userAssetApi, unwrap, apiErrorMessage, apiErrorCode, SPACE_GONE_CODES } from '@/utils/api'
import { assertImageFile, assertVideoFile } from '@/utils/canvasUpload'
import { fetchMediaBlob } from '@/utils/canvasDownload'
import { ensureHttps } from '@/utils/mediaUrl'
import { pixelSize } from '@/utils/pixelSize'
import { writeClipboard } from '@/utils/clipboard'
import { useAppStore } from '@/stores/app'
import { useSpaceStore } from '@/stores/space'
import type { AssetFolder, Person } from '@/types'

/** /api/user-asset 返回的一项（只列这一页用到的字段） */
interface AssetItem {
  id: string
  kind: AssetKind
  nodeType: 'IMAGE' | 'VIDEO'
  name: string
  folder: string
  mediaUrl: string
  thumbnailUrl: string
  width: number
  height: number
  source: 'upload' | 'generated' | string
  /** 这条在哪个库里：团队的，还是个人空间的 */
  scope?: 'team' | 'personal'
  /** 是不是调用者自己加的（个人空间里恒为 true） */
  mine?: boolean
  /** 调用者能不能改、能不能删：自己加的可以，团长和管理员都可以 */
  canManage?: boolean
  uploaderName?: string
  /** 团队里：谁加的；个人空间为 null */
  createdBy?: Person | null
}
type AssetKind = 'product' | 'brand' | 'reference' | 'output'

const { t } = useI18n()
const app = useAppStore()
const space = useSpaceStore()
/** 人在个人空间，同时又是某个团队的成员 */
const inTeams = computed(() => !space.isTeam && space.teams.length > 0)
/** 有没有别的空间可以复制过去：团队里总有个人空间；个人空间里得先在某个团队里 */
const canCopyOut = computed(() => space.teamsEnabled && (space.isTeam || space.teams.length > 0))

const KINDS: AssetKind[] = ['product', 'brand', 'reference', 'output']
const PAGE_SIZE = 60

// ---- 筛选 ----
/** 分类 / 文件夹 / 名称搜索由接口筛；类型（图片 / 视频）接口不支持，只在已加载的里面筛 */
const kind = ref<AssetKind | ''>('')
const type = ref<'' | 'IMAGE' | 'VIDEO'>('')
const folder = ref('')
const searchText = ref('')
const search = ref('')
let searchTimer = 0
watch(searchText, (v) => {
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => { search.value = v.trim() }, 300)
})

const typeOptions = computed(() => [
  { value: '' as '' | 'IMAGE' | 'VIDEO', label: t('assetsPage.filter.typeAll') },
  { value: 'IMAGE' as '' | 'IMAGE' | 'VIDEO', label: t('assetsPage.filter.typeImage') },
  { value: 'VIDEO' as '' | 'IMAGE' | 'VIDEO', label: t('assetsPage.filter.typeVideo') },
])
/**
 * 分组。分组是独立存在的：里面的素材都移走了它也还在（空的），不用了要手动删。
 * 数量是分组里所有种类的素材数，不受上面的筛选影响。
 */
const folderList = ref<AssetFolder[]>([])
const folderOptions = computed(() => {
  const list = folderList.value.map(f => ({ value: f.name, label: f.name, desc: f.empty ? t('assetsPage.folders.isEmpty') : t('assetsPage.folders.count', { n: formatInt(f.count) }, f.count) }))
  // 地址里带着一个已经不存在的分组（刚被删了）：照样显示出来，人才知道自己筛的是什么
  if (folder.value && !list.some(f => f.value === folder.value)) list.push({ value: folder.value, label: folder.value, desc: '' })
  return [{ value: '', label: t('assetsPage.filter.folderAll'), desc: '' }, ...list]
})
/** 老服务端只给名字（folders），没有数量：当成「不知道是不是空的、也删不了」 */
function readFolders(data: any): AssetFolder[] {
  if (Array.isArray(data?.folderList)) return data.folderList
  return (Array.isArray(data?.folders) ? data.folders : []).map((name: string) => ({ name, count: 0, empty: false, canDelete: false }))
}
/** 现在筛的这个分组，而且它是空的 */
const emptyFolder = computed(() => (folder.value && !kind.value && !type.value && !search.value ? folderList.value.find(f => f.name === folder.value && f.empty) || null : null))

const foldersOpen = ref(false)
function onFoldersChanged(what: { created?: string; removed?: string }) {
  // 正筛着的分组被删了 / 解散了：筛选回到全部（watch 会重取）；否则原地重取，数量跟着变
  if (what.removed && what.removed === folder.value) folder.value = ''
  else void load(true)
}
function viewFolder(name: string) {
  foldersOpen.value = false
  kind.value = ''
  type.value = ''
  searchText.value = ''
  search.value = ''
  folder.value = name
}
/** 空态里的「删除分组」：这个分组此刻是空的 */
async function removeEmptyFolder(name: string) {
  if (busy.value) return
  busy.value = true
  try {
    await userAssetApi.removeFolder(name)
    MessagePlugin.success(t('assetsPage.folders.deleted', { name }))
    if (folder.value === name) folder.value = ''
    else void load(true)
  } catch (err) {
    // 刚有人往里放了东西（409）、不是自己建的（403）、已经被删了（404）：服务端的话说得清楚，列表重取
    MessagePlugin.error(apiErrorMessage(err, t('common.operationFailed')))
    void load(true)
  } finally {
    busy.value = false
  }
}
const filtered = computed(() => !!(kind.value || type.value || folder.value || searchText.value.trim()))
function resetFilters() {
  kind.value = ''
  type.value = ''
  folder.value = ''
  searchText.value = ''
  search.value = ''
}

// ---- 列表 ----
const items = ref<AssetItem[]>([])
const total = ref(0)
const page = ref(1)
const loading = ref(false)
const loadingMore = ref(false)
const loadError = ref('')
const hasMore = computed(() => items.value.length < total.value)
let seq = 0

async function load(reset: boolean) {
  const mine = ++seq
  if (reset) { page.value = 1; loading.value = true; loadError.value = '' } else loadingMore.value = true
  try {
    const data = unwrap<any>(await userAssetApi.list({
      ...(kind.value ? { kind: kind.value } : {}),
      ...(folder.value ? { folder: folder.value } : {}),
      ...(search.value ? { search: search.value } : {}),
      page: page.value, pageSize: PAGE_SIZE,
    }))
    if (mine !== seq) return
    const list: AssetItem[] = (data?.list || []).map((d: any) => ({ ...d, id: String(d.id || d._id) }))
    items.value = reset ? list : [...items.value, ...list.filter(n => !items.value.some(o => o.id === n.id))]
    total.value = Number(data?.pagination?.total) || 0
    folderList.value = readFolders(data)
    // 列表换了：不在里面的选中项一起丢掉
    if (reset && selected.value.size) {
      const ids = new Set(list.map(i => i.id))
      selected.value = new Set([...selected.value].filter(id => ids.has(id)))
    }
  } catch (err) {
    if (mine !== seq) return
    if (reset) { items.value = []; total.value = 0; loadError.value = apiErrorMessage(err, t('common.loadFailed')) }
    else MessagePlugin.error(apiErrorMessage(err, t('common.loadFailed')))
  } finally {
    if (mine === seq) { loading.value = false; loadingMore.value = false }
  }
}
function loadMore() {
  if (loading.value || loadingMore.value || !hasMore.value) return
  page.value += 1
  load(false)
}

/** 各分类的数量：接口一次只报一类，按分类各问一次（只要总数，每次取 1 条） */
const counts = ref<Record<AssetKind, number> | null>(null)
const countAll = computed(() => (counts.value ? KINDS.reduce((s, k) => s + counts.value![k], 0) : 0))
let countSeq = 0
async function loadCounts() {
  const mine = ++countSeq
  try {
    const res = await Promise.all(KINDS.map(k => userAssetApi.list({ kind: k, pageSize: 1 })))
    if (mine !== countSeq) return
    counts.value = Object.fromEntries(KINDS.map((k, i) => [k, Number(unwrap<any>(res[i])?.pagination?.total) || 0])) as Record<AssetKind, number>
  } catch { /* 数量只是点缀，拿不到就不显示 */ }
}

function reloadAll() {
  load(true)
  loadCounts()
}
watch([kind, folder, search], () => load(true))

const shown = computed(() => (type.value ? items.value.filter(i => i.nodeType === type.value) : items.value))
const footText = computed(() => {
  if (type.value) return t('assetsPage.shownFiltered', { n: shown.value.length, loaded: items.value.length, total: total.value })
  return hasMore.value
    ? t('assetsPage.shown', { n: items.value.length, total: total.value })
    : t('assetsPage.allLoaded', { total: total.value })
})

const nameOf = (it: AssetItem) => it.name || t('assetsPage.unnamed')
/** 谁加的（老数据只有 uploaderName）。怎么写见 components/PersonName.vue */
const uploaderOf = (it: AssetItem): Partial<Person> => it.createdBy || { name: it.uploaderName || '' }
/** 视频资产有没有一张真正的封面图（而不是被填成了视频地址本身） */
const hasOwnPoster = (it: AssetItem) => !!it.thumbnailUrl && it.thumbnailUrl !== it.mediaUrl
function metaOf(it: AssetItem): string {
  return [
    pixelSize(it.width, it.height),
    it.source === 'generated' ? t('assetsPage.source.generated') : t('assetsPage.source.upload'),
    it.folder,
  ].filter(Boolean).join(' · ')
}

// 滚到底自动接着加载；按钮留着兜底
const pageEl = ref<HTMLElement | null>(null)
const moreEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null
watch(moreEl, (el) => {
  observer?.disconnect()
  if (!el || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => {
    if (entries.some(e => e.isIntersecting)) loadMore()
  }, { root: pageEl.value, rootMargin: '200px' })
  observer.observe(el)
})

// ---- 上传：先传文件，再登记成素材（和画布里的资源库是同一套顺序） ----
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const upload = ref({ index: 0, count: 0, pct: 0, name: '' })
/** 落在哪一类：正看着某一类就进那一类，否则进「产品图」（后端的默认值） */
const uploadKind = computed<AssetKind>(() => kind.value || 'product')
/** 这台服务器的上传上限（MB）；老版本后端不下发就是 0，不显示 */
const maxMb = computed(() => { const mb = Number(app.bootstrap?.limits?.maxUploadMb); return mb > 0 ? mb : 0 })
const limitText = computed(() => (maxMb.value
  ? `${t('assetsPage.drop.formats')} · ${t('assetsPage.drop.limit', { mb: maxMb.value })}`
  : t('assetsPage.drop.formats')))

function pickFiles() {
  if (!uploading.value) fileInput.value?.click()
}
function onFileInput(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  void uploadFiles(files)
}

async function uploadFiles(all: File[]) {
  if (uploading.value || !all.length) return
  const files = all.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
  if (files.length < all.length) MessagePlugin.warning(t('assetsPage.notMedia'))
  if (!files.length) return
  // 上传途中用户可能切到别的分类，归属以开始上传那一刻为准
  const target = uploadKind.value
  uploading.value = true
  let done = 0
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    upload.value = { index: i + 1, count: files.length, pct: 0, name: f.name }
    try {
      const isVideo = f.type.startsWith('video/')
      // 类型和这台服务器的大小上限先在本地挡一道
      if (isVideo) assertVideoFile(f)
      else assertImageFile(f)
      const file = unwrap(await filesApi.upload(f, (pct) => { upload.value.pct = pct }))
      if (!file?.url) throw new Error(t('upload.noUrl'))
      unwrap(await userAssetApi.create({
        kind: target,
        nodeType: isVideo ? 'VIDEO' : 'IMAGE',
        name: f.name.replace(/\.[^.]+$/, '').slice(0, 300),
        mediaUrl: file.url,
      }))
      done += 1
    } catch (err) {
      MessagePlugin.error(t('assetsPage.uploadFailed', { name: f.name, reason: apiErrorMessage(err, t('common.uploadFailed')) }))
    }
  }
  uploading.value = false
  if (done > 0) {
    MessagePlugin.success(t('assetsPage.uploaded', { n: done }))
    reloadAll()
  }
}

// 整页拖入
const dragging = ref(false)
let dragDepth = 0
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types || []).includes('Files')
function onDragEnter(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth += 1
  dragging.value = true
}
function onDragOver(e: DragEvent) {
  if (hasFiles(e)) e.preventDefault()
}
function onDragLeave(e: DragEvent) {
  if (!hasFiles(e)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) dragging.value = false
}
function onDrop(e: DragEvent) {
  if (!hasFiles(e)) return
  e.preventDefault()
  dragDepth = 0
  dragging.value = false
  void uploadFiles(Array.from(e.dataTransfer?.files || []))
}

// ---- 选择 ----
const selected = ref<Set<string>>(new Set())
const selectedItems = computed(() => items.value.filter(i => selected.value.has(i.id)))
/** 选中的里面有几条是别人加的、自己动不了（只有团队里的成员会遇到） */
const lockedCount = computed(() => selectedItems.value.filter(i => i.canManage === false).length)
/** 改名、移动、删除：选中的每一条都得是自己能管的 */
const canManageSel = computed(() => selectedItems.value.length > 0 && !lockedCount.value)
/** 「复制到…」针对哪一条 */
const copyTo = ref<AssetItem | null>(null)
const allSelected = computed(() => shown.value.length > 0 && shown.value.every(i => selected.value.has(i.id)))
const selBreakdown = computed(() => ({
  image: selectedItems.value.filter(i => i.nodeType !== 'VIDEO').length,
  video: selectedItems.value.filter(i => i.nodeType === 'VIDEO').length,
}))
function toggle(it: AssetItem) {
  const next = new Set(selected.value)
  if (!next.delete(it.id)) next.add(it.id)
  selected.value = next
}
function toggleAll() {
  selected.value = allSelected.value ? new Set() : new Set(shown.value.map(i => i.id))
}
function clearSelection() {
  selected.value = new Set()
}

const lightbox = ref<{ open: boolean; url: string; type: 'image' | 'video' }>({ open: false, url: '', type: 'image' })
/** 已经在选了就继续选，否则点卡片是预览 */
function onCardClick(it: AssetItem) {
  if (selected.value.size) toggle(it)
  else lightbox.value = { open: true, url: ensureHttps(it.mediaUrl), type: it.nodeType === 'VIDEO' ? 'video' : 'image' }
}

// ---- 批量操作 ----
const busy = ref(false)

/**
 * 改、删被拒绝：这一条不是自己的，或者角色刚被改了（team.forbidden）。
 * 把服务端的那句话说出来，再重新拉一遍，让按钮跟上现在的权限。空间没了由外壳统一处理，这里不出声。
 */
function reportFailure(err: unknown, fallback: string) {
  const code = apiErrorCode(err)
  if ((SPACE_GONE_CODES as readonly string[]).includes(code)) return
  MessagePlugin.error(apiErrorMessage(err, fallback))
  if (code === 'team.forbidden') {
    closeDialogs()
    clearSelection()
    reloadAll()
    void space.refresh()
  }
}

function extOf(it: AssetItem): string {
  const m = it.mediaUrl.split('?')[0].match(/\.([a-zA-Z0-9]{2,5})$/)
  return m ? m[1].toLowerCase() : it.nodeType === 'VIDEO' ? 'mp4' : 'png'
}
async function downloadSelected() {
  if (busy.value) return
  const list = selectedItems.value
  busy.value = true
  let done = 0
  try {
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      MessagePlugin.closeAll()
      MessagePlugin.loading(t('assetsPage.downloading', { i: i + 1, n: list.length }), 0)
      const filename = `${nameOf(it).replace(/[\\/:*?"<>|]+/g, '_')}.${extOf(it)}`
      try {
        const blob = await fetchMediaBlob(it.mediaUrl, filename)
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(a.href)
        done += 1
      } catch {
        MessagePlugin.error(t('assetsPage.downloadFailed', { name: nameOf(it) }))
      }
    }
  } finally {
    MessagePlugin.closeAll()
    busy.value = false
  }
  if (done) MessagePlugin.success(t('assetsPage.downloaded', { n: done }))
}

async function copyLink() {
  const it = selectedItems.value[0]
  if (!it) return
  try {
    await writeClipboard(new URL(ensureHttps(it.mediaUrl), window.location.href).href)
    MessagePlugin.success(t('assetsPage.linkCopied'))
  } catch {
    MessagePlugin.error(t('common.copyFailed'))
  }
}

const renameOpen = ref(false)
const renameText = ref('')
const renameInput = ref<HTMLInputElement | null>(null)
function openRename() {
  const it = selectedItems.value[0]
  if (!it) return
  renameText.value = it.name || ''
  renameOpen.value = true
  nextTick(() => renameInput.value?.select())
}
async function confirmRename() {
  const it = selectedItems.value[0]
  if (!it || !renameText.value || busy.value) return
  busy.value = true
  try {
    const saved = unwrap<any>(await userAssetApi.update(it.id, { name: renameText.value }))
    items.value = items.value.map(x => (x.id === it.id ? { ...x, name: saved?.name ?? renameText.value } : x))
    renameOpen.value = false
    MessagePlugin.success(t('assetsPage.renameDialog.done'))
  } catch (err) {
    busy.value = false
    reportFailure(err, t('common.operationFailed'))
  } finally {
    busy.value = false
  }
}

const moveOpen = ref(false)
const moveText = ref('')
const moveInput = ref<HTMLInputElement | null>(null)
function openMove() {
  const names = [...new Set(selectedItems.value.map(i => i.folder))]
  moveText.value = names.length === 1 ? names[0] : ''
  moveOpen.value = true
  nextTick(() => moveInput.value?.focus())
}
/** name 为空 = 移出文件夹 */
async function confirmMove(name: string) {
  const list = selectedItems.value
  if (!list.length || busy.value) return
  busy.value = true
  try {
    const res = await Promise.allSettled(list.map(it => userAssetApi.update(it.id, { folder: name }).then(unwrap)))
    const ok = res.filter(r => r.status === 'fulfilled').length
    const failed = res.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined
    busy.value = false
    if (failed) reportFailure(failed.reason, t('common.operationFailed'))
    if (ok) MessagePlugin.success(t(name ? 'assetsPage.moveDialog.done' : 'assetsPage.moveDialog.doneOut', { n: ok }))
    moveOpen.value = false
    clearSelection()
    load(true)
  } finally {
    busy.value = false
  }
}

const removeOpen = ref(false)
async function confirmRemove() {
  const list = selectedItems.value
  if (!list.length || busy.value) return
  busy.value = true
  try {
    const res = await Promise.allSettled(list.map(it => userAssetApi.remove(it.id).then(unwrap)))
    const ok = res.filter(r => r.status === 'fulfilled').length
    const fail = res.length - ok
    // 被拒绝的（不是自己的）把服务端的原因说出来，别的失败只报个数
    const denied = res.find(r => r.status === 'rejected' && apiErrorCode((r as PromiseRejectedResult).reason) === 'team.forbidden') as PromiseRejectedResult | undefined
    const gone = res.some(r => r.status === 'rejected' && (SPACE_GONE_CODES as readonly string[]).includes(apiErrorCode((r as PromiseRejectedResult).reason)))
    if (gone) return
    if (denied) { MessagePlugin.error(apiErrorMessage(denied.reason, t('common.operationFailed'))); void space.refresh() }
    else if (fail) MessagePlugin.error(t('assetsPage.removeDialog.partial', { ok, fail }))
    else MessagePlugin.success(t('assetsPage.removeDialog.done', { n: ok }))
    removeOpen.value = false
    clearSelection()
    // 按页取的列表删掉几项后页码就对不上了，从头再拉
    reloadAll()
  } finally {
    busy.value = false
  }
}

function closeDialogs() {
  if (busy.value) return
  renameOpen.value = false
  moveOpen.value = false
  removeOpen.value = false
}
function onKeydown(e: KeyboardEvent) {
  // 弹窗自己的 Esc 归 v-dialog 管（那一下不会传到这里）；这里只剩「取消选择」
  if (e.key !== 'Escape' || lightbox.value.open) return
  if (selected.value.size) clearSelection()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  reloadAll()
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.clearTimeout(searchTimer)
  observer?.disconnect()
})
</script>

<style scoped>
.as-page { position: relative; }
.as-head-text { min-width: 0; flex: 1 1 320px; }
.as-upload-btn { height: 40px; padding: 0 20px; }
.as-file { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }

.as-rule { display: flex; align-items: flex-start; gap: 8px; margin-top: 14px; font-size: 13px; line-height: 1.6; color: var(--text-3); }
.as-rule :deep(svg) { flex: none; margin-top: 3px; color: var(--text-3); }
.as-fbar { margin-top: 16px; }
.as-fbar .lc-seg .n { font: 500 11px var(--f-mono); color: var(--text-3); }
.as-fbar .lc-seg .on .n { color: var(--cyan-soft); }
.as-sel { width: 136px; flex: none; }
.as-sel.wide { width: 168px; }
.as-reset { height: 32px; }
.as-error { margin-top: 16px; align-items: center; }
.as-error > span { flex: 1; min-width: 0; }

/* ---- 批量操作条 ---- */
.as-selbar {
  display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; margin-top: 16px;
  min-height: 48px; padding: 8px 8px 8px 16px; border-radius: 12px;
  border: 1px solid rgb(var(--c-cyan) / .45); background: rgb(var(--c-cyan) / .08);
}
.as-selbar .lc-cb { cursor: pointer; }
.as-selbar b { font-weight: 600; }
.as-selbar-sub { font-size: 13px; }
.as-selbar-lock { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-2); }
.as-selbar-acts { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ---- 网格 ---- */
.as-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 16px; margin-top: 16px; }
.as { position: relative; overflow: hidden; min-width: 0; transition: border-color .15s, box-shadow .15s; }
.as:not(.on):not(.as-up):not(.skel-card):hover { border-color: var(--line-3); }
.as-thumb { display: block; width: 100%; height: 132px; padding: 0; border: 0; cursor: pointer; }
.as-thumb:focus-visible { outline: 2px solid var(--cyan); outline-offset: -2px; }
.as .meta { padding: 10px 12px 12px; }
.as .meta b { display: block; font-size: 13px; font-weight: 500; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.as .meta small { display: block; font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.as .meta small.as-by { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: var(--text-2); }
.as .meta small.as-by > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.as .meta small.as-by :deep(.pn-tag) { height: 18px; padding: 0 6px; font-size: 11px; }
.as-pick {
  position: absolute; right: 8px; top: 8px; width: 22px; height: 22px; padding: 0; border-radius: 50%;
  border: 1.5px solid var(--on-scrim-line-2); background: rgb(var(--c-scrim) / .45);
  display: grid; place-items: center; color: var(--text-inv); cursor: pointer;
}
.as-pick:hover { border-color: var(--cyan-soft); }
.as-pick:focus-visible { outline: none; box-shadow: var(--ring); }
.as.on .as-pick { background: var(--grad-btn); border-color: transparent; }

.as-up {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  min-height: 190px; padding: 16px 12px; text-align: center; font-size: 13px; color: var(--text-2);
  border-style: dashed; border-color: var(--line-3); background: rgb(var(--c-well) / .3); cursor: pointer;
}
.as-up:hover:not(:disabled) { border-color: var(--cyan); color: var(--text); }
.as-up:focus-visible { outline: none; box-shadow: var(--ring); border-color: var(--cyan); }
.as-up:disabled { cursor: default; }
.as-up-t { margin-top: 10px; max-width: 100%; }
.as-up-s { font-size: 12px; line-height: 1.7; color: var(--text-3); max-width: 100%; }
.as-up-s.one { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.as-up .lc-ring { font-size: 12px; }
.as-ti {
  width: 48px; height: 48px; border-radius: 14px; flex: none; display: grid; place-items: center; color: var(--cyan);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .18), rgb(var(--c-violet) / .22));
  box-shadow: 0 0 0 1px rgb(var(--c-cyan) / .35) inset;
}

.skel { display: block; height: 12px; border-radius: 6px; background: var(--skel-bg); animation: lc-pulse 1.6s ease-in-out infinite; }
.skel.thumb { height: 132px; border-radius: 0; background: var(--media-bg); }
.skel.w70 { width: 70%; } .skel.w50 { width: 50%; margin-top: 8px; }

.as-none { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.as-foot { display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; margin-top: 24px; font-size: 13px; color: var(--text-3); text-align: center; }

/* ---- 空态 ---- */
.as-empty { margin-top: 16px; padding: 56px 24px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; border-style: dashed; border-color: var(--line-3); background: rgb(var(--c-well) / .3); }
.as-empty h2 { font: 600 16px/1.4 var(--f-disp); color: var(--text); margin-top: 8px; }
.as-empty p { color: var(--text-2); font-size: 13px; max-width: 440px; line-height: 1.7; }
.as-empty .lc-btn { margin-top: 12px; }
.as-empty small { color: var(--text-3); font-size: 12px; margin-top: 4px; }

/* ---- 整页拖入 ---- */
.as-dropmask {
  position: fixed; inset: 0; z-index: 2500; pointer-events: none; display: grid; place-items: center; padding: 24px;
  background: rgb(var(--c-void) / .6); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
}
.as-dropbox {
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 40px 56px; max-width: 100%; text-align: center;
  border: 1.5px dashed var(--cyan); border-radius: var(--r-lg); background: rgb(var(--c-glass-lo) / .9); box-shadow: var(--glow-m);
}
.as-dropbox b { font: 600 16px/1.4 var(--f-disp); margin-top: 8px; }
.as-dropbox small { color: var(--text-2); font-size: 13px; }

/* ---- 弹窗 ---- */
.as-dialog { width: 440px; }
.as-last { margin-bottom: 0; }
.as-folders { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.as-folders .lc-chip { height: 28px; padding: 0 10px; gap: 6px; border: 0; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.as-folders .lc-chip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.as-folders .lc-chip i { flex: none; font-style: normal; font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.as-none small { display: block; margin-top: 4px; color: var(--text-3); font-size: 12px; }
.as-none-ops { display: flex; justify-content: center; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.as-folders-btn { flex: none; }
.as-folders .lc-chip:hover { color: var(--text); box-shadow: 0 0 0 1px var(--line-3) inset; }
.as-folders .lc-chip.on { color: var(--cyan-soft); background: rgb(var(--c-cyan) / .1); box-shadow: 0 0 0 1px var(--cyan) inset; }
.as-out { margin-right: auto; }
.as-confirm { color: var(--text-2); line-height: 1.7; word-break: break-word; }

@media (max-width: 1280px) { .as-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 900px) { .as-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 600px) {
  .as-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .as-sel, .as-sel.wide { flex: 1 1 130px; width: auto; min-width: 0; }
  .as-upload-btn { width: 100%; }
  .as-selbar { padding: 10px 12px; }
  .as-selbar-acts { width: 100%; }
  .as-thumb, .skel.thumb { height: 120px; }
  .as-up { min-height: 178px; }
  .as-dropbox { padding: 28px 24px; }
}
</style>
