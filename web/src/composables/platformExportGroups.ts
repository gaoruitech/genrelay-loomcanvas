/**
 * 「多平台导出」两个分组（国内 / 跨境）各存各的结果。
 *
 * 原来换组是直接把结果清空的 —— 理由是「换组等于换一整套尺寸，旧结果作废」。
 * 但用户导完跨境、想点回国内看一眼，跨境那一组就没了，等于白跑一次。
 * 现在切走时把当前这组收进 exportByGroup，切回来再放出来。
 *
 * 节点对外的 imageUrl / imageUrls 始终等于「当前这一组」，所以下游拿到的
 * 永远跟界面上看到的那组是一致的。
 *
 * 抽成纯函数是因为这里全是「哪个字段该覆盖、哪个不该动」的琐碎判断，
 * 上一版就是在这儿丢的数据，值得单独测。
 */

export type ExportGroup = 'domestic' | 'overseas'

export interface ExportItem {
  key: string
  label: string
  url: string
  width: number
  height: number
}

export interface WhiteBgCheck {
  pure: boolean
  score: number
}

/** 一个分组跑出来的全部东西 */
export interface GroupSnapshot {
  items: ExportItem[]
  whiteBgCheck: WhiteBgCheck | null
  urls: string[]
}

export interface ExportNodeData {
  group?: ExportGroup
  status?: string
  errorMsg?: string
  imageUrl?: string
  imageUrls?: string[]
  exportItems?: ExportItem[]
  whiteBgCheck?: WhiteBgCheck | null
  exportByGroup?: Partial<Record<ExportGroup, GroupSnapshot>>
  [k: string]: any
}

export function currentGroup(data: ExportNodeData): ExportGroup {
  return data?.group === 'overseas' ? 'overseas' : 'domestic'
}

/**
 * 把一次成功导出的结果并进 exportByGroup，另一组原样保留。
 * 返回的是新对象，不改传进来的那个。
 */
export function recordGroupResult(
  data: ExportNodeData,
  group: ExportGroup,
  snapshot: GroupSnapshot,
): Partial<Record<ExportGroup, GroupSnapshot>> {
  return { ...(data?.exportByGroup || {}), [group]: snapshot }
}

/**
 * 换组时要写进节点的那一批字段。
 *
 * @returns null 表示点的就是当前这组，什么都不用做（别白写一次 data，
 *          那会让画布变脏、触发一次自动保存）
 */
export function switchGroupPatch(
  data: ExportNodeData,
  next: ExportGroup,
): Record<string, any> | null {
  const cur = currentGroup(data)
  if (next === cur) return null

  const byGroup: Partial<Record<ExportGroup, GroupSnapshot>> = { ...(data?.exportByGroup || {}) }

  // 先把当前这组收起来。没结果就不写，免得存一堆空壳
  const curItems = data?.exportItems || []
  if (curItems.length) {
    byGroup[cur] = {
      items: curItems,
      whiteBgCheck: data?.whiteBgCheck || null,
      urls: data?.imageUrls || [],
    }
  }

  const restored = byGroup[next]
  const urls = restored?.urls || []
  return {
    group: next,
    exportByGroup: byGroup,
    exportItems: restored?.items || [],
    whiteBgCheck: restored?.whiteBgCheck || null,
    imageUrls: urls,
    imageUrl: urls[0] || '',
    // 这组以前跑过就直接回到 done，别让用户看着「没跑过」的空态却有图
    status: restored?.items?.length ? 'done' : 'idle',
    errorMsg: '',
  }
}
