// 库构建：把两个集成入口打成可以直接被别的项目引用的 ES 模块。
// 用法：node scripts/build-lib.mjs [--no-types] [--no-standalone]
//
// 产物（web/dist-lib/）：
//   app.js / editor.js              入口，vue 是外部依赖（对等依赖）
//   app.css / editor.css            每个入口一份样式表（所有规则限制在 .lc-root 之内）
//   standalone/app.js / editor.js   同样的入口，vue 也打在里面（没有打包工具的页面用）
//   chunks/                         按需加载的代码块
//   fonts.css + fonts/              三款自托管字体（可选；见 docs/integration.md）
//   types/                          类型声明
//   licenses/fonts-OFL-1.1.txt      字体的协议全文
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'dist-lib')
const args = new Set(process.argv.slice(2))
// 直接用 node 跑两个工具的入口脚本：不经 shell，Windows 上也不用管 .cmd
const VITE = path.join(root, 'node_modules/vite/bin/vite.js')
const VUE_TSC = path.join(root, 'node_modules/vue-tsc/bin/vue-tsc.js')
function run(script, argv, env = {}) {
  const once = () => execFileSync(process.execPath, [script, ...argv], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  try { once() } catch (err) {
    // 工具自己报错（退出码 1 之类）就照常失败；进程是被系统杀掉 / 原生崩溃的（没有退出码，或是个很大的数）才重试一次
    if (typeof err.status === 'number' && err.status >= 0 && err.status < 128) throw err
    console.warn(`[build-lib] ${path.basename(script)} crashed (status ${err.status}, signal ${err.signal}); trying once more`)
    once()
  }
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'chunks'), { recursive: true })

function moveDir(from, to) {
  if (!fs.existsSync(from)) return
  fs.mkdirSync(to, { recursive: true })
  for (const name of fs.readdirSync(from)) fs.renameSync(path.join(from, name), path.join(to, name))
}

function build(entry, standalone) {
  const tmp = path.join(out, `.tmp-${entry}${standalone ? '-sa' : ''}`)
  run(VITE, ['build', '--config', 'vite.lib.config.ts'], { LC_LIB_ENTRY: entry, LC_LIB_STANDALONE: standalone ? '1' : '', LC_LIB_OUT: tmp })
  const dest = standalone ? path.join(out, 'standalone') : out
  fs.mkdirSync(path.join(dest, 'chunks'), { recursive: true })
  fs.renameSync(path.join(tmp, `${entry}.js`), path.join(dest, `${entry}.js`))
  moveDir(path.join(tmp, 'chunks'), path.join(dest, 'chunks'))
  // 样式表：一次构建只出一份。两种打法出来是同一份，只留不带 vue 的那一次的
  const assets = path.join(tmp, 'assets')
  const sheets = fs.existsSync(assets) ? fs.readdirSync(assets).filter((n) => n.endsWith('.css')) : []
  if (sheets.length !== 1) throw new Error(`expected one stylesheet for ${entry}, got ${sheets.length}`)
  if (!standalone) fs.renameSync(path.join(assets, sheets[0]), path.join(out, `${entry}.css`))
  else fs.rmSync(path.join(assets, sheets[0]))
  // 库模式下别的静态资源都内联了；万一哪天多出文件来，这里会报出来而不是悄悄丢掉
  const rest = fs.readdirSync(assets)
  if (rest.length) throw new Error(`unexpected asset files in the ${entry} build: ${rest.join(', ')}`)
  fs.rmSync(tmp, { recursive: true, force: true })
}

for (const entry of ['app', 'editor']) {
  build(entry, false)
  if (!args.has('--no-standalone')) build(entry, true)
}

// ---------- 字体：文件原样拷过去，样式表里用相对地址 ----------
const FONTS = [
  { pkg: 'inter', family: 'Inter Variable', weight: '100 900' },
  { pkg: 'sora', family: 'Sora Variable', weight: '100 800' },
  { pkg: 'jetbrains-mono', family: 'JetBrains Mono Variable', weight: '100 800' },
]
fs.mkdirSync(path.join(out, 'fonts'), { recursive: true })
fs.mkdirSync(path.join(out, 'licenses'), { recursive: true })
const rule = '='.repeat(78)
const faces = []
const notices = ['Fonts bundled with the LoomCanvas web app', '']
for (const f of FONTS) {
  const dir = path.join(root, 'node_modules/@fontsource-variable', f.pkg)
  const file = `${f.pkg}-latin-wght-normal.woff2`
  fs.copyFileSync(path.join(dir, 'files', file), path.join(out, 'fonts', file))
  faces.push(`@font-face {\n  font-family: '${f.family}';\n  font-style: normal; font-display: swap; font-weight: ${f.weight};\n  src: url('./fonts/${file}') format('woff2-variations');\n}`)
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const text = fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8').split(/\r?\n/).join('\n').trim()
  notices.push(rule, `${meta.name}@${meta.version}`, `File shipped unmodified: ${file}`, rule, '', text, '')
}
fs.writeFileSync(path.join(out, 'fonts.css'), [
  '/* Optional. The three self-hosted variable fonts LoomCanvas is designed with (SIL OFL 1.1, Latin subset).',
  '   @font-face cannot be scoped: these family names are registered for the whole document.',
  '   Leave this file out to fall back to system fonts, or declare the same family names with your own files. */',
  ...faces, '',
].join('\n'))
fs.writeFileSync(path.join(out, 'licenses', 'fonts-OFL-1.1.txt'), notices.join('\n'))

// ---------- 类型声明 ----------
if (!args.has('--no-types')) {
  const tmp = path.join(out, '.tmp-types')
  run(VUE_TSC, ['-p', 'tsconfig.lib.json', '--outDir', tmp])
  const PUBLIC = ['embed/app.d.ts', 'embed/editor.d.ts', 'embed/types.d.ts', 'embed/document.d.ts', 'embed/httpAdapter.d.ts', 'embed/memoryAdapter.d.ts', 'types/index.d.ts']
  for (const rel of PUBLIC) {
    const src = path.join(tmp, rel)
    if (!fs.existsSync(src)) throw new Error(`type declaration missing: ${rel}`)
    const text = fs.readFileSync(src, 'utf8')
    // 对外的声明只能引 vue 和彼此：引到应用内部（@/...）说明有内部类型漏进了公开接口
    const leak = text.match(/from ['"](@\/[^'"]+|\.\.?\/(?!types|document|httpAdapter|memoryAdapter)[^'"]+)['"]/)
    if (leak) throw new Error(`${rel} refers to an internal module: ${leak[1]}`)
    const dest = path.join(out, 'types', rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, text)
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}

// ---------- 报告 ----------
const kb = (n) => `${(n / 1024).toFixed(1)} kB`
function sizeOf(file) {
  const buf = fs.readFileSync(file)
  return { raw: buf.length, gz: zlib.gzipSync(buf).length }
}
function dirSize(dir) {
  let raw = 0, gz = 0, n = 0
  if (!fs.existsSync(dir)) return { raw, gz, n }
  for (const name of fs.readdirSync(dir)) {
    const s = sizeOf(path.join(dir, name)); raw += s.raw; gz += s.gz; n++
  }
  return { raw, gz, n }
}
console.log('\nloomcanvas-web library build')
const rows = [['file', 'size', 'gzip']]
for (const rel of ['app.js', 'editor.js', 'app.css', 'editor.css', 'fonts.css', 'standalone/app.js', 'standalone/editor.js']) {
  const p = path.join(out, rel)
  if (!fs.existsSync(p)) continue
  const s = sizeOf(p)
  rows.push([rel, kb(s.raw), kb(s.gz)])
}
for (const rel of ['chunks', 'standalone/chunks', 'fonts']) {
  const s = dirSize(path.join(out, rel))
  if (s.n) rows.push([`${rel}/ (${s.n} files)`, kb(s.raw), kb(s.gz)])
}
const w = rows.reduce((m, r) => Math.max(m, r[0].length), 0)
for (const r of rows) console.log(`  ${r[0].padEnd(w)}  ${r[1].padStart(10)}  ${r[2].padStart(10)}`)
