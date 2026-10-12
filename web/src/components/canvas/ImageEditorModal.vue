<template>
  <div v-if="open" class="lc-mask lc-sheet ie-mask" @click.self="requestClose">
    <div class="lc-dialog ie-modal">
      <div class="lc-dialog-head">
        <span class="ie-title">{{ t('dialogs.editor.title') }}<span v-if="sizeText" class="ie-size">{{ sizeText }}</span></span>
        <button class="lc-x" :title="t('common.close')" @click="requestClose">×</button>
      </div>

      <div class="ie-main">
        <!-- 左：工具 -->
        <div class="ie-rail">
          <button
            v-for="tl in TOOLS"
            :key="tl.value"
            class="lc-tb ie-tool"
            :class="{ on: tool === tl.value }"
            :title="t(tl.labelKey)"
            :aria-label="t(tl.labelKey)"
            :disabled="loading || !!error"
            @click="tool = tl.value"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" v-html="tl.icon" />
          </button>
        </div>

        <!-- 中：画面 -->
        <div ref="stageRef" class="ie-stage">
          <div v-if="loading" class="ie-state">{{ t('dialogs.editor.loading') }}</div>
          <div v-else-if="error" class="lc-alert ie-state-err">{{ error }}</div>
          <div
            v-else
            ref="frameRef"
            class="ie-frame"
            :style="{ width: frameSize.w + 'px', height: frameSize.h + 'px' }"
          >
            <canvas ref="canvasRef" class="ie-canvas" />
            <img v-if="comparing" :src="$src(url)" class="ie-compare" alt="" />

            <div
              v-if="tool === 'crop' && !comparing"
              class="ie-crop"
              :style="cropStyle"
              @pointerdown="startDrag('move', $event)"
              @pointermove="onDragMove"
              @pointerup="endDrag"
              @pointercancel="endDrag"
            >
              <span class="ie-crop-grid" />
              <span
                v-for="h in handles"
                :key="h"
                class="ie-handle"
                :class="'h-' + h"
                @pointerdown.stop="startDrag(h, $event)"
                @pointermove="onDragMove"
                @pointerup="endDrag"
                @pointercancel="endDrag"
              />
            </div>
          </div>
        </div>

        <!-- 右：参数 -->
        <div class="ie-params">
          <template v-if="tool === 'crop'">
            <div class="ie-field">
              <div class="ie-label">{{ t('dialogs.editor.ratio') }}</div>
              <div class="ie-grid3">
                <button
                  v-for="r in RATIOS"
                  :key="r.key"
                  class="ie-opt"
                  :class="{ on: ratioKey === r.key }"
                  @click="setRatio(r)"
                >{{ r.labelKey ? t(r.labelKey) : r.key }}</button>
              </div>
            </div>
            <div class="ie-field">
              <div class="ie-label">{{ t('dialogs.editor.straighten', { angle: angleText }) }}</div>
              <input
                type="range" class="ie-range" min="-15" max="15" step="1"
                :value="transform.angle" :aria-label="t('dialogs.editor.straightenAria')"
                @change="commitAngle" @input="previewAngle"
              />
            </div>
            <div class="ie-field">
              <div class="ie-label">{{ t('dialogs.editor.outputSize') }}</div>
              <div class="ie-readout">{{ outputSizeText }}</div>
            </div>
            <button class="ie-opt wide" @click="resetCrop">{{ t('dialogs.editor.resetCrop') }}</button>
          </template>

          <template v-else>
            <div class="ie-field">
              <div class="ie-label">{{ t('dialogs.editor.quick') }}</div>
              <div class="ie-grid3">
                <button class="ie-opt" :title="t('dialogs.editor.rotateCcw')" @click="rotateBy(-1)">↺ 90°</button>
                <button class="ie-opt" :title="t('dialogs.editor.rotateCw')" @click="rotateBy(1)">↻ 90°</button>
                <button class="ie-opt" :title="t('dialogs.editor.rotate180')" @click="rotateBy(2)">180°</button>
                <button class="ie-opt" :class="{ on: transform.flipH }" @click="toggleFlip('h')">⇄ {{ t('dialogs.editor.flipH') }}</button>
                <button class="ie-opt" :class="{ on: transform.flipV }" @click="toggleFlip('v')">⇅ {{ t('dialogs.editor.flipV') }}</button>
                <button class="ie-opt" @click="resetTransform">{{ t('common.reset') }}</button>
              </div>
            </div>
            <div class="ie-field">
              <div class="ie-label">{{ t('dialogs.editor.angle', { angle: angleText }) }}</div>
              <input
                type="range" class="ie-range" min="-45" max="45" step="1"
                :value="transform.angle" :aria-label="t('dialogs.editor.angleAria')"
                @change="commitAngle" @input="previewAngle"
              />
            </div>
            <div class="ie-field" :class="{ disabled: transform.angle === 0 }">
              <div class="ie-label">{{ t('dialogs.editor.corners') }}</div>
              <div class="ie-grid2">
                <button class="ie-opt" :class="{ on: transform.autoCrop }" @click="setAutoCrop(true)">{{ t('dialogs.editor.cornersCrop') }}</button>
                <button class="ie-opt" :class="{ on: !transform.autoCrop }" @click="setAutoCrop(false)">{{ t('dialogs.editor.cornersKeep') }}</button>
              </div>
            </div>
          </template>

          <div class="ie-field ie-result">
            <div class="ie-label">{{ t('dialogs.editor.result') }}</div>
            <div class="ie-grid2">
              <button class="ie-opt" :class="{ on: resultMode === 'new' }" @click="resultMode = 'new'">{{ t('dialogs.editor.resultNew') }}</button>
              <button class="ie-opt" :class="{ on: resultMode === 'replace' }" @click="resultMode = 'replace'">{{ t('dialogs.editor.resultReplace') }}</button>
            </div>
            <p class="ie-hint">
              {{ resultMode === 'new' ? t('dialogs.editor.resultNewHint') : t('dialogs.editor.resultReplaceHint') }}
            </p>
          </div>
        </div>
      </div>

      <div class="lc-dialog-foot ie-foot">
        <button class="lc-btn" :disabled="!canUndo" @click="undo">{{ t('dialogs.editor.undo') }}</button>
        <button class="lc-btn" :disabled="!canRedo" @click="redo">{{ t('dialogs.editor.redo') }}</button>
        <button
          class="lc-btn"
          :disabled="loading || !!error"
          @pointerdown="comparing = true"
          @pointerup="comparing = false"
          @pointerleave="comparing = false"
        >{{ t('dialogs.editor.holdToCompare') }}</button>
        <span class="ie-spacer" />
        <span class="ie-cost">{{ t('dialogs.editor.freeHint') }}</span>
        <button class="lc-btn" :disabled="applying" @click="requestClose">{{ t('common.cancel') }}</button>
        <button class="lc-btn primary quiet" :disabled="loading || !!error || applying || !changed" @click="apply">
          {{ applying ? t('dialogs.editor.applying') : t('common.apply') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { MessagePlugin } from '@/utils/feedback'
import { useI18n } from 'vue-i18n'
import { uploadCanvasImage } from '@/utils/canvasUpload'
import {
  loadCanvasImage, renderTransform, renderEdited, transformedSize,
  DEFAULT_TRANSFORM, FULL_CROP, isIdentityTransform, isFullCrop,
  type TransformOps, type CropRect,
} from '@/utils/canvasImageOps'

const props = defineProps<{ open: boolean; url: string }>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'done', payload: { url: string; mode: 'new' | 'replace' }): void
}>()

const { t } = useI18n()

const TOOLS = [
  { value: 'crop' as const, labelKey: 'dialogs.editor.toolCrop', icon: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>' },
  { value: 'rotate' as const, labelKey: 'dialogs.editor.toolRotate', icon: '<path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/>' },
]

/**
 * ratio = 宽/高（像素比）；null = 自由，0 = 跟随原图比例。
 * key 是稳定标识（进撤销历史），有 labelKey 的按语言翻译，其余直接显示 key。
 */
interface RatioOption { key: string; ratio: number | null; labelKey?: string }
const FREE_RATIO = 'free'
const RATIOS: RatioOption[] = [
  { key: FREE_RATIO, ratio: null, labelKey: 'dialogs.editor.ratioFree' },
  { key: 'original', ratio: 0, labelKey: 'dialogs.editor.ratioOriginal' },
  { key: '1:1', ratio: 1 },
  { key: '3:4', ratio: 3 / 4 },
  { key: '4:3', ratio: 4 / 3 },
  { key: '16:9', ratio: 16 / 9 },
  { key: '9:16', ratio: 9 / 16 },
]

const PREVIEW_MAX = 1000
const MIN_CROP = 0.05
/** 与 canvasUpload 的图片上限一致；在这里先拦一道是为了给出「裁小一点」这种对症的提示 */
const MAX_UPLOAD_MB = 20
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

const tool = ref<'crop' | 'rotate'>('crop')
const loading = ref(false)
const error = ref('')
const applying = ref(false)
const comparing = ref(false)
const resultMode = ref<'new' | 'replace'>('new')

const transform = ref<TransformOps>({ ...DEFAULT_TRANSFORM })
const crop = ref<CropRect>({ ...FULL_CROP })
const ratioKey = ref(FREE_RATIO)
const angleText = computed(() => `${transform.value.angle > 0 ? '+' : ''}${transform.value.angle}`)

const frameRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const stageRef = ref<HTMLElement | null>(null)
let sourceImg: HTMLImageElement | null = null

// 画面显示尺寸自己按舞台可用空间算出来，用 px 写死。
// 不用 aspect-ratio + max-width/max-height 那套：frame 要靠 canvas 撑出宽度，
// canvas 的 max-width 又要回头量 frame，互相依赖，结果就是塌成一个小方块。
const frameSize = ref({ w: 0, h: 0 })
let stageRO: ResizeObserver | null = null

function fitFrame() {
  const el = stageRef.value
  if (!el || !previewW.value || !previewH.value) return
  const cs = getComputedStyle(el)
  const availW = el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0')
  const availH = el.clientHeight - parseFloat(cs.paddingTop || '0') - parseFloat(cs.paddingBottom || '0')
  if (availW <= 0 || availH <= 0) return
  // 不放大：预览位图最多 PREVIEW_MAX，拉大只会糊
  const scale = Math.min(availW / previewW.value, availH / previewH.value, 1)
  frameSize.value = {
    w: Math.max(1, Math.floor(previewW.value * scale)),
    h: Math.max(1, Math.floor(previewH.value * scale)),
  }
}

function watchStage() {
  stopWatchStage()
  const el = stageRef.value
  if (!el || typeof ResizeObserver === 'undefined') return
  stageRO = new ResizeObserver(() => fitFrame())
  stageRO.observe(el)
}
function stopWatchStage() {
  stageRO?.disconnect()
  stageRO = null
}
onBeforeUnmount(stopWatchStage)

const previewW = ref(1)
const previewH = ref(1)
/** 变换后的成品像素尺寸（未裁剪），用来算输出尺寸文案 */
const fullW = ref(0)
const fullH = ref(0)

const changed = computed(() => !isIdentityTransform(transform.value) || !isFullCrop(crop.value))
const sizeText = computed(() => (fullW.value ? `${outWidth.value} × ${outHeight.value}` : ''))
const outWidth = computed(() => Math.max(1, Math.round(fullW.value * crop.value.w)))
const outHeight = computed(() => Math.max(1, Math.round(fullH.value * crop.value.h)))
const outputSizeText = computed(() =>
  fullW.value
    ? t('dialogs.editor.outputSizeValue', {
        w: outWidth.value,
        h: outHeight.value,
        sw: sourceImg?.naturalWidth || 0,
        sh: sourceImg?.naturalHeight || 0,
      })
    : '—')

// 锁定比例时只留四个角手柄：边手柄在锁比例下的锚点行为很难猜，不如不给
const handles = computed(() => (aspectK.value ? ['nw', 'ne', 'se', 'sw'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']))

/** 归一化空间里的宽高比系数：w_norm = h_norm * k */
const aspectK = computed<number | null>(() => {
  const r = RATIOS.find((x) => x.key === ratioKey.value)
  if (!r || r.ratio === null) return null
  if (!previewW.value || !previewH.value) return null
  const px = r.ratio === 0 ? previewW.value / previewH.value : r.ratio
  return (px * previewH.value) / previewW.value
})

const cropStyle = computed(() => ({
  left: `${crop.value.x * 100}%`,
  top: `${crop.value.y * 100}%`,
  width: `${crop.value.w * 100}%`,
  height: `${crop.value.h * 100}%`,
}))

/* ============ 撤销 / 重做 ============ */
interface Snap { transform: TransformOps; crop: CropRect; ratioKey: string }
const history = ref<Snap[]>([])
const histIndex = ref(-1)
const canUndo = computed(() => histIndex.value > 0)
const canRedo = computed(() => histIndex.value >= 0 && histIndex.value < history.value.length - 1)

function snap(): Snap {
  return { transform: { ...transform.value }, crop: { ...crop.value }, ratioKey: ratioKey.value }
}
function resetHistory() {
  history.value = [snap()]
  histIndex.value = 0
}
function pushHistory() {
  history.value = history.value.slice(0, histIndex.value + 1)
  history.value.push(snap())
  histIndex.value = history.value.length - 1
}
function restore(s: Snap) {
  transform.value = { ...s.transform }
  crop.value = { ...s.crop }
  ratioKey.value = s.ratioKey
  renderPreview()
}
function undo() {
  if (!canUndo.value) return
  histIndex.value -= 1
  restore(history.value[histIndex.value])
}
function redo() {
  if (!canRedo.value) return
  histIndex.value += 1
  restore(history.value[histIndex.value])
}

/* ============ 加载与预览 ============ */
watch(() => props.open, async (open) => {
  if (!open) return
  tool.value = 'crop'
  transform.value = { ...DEFAULT_TRANSFORM }
  crop.value = { ...FULL_CROP }
  ratioKey.value = FREE_RATIO
  resultMode.value = 'new'
  comparing.value = false
  error.value = ''
  sourceImg = null
  loading.value = true
  try {
    sourceImg = await loadCanvasImage(props.url)
    // 顺序要紧：canvas 在 v-else 分支里，loading 还是 true 时它根本没挂载，
    // canvasRef 是 null，drawImage 就画到了空气里 —— 画面全透明、只剩棋盘格底。
    // 所以先退出 loading，等 DOM 出来再画。
    loading.value = false
    await nextTick()
    watchStage()
    renderPreview()
    resetHistory()
  } catch (err: any) {
    error.value = err?.message || t('dialogs.editor.loadFailed')
  } finally {
    loading.value = false
  }
})

// 关闭时把观察器收掉，免得留着一个指向已卸载节点的 observer
watch(() => props.open, (open) => { if (!open) stopWatchStage() })

/**
 * 预览只渲染到 PREVIEW_MAX，成品在「应用」时按原分辨率重新渲染一次 —— 预览尺寸不影响画质。
 * 成品尺寸走纯计算，不为了显示两个数字再画一张全尺寸图。
 */
function renderPreview() {
  if (!sourceImg) return
  const preview = renderTransform(sourceImg, transform.value, PREVIEW_MAX)
  previewW.value = preview.width
  previewH.value = preview.height

  const s = transformedSize(sourceImg.naturalWidth, sourceImg.naturalHeight, transform.value)
  fullW.value = Math.max(1, Math.round(s.w))
  fullH.value = Math.max(1, Math.round(s.h))

  const target = canvasRef.value
  if (target) {
    target.width = preview.width
    target.height = preview.height
    const ctx = target.getContext('2d')
    if (ctx) ctx.drawImage(preview, 0, 0)
  }
  fitFrame()
}

/* ============ 工具操作 ============ */
function rotateBy(q: number) {
  transform.value = { ...transform.value, quarter: (((transform.value.quarter + q) % 4) + 4) % 4 }
  crop.value = { ...FULL_CROP }   // 转向变了，原来的裁剪框已经没有意义
  renderPreview()
  pushHistory()
}
function toggleFlip(axis: 'h' | 'v') {
  transform.value = axis === 'h'
    ? { ...transform.value, flipH: !transform.value.flipH }
    : { ...transform.value, flipV: !transform.value.flipV }
  crop.value = { ...FULL_CROP }
  renderPreview()
  pushHistory()
}
function setAutoCrop(v: boolean) {
  if (transform.value.autoCrop === v) return
  transform.value = { ...transform.value, autoCrop: v }
  renderPreview()
  pushHistory()
}
function previewAngle(e: Event) {
  // 拖动过程中只重画，不压历史 —— 否则一次拖动会塞进几十条撤销记录
  transform.value = { ...transform.value, angle: Number((e.target as HTMLInputElement).value) }
  renderPreview()
}
function commitAngle() {
  pushHistory()
}
function resetTransform() {
  transform.value = { ...DEFAULT_TRANSFORM }
  crop.value = { ...FULL_CROP }
  renderPreview()
  pushHistory()
}
function resetCrop() {
  crop.value = { ...FULL_CROP }
  ratioKey.value = FREE_RATIO
  pushHistory()
}
function setRatio(r: RatioOption) {
  ratioKey.value = r.key
  if (r.ratio !== null) fitCropToRatio()
  pushHistory()
}
/** 换比例时给一个居中的最大内接框，用户不用自己从头拖 */
function fitCropToRatio() {
  const k = aspectK.value
  if (!k) return
  let w = 1, h = 1 / k
  if (h > 1) { h = 1; w = k }
  crop.value = { x: (1 - w) / 2, y: (1 - h) / 2, w, h }
}

/* ============ 裁剪框拖拽 ============ */
type DragMode = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
let drag: { mode: DragMode; x: number; y: number; start: CropRect } | null = null

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

function startDrag(mode: string, e: PointerEvent) {
  if (comparing.value) return
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  drag = { mode: mode as DragMode, x: e.clientX, y: e.clientY, start: { ...crop.value } }
  e.preventDefault()
}
function onDragMove(e: PointerEvent) {
  if (!drag || !frameRef.value) return
  const r = frameRef.value.getBoundingClientRect()
  if (!r.width || !r.height) return
  crop.value = nextCrop(drag.mode, drag.start, (e.clientX - drag.x) / r.width, (e.clientY - drag.y) / r.height)
}
function endDrag() {
  if (!drag) return
  drag = null
  pushHistory()
}

function nextCrop(mode: DragMode, s: CropRect, dx: number, dy: number): CropRect {
  if (mode === 'move') {
    return {
      x: Math.max(0, Math.min(1 - s.w, s.x + dx)),
      y: Math.max(0, Math.min(1 - s.h, s.y + dy)),
      w: s.w, h: s.h,
    }
  }

  const k = aspectK.value
  if (k) {
    // 锁比例：锚在对角，跟着离锚点最远的那一边走
    const ax = mode.includes('w') ? s.x + s.w : s.x
    const ay = mode.includes('n') ? s.y + s.h : s.y
    const curX = clamp01((mode.includes('w') ? s.x : s.x + s.w) + dx)
    const curY = clamp01((mode.includes('n') ? s.y : s.y + s.h) + dy)
    let w = Math.abs(curX - ax)
    let h = Math.abs(curY - ay)
    if (w / k > h) h = w / k
    else w = h * k
    const maxW = mode.includes('w') ? ax : 1 - ax
    const maxH = mode.includes('n') ? ay : 1 - ay
    const sc = Math.min(1, w > 0 ? maxW / w : 1, h > 0 ? maxH / h : 1)
    w = Math.max(MIN_CROP, w * sc)
    h = Math.max(MIN_CROP, h * sc)
    return {
      x: clamp01(mode.includes('w') ? ax - w : ax),
      y: clamp01(mode.includes('n') ? ay - h : ay),
      w, h,
    }
  }

  let left = s.x, top = s.y, right = s.x + s.w, bottom = s.y + s.h
  if (mode.includes('w')) left = Math.min(right - MIN_CROP, Math.max(0, s.x + dx))
  if (mode.includes('e')) right = Math.max(left + MIN_CROP, Math.min(1, s.x + s.w + dx))
  if (mode.includes('n')) top = Math.min(bottom - MIN_CROP, Math.max(0, s.y + dy))
  if (mode.includes('s')) bottom = Math.max(top + MIN_CROP, Math.min(1, s.y + s.h + dy))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/* ============ 应用 ============ */
async function apply() {
  if (!sourceImg || applying.value) return
  applying.value = true
  try {
    const { blob, ext } = await renderEdited(sourceImg, transform.value, crop.value, props.url)
    if (blob.size > MAX_UPLOAD_BYTES) {
      MessagePlugin.error(t('dialogs.editor.tooLarge', { size: (blob.size / 1024 / 1024).toFixed(1), max: MAX_UPLOAD_MB }))
      return
    }
    const file = new File([blob], `canvas_edit_${Date.now()}.${ext}`, { type: blob.type })
    const url = await uploadCanvasImage(file)
    emit('done', { url, mode: resultMode.value })
  } catch (err: any) {
    MessagePlugin.error(err?.message || t('dialogs.editor.failed'))
  } finally {
    applying.value = false
  }
}

function requestClose() {
  if (applying.value) return
  emit('close')
}
</script>

<style scoped>
.ie-mask { z-index: 3200; }
.ie-modal { width: min(1080px, 100%); height: min(calc(84 * var(--lc-vh)), 780px); overflow: hidden; }
.ie-title { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
.ie-size { font: 400 12px var(--f-mono); color: var(--text-3); white-space: nowrap; }

.ie-main { flex: 1; display: grid; grid-template-columns: 56px 1fr 256px; min-height: 0; }
.ie-rail {
  border-right: 1px solid var(--line);
  padding: 10px 0;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.ie-tool { width: 38px; height: 38px; }
.ie-tool svg { width: 18px; height: 18px; }

/* 舞台：棋盘格底，透明 PNG 才看得出哪儿是透明的 */
.ie-stage {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  padding: 28px; min-width: 0; min-height: 0; overflow: hidden;
  background-color: var(--well-solid);
  background-image:
    linear-gradient(45deg, rgb(var(--c-film) / .07) 25%, transparent 25% 75%, rgb(var(--c-film) / .07) 75%),
    linear-gradient(45deg, rgb(var(--c-film) / .07) 25%, transparent 25% 75%, rgb(var(--c-film) / .07) 75%);
  background-size: 18px 18px;
  background-position: 0 0, 9px 9px;
}
.ie-state { color: var(--text-3); font-size: 13px; }
.ie-state-err { max-width: 420px; }
/* 尺寸由 fitFrame() 写成 px，这里不再参与推导。
   overflow:hidden 是必须的：裁剪框那圈压暗用的是 9999px 的 box-shadow，
   不裁掉会把整个弹窗一起压黑。手柄因此也全部放在框内侧。 */
.ie-frame {
  position: relative;
  touch-action: none;
  overflow: hidden;
  /* 不铺底色：透明 PNG 要能看见舞台那层棋盘格 */
}
.ie-canvas { display: block; width: 100%; height: 100%; }
.ie-compare {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: contain; background: var(--media-bg);
}

.ie-crop {
  position: absolute;
  border: 1px solid var(--cyan);
  /* 框外压暗：一个 box-shadow 顶掉四块遮罩 div */
  box-shadow: 0 0 0 9999px rgb(var(--c-void) / .6);
  cursor: move;
  touch-action: none;
}
/* 三分线压在图片上，固定用半透明浅色 */
.ie-crop-grid {
  position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(to right, transparent 33.2%, var(--on-scrim-grid) 33.2% 33.5%, transparent 33.5% 66.4%, var(--on-scrim-grid) 66.4% 66.7%, transparent 66.7%),
    linear-gradient(to bottom, transparent 33.2%, var(--on-scrim-grid) 33.2% 33.5%, transparent 33.5% 66.4%, var(--on-scrim-grid) 66.4% 66.7%, transparent 66.7%);
}
.ie-handle {
  position: absolute; width: 12px; height: 12px;
  background: var(--cyan); border-radius: 3px;
}
.h-nw { left: 0; top: 0; cursor: nwse-resize; }
.h-ne { right: 0; top: 0; cursor: nesw-resize; }
.h-se { right: 0; bottom: 0; cursor: nwse-resize; }
.h-sw { left: 0; bottom: 0; cursor: nesw-resize; }
.h-n { left: 50%; top: 0; margin-left: -6px; cursor: ns-resize; }
.h-s { left: 50%; bottom: 0; margin-left: -6px; cursor: ns-resize; }
.h-w { top: 50%; left: 0; margin-top: -6px; cursor: ew-resize; }
.h-e { top: 50%; right: 0; margin-top: -6px; cursor: ew-resize; }

.ie-params { border-left: 1px solid var(--line); padding: 16px; overflow-y: auto; }
.ie-field { margin-bottom: 16px; }
.ie-field.disabled { opacity: .45; pointer-events: none; }
.ie-label { font-size: 12px; color: var(--text-2); margin-bottom: 8px; }
.ie-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.ie-grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.ie-opt {
  min-height: 30px; padding: 4px; text-align: center; font: inherit; font-size: 12px; line-height: 1.3;
  border-radius: 8px; border: 1px solid var(--line);
  background: var(--well); color: var(--text-2); cursor: pointer;
  transition: border-color .14s ease, color .14s ease, background .14s ease;
}
.ie-opt:hover { color: var(--text); border-color: var(--line-3); }
.ie-opt.on { border-color: var(--line-3); color: var(--text); background: rgb(var(--c-blue) / .28); }
.ie-opt.wide { width: 100%; }
.ie-range { width: 100%; accent-color: var(--cyan); }
.ie-readout {
  font: 12px var(--f-mono); color: var(--text);
  padding: 7px 10px; border-radius: 8px; background: var(--well); border: 1px solid var(--line);
}
.ie-result { border-top: 1px solid var(--line); padding-top: 16px; margin-bottom: 0; }
.ie-hint { margin: 8px 0 0; font-size: 12px; line-height: 1.6; color: var(--text-3); }

.ie-foot { align-items: center; flex-wrap: wrap; }
.ie-spacer { flex: 1; min-width: 8px; }
.ie-cost { font-size: 12px; color: var(--text-3); }

/* 窄屏：工具横排在上，画面居中，参数在画面下方滚动 */
@media (max-width: 880px) {
  .ie-main { grid-template-columns: 1fr; grid-template-rows: auto minmax(200px, 1fr) minmax(0, 36%); }
  .ie-rail { flex-direction: row; justify-content: center; padding: 8px 12px; border-right: 0; border-bottom: 1px solid var(--line); }
  .ie-stage { padding: 16px; }
  .ie-params { border-left: 0; border-top: 1px solid var(--line); padding: 12px 16px; }
}
@media (max-width: 600px) {
  .ie-modal { height: calc(94 * var(--lc-vh)); height: calc(94 * var(--lc-dvh)); }
  .ie-foot { padding: 10px 16px; gap: 8px; }
  .ie-cost, .ie-spacer { display: none; }
  .ie-foot .lc-btn { flex: 1; padding: 0 8px; font-size: 13px; }
}
</style>
