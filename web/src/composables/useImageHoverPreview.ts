import { frameOf } from '@/utils/frame'
import { ref } from 'vue'

// 全局唯一的"悬停大图"状态。每张图片用 imageHoverHandlers() 拿到事件处理器，
// 触发的预览统一渲染在挂在 body 上的 <ImageHoverPreview> 组件里，避免每个节点都做一份。

const visible = ref(false)
const src = ref('')
const x = ref(0)
const y = ref(0)
const w = ref(0)
const h = ref(0)

// 鼠标 ↔ 预览之间的间距，避免鼠标精确点压在大图角上
const OFFSET = 20
// 视口安全边距，防止贴边
const SAFE = 8

/** 正悬停着的那张图：靠它找到所在的根（一页上可能嵌了不止一个） */
let anchor: Element | null = null

function clampSize(natW: number, natH: number) {
  const { w: vw, h: vh } = frameOf(anchor)
  const maxW = vw * 0.9
  const maxH = vh * 0.9
  let ww = natW * 0.8
  let hh = natH * 0.8
  // 保持纵横比，整体缩放进 90vw / 90vh
  if (ww > maxW || hh > maxH) {
    const scale = Math.min(maxW / ww, maxH / hh)
    ww *= scale
    hh *= scale
  }
  return { ww, hh }
}

// 默认放在鼠标右下；任一方向放不下就翻到另一侧；最后再钳到视口内
function place(cx: number, cy: number) {
  // 预览是 fixed 的：鼠标的视口坐标换成「画框」坐标（utils/frame.ts）
  const fr = frameOf(anchor)
  const mx = cx - fr.x
  const my = cy - fr.y
  const vw = fr.w
  const vh = fr.h
  let px = mx + OFFSET
  let py = my + OFFSET
  if (px + w.value > vw - SAFE) px = mx - OFFSET - w.value
  if (py + h.value > vh - SAFE) py = my - OFFSET - h.value
  px = Math.max(SAFE, Math.min(px, vw - w.value - SAFE))
  py = Math.max(SAFE, Math.min(py, vh - h.value - SAFE))
  x.value = px
  y.value = py
}

export function useImageHoverPreviewState() {
  return { visible, src, x, y, w, h }
}

/**
 * 给一个 <img> 元素绑定 hover 大图预览。getUrl 是函数，确保拿到的是最新 URL。
 * 用法：
 *   const hover = imageHoverHandlers(() => props.data.imageUrl || '')
 *   <img @mouseenter="hover.onEnter" @mousemove="hover.onMove" @mouseleave="hover.onLeave" />
 */
export function imageHoverHandlers(getUrl: () => string) {
  function onEnter(e: MouseEvent) {
    const url = getUrl()
    if (!url) return
    anchor = e.target as Element
    const cx = e.clientX
    const cy = e.clientY
    // 读 naturalWidth / naturalHeight 需要等图片加载；浏览器已缓存时几乎瞬时返回
    const probe = new Image()
    probe.onload = () => {
      // 加载期间用户可能已 mouseleave，按 visible 兜底（onLeave 会置 false，但这里
      // 进入时未先置 true，所以同一图首次 hover 的竞态：只看当前 URL 是否仍是触发的 URL）
      if (getUrl() !== url) return
      const { ww, hh } = clampSize(probe.naturalWidth, probe.naturalHeight)
      w.value = ww
      h.value = hh
      src.value = url
      visible.value = true
      place(cx, cy)
    }
    probe.src = url
  }

  function onMove(e: MouseEvent) {
    if (!visible.value) return
    place(e.clientX, e.clientY)
  }

  function onLeave() {
    visible.value = false
  }

  return { onEnter, onMove, onLeave }
}
