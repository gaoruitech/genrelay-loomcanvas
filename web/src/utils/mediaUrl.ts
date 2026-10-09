/**
 * 页面本身走 HTTPS 时，把 http:// 的媒体地址升到 https://，避免 Mixed Content 被浏览器拦掉。
 * 页面是 http（自部署在内网很常见）就原样返回 —— 这时强行升级反而会让文件打不开。
 * 站内相对地址（/files/...）不受影响。
 */
export function ensureHttps(url: string | undefined | null): string {
  if (!url || typeof url !== 'string') return url || ''
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
