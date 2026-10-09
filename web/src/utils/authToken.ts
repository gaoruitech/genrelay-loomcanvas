const KEY = 'loomcanvas-token'

export function getToken(): string {
  try { return localStorage.getItem(KEY) || '' } catch { return '' }
}

export function setToken(token: string): void {
  try { localStorage.setItem(KEY, token) } catch { /* 隐私模式下写不进去，本次会话仍可用内存里的那份 */ }
}

export function clearToken(): void {
  try { localStorage.removeItem(KEY) } catch { /* 同上 */ }
}
