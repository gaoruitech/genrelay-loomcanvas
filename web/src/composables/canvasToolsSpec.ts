/**
 * 画布工具节点的预设与算式。
 *
 * 全是纯数据/纯函数，四个节点组件共用，也好单独测 —— 节点里那些
 * 「这次会用几张、剩几个空格」的数字算错了，用户是看不出来的，
 * 等他拼完才发现少了两张。
 *
 * 带文案的选项表里 label 都是 getter：语言可以在运行时切换，
 * 所以每次读取时现翻译，表的导出名和形状不变。
 */
import { t } from '@/locales'

export interface GridPreset {
  key: string
  label: string
  cols: number
  rows: number
}

/** 切片预设。名字按用户的说法来（九宫、六宫、四宫），不写 3×3 这种 */
export const SLICE_PRESETS: GridPreset[] = [
  { key: '2x1', get label() { return t('tools.grid.leftRight2') }, cols: 2, rows: 1 },
  { key: '1x2', get label() { return t('tools.grid.topBottom2') }, cols: 1, rows: 2 },
  { key: '3x1', get label() { return t('tools.grid.three') }, cols: 3, rows: 1 },
  { key: '1x3', get label() { return t('tools.grid.threeVertical') }, cols: 1, rows: 3 },
  { key: '2x2', get label() { return t('tools.grid.four') }, cols: 2, rows: 2 },
  { key: '3x2', get label() { return t('tools.grid.six') }, cols: 3, rows: 2 },
  { key: '3x3', get label() { return t('tools.grid.nine') }, cols: 3, rows: 3 },
]

/** 拼图布局。最多 4×4 —— 再多每格就小到看不清了 */
export const COLLAGE_PRESETS: GridPreset[] = [
  { key: '2x1', get label() { return t('tools.grid.leftRight') }, cols: 2, rows: 1 },
  { key: '1x2', get label() { return t('tools.grid.topBottom') }, cols: 1, rows: 2 },
  { key: '3x1', get label() { return t('tools.grid.rowOfThree') }, cols: 3, rows: 1 },
  { key: '2x2', get label() { return t('tools.grid.four') }, cols: 2, rows: 2 },
  { key: '3x2', get label() { return t('tools.grid.six') }, cols: 3, rows: 2 },
  { key: '3x3', get label() { return t('tools.grid.nine') }, cols: 3, rows: 3 },
]

export const RATIO_OPTIONS = [
  { value: '', get label() { return t('tools.ratio.keep') } },
  { value: '1:1', get label() { return t('tools.ratio.square') } },
  { value: '3:4', get label() { return t('tools.ratio.xhs') } },
  { value: '4:3', label: '4:3' },
  { value: '9:16', get label() { return t('tools.ratio.portrait') } },
  { value: '16:9', get label() { return t('tools.ratio.landscape') } },
  { value: '2:3', label: '2:3' },
  { value: '3:2', label: '3:2' },
]

/** 拼图每格的比例：多一个「跟随第一张」 */
export const CELL_RATIO_OPTIONS = [
  { value: '', get label() { return t('tools.ratio.followFirst') } },
  ...RATIO_OPTIONS.slice(1),
]

export const FORMAT_OPTIONS = [
  { value: 'auto', get label() { return t('tools.format.auto') } },
  { value: 'jpg', label: 'JPG' },
  { value: 'png', label: 'PNG' },
  { value: 'webp', label: 'WebP' },
]

/** 水印的九个锚点，按九宫格顺序排，组件里直接 3 列铺开 */
export const WATERMARK_POSITIONS = [
  { value: 'tl', get label() { return t('tools.position.tl') } }, { value: 'tc', get label() { return t('tools.position.tc') } }, { value: 'tr', get label() { return t('tools.position.tr') } },
  { value: 'ml', get label() { return t('tools.position.ml') } }, { value: 'mc', get label() { return t('tools.position.mc') } }, { value: 'mr', get label() { return t('tools.position.mr') } },
  { value: 'bl', get label() { return t('tools.position.bl') } }, { value: 'bc', get label() { return t('tools.position.bc') } }, { value: 'br', get label() { return t('tools.position.br') } },
]

/** '3x2' → { cols: 3, rows: 2 }，认不出返回 null */
export function parseGridKey(key: string): { cols: number; rows: number } | null {
  const m = /^(\d+)x(\d+)$/.exec(String(key || ''))
  if (!m) return null
  const cols = Number(m[1]); const rows = Number(m[2])
  if (!cols || !rows) return null
  return { cols, rows }
}

export const gridKey = (cols: number, rows: number) => `${cols}x${rows}`

/**
 * 拼图会用掉几张、空几格、丢几张。
 * 接了 5 张图配 2×2 的话，是「用 4 张、丢 1 张」—— 这个得在跑之前就告诉用户。
 */
export function collagePlan(imageCount: number, cols: number, rows: number) {
  const cells = Math.max(0, cols) * Math.max(0, rows)
  const n = Math.max(0, imageCount)
  const used = Math.min(n, cells)
  return { cells, used, empty: Math.max(0, cells - used), skipped: Math.max(0, n - cells) }
}

/** 切片会切出几块 */
export const sliceCount = (cols: number, rows: number) =>
  Math.max(0, cols) * Math.max(0, rows)

/** 体积显示：后端回的是字节 */
export function humanSize(bytes: number): string {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1048576).toFixed(1)} MB`
}
