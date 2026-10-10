import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from 'tdesign-vue-next'
import { workflowApi, apiErrorMessage } from '@/utils/api'

export interface TemplateLike {
  title?: string
  graph?: { nodes?: any[]; edges?: any[] }
}

/**
 * 「新建画布并进入编辑器」的几条路：空白、从模板、带一个素材、带一段文本。
 * 工作台首页和画布列表共用 —— 这两页都没有「当前画布」，选中的东西一律落到一个新画布里。
 */
export function useCanvasCreate() {
  const router = useRouter()
  const { t } = useI18n()

  /**
   * 卡片上的时间：今天 / 昨天说人话，今年只给月日，跨年才补年份 ——
   * 它只是个次要信息，认得出「哪张更新」就够了。
   */
  function formatTime(v: string | undefined) {
    if (!v) return ''
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    const sameDay = (a: Date, b: Date) =>
      a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

    const now = new Date()
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    if (sameDay(d, now)) return t('views.list.today', { time: hm })
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (sameDay(d, yesterday)) return t('views.list.yesterday', { time: hm })

    const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return d.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}-${md}`
  }

  const untitledName = () => t('views.list.untitled', { time: formatTime(new Date().toISOString()) })
  /** 自动命名：优先用素材 / 模板自己的名字，否则按时间 */
  const autoName = (preferred?: string) => preferred?.trim().slice(0, 80) || untitledName()

  /** 建一个画布并进入编辑器；失败时提示并返回 false */
  async function createAndOpen(name: string, nodes: any[] = [], edges: any[] = []): Promise<boolean> {
    try {
      const res = await workflowApi.create({ name, nodes, edges })
      if (res.data.result === 0 && res.data.data) {
        router.push(`/canvas/${res.data.data.id}`)
        return true
      }
      MessagePlugin.error(res.data.message || t('views.list.createFailed'))
    } catch (err: any) {
      MessagePlugin.error(apiErrorMessage(err, t('views.list.createFailed')))
    }
    return false
  }

  /** 画布模板：新建画布并把模板节点图铺进去 */
  async function createFromTemplate(tpl: TemplateLike): Promise<boolean> {
    const g = tpl?.graph
    if (!g || !Array.isArray(g.nodes) || g.nodes.length === 0) {
      MessagePlugin.warning(t('views.list.templateEmpty'))
      return false
    }
    // 模板局部 id → 新的全局 id（用下标保证唯一）
    const base = Date.now().toString(36)
    const idMap = new Map<string, string>()
    g.nodes.forEach((n: any, i: number) => idMap.set(n.id, `n_${base}_${i}`))

    const nodes = g.nodes.map((n: any) => ({
      id: idMap.get(n.id)!,
      type: n.type,
      position: { x: n.position?.x || 0, y: n.position?.y || 0 },
      data: JSON.parse(JSON.stringify(n.data || {})),
    }))
    const edges = (g.edges || [])
      .filter((e: any) => idMap.has(e.source) && idMap.has(e.target))
      .map((e: any, i: number) => ({
        id: `e_${base}_${i}`,
        source: idMap.get(e.source)!,
        target: idMap.get(e.target)!,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: 'glow',
      }))
    return createAndOpen(autoName(tpl.title), nodes, edges)
  }

  /** 素材「添加到画布」：新建画布并把素材作为节点放进去 */
  async function createFromAsset(asset: { nodeType?: string; mediaUrl?: string; name?: string }): Promise<boolean> {
    if (!asset?.mediaUrl) return false
    const isVideo = asset.nodeType === 'VIDEO'
    const node = {
      id: `n_${Date.now().toString(36)}_0`,
      type: isVideo ? 'video' : 'image',
      position: { x: 200, y: 120 },
      data: isVideo ? { videoUrl: asset.mediaUrl } : { imageUrl: asset.mediaUrl },
    }
    return createAndOpen(autoName(asset.name), [node], [])
  }

  /** 文本模板「添加到画布」：新建画布，放一个文本节点 */
  async function createFromText(content: string): Promise<boolean> {
    if (!content || !content.trim()) return false
    const node = {
      id: `n_${Date.now().toString(36)}_0`,
      type: 'text',
      position: { x: 200, y: 120 },
      data: { text: content },
    }
    return createAndOpen(untitledName(), [node], [])
  }

  return { formatTime, createAndOpen, createFromTemplate, createFromAsset, createFromText }
}
