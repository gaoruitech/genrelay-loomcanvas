import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { TDesignResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'path'
import { readFileSync } from 'fs'
import scopeToRoot from './build/scope-to-root.mjs'

/**
 * 给集成方用的库构建：一次只打一个入口，由 scripts/build-lib.mjs 逐个调用并收拢产物。
 *   LC_LIB_ENTRY       app | editor
 *   LC_LIB_STANDALONE  1 = 把 vue 也打进去（没有打包工具、直接用 <script type="module"> 的宿主页面用）
 *   LC_LIB_OUT         临时输出目录
 * 样式规则同样全部限制在 .lc-root 之内（和独立应用是同一个插件、同一份源码）。
 */
const entry = process.env.LC_LIB_ENTRY || 'app'
const standalone = process.env.LC_LIB_STANDALONE === '1'
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'))

export default defineConfig({
  plugins: [
    vue(),
    Components({ resolvers: [TDesignResolver({ library: 'vue-next' })], dts: false }),
  ],
  // containerTwins：嵌入时响应式布局跟着挂载点的宽度走，而不是浏览器窗口的宽度（见 build/scope-to-root.mjs）
  css: { postcss: { plugins: [scopeToRoot({ containerTwins: true })] } },
  define: {
    __INTLIFY_JIT_COMPILATION__: true,
    __LC_VERSION__: JSON.stringify(pkg.version),
    // 库模式下 Vite 不替换这个量；留着的话浏览器直接加载时会报 process is not defined
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  publicDir: false,
  build: {
    outDir: process.env.LC_LIB_OUT || 'dist-lib/.tmp',
    emptyOutDir: true,
    // 一个入口一份样式表
    cssCodeSplit: false,
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, `src/embed/${entry}.ts`),
      formats: ['es'],
      fileName: () => `${entry}.js`,
    },
    rollupOptions: {
      // vue 是对等依赖：宿主自己有一份，<LoomCanvasEditor> 才能直接用在宿主的 Vue 应用里；
      // 其余依赖（vue-router、pinia、vue-i18n、Vue Flow、TDesign、axios）都打进包里，宿主不用装
      external: standalone ? [] : ['vue'],
      output: {
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
