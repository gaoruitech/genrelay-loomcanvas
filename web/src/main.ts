import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { i18n } from './locales'
import { useAppStore } from '@/stores/app'
import { loadModels } from '@/utils/canvasModels'

// tdesign 组件按需引入(由 unplugin-vue-components 自动处理模板中的 <t-xxx>)；
// 仅程序化调用的插件需手动引样式（resolver 只扫描模板）。
// 第一行是 TDesign 的基础令牌（尺寸、间距、颜色）：各组件自己的样式里不带，必须单独引一次，
// 而且要排在本项目的样式之前，base.css 里把它接到霓虹令牌上的那一段才压得住。
import 'tdesign-vue-next/es/style/index.css'
import 'tdesign-vue-next/es/message/style/css'
import 'tdesign-vue-next/es/dialog/style/css'

import '@/styles/design-tokens.css'
import '@/styles/base.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(i18n)

const appStore = useAppStore(pinia)

// 启动信息拿到之后再装路由：守卫要靠它判断「登录了没有」「有没有接入服务商」。
// 模型清单是按账号的，登录了才取；之后登录状态变化时由 App.vue 重取。
appStore.loadBootstrap()
  // 还在用临时密码的账号，接口只放行改密码：模型清单等改完再取（App.vue 看着）
  .then(() => (appStore.authed && !appStore.mustChangePassword ? loadModels().catch(() => undefined) : undefined))
  .finally(() => {
    app.use(router)
    app.mount('#app')
  })
