/** 后端统一返回包：result 非 0 表示失败 */
export interface ApiResponse<T = any> {
  result: number
  message?: string
  data?: T
  code?: string
}

export type LocaleCode = 'zh-CN' | 'en'

export interface User {
  id: string
  username: string
  /** 服务端启动时自动创建的超级管理员可以没有邮箱（空串）；注册的账号一定有 */
  email: string
  /** owner：这台实例的超级管理员（服务端启动时自动创建，不靠注册产生），能管存储、运行限制、站点和其他用户 */
  role: 'owner' | 'user'
  /** 现在的密码是别人知道的（启动时生成的 / 被重置出来的临时密码）：改掉之前接口只放行改密码 */
  mustChangePassword?: boolean
  /** 这个账号对界面的偏好，存在服务端，换浏览器也跟着走；老版本后端没有这一项 */
  prefs?: UserPrefs
  createdAt: string
}

export interface UserPrefs {
  /** 画布上生成节点的布局：a 结果优先 + 输入条（默认）/ b 紧凑节点 + 右侧属性面板 / c 全部放在节点上 */
  nodeLayout?: 'a' | 'b' | 'c'
  /** 界面主题：dark 深色（默认）/ light 浅色 / system 跟随系统 */
  theme?: 'dark' | 'light' | 'system'
}

/** 超级管理员在「用户管理」里看到的一行 */
export interface AdminUser extends User {
  disabled: boolean
  lastLoginAt?: string | null
  counts?: { workflows?: number; runs?: number }
  /** 能不能创建团队（超级管理员恒为 true） */
  canCreateTeams?: boolean
  /** 加入了几个团队、其中几个是团长 */
  teams?: { member: number; owned: number }
}

export interface AuthSession {
  id: string
  current: boolean
  createdAt: string
  lastSeenAt?: string | null
  userAgent?: string
  ip?: string
}

export interface SiteSettings {
  registrationOpen: boolean
}

export interface BootstrapInfo {
  /** 注册是否开放（超级管理员的设置）；注册出来的永远是普通用户 */
  auth?: { registrationOpen: boolean }
  /** 当前登录的账号；没登录是 null */
  user?: User | null
  site: {
    name?: string
    logoUrl?: string
    /** 有 Logo 时，旁边要不要写站点名称（showSiteName 这项设置）；老版本后端没有这一项，按显示算 */
    showName?: boolean
    defaultLocale?: string
  }
  hasProvider: boolean
  version?: string
  /** 服务端的硬限制；老版本后端没有这一项 */
  limits?: { maxUploadMb?: number }
  /**
   * upstreamByUrl：上游能不能按地址读到站内文件（配了公网的 PUBLIC_URL，或文件在公网能访问的桶里）。
   * writable：现在存不存得了新文件；false 时上传和出图 / 出片的运行会被拒绝（存储桶的密钥解不开）。
   * 老版本后端没有 media，或者只有前一项。
   */
  media?: { upstreamByUrl?: boolean; writable?: boolean }
  /** 调用者能进的所有空间：先是个人空间，然后是加入的团队。老版本后端没有这四项 */
  spaces?: SpaceSummary[]
  /** 这个请求作用的空间（X-Space 指定，不带就是个人空间） */
  space?: CurrentSpace | null
  /** X-Space 指向一个进不去的团队时才有；这时 space 是个人空间 */
  spaceError?: SpaceErrorCode
  /** 调用者能不能创建团队 */
  teams?: TeamCreation | null
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
  /** 参考图只能以公网地址交给上游（不收内联数据）；没有公网地址的图会在请求发出前被拒绝 */
  imageByUrlOnly?: boolean
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
  /** 存着 Key、但已经解不开（SECRET_KEY 变了）：重新填写之前这个服务商不能用。成员也拿得到这一项 */
  keyUnreadable?: boolean
  /** 团队里的成员拿到的是受限的：没有 Key 末几位、没有地址 */
  restricted?: boolean
  /** 维护人：最后一次真的改了这个服务商的人（改名、地址、Key、开关、自定义模型）。可能已经离开团队 */
  maintainer?: Person | null
  /** 最近一次连接测试；null = 没测过，或者测过之后 Key / 地址变了。团队成员（restricted）永远拿到 null */
  lastTest?: { ok: boolean; at: string; message: string } | null
  updatedAt?: string
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
  /** 有 Logo 时旁边要不要写站点名称；老后端没有这一项 */
  showSiteName?: boolean
  defaultLocale: string
  concurrency: number
  /** 一个账号最多同时占用多少个并发位 */
  userConcurrency: number
  /** 一个账号最多能有多少个未结束的运行（排队 + 运行中） */
  userQueueLimit: number
  imageTimeoutMinutes: number
  videoTimeoutMinutes: number
  maxRetries: number
  retentionDays: number
  submitTimeoutSec: number
  chatTimeoutSec: number
  downloadTimeoutSec: number
  /** 每个账号最多创建几个团队 */
  teamMaxPerUser?: number
  /** 每个团队最多多少成员 */
  teamMaxMembers?: number
  /** 一个团队同时在跑的运行的合计上限（默认值，可以给某个团队单独设） */
  teamConcurrency?: number
  /** 团队动态保留多少天，0 表示永久 */
  teamActivityDays?: number
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
  /** 同一个 S3 服务在公网上的地址：只用来生成交给上游模型的签名地址；Endpoint 只在内网能用时才需要 */
  presignEndpoint: string
  delivery: StorageDelivery
  acl: '' | 'private' | 'public-read'
}

/**
 * 现在存下的文件怎么交给上游模型：桶的公开地址 / 临时签名地址 / 经本站（PUBLIC_URL）/ 没有上游打得开的地址。
 * unavailable：现在根本存不了新文件（原因在 upstreamReason）—— 这不是一种交付方式，也不是要改的配置。
 */
export type StorageUpstream = 'public_base' | 'signed' | 'app' | 'inline' | 'unavailable'

/** 会去查找文件的一个存储桶（GET /api/admin/storage 的 buckets[]），正在写入的排第一 */
export interface StorageBucket {
  id: string
  endpointHost: string
  bucket: string
  keyPrefix: string
  /** 设置页保存的 / S3_* 环境变量描述的 */
  origin: 'saved' | 'env'
  /** 新文件正写在这里 */
  active: boolean
  /** ok：没发现连不上；unreachable：没有回应；secret_unreadable：保存的密钥解不开 */
  state: 'ok' | 'unreachable' | 'secret_unreadable'
  /** 从什么时候起连不上（ISO 时间），只在 unreachable 时有 */
  downSince?: string
  /** 能不能从列表里去掉（DELETE /api/admin/storage/buckets/:id） */
  removable: boolean
}

export interface StorageStatus {
  /** 当前生效的选择来自哪里：在设置页保存的 / 环境变量 / 什么都没配（本地磁盘） */
  source: 'saved' | 'env' | 'default'
  driver: 'local' | 's3'
  delivery: '' | StorageDelivery
  envDriver: 'local' | 's3'
  /** 已保存的密钥解不开（SECRET_KEY 变了），需要重新填写 */
  secretUnreadable: boolean
  /** false：新文件被拒绝（正在使用的就是密钥解不开的那个桶）。老版本后端没有这一项 */
  writable?: boolean
  /** 现在存下的文件怎么交给上游模型。老版本后端没有这一项 */
  upstream?: StorageUpstream
  /** upstream 为 unavailable 时的原因（现在只有 secret_unreadable）；其余时候是空串 */
  upstreamReason?: '' | 'secret_unreadable'
  s3: (Omit<StorageS3Form, 'secretAccessKey'> & { hasSecret: boolean; secretTail: string; endpointHost: string }) | null
  /** 不再写入、但仍在读取的旧存储桶 */
  previous: { endpointHost: string; bucket: string; keyPrefix: string }[]
  /** 会去查找文件的每一个存储桶和它现在的状态。老版本后端没有这一项 */
  buckets?: StorageBucket[]
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
  canceled?: number
  /** 此刻还在排队、运行或转存的条数；reserved 是它们占着的金额（按币种） */
  inProgress?: number
  reserved?: Record<string, number>
  /** 计入每月上限的次数 = succeeded + inProgress */
  counted?: { runs: number }
  /** 按币种分开的花费合计；amount / currency 只是其中最大的一笔 */
  costs?: Record<string, number>
  /** groupBy=member 时：这一行是谁 */
  member?: Person
}

/** 对话运行里上游报的 token 数；图片 / 视频运行、上游没报的都是 null */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/**
 * 生成记录里的一条（docs/api.zh-CN.md「用量与生成记录」）。
 * 列表里提示词只给前 200 个字符、对话的回复只给前 500 个（promptTruncated / textTruncated 说有没有截），
 * 按 id 读单条（或列表带 full=1）才是全文，还多出 systemPrompt / imageUrls / videoUrls。
 */
export interface UsageRecord {
  id: string
  createdAt: string
  model: string
  kind: ModelKind
  status: RunStatus
  /** 0–100；没跑完的记录轮询时跟着变 */
  progress?: number
  /** 提交时按价格表估的；成功后是这次运行算下来的花费。失败、取消的运行不计费（见 historyFormat 的 costOf） */
  cost?: Cost
  workflowId?: string
  modelLabel?: string
  providerType?: string
  prompt?: string
  promptLength?: number
  promptTruncated?: boolean
  params?: Record<string, any>
  count?: number
  /** 随提示词一起发出去的参考图 / 视频各有几个 */
  inputs?: { images: number; videos: number }
  usage?: TokenUsage | null
  /** 对话的回复；图片 / 视频运行、还没成功的都是空串 */
  text?: string
  textLength?: number
  textTruncated?: boolean
  /** 图片 / 视频运行的结果文件。成功了却是空的、filesPurged 为 true：文件已按保留期清理 */
  outputs?: RunOutput[]
  filesPurged?: boolean
  /** 失败原因（或不是人点的取消的原因），已是当前界面语言 */
  error?: string
  /** 稳定的错误码（run.timeout_chat、run.canceled_account_disabled……） */
  errorCode?: string
  nodeId?: string
  startedAt?: string | null
  finishedAt?: string | null
  /** 排队等了多久、跑了多久（毫秒）；那一段还没结束时是 null */
  queuedMs?: number | null
  durationMs?: number | null
  /** 团队里：谁发起的 */
  createdBy?: Person | null
  /** 只有单条 / full=1 才有 */
  systemPrompt?: string
  imageUrls?: string[]
  videoUrls?: string[]
}

/* ====================== 空间与团队（docs/api.zh-CN.md「空间与团队」） ====================== */

/** 团队里的角色：团长 / 管理员 / 成员。和站点角色（User.role）是两回事 */
export type TeamRole = 'owner' | 'admin' | 'member'
export type TeamStatus = 'active' | 'suspended' | 'dissolved'
export type CanvasVisibility = 'private' | 'team_view' | 'team_edit'

/** 权限矩阵里调用者那一列：true / false，或 null（要看具体画布或成员） */
export type SpacePermissions = Record<string, boolean | null>

export interface TeamSettings {
  defaultVisibility: CanvasVisibility
  publicShare: 'editors' | 'managers'
  adminsSeeAll: boolean
  copyToPersonal: boolean
  blockUnpriced: boolean
}

/** bootstrap.spaces 里的一项：个人空间（id 为 personal），或加入的团队 */
export interface SpaceSummary {
  id: string
  kind: 'personal' | 'team'
  name: string
  role: TeamRole
  avatar?: string
  ownerId?: string
  status?: TeamStatus
  members?: number
  maxMembers?: number
  timezone?: string
  dissolvedAt?: string | null
  purgeAt?: string | null
  createdAt?: string
}
export type Team = SpaceSummary & { kind: 'team' }

/** bootstrap.space：这个请求作用的空间 */
export interface CurrentSpace {
  id: string
  kind: 'personal' | 'team'
  name: string
  role: TeamRole
  permissions: SpacePermissions
  settings: TeamSettings | null
}

export type SpaceErrorCode = 'team.not_found' | 'team.dissolved' | 'team.suspended'

export interface TeamCreationRequest {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  note: string
  reason: string
  createdAt: string
  decidedAt?: string | null
}

/** 调用者能不能创建团队 */
export interface TeamCreation {
  authorised: boolean
  canCreate: boolean
  held: number
  max: number
  maxMembers: number
  request: TeamCreationRequest | null
}

/** 接口里凡是提到团队里的某个人 */
export type PersonState = 'active' | 'left' | 'deleted'
/**
 * name / username 是这个人离开时用的名字（服务端留着），只有很早以前离开的人、谁也不认识的 id 才是空串。
 * 怎么显示统一走 utils/person.ts 和 components/PersonName.vue。
 */
export interface Person {
  id: string
  username: string
  name: string
  /** 还在 / 已离开团队（账号还在）/ 账号已删除。老服务端没有这一项时看下面两个 */
  state?: PersonState
  left?: boolean
  deleted?: boolean
}

export interface LimitMeter { used: number; limit: number | null; remaining: number | null }
/** 一项上限现在的状态。由服务端给（effective），前端不自己从 used / limit 再算一遍 */
export type LimitState = 'unlimited' | 'ok' | 'near' | 'reached'
export interface LimitMeterState extends LimitMeter { state: LimitState }
/** 现在提交一次运行会被哪一项上限拦下（就是拒绝码 budget.* 的后半截） */
export type LimitBlockedBy = 'member_runs' | 'team_runs' | 'member_amount' | 'team_amount'

/** 「已用」背后的明细。已用 = 已成功 + 进行中；失败、取消的不计 */
export interface LimitBreakdown {
  succeeded: { runs: number; amount: number; unknownCost: number }
  inProgress: { runs: number; amount: number; unknownCost: number }
  failed: { runs: number }
  canceled: { runs: number }
  counted: { runs: number; amount: number }
  /** 计了次数、但金额算不出来的运行有几次 */
  unknownCost: number
}
export interface LimitEffective {
  runs: LimitMeterState
  amount: LimitMeterState
  /** 两项里更紧的那个；blockedBy 有值时一定是 reached */
  state: LimitState
  blockedBy: LimitBlockedBy | null
  uncounted: number
}
/** 上限的一侧：团队的，或者某一个成员的 */
export interface LimitSide {
  runs: LimitMeter
  amount: LimitMeter
  uncounted: number
  custom?: { runs: boolean; amount: boolean }
  breakdown: LimitBreakdown
  effective: LimitEffective
}
export interface PersonRef { id: string; name: string }
/** 因为价格算不进金额上限的模型 */
export interface UncountableModel {
  id: string
  label: string
  reason: 'unpriced' | 'currency'
  /** reason 为 currency 时：模型的价格用的币种 */
  modelCurrency: string
  /** 在它上面发起运行会被拒绝的码 */
  code: 'budget.unpriced_model' | 'budget.currency_mismatch'
}

/** 每月上限（GET /api/teams/:id/limits） */
export interface TeamLimits {
  /** 2026-10：团队时区里的自然月 */
  month: string
  timezone: string
  startsAt?: string
  resetsAt: string
  currency: string
  blockUnpriced: boolean
  member: LimitSide
  /** 该找谁：上限归团长设，价格团长和管理员都能填 */
  managers?: { owner: PersonRef | null; admins: PersonRef[] }
  /** 「我」现在因为价格跑不了的模型，服务端已经算好（团队详情里带的那一份没有这一项） */
  cannotRun?: { moneyLimited: boolean; blockUnpriced: boolean; models: UncountableModel[] }
  team?: LimitSide
  memberDefault?: { runs: number | null; amount: number | null }
  /** ?members=1 时：每个成员一份 */
  members?: (LimitSide & { id: string; name: string; username: string; role: TeamRole })[]
  /** 团长、管理员才有：全队范围内算不进去的模型，和后果 */
  uncountable?: (UncountableModel & { blocked: 'everyone' | 'some' | 'none' })[]
  unpriced?: {
    models: number
    moneyLimited: 'everyone' | 'some' | 'none'
    blockUnpriced: boolean
    blocked: 'everyone' | 'some' | 'none'
    effect: 'refused' | 'runs_only' | 'none'
  }
}

/** 每月上限拒绝一次运行时（403 budget.*）带的 data */
export interface BudgetRefusalData {
  scope?: 'member' | 'team'
  unit?: 'runs' | 'amount'
  limit?: number | null
  used?: number
  remaining?: number
  requested?: number
  /** requested 是什么：一次运行 / 预估金额 / 对话模型的预留 / 没有金额可言 */
  requestedKind?: 'run' | 'estimate' | 'reserve' | 'none'
  currency?: string
  month?: string
  timezone?: string
  resetsAt?: string
  resetsAtLocal?: string
  reason?: 'unpriced' | 'currency'
  model?: { id: string; label: string }
  modelCurrency?: string
  canChange?: { roles: string[]; owner: PersonRef | null; admins: PersonRef[] }
}
export type BudgetRefusalCode =
  | 'budget.member_runs' | 'budget.team_runs' | 'budget.member_amount' | 'budget.team_amount'
  | 'budget.unpriced_model' | 'budget.currency_mismatch'
export interface BudgetRefusal {
  code: BudgetRefusalCode
  data: BudgetRefusalData
  /** 服务端给的整句话：data 不全（老服务端、宿主自己的后端）时用它 */
  message?: string
}

export interface TeamDetail extends Team {
  settings: TeamSettings
  me: { id: string; role: TeamRole; displayName: string; joinedAt: string }
  permissions: SpacePermissions
  onboarding: { hasProvider: boolean; hasMembers: boolean; hasCanvas: boolean }
  limits: TeamLimits | null
  /** 团队同时在跑的运行数上限（超级管理员给这个团队单独设的，否则是全站的默认值） */
  concurrency?: number
}

export interface TeamMember {
  id: string
  username: string
  displayName: string
  name: string
  role: TeamRole
  joinedAt: string
  disabled: boolean
  /** 本月已用（已成功 + 进行中），和它背后的明细 */
  usage?: { runs: number; amount: number; uncounted: number; currency: string; breakdown?: LimitBreakdown }
  limits?: { runs: number | null; amount: number | null; custom: { runs: boolean; amount: boolean } }
  /** 这名成员本月上限的状态，服务端算好的 */
  effective?: LimitEffective
}

export type InvitationState = 'valid' | 'expired' | 'used_up' | 'revoked' | 'team_full' | 'team_unavailable'

export interface TeamInvitation {
  id: string
  /** SECRET_KEY 改过之后为空串：这样的链接只能撤销 */
  token: string
  createdBy: Person
  maxUses: number
  usedCount: number
  expiresAt: string
  revoked: boolean
  state: InvitationState
  /** 还能用几次：null = 不限次数，0 = 用完了。老服务端没有这一项 */
  remainingUses?: number | null
  createdAt: string
}

/** 加入页的预览（公开接口） */
export interface InvitationPreview {
  state: InvitationState
  team: { id: string; name: string; avatar: string; members: number; maxMembers: number; ownerName: string } | null
  /** 生成这条链接的人（他在团队里用的名字；人已经离开团队、账号已删除时也还是这个名字） */
  inviterName: string
  /** 链接用不了时该找谁重新生成：生成它的人还能再生成（还在团队里、是团长或管理员）就是他，否则是团长。团队已关闭时是空串；老服务端没有这一项 */
  contactName?: string
  expiresAt: string
  alreadyMember: boolean
  registrationOpen: boolean
  /** 还能用几次：数字 = 有次数限制的有效链接；null = 不限次数，或者链接已经用不了 */
  remainingUses?: number | null
}

/** 动态里的一条。怎么写成一句话见 components/team/activityText.ts */
export interface TeamActivityItem {
  id: string
  type: string
  category: string
  /** system：站点的超级管理员从团队外面做的（id 为空，name 是服务端按语言给的） */
  actor: Partial<Person> & { id: string; name: string; system?: boolean }
  /** person：对象是成员时，这个人现在的样子 */
  target?: { type: string; id: string; name: string; person?: Person } | null
  /** 每一项都可能没有（老记录） */
  detail?: Record<string, any>
  /** 服务端按当前语言写好的整句话：不认识的类型、缺字段的老记录用它 */
  message: string
  createdAt: string
}

/**
 * 编辑锁。锁属于一次编辑会话（一个标签页），不属于账号：
 * mine = 就是发请求的这个会话拿着；sameUser = 拿着的是我这个账号（mine 为 false 时就是「我在另一个标签页」）。
 * releaseToken 只有持有的那个会话看得到：页面关掉时凭它把锁还回去（那时带不了登录头）。
 */
export interface CanvasLock { by: Person; at: string; expiresAt: string; mine: boolean; sameUser?: boolean; releaseToken?: string }

export interface CanvasAccess {
  canView: boolean
  canEdit: boolean
  canDelete: boolean
  canSetVisibility: boolean
  canTakeOver: boolean
  canOverwrite: boolean
  canShare: boolean
}

/** 所有返回画布的接口多出来的字段（个人空间也有） */
export interface CanvasTeamFields {
  spaceId?: string
  visibility?: CanvasVisibility | ''
  createdBy?: Person | null
  revision?: number
  /** 改名（和清掉旧布局标记）才动的计数：告诉开着的编辑器「名字变了」，从不参与冲突 */
  metaRevision?: number
  lastEditedBy?: Person | null
  lastEditedAt?: string | null
  lock?: CanvasLock | null
  access?: CanvasAccess
}

/** 超级管理员看到的团队：只有名称和数字 */
export interface AdminTeam {
  id: string
  name: string
  avatar?: string
  status: TeamStatus
  owner: { id: string; username: string; usable: boolean }
  counts: { members: number; workflows: number; runs: number }
  maxMembers: number | null
  concurrency: number | null
  effective: { maxMembers: number; concurrency: number }
  dissolvedAt: string | null
  purgeAt: string | null
  createdAt: string
}

export interface AdminTeamRequest extends TeamCreationRequest {
  user: { id: string; username: string; email: string; disabled: boolean; canCreateTeams: boolean }
}

/** 素材分组：分组可以是空的，空了也不会自己消失（GET /api/user-asset/list 的 folderList） */
export interface AssetFolder {
  name: string
  /** 分组里的素材数（所有种类一起算，不受列表筛选影响） */
  count: number
  empty: boolean
  /** 空的，而且调用者删得了 */
  canDelete: boolean
}

/** 「复制到…」的一个去处不能用的原因（GET /api/spaces/copy-targets） */
export type CopyTargetReason = '' | 'same_space' | 'copy_out_disabled' | 'team_suspended' | 'team_dissolved' | 'asset_kind_full' | 'no_permission'
export interface CopyTarget {
  /** 复制接口的 toSpace：'personal' 或团队 id */
  id: string
  kind: 'personal' | 'team'
  /** 个人空间是空串 */
  name: string
  avatar: string
  role: TeamRole
  status: TeamStatus
  current: boolean
  available: boolean
  reason: CopyTargetReason
  /** 服务端按当前语言写好的原因 */
  message: string
}

/** 超级管理员彻底删除一个团队之后，各删掉了多少 */
export interface TeamPurgeResult {
  id: string
  name: string
  /** false：数据删了，文件还没有全部删完（某个存储连不上，或返回时还在删）；剩下的在后台继续删 */
  filesRemoved?: boolean
  counts?: Record<string, number>
  files?: number
}
