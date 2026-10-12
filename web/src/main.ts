// 独立应用的入口：整个页面都是本产品的。
// 启动过程和「整站嵌入」（embed/app.ts）是同一份（embed/createApp.ts），这里只多出冲着整个文档去的那几样：
// 字体、<html> / <body> 的高度、首帧主题的兜底。
import '@/embed/styles'
import '@/styles/fonts.css'
import '@/styles/standalone.css'

import { createLoomApp } from '@/embed/createApp'
import { createEmbedContext, setCurrentEmbed } from '@/embed/context'
import { paintStandalone } from '@/composables/useTheme'

paintStandalone()

const ctx = createEmbedContext()
setCurrentEmbed(ctx)
createLoomApp({ el: '#app', ctx, routerMode: 'history' })
