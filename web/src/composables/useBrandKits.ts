import { computed, ref } from 'vue'
import { brandKitApi } from '@/utils/canvasBackend'
import { t } from '@/locales'
import { useSpaceStore } from '@/stores/space'
import { currentEmbed } from '@/embed/context'

/**
 * 品牌包：加载、解析「这个节点用哪一个」、以及运行时到底往请求里加了什么。
 *
 * 品牌包按「画布」选（画布文档上的 brandKitId），节点只在跟画布不一样时才存东西
 * （data.brandKitOverride：一个品牌包 id，或 KIT_NONE 表示这个节点不套用）。
 * 存的都是 id，运行时按 id 查回来 —— 改了品牌包，之后每一次运行都用新的。
 * 查不到（被删了）就当没有，画布照跑不误。
 *
 * 这里的 composeBrandKit 是唯一一处「怎么加」的实现：执行器用它拼真正发出去的内容，
 * 节点上的预览用它显示「会加什么」。两边各写一份的话，预览迟早和实际发出去的对不上。
 */

export interface BrandKit {
  id: string
  name: string
  refImages: string[]
  promptPrefix: string
  negativePrompt: string
  isDefault: boolean
  /** 有几张画布在用它（只有列表接口带） */
  usedBy?: number
  updatedAt?: string
  /** 团队的品牌包（全队共用）；个人空间里是 false */
  shared?: boolean
  /** 是不是调用者自己建的 */
  mine?: boolean
  /** 调用者能不能改、删、设默认。团队里只有团长和管理员可以；老后端和自己写的适配器不给这一项，按「可以」算 */
  canManage?: boolean
}

/**
 * 调用者在当前空间里能不能新建 / 修改品牌包。
 * 个人空间：能。团队：只有团长和管理员（brandkit:manage）。
 * 只嵌编辑器时没有「空间」这回事（由适配器定）：看列表里的条目自己怎么说，没说就按能。
 */
export function canManageBrandKits(kits: BrandKit[] = []): boolean {
  if (currentEmbed().mode === 'editor') return !kits.some((k) => k.canManage === false)
  return useSpaceStore().can('brandkit:manage')
}
/** 这一个品牌包调用者能不能改 */
export function canManageBrandKit(kit: BrandKit | null | undefined, kits: BrandKit[] = []): boolean {
  if (kit && typeof kit.canManage === 'boolean') return kit.canManage
  return canManageBrandKits(kits)
}

/** 节点的 brandKitOverride 取这个值 = 这个节点不套用品牌包 */
export const KIT_NONE = 'none'

/** 能套用品牌包的节点类型，与执行器里的生成类节点一致 */
export const BRAND_KIT_NODE_TYPES = ['image-gen', 'image-edit', 'video-gen', 'video-edit']

/** 每个品牌包最多几张参考图（后端同一个上限） */
export const BRAND_KIT_MAX_REFS = 5

export interface NodeKitChoice {
  /** 实际会套用的品牌包；null = 这次运行不套用 */
  kit: BrandKit | null
  /** 是节点自己定的（例外），还是跟着画布 */
  own: boolean
  /** 节点自己定的那个品牌包已经不存在了（被删了），于是不套用 */
  missing: boolean
}

/** 一个节点实际用哪个品牌包：节点自己有例外就听节点的，否则跟画布 */
export function resolveNodeKit(kits: BrandKit[], canvasKitId: string, nodeData: any): NodeKitChoice {
  const find = (id: string) => kits.find((k) => k.id === id) || null
  const override = typeof nodeData?.brandKitOverride === 'string' ? nodeData.brandKitOverride : ''
  if (!override) return { kit: canvasKitId ? find(canvasKitId) : null, own: false, missing: false }
  if (override === KIT_NONE) return { kit: null, own: true, missing: false }
  const kit = find(override)
  return { kit, own: true, missing: !kit }
}

export function useBrandKits() {
  const kits = ref<BrandKit[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const failed = ref(false)

  async function load(force = false) {
    if (loading.value) return
    if (loaded.value && !force) return
    loading.value = true
    try {
      const res = await brandKitApi.list()
      if (res.data.result === 0) {
        // 「新画布默认」的那个排最前，其余按接口给的顺序（最近改过的在前）
        const list: BrandKit[] = res.data.data || []
        kits.value = [...list.filter((k) => k.isDefault), ...list.filter((k) => !k.isDefault)]
        loaded.value = true
        failed.value = false
      } else {
        failed.value = true
      }
    } catch {
      // 拉不到就当没有品牌包 —— 这个功能不该拦住画布正常使用；管理页自己看 failed 给重试
      failed.value = true
    } finally {
      loading.value = false
    }
  }

  /** 能不能新建、修改、删除、设默认（见 canManageBrandKits）。成员只能选用 */
  const canManage = computed(() => canManageBrandKits(kits.value))

  return { kits, loading, loaded, failed, load, canManage }
}

/** 一句话说清这个品牌包里有什么（卡片、选择器共用） */
export function brandKitSummary(kit: BrandKit): string {
  const parts: string[] = []
  const refs = (kit.refImages || []).filter(Boolean).length
  if (refs) parts.push(t('brandKit.summary.refs', { n: refs }))
  if ((kit.promptPrefix || '').trim()) parts.push(t('brandKit.summary.prefix'))
  if ((kit.negativePrompt || '').trim()) parts.push(t('brandKit.summary.negative'))
  return parts.length ? parts.join(' · ') : t('brandKit.summary.empty')
}

export interface BrandKitEffect {
  /** 套用之后真正发出去的提示词 */
  prompt: string
  /** 套用之后真正发出去的参考图，按顺序 */
  imageUrls: string[]
  /** 加在提示词最前面的那段话；没有就是空串 */
  prefix: string
  /** 加在提示词末尾的那一整行（含「不要出现：」）；没有就是空串 */
  suffix: string
  /** 这次会一起发出去的品牌包参考图 */
  addedImages: string[]
  /** 这次不会发出去的品牌包参考图 */
  skippedImages: string[]
  /** 没发出去的原因：首尾帧模式 / 模型不接收参考图 / 模型的参考图名额满了 */
  skipReason: '' | 'frames' | 'noRefs' | 'full'
}

/**
 * 把品牌包套到一次运行上。
 *
 * 文字：前缀放最前，「不要出现：…」放最后。后者只是提示词里的一句话 ——
 * 现有几家模型的接口都没有独立的 negative_prompt 参数，模型听不听是另一回事。
 * 那句话的开头跟着运行那一刻的界面语言走。
 *
 * 图片：节点自己连进来的图一张不动、排在前面，品牌包的图只填模型剩下的名额。
 * 节点上连的那张才是这次要处理的主体（商品图），品牌包只是风格上下文；
 * 反过来的话，带 5 张图的品牌包会把刚连上的商品图挤掉，而且不报错。
 * 首尾帧模式不加图：那条路送出去的必须正好是 [首帧, 尾帧]，多一张就会顶掉尾帧或被当成尾帧。
 *
 * @param maxRefs 该模型的参考图上限；0 = 这个模型不接收参考图
 */
export function composeBrandKit(
  kit: BrandKit,
  input: { prompt: string; imageUrls: string[]; maxRefs: number; framesMode?: boolean },
): BrandKitEffect {
  const prefix = (kit.promptPrefix || '').trim()
  const neg = (kit.negativePrompt || '').trim()
  const suffix = neg ? t('brandKit.negativeLead') + neg : ''
  const prompt = [prefix, input.prompt, suffix].filter(Boolean).join('\n')

  const own = input.imageUrls
  const refs = [...new Set((kit.refImages || []).filter(Boolean))].filter((u) => !own.includes(u))
  const cap = Math.max(0, Number(input.maxRefs) || 0)
  let free = 0
  let skipReason: BrandKitEffect['skipReason'] = ''
  if (input.framesMode) skipReason = 'frames'
  else if (!cap) skipReason = 'noRefs'
  else free = Math.max(0, cap - new Set(own).size)
  const addedImages = refs.slice(0, free)
  const skippedImages = refs.slice(free)
  if (!skippedImages.length) skipReason = ''
  else if (!skipReason) skipReason = 'full'

  return { prompt, imageUrls: [...own, ...addedImages], prefix, suffix, addedImages, skippedImages, skipReason }
}

/**
 * 一个节点这次运行和品牌包的关系 —— 节点表头的标记、改提示词处的那一行都按它说话，不各自判断：
 *
 *   none      没有品牌包要套用（画布没选，节点也没有例外）
 *   off       节点自己定了「不套用」
 *   missing   节点单独选的那个品牌包已经被删了，于是不套用
 *   applied   会套用，品牌包里的东西全都发得出去
 *   textOnly  会套用，但只有文字发得出去：参考图一张都不会发（首尾帧模式 / 模型不接收参考图 / 名额已满）
 *   partial   会套用，参考图只发得出去一部分（模型的名额不够）
 *   noEffect  选了品牌包，可这次运行什么都加不上：它只有参考图，而参考图一张都发不出去
 *   empty     选了品牌包，但它本身是空的
 *
 * 「选了」和「起作用」是两回事：只写「已套用」会让人以为参考图也跟着发出去了。
 */
export type KitRunState = 'none' | 'off' | 'missing' | 'applied' | 'textOnly' | 'partial' | 'noEffect' | 'empty'

export function kitRunState(choice: NodeKitChoice, effect: BrandKitEffect | null | undefined): KitRunState {
  if (!choice.kit) return choice.missing ? 'missing' : choice.own ? 'off' : 'none'
  // 查不到会加什么（执行器不在场）：只能说选了，不替它说没起作用
  if (!effect) return 'applied'
  const text = !!(effect.prefix || effect.suffix)
  const added = effect.addedImages.length
  const skipped = effect.skippedImages.length
  if (!text && !added) return skipped ? 'noEffect' : 'empty'
  if (!skipped) return 'applied'
  return added ? 'partial' : 'textOnly'
}
