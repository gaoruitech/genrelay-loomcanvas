import { t } from '@/locales'
import type { Person, PersonState } from '@/types'

/**
 * 界面上提到一个人（画布的创建人、素材是谁加的、邀请链接是谁建的、动态里的操作人、服务商的维护人……）
 * 时怎么写，全站只有这一份；带头像、带标签的写法是 components/PersonName.vue，它也用这里的函数。
 *
 *  - 还在的人：名字（团队里的显示名，没有就是用户名）。
 *  - 已离开团队 / 账号已删除：名字照旧（服务端留着他们离开时的名字），后面跟一个状态标签。
 *  - 名字没留下来（很早以前离开的人、谁也不认识的 id）：写一个中性的称呼「前成员」/「已删除的账号」，
 *    这时不再跟标签——称呼本身已经说了同一件事。
 */

type Who = Partial<Person> | null | undefined

/** 这个人现在的状态。老服务端只给 left / deleted 两个布尔值 */
export function personState(p: Who): PersonState {
  if (!p) return 'active'
  if (p.state === 'active' || p.state === 'left' || p.state === 'deleted') return p.state
  if (p.deleted) return 'deleted'
  if (p.left) return 'left'
  return 'active'
}

/** 留下来的名字；没有就是空串 */
export function personKeptName(p: Who): string {
  return (p && (p.name || p.username)) || ''
}

/** 界面上叫什么：名字；名字没留下来时是中性的称呼 */
export function personName(p: Who): string {
  const kept = personKeptName(p)
  if (kept) return kept
  const state = personState(p)
  if (state === 'deleted') return t('spaces.person.deletedAccount')
  if (state === 'left') return t('spaces.person.former')
  return t('spaces.person.unknown')
}

/** 名字后面的状态标签：已离开团队 / 账号已删除；还在的人、名字已经是中性称呼的人没有 */
export function personNote(p: Who): string {
  const state = personState(p)
  if (state === 'active' || !personKeptName(p)) return ''
  return t(state === 'deleted' ? 'spaces.person.deleted' : 'spaces.person.left')
}

/** 这个人已经不在团队里了（离开了，或账号被删了） */
export function personGone(p: Who): boolean {
  return !p || personState(p) !== 'active'
}

/** 一行写完：周屿 · 已离开团队 */
export function personTitle(p: Who): string {
  const note = personNote(p)
  return note ? `${personName(p)} · ${note}` : personName(p)
}

/**
 * 存下来的模板 / 文本片段是谁存的：「我保存的」/「周屿 保存」/「周屿 · 已离开团队 保存」。
 * 内置的没有作者；个人空间里都是自己存的，卡片上的「我保存的」标签已经说了，不再写一遍（返回空串）。
 */
export function savedByText(item: { builtin?: boolean; mine?: boolean; createdBy?: Who } | null | undefined, inTeam: boolean): string {
  if (!item || item.builtin !== false || !inTeam) return ''
  if (item.mine) return t('library.saved.mine')
  return item.createdBy ? t('library.saved.by', { name: personTitle(item.createdBy) }) : ''
}

/** 名字下面那行小字：还在的人写 @用户名，不在的写去向 */
export function personSub(p: Who): string {
  return personNote(p) || (p?.username && personState(p) === 'active' ? `@${p.username}` : '')
}
