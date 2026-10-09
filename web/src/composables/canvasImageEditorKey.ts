import type { InjectionKey } from 'vue'

export interface ImageEditorResult {
  /** 处理后上传得到的新地址 */
  url: string
  /** new = 生成新节点并连线；replace = 直接改写发起编辑的那个节点 */
  mode: 'new' | 'replace'
}

export interface ImageEditorApi {
  /**
   * 打开单图编辑器。nodeId 用来决定「替换当前」改哪个节点、「生成新节点」接在谁右边。
   * 用户取消时 resolve(null)。
   */
  open: (opts: { url: string; nodeId: string }) => Promise<ImageEditorResult | null>
}

export const CANVAS_IMAGE_EDITOR_KEY: InjectionKey<ImageEditorApi> = Symbol('canvasImageEditor')
