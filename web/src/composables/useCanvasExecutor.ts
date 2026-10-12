import { ref, computed, watch, type Ref } from 'vue'
import type { Node, Edge } from '@vue-flow/core'
import { MessagePlugin } from 'tdesign-vue-next'
import {
  getAdapter, isModelSupported, isLastFrameHandle, isFramesModeData, listChatModels, listVideoChatModels, chatReadsImages,
  type AdapterPollResult,
} from '@/utils/canvasModels'
import { llmApi, runsApi, unwrap, platformExportApi, canvasToolApi } from '@/utils/api'
import { uploadDataUrl } from '@/utils/canvasUpload'
import { sumCosts } from '@/utils/cost'
import { t } from '@/locales'
import type { Cost, LlmTask } from '@/types'
import { composeBrandKit, type BrandKit, type BrandKitEffect } from '@/composables/useBrandKits'
import { recordGroupResult } from '@/composables/platformExportGroups'
import { publicUrlProblem } from '@/composables/usePublicUrlNotice'
import {
  applyImageOrder, buildImageRefs, resolveMentions, danglingMentions,
  type RawImageRef, type ImageRef,
} from '@/composables/canvasImageRefs'

const TERMINAL_DATA_TYPES = new Set(['text', 'image'])
const GEN_TYPES = new Set(['image-gen', 'image-edit', 'video-gen', 'video-edit'])
// 视频分析节点：video-in + text-in（提示词）→ text-out，走自定义分析接口，输出文本而非 image/video，
// 因此不走通用 adapter 路径，由 runAnalysisNode 专门处理，但仍参与运行计划/排队。
const ANALYSIS_TYPE = 'video-analysis'
// 大语言模型节点：text-in(提示词) + 可选 image-in(参考图) → text-out，无视频输入。
// 与视频分析共用「提交 → 轮询 → 把返回文本写入 data.text」的自由文本任务流程，走 /api/llm/tasks 接口。
const LLM_TYPE = 'llm'
// 输出文本、由专门执行器处理（不走通用 adapter）、但仍参与运行计划/排队的节点类型
const TEXT_OUT_TYPES = new Set([ANALYSIS_TYPE, LLM_TYPE])

/**
 * 后端某次运行给出的失败原因。带上那次运行的 id：节点上存的 errorMsg 是当时界面语言的
 * 一句话，有了 id 才能在换语言 / 重新打开画布时按当前语言重取（见 refreshRunErrors）。
 */
function runFailure(message: string, runId: string): Error {
  return Object.assign(new Error(message), { runId })
}
/** 这次运行被用户取消了。不是失败：节点回到中性的「已取消」，不标红、不提示 */
class RunCanceled extends Error {}

/**
 * 多平台导出。与 video-analysis / llm 一样不走模型适配器，但它更特殊：
 * 整个处理在后端本机做（换尺寸、白底净化、纯白检测），不调任何模型，
 * 因此没有成本、也没有 taskId 可轮询 —— 一次请求拿到全部结果。
 */
const EXPORT_TYPE = 'platform-export'
const SLICE_TYPE = 'slice'
const COLLAGE_TYPE = 'collage'
const WATERMARK_TYPE = 'watermark'
const FIT_TYPE = 'fit-size'
/** 工具节点：后端本机处理，不调模型，没有成本 */
const TOOL_TYPES = new Set([SLICE_TYPE, COLLAGE_TYPE, WATERMARK_TYPE, FIT_TYPE])
/** 参与运行计划、但不走适配器的「本机处理」节点 */
const LOCAL_TYPES = new Set([EXPORT_TYPE, ...TOOL_TYPES])

const NODE_KIND_OUTPUT = 'output'

/** 生成节点的名字，只用于提示语 */
const GEN_LABEL_KEY: Record<string, string> = {
  'image-gen': 'nodes.title.imageGen', 'image-edit': 'nodes.title.imageEdit',
  'video-gen': 'nodes.title.videoGen', 'video-edit': 'nodes.title.videoEdit',
}

/** 工具节点的名字，只用于提示语 */
const TOOL_LABEL_KEY: Record<string, string> = {
  'slice': 'nodes.title.slice', 'collage': 'nodes.title.collage',
  'watermark': 'nodes.title.watermark', 'fit-size': 'nodes.title.fitSize',
}

/**
 * 一个节点最多留几版结果。
 *
 * 存的只是 URL 和参数（图本身在存储层），但画布整体 payload 有体积上限，
 * 500 节点每个留十几版就顶到天花板了 —— 保存会被后端直接拒掉。10 版足够对比，
 * 再往前的版本实际上没人回头看。
 */
const MAX_RESULTS = 10

/** 一次成功运行的产物快照。一版可能有多张（节点「数量」参数 > 1），所以是数组 */
export interface NodeResultEntry {
  id: string
  at: number
  urls: string[]
  /** 这一版的实际成本；模型没配价格时 unknown 为真 */
  cost?: Cost | null
  model?: string
  prompt?: string
}

const POLL_INTERVAL_MS = 1500
// 30 分钟：视频生成常需 10+ 分钟。后端对每个运行有自己的总时长上限，超时会判失败，
// 这里只是前端的兜底。快任务会在 completed/failed 时提前 return。
const POLL_MAX_ATTEMPTS = 1200

// 轮询期间的「瞬时错误」：后端重启 / 网关 502~504 / 网络中断等。
// 这类错误不代表任务失败——上游任务还在跑，应继续重试等后端恢复后把结果重新捞回来，
// 不能像业务错误(result!==0，纯 Error)那样几次就判失败标红（比如重新部署时后端短暂 502）。
function isTransientPollError(err: any): boolean {
  const status = err?.response?.status
  if (typeof status === 'number') return status >= 500 || status === 429 || status === 408
  // 没有 HTTP 响应：网络中断 / 后端重启中 / 网关不可达
  if (err?.isAxiosError || err?.request) return true
  const code = err?.code
  return code === 'ECONNABORTED' || code === 'ERR_NETWORK' || code === 'ETIMEDOUT'
}

export type NodeStatus = 'idle' | 'queued' | 'running' | 'done' | 'error' | 'stale' | 'canceled'

interface CollectedInputs {
  text: string | null
  imageUrls: string[]
  videoUrl: string | null
}

interface ExecutorOptions {
  nodes: Ref<Node[]>
  edges: Ref<Edge[]>
  updateNodeData: (id: string, patch: Record<string, any>) => void
  /**
   * 这个节点这次运行套用哪个品牌包（跟随画布，或节点自己的例外）。
   * 可选 —— 不传（或返回 null）时提示词和参考图原样发出去。
   */
  getNodeBrandKit?: (nodeData: any) => BrandKit | null
  /** 当前画布 id，提交运行时带上用于用量归属 */
  getWorkflowId?: () => string | null | undefined
  /**
   * 立刻把画布存一次。提交成功拿到任务号的那一刻调用：任务号只在内存里的话，
   * 这时候刷新或关页面，已经在跑（也已经计费）的任务就再也接不回来了。
   */
  persist?: () => Promise<unknown> | void
  /**
   * 这次运行会重新提交已经有结果的付费节点（生成 / 大语言模型 / 视频分析）时先问用户。
   * 一次触发只问一次，不管牵连几个节点；返回 false 整次运行不开始。
   * 不传就不问。
   */
  confirmRerun?: (info: { count: number; textCount: number }) => Promise<boolean>
}

export interface RunOptions {
  /** 调用方自己已经让用户确认过这一批（批量运行），不再弹重跑确认 */
  skipRerunConfirm?: boolean
}

// 同时真正在执行(submit/poll)的节点上限。多条生成并发时用它兜底，避免一次打出过多请求触发上游限流。
export const MAX_CONCURRENT = 10

export function useCanvasExecutor({ nodes, edges, updateNodeData, getNodeBrandKit, getWorkflowId, persist, confirmRerun }: ExecutorOptions) {
  // ============ 并发调度状态 ============
  // 多条生成可同时进行：不再用单一全局锁，改为「按依赖就绪即执行 + 并发上限」的 DAG 调度。
  // inflight：节点 → 正在跑的 Promise。既做「同一节点只跑一次」的去重（防共享上游被重复触发重复计费），
  // 也让另一条分支需要同一上游时 await 同一个 Promise 而不是重跑。
  const inflight = new Map<string, Promise<boolean>>()
  const inflightCount = ref(0)
  const running = computed(() => inflightCount.value > 0) // 供 UI「运行中」显示
  const runningNodeId = ref<string | null>(null)          // 最近一个开始执行的节点（并发下仅供参考/兼容）

  // 简单信号量：控制同时执行的节点数不超过 MAX_CONCURRENT
  let activeSlots = 0
  const slotWaiters: Array<() => void> = []
  function acquireSlot(): Promise<void> {
    if (activeSlots < MAX_CONCURRENT) { activeSlots++; return Promise.resolve() }
    return new Promise<void>(res => slotWaiters.push(res))
  }
  function releaseSlot() {
    activeSlots = Math.max(0, activeSlots - 1)
    const next = slotWaiters.shift()
    if (next) { activeSlots++; next() }
  }

  // ============ 基础工具 ============

  function findNode(id: string): Node | undefined {
    return nodes.value.find(n => n.id === id)
  }

  // 文本/视频输出（单值）
  function getOutputValue(node: Node, dataType: 'text' | 'video'): string | null {
    const d = node.data || {}
    if (node.type === 'text' && dataType === 'text') return d.text || null
    if (TEXT_OUT_TYPES.has(node.type as string) && dataType === 'text') return d.text || null
    if (node.type === 'video' && dataType === 'video') return d.videoUrl || null
    if (node.type === 'video-gen' && dataType === 'video') return d.videoUrl || null
    if (node.type === 'video-edit' && dataType === 'video') return d.videoUrl || null
    return null
  }

  // 图片输出（可能是多张，递归处理 image-collection）
  function getImageOutputs(node: Node, visited = new Set<string>()): string[] {
    if (visited.has(node.id)) return []
    visited.add(node.id)
    const d = node.data || {}
    if (node.type === 'image') return d.imageUrl ? [d.imageUrl] : []
    if (node.type === 'image-gen' || node.type === 'image-edit') {
      return d.imageUrl ? [d.imageUrl] : []
    }
    // 导出节点吐的是一整组尺寸，下游（比如成品节点）该拿到全部
    if (node.type === EXPORT_TYPE) return Array.isArray(d.imageUrls) ? d.imageUrls : []
    // 切片同理：切出来的每一块都是产物；其余工具节点只出一张
    if (node.type === SLICE_TYPE) return Array.isArray(d.imageUrls) ? d.imageUrls : []
    if (TOOL_TYPES.has(node.type as string)) return d.imageUrl ? [d.imageUrl] : []
    if (node.type === 'image-collection') {
      // 集合 = 上游所有图片节点 + 自己内部上传的
      const upstream: string[] = []
      const incoming = edges.value.filter(e =>
        e.target === node.id && getHandleDataType(e.sourceHandle as string) === 'image'
      )
      for (const e of incoming) {
        const src = findNode(e.source)
        if (src) upstream.push(...getImageOutputs(src, visited))
      }
      const internal: string[] = Array.isArray(d.imageUrls) ? d.imageUrls : []
      return [...upstream, ...internal]
    }
    return []
  }

  /**
   * 和 getImageOutputs 走同一套展开规则，但把「哪个节点产的、在它内部排第几」也带出来。
   * 这两个信息拼成的 key 是编号和别名的锚点 —— 源节点重跑一次 URL 就变了，拿 URL 当
   * 主键的话用户排好的顺序和起好的名字会全部丢。
   */
  function getRawImageRefs(node: Node, visited = new Set<string>()): RawImageRef[] {
    if (visited.has(node.id)) return []
    // 集合节点要把上游摊平，摊平后每一张仍归属它自己的源节点，编号才跟得住
    if (node.type === 'image-collection') {
      visited.add(node.id)
      const out: RawImageRef[] = []
      const incoming = edges.value.filter(e =>
        e.target === node.id && getHandleDataType(e.sourceHandle as string) === 'image'
      )
      for (const e of incoming) {
        const s = findNode(e.source)
        if (s) out.push(...getRawImageRefs(s, visited))
      }
      const internal: string[] = Array.isArray(node.data?.imageUrls) ? node.data!.imageUrls : []
      internal.forEach((url, i) => { if (url) out.push({ sourceId: node.id, slot: i, url }) })
      return out
    }
    return getImageOutputs(node, visited).map((url, i) => ({ sourceId: node.id, slot: i, url }))
  }

  function getHandleDataType(handleId?: string | null): 'text' | 'image' | 'video' | null {
    if (!handleId) return null
    const prefix = handleId.split('-')[0]
    if (prefix === 'text' || prefix === 'image' || prefix === 'video') return prefix
    return null
  }

  // ============ data: URL 转存成站内文件 ============

  async function ensureStoredUrl(url: string): Promise<string> {
    if (!url) return url
    return uploadDataUrl(url)
  }

  // ============ 收集输入 ============

  function collectInputs(targetId: string): CollectedInputs {
    const result: CollectedInputs = { text: null, imageUrls: [], videoUrl: null }
    const incoming = edges.value.filter(e => e.target === targetId)

    // 先分离出图片输入边；文本/视频即时取值
    const imageEdges: typeof incoming = []
    const textEdges: typeof incoming = []
    for (const edge of incoming) {
      const source = findNode(edge.source)
      if (!source) continue
      const dataType = getHandleDataType(edge.sourceHandle as string)
      if (!dataType) continue

      if (dataType === 'image') {
        imageEdges.push(edge)
      } else if (dataType === 'text') {
        textEdges.push(edge)
      } else if (dataType === 'video') {
        const value = getOutputValue(source, dataType)
        if (value) result.videoUrl = value
      }
    }

    // 文本可多条：按节点里的 textOrder 排序后拼接（单条时即它本身）
    if (textEdges.length) {
      const items = textEdges
        .map(e => { const s = findNode(e.source); const v = s ? getOutputValue(s, 'text') : null; return v ? { sourceId: e.source, text: v } : null })
        .filter((x): x is { sourceId: string; text: string } => !!x)
      const order = (findNode(targetId)?.data?.textOrder as string[]) || []
      const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? 9999 : i }
      items.sort((a, b) => rank(a.sourceId) - rank(b.sourceId))
      result.text = items.map(t => t.text).join('\n\n') || null
    }

    // 图片可能来自集合节点，取值时要展开
    const refsOf = (es: typeof imageEdges) =>
      es.flatMap(e => { const s = findNode(e.source); return s ? getRawImageRefs(s) : [] })
    const urlsOf = (es: typeof imageEdges) => refsOf(es).map(r => r.url)

    const lastEdges = imageEdges.filter(e => isLastFrameHandle(e.targetHandle as string))
    if (lastEdges.length) {
      /**
       * 接了尾帧 = 用户在用首尾帧模式，那么送出去的就该正好是 [首帧, 尾帧] 两张。
       *
       * 不能只靠「排个序 + 交给 submit 截前两张」：首帧口在 video-gen 上是允许接多张的
       * （多图参考模式要用），一旦首帧接了两张，排完序是 [图1, 图2, 尾]，submit 截前两张
       * 拿到 [图1, 图2] —— 尾帧被静默丢掉，用户看不出哪里错了，只觉得尾帧没生效。
       * 所以这里两端各取一张，多余的不参与。
       *
       * 判据用「有没有接尾帧」而不是读节点的 imgMode：模式的默认值来自各模型的声明，
       * 执行器再去解析一遍容易和界面对不上；
       * 而「他把线连到尾帧口上了」本身就是最硬的意图证据。
       */
      const first = urlsOf(imageEdges.filter(e => !isLastFrameHandle(e.targetHandle as string)))[0]
      const last = urlsOf(lastEdges)[0]
      if (first) result.imageUrls.push(first)
      if (last) result.imageUrls.push(last)
    } else {
      // 用户在缩略图条上排过序就按他排的来。这里和 collectImageRefs 必须同口径，
      // 否则界面标的「图2」和真正送出去的第二张对不上
      const node = findNode(targetId)
      const ordered = applyImageOrder(refsOf(imageEdges), node?.data?.imageOrder as string[] | undefined)
      result.imageUrls.push(...ordered.map(r => r.url))
    }
    return result
  }

  /**
   * 一个节点当前真正会送出去的图，按最终顺序。缩略图条和执行器共用这一个，
   * 界面上标的「图2」和实际发出去的第二张必须是同一张。
   */
  function collectImageRefs(targetId: string): ImageRef[] {
    const node = findNode(targetId)
    if (!node) return []
    const incoming = edges.value.filter(e => e.target === targetId)
    const imageEdges = incoming.filter(e => getHandleDataType(e.sourceHandle as string) === 'image')
    const refsOf = (es: typeof imageEdges) =>
      es.flatMap(e => { const s = findNode(e.source); return s ? getRawImageRefs(s) : [] })

    const lastEdges = imageEdges.filter(e => isLastFrameHandle(e.targetHandle as string))
    if (lastEdges.length) {
      // 首尾帧那条路送出去的必须正好两张，顺序由「连到哪个口」决定，不参与拖拽调序
      const first = refsOf(imageEdges.filter(e => !isLastFrameHandle(e.targetHandle as string)))[0]
      const last = refsOf(lastEdges)[0]
      const picked = [first, last].filter(Boolean) as RawImageRef[]
      return buildImageRefs(picked, node.data?.imageNames, 2, ['first', 'last'])
    }

    const adapter = getAdapter((node.data?.model as string) || '')
    const cap = adapter?.options?.maxReferenceImages
    return buildImageRefs(
      applyImageOrder(refsOf(imageEdges), node.data?.imageOrder as string[] | undefined),
      node.data?.imageNames,
      cap,
    )
  }

  /** 连进来的文本（提示词），与 collectInputs 给执行用的是同一份。面板上「提示词来自上游」那一段显示的就是它 */
  function upstreamText(targetId: string): string {
    return collectInputs(targetId).text || ''
  }

  // ============ 校验 ============

  function validateGenNode(node: Node, inputs: CollectedInputs): string | null {
    const modelId = (node.data?.model as string) || ''
    if (!isModelSupported(modelId)) {
      return modelId ? t('executor.modelUnavailable', { model: modelId }) : t('executor.noModel')
    }

    if (node.type === 'image-gen' || node.type === 'video-gen') {
      const prompt = inputs.text || node.data?.prompt || ''
      if (!prompt.trim()) return t('executor.needPrompt')
    }

    /**
     * 提示词里 @ 了一张已经不在的图（图被删了 / 线断了）。
     * 拦下来而不是照发：那句话会原封不动进提示词，模型只能瞎猜，出来的东西不对
     * 用户还找不到原因。
     */
    {
      const text = inputs.text
        || (node.type === 'image-edit' ? node.data?.instruction : node.data?.prompt)
        || ''
      const missing = danglingMentions(text, collectImageRefs(node.id))
      if (missing.length) return t('executor.danglingMention', { name: missing[0] })
    }
    if (node.type === 'video-gen' && inputs.videoUrl) {
      // 连了「视频」输入，但当前模型不支持视频输入
      const adapter = getAdapter(modelId)
      if (adapter && !adapter.acceptsVideo) {
        return t('executor.videoInputUnsupported')
      }
    }
    if (node.type === 'image-edit') {
      if (inputs.imageUrls.length === 0) return t('executor.needSourceImage')
      const instr = inputs.text || node.data?.instruction || ''
      if (!instr.trim()) return t('executor.needInstruction')
    }
    if (node.type === 'video-edit') {
      // 视频编辑必须连入一个视频；提示词/参考图可选
      if (!inputs.videoUrl) return t('executor.needVideo')
    }
    // 参考素材只能按公网地址交给上游、而实例没有公网地址：后端反正会拒绝，这里先拦下并说清楚
    // 品牌包的参考图同样按地址交给上游，所以看的是加上它们之后真正会发出去的那一组
    const unreachable = publicUrlProblem(getAdapter(modelId), { imageUrls: composeGenRequest(node, inputs).imageUrls, videoUrl: inputs.videoUrl })
    if (unreachable) return unreachable
    return null
  }

  // ============ 这次会发出去什么 ============

  /**
   * 一个生成节点这次运行真正发出去的提示词和参考图。
   *
   * 提示词：连进来的文本优先，回退到节点上写的；@图1 / @产品 翻成模型读得懂的话
   * （「第 1 张参考图（产品）」），卡片上仍显示带 @ 的原文。
   *
   * 品牌包：没有就原样返回。有的话怎么加只有 composeBrandKit 一处实现，
   * 节点上「会加什么」的预览（brandKitEffect）走的也是这个函数 —— 预览和实际发出去的不会两样。
   * 首尾帧模式只加文字不加图，判据取或：节点声明的模式，以及「有没有把线连到尾帧口上」——
   * 后者是执行器一贯采用的硬证据（用户连线的意图比默认值可靠）。
   */
  function composeGenRequest(node: Node, inputs: CollectedInputs): { prompt: string; imageUrls: string[]; kit: BrandKit | null; effect: BrandKitEffect | null } {
    const raw = inputs.text
      || (node.type === 'image-edit' ? node.data?.instruction : node.data?.prompt)
      || ''
    const prompt = resolveMentions(raw, collectImageRefs(node.id))
    const kit = getNodeBrandKit ? getNodeBrandKit(node.data) : null
    if (!kit) return { prompt, imageUrls: inputs.imageUrls, kit: null, effect: null }
    const framesMode = isFramesModeData(node.data)
      || edges.value.some(e => e.target === node.id && isLastFrameHandle(e.targetHandle as string))
    const effect = composeBrandKit(kit, {
      prompt,
      imageUrls: inputs.imageUrls,
      maxRefs: getAdapter((node.data?.model as string) || '')?.options.maxReferenceImages || 0,
      framesMode,
    })
    return { prompt: effect.prompt, imageUrls: effect.imageUrls, kit, effect }
  }

  /** 这个节点现在运行的话，品牌包会往请求里加什么；不套用品牌包返回 null */
  function brandKitEffect(nodeId: string): { kit: BrandKit; effect: BrandKitEffect } | null {
    const node = findNode(nodeId)
    if (!node || !GEN_TYPES.has(node.type as string)) return null
    const req = composeGenRequest(node, collectInputs(nodeId))
    return req.kit && req.effect ? { kit: req.kit, effect: req.effect } : null
  }

  // ============ 单节点执行 ============

  async function runNode(nodeId: string): Promise<boolean> {
    const node = findNode(nodeId)
    if (!node) return false
    if (node.type === EXPORT_TYPE) {
      return await runExportNode(node)
    }
    if (TOOL_TYPES.has(node.type as string)) {
      return await runToolNode(node)
    }
    if (node.type === ANALYSIS_TYPE) {
      return await runAnalysisNode(node)
    }
    if (node.type === LLM_TYPE) {
      return await runLlmNode(node)
    }
    if (!GEN_TYPES.has(node.type as string)) {
      // 非生成节点直接视为"已就绪"
      return true
    }

    const inputs = collectInputs(nodeId)
    const validationMsg = validateGenNode(node, inputs)
    if (validationMsg) {
      // 校验失败不算"运行失败"——任务根本没提交，不应显示"失败"badge。
      // validationError 驱动卡片红边框；validationStamp 每次触发都更新，节点组件据此重启抖动动画。
      updateNodeData(nodeId, {
        status: 'idle',
        validationError: validationMsg,
        validationStamp: Date.now(),
      })
      MessagePlugin.error(`[${t(GEN_LABEL_KEY[node.type as string] || 'nodes.title.generic')}] ${validationMsg}`)
      return false
    }
    // 校验通过：清掉之前残留的校验提示
    if (node.data?.validationError) {
      updateNodeData(nodeId, { validationError: '' })
    }

    const modelId = node.data!.model as string
    const adapter = getAdapter(modelId)!  // validated above

    // 提示词和参考图：节点自己的，加上品牌包的（见 composeGenRequest）。
    // 落库的 lastPrompt 存的是这里拼好的 —— 那才是真发出去的。
    const request = composeGenRequest(node, inputs)
    const prompt = request.prompt
    inputs.imageUrls = request.imageUrls

    updateNodeData(nodeId, {
      status: 'running',
      progress: 0,
      errorMsg: '',
      errorRunId: '',
      cost: null,
      // 落库"本次执行实际用的提示词"：上游文本节点会覆盖本地 prompt/instruction，
      // 不存的话详情面板就只能显示卡片上当前文本框里的内容，跟实际跑的可能不一致。
      lastPrompt: prompt,
    })
    runningNodeId.value = nodeId

    const count = Math.max(1, Number(node.data?.count) || 1)
    const costs: Array<Cost | undefined> = []
    let storedUrls: string[] = []

    // 拆成两阶段:先把 N 个任务全部 submit 拿到 taskIds → 立刻落库 →
    // 再去并发轮询。这样用户中途刷新 / 切走 / 关页面,
    // resumeIncompleteTasks 也能拿到完整的 taskIds 把多张产物收齐,
    // 不会丢任务。
    // 实时进度：各任务的上游进度汇总后写回节点（单任务时直接反映上游 progress）
    const progressByTask: Record<string, number> = {}
    function emitProgress() {
      const sum = Object.values(progressByTask).reduce((a, b) => a + b, 0)
      updateNodeData(nodeId, { progress: Math.min(99, Math.round(sum / count)) })
    }

    async function pollTask(taskId: string): Promise<{ fileUrls: string[]; cost?: Cost; taskId: string }> {
      let attempts = 0
      while (attempts < POLL_MAX_ATTEMPTS) {
        await sleep(POLL_INTERVAL_MS)
        attempts++
        let polled
        try {
          polled = await adapter.poll(taskId)
        } catch (err: any) {
          // 后端重启 / 502 / 网络中断等瞬时错误：不判失败，继续重试等后端恢复后重新捞回结果
          if (isTransientPollError(err)) continue
          if (attempts > 3) throw err
          continue
        }
        if (polled.status === 'completed') {
          progressByTask[taskId] = 100
          emitProgress()
          return { taskId, fileUrls: outputUrls(polled), cost: polled.cost }
        }
        if (polled.status === 'canceled') throw new RunCanceled()
        if (polled.status === 'failed') {
          throw polled.error ? runFailure(polled.error, taskId) : new Error(t('executor.genFailed'))
        }
        // pending / processing / queued：把上游进度实时写回
        progressByTask[taskId] = Math.min(99, Number(polled.progress) || 0)
        emitProgress()
      }
      throw new Error(t('executor.pollTimeout'))
    }

    try {
      // 把 data: URL 转存成站内文件（只做一次，所有 N 次提交复用）
      for (const u of inputs.imageUrls) {
        storedUrls.push(await ensureStoredUrl(u))
      }

      // 按模型上限截取
      const max = adapter.options.maxReferenceImages
      if (storedUrls.length > max) {
        MessagePlugin.warning(t('executor.refsTruncated', { model: adapter.label, max }))
        storedUrls = storedUrls.slice(0, max)
      }

      // 阶段 1: 并发 submit 拿 taskIds
      const submitParams = {
        prompt,
        imageUrls: storedUrls,
        videoUrls: inputs.videoUrl ? [inputs.videoUrl] : [],
        workflowId: getWorkflowId?.() || undefined,
        nodeId,
        params: {
          resolution: node!.data?.resolution,
          imgMode: node!.data?.imgMode,
          aspectRatio: node!.data?.aspectRatio,
          duration: node!.data?.duration,
        },
      }
      const submitted = await Promise.allSettled(
        Array.from({ length: count }, () => adapter.submit(submitParams))
      )
      const taskIds: string[] = []
      let submitError: string | null = null
      for (const s of submitted) {
        if (s.status === 'fulfilled') taskIds.push(s.value.taskId)
        else if (!submitError) submitError = submitErrorMessage(s.reason)
      }
      if (taskIds.length === 0) {
        throw new Error(submitError || t('executor.submitFailed'))
      }
      // taskIds 立刻落库 —— 用户中途刷新也能恢复所有任务的产物
      // taskId 保留:兼容历史 resumeIncompleteTasks 与详情面板
      // runPending：这批任务还没出结果。重跑时节点上留着上一版的图，
      // 光看「有没有产物」分不出新任务跑完没有，得靠这个标记
      updateNodeData(nodeId, { taskId: taskIds[0], taskIds: [...taskIds], runPending: true })
      // 不等自动保存的去抖：存不上不影响本次运行，只是刷新后接不回来
      void Promise.resolve(persist?.()).catch(() => {})

      // 阶段 2: 并发轮询（进度由 pollTask 内部实时写回）
      const settled = await Promise.allSettled(
        taskIds.map((tid) => pollTask(tid))
      )

      const fileUrls: string[] = []
      let firstError: string | null = null
      let firstErrorRunId = ''
      let canceled = 0
      for (const s of settled) {
        if (s.status === 'fulfilled') {
          fileUrls.push(...s.value.fileUrls)
          costs.push(s.value.cost)
        } else if (s.reason instanceof RunCanceled) {
          canceled++
        } else if (!firstError) {
          firstError = s.reason?.message || String(s.reason || t('executor.genFailed'))
          firstErrorRunId = s.reason?.runId || ''
        }
      }
      const totalCost = sumCosts(costs)

      // 一张没出、且都是被取消的（不是失败）
      if (fileUrls.length === 0 && canceled && !firstError) {
        markCanceled(nodeId)
        return false
      }
      // 全军覆没 —— 标 error
      if (fileUrls.length === 0) {
        updateNodeData(nodeId, {
          status: 'error',
          errorMsg: firstError || t('executor.allFailed'),
          errorRunId: firstErrorRunId,
          cost: totalCost,
          runPending: false,
        })
        return false
      }

      // 部分失败 —— 标 done 但 toast 提示
      if (firstError) {
        const failCount = settled.filter(s => s.status === 'rejected').length - canceled
        MessagePlugin.warning(t('executor.partialFailed', { n: failCount, reason: firstError }))
      }

      const field = adapter.outputType === 'image' ? 'imageUrl' : 'videoUrl'
      const arrField = adapter.outputType === 'image' ? 'imageUrls' : 'videoUrls'
      const first = fileUrls[0]
      updateNodeData(nodeId, {
        status: 'done',
        progress: 100,
        [field]: first,
        [arrField]: fileUrls,
        cost: totalCost,
        errorMsg: '',
        runPending: false,
      })
      pushResult(nodeId, {
        urls: fileUrls,
        cost: totalCost,
        model: modelId,
        prompt,
      })
      propagateResultToOutputs(nodeId, adapter.outputType, first)
      return true
    } catch (err: any) {
      updateNodeData(nodeId, {
        status: 'error',
        errorMsg: submitErrorMessage(err) || t('executor.runFailed'),
        cost: sumCosts(costs),
        runPending: false,
      })
      return false
    } finally {
      if (runningNodeId.value === nodeId) runningNodeId.value = null
    }
  }

  // ============ 视频分析节点执行（自定义提示词，全新接口）============
  // 取上游视频 + 上游文本(作为分析提示词) → 提交自定义分析任务 → 轮询 →
  // 把模型返回的自由文本写入 data.text，作为 text-out 供下游使用。
  async function runAnalysisNode(node: Node): Promise<boolean> {
    const nodeId = node.id
    const inputs = collectInputs(nodeId)
    const videoUrl = inputs.videoUrl
    const promptText = (inputs.text || '').trim()

    if (!videoUrl) {
      updateNodeData(nodeId, { status: 'idle', validationError: t('executor.needVideo'), validationStamp: Date.now() })
      MessagePlugin.error(`[${t('nodes.title.videoAnalysis')}] ${t('executor.needVideo')}`)
      return false
    }
    if (videoUrl.startsWith('data:')) {
      updateNodeData(nodeId, { status: 'error', errorMsg: t('executor.videoNotUploaded') })
      MessagePlugin.error(`[${t('nodes.title.videoAnalysis')}] ${t('executor.videoNotUploaded')}`)
      return false
    }
    if (!promptText) {
      updateNodeData(nodeId, { status: 'idle', validationError: t('executor.needPrompt'), validationStamp: Date.now() })
      MessagePlugin.error(`[${t('nodes.title.videoAnalysis')}] ${t('executor.connectPrompt')}`)
      return false
    }
    const model = resolveChatModel(node, listVideoChatModels())
    if (!model) {
      updateNodeData(nodeId, { status: 'idle', validationError: t('executor.noVideoChatModel'), validationStamp: Date.now() })
      MessagePlugin.error(`[${t('nodes.title.videoAnalysis')}] ${t('executor.noVideoChatModel')}`)
      return false
    }
    if (node.data?.validationError) updateNodeData(nodeId, { validationError: '' })

    updateNodeData(nodeId, { status: 'running', progress: 0, errorMsg: '', errorRunId: '' })
    runningNodeId.value = nodeId
    try {
      // 纯文本模型不带图（节点上已提示）
      const refImageUrls = chatReadsImages(model) ? await collectRefImages(inputs.imageUrls) : []
      const submitRes = await llmApi.create({ model, prompt: promptText, imageUrls: refImageUrls, videoUrl })
      if (submitRes.data.result !== 0) throw new Error(submitRes.data.message || t('executor.submitFailed'))
      const taskId = submitRes.data.data?.taskId
      if (!taskId) throw new Error(t('executor.noRunId'))
      markTextTaskPending(nodeId, taskId)
      return await pollTextTask(nodeId, taskId)
    } catch (err: any) {
      if (err instanceof RunCanceled) { markCanceled(nodeId); return false }
      updateNodeData(nodeId, { status: 'error', errorMsg: submitErrorMessage(err) || t('executor.runFailed'), errorRunId: err?.runId || '', runPending: false })
      return false
    } finally {
      if (runningNodeId.value === nodeId) runningNodeId.value = null
    }
  }

  // ============ 大语言模型节点执行 ============
  // 取上游文本(作为提示词) + 可选上游图片(参考图) → 提交 LLM 任务 → 轮询 →
  // 把模型返回的自由文本写入 data.text，作为 text-out 供下游使用。无视频输入。
  async function runLlmNode(node: Node): Promise<boolean> {
    const nodeId = node.id
    const inputs = collectInputs(nodeId)
    const promptText = (inputs.text || '').trim()

    if (!promptText) {
      updateNodeData(nodeId, { status: 'idle', validationError: t('executor.needPrompt'), validationStamp: Date.now() })
      MessagePlugin.error(`[${t('nodes.title.llm')}] ${t('executor.connectPrompt')}`)
      return false
    }
    const model = resolveChatModel(node)
    if (!model) {
      updateNodeData(nodeId, { status: 'idle', validationError: t('executor.noChatModel'), validationStamp: Date.now() })
      MessagePlugin.error(`[${t('nodes.title.llm')}] ${t('executor.noChatModel')}`)
      return false
    }
    if (node.data?.validationError) updateNodeData(nodeId, { validationError: '' })

    updateNodeData(nodeId, { status: 'running', progress: 0, errorMsg: '', errorRunId: '' })
    runningNodeId.value = nodeId
    try {
      // 纯文本模型不带图：节点上已经说明连着的图片不会发送，这里照着做
      const refImageUrls = chatReadsImages(model) ? await collectRefImages(inputs.imageUrls) : []
      const submitRes = await llmApi.create({
        model,
        prompt: promptText,
        systemPrompt: (node.data?.systemPrompt as string) || undefined,
        imageUrls: refImageUrls,
      })
      if (submitRes.data.result !== 0) throw new Error(submitRes.data.message || t('executor.submitFailed'))
      const taskId = submitRes.data.data?.taskId
      if (!taskId) throw new Error(t('executor.noRunId'))
      markTextTaskPending(nodeId, taskId)
      return await pollTextTask(nodeId, taskId)
    } catch (err: any) {
      if (err instanceof RunCanceled) { markCanceled(nodeId); return false }
      updateNodeData(nodeId, { status: 'error', errorMsg: submitErrorMessage(err) || t('executor.genFailed'), errorRunId: err?.runId || '', runPending: false })
      return false
    } finally {
      if (runningNodeId.value === nodeId) runningNodeId.value = null
    }
  }

  /**
   * 工具节点：切片 / 拼图 / 水印 / 改尺寸。
   *
   * 与生成类节点的区别和一图出全平台一样 —— 没有 taskId（一次请求出结果）、
   * 没有成本（纯本机像素处理）。四个共用这一段，差别只在取什么输入、发哪个接口。
   */
  async function runToolNode(node: Node): Promise<boolean> {
    const nodeId = node.id
    const type = node.type as string
    const d: any = node.data || {}

    // 水印要分辨两个入口，不能走 collectInputs（它把所有图片边并成一个数组）
    const imageEdgesOf = (handle?: string) => edges.value.filter(e =>
      e.target === nodeId
      && getHandleDataType(e.sourceHandle as string) === 'image'
      && (handle ? e.targetHandle === handle : true))
    const urlsOf = (es: any[]) => es.flatMap(e => {
      const s = findNode(e.source); return s ? getImageOutputs(s) : []
    })

    const baseUrls = urlsOf(imageEdgesOf('image-in'))
    // 水印图不走连线，就存在节点自己身上（第一版做成第二个输入口，太难用了）
    const markUrl = String(d.markUrl || '')

    const need = (msg: string) => {
      updateNodeData(nodeId, { status: 'idle', validationError: msg, validationStamp: Date.now() })
      MessagePlugin.error(`[${t(TOOL_LABEL_KEY[type] || 'nodes.title.tool')}] ${msg}`)
      return false
    }
    if (type === COLLAGE_TYPE) {
      if (baseUrls.length < 2) return need(t('executor.needTwoImages'))
    } else if (!baseUrls.length) {
      return need(t('executor.needOneImage'))
    }
    if (type === WATERMARK_TYPE && !markUrl) return need(t('executor.needMarkImage'))
    if ([...baseUrls, markUrl].filter(Boolean).some(u => u.startsWith('data:'))) {
      updateNodeData(nodeId, { status: 'error', errorMsg: t('executor.imageNotUploaded') })
      return false
    }
    if (d.validationError) updateNodeData(nodeId, { validationError: '' })

    updateNodeData(nodeId, { status: 'running', progress: 0, errorMsg: '', errorRunId: '' })
    runningNodeId.value = nodeId
    try {
      let patch: Record<string, any>
      if (type === SLICE_TYPE) {
        const res = await canvasToolApi.slice(baseUrls[0], Number(d.cols) || 3, Number(d.rows) || 3)
        if (res.data.result !== 0) throw new Error(res.data.message || t('executor.sliceFailed'))
        const items = res.data.data?.items || []
        const urls = items.map((i: any) => i.url).filter(Boolean)
        if (!urls.length) throw new Error(t('executor.sliceEmpty'))
        patch = { sliceItems: items, imageUrls: urls, imageUrl: urls[0] }
      } else if (type === COLLAGE_TYPE) {
        const res = await canvasToolApi.collage(baseUrls, {
          cols: Number(d.cols) || 2, rows: Number(d.rows) || 2,
          gap: Number(d.gap) || 0, bg: d.bg || '#ffffff', ratio: d.ratio || '',
        })
        if (res.data.result !== 0) throw new Error(res.data.message || t('executor.collageFailed'))
        const r = res.data.data
        patch = {
          imageUrl: r.url, imageUrls: [r.url], outW: r.width, outH: r.height,
          usedCount: r.used, skippedCount: r.skipped,
        }
      } else if (type === WATERMARK_TYPE) {
        const res = await canvasToolApi.watermark(baseUrls[0], markUrl, {
          position: d.position || 'br', scalePct: Number(d.scalePct) || 20,
          opacity: Number(d.opacity) || 70,
          marginPct: d.marginPct == null ? 3 : Number(d.marginPct),
        })
        if (res.data.result !== 0) throw new Error(res.data.message || t('executor.watermarkFailed'))
        patch = { imageUrl: res.data.data.url, imageUrls: [res.data.data.url] }
      } else {
        const res = await canvasToolApi.fit(baseUrls[0], {
          ratio: d.ratio || '', bg: d.bg || '#ffffff', format: d.format || 'auto',
          quality: Number(d.quality) || 88, maxKb: Number(d.maxKb) || 0,
        })
        if (res.data.result !== 0) throw new Error(res.data.message || t('executor.processFailed'))
        const r = res.data.data
        patch = {
          imageUrl: r.url, imageUrls: [r.url], outW: r.width, outH: r.height,
          bytes: r.bytes, overLimit: !!r.overLimit,
        }
      }
      updateNodeData(nodeId, { status: 'done', progress: 100, errorMsg: '', ...patch })
      if (patch.imageUrl) propagateResultToOutputs(nodeId, 'image', patch.imageUrl)
      return true
    } catch (err: any) {
      updateNodeData(nodeId, {
        status: 'error',
        errorMsg: submitErrorMessage(err) || t('executor.processFailed'),
      })
      return false
    } finally {
      if (runningNodeId.value === nodeId) runningNodeId.value = null
    }
  }

  // ============ 多平台导出 ============
  /**
   * 取上游一张图 → 后端换成各平台主图尺寸 → 结果写回节点。
   *
   * 与生成类节点的三点不同：没有 taskId（一次请求出全部）、没有成本
   * （纯本机像素处理）、产物是一整组而不是一张。
   */
  async function runExportNode(node: Node): Promise<boolean> {
    const nodeId = node.id
    const inputs = collectInputs(nodeId)
    const src = inputs.imageUrls[0]
    if (!src) {
      updateNodeData(nodeId, { status: 'idle', validationError: t('executor.needImage'), validationStamp: Date.now() })
      MessagePlugin.error(`[${t('nodes.title.platformExport')}] ${t('executor.needOneImage')}`)
      return false
    }
    if (src.startsWith('data:')) {
      updateNodeData(nodeId, { status: 'error', errorMsg: t('executor.imageNotUploaded') })
      return false
    }
    if (node.data?.validationError) updateNodeData(nodeId, { validationError: '' })

    updateNodeData(nodeId, { status: 'running', progress: 0, errorMsg: '', errorRunId: '' })
    runningNodeId.value = nodeId
    try {
      const group = node.data?.group === 'overseas' ? 'overseas' : 'domestic'
      const res = await platformExportApi.run(src, group)
      if (res.data.result !== 0) throw new Error(res.data.message || t('executor.exportFailed'))
      const d: any = res.data.data
      const urls: string[] = (d.items || []).map((i: any) => i.url).filter(Boolean)
      if (!urls.length) throw new Error(t('executor.exportEmpty'))
      updateNodeData(nodeId, {
        status: 'done',
        progress: 100,
        imageUrl: urls[0],
        imageUrls: urls,
        exportItems: d.items,
        whiteBgCheck: d.whiteBg || null,
        // 两组各存各的，换组时不互相冲掉（见 platformExportGroups.ts）
        exportByGroup: recordGroupResult(node.data || {}, group, {
          items: d.items,
          whiteBgCheck: d.whiteBg || null,
          urls,
        }),
        errorMsg: '',
      })
      propagateResultToOutputs(nodeId, 'image', urls[0])
      return true
    } catch (err: any) {
      updateNodeData(nodeId, {
        status: 'error',
        errorMsg: submitErrorMessage(err) || t('executor.exportFailed'),
      })
      return false
    } finally {
      if (runningNodeId.value === nodeId) runningNodeId.value = null
    }
  }

  /** 节点选定的对话模型；没选过、或选的那个已经不在清单里，就用清单里的第一个 */
  function resolveChatModel(node: Node, list = listChatModels()): string {
    const chosen = (node.data?.model as string) || ''
    if (chosen && list.some(m => m.id === chosen)) return chosen
    return list[0]?.id || ''
  }

  /** 参考图（可选，最多 5 张，静默截断）：data: URL 先转存，失败的静默跳过 */
  async function collectRefImages(urls: string[]): Promise<string[]> {
    const out: string[] = []
    for (const u of (urls || []).slice(0, 5)) {
      try { out.push(await ensureStoredUrl(u)) } catch { /* 跳过无法上传的参考图 */ }
    }
    return out
  }

  /**
   * 任务号一拿到就落到节点上并立刻存一次（与生成节点同一个道理，见 ExecutorOptions.persist）。
   * runPending：这次任务还没出结果。文本节点跑完后 taskId 一直留着，重跑时节点上也还留着
   * 上一版的文字，刷新后要不要接回来只能靠这个标记判断。
   */
  function markTextTaskPending(nodeId: string, taskId: string) {
    updateNodeData(nodeId, { taskId, runPending: true })
    void Promise.resolve(persist?.()).catch(() => {})
  }

  // 视频分析 / 大语言模型共用：轮询 /api/llm/tasks/:id，succeeded 时把 text 写入 data.text。
  // 沿用瞬时错误重试策略（后端重启 / 502 / 网络中断不判失败）。
  async function pollTextTask(nodeId: string, taskId: string): Promise<boolean> {
    let attempts = 0
    while (attempts < POLL_MAX_ATTEMPTS) {
      await sleep(POLL_INTERVAL_MS)
      attempts++
      let task: LlmTask
      try {
        const r = await llmApi.get(taskId)
        if (r.data.result !== 0 || !r.data.data) throw new Error(r.data.message || t('executor.queryFailed'))
        task = r.data.data
      } catch (err: any) {
        // 后端明确说没有这个任务（记录被清理了）：再问几次也一样，直接判失败
        if (err?.response?.status === 404) throw err
        // 后端重启 / 502 / 网络中断等瞬时错误：不判失败，继续重试等后端恢复
        if (isTransientPollError(err)) continue
        if (attempts > 3) throw err
        continue
      }
      if (task.status === 'succeeded') {
        const text = String(task.text || '').trim()
        if (!text) throw new Error(t('executor.emptyResult'))
        updateNodeData(nodeId, {
          status: 'done',
          progress: 100,
          text,
          cost: task.cost || null,
          errorMsg: '',
          runPending: false,
        })
        return true
      }
      if (task.status === 'canceled') throw new RunCanceled()
      if (task.status === 'failed') {
        throw task.error ? runFailure(task.error, taskId) : new Error(t('executor.genFailed'))
      }
      updateNodeData(nodeId, { progress: Math.min(99, Number(task.progress) || 0) })
    }
    throw new Error(t('executor.pollTimeout'))
  }

  // ============ 取消 ============

  /** 节点这次运行被取消后的样子：不是失败，不留错误信息；上一版结果（如果有）原样留着 */
  function markCanceled(nodeId: string) {
    updateNodeData(nodeId, { status: 'canceled', progress: 0, errorMsg: '', errorRunId: '', runPending: false })
  }

  /**
   * 取消节点正在跑的运行。一个节点可能同时有好几个（「数量」大于 1），全部取消。
   * 这里只负责告诉后端；节点状态由轮询那边收尾 —— 后端把运行标成 canceled，
   * 下一次轮询（最多 POLL_INTERVAL_MS 之后）读到就停，已经出完的那几张照常留下。
   */
  async function cancelNode(nodeId: string): Promise<void> {
    const d = findNode(nodeId)?.data || {}
    if (d.runPending !== true) return
    const ids: string[] = Array.isArray(d.taskIds) && d.taskIds.length ? d.taskIds : (d.taskId ? [d.taskId] : [])
    if (!ids.length) return
    const settled = await Promise.allSettled(ids.map(id => runsApi.cancel(id).then(unwrap)))
    const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
    if (failed && settled.every(s => s.status === 'rejected')) {
      MessagePlugin.error(submitErrorMessage(failed.reason) || t('executor.cancelFailed'))
    }
  }

  /**
   * 把这一轮的产出压进节点的结果历史。
   *
   * 不留历史的话，重跑一次就把 data.imageUrl 直接覆盖了 —— 上一版连同它花掉的成本
   * 一起消失，想对比两次出图只能手动复制节点，而复制出来的节点又不带产物。
   * 新的一版永远排在最前，所以写完 resultIndex 恒为 0。
   */
  function pushResult(nodeId: string, entry: Omit<NodeResultEntry, 'id' | 'at'>) {
    const urls = (entry.urls || []).filter(Boolean)
    if (!urls.length) return
    const node = findNode(nodeId)
    const prev: NodeResultEntry[] = Array.isArray(node?.data?.results) ? node!.data!.results : []
    const rec: NodeResultEntry = {
      id: 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      at: Date.now(),
      ...entry,
      urls,
    }
    updateNodeData(nodeId, {
      results: [rec, ...prev].slice(0, MAX_RESULTS),
      resultIndex: 0,
    })
  }

  // 把生成结果写到所有可达的下游 output 节点（递归穿过 collection/edit 等中转节点）
  function propagateResultToOutputs(sourceId: string, mediaType: 'image' | 'video', fileUrl: string) {
    if (!fileUrl) return
    const field = mediaType === 'image' ? 'imageUrl' : 'videoUrl'
    const visited = new Set<string>()
    function walk(id: string) {
      const outs = edges.value.filter(e => e.source === id)
      for (const e of outs) {
        if (visited.has(e.target)) continue
        visited.add(e.target)
        const target = findNode(e.target)
        if (!target) continue
        if (target.type === NODE_KIND_OUTPUT) {
          updateNodeData(target.id, { [field]: fileUrl, status: 'done' })
        } else {
          // 透传：例如 gen → image-collection → output 也能拿到结果
          walk(target.id)
        }
      }
    }
    walk(sourceId)
  }

  // ============ 拓扑排序 + 子树执行 ============

  // 从 target 开始反向 BFS，收集所有上游 gen 节点
  function topoSortForTarget(targetId: string): string[] {
    const visited = new Set<string>()
    const order: string[] = []

    function dfs(id: string) {
      if (visited.has(id)) return
      visited.add(id)
      const incoming = edges.value.filter(e => e.target === id)
      for (const e of incoming) {
        dfs(e.source)
      }
      const node = findNode(id)
      if (node && (GEN_TYPES.has(node.type as string) || TEXT_OUT_TYPES.has(node.type as string)
        || LOCAL_TYPES.has(node.type as string))) {
        order.push(id)
      }
    }

    dfs(targetId)
    return order
  }

  // 节点是否已有可复用产物：有 imageUrl/videoUrl 且未被标 stale 即视为已就绪。
  // 注意 status 字段不持久化（Canvas.vue 的 RUNTIME_FIELDS 会剥掉），
  // 从数据库加载回来时 status 是 undefined 但产物 URL 还在 —— 此路径靠 URL 兜底。
  function isAlreadyDone(n: Node): boolean {
    const d = n.data || {}
    if (d.status === 'stale') return false
    // 导出节点看的是「那一组尺寸出全了没有」，不是单张 imageUrl
    if (LOCAL_TYPES.has(n.type as string)) {
      return Array.isArray(d.imageUrls) && d.imageUrls.length > 0
    }
    return !!(d.imageUrl || d.videoUrl || (TEXT_OUT_TYPES.has(n.type as string) && d.text))
  }

  // 付费节点（要向上游提交任务的那几类）上是否已经有一份结果。与 isAlreadyDone 不同：
  // 被标成 stale 的结果也算 —— 重跑它一样是在已有结果的节点上再花一次钱。
  function holdsPaidResult(n: Node): boolean {
    const d = n.data || {}
    if (GEN_TYPES.has(n.type as string)) return !!(d.imageUrl || d.videoUrl)
    return TEXT_OUT_TYPES.has(n.type as string) && !!d.text
  }

  // 某节点在「运行集合」内的直接上游 gen/analysis 依赖：
  // 沿入边向上，穿过 image / image-collection / text / video 等中转节点，遇到 gen 节点即算作依赖并停止穿透
  //（该 gen 节点自身的上游由它自己负责）。
  function upstreamGenDeps(nodeId: string): string[] {
    const deps = new Set<string>()
    const visited = new Set<string>()
    function walk(id: string, isStart: boolean) {
      const node = findNode(id)
      if (!node) return
      if (!isStart && (GEN_TYPES.has(node.type as string) || TEXT_OUT_TYPES.has(node.type as string)
        || LOCAL_TYPES.has(node.type as string))) {
        deps.add(id)
        return
      }
      for (const e of edges.value.filter(e => e.target === id)) {
        if (visited.has(e.source)) continue
        visited.add(e.source)
        walk(e.source, false)
      }
    }
    walk(nodeId, true)
    return [...deps]
  }

  // 跑单个节点（带 inflight 去重）：同一节点无论被多少条分支引用，都只跑一次、只计一次费。
  // stack：从本次触发点到 id 的祖先链，用于在「自己这条 DFS 路径」上判环（不是全局共享，
  // 否则两条独立分支同时解析时会把对方正在解析的真实上游误判成环而跳过等待）。
  function ensureNodeRun(id: string, runSet: Set<string>, stack: Set<string>): Promise<boolean> {
    const cached = inflight.get(id)
    if (cached) return cached
    inflightCount.value++
    const p = runNodeWithDeps(id, runSet, stack)
      .catch(() => false)
      .finally(() => { inflight.delete(id); inflightCount.value-- })
    inflight.set(id, p)
    return p
  }

  // 先等本节点在运行集合内的上游依赖完成，再占用并发名额执行。
  async function runNodeWithDeps(id: string, runSet: Set<string>, stack: Set<string>): Promise<boolean> {
    // 1. 依赖：只等「本次也要跑」的上游（已完成/不在集合内的上游产物已就绪，无需等待）。
    //    若某上游已在本条祖先链 stack 上（用户误连成环），跳过对它的等待以断开回边，
    //    避免相互 await 造成死锁、UI 永久卡在「运行中」。
    const nextStack = new Set(stack).add(id)
    const deps = upstreamGenDeps(id).filter(d => d !== id && runSet.has(d) && !stack.has(d))
    const depResults = await Promise.all(deps.map(d => ensureNodeRun(d, runSet, nextStack)))
    if (depResults.some(ok => !ok)) {
      // 上游失败 → 本节点无法执行，撤回排队态；其它独立分支不受影响（失败隔离）
      if (findNode(id)?.data?.status === 'queued') updateNodeData(id, { status: 'idle' })
      return false
    }
    // 2. 占用并发名额后执行；名额在依赖等待期间不占用，最大化并行度
    await acquireSlot()
    try {
      return await runNode(id)
    } finally {
      releaseSlot()
    }
  }

  // 把一组目标 gen/analysis 节点作为一个 DAG 一起跑：
  // 无依赖关系的并发、有依赖的自动排队，整体受 MAX_CONCURRENT 限制。
  // forceId：用户亲手点了运行的那个节点，已有产物也要重跑（否则按钮点了没反应，也攒不出历史版本）
  async function runNodeSet(ids: Iterable<string>, forceId?: string, opts: RunOptions = {}): Promise<void> {
    const runSet = new Set<string>()
    for (const id of ids) {
      const n = findNode(id)
      // 上游已有可复用产物且未过期的节点不重跑
      if (n && (id === forceId || !isAlreadyDone(n))) runSet.add(id)
    }
    if (runSet.size === 0) return
    // 所有运行入口（节点上的运行按钮、成品节点、运行全部）都汇到这里，重跑确认只放这一处：
    // 这一批里已经有结果、又要重新提交到上游的付费节点，合起来只问一次
    if (confirmRerun && !opts.skipRerunConfirm) {
      const reruns = [...runSet].map(findNode).filter((n): n is Node => !!n && holdsPaidResult(n))
      if (reruns.length) {
        const textCount = reruns.filter(n => TEXT_OUT_TYPES.has(n.type as string)).length
        if (!(await confirmRerun({ count: reruns.length, textCount }))) return
      }
    }
    // 标记排队态；已在跑的节点（来自另一条并发分支）不要覆盖它的状态
    for (const id of runSet) {
      if (!inflight.has(id)) updateNodeData(id, { status: 'queued' })
    }
    await Promise.allSettled([...runSet].map(id => ensureNodeRun(id, runSet, new Set())))
  }

  // 运行某个目标（成品，或直接就是 gen 节点）及其所有需要重跑的上游
  async function runSubtree(targetId: string): Promise<void> {
    const plan = topoSortForTarget(targetId)
    const target = findNode(targetId)
    const runnable = !!target && (GEN_TYPES.has(target.type as string) || TEXT_OUT_TYPES.has(target.type as string)
      || LOCAL_TYPES.has(target.type as string))
    if (runnable && !plan.includes(targetId)) plan.push(targetId)
    await runNodeSet(plan, runnable ? targetId : undefined)
  }

  // 运行全部：把所有成品节点的上游合并成一个 DAG 一起跑，共享同一个 MAX_CONCURRENT 名额池
  async function runAll(opts: RunOptions = {}): Promise<void> {
    const outputs = nodes.value.filter(n => n.type === NODE_KIND_OUTPUT)
    if (outputs.length === 0) {
      MessagePlugin.warning(t('executor.noOutputNode'))
      return
    }
    const all: string[] = []
    for (const out of outputs) all.push(...topoSortForTarget(out.id))
    await runNodeSet(all, undefined, opts)
  }

  // ============ 恢复轮询已有 task ============
  // 用于刷新/重进画布后，对节点上已有的 taskId 继续等结果，不重新提交

  async function attachTask(nodeId: string): Promise<boolean> {
    const node = findNode(nodeId)
    if (!node) return false
    if (TEXT_OUT_TYPES.has(node.type as string)) return await attachTextTask(node)
    if (!GEN_TYPES.has(node.type as string)) return false
    // 优先用 taskIds 数组(多任务),回退到单个 taskId(历史数据)
    const stored: string[] = Array.isArray(node.data?.taskIds) && node.data.taskIds.length > 0
      ? node.data.taskIds
      : (node.data?.taskId ? [node.data.taskId] : [])
    if (stored.length === 0) return false
    const modelId = node.data?.model as string
    const adapter = getAdapter(modelId)
    if (!adapter) return false

    updateNodeData(nodeId, { status: 'running', errorMsg: '', errorRunId: '' })

    // 恢复轮询的实时进度：各任务进度汇总写回节点
    const progressByTask: Record<string, number> = {}
    function emitProgress() {
      const sum = Object.values(progressByTask).reduce((a, b) => a + b, 0)
      updateNodeData(nodeId, { progress: Math.min(99, Math.round(sum / stored.length)) })
    }

    // 单 task 轮询;completed → { fileUrls, cost },failed → throw
    async function pollUntilDone(tid: string): Promise<{ fileUrls: string[]; cost?: Cost }> {
      let attempts = 0
      while (attempts < POLL_MAX_ATTEMPTS) {
        await sleep(POLL_INTERVAL_MS)
        attempts++
        let polled
        try {
          polled = await adapter!.poll(tid)
        } catch (err) {
          // 后端重启 / 502 / 网络中断等瞬时错误：不判失败，继续重试等后端恢复后重新捞回结果
          if (isTransientPollError(err)) continue
          if (attempts > 3) throw err
          continue
        }
        if (polled.status === 'completed') {
          progressByTask[tid] = 100
          emitProgress()
          return { fileUrls: outputUrls(polled), cost: polled.cost }
        }
        if (polled.status === 'canceled') throw new RunCanceled()
        if (polled.status === 'failed') {
          throw polled.error ? runFailure(polled.error, tid) : new Error(t('executor.genFailed'))
        }
        // pending / processing / queued：实时写回上游进度
        progressByTask[tid] = Math.min(99, Number(polled.progress) || 0)
        emitProgress()
      }
      throw new Error(t('executor.pollTimeout'))
    }

    try {
      const settled = await Promise.allSettled(stored.map(tid => pollUntilDone(tid)))
      const fileUrls: string[] = []
      const costs: Array<Cost | undefined> = []
      let firstError: string | null = null
      let firstErrorRunId = ''
      let canceled = 0
      for (const s of settled) {
        if (s.status === 'fulfilled') {
          fileUrls.push(...s.value.fileUrls)
          costs.push(s.value.cost)
        } else if (s.reason instanceof RunCanceled) {
          canceled++
        } else if (!firstError) {
          firstError = s.reason?.message || String(s.reason || t('executor.genFailed'))
          firstErrorRunId = s.reason?.runId || ''
        }
      }
      const totalCost = sumCosts(costs) || node.data?.cost || null
      if (fileUrls.length === 0 && canceled && !firstError) {
        markCanceled(nodeId)
        return false
      }
      if (fileUrls.length === 0) {
        updateNodeData(nodeId, {
          status: 'error',
          errorMsg: firstError || t('executor.resumeFailed'),
          errorRunId: firstErrorRunId,
          runPending: false,
        })
        return false
      }
      if (firstError) {
        const failCount = settled.filter(s => s.status === 'rejected').length - canceled
        MessagePlugin.warning(t('executor.partialFailed', { n: failCount, reason: firstError }))
      }
      const field = adapter.outputType === 'image' ? 'imageUrl' : 'videoUrl'
      const arrField = adapter.outputType === 'image' ? 'imageUrls' : 'videoUrls'
      updateNodeData(nodeId, {
        status: 'done',
        progress: 100,
        [field]: fileUrls[0],
        [arrField]: fileUrls,
        cost: totalCost,
        errorMsg: '',
        runPending: false,
      })
      // 刷新前提交、刷新后才回来的那一版同样要进历史，
      // 否则「跑完就刷新」的用法会让历史断档
      pushResult(nodeId, {
        urls: fileUrls,
        cost: totalCost,
        model: (node.data?.model as string) || '',
        prompt: node.data?.lastPrompt || '',
      })
      propagateResultToOutputs(nodeId, adapter.outputType, fileUrls[0])
      return true
    } catch (err: any) {
      updateNodeData(nodeId, {
        status: 'error',
        errorMsg: err?.message || t('executor.resumeFailed'),
        runPending: false,
      })
      return false
    }
  }

  /** 大语言模型 / 视频分析节点：接回刷新前提交的那个任务，只轮询、不重新提交 */
  async function attachTextTask(node: Node): Promise<boolean> {
    const nodeId = node.id
    const taskId = (node.data?.taskId as string) || ''
    if (!taskId) return false
    updateNodeData(nodeId, { status: 'running', progress: 0, errorMsg: '', errorRunId: '' })
    try {
      return await pollTextTask(nodeId, taskId)
    } catch (err: any) {
      if (err instanceof RunCanceled) { markCanceled(nodeId); return false }
      updateNodeData(nodeId, {
        status: 'error',
        errorMsg: submitErrorMessage(err) || t('executor.resumeFailed'),
        errorRunId: err?.runId || '',
        runPending: false,
      })
      return false
    }
  }

  /**
   * 扫描所有 gen 节点和文本任务节点，把刷新前还没出结果的任务并发接回来轮询。
   * 「还没出结果」以 runPending 为准；没有这个标记的老数据按原来的判法：
   * 有 taskId 且无结果、无失败记录。
   */
  function resumeIncompleteTasks() {
    const candidates = nodes.value.filter((n) => {
      const d = n.data || {}
      if (!d.taskId) return false
      // 文本任务节点只认标记：跑完后 taskId 仍留在节点上，文字又可以被用户清空或改写，
      // 按「有任务号、没结果」去猜会把早就结束的任务再取一遍、盖掉用户改过的内容
      if (TEXT_OUT_TYPES.has(n.type as string)) return d.runPending === true
      if (!GEN_TYPES.has(n.type as string)) return false
      if (d.runPending === true) return true
      // 标记明确是「已结束」（成功、失败、取消都会写 false）就不用再猜了
      if (d.runPending === false) return false
      if (d.imageUrl || d.videoUrl) return false
      // 已落库的失败任务不再轮询，直接保留 error 态展示
      if (d.errorMsg) return false
      return true
    })
    for (const n of candidates) {
      attachTask(n.id).catch(() => {})
    }
  }

  /**
   * 失败原因来自后端运行的节点，按当前界面语言把原因重取一遍。
   * 打开画布和切换语言时调用；取不到（运行记录已清理、断网）就保留存着的那句。
   */
  async function refreshRunErrors(): Promise<void> {
    const targets = nodes.value.filter((n) => n.data?.errorMsg && n.data?.errorRunId)
    await Promise.all(targets.map(async (n) => {
      try {
        const id = n.data.errorRunId as string
        const run = TEXT_OUT_TYPES.has(n.type as string) ? unwrap(await llmApi.get(id)) : unwrap(await runsApi.get(id))
        if (run.error && run.error !== n.data.errorMsg) updateNodeData(n.id, { errorMsg: run.error })
      } catch { /* 保留原文 */ }
    }))
  }

  // ============ Stale 传播 ============

  // 找到一个节点的所有下游 gen / output 节点
  function findAllDownstream(nodeId: string): string[] {
    const visited = new Set<string>()
    const result: string[] = []
    function dfs(id: string) {
      const outs = edges.value.filter(e => e.source === id)
      for (const e of outs) {
        if (visited.has(e.target)) continue
        visited.add(e.target)
        result.push(e.target)
        dfs(e.target)
      }
    }
    dfs(nodeId)
    return result
  }

  function markDownstreamStale(nodeId: string) {
    for (const id of findAllDownstream(nodeId)) {
      const n = findNode(id)
      if (!n) continue
      // 只标"已完成"的为 stale，跑过失败的保持 error
      if (n.data?.status === 'done') {
        updateNodeData(id, { status: 'stale' })
      }
    }
  }

  // 监听节点关键字段变化 → 自动 stale 下游
  // 跟踪每个节点上次的"用户可编辑字段"快照
  const snapshot = new Map<string, string>()

  function fingerprintNode(n: Node): string {
    const d = n.data || {}
    // gen 节点的 imageUrl/videoUrl 是**输出结果**，不是用户输入 —
    // 不能纳入指纹，否则跑完一刷新结果会把刚标 done 的下游又打成 stale。
    // 只有 image/image-collection 这种输入节点的 imageUrl(s) 才算用户编辑。
    const isInputNode = n.type === 'image' || n.type === 'image-collection'
    return JSON.stringify({
      text: d.text || '',
      imageUrl: isInputNode ? (d.imageUrl || '') : '',
      // 「视频」源节点的 videoUrl 是用户输入，改了要让下游 stale；
      // video-gen 的 videoUrl 是产物，不计入（否则跑完会把下游打 stale）
      videoUrl: n.type === 'video' ? (d.videoUrl || '') : '',
      imageUrls: isInputNode && Array.isArray(d.imageUrls) ? d.imageUrls : [],
      prompt: d.prompt || '',
      instruction: d.instruction || '',
      model: d.model || '',
      imgMode: d.imgMode || '',
      aspectRatio: d.aspectRatio || '',
      resolution: d.resolution || '',
      duration: d.duration || '',
      count: d.count || '',
      // 多平台导出换组会真的换掉对外输出（两组结果各存各的），
      // 不纳入指纹的话下游还挂着上一组的图，却不会被标 stale。
      group: d.group || '',
    })
  }

  // 输入/连边变化后，对仍有 validationError 的生成节点重新校验，已通过则清掉红边框
  function clearPassedValidations() {
    for (const n of nodes.value) {
      if (!GEN_TYPES.has(n.type as string)) continue
      if (!n.data?.validationError) continue
      const inputs = collectInputs(n.id)
      if (!validateGenNode(n, inputs)) {
        updateNodeData(n.id, { validationError: '' })
      }
    }
  }

  // stale 追踪的重活：对每个节点算指纹（JSON.stringify）比对，变了就把自身/下游标 stale。
  // 拖动节点时 nodes 会每帧变动，若每次都全量算指纹会明显卡顿 ——
  // 因此用防抖把这段挪到「停手后」跑一次；stale 只是视觉提示，200ms 延迟无感。
  function processNodeChanges() {
    staleTimer = null
    const currentNodes = nodes.value
    for (const n of currentNodes) {
      const prev = snapshot.get(n.id)
      const curr = fingerprintNode(n)
      if (prev !== undefined && prev !== curr) {
        // 节点自身的提示词/参数变了 → 自身若已完成也要能重跑（否则被 isAlreadyDone 跳过）
        if (GEN_TYPES.has(n.type as string) && n.data?.status === 'done') {
          updateNodeData(n.id, { status: 'stale' })
        }
        markDownstreamStale(n.id)
      }
      snapshot.set(n.id, curr)
    }
    clearPassedValidations()
    // 清理已删除节点的快照
    const ids = new Set(currentNodes.map(n => n.id))
    for (const k of snapshot.keys()) {
      if (!ids.has(k)) snapshot.delete(k)
    }
  }

  let staleTimer: number | null = null
  watch(
    nodes,
    () => {
      if (staleTimer) clearTimeout(staleTimer)
      staleTimer = window.setTimeout(processNodeChanges, 200)
    },
    { deep: true }
  )

  // 连边变化也会改变上游图片输入，需要重新校验
  watch(edges, () => clearPassedValidations(), { deep: true })

  return {
    running,
    runningNodeId,
    runNode,
    runSubtree,
    runAll,
    attachTask,
    cancelNode,
    resumeIncompleteTasks,
    refreshRunErrors,
    collectImageRefs,
    upstreamText,
    brandKitEffect,
    // 批量运行要在换完素材后立刻作废下游：内部那个 stale watcher 是 200ms
    // 去抖的，等它的话 runAll 会认为下游「已有产物」而整轮跳过
    markDownstreamStale,
  }
}

/** 一次运行的全部产物地址 */
function outputUrls(polled: AdapterPollResult): string[] {
  if (polled.fileUrls?.length) return polled.fileUrls
  return polled.fileUrl ? [polled.fileUrl] : []
}

/** 后端用 HTTP 状态码 + message 报错时，优先取后端给用户看的那句 */
function submitErrorMessage(err: any): string {
  return err?.response?.data?.message || err?.message || (err ? String(err) : '')
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
