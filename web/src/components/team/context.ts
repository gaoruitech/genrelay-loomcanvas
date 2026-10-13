import { inject, provide, type InjectionKey, type Ref } from 'vue'
import type { Router } from 'vue-router'
import type { TeamDetail } from '@/types'

/**
 * 「团队」页给四个页签共用的东西：团队详情只取一次，谁改了会影响它的东西（名称、头像、设置、上限、人数）就 reload。
 */
export interface TeamPage {
  teamId: string
  detail: Ref<TeamDetail | null>
  /** 重新读团队详情；读不到时保留旧的 */
  reload: () => Promise<void>
  /**
   * 把一次失败说成一句话，并顺手做该做的事：
   *  - 空间已经不在了（被移出、解散、停用）：外壳会统一处理，这里返回空串，调用方不要再弹提示
   *  - team.forbidden：开着页面时角色变了，重取权限，页面跟着变
   *  - team.changed：重读团队
   */
  explain: (err: unknown, fallback?: string) => string
  /** explain 之后直接弹错误提示（空串不弹） */
  fail: (err: unknown, fallback?: string) => void
}

const KEY: InjectionKey<TeamPage> = Symbol('lc-team-page')

export function provideTeamPage(page: TeamPage) {
  provide(KEY, page)
}

export function useTeamPage(): TeamPage {
  const page = inject(KEY)
  if (!page) throw new Error('useTeamPage() outside the team page')
  return page
}

/** 一个上限输入框里的字 -> 接口要的值：空 = null（不限 / 跟默认值），否则是数字；填得不对返回 undefined */
export function parseLimitText(text: string, integer: boolean): number | null | undefined {
  const s = String(text ?? '').trim()
  if (!s) return null
  if (!(integer ? /^\d{1,10}$/ : /^\d{1,10}(\.\d{1,6})?$/).test(s)) return undefined
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : undefined
}

export const limitText = (v: number | null | undefined) => (v == null ? '' : String(v))

/** 货币的符号（¥ / $ / €）；认不出来就用代码本身 */
export function currencySymbol(currency: string, locale: string): string {
  try {
    const part = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((p) => p.type === 'currency')
    return part?.value || currency
  } catch {
    return currency
  }
}

/**
 * 自己离开了这个团队（退出、解散）：回到个人空间。
 * 先换地址：路由守卫进个人空间时会带着个人空间的请求头重取启动信息（团队列表跟着更新）。
 * 反过来先 refresh 的话，那一次还带着刚离开的团队的请求头，外壳会把它当成「被移出团队」再弹一次说明。
 */
export async function toPersonalSpace(router: Router, space: { refresh: () => Promise<void>; currentId: string }) {
  await router.replace({ name: 'home', query: { space: 'personal' } }).catch(() => undefined)
  if (space.currentId) await space.refresh()
}
