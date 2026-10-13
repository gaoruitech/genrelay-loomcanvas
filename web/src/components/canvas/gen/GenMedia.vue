<template>
  <div
    class="gn-media"
    :class="[`m-${g.media}`, { 'is-empty': isEmpty, 'is-run': g.isRunning }]"
    :style="{ height: height + 'px' }"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
  >
    <!-- 文本类节点：结果就是一段可以手改的文字，作为 text-out 喂给下游 -->
    <template v-if="g.isText">
      <div v-if="layout === 'b' || g.readonly" class="gn-text ro nowheel" :class="{ ph: !g.text }" @wheel.stop>{{ g.text || (g.readonly ? t('nodeui.share.emptyText') : t('gen.empty.text')) }}</div>
      <!-- 这一块是「输出」：不带底色的一块面，左上角一行小字写明它是结果（可以手改），右边是清空 / 字数 / 放大。
           下面带底色的那个框才是输入（提示词）—— 两块长得不一样，一眼分得出哪个是写的、哪个是出的。
           还没有结果时是虚线框，和出图 / 出片节点「结果出现在这里」的占位同一种说法。
           那一行在文字框外面（上方），长文滚动时字不会从它底下透出来 -->
      <div v-else class="gn-tbox" :class="{ busy: g.isRunning, empty: !g.text }" data-testid="gen-result">
        <div class="gn-text-h">
          <span :id="labelId" class="gn-text-l">{{ resultLabel }}</span>
          <span class="gn-text-t">
            <button v-if="g.text && !g.viewOnly" type="button" class="gf-link nodrag" :disabled="g.isRunning" data-testid="gen-text-clear" @click.stop="g.text = ''" @mousedown.stop>{{ t('common.clear') }}</button>
            <span v-if="g.text" class="gf-count">{{ g.text.length }} / {{ PROMPT_MAX }}</span>
            <button type="button" class="gf-ib-plain nodrag" v-tip="t(g.viewOnly ? 'nodeui.ro.expand' : 'nodes.action.expand')" :aria-label="t(g.viewOnly ? 'nodeui.ro.expand' : 'nodes.action.expand')" data-testid="gen-text-expand" @click.stop="emit('expand')" @mousedown.stop><GenIconExpand /></button>
          </span>
        </div>
        <!-- 只读：同一个框，字只能选中、复制、滚动（readonly 而不是 disabled：disabled 的框选不了字、Tab 也停不上去） -->
        <textarea
          v-model="g.text"
          class="gn-text nodrag nowheel"
          :placeholder="g.isRunning ? g.runningPlain : g.viewOnly ? t('nodeui.share.noResult') : g.placeholder"
          :aria-labelledby="labelId"
          :disabled="g.isRunning && !g.viewOnly"
          :readonly="g.viewOnly"
          :maxlength="PROMPT_MAX"
          data-testid="gen-text"
          @mousedown.stop
          @wheel.stop
        />
      </div>
    </template>

    <!-- 出图 / 出片：有结果 -->
    <template v-else-if="g.mediaUrl">
      <img v-if="g.media === 'image'" :src="canvasImageThumb(g.mediaUrl, 560)" class="gn-img" alt="" draggable="false" @load="onImgLoad" />
      <template v-else>
        <video
          ref="videoRef"
          :key="g.mediaUrl"
          :src="$src(g.mediaUrl)"
          :poster="canvasVideoPoster(g.mediaUrl, 480)"
          class="gn-img"
          muted
          playsinline
          preload="metadata"
          @loadedmetadata="onMeta"
        />
        <span v-if="!g.isRunning" class="gn-play"><LcIcon name="play" size="s" /></span>
        <span v-if="durText && !g.isRunning" class="gn-dur">{{ durText }}</span>
      </template>
    </template>

    <!-- 还没有结果：虚线占位，写着这次会用的提示词的头一句（没过校验 / 失败了就写原因） -->
    <div v-else class="gn-ph" :class="{ err: !!phError }" data-testid="gen-empty">
      <LcIcon :name="phError ? 'warn' : g.icon" />
      <span v-tip="{ text: phError, clipped: true }" class="gn-ph-t">{{ phError || (layout === 'c' || g.readonly ? '' : promptLine) || emptyHint }}</span>
      <GenRunButton v-if="layout === 'a' && !g.readonly && !g.isRunning" variant="chip" />
    </div>

    <!-- 运行中：画面压暗 + 扫光 + 进度环（上游报了进度才写数字） -->
    <span v-if="g.isRunning" class="gn-rov">
      <span class="gn-ring" :class="{ indet: !g.progress, s: layout === 'b' }">
        <svg viewBox="0 0 48 48" aria-hidden="true"><circle class="bg" cx="24" cy="24" r="18" /><circle class="fg" cx="24" cy="24" r="18" :style="ringStyle" /></svg>
        <template v-if="g.progress">{{ g.progress }}%</template>
      </span>
    </span>

    <!-- 已经有结果、最近一次又没跑成：原因压在画面底边，不把结果挤走 -->
    <div v-if="g.displayError && !g.isRunning && layout !== 'c' && (g.isText || g.mediaUrl)" v-tip="{ text: g.displayError, clipped: true }" class="gn-err-ov" data-testid="gen-error-line">{{ g.displayError }}</div>

    <template v-if="g.mediaUrl && !g.isText">
      <button v-if="!g.readonly" type="button" class="gn-zoom nodrag" v-tip="t('nodes.action.detail')" :aria-label="t('nodes.action.detail')" data-testid="gen-detail" @click.stop="emit('detail')" @mousedown.stop>
        <GenIconExpand />
      </button>
      <div v-if="!g.readonly && layout !== 'b' && (g.mediaList.length > 1 || g.versions.length > 1)" class="gn-ov-bl">
        <!-- 这一版出了多张：挑当前用哪一张 -->
        <div v-if="g.mediaList.length > 1" class="gn-strip nodrag nowheel" @click.stop @mousedown.stop @wheel.stop>
          <button
            v-for="(url, i) in g.mediaList" :key="url + i" type="button"
            :class="{ on: url === g.mediaUrl }"
            v-tip="t(g.media === 'video' ? 'gen.node.nthVideo' : 'gen.node.nthImage', { n: i + 1 })" :aria-label="t(g.media === 'video' ? 'gen.node.nthVideo' : 'gen.node.nthImage', { n: i + 1 })"
            @click.stop="g.selectMedia(url)"
          ><img v-if="thumbOf(url)" :src="thumbOf(url)" alt="" /><video v-else :src="url" preload="metadata" muted /></button>
        </div>
        <GenVersions v-if="g.versions.length > 1" variant="chips" />
      </div>
      <!-- 没选中也能直接跑：悬停在结果上出一颗「重新运行」 -->
      <GenRunButton v-if="layout === 'a' && !selected && !g.readonly" variant="chip" class="gn-hover-run" />
      <!-- 只读：同一个位置换成「查看大图 / 播放」—— 看的人要的是把结果看清楚（三种布局都有；键盘 Tab 走得到） -->
      <button
        v-if="g.viewOnly && viewer" type="button" class="gf-run chip gn-hover-run gn-view nodrag"
        :class="{ ic: layout === 'b' }"
        v-tip="layout === 'b' ? viewLabel : ''" :aria-label="viewLabel" data-testid="gen-view"
        @click.stop="viewer(g.mediaUrl, g.media === 'video' ? 'video' : 'image')" @mousedown.stop @dblclick.stop
      ><LcIcon :name="g.media === 'video' ? 'play' : 'eye'" size="s" /><span v-if="layout !== 'b'">{{ viewLabel }}</span></button>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * 节点上的结果区：图 / 片 / 文字，以及没有结果、运行中、失败时这一块各自的样子。
 * 三种布局用的是同一个，差别只在高度和压在上面的小件露不露。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useGenNodeState, PROMPT_MAX } from '@/composables/useGenNode'
import { useCanvasViewer, type NodeLayout } from '@/composables/nodeLayout'
import { timecode } from '@/utils/duration'
import { canvasImageThumb, canvasVideoPoster } from '@/utils/canvasMedia'
import LcIcon from '@/components/LcIcon.vue'
import GenIconExpand from './GenIconExpand.vue'
import GenRunButton from './GenRunButton.vue'
import GenVersions from './GenVersions.vue'

const props = defineProps<{ layout: NodeLayout; selected?: boolean }>()
const emit = defineEmits<{ (e: 'detail'): void; (e: 'expand'): void }>()
const { t } = useI18n()
const g = useGenNodeState()
/** 画布根上的大图预览（分享页没有画布上下文：null） */
const viewer = useCanvasViewer()
const viewLabel = computed(() => t(g.media === 'video' ? 'gen.view.video' : 'gen.view.image'))

const isEmpty = computed(() => !g.isText && !g.mediaUrl)
/** 文本类节点结果那一块左上角的小字，也是文字框的无障碍名字 */
const resultLabel = computed(() => t(g.kind === 'video-analysis' ? 'nodeui.analysis.result' : 'nodeui.llm.result'))
const labelId = computed(() => `gn-result-${g.id}`)
const thumbOf = (url: string) => (g.media === 'video' ? canvasVideoPoster(url, 96) : canvasImageThumb(url, 96))

/* ── 高度 ──
   a / c：画面通栏。横向的结果用固定的框（和没有结果时一样高，裁掉一点边）；方图、竖图按真实比例
   往高里长，到上限为止 —— 不然竖图只剩中间一条。b：固定的缩略图高度。 */
const BOX = { a: { w: 272, base: 204, min: 204, max: 340 }, b: { w: 240, base: 120, min: 120, max: 120 }, c: { w: 328, base: 184, min: 184, max: 246 } } as const
const naturalRatio = ref(0)
function onImgLoad(e: Event) {
  const img = e.target as HTMLImageElement
  if (img.naturalWidth && img.naturalHeight) naturalRatio.value = img.naturalWidth / img.naturalHeight
}
const duration = ref(0)
function onMeta(e: Event) {
  const v = e.target as HTMLVideoElement
  if (v.videoWidth && v.videoHeight) naturalRatio.value = v.videoWidth / v.videoHeight
  duration.value = Number.isFinite(v.duration) ? v.duration : 0
}
const height = computed(() => {
  const b = BOX[props.layout]
  if (g.isText || !g.mediaUrl || b.min === b.max) return b.base
  // 已有结果：贴合它的真实比例；还没量到就先按「比例」设置估
  let r = naturalRatio.value
  if (!r) {
    const set = String(g.aspectRatio || '')
    const [w, h] = set.includes(':') ? set.split(':').map(Number) : [0, 0]
    r = w && h ? w / h : 0
  }
  // 横图（宽明显大于高）：就用固定的框，裁掉一点边；方图、竖图才往高里长
  if (!r || r > 1.15) return b.base
  return Math.max(b.min, Math.min(b.max, Math.round(b.w / r)))
})
// 压在画面上的是时间码（0:08），不是「8 秒」那种时长的说法：见 utils/duration.ts
const durText = computed(() => (Math.round(duration.value) > 0 ? timecode(duration.value) : ''))

/* ── 占位里的那句话 ── */
// 布局 c 的报错在节点下半部分的说明里（带重试），占位里不再写一遍
const phError = computed(() => (props.layout === 'c' ? '' : g.displayError))
const promptLine = computed(() => {
  const text = (g.effectivePrompt || '').trim()
  return text.split('\n')[0] || ''
})
// 只读的人运行不了：不写「写好提示词后运行」，只说现在没有结果
const emptyHint = computed(() => (g.viewOnly ? t('nodeui.share.noResult') : t(g.media === 'video' ? 'gen.empty.video' : 'gen.empty.image')))

/* ── 进度环：周长 2πr = 113.1 ── */
const ringStyle = computed(() => (g.progress ? { strokeDashoffset: String(113.1 * (1 - Math.min(100, g.progress) / 100)) } : undefined))

/* ── 视频：悬停静音播放，移开暂停并回到开头 ── */
const videoRef = ref<HTMLVideoElement | null>(null)
function onEnter() {
  const v = videoRef.value
  if (!v) return
  try { v.currentTime = 0 } catch { /* 还没加载到能跳的程度 */ }
  v.play().catch(() => {})
}
function onLeave() {
  const v = videoRef.value
  if (!v) return
  v.pause()
  try { v.currentTime = 0 } catch { /* 同上 */ }
}
</script>
