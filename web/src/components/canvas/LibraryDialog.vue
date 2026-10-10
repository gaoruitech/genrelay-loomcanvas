<template>
  <div v-if="modelValue" class="lc-mask lc-sheet lib-mask" @click.self="close">
    <div class="lc-dialog lib-dialog">
      <div class="lib-header">
        <div class="lc-seg lib-tabs">
          <button
            v-for="tab in visibleTabs"
            :key="tab.key"
            :class="{ on: activeTab === tab.key }"
            @click="switchTab(tab.key)"
          >{{ t(tab.label) }}</button>
        </div>
        <label v-if="activeTab === 'mine' || activeTab === 'text-template'" class="lc-inp sm lib-search">
          <LcIcon name="search" size="s" />
          <input v-model="searchText" :placeholder="searchPlaceholder" />
        </label>
        <button class="lc-x lib-close" :title="t('common.close')" @click="close">×</button>
      </div>

      <div class="lib-body" ref="bodyRef" @scroll="onBodyScroll">
        <!-- 素材库 -->
        <template v-if="activeTab === 'material'">
          <div class="lib-sub-bar" v-if="materialCats.length > 0">
            <div class="cat-tabs">
              <button
                v-for="c in materialCats"
                :key="c.code"
                :class="['cat-tab', { active: materialCode === c.code }]"
                @click="switchMaterialCat(c.code)"
              >{{ c.name }}</button>
            </div>
          </div>

          <div v-if="(materialLoading || !materialCatsLoaded) && materialList.length === 0" class="lib-empty">{{ t('common.loading') }}</div>
          <div v-else-if="materialCats.length === 0 || materialList.length === 0" class="lib-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <div>{{ t('library.material.empty') }}</div>
          </div>

          <template v-else>
            <div class="lib-grid">
              <div v-for="item in materialList" :key="item.id" class="lib-card">
                <div class="lib-thumb" @mouseenter="onThumbEnter" @mouseleave="onThumbLeave">
                  <img v-if="item.nodeType === 'IMAGE' && (item.thumbnailUrl || item.mediaUrl)" :src="https(item.thumbnailUrl || item.mediaUrl)" alt="" loading="lazy" />
                  <template v-else-if="item.nodeType === 'VIDEO' && (item.mediaUrl || item.thumbnailUrl)">
                    <!-- 鼠标悬停自动播放（muted+loop），移开暂停回到首帧 -->
                    <video
                      :src="item.mediaUrl ? https(item.mediaUrl) : undefined"
                      :poster="item.thumbnailUrl ? https(item.thumbnailUrl) : undefined"
                      muted loop playsinline preload="none"
                    />
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

                  <!-- hover overlay: 添加到画布 -->
                  <div class="thumb-overlay">
                    <button class="lc-btn sm primary quiet add-btn" @click="addMaterial(item)">{{ t('library.addToCanvas') }}</button>
                  </div>
                </div>
                <div class="lib-meta">
                  <div class="lib-name">{{ item.name }}</div>
                </div>
              </div>
            </div>
            <div v-if="materialLoading" class="lib-loading-more">{{ t('common.loading') }}</div>
            <div v-else-if="!hasMoreMaterial" class="lib-loading-more">{{ t('library.noMore') }}</div>
          </template>
        </template>

        <!-- 我的资产 -->
        <template v-else-if="activeTab === 'my-asset'">
          <div class="lib-sub-bar spread">
            <div class="cat-tabs">
              <button v-for="k in MY_KINDS" :key="k" :class="['cat-tab', { active: myAssetKind === k }]" @click="switchMyKind(k)">{{ t('library.myAsset.kinds.' + k) }}</button>
            </div>
            <button class="lc-btn sm" :disabled="myAssetUploading" @click="assetFileInput?.click()">
              <LcIcon name="upload" size="s" />{{ myAssetUploading ? t('common.uploading') : t('library.myAsset.upload') }}
            </button>
            <input ref="assetFileInput" type="file" accept="image/*,video/*" multiple hidden @change="onAssetFiles" />
          </div>
          <div v-if="myAssetLoading && !myAssetList.length" class="lib-empty">{{ t('common.loading') }}</div>
          <div v-else-if="!myAssetList.length" class="lib-empty">{{ t('library.myAsset.empty') }}</div>
          <div v-else class="lib-grid">
            <div v-for="item in myAssetList" :key="item._id" class="lib-card">
              <div class="lib-thumb" @mouseenter="onThumbEnter" @mouseleave="onThumbLeave">
                <img v-if="item.nodeType !== 'VIDEO'" :src="https(item.thumbnailUrl || item.mediaUrl)" alt="" loading="lazy" />
                <template v-else>
                  <!-- 没有单独的封面图时接口把 thumbnailUrl 填成视频地址本身，拿它当 poster 是张裂图，
                       卡片就是一块空底色：这种情况改成只取元数据，让浏览器显示首帧 -->
                  <video
                    :src="item.mediaUrl ? https(item.mediaUrl) : undefined"
                    :poster="hasOwnPoster(item) ? https(item.thumbnailUrl) : undefined"
                    muted loop playsinline :preload="hasOwnPoster(item) ? 'none' : 'metadata'"
                  />
                  <span class="play-overlay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4" /></svg></span>
                </template>
                <div class="thumb-overlay"><button class="lc-btn sm primary quiet add-btn" @click="addMyAsset(item)">{{ t('library.addToCanvas') }}</button></div>
                <button class="btn-del" :title="t('common.delete')" @click.stop="confirmRemoveAsset(item)"><LcIcon name="trash" size="s" /></button>
              </div>
              <div class="lib-meta"><div class="lib-name">{{ item.name || t('library.unnamed') }}</div></div>
            </div>
          </div>
        </template>

        <!-- 画布模板 -->
        <template v-else-if="activeTab === 'canvas-template'">
          <div v-if="canvasTplLoading && canvasTplList.length === 0" class="lib-empty">{{ t('common.loading') }}</div>
          <div v-else-if="canvasTplList.length === 0" class="lib-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="9" x2="9" y2="21" />
            </svg>
            <div>{{ t('library.template.empty') }}</div>
          </div>
          <div v-else class="lib-grid">
            <div v-for="tpl in canvasTplList" :key="tpl.key" class="lib-card clickable" @click="applyCanvasTpl(tpl)">
              <div class="lib-thumb">
                <img v-if="tpl.cover" :src="https(tpl.cover)" :alt="tpl.title" loading="lazy" />
                <span v-else class="thumb-empty">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="9" x2="9" y2="21" />
                  </svg>
                </span>
                <div class="thumb-overlay">
                  <button class="lc-btn sm primary quiet add-btn">{{ t('library.useTemplate') }}</button>
                </div>
              </div>
              <div class="lib-meta">
                <div class="lib-name">{{ tpl.title }}</div>
                <div v-if="tpl.description" class="lib-sub"><span class="sub-main">{{ tpl.description }}</span></div>
              </div>
            </div>
          </div>
        </template>

        <!-- 文本模板 -->
        <template v-else-if="activeTab === 'text-template'">
          <div class="lib-sub-bar spread">
            <div class="cat-tabs">
              <button
                v-for="c in textTplCategories"
                :key="c"
                :class="['cat-tab', { active: textTplCat === c }]"
                @click="textTplCat = c"
              >{{ c === '__all__' ? t('common.all') : c }}</button>
            </div>
            <div class="lc-seg tt-lang">
              <button :class="{ on: textTplLang === 'zh' }" @click="switchTextLang('zh')">{{ t('library.text.langZh') }}</button>
              <button :class="{ on: textTplLang === 'en' }" @click="switchTextLang('en')">{{ t('library.text.langEn') }}</button>
            </div>
          </div>

          <div v-if="textTplLoading" class="lib-empty">{{ t('common.loading') }}</div>
          <div v-else-if="!filteredTextTpl.length" class="lib-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            <div>{{ t('library.text.empty') }}</div>
          </div>
          <div v-else class="tt-grid">
            <div v-for="tpl in filteredTextTpl" :key="tpl.id" class="lc-card tt-card" @click="pickTextTpl(tpl)">
              <div class="tt-card-head">
                <span class="tt-card-title">{{ tpl.title }}</span>
                <span v-if="tpl.category" class="lc-chip tt-card-cat">{{ tpl.category }}</span>
              </div>
              <div class="tt-card-content">{{ tpl.content }}</div>
              <div class="tt-card-hover">
                <span class="lc-btn sm primary quiet">{{ t('library.addToCanvas') }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- 我的分享：已生成的分享链接 -->
        <template v-else>
          <div v-if="mineLoading && mineList.length === 0" class="lib-empty">{{ t('common.loading') }}</div>
          <div v-else-if="filteredMine.length === 0" class="lib-empty">{{ t('library.share.empty') }}</div>

          <div v-else class="lib-grid">
            <div
              v-for="item in filteredMine"
              :key="item.id"
              class="lib-card"
              :class="{ inactive: shareState(item) !== 'active' }"
            >
              <div class="lib-thumb">
                <img v-if="item.thumbnailType === 'image' && item.thumbnail" :src="https(item.thumbnail)" alt="" loading="lazy" />
                <template v-else-if="item.thumbnailType === 'video' && item.thumbnail">
                  <video :src="https(item.thumbnail)" preload="metadata" muted />
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

                <span class="lc-bd status-tag" :class="'st-' + shareState(item)">{{ t('library.share.' + shareState(item)) }}</span>
              </div>

              <div class="lib-meta">
                <div class="lib-name">{{ item.title || t('library.unnamed') }}</div>
                <div class="lib-sub">
                  <span class="sub-main">{{ expiryText(item) }}</span>
                  <span class="sub-side">{{ t('library.share.nodeCount', { n: item.nodeCount || 0 }) }}</span>
                </div>
                <!-- 都是本机操作，不调模型：一律描边按钮 -->
                <div class="share-actions">
                  <button class="lc-btn sm" :disabled="shareState(item) !== 'active'" @click="copyLink(item)">{{ t('library.share.copyLink') }}</button>
                  <button class="lc-btn sm" :disabled="shareState(item) !== 'active'" @click="openShare(item)">{{ t('library.share.open') }}</button>
                  <button
                    class="lc-btn sm"
                    :disabled="shareState(item) !== 'active' || !!copyingId"
                    @click="copyToMine(item)"
                  >{{ copyingId === item.id ? t('library.share.copying') : t('library.share.copyToMine') }}</button>
                  <button v-if="!item.revoked" class="lc-btn sm danger" @click="confirmRevoke(item)">{{ t('library.share.revoke') }}</button>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- 二次确认（撤销分享链接 / 删除资产） -->
    <div v-if="pending" class="lc-mask confirm-mask" @click.self="cancelPending">
      <div class="lc-dialog confirm-dialog">
        <div class="lc-dialog-head"><span>{{ pending.title }}</span><button class="lc-x" :disabled="pendingBusy" @click="cancelPending">×</button></div>
        <div class="lc-dialog-body">
          <p class="confirm-text">{{ pending.text }}</p>
        </div>
        <div class="lc-dialog-foot">
          <button class="lc-btn" :disabled="pendingBusy" @click="cancelPending">{{ t('common.cancel') }}</button>
          <button class="lc-btn danger" :disabled="pendingBusy" @click="runPending">{{ pendingBusy ? pending.busyText : pending.okText }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import LcIcon from '@/components/LcIcon.vue'
import { MessagePlugin } from 'tdesign-vue-next'
import {
  canvasShareApi, canvasAssetApi, canvasTemplateApi, canvasTextTemplateApi, userAssetApi, apiErrorMessage,
  type CanvasShareSummary, type CanvasAssetCategory, type CanvasAssetItem,
} from '@/utils/api'
import { ensureHttps } from '@/utils/mediaUrl'
import { registerThumb } from '@/utils/canvasMedia'
import { uploadCanvasImage, uploadCanvasVideo } from '@/utils/canvasUpload'

type TabKey = 'material' | 'my-asset' | 'canvas-template' | 'text-template' | 'mine'

// 画布模板 / 文本模板 卡片类型（与各自独立弹窗保持一致）
interface CanvasTplItem { key: string; title: string; description?: string; cover?: string; graph?: any }
interface TextTplItem { id: string; title: string; content: string; category: string; lang?: string }

// label 存的是文案键，渲染时再翻译（语言可以在运行时切换）
const TABS: { key: TabKey; label: string }[] = [
  { key: 'material', label: 'library.tabs.material' },
  { key: 'my-asset', label: 'library.tabs.myAsset' },
  { key: 'canvas-template', label: 'library.tabs.canvasTemplate' },
  { key: 'text-template', label: 'library.tabs.textTemplate' },
  { key: 'mine', label: 'library.tabs.mine' },
]

const props = defineProps<{
  modelValue: boolean
  initialTab?: TabKey
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'add-asset', asset: CanvasAssetItem): void
  (e: 'apply-template', tpl: CanvasTplItem): void
  (e: 'add-text', content: string): void
}>()

const router = useRouter()
const { t, locale } = useI18n()

// 网格里一屏几十张：后端给了 thumbnailUrl 就用它，没有才退回原图
const https = (u: string) => (u ? ensureHttps(u) : u)
/** 视频资产有没有一张真正的封面图（而不是被填成了视频地址本身） */
const hasOwnPoster = (item: { thumbnailUrl?: string; mediaUrl?: string }) =>
  !!item.thumbnailUrl && item.thumbnailUrl !== item.mediaUrl

// 素材库视频：鼠标悬停自动播放，移开暂停并回到首帧
const onThumbEnter = (e: MouseEvent) => {
  const v = (e.currentTarget as HTMLElement)?.querySelector('video') as HTMLVideoElement | null
  if (v) v.play().catch(() => {})
}
const onThumbLeave = (e: MouseEvent) => {
  const v = (e.currentTarget as HTMLElement)?.querySelector('video') as HTMLVideoElement | null
  if (v) { v.pause(); try { v.currentTime = 0 } catch { /* noop */ } }
}

function isTab(v: any): v is TabKey {
  return TABS.some((x) => x.key === v)
}
/** 调用方传了不认识的标签（比如旧数据里的值）就落回素材库 */
function initialTabKey(): TabKey {
  return isTab(props.initialTab) ? props.initialTab : 'material'
}

const activeTab = ref<TabKey>(initialTabKey())
const searchText = ref('')
const bodyRef = ref<HTMLElement | null>(null)

const searchPlaceholder = computed(() =>
  activeTab.value === 'text-template' ? t('library.text.searchTemplate') : t('library.share.search'))

function close() {
  emit('update:modelValue', false)
}

/** 进入某个标签时拉它的数据 */
function loadTab(tab: TabKey) {
  if (tab === 'material') initMaterial()
  else if (tab === 'my-asset') loadMyAssets()
  else if (tab === 'canvas-template') loadCanvasTpl()
  else if (tab === 'text-template') { textTplCat.value = '__all__'; loadTextTpl(textTplLang.value) }
  // 分享链接是在画布里生成的，每次进来都重新拉，免得看到旧列表
  else if (tab === 'mine') loadMine()
}

function switchTab(tab: TabKey) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  searchText.value = ''
  loadTab(tab)
}

// ===== 二次确认 =====
interface PendingConfirm { title: string; text: string; okText: string; busyText: string; run: () => Promise<void> }
const pending = ref<PendingConfirm | null>(null)
const pendingBusy = ref(false)

function cancelPending() {
  if (!pendingBusy.value) pending.value = null
}
async function runPending() {
  const p = pending.value
  if (!p || pendingBusy.value) return
  pendingBusy.value = true
  try {
    await p.run()
    pending.value = null
  } catch {
    // 失败提示由各自的 run 给出；弹窗留着，方便重试
  } finally {
    pendingBusy.value = false
  }
}

// ===== 素材库 =====
// 公共素材是部署方预置的（canvasassets 集合），界面上没有录入入口。
// 一张都没有时不显示这个标签页 —— 否则资源库一打开永远是个空页。
const visibleTabs = computed(() => TABS.filter((tab) =>
  tab.key !== 'material' || !materialCatsLoaded.value || materialCats.value.length > 0))
const materialCats = ref<CanvasAssetCategory[]>([])
const materialCode = ref<string>('')
const materialList = ref<CanvasAssetItem[]>([])
const materialLoading = ref(false)
const materialCatsLoaded = ref(false)
const materialPage = ref(1)
const materialTotal = ref(0)
const materialPageSize = 20
const hasMoreMaterial = computed(() => materialList.value.length < materialTotal.value)
// 切分类时旧请求可能还没回来，回来了也不能覆盖新分类的列表
let materialSeq = 0

/** 分类只拉一次。弹窗一打开就拉（不管落在哪个标签页），标签栏才知道要不要显示「素材库」 */
let materialCatsJob: Promise<void> | null = null
function loadMaterialCats(): Promise<void> {
  materialCatsJob ||= (async () => {
    try {
      const res = await canvasAssetApi.categories()
      if (res.data.result === 0 && res.data.data) {
        materialCats.value = res.data.data
      }
    } catch { /* 静默：拉不到分类就显示空态 */ }
    materialCatsLoaded.value = true
  })()
  return materialCatsJob
}

async function initMaterial() {
  await loadMaterialCats()
  if (materialCats.value.length === 0) {
    // 这个实例没有预置公共素材：标签页本身已经隐藏（见 visibleTabs），人落到「我的资产」
    if (activeTab.value === 'material') switchTab('my-asset')
    return
  }
  // 默认选中第一个分类
  if (!materialCode.value) materialCode.value = materialCats.value[0].code
  if (materialList.value.length === 0) loadMaterial(true)
}

function switchMaterialCat(code: string) {
  if (materialCode.value === code) return
  materialCode.value = code
  materialList.value = []
  if (bodyRef.value) bodyRef.value.scrollTop = 0
  loadMaterial(true)
}

async function loadMaterial(reset = false) {
  if (materialLoading.value && !reset) return
  if (reset) { materialPage.value = 1; materialTotal.value = 0 }
  const seq = ++materialSeq
  materialLoading.value = true
  try {
    const res = await canvasAssetApi.list({ code: materialCode.value, page: materialPage.value, pageSize: materialPageSize })
    if (seq !== materialSeq) return
    if (res.data.result === 0 && res.data.data) {
      const d = res.data.data
      materialTotal.value = d.total
      materialList.value = reset ? d.list : [...materialList.value, ...d.list]
    }
  } catch (err: any) {
    if (seq === materialSeq) MessagePlugin.error(apiErrorMessage(err, t('common.loadFailed')))
  } finally {
    if (seq === materialSeq) materialLoading.value = false
  }
}

// 滚动到底部自动加载（仅素材库）
function onBodyScroll() {
  if (activeTab.value !== 'material') return
  const el = bodyRef.value
  if (!el) return
  if (materialLoading.value || !hasMoreMaterial.value) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
    materialPage.value += 1
    loadMaterial(false)
  }
}

/** 素材进画布：顺手登记缩略图，节点里的小图就不用拉原图 */
function emitAsset(asset: CanvasAssetItem) {
  registerThumb(asset.mediaUrl, asset.thumbnailUrl)
  emit('add-asset', asset)
  close()
}

function addMaterial(item: CanvasAssetItem) {
  emitAsset(item)
}

// ===== 我的资产 =====
const MY_KINDS = ['product', 'brand', 'reference', 'output'] as const
type MyKind = typeof MY_KINDS[number]
const myAssetKind = ref<MyKind>('product')
const myAssetList = ref<any[]>([])
const myAssetLoading = ref(false)
const myAssetUploading = ref(false)
const assetFileInput = ref<HTMLInputElement | null>(null)
let myAssetSeq = 0

async function loadMyAssets() {
  const seq = ++myAssetSeq
  myAssetLoading.value = true
  try {
    const res = await userAssetApi.list({ kind: myAssetKind.value, pageSize: 100 })
    if (seq !== myAssetSeq) return
    if (res.data.result === 0) myAssetList.value = res.data.data?.list || []
  } catch { /* 静默：显示空态 */ } finally {
    if (seq === myAssetSeq) myAssetLoading.value = false
  }
}

function switchMyKind(k: MyKind) {
  if (myAssetKind.value === k) return
  myAssetKind.value = k
  myAssetList.value = []
  loadMyAssets()
}

function addMyAsset(item: any) {
  emitAsset({
    id: item._id || item.id, name: item.name || '', code: '', categoryName: '',
    nodeType: item.nodeType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    mediaUrl: item.mediaUrl, thumbnailUrl: item.thumbnailUrl || item.mediaUrl,
    width: item.width || 0, height: item.height || 0, aspectRatio: item.aspectRatio || '',
  })
}

async function onAssetFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  // 上传途中用户可能切到别的分类，归属以点上传那一刻为准
  const kind = myAssetKind.value
  myAssetUploading.value = true
  let done = 0
  for (const f of files) {
    try {
      const isVideo = f.type.startsWith('video/')
      const url = isVideo ? await uploadCanvasVideo(f) : await uploadCanvasImage(f)
      const res = await userAssetApi.create({
        kind,
        nodeType: isVideo ? 'VIDEO' : 'IMAGE',
        name: f.name.replace(/\.[^.]+$/, '').slice(0, 300),
        mediaUrl: url,
      })
      if (res.data.result !== 0) throw new Error(res.data.message || t('common.uploadFailed'))
      done += 1
    } catch (err: any) {
      MessagePlugin.error(t('library.myAsset.uploadItemFailed', {
        name: f.name, reason: apiErrorMessage(err, t('common.uploadFailed')),
      }))
    }
  }
  myAssetUploading.value = false
  if (done > 0) {
    MessagePlugin.success(t('library.myAsset.uploaded', { n: done }))
    if (myAssetKind.value === kind) loadMyAssets()
  }
}

function confirmRemoveAsset(item: any) {
  const id = item._id || item.id
  pending.value = {
    title: t('library.myAsset.removeTitle'),
    text: t('library.myAsset.removeConfirm', { name: item.name || t('library.unnamed') }),
    okText: t('common.delete'),
    busyText: t('common.delete'),
    run: async () => {
      try {
        const res = await userAssetApi.remove(id)
        if (res.data.result !== 0) throw new Error(res.data.message || t('library.myAsset.removeFailed'))
        myAssetList.value = myAssetList.value.filter((x) => (x._id || x.id) !== id)
        MessagePlugin.success(t('library.myAsset.removed'))
      } catch (err: any) {
        MessagePlugin.error(apiErrorMessage(err, t('library.myAsset.removeFailed')))
        throw err
      }
    },
  }
}

// ===== 画布模板 =====
const canvasTplList = ref<CanvasTplItem[]>([])
const canvasTplLoading = ref(false)
const canvasTplLoaded = ref(false)

async function loadCanvasTpl() {
  if (canvasTplLoaded.value || canvasTplLoading.value) return
  canvasTplLoading.value = true
  try {
    const res = await canvasTemplateApi.list()
    if (res.data.result === 0 && Array.isArray(res.data.data)) {
      canvasTplList.value = res.data.data
    }
    canvasTplLoaded.value = true
  } catch (e: any) {
    MessagePlugin.error(apiErrorMessage(e, t('library.template.loadFailed')))
  } finally {
    canvasTplLoading.value = false
  }
}

function applyCanvasTpl(tpl: CanvasTplItem) {
  emit('apply-template', tpl)
  close()
}

// ===== 文本模板 =====
// 模板语言默认跟界面语言走，可手动切换
const textTplLang = ref<'zh' | 'en'>(locale.value.startsWith('zh') ? 'zh' : 'en')
const textTplCat = ref('__all__')
const textTplCache: Record<string, TextTplItem[]> = {}
const textTplList = ref<TextTplItem[]>([])
const textTplLoading = ref(false)

async function loadTextTpl(l: 'zh' | 'en') {
  if (textTplCache[l]) { textTplList.value = textTplCache[l]; return }
  textTplLoading.value = true
  try {
    const res = await canvasTextTemplateApi.list(l)
    const data: TextTplItem[] = res.data.result === 0 ? (res.data.data || []) : []
    textTplCache[l] = data
    if (textTplLang.value === l) textTplList.value = data
  } catch {
    if (textTplLang.value === l) textTplList.value = []
  } finally {
    textTplLoading.value = false
  }
}

const textTplCategories = computed(() => {
  const set = new Set<string>()
  for (const it of textTplList.value) if (it.category) set.add(it.category)
  return textTplList.value.length ? ['__all__', ...Array.from(set)] : []
})

const filteredTextTpl = computed(() => {
  const kw = searchText.value.trim().toLowerCase()
  return textTplList.value.filter((it) => {
    if (textTplCat.value !== '__all__' && it.category !== textTplCat.value) return false
    if (kw && !(it.title.toLowerCase().includes(kw) || it.content.toLowerCase().includes(kw))) return false
    return true
  })
})

function switchTextLang(l: 'zh' | 'en') {
  if (textTplLang.value === l) return
  textTplLang.value = l
  textTplCat.value = '__all__'
  loadTextTpl(l)
}

function pickTextTpl(tpl: TextTplItem) {
  emit('add-text', tpl.content)
  close()
}

// ===== 我的分享（分享链接） =====
const mineList = ref<CanvasShareSummary[]>([])
const mineLoading = ref(false)
const copyingId = ref('')

const filteredMine = computed(() => {
  const kw = searchText.value.trim().toLowerCase()
  if (!kw) return mineList.value
  return mineList.value.filter((x) => (x.title || '').toLowerCase().includes(kw))
})

async function loadMine() {
  mineLoading.value = true
  try {
    const res = await canvasShareApi.mine()
    if (res.data.result === 0 && res.data.data) {
      mineList.value = res.data.data.list || []
    }
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('common.loadFailed')))
  } finally {
    mineLoading.value = false
  }
}

type ShareState = 'active' | 'expired' | 'revoked'

function isExpired(item: CanvasShareSummary) {
  if (!item.expiresAt) return false
  const ts = new Date(item.expiresAt).getTime()
  return Number.isFinite(ts) && ts <= Date.now()
}

/** 撤销优先于过期：两者都成立时，用户做过的动作更该被看到 */
function shareState(item: CanvasShareSummary): ShareState {
  if (item.revoked) return 'revoked'
  return isExpired(item) ? 'expired' : 'active'
}

function expiryText(item: CanvasShareSummary) {
  if (!item.expiresAt) return t('library.share.neverExpires')
  const d = new Date(item.expiresAt)
  if (!Number.isFinite(d.getTime())) return t('library.share.neverExpires')
  const date = d.toLocaleDateString(locale.value)
  return isExpired(item) ? t('library.share.expiredOn', { date }) : t('library.share.expiresOn', { date })
}

function sharePath(item: CanvasShareSummary) {
  return `/share/${encodeURIComponent(item.token)}`
}

/** http 自部署时没有 navigator.clipboard（仅安全上下文可用），退回 execCommand */
async function writeClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(ta)
  if (!ok) throw new Error('copy failed')
}

async function copyLink(item: CanvasShareSummary) {
  try {
    await writeClipboard(`${location.origin}${sharePath(item)}`)
    MessagePlugin.success(t('library.share.linkCopied'))
  } catch {
    MessagePlugin.error(t('common.copyFailed'))
  }
}

function openShare(item: CanvasShareSummary) {
  window.open(router.resolve(sharePath(item)).href, '_blank', 'noopener')
}

async function copyToMine(item: CanvasShareSummary) {
  if (copyingId.value) return
  copyingId.value = item.id
  try {
    const res = await canvasShareApi.copy(item.token, t('common.copyName', { name: item.title || t('library.unnamed') }))
    if (res.data.result === 0 && res.data.data?.workflowId) {
      MessagePlugin.success(t('library.share.copiedToMine'))
      close()
      router.push(`/canvas/${res.data.data.workflowId}`)
    } else {
      MessagePlugin.error(res.data.message || t('library.share.copyToMineFailed'))
    }
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('library.share.copyToMineFailed')))
  } finally {
    copyingId.value = ''
  }
}

function confirmRevoke(item: CanvasShareSummary) {
  pending.value = {
    title: t('library.share.revokeTitle'),
    text: t('library.share.revokeConfirm', { title: item.title || t('library.unnamed') }),
    okText: t('library.share.revokeOk'),
    busyText: t('library.share.revoking'),
    run: async () => {
      try {
        const res = await canvasShareApi.remove(item.id)
        if (res.data.result !== 0) throw new Error(res.data.message || t('library.share.revokeFailed'))
        // 留在列表里并标成已撤销，让人看得到这一步确实生效了
        mineList.value = mineList.value.map((x) => (x.id === item.id ? { ...x, revoked: true } : x))
        MessagePlugin.success(t('library.share.revokeDone'))
      } catch (err: any) {
        MessagePlugin.error(apiErrorMessage(err, t('library.share.revokeFailed')))
        throw err
      }
    },
  }
}

// 打开时初始化对应 tab 的数据
watch(() => props.modelValue, (open) => {
  if (!open) { pending.value = null; return }
  activeTab.value = initialTabKey()
  searchText.value = ''
  void loadMaterialCats()
  loadTab(activeTab.value)
}, { immediate: true })
</script>

<style scoped>
.lib-mask { z-index: 9000; }
.lib-dialog { width: min(1200px, 100%); height: min(780px, calc(100vh - 40px)); overflow: hidden; }

.lib-header {
  flex: none; display: flex; align-items: center; gap: 12px;
  padding: 14px 20px; border-bottom: 1px solid var(--line);
}
.lib-tabs { flex: 0 1 auto; min-width: 0; }
.lib-search { flex: 0 1 240px; margin-left: auto; }
.lib-close { margin-left: auto; }
.lib-search + .lib-close { margin-left: 0; }

.lib-body { flex: 1; min-height: 0; padding: 16px 20px 20px; overflow-y: auto; }

/* 二级：分类 + 右侧动作 */
.lib-sub-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.lib-sub-bar.spread { justify-content: space-between; }
.cat-tabs { display: flex; gap: 6px; flex-wrap: wrap; min-width: 0; }
.cat-tab {
  height: 28px; padding: 0 12px; border: 1px solid var(--line); background: var(--well);
  color: var(--text-2); border-radius: 8px; cursor: pointer; font-size: 13px; white-space: nowrap;
  transition: background-color .15s, color .15s, border-color .15s;
}
.cat-tab:hover { color: var(--text); border-color: var(--line-3); }
.cat-tab.active { background: rgba(59, 123, 255, .28); color: var(--text); border-color: var(--line-3); }
.tt-lang { flex: none; }

.lib-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 60px 20px; color: var(--text-3); font-size: 13px; text-align: center; min-height: 280px;
}
.lib-empty svg { width: 40px; height: 40px; color: rgba(124, 160, 255, .4); }
.lib-loading-more { text-align: center; padding: 16px 0 0; color: var(--text-3); font-size: 12px; }

/* 卡片网格 */
.lib-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
.lib-card {
  border-radius: var(--r-md); border: 1px solid var(--line); background: var(--grad-card);
  overflow: hidden; transition: border-color .15s ease;
}
.lib-card:hover { border-color: rgba(63, 216, 255, .55); }
.lib-card.clickable { cursor: pointer; }
.lib-card.inactive .lib-thumb { opacity: .5; }
.lib-thumb {
  position: relative; aspect-ratio: 4 / 3; background: var(--media-bg);
  display: flex; align-items: center; justify-content: center; overflow: hidden;
}
.lib-thumb img, .lib-thumb video { width: 100%; height: 100%; object-fit: cover; display: block; }
.thumb-empty { color: rgba(124, 160, 255, .4); }
.thumb-empty svg { width: 36px; height: 36px; }
/* 压在画面上的件：底是恒暗遮罩，字固定用浅色 */
.play-overlay {
  position: absolute; inset: 0; margin: auto; width: 36px; height: 36px; border-radius: 50%;
  display: grid; place-items: center; pointer-events: none;
  background: rgba(4, 9, 28, .6); border: 1px solid rgba(255, 255, 255, .35); color: var(--on-scrim);
  transition: opacity .15s ease;
}
.play-overlay svg { width: 13px; height: 13px; margin-left: 2px; }
.lib-thumb:hover .play-overlay { opacity: 0; }
.thumb-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  background: rgba(4, 9, 28, .6); opacity: 0; transition: opacity .15s ease;
}
.lib-thumb:hover .thumb-overlay { opacity: 1; }
.btn-del {
  position: absolute; top: 8px; right: 8px; width: 28px; height: 28px; padding: 0;
  display: grid; place-items: center; border: 0; border-radius: 8px;
  background: rgba(4, 9, 28, .7); color: var(--on-scrim); cursor: pointer;
  opacity: 0; transition: opacity .15s ease, color .15s ease;
}
.lib-thumb:hover .btn-del { opacity: 1; }
.btn-del:hover { color: var(--err-soft); }
.status-tag { position: absolute; top: 8px; left: 8px; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); background: rgba(12, 21, 52, .8); }
.status-tag.st-active { color: var(--ok); }
.status-tag.st-expired { color: var(--warn); }
.status-tag.st-revoked { color: var(--text-3); }

.lib-meta { padding: 10px 12px 12px; }
.lib-name { font-size: 14px; font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-sub { margin-top: 2px; display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text-3); }
.sub-main { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub-side { flex: none; }
.share-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.share-actions .lc-btn { flex: 1 1 auto; padding: 0 8px; }

/* 文本模板卡 */
.tt-grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.tt-card {
  position: relative; padding: 12px 14px; cursor: pointer; overflow: hidden;
  min-height: 132px; display: flex; flex-direction: column; transition: border-color .15s;
}
.tt-card:hover { border-color: rgba(63, 216, 255, .55); }
.tt-card:hover .tt-card-hover { opacity: 1; }
.tt-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.tt-card-title { font-size: 14px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.tt-card-cat { flex-shrink: 0; }
.tt-card-content {
  font-size: 12px; line-height: 1.6; color: var(--text-2); overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  white-space: pre-wrap; word-break: break-word;
}
.tt-card-hover {
  position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 12px;
  background: linear-gradient(to top, rgba(12, 21, 52, .96) 30%, rgba(12, 21, 52, 0) 100%);
  opacity: 0; transition: opacity .18s;
}

/* 二次确认 */
.confirm-mask { z-index: 9100; }
.confirm-dialog { width: 420px; }
.confirm-text { margin: 0; font-size: 14px; line-height: 1.7; color: var(--text-2); }

@media (max-width: 600px) {
  .lib-dialog { height: 92vh; height: 92dvh; }
  .lib-header { flex-wrap: wrap; padding: 12px 16px; gap: 10px; }
  .lib-tabs { order: 1; flex: 1 1 0; }
  .lib-close { order: 2; margin-left: 0; }
  .lib-search { order: 3; flex: 1 1 100%; margin-left: 0; }
  .lib-body { padding: 12px 16px 16px; }
  .lib-sub-bar { flex-wrap: wrap; }
  .cat-tabs { flex-wrap: nowrap; overflow-x: auto; flex: 1 1 100%; scrollbar-width: none; }
  .lib-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .tt-grid { grid-template-columns: 1fr; }
  /* 触屏没有悬停：动作直接露出来 */
  .thumb-overlay { opacity: 1; inset: auto 0 0 0; padding: 8px; background: linear-gradient(to top, rgba(4, 9, 28, .8), transparent); }
  .btn-del { opacity: 1; }
}
</style>
