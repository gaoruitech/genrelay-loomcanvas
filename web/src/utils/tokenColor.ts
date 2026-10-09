import { ref, watch, onBeforeUnmount, type Ref } from 'vue'
import { useAppStore } from '@/stores/app'

/**
 * 把 design token 的计算值读成响应式字符串。
 *
 * 专给那些「不认 CSS 变量」的地方用。典型是 vue-flow 的 Background / MiniMap：
 * 它把颜色当 SVG presentation attribute 传，而 attribute 不解析 var()，
 * 直接写 var(--n-5) 会静默失效 —— 点阵不会报错，就是直接不见了。
 *
 * @param token    token 名，如 '--n-5'
 * @param fallback 读不到时的兜底（首屏样式还没算出来、或 token 被删了）
 * @param alpha    传了就把 #rrggbb 转成 rgba()；token 本身是 rgba 时忽略
 */
export function useTokenColor(token: string, fallback: string, alpha?: number): Ref<string> {
  const app = useAppStore()
  const out = ref(fallback)

  function read() {
    let v = ''
    try {
      v = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
    } catch { /* 极早期调用时拿不到，用兜底 */ }
    if (!v) v = fallback
    out.value = alpha == null ? v : withAlpha(v, alpha)
  }

  // 属性写到 <html> 之后浏览器才重算样式，等一帧再读
  const reread = () => requestAnimationFrame(read)
  read()
  const stop = watch(() => app.resolvedTheme, reread)
  onBeforeUnmount(stop)

  return out
}

function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}
