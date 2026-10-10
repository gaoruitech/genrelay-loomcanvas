'use strict'

/**
 * The message catalog: both languages complete, every key the code uses
 * present, no user-facing Chinese left in the code, and the rules for picking
 * a language and rendering a message.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const i18n = require('../src/i18n')
const zh = require('../src/i18n/zh-CN')
const en = require('../src/i18n/en')

const SRC = path.join(__dirname, '..', 'src')
const rel = (file) => path.relative(SRC, file).split(path.sep).join('/')

function sourceFiles(dir = SRC) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.(js|json)$/.test(name)) out.push(full)
  }
  return out
}

/** Source text with comments blanked out; string and template literals are kept. */
function withoutComments(code) {
  let out = ''
  let quote = ''
  for (let i = 0; i < code.length; i++) {
    const c = code[i]
    const next = code[i + 1]
    if (quote) {
      out += c
      if (c === '\\') out += code[++i] || ''
      else if (c === quote) quote = ''
    } else if (c === '/' && next === '/') {
      while (i < code.length && code[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2)
      i = end < 0 ? code.length : end + 1
      out += ' '
    } else {
      if (c === '\'' || c === '"' || c === '`') quote = c
      out += c
    }
  }
  return out
}

const placeholders = (s) => [...new Set(s.match(/\{\w+\}/g) || [])].sort()

/* Keys that are built at run time from stable identifiers. */
const DYNAMIC = [/^provider\.[a-z0-9-]+\.label$/, /^model\.[a-z0-9-]+\..+\.desc$/, /^export\.\w+$/]
const isDynamic = (key) => DYNAMIC.some((re) => re.test(key))

test('both catalogs have exactly the same keys and placeholders', () => {
  assert.deepEqual(Object.keys(en).filter((k) => !(k in zh)), [], 'keys missing from zh-CN')
  assert.deepEqual(Object.keys(zh).filter((k) => !(k in en)), [], 'keys missing from en')
  for (const key of Object.keys(zh)) {
    assert.ok(typeof zh[key] === 'string' && zh[key], `${key} (zh-CN) is empty`)
    assert.ok(typeof en[key] === 'string' && en[key], `${key} (en) is empty`)
    assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), `${key}: placeholders differ`)
    assert.doesNotMatch(en[key], /[㐀-鿿]/, `${key}: the English text contains Chinese`)
  }
})

test('every key used in the code exists, and every catalog entry is used', () => {
  const namespaces = new Set(Object.keys(zh).map((k) => k.split('.')[0]))
  // Keys are always written as single-quoted literals: 'namespace.name'.
  const literal = /'([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)+)'/g
  const used = new Set()
  const missing = []
  for (const file of sourceFiles()) {
    if (['i18n/zh-CN.js', 'i18n/en.js'].includes(rel(file)) || file.endsWith('.json')) continue
    const code = withoutComments(fs.readFileSync(file, 'utf8'))
    for (const m of code.matchAll(literal)) {
      const key = m[1]
      if (!namespaces.has(key.split('.')[0])) continue
      used.add(key)
      if (!(key in zh)) missing.push(`${rel(file)}: ${key}`)
    }
  }
  assert.deepEqual(missing, [], 'keys used in code but absent from the catalogs')
  const unused = Object.keys(zh).filter((k) => !used.has(k) && !isDynamic(k))
  assert.deepEqual(unused, [], 'catalog entries nothing refers to')
})

test('keys built at run time exist for every built-in provider, model and export size', () => {
  const registry = require('../src/providers')
  const { PLATFORM_SIZES } = require('../src/services/imageTools')
  const expected = new Set()
  for (const type of ['gaorui', 'openai', 'gemini']) {
    expected.add(`provider.${type}.label`)
    for (const m of registry.getType(type).catalog) expected.add(`model.${type}.${m.id}.desc`)
  }
  for (const group of Object.values(PLATFORM_SIZES)) for (const key of Object.keys(group)) expected.add(`export.${key}`)
  assert.deepEqual([...expected].filter((k) => !(k in zh)), [], 'missing')
  assert.deepEqual(Object.keys(zh).filter((k) => isDynamic(k) && !expected.has(k)), [], 'stale')

  // The registry serves them in the reader's language; ids stay put.
  const vendor = (locale) => registry.listVendors(locale).find((p) => p.type === 'gaorui')
  assert.equal(vendor('en').label, en['provider.gaorui.label'])
  assert.equal(vendor('zh-CN').label, '高瑞')
  assert.equal(vendor('zh-CN').models.find((m) => m.model === 'omni-flash').desc, zh['model.gaorui.omni-flash.desc'])
  const spec = { id: 'mine:nano-banana-2.1', providerType: 'gaorui', label: 'x' }
  assert.equal(registry.localizeSpec(spec, 'en').desc, en['model.gaorui.nano-banana-2.1.desc'])
  assert.equal(registry.localizeSpec({ ...spec, id: 'mine:unknown', desc: 'own' }, 'en').desc, 'own')
  assert.equal(registry.localizeSpec({ ...spec, custom: true }, 'en').desc, undefined, 'a custom model that shares a name borrows no description')
})

test('no Chinese text in the server code outside the zh-CN catalog, the seed content and comments', () => {
  const allowed = new Set(['i18n/zh-CN.js', 'services/seed.js'])
  const offenders = []
  for (const file of sourceFiles()) {
    if (allowed.has(rel(file))) continue
    const raw = fs.readFileSync(file, 'utf8')
    const code = file.endsWith('.json') ? raw : withoutComments(raw)
    code.split('\n').forEach((line, i) => {
      if (/[㐀-鿿]/.test(line)) offenders.push(`${rel(file)}:${i + 1}: ${line.trim().slice(0, 80)}`)
    })
  }
  assert.deepEqual(offenders, [])
})

test('language of a request: X-Locale, then Accept-Language, then the site default, then zh-CN', () => {
  const { resolveLocale } = i18n
  assert.equal(resolveLocale({ 'x-locale': 'en', 'accept-language': 'zh-CN' }, 'zh-CN'), 'en')
  assert.equal(resolveLocale({ 'x-locale': 'zh-CN', 'accept-language': 'en' }, 'en'), 'zh-CN')
  assert.equal(resolveLocale({ 'accept-language': 'en-GB,en;q=0.9' }, 'zh-CN'), 'en')
  assert.equal(resolveLocale({ 'accept-language': 'fr-FR,zh-TW;q=0.6,en;q=0.7' }, 'zh-CN'), 'en', 'highest q among supported')
  assert.equal(resolveLocale({ 'accept-language': 'fr,en;q=0' }, 'zh-CN'), 'zh-CN', 'q=0 means not acceptable')
  assert.equal(resolveLocale({ 'x-locale': 'klingon', 'accept-language': 'fr, de' }, 'en'), 'en')
  assert.equal(resolveLocale({}, 'en'), 'en')
  assert.equal(resolveLocale({}, undefined), 'zh-CN')
  assert.equal(resolveLocale(undefined, 'nonsense'), 'zh-CN')
  assert.equal(i18n.normalizeLocale('ZH_hans'), 'zh-CN')
  assert.equal(i18n.normalizeLocale('en-US'), 'en')
  assert.equal(i18n.normalizeLocale(['en']), null)
})

test('placeholders: values, nested messages, missing values, unknown keys', () => {
  const { t, msg, render } = i18n
  assert.equal(t('en', 'validation.int_range', { field: 'concurrency', min: 1, max: 32 }), 'concurrency must be a whole number from 1 to 32')
  assert.equal(t('zh-CN', 'validation.int_range', { field: 'concurrency', min: 1, max: 32 }), 'concurrency 必须是 1-32 之间的整数')
  // A parameter that is itself a message is rendered in the same language.
  const nested = { what: msg('noun.nth_image', { n: 3 }) }
  assert.equal(t('en', 'tool.unreadable', nested), 'Could not read image 3')
  assert.equal(t('zh-CN', 'tool.unreadable', nested), '第 3 张图读取失败')
  assert.equal(t('en', 'upstream.failed_detail', { detail: '内容违规 {status}' }), 'Generation failed at the upstream: 内容违规 {status}', 'values are not re-scanned')
  assert.equal(t('en', 'validation.required', {}), ' is required')
  assert.equal(t('en', 'validation.required', { field: 0 }), '0 is required')
  assert.equal(t('en', 'no.such.key'), 'no.such.key')
  assert.equal(t('en', 'constructor'), 'constructor')
  assert.equal(t('pt-BR', 'run.canceled'), zh['run.canceled'], 'an unknown language falls back to zh-CN')
  assert.equal(render('en', msg('run.canceled')), 'Canceled')
  assert.equal(render('en', 'already text'), 'already text')
})

test('errors carry a message, not text: code and params survive to the response', () => {
  const { ApiError, badRequest } = require('../src/utils/http')
  const { errorHandler } = require('../src/middleware/errors')
  const err = badRequest('validation.max_items', { field: 'ids', max: 100 })
  assert.ok(err instanceof ApiError)
  assert.deepEqual([err.status, err.code, err.params], [400, 'validation.max_items', { field: 'ids', max: 100 }])
  assert.equal(err.message, 'ids can have at most 100 items', 'English in logs')

  const respond = (error, locale) => {
    const res = { headersSent: false, status(s) { this.statusCode = s; return this }, json(b) { this.body = b } }
    errorHandler(error, { locale, method: 'GET', originalUrl: '/x' }, res, () => {})
    return res
  }
  assert.deepEqual(respond(err, 'zh-CN').body, { result: -1, message: 'ids 最多 100 项', code: 'validation.max_items', data: null })
  assert.equal(respond(err, 'en').body.message, 'ids can have at most 100 items')
  // Text from outside our code (a plugin, a billing hook) is shown as it is and has no code.
  const foreign = respond(Object.assign(new Error('plugin says no'), { userFacing: true }), 'en')
  assert.deepEqual([foreign.statusCode, foreign.body.message, foreign.body.code], [400, 'plugin says no', ''])
})

test('a stored run error is rendered in the language of whoever reads it', async () => {
  const { serializeRun } = require('../src/runner')
  const { Runner } = require('../src/runner/core')
  const { createMemoryStore } = require('../src/runner/memoryStore')

  const store = createMemoryStore()
  const id = store.insert({ kind: 'image', modelId: 'p:m', cost: {} })
  const runner = new Runner({
    store,
    resolve: async () => ({
      provider: { async submit() { return { externalId: 'x' } }, async poll() { return { status: 'failed', error: 'NSFW content detected' } } },
      cfg: {},
      request: {},
    }),
    transfer: async (o) => o,
    billing: { async beforeRun() { return { allow: true } }, async afterRun() {}, async onFailed() {} },
    settings: () => ({ concurrency: 1, submitTimeoutMs: 1000, pollTimeoutMs: { image: 2000, video: 2000 }, chatTimeoutMs: 1000, downloadTimeoutMs: 1000, retries: 0 }),
    logger: { error() {} },
    pollIntervalMs: [5, 10],
  })
  runner.enqueue(id)
  let run
  for (let i = 0; i < 400 && !(run && run.status === 'failed'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    run = await store.get(id)
  }
  assert.equal(run.status, 'failed')
  assert.deepEqual([run.errorCode, run.errorParams], ['upstream.failed_detail', { detail: 'NSFW content detected' }])

  const doc = { ...run, _id: id }
  assert.equal(serializeRun(doc, 'en').error, 'Generation failed at the upstream: NSFW content detected')
  assert.equal(serializeRun(doc, 'zh-CN').error, '上游生成失败：NSFW content detected')
  assert.equal(serializeRun(doc, 'en').errorCode, 'upstream.failed_detail')

  // Records from before message codes existed only have text: shown unchanged.
  assert.equal(serializeRun({ _id: id, status: 'failed', error: '生成超时' }, 'en').error, '生成超时')
  // A code that a later version no longer knows falls back to the stored text too.
  assert.equal(serializeRun({ _id: id, status: 'failed', error: '旧文案', errorCode: 'run.removed_key' }, 'en').error, '旧文案')
  assert.equal(serializeRun({ _id: id, status: 'succeeded' }, 'en').error, '')
})
