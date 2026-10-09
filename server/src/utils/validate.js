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

module.exports = { isObjectId, requireObjectId, clampInt, pageParams, text, isPlainObject, isMediaUrl, escapeRegExp, parseDate }
