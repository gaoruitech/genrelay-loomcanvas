'use strict'

/**
 * Site settings: a fixed set of keys with validation, stored as key/value
 * documents and cached in memory. Reads are synchronous after load().
 */
const Setting = require('../models/Setting')
const { LOCAL_USER } = require('../constants')
const { badRequest } = require('../utils/http')
const { isMediaUrl } = require('../utils/validate')

const int = (min, max) => (v, key) => {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw badRequest('validation.int_range', { field: key, min, max })
  return n
}
const oneOf = (...values) => (v, key) => {
  if (!values.includes(v)) throw badRequest('validation.one_of', { field: key, values: values.join(' / ') })
  return v
}
const string = (max) => (v, key) => {
  if (typeof v !== 'string') throw badRequest('validation.string', { field: key })
  return v.trim().slice(0, max)
}

/** key -> { default, parse } */
const DEFINITIONS = {
  siteName: { default: 'LoomCanvas', parse: string(40) },
  logoUrl: {
    default: '',
    parse: (v, key) => {
      const s = string(2048)(v, key)
      if (s && !isMediaUrl(s)) throw badRequest('settings.logo_url')
      return s
    },
  },
  defaultTheme: { default: 'light', parse: oneOf('light', 'dark', 'system') },
  defaultLocale: { default: 'zh-CN', parse: oneOf('zh-CN', 'en') },
  // Runner
  concurrency: { default: 4, parse: int(1, 32) },
  submitTimeoutSec: { default: 60, parse: int(5, 600) },
  imageTimeoutMinutes: { default: 10, parse: int(1, 120) },
  videoTimeoutMinutes: { default: 30, parse: int(1, 240) },
  chatTimeoutSec: { default: 300, parse: int(10, 3600) },
  downloadTimeoutSec: { default: 300, parse: int(10, 3600) },
  maxRetries: { default: 2, parse: int(0, 5) },
  // 0 = keep generated files forever
  retentionDays: { default: 0, parse: int(0, 3650) },
}

const cache = new Map()
const listeners = new Set()

function defaults() {
  return Object.fromEntries(Object.entries(DEFINITIONS).map(([k, d]) => [k, d.default]))
}

async function load() {
  const rows = await Setting.find({ userId: LOCAL_USER }).lean()
  cache.clear()
  for (const row of rows) {
    const def = DEFINITIONS[row.key]
    if (!def) continue
    // A stored value that no longer validates falls back to the default.
    try { cache.set(row.key, def.parse(row.value, row.key)) } catch { /* use default */ }
  }
}

function getAll() {
  return { ...defaults(), ...Object.fromEntries(cache) }
}

function get(key) {
  return cache.has(key) ? cache.get(key) : DEFINITIONS[key].default
}

/** Validate and persist a partial update. Unknown keys are rejected. */
async function update(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw badRequest('validation.body_object')
  const parsed = {}
  for (const [key, value] of Object.entries(patch)) {
    const def = DEFINITIONS[key]
    if (!def) throw badRequest('settings.unknown_key', { key: String(key).slice(0, 40) })
    parsed[key] = def.parse(value, key)
  }
  for (const [key, value] of Object.entries(parsed)) {
    await Setting.updateOne({ key }, { $set: { value, userId: LOCAL_USER } }, { upsert: true })
    cache.set(key, value)
  }
  for (const fn of listeners) {
    try { fn(getAll()) } catch { /* listeners must not break saves */ }
  }
  return getAll()
}

function onChange(fn) { listeners.add(fn) }

/** Runner timing derived from settings, in milliseconds. */
function runnerSettings() {
  const s = getAll()
  return {
    concurrency: s.concurrency,
    submitTimeoutMs: s.submitTimeoutSec * 1000,
    pollTimeoutMs: { image: s.imageTimeoutMinutes * 60000, video: s.videoTimeoutMinutes * 60000 },
    chatTimeoutMs: s.chatTimeoutSec * 1000,
    downloadTimeoutMs: s.downloadTimeoutSec * 1000,
    retries: s.maxRetries,
  }
}

module.exports = { DEFINITIONS, defaults, load, get, getAll, update, onChange, runnerSettings }
