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
    if (!(r.width > 0 && r.height > 0)) return
    // 收起来的（visibility: hidden —— 抽屉开着时的底部工具条、被面板挤得收起的工具面板）不占地方
    const cs = getComputedStyle(el)
    if (cs.display !== 'none' && cs.visibility !== 'hidden') {
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

/** 一块 w×h 的东西放在 (x, y)，和矩形 r 重叠的面积 */
export function overlapArea(x: number, y: number, size: { w: number; h: number }, r: Rect): number {
  return Math.max(0, Math.min(x + size.w, r.r) - Math.max(x, r.l)) * Math.max(0, Math.min(y + size.h, r.b) - Math.max(y, r.t))
}

export type Side = 'below' | 'above' | 'right' | 'left'
export interface NearSpot {
  x: number
  y: number
  side: Side
  /** true = 贴着锚点、不压任何障碍、整个在编辑区里；false = 实在放不下，挑了压得最少的地方 */
  clear: boolean
}

/**
 * 把一块 w×h 的东西贴着 anchor 放（输入条贴着选中的节点、多选工具条贴着选区）。
 *
 * 按 order 一边一边试：在那一边居中对着锚点，压着障碍（工具面板、队列圆钮、小地图、底部工具条……）
 * 就沿着那条边横向 / 纵向滑开，但滑开之后还得和锚点搭着 attach 这么宽 —— 滑到看不出是谁的就不如换一边。
 * soft（画布上别的节点）能不压就不压：先找一个连它们也不压的位置，找不到才允许压（调用方这时把自己画得更实）。
 * 哪一边都放不下（锚点比视野还大、视野太小）时退而求其次：在各边夹回编辑区里的位置附近挑压得最少的，
 * 最先保的是 keep（节点自己的端口，绝不能盖住），其次是障碍，最后才是锚点本身。
 */
export function placeNear(
  anchor: Rect,
  size: { w: number; h: number },
  box: { w: number; h: number },
  obstacles: Rect[],
  opts: {
    order?: Side[]
    /** 上 / 下离锚点多远；sideGap 是左 / 右的（默认同 gap） */
    gap?: number
    sideGap?: number
    edge?: number
    obstacleGap?: number
    /** 绝不能盖住的小块（节点自己的端口和端口旁的名字） */
    keep?: Rect[]
    /** 能不压就不压的（别的节点） */
    soft?: Rect[]
    /** 滑开之后至少还要和锚点搭着这么宽 */
    attach?: number
  } = {},
): NearSpot {
  const order = opts.order || ['below', 'above', 'right', 'left']
  const gap = opts.gap ?? 12, sideGap = opts.sideGap ?? gap, edge = opts.edge ?? 8, og = opts.obstacleGap ?? 8
  const { w, h } = size
  const maxX = Math.max(edge, box.w - w - edge), maxY = Math.max(edge, box.h - h - edge)
  const fitsX = box.w - w - edge >= edge, fitsY = box.h - h - edge >= edge
  const keep = opts.keep || []
  const base = (side: Side) => ({
    x: side === 'right' ? anchor.r + sideGap : side === 'left' ? anchor.l - sideGap - w : (anchor.l + anchor.r) / 2 - w / 2,
    y: side === 'below' ? anchor.b + gap : side === 'above' ? anchor.t - gap - h : (anchor.t + anchor.b) / 2 - h / 2,
  })
  const attached = (lo: number, len: number, a0: number, a1: number) => Math.min(lo + len, a1) - Math.max(lo, a0) >= Math.min(opts.attach ?? 48, len, a1 - a0) - 0.5
  const trySides = (soft: Rect[]): NearSpot | null => {
    const around = [...obstacles, ...soft]
    for (const side of order) {
      const b = base(side)
      if (side === 'below' || side === 'above') {
        if (!fitsX || b.y < edge || b.y > box.h - h - edge) continue
        const x0 = clampNum(b.x, edge, maxX)
        const ok = (x: number) => isFree(x, b.y, size, around, og - 0.5) && isFree(x, b.y, size, keep, 0)
        const x = [x0, ...around.flatMap((r) => [r.l - w - og, r.r + og])]
          .filter((v) => v >= edge && v <= maxX && attached(v, w, anchor.l, anchor.r))
          .sort((p, q) => Math.abs(p - x0) - Math.abs(q - x0))
          .find(ok)
        if (x !== undefined) return { x: Math.round(x), y: Math.round(b.y), side, clear: true }
      } else {
        if (!fitsY || b.x < edge || b.x > box.w - w - edge) continue
        const y0 = clampNum(b.y, edge, maxY)
        const ok = (y: number) => isFree(b.x, y, size, around, og - 0.5) && isFree(b.x, y, size, keep, 0)
        const y = [y0, ...around.flatMap((r) => [r.t - h - og, r.b + og])]
          .filter((v) => v >= edge && v <= maxY && attached(v, h, anchor.t, anchor.b))
          .sort((p, q) => Math.abs(p - y0) - Math.abs(q - y0))
          .find(ok)
        if (y !== undefined) return { x: Math.round(b.x), y: Math.round(y), side, clear: true }
      }
    }
    return null
  }
  const clear = (opts.soft?.length ? trySides(opts.soft) : null) || trySides([])
  if (clear) return clear
  // 退路：每一边夹回编辑区后的位置，外加从那里挪到「不压障碍」「连端口也不压」的最近空地
  const range = { minX: edge, minY: edge, maxX, maxY }
  const area = (p: { x: number; y: number }, list: Rect[]) => list.reduce((s, r) => s + overlapArea(p.x, p.y, size, r), 0)
  let best: NearSpot = { x: edge, y: edge, side: order[0] || 'below', clear: false }
  let bestScore = Infinity
  order.forEach((side, i) => {
    const b = base(side)
    const at = { x: clampNum(b.x, edge, maxX), y: clampNum(b.y, edge, maxY) }
    const spots = [at, nearestFree(at, size, range, obstacles, { gap: og }), nearestFree(at, size, range, [...obstacles, ...keep], { gap: og })]
    for (const p of spots) {
      const score = area(p, keep) * 1e6 + area(p, obstacles) * 1e3 + area(p, [anchor]) + Math.hypot(p.x - at.x, p.y - at.y) + i
      if (score < bestScore) { bestScore = score; best = { x: Math.round(p.x), y: Math.round(p.y), side, clear: false } }
    }
  })
  return best
}

/**
 * 盯着 host 里匹配 selector 的那些悬浮块占的矩形：先量一次，之后每隔 ms 再量，变了才回调。
 * 它们各有各的挪法（圆钮能拖、小地图和工具条跟着窗口变、提示条时有时无），没有一个事件能全盖住，
 * 而量几个矩形很便宜 —— 只在输入条 / 多选工具条开着的时候才盯。返回停止函数。
 */
export function watchRects(host: () => HTMLElement | null | undefined, selector: string, cb: (rects: Rect[]) => void, ms = 300): () => void {
  let last = ''
  const tick = () => {
    const rects = rectsIn(host(), selector).map((r) => ({ l: Math.round(r.l), t: Math.round(r.t), r: Math.round(r.r), b: Math.round(r.b) }))
    const key = JSON.stringify(rects)
    if (key === last) return
    last = key
    cb(rects)
  }
  tick()
  const timer = window.setInterval(tick, ms)
  return () => window.clearInterval(timer)
}

/**
 * 贴底的抽屉（输入条 / 属性面板在窄窗口里的形态）开着时，把一块东西（选中的节点）摆进抽屉上面剩下的那一块 area 里。
 *
 *   · 放得下：挪得最少 —— 已经整个在里面、又不压着别的悬浮块就不动（返回 null）；压着了挪到最近的空地；
 *   · 放不下（手机上节点比剩下的地方还高）：先缩小到刚好放得下（scale < 1，由调用方换算成画布的缩放），再摆 ——
 *     不然只能露出节点的一截，它的端口、结果总有一部分被抽屉盖住；
 *   · 放得下、可是绕不开某个悬浮块（手机上挪到抽屉上面来的生成队列圆钮：节点旁边、上面都不够宽 / 不够高）：
 *     在那个悬浮块的左 / 右 / 上 / 下剩下的几块里挑缩得最少的一块，缩小了放进去 —— 不留在原地压着它；
 *   · 缩到 minScale 还放不下（画布已经缩到头了）：顶 / 左对齐，露出它的头。
 * 返回新的左上角和缩放倍数（相对现在的大小）；什么都不用动返回 null。纯函数，web/test/float-spot.test.ts 里有测。
 */
export function fitInArea(
  rect: Rect,
  area: Rect,
  obstacles: Rect[] = [],
  opts: { gap?: number; minScale?: number } = {},
): { x: number; y: number; scale: number } | null {
  const gap = opts.gap ?? 8
  const minScale = Math.min(1, opts.minScale ?? 0)
  const w0 = rect.r - rect.l, h0 = rect.b - rect.t
  if (!(w0 > 0) || !(h0 > 0) || !(area.r - area.l > 0) || !(area.b - area.t > 0)) return null
  /** 在 ar 这一块里摆：缩到放得下，夹进去，绕开障碍。free = 落点真的不压任何障碍 */
  const tryArea = (ar: Rect) => {
    const aw = ar.r - ar.l, ah = ar.b - ar.t
    const scale = Math.max(minScale, Math.min(1, aw / w0, ah / h0))
    const w = w0 * scale, h = h0 * scale
    const fits = w <= aw + 0.5 && h <= ah + 0.5
    // 缩小是绕着左上角缩的：先看它缩完之后落在哪，再夹进这一块
    const want = { x: fits ? clampNum(rect.l, ar.l, ar.r - w) : ar.l, y: fits ? clampNum(rect.t, ar.t, ar.b - h) : ar.t }
    const spot = fits ? nearestFree(want, { w, h }, { minX: ar.l, minY: ar.t, maxX: ar.r - w, maxY: ar.b - h }, obstacles, { gap }) : want
    return { x: spot.x, y: spot.y, scale, free: fits && isFree(spot.x, spot.y, { w, h }, obstacles, gap - 0.5) }
  }
  let best = tryArea(area)
  if (!best.free && obstacles.length) {
    // 绕不开：障碍的四边把这一块切成几块，各试一次，挑缩得最少的（一样的话挑挪得最少的）
    const far = (c: { x: number; y: number }) => Math.hypot(c.x - rect.l, c.y - rect.t)
    let pick: typeof best | null = null
    for (const o of obstacles) {
      if (!(o.r > area.l && o.l < area.r && o.b > area.t && o.t < area.b)) continue
      const subs: Rect[] = [
        { l: area.l, t: area.t, r: Math.min(area.r, o.l - gap), b: area.b },
        { l: Math.max(area.l, o.r + gap), t: area.t, r: area.r, b: area.b },
        { l: area.l, t: area.t, r: area.r, b: Math.min(area.b, o.t - gap) },
        { l: area.l, t: Math.max(area.t, o.b + gap), r: area.r, b: area.b },
      ]
      for (const sub of subs) {
        if (sub.r - sub.l < 24 || sub.b - sub.t < 24) continue
        const c = tryArea(sub)
        if (!c.free) continue
        if (!pick || c.scale > pick.scale + 0.001 || (Math.abs(c.scale - pick.scale) <= 0.001 && far(c) < far(pick))) pick = c
      }
    }
    if (pick) best = pick
  }
  if (best.scale === 1 && Math.abs(best.x - rect.l) < 1 && Math.abs(best.y - rect.t) < 1) return null
  return { x: best.x, y: best.y, scale: best.scale }
}
