import { runtime } from '@/embed/runtime'

/**
 * 「按空间的」状态怎么在换空间时清干净。
 *
 * 页面自己的状态不用管：换空间时外壳里的页面整个重建（App.vue 给 router-view 的 key 带着空间）。
 * 要管的是模块级的缓存（模型清单这一类，活得比页面长）：在这里登记一个清空函数，
 * 换空间的那一刻（请求头已经换成新空间之前）统一清掉，新空间的数据由各自的加载函数重取。
 *
 * 另一半是「在路上的请求」：发出去时是旧空间的，回来时人已经在新空间了。
 * 用 spaceToken() 记下发出时的空间，回来时用 sameSpace() 比一下，不一样就把结果扔掉。
 */
const resets = new Set<() => void>()

/** 登记一个换空间时要跑的清空函数；返回值用来注销 */
export function onSpaceReset(fn: () => void): () => void {
  resets.add(fn)
  return () => { resets.delete(fn) }
}

/** 换空间的那一刻由 stores/space 调 */
export function resetSpaceState(): void {
  for (const fn of [...resets]) {
    try { fn() } catch (err) { console.error('[loomcanvas] space reset failed', err) }
  }
}

/** 发请求之前取一个；见 sameSpace */
export function spaceToken(): number {
  return runtime.spaceEpoch
}

/** 从取 token 到现在，空间有没有换过。换过就不要把结果写进任何活得比页面长的地方 */
export function sameSpace(token: number): boolean {
  return token === runtime.spaceEpoch
}

/** 当前空间的标识：个人空间是 'personal'，团队是它的 id。用来给按空间存的本机状态起键名 */
export function currentSpaceKey(): string {
  return runtime.space || 'personal'
}
