import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import { i18n } from './locales'
import { useAppStore } from '@/stores/app'
import { loadModels } from '@/utils/canvasModels'

// tdesign 组件按需引入(由 unplugin-vue-components 自动处理模板中的 <t-xxx>)；
// 仅程序化调用的插件需手动引样式（resolver 只扫描模板）
import 'tdesign-vue-next/es/message/style/css'
import 'tdesign-vue-next/es/dialog/style/css'

import '@/styles/design-tokens.css'
import '@/styles/base.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(i18n)

const appStore = useAppStore(pinia)
// index.html 的内联脚本已经把主题属性写到 <html> 上了（在样式之前，避免闪烁），
// 这里只是接管后续切换，并在选了「跟随系统」时监听系统变化。
appStore.initTheme()

// 启动信息拿到之后再装路由：守卫要靠它判断「是否需要口令」「有没有接入」。
// 模型清单也在这里加载一次；没通过口令时接口会 401，等登录后再加载。
appStore.loadBootstrap()
  .then(() => (appStore.authed ? loadModels().catch(() => undefined) : undefined))
  .finally(() => {
    app.use(router)
    app.mount('#app')
  })
