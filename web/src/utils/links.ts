import { currentLocale } from '@/locales'

/** 项目仓库。换了托管地址只改这一处。 */
const REPO = 'https://gitee.com/jishulin/loomcanvas'
const FILE = `${REPO}/blob/master`

/** 仓库里的一篇文档；中文界面给中文版 */
function doc(name: string): string {
  return `${FILE}/docs/${name}${currentLocale() === 'zh-CN' ? '.zh-CN' : ''}.md`
}

/** 站外链接：文档、源码、协议。都指向项目仓库。 */
export const LINKS = {
  repo: REPO,
  get docs() { return doc('README') },
  get gettingStarted() { return doc('getting-started') },
  get deployment() { return doc('deployment') },
  get faq() { return doc('faq') },
  get security() { return doc('security') },
  get integration() { return doc('integration') },
  /** 使用指南的「团队」一章（两种语言的章节锚点不同；中文锚点按百分号编码写，源码里不留中文字面量） */
  get teams() { return doc('user-guide') + (currentLocale() === 'zh-CN' ? '#%E5%9B%A2%E9%98%9F' : '#teams') },
  examples: `${REPO}/tree/master/examples`,
  license: `${FILE}/LICENSE`,
  commercial: `${FILE}/COMMERCIAL.md`,
  changelog: `${FILE}/CHANGELOG.md`,
}
