/** 后端统一返回包：result 非 0 表示失败 */
export interface ApiResponse<T = any> {
  result: number
  message?: string
  data?: T
  code?: string
}

export type ThemeMode = 'dark' | 'light' | 'system'
export type LocaleCode = 'zh-CN' | 'en'

export interface BootstrapInfo {
  authRequired: boolean
  authed: boolean
  site: {
    name?: string
    logoUrl?: string
    defaultTheme?: ThemeMode
    defaultLocale?: string
  }
  hasProvider: boolean
  version?: string
}

export interface UploadedFile {
  url: string
  key: string
  size: number
  mime: string
  width?: number
  height?: number
}

export type ModelKind = 'image' | 'video' | 'chat'

export interface ModelPricing {
  currency: string
  unit: 'per_image' | 'per_video' | 'per_second' | 'per_1m_tokens'
  by?: 'resolution' | 'duration' | 'resolution_duration' | ''
  price?: number
  table?: Record<string, number>
}

export interface ModelSpec {
  id: string
  providerId: string
  label: string
  desc?: string
  tag?: string
  kind: ModelKind
  acceptsImage?: boolean
  acceptsVideo?: boolean
  videoEdit?: boolean
  maxReferenceImages?: number
  options?: {
    aspectRatios?: string[]
    resolutions?: string[]
    durations?: number[]
    counts?: number[]
    /** 图片输入模式：frames 首尾帧 / multi 多图参考。声明了才显示模式开关 */
    imgModes?: string[]
  }
  defaults?: Record<string, any>
  pricing?: ModelPricing | null
}

/** 一笔花费。unknown 为真表示该模型没有配置价格，amount 无意义 */
export interface Cost {
  amount: number
  currency: string
  unknown: boolean
}

export interface CostEstimate {
  unitCost: number
  totalCost: number
  currency: string
  unknown: boolean
}

export type RunStatus = 'queued' | 'running' | 'archiving' | 'succeeded' | 'failed' | 'canceled'

export interface RunOutput {
  type: 'image' | 'video'
  url: string
  thumbnailUrl?: string
}

export interface Run {
  id: string
  status: RunStatus
  progress: number
  outputs: RunOutput[]
  /** 失败原因，已是当前界面语言 */
  error?: string
  /** 失败原因的稳定标识，需要按原因分支时用它，不要去匹配文字 */
  errorCode?: string
  cost?: Cost
  model: string
  kind: ModelKind
  createdAt?: string
  startedAt?: string
  finishedAt?: string
}

export interface RunRequest {
  model: string
  prompt: string
  imageUrls?: string[]
  videoUrls?: string[]
  params?: Record<string, any>
  workflowId?: string
  nodeId?: string
}

export interface LlmTask {
  status: RunStatus
  text?: string
  error?: string
  errorCode?: string
  cost?: Cost
  progress?: number
}

export interface ProviderField {
  key: string
  label: string
  secret?: boolean
  required?: boolean
  placeholder?: string
  help?: string
}

export interface ProviderType {
  type: string
  label: string
  fields: ProviderField[]
  defaultBaseUrl?: string
}

export interface ProviderInstance {
  id: string
  type: string
  name: string
  baseUrl?: string
  enabled: boolean
  hasKey: boolean
  keyTail?: string
  [extra: string]: any
}

export interface ProviderTestResult {
  ok: boolean
  message?: string
  modelCount?: number
}

/** 设置页里的模型行：ModelSpec 加上启用状态与排序 */
export interface AdminModel extends ModelSpec {
  enabled: boolean
  sort?: number
  providerName?: string
}

export interface AdminSettings {
  siteName: string
  logoUrl: string
  defaultTheme: ThemeMode
  defaultLocale: string
  concurrency: number
  imageTimeoutMinutes: number
  videoTimeoutMinutes: number
  maxRetries: number
  retentionDays: number
}

export interface UsageSummaryRow {
  key: string
  label?: string
  runs: number
  succeeded?: number
  failed?: number
  amount: number
  currency: string
  unknownCount?: number
}

export interface UsageRecord {
  id: string
  createdAt: string
  model: string
  kind: ModelKind
  status: RunStatus
  cost?: Cost
  workflowId?: string
}
