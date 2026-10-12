import { ref, watch, type Ref } from 'vue'
import { resolvedTheme } from '@/composables/useTheme'
import { currentRoot } from '@/embed/runtime'

/** design token 现在的计算值（跟着当前主题）；读不到返回空串 */
export function readToken(token: string): string {
  try {
    return getComputedStyle(currentRoot()).getPropertyValue(token).trim()
  } catch { return '' }
}

/**
 * 把 design token 的计算值读成字符串（包成 ref，主题一换自己重读）。
 *
 * 专给那些「不认 CSS 变量」的地方用。典型是 vue-flow 的 Background / MiniMap：
 * 它把颜色当 SVG presentation attribute 传，而 attribute 不解析 var()，
 * 直接写 var(--flow-dot) 会静默失效 —— 点阵不会报错，就是直接不见了。
 */
export function useTokenColor(token: string): Ref<string> {
  const out = ref('')

  function read() {
    const v = readToken(token)
    // 极早期读不到（样式表还没到）：留着上一次的值，主题变化时再读
    if (v) out.value = v
  }

  read()
  // 主题是先写到 <html> 上、再改这个 ref 的，所以这里读到的已经是新主题的取值
  watch(resolvedTheme, read)

  return out
}
