<template>
  <Teleport to="body">
    <div v-if="open" class="cp-mask" @click.self="cancel">
      <div class="cp-box">
        <header class="cp-header">
          <div class="cp-title">
            <div class="cp-source-tabs">
              <button :class="['cp-source-tab', { active: source === 'mine' }]" @click="switchSource('mine')">{{ t('library.picker.mine') }}</button>
              <button :class="['cp-source-tab', { active: source === 'material' }]" @click="switchSource('material')">{{ t('library.picker.material') }}</button>
            </div>
            <span class="cp-sub">{{ mediaTypeLabel }}{{ multiSelect ? ' · ' + t('library.picker.multi') : '' }}</span>
          </div>
          <button class="cp-close" :title="t('common.close')" @click="cancel">×</button>
        </header>

        <div class="cp-body">
          <div v-if="loading && list.length === 0" class="cp-empty">{{ t('common.loading') }}</div>
          <div v-else-if="!loading && list.length === 0" class="cp-empty">{{ t('library.picker.empty') }}</div>

          <div v-else class="cp-grid">
            <div
              v-for="item in list"
              :key="item.id"
              class="cp-item"
              :class="{ selected: selected.has(item.id) }"
              @click="toggle(item)"
            >
              <div class="cp-thumb">
                <img v-if="item.type === 'image'" :src="item.thumbnailUrl || item.fileUrl" alt="" loading="lazy" />
                <video v-else :src="item.fileUrl" :poster="item.thumbnailUrl || undefined" muted preload="metadata" />
              </div>
              <div class="cp-prompt" :title="item.name">{{ item.name || t('library.picker.unnamed') }}</div>
              <div class="cp-check" v-if="selected.has(item.id)">✓</div>
            </div>
          </div>

          <div v-if="hasMore && !loading" class="cp-more">
            <button class="cp-more-btn" @click="loadMore">{{ t('library.picker.loadMore') }}</button>
          </div>
          <div v-else-if="loading && list.length > 0" class="cp-more">{{ t('common.loading') }}</div>
        </div>

        <footer class="cp-footer">
          <span class="cp-count">{{ t('library.picker.selected', { n: selected.size }) }}</span>
          <div class="cp-actions">
            <button class="cp-btn" @click="cancel">{{ t('common.cancel') }}</button>
            <button
              class="cp-btn primary"
              :disabled="selected.size === 0"
              @click="confirm"
            >{{ t('common.confirm') }}</button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 素材选择器：从本地素材库里挑图片 / 视频填进节点。
 * 两个来源 —— 「我的资产」（自己上传和登记的成品）与「素材库」（内置素材）。
 */
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { canvasAssetApi, userAssetApi } from '@/utils/api'
import { registerThumb } from '@/utils/canvasMedia'
import type { PickerItem, PickerOptions } from '@/composables/canvasPickerKey'

const { t } = useI18n()

const PAGE_SIZE = 24

const open = ref(false)
const loading = ref(false)
const mediaType = ref<'image' | 'video'>('image')
const multiSelect = ref(false)
const source = ref<'mine' | 'material'>('mine')
const list = ref<PickerItem[]>([])
const selected = ref(new Set<string>())
const page = ref(1)
const hasMore = ref(false)

let resolver: ((items: PickerItem[]) => void) | null = null

const mediaTypeLabel = computed(() =>
  mediaType.value === 'image' ? t('nodes.title.image') : t('nodes.title.video'))

// 切来源 / 重新打开时旧请求可能还在路上：只认最后一次发出的那个
let fetchSeq = 0

async function fetchPage(reset = false) {
  if (loading.value && !reset) return
  const seq = ++fetchSeq
  loading.value = true
  try {
    const got = source.value === 'material' ? await fetchMaterialPage() : await fetchMyAssetPage()
    if (seq !== fetchSeq) return
    list.value = reset ? got.items : [...list.value, ...got.items]
    hasMore.value = got.total > list.value.length
  } catch {
    if (seq === fetchSeq && reset) { list.value = []; hasMore.value = false }
  } finally {
    if (seq === fetchSeq) loading.value = false
  }
}

interface FetchedPage { items: PickerItem[]; total: number }

async function fetchMaterialPage(): Promise<FetchedPage> {
  const res = await canvasAssetApi.list({
    nodeType: mediaType.value === 'video' ? 'VIDEO' : 'IMAGE',
    page: page.value,
    pageSize: PAGE_SIZE,
  })
  if (res.data.result !== 0 || !res.data.data) return { items: [], total: 0 }
  const d = res.data.data
  const items: PickerItem[] = (d.list || []).filter(it => it.mediaUrl).map(it => ({
    id: it.id,
    type: it.nodeType === 'VIDEO' ? 'video' : 'image',
    name: it.name || '',
    fileUrl: it.mediaUrl,
    thumbnailUrl: it.thumbnailUrl || '',
  }))
  return { items, total: d.total || 0 }
}

/** 「我的资产」一次拉完（不分页），total 给 0 表示没有下一页 */
async function fetchMyAssetPage(): Promise<FetchedPage> {
  const res = await userAssetApi.list({ pageSize: 100 })
  if (res.data.result !== 0 || !res.data.data) return { items: [], total: 0 }
  const want = mediaType.value === 'video' ? 'VIDEO' : 'IMAGE'
  const items = (res.data.data.list || [])
    .filter((it: any) => (it.nodeType || 'IMAGE') === want && it.mediaUrl)
    .map((it: any): PickerItem => ({
      id: it._id || it.id,
      type: want === 'VIDEO' ? 'video' : 'image',
      name: it.name || '',
      fileUrl: it.mediaUrl,
      thumbnailUrl: it.thumbnailUrl || '',
    }))
  return { items, total: 0 }
}

function switchSource(s: 'mine' | 'material') {
  if (source.value === s) return
  source.value = s
  list.value = []
  selected.value = new Set()
  page.value = 1
  fetchPage(true)
}

function show(opts: PickerOptions): Promise<PickerItem[]> {
  // 上一次还没收尾就又被打开：先按「取消」了结旧的，免得调用方永远等不到结果
  resolver?.([])
  mediaType.value = opts.mediaType
  multiSelect.value = !!opts.multiSelect
  source.value = 'mine'
  list.value = []
  selected.value = new Set()
  page.value = 1
  open.value = true
  // resolver 必须在发请求之前就位：列表还在加载时用户点取消，也要能正常返回
  const result = new Promise<PickerItem[]>((res) => {
    resolver = res
  })
  fetchPage(true)
  return result
}

function finish(items: PickerItem[]) {
  for (const it of items) registerThumb(it.fileUrl, it.thumbnailUrl)
  resolver?.(items)
  cleanup()
}

function toggle(item: PickerItem) {
  if (multiSelect.value) {
    if (selected.value.has(item.id)) selected.value.delete(item.id)
    else selected.value.add(item.id)
    selected.value = new Set(selected.value) // trigger reactivity
  } else {
    // 单选直接确认
    finish([item])
  }
}

function confirm() {
  if (selected.value.size === 0) return
  finish(list.value.filter(i => selected.value.has(i.id)))
}

function cancel() {
  resolver?.([])
  cleanup()
}

function cleanup() {
  open.value = false
  resolver = null
  // 作废还在路上的请求
  fetchSeq += 1
  loading.value = false
}

function loadMore() {
  if (loading.value) return
  page.value += 1
  fetchPage(false)
}

defineExpose({ show })
</script>

<style scoped>
.cp-mask {
  position: fixed;
  inset: 0;
  background: var(--scrim);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cp-box {
  width: 880px;
  max-width: calc(100vw - 40px);
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  background: var(--n-2);
  border: 1px solid var(--n-5);
  border-radius: 12px;
  overflow: hidden;
}
.cp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--n-5);
}
.cp-title {
  color: var(--t-max);
  font-size: 15px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 10px;
}
.cp-sub {
  font-size: 12px;
  color: var(--t-dim);
  font-weight: 400;
}
.cp-source-tabs { display: flex; gap: 4px; background: var(--n-3); border-radius: 8px; padding: 3px; }
.cp-source-tab {
  padding: 5px 14px; border: none; background: none; color: var(--t-dim);
  border-radius: 6px; cursor: pointer; font-size: 13px;
}
.cp-source-tab.active { background: var(--chip-bg); color: var(--chip-fg); font-weight: 600; }
.cp-close {
  background: transparent;
  border: none;
  color: var(--t-dim);
  font-size: 22px;
  cursor: pointer;
  line-height: 1;
}
.cp-close:hover { color: var(--t-max); }

.cp-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}
.cp-empty {
  text-align: center;
  color: var(--t-dim);
  font-size: 13px;
  padding: 60px 0;
}
.cp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.cp-item {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: var(--n-3);
  border: 2px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s ease;
}
.cp-item:hover { border-color: var(--n-7); }
.cp-item.selected { border-color: var(--accent-text); }

.cp-thumb {
  aspect-ratio: 1;
  background: var(--n-0);
  overflow: hidden;
}
.cp-thumb img,
.cp-thumb video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.cp-prompt {
  padding: 6px 8px;
  font-size: 11px;
  color: var(--t-body);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cp-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--accent);
  /* 压在实心青柠上的对勾。青柠两个主题同值，所以字色也必须恒定：
     原来的 --n-0 在亮色下是 #f9fafa，白勾压青柠基本看不见 */
  color: var(--accent-ink);
  font-size: 14px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cp-more {
  text-align: center;
  padding: 16px 0;
  color: var(--t-dim);
  font-size: 13px;
}
.cp-more-btn {
  background: var(--n-3);
  border: 1px solid var(--n-5);
  border-radius: 6px;
  padding: 6px 16px;
  color: var(--t-body);
  font-size: 13px;
  cursor: pointer;
}
.cp-more-btn:hover { border-color: var(--accent-text); color: var(--accent-text); }

.cp-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  border-top: 1px solid var(--n-5);
}
.cp-count { font-size: 12px; color: var(--t-dim); }
.cp-actions { display: flex; gap: 8px; }
.cp-btn {
  padding: 7px 16px;
  background: var(--n-3);
  border: 1px solid var(--n-5);
  border-radius: 6px;
  color: var(--t-body);
  font-size: 13px;
  cursor: pointer;
}
.cp-btn:hover:not(:disabled) { border-color: var(--accent-text); color: var(--accent-text); }
.cp-btn.primary {
  background: var(--btn-bg);
  color: var(--btn-fg);
  border-color: var(--accent-text);
}
.cp-btn.primary:hover:not(:disabled) { background: var(--btn-bg-hover); }
.cp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
