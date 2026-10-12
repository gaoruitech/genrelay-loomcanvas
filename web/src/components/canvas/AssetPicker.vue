<template>
  <Teleport :to="$lcPortal">
    <div v-if="open" class="lc-mask lc-sheet cp-mask" @click.self="cancel">
      <div class="lc-dialog cp-box">
        <header class="lc-dialog-head">
          <div class="cp-title">
            <div class="lc-seg">
              <button :class="{ on: source === 'mine' }" @click="switchSource('mine')">{{ t('library.picker.mine') }}</button>
              <button :class="{ on: source === 'material' }" @click="switchSource('material')">{{ t('library.picker.material') }}</button>
            </div>
            <span class="cp-sub">{{ mediaTypeLabel }}{{ multiSelect ? ' · ' + t('library.picker.multi') : '' }}</span>
          </div>
          <button class="lc-x" :title="t('common.close')" @click="cancel">×</button>
        </header>

        <div class="lc-dialog-body cp-body">
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
                <img v-if="item.type === 'image'" :src="$src(item.thumbnailUrl || item.fileUrl)" alt="" loading="lazy" />
                <video v-else :src="$src(item.fileUrl)" :poster="$src(item.thumbnailUrl) || undefined" muted preload="metadata" />
              </div>
              <div class="cp-prompt" :title="item.name">{{ item.name || t('library.picker.unnamed') }}</div>
              <span v-if="selected.has(item.id)" class="lc-cb on cp-check" />
            </div>
          </div>

          <div v-if="hasMore && !loading" class="cp-more">
            <button class="lc-btn sm" @click="loadMore">{{ t('library.picker.loadMore') }}</button>
          </div>
          <div v-else-if="loading && list.length > 0" class="cp-more">{{ t('common.loading') }}</div>
        </div>

        <footer class="lc-dialog-foot cp-footer">
          <span class="cp-count">{{ t('library.picker.selected', { n: selected.size }) }}</span>
          <div class="cp-actions">
            <button class="lc-btn" @click="cancel">{{ t('common.cancel') }}</button>
            <button
              class="lc-btn primary quiet"
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
import { canvasAssetApi, userAssetApi } from '@/utils/canvasBackend'
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
  const items: PickerItem[] = (d.list || []).filter((it: any) => it.mediaUrl).map((it: any) => ({
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
.cp-mask { z-index: 9999; }
.cp-box { width: 880px; }
.cp-title { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cp-sub { font: 400 12px var(--f-body); color: var(--text-3); white-space: nowrap; }
.cp-body { flex: 1; min-height: 240px; }
.cp-empty { text-align: center; color: var(--text-3); font-size: 13px; padding: 60px 0; }
.cp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
.cp-item {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  background: var(--grad-card);
  border: 1px solid var(--line);
  cursor: pointer;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.cp-item:hover { border-color: var(--line-3); }
.cp-item.selected { border-color: rgb(var(--c-cyan) / .7); box-shadow: var(--glow-s); }
.cp-thumb { aspect-ratio: 1; background: var(--media-bg); overflow: hidden; }
.cp-thumb img,
.cp-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
.cp-prompt {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cp-check { position: absolute; top: 8px; right: 8px; width: 20px; height: 20px; border-radius: 6px; }
.cp-more { text-align: center; padding: 16px 0 0; color: var(--text-3); font-size: 13px; }
.cp-footer { justify-content: space-between; align-items: center; }
.cp-count { font-size: 13px; color: var(--text-2); }
.cp-actions { display: flex; gap: 10px; }
@media (max-width: 600px) {
  .cp-box { height: calc(92 * var(--lc-vh)); height: calc(92 * var(--lc-dvh)); }
  .cp-sub { display: none; }
  .cp-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .cp-prompt { padding: 6px 8px; font-size: 11px; }
}
</style>
