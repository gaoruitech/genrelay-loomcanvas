<template>
  <div class="share-view-page">
    <header class="sv-topbar">
      <LcLogo class="sv-brand" :to="appStore.authed ? '/app' : '/'" />
      <span class="sv-sep" />
      <div class="sv-info">
        <h1 class="sv-title">{{ detail?.title || t('views.share.fallbackTitle') }}</h1>
        <span v-if="detail" class="lc-chip sv-ro"><LcIcon name="eye" size="s" />{{ t('views.share.readOnly') }}</span>
      </div>
      <!-- 分享页跟的是看的人自己的主题（这台浏览器上记着的 / 系统的），不是作者的 -->
      <ThemeSwitch v-if="$feat.themeSwitch" />
      <!-- 复制回来的画布要打开来看：这次挂载里没有画布页（集成方没开放）就不出这颗按钮 -->
      <button v-if="detail && pages.has('canvas')" class="lc-btn primary sv-copy" :disabled="copying" @click="handleCopy">
        <LcIcon name="copy" />
        <span>{{ copying ? t('views.share.copying') : t('views.share.copyToMine') }}</span>
      </button>
    </header>

    <p v-if="detail?.description" class="sv-desc">{{ detail.description }}</p>

    <div class="sv-canvas" :style="flowStyle" :data-ground="groundTone">
      <div v-if="loading" class="sv-state">
        <span class="lc-ring sm spin" />
        <div class="sv-state-text">{{ t('common.loading') }}</div>
      </div>
      <!-- 链接不存在 / 已过期 / 已撤销：重试没有意义，只给一条回去的路 -->
      <div v-else-if="state === 'unavailable'" class="sv-state">
        <div class="lc-glass sv-notice">
          <span class="sv-notice-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 17H7A5 5 0 0 1 7 7h2" />
              <path d="M15 7h2a5 5 0 0 1 4 8" />
              <line x1="8" y1="12" x2="12" y2="12" />
              <line x1="3" y1="3" x2="21" y2="21" />
            </svg>
          </span>
          <div class="sv-state-title">{{ t('views.share.unavailableTitle') }}</div>
          <div class="sv-state-text">{{ t('views.share.unavailableHint') }}</div>
          <router-link class="lc-btn" :to="appStore.authed ? '/app' : '/'">{{ t('views.share.openApp', { name: appStore.siteName }) }}</router-link>
        </div>
      </div>
      <div v-else-if="state === 'error'" class="sv-state">
        <div class="lc-glass sv-notice">
          <span class="sv-notice-ic err"><LcIcon name="warn" size="l" /></span>
          <div class="sv-state-title">{{ t('common.loadFailed') }}</div>
          <div class="sv-state-text">{{ t('views.share.loadFailedHint') }}</div>
          <button class="lc-btn" @click="load"><LcIcon name="refresh" />{{ t('common.retry') }}</button>
        </div>
      </div>
      <VueFlow
        v-else
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :default-viewport="viewport"
        :min-zoom="0.2"
        :max-zoom="4"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :elements-selectable="false"
        :nodes-focusable="false"
        :edges-focusable="false"
      >
        <!-- 分享时定的画布外观跟着快照一起走，编辑页和这里是同一套渲染 -->
        <Background
          v-if="bgSettings.pattern !== 'none'"
          :variant="bgVariant"
          :pattern-color="flowPatternColor"
          :gap="bgSettings.gap"
        >
          <template v-if="bgSettings.pattern === 'cross'" #pattern>
            <path :d="crossPath" :stroke="flowPatternColor" stroke-width="1" fill="none" />
          </template>
        </Background>
        <Controls position="bottom-right" :show-interactive="false" />
        <MiniMap position="bottom-left" pannable zoomable :node-color="miniNodeColor" :mask-color="miniMaskColor" />
      </VueFlow>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, markRaw } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'

import ShareNode from '@/components/canvas/ShareNode.vue'
import GenNode from '@/components/canvas/gen/GenNode.vue'
import '@/components/canvas/gen/gen.css'
import { GEN_NODE_KINDS } from '@/composables/nodeLayout'
import GlowEdge from '@/components/canvas/GlowEdge.vue'
import LcLogo from '@/components/LcLogo.vue'
import ThemeSwitch from '@/components/ThemeSwitch.vue'
import { usePageOpen } from '@/embed/links'
import LcIcon from '@/components/LcIcon.vue'
import { canvasShareApi, apiErrorMessage, type CanvasShareDetail } from '@/utils/api'
import { useAppStore } from '@/stores/app'
import { useTokenColor } from '@/utils/tokenColor'
import { resolvedTheme } from '@/composables/useTheme'
import {
  DEFAULT_CANVAS_BG, normalizeCanvasBg, patternColorFor, hexToRgba, miniNodeColorFor, groundToneFor,
  type CanvasBgSettings,
} from '@/utils/canvasBg'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import '@/styles/vue-flow-theme.css'

/**
 * vue-flow 的 Background / MiniMap 把颜色当 SVG attribute 传，attribute 不解析
 * var()，所以这里读 token 的计算值，而不是直接写 var(--flow-dot)。
 */
const vfPattern = useTokenColor('--flow-dot')
const vfMask = useTokenColor('--mini-mask-ro')
const vfMiniNode = useTokenColor('--mini-node-ro')

const route = useRoute()
const router = useRouter()
const pages = usePageOpen()
const appStore = useAppStore()
const { t } = useI18n()

// 素材 / 工具 / 成品 / 组用只读的 ShareNode；六种生成节点和编辑页是同一个组件（GenNode）。
// 这里不 provide 画布上下文，GenNode 据此走只读：不看谁的偏好，一律是布局 a，不写数据、不发请求。
const nodeTypes = {
  ...Object.fromEntries([
    'text', 'image', 'video', 'image-collection', 'output', 'platform-export', 'slice', 'collage', 'watermark', 'fit-size', 'frame',
  ].map(k => [k, markRaw(ShareNode)])),
  ...Object.fromEntries(GEN_NODE_KINDS.map(k => [k, markRaw(GenNode)])),
} as any
const edgeTypes = { 'glow': GlowEdge } as any

const loading = ref(true)
/** unavailable = 链接不存在 / 已过期 / 已撤销；error = 网络之类的临时故障，可以重试 */
const state = ref<'ok' | 'unavailable' | 'error'>('ok')
const copying = ref(false)
const detail = ref<CanvasShareDetail | null>(null)
const nodes = ref<any[]>([])
const edges = ref<any[]>([])
const viewport = ref({ x: 0, y: 0, zoom: 1 })

/* ===== 画布外观（跟着分享快照走；老分享没有这个字段就落到默认底色） ===== */
// 十字图案的瓦片尺寸要按实时缩放算，所以这里取的是 vue-flow 的实时视口，
// 不是上面那个只用于 default-viewport 的初始值
const { viewport: liveViewport, fitView, onNodesInitialized, onMoveStart } = useVueFlow()

/**
 * 打开时把整张画布框进视野，最多放到 100% —— 自带的 fit-view-on-init 没有上限，
 * 两三个节点的画布会被放大到 4 倍，一屏只剩半个节点。
 * 图片加载完节点会变高，所以稍后再框一次；这期间看的人已经自己拖动过就不再动它。
 */
let userMoved = false
const fitAll = () => fitView({ padding: 0.15, maxZoom: 1 })
onMoveStart(({ event }) => { if (event?.sourceEvent) userMoved = true })
onNodesInitialized(() => {
  fitAll()
  window.setTimeout(() => { if (!userMoved) fitAll() }, 900)
})
const bgSettings = ref<CanvasBgSettings>({ ...DEFAULT_CANVAS_BG })
const bgIsAuto = computed(() => bgSettings.value.color === 'auto')
const flowStyle = computed(() => (bgIsAuto.value ? {} : { background: bgSettings.value.color }))
const bgVariant = computed(() => (bgSettings.value.pattern === 'dots' ? 'dots' : 'lines'))
const flowPatternColor = computed(() => (bgIsAuto.value ? vfPattern.value : patternColorFor(bgSettings.value.color)))
const miniMaskColor = computed(() => (bgIsAuto.value ? vfMask.value : hexToRgba(bgSettings.value.color, 0.7)))
const miniNodeColor = computed(() => (bgIsAuto.value ? vfMiniNode.value : miniNodeColorFor(bgSettings.value.color)))
// 自选底色的明暗和看的人的主题相反时：连线 / 组框按底色取值
const groundTone = computed(() => groundToneFor(bgSettings.value, resolvedTheme.value))
const crossPath = computed(() => {
  const g = Math.max(1, bgSettings.value.gap * (liveViewport.value?.zoom || 1))
  const arm = Math.max(2, Math.min(6, g * 0.18))
  const c = g / 2
  return `M${c - arm} ${c} h${arm * 2} M${c} ${c - arm} v${arm * 2}`
})

const shareToken = () => String(route.params.token || '')

async function load() {
  const token = shareToken()
  if (!token) { state.value = 'unavailable'; loading.value = false; return }
  loading.value = true
  state.value = 'ok'
  try {
    const res = await canvasShareApi.detail(token)
    if (res.data.result === 0 && res.data.data) {
      const d = res.data.data
      detail.value = d
      // 只读渲染：节点不可拖拽，边统一 glow 样式
      nodes.value = (d.nodes || []).map((n: any) => ({ ...n, draggable: false, selectable: false }))
      edges.value = (d.edges || []).map((e: any) => ({ ...e, type: 'glow', selectable: false }))
      viewport.value = d.viewport || { x: 0, y: 0, zoom: 1 }
      bgSettings.value = normalizeCanvasBg(d.settings?.bg)
    } else {
      detail.value = null
      state.value = 'unavailable'
    }
  } catch (err: any) {
    detail.value = null
    const status = err?.response?.status
    // 有业务返回包（result 非 0）也算「链接本身不行了」，只有连不上 / 服务端炸了才给重试
    const rejected = status === 404 || status === 410 || (status < 500 && !!err?.response?.data?.result)
    state.value = rejected ? 'unavailable' : 'error'
  } finally {
    loading.value = false
  }
}

async function handleCopy() {
  if (!detail.value || copying.value) return
  // 复制是往自己的账号里写东西：没登录就先去登录，登录完回到这个分享页再点一次
  if (!appStore.authed) {
    router.push({ path: '/login', query: { redirect: route.fullPath } })
    return
  }
  copying.value = true
  try {
    const res = await canvasShareApi.copy(shareToken(), t('common.copyName', { name: detail.value.title || t('views.share.fallbackTitle') }))
    if (res.data.result === 0 && res.data.data?.workflowId) {
      MessagePlugin.success(t('views.share.copied'))
      router.push(`/canvas/${res.data.data.workflowId}`)
    } else {
      MessagePlugin.error(res.data.message || t('views.share.copyFailed'))
    }
  } catch (err: any) {
    // 看分享不用登录，但复制是往自己的账号里写东西：登录失效时后端回 401
    if (err?.response?.status === 401) MessagePlugin.warning(t('views.share.needAccess'))
    else MessagePlugin.error(apiErrorMessage(err, t('views.share.copyFailed')))
  } finally {
    copying.value = false
  }
}

onMounted(load)
</script>

<style scoped>
/* 这一页不登录也能看，不套应用外壳：自己撑满视口 */
.share-view-page { display: flex; flex-direction: column; height: 100%; min-height: 420px; color: var(--text); }
.sv-topbar {
  flex: none; display: flex; align-items: center; gap: 16px; min-height: 56px;
  padding: 8px 20px; border-bottom: 1px solid var(--line);
  background: rgb(var(--c-chrome-2) / .72); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px);
}
.sv-brand { flex: none; }
.sv-sep { flex: none; width: 1px; height: 20px; background: var(--line-2); }
.sv-info { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
.sv-title {
  margin: 0; min-width: 0; font: 600 15px/1.4 var(--f-body); color: var(--text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.sv-ro { flex: none; }
.sv-copy { flex: none; }
.sv-desc {
  flex: none; margin: 0; padding: 10px 20px; font-size: 13px; color: var(--text-2);
  border-bottom: 1px solid var(--line); line-height: 1.6; background: rgb(var(--c-chrome-2) / .5);
  max-height: 96px; overflow-y: auto; white-space: pre-wrap; word-break: break-word;
}
/* 跟编辑页的工作台同一个底色，否则同一张画布分享出去换了个颜色。
   自定义底色走内联 style；没设置时这里的 --flow-bg 继续生效 */
.sv-canvas { flex: 1; position: relative; min-height: 0; background: var(--flow-bg); }
.sv-state {
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; padding: 20px; text-align: center;
}
.sv-notice {
  width: 420px; max-width: 100%; padding: 32px 28px; display: flex; flex-direction: column; align-items: center; gap: 8px;
  box-shadow: var(--sh-1);
}
.sv-notice-ic {
  width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center; margin-bottom: 8px;
  color: var(--cyan-soft); background: rgb(var(--c-cyan) / .1); box-shadow: 0 0 0 1px var(--line-2) inset;
}
.sv-notice-ic.err { color: var(--err-soft); background: rgb(var(--c-err) / .1); }
.sv-notice-ic svg { width: 24px; height: 24px; }
.sv-state-title { font: 600 18px/1.4 var(--f-disp); color: var(--text); }
.sv-state-text { font-size: 14px; line-height: 1.7; color: var(--text-2); }
.sv-notice .lc-btn { margin-top: 16px; }
@media (max-width: 600px) {
  .sv-topbar { padding: 8px 12px; gap: 10px; }
  .sv-brand :deep(.lc-logo-name), .sv-sep, .sv-ro { display: none; }
  .sv-copy { padding: 0 12px; font-size: 13px; }
  .sv-desc { padding: 8px 12px; }
  .sv-notice { padding: 28px 20px; }
}
</style>
