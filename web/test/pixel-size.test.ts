import { describe, expect, it } from 'vitest'
import { pixelSize } from '../src/utils/pixelSize'

/** 像素尺寸全站一种写法：1080×1920，乘号两边不留空格（和工具节点、图片编辑器里的写法一致） */
describe('pixel size', () => {
  it('writes width×height without spaces', () => {
    expect(pixelSize(1080, 1920)).toBe('1080×1920')
    expect(pixelSize('2048', 2048.4)).toBe('2048×2048')
  })
  it('says nothing when a side is missing', () => {
    expect(pixelSize(0, 1080)).toBe('')
    expect(pixelSize(1080, undefined)).toBe('')
    expect(pixelSize(null, null)).toBe('')
    expect(pixelSize(Number.NaN, 10)).toBe('')
  })
})
