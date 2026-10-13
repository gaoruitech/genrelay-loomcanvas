/**
 * 「这一行放不放得下，放不下就一档一档收紧」里保证停得下来的那一部分（布局 c 节点底下那一行在用，见 GenShellC；
 * web/test/row-fit.test.ts 里有测）。
 *
 * 量一遍 = 从第 0 档起，换一档、等它排好、量一次，放得下就停，最多走到最高档：至多 max + 1 步，只往上走，不回头。
 *
 * 量的时候又有人要求重量（内容变了）：
 *  - 不重入：正在量的这一遍照常走完，不从头再来，也不在这一遍里多走一步；
 *  - 走完之后只补量一遍，而且排到宏任务里（defer）。以前是 `do { … } while (又要量)`，每一步等的是 nextTick ——
 *    整个循环都在微任务里，只要每一遍里都有人再要求一次，主线程就一直让不出来：页面不重画、不响应点击，
 *    从外面看就是卡死。现在两遍之间一定隔着一次事件循环；
 *  - 一遍接一遍地被要求（不该有，但要是量这个动作自己会引出下一次要求，就是这样）时，间隔成倍拉长，封顶一秒：
 *    最坏也只是每秒量一遍，不会把页面拖住。哪一遍量完没人再要求，间隔回到最短。
 */
export interface RowFitHost {
  /** 最高那一档（档位是 0…max） */
  max: number
  /** 换到这一档，并等它排好 */
  apply: (level: number) => Promise<void> | void
  /** 这一档下放得下吗。量不了（元素不在了、宽度是 0）也答放得下：没有东西可收 */
  fits: () => boolean
  /** 过 ms 毫秒之后在宏任务里调 run（setTimeout）；返回值不用 */
  defer: (run: () => void, ms: number) => void
}

/** 补量的间隔：第一次隔一帧左右，之后每次翻倍，最多一秒 */
export const ROW_FIT_DELAYS = { first: 16, max: 1000 } as const
export const rowFitDelay = (chained: number) => Math.min(ROW_FIT_DELAYS.max, ROW_FIT_DELAYS.first * 2 ** Math.max(0, chained))

export function createRowFit(host: RowFitHost) {
  let busy = false
  let again = false
  let waiting = false
  let chained = 0
  let dead = false

  async function pass() {
    for (let level = 0; level <= host.max; level++) {
      await host.apply(level)
      if (dead || host.fits()) return
    }
  }

  /** 要求量一遍。正在量、或者已经排了一遍在等：只记下「还要量」，不另起一遍 */
  async function request(): Promise<void> {
    if (dead) return
    if (busy || waiting) { again = true; return }
    busy = true
    again = false
    try { await pass() } finally { busy = false }
    if (dead) return
    if (!again) { chained = 0; return }
    again = false
    waiting = true
    host.defer(() => { waiting = false; void request() }, rowFitDelay(chained++))
  }

  return {
    request,
    /** 卸载：正在量的那一遍在下一步停下，排着的那一遍不再跑 */
    stop() { dead = true },
    /** 给测试看的：正在量 / 排着一遍在等 */
    get pending() { return busy || waiting },
  }
}
