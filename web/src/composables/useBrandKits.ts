import { ref, computed } from 'vue'
import { brandKitApi } from '@/utils/api'
import { t } from '@/locales'

/**
 * 品牌包的加载与查找。
 *
 * 画布挂载时拉一次列表放内存，节点上只存 brandKitId，执行时按 id 查回来。
 * 不把整份品牌包快照进节点，是为了改了品牌包之后画布上所有节点跟着变 ——
 * 这正是它存在的意义。代价是通过分享链接复制走的画布在别的实例里查不到这个 id，
 * 于是自动退化成「不套用」，画布照跑不误（见 getBrandKit 的兜底）。
 */

export interface BrandKit {
  id: string
  name: string
  refImages: string[]
  promptPrefix: string
  negativePrompt: string
  defaultRatio: string
  defaultModel: string
  isDefault: boolean
  updatedAt?: string
}

export function useBrandKits() {
  const kits = ref<BrandKit[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  const defaultKit = computed(() => kits.value.find((k) => k.isDefault) || null)

  async function load(force = false) {
    if (loading.value) return
    if (loaded.value && !force) return
    loading.value = true
    try {
      const res = await brandKitApi.list()
      if (res.data.result === 0) {
        kits.value = res.data.data || []
        loaded.value = true
      }
    } catch {
      // 拉不到就当没有品牌包 —— 这个功能不该拦住画布正常使用
    } finally {
      loading.value = false
    }
  }

  /**
   * 按 id 取。查不到返回 null，调用方据此完全跳过套用。
   *
   * 查不到是正常情况而不是错误：品牌包被删了、或者这张画布是从分享链接
   * 复制来的、里面的 id 不在本实例。这两种情况都该安静退化，不该报错。
   */
  function getBrandKit(id?: string | null): BrandKit | null {
    if (!id) return null
    return kits.value.find((k) => k.id === id) || null
  }

  return { kits, loading, loaded, defaultKit, load, getBrandKit }
}

/**
 * 把品牌包的提示词部分拼进本次提示词。
 *
 * 负向词是以「不要出现：」的形式（前缀跟界面语言走）附在末尾的 —— 现有几家图片模型的接口都没有
 * 独立的 negative_prompt 参数，这是提示词工程不是接口能力，模型听不听是另一回事。
 * 界面上不要把它说成「负向提示词（生效）」。
 */
export function applyBrandKitPrompt(kit: BrandKit, prompt: string): string {
  const parts: string[] = []
  const prefix = (kit.promptPrefix || '').trim()
  const neg = (kit.negativePrompt || '').trim()
  if (prefix) parts.push(prefix)
  if (prompt) parts.push(prompt)
  if (neg) parts.push(t('library.brandKit.negativePrefix') + neg)
  return parts.join('\n')
}

/**
 * 把品牌包的固定参考图并进本次的图片输入。
 *
 * 顺序上「节点自己连进来的图」优先，品牌包的图填剩余名额 ——
 * 节点上连的那张才是这次要处理的主体（商品图），品牌包只是风格上下文。
 * 反过来的话，一个带 5 张参考图的品牌包会把用户刚连上的商品图整个挤掉，
 * 而且不报错，用户只会觉得「出的图跟我给的商品没关系」。
 *
 * @param max 该模型的参考图上限（adapter.options.maxReferenceImages）
 */
export function applyBrandKitImages(kit: BrandKit, imageUrls: string[], max: number): string[] {
  const refs = (kit.refImages || []).filter(Boolean)
  if (!refs.length) return imageUrls
  const cap = Math.max(1, Number(max) || 1)

  const out: string[] = []
  const seen = new Set<string>()
  for (const u of [...imageUrls, ...refs]) {
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
    if (out.length >= cap) break
  }
  return out
}

/**
 * 这个品牌包在该模型下实际能占几张参考图 —— 给界面显示「还能加几张」用。
 * 与 applyBrandKitImages 的口径必须一致：节点已连 n 张时，品牌包只能占剩下的。
 */
export function brandKitImageSlots(kit: BrandKit | null, usedByNode: number, max: number): number {
  if (!kit) return 0
  const refs = (kit.refImages || []).filter(Boolean).length
  if (!refs) return 0
  const cap = Math.max(1, Number(max) || 1)
  return Math.max(0, Math.min(refs, cap - usedByNode))
}
