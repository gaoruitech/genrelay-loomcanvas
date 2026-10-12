/**
 * 画布编辑器对外的唯一出口。
 *
 * 编辑器（Canvas.vue、执行器、节点、队列、素材 / 模板 / 品牌包弹窗）不直接调 HTTP 接口，
 * 而是调这里；这里再转给当前的「适配器」（embed/types.ts 的 EditorAdapter）：
 *   - 独立应用、整站嵌入：httpAdapterOver(sharedApi) —— 就是原来那批接口；
 *   - 只嵌编辑器：集成方给的适配器（createHttpAdapter / createMemoryAdapter / 自己写的）。
 *
 * 为了不动几十处调用点，这里导出的对象和 utils/api.ts 里的同名、同形：
 * 返回值仍是 `{ data: { result: 0, data } }`，适配器抛的错原样往上抛
 * （HTTP 适配器抛的是 axios 的错，带 response；自己写的适配器抛普通 Error，可以带 status）。
 */
import { shallowRef } from 'vue'
import { sharedApi, unwrap, apiErrorMessage, apiErrorCode, apiErrorData } from './api'
import { localizeTemplates } from './builtinContent'
import { useAppStore } from '@/stores/app'
import { runtime } from '@/embed/runtime'
import { currentEmbed } from '@/embed/context'
import { httpAdapterOver } from '@/embed/httpAdapterCore'
import { migrateDocument } from '@/embed/document'
import type { AdapterCapabilities, EditorAdapter } from '@/embed/types'
import type { ApiResponse, CostEstimate, LlmTask, ModelKind, ModelSpec, Run, RunRequest, UploadedFile } from '@/types'
import type { EstimateRequest, LlmTaskRequest, WorkflowDetail, WorkflowSummary } from './api'

export { unwrap, apiErrorMessage, apiErrorCode, apiErrorData }
export type * from './api'

/** 当前的适配器。没人设过就是「原装后端」那一个 */
export function backend(): EditorAdapter {
  return (runtime.adapter ||= httpAdapterOver(sharedApi, () => runtime.fileBase))
}

type Envelope<T> = { data: ApiResponse<T> }
const ok = <T>(p: Promise<T>): Promise<Envelope<T>> => p.then((data) => ({ data: { result: 0, data } }))

function unsupported(what: string): never {
  throw Object.assign(new Error(`LoomCanvas: the adapter does not provide ${what}`), { status: 501 })
}

/* ---------- 后端的能力（上传上限、上游能不能按地址读文件） ---------- */

const caps = shallowRef<AdapterCapabilities>({})
/** 只嵌编辑器时在挂载那一刻取一次；别的形态用启动信息（见 backendCapabilities 的调用方） */
export async function loadBackendCapabilities(): Promise<void> {
  try { caps.value = (await backend().capabilities?.()) || {} } catch { caps.value = {} }
}
/**
 * 后端的硬限制。只嵌编辑器时问适配器；别的形态启动信息里就有（老版本后端没有这两项，那就是 undefined：不知道就不拦）。
 */
export function backendCapabilities(): AdapterCapabilities {
  if (currentEmbed().mode === 'editor') return caps.value
  const info = useAppStore().bootstrap
  return { maxUploadMb: info?.limits?.maxUploadMb, upstreamByUrl: info?.media?.upstreamByUrl }
}

/* ---------- 画布 ---------- */

export const workflowApi = {
  list: () => ok<WorkflowSummary[]>((async () => {
    const b = backend()
    if (!b.listCanvases) return unsupported('listCanvases')
    return (await b.listCanvases()) as WorkflowSummary[]
  })()),

  detail: (id: string) => ok<WorkflowDetail>((async () => {
    const stored = await backend().loadCanvas(id)
    // 任何版本的文档都先升到当前版本（原装后端已经升过一遍，这里是幂等的）
    const doc = migrateDocument(stored.document)
    const now = new Date().toISOString()
    return {
      id: stored.id || id,
      ...doc,
      legacyLayout: !!doc.legacyLayout,
      createdAt: stored.createdAt || stored.updatedAt || now,
      updatedAt: stored.updatedAt || now,
    } as unknown as WorkflowDetail
  })()),

  update: (id: string, data: { name?: string; nodes?: any[]; edges?: any[]; viewport?: any; settings?: any; brandKitId?: string; legacyLayout?: false }) =>
    ok<{ updatedAt: string }>(backend().saveCanvas(id, data as any)),

  downloadZip: async (id: string, urls?: string[]) => {
    const b = backend()
    if (!b.downloadZip) return unsupported('downloadZip')
    return { data: await b.downloadZip(id, urls) }
  },

  download: async (url: string, filename: string) => {
    const b = backend()
    if (!b.downloadFile) return unsupported('downloadFile')
    return { data: await b.downloadFile(url, filename) }
  },
}

/* ---------- 模型与运行 ---------- */

export const modelsApi = {
  list: (_kind?: ModelKind) => ok<ModelSpec[]>(backend().listModels()),
}

export const runsApi = {
  estimate: (data: EstimateRequest) => ok<CostEstimate>((async () => {
    const b = backend()
    if (!b.estimate) return unsupported('estimate')
    return b.estimate(data)
  })()),
  create: (data: RunRequest) => ok<{ runId: string }>(backend().submitRun(data)),
  get: (id: string) => ok<Run>(backend().getRuns([id]).then((list) => {
    const run = list.find((r) => r.id === id) || list[0]
    if (!run) throw Object.assign(new Error('Run not found'), { status: 404 })
    return run
  })),
  status: (ids: string[]) => ok<Run[]>(backend().getRuns(ids)),
  cancel: (id: string) => ok<null>(backend().cancelRun(id).then(() => null)),
}

export const llmApi = {
  create: (data: LlmTaskRequest) => ok<{ taskId: string }>(backend().submitLlm(data)),
  get: (id: string) => ok<LlmTask>(backend().getLlm(id)),
}

export const filesApi = {
  upload: (file: File | Blob, onProgress?: (pct: number) => void, filename?: string) =>
    ok<UploadedFile>(backend().upload(file, { onProgress, filename })),
  /** 适配器不会转存远程文件时原样用那个地址 */
  fetch: (url: string) => ok<UploadedFile>((async () => {
    const b = backend()
    if (!b.importRemoteFile) return { url, key: url, size: 0, mime: '' }
    return b.importRemoteFile(url)
  })()),
}

/* ---------- 工具节点 ---------- */

function tool(name: 'slice' | 'collage' | 'watermark' | 'fit' | 'platform-export', payload: Record<string, unknown>) {
  return ok<any>((async () => {
    const b = backend()
    if (!b.runTool) return unsupported('runTool')
    return b.runTool(name, payload)
  })())
}

export const canvasToolApi = {
  slice: (imageUrl: string, cols: number, rows: number) => tool('slice', { imageUrl, cols, rows }),
  collage: (imageUrls: string[], opts: Record<string, any>) => tool('collage', { imageUrls, ...opts }),
  watermark: (imageUrl: string, markUrl: string, opts: Record<string, any>) => tool('watermark', { imageUrl, markUrl, ...opts }),
  fit: (imageUrl: string, opts: Record<string, any>) => tool('fit', { imageUrl, ...opts }),
}

export const platformExportApi = {
  run: (imageUrl: string, group: 'domestic' | 'overseas') => tool('platform-export', { imageUrl, group }),
}

/* ---------- 品牌包 / 模板 / 素材 / 分享：适配器里是可选的 ---------- */

function part<K extends 'brandKits' | 'templates' | 'assets' | 'share'>(key: K): NonNullable<EditorAdapter[K]> {
  const p = backend()[key]
  if (!p) return unsupported(key)
  return p as NonNullable<EditorAdapter[K]>
}
/** 同步抛出的「不支持」也变成被拒绝的 Promise，调用点的 try / catch 才接得住 */
const lazy = <T>(fn: () => Promise<T>) => ok<T>((async () => fn())())

export const brandKitApi = {
  list: () => lazy<any>(() => part('brandKits').list()),
  create: (data: any) => lazy<any>(() => part('brandKits').create(data)),
  update: (id: string, data: any) => lazy<any>(() => part('brandKits').update(id, data)),
  remove: (id: string) => lazy<any>(() => part('brandKits').remove(id)),
}

export const canvasTemplateApi = {
  /** 内置模板的标题 / 说明 / 预填提示词换成当前界面语言的写法（见 utils/builtinContent） */
  list: () => lazy<any>(async () => {
    const list = await part('templates').listCanvasTemplates()
    return Array.isArray(list) ? localizeTemplates(list as any[]) : list
  }),
}

export const canvasTextTemplateApi = {
  list: (lang: 'zh' | 'en' = 'zh') => lazy<any>(() => part('templates').listTextTemplates(lang)),
}

export const canvasAssetApi = {
  categories: () => lazy<any>(() => part('assets').categories()),
  list: (params: Record<string, any>) => lazy<any>(() => part('assets').listBuiltin(params)),
}

export const userAssetApi = {
  list: (params: any) => lazy<any>(() => part('assets').listMine(params)),
  create: (data: any) => lazy<any>(() => part('assets').create(data)),
  remove: (id: string) => lazy<any>(() => part('assets').remove(id)),
  registerOutput: (data: any) => lazy<any>(() => part('assets').registerOutput(data)),
}

export const canvasShareApi = {
  publish: (data: { workflowId: string; title?: string; description?: string; expiresInDays?: number }) =>
    lazy<{ id: string; token: string; updated?: boolean; expiresAt?: string | null }>(() => part('share').publish(data)),
  mine: () => lazy<any>(() => part('share').mine()),
  remove: (id: string) => lazy<any>(() => part('share').remove(id)),
  copy: (token: string, name?: string) => lazy<{ workflowId: string }>(() => part('share').copy(token, name)),
}

/** 分享链接的完整地址：适配器自己给，否则按本产品的路由拼 */
export function shareLinkFor(token: string, fallback: string): string {
  try { return backend().share?.linkFor?.(token) || fallback } catch { return fallback }
}

/** 这个功能当前这次挂载开没开（组件之外用；组件里用 useEmbed().features） */
export function featureOn(key: keyof ReturnType<typeof currentEmbed>['features']): boolean {
  return !!currentEmbed().features[key]
}
