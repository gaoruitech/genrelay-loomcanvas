// i18n 检查：
//  1. 语言文件之外是否还有中文字面量（注释不算）
//  2. zh-CN 与 en 的 key 是否一一对应
//  3. 代码里用到的 t('a.b.c') 是否都能在语言文件里找到
// 用法：node scripts/check-i18n.mjs        有问题时退出码为 1
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'src')
const HAN = /[一-龥]/

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const rel = (p) => path.relative(root, p).split(path.sep).join('/')
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
    .split('\n').map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')

const files = walk(src).filter((p) => /\.(vue|ts)$/.test(p))
const codeFiles = files.filter((p) => !rel(p).startsWith('src/locales/'))

// ---- 1. 残留中文 ----
const leftovers = []
for (const p of codeFiles) {
  const n = stripComments(fs.readFileSync(p, 'utf8')).split('\n').filter((l) => HAN.test(l)).length
  if (n) leftovers.push([n, rel(p)])
}
leftovers.sort((a, b) => b[0] - a[0])

// ---- 2/3. 语言文件：用 TypeScript 转成 JS 后加载 ----
const require = createRequire(import.meta.url)
const ts = require('typescript')
const tmp = fs.mkdtempSync(path.join(root, 'node_modules', '.i18n-check-'))
function emit(file) {
  const outFile = path.join(tmp, rel(file).replace(/\.ts$/, '.mjs'))
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  let js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  js = js.replace(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g, (m, q, spec) => `from ${q}${spec}.mjs${q}`)
  fs.writeFileSync(outFile, js)
  return outFile
}
const localeFiles = walk(path.join(src, 'locales')).filter((p) => p.endsWith('.ts') && !p.endsWith('index.ts'))
const emitted = Object.fromEntries(localeFiles.map((f) => [rel(f), emit(f)]))
const load = async (name) => (await import(pathToFileURL(emitted[`src/locales/${name}.ts`]).href)).default
const flat = (obj, prefix = '', out = new Set()) => {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, key, out)
    else out.add(key)
  }
  return out
}

let zh, en
try {
  zh = flat(await load('zh-CN'))
  en = flat(await load('en'))
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
const onlyZh = [...zh].filter((k) => !en.has(k))
const onlyEn = [...en].filter((k) => !zh.has(k))

const used = new Map()
const T_CALL = /(?:\$t|\bt|i18n\.global\.t|\btr)\(\s*(['"`])([A-Za-z0-9_.-]+)\1/g
for (const p of codeFiles) {
  const s = fs.readFileSync(p, 'utf8')
  for (const m of s.matchAll(T_CALL)) {
    if (!m[2].includes('.')) continue
    if (!used.has(m[2])) used.set(m[2], rel(p))
  }
}
// 以 "." 结尾的是模板字符串前缀（t(`a.b.${x}`)），只要求这个前缀下有 key
const missing = [...used].filter(([k]) => {
  const base = k.replace(/\.$/, '')
  return !zh.has(base) && ![...zh].some((z) => z.startsWith(base + '.'))
})

// ---- 输出 ----
console.log(`语言文件 key 数：zh-CN ${zh.size}，en ${en.size}`)
console.log(`语言文件之外仍含中文字面量的文件：${leftovers.length} 个，共 ${leftovers.reduce((a, b) => a + b[0], 0)} 行`)
for (const [n, p] of leftovers.slice(0, 30)) console.log(`  ${String(n).padStart(4)}  ${p}`)
console.log(`只在 zh-CN 有的 key：${onlyZh.length}`); onlyZh.slice(0, 20).forEach((k) => console.log('  ' + k))
console.log(`只在 en 有的 key：${onlyEn.length}`); onlyEn.slice(0, 20).forEach((k) => console.log('  ' + k))
console.log(`代码里用到但语言文件里没有的 key：${missing.length}`); missing.slice(0, 40).forEach(([k, f]) => console.log(`  ${k}   (${f})`))

process.exit(leftovers.length || onlyZh.length || onlyEn.length || missing.length ? 1 : 0)
