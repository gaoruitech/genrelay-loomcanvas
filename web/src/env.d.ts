/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

/** 包的版本号，构建时注入（vite.config.ts / vite.lib.config.ts 的 define） */
declare const __LC_VERSION__: string
