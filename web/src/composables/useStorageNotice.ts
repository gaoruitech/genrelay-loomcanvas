/**
 * 运行之前就知道跑不了的两种情况，说在节点上（和「参考图只能给公网地址」那句是同一个位置）：
 *
 *  - 现在存不了新文件：出图 / 出片的运行会被服务端拒绝（503 storage.secret_unreadable）；
 *  - 选的模型所属的服务商，存着的 Key 解不开了：运行会被拒绝（400 provider.key_undecryptable）。
 *
 * 状态从哪来见 utils/storageHealth。这里只负责说明，不拦运行：拦不拦由服务端决定，
 * 这样管理员在别处修好之后，用户再点一次运行就能过，不会被一条过期的提示卡住。
 *
 * 每条说明可以带一个去处（能自己修的人才有）：超级管理员去「设置 → 存储」，能管服务商的人去「模型管理」。
 */
import { computed, type ComputedRef } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { adminApi, unwrap } from '@/utils/api'
import { backendCapabilities } from '@/utils/canvasBackend'
import { getAdapter, listChatModels } from '@/utils/canvasModels'
import { storageHealth, noteProviders, healthCheckDue } from '@/utils/storageHealth'
import { useAppStore } from '@/stores/app'
import { useSpaceStore } from '@/stores/space'
import { currentEmbed } from '@/embed/context'
import { t } from '@/locales'
import type { ModelSpec } from '@/types'

/** 说明后面跟着的那个链接：去哪儿、叫什么 */
export interface NoticeGo { label: string; to: RouteLocationRaw }
/** 运行前的一条说明 */
export interface RunNotice { text: string; go: NoticeGo | null }

/**
 * 问一次「哪些服务商的 Key 解不开」，最多一分钟一次（每个节点挂载时都会走到这里）。
 * 服务商列表谁都能取（成员拿到的是不含 Key 的那一份，但带着 keyUnreadable）。
 * 只嵌编辑器时接口由集成方的适配器提供，这个接口不一定有：不问。取不到就当没问过。
 * （存不存得了新文件不用问：启动信息里就有。）
 */
export function checkStorageHealth(): void {
  if (currentEmbed().mode === 'editor') return
  const app = useAppStore()
  if (!app.authed) return
  const space = useSpaceStore()
  if (!healthCheckDue(space.currentId || 'personal')) return
  adminApi.providers().then((res) => noteProviders(unwrap(res) || [])).catch(() => undefined)
}

/** 现在存不存得了新文件：这个页面自己后来得知的优先，否则是后端一开始说的；都没有就是不知道 */
export function storageWritable(): boolean | undefined {
  return storageHealth.writable ?? backendCapabilities().storageWritable
}

function specOf(modelId: string): ModelSpec | null {
  if (!modelId) return null
  return getAdapter(modelId)?.spec || listChatModels().find((s) => s.id === modelId) || null
}

/** 这个模型所属的服务商是不是 Key 解不开了 */
export function modelProviderDead(modelId: string): boolean {
  const spec = specOf(modelId)
  return !!spec && spec.providerId in storageHealth.deadProviders
}

/** 能不能自己去把 Key 填上：个人空间里是自己的服务商；团队里要有管理服务商的权限 */
function canFixProvider(): boolean {
  const space = useSpaceStore()
  return !space.isTeam || space.can('provider:manage')
}

/**
 * 选了这个模型现在跑不了的原因，一整句；跑得了返回空串。
 * 能管服务商的人：是哪家服务商、去哪儿重填。团队成员：只说暂不可用、该找谁。
 */
export function providerProblem(modelId: string): string {
  const spec = specOf(modelId)
  if (!spec || !(spec.providerId in storageHealth.deadProviders)) return ''
  if (!canFixProvider()) return t('canvas.storage.providerUnusable')
  return t('canvas.storage.providerKey', { provider: storageHealth.deadProviders[spec.providerId] || spec.providerName || '' })
}

/**
 * 模型下拉里那一行怎么标：右边的标签（「暂不可用」）和名字下面的一句原因。没问题返回 null。
 * 下拉里每一行都要写，所以是短的那一句；完整的说明在节点上（providerProblem）。
 */
export function providerMark(modelId: string): { tag: string; desc: string } | null {
  if (!modelProviderDead(modelId)) return null
  return { tag: t('canvas.storage.modelUnusable'), desc: t(canFixProvider() ? 'canvas.storage.modelWhy' : 'canvas.storage.modelWhyMember') }
}

/** 现在存不了新文件：出图 / 出片节点运行前的那一句；存得了（或不知道）返回空串 */
export function storageWriteProblem(): string {
  if (storageWritable() !== false) return ''
  return t(useAppStore().isOwner ? 'canvas.storage.notWritableOwner' : 'canvas.storage.notWritable')
}

/** 去「设置 → 存储」的链接：只有超级管理员看得到那一页；只嵌编辑器时没有这些页面 */
export function storageGo(): NoticeGo | null {
  if (currentEmbed().mode === 'editor' || !useAppStore().isOwner) return null
  return { label: t('canvas.storage.goStorage'), to: { name: 'settings', params: { section: 'storage' } } }
}

/** 去「模型管理」重填 Key 的链接：能管这个空间的服务商的人才有 */
function providerGo(): NoticeGo | null {
  if (currentEmbed().mode === 'editor' || !canFixProvider()) return null
  return { label: t('canvas.storage.goModels'), to: { name: 'models' } }
}

/**
 * 一个生成节点运行前要说的「现在跑不了」：服务商的 Key 解不开（各种节点），存不了新文件（出图 / 出片节点）。
 *
 * shown 是节点上此刻显示着的失败原因。运行被服务端拒绝之后，那里写的就是同一件事 ——
 * 这时不把整句再说一遍，只给能自己修的人留一句「修好就能运行」和去处；别人那里什么都不加。
 */
export function useRunBlockNotices(opts: { media: boolean; model: () => string; shown: () => string }): ComputedRef<RunNotice[]> {
  checkStorageHealth()
  const saidAlready = (said: string) => !!said && opts.shown().includes(said)
  return computed(() => {
    const out: RunNotice[] = []
    const provider = providerProblem(opts.model())
    if (provider) {
      const go = providerGo()
      if (!saidAlready(storageHealth.said.provider)) out.push({ text: provider, go })
      else if (go) out.push({ text: t('canvas.storage.providerKeyShort'), go })
    }
    const storage = opts.media ? storageWriteProblem() : ''
    if (storage) {
      const go = storageGo()
      if (!saidAlready(storageHealth.said.storage)) out.push({ text: storage, go })
      else if (go) out.push({ text: t('canvas.storage.notWritableShort'), go })
    }
    return out
  })
}
