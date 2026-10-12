import { runtime } from '@/embed/runtime'

/**
 * 文档里存的媒体地址 → 浏览器能加载的地址。
 *
 * 原装后端存的是站内相对地址（/files/<key>）。独立部署时页面和接口同源，原样就能用；
 * 嵌进别人的页面、接口在另一个域名上时要补上那个域名；集成方自己写的适配器可以在
 * resolveFileUrl 里做任何换算（比如把 key 换成带签名的地址）。
 * 凡是把地址交给 <img> / <video> / fetch 的地方都要过一下这里（ensureHttps 已经包含了它）。
 * 发给后端的请求里用的仍是文档里的原地址，不要用这里的结果。
 */
export function mediaSrc(url: string | undefined | null): string {
  if (!url || typeof url !== 'string') return url || ''
  const a = runtime.adapter
  if (a) { try { return a.resolveFileUrl(url) || url } catch { return url } }
  return runtime.fileBase && url.startsWith('/files/') ? runtime.fileBase + url : url
}

/**
 * 页面本身走 HTTPS 时，把 http:// 的媒体地址升到 https://，避免 Mixed Content 被浏览器拦掉。
 * 页面是 http（自部署在内网很常见）就原样返回 —— 这时强行升级反而会让文件打不开。
 * 站内相对地址（/files/...）不受影响。
 */
export function ensureHttps(url: string | undefined | null): string {
  if (!url || typeof url !== 'string') return url || ''
  // 接口在别的域名上时，站内相对地址要先补上那个域名（见 mediaSrc）
  url = mediaSrc(url)
  if (!url.startsWith('http://')) return url
  if (typeof window === 'undefined' || window.location.protocol !== 'https:') return url
  try {
    const { hostname } = new URL(url)
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1'
    const isPrivateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(hostname)
    if (isLocalHost || isPrivateIpv4) return url
  } catch {
    return url
  }
  return url.replace('http://', 'https://')
}

/**
 * 视频元素 @canplay/@loadeddata 事件处理：暂停状态尝试自动播放（静音视频），
 * 在模板中用 @canplay="autoPlayOnReady" 即可。
 */
export function autoPlayOnReady(e: Event): void {
  const v = e.target as HTMLVideoElement | null
  if (v && v.paused) {
    v.play().catch(() => { /* 浏览器策略阻止自动播放，需要用户点击 */ })
  }
}
