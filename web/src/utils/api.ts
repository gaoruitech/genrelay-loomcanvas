import axios, { type AxiosInstance } from 'axios'
import type { ApiResponse, BootstrapInfo, UploadedFile, ModelSpec, ModelKind, CostEstimate, Run, RunRequest, LlmTask, Vendor, ProviderInstance, ProviderTestResult, AdminModel, AdminSettings, UsageSummaryRow, UsageRecord, StorageStatus, StorageS3Form, StorageTestResult, User, AdminUser, AuthSession, SiteSettings, RunStatus, UserPrefs, SpaceSummary, Team, TeamCreation, TeamDetail, TeamMember, TeamInvitation, InvitationPreview, TeamLimits, TeamActivityItem, TeamSettings, CanvasTeamFields, CanvasVisibility, CanvasLock, AdminTeam, AdminTeamRequest, Person, AssetFolder, CopyTarget, TeamPurgeResult } from '@/types'
import { getToken, clearToken } from '@/utils/authToken'
import { localizeTemplates } from '@/utils/builtinContent'
import { currentLocale } from '@/locales'
import { runtime } from '@/embed/runtime'
import { noteStorageAnswer } from '@/utils/storageHealth'
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
  /**
   * 请求作用于哪个空间：'' 或 'personal' 是调用者的个人空间（不带 X-Space），否则是团队 id。
   * 每次请求时现取。
   */
  space?: () => string
  /**
   * 带着 X-Space 发出去的请求被告知「这个空间对你已经不存在」
   * （team.not_found / team.dissolved / team.suspended）。space 是那次请求作用的团队 id。
   */
  onSpaceGone?: (code: string, space: string, message: string) => void
}

/** 「这个空间对我已经不存在」的三个错误码 */
export const SPACE_GONE_CODES = ['team.not_found', 'team.dissolved', 'team.suspended'] as const

/** 超级管理员的站点接口：/admin 下除了按空间的那几组（vendors / providers / models / usage）之外的 */
export function isSiteRoute(url: string): boolean {
  const path = url.split('?')[0]
  return /^\/admin\//.test(path) && !/^\/admin\/(vendors|providers|models|usage)(\/|$)/.test(path)
}

/** 团队 id 的写法（24 位十六进制） */
export function isTeamId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v)
}

/**
 * 建一个 axios 实例：根地址、认证头、语言头都在每次请求时现取。
 * 独立应用和整站嵌入共用下面那一个；createHttpAdapter 给每个适配器各建一个。
 */
export function createHttpClient(opts: HttpClientOptions): AxiosInstance {
  const http = axios.create({ timeout: opts.timeoutMs ?? 320000 })
  // 页面关掉时还锁用的是 sendBeacon，不经过 axios：把「接口根地址现在是什么」留在实例上给它拼地址
  ;(http as any).lcApiBase = opts.apiBase
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
    // 作用于哪个空间。调用方自己给了 X-Space 的（探测别的空间）不动它；个人空间不带这个头。
    // 超级管理员的站点接口（用户、站点、团队、申请、设置、存储）不属于任何空间：不带，
    // 否则那里的 team.not_found（说的是被操作的那个团队）会被当成「当前空间没了」。
    if (isSiteRoute(String(config.url || ''))) {
      delete config.headers['X-Space']
    } else if (config.headers['X-Space'] == null) {
      const space = opts.space?.() || ''
      if (isTeamId(space)) config.headers['X-Space'] = space
    } else if (!isTeamId(config.headers['X-Space'])) {
      delete config.headers['X-Space']
    }
    return config
  })
  http.interceptors.response.use(
    (response) => {
      // 一次成功的上传 / 出图出片运行说明存储现在存得下东西；启动信息取回来了就以它为准（见 utils/storageHealth）
      noteStorageAnswer(String(response.config?.url || ''), String(response.config?.method || ''), '')
      return response
    },
    (error) => {
      // 存储存不了新文件、服务商的 Key 解不开：记下来（连同服务端那句话），画布在下一次运行之前先说明
      noteStorageAnswer(String(error.config?.url || ''), String(error.config?.method || ''), String(error.response?.data?.code || ''), String(error.response?.data?.message || ''))
      // 任何接口回 403 auth.password_change_required：这个账号得先换掉临时密码（比如开着页面时被超级管理员重置了）
      if (error.response?.status === 403 && error.response?.data?.code === 'auth.password_change_required') {
        opts.onPasswordChangeRequired?.()
      }
      // 登录接口自己的 401（账号或密码不对）不算「登录失效」
      const url = String(error.config?.url || '')
      if (error.response?.status === 401 && !url.startsWith('/auth/login') && !url.startsWith('/auth/register')) {
        opts.onUnauthorized?.()
      }
      // 这个空间对调用者已经不存在了（被移出、团队被解散或停用）。
      // 只认「请求作用的那个空间」出的事：跨空间复制时目标团队进不去也是 team.not_found，那是调用方自己的事。
      const code = String(error.response?.data?.code || '')
      if ((SPACE_GONE_CODES as readonly string[]).includes(code) && !error.config?.lcSpaceProbe && !isSiteRoute(url)) {
        const sent = String(error.config?.headers?.['X-Space'] || '')
        const inPath = /^\/teams\/([0-9a-f]{24})(\/|$)/i.exec(url)?.[1] || ''
        const copyOut = /\/copy$/.test(url.split('?')[0])
        const gone = inPath || (copyOut ? '' : sent)
        if (gone) opts.onSpaceGone?.(code, gone, String(error.response?.data?.message || ''))
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

/** 当前空间没了时的回调，由 stores/space 注册 */
let onSpaceGone: ((code: string, space: string, message: string) => void) | null = null
export function setSpaceGoneHandler(fn: ((code: string, space: string, message: string) => void) | null) {
  onSpaceGone = fn
}

let lastAuthRequired = 0
const api = createHttpClient({
  apiBase: () => runtime.apiBase,
  space: () => runtime.space,
  onSpaceGone: (code, space, message) => onSpaceGone?.(code, space, message),
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

/**
 * 从 axios 错误里取后端给的 message，取不到用 fallback。
 * 后端没给话的时候（断网、超时、反向代理自己回的 502 / 503），axios 的那句英文
 * （Network Error、Request failed with status code 503）不给用户看：用调用处按界面语言给的 fallback。
 * 不是 axios 的错（本地校验抛的、自己写的适配器抛的）带的是写给人看的话，照用。
 */
export function apiErrorMessage(err: any, fallback: string): string {
  const said = err?.response?.data?.message
  if (said && typeof said === 'string') return said
  if (err?.isAxiosError && fallback) return fallback
  return err?.message || fallback
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
  me: () => api.get<ApiResponse<{ user: User; spaces?: SpaceSummary[] }>>('/auth/me'),
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
  /** 授予 / 收回「可以创建团队」。收回后已有的团队保留 */
  setUserCanCreateTeams: (id: string, canCreateTeams: boolean) =>
    api.patch<ApiResponse<AdminUser>>(`/admin/users/${encodeURIComponent(id)}`, { canCreateTeams }),
  /** confirm 必须是那个用户的用户名，后端核对后才删 */
  /**
   * 删除账号：个人空间里的东西和文件一起删，所在的团队自动退出（团队里的内容留给团队）。还是某个团队团长的删不了（409）。
   * filesRemoved 为 false：账号和数据已经删了，存储里的文件还没有全部删完；剩下的服务端在后台继续删。
   */
  removeUser: (id: string, confirm: string) =>
    api.delete<ApiResponse<{ id: string; removed: Record<string, number>; files: number; filesRemoved: boolean }>>(`/admin/users/${encodeURIComponent(id)}`, { params: { confirm } }),
  resetUserPassword: (id: string) =>
    api.post<ApiResponse<{ temporaryPassword: string }>>(`/admin/users/${encodeURIComponent(id)}/reset-password`),
  site: () => api.get<ApiResponse<SiteSettings>>('/admin/site'),
  updateSite: (data: SiteSettings) => api.put<ApiResponse<SiteSettings>>('/admin/site', data),

  // ---- 团队（只有名称和数字，没有任何团队里的内容） ----
  teams: () => api.get<ApiResponse<{ teams: AdminTeam[]; defaults: { teamMaxPerUser: number; teamMaxMembers: number; teamConcurrency: number; teamActivityDays: number } }>>('/admin/teams'),
  /** null 表示恢复用站点默认值；status 只能在 active / suspended 之间切（已解散的用 restoreTeam） */
  updateTeam: (id: string, data: { maxMembers?: number | null; concurrency?: number | null; status?: 'suspended' | 'active' }) =>
    api.patch<ApiResponse<AdminTeam>>(`/admin/teams/${encodeURIComponent(id)}`, data),
  teamMembers: (id: string) =>
    api.get<ApiResponse<{ id: string; username: string; role: string; disabled: boolean }[]>>(`/admin/teams/${encodeURIComponent(id)}/members`),
  /** 只在当前团长的账号不可用时才行（否则 409 team.owner_usable） */
  appointTeamOwner: (id: string, userId: string) =>
    api.post<ApiResponse<AdminTeam>>(`/admin/teams/${encodeURIComponent(id)}/owner`, { userId }),
  restoreTeam: (id: string) => api.post<ApiResponse<AdminTeam>>(`/admin/teams/${encodeURIComponent(id)}/restore`),
  /** 永久删除：团队必须已经关闭，confirm 是准确的团队名称 */
  purgeTeam: (id: string, confirm: string) =>
    api.delete<ApiResponse<TeamPurgeResult>>(`/admin/teams/${encodeURIComponent(id)}`, { params: { confirm } }),
  teamRequests: (params: { status?: 'pending' | 'approved' | 'rejected' | 'all'; page?: number; pageSize?: number } = {}) =>
    api.get<ApiResponse<{ list: AdminTeamRequest[]; total: number; pending: number; page: number; pageSize: number }>>('/admin/team-requests', { params }),
  approveTeamRequest: (id: string) => api.post<ApiResponse<AdminTeamRequest>>(`/admin/team-requests/${encodeURIComponent(id)}/approve`),
  rejectTeamRequest: (id: string, reason?: string) =>
    api.post<ApiResponse<AdminTeamRequest>>(`/admin/team-requests/${encodeURIComponent(id)}/reject`, { reason }),
})

// ====================== 团队 ======================

export interface UsageQuery {
  from?: string; to?: string; tz?: string
  kind?: ModelKind | ''; status?: RunStatus | ''; model?: string
  /** 只对能看全队的人有效；其余人传了会被忽略 */
  member?: string
  /** 文字搜索（最多 100 个字符）：提示词、模型、画布名里含这段文字的；只在调用者本来就能看到的记录里筛 */
  q?: string
}

/** 路径里带团队 id 的那一组接口：路径决定团队，不读 X-Space */
const makeTeamApi = (api: AxiosInstance) => {
  const base = (id: string) => `/teams/${encodeURIComponent(id)}`
  return {
    list: () => api.get<ApiResponse<{ teams: Team[]; creation: TeamCreation }>>('/teams'),
    /** timezone：浏览器的 IANA 时区，每月上限按它切月 */
    create: (data: { name: string; avatar?: string; timezone?: string }) => api.post<ApiResponse<Team>>('/teams', data),
    creation: () => api.get<ApiResponse<TeamCreation>>('/teams/creation'),
    requestCreation: (note?: string) => api.post<ApiResponse<TeamCreation>>('/teams/creation-request', { note }),
    withdrawCreationRequest: () => api.delete<ApiResponse<TeamCreation & { withdrawn: boolean }>>('/teams/creation-request'),

    detail: (id: string) => api.get<ApiResponse<TeamDetail>>(base(id)),
    update: (id: string, data: { name?: string; avatar?: string; timezone?: string; settings?: Partial<TeamSettings> }) =>
      api.patch<ApiResponse<TeamDetail>>(base(id), data),
    /** confirm 必须是准确的团队名称 */
    dissolve: (id: string, confirm: string) => api.delete<ApiResponse<Team>>(base(id), { params: { confirm } }),
    restore: (id: string) => api.post<ApiResponse<Team>>(`${base(id)}/restore`),
    transfer: (id: string, userId: string, confirm: string) => api.post<ApiResponse<Team>>(`${base(id)}/transfer`, { userId, confirm }),
    leave: (id: string) => api.post<ApiResponse<{ left: boolean; canvasesInherited: number; runsCanceled: number }>>(`${base(id)}/leave`),

    members: (id: string) => api.get<ApiResponse<{ members: TeamMember[]; maxMembers: number; withUsage: boolean }>>(`${base(id)}/members`),
    /** limits 里的 null 表示跟全员默认值 */
    updateMember: (id: string, userId: string, data: { role?: 'admin' | 'member'; displayName?: string; limits?: { runs?: number | null; amount?: number | null } }) =>
      api.patch<ApiResponse<TeamMember>>(`${base(id)}/members/${encodeURIComponent(userId)}`, data),
    /** keysSet：被移除的管理员填写过当前 Key 的服务商，要提醒团长到上游换新 */
    removeMember: (id: string, userId: string) =>
      api.delete<ApiResponse<{ removed: boolean; canvasesInherited: number; runsCanceled: number; keysSet?: { id: string; name: string }[] }>>(`${base(id)}/members/${encodeURIComponent(userId)}`),

    invitations: (id: string) => api.get<ApiResponse<TeamInvitation[]>>(`${base(id)}/invitations`),
    createInvitation: (id: string, data: { expiresInDays?: number; maxUses?: number }) =>
      api.post<ApiResponse<TeamInvitation>>(`${base(id)}/invitations`, data),
    revokeInvitation: (id: string, invitationId: string) =>
      api.delete<ApiResponse<{ id: string; revoked: boolean }>>(`${base(id)}/invitations/${encodeURIComponent(invitationId)}`),

    /** members：连每个成员的那一份一起要（要有查看全队用量的权限，否则服务端不给） */
    limits: (id: string, members = false) => api.get<ApiResponse<TeamLimits>>(`${base(id)}/limits`, members ? { params: { members: 1 } } : undefined),
    /** 数字是设上限，null 是取消 */
    updateLimits: (id: string, data: { team?: { runs?: number | null; amount?: number | null }; memberDefault?: { runs?: number | null; amount?: number | null }; currency?: string; blockUnpriced?: boolean }) =>
      api.put<ApiResponse<TeamLimits>>(`${base(id)}/limits`, data),

    /** scope：all 是全队的，own 是只有调用者自己的 */
    usage: (id: string, params: UsageQuery & { groupBy: 'day' | 'model' | 'member' }) =>
      api.get<ApiResponse<{ items: UsageSummaryRow[]; totals?: UsageSummaryRow; scope?: 'all' | 'own' }>>(`${base(id)}/usage`, { params }),
    usageRecords: (id: string, params: UsageQuery & { page?: number; pageSize?: number }) =>
      api.get<ApiResponse<{ list: UsageRecord[]; total: number; page: number; pageSize: number; scope?: 'all' | 'own' }>>(`${base(id)}/usage/records`, { params }),

    activity: (id: string, params: { category?: string; actor?: string; from?: string; to?: string; page?: number; pageSize?: number; tz?: string }) =>
      api.get<ApiResponse<{ list: TeamActivityItem[]; categories: string[]; total: number; page: number; pageSize: number }>>(`${base(id)}/activity`, { params }),

    /**
     * 「复制到…」能去哪儿：调用者所在的每一个空间，去不了的也列出来并说明原因。
     * 作用于「东西现在所在的空间」（请求头里的当前空间）。assetKind：素材的种类，目标那一类满了也算去不了。
     */
    copyTargets: (kind: 'canvas' | 'asset', assetKind?: string) =>
      api.get<ApiResponse<{ kind: string; from: { id: string; kind: string }; targets: CopyTarget[] }>>('/spaces/copy-targets', { params: { kind, ...(assetKind ? { assetKind } : {}) } }),

    /** 邀请链接的预览：公开接口，登录不登录都能取 */
    invitationPreview: (token: string) => api.get<ApiResponse<InvitationPreview>>(`/team-invitations/${encodeURIComponent(token)}`),
    acceptInvitation: (token: string) => api.post<ApiResponse<{ team: Team; already: boolean }>>(`/team-invitations/${encodeURIComponent(token)}/accept`),
  }
}

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
  /** 传到指定的空间名下（'personal' 或团队 id），不管当前在哪个空间。刚建好的团队传头像时用 */
  uploadTo: (space: string, file: File | Blob, filename?: string) => {
    const fd = new FormData()
    if (filename) fd.append('file', file, filename)
    else fd.append('file', file)
    return api.post<ApiResponse<UploadedFile>>('/files/upload', fd, { timeout: 600000, headers: { 'X-Space': isTeamId(space) ? space : 'personal' } })
  },
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
  /**
   * 几条生成记录的结果打成一个 zip（最多 100 条记录、100 个文件）：成功的图片 / 视频运行的文件，加上成功的对话的回复（.txt）。
   * urls 只是在这些记录的文件里再挑；给了它就不带对话的回复。name 是压缩包的名字（不带 .zip）。
   * 回来的是 blob；被拒绝时（run.zip_max、run.nothing_to_download、run.zip_busy……）回来的是 JSON，同样装在 blob 里。
   * 打包是一个文件接一个文件地读，给足十分钟；onProgress 报已经收到多少字节（总大小事先不知道）。
   */
  downloadZip: (data: { ids: string[]; urls?: string[]; name?: string }, onProgress?: (loaded: number) => void) =>
    api.post<Blob>('/runs/download-zip', data, {
      responseType: 'blob', timeout: 660000,
      onDownloadProgress: onProgress ? (e) => onProgress(Number(e.loaded) || 0) : undefined,
    }),
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

  /**
   * probe：先让服务端把每个存储桶都问一遍（最多等几秒），拿到的状态才是此刻的；
   * 不带的话是「上次有文件请求碰到它时」的样子，立刻返回。
   */
  storage: (probe = false) => api.get<ApiResponse<StorageStatus>>('/admin/storage', probe ? { params: { probe: 1 } } : undefined),
  /** 用还没保存的配置真实读写一遍存储桶；secretAccessKey 留空表示用已保存的那一把 */
  testStorage: (s3: StorageS3Form) =>
    api.post<ApiResponse<StorageTestResult>>('/admin/storage/test', { s3 }),
  /** 保存并立即生效。S3 配置会先测试，没过返回 400（code: storage.save_needs_test，data.test 是测试结果），force 可跳过 */
  saveStorage: (data: { driver: 'local' } | { driver: 's3'; s3: StorageS3Form; force?: boolean }) =>
    api.put<ApiResponse<StorageStatus>>('/admin/storage', data),
  /**
   * 不再读取一个已经不写入的存储桶（id 取自存储状态的 buckets，removable 为 true 的）。桶里的东西不删。
   * 404 storage.bucket_not_found / 400 storage.bucket_in_use / 400 storage.bucket_from_env。返回新的存储状态。
   */
  forgetStorageBucket: (id: string) =>
    api.delete<ApiResponse<StorageStatus>>(`/admin/storage/buckets/${encodeURIComponent(id)}`),

  /**
   * 用量的三个接口都带上浏览器的时区：from / to / before 写成 `YYYY-MM-DD` 时指的是
   * 用户本地的那一天（不带时区的话后端按 UTC 的一天算，东八区的「今天」会少掉早上八点前的记录），
   * 按天分组时一天的起止也按这个时区。
   */
  usage: (params: {
    from?: string; to?: string; groupBy: 'day' | 'model' | 'member'; tz?: string
    kind?: ModelKind | ''; status?: RunStatus | ''; model?: string
    /** 团队里：只看这个成员的（只对能看全队的人有效） */
    member?: string
    /** 文字搜索，和 usageRecords 的 q 是同一个条件：汇总和列表对得上 */
    q?: string
  }) =>
    api.get<ApiResponse<{ items: UsageSummaryRow[]; totals?: UsageSummaryRow; scope?: 'all' | 'own' }>>('/admin/usage', { params: { tz: browserTimeZone(), ...params } }),
  usageRecords: (params: {
    from?: string; to?: string; page?: number; pageSize?: number
    kind?: ModelKind | ''; status?: RunStatus | ''; model?: string
    member?: string
    /** 文字搜索（最多 100 个字符）：提示词、模型（名称或 id）、画布名里含这段文字的，按字面、不分大小写；筛的是全部页 */
    q?: string
    /** 不给就用浏览器的时区 */
    tz?: string
    /** 1 = 每条都给全文（完整的提示词和回复、系统提示词）：导出用，翻页看列表不需要 */
    full?: 1
  }) =>
    api.get<ApiResponse<{ list: UsageRecord[]; total: number; page: number; pageSize: number; scope?: 'all' | 'own' }>>(
      '/admin/usage/records', { params: { tz: browserTimeZone(), ...params } }
    ),
  /** 一条记录的全文：完整的提示词和回复、系统提示词、随提示词发出去的文件。读不到（别人的、已清理）是 404 run.not_found */
  usageRecord: (id: string) =>
    api.get<ApiResponse<UsageRecord>>(`/admin/usage/records/${encodeURIComponent(id)}`),
  /**
   * 清掉早于某一刻的用量记录。before 是 `YYYY-MM-DD`（用户本地那一天零点之前）或完整的 ISO 时间。
   * 只删已结束的（成功 / 失败 / 已取消），排队中和运行中的不动；生成的文件不删。
   */
  clearUsageRecords: (before: string) =>
    api.delete<ApiResponse<{ deleted: number }>>('/admin/usage/records', { params: { before, tz: browserTimeZone() } }),
})

// ====================== 画布 ======================

export interface WorkflowSummary extends CanvasTeamFields {
  id: string
  name: string
  thumbnail?: string
  thumbnailType?: 'image' | 'video' | ''
  createdAt: string
  updatedAt: string
}

/**
 * GET /workflow/locks 的回答：画布列表隔一会儿问一次的那一份。
 * 个人空间里只有 locks（空的）和 pollMs；now / counts 只有团队空间有，changed / removed 只有带了 since 才有。
 */
export interface WorkflowListPoll {
  locks: { id: string; lock: CanvasLock }[]
  pollMs: number
  /** 服务端的「现在」：下一次原样当 since 送回去 */
  now?: string
  /** 这个人现在的列表里一共几张、每档可见范围各几张：和手上的对不上（有人改了可见范围）就整个重取 */
  counts?: { total: number; private: number; team_view: number; team_edit: number }
  /** since 以后新建 / 改名 / 保存 / 恢复过的画布，和列表里的一行一样 */
  changed?: WorkflowSummary[]
  /** since 以后被删掉的画布 */
  removed?: string[]
  /** 变的太多，不逐个列了：整个重取 */
  reload?: boolean
}

/** 回收站里的一张画布 */
export interface TrashedWorkflow extends WorkflowSummary {
  deletedAt: string
  deletedBy?: Person | null
  restorableUntil: string
}

/**
 * 拿锁 / 续期的返回。个人空间里 lock 为 null、state 为 'none'。
 * state：acquired 拿到了 / renewed 续上了 / reacquired 我的锁过期了但没人拿走，接着用 / taken_over 接管来的。
 * name、metaRevision 是画布现在的名字：心跳就是开着的编辑器得知「被改名了」的途径。
 */
export interface WorkflowLockResult {
  lock: CanvasLock | null
  state?: 'acquired' | 'renewed' | 'reacquired' | 'taken_over' | 'none'
  revision: number
  metaRevision?: number
  name?: string
  ttlMs?: number
  heartbeatMs?: number
  /** 只读等着的人多久看一次锁还在不在 */
  pollMs?: number
  ttlSeconds?: number
  heartbeatSeconds?: number
}

/** 只看一眼锁（不拿）：GET /workflow/:id/lock */
export interface WorkflowLockPeek {
  lock: CanvasLock | null
  revision: number
  metaRevision: number
  name: string
  canEdit: boolean
  canTakeOver: boolean
  ttlMs: number
  heartbeatMs: number
  pollMs: number
}

/** 探测「这张画布是不是在别的空间里」时用：这种请求的失败不算「当前空间没了」 */
const probe = (space: string) => ({ headers: { 'X-Space': isTeamId(space) ? space : 'personal' }, lcSpaceProbe: true } as any)

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
  /** 团队里可以收窄：mine（我创建的）、member（某个成员创建的）、visibility。只会在调用者看得到的范围内缩小 */
  list: (params?: { mine?: 1; member?: string; visibility?: CanvasVisibility }) =>
    api.get<ApiResponse<WorkflowSummary[]>>('/workflow/list', { params }),

  /** sessionId：这个标签页的编辑会话。带上它，返回里的 lock.mine 才说得准「是不是这个标签页拿着」 */
  detail: (id: string, sessionId?: string) =>
    api.get<ApiResponse<WorkflowDetail>>(`/workflow/${id}`, sessionId ? { params: { sessionId } } : undefined),

  /** 这张画布在不在 space 这个空间里（'personal' 或团队 id）。在：返回它；不在：null。别的错误照常抛 */
  findIn: async (id: string, space: string): Promise<WorkflowDetail | null> => {
    try {
      return unwrap(await api.get<ApiResponse<WorkflowDetail>>(`/workflow/${id}`, probe(space)))
    } catch (err: any) {
      if ([403, 404].includes(err?.response?.status)) return null
      throw err
    }
  },

  /** visibility 只在团队里有意义，不传就用团队的默认可见范围 */
  create: (data: { name: string; nodes?: any[]; edges?: any[]; viewport?: any; settings?: any; brandKitId?: string; visibility?: CanvasVisibility }) =>
    api.post<ApiResponse<WorkflowDetail>>('/workflow', data),

  /**
   * baseRevision：我是基于哪一版改的（团队里保存内容必须带）。画布已经不在这一版：409 canvas.conflict，什么都不写。
   * force：跳过版本检查，用我的版本覆盖（要有 access.canOverwrite）。别人持锁：423 canvas.locked。
   */
  update: (id: string, data: { name?: string; nodes?: any[]; edges?: any[]; viewport?: any; settings?: any; brandKitId?: string; legacyLayout?: false; baseRevision?: number; force?: boolean; sessionId?: string }) =>
    api.put<ApiResponse<WorkflowDetail>>(`/workflow/${id}`, data),

  /**
   * 只改「不算内容」的那几样：名字、视口、旧布局标记。只要有编辑权就行——不要锁、不带版本、不会冲突，
   * 也不动内容的版本号。所以别人正在编辑的画布照样能改名，对方下一次保存也不会因此冲突。
   */
  saveMeta: (id: string, data: { name?: string; viewport?: any; legacyLayout?: false; sessionId?: string }) =>
    api.patch<ApiResponse<WorkflowDetail>>(`/workflow/${id}/meta`, data),
  rename: (id: string, name: string) =>
    api.patch<ApiResponse<WorkflowDetail>>(`/workflow/${id}/meta`, { name }),

  /** 改可见范围（仅团队）。不改变 revision */
  setAccess: (id: string, visibility: CanvasVisibility) =>
    api.patch<ApiResponse<WorkflowDetail>>(`/workflow/${id}/access`, { visibility }),

  /**
   * 拿锁 / 续期（心跳）/ 接管。锁属于 sessionId 这个编辑会话（一个标签页）。
   * 别的会话持有有效的锁（别人，或者自己的另一个标签页）：423 canvas.locked，data 里是 { lock, canTakeOver, lost }。
   */
  lock: (id: string, sessionId: string, takeover = false) =>
    api.post<ApiResponse<WorkflowLockResult>>(`/workflow/${id}/lock`, takeover ? { sessionId, takeover: true } : { sessionId }),
  /** 在应用里离开编辑器时还锁 */
  unlock: (id: string, sessionId: string) =>
    api.delete<ApiResponse<{ released: boolean }>>(`/workflow/${id}/lock`, { params: { sessionId } }),
  /** 只看一眼锁（不拿、不续）：只读等着的编辑器隔几秒问一次 */
  peekLock: (id: string, sessionId?: string) =>
    api.get<ApiResponse<WorkflowLockPeek>>(`/workflow/${id}/lock`, sessionId ? { params: { sessionId } } : undefined),
  /**
   * 这个空间里现在谁在编辑哪张画布（只有活着的锁）：画布列表隔一会儿问一次，不用整个列表重拉。
   * 带上 since（上一次回答里的 now）时，回答里还有从那以后变了的画布（别人改了名、新建、保存、恢复）和被删掉的 id。
   */
  locks: (since?: string) =>
    api.get<ApiResponse<WorkflowListPoll>>('/workflow/locks', since ? { params: { since } } : undefined),
  /**
   * 页面关掉 / 刷新 / 跳走时还锁。这时候普通请求不保证发得出去，sendBeacon 可以，但它带不了登录头——
   * 所以这个接口是公开的，凭锁自己的 releaseToken。发不出去也不要紧：锁会自己过期。
   */
  releaseOnUnload: (id: string, releaseToken: string): boolean => {
    const base = String(((api as any).lcApiBase?.() ?? api.defaults.baseURL ?? '/api') || '/api').replace(/\/+$/, '')
    const url = `${base}/workflow/${id}/lock/release`
    const body = JSON.stringify({ releaseToken })
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, body)) return true
    } catch { /* 退到下面 */ }
    try {
      void fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, credentials: 'omit' }).catch(() => undefined)
      return true
    } catch { return false }
  },

  /** 复制到调用者所在的另一个空间；文件一起复制（files 是数量） */
  copyTo: (id: string, toSpace: string, name?: string) =>
    api.post<ApiResponse<{ workflowId: string; spaceId: string; files: number }>>(`/workflow/${id}/copy`, { toSpace, name }, { timeout: 600000 }),

  /** 最近 30 天删除的画布。团队里只有团长和管理员能看 */
  trash: () => api.get<ApiResponse<TrashedWorkflow[]>>('/workflow/trash'),
  restore: (id: string) => api.post<ApiResponse<WorkflowDetail>>(`/workflow/${id}/restore`),

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
  /** 团队里：谁发布的 */
  createdBy?: Person | null
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
  /** 解散分组：分组没了，里面的素材留着，变成不在任何分组里（团队里只有团长、管理员能做） */
  deleteFolder: (data: any) => api.post<ApiResponse<{ moved: number }>>('/user-asset/folder/delete', data),
  /** 新建一个空分组；已经有同名的也算成功（existed: true） */
  createFolder: (name: string) => api.post<ApiResponse<AssetFolder & { existed: boolean }>>('/user-asset/folder', { name }),
  /** 删除一个空分组；里面还有素材时是 409 asset.folder_not_empty（data: { name, count }） */
  removeFolder: (name: string) => api.delete<ApiResponse<{ name: string; deleted: boolean }>>('/user-asset/folder', { params: { name } }),
  /** 复制到调用者所在的另一个空间，文件另存一份 */
  copyTo: (id: string, toSpace: string) =>
    api.post<ApiResponse<{ id: string; spaceId: string; mediaUrl: string; thumbnailUrl: string }>>(`/user-asset/${id}/copy`, { toSpace }, { timeout: 600000 }),
})

const makeCanvasTemplateApi = (api: AxiosInstance) => ({
  /** 内置模板的标题 / 说明 / 预填提示词换成当前界面语言的写法（见 utils/builtinContent） */
  list: async () => {
    const res = await api.get<ApiResponse>('/canvas/templates')
    if (Array.isArray(res.data?.data)) res.data.data = localizeTemplates(res.data.data)
    return res
  },
  /** 把一组节点存成这个空间的模板（key 由服务端生成） */
  create: (data: { title: string; description?: string; cover?: string; graph: { nodes: any[]; edges: any[]; viewport?: any; group?: any } }) =>
    api.post<ApiResponse>('/canvas/templates', data),
  /** 自己存的自己能删，团长和管理员能删任何人的；内置的删不了 */
  remove: (key: string) => api.delete<ApiResponse>(`/canvas/templates/${encodeURIComponent(key)}`),
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
  create: (data: { title: string; content: string; category?: string; lang?: 'zh' | 'en' }) =>
    api.post<ApiResponse>('/canvas/text-templates', data),
  remove: (id: string) => api.delete<ApiResponse>(`/canvas/text-templates/${encodeURIComponent(id)}`),
})


/** 全部接口分组，绑在一个 axios 实例上。独立应用用下面那一份共享的；createHttpAdapter 给每个适配器各建一份。 */
export function createApi(http: AxiosInstance) {
  return {
    appApi: makeAppApi(http),
    authApi: makeAuthApi(http),
    ownerApi: makeOwnerApi(http),
    teamApi: makeTeamApi(http),
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
  appApi, authApi, ownerApi, teamApi, filesApi, modelsApi, runsApi, llmApi, adminApi, workflowApi, canvasShareApi, canvasAssetApi, userAssetApi, canvasTemplateApi, platformExportApi, canvasToolApi, brandKitApi, canvasTextTemplateApi,
} = sharedApi