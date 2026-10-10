'use strict'

/** Small input validation helpers. Routes never trust req.body/req.query shapes. */
const mongoose = require('mongoose')
const { badRequest } = require('./http')

function isObjectId(v) {
  return typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v) && mongoose.Types.ObjectId.isValid(v)
}

/** Throws 400 unless the value is a 24-hex ObjectId string. */
function requireObjectId(v, name = 'id') {
  if (!isObjectId(v)) throw badRequest('validation.bad_format', { field: name })
  return v
}

function clampInt(v, lo, hi, dft) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return dft
  return Math.min(hi, Math.max(lo, n))
}

function pageParams(query, { defaultSize = 20, maxSize = 100 } = {}) {
  const page = clampInt(query && query.page, 1, 100000, 1)
  const pageSize = clampInt(query && query.pageSize, 1, maxSize, defaultSize)
  return { page, pageSize, skip: (page - 1) * pageSize }
}

/** Trimmed string capped at max chars; non-strings become ''. */
function text(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * A media reference the canvas may store: an http(s) URL or a site-relative
 * /files/ path (local storage without PUBLIC_URL). Never data: URIs - inline
 * base64 would blow up workflow documents.
 */
function isMediaUrl(v) {
  if (typeof v !== 'string' || !v || v.length > 2048) return false
  if (v.startsWith('/files/')) return true
  return /^https?:\/\//i.test(v)
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Parse a date-ish query value; returns null when absent, throws 400 when invalid. */
function parseDate(v, name) {
  if (v === undefined || v === null || v === '') return null
  const d = new Date(/^\d+$/.test(String(v)) ? Number(v) : String(v))
  if (Number.isNaN(d.getTime())) throw badRequest('validation.bad_date', { field: name })
  return d
}

const BARE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** An IANA time zone name the runtime knows ("Asia/Shanghai"), or 400. Absent -> 'UTC'. */
function parseTimeZone(v, name = 'tz') {
  if (v === undefined || v === null || v === '') return 'UTC'
  if (typeof v !== 'string' || v.length > 64) throw badRequest('validation.invalid', { field: name })
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: v }).resolvedOptions().timeZone
  } catch {
    throw badRequest('validation.invalid', { field: name })
  }
}

const zoneFormatters = new Map()

/** The calendar date an instant falls on in a zone, as a sortable number (20250131). */
function localDayKey(tz, ms) {
  let fmt = zoneFormatters.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' })
    if (zoneFormatters.size < 600) zoneFormatters.set(tz, fmt)
  }
  const f = {}
  for (const p of fmt.formatToParts(new Date(ms))) f[p.type] = Number(p.value)
  return f.year * 10000 + f.month * 100 + f.day
}

/**
 * The instant a calendar day begins in a time zone: the first second whose
 * local date is that day or later. Found by search rather than by subtracting
 * an offset, so a day whose midnight does not exist (clocks jump at 00:00)
 * and a zone whose offset changed that night both come out right.
 * `plusDays` moves by calendar days, which is not always 24 hours.
 */
function startOfDayIn(tz, year, month, day, plusDays = 0) {
  const target = new Date(Date.UTC(year, month - 1, day + plusDays))
  const key = target.getUTCFullYear() * 10000 + (target.getUTCMonth() + 1) * 100 + target.getUTCDate()
  // No zone is more than 14 hours from UTC; 26 leaves room for the odd historical one.
  let lo = target.getTime() / 1000 - 26 * 3600 // local date is still earlier here
  let hi = target.getTime() / 1000 + 26 * 3600 // and already that day or later here
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (localDayKey(tz, mid * 1000) >= key) hi = mid
    else lo = mid
  }
  return new Date(hi * 1000)
}

/**
 * A date for a range filter. A bare date ("2025-01-31") is a calendar day in
 * `tz` and resolves to the start of that day, or of the day `plusDays` later;
 * anything else is an instant and is taken as it is (see parseDate).
 * Returns { date, bare } or null when absent.
 */
function parseDayOrInstant(v, name, tz = 'UTC', plusDays = 0) {
  if (v === undefined || v === null || v === '') return null
  const m = typeof v === 'string' ? BARE_DATE_RE.exec(v) : null
  if (!m) return { date: parseDate(v, name), bare: false }
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const check = new Date(Date.UTC(y, mo - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) throw badRequest('validation.bad_date', { field: name })
  return { date: startOfDayIn(tz, y, mo, d, plusDays), bare: true }
}

module.exports = { isObjectId, requireObjectId, clampInt, pageParams, text, isPlainObject, isMediaUrl, escapeRegExp, parseDate, parseTimeZone, parseDayOrInstant, startOfDayIn }
