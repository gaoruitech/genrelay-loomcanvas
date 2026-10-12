// 全站共用的样式，独立应用和两个嵌入入口都从这里引，顺序不能变：
// 第一行是 TDesign 的基础令牌（尺寸、间距、颜色），各组件自己的样式里不带，必须单独引一次，
// 而且要排在本项目的样式之前，base.css 里把它接到霓虹令牌上的那一段才压得住。
// 后两行是只在脚本里调用的两个插件（轻提示、确认弹窗）的样式：按需引入只扫模板，扫不到它们。
import 'tdesign-vue-next/es/style/index.css'
import 'tdesign-vue-next/es/message/style/css'
import 'tdesign-vue-next/es/dialog/style/css'

import '@/styles/design-tokens.css'
import '@/styles/base.css'
