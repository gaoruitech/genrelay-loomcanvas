import { runsApi } from '@/utils/api'

/**
 * 几条生成记录的结果打成一个 zip 下载（POST /api/runs/download-zip）。
 * 接口按 blob 收：成了回来的是压缩包；被拒绝时回来的是装在 blob 里的 JSON（{ code, message }）；
 * 打到一半断了（服务端中途放弃、网络断了）浏览器只会报一个没有内容的网络错误。
 */

/** 服务端的上限（docs/api.md「History export」）：先在界面上拦一道，省得白跑一趟 */
export const ZIP_MAX_RECORDS = 100
export const ZIP_MAX_FILES = 100

export interface ZipRefusal { code: string; message: string; status: number }
export type ZipResult =
  | { ok: true; filename: string }
  /** refusal 为空 = 不是服务端拒绝的，是下载中断了 */
  | { ok: false; refusal: ZipRefusal | null }

/** 被拒绝时的那一包 JSON；不是 JSON（真的是压缩包、或者什么都没有）返回 null */
export async function readRefusal(data: unknown, status = 0): Promise<ZipRefusal | null> {
  if (!(data instanceof Blob)) return null
  // 压缩包可能很大，只有说自己是 JSON 的、或者小到不可能是压缩包的才去读
  if (!data.type.includes('json') && data.size > 4096) return null
  try {
    const body = JSON.parse(await data.text())
    if (!body || typeof body !== 'object' || typeof body.message !== 'string') return null
    return { code: String(body.code || ''), message: body.message, status }
  } catch { return null }
}

/** Content-Disposition 里的文件名：优先 filename*=UTF-8''…（中文名在这里），没有再看 filename="…" */
export function filenameFromDisposition(header: unknown): string {
  const h = typeof header === 'string' ? header : ''
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(h)
  if (star) {
    try { return decodeURIComponent(star[1].trim()) } catch { /* 写坏了的编码：看下一种 */ }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(h) || /filename\s*=\s*([^;]+)/i.exec(h)
  return plain ? plain[1].trim() : ''
}

/** 存到本地的文件名里不能有的字符换成下划线 */
export function safeFilename(name: string, fallback: string): string {
  const s = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 120)
  return s || fallback
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

/**
 * 打包并存到本地。name 是想要的压缩包名字（不带 .zip）；onProgress 报已经收到多少字节。
 * 不抛错：结果里说成没成、被拒绝的话为什么。
 */
export async function downloadRecordsZip(
  ids: string[],
  opts: { name?: string; urls?: string[]; onProgress?: (loaded: number) => void } = {},
): Promise<ZipResult> {
  try {
    const res = await runsApi.downloadZip({ ids, ...(opts.urls ? { urls: opts.urls } : {}), ...(opts.name ? { name: opts.name } : {}) }, opts.onProgress)
    const blob = res.data as Blob
    const refusal = await readRefusal(blob, res.status)
    if (refusal) return { ok: false, refusal }
    const filename = safeFilename(filenameFromDisposition(res.headers?.['content-disposition']), `${safeFilename(opts.name || '', 'history')}.zip`)
    saveBlob(blob, filename)
    return { ok: true, filename }
  } catch (err: any) {
    return { ok: false, refusal: await readRefusal(err?.response?.data, Number(err?.response?.status) || 0) }
  }
}
