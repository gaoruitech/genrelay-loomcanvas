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
  /** 服务端的硬限制；老版本后端没有这一项 */
  limits?: { maxUploadMb?: number }
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
  /** 所属服务商实例的名称 */
  providerName?: string
  label: string
  desc?: string
  tag?: string
  kind: ModelKind
  acceptsImage?: boolean
  acceptsVideo?: boolean
  videoEdit?: boolean
  /** 用户自己添加的模型（不在服务商的模型清单里） */
  custom?: boolean
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
  /** 项目用真实接口跑通这个模型的日期（YYYY-MM-DD）；只有服务商清单里的模型可能有 */
  verified?: string
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

/** 服务商模型清单里的一项。model 是上游模型名 */
export interface VendorModel extends Omit<ModelSpec, 'id' | 'providerId' | 'pricing'> {
  model: string
}

/** 一个服务商：名字、官方地址、它支持的全部模型，以及自定义模型能选的类型和各自得到的参数 */
export interface Vendor {
  type: string
  label: string
  recommended: boolean
  /** 申请 API Key 的地址；没有则为空 */
  keyUrl: string
  defaultBaseUrl: string
  models: VendorModel[]
  customKinds: ModelKind[]
  customDefaults: Partial<Record<ModelKind, Omit<VendorModel, 'model' | 'label'>>>
}

export interface CustomModel {
  model: string
  kind: ModelKind
  label: string
}

export interface ProviderInstance {
  id: string
  /** 服务商标识 */
  type: string
  name: string
  slug: string
  baseUrl?: string
  /** 地址是否改成了官方地址以外的 */
  customBaseUrl?: boolean
  customModels: CustomModel[]
  enabled: boolean
  hasKey: boolean
  keyTail?: string
}

export interface ProviderTestResult {
  ok: boolean
  message?: string
}

/** 设置页里的模型行：ModelSpec 加上启用状态与排序 */
export interface AdminModel extends ModelSpec {
  enabled: boolean
  sort?: number
  /** 所属服务商的标识 */
  providerType?: string
  providerEnabled?: boolean
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
  submitTimeoutSec: number
  chatTimeoutSec: number
  downloadTimeoutSec: number
}

export type StoragePreset = 'aws' | 'r2' | 'oss' | 'minio' | 'custom'
export type StorageDelivery = 'proxy' | 'redirect'

/** S3 兼容存储的配置表单。secretAccessKey 只写不读，留空表示沿用已保存的 */
export interface StorageS3Form {
  preset: StoragePreset
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  keyPrefix: string
  publicBaseUrl: string
  delivery: StorageDelivery
  acl: '' | 'private' | 'public-read'
}

export interface StorageStatus {
  /** 当前生效的选择来自哪里：在设置页保存的 / 环境变量 / 什么都没配（本地磁盘） */
  source: 'saved' | 'env' | 'default'
  driver: 'local' | 's3'
  delivery: '' | StorageDelivery
  envDriver: 'local' | 's3'
  /** 已保存的密钥解不开（SECRET_KEY 变了），需要重新填写 */
  secretUnreadable: boolean
  s3: (Omit<StorageS3Form, 'secretAccessKey'> & { hasSecret: boolean; secretTail: string; endpointHost: string }) | null
  /** 不再写入、但仍在读取的旧存储桶 */
  previous: { endpointHost: string; bucket: string; keyPrefix: string }[]
}

export interface StorageTestStep {
  step: 'put' | 'head' | 'get' | 'public' | 'delete'
  status: 'ok' | 'failed' | 'skipped'
  ms?: number
}

export interface StorageTestResult {
  ok: boolean
  steps: StorageTestStep[]
  message: string
  code: string
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
