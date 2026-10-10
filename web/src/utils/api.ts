import axios from 'axios'
import type {
  ApiResponse, BootstrapInfo, UploadedFile, ModelSpec, ModelKind, CostEstimate, Run, RunRequest,
  LlmTask, Vendor, ProviderInstance, ProviderTestResult, AdminModel, AdminSettings,
  UsageSummaryRow, UsageRecord, StorageStatus, StorageS3Form, StorageTestResult,
} from '@/types'
import { getToken, clearToken } from '@/utils/authToken'
import { localizeTemplates } from '@/utils/builtinContent'
import { currentLocale } from '@/locales'

export type { ApiResponse } from '@/types'

const api = axios.create({
  baseURL: '/api',
  timeout: 320000,
})

api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  // 后端按这个语言给出 message 和运行失败原因（见 docs/architecture.md 第 10 节）
  config.headers['X-Locale'] = currentLocale()
  return config
})

/** 登录失效时的回调，由 stores/app 注册 —— api 层不反向依赖 store */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearToken()
      onUnauthorized?.()
    }
    return Promise.reject(error)
  }
)

export default api

/** 拆统一返回包：result 非 0 抛错，否则给出 data */
export function unwrap<T = any>(res: { data: ApiResponse<T> }): T {
  if (res.data.result !== 0) throw new Error(res.data.message || 'Request failed')
  return res.data.data as T
}

/** 从 axios 错误里取后端给的 message，取不到用 fallback */
export function apiErrorMessage(err: any, fallback: string): string {
  return err?.response?.data?.message || err?.message || fallback
}

// ====================== 基础 ======================

export const appApi = {
  bootstrap: () => api.get<ApiResponse<BootstrapInfo>>('/app/bootstrap'),
}

export const authApi = {
  login: (password: string) => api.post<ApiResponse<{ token: string }>>('/auth/login', { password }),
}

export const filesApi = {
  /** onProgress 给了就回报真实上传进度（0-100）；视频动辄上百 MB，没有进度会以为卡死了 */
  upload: (file: File | Blob, onProgress?: (pct: number) => void, filename?: string) => {
    const fd = new FormData()
    if (filename) fd.append('file', file, filename)
    else fd.append('file', file)
    return api.post<ApiResponse<UploadedFile>>('/files/upload', fd, {
      timeout: 600000,
      onUploadProgress: onProgress
        ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)) }
        : undefined,
    })
  },
  /** 让后端抓取远程地址并转存，返回站内地址 */
  fetch: (url: string) => api.post<ApiResponse<UploadedFile>>('/files/fetch', { url }),
}

// ====================== 模型与运行 ======================

export const modelsApi = {
  list: (kind?: ModelKind) =>
    api.get<ApiResponse<ModelSpec[]>>('/models', { params: kind ? { kind } : undefined }),
}

export interface EstimateRequest {
  model: string
  params?: Record<string, any>
  count?: number
}

export const runsApi = {
  estimate: (data: EstimateRequest) => api.post<ApiResponse<CostEstimate>>('/runs/estimate', data),
  create: (data: RunRequest) => api.post<ApiResponse<{ runId: string }>>('/runs', data),
  get: (id: string) => api.get<ApiResponse<Run>>(`/runs/${encodeURIComponent(id)}`),
  status: (ids: string[]) => api.post<ApiResponse<Run[]>>('/runs/status', { ids }),
  cancel: (id: string) => api.post<ApiResponse>(`/runs/${encodeURIComponent(id)}/cancel`),
}

export interface LlmTaskRequest {
  model: string
  prompt: string
  systemPrompt?: string
  imageUrls?: string[]
  videoUrl?: string
}

export const llmApi = {
  create: (data: LlmTaskRequest) => api.post<ApiResponse<{ taskId: string }>>('/llm/tasks', data),
  get: (id: string) => api.get<ApiResponse<LlmTask>>(`/llm/tasks/${encodeURIComponent(id)}`),
}

// ====================== 管理（设置页） ======================

export const adminApi = {
  vendors: () => api.get<ApiResponse<Vendor[]>>('/admin/vendors'),
  providers: () => api.get<ApiResponse<ProviderInstance[]>>('/admin/providers'),
  createProvider: (data: Record<string, any>) =>
    api.post<ApiResponse<ProviderInstance>>('/admin/providers', data),
  updateProvider: (id: string, data: Record<string, any>) =>
    api.put<ApiResponse<ProviderInstance>>(`/admin/providers/${encodeURIComponent(id)}`, data),
  removeProvider: (id: string) =>
    api.delete<ApiResponse>(`/admin/providers/${encodeURIComponent(id)}`),
  testProvider: (id: string) =>
    api.post<ApiResponse<ProviderTestResult>>(`/admin/providers/${encodeURIComponent(id)}/test`),

  // 自定义模型挂在服务商实例下面；模型名里可能有 : 和 /，要整体编码
  addCustomModel: (providerId: string, data: { model: string; kind: ModelKind; label?: string }) =>
    api.post<ApiResponse<ProviderInstance>>(`/admin/providers/${encodeURIComponent(providerId)}/models`, data),
  updateCustomModel: (providerId: string, model: string, data: { kind?: ModelKind; label?: string }) =>
    api.put<ApiResponse<ProviderInstance>>(`/admin/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(model)}`, data),
  removeCustomModel: (providerId: string, model: string) =>
    api.delete<ApiResponse<ProviderInstance>>(`/admin/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(model)}`),

  models: () => api.get<ApiResponse<AdminModel[]>>('/admin/models'),
  updateModel: (
    modelId: string,
    data: Partial<Pick<AdminModel, 'enabled' | 'label' | 'sort' | 'defaults' | 'pricing'>>,
  ) => api.put<ApiResponse<AdminModel>>(`/admin/models/${encodeURIComponent(modelId)}`, data),

  settings: () => api.get<ApiResponse<AdminSettings>>('/admin/settings'),
  updateSettings: (data: Partial<AdminSettings>) =>
    api.put<ApiResponse<AdminSettings>>('/admin/settings', data),

  storage: () => api.get<ApiResponse<StorageStatus>>('/admin/storage'),
  /** 用还没保存的配置真实读写一遍存储桶；secretAccessKey 留空表示用已保存的那一把 */
  testStorage: (s3: StorageS3Form) =>
    api.post<ApiResponse<StorageTestResult>>('/admin/storage/test', { s3 }),
  /** 保存并立即生效。S3 配置会先测试，没过返回 400（code: storage.save_needs_test，data.test 是测试结果），force 可跳过 */
  saveStorage: (data: { driver: 'local' } | { driver: 's3'; s3: StorageS3Form; force?: boolean }) =>
    api.put<ApiResponse<StorageStatus>>('/admin/storage', data),

  usage: (params: { from?: string; to?: string; groupBy: 'day' | 'model' }) =>
    api.get<ApiResponse<{ items: UsageSummaryRow[] }>>('/admin/usage', { params }),
  usageRecords: (params: { from?: string; to?: string; page?: number; pageSize?: number }) =>
    api.get<ApiResponse<{ list: UsageRecord[]; total: number; page: number; pageSize: number }>>(
      '/admin/usage/records', { params }
    ),
  /**
   * 清掉早于某一刻的用量记录。before 是 `YYYY-MM-DD`（那一天 UTC 零点之前）或完整的 ISO 时间。
   * 只删已结束的（成功 / 失败 / 已取消），排队中和运行中的不动；生成的文件不删。
   */
  clearUsageRecords: (before: string) =>
    api.delete<ApiResponse<{ deleted: number }>>('/admin/usage/records', { params: { before } }),
}

// ====================== 画布 ======================

export interface WorkflowSummary {
  id: string
  name: string
  thumbnail?: string
  thumbnailType?: 'image' | 'video' | ''
  createdAt: string
  updatedAt: string
}

export interface WorkflowDetail extends WorkflowSummary {
  nodes: any[]
  edges: any[]
  viewport: { x: number; y: number; zoom: number }
  /** 画布级设置（背景底色/图案/密度）；老画布没有这个字段 */
  settings?: Record<string, any>
}

export const workflowApi = {
  list: () =>
    api.get<ApiResponse<WorkflowSummary[]>>('/workflow/list'),

  detail: (id: string) =>
    api.get<ApiResponse<WorkflowDetail>>(`/workflow/${id}`),

  create: (data: { name: string; nodes?: any[]; edges?: any[]; viewport?: any; settings?: any }) =>
    api.post<ApiResponse<WorkflowDetail>>('/workflow', data),

  update: (id: string, data: { name?: string; nodes?: any[]; edges?: any[]; viewport?: any; settings?: any }) =>
    api.put<ApiResponse<WorkflowDetail>>(`/workflow/${id}`, data),

  /**
   * 批量打包下载。urls 只是子集筛选，后端会拿它跟画布里实际存在的地址取交集，
   * 传别的域名进去没有任何用处。不传 urls = 整张画布全打包。
   * 打包是串行拉流，超时给到 10 分钟。
   */
  downloadZip: (id: string, urls?: string[]) =>
    api.post(`/workflow/${id}/download-zip`, { urls }, { responseType: 'blob', timeout: 600000 }),

  /** 单个产物下载代理：跨域地址浏览器直接拉会被 CORS 拦，交给后端转一手 */
  download: (url: string, filename: string) =>
    api.post('/workflow/download', { url, filename }, { responseType: 'blob', timeout: 180000 }),

  /** name：副本的名字，由前端按界面语言起；不传时后端用默认名 */
  duplicate: (id: string, name?: string) =>
    api.post<ApiResponse<WorkflowDetail>>(`/workflow/${id}/duplicate`, { name }),

  remove: (id: string) =>
    api.delete<ApiResponse<{ id: string }>>(`/workflow/${id}`),
}

// 分享链接
export interface CanvasShareSummary {
  id: string
  /** 分享链接里的令牌；/share/:token 用它读取 */
  token: string
  workflowId?: string
  title: string
  thumbnail: string
  thumbnailType: 'image' | 'video' | ''
  nodeCount: number
  /** 过期时间；空表示长期有效 */
  expiresAt?: string | null
  revoked?: boolean
  createdAt: string
}

export interface CanvasShareDetail extends CanvasShareSummary {
  description: string
  nodes: any[]
  edges: any[]
  viewport: { x: number; y: number; zoom: number }
  /** 分享时的画布外观快照 */
  settings?: Record<string, any>
}

export const canvasShareApi = {
  /** 只读读取，不需要登录 */
  detail: (token: string) =>
    api.get<ApiResponse<CanvasShareDetail>>(`/canvas-share/${encodeURIComponent(token)}`),

  publish: (data: { workflowId: string; title?: string; description?: string; expiresInDays?: number }) =>
    api.post<ApiResponse<{ id: string; token: string; updated: boolean; expiresAt?: string | null }>>(
      '/canvas-share/publish', data
    ),

  /** name：复制出来的画布叫什么，由前端按界面语言起；不传时后端用默认名 */
  copy: (token: string, name?: string) =>
    api.post<ApiResponse<{ workflowId: string }>>(`/canvas-share/${encodeURIComponent(token)}/copy`, { name }),

  mine: () =>
    api.get<ApiResponse<{ list: CanvasShareSummary[] }>>('/canvas-share/mine'),

  /** 撤销分享链接 */
  remove: (id: string) =>
    api.delete<ApiResponse<{ id: string }>>(`/canvas-share/${encodeURIComponent(id)}`),
}

// 素材库
export interface CanvasAssetCategory {
  code: string
  name: string
  count: number
}

export interface CanvasAssetItem {
  id: string
  name: string
  code: string
  categoryName: string
  nodeType: 'IMAGE' | 'VIDEO'
  mediaUrl: string
  thumbnailUrl: string
  width: number
  height: number
  aspectRatio: string
}

export const canvasAssetApi = {
  categories: () =>
    api.get<ApiResponse<CanvasAssetCategory[]>>('/canvas-asset/categories'),

  list: (params: { code?: string; nodeType?: 'IMAGE' | 'VIDEO'; page?: number; pageSize?: number }) =>
    api.get<ApiResponse<{ list: CanvasAssetItem[]; total: number; page: number; pageSize: number }>>(
      '/canvas-asset/list', { params }
    ),
}

// 「我的资产」库
export const userAssetApi = {
  list: (params: any) => api.get<ApiResponse>('/user-asset/list', { params }),
  create: (data: any) => api.post<ApiResponse>('/user-asset', data),
  registerOutput: (data: any) => api.post<ApiResponse>('/user-asset/register-output', data),
  update: (id: string, data: any) => api.put<ApiResponse>(`/user-asset/${id}`, data),
  remove: (id: string) => api.delete<ApiResponse>(`/user-asset/${id}`),
  deleteFolder: (data: any) => api.post<ApiResponse>('/user-asset/folder/delete', data),
}

export const canvasTemplateApi = {
  /** 内置模板的标题 / 说明 / 预填提示词换成当前界面语言的写法（见 utils/builtinContent） */
  list: async () => {
    const res = await api.get<ApiResponse>('/canvas/templates')
    if (Array.isArray(res.data?.data)) res.data.data = localizeTemplates(res.data.data)
    return res
  },
}

// 多平台导出：本机像素处理（尺寸/白底净化/纯白检测），不调模型
export const platformExportApi = {
  run: (imageUrl: string, group: 'domestic' | 'overseas') =>
    api.post<ApiResponse>('/canvas/platform-export', { imageUrl, group }),
}

// 画布工具节点：切片 / 拼图 / 水印 / 改尺寸。全是本机处理，不调模型
export const canvasToolApi = {
  slice: (imageUrl: string, cols: number, rows: number) =>
    api.post<ApiResponse>('/canvas/tool/slice', { imageUrl, cols, rows }),
  collage: (imageUrls: string[], opts: Record<string, any>) =>
    api.post<ApiResponse>('/canvas/tool/collage', { imageUrls, ...opts }),
  watermark: (imageUrl: string, markUrl: string, opts: Record<string, any>) =>
    api.post<ApiResponse>('/canvas/tool/watermark', { imageUrl, markUrl, ...opts }),
  fit: (imageUrl: string, opts: Record<string, any>) =>
    api.post<ApiResponse>('/canvas/tool/fit', { imageUrl, ...opts }),
}

// 品牌包：一组可复用的出图方向，挂在生成节点上（见 composables/useBrandKits）
export const brandKitApi = {
  list: () => api.get<ApiResponse>('/brand-kits'),
  create: (data: any) => api.post<ApiResponse>('/brand-kits', data),
  update: (id: string, data: any) => api.put<ApiResponse>(`/brand-kits/${id}`, data),
  remove: (id: string) => api.delete<ApiResponse>(`/brand-kits/${id}`),
}

// 文本素材（文本节点一键填入）。lang 默认 zh，可传 en 获取英文原版
export const canvasTextTemplateApi = {
  list: (lang: 'zh' | 'en' = 'zh') =>
    api.get<ApiResponse>('/canvas/text-templates', { params: { lang } }),
}
