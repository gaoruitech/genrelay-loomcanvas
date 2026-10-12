import axios, { type AxiosInstance } from 'axios'
import type { ApiResponse, BootstrapInfo, UploadedFile, ModelSpec, ModelKind, CostEstimate, Run, RunRequest, LlmTask, Vendor, ProviderInstance, ProviderTestResult, AdminModel, AdminSettings, UsageSummaryRow, UsageRecord, StorageStatus, StorageS3Form, StorageTestResult, User, AdminUser, AuthSession, SiteSettings, RunStatus, UserPrefs } from '@/types'
import { getToken, clearToken } from '@/utils/authToken'
import { localizeTemplates } from '@/utils/builtinContent'
import { currentLocale } from '@/locales'
import { runtime } from '@/embed/runtime'
import type { GetAuth } from '@/embed/types'

export type { ApiResponse } from '@/types'

export interface HttpClientOptions {
  /** 接口的根地址，每次请求时现取（集成方可以在挂载时改） */
  apiBase: () => string
  /** 宿主自己的认证：每次请求时取一组请求头。给了就不再带本产品自己的登录令牌 */
  getAuth?: () => GetAuth | null
  /** 没有 getAuth 时带的登录令牌 */
  getToken?: () => string
  locale?: () => string
  timeoutMs?: number
  /** 401（登录、注册接口自己的不算） */
  onUnauthorized?: () => void
  /** 403 auth.password_change_required */
  onPasswordChangeRequired?: () => void
}

/**
 * 建一个 axios 实例：根地址、认证头、语言头都在每次请求时现取。
 * 独立应用和整站嵌入共用下面那一个；createHttpAdapter 给每个适配器各建一个。
 */
export function createHttpClient(opts: HttpClientOptions): AxiosInstance {
  const http = axios.create({ timeout: opts.timeoutMs ?? 320000 })
  http.interceptors.request.use(async (config) => {
    config.baseURL = opts.apiBase()
    const getAuth = opts.getAuth?.()
    if (getAuth) {
      const headers = await getAuth()
      for (const [k, v] of Object.entries(headers || {})) if (v != null && v !== '') config.headers[k] = String(v)
    } else {
      const token = opts.getToken?.()
      if (token) config.headers.Authorization = `Bearer ${token}`
    }
    // 后端按这个语言给出 message 和运行失败原因（见 docs/architecture.md 第 10 节）
    config.headers['X-Locale'] = (opts.locale || currentLocale)()
    return config
  })
  http.interceptors.response.use(
    (response) => response,
    (error) => {
      // 任何接口回 403 auth.password_change_required：这个账号得先换掉临时密码（比如开着页面时被超级管理员重置了）
      if (error.response?.status === 403 && error.response?.data?.code === 'auth.password_change_required') {
        opts.onPasswordChangeRequired?.()
      }
      // 登录接口自己的 401（账号或密码不对）不算「登录失效」
      const url = String(error.config?.url || '')
      if (error.response?.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/auth/register')) {
        opts.onUnauthorized?.()
      }
      return Promise.reject(error)
    }
  )
  return http
}

/** 登录失效时的回调，由 stores/app 注册 —— api 层不反向依赖 store */
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

/** 账号还在用临时密码、接口只放行改密码时的回调，同样由 stores/app 注册 */
let onPasswordChangeRequired: (() => void) | null = null
export function setPasswordChangeHandler(fn: () => void) {
  onPasswordChangeRequired = fn
}

let lastAuthRequired = 0
const api = createHttpClient({
  apiBase: () => runtime.apiBase,
  getAuth: () => runtime.getAuth,
  getToken,
  onUnauthorized: () => {
    // 宿主管登录：没有本产品的令牌可清，交给宿主（onAuthRequired）
    // （一页同时发出去的几个请求会一起 401：一秒之内只说一次）
    if (runtime.getAuth) {
      const now = Date.now()
      if (now - lastAuthRequired > 1000) { lastAuthRequired = now; runtime.onAuthRequired?.() }
      return
    }
    clearToken()
    onUnauthorized?.()
  },
  onPasswordChangeRequired: () => onPasswordChangeRequired?.(),
})

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

/** 后端的错误码（如 auth.username_taken）；不是接口返回的错误时为空串 */
export function apiErrorCode(err: any): string {
  return String(err?.response?.data?.code || '')
}

/** 错误响应里附带的 data（如 auth.too_many_attempts 的 retryAfterSeconds） */
export function apiErrorData(err: any): Record<string, any> {
  const d = err?.response?.data?.data
  return d && typeof d === 'object' ? d : {}
}

// ====================== 基础 ======================

const makeAppApi = (api: AxiosInstance) => ({
  bootstrap: () => api.get<ApiResponse<BootstrapInfo>>('/bootstrap'),
})

/** 浏览器所在的时区（IANA 名字，如 Asia/Shanghai）；取不到就不带，后端按 UTC 算 */
export function browserTimeZone(): string | undefined {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined } catch { return undefined }
}

const makeAuthApi = (api: AxiosInstance) => ({
  register: (data: { username: string; email: string; password: string }) =>
    api.post<ApiResponse<{ user: User; token: string }>>('/auth/register', data),
  login: (data: { account: string; password: string; remember: boolean }) =>
    api.post<ApiResponse<{ user: User; token: string }>>('/auth/login', data),
  logout: () => api.post<ApiResponse>('/auth/logout'),
  me: () => api.get<ApiResponse<{ user: User }>>('/auth/me'),
  /** 成功后这个账号的会话全部作废，返回的 token 是给当前浏览器换发的新令牌 */
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.put<ApiResponse<{ revokedSessions: number; token: string }>>('/auth/password', data),
  updateProfile: (data: { username?: string; email?: string }) =>
    api.put<ApiResponse<{ user: User }>>('/auth/profile', data),
  /** 改界面偏好：只改发过去的那几项，返回完整的账号 */
  updatePrefs: (data: UserPrefs) =>
    api.put<ApiResponse<{ user: User }>>('/auth/prefs', data),
  sessions: () => api.get<ApiResponse<AuthSession[]>>('/auth/sessions'),
  revokeSession: (id: string) => api.delete<ApiResponse>(`/auth/sessions/${encodeURIComponent(id)}`),
  /** 退出除当前这个以外的全部会话 */
  revokeOtherSessions: () => api.delete<ApiResponse>('/auth/sessions'),
})

/** 只有超级管理员能调（其他人 403 auth.forbidden） */
const makeOwnerApi = (api: AxiosInstance) => ({
  users: () => api.get<ApiResponse<AdminUser[]>>('/admin/users'),
  setUserDisabled: (id: string, disabled: boolean) =>
    api.patch<ApiResponse<AdminUser>>(`/admin/users/${encodeURIComponent(id)}`, { disabled }),
  /** confirm 必须是那个用户的用户名，后端核对后才删 */
  removeUser: (id: string, confirm: string) =>
    api.delete<ApiResponse>(`/admin/users/${encodeURIComponent(id)}`, { params: { confirm } }),
  resetUserPassword: (id: string) =>
    api.post<ApiResponse<{ temporaryPassword: string }>>(`/admin/users/${encodeURIComponent(id)}/reset-password`),
  site: () => api.get<ApiResponse<SiteSettings>>('/admin/site'),
  updateSite: (data: SiteSettings) => api.put<ApiResponse<SiteSettings>>('/admin/site', data),
})

const makeFilesApi = (api: AxiosInstance) => ({
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
})

// ====================== 模型与运行 ======================

const makeModelsApi = (api: AxiosInstance) => ({
  list: (kind?: ModelKind) =>
    api.get<ApiResponse<ModelSpec[]>>('/models', { params: kind ? { kind } : undefined }),
})

export interface EstimateRequest {
  model: string
  params?: Record<string, any>
  count?: number
}

const makeRunsApi = (api: AxiosInstance) => ({
  estimate: (data: EstimateRequest) => api.post<ApiResponse<CostEstimate>>('/runs/estimate', data),
  create: (data: RunRequest) => api.post<ApiResponse<{ runId: string }>>('/runs', data),
  get: (id: string) => api.get<ApiResponse<Run>>(`/runs/${encodeURIComponent(id)}`),
  status: (ids: string[]) => api.post<ApiResponse<Run[]>>('/runs/status', { ids }),
  cancel: (id: string) => api.post<ApiResponse>(`/runs/${encodeURIComponent(id)}/cancel`),
})

export interface LlmTaskRequest {
  model: string
  prompt: string
  systemPrompt?: string
  imageUrls?: string[]
  videoUrl?: string
}

const makeLlmApi = (api: AxiosInstance) => ({
  create: (data: LlmTaskRequest) => api.post<ApiResponse<{ taskId: string }>>('/llm/tasks', data),
  get: (id: string) => api.get<ApiResponse<LlmTask>>(`/llm/tasks/${encodeURIComponent(id)}`),
})

// ====================== 管理（设置页） ======================

const makeAdminApi = (api: AxiosInstance) => ({
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

  /**
   * 用量的三个接口都带上浏览器的时区：from / to / before 写成 `YYYY-MM-DD` 时指的是
   * 用户本地的那一天（不带时区的话后端按 UTC 的一天算，东八区的「今天」会少掉早上八点前的记录），
   * 按天分组时一天的起止也按这个时区。
   */
  usage: (params: {
    from?: string; to?: string; groupBy: 'day' | 'model'; tz?: string
    kind?: ModelKind | ''; status?: RunStatus | ''; model?: string
  }) =>
    api.get<ApiResponse<{ items: UsageSummaryRow[]; totals?: UsageSummaryRow }>>('/admin/usage', { params: { tz: browserTimeZone(), ...params } }),
  usageRecords: (params: {
    from?: string; to?: string; page?: number; pageSize?: number
    kind?: ModelKind | ''; status?: RunStatus | ''; model?: string
  }) =>
    api.get<ApiResponse<{ list: UsageRecord[]; total: number; page: number; pageSize: number }>>(
      '/admin/usage/records', { params: { tz: browserTimeZone(), ...params } }
    ),
  /**
   * 清掉早于某一刻的用量记录。before 是 `YYYY-MM-DD`（用户本地那一天零点之前）或完整的 ISO 时间。
   * 只删已结束的（成功 / 失败 / 已取消），排队中和运行中的不动；生成的文件不删。
   */
  clearUsageRecords: (before: string) =>
    api.delete<ApiResponse<{ deleted: number }>>('/admin/usage/records', { params: { before, tz: browserTimeZone() } }),
})

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
  /** 节点位置还是改版前排的、编辑器还没查过有没有重叠；查过一次后永远是 false */
  legacyLayout?: boolean
  /** 这张画布套用的品牌包 id；空串 = 不套用。节点自己的例外在 data.brandKitOverride */
  brandKitId?: string
}

const makeWorkflowApi = (api: AxiosInstance) => ({
  list: () =>
    api.get<ApiResponse<WorkflowSummary[]>>('/workflow/list'),

  detail: (id: string) =>
    api.get<ApiResponse<WorkflowDetail>>(`/workflow/${id}`),

  create: (data: { name: string; nodes?: any[]; edges?: any[]; viewport?: any; settings?: any }) =>
    api.post<ApiResponse<WorkflowDetail>>('/workflow', data),

  update: (id: string, data: { name?: string; nodes?: any[]; edges?: any[]; viewport?: any; settings?: any; brandKitId?: string; legacyLayout?: false }) =>
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
})

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

const makeCanvasShareApi = (api: AxiosInstance) => ({
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
})

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

const makeCanvasAssetApi = (api: AxiosInstance) => ({
  categories: () =>
    api.get<ApiResponse<CanvasAssetCategory[]>>('/canvas-asset/categories'),

  list: (params: { code?: string; nodeType?: 'IMAGE' | 'VIDEO'; page?: number; pageSize?: number }) =>
    api.get<ApiResponse<{ list: CanvasAssetItem[]; total: number; page: number; pageSize: number }>>(
      '/canvas-asset/list', { params }
    ),
})

// 「我的资产」库
const makeUserAssetApi = (api: AxiosInstance) => ({
  list: (params: any) => api.get<ApiResponse>('/user-asset/list', { params }),
  create: (data: any) => api.post<ApiResponse>('/user-asset', data),
  registerOutput: (data: any) => api.post<ApiResponse>('/user-asset/register-output', data),
  update: (id: string, data: any) => api.put<ApiResponse>(`/user-asset/${id}`, data),
  remove: (id: string) => api.delete<ApiResponse>(`/user-asset/${id}`),
  deleteFolder: (data: any) => api.post<ApiResponse>('/user-asset/folder/delete', data),
})

const makeCanvasTemplateApi = (api: AxiosInstance) => ({
  /** 内置模板的标题 / 说明 / 预填提示词换成当前界面语言的写法（见 utils/builtinContent） */
  list: async () => {
    const res = await api.get<ApiResponse>('/canvas/templates')
    if (Array.isArray(res.data?.data)) res.data.data = localizeTemplates(res.data.data)
    return res
  },
})

// 多平台导出：本机像素处理（尺寸/白底净化/纯白检测），不调模型
const makePlatformExportApi = (api: AxiosInstance) => ({
  run: (imageUrl: string, group: 'domestic' | 'overseas') =>
    api.post<ApiResponse>('/canvas/platform-export', { imageUrl, group }),
})

// 画布工具节点：切片 / 拼图 / 水印 / 改尺寸。全是本机处理，不调模型
const makeCanvasToolApi = (api: AxiosInstance) => ({
  slice: (imageUrl: string, cols: number, rows: number) =>
    api.post<ApiResponse>('/canvas/tool/slice', { imageUrl, cols, rows }),
  collage: (imageUrls: string[], opts: Record<string, any>) =>
    api.post<ApiResponse>('/canvas/tool/collage', { imageUrls, ...opts }),
  watermark: (imageUrl: string, markUrl: string, opts: Record<string, any>) =>
    api.post<ApiResponse>('/canvas/tool/watermark', { imageUrl, markUrl, ...opts }),
  fit: (imageUrl: string, opts: Record<string, any>) =>
    api.post<ApiResponse>('/canvas/tool/fit', { imageUrl, ...opts }),
})

// 品牌包：一组可复用的出图设定，按画布选（见 composables/useBrandKits）
const makeBrandKitApi = (api: AxiosInstance) => ({
  list: () => api.get<ApiResponse>('/brand-kits'),
  create: (data: any) => api.post<ApiResponse>('/brand-kits', data),
  update: (id: string, data: any) => api.put<ApiResponse>(`/brand-kits/${id}`, data),
  remove: (id: string) => api.delete<ApiResponse>(`/brand-kits/${id}`),
})

// 文本素材（文本节点一键填入）。lang 默认 zh，可传 en 获取英文原版
const makeCanvasTextTemplateApi = (api: AxiosInstance) => ({
  list: (lang: 'zh' | 'en' = 'zh') =>
    api.get<ApiResponse>('/canvas/text-templates', { params: { lang } }),
})


/** 全部接口分组，绑在一个 axios 实例上。独立应用用下面那一份共享的；createHttpAdapter 给每个适配器各建一份。 */
export function createApi(http: AxiosInstance) {
  return {
    appApi: makeAppApi(http),
    authApi: makeAuthApi(http),
    ownerApi: makeOwnerApi(http),
    filesApi: makeFilesApi(http),
    modelsApi: makeModelsApi(http),
    runsApi: makeRunsApi(http),
    llmApi: makeLlmApi(http),
    adminApi: makeAdminApi(http),
    workflowApi: makeWorkflowApi(http),
    canvasShareApi: makeCanvasShareApi(http),
    canvasAssetApi: makeCanvasAssetApi(http),
    userAssetApi: makeUserAssetApi(http),
    canvasTemplateApi: makeCanvasTemplateApi(http),
    platformExportApi: makePlatformExportApi(http),
    canvasToolApi: makeCanvasToolApi(http),
    brandKitApi: makeBrandKitApi(http),
    canvasTextTemplateApi: makeCanvasTextTemplateApi(http),
  }
}
export type ApiGroups = ReturnType<typeof createApi>

/** 独立应用和整站嵌入共用的那一份（绑在上面那个 axios 实例上） */
export const sharedApi = createApi(api)

export const {
  appApi, authApi, ownerApi, filesApi, modelsApi, runsApi, llmApi, adminApi, workflowApi, canvasShareApi, canvasAssetApi, userAssetApi, canvasTemplateApi, platformExportApi, canvasToolApi, brandKitApi, canvasTextTemplateApi,
} = sharedApi