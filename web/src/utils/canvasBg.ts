import { t } from '@/locales'

/**
 * 无限画布的背景设置（底色 / 图案 / 密度）。
 *
 * 存在画布本身（Workflow.settings.bg），不是浏览器本地 —— 通过分享链接打开的画布要带着
 * 作者定的底色走，换设备也要一致。默认值 color:'auto' 就是编辑器的默认底色，
 * 老画布读出来是空对象也会落到这一档。
 *
 * 和主题的关系（两套主题下都不许有「存过的选择变得看不清」的情况）：
 *   - 'auto' 跟着看的人的主题走：深色主题是深蓝底，浅色主题是浅蓝灰底（令牌 --flow-bg / --flow-dot）。
 *   - 自选的颜色原样保留，哪个主题下看都是这个颜色。
 *   - 直接画在底色上的东西（图案、小地图、连线、组的虚线框、框选矩形）按「这个底色是亮还是暗」取色，
 *     不按主题：图案 / 小地图在下面用亮度算，连线那一组靠 groundToneFor() 给画布容器挂 data-ground。
 *   - 节点卡片、浮在画布上的面板自己有底，照常跟主题。
 * 这个文件里剩下的几个裸色值就是这件事：它们是「跟着用户选的颜色算出来的」，不属于任何一套主题。
 */

export type CanvasBgPattern = 'dots' | 'lines' | 'cross' | 'none'

export interface CanvasBgSettings {
  /** 'auto' = 默认底色（令牌 --flow-bg，跟主题）；否则是 #rrggbb */
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

/** 这个底色算亮底还是暗底 */
export function isLightBg(hex: string): boolean {
  return relLuminance(hex) > 0.45
}

/** 自定义底色时的图案色：亮底加黑、暗底加白，跟着底色走而不是跟着主题走 */
export function patternColorFor(hex: string): string {
  return isLightBg(hex) ? 'rgba(0, 0, 0, 0.16)' : 'rgba(255, 255, 255, 0.14)'
}

/** 自定义底色时小地图上的节点块：要压得住遮罩，不能用图案那档极淡的颜色 */
export function miniNodeColorFor(hex: string): string {
  return isLightBg(hex) ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.32)'
}

/** 自定义底色时小地图的视口框 */
export function miniStrokeColorFor(hex: string): string {
  return isLightBg(hex) ? 'rgba(20, 80, 160, .9)' : '#3fd8ff'
}

/**
 * 画布容器的 data-ground：自选底色的明暗和当前主题相反时，返回底色的那一档，
 * 让「画布底」那组令牌（连线、组的虚线框、框选矩形）按底色取值；否则返回 undefined（不挂属性，跟主题）。
 */
export function groundToneFor(bg: CanvasBgSettings, theme: 'dark' | 'light'): 'dark' | 'light' | undefined {
  if (bg.color === 'auto' || !isHexColor(bg.color)) return undefined
  const tone = isLightBg(bg.color) ? 'light' : 'dark'
  return tone === theme ? undefined : tone
}

