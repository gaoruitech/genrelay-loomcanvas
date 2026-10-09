import { filesApi, unwrap } from './api'
import { registerThumb } from './canvasMedia'
import { t } from '@/locales'

const MAX_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_BYTES = 200 * 1024 * 1024

/** 校验图片文件 —— 不通过则抛错（提示已本地化，可直接 toast） */
export function assertImageFile(file: File): void {
  if (!file.type.startsWith('image/')) throw new Error(t('upload.notImage'))
  if (file.size > MAX_BYTES) throw new Error(t('upload.imageTooLarge', { mb: MAX_BYTES / 1024 / 1024 }))
}

/** 校验视频文件 */
export function assertVideoFile(file: File): void {
  if (!file.type.startsWith('video/')) throw new Error(t('upload.notVideo'))
  if (file.size > MAX_VIDEO_BYTES) throw new Error(t('upload.videoTooLarge', { mb: MAX_VIDEO_BYTES / 1024 / 1024 }))
}

async function uploadFile(file: File | Blob, onProgress?: (pct: number) => void, filename?: string): Promise<string> {
  const data = unwrap(await filesApi.upload(file, onProgress, filename))
  if (!data?.url) throw new Error(t('upload.noUrl'))
  return data.url
}

/**
 * 上传单张图片，返回 URL。节点 data 里只该存 URL，不能存 data: base64 ——
 * 否则会撑爆画布保存的体积上限。
 */
export async function uploadCanvasImage(file: File): Promise<string> {
  assertImageFile(file)
  return uploadFile(file)
}

/** 上传单个视频，返回 URL。onProgress 回报 0-100 的真实上传进度 */
export async function uploadCanvasVideo(file: File, onProgress?: (pct: number) => void): Promise<string> {
  assertVideoFile(file)
  return uploadFile(file, onProgress)
}

/** 把 data: URL 转存成站内文件，返回 URL；本来就不是 data: 的原样返回 */
export async function uploadDataUrl(url: string): Promise<string> {
  if (!url || !url.startsWith('data:')) return url
  const blob = await (await fetch(url)).blob()
  const ext = blob.type.split('/')[1] || 'jpg'
  return uploadFile(blob, undefined, `canvas-${Date.now()}.${ext}`)
}

/**
 * 让后端抓取一个远程地址并转存到站内存储，返回站内 URL。
 * 用于把外链素材内化：外链随时可能失效，也常常不允许跨域读取。
 */
export async function internalizeRemoteUrl(url: string): Promise<string> {
  const data = unwrap(await filesApi.fetch(url))
  if (!data?.url) throw new Error(t('upload.noUrl'))
  registerThumb(data.url, (data as any).thumbnailUrl)
  return data.url
}
