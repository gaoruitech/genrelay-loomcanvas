import { t } from '@/locales'

/**
 * 无限画布的背景设置（底色 / 图案 / 密度）。
 *
 * 存在画布本身（Workflow.settings.bg），不是浏览器本地 —— 通过分享链接打开的画布要带着
 * 作者定的底色走，换设备也要一致。默认值 color:'auto' 就是编辑器的默认底色，
 * 等价于改动之前的行为，老画布读出来是空对象也会落到这一档。
 */

export type CanvasBgPattern = 'dots' | 'lines' | 'cross' | 'none'

export interface CanvasBgSettings {
  /** 'auto' = 默认底色（令牌 --flow-bg）；否则是 #rrggbb */
  color: string
  pattern: CanvasBgPattern
  /** 图案间距，px */
  gap: number
}

export interface CanvasSettings {
  bg?: CanvasBgSettings
}

export const DEFAULT_CANVAS_BG: CanvasBgSettings = { color: 'auto', pattern: 'dots', gap: 24 }

export const CANVAS_BG_GAP_MIN = 12
export const CANVAS_BG_GAP_MAX = 56

/**
 * 预设底色。深浅各四档，覆盖大多数需求，剩下的走取色器。
 * label 是 getter：语言可以在运行时切换，文案必须在读取时才翻译。
 */
export const CANVAS_BG_PRESETS: { value: string; label: string }[] = [
  { value: 'auto',    get label() { return t('dialogs.bg.defaultColor') } },
  { value: '#151517', get label() { return t('dialogs.bg.presetGraphite') } },
  { value: '#101a24', get label() { return t('dialogs.bg.presetMidnight') } },
  { value: '#1b1714', get label() { return t('dialogs.bg.presetBrown') } },
  { value: '#141c18', get label() { return t('dialogs.bg.presetForest') } },
  { value: '#eaeceb', get label() { return t('dialogs.bg.presetPaper') } },
  { value: '#dfe4e8', get label() { return t('dialogs.bg.presetCoolGray') } },
  { value: '#f0e7d8', get label() { return t('dialogs.bg.presetCream') } },
]

export const CANVAS_BG_PATTERNS: { value: CanvasBgPattern; label: string }[] = [
  { value: 'dots',  get label() { return t('dialogs.bg.dots') } },
  { value: 'lines', get label() { return t('dialogs.bg.lines') } },
  { value: 'cross', get label() { return t('dialogs.bg.cross') } },
  { value: 'none',  get label() { return t('common.none') } },
]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_RE.test(v)
}

/** 兜底到默认值：老画布没有这个字段，脏数据也不该把画布渲染坏 */
export function normalizeCanvasBg(raw: any): CanvasBgSettings {
  const src = (raw && typeof raw === 'object') ? raw : {}
  const color = (src.color === 'auto' || isHexColor(src.color)) ? src.color : DEFAULT_CANVAS_BG.color
  const pattern: CanvasBgPattern =
    (['dots', 'lines', 'cross', 'none'] as const).includes(src.pattern) ? src.pattern : DEFAULT_CANVAS_BG.pattern
  const gapNum = Number(src.gap)
  const gap = Number.isFinite(gapNum)
    ? Math.min(CANVAS_BG_GAP_MAX, Math.max(CANVAS_BG_GAP_MIN, Math.round(gapNum)))
    : DEFAULT_CANVAS_BG.gap
  return { color, pattern, gap }
}

export function isDefaultCanvasBg(bg: CanvasBgSettings): boolean {
  return bg.color === DEFAULT_CANVAS_BG.color
    && bg.pattern === DEFAULT_CANVAS_BG.pattern
    && bg.gap === DEFAULT_CANVAS_BG.gap
}

export function hexToRgba(hex: string, alpha: number): string {
  if (!isHexColor(hex)) return hex
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** WCAG 相对亮度，用来判断底色是"亮的"还是"暗的" */
export function relLuminance(hex: string): number {
  if (!isHexColor(hex)) return 0.5
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** 自定义底色时的图案色：亮底加黑、暗底加白，跟着底色走而不是跟着主题走 */
export function patternColorFor(hex: string): string {
  return relLuminance(hex) > 0.45 ? 'rgba(0, 0, 0, 0.16)' : 'rgba(255, 255, 255, 0.14)'
}

/**
 * 对比度护栏。
 *
 * 节点卡片本身是透明底（node-shared.css 里 .cv-node background:transparent），
 * 所以真正会出事的不是"卡片和背景撞色"，而是「深色主题下选了浅底」——
 * 节点的文字和边框都是按主题配的浅色，压在浅底上直接消失。
 * 不禁止用户选，但要当场告诉他会发生什么。
 */
export function canvasBgWarning(bg: CanvasBgSettings): string {
  if (bg.color === 'auto' || !isHexColor(bg.color)) return ''
  return relLuminance(bg.color) > 0.45 ? t('dialogs.bg.warnLightOnDark') : ''
}
