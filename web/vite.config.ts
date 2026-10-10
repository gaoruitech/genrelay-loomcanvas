import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { TDesignResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import type { Plugin } from 'vite'

// 开发时后端不在 3000 上的话：LC_DEV_BACKEND=http://127.0.0.1:3100 npm run dev
const BACKEND = process.env.LC_DEV_BACKEND || 'http://127.0.0.1:3000'

/**
 * 自托管的三款字体都是 SIL Open Font License 1.1：再分发时要带上版权声明和协议全文。
 * 构建时把三个包自带的 LICENSE 原文拼成 dist/licenses/fonts-OFL-1.1.txt，跟着产物一起部署；
 * 内容直接读 node_modules，升级字体包后不会和实际发出去的文件对不上。
 */
const FONT_PACKAGES = ['inter', 'sora', 'jetbrains-mono']
function fontLicenses(): Plugin {
  return {
    name: 'loomcanvas-font-licenses',
    apply: 'build',
    generateBundle() {
      const rule = '='.repeat(78)
      const parts = FONT_PACKAGES.map((name) => {
        const dir = resolve(__dirname, 'node_modules/@fontsource-variable', name)
        const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
        const text = readFileSync(resolve(dir, 'LICENSE'), 'utf8').split(/\r?\n/).join('\n').trim()
        return [rule, `${pkg.name}@${pkg.version}`, `File shipped unmodified: ${name}-latin-wght-normal.woff2`, rule, '', text, ''].join('\n')
      })
      this.emitFile({
        type: 'asset',
        fileName: 'licenses/fonts-OFL-1.1.txt',
        source: ['Fonts bundled with the LoomCanvas web app', '', ...parts].join('\n'),
      })
    },
  }
}

export default defineConfig({
  plugins: [
    vue(),
    fontLicenses(),
    // tdesign 按需引入：模板里的 <t-xxx> 自动导入对应组件与样式
    Components({
      resolvers: [TDesignResolver({ library: 'vue-next' })],
      dts: false,
    }),
  ],
  define: {
    // vue-i18n 默认用 new Function 编译文案，会被服务端下发的 CSP（script-src 不含 'unsafe-eval'）拦掉，
    // 整个应用白屏。打开这个开关后改为解释执行编译结果，不需要 eval。
    __INTLIFY_JIT_COMPILATION__: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 第三方库拆成独立 vendor chunk：跨部署可被浏览器长期缓存，且按需加载。
        // tdesign 不在这里归并：强行并成一个 chunk 的话，只有设置页用到的日期选择（连同它带进来的
        // 下拉、弹层、dayjs，约 350 kB）和全部组件的样式都会进首屏。交给 rollup 自动分配后，
        // 首屏只带 Message / Dialog，日期选择跟着设置页按需加载。
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@vue-flow')) return 'vendor-vueflow'
          if (
            id.includes('/vue/') ||
            id.includes('/@vue/') ||
            id.includes('vue-router') ||
            id.includes('vue-i18n') ||
            id.includes('/pinia/')
          )
            return 'vendor-vue'
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/files': { target: BACKEND, changeOrigin: true },
    },
  },
})
