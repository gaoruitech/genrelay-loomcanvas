import { computed, inject, onBeforeUnmount, reactive, ref, watch, type ComputedRef, type InjectionKey } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { MessagePlugin } from '@/utils/feedback'
import { CANVAS_BUDGET_KEY, holdBudgetFresh } from '@/composables/canvasBudgetKey'
import { preflight, refusalText, storedRefusal } from '@/utils/budget'
import type { BudgetRefusal } from '@/types'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { useEstimateCost } from '@/composables/useEstimateCost'
import { usePublicUrlNotice } from '@/composables/usePublicUrlNotice'
import { providerMark, storageGo, useRunBlockNotices, type RunNotice } from '@/composables/useStorageNotice'
import { useMentionInput } from '@/composables/useMentionInput'
import { mentionsToDisplay, mentionsToStored, type ImageRef } from '@/composables/canvasImageRefs'
import { CANVAS_NODE_UI_KEY, type GenNodeKind } from '@/composables/nodeLayout'
import { clipLength } from '@/utils/duration'
import {
  defaultModelId, defaultVideoEditModelId, getAdapter, listFlatModels, listFlatVideoEditModels, modelKeyOf, alignParams,
  isFramesModeData, isLastFrameHandle, FIRST_FRAME_HANDLE, LAST_FRAME_HANDLE,
  chatReadsImages, listChatModels, listVideoChatModels, modelTag, type ModelAdapter,
} from '@/utils/canvasModels'
import { capsSummary } from '@/utils/modelCaps'
import { localizedModelDesc } from '@/utils/builtinContent'
import { formatCost, formatEstimate } from '@/utils/cost'
import type { Cost } from '@/types'

/**
 * 一个生成节点的全部状态和动作 —— 与布局无关。
 *
 * 六种节点（图片生成 / 图片编辑 / 视频生成 / 视频编辑 / 大语言模型 / 视频分析）共用这一份；
 * 三种布局的外壳，以及画布上唯一的那条输入条（布局 a）和属性面板（布局 b），读的都是它。
 * 节点和面板各起一份实例：开着 only-render-visible-elements，被选中的节点可能根本没渲染，
 * 面板不能指望节点替它算。两份实例读写的是同一个 node.data，副作用（落默认模型、对齐参数、
 * 预估成本）都是幂等的。
 *
 * 发出去什么仍然只由执行器决定（collectInputs / composeGenRequest），这里一个字都不拼 ——
 * 所以三种布局下同一份节点数据发出去的请求必然一样。
 */

interface KindSpec {
  icon: string
  titleKey: string
  /** 结果是什么 */
  media: 'image' | 'video' | 'text'
  /** 节点自己的提示词存在 data 的哪个字段；文本类节点没有自己的提示词，只吃上游 */
  promptField: 'prompt' | 'instruction' | null
  placeholderKey: string
  /** 提示词这一项在界面上叫什么（图片编辑叫「编辑指令」） */
  promptLabelKey: string
  badgeKey: string
  badgeKind: 'img' | 'vid' | 'chat'
  detailType: string
}

const KINDS: Record<GenNodeKind, KindSpec> = {
  'image-gen': { icon: 'image', titleKey: 'nodes.title.imageGen', media: 'image', promptField: 'prompt', placeholderKey: 'gen.node.imageGenPlaceholder', promptLabelKey: 'nodes.field.prompt', badgeKey: 'gen.node.kindImage', badgeKind: 'img', detailType: 'image-gen' },
  'image-edit': { icon: 'edit', titleKey: 'nodes.title.imageEdit', media: 'image', promptField: 'instruction', placeholderKey: 'gen.node.imageEditPlaceholder', promptLabelKey: 'gen.detail.instruction', badgeKey: 'gen.node.kindImage', badgeKind: 'img', detailType: 'image-edit' },
  'video-gen': { icon: 'video', titleKey: 'nodes.title.videoGen', media: 'video', promptField: 'prompt', placeholderKey: 'gen.node.videoGenPlaceholder', promptLabelKey: 'nodes.field.prompt', badgeKey: 'gen.node.kindVideo', badgeKind: 'vid', detailType: 'video-gen' },
  'video-edit': { icon: 'video', titleKey: 'nodes.title.videoEdit', media: 'video', promptField: 'prompt', placeholderKey: 'gen.node.videoEditPlaceholder', promptLabelKey: 'nodes.field.prompt', badgeKey: 'gen.node.kindVideo', badgeKind: 'vid', detailType: 'video-edit' },
  'llm': { icon: 'chat', titleKey: 'nodes.title.llm', media: 'text', promptField: null, placeholderKey: 'nodeui.llm.placeholder', promptLabelKey: 'nodes.field.prompt', badgeKey: 'gen.node.kindChat', badgeKind: 'chat', detailType: '' },
  'video-analysis': { icon: 'video', titleKey: 'nodes.title.videoAnalysis', media: 'text', promptField: null, placeholderKey: 'nodeui.analysis.placeholder', promptLabelKey: 'nodes.field.prompt', badgeKey: 'gen.node.kindChat', badgeKind: 'chat', detailType: '' },
}

export const PROMPT_MAX = 5000

export interface GenPort {
  id: string
  type: 'target' | 'source'
  /** 数据类型，决定端口颜色 */
  dataType: 'text' | 'image' | 'video'
  cls: string
  label: string
  /** 接了几个；输出口不计 */
  count: number
  /** 「2」或「2/4」；没接是空串 */
  countText: string
  /** 当前模型用不上这个口（纯文本模型的图片口） */
  off: boolean
  connectable: boolean
  title: string
  /** 这个口喂给哪一项：提示词 / 参考素材。布局 c 按它把端口对到字段上 */
  feeds: 'prompt' | 'refs' | 'source' | 'out'
}

export interface GenModelOption { value: string; label: string; desc?: string; tag?: string; icon?: string; modelId?: string }

export interface GenVersion { index: number; n: number; active: boolean; count: number; title: string; thumb: string }

export function useGenNode(opts: {
  kind: GenNodeKind
  id: string
  data: () => Record<string, any>
  /** 分享页的快照：没有画布上下文（没有模型清单、没有执行器），不写任何东西、不发任何请求。挂上之后不会变 */
  readonly?: boolean
}) {
  const { kind, id } = opts
  const readonly = !!opts.readonly
  const spec = KINDS[kind]
  const isText = spec.media === 'text'
  const { t } = useI18n()
  const flow = useVueFlow()
  const executor = readonly ? undefined : inject(CANVAS_EXECUTOR_KEY, undefined)
  // 团队的每月上限（个人空间、只读画布没有）
  const budget = readonly ? undefined : inject(CANVAS_BUDGET_KEY, undefined)
  const ui = readonly ? undefined : inject(CANVAS_NODE_UI_KEY, undefined)
  /**
   * 只看不改：分享页的快照（上面的 readonly），或者编辑器里这张画布现在轮不到我改（别人正在编辑、只有查看权、
   * 丢了锁、宿主要求只读）。后一种是活的 —— 丢了锁的那一刻变成 true，接管之后变回 false，页面不用重新载入。
   * 界面上凡是「做事」的入口都看它：只读时不出现（不是摆着置灰）；看大图、播放、选中复制、展开长文、
   * 切换查看历史版本、下载这些「看」的照常。
   */
  const viewOnly = computed(() => readonly || !!ui?.readOnly.value)
  const data = computed(() => opts.data() || {})
  /** 往节点数据里写的唯一出口：只读时一个字都不写（包括落默认模型、对齐参数、预估成本这些自动的） */
  const patch = (p: Record<string, any>) => { if (!viewOnly.value) flow.updateNodeData(id, p) }
  /**
   * 编辑器自己补的默认值（默认模型、按模型对齐的参数）也只从这一个口写：照样进节点数据、照样会存，
   * 但标明「不是人改的」—— 模型清单来得再晚（人已经点过画布了），也不会让一张没改过的画布跳成「未保存」。
   */
  const fill = (p: Record<string, any>) => {
    if (viewOnly.value) return
    if (ui?.fillDefaults) ui.fillDefaults(id, p)
    else flow.updateNodeData(id, p)
  }

  /* ── 模型 ── */
  const mediaOpts = computed<GenModelOption[]>(() => {
    if (isText || readonly) return []
    if (kind === 'video-edit') return listFlatVideoEditModels()
    return listFlatModels(spec.media as 'image' | 'video')
  })
  const chatOpts = computed<GenModelOption[]>(() => {
    if (!isText || readonly) return []
    if (kind === 'video-analysis') {
      return listVideoChatModels().map(m => ({ value: m.id, label: m.label || m.id, desc: localizedModelDesc(m.id, m.desc), tag: modelTag(m) }))
    }
    // 每行副标题：模型自己的一句话说明 + 它读不读图（「纯文本」/「可读图片，最多 N 张」）
    return listChatModels().map(m => ({
      value: m.id,
      label: m.label || m.id,
      desc: [localizedModelDesc(m.id, m.desc), capsSummary(m)[0]].filter(Boolean).join(' · '),
      tag: modelTag(m),
    }))
  })
  /**
   * 因为价格跑不了的模型（团队设了金额上限、而它没填价格或币种对不上）在清单里标出来。
   * 是哪几个由服务端给（上限答案里的 cannotRun），这里不看价格自己推。
   */
  const modelOpts = computed<GenModelOption[]>(() => {
    // 所属服务商的 Key 解不开了的模型：同样标出来（见 useStorageNotice）
    const list = (isText ? chatOpts.value : mediaOpts.value).map((o) => {
      const mark = providerMark(String(o.modelId || o.value))
      return mark ? { ...o, ...mark } : o
    })
    const blocked = budget?.limits.value?.cannotRun?.models
    if (!blocked?.length) return list
    const currency = budget?.limits.value?.currency || ''
    return list.map((o) => {
      const hit = blocked.find((b) => b.id === String(o.modelId || o.value))
      if (!hit) return o
      const why = hit.reason === 'currency'
        ? t('spaces.refusal.model.currency', { modelCurrency: hit.modelCurrency, currency })
        : t('spaces.refusal.model.unpriced')
      return { ...o, tag: t('spaces.refusal.model.tag'), desc: why }
    })
  })

  const fallbackModel = computed(() => {
    if (readonly) return ''
    if (isText) return ''
    if (kind === 'video-edit') return defaultVideoEditModelId()
    return defaultModelId(spec.media as 'image' | 'video')
  })
  /**
   * 当前生效的模型。
   * 出图 / 出片：节点上存的那个，没存过就用默认的。
   * 文本类：存的那个还在清单里就用它，否则落到第一个（与执行器的回退一致）。
   */
  const currentModel = computed<string>(() => {
    const chosen = (data.value.model as string) || ''
    if (!isText) return chosen || fallbackModel.value
    if (readonly) return chosen
    if (chosen && chatOpts.value.some(o => o.value === chosen)) return chosen
    return chatOpts.value[0]?.value || ''
  })
  const adapter = computed<ModelAdapter | null>(() => (isText || readonly ? null : getAdapter(currentModel.value)))

  const modelValue = computed<string>({
    get: () => (isText ? currentModel.value : modelKeyOf(currentModel.value)),
    set: (key) => {
      if (isText) { patch({ model: String(key) }); return }
      const opt = mediaOpts.value.find(m => m.value === key)
      if (!opt || opt.modelId === data.value.model) return
      // 保留已生成的结果（主图 / 多图 / 成本）用于展示，只换模型并套用新模型的默认参数。
      // 已有产物时标记 stale：否则重新运行会因 isAlreadyDone 命中旧产物而被跳过（换了模型却没重跑）。
      patch({
        ...(getAdapter(opt.modelId || '')?.defaults || {}),
        model: opt.modelId,
        ...(hasResult.value ? { status: 'stale' } : {}),
      })
    },
  })
  // 节点上存的模型已经不在清单里（接入被停用等）时，照样显示它的标识，而不是空白。
  // 只读画布上看的人没有发布者的服务商，显示发布时随快照存下的名字。
  const modelLabel = computed(() => {
    if (readonly) {
      if (!data.value.model) return ''
      const stored = typeof data.value.modelLabel === 'string' ? data.value.modelLabel.trim() : ''
      return stored || t('nodeui.share.modelUnlisted')
    }
    return modelOpts.value.find(m => m.value === modelValue.value)?.label || currentModel.value
  })
  const modelNoneText = computed(() => {
    if (kind === 'llm') return t('executor.noChatModel')
    if (kind === 'video-analysis') return t('executor.noVideoChatModel')
    return t('models.none')
  })

  /* ── 参数（只有出图 / 出片的节点有） ── */
  const aspectRatio = computed<string>({
    get: () => data.value.aspectRatio || '',
    set: (v) => patch({ aspectRatio: v }),
  })
  const resolution = computed<string>({
    get: () => data.value.resolution || (spec.media === 'video' ? adapter.value?.defaults?.resolution : '') || '',
    set: (v) => patch({ resolution: v }),
  })
  const duration = computed<number>({
    get: () => Number(data.value.duration) || adapter.value?.options.fixedDuration || Number(adapter.value?.defaults?.duration) || 0,
    set: (v) => patch({ duration: Number(v) }),
  })
  const count = computed<number>({
    get: () => Number(data.value.count) || 1,
    set: (v) => patch({ count: Number(v) || 1 }),
  })
  const imgModes = computed(() => (kind === 'video-gen' ? adapter.value?.options.imgModes || [] : []))
  const imgMode = computed<string>({
    get: () => data.value.imgMode || adapter.value?.defaults?.imgMode || adapter.value?.options.imgModes?.[0]?.value || '',
    set: (v) => patch({ imgMode: v }),
  })
  // 首尾帧模式：露出「尾帧」输入口。判定走模型表里那一份，跟 Canvas 的连线规则、
  // 执行器的取图规则共用同一个函数，免得三处各判各的、界面和行为对不上
  const isFramesMode = computed(() => kind === 'video-gen' && isFramesModeData(data.value))
  const modeLabel = computed(() => imgModes.value.find(m => m.value === imgMode.value)?.label || '')

  /**
   * 页脚 / 摘要里的那一小段：「自适应 · 1K」「16:9 · 720p · 8s」。
   * 顺序固定是 比例 · 分辨率 · 时长（· 数量）—— 和参数 chip（ImageParamsChip）、属性面板、队列、生成记录同一个顺序，
   * 同一个节点在不同布局、不同页面上读出来的是同一句话。
   */
  const paramsSummary = computed(() => {
    if (isText) return ''
    const d = data.value
    const a = adapter.value
    const parts: string[] = []
    // 只读画布上没有模型清单可查：「auto」这个值自己翻成「自适应」，其余原样显示
    const ratio = a?.options.aspectRatios.find(x => String(x.value) === String(d.aspectRatio))?.label
      || (d.aspectRatio === 'auto' ? t('models.auto') : d.aspectRatio)
    if (ratio) parts.push(String(ratio))
    else if (a) parts.push(t('models.auto'))
    const res = a?.options.resolutions?.find(x => String(x.value) === String(resolution.value))?.label || resolution.value
    if (res) parts.push(String(res))
    if (spec.media === 'video' && duration.value) parts.push(clipLength(duration.value))
    if (count.value > 1) parts.push(`×${count.value}`)
    return parts.join(' · ')
  })

  /* ── 提示词 ── */
  // 首帧 / 尾帧的 @ 在数据里存固定 token，文本框里显示当前语言的名字，切语言不会失效
  const frameTokens = kind === 'video-gen'
  const prompt = computed<string>({
    get: () => {
      if (!spec.promptField) return ''
      const raw = (data.value[spec.promptField] as string) || ''
      return frameTokens ? mentionsToDisplay(raw) : raw
    },
    set: (v) => {
      if (!spec.promptField) return
      patch({ [spec.promptField]: frameTokens ? mentionsToStored(v) : v })
    },
  })
  const hasOwnPrompt = !!spec.promptField
  const systemPrompt = computed<string>({
    get: () => data.value.systemPrompt || '',
    set: (v) => patch({ systemPrompt: v }),
  })

  /* ── 连线 ── */
  const inCount = (handle: string) => flow.edges.value.filter(e => e.target === id && e.targetHandle === handle).length
  const textInCount = computed(() => inCount('text-in'))
  const imageInCount = computed(() => inCount('image-in'))
  const lastInCount = computed(() => inCount(LAST_FRAME_HANDLE))
  const videoInCount = computed(() => inCount('video-in'))

  /**
   * 上游文本节点连进来的提示词，就是执行器会发出去的那一份（多条按顺序拼好）。
   * 连了线、上游有内容时它整段顶替节点自己写的；上游是空的才回退到自己写的。
   */
  const upstreamText = computed(() => (textInCount.value ? executor?.upstreamText(id) || '' : ''))
  const upstream = reactive({
    connected: computed(() => textInCount.value > 0),
    count: textInCount,
    text: upstreamText,
  })
  /** 这次运行真正会用的提示词（带 @ 的原文，没经过翻译），空态占位里显示它的第一行 */
  const effectivePrompt = computed(() => upstreamText.value || prompt.value)

  /* ── 输入图与 @ 指代 ── */
  /**
   * 缩略图条和 @ 候选都读执行器的 collectImageRefs —— 必须和真正送出去的那份
   * 同源，各算各的迟早会漂：界面标「图2」、实际发的是另一张，这种最难查。
   * 只读画布没有执行器，退化成空数组。
   */
  const imageRefs = computed<ImageRef[]>(() => (isText ? [] : executor?.collectImageRefs(id) || []))
  const maxRefs = computed(() => adapter.value?.options.maxReferenceImages || 0)
  const refsReorderable = computed(() => !isFramesMode.value)
  function reorderRefs(keys: string[]) { patch({ imageOrder: keys }) }
  function renameRef({ key, name }: { key: string; name: string }) {
    const names = { ...(data.value.imageNames || {}) } as Record<string, string>
    // 清空就把这一条删掉，别留一堆空字符串在节点数据里
    if (name) names[key] = name
    else delete names[key]
    patch({ imageNames: names })
  }
  const mention = useMentionInput({
    refs: () => imageRefs.value,
    get: () => prompt.value,
    set: (v: string) => { prompt.value = v },
  })

  /* ── 文本类节点 ── */
  // 当前模型读不读图；纯文本模型时图片口关掉，已连着的图片数量用来提示
  const readsImages = computed(() => kind !== 'llm' || !currentModel.value || chatReadsImages(currentModel.value))
  // 已连的文本输入（可多条），按 textOrder 排序，供调序
  const textInputs = computed(() => {
    if (kind !== 'llm') return []
    const es = flow.edges.value.filter(e => e.target === id && e.targetHandle === 'text-in')
    const items = es.map((e) => {
      const src = flow.findNode(e.source)
      const txt = (((src?.data?.text as string) || '')).replace(/\s+/g, ' ').trim()
      return { sourceId: e.source as string, snippet: txt.slice(0, 16) }
    })
    const order = (data.value.textOrder as string[]) || []
    const rank = (sid: string) => { const i = order.indexOf(sid); return i < 0 ? 9999 : i }
    return [...items].sort((a, b) => rank(a.sourceId) - rank(b.sourceId))
  })
  function moveText(idx: number, dir: number) {
    const arr = textInputs.value.map(it => it.sourceId)
    const j = idx + dir
    if (j < 0 || j >= arr.length) return
    const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp
    patch({ textOrder: arr })
  }
  /** 文本类节点的结果，可以手改，作为 text-out 喂给下游 */
  const text = computed<string>({
    get: () => data.value.text || '',
    set: (v) => patch({ text: v }),
  })

  /* ── 端口 ── */
  const ports = computed<GenPort[]>(() => {
    const refsText = (n: number) => (n ? (maxRefs.value ? `${n}/${maxRefs.value}` : String(n)) : '')
    const p = (
      pid: string, type: 'target' | 'source', dataType: GenPort['dataType'], feeds: GenPort['feeds'],
      label: string, n: number, countText: string, title: string, extra: Partial<GenPort> = {},
    ): GenPort => ({
      id: pid, type, dataType, feeds, label, count: n, countText, title,
      cls: `h-${dataType}`, off: false, connectable: true, ...extra,
    })
    const promptPort = p('text-in', 'target', 'text', 'prompt', t(spec.promptLabelKey), textInCount.value,
      textInCount.value ? String(textInCount.value) : '', t(isText ? 'nodeui.llm.textIn' : 'gen.node.promptIn'))
    const refPort = (label: string, title: string) =>
      p('image-in', 'target', 'image', 'refs', label, imageRefs.value.length, refsText(imageRefs.value.length), title)
    const out = (dataType: GenPort['dataType']) => p(`${dataType}-out`, 'source', dataType, 'out', '', 0, '', '')

    if (kind === 'image-gen') return [promptPort, refPort(t('gen.node.refImages'), t('gen.node.imageIn')), out('image')]
    if (kind === 'image-edit') {
      return [
        { ...refPort(t('gen.node.sourceImage'), t('gen.node.imageIn')), feeds: 'source' },
        promptPort,
        out('image'),
      ]
    }
    if (kind === 'video-gen') {
      const frames = isFramesMode.value
      const first = inCount(FIRST_FRAME_HANDLE)
      const list: GenPort[] = [
        promptPort,
        frames
          ? p(FIRST_FRAME_HANDLE, 'target', 'image', 'refs', t('executor.firstFrame'), first, first ? '1' : '', t('gen.node.firstFrameIn'))
          : refPort(t('gen.node.refImages'), t('gen.node.imageIn')),
      ]
      // 首尾帧模式：额外的「尾帧」输入口。id 必须以 -in 结尾 —— Canvas.vue 的 isValidConnection 靠后缀判断连线方向
      if (frames) {
        list.push(p(LAST_FRAME_HANDLE, 'target', 'image', 'refs', t('executor.lastFrame'), lastInCount.value,
          lastInCount.value ? '1' : '', t('gen.node.lastFrameIn'), { cls: 'h-image h-image-last' }))
      }
      list.push(out('video'))
      return list
    }
    if (kind === 'video-edit') {
      return [
        p('video-in', 'target', 'video', 'source', t('gen.node.sourceVideo'), videoInCount.value, videoInCount.value ? '1' : '', t('gen.node.sourceVideo')),
        promptPort,
        refPort(t('gen.node.refImages'), t('gen.node.imageIn')),
        out('video'),
      ]
    }
    if (kind === 'llm') {
      const on = readsImages.value
      return [
        promptPort,
        // 纯文本模型：图片口变灰且不再接受新连线
        p('image-in', 'target', 'image', 'refs', t('gen.node.refImages'), imageInCount.value, imageInCount.value ? String(imageInCount.value) : '',
          on ? t('nodeui.llm.imageIn') : t('nodeui.llm.imageInOff'), { off: !on, connectable: on }),
        out('text'),
      ]
    }
    return [
      p('video-in', 'target', 'video', 'source', t('nodes.title.video'), videoInCount.value, videoInCount.value ? '1' : '', t('nodeui.analysis.videoIn')),
      promptPort,
      p('image-in', 'target', 'image', 'refs', t('gen.node.refImages'), imageInCount.value, imageInCount.value ? String(imageInCount.value) : '', t('nodeui.llm.imageIn')),
      out('text'),
    ]
  })

  /* ── 结果 ── */
  const urlField = spec.media === 'video' ? 'videoUrl' : 'imageUrl'
  const listField = spec.media === 'video' ? 'videoUrls' : 'imageUrls'
  /**
   * 只读时「切换着看」：看哪一版、哪一张只记在画布给的那张表里（节点和它的面板是两份实例，要看同一张），
   * 不写进节点数据 —— 存着的文档一个字节都不变。指的那一版 / 那一张已经不在了（对方重跑、删了）就当没指过。
   */
  const peek = computed(() => {
    const pk = viewOnly.value && !isText ? ui?.peek.get(id) : undefined
    if (!pk) return null
    const list = Array.isArray(data.value.results) ? data.value.results : []
    const hasIndex = typeof pk.resultIndex === 'number' && pk.resultIndex >= 0 && pk.resultIndex < list.length
    const urls: string[] = hasIndex
      ? ((list[pk.resultIndex!]?.urls || []) as string[]).filter(Boolean)
      : (data.value[listField] || [])
    if (hasIndex && !urls.length) return null
    const url = pk.url && urls.includes(pk.url) ? pk.url : hasIndex ? urls[0] : ''
    if (!hasIndex && !url) return null
    return { index: hasIndex ? pk.resultIndex! : -1, urls, url, cost: hasIndex ? (list[pk.resultIndex!]?.cost ?? null) : undefined }
  })
  const mediaUrl = computed<string>(() => (isText ? '' : peek.value?.url || data.value[urlField] || ''))
  const mediaList = computed<string[]>(() => (isText ? [] : peek.value?.urls || data.value[listField] || []))
  const hasResult = computed(() => (isText ? !!data.value.text : !!mediaUrl.value))
  function selectMedia(url: string) {
    if (!url || url === mediaUrl.value) return
    if (viewOnly.value) { ui?.peek.set(id, { ...(ui.peek.get(id) || {}), url }); return }
    patch({ [urlField]: url })
  }
  /** 节点现在给人看的那一份数据（只读时带着「切换着看」的那一版）：任务详情、看大图、下载都读它 */
  const shownData = computed<Record<string, any>>(() => {
    const pk = peek.value
    if (!pk) return data.value
    return {
      ...data.value, [urlField]: pk.url, [listField]: pk.urls,
      ...(pk.index >= 0 ? { resultIndex: pk.index, cost: pk.cost ?? null } : {}),
    }
  })

  /**
   * 历次运行的产物，新的在最前；resultIndex 指向当前展示的是第几版。
   * 历史由执行器在出结果时写进 node.data.results，这里只负责「切换当前展示的是哪一版」。
   * 一版可能有多张（「数量」> 1），所以每条存的是 urls 数组。文本类节点没有历史版本。
   */
  const versions = computed<GenVersion[]>(() => {
    const list = !isText && Array.isArray(data.value.results) ? data.value.results : []
    const i = peek.value && peek.value.index >= 0 ? peek.value.index : Number(data.value.resultIndex)
    const current = Number.isFinite(i) && i >= 0 && i < list.length ? i : 0
    return list.map((r: any, index: number) => {
      const parts: string[] = [index === 0 ? t('gen.history.latestTitle') : t('gen.history.nthTitle', { n: list.length - index })]
      if (r.at) {
        const d = new Date(r.at)
        const pad = (n: number) => String(n).padStart(2, '0')
        parts.push(`${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`)
      }
      const cost = formatCost(r.cost)
      if (cost) parts.push(cost)
      if (r.prompt) parts.push(String(r.prompt).slice(0, 40))
      return {
        index, n: list.length - index, active: index === current,
        count: (r.urls || []).length, title: parts.join(' · '), thumb: (r.urls && r.urls[0]) || '',
      }
    })
  })
  const versionLabel = computed(() => {
    const cur = versions.value.find(v => v.active)
    return cur && hasResult.value ? `v${cur.n}` : ''
  })
  function selectVersion(index: number) {
    const r = (data.value.results || [])[index]
    const urls = ((r?.urls || []) as string[]).filter(Boolean)
    if (!urls.length) return
    if (viewOnly.value) { ui?.peek.set(id, { resultIndex: index, url: urls[0] }); return }
    patch({
      [urlField]: urls[0],
      [listField]: urls,
      // 「实际成本」跟着切换走：这里问的是「这一版花了多少」，不是历次累计。
      cost: r.cost ?? null,
      status: 'done',
      errorMsg: '',
      resultIndex: index,
    })
  }

  /* ── 成本 ── */
  // 预估：按当前参数运行一次要花多少，随模型 / 参数 / 数量实时变；模型没配价格时显示「成本未知」
  const estimateText = computed(() => formatEstimate(data.value.estimatedCost as Cost | null))
  const estimateUnknown = computed(() => !!(data.value.estimatedCost as Cost | null)?.unknown)
  // 文本类节点跑过之后显示这一次的实际成本
  const actualText = computed(() => (isText ? formatCost(data.value.cost as Cost | null) : ''))
  const costText = computed(() => actualText.value || estimateText.value)
  const costIsActual = computed(() => !!actualText.value)
  const costUnknown = computed(() => (actualText.value ? !!(data.value.cost as Cost | null)?.unknown : estimateUnknown.value))

  /* ── 状态 ── */
  const status = computed<string>(() => data.value.status || 'idle')
  const progress = computed<number>(() => data.value.progress || 0)
  const isRunning = computed(() => status.value === 'running' || status.value === 'queued')
  // 任务已经提交到后端、还没出结果时才有东西可取消（排队等上游、正在提交的那一小段没有）
  const canCancel = computed(() => !viewOnly.value && status.value === 'running' && data.value.runPending === true)
  const runningPlainKey = kind === 'llm' ? 'nodeui.llm.statusRunning' : kind === 'video-analysis' ? 'nodeui.analysis.statusRunning' : 'gen.node.runningPlain'
  const statusLabel = computed(() => {
    if (readonly) return ''
    if (status.value === 'stale') return t('nodes.status.stale')
    if (status.value === 'canceled') return t('nodes.status.canceled')
    if (status.value === 'queued') return t('nodes.status.queued')
    if (status.value === 'running') return isText ? t(runningPlainKey) : t('nodes.status.running')
    if (status.value === 'error') return storedRefusal(data.value.refusal) ? t('spaces.refusal.status') : t('nodes.status.error')
    if (status.value === 'done' || hasResult.value) return t('nodes.status.done')
    return ''
  })
  const statusClass = computed(() => {
    if (!statusLabel.value) return ''
    if (status.value === 'error') return 'error'
    if (status.value === 'queued') return 'queued'
    if (status.value === 'running') return 'running'
    if (status.value === 'stale' || status.value === 'canceled') return 'stale'
    return 'done'
  })
  const runningLabel = computed(() => {
    if (status.value === 'queued') return t('nodes.status.queued')
    // 上游报了进度才显示百分比；没报就只说「生成中」，不编数字
    return progress.value ? t('nodes.action.running', { progress: progress.value }) : t(runningPlainKey)
  })
  /** 不带百分比的那半句，百分比另外显示时用 */
  const runningPlain = computed(() => (status.value === 'queued' ? t('nodes.status.queued') : t(runningPlainKey)))
  /** 这次运行是被团队的每月上限拦下的（没有发出去）：是哪一项、数字、找谁，见 BudgetNotice */
  const refusal = computed<BudgetRefusal | null>(() => {
    if (readonly || data.value.validationError || status.value !== 'error') return null
    return storedRefusal(data.value.refusal)
  })
  /** 还没点运行就知道会被拦：上限已经用完，或者当前模型因为价格跑不了（服务端给的答案） */
  const preflightRefusal = computed<BudgetRefusal | null>(() => {
    // 只读的人本来就运行不了：「现在跑会被上限拦下」对他没有意义
    if (viewOnly.value || refusal.value || isRunning.value) return null
    return preflight(budget?.limits.value, currentModel.value)
  })
  const displayError = computed<string>(() => {
    if (readonly) return ''
    if (data.value.validationError) return data.value.validationError
    if (refusal.value) return refusalText(refusal.value).line
    if (isText) return (status.value === 'error' ? data.value.errorMsg : '') || ''
    return data.value.errorMsg || ''
  })
  if (budget) {
    // 上限的答案换了：各节点上记着的「被上限拦下」跟着对一遍 —— 不成立的撤掉，数字变了的换掉（执行器的 syncRefusals，
    // 一次对的是整张画布，包括眼下没渲染的节点；幂等，所以每个实例都调也无妨）
    watch(() => budget.limits.value, (limits) => { executor?.syncRefusals?.(limits) }, { immediate: true })
    // 这个节点正摆着上限的说明（被拦下的那一句，或者运行前的提醒）：让答案跟得上，团长那边一改这里就知道
    let release: (() => void) | null = null
    watch(() => !!(refusal.value || preflightRefusal.value), (on) => {
      if (on && !release) release = holdBudgetFresh(budget)
      else if (!on && release) { release(); release = null }
    }, { immediate: true })
    onBeforeUnmount(() => { release?.(); release = null })
  }
  /** 真的跑了、失败了。被上限拦下的不算：那是「没有运行」 */
  const failed = computed(() => status.value === 'error' && !refusal.value)
  const refused = computed(() => !!refusal.value)
  const runLabel = computed(() => {
    if (kind === 'llm') return t('nodeui.llm.run')
    if (kind === 'video-analysis') return t('nodeui.analysis.run')
    return hasResult.value ? t('gen.node.rerun') : t('nodes.action.run')
  })

  /* ── 运行前就要说的话 ── */
  // 参考素材只能按公网地址交给上游、而实例没有公网地址：运行之前就说明。
  // 品牌包的参考图也是按地址交给上游的，一并算进去
  const publicUrlNotice = isText || readonly
    ? computed(() => '')
    : usePublicUrlNotice(id, adapter as ComputedRef<ModelAdapter | null>, imageRefs, () => executor?.brandKitEffect(id)?.effect.addedImages || [])
  // 现在跑不了的两种情况（见 useStorageNotice）：选的模型所属的服务商 Key 解不开了；存不了新文件（出图 / 出片节点）。
  // 节点上已经显示着同一句失败原因时不重复说
  const blockNotices = readonly
    ? computed<RunNotice[]>(() => [])
    : useRunBlockNotices({ media: !isText, model: () => currentModel.value, shown: () => displayError.value })
  /** 每条说明，和它后面跟着的去处（能自己去改的人才有：超级管理员去「设置 → 存储」，能管服务商的人去「模型管理」） */
  const noticeItems = computed<RunNotice[]>(() => {
    const list: RunNotice[] = []
    // 不是人点的取消：后端说了为什么（发起人被移出团队、账号被停用、团队关了）
    if (status.value === 'canceled' && data.value.cancelNote) list.push({ text: String(data.value.cancelNote), go: null })
    // 下面几条都是「运行之前要知道的」：只读的人运行不了，不说
    if (viewOnly.value) return list
    list.push(...blockNotices.value)
    if (publicUrlNotice.value) list.push({ text: publicUrlNotice.value, go: storageGo() })
    // 纯文本模型却连着图片：说清楚这些图不会发出去
    if (kind === 'llm' && !readsImages.value && imageInCount.value) list.push({ text: t('nodeui.llm.imagesIgnored', { n: imageInCount.value }), go: null })
    return list
  })
  const notices = computed<string[]>(() => noticeItems.value.map(n => n.text))
  const noticeGo = computed(() => noticeItems.value.map(n => n.go))

  /* ── 动作 ── */
  // 已有结果时的重跑确认由执行器统一处理（见 useRerunConfirm），这里只管发起
  async function run() {
    if (!executor || viewOnly.value || isRunning.value) return
    await executor.runSubtree(id)
  }
  function cancel() { if (!viewOnly.value) void executor?.cancelNode(id) }

  /* ── 校验失败时抖一下 ── */
  const shaking = ref(false)
  let shakeTimer: number | null = null

  /* ── 副作用：只读画布一个都不起 ── */
  if (!readonly) {
    if (isText) {
      // 没选过模型时把默认值落到节点上；清单是异步加载的，所以用 watch 而不是只做一次
      // viewOnly 也在监听里：只读时 patch 不写，接管（变回可编辑）的那一刻要补上
      watch([currentModel, viewOnly], ([m]) => { if (m && !data.value.model) fill({ model: m }) }, { immediate: true })
      useEstimateCost(
        computed(() => (currentModel.value && !viewOnly.value ? { model: currentModel.value, count: 1 } : null)),
        (cost) => patch({ estimatedCost: cost }),
      )
    } else {
      // 节点还没选过模型时，把默认模型写进 data —— 执行器只认 data.model
      watch([fallbackModel, viewOnly], ([m]) => { if (m && !data.value.model) fill({ model: m }) }, { immediate: true })
      watch([adapter, viewOnly], ([a]) => {
        if (!a) return
        const p = alignParams(a, data.value)
        if (Object.keys(p).length > 0) fill(p)
      }, { immediate: true })
      useEstimateCost(
        computed(() => {
          // 只估已经写进 data 的模型：执行器提交的也是 data 里那一份
          const d = data.value
          // 只读时不问价：预估是给要运行的人看的，问回来也没处写
          if (viewOnly.value || !d.model || !adapter.value) return null
          const params: Record<string, any> = {}
          if (d.resolution) params.resolution = d.resolution
          if (d.aspectRatio) params.aspectRatio = d.aspectRatio
          if (spec.media === 'video') {
            if (d.duration) params.duration = Number(d.duration)
            if (d.imgMode) params.imgMode = d.imgMode
          }
          return { model: d.model, params, count: count.value }
        }),
        (cost) => patch({ estimatedCost: cost }),
      )
    }

    if (kind === 'video-gen') {
      /**
       * 切模式（或换模型）之后，把已经不成立的连线清掉。
       *
       * 不清会出两种烂摊子：
       *   多图参考 ← 首尾帧：尾帧口没了，可连在它上面的那条边还在 edges 里 —— 画布上是一根
       *     指向虚空的线，运行时还会被执行器当成一张输入图。
       *   首尾帧 ← 多图参考：首帧口在多图模式下能接好几张，切回首尾帧后这些线全堆在「首帧」上，
       *     而首尾帧只认一张，多出来的会把尾帧挤掉。
       *
       * 所以按新模式反过来裁剪，并且明确告诉用户断了几根 —— 连线是用户亲手连的，
       * 悄悄删掉比留着更糟。（节点和面板各有一份实例：先跑的那份删完，后跑的就没有可删的了。）
       */
      watch(isFramesMode, (frames) => {
        // 只读时模式不是我改的（是载入了对方存的新内容）：线是对方的，轮不到这边删
        if (viewOnly.value) return
        const mine = flow.edges.value.filter(e => e.target === id)
        const drop = frames
          ? mine.filter(e => e.targetHandle === FIRST_FRAME_HANDLE).slice(1)
          : mine.filter(e => isLastFrameHandle(e.targetHandle as string))
        if (!drop.length) return
        flow.removeEdges(drop.map(e => e.id))
        MessagePlugin.info(frames
          ? t('gen.node.firstFrameTrimmed', { n: drop.length })
          : t('gen.node.lastFrameDropped', { n: drop.length }))
      })
    }

    // 每次 validationStamp 变化都重启抖动；红边框由 validationError 持续展示
    watch(() => data.value.validationStamp, (val) => {
      if (!val) return
      shaking.value = true
      if (shakeTimer) window.clearTimeout(shakeTimer)
      shakeTimer = window.setTimeout(() => { shaking.value = false; shakeTimer = null }, 1000)
    })
    onBeforeUnmount(() => { if (shakeTimer) window.clearTimeout(shakeTimer) })
  }

  return reactive({
    kind, id, readonly, viewOnly, isText, data, shownData,
    icon: spec.icon,
    media: spec.media,
    detailType: spec.detailType,
    title: computed(() => t(spec.titleKey)),
    promptLabel: computed(() => t(spec.promptLabelKey)),
    placeholder: computed(() => t(spec.placeholderKey)),
    badge: computed(() => t(spec.badgeKey)),
    badgeKind: spec.badgeKind,

    modelOpts, modelValue, modelLabel, modelNoneText, adapter,
    aspectRatio, resolution, duration, count, imgModes, imgMode, isFramesMode, modeLabel, paramsSummary,

    hasOwnPrompt, prompt, systemPrompt, upstream, effectivePrompt,
    imageRefs, maxRefs, refsReorderable, reorderRefs, renameRef, mention,
    readsImages, textInputs, moveText, text,
    ports,

    mediaUrl, mediaList, hasResult, selectMedia, versions, versionLabel, selectVersion,
    estimateText, estimateUnknown, actualText, costText, costIsActual, costUnknown,

    status, progress, isRunning, canCancel, statusLabel, statusClass, runningLabel, runningPlain,
    displayError, failed, refused, refusal, preflightRefusal, budget, runLabel, notices, noticeGo, shaking,
    run, cancel,
  })
}

export type GenNodeState = ReturnType<typeof useGenNode>

/** 节点 / 面板把自己那份状态 provide 出去，字段组件（提示词、模型、参数、运行……）从这里取 */
export const GEN_NODE_KEY: InjectionKey<GenNodeState> = Symbol('gen-node')

export function useGenNodeState(): GenNodeState {
  const g = inject(GEN_NODE_KEY)
  if (!g) throw new Error('gen field used outside a gen node')
  return g
}
