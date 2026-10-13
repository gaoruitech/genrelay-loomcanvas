/**
 * 文本框里的一段文字（或一个光标位置）在屏幕上占哪儿。
 *
 * 浏览器不告诉你 textarea 里第几个字画在哪，只能照着它的排版另摆一份量：一个和文本框同宽、同字体、同内边距的
 * 看不见的块，里面放同样的字，要量的那一段包在 span 里，量完就拿掉（同步完成，页面上看不到）。
 *
 * 这个块挂在文本框的定位祖先里、摆在文本框的位置上 —— 文本框在被缩放的画布里（布局 c 的节点）时，它跟着一起缩放，
 * 量出来的就是屏幕上真实的位置。
 *
 * 用处：输入法在别处组字、文字实时写进提示词框时，给这一段画下划线，并把输入法的候选窗引到光标旁边
 * （见 views/Canvas.vue 的「候着的框」）。
 */
export interface RangeRect { left: number; top: number; right: number; bottom: number }

/** 决定文字怎么排的那些样式：照抄 */
const COPIED = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'fontStretch', 'fontKerning', 'fontFeatureSettings',
  'lineHeight', 'letterSpacing', 'wordSpacing', 'textTransform', 'textIndent', 'textAlign', 'tabSize', 'direction',
  'wordBreak', 'lineBreak',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
] as const

/**
 * [start, end) 这一段在视口里的矩形，一行一个；start === end 时是光标所在的那一条竖线（宽 0）。
 * 滚出文本框可见范围的行不算。量不了（文本框不在页面上）返回空数组。
 */
export function textareaRangeRects(ta: HTMLTextAreaElement, start: number, end: number): RangeRect[] {
  const host = (ta.offsetParent as HTMLElement | null) || ta.parentElement
  if (!host || !ta.isConnected) return []
  const cs = getComputedStyle(ta)
  const num = (v: string) => parseFloat(v) || 0
  const value = ta.value
  const a = Math.max(0, Math.min(start, value.length)), b = Math.max(a, Math.min(end, value.length))

  const mirror = document.createElement('div')
  const s = mirror.style
  for (const k of COPIED) s[k] = cs[k]
  s.position = 'absolute'
  s.left = `${ta.offsetLeft}px`
  s.top = `${ta.offsetTop}px`
  s.boxSizing = 'content-box'
  // 内容区的宽度：clientWidth 不含竖向滚动条和边框，和文本框里真正排字的宽度一致
  s.width = `${Math.max(0, ta.clientWidth - num(cs.paddingLeft) - num(cs.paddingRight))}px`
  s.borderStyle = 'solid'
  s.borderColor = 'transparent'
  s.margin = '0'
  s.whiteSpace = 'pre-wrap'
  s.overflowWrap = 'break-word'
  s.overflow = 'hidden'
  s.visibility = 'hidden'
  s.pointerEvents = 'none'
  mirror.setAttribute('aria-hidden', 'true')

  const mark = document.createElement('span')
  // 空的一段（只量光标）：放一个零宽字符，才有行盒可量
  mark.textContent = value.slice(a, b) || '​'
  // 后面的字也放上：这一段在哪儿折行取决于它后面跟着什么
  mirror.append(value.slice(0, a), mark, value.slice(b) + '​')
  host.appendChild(mirror)
  let rects: RangeRect[] = []
  try {
    const box = ta.getBoundingClientRect()
    // 文本框在缩放过的画布里时，屏幕上的一个像素不等于它自己的一个像素
    const scale = ta.offsetHeight ? box.height / ta.offsetHeight : 1
    const dy = ta.scrollTop * scale, dx = ta.scrollLeft * scale
    rects = Array.from(mark.getClientRects())
      .map((r) => ({ left: r.left - dx, top: r.top - dy, right: (b > a ? r.right : r.left) - dx, bottom: r.bottom - dy }))
      // 整行都滚出去了的不要（留半行的余地）
      .filter((r) => r.bottom > box.top + 2 && r.top < box.bottom - 2)
  } finally {
    mirror.remove()
  }
  return rects
}

/** 光标（第 at 个字符之前）在视口里的位置：一条竖线；量不到返回 null */
export function textareaCaret(ta: HTMLTextAreaElement, at: number): { x: number; top: number; bottom: number } | null {
  const r = textareaRangeRects(ta, at, at)[0]
  return r ? { x: r.left, top: r.top, bottom: r.bottom } : null
}
