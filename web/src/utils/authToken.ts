const KEY = 'loomcanvas-token'

/**
 * 登录令牌放在哪：勾了「记住我」放 localStorage（关掉浏览器还在），
 * 没勾放 sessionStorage（关掉这个标签页就没了）。读的时候两处都看。
 */
export function getToken(): string {
  try { return sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || '' } catch { return '' }
}

export function setToken(token: string, remember = true): void {
  try {
    if (remember) { localStorage.setItem(KEY, token); sessionStorage.removeItem(KEY) }
    else { sessionStorage.setItem(KEY, token); localStorage.removeItem(KEY) }
  } catch { /* 隐私模式下写不进去，刷新后需要重新登录 */ }
}

/** 换成新令牌，放回原来那一处（改密码后服务端会换发一个；「记住我」的选择不变） */
export function replaceToken(token: string): void {
  let remembered = true
  try { remembered = !sessionStorage.getItem(KEY) } catch { /* 读不了就按记住处理 */ }
  setToken(token, remembered)
}

export function clearToken(): void {
  try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY) } catch { /* 同上 */ }
}
