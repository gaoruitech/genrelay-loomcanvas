/**
 * 画布多图输入的编号、别名与 @ 指代。
 *
 * 起因：多图参考时用户在提示词里没法说清「哪张图」。而更靠底下的问题是——
 * 图的顺序原本就是连线的创建顺序（collectInputs 里 edges 数组的顺序），
 * 界面上完全不显示，删一条线重连还会静默变。所以先得让顺序看得见、能调，
 * 「@图2」才有意义。
 *
 * 这里只放纯函数：执行器和节点卡片共用同一份推导，各算各的迟早会漂——
 * 界面显示图 2、实际送出去的是另一张，这种 bug 最难查。
 */
import { SUPPORTED_LOCALES, t } from '@/locales'
import type { LocaleCode } from '@/types'

/** 遍历上游拿到的原始图片：谁产出的、在它的产物里排第几 */
export interface RawImageRef {
  sourceId: string
  /** 在该源节点自身产物数组里的下标 */
  slot: number
  url: string
}

export interface ImageRef {
  /**
   * 稳定标识。不能用 URL —— 源节点重跑一次 URL 就变了，顺序和别名会全丢。
   * 用「源节点 + 它内部的第几张」，重跑、换图都稳，只有删节点才失效。
   */
  key: string
  url: string
  sourceId: string
  /** 最终序号，1 起。界面角标和 @图N 用的就是它 */
  index: number
  /** 用户起的别名，没起就是空 */
  name: string
  /** 界面与 @ 里显示的名字：别名优先，否则「图N」（跟界面语言走） */
  label: string
  /**
   * 语义位（首帧/尾帧）的显示名，跟界面语言走。有值时 @ 直接用它指代，不再说
   * 「第 N 张参考图」—— 首尾帧那条路送出去的必须正好两张，说位置比说编号准。
   */
  semantic?: string
  /** 语义位本身，与语言无关 */
  slot?: FrameSlot
  /** 超出该模型参考图上限，不会真的送给模型 */
  overCap: boolean
}

export const refKey = (sourceId: string, slot: number) => `${sourceId}#${slot}`

/** 没起别名时的默认名字（「图N」），跟着界面语言走 */
const defaultRefName = (index: number, locale?: LocaleCode) =>
  locale ? t('gen.refs.defaultName', { n: index }, { locale }) : t('gen.refs.defaultName', { n: index })

/**
 * 语义位名字要能当 @token 用。token 里不允许空白（见 MENTION_BODY），
 * 而英文的「First frame」带空格，这里换成下划线。
 */
const mentionSafe = (s: string) => s.trim().replace(/\s+/g, '_')

/** 首尾帧模式下的两个语义位 */
export type FrameSlot = 'first' | 'last'

/**
 * 语义位在节点数据里存的写法，与界面语言无关。
 *
 * 提示词是存在画布里的：存「@首帧」的话，换成英文界面它就成了认不出来的悬空指代。
 * 所以落库的是这两个固定 token，文本框里显示的才是当前语言的名字
 * （见 mentionsToDisplay / mentionsToStored）。
 */
const FRAME_TOKEN: Record<FrameSlot, string> = { first: 'first_frame', last: 'last_frame' }
const FRAME_LABEL_KEY: Record<FrameSlot, string> = { first: 'executor.firstFrame', last: 'executor.lastFrame' }
const FRAME_SLOTS = Object.keys(FRAME_TOKEN) as FrameSlot[]

const frameText = (slot: FrameSlot, locale?: LocaleCode) =>
  locale ? t(FRAME_LABEL_KEY[slot], {}, { locale }) : t(FRAME_LABEL_KEY[slot])
/** 语义位在文本框里显示的 @ 名字（当前界面语言） */
const frameLabel = (slot: FrameSlot, locale?: LocaleCode) => mentionSafe(frameText(slot, locale))

/** 一个 @ 名字是不是在指某个语义位：固定 token，或任一语言下的显示名（老画布里存的是后者） */
function frameSlotOf(name: string): FrameSlot | null {
  for (const slot of FRAME_SLOTS) {
    if (name === FRAME_TOKEN[slot]) return slot
    if (SUPPORTED_LOCALES.some(l => frameLabel(slot, l.code) === name)) return slot
  }
  return null
}

/**
 * 一张图在提示词里可以被怎么称呼。
 *
 * 用默认名字的图，各语言的默认名都认 —— 提示词是存在画布里的，中文界面下写的
 * 「@图1」切到英文界面后不该变成认不出来的悬空指代。起了别名的只认别名。
 */
function refAliases(ref: ImageRef): string[] {
  if (ref.name) return [ref.label]
  if (ref.slot) return [FRAME_TOKEN[ref.slot], ...SUPPORTED_LOCALES.map(l => frameLabel(ref.slot!, l.code))]
  return [...SUPPORTED_LOCALES.map(l => defaultRefName(ref.index, l.code)), ref.label]
}

/**
 * 按节点里存的顺序重排。
 *
 * 存的是 key 数组。没在记录里的（新连进来的图）排在后面并保持原有相对顺序——
 * 新加一张不该把已经排好的打乱，那会让提示词里的 @图N 集体错位。
 */
export function applyImageOrder(raw: RawImageRef[], order?: string[] | null): RawImageRef[] {
  if (!order || !order.length) return raw
  const pos = new Map(order.map((k, i) => [k, i]))
  const known: RawImageRef[] = []
  const fresh: RawImageRef[] = []
  for (const r of raw) {
    if (pos.has(refKey(r.sourceId, r.slot))) known.push(r)
    else fresh.push(r)
  }
  known.sort((a, b) => pos.get(refKey(a.sourceId, a.slot))! - pos.get(refKey(b.sourceId, b.slot))!)
  return [...known, ...fresh]
}

/**
 * 加工成界面和 @ 直接可用的形态。
 *
 * @param cap 该模型的参考图上限。超出的照样列出来但标灰 —— 让人 @ 一张根本
 *            不会送出去的图，比不显示更糟。
 * @param slots 语义位，按序号给（首尾帧模式下是 ['first','last']）
 */
export function buildImageRefs(
  raw: RawImageRef[],
  names?: Record<string, string> | null,
  cap?: number | null,
  slots?: FrameSlot[] | null,
): ImageRef[] {
  const limit = cap && cap > 0 ? cap : Infinity
  return raw.map((r, i) => {
    const key = refKey(r.sourceId, r.slot)
    const name = (names && names[key]) || ''
    const slot = slots && slots[i] ? slots[i] : undefined
    return {
      key,
      url: r.url,
      sourceId: r.sourceId,
      index: i + 1,
      name,
      label: name || (slot ? frameLabel(slot) : '') || defaultRefName(i + 1),
      semantic: slot ? frameText(slot) : undefined,
      slot,
      overCap: i >= limit,
    }
  })
}

/**
 * @ 后面允许的字符：中英文、数字、下划线、中点。刻意不含空格 ——
 * 带空格的名字没法在纯文本里划出边界，改名时会把空白去掉。
 */
const MENTION_BODY = '[\\w\\u4e00-\\u9fa5·]{1,20}'
const MENTION_RE = new RegExp(`@(${MENTION_BODY})`, 'g')
const NOT_NAME_CHAR_RE = new RegExp('[^\\w\\u4e00-\\u9fa5·]', 'g')
const HAN_RE = new RegExp('[\\u4e00-\\u9fa5]')

/** 名字规范化：去空白，截断，防止造出匹配不到的 token */
export function normalizeRefName(input: string): string {
  return String(input || '').replace(/\s+/g, '').replace(NOT_NAME_CHAR_RE, '').slice(0, 20)
}

/** 摘出提示词里所有的 @ 名字（去重，保持出现顺序） */
export function findMentions(text: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of String(text || '').matchAll(MENTION_RE)) {
    if (!seen.has(m[1])) { seen.add(m[1]); out.push(m[1]) }
  }
  return out
}

/** 提示词里出现了、但当前输入图里已经没有的名字（图被删了或线断了） */
export function danglingMentions(text: string, refs: ImageRef[]): string[] {
  const known = new Set(refs.flatMap(refAliases))
  return findMentions(text).filter(n => !known.has(n))
}

/**
 * 判语种要先把 @token 摘掉再看。
 *
 * token 名字默认就是「图1」「图2」，本身带中文；连名字一起判的话，任何英文提示词
 * 都会被判成中文，翻出来的是「put 第 1 张参考图 into ...」这种夹生句子。
 * 真正决定语种的是 token 周围那些字。
 */
const promptIsZh = (s: string) => HAN_RE.test(s.replace(MENTION_RE, ' '))

/**
 * 提交前把 @ 翻译成模型读得懂的话。
 *
 * 编号和名字都给：只给名字模型不知道指哪张，只给编号丢了语义。
 * 语种跟着提示词走 —— 一句英文提示词里插一句中文，模型的注意力会被带偏。
 */
export function resolveMentions(text: string, refs: ImageRef[]): string {
  const src = String(text || '')
  if (!src) return src
  // 先放各语言的默认名，再放正式名字：撞名时以用户起的别名为准
  const byLabel = new Map<string, ImageRef>()
  for (const r of refs) for (const a of refAliases(r)) byLabel.set(a, r)
  for (const r of refs) byLabel.set(r.label, r)
  // 措辞的语种跟提示词走，不跟界面语言走
  const locale = promptIsZh(src) ? 'zh-CN' : 'en'
  return src.replace(MENTION_RE, (whole, name: string) => {
    const ref = byLabel.get(name)
    // 认不出来就原样留着：宁可把 @xxx 原封不动发出去，也不要瞎猜成某张图
    if (!ref) return whole
    // 首帧/尾帧是位置不是编号，直接说位置；语种同样跟提示词走
    if (ref.slot) return frameText(ref.slot, locale)
    return ref.name
      ? t('gen.refs.nthNamed', { n: ref.index, name: ref.name }, { locale })
      : t('gen.refs.nth', { n: ref.index }, { locale })
  })
}

/** 文本框里显示的提示词 → 落库的写法：语义位的 @ 名字（任一语言）换成固定 token */
export function mentionsToStored(text: string): string {
  return String(text || '').replace(MENTION_RE, (whole, name: string) => {
    const slot = frameSlotOf(name)
    return slot ? `@${FRAME_TOKEN[slot]}` : whole
  })
}

/** 落库的提示词 → 文本框里显示的写法：语义位换成当前界面语言的名字 */
export function mentionsToDisplay(text: string): string {
  return String(text || '').replace(MENTION_RE, (whole, name: string) => {
    const slot = frameSlotOf(name)
    return slot ? `@${frameLabel(slot)}` : whole
  })
}

/**
 * 在光标处插入一个 @token。
 * 返回新文本和新光标位置；前面不是空白就补一个空格，免得和上一个词粘成一个 token。
 */
export function insertMention(text: string, caret: number, label: string): { text: string; caret: number } {
  const src = String(text || '')
  const pos = Math.max(0, Math.min(caret, src.length))
  const before = src.slice(0, pos)
  const after = src.slice(pos)
  const pad = before && !/\s$/.test(before) ? ' ' : ''
  const token = `${pad}@${label} `
  return { text: before + token + after, caret: pos + token.length }
}

/**
 * 用户刚敲下 @ 时，取光标前那一段还没敲完的名字，用来过滤候选。
 * 返回 null 表示光标不在一个 @ 片段里，不该弹候选。
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const src = String(text || '')
  const pos = Math.max(0, Math.min(caret, src.length))
  const at = src.lastIndexOf('@', pos - 1)
  if (at < 0) return null
  const seg = src.slice(at + 1, pos)
  // 中间出现空白或换行说明这个 @ 已经结束了，不是正在输入的那个
  if (/\s/.test(seg)) return null
  if (seg.length > 20) return null
  // @ 前面得是行首或空白，否则是邮箱之类的东西
  if (at > 0 && !/\s/.test(src[at - 1])) return null
  return { start: at, query: seg }
}
