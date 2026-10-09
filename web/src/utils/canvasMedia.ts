import { t } from '@/locales'

/**
 * 原图地址 → 缩略图地址。
 *
 * 节点数据里只存原图 URL；后端在运行结果、素材列表里会另给一个 thumbnailUrl。
 * 拿到时登记在这里，节点内的小图就能用缩略图，避免把几 MB 原图塞进 ≤240px 的框里
 * （N 张原图 = N 次大图解码 + 大量内存/显存，是「图片多了卡顿」的头号原因）。
 * 没登记过的（比如刷新后）退回原图。
 */
const thumbs = new Map<string, string>()

export function registerThumb(url?: string | null, thumbnailUrl?: string | null): void {
  if (url && thumbnailUrl && thumbnailUrl !== url) thumbs.set(url, thumbnailUrl)
}

/**
 * 画布节点内图片显示用的地址：后端给过缩略图就用缩略图，否则用原图。
 * box 是显示框最长边（CSS px），保留在签名里供调用处表意。
 * 点开大图 / 下载仍应使用原始 URL，不要用本函数的结果。
 */
export function canvasImageThumb(url: string | undefined | null, _box?: number): string {
  if (!url) return ''
  return thumbs.get(url) || url
}

/**
 * 视频封面。后端给过封面图就返回它；否则返回空串，调用方回退到 <video> 元素本身。
 */
export function canvasVideoPoster(url: string | undefined | null, _box?: number): string {
  if (!url) return ''
  return thumbs.get(url) || ''
}

/** 批量下载清单里的一项 */
export interface CanvasMediaItem {
  url: string
  kind: 'image' | 'video'
  nodeId: string
  nodeType: string
  /** 节点名，用于清单展示与 zip 内文件名 */
  label: string
  /** 是否来自成品节点，用于「仅成品」筛选 */
  isOutput: boolean
}

const NODE_LABEL_KEY: Record<string, string> = {
  'image': 'nodes.title.image',
  'video': 'nodes.title.video',
  'image-collection': 'nodes.title.imageCollection',
  'image-gen': 'nodes.title.imageGen',
  'image-edit': 'nodes.title.imageEdit',
  'video-gen': 'nodes.title.videoGen',
  'video-edit': 'nodes.title.videoEdit',
  'output': 'nodes.title.output',
}

/** 可下载的地址：完整 http(s) 地址，或站内相对地址（/files/...） */
function isDownloadable(u: any): u is string {
  return typeof u === 'string' && (/^https?:\/\//i.test(u) || u.startsWith('/'))
}

/**
 * 从画布节点里刨出所有可下载的产物。
 *
 * 字段与后端打包接口保持一致（imageUrl / imageUrls / videoUrl / videoUrls），
 * 顺序也一致 —— 前端清单的序号要能对上 zip 里的文件名，改一处必须改两处。
 */
export function collectCanvasMedia(nodes: any[]): CanvasMediaItem[] {
  const out: CanvasMediaItem[] = []
  const seen = new Set<string>()

  for (const n of nodes || []) {
    const d = (n?.data && typeof n.data === 'object') ? n.data : {}
    const key = NODE_LABEL_KEY[n?.type]
    const label = key ? t(key) : t('nodes.title.generic')
    const push = (v: any, kind: 'image' | 'video') => {
      const arr = Array.isArray(v) ? v : (v ? [v] : [])
      for (const u of arr) {
        if (!isDownloadable(u) || seen.has(u)) continue
        seen.add(u)
        out.push({
          url: u,
          kind,
          nodeId: String(n.id),
          nodeType: String(n.type || ''),
          label,
          isOutput: n?.type === 'output',
        })
      }
    }
    push(d.imageUrl, 'image')
    push(d.imageUrls, 'image')
    push(d.videoUrl, 'video')
    push(d.videoUrls, 'video')
  }
  return out
}
