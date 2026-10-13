/**
 * 画布工具面板上两颗按钮叫什么 —— 跟着这一次挂载开着哪些功能走（embed 的 features）。
 * 纯函数，返回的是文案 key（或者「用那一项自己的名字」）；Canvas.vue 用它，web/test/options.test.ts 里有测。
 *
 * 起因：集成方只开了一部分功能时，按钮还叫全开时的名字 —— 模板关着，按钮写着「素材与模板」；
 * 对外链接关着，团队画布上那颗只能改团队权限的按钮写着「创建分享链接」。
 */

/**
 * 素材那一组入口（素材库 / 画布模板 / 我的分享）叫什么。
 * keys：真会出现的那几项，按顺序。素材库和画布模板都在才叫「素材与模板」；有素材库没有模板就是「素材库」；
 * 其余情况（只剩模板、只剩我的分享）返回空串：调用方直接用第一项自己的名字。
 */
export function libraryGroupLabelKey(keys: string[]): string {
  const has = (k: string) => keys.includes(k)
  if (has('library') && has('templates')) return 'canvas.pal.library'
  if (has('library')) return 'canvas.rail.library'
  return ''
}

/**
 * 分享那颗按钮叫什么，要和点开之后看到的对得上：
 *   个人画布                         创建分享链接
 *   团队画布，对外链接开着             分享与权限（两个页签）
 *   团队画布，对外链接关着             团队权限（只剩这一个页签）
 *   只读时各加上「（只读）」
 */
export function shareButtonLabelKey(o: { share: boolean; team: boolean; readOnly: boolean }): string {
  if (o.readOnly) return o.share ? 'canvas.readonly.share' : 'canvas.readonly.access'
  if (!o.share) return 'canvas.pal.access'
  return o.team ? 'canvas.pal.share' : 'canvas.topbar.share'
}
