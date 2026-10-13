<template>
  <div class="lc-page"><div class="lc-page-inner">
    <header class="lc-page-head cl-head">
      <div class="cl-heading">
        <h1 class="lc-ph1">{{ space.isTeam ? t('views.team.title') : t('views.list.title') }}</h1>
        <p class="lc-ph-sub">
          <template v-if="!space.isTeam">{{ t('views.list.subtitle') }}</template>
          <template v-else-if="loaded">{{ t('views.team.subtitle', { team: space.name, n: list.length }) }}</template>
          <template v-else>{{ t('views.team.subtitleLoading', { team: space.name }) }}</template>
        </p>
      </div>
      <span class="lc-sp" />
      <div class="cl-actions">
        <button v-if="canTrash" class="lc-btn" @click="trashOpen = true">
          <LcIcon name="trash" /><span>{{ t('views.trash.title') }}</span>
        </button>
        <button v-if="$feat.share" class="lc-btn" @click="openLibrary('mine')">
          <LcIcon name="share" /><span>{{ space.isTeam ? t('views.team.shareLinks') : t('views.list.shareLinks') }}</span>
        </button>
        <button v-if="$feat.templates" class="lc-btn" @click="openLibrary('canvas-template')">
          <LcIcon name="layout" /><span>{{ t('views.list.templates') }}</span>
        </button>
        <button class="lc-btn primary cl-new" @click="openCreateDialog">
          <LcIcon name="plus" /><span>{{ t('views.list.newCanvas') }}</span>
        </button>
      </div>
    </header>

    <!-- 团队空间：按「谁的、哪一档」筛，右边按创建人筛和排序 -->
    <div v-if="space.isTeam && list.length" class="cl-filters">
      <div class="lc-seg" role="tablist" :aria-label="t('views.team.filterLabel')">
        <button
          v-for="f in filters"
          :key="f.key"
          type="button"
          role="tab"
          :aria-selected="filter === f.key"
          :class="{ on: filter === f.key }"
          @click="filter = f.key"
        >{{ f.label }} <span class="cl-n">{{ f.count }}</span></button>
      </div>
      <span class="lc-sp" />
      <div class="cl-selects">
        <LcSelect v-model="creator" :options="creatorOptions" :searchable="creatorOptions.length > 9" size="sm" auto-width :aria-label="t('views.team.creator')" />
        <LcSelect v-model="sort" :options="sortOptions" size="sm" auto-width :aria-label="t('views.team.sort')" />
      </div>
    </div>

    <!-- 冷启动（屏幕上还没有任何画布）才出骨架 -->
    <div v-if="loading && list.length === 0" class="cl-grid">
      <ListSkeleton variant="canvas" :count="8" />
    </div>
    <div v-else-if="loadError && list.length === 0" class="lc-card cl-state">
      <span class="cl-state-ic err"><LcIcon name="warn" size="l" /></span>
      <b>{{ t('views.list.loadFailed') }}</b>
      <button class="lc-btn sm" @click="fetchList">{{ t('common.retry') }}</button>
    </div>
    <div v-else-if="list.length === 0" class="lc-card cl-state">
      <span class="cl-state-ic"><LcIcon name="canvas" size="l" /></span>
      <p>{{ space.isTeam ? t('views.team.empty') : t('views.list.empty') }}</p>
      <button class="lc-btn" @click="openCreateDialog"><LcIcon name="plus" />{{ t('views.list.newCanvas') }}</button>
    </div>
    <div v-else-if="shown.length === 0" class="lc-card cl-state">
      <span class="cl-state-ic"><LcIcon name="search" size="l" /></span>
      <p>{{ t('views.team.noMatch') }}</p>
      <button class="lc-btn sm" @click="resetFilters">{{ t('views.team.showAll') }}</button>
    </div>

    <div v-else class="cl-grid">
      <CanvasCard
        v-for="w in shown"
        :key="w.id"
        class="cl-card"
        :canvas="w"
        :team="space.isTeam"
        :menu-items="space.isTeam ? acts?.itemsOf(w) : undefined"
        :now="now"
        @open="openCanvas(w.id)"
        @action="acts?.run($event, w)"
      >
        <!--
          个人空间：操作是封面右上角的一排图标。复制 / 删除走就地确认气泡 ——
          一屏十几张卡片，盖住整页的弹窗会把人从列表里拽出去；气泡贴着按钮弹，动的是哪张一目了然。
          ConfirmPop 内部对触发和气泡都做了 click.stop，不会连带把画布点开。
          团队空间里操作收在卡片右下角的「…」里（见 CanvasActions）。
        -->
        <template v-if="!space.isTeam" #ops>
          <div class="cl-ops">
            <button class="cl-op" v-tip="t('views.list.renameTip', { name: w.name })" :aria-label="t('views.list.renameTip', { name: w.name })" @click.stop="acts?.rename(w)">
              <LcIcon name="edit" size="s" />
            </button>
            <button
              v-if="$feat.batchDownload"
              class="cl-op"
              v-tip="t('views.list.downloadTip', { name: w.name })"
              :aria-label="t('views.list.downloadTip', { name: w.name })"
              :disabled="!!acts?.downloadingId"
              @click.stop="acts?.download(w)"
            >
              <LcIcon name="download" size="s" />
            </button>
            <ConfirmPop
              :text="t('views.list.duplicateConfirm', { name: w.name })"
              :hint="t('views.list.duplicateHint')"
              :ok-text="t('common.copy')"
              tone="primary"
              :disabled="acts?.duplicating"
              @ok="acts?.duplicate(w)"
            >
              <button class="cl-op" v-tip="t('views.list.duplicateTip', { name: w.name })" :aria-label="t('views.list.duplicateTip', { name: w.name })">
                <LcIcon name="copy" size="s" />
              </button>
            </ConfirmPop>
            <!-- 加入了团队的人才有：把这张画布（连同里面的文件）复制一份到团队里 -->
            <button
              v-if="acts?.canCopyTo"
              class="cl-op"
              v-tip="t('views.team.copyToTeamTip', { name: w.name })"
              :aria-label="t('views.team.copyToTeamTip', { name: w.name })"
              @click.stop="acts?.copyTo(w)"
            >
              <LcIcon name="users" size="s" />
            </button>
            <ConfirmPop
              :text="t('views.list.deleteConfirm', { name: w.name })"
              :hint="t('views.list.deleteHint')"
              :disabled="acts?.deleting"
              @ok="acts?.remove(w)"
            >
              <button class="cl-op danger" v-tip="t('views.list.deleteTip', { name: w.name })" :aria-label="t('views.list.deleteTip', { name: w.name })">
                <LcIcon name="trash" size="s" />
              </button>
            </ConfirmPop>
          </div>
        </template>
      </CanvasCard>
    </div>

    <!-- 三档可见范围各是什么意思 -->
    <ul v-if="space.isTeam && list.length" class="cl-legend" :aria-label="t('spaces.visibility.label')">
      <li v-for="v in VISIBILITIES" :key="v">
        <VisibilityChip :value="v" plain :title="false" /><span>{{ t(`spaces.visibility.${v}.hint`) }}</span>
      </li>
    </ul>

    <!-- 画布模板 / 我的分享 弹窗；列表页没有「当前画布」，选中的东西一律落到一个新画布里 -->
    <LibraryDialog
      v-model="libraryOpen"
      :initial-tab="libraryInitialTab"
      @add-asset="onAddAssetToNewCanvas"
      @apply-template="onApplyTemplateToNewCanvas"
      @add-text="onAddTextToNewCanvas"
    />

    <CanvasNameDialog
      v-model="nameDialogOpen"
      :title="t('views.list.newCanvas')"
      :ok-text="t('views.list.create')"
      :busy-text="t('views.list.creating')"
      :busy="submitting"
      @submit="submitNameDialog"
    />

    <!-- 卡片上的操作（重命名、复制、团队权限、下载、删除）和它们的弹窗 -->
    <CanvasActions ref="acts" @changed="fetchList" @patched="onPatched" />
    <TrashDialog v-if="trashOpen" @close="trashOpen = false" @restored="fetchList" />
  </div></div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { workflowApi, type WorkflowSummary } from '@/utils/api'
import { useAppStore } from '@/stores/app'
import { useSpaceStore } from '@/stores/space'
import LibraryDialog from '@/components/canvas/LibraryDialog.vue'
import { mergeList, useCanvasLocks } from '@/components/canvaslist/useCanvasLocks'
import ListSkeleton from '@/components/ListSkeleton.vue'
import ConfirmPop from '@/components/ConfirmPop.vue'
import LcIcon from '@/components/LcIcon.vue'
import LcSelect from '@/components/LcSelect.vue'
import VisibilityChip from '@/components/space/VisibilityChip.vue'
import CanvasNameDialog from '@/components/workbench/CanvasNameDialog.vue'
import CanvasCard from '@/components/canvaslist/CanvasCard.vue'
import CanvasActions from '@/components/canvaslist/CanvasActions.vue'
import TrashDialog from '@/components/canvaslist/TrashDialog.vue'
import { personTitle } from '@/components/canvaslist/canvasMeta'
import { useCanvasCreate, type TemplateLike } from '@/components/workbench/useCanvasCreate'
import type { CanvasVisibility } from '@/types'

const router = useRouter()
const { t } = useI18n()
const app = useAppStore()
const space = useSpaceStore()
const { createAndOpen, createFromTemplate, createFromAsset, createFromText } = useCanvasCreate()

const list = ref<WorkflowSummary[]>([])
const loading = ref(false)
const loadError = ref(false)
/** 至少成功取到过一次（团队里的副标题要报张数，没取到之前不报 0） */
const loaded = ref(false)

async function fetchList() {
  loading.value = true
  loadError.value = false
  try {
    const res = await workflowApi.list()
    if (res.data.result === 0 && res.data.data) {
      // 没变的卡片留着原来的对象（隔几秒的轮询、回到页签时的重取都走这里：一样的回答不重绘）
      list.value = mergeList(list.value, res.data.data)
      loaded.value = true
    } else {
      loadError.value = true
    }
  } catch (err) {
    loadError.value = true
    // 空间没了（被移出、团队解散或停用）由外壳统一处理并说明原因，不算这一页的错
    if (!['team.not_found', 'team.dissolved', 'team.suspended'].includes(String((err as any)?.response?.data?.code || ''))) console.error('[canvas-list] fetch failed:', err)
  } finally {
    loading.value = false
  }
}

function openCanvas(id: string) {
  router.push({ name: 'canvas', params: { id } })
}

/* ===== 团队空间：筛选、创建人、排序（都在已经取回来的这一份上做） ===== */
const VISIBILITIES: CanvasVisibility[] = ['private', 'team_view', 'team_edit']
type FilterKey = 'all' | 'mine' | 'team_edit' | 'private'
type SortKey = 'edited' | 'created' | 'name'
const filter = ref<FilterKey>('all')
const creator = ref('')
const sort = ref<SortKey>('edited')

const myId = computed(() => app.user?.id || '')
const matches = (w: WorkflowSummary, f: FilterKey) =>
  f === 'all' || (f === 'mine' ? !!myId.value && w.createdBy?.id === myId.value : w.visibility === f)
const filters = computed(() => (['all', 'mine', 'team_edit', 'private'] as FilterKey[]).map((key) => ({
  key,
  label: key === 'all' ? t('views.team.filterAll') : key === 'mine' ? t('views.team.filterMine') : t(`spaces.visibility.${key}.label`),
  count: list.value.filter((w) => matches(w, key)).length,
})))

/** 创建人下拉：只列这份列表里出现过的人 */
const creatorOptions = computed(() => {
  const seen = new Map<string, string>()
  for (const w of list.value) {
    const p = w.createdBy
    if (p?.id && !seen.has(p.id)) seen.set(p.id, personTitle(p))
  }
  return [
    { value: '', label: t('views.team.creatorAll') },
    ...[...seen].map(([value, label]) => ({ value, label: value === myId.value ? t('views.team.creatorMe', { name: label }) : label })),
  ]
})
const sortOptions = computed(() => (['edited', 'created', 'name'] as SortKey[]).map((value) => ({ value, label: t(`views.team.sortBy.${value}`) })))

const shown = computed(() => {
  // 个人空间：就是服务端给的那一份，顺序也不动
  if (!space.isTeam) return list.value
  const ts = (v?: string | null) => (v ? new Date(v).getTime() || 0 : 0)
  const edited = (w: WorkflowSummary) => ts(w.lastEditedAt || w.updatedAt || w.createdAt)
  const out = list.value.filter((w) => matches(w, filter.value) && (!creator.value || w.createdBy?.id === creator.value))
  if (sort.value === 'name') return out.sort((a, b) => a.name.localeCompare(b.name))
  return out.sort((a, b) => (sort.value === 'created' ? ts(b.createdAt) - ts(a.createdAt) : edited(b) - edited(a)))
})
function resetFilters() {
  filter.value = 'all'
  creator.value = ''
}

/* ===== 卡片上的操作 ===== */
const acts = ref<InstanceType<typeof CanvasActions> | null>(null)
function onPatched(canvas: WorkflowSummary) {
  list.value = list.value.map((it) => (it.id === canvas.id ? { ...it, ...canvas } : it))
}

/* ===== 回收站 =====
   个人空间里是自己删的那些；团队里只有能恢复的人（团长、管理员）才有这个入口 */
const trashOpen = ref(false)
const canTrash = computed(() => space.can('canvas:restore'))

/* ===== 新建 ===== */
const nameDialogOpen = ref(false)
const submitting = ref(false)
const openCreateDialog = () => { nameDialogOpen.value = true }

/** 弹窗已经把名字去过空白、判过空。团队里不传可见范围：用团队的默认值 */
async function submitNameDialog(name: string) {
  if (submitting.value) return
  submitting.value = true
  try {
    if (await createAndOpen(name)) nameDialogOpen.value = false
  } finally {
    submitting.value = false
  }
}

/* ===== 素材库弹窗（列表页只用到「画布模板」和「我的分享」两个入口） ===== */
type LibraryTab = 'material' | 'my-asset' | 'canvas-template' | 'text-template' | 'mine'
const libraryOpen = ref(false)
const libraryInitialTab = ref<LibraryTab>('canvas-template')

function openLibrary(tab: LibraryTab) {
  libraryInitialTab.value = tab
  libraryOpen.value = true
}

// 素材 / 模板 / 文本：各自新建一个画布把它放进去，然后进入编辑器
async function onAddAssetToNewCanvas(asset: { nodeType?: string; mediaUrl?: string; name?: string }) {
  if (await createFromAsset(asset)) libraryOpen.value = false
}
async function onApplyTemplateToNewCanvas(tpl: TemplateLike) {
  if (await createFromTemplate(tpl)) libraryOpen.value = false
}
async function onAddTextToNewCanvas(content: string) {
  if (await createFromText(content)) libraryOpen.value = false
}

/* 「现在」：相对时间、编辑锁有没有过期都按它算。团队里回到这个页签时顺手重取一次 */
const now = ref(Date.now())
// 页面开着时隔几秒问一次：谁正在编辑、别人改的名字、新建 / 删掉 / 恢复的画布，变了的卡片就地换（见 useCanvasLocks）；
// 可见范围被人改了（张数对不上）才整个重取。顺序和服务端给的一样：新建的在前
const byCreated = (a: WorkflowSummary, b: WorkflowSummary) => (new Date(b.createdAt).getTime() || 0) - (new Date(a.createdAt).getTime() || 0)
useCanvasLocks(list, {
  enabled: () => space.isTeam && !loading.value,
  onTick: () => { now.value = Date.now() },
  reload: fetchList,
  order: byCreated,
})
let ticker = 0
function onVisible() {
  if (document.visibilityState !== 'visible') return
  now.value = Date.now()
  if (space.isTeam && !loading.value) void fetchList()
}

onMounted(() => {
  void fetchList()
  ticker = window.setInterval(() => { now.value = Date.now() }, 30000)
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => {
  window.clearInterval(ticker)
  document.removeEventListener('visibilitychange', onVisible)
})
</script>

<style scoped>
.cl-head { align-items: center; }
.cl-heading { min-width: 0; }
.cl-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.cl-new { height: 40px; padding: 0 20px; }

.cl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 16px; margin-top: 24px; }
/* 骨架卡是公用组件里的，圆角和边线对到这页的卡片上 */
.cl-grid :deep(.skel-canvas-card) { border-radius: var(--r-md); border-color: var(--line); background: var(--grad-card); }

/* 团队空间的筛选行 */
.cl-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
.cl-filters + .cl-grid, .cl-filters + .cl-state { margin-top: 16px; }
.cl-n { color: var(--text-3); font-variant-numeric: tabular-nums; }
.lc-seg > button.on .cl-n { color: var(--text-2); }
.cl-selects { display: flex; align-items: center; gap: 8px; min-width: 0; }

/* 三档可见范围的图例 */
.cl-legend { list-style: none; display: flex; flex-wrap: wrap; gap: 10px 24px; margin: 20px 0 0; padding: 0; font-size: 12px; color: var(--text-3); }
.cl-legend li { display: flex; align-items: center; gap: 10px; min-width: 0; }

/* 卡片右上角的一排操作：悬停才出现，不跟封面抢戏 */
.cl-ops {
  position: absolute; top: 8px; right: 8px; display: flex; gap: 2px; padding: 3px;
  border-radius: 10px; border: 1px solid var(--line-2); background: rgb(var(--c-glass) / .88);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  opacity: 0; transition: opacity .15s;
}
.cl-card:hover .cl-ops, .cl-card:focus-within .cl-ops { opacity: 1; }
/* 触屏没有悬停，直接常显 */
@media (hover: none) { .cl-ops { opacity: 1; } }
.cl-op {
  width: 28px; height: 28px; border: 0; border-radius: 7px; background: none; color: var(--text-2);
  display: grid; place-items: center; transition: background .15s, color .15s;
}
.cl-op:hover:not(:disabled) { background: rgb(var(--c-film) / .14); color: var(--text); }
.cl-op.danger:hover:not(:disabled) { background: rgb(var(--c-err) / .14); color: var(--err-soft); }
.cl-op:disabled { opacity: .4; cursor: not-allowed; }

.cl-state { display: grid; justify-items: center; gap: 10px; margin-top: 24px; padding: 64px 20px; text-align: center; color: var(--text-2); }
.cl-state b { font: 600 15px/1.4 var(--f-disp); color: var(--text); }
.cl-state .lc-btn { margin-top: 6px; }
.cl-state-ic {
  width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; color: var(--cyan);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .18), rgb(var(--c-violet) / .22)); box-shadow: 0 0 0 1px rgb(var(--c-cyan) / .35) inset;
}
.cl-state-ic.err { color: var(--err); background: rgb(var(--c-err) / .1); box-shadow: 0 0 0 1px rgb(var(--c-err) / .35) inset; }

@media (max-width: 600px) {
  .cl-actions { width: 100%; }
  .cl-actions .lc-btn { flex: 1 1 auto; padding: 0 12px; }
  .cl-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .cl-filters .lc-sp { display: none; }
  .cl-selects { width: 100%; }
  .cl-selects > * { flex: 1 1 0; min-width: 0; }
  .cl-legend { flex-direction: column; }
  /* 窄屏卡片太小，操作条不再压在封面上，改成卡片底部的一行 */
  .cl-ops {
    position: static; opacity: 1; border: 0; border-top: 1px solid var(--line); border-radius: 0; background: none;
    justify-content: space-around; -webkit-backdrop-filter: none; backdrop-filter: none;
  }
}
</style>
