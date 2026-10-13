import { localizedModelDesc } from '@/utils/builtinContent'
import { onSpaceReset, sameSpace, spaceToken } from '@/utils/spaceScope'
import { computed, shallowRef } from 'vue'
import { modelsApi, runsApi, unwrap } from './canvasBackend'
import { i18n, t } from '@/locales'
import { registerThumb } from './canvasMedia'
import { clipLength } from './duration'
import type { Cost, ModelSpec, Run } from '@/types'

export type CanvasMediaType = 'image' | 'video'

export interface ModelOption<T = string> {
  value: T
  label: string
}

export interface ModelOptionsConfig {
  aspectRatios: ModelOption[]
  resolutions?: ModelOption[]
  durations?: ModelOption<number>[]
  /** 只有一种时长的模型：节点不展示时长选择，提交时带这个值 */
  fixedDuration?: number
  /** 图片输入模式：首尾帧 frames / 多图参考 multi。提供则节点显示模式选择 */
  imgModes?: ModelOption[]
  /** 可选生成数量；不提供则节点不展示数量选项（视为 1） */
  counts?: ModelOption<number>[]
  maxReferenceImages: number
}

export interface AdapterParams {
  resolution?: string
  aspectRatio?: string
  duration?: number
  /** 图片输入模式：frames 首尾帧 / multi 多图参考 */
  imgMode?: string
}

export interface AdapterInput {
  prompt: string
  imageUrls: string[]
  videoUrls?: string[]
  params: AdapterParams
  /** 用量归属，可选 */
  workflowId?: string
  nodeId?: string
}

export interface AdapterTask {
  taskId: string
}

export interface AdapterPollResult {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'canceled'
  progress: number
  fileUrl?: string
  /** 一次运行的全部产物（多数模型只有一个） */
  fileUrls?: string[]
  error?: string
  cost?: Cost
}

export interface ModelAdapter {
  /** 模型标识，形如 `<接入>:<模型>`，写入 node.data.model */
  id: string
  label: string
  outputType: CanvasMediaType
  acceptsImage: boolean
  /** 是否支持「视频」输入（参考视频 / 视频转视频） */
  acceptsVideo?: boolean
  /** 是否为「视频编辑」节点可选模型；这类模型不进「视频生成」的下拉 */
  videoEdit?: boolean
  options: ModelOptionsConfig
  /** 切换到该模型时，为节点 data 应用的默认参数（不含 prompt） */
  defaults: Record<string, any>
  /** 后端给的原始声明 */
  spec: ModelSpec
  submit(input: AdapterInput): Promise<AdapterTask>
  poll(taskId: string): Promise<AdapterPollResult>
}

// ====================== 模型清单缓存 ======================

/**
 * 全部已启用模型的声明，来自 GET /api/models。
 * 应用启动时加载一次；设置页改了接入或模型后调 loadModels() 刷新。
 */
const specs = shallowRef<ModelSpec[]>([])
const loaded = shallowRef(false)

export async function loadModels(): Promise<ModelSpec[]> {
  // 模型清单是按空间的：发出去之后换了空间，这一份就不是现在这个空间的了
  const token = spaceToken()
  const list = unwrap(await modelsApi.list())
  if (!sameSpace(token)) return specs.value
  specs.value = Array.isArray(list) ? list : []
  loaded.value = true
  return specs.value
}
// 换空间的那一刻清空：新空间的清单取回来之前，画布上不会出现上一个空间的模型
onSpaceReset(() => { specs.value = []; loaded.value = false })

export function modelsLoaded(): boolean {
  return loaded.value
}

/**
 * 模型下拉里每一行右侧的标签。模型自己带标签的用它的；否则，当清单里不止一家服务商时
 * 标上服务商实例的名字 —— 不同服务商会有同名的模型（比如两家都有 Nano Banana 2.1），
 * 只看名字分不出是哪一家的。
 */
const multiProvider = computed(() => new Set(specs.value.map(s => s.providerId)).size > 1)
export function modelTag(spec: ModelSpec): string | undefined {
  return spec.tag || (multiProvider.value ? spec.providerName || undefined : undefined)
}

/** 对话类模型（大语言模型节点、视频分析节点用） */
export function listChatModels(): ModelSpec[] {
  return specs.value.filter(s => s.kind === 'chat')
}

/**
 * 这个对话模型读不读图片。纯文本模型（acceptsImage 为假）不能收图：节点据此关掉图片
 * 输入口并提示，执行器据此不带图提交 —— 后端对带图的纯文本模型请求是直接拒绝的。
 * 清单里找不到的模型按「读」处理，交给后端去判。
 */
export function chatReadsImages(modelId: string): boolean {
  const spec = specs.value.find(s => s.id === modelId && s.kind === 'chat')
  return spec ? spec.acceptsImage === true && (Number(spec.maxReferenceImages) || 0) > 0 : true
}

/** 能读视频的对话类模型（视频分析节点用）：不是每个对话模型都收视频，后端对不收的会直接拒绝 */
export function listVideoChatModels(): ModelSpec[] {
  return listChatModels().filter(s => s.acceptsVideo === true)
}

// ====================== 通用适配器 ======================

function runToPollResult(run: Run): AdapterPollResult {
  const outputs = Array.isArray(run.outputs) ? run.outputs : []
  for (const o of outputs) registerThumb(o.url, o.thumbnailUrl)
  const progress = Number(run.progress) || 0
  switch (run.status) {
    case 'succeeded':
      return {
        status: 'completed',
        progress: 100,
        fileUrl: outputs[0]?.url,
        fileUrls: outputs.map(o => o.url).filter(Boolean),
        cost: run.cost,
      }
    case 'failed':
      return { status: 'failed', progress, error: run.error || '', cost: run.cost }
    case 'canceled':
      // 不是人点的取消（发起人被移出团队、账号被停用、团队关了）带着原因；人点的不带
      return { status: 'canceled', progress, cost: run.cost, error: run.errorCode && run.errorCode !== 'run.canceled' ? run.error || '' : '' }
    case 'queued':
      return { status: 'pending', progress }
    default:
      // running / archiving
      return { status: 'processing', progress }
  }
}

function optionLabel(kind: 'aspect' | 'duration' | 'imgMode', v: string | number): string {
  if (kind === 'aspect' && v === 'auto') return t('models.auto')
  // 片长每一档的叫法和节点摘要、队列、生成记录是同一份（utils/duration.ts）
  if (kind === 'duration') return clipLength(v) || String(v)
  if (kind === 'imgMode') {
    if (v === 'frames') return t('models.imgModeFrames')
    if (v === 'multi') return t('models.imgModeMulti')
  }
  return String(v)
}

/** 唯一的适配器实现：提交走 POST /api/runs，轮询走 GET /api/runs/:id */
function buildAdapter(spec: ModelSpec): ModelAdapter {
  const o = spec.options || {}
  const durations = Array.isArray(o.durations) ? o.durations : []
  const options: ModelOptionsConfig = {
    aspectRatios: (o.aspectRatios || []).map(v => ({ value: v, label: optionLabel('aspect', v) })),
    maxReferenceImages: Math.max(0, Number(spec.maxReferenceImages) || 0) || (spec.acceptsImage ? 1 : 0),
  }
  if (o.resolutions?.length) options.resolutions = o.resolutions.map(v => ({ value: v, label: v }))
  if (durations.length > 1) options.durations = durations.map(v => ({ value: v, label: optionLabel('duration', v) }))
  else if (durations.length === 1) options.fixedDuration = durations[0]
  if (o.counts?.length) options.counts = o.counts.map(v => ({ value: v, label: String(v) }))
  if (o.imgModes?.length) options.imgModes = o.imgModes.map(v => ({ value: v, label: optionLabel('imgMode', v) }))

  const defaults: Record<string, any> = { ...(spec.defaults || {}) }
  if (options.fixedDuration && defaults.duration === undefined) defaults.duration = options.fixedDuration

  return {
    id: spec.id,
    label: spec.label || spec.id,
    outputType: spec.kind === 'video' ? 'video' : 'image',
    acceptsImage: !!spec.acceptsImage,
    acceptsVideo: !!spec.acceptsVideo,
    videoEdit: !!spec.videoEdit,
    options,
    defaults,
    spec,
    async submit({ prompt, imageUrls, videoUrls, params, workflowId, nodeId }) {
      const clean: Record<string, any> = {}
      for (const [k, v] of Object.entries(params || {})) {
        if (v !== undefined && v !== null && v !== '') clean[k] = v
      }
      if (clean.duration !== undefined) clean.duration = Number(clean.duration)
      const data = unwrap(await runsApi.create({
        model: spec.id,
        prompt,
        imageUrls,
        videoUrls: videoUrls && videoUrls.length ? videoUrls : undefined,
        params: clean,
        workflowId: workflowId || undefined,
        nodeId: nodeId || undefined,
      }))
      if (!data?.runId) throw new Error(t('executor.noRunId'))
      return { taskId: data.runId }
    },
    async poll(taskId) {
      return runToPollResult(unwrap(await runsApi.get(taskId)))
    },
  }
}

/**
 * 适配器表。依赖模型清单和当前语言 —— 选项标签（「自适应」「5 秒」）是本地化的，
 * 切语言后要重建。
 */
const adapters = computed<Record<string, ModelAdapter>>(() => {
  void i18n.global.locale.value
  const out: Record<string, ModelAdapter> = {}
  for (const s of specs.value) {
    if (s.kind === 'image' || s.kind === 'video') out[s.id] = buildAdapter(s)
  }
  return out
})

export function getAdapter(modelId: string): ModelAdapter | null {
  return adapters.value[modelId] || null
}

export function isModelSupported(modelId: string): boolean {
  return modelId in adapters.value
}

/**
 * 让节点参数跟模型声明对齐：没设过的取模型默认值；模型不支持的值回落到默认值或
 * 第一个可选项；模型压根没有的那一项清掉。时长例外：存着的秒数已经不提供时，取最接近
 * 的那一档（一样近取短的），和后端 gaorui.js 的 nearestDuration 同一个规则 ——
 * 存着 6 秒的 Omni Flash 变 8 秒，存着 4 秒的 Grok Video 1.5 变 6 秒。
 *
 * 执行器是直接拿 data 里的参数去提交的 —— 换模型后留着上一个模型的分辨率、数量，
 * 界面上已经没有对应的选项，用户看不见也改不了，却照样会被送出去。
 */
export function alignParams(a: ModelAdapter, data: Record<string, any>): Record<string, any> {
  const o = a.options
  const lists: Record<string, ModelOption<any>[] | undefined> = {
    resolution: o.resolutions,
    aspectRatio: o.aspectRatios,
    duration: o.durations,
    imgMode: o.imgModes,
    count: o.counts,
  }
  const patch: Record<string, any> = {}
  for (const [k, v] of Object.entries(a.defaults)) {
    if (data[k] === undefined) patch[k] = v
  }
  for (const [k, list] of Object.entries(lists)) {
    const cur = k in patch ? patch[k] : data[k]
    const def = a.defaults[k]
    const has = (v: any) => !!list?.some(x => String(x.value) === String(v))
    let next = cur
    if (list?.length) {
      if (!has(cur)) {
        const n = Number(cur)
        if (k === 'duration' && cur !== undefined && cur !== null && cur !== '' && Number.isFinite(n) && n > 0) {
          next = list.map(x => Number(x.value)).reduce((best, d) => (Math.abs(d - n) < Math.abs(best - n) ? d : best))
        } else {
          next = has(def) ? def : list[0].value
        }
      }
    } else {
      next = k === 'duration' && o.fixedDuration ? o.fixedDuration : def
    }
    if (next !== cur) patch[k] = next
  }
  return patch
}

/** 通用模型下拉用：不含「视频编辑」专用模型 */
export function listAdapters(outputType?: CanvasMediaType): ModelAdapter[] {
  const all = Object.values(adapters.value).filter(a => !a.videoEdit)
  return outputType ? all.filter(a => a.outputType === outputType) : all
}

/** 视频编辑节点可选模型（ModelSpec.videoEdit 为真的） */
export function listVideoEditAdapters(): ModelAdapter[] {
  return Object.values(adapters.value).filter(a => a.videoEdit)
}

/** 新建节点时的默认模型：该类型的第一个；一个都没有返回空串 */
export function defaultModelId(outputType: CanvasMediaType): string {
  return listAdapters(outputType)[0]?.id || ''
}

export function defaultVideoEditModelId(): string {
  return listVideoEditAdapters()[0]?.id || ''
}

/**
 * 一个生成节点眼下会用哪个模型：节点上存的那个；没存过（或者文本类存的那个已经不在清单里）就是它会落到的默认模型。
 * 和节点自己显示的（useGenNode 的 currentModel）、执行器真正提交的（resolveChatModel）是同一条规则。
 * 运行之前要按模型判断的地方（每月上限的预检）用它 —— 只看 data.model 的话，「用默认模型」的节点会被漏掉。
 */
export function effectiveModelId(type: string, data: { model?: unknown } | null | undefined): string {
  const chosen = typeof data?.model === 'string' ? data.model : ''
  if (type === 'llm' || type === 'video-analysis') {
    const list = type === 'video-analysis' ? listVideoChatModels() : listChatModels()
    return chosen && list.some(m => m.id === chosen) ? chosen : list[0]?.id || ''
  }
  if (chosen) return chosen
  if (type === 'video-edit') return defaultVideoEditModelId()
  return defaultModelId(type === 'video-gen' ? 'video' : 'image')
}

export interface FlatModelOption extends ModelOption {
  /** 适配器 id（写入 node.data.model） */
  modelId: string
  /** 下拉行的副标题描述 */
  desc?: string
  /** 下拉行右侧标签（如「推荐」） */
  tag?: string
  /** 下拉行左侧图标（完整 <svg> 字符串，用 currentColor 着色） */
  icon?: string
}

// 模型行图标（monochrome，跟随文字色）
const ICON_IMG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="8.5" cy="8.5" r="1.6"/><polyline points="21 15 16 10 5 21"/></svg>'
const ICON_FILM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><line x1="8" y1="4" x2="8" y2="20"/><line x1="16" y1="4" x2="16" y2="20"/><line x1="3" y1="12" x2="21" y2="12"/></svg>'

function toFlat(a: ModelAdapter): FlatModelOption {
  return {
    value: modelKeyOf(a.id),
    label: a.label,
    modelId: a.id,
    desc: localizedModelDesc(a.id, a.spec.desc),
    tag: modelTag(a.spec),
    icon: a.outputType === 'video' ? ICON_FILM : ICON_IMG,
  }
}

/** 下拉选项的 value。每个模型是平铺的一项，形如 `gaorui:nano-banana-2.1::` */
export function modelKeyOf(modelId?: string | null): string {
  return `${modelId || ''}::`
}

/** 模型下拉：每个 ModelSpec 一项 */
export function listFlatModels(outputType: CanvasMediaType): FlatModelOption[] {
  return listAdapters(outputType).map(toFlat)
}

/** 视频编辑节点的模型下拉 */
export function listFlatVideoEditModels(): FlatModelOption[] {
  return listVideoEditAdapters().map(toFlat)
}

/* ── 视频生成节点的图片输入端口 ────────────────────────────────────────
   端口 id 必须以 -in 结尾：Canvas.vue 的 isValidConnection 靠这个后缀判方向。

   这三样放在模型表里而不是各写各的，是因为「当前是不是首尾帧模式」有三个地方
   要问：节点（决定露不露尾帧口）、Canvas（决定首帧口收几条线）、执行器（决定
   送几张图）。三份判定只要有一份跟另外两份错开，界面和行为就会打架。 */
export const FIRST_FRAME_HANDLE = 'image-in'
export const LAST_FRAME_HANDLE = 'image-last-in'

/** 是不是「尾帧」口 */
export function isLastFrameHandle(handleId?: string | null): boolean {
  return !!handleId?.startsWith('image-last')
}

/**
 * 这个视频生成节点当前是不是「首尾帧」模式。
 *
 * 节点上的 imgMode 可能压根没存过（新建节点没动过那个开关），这时要落到模型的
 * 默认值上。模型本身没有模式开关的一律不算首尾帧，哪怕 data 里残留着 imgMode。
 */
export function isFramesModeData(data: any): boolean {
  const a = getAdapter(data?.model || '')
  if (!a?.options?.imgModes) return false
  return (data?.imgMode || a.defaults?.imgMode || a.options.imgModes[0]?.value) === 'frames'
}
