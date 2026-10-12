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
  examples: `${REPO}/tree/master/examples`,
  license: `${FILE}/LICENSE`,
  commercial: `${FILE}/COMMERCIAL.md`,
  changelog: `${FILE}/CHANGELOG.md`,
}
