/**
 * 从 User-Agent 里认出「系统 · 浏览器」，只给登录会话列表用。
 * 认不出来的部分留空，界面上显示「未知设备」，不去猜。
 */
export interface DeviceInfo {
  os: string
  browser: string
  /** 手机 / 平板 */
  mobile: boolean
}

const OS: [RegExp, string][] = [
  [/iPhone|iPod/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Linux|X11/, 'Linux'],
]

// 顺序有讲究：Edge / Opera 等的 UA 里也带 Chrome 和 Safari，Chrome 的里面也带 Safari
const BROWSER: [RegExp, string][] = [
  [/Edg(e|A|iOS)?\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/SamsungBrowser\//, 'Samsung Internet'],
  [/Firefox\/|FxiOS\//, 'Firefox'],
  [/Chrome\/|CriOS\/|Chromium\//, 'Chrome'],
  [/Safari\//, 'Safari'],
  [/curl\//i, 'curl'],
  [/node|undici|axios/i, 'Node.js'],
]

export function parseUserAgent(ua?: string | null): DeviceInfo {
  const s = String(ua || '')
  const os = OS.find(([re]) => re.test(s))?.[1] || ''
  const browser = BROWSER.find(([re]) => re.test(s))?.[1] || ''
  return { os, browser, mobile: /iPhone|iPod|iPad|Android|Mobile/.test(s) }
}
