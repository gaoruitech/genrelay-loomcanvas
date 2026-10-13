/**
 * 整个应用里加载不出来的站内图片 / 视频，换成一块说得清的占位，而不是浏览器的破图标。
 *
 * 装在每个挂载根上（embed/mount.ts 的 installCommon：独立应用是 <html>，嵌进别人页面时是挂载点里的根元素），
 * 所以画布节点、缩略图条、参考图、素材库、历史记录、工作台，以及传送到弹层里的灯箱和各种弹窗都在里面 ——
 * 加载失败的事件不冒泡，但捕获阶段能在根上收到。
 *
 * <img> / <video> 加载失败时，问一下那个地址是怎么回事（只问本站存储的文件 /files/...）：
 *   503（storage.unreachable：这个文件可能所在的存储现在连不上）
 *        → 「这个文件所在的存储暂时连不上」+ 重试。文件并没有丢，所以不是报错的样子；连上之后自己恢复
 *          （有这种占位时每 20 秒问一次，服务端自己 30 秒才重新探一次那个存储）。
 *   404（文件真的没了：被清理了、所在的存储桶不再读取了）
 *        → 「文件已不存在」，同一种样子，没有重试。
 *   别的（外链、跨域问不到、断网）一律不管，和以前一样。
 * 自己处理加载失败的地方（封面、头像、Logo：出错就换成别的）不受影响：等问到结果时那个元素已经不在了。
 *
 * 占位是插在那个元素后面的一个兄弟元素（原元素用 data-lc-media-down 藏起来），所以要自己收拾：
 * 原元素被移走、换了地址（节点换了一张图）时占位跟着撤掉 —— 用一个只在有占位时才开着的 MutationObserver。
 * 样式在 styles/media-down.css。位置和尺寸用 CSSOM 设。
 */
import { t } from '@/locales'
import '@/styles/media-down.css'

type Media = HTMLImageElement | HTMLVideoElement
/** down：存储连不上（503）；gone：文件不存在（404） */
type Kind = 'down' | 'gone'
interface Mark { url: string; ph: HTMLElement; kind: Kind }

const DOWN_ATTR = 'data-lc-media-down'
const RETRY_MS = 20 * 1000
/** 小于这个尺寸的只放一个图标 */
const FULL_W = 150
const FULL_H = 96

const marks = new Map<Media, Mark>()
const roots = new Set<HTMLElement>()
const probes = new Map<string, Promise<Kind | ''>>()
let observer: MutationObserver | null = null
let timer: ReturnType<typeof setInterval> | null = null

const urlOf = (el: Media) => el.currentSrc || el.getAttribute('src') || ''

/** 只管本站存储的文件（/files/...）：别的地址问了也说明不了什么 */
function isStoredFile(url: string): boolean {
  if (!url || /^(data|blob):/i.test(url)) return false
  try { return new URL(url, window.location.href).pathname.includes('/files/') } catch { return false }
}

/** 这个地址现在是怎么回事。问不到（断网、跨域）和别的状态都算「不知道」 */
function probe(url: string): Promise<Kind | ''> {
  let p = probes.get(url)
  if (!p) {
    p = fetch(url, { method: 'HEAD', cache: 'no-store', credentials: 'omit' })
      .then((res): Kind | '' => (res.status === 503 ? 'down' : res.status === 404 ? 'gone' : ''), (): Kind | '' => '')
      .finally(() => probes.delete(url))
    probes.set(url, p)
  }
  return p
}

const ICON: Record<Kind, string[]> = {
  // 一朵云，下面一道断开的线：东西在那边，这会儿够不着
  down: ['M7 17a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17.2 9.1 4 4 0 0 1 17 17', 'M9 21h2M13 21h2M12 17v1'],
  // 一张图，划了一道：这张图没有了
  gone: ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M4 20L20 4'],
}

function icon(kind: Kind): SVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  for (const d of ICON[kind]) {
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  }
  return svg
}

function placeholder(el: Media, kind: Kind): HTMLElement {
  const ph = document.createElement('span')
  ph.className = 'lc-media-down' + (kind === 'gone' ? ' gone' : '')
  ph.setAttribute('data-testid', kind === 'gone' ? 'media-gone' : 'media-down')

  // 占原来那张图的地方。原图有尺寸（样式给的）就照着来；没有（高度跟着图走的）给一块固定的
  const cs = getComputedStyle(el)
  const w = el.offsetWidth
  const h = el.offsetHeight
  const sized = w >= 24 && h >= 24
  const parent = el.parentElement
  /** 原图没有自己的尺寸，而它所在的地方很矮（一行里的小图）：放一个小方块，不撑开那一行 */
  const cramped = !sized && !!parent && parent.clientHeight >= 16 && parent.clientHeight < FULL_H
  if (cs.position === 'absolute' || cs.position === 'fixed') {
    ph.style.position = 'absolute'
    ph.style.left = el.offsetLeft + 'px'
    ph.style.top = el.offsetTop + 'px'
    ph.style.width = w + 'px'
    ph.style.height = h + 'px'
  } else if (sized && parent && w === parent.clientWidth && h === parent.clientHeight) {
    ph.style.width = '100%'
    ph.style.height = '100%'
  } else if (sized) {
    ph.style.width = w + 'px'
    ph.style.height = h + 'px'
    ph.style.flex = 'none'
  } else if (cramped) {
    const side = Math.max(16, Math.min(parent!.clientHeight, parent!.clientWidth || 40, 40)) + 'px'
    ph.style.width = side
    ph.style.height = side
    ph.style.flex = 'none'
  } else {
    ph.classList.add('auto')
  }
  if (sized) ph.style.borderRadius = cs.borderRadius

  // 小缩略图：只放图标，文字进提示
  const compact = cramped || (sized && (w < FULL_W || h < FULL_H))
  const text = t(kind === 'gone' ? 'canvas.storage.mediaGone' : 'canvas.storage.mediaDown')
  ph.appendChild(icon(kind))
  if (compact) {
    ph.classList.add('compact')
    ph.title = text
    ph.setAttribute('role', 'img')
    ph.setAttribute('aria-label', text)
    return ph
  }
  ph.setAttribute('role', 'group')
  ph.setAttribute('aria-label', text)
  const title = document.createElement('span')
  title.className = 'lc-media-down-t'
  title.textContent = text
  ph.appendChild(title)
  // 没了的文件没有下一步可做；本身就在按钮 / 链接里的（素材库的格子）不能再套一颗按钮：只写那一句，它自己会定时再试
  if (kind === 'gone' || el.closest('button, a, label')) return ph

  const hint = document.createElement('span')
  hint.className = 'lc-media-down-h'
  hint.textContent = t('canvas.storage.mediaDownHint')
  const btn = document.createElement('button')
  btn.type = 'button'
  // nodrag / nopan：画布上点它不算拖节点、拖画布
  btn.className = 'lc-btn sm nodrag nopan'
  btn.textContent = t('common.retry')
  btn.setAttribute('data-testid', 'media-down-retry')
  for (const type of ['mousedown', 'pointerdown', 'dblclick']) btn.addEventListener(type, (e) => e.stopPropagation())
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    void retry(el, true)
  })
  ph.append(hint, btn)
  return ph
}

function mark(el: Media, url: string, kind: Kind) {
  if (marks.has(el) || !el.isConnected) return
  const ph = placeholder(el, kind)
  el.setAttribute(DOWN_ATTR, kind)
  el.after(ph)
  marks.set(el, { url, ph, kind })
  watch()
}

/** 撤掉占位，让原元素重新露出来。reload：地址没变，要它自己重新取一次 */
function restore(el: Media, reload: boolean) {
  const m = marks.get(el)
  if (!m) return
  marks.delete(el)
  m.ph.remove()
  el.removeAttribute(DOWN_ATTR)
  if (reload && el.isConnected) {
    if (el instanceof HTMLVideoElement) el.load()
    else el.src = el.getAttribute('src') || ''
  }
  if (!marks.size) unwatch()
}

/** 再问一次连不上的那个文件：连上了就恢复；这回成了「不存在」（那个存储不再读取了）就换成那一种占位 */
async function retry(el: Media, byHand = false) {
  const m = marks.get(el)
  if (!m || m.kind !== 'down') return
  if (byHand) m.ph.classList.add('busy')
  const now = await probe(m.url)
  m.ph.classList.remove('busy')
  if (marks.get(el) !== m || now === 'down') return
  restore(el, now === '')
  if (now === 'gone') mark(el, m.url, 'gone')
}

/** 原元素没了、换了地址：占位跟着撤；被挪了位置：占位跟过去 */
function sync() {
  for (const [el, m] of [...marks]) {
    if (!el.isConnected) { m.ph.remove(); marks.delete(el); continue }
    if (urlOf(el) !== m.url) { restore(el, false); continue }
    if (el.nextSibling !== m.ph) el.after(m.ph)
  }
  if (!marks.size) unwatch()
}

const WATCH: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] }

function watch() {
  if (!observer && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(sync)
    for (const root of roots) observer.observe(root, WATCH)
  }
  if (!timer) {
    timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      sync()
      for (const [el, m] of [...marks]) if (m.kind === 'down') void retry(el)
    }, RETRY_MS)
  }
}

function unwatch() {
  observer?.disconnect()
  observer = null
  if (timer) clearInterval(timer)
  timer = null
}

function onError(e: Event) {
  const el = e.target
  if (!(el instanceof HTMLImageElement) && !(el instanceof HTMLVideoElement)) return
  const url = urlOf(el)
  if (marks.has(el) || !isStoredFile(url)) return
  void probe(url).then((kind) => {
    if (kind && el.isConnected && urlOf(el) === url) mark(el, url, kind)
  })
}

/** 在一个根上装上；返回卸下的函数（卸下时这个根里的占位一并收走） */
export function installMediaGuard(root: HTMLElement): () => void {
  roots.add(root)
  // 加载失败的事件不冒泡：在捕获阶段收
  root.addEventListener('error', onError, true)
  if (observer) observer.observe(root, WATCH)
  return () => {
    roots.delete(root)
    root.removeEventListener('error', onError, true)
    for (const [el, m] of [...marks]) if (root.contains(el) || !el.isConnected) { m.ph.remove(); el.removeAttribute(DOWN_ATTR); marks.delete(el) }
    if (!marks.size) unwatch()
  }
}
