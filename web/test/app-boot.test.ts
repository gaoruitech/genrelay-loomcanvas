import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, type App as VueApp } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { i18n } from '../src/locales'
import { createEmbedContext, setCurrentEmbed } from '../src/embed/context'
import { useAppStore } from '../src/stores/app'
import App from '../src/App.vue'

/**
 * 启动时第一次导航还没走完的那几帧：路由还是空的，不知道这一页有没有外壳。
 * 这时不能先把外壳画出来 —— 落地页 / 登录页 / 404 会先闪一帧登录后的外壳。接着显示启动时的转圈，导航完了再换成页面。
 */
let app: VueApp | null = null
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = '' })

describe('App before the first navigation', () => {
  it('keeps the start-up spinner instead of painting the shell, then shows the page', async () => {
    setCurrentEmbed(createEmbedContext())
    const pinia = createPinia()
    const page = { render: () => h('div', { class: 'public-page' }, 'landing') }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: page, meta: { public: true } }] })
    const host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp(App)
    app.use(pinia).use(i18n)
    app.config.globalProperties.$lcPortal = 'body'
    useAppStore(pinia).bootstrap = { auth: { registrationOpen: true }, user: null, site: {}, hasProvider: false }

    // 和 embed/createApp.ts 一样：装上路由（第一次导航这时才开始，是异步的）紧接着就挂载
    app.use(router)
    app.mount(host)
    expect(router.currentRoute.value.matched.length).toBe(0)
    expect(host.querySelector('[data-testid="app-boot"]')).toBeTruthy()
    expect(host.querySelector('[data-testid="app-boot"]')!.getAttribute('role')).toBe('status')
    expect(host.querySelector('.shell')).toBeNull()
    expect(host.querySelector('.public-page')).toBeNull()

    await router.isReady()
    await nextTick()
    expect(host.querySelector('[data-testid="app-boot"]')).toBeNull()
    expect(host.querySelector('.public-page')).toBeTruthy()
    expect(host.querySelector('.shell')).toBeNull()
  })
})
