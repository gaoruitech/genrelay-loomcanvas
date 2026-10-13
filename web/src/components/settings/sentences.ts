/**
 * 把几句完整的话接成一段。设置页上的说明是按「这次挂载里有什么」拼出来的
 * （集成方可以关掉账号、语言 / 主题 / 节点布局的切换、模型管理、分享……关掉的东西说明里就不提），
 * 所以一段说明是几句各自成立的话：中文的句号后面不加空格，英文的句子之间加一个。
 */
export function joinSentences(parts: readonly (string | false | null | undefined)[], locale: string): string {
  const list = parts.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
  return list.join(/^(zh|ja|ko)\b/i.test(locale) ? '' : ' ')
}
