import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { TDesignResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

// 单元测试：集成入口的对外接口、选项处理、适配器约定、文档格式、样式作用域插件。
// HTTP 适配器那一组要一个真的后端（server/ 加 MongoDB）：设了 TEST_MONGODB_URI 才跑，否则跳过。
export default defineConfig({
  plugins: [
    vue(),
    Components({ resolvers: [TDesignResolver({ library: 'vue-next' })], dts: false }),
  ],
  define: {
    __INTLIFY_JIT_COMPILATION__: true,
    __LC_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts'],
    css: false,
    testTimeout: 30000,
    hookTimeout: 60000,
    // 起后端的那一组自己占一个进程，别的互不影响
    pool: 'forks',
    server: { deps: { inline: ['tdesign-vue-next', /@vue-flow/] } },
  },
})
