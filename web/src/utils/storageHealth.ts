/**
 * 画布在运行之前就该说的两件事，各自从哪儿知道：
 *
 *  - 现在存不存得了新文件。服务端在启动信息里告诉每个登录的人（GET /api/bootstrap 的 media.writable；
 *    只嵌编辑器时是适配器 capabilities() 的 storageWritable）。启动信息是进来时取的，之后情况可能变，
 *    所以这里再记一份「这个页面自己后来得知的」：被 503 storage.secret_unreadable 拒绝过 → 存不了；
 *    一次成功的上传 / 出图出片运行 → 存得了；超级管理员在「设置 → 存储」看到的 → 以它为准。
 *    启动信息重新取回来时这一份作废（新取的更新）。
 *  - 哪些服务商存着的 Key 解不开了（GET /api/admin/providers 的 keyUnreadable）：它们的模型现在跑不了。
 *
 * 这些只用来提前说明，不用来拦运行：拦不拦始终由服务端说了算。
 */
import { reactive } from 'vue'

export const storageHealth = reactive({
  /** 这个页面自己得知的「存不存得了新文件」；null = 没有比启动信息更新的消息 */
  writable: null as boolean | null,
  /** Key 解不开的服务商：服务商 id → 名字。服务商 id 全站唯一，换空间不用清 */
  deadProviders: {} as Record<string, string>,
  /**
   * 最近一次被拒绝时服务端的原话，按原因分。节点上已经显示着这一句（运行失败的原因）时，
   * 运行前的那条提示就不再把同一件事说第二遍。
   */
  said: { storage: '', provider: '' },
})

/** 超级管理员从「设置 → 存储」拿到了确切的答案 */
export function setWritable(writable: boolean): void {
  storageHealth.writable = writable
}

/** 取到了一个空间的服务商列表：按它更新「哪些 Key 解不开」 */
export function noteProviders(list: { id: string; name?: string; keyUnreadable?: boolean }[]): void {
  const next: Record<string, string> = {}
  // 列表里没有的（别的空间的）原样留着
  const seen = new Set(list.map((p) => p.id))
  for (const [id, name] of Object.entries(storageHealth.deadProviders)) if (!seen.has(id)) next[id] = name
  for (const p of list) if (p.keyUnreadable) next[p.id] = p.name || ''
  storageHealth.deadProviders = next
}

/**
 * 每个接口应答都过一下这里（utils/api.ts 的拦截器）：
 *  - 被 storage.secret_unreadable 拒绝 → 存不了，记下那句话；
 *  - 一次成功的上传或出图 / 出片运行 → 存得了；
 *  - 启动信息取回来了 → 它说了算，自己记的那一份作废；
 *  - provider.key_undecryptable → 记下那句话，服务商的状态下次预检重新取。
 */
export function noteStorageAnswer(url: string, method: string, code: string, message = ''): void {
  const verb = method.toLowerCase()
  if (code === 'storage.secret_unreadable') {
    storageHealth.writable = false
    storageHealth.said.storage = message
  } else if (code === 'provider.key_undecryptable') {
    storageHealth.said.provider = message
    checkedAt = 0
  } else if (code) {
    // 别的错误说明不了什么
  } else if (verb === 'post' && /^\/(files\/upload|runs)(\?|$)/.test(url)) {
    storageHealth.writable = true
  } else if (verb === 'get' && /^\/(app\/)?bootstrap(\?|$)/.test(url)) {
    storageHealth.writable = null
  }
}

/** 上次预检是什么时候、针对哪个空间（见 composables/useStorageNotice 的 checkStorageHealth） */
let checkedAt = 0
let checkedFor = ''
const CHECK_EVERY_MS = 60 * 1000
/** 该不该再查一次：换了空间，或者离上次已经过了一分钟 */
export function healthCheckDue(space: string): boolean {
  if (space === checkedFor && Date.now() - checkedAt < CHECK_EVERY_MS) return false
  checkedAt = Date.now()
  checkedFor = space
  return true
}
