// 主题检查：
//  1. 深色 / 浅色两套令牌的名字是否一一对应（src/styles/design-tokens.css）
//  2. 两套主题下，文字 / 强调 / 语义色压在各自底面上的对比度（WCAG），不够的列出来
//  3. 令牌文件之外是否还有裸色值（源码；给了构建目录就连构建产物一起查）
// 用法：node scripts/check-theme.mjs [dist 目录]        第 1、2 项有问题时退出码为 1；第 3 项只列出来，由人判断
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src')
const TOKENS = path.join(src, 'styles/design-tokens.css')
const rel = (p) => path.relative(root, p).split(path.sep).join('/')
let failed = false

// ---------- 读令牌 ----------
const css = fs.readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
function blocks(re) {
  const out = {}
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!re.test(m[1].trim())) continue
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim()
  }
  return out
}
const dark = blocks(/^:root, \.lc-theme-dark/)
const light = blocks(/^:root\[data-theme='light'\], \.lc-theme-light/)
// 两套共用、浅色不重复写的：圆角、字体、外壳尺寸
const SHARED = /^--(r-(xs|sm|md|lg|xl)|f-(body|disp|mono)|shell-(top|side|side-mini))$/

console.log(`令牌：深色 ${Object.keys(dark).length} 个，浅色 ${Object.keys(light).length} 个`)
const onlyDark = Object.keys(dark).filter((k) => !(k in light) && !SHARED.test(k))
const onlyLight = Object.keys(light).filter((k) => !(k in dark))
console.log(`只在深色里有的：${onlyDark.length}${onlyDark.length ? '  ' + onlyDark.join(' ') : ''}`)
console.log(`只在浅色里有的：${onlyLight.length}${onlyLight.length ? '  ' + onlyLight.join(' ') : ''}`)
if (onlyDark.length || onlyLight.length) failed = true

// ---------- 颜色计算 ----------
function resolveToken(set, name, depth = 0) {
  let v = set[name] ?? dark[name]
  if (v == null) throw new Error('unknown token ' + name)
  while (/var\(/.test(v) && depth++ < 8) v = v.replace(/var\((--[\w-]+)\)/g, (_, k) => set[k] ?? dark[k])
  return v
}
/** -> [r, g, b, a] */
function parse(v) {
  v = v.trim()
  let m = /^#([0-9a-f]{6})$/i.exec(v)
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1] }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(v)
  if (m) return [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]]
  // 渐变：取第一个色标（按钮渐变两端分别查，见下面的表）
  m = /(#[0-9a-f]{6}|rgba?\([^)]*\))/i.exec(v)
  if (m) return parse(m[1])
  throw new Error('cannot parse colour: ' + v)
}
const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1) }
const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
const hex = (c) => '#' + c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('')

/** 渐变里的第 n 个色标 */
const stop = (set, name, n) => parse([...resolveToken(set, name).matchAll(/#[0-9a-f]{6}|rgba?\([^)]*\)/gi)][n][0])
const chan = (set, name, a) => { const [r, g, b] = resolveToken(set, name).split(/\s+/).map(Number); return [r, g, b, a] }

/**
 * 要查的组合：[说明, 前景, 底面（从下往上叠）, 最低对比度]
 * 4.5 = 正文 / 有信息量的小字；3 = 图标、描边、大字、状态点这类非文字件。
 */
function pairs(set) {
  const c = (name) => parse(resolveToken(set, name))
  const bg0 = c('--bg-0')
  const card = over(stop(set, '--grad-card', 0), bg0) // 普通卡片
  const node = stop(set, '--grad-node', 0).length ? over(stop(set, '--grad-node', 0), bg0) : bg0 // 画布节点
  const pop = c('--pop') // 菜单 / 弹层
  const dialog = stop(set, '--grad-dialog', 1) // 弹窗（取渐变里离文字色更近的那一端）
  const well = over(c('--well'), card) // 输入框
  const film = (base, a) => over(chan(set, '--c-film', a), base)
  const tint = (name, a, base) => over(chan(set, name, a), base)
  const rows = [
    ['正文 --text / 页面底', c('--text'), bg0, 4.5],
    ['正文 --text / 卡片', c('--text'), card, 4.5],
    ['正文 --text / 节点', c('--text'), node, 4.5],
    ['正文 --text / 输入框', c('--text'), well, 4.5],
    ['正文 --text / 菜单', c('--text'), pop, 4.5],
    ['正文 --text / 弹窗', c('--text'), dialog, 4.5],
    ['次要 --text-2 / 页面底', c('--text-2'), bg0, 4.5],
    ['次要 --text-2 / 卡片', c('--text-2'), card, 4.5],
    ['次要 --text-2 / 节点', c('--text-2'), node, 4.5],
    ['次要 --text-2 / 菜单', c('--text-2'), pop, 4.5],
    ['次要 --text-2 / 默认按钮底', c('--text-2'), film(card, 0.06), 4.5],
    ['辅助 --text-3 / 页面底', c('--text-3'), bg0, 4.5],
    ['辅助 --text-3 / 卡片', c('--text-3'), card, 4.5],
    ['辅助 --text-3 / 节点', c('--text-3'), node, 4.5],
    ['辅助 --text-3 / 输入框（占位字）', c('--text-3'), well, 3],
    ['辅助 --text-3 / 表头', c('--text-3'), over(chan(set, '--c-well', 0.35), card), 4.5],
    ['链接 --cyan-soft / 页面底', c('--cyan-soft'), bg0, 4.5],
    ['链接 --cyan-soft / 卡片', c('--cyan-soft'), card, 4.5],
    ['当前项 --cyan-soft / 青色底 12%', c('--cyan-soft'), tint('--c-cyan', 0.12, card), 4.5],
    ['当前导航 --text / 导航高亮底', c('--text'), tint('--c-blue', 0.22, bg0), 4.5],
    ['强调 --cyan（图标、状态字）/ 卡片', c('--cyan'), card, 4.5],
    ['强调 --cyan / 页面底', c('--cyan'), bg0, 3],
    ['强调 --blue / 卡片', c('--blue'), card, 3],
    ['强调 --violet / 卡片', c('--violet'), card, 3],
    ['主按钮字 --text-inv / 渐变起点', c('--text-inv'), stop(set, '--grad-btn', 0), 4.5],
    ['主按钮字 --text-inv / 渐变终点', c('--text-inv'), stop(set, '--grad-btn', 1), 4.5],
    ['主按钮字 / 悬停渐变起点', c('--text-inv'), stop(set, '--grad-btn-hover', 0), 4.5],
    ['主按钮字 / 悬停渐变终点', c('--text-inv'), stop(set, '--grad-btn-hover', 1), 4.5],
    ['头像字 --text-inv / 头像渐变起点', c('--text-inv'), stop(set, '--grad-avatar', 0), 3],
    ['头像字 --text-inv / 头像渐变终点', c('--text-inv'), stop(set, '--grad-avatar', 1), 3],
    ['危险按钮字 --text-inv / --err', c('--text-inv'), c('--err'), 4.5],
    ['成功 --ok / 卡片', c('--ok'), card, 4.5],
    ['成功 --ok / 成功底', c('--ok'), over(c('--success-dim'), card), 4.5],
    ['警告 --warn / 卡片', c('--warn'), card, 4.5],
    ['警告 --warn / 警告底', c('--warn'), over(c('--warning-dim'), card), 4.5],
    ['错误 --err / 卡片', c('--err'), card, 4.5],
    ['错误字 --err-soft / 卡片', c('--err-soft'), card, 4.5],
    ['错误字 --err-soft / 错误底', c('--err-soft'), over(c('--danger-dim'), card), 4.5],
    ['信息 --info / 卡片', c('--info'), card, 4.5],
    ['提示条 错误字 / 错误底 10%', c('--alert-err-fg'), tint('--c-err', 0.1, card), 4.5],
    ['提示条 信息字 / 青色底 8%', c('--alert-info-fg'), tint('--c-cyan', 0.08, card), 4.5],
    ['提示条 警告字 / 警告底 8%', c('--alert-warn-fg'), tint('--c-warn', 0.08, card), 4.5],
    ['徽标 图片 fg / bg', c('--kind-image-fg'), over(c('--kind-image-bg'), card), 4.5],
    ['徽标 视频 fg / bg', c('--kind-video-fg'), over(c('--kind-video-bg'), card), 4.5],
    ['徽标 对话 fg / bg', c('--kind-chat-fg'), over(c('--kind-chat-bg'), card), 4.5],
    ['缩略图上的类型标签 图片 fg / 垫底', c('--kind-image-fg'), over(c('--tag-scrim'), [128, 128, 128, 1]), 4.5],
    ['缩略图上的类型标签 视频 fg / 垫底', c('--kind-video-fg'), over(c('--tag-scrim'), [128, 128, 128, 1]), 4.5],
    ['标签 .lc-chip 字 / 底', c('--text-2'), film(card, 0.1), 4.5],
    ['强调标签 --chip-fg / --chip-bg', c('--chip-fg'), over(c('--chip-bg'), card), 4.5],
    ['压在画面上的字 --on-scrim / 遮罩 66%（中灰画面）', over(c('--on-scrim'), over(chan(set, '--c-scrim', 0.66), [128, 128, 128, 1])), over(chan(set, '--c-scrim', 0.66), [128, 128, 128, 1]), 4.5],
    ['TDesign 品牌色 --brand / 弹层', c('--brand'), pop, 3],
    ['禁用字 --text-disabled / 卡片（不要求）', c('--text-disabled'), card, 0],
    ['描边 --line-3 / 卡片（输入框悬停）', over(c('--line-3'), card), card, 0],
    ['端口描边 --cyan / 画布底', c('--cyan'), c('--flow-bg'), 3],
    ['连线 图片起点 / 画布底', c('--wire-image-a'), c('--flow-bg'), 0],
    ['连线 图片终点 / 画布底', c('--wire-image-b'), c('--flow-bg'), 3],
    ['连线 视频起点 / 画布底', c('--wire-video-a'), c('--flow-bg'), 0],
    ['连线 文本起点 / 画布底', c('--wire-text-a'), c('--flow-bg'), 3],
    ['拖线预览 / 画布底', c('--wire-draft'), c('--flow-bg'), 3],
  ]
  return rows
}

for (const [name, set] of [['深色', dark], ['浅色', { ...dark, ...light }]]) {
  console.log(`\n对比度 · ${name}`)
  for (const [label, fg, bg, min] of pairs(set)) {
    const r = ratio(fg, bg)
    const bad = min > 0 && r < min
    if (bad) failed = true
    console.log(`  ${bad ? '✗' : ' '} ${r.toFixed(2).padStart(5)}  ${hex(fg)} / ${hex(bg)}  ${label}${min ? `（≥ ${min}）` : ''}`)
  }
}

// ---------- 裸色值 ----------
const NAMED = 'white|black|red|green|blue|gray|grey|silver|navy|teal|orange|yellow|purple|pink|cyan|magenta'
const LITERAL = new RegExp(`#[0-9a-fA-F]{3,8}\\b|\\b(?:rgba?|hsla?)\\(\\s*[\\d.]+|(?<![\\w-])(?:color|background(?:-color)?|fill|stroke|border(?:-[a-z]+)?-color|stop-color)\\s*[:=]\\s*["']?(?:${NAMED})\\b`, 'g')
const walk = (dir, out = []) => { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); fs.statSync(p).isDirectory() ? walk(p, out) : out.push(p) } return out }
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
  .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')

console.log('\n令牌文件之外的裸色值 · 源码')
let n = 0
for (const p of walk(src).filter((p) => /\.(vue|css|ts)$/.test(p) && p !== TOKENS && !rel(p).startsWith('src/locales/'))) {
  stripComments(fs.readFileSync(p, 'utf8')).split('\n').forEach((line, i) => {
    // 遮罩技巧里的 #000（mask 只看 alpha，和主题无关）不算
    const hits = (line.replace(/linear-gradient\(#000 0 0\)/g, '').match(LITERAL) || [])
    if (!hits.length) return
    n += hits.length
    console.log(`  ${rel(p)}:${i + 1}  ${hits.join(' ')}  | ${line.trim().slice(0, 110)}`)
  })
}
for (const p of [path.join(root, 'index.html'), path.join(root, 'public/theme-boot.js')]) {
  stripComments(fs.readFileSync(p, 'utf8')).split('\n').forEach((line, i) => {
    const hits = line.match(LITERAL) || []
    if (!hits.length) return
    n += hits.length
    console.log(`  ${rel(p)}:${i + 1}  ${hits.join(' ')}`)
  })
}
console.log(`共 ${n} 处`)

const dist = process.argv[2]
if (dist) {
  console.log('\n令牌文件之外的裸色值 · 构建产物 ' + dist)
  const assets = path.join(dist, 'assets')
  // 第三方样式（TDesign / vue-flow 自带的皮肤）和令牌定义本身不算：只看我们自己写的规则
  const THIRD = /(^|[\s,>+~(])\.t-[\w-]|\.vue-flow__(?:node-(?:input|output|default|group)|edge|controls|minimap|handle|background|connection|selection|nodesselection|resize-control|pane|panel|transformationpane|viewport|container|edgelabel|edge-|arrowhead)|^\.vue-flow\b|^\.vue-flow[ ,.]|\[theme-mode|^:root|\.lc-theme-|\[data-ground|^@font-face|^::view-transition|^html\b/
  let cssN = 0, cssRules = 0
  const cssHits = {}
  for (const f of fs.readdirSync(assets).filter((f) => f.endsWith('.css'))) {
    const text = fs.readFileSync(path.join(assets, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim()
      if (THIRD.test(sel) || /^(from|to|\d+%)/.test(sel)) continue
      cssRules++
      // 去掉自定义属性的定义（TDesign 组件样式里自带的局部令牌）和遮罩技巧
      const body = m[2].replace(/--[\w-]+\s*:[^;]*;?/g, '').replace(/linear-gradient\(#000 0 0\)/g, '')
      const hits = body.match(LITERAL) || []
      if (!hits.length) continue
      cssN += hits.length
      const key = `${f.replace(/-[\w-]{8}\.css$/, '.css')}  ${sel.slice(0, 70)}`
      cssHits[key] = (cssHits[key] || []).concat(hits)
    }
  }
  for (const [k, v] of Object.entries(cssHits)) console.log(`  css  ${k}  ${[...new Set(v)].join(' ')}`)
  console.log(`  CSS：查了 ${cssRules} 条自己的规则，裸色值 ${cssN} 处`)
  let jsN = 0
  for (const f of fs.readdirSync(assets).filter((f) => f.endsWith('.js') && !/^vendor-/.test(f))) {
    const text = fs.readFileSync(path.join(assets, f), 'utf8')
    // 库代码打进同一个 chunk 的（TDesign 的取色器、dayjs 等）靠特征跳过：只报出现在引号里的色值
    const hits = [...text.matchAll(/["'`]([^"'`\n]{0,40}?(?:#[0-9a-fA-F]{6}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+)[^"'`\n]{0,30})["'`]/g)].map((m) => m[1])
    if (!hits.length) continue
    jsN += hits.length
    console.log(`  js   ${f.replace(/-[\w-]{8}\.js$/, '.js')}  ${[...new Set(hits)].slice(0, 12).join(' | ').slice(0, 300)}${hits.length > 12 ? ` …(+${hits.length - 12})` : ''}`)
  }
  console.log(`  JS：带色值的字符串 ${jsN} 处`)
}

if (failed) { console.log('\n有问题，见上面带 ✗ 的行。'); process.exit(1) }
console.log('\n令牌名对得上，对比度都够。')
