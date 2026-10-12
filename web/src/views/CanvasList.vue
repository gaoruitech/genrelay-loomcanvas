<template>
  <div class="lc-page"><div class="lc-page-inner">
    <header class="lc-page-head cl-head">
      <div class="cl-heading">
        <h1 class="lc-ph1">{{ t('views.list.title') }}</h1>
        <p class="lc-ph-sub">{{ t('views.list.subtitle') }}</p>
      </div>
      <span class="lc-sp" />
      <div class="cl-actions">
        <button class="lc-btn" @click="openLibrary('mine')">
          <LcIcon name="share" /><span>{{ t('views.list.shareLinks') }}</span>
        </button>
        <button class="lc-btn" @click="openLibrary('canvas-template')">
          <LcIcon name="layout" /><span>{{ t('views.list.templates') }}</span>
        </button>
        <button class="lc-btn primary cl-new" @click="openCreateDialog">
          <LcIcon name="plus" /><span>{{ t('views.list.newCanvas') }}</span>
        </button>
      </div>
    </header>

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
      <p>{{ t('views.list.empty') }}</p>
      <button class="lc-btn" @click="openCreateDialog"><LcIcon name="plus" />{{ t('views.list.newCanvas') }}</button>
    </div>

    <div v-else class="cl-grid">
      <div
        v-for="w in list"
        :key="w.id"
        class="lc-card cl-card"
        role="link"
        tabindex="0"
        @click="openCanvas(w.id)"
        @keydown.enter.self="openCanvas(w.id)"
      >
        <div class="lc-thumb cl-thumb">
          <img
            v-if="w.thumbnailType === 'image' && hasCover(w)"
            loading="lazy"
            :src="canvasImageThumb(https(w.thumbnail))"
            alt=""
            @error="onCoverError(w.id)"
          />
          <template v-else-if="w.thumbnailType === 'video' && hasCover(w)">
            <video :src="https(w.thumbnail)" preload="metadata" muted @error="onCoverError(w.id)" />
            <span class="play"><LcIcon name="play" /></span>
          </template>
          <span v-else class="cl-ph"><LcIcon name="canvas" size="xl" /></span>
          <span v-if="w.thumbnailType === 'image' || w.thumbnailType === 'video'" class="lc-bd tag" :class="w.thumbnailType">{{ t(`workbench.kind.${w.thumbnailType}`) }}</span>
        </div>
        <div class="cl-meta">
          <h3 :title="w.name">{{ w.name }}</h3>
          <small>{{ formatTime(w.createdAt) }}</small>
        </div>
        <!--
          复制 / 删除走就地确认气泡。一屏十几张卡片，盖住整页的弹窗会把人从列表里拽出去；
          气泡贴着按钮弹，动的是哪张一目了然。
          ConfirmPop 内部对触发和气泡都做了 click.stop，不会连带把画布点开。
        -->
        <div class="cl-ops">
          <button class="cl-op" :title="t('views.list.renameTip', { name: w.name })" :aria-label="t('views.list.renameTip', { name: w.name })" @click.stop="openRenameDialog(w)">
            <LcIcon name="edit" size="s" />
          </button>
          <button
            class="cl-op"
            :title="t('views.list.downloadTip', { name: w.name })"
            :aria-label="t('views.list.downloadTip', { name: w.name })"
            :disabled="!!downloadingId"
            @click.stop="handleDownload(w)"
          >
            <LcIcon name="download" size="s" />
          </button>
          <ConfirmPop
            :text="t('views.list.duplicateConfirm', { name: w.name })"
            :hint="t('views.list.duplicateHint')"
            :ok-text="t('common.copy')"
            :disabled="duplicating"
            @ok="handleDuplicate(w)"
          >
            <button class="cl-op" :title="t('views.list.duplicateTip', { name: w.name })" :aria-label="t('views.list.duplicateTip', { name: w.name })">
              <LcIcon name="copy" size="s" />
            </button>
          </ConfirmPop>
          <ConfirmPop
            :text="t('views.list.deleteConfirm', { name: w.name })"
            :hint="t('views.list.deleteHint')"
            :disabled="deleting"
            @ok="handleDelete(w)"
          >
            <button class="cl-op danger" :title="t('views.list.deleteTip', { name: w.name })" :aria-label="t('views.list.deleteTip', { name: w.name })">
              <LcIcon name="trash" size="s" />
            </button>
          </ConfirmPop>
        </div>
      </div>
    </div>

    <!-- 画布模板 / 我的分享 弹窗；列表页没有「当前画布」，选中的东西一律落到一个新画布里 -->
    <LibraryDialog
      v-model="libraryOpen"
      :initial-tab="libraryInitialTab"
      @add-asset="onAddAssetToNewCanvas"
      @apply-template="onApplyTemplateToNewCanvas"
      @add-text="onAddTextToNewCanvas"
    />

    <!-- 新建 / 重命名 共用一个弹窗 -->
    <CanvasNameDialog
      v-model="nameDialogOpen"
      :title="renameTarget ? t('views.list.renameTitle') : t('views.list.newCanvas')"
      :initial="renameTarget?.name || ''"
      :ok-text="renameTarget ? t('common.save') : t('views.list.create')"
      :busy-text="renameTarget ? t('common.saving') : t('views.list.creating')"
      :busy="submitting"
      @submit="submitNameDialog"
    />
  </div></div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { workflowApi, apiErrorMessage, type WorkflowSummary } from '@/utils/api'
import LibraryDialog from '@/components/canvas/LibraryDialog.vue'
import ListSkeleton from '@/components/ListSkeleton.vue'
import ConfirmPop from '@/components/ConfirmPop.vue'
import LcIcon from '@/components/LcIcon.vue'
import CanvasNameDialog from '@/components/workbench/CanvasNameDialog.vue'
import { useCanvasCreate, type TemplateLike } from '@/components/workbench/useCanvasCreate'
import { ensureHttps } from '@/utils/mediaUrl'
import { canvasImageThumb } from '@/utils/canvasMedia'

const router = useRouter()
const { t } = useI18n()
const { formatTime, createAndOpen, createFromTemplate, createFromAsset, createFromText } = useCanvasCreate()

const list = ref<WorkflowSummary[]>([])
const loading = ref(false)
const loadError = ref(false)

/**
 * 封面取不到时退回占位图。
 *
 * 老画布的封面指向的资源可能早就没了（换过存储、产物被清理过），
 * 不兜底的话浏览器会画一个破图标 —— 那看着像是页面坏了，而不是这张图没了。
 */
const brokenCovers = ref(new Set<string>())
function onCoverError(id: string) {
  // 换个 Set 才触发重渲染，原地 add 是改不动的
  brokenCovers.value = new Set(brokenCovers.value).add(id)
}
const hasCover = (w: WorkflowSummary) => !!w.thumbnail && !brokenCovers.value.has(w.id)
// WorkflowSummary.thumbnail 是可选的，hasCover 里那层判空 TS 收窄不到这里
const https = (u?: string) => (u ? ensureHttps(u) : '')

async function fetchList() {
  loading.value = true
  loadError.value = false
  try {
    const res = await workflowApi.list()
    if (res.data.result === 0 && res.data.data) {
      list.value = res.data.data
    } else {
      loadError.value = true
    }
  } catch (err) {
    loadError.value = true
    console.error('[canvas-list] fetch failed:', err)
  } finally {
    loading.value = false
  }
}

function openCanvas(id: string) {
  router.push(`/canvas/${id}`)
}

/* ===== 新建 / 重命名 ===== */
const nameDialogOpen = ref(false)
const submitting = ref(false)
/** 有值 = 正在给这张画布改名；空 = 新建 */
const renameTarget = ref<WorkflowSummary | null>(null)

function showNameDialog(target: WorkflowSummary | null) {
  renameTarget.value = target
  nameDialogOpen.value = true
}
const openCreateDialog = () => showNameDialog(null)
const openRenameDialog = (w: WorkflowSummary) => showNameDialog(w)

/** 弹窗已经把名字去过空白、判过空 */
async function submitNameDialog(name: string) {
  if (submitting.value) return
  const target = renameTarget.value
  submitting.value = true
  try {
    const ok = target
      ? name === target.name || await renameCanvas(target, name)
      : await createAndOpen(name)
    if (ok) nameDialogOpen.value = false
  } finally {
    submitting.value = false
  }
}

/** 只改名字，画布内容不动；失败时提示并返回 false */
async function renameCanvas(w: WorkflowSummary, name: string): Promise<boolean> {
  try {
    const res = await workflowApi.update(w.id, { name })
    if (res.data.result !== 0) {
      MessagePlugin.error(res.data.message || t('views.list.renameFailed'))
      return false
    }
    // 列表里就地改名，不为这一个字段整页重拉
    list.value = list.value.map(it => (it.id === w.id ? { ...it, name } : it))
    MessagePlugin.success(t('views.list.renamed'))
    return true
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('views.list.renameFailed')))
    return false
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

/* ===== 卡片上的操作 ===== */
const deleting = ref(false)
const duplicating = ref(false)
const downloadingId = ref('')

async function handleDuplicate(w: WorkflowSummary) {
  if (!w || duplicating.value) return
  duplicating.value = true
  try {
    const res = await workflowApi.duplicate(w.id, t('common.copyName', { name: w.name }))
    if (res.data.result === 0) {
      MessagePlugin.success(t('views.list.duplicated'))
      fetchList()
    } else {
      MessagePlugin.error(res.data.message || t('views.list.duplicateFailed'))
    }
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('views.list.duplicateFailed')))
  } finally {
    duplicating.value = false
  }
}

/** 确认气泡点了「删除」才会走到这里，所以这里不再自己弹确认 */
async function handleDelete(w: WorkflowSummary) {
  if (!w || deleting.value) return
  deleting.value = true
  try {
    const res = await workflowApi.remove(w.id)
    if (res.data.result === 0) {
      MessagePlugin.success(t('views.list.deleted'))
      fetchList()
    } else {
      MessagePlugin.error(res.data.message || t('views.list.deleteFailed'))
    }
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('views.list.deleteFailed')))
  } finally {
    deleting.value = false
  }
}

/** 接口按 blob 收，出错时错误信息也裹在 blob 里，得自己拆出来 */
async function blobErrorMessage(data: unknown): Promise<string> {
  if (!(data instanceof Blob)) return ''
  try { return JSON.parse(await data.text())?.message || '' } catch { return '' }
}

/**
 * 整张画布打包下载：不传 urls，后端把画布里所有图片和视频打成一个 zip。
 * 打包是串行拉流，大画布会等比较久，loading 一直挂到 blob 落地为止。
 */
async function handleDownload(w: WorkflowSummary) {
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
  } finally {
    downloadingId.value = ''
  }
}

onMounted(fetchList)
</script>

<style scoped>
.cl-head { align-items: center; }
.cl-heading { min-width: 0; }
.cl-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.cl-new { height: 40px; padding: 0 20px; }

.cl-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 16px; margin-top: 24px; }
/* 骨架卡是公用组件里的，圆角和边线对到这页的卡片上 */
.cl-grid :deep(.skel-canvas-card) { border-radius: var(--r-md); border-color: var(--line); background: var(--grad-card); }

.cl-card { position: relative; overflow: hidden; min-width: 0; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.cl-card:hover { border-color: var(--line-3); }
.cl-card:focus-visible { outline: none; border-color: var(--cyan); box-shadow: var(--ring); }
.cl-thumb { aspect-ratio: 16 / 10; }
/* 封面可能是浅色的图：徽标垫一层深底才读得出来 */
.cl-thumb .tag { box-shadow: 0 0 0 99px var(--tag-scrim) inset; }
.cl-ph {
  position: absolute; inset: 0; display: grid; place-items: center; color: rgb(var(--c-film-2) / .38);
  background: linear-gradient(135deg, rgb(var(--c-cyan) / .07), rgb(var(--c-violet) / .1));
}
/* 名字是主角、时间是配角 */
.cl-meta { padding: 12px 14px 14px; }
.cl-meta h3 { font: 600 14px/1.5 var(--f-body); color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cl-meta small { display: block; margin-top: 2px; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }

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
  /* 窄屏卡片太小，操作条不再压在封面上，改成卡片底部的一行 */
  .cl-ops {
    position: static; opacity: 1; border: 0; border-top: 1px solid var(--line); border-radius: 0; background: none;
    justify-content: space-around; -webkit-backdrop-filter: none; backdrop-filter: none;
  }
}
</style>
