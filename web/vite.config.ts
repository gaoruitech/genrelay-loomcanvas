import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { TDesignResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'path'

const BACKEND = 'http://127.0.0.1:3000'

export default defineConfig({
  plugins: [
    vue(),
    // tdesign 按需引入：模板里的 <t-xxx> 自动导入对应组件与样式
    Components({
      resolvers: [TDesignResolver({ library: 'vue-next' })],
      dts: false,
    }),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 第三方库拆成独立 vendor chunk：跨部署可被浏览器长期缓存，且按需加载
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('tdesign')) return 'vendor-tdesign'
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
