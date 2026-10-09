<template>
  <div class="canvas-list-page">
    <div class="container">
      <header class="page-head">
        <div class="heading">
          <h1>{{ t('views.list.title') }}</h1>
          <p>{{ t('views.list.subtitle') }}</p>
        </div>
        <div class="actions">
          <button class="btn-ghost" @click="openLibrary('mine')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
              <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
            </svg>
            <span>{{ t('views.list.shareLinks') }}</span>
          </button>
          <button class="btn-ghost" @click="openLibrary('canvas-template')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
            <span>{{ t('views.list.templates') }}</span>
          </button>
          <button class="btn-new" @click="openCreateDialog">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>{{ t('views.list.newCanvas') }}</span>
          </button>
        </div>
      </header>

      <!-- 冷启动（屏幕上还没有任何画布）才出骨架 -->
      <div v-if="loading && list.length === 0" class="grid">
        <ListSkeleton variant="canvas" :count="8" />
      </div>
      <div v-else-if="loadError && list.length === 0" class="state-msg">
        <div>{{ t('views.list.loadFailed') }}</div>
        <button class="btn-ghost state-retry" @click="fetchList">{{ t('common.retry') }}</button>
      </div>
      <div v-else-if="list.length === 0" class="state-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <div>{{ t('views.list.empty') }}</div>
      </div>

      <div v-else class="grid">
        <div v-for="w in list" :key="w.id" class="card" @click="openCanvas(w.id)">
          <div class="thumb">
            <img
              v-if="w.thumbnailType === 'image' && hasCover(w)"
              loading="lazy"
              :src="https(w.thumbnail)"
              alt=""
              @error="onCoverError(w.id)"
            />
            <template v-else-if="w.thumbnailType === 'video' && hasCover(w)">
              <video :src="https(w.thumbnail)" preload="metadata" muted @error="onCoverError(w.id)" />
              <span class="play-overlay">
                <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg>
              </span>
            </template>
            <span v-else class="thumb-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </span>
          </div>
          <div class="meta">
            <div class="name" :title="w.name">{{ w.name }}</div>
            <div class="time">{{ formatTime(w.createdAt) }}</div>
          </div>
          <!--
            复制 / 删除走就地确认气泡。一屏十几张卡片，盖住整页的弹窗会把人从列表里拽出去；
            气泡贴着按钮弹，动的是哪张一目了然。
            ConfirmPop 内部对触发和气泡都做了 click.stop，不会连带把画布点开。
          -->
          <div class="card-ops">
            <button class="btn-op" :title="t('views.list.renameTip', { name: w.name })" @click.stop="openRenameDialog(w)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
              </svg>
            </button>
            <button
              class="btn-op"
              :title="t('views.list.downloadTip', { name: w.name })"
              :disabled="!!downloadingId"
              @click.stop="handleDownload(w)"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            <ConfirmPop
              :text="t('views.list.duplicateConfirm', { name: w.name })"
              :hint="t('views.list.duplicateHint')"
              :ok-text="t('common.copy')"
              :disabled="duplicating"
              @ok="handleDuplicate(w)"
            >
              <button class="btn-op" :title="t('views.list.duplicateTip', { name: w.name })">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="12" height="12" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </ConfirmPop>
            <ConfirmPop
              :text="t('views.list.deleteConfirm', { name: w.name })"
              :hint="t('views.list.deleteHint')"
              :disabled="deleting"
              @ok="handleDelete(w)"
            >
              <button class="btn-op danger" :title="t('views.list.deleteTip', { name: w.name })">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
              </button>
            </ConfirmPop>
          </div>
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
    <div v-if="nameDialogOpen" class="modal-mask" @click.self="closeNameDialog">
      <div class="modal">
        <div class="modal-header">
          <span>{{ renameTarget ? t('views.list.renameTitle') : t('views.list.newCanvas') }}</span>
          <button class="modal-close" :title="t('common.close')" @click="closeNameDialog">×</button>
        </div>
        <div class="modal-body">
          <label class="modal-label">{{ t('views.list.nameLabel') }}</label>
          <input
            ref="nameInputRef"
            v-model="nameDraft"
            class="modal-input"
            :placeholder="t('views.list.namePlaceholder')"
            maxlength="80"
            @keydown.enter="submitNameDialog"
            @keydown.escape="closeNameDialog"
          />
        </div>
        <div class="modal-footer">
          <button class="modal-btn" :disabled="submitting" @click="closeNameDialog">{{ t('common.cancel') }}</button>
          <button class="modal-btn primary" :disabled="submitting" @click="submitNameDialog">
            {{ submitLabel }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { workflowApi, apiErrorMessage, type WorkflowSummary } from '@/utils/api'
import LibraryDialog from '@/components/canvas/LibraryDialog.vue'
import ListSkeleton from '@/components/ListSkeleton.vue'
import ConfirmPop from '@/components/ConfirmPop.vue'
import { ensureHttps } from '@/utils/mediaUrl'

const router = useRouter()
const { t } = useI18n()

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
const nameDraft = ref('')
const submitting = ref(false)
/** 有值 = 正在给这张画布改名；空 = 新建 */
const renameTarget = ref<WorkflowSummary | null>(null)
const nameInputRef = ref<HTMLInputElement | null>(null)

const submitLabel = computed(() => {
  if (renameTarget.value) return submitting.value ? t('common.saving') : t('common.save')
  return submitting.value ? t('views.list.creating') : t('views.list.create')
})

function showNameDialog(target: WorkflowSummary | null) {
  renameTarget.value = target
  nameDraft.value = target?.name || ''
  nameDialogOpen.value = true
  nextTick(() => {
    nameInputRef.value?.focus()
    nameInputRef.value?.select()
  })
}
const openCreateDialog = () => showNameDialog(null)
const openRenameDialog = (w: WorkflowSummary) => showNameDialog(w)

function closeNameDialog() {
  if (submitting.value) return
  nameDialogOpen.value = false
}

async function submitNameDialog() {
  if (submitting.value) return
  const name = nameDraft.value.trim()
  if (!name) {
    MessagePlugin.warning(t('views.list.nameRequired'))
    return
  }
  const target = renameTarget.value
  submitting.value = true
  try {
    const ok = target
      ? name === target.name || await renameCanvas(target, name)
      : await createAndOpen(name, [], [])
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

/** 建一个画布并进入编辑器；失败时提示并返回 false */
async function createAndOpen(name: string, nodes: any[], edges: any[]): Promise<boolean> {
  try {
    const res = await workflowApi.create({ name, nodes, edges })
    if (res.data.result === 0 && res.data.data) {
      router.push(`/canvas/${res.data.data.id}`)
      return true
    }
    MessagePlugin.error(res.data.message || t('views.list.createFailed'))
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('views.list.createFailed')))
  }
  return false
}

/* ===== 素材库弹窗（列表页只用到「画布模板」和「我的分享」两个入口） ===== */
type LibraryTab = 'material' | 'my-asset' | 'canvas-template' | 'text-template' | 'mine'
const libraryOpen = ref(false)
const libraryInitialTab = ref<LibraryTab>('canvas-template')

function openLibrary(tab: LibraryTab) {
  libraryInitialTab.value = tab
  libraryOpen.value = true
}

const untitledName = () => t('views.list.untitled', { time: formatTime(new Date().toISOString()) })
/** 自动命名：优先用素材 / 模板自己的名字，否则按时间 */
const autoName = (preferred?: string) => preferred?.trim().slice(0, 80) || untitledName()

// 素材「添加到画布」：自动新建一个画布并把素材作为节点放进去，然后进入编辑器
async function onAddAssetToNewCanvas(asset: { nodeType?: string; mediaUrl?: string; name?: string }) {
  if (!asset?.mediaUrl) return
  const isVideo = asset.nodeType === 'VIDEO'
  const node = {
    id: `n_${Date.now().toString(36)}_0`,
    type: isVideo ? 'video' : 'image',
    position: { x: 200, y: 120 },
    data: isVideo ? { videoUrl: asset.mediaUrl } : { imageUrl: asset.mediaUrl },
  }
  if (await createAndOpen(autoName(asset.name), [node], [])) libraryOpen.value = false
}

// 画布模板「使用模板」：自动新建画布并把模板节点图铺进去，然后进入编辑器
async function onApplyTemplateToNewCanvas(tpl: { title?: string; graph?: { nodes?: any[]; edges?: any[] } }) {
  const g = tpl?.graph
  if (!g || !Array.isArray(g.nodes) || g.nodes.length === 0) {
    MessagePlugin.warning(t('views.list.templateEmpty'))
    return
  }
  // 模板局部 id → 新的全局 id（用下标保证唯一）
  const base = Date.now().toString(36)
  const idMap = new Map<string, string>()
  g.nodes.forEach((n: any, i: number) => idMap.set(n.id, `n_${base}_${i}`))

  const nodes = g.nodes.map((n: any) => ({
    id: idMap.get(n.id)!,
    type: n.type,
    position: { x: n.position?.x || 0, y: n.position?.y || 0 },
    data: JSON.parse(JSON.stringify(n.data || {})),
  }))
  const edges = (g.edges || [])
    .filter((e: any) => idMap.has(e.source) && idMap.has(e.target))
    .map((e: any, i: number) => ({
      id: `e_${base}_${i}`,
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'glow',
    }))

  if (await createAndOpen(autoName(tpl.title), nodes, edges)) libraryOpen.value = false
}

// 文本模板「添加到画布」：自动新建画布，放一个文本节点，然后进入编辑器
async function onAddTextToNewCanvas(content: string) {
  if (!content || !content.trim()) return
  const node = {
    id: `n_${Date.now().toString(36)}_0`,
    type: 'text',
    position: { x: 200, y: 120 },
    data: { text: content },
  }
  if (await createAndOpen(untitledName(), [node], [])) libraryOpen.value = false
}

/* ===== 卡片上的操作 ===== */
const deleting = ref(false)
const duplicating = ref(false)
const downloadingId = ref('')

async function handleDuplicate(w: WorkflowSummary) {
  if (!w || duplicating.value) return
  duplicating.value = true
  try {
    const res = await workflowApi.duplicate(w.id)
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

/**
 * 卡片上的时间。
 *
 * 今天 / 昨天说人话，今年只给月日，跨年才补年份 —— 完整的 2026-07-03 10:41
 * 在卡片上跟标题抢注意力，而它只是个次要信息，认得出「哪张更新」就够了。
 */
function formatTime(v: string | undefined) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

  const now = new Date()
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (sameDay(d, now)) return t('views.list.today', { time: hm })
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay(d, yesterday)) return t('views.list.yesterday', { time: hm })

  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return d.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}-${md}`
}

onMounted(fetchList)
</script>

<style scoped>
/* 外层应用壳已经有顶栏了，这里只是壳里的一块可滚动内容区 */
.canvas-list-page {
  height: 100%;
  overflow-y: auto;
  background: var(--n-0);
  box-sizing: border-box;
}

.container {
  padding: 28px 40px 48px;
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 24px;
}
.heading { min-width: 0; }
.heading h1 {
  margin: 0;
  color: var(--t-max);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.2;
}
.heading p {
  margin: 6px 0 0;
  color: var(--t-dim);
  font-size: 13px;
}

.actions {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.btn-new {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 14px;
  background: var(--btn-bg);
  color: var(--btn-fg);
  border: none;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}
.btn-new:hover { background: var(--btn-bg-hover); }
.btn-new svg { width: 14px; height: 14px; }

.btn-ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 0 14px;
  background: var(--n-2);
  color: var(--t-body);
  border: 1px solid var(--n-6);
  border-radius: 7px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-ghost:hover {
  border-color: var(--accent-veil);
  color: var(--accent-text);
}
.btn-ghost svg { width: 14px; height: 14px; }

.state-msg, .state-empty {
  text-align: center;
  padding: 80px 20px;
  color: var(--t-dim);
  font-size: 14px;
}
.state-retry { margin-top: 14px; }
.state-empty svg {
  width: 56px;
  height: 56px;
  color: var(--n-7);
  margin: 0 auto 14px;
  display: block;
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
}
@media (max-width: 1200px) {
  .grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 900px) {
  .grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 600px) {
  .container { padding: 20px 16px 32px; }
  .grid { grid-template-columns: 1fr; }
}

.card {
  position: relative;
  background: var(--n-3);
  border: 1px solid var(--n-5);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
}
.card:hover {
  transform: translateY(-2px);
  border-color: var(--accent-text);
  background: var(--n-4);
}

.thumb {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  background: var(--n-2);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.thumb img, .thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.thumb-empty {
  color: var(--n-7);
  width: 48px;
  height: 48px;
}
.thumb-empty svg { width: 100%; height: 100%; }

.play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.play-overlay svg {
  width: 28px;
  height: 28px;
  color: var(--on-scrim);
  background: var(--scrim);
  border-radius: 50%;
  padding: 8px;
  box-sizing: content-box;
}

/* 名字是主角、时间是配角：靠字号和颜色拉开层级，别让两行一样重 */
.meta {
  padding: 10px 12px 11px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.name {
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--t-max);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.time {
  font-size: 11px;
  line-height: 1.3;
  color: var(--t-dim);
  /* 一列卡片的时间要对得齐，等宽数字 */
  font-variant-numeric: tabular-nums;
}

/* 卡片右上角的一排操作：悬停才出现，不跟封面抢戏 */
.card-ops {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 6px;
  opacity: 0;
  transition: opacity 0.18s ease;
}
.card:hover .card-ops,
.card-ops:focus-within { opacity: 1; }
/* 触屏没有悬停，直接常显 */
@media (hover: none) {
  .card-ops { opacity: 1; }
}
.btn-op {
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--glass-panel);
  border: 1px solid var(--n-5);
  border-radius: 6px;
  color: var(--t-body);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}
.btn-op:hover { color: var(--accent-text); border-color: var(--accent-text); }
.btn-op.danger:hover { color: var(--danger); border-color: var(--danger); }
.btn-op svg { width: 14px; height: 14px; }
.btn-op:disabled { opacity: .4; cursor: not-allowed; }

/* ============ 模态弹窗 ============ */
.modal-mask {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}
.modal {
  width: 420px;
  max-width: calc(100vw - 40px);
  background: var(--n-3);
  border: 1px solid var(--n-5);
  border-radius: 12px;
  box-shadow: 0 20px 60px var(--shadow-2);
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--n-5);
  color: var(--t-max);
  font-size: 15px;
  font-weight: 600;
}
.modal-close {
  background: transparent;
  border: none;
  color: var(--t-dim);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.modal-close:hover { color: var(--t-max); }

.modal-body {
  padding: 18px 20px;
}
.modal-label {
  display: block;
  font-size: 13px;
  color: var(--t-body);
  margin-bottom: 8px;
}
.modal-input {
  width: 100%;
  padding: 10px 12px;
  background: var(--n-2);
  border: 1px solid var(--n-5);
  border-radius: 8px;
  color: var(--t-max);
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s ease;
  box-sizing: border-box;
}
.modal-input:focus { border-color: var(--accent-text); }
.modal-input::placeholder { color: var(--t-dim); }

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px 18px;
}
.modal-btn {
  padding: 8px 18px;
  background: transparent;
  border: 1px solid var(--n-7);
  border-radius: 8px;
  color: var(--t-body);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.modal-btn:hover:not(:disabled) { border-color: var(--accent-text); color: var(--accent-text); }
.modal-btn.primary {
  background: var(--btn-bg);
  border-color: var(--accent-text);
  color: var(--btn-fg);
  font-weight: 600;
}
.modal-btn.primary:hover:not(:disabled) { background: var(--btn-bg-hover); border-color: var(--accent-hover); color: var(--btn-fg); }
.modal-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
