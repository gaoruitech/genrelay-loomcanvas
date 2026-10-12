/**
 * 画布上的悬浮块（生成队列圆钮、工具面板）互相让位用的几何小工具。
 * 坐标都相对编辑区（.ed）的左上角。
 */
export interface Rect { l: number; t: number; r: number; b: number }

export const clampNum = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), v))

/** host 里匹配 selector、且真的显示着的元素，换算成相对 host 的矩形 */
export function rectsIn(host: HTMLElement | null | undefined, selector: string): Rect[] {
  if (!host) return []
  const o = host.getBoundingClientRect()
  const out: Rect[] = []
  host.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none') {
      out.push({ l: r.left - o.left, t: r.top - o.top, r: r.right - o.left, b: r.bottom - o.top })
    }
  })
  return out
}

/** 一块 w×h 的东西放在 (x, y)，四周留 gap，会不会压着哪个障碍 */
export function isFree(x: number, y: number, size: { w: number; h: number }, obstacles: Rect[], gap = 10): boolean {
  return !obstacles.some((r) => r.r > x - gap && r.l < x + size.w + gap && r.b > y - gap && r.t < y + size.h + gap)
}

/**
 * 想把一块 w×h 的东西放在 want：压着别的块时，挪到离得最近的那块空地。
 *
 * 候选位置 = 原位，加上紧贴每个障碍四边的位置（两个方向可以各取各的），取其中不压任何
 * 障碍、且离原位最近的。lockX：横向不许动（圆钮是吸在左右边上的，只上下找）。
 * 一块空地都没有就留在原位 —— 总比跳到莫名其妙的地方强。
 */
export function nearestFree(
  want: { x: number; y: number },
  size: { w: number; h: number },
  range: { minX: number; minY: number; maxX: number; maxY: number },
  obstacles: Rect[],
  opts: { gap?: number; lockX?: boolean } = {},
): { x: number; y: number } {
  const gap = opts.gap ?? 10
  const { w, h } = size
  const x0 = clampNum(want.x, range.minX, range.maxX), y0 = clampNum(want.y, range.minY, range.maxY)
  const free = (x: number, y: number) => isFree(x, y, size, obstacles, gap)
  if (free(x0, y0)) return { x: x0, y: y0 }
  const xs = opts.lockX ? [x0] : [x0, ...obstacles.flatMap((r) => [r.l - w - gap, r.r + gap])].filter((x) => x >= range.minX && x <= range.maxX)
  const ys = [y0, ...obstacles.flatMap((r) => [r.t - h - gap, r.b + gap])].filter((y) => y >= range.minY && y <= range.maxY)
  let best: { x: number; y: number } | null = null
  let bestD = Infinity
  for (const x of xs) {
    for (const y of ys) {
      const d = (x - x0) * (x - x0) + (y - y0) * (y - y0)
      if (d < bestD && free(x, y)) { best = { x, y }; bestD = d }
    }
  }
  return best || { x: x0, y: y0 }
}
