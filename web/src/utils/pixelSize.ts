/**
 * 像素尺寸怎么写，全站一种：1080×1920 —— 乘号两边不留空格，两种语言一样。
 * 工具节点结果上的角标、导出 / 切片格子的提示、图片编辑器的标题都是这一种写法；素材库卡片上的那一行也用它。
 * 少了一边（没量到、老数据里是 0）返回空串：没有这个数就不写。
 */
export function pixelSize(width: unknown, height: unknown): string {
  const w = Math.round(Number(width))
  const h = Math.round(Number(height))
  return w > 0 && h > 0 ? `${w}×${h}` : ''
}
