import { filesApi, unwrap, apiErrorMessage } from './api'
import { registerThumb } from './canvasMedia'
import { t } from '@/locales'
import { useAppStore } from '@/stores/app'

/**
 * 上传大小只有一个上限，在服务端（MAX_UPLOAD_MB），随启动信息下发。
 * 前端先按它拦一道，省得把注定被拒的大文件传完才报错；老版本后端不下发这个数，
 * 那就不预检，等服务端的 413 自己说。
 */
function assertUploadSize(file: File | Blob): void {
  const mb = Number(useAppStore().bootstrap?.limits?.maxUploadMb)
  if (!(mb > 0)) return
  if (file.size > mb * 1024 * 1024) throw new Error(t('upload.tooLarge', { mb }))
}

/** 校验图片文件 —— 不通过则抛错（提示已本地化，可直接 toast） */
export function assertImageFile(file: File): void {
  if (!file.type.startsWith('image/')) throw new Error(t('upload.notImage'))
  assertUploadSize(file)
}

/** 校验视频文件 */
export function assertVideoFile(file: File): void {
  if (!file.type.startsWith('video/')) throw new Error(t('upload.notVideo'))
  assertUploadSize(file)
}

async function uploadFile(file: File | Blob, onProgress?: (pct: number) => void, filename?: string): Promise<string> {
  assertUploadSize(file)
  let data
  try {
    data = unwrap(await filesApi.upload(file, onProgress, filename))
  } catch (err) {
    // 服务端拒绝时（413 超限、415 类型不对……）把它给用户看的那句话带出来，而不是「Request failed with status code 413」
    throw new Error(apiErrorMessage(err, t('upload.failed')))
  }
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
