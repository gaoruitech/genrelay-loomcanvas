'use strict'

/**
 * Server-side message catalog.
 *
 * Everything the server says to a user is identified by a catalog key and
 * rendered in the language of the request that reads it:
 *
 *   t(locale, key, params)       -> text
 *   msg(key, params)             -> { code, params }, a message that is not
 *                                   rendered yet (it can be stored, nested as a
 *                                   parameter of another message, or thrown)
 *   new LocalizedError(key, ...) -> an error carrying such a message in `.i18n`
 *
 * Catalogs are flat objects with `{name}` placeholders. A parameter may itself
 * be a message (`{ code, params }`), which is rendered in the same language -
 * that is how "Could not read the {what}" gets its noun.
 */
const CATALOGS = {
  'zh-CN': require('./zh-CN'),
  en: require('./en'),
}

const LOCALES = Object.keys(CATALOGS)
const FALLBACK_LOCALE = 'zh-CN'
/** Carries text that has no catalog entry (a billing hook's reason, a plugin's own error). */
const RAW = 'common.raw'

/** 'zh', 'zh-TW', 'ZH_cn' -> 'zh-CN'; 'en-US' -> 'en'; anything else -> null. */
function normalizeLocale(value) {
  if (typeof value !== 'string') return null
  const tag = value.trim().toLowerCase().replace(/_/g, '-')
  if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-CN'
  if (tag === 'en' || tag.startsWith('en-')) return 'en'
  return null
}

/** First supported language of an Accept-Language header, by descending q. */
function fromAcceptLanguage(header) {
  if (typeof header !== 'string' || !header) return null
  const ranked = header.slice(0, 400).split(',').map((part, index) => {
    const [tag, ...attrs] = part.trim().split(';')
    const q = attrs.map((a) => /^\s*q=([\d.]+)\s*$/.exec(a)).find(Boolean)
    const weight = q ? Number(q[1]) : 1
    return { tag, weight: Number.isFinite(weight) ? weight : 0, index }
  })
  ranked.sort((a, b) => (b.weight - a.weight) || (a.index - b.index))
  for (const { tag, weight } of ranked) {
    const locale = weight > 0 ? normalizeLocale(tag) : null
    if (locale) return locale
  }
  return null
}

/**
 * Language of a request: the X-Locale header the frontend sends, then
 * Accept-Language, then the site's default language, then zh-CN.
 */
function resolveLocale(headers, siteDefault) {
  const h = headers || {}
  return normalizeLocale(h['x-locale'])
    || fromAcceptLanguage(h['accept-language'])
    || normalizeLocale(siteDefault)
    || FALLBACK_LOCALE
}

function isMessage(v) {
  return !!v && typeof v === 'object' && typeof v.code === 'string'
}

function msg(code, params) {
  return { code, params: params || {} }
}

function has(key) {
  return typeof key === 'string' && Object.hasOwn(CATALOGS[FALLBACK_LOCALE], key)
}

function template(locale, key) {
  const catalog = CATALOGS[locale] || CATALOGS[FALLBACK_LOCALE]
  if (Object.hasOwn(catalog, key)) return catalog[key]
  if (Object.hasOwn(CATALOGS[FALLBACK_LOCALE], key)) return CATALOGS[FALLBACK_LOCALE][key]
  return null
}

/** Render a catalog entry. An unknown key renders as the key itself. */
function t(locale, key, params) {
  const tpl = template(locale, key)
  if (tpl === null) return String(key)
  return tpl.replace(/\{(\w+)\}/g, (_m, name) => {
    const v = params ? params[name] : undefined
    if (v === undefined || v === null) return ''
    return isMessage(v) ? t(locale, v.code, v.params) : String(v)
  })
}

/** Render a message object; plain strings pass through. */
function render(locale, message) {
  if (isMessage(message)) return t(locale, message.code, message.params)
  return message === undefined || message === null ? '' : String(message)
}

/**
 * An error meant for the user. `key` is a catalog key or a message object.
 * `.message` is the English text (for logs); `.i18n` is what gets shown.
 */
class LocalizedError extends Error {
  constructor(key, params, extra) {
    const i18n = isMessage(key) ? msg(key.code, key.params) : msg(key, params)
    super(t('en', i18n.code, i18n.params))
    this.name = 'LocalizedError'
    this.userFacing = true
    this.i18n = i18n
    if (extra) Object.assign(this, extra)
  }
}

/**
 * The message of a user-facing error. Errors from outside our own code
 * (plugins, billing hooks) only have text; that is passed through as it is.
 * Null when the error is not meant for the user.
 */
function messageOf(err) {
  if (!err || !err.userFacing) return null
  if (isMessage(err.i18n)) return err.i18n
  return err.message ? msg(RAW, { text: String(err.message).slice(0, 500) }) : null
}

/**
 * Fields to store for an error that is read later (a run's failure reason):
 * the message itself plus its text in the fallback language, which is what
 * records written before the catalog existed have and what is shown if a key
 * ever disappears.
 */
function storedError(message) {
  return {
    error: render(FALLBACK_LOCALE, message).slice(0, 500),
    errorCode: message.code,
    errorParams: message.params || {},
  }
}

/** The stored error of a record, in the reader's language. */
function renderStored(locale, record) {
  if (!record) return ''
  if (record.errorCode && has(record.errorCode)) return t(locale, record.errorCode, record.errorParams).slice(0, 500)
  return record.error || ''
}

module.exports = {
  LOCALES,
  FALLBACK_LOCALE,
  RAW,
  CATALOGS,
  normalizeLocale,
  fromAcceptLanguage,
  resolveLocale,
  isMessage,
  msg,
  has,
  t,
  render,
  LocalizedError,
  messageOf,
  storedError,
  renderStored,
}
