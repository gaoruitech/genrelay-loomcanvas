import { computed, type ComputedRef } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { backendCapabilities } from '@/utils/canvasBackend'
import { t } from '@/locales'
import type { ModelAdapter } from '@/utils/canvasModels'

/** 站内文件的地址是相对的（/files/...）；上游要按地址来取，只认 http(s) 开头的公网地址 */
const isAbsolute = (url: string) => /^https?:\/\//i.test(url)

/**
 * 「参考素材只能按公网地址交给上游，而这个实例没有公网地址」—— 这句话要在运行之前说。
 *
 * 有些模型的参考图只收公网地址（ModelSpec.imageByUrlOnly），视频编辑的源视频对所有
 * 模型都只能给地址。实例既没配 PUBLIC_URL、文件又不在公网能访问的桶里时，后端会在
 * 请求发出之前拒绝；等到点了运行才看到那句报错太晚，所以节点面板里提前说明原因和做法。
 *
 * 纯函数：节点面板和执行器的校验共用同一个判断。返回空串表示没有问题。
 */
export function publicUrlProblem(
  adapter: ModelAdapter | null,
  input: { imageUrls?: string[]; imagePending?: boolean; videoUrl?: string | null; videoPending?: boolean },
): string {
  if (!adapter) return ''
  // 老版本后端没有这一项：不知道就不说
  const known = backendCapabilities().upstreamByUrl
  if (known === undefined || known) return ''
  if (adapter.videoEdit && (input.videoPending || (input.videoUrl && !isAbsolute(input.videoUrl)))) {
    return t('gen.publicUrl.video')
  }
  if (adapter.spec.imageByUrlOnly && (input.imagePending || (input.imageUrls || []).some(u => !isAbsolute(u)))) {
    return t('gen.publicUrl.image', { model: adapter.label })
  }
  return ''
}

/**
 * 节点面板用：连了图片（或视频）输入就算，哪怕上游还没出结果 ——
 * 这个应用里生成、上传的东西都存在站内，出来的一定是站内地址。
 */
export function usePublicUrlNotice(
  nodeId: string,
  adapter: ComputedRef<ModelAdapter | null>,
  imageRefs: ComputedRef<{ url: string }[]>,
  /** 不是连线连进来、但运行时也会一起发出去的图（品牌包的参考图） */
  extraImages?: () => string[],
): ComputedRef<string> {
  const { edges } = useVueFlow()
  const connected = (kind: 'image' | 'video') =>
    edges.value.some(e => e.target === nodeId && String(e.sourceHandle || '').split('-')[0] === kind)
  return computed(() => publicUrlProblem(adapter.value, {
    imageUrls: [...imageRefs.value.map(r => r.url), ...(extraImages?.() || [])],
    imagePending: !imageRefs.value.length && connected('image'),
    videoPending: connected('video'),
  }))
}
