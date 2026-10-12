import { lcLocal, storageKey } from '@/utils/storage'
import { runtime } from '@/embed/runtime'
import { nextTick, readonly, ref } from 'vue'

/**
 * 界面主题：深色（默认）/ 浅色 / 跟随系统。
 *
 * 取值都在 styles/design-tokens.css：`:root` 是深色，`:root[data-theme='light']` 把同名令牌换成浅色。
 * 这里只做三件事：
 *   1) 把选择解析成 dark / light，写到 <html> 的 data-theme 上（同时写 TDesign 认的 theme-mode，
 *      以及 <meta name="color-scheme"> / <meta name="theme-color">）；
 *   2) 记在 localStorage 里 —— 落地页 / 登录页（还没登录）和下一次打开时的首帧都靠它，
 *      首帧由 public/theme-boot.js 读同一个键来上色，所以刷新不会先闪一下别的主题；
 *   3) 「跟随系统」时盯着 prefers-color-scheme，系统一变这里跟着变。
 * 账号上的那一份（users.prefs.theme）由 stores/app.ts 负责和这里对齐。
 */
export type ThemePref = 'dark' | 'light' | 'system'
export type ThemeName = 'dark' | 'light'

export const THEME_PREFS: ThemePref[] = ['dark', 'light', 'system']
export const DEFAULT_THEME: ThemePref = 'dark'
/** 和 public/theme-boot.js 里的是同一个键 */
const KEY = 'loomcanvas-theme'
/** 「没登录的时候在这台浏览器上换过主题，还没来得及存到账号上」的记号，见 themePending() */
const PENDING_KEY = 'loomcanvas-theme-pending'

export function normalizeTheme(v: unknown): ThemePref {
  return v === 'light' || v === 'system' ? v : DEFAULT_THEME
}

/** 这台浏览器上记着的选择；没选过返回 null */
export function savedTheme(): ThemePref | null {
  try {
    const v = lcLocal.getItem(KEY)
    return v === 'dark' || v === 'light' || v === 'system' ? v : null
  } catch { return null }
}

/**
 * 没登录时换的主题（落地页 / 登录页上点的）还没存到任何账号上。
 * 有这个记号时，接下来登录的账号以本机的选择为准并把它存上去；没有记号时反过来，以账号上的为准。
 * 这样「刚在登录页选了浅色，一登录又变回深色」和「别人以前留在这台浏览器上的选择盖掉我账号上的」两种情况都不会发生。
 */
export function themePending(): boolean {
  try { return lcLocal.getItem(PENDING_KEY) === '1' } catch { return false }
}
export function setThemePending(on: boolean) {
  try { if (on) lcLocal.setItem(PENDING_KEY, '1'); else lcLocal.removeItem(PENDING_KEY) } catch { /* 存不上就算了 */ }
}

const media: MediaQueryList | null =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null

function resolve(pref: ThemePref): ThemeName {
  if (pref === 'system') return media?.matches ? 'light' : 'dark'
  return pref
}

const pref = ref<ThemePref>(savedTheme() || DEFAULT_THEME)
const resolved = ref<ThemeName>(resolve(pref.value))

/** 当前的选择（dark / light / system） */
export const themePref = readonly(pref)
/** 现在实际显示的是哪一套（system 已经解析过） */
export const resolvedTheme = readonly(resolved)

/** 把主题写到文档上。和 theme-boot.js 写的是同一组属性。 */
function paint(theme: ThemeName) {
  // 嵌进别人的页面：属性写在本产品自己的根元素上，<html> 和 <meta> 是宿主的，不碰
  if (runtime.embedded) {
    for (const el of runtime.roots) paintRoot(el, theme)
    return
  }
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.setAttribute('theme-mode', theme)
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme)
  // 地址栏 / 状态栏的颜色跟页面底色走：直接读令牌，不在这里再写一份色值
  const bg = getComputedStyle(root).getPropertyValue('--bg-0').trim()
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg)
}

/** 给一个挂载根上色（嵌入时新挂上来的根用它对齐当前主题） */
export function paintRoot(el: HTMLElement, theme: ThemeName = resolved.value) {
  el.setAttribute('data-theme', theme)
  el.setAttribute('theme-mode', theme)
}

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** 最后一次要换到的主题。交叉淡入时真正上色是异步的（下一帧），连着换两次时以它为准，免得后一次被前一次盖掉 */
let wanted: ThemeName = resolved.value

/**
 * 换到 theme。animate=true 时做一次很短的整页交叉淡入：
 * 浏览器支持 View Transitions 就用它（渐变、阴影、图片都一起过渡）；不支持就给 <html> 挂一个临时的类，
 * 让颜色类的属性过渡一下（见 base.css 的 .theme-fade）。系统开了「减少动态效果」就直接换。
 */
function show(theme: ThemeName, animate: boolean) {
  if (theme === wanted) return
  wanted = theme
  // 上色时取 wanted 而不是进来时的 theme：回调跑到的时候，可能又换过一次了（比如没存上、立刻改回去）
  const apply = () => { paint(wanted); resolved.value = wanted }
  if (!animate || reducedMotion() || document.visibilityState !== 'visible') { apply(); return }
  const doc = document as Document & { startViewTransition?: (cb: () => unknown) => unknown }
  // View Transitions 是整个文档的：嵌入时会让宿主页面跟着闪一下，只走下面那条
  if (!runtime.embedded && typeof doc.startViewTransition === 'function') {
    // 回调返回的 Promise 结束之后浏览器才截「新画面」：等 Vue 把跟着主题变的东西（小地图的颜色等）也画完
    try { doc.startViewTransition(() => { apply(); return nextTick() }); return } catch { /* 落到下面 */ }
  }
  const targets = runtime.embedded ? [...runtime.roots] : [document.documentElement]
  for (const el of targets) el.classList.add('theme-fade')
  apply()
  window.setTimeout(() => { for (const el of targets) el.classList.remove('theme-fade') }, 260)
}

export interface SetThemeOptions {
  /** 记到这台浏览器上，默认 true */
  persist?: boolean
  /** 交叉淡入，默认 true；启动时对齐账号偏好之类的场合传 false */
  animate?: boolean
}

export function setThemePref(v: ThemePref, opts: SetThemeOptions = {}) {
  const next = normalizeTheme(v)
  pref.value = next
  if (opts.persist !== false) {
    try { lcLocal.setItem(KEY, next) } catch { /* 存不上（隐私模式）：这一次会话里照样生效 */ }
  }
  show(resolve(next), opts.animate !== false)
}

/**
 * 独立应用启动时调一次：首帧已经由 theme-boot.js 上过色，这里再写一遍是兜底（脚本被拦、或者被别的东西改过属性）。
 * 不能在模块加载时就做：这个模块也会被打进嵌入用的包里，那时 <html> 是宿主的。
 */
export function paintStandalone() {
  if (typeof document !== 'undefined' && !runtime.embedded) paint(resolved.value)
}

/**
 * 嵌入时由入口调一次：按集成方给的主题（没给就用这台浏览器上记着的）定下起始主题。
 * 模块加载时读过一次存储，但那时还不知道集成方的键前缀。
 */
export function initEmbeddedTheme(theme?: ThemePref) {
  const next = normalizeTheme(theme || savedTheme() || DEFAULT_THEME)
  pref.value = next
  wanted = resolve(next)
  resolved.value = wanted
  paint(wanted)
}

// 跟随系统：系统的深浅一变就跟着换
media?.addEventListener?.('change', () => { if (pref.value === 'system') show(resolve('system'), true) })

// 别的标签页里换了主题：这一页跟上（storage 事件只在「别的」标签页触发）
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== storageKey(KEY)) return
    const next = normalizeTheme(e.newValue)
    if (next === pref.value) return
    pref.value = next
    show(resolve(next), true)
  })
}
