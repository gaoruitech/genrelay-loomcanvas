/** 视频元信息读取 */

/** URL → 时长缓存。同一个地址在「连线提示」和「运行兜底」两处都会被查，不必拉两次 metadata */
const durationCache = new Map<string, number>()

/**
 * 读取视频时长（秒）。读不到一律返回 0（调用方据此放行）。
 *
 * 传 File 走 objectURL；传 URL 直接让 <video> 拉 metadata —— 跨域地址也能读到
 * duration，metadata 不受 CORS 限制（只有把帧画进 canvas 再回读才需要 CORS 头）。
 */
export function readVideoDuration(src: File | string, timeoutMs = 8000): Promise<number> {
  if (typeof src === 'string') {
    const hit = durationCache.get(src)
    if (hit !== undefined) return Promise.resolve(hit)
  }
  return new Promise(resolve => {
    const objectUrl = typeof src === 'string' ? '' : URL.createObjectURL(src)
    const v = document.createElement('video')
    let done = false

    const finish = (sec: number) => {
      if (done) return
      done = true
      clearTimeout(timer)
      v.onloadedmetadata = null
      v.onerror = null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      const val = Number.isFinite(sec) && sec > 0 ? sec : 0
      // 只缓存读到的真实时长；读失败(0)不缓存，下次还有机会重试
      if (typeof src === 'string' && val > 0) durationCache.set(src, val)
      resolve(val)
    }

    // 远端地址可能很慢甚至拉不动，不能让用户卡在这儿等
    const timer = setTimeout(() => finish(0), timeoutMs)

    v.preload = 'metadata'
    v.muted = true
    v.onloadedmetadata = () => finish(v.duration)
    v.onerror = () => finish(0)
    v.src = objectUrl || (src as string)
  })
}
