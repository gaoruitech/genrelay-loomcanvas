import { t } from '@/locales'
import type { ModelSpec } from '@/types'

type Caps = Pick<ModelSpec, 'kind' | 'acceptsImage' | 'acceptsVideo' | 'videoEdit' | 'maxReferenceImages' | 'options'>

/**
 * 一个模型能做什么，写成几条短句：参考图、输入视频、比例、分辨率、时长。
 * 设置页的「支持的模型」清单和自定义模型弹窗都用它，内容只来自模型声明本身。
 */
export function capsSummary(m: Caps): string[] {
  const o = m.options || {}
  const out: string[] = []
  const refs = Math.max(0, Number(m.maxReferenceImages) || 0)
  if (m.kind === 'chat') {
    out.push(m.acceptsImage && refs ? t('settings.caps.readsImages', { n: refs }) : t('settings.caps.textOnly'))
    if (m.acceptsVideo) out.push(t('settings.caps.readsVideo'))
    return out
  }
  if (m.videoEdit) out.push(t('settings.caps.sourceVideo'))
  out.push(m.acceptsImage && refs ? t('settings.caps.refs', { n: refs }) : t('settings.caps.noRefs'))
  if (o.imgModes?.includes('frames')) out.push(t('settings.caps.frames'))
  const ratios = (o.aspectRatios || []).map(v => (v === 'auto' ? t('models.auto') : v))
  if (ratios.length) out.push(t('settings.caps.ratios', { list: ratios.join(' ') }))
  if (o.resolutions?.length) out.push(t('settings.caps.resolutions', { list: o.resolutions.join(' / ') }))
  if (o.durations?.length) out.push(t('settings.caps.durations', { list: o.durations.join(' / ') }))
  if (o.counts && o.counts.length > 1) out.push(t('settings.caps.counts', { n: Math.max(...o.counts) }))
  return out
}
