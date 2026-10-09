import { fetchMediaBlob } from '@/utils/canvasDownload'
import { t as tr } from '@/locales'

/**
 * 画布单图工具的像素运算层：裁剪 / 旋转 / 翻转，全在浏览器 canvas 里做，不调模型。
 *
 * 一个必须知道的前提：跨域图片多半没开 CORS。
 * <img src="https://cdn..."> 能显示，但一 drawImage 进 canvas 就把画布"污染"了，
 * 之后 toBlob / getImageData 一律抛 SecurityError。所以原图不能直接 new Image() 拉，
 * 必须先拿到同源 blob 再解码 —— 跟 canvasDownload 用的是同一条通道。
 */

export interface CropRect {
  /** 全部是 0..1 的归一化坐标，相对「变换之后」的画面 */
  x: number
  y: number
  w: number
  h: number
}

export interface TransformOps {
  /** 90° 的整数倍，0..3 */
  quarter: number
  /** 自由角度，度，-45..45 */
  angle: number
  flipH: boolean
  flipV: boolean
  /** 自由角度旋转后是否自动裁掉四周露出的空角 */
  autoCrop: boolean
}

export const DEFAULT_TRANSFORM: TransformOps = {
  quarter: 0, angle: 0, flipH: false, flipV: false, autoCrop: true,
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 }

export function isIdentityTransform(t: TransformOps): boolean {
  return t.quarter === 0 && t.angle === 0 && !t.flipH && !t.flipV
}

export function isFullCrop(c: CropRect): boolean {
  return c.x <= 0.0005 && c.y <= 0.0005 && c.w >= 0.999 && c.h >= 0.999
}

/** 拉原图 → 同源 blob → 解码。这样 canvas 不会被污染 */
export async function loadCanvasImage(url: string): Promise<HTMLImageElement> {
  const blob = await fetchMediaBlob(url, 'source')
  const objectUrl = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(tr('imageOps.decodeFailed')))
      img.src = objectUrl
    })
  } finally {
    // 解码完就可以放掉：img 已经持有了位图
    setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
  }
}

/**
 * 旋转矩形内能放下的最大同向矩形。
 * 自由角度旋转后四周会露出空角，不裁掉就得留白 —— 这是「自动裁掉」那个选项的算法。
 */
function largestInnerRect(w: number, h: number, rad: number): { w: number; h: number } {
  let a = Math.abs(rad) % Math.PI
  if (a > Math.PI / 2) a = Math.PI - a
  const sin = Math.sin(a)
  const cos = Math.cos(a)
  const widthIsLonger = w >= h
  const longSide = widthIsLonger ? w : h
  const shortSide = widthIsLonger ? h : w

  if (shortSide <= 2 * sin * cos * longSide || Math.abs(sin - cos) < 1e-10) {
    // 退化情形：贴着短边取半
    const x = 0.5 * shortSide
    return widthIsLonger ? { w: x / sin, h: x / cos } : { w: x / cos, h: x / sin }
  }
  const cos2a = cos * cos - sin * sin
  return { w: (w * cos - h * sin) / cos2a, h: (h * cos - w * sin) / cos2a }
}

/** 变换后的画面尺寸。纯计算，不碰画布 —— UI 要显示「输出尺寸」时不该为了拿两个数去渲染一张图 */
export function transformedSize(sw: number, sh: number, t: TransformOps): { w: number; h: number; rad: number } {
  const rad = ((t.quarter * 90 + t.angle) * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  let w = sw * cos + sh * sin   // 旋转后的外接矩形
  let h = sw * sin + sh * cos
  // 自由角度 + 自动裁空角：外接矩形换成内接最大矩形
  if (Math.abs(t.angle) > 0.01 && t.autoCrop) {
    const inner = largestInnerRect(sw, sh, rad)
    w = Math.max(1, inner.w)
    h = Math.max(1, inner.h)
  }
  return { w, h, rad }
}

/**
 * 应用旋转 / 翻转，返回一张新画布。
 * maxSize 用来出预览图（限制到屏幕能看清的尺寸即可），出成品时不传。
 */
export function renderTransform(
  img: HTMLImageElement | HTMLCanvasElement,
  t: TransformOps,
  maxSize?: number,
): HTMLCanvasElement {
  const sw = (img as HTMLImageElement).naturalWidth || img.width
  const sh = (img as HTMLImageElement).naturalHeight || img.height
  const { w: outW, h: outH, rad } = transformedSize(sw, sh, t)

  let scale = 1
  if (maxSize && Math.max(outW, outH) > maxSize) scale = maxSize / Math.max(outW, outH)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(outW * scale))
  canvas.height = Math.max(1, Math.round(outH * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(tr('imageOps.noCanvas'))

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(rad)
  ctx.scale((t.flipH ? -1 : 1) * scale, (t.flipV ? -1 : 1) * scale)
  ctx.drawImage(img as CanvasImageSource, -sw / 2, -sh / 2, sw, sh)
  return canvas
}

/** 按归一化矩形裁剪；整图裁剪直接返回原画布 */
export function applyCrop(src: HTMLCanvasElement, crop: CropRect): HTMLCanvasElement {
  if (isFullCrop(crop)) return src
  const sx = Math.round(crop.x * src.width)
  const sy = Math.round(crop.y * src.height)
  const sw = Math.max(1, Math.round(crop.w * src.width))
  const sh = Math.max(1, Math.round(crop.h * src.height))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(tr('imageOps.noCanvas'))
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh)
  return canvas
}

/**
 * 输出格式跟着源图走：PNG 源出 PNG（无损），JPG 源出 JPG。
 * 不统一转 PNG 是因为照片转 PNG 体积会翻好几倍，直接撞上上传体积上限；
 * 也不统一转 JPG —— 那会把带透明通道的图毁掉。
 */
export function outputTypeFor(url: string): { mime: string; ext: string; quality?: number } {
  const clean = String(url).split('?')[0].toLowerCase()
  if (/\.(jpe?g)$/.test(clean)) return { mime: 'image/jpeg', ext: 'jpg', quality: 0.95 }
  if (/\.webp$/.test(clean)) return { mime: 'image/webp', ext: 'webp', quality: 0.95 }
  return { mime: 'image/png', ext: 'png' }
}

export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(tr('imageOps.exportFailed')))),
      mime,
      quality,
    )
  })
}

/** 一步出成品：变换 → 裁剪 → 编码 */
export async function renderEdited(
  img: HTMLImageElement,
  t: TransformOps,
  crop: CropRect,
  sourceUrl: string,
): Promise<{ blob: Blob; ext: string; width: number; height: number }> {
  const transformed = renderTransform(img, t)
  const cropped = applyCrop(transformed, crop)
  const out = outputTypeFor(sourceUrl)
  const blob = await canvasToBlob(cropped, out.mime, out.quality)
  return { blob, ext: out.ext, width: cropped.width, height: cropped.height }
}
