import type { InjectionKey } from 'vue'

export type PickerMediaType = 'image' | 'video'

/** 素材选择器里的一项（来自「我的资产」或「素材库」） */
export interface PickerItem {
  id: string
  type: PickerMediaType
  name: string
  fileUrl: string
  thumbnailUrl?: string
}

export interface PickerOptions {
  mediaType: PickerMediaType
  multiSelect?: boolean
}

export interface PickerApi {
  /** 打开选择器，返回所选项数组。取消返回空数组。 */
  open(opts: PickerOptions): Promise<PickerItem[]>
}

export const CANVAS_PICKER_KEY: InjectionKey<PickerApi> = Symbol('canvas-picker')
