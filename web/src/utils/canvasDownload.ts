import { MessagePlugin } from 'tdesign-vue-next'
import { workflowApi } from '@/utils/api'
import { t } from '@/locales'

function guessExt(url: string, fallback: string): string {
  // 去掉查询串,再取最后一个扩展名
  const cleaned = url.split('?')[0]
  const m = cleaned.match(/\.([a-zA-Z0-9]{2,5})$/)
  return m ? m[1].toLowerCase() : fallback
}

function isSameOrigin(url: string): boolean {
  try { return new URL(url, window.location.href).origin === window.location.origin } catch { return false }
}

/**
 * 把一个媒体地址读成 blob。
 * 站内文件（/files/... 或同源地址）直接拉；跨域地址多半没开 CORS，交给后端代理转一手。
 *
 * 站内地址也不保证拉得到：文件存在对象存储、且设置成「跳转到公开地址」时，/files/...
 * 会 302 到存储桶的域名，那边没开 CORS 的话 fetch 直接抛错（<img> 能显示，fetch 不行）。
 * 这种情况同样退回后端代理，由服务端从存储里读。
 */
export async function fetchMediaBlob(url: string, filename = 'file'): Promise<Blob> {
  if (isSameOrigin(url)) {
    let resp: Response | null = null
    try { resp = await fetch(url) } catch { /* 被跨域跳转拦下，走后端代理 */ }
    if (resp) {
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return await resp.blob()
    }
  }
  const resp = await workflowApi.download(url, filename)
  return resp.data as Blob
}

function saveBlob(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(blobUrl)
}

/** axios blob 请求出错时 response.data 仍是 blob，得转成文本再取 message */
async function errorMessage(err: any, fallback: string): Promise<string> {
  const data = err?.response?.data
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text())
      return parsed?.message || fallback
    } catch { return fallback }
  }
  return err?.message || fallback
}

// 节点产物下载
export async function downloadCanvasAsset(
  url: string,
  baseName: string,
  kind: 'image' | 'video',
): Promise<void> {
  if (!url) {
    MessagePlugin.warning(t('download.nothing'))
    return
  }
  MessagePlugin.loading(t('download.preparing'), 0)
  try {
    const ext = guessExt(url, kind === 'video' ? 'mp4' : 'png')
    const filename = `${baseName}.${ext}`
    saveBlob(await fetchMediaBlob(url, filename), filename)
    MessagePlugin.closeAll()
    MessagePlugin.success(t('download.done'))
  } catch (err: any) {
    MessagePlugin.closeAll()
    MessagePlugin.error(await errorMessage(err, t('download.failed')))
  }
}

/**
 * 批量打包下载:后端流式打 zip 再吐给浏览器。
 *
 * 只传 urls 做子集筛选,地址本身由后端从画布文档里现取 —— 前端传什么域名都没用。
 * 打包是串行拉流,大批量会等比较久,所以这里的 loading 一直挂到 blob 落地为止,
 * 否则用户会以为卡死连点五次,把后端一起拉爆。
 */
export async function downloadCanvasBatch(
  workflowId: string,
  urls: string[],
  zipBaseName: string,
): Promise<boolean> {
  if (!workflowId) {
    MessagePlugin.warning(t('download.unsaved'))
    return false
  }
  if (!urls.length) {
    MessagePlugin.warning(t('download.selectFirst'))
    return false
  }
  MessagePlugin.loading(t('download.zipping', { n: urls.length }), 0)
  try {
    const resp = await workflowApi.downloadZip(workflowId, urls)
    const safeName = (zipBaseName || t('download.zipName')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)
    saveBlob(resp.data as Blob, `${safeName}.zip`)
    MessagePlugin.closeAll()
    MessagePlugin.success(t('download.zipDone'))
    return true
  } catch (err: any) {
    MessagePlugin.closeAll()
    MessagePlugin.error(await errorMessage(err, t('download.zipFailed')))
    return false
  }
}
