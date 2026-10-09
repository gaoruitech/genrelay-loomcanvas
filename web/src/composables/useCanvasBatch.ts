import { ref, computed, nextTick, type Ref } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { t } from '@/locales'
import { sumCosts } from '@/utils/cost'
import type { Cost } from '@/types'

/**
 * 批量跑：同一张节点图，换 N 份素材各跑一遍。
 *
 * ── 为什么是「换输入重跑」而不是「复制 N 份节点图」 ──────────────
 * 复制是用户现在的土办法，但单画布节点上限 500，一条五节点的链路复制十几次
 * 就撞墙了，而一次要出的往往是几十份素材。所以这里不动画布结构，只把某个
 * 「图片」输入节点当成变量位，逐轮换掉它的图，让下游整条链重跑。
 *
 * ── 为什么能直接复用现有调度 ──────────────────────────────────
 * 执行器本来就有一套完整的东西：改了输入节点会自动把下游标 stale，
 * runAll 会把所有成品节点的上游合成一个 DAG、按 MAX_CONCURRENT 并发跑、
 * 同一上游被多条分支引用时只跑一次也只计一次费。批量这一层只负责
 * 「换图 → 等它跑完 → 把这一轮的产物收走」，一行调度代码都不用重写。
 *
 * ── 说清楚 MVP 的边界 ────────────────────────────────────────
 * 编排在浏览器里，所以页面必须开着；关掉标签页会停在当前轮。
 * 每一轮的产物同时也进了节点的历史版本条（最近 10 版），但整批结果
 * 只活在这次会话里 —— 要做「跑完关机、回来看结果」得把批次落到后端，
 * 那是另一件事。
 */

const GEN_TYPES = new Set(['image-gen', 'image-edit', 'video-gen', 'video-edit'])
const OUTPUT_TYPE = 'output'
/** 与后端 MAX_ZIP_ITEMS 对齐，也是一次批量的理智上限 */
export const MAX_BATCH_SOURCES = 100

export interface BatchSource {
  url: string
  name: string
}

export interface BatchOutput {
  url: string
  kind: 'image' | 'video'
}

export interface BatchItem {
  url: string
  name: string
  status: 'pending' | 'running' | 'done' | 'error'
  outputs: BatchOutput[]
  error: string
  /** 这一轮的实际花费；没跑完或没有记录时为 null */
  cost: Cost | null
}

interface ExecutorLike {
  runAll: (opts?: { skipRerunConfirm?: boolean }) => Promise<void>
  markDownstreamStale: (id: string) => void
}

interface Options {
  nodes: Ref<any[]>
  edges: Ref<any[]>
  updateNodeData: (id: string, patch: Record<string, any>) => void
  executor: ExecutorLike
  /** 开跑前的钩子，画布用它记一笔撤销历史 */
  beforeStart?: () => void
}

/** 节点还没报上价时的占位：按「未知」参与合计，免得总数被报低 */
const UNKNOWN_COST: Cost = { amount: 0, currency: '', unknown: true }

export function useCanvasBatch({ nodes, edges, updateNodeData, executor, beforeStart }: Options) {
  const open = ref(false)
  const varNodeId = ref('')
  const sources = ref<BatchSource[]>([])
  const items = ref<BatchItem[]>([])
  const running = ref(false)
  const stopping = ref(false)
  const currentIndex = ref(0)
  /** 变量位原来那张图，跑完可以一键还原 */
  const originalUrl = ref('')

  /** 能当变量位的节点：画布上的「图片」输入节点 */
  const varCandidates = computed(() =>
    nodes.value.filter((n) => n.type === 'image')
  )

  const outputNodes = computed(() => nodes.value.filter((n) => n.type === OUTPUT_TYPE))

  function findNode(id: string) {
    return nodes.value.find((n) => n.id === id)
  }

  /** 从某节点出发，沿出边收集所有下游节点 id */
  function downstreamIds(id: string): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    const walk = (cur: string) => {
      for (const e of edges.value.filter((x: any) => x.source === cur)) {
        if (seen.has(e.target)) continue
        seen.add(e.target)
        out.push(e.target)
        walk(e.target)
      }
    }
    walk(id)
    return out
  }

  /** 变量位下游会重跑的生成节点 —— 预估和花费统计都按这一组算 */
  const affectedGenNodes = computed(() => {
    if (!varNodeId.value) return []
    return downstreamIds(varNodeId.value)
      .map(findNode)
      .filter((n) => n && GEN_TYPES.has(n.type)) as any[]
  })

  /**
   * 单轮预估：下游各生成节点自己算好的 estimatedCost 之和。
   * 那个数是节点组件按当前模型/参数/数量向 /runs/estimate 问来的，
   * 跟运行按钮旁边显示的是同一个，不另起一套口径。
   * 没有受影响的节点时为 null；有节点还没报上价（或模型没配价格）时整体记为未知。
   */
  const unitCost = computed<Cost | null>(() =>
    sumCosts(affectedGenNodes.value.map((n) => (n.data?.estimatedCost as Cost | null | undefined) || UNKNOWN_COST))
  )
  const totalCost = computed<Cost | null>(() => {
    const unit = unitCost.value
    if (!unit) return null
    return {
      amount: Math.round(unit.amount * sources.value.length * 1e6) / 1e6,
      currency: unit.currency,
      unknown: unit.unknown,
    }
  })
  /** 有节点报不上价时，总价无从算起 —— 界面上要说明原因 */
  const costIsPartial = computed(() => !!unitCost.value?.unknown)

  const doneCount = computed(() => items.value.filter((i) => i.status === 'done').length)
  const failedCount = computed(() => items.value.filter((i) => i.status === 'error').length)
  const spentCost = computed<Cost | null>(() => sumCosts(items.value.map((i) => i.cost)))
  const allOutputs = computed(() => items.value.flatMap((i) => i.outputs))

  function addSources(list: BatchSource[]) {
    const seen = new Set(sources.value.map((s) => s.url))
    const fresh = list.filter((s) => s.url && !seen.has(s.url))
    const room = MAX_BATCH_SOURCES - sources.value.length
    if (fresh.length > room) {
      MessagePlugin.warning(t('dialogs.batch.tooManySources', { max: MAX_BATCH_SOURCES }))
    }
    sources.value = sources.value.concat(fresh.slice(0, Math.max(0, room)))
  }

  function removeSource(url: string) {
    sources.value = sources.value.filter((s) => s.url !== url)
  }

  function clearSources() {
    sources.value = []
  }

  /**
   * 每轮开跑前把成品节点清空。
   *
   * 不清的话，这一轮要是失败了，收结果时读到的还是上一轮留在成品节点上的地址 ——
   * 一次失败会被记成「成功，而且产物跟上一轮一模一样」，比直接报错更难发现。
   */
  function clearOutputs() {
    for (const n of outputNodes.value) {
      updateNodeData(n.id, { imageUrl: '', videoUrl: '', status: 'idle' })
    }
  }

  function collectOutputs(): BatchOutput[] {
    const out: BatchOutput[] = []
    for (const n of outputNodes.value) {
      const d = n.data || {}
      if (d.imageUrl) out.push({ url: d.imageUrl, kind: 'image' })
      if (d.videoUrl) out.push({ url: d.videoUrl, kind: 'video' })
    }
    return out
  }

  /** 这一轮下游哪个生成节点报错了 —— runAll 不抛异常，失败只体现在节点状态上 */
  function roundError(): string {
    for (const n of affectedGenNodes.value) {
      if (n.data?.status === 'error') {
        return n.data?.errorMsg || t('executor.genFailed')
      }
    }
    return ''
  }

  /** 这一轮的实际花费：各生成节点执行器写回的 data.cost 之和 */
  function roundCost(): Cost | null {
    return sumCosts(affectedGenNodes.value.map((n) => n.data?.cost as Cost | null | undefined))
  }

  /** 开跑前的硬校验，全部通过才动手 —— 跑到一半才发现连线不对最浪费钱 */
  function validate(): string {
    if (!varNodeId.value || !findNode(varNodeId.value)) {
      return t('dialogs.batch.needVarNode')
    }
    if (!sources.value.length) return t('dialogs.batch.needSources')
    if (!outputNodes.value.length) {
      return t('dialogs.batch.needOutputNode')
    }
    if (!affectedGenNodes.value.length) {
      return t('dialogs.batch.needGenNode')
    }
    return ''
  }

  async function start() {
    if (running.value) return
    const msg = validate()
    if (msg) { MessagePlugin.warning(msg); return }

    beforeStart?.()

    const varId = varNodeId.value
    originalUrl.value = findNode(varId)?.data?.imageUrl || ''
    items.value = sources.value.map((s) => ({
      url: s.url, name: s.name, status: 'pending', outputs: [], error: '', cost: null,
    }))
    running.value = true
    stopping.value = false
    currentIndex.value = 0

    try {
      for (let i = 0; i < items.value.length; i++) {
        if (stopping.value) break
        currentIndex.value = i
        const it = items.value[i]
        it.status = 'running'
        try {
          clearOutputs()
          // 换素材。执行器自己那套 stale 传播是 200ms 去抖的，等不起 ——
          // 直接把下游标掉，否则 runAll 会认为它们「已有产物」而整轮跳过。
          updateNodeData(varId, { imageUrl: it.url, imageUrls: [it.url] })
          executor.markDownstreamStale(varId)
          // 再按节点兜一道。markDownstreamStale 只标 status==='done' 的，而从库里
          // 加载回来的画布，节点可能带着产物、status 却是空的 —— runAll 会
          // 认为它「已有产物」整轮跳过，于是每一轮都报「没有产出」。
          // 这里不看状态只看节点，同时清掉上一轮的花费，保证每一轮都是真跑、账也只算这一轮的。
          for (const g of affectedGenNodes.value) {
            updateNodeData(g.id, { status: 'stale', cost: null })
          }
          await nextTick()

          // 这一批是用户在批量运行弹窗里亲手发起的，下游刚被标成待更新 —— 不再逐轮弹重跑确认
          await executor.runAll({ skipRerunConfirm: true })

          // 钱已经花了就要记上，哪怕这一轮最后判了失败
          it.cost = roundCost()
          const err = roundError()
          if (err) throw new Error(err)
          const outs = collectOutputs()
          if (!outs.length) throw new Error(t('dialogs.batch.roundEmpty'))
          it.outputs = outs
          it.status = 'done'
        } catch (e: any) {
          it.status = 'error'
          it.error = e?.message || t('dialogs.batch.roundFailed')
        }
      }
    } finally {
      running.value = false
      const stopped = stopping.value
      stopping.value = false
      if (stopped) MessagePlugin.info(t('dialogs.batch.stoppedAt', { n: currentIndex.value + 1 }))
      else if (failedCount.value) {
        MessagePlugin.warning(t('dialogs.batch.finishedMixed', { done: doneCount.value, failed: failedCount.value }))
      } else MessagePlugin.success(t('dialogs.batch.finishedAll', { n: doneCount.value }))
    }
  }

  /** 停：当前这一轮已经提交给上游了，停不掉、费用也已经产生，只能不再往下跑 */
  function stop() {
    if (!running.value) return
    stopping.value = true
  }

  /** 把变量位换回原来那张图。跑完画布上留的是最后一份素材的结果 */
  function restoreVarNode() {
    if (!varNodeId.value || !originalUrl.value) return
    updateNodeData(varNodeId.value, { imageUrl: originalUrl.value, imageUrls: [originalUrl.value] })
    executor.markDownstreamStale(varNodeId.value)
    MessagePlugin.success(t('dialogs.batch.varRestored'))
  }

  function reset() {
    items.value = []
    currentIndex.value = 0
  }

  return {
    open, varNodeId, sources, items, running, stopping, currentIndex,
    varCandidates, affectedGenNodes, outputNodes,
    unitCost, totalCost, costIsPartial,
    doneCount, failedCount, spentCost, allOutputs, originalUrl,
    addSources, removeSource, clearSources,
    validate, start, stop, restoreVarNode, reset,
  }
}

export type CanvasBatch = ReturnType<typeof useCanvasBatch>
