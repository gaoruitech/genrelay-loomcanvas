import { runtime, DEFAULT_STORAGE_PREFIX } from '@/embed/runtime'

/**
 * 浏览器存储的统一入口。
 *
 * 独立部署时键名和以前一模一样（loomcanvas-token、lc-queue-pos、canvas_guide_autoshown……）。
 * 嵌进别人的页面时，所有键都带上同一个前缀（默认 loomcanvas-，集成方可以换成自己的），
 * 免得和宿主页面、或同一个域名下的另一个产品撞键。
 *
 * 用法和原生的一样：lcLocal.getItem / setItem / removeItem。读写失败照样抛出，调用方原来就包着 try。
 */
export function storageKey(key: string): string {
  if (!runtime.embedded) return key
  const bare = key.startsWith(DEFAULT_STORAGE_PREFIX) ? key.slice(DEFAULT_STORAGE_PREFIX.length) : key
  return `${runtime.storagePrefix}${bare}`
}

function wrap(pick: () => Storage) {
  return {
    getItem: (key: string) => pick().getItem(storageKey(key)),
    setItem: (key: string, value: string) => pick().setItem(storageKey(key), value),
    removeItem: (key: string) => pick().removeItem(storageKey(key)),
  }
}

export const lcLocal = wrap(() => localStorage)
export const lcSession = wrap(() => sessionStorage)
