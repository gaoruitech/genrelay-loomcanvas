/**
 * 后端内置内容的界面语言版本。
 *
 * 内置模板的标题 / 说明 / 预填提示词、模型声明里的一句话说明，都是后端写死的一种语言。
 * 它们各有稳定的标识（模板 key、模型标识），这里按标识到语言文件里取当前语言的写法；
 * 语言文件里没有的（用户自己加的模板、自动发现的模型）原样返回后端给的内容。
 */
import { i18n } from '@/locales'

interface TemplateLike {
  key: string
  title: string
  description?: string
  graph?: { nodes?: any[]; [k: string]: any }
  [k: string]: any
}

interface TemplateText {
  title?: string
  description?: string
  /** 模板里各文本节点的预填内容，按模板内的节点 id */
  texts?: Record<string, string>
}

/** 取一棵消息子树。键里可能带点号（模型标识），不能按「点号分隔的路径」去取单条 */
function subtree<T>(path: string): Record<string, T> {
  const { tm } = i18n.global
  const v = tm(path) as unknown
  return v && typeof v === 'object' ? (v as Record<string, T>) : {}
}

const text = (v: unknown): string => (v == null ? '' : i18n.global.rt(v as any))

export function localizeTemplates<T extends TemplateLike>(list: T[]): T[] {
  const dict = subtree<TemplateText>('library.builtinTemplates')
  return list.map((tpl) => {
    const loc = dict[tpl.key]
    if (!loc) return tpl
    const texts = loc.texts || {}
    const nodes = (tpl.graph?.nodes || []).map((n: any) =>
      (n?.id in texts && n?.data ? { ...n, data: { ...n.data, text: text(texts[n.id]) } } : n))
    return {
      ...tpl,
      title: text(loc.title) || tpl.title,
      description: text(loc.description) || tpl.description,
      graph: tpl.graph ? { ...tpl.graph, nodes } : tpl.graph,
    }
  })
}

/** 模型下拉里的一句话说明。modelId 形如 `gaorui:nano-banana-2.1`，按冒号后面的模型标识查 */
export function localizedModelDesc(modelId: string, fallback?: string): string | undefined {
  if (!fallback) return fallback
  const bare = modelId.slice(modelId.indexOf(':') + 1)
  const loc = subtree<unknown>('models.catalogDesc')[bare]
  return loc ? text(loc) : fallback
}
