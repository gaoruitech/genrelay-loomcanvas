'use strict'

/**
 * Site settings: one set for the whole instance, changed by the owner. A fixed
 * set of keys with validation, stored as key/value documents and cached in
 * memory. Reads are synchronous after load().
 */
const Setting = require('../models/Setting')
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
const bool = () => (v, key) => {
  if (typeof v !== 'boolean') throw badRequest('validation.boolean', { field: key })
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
  // With a logo set: is the site name written next to it? `false` lets a logo that already
  // spells the name (a wordmark) stand alone. Without a logo the name is always shown.
  showSiteName: { default: true, parse: bool() },
  defaultLocale: { default: 'zh-CN', parse: oneOf('zh-CN', 'en') },
  // May people create accounts themselves? REGISTRATION_OPEN seeds it once, see seed().
  registrationOpen: { default: true, parse: bool() },
  // Runner. `concurrency` is for the whole instance; `userConcurrency` is how many of
  // those one account may hold at a time, `userQueueLimit` how many unfinished runs it may have.
  concurrency: { default: 4, parse: int(1, 32) },
  userConcurrency: { default: 4, parse: int(1, 32) },
  userQueueLimit: { default: 200, parse: int(1, 500) },
  submitTimeoutSec: { default: 60, parse: int(5, 600) },
  imageTimeoutMinutes: { default: 10, parse: int(1, 120) },
  videoTimeoutMinutes: { default: 30, parse: int(1, 240) },
  chatTimeoutSec: { default: 300, parse: int(10, 3600) },
  downloadTimeoutSec: { default: 300, parse: int(10, 3600) },
  maxRetries: { default: 2, parse: int(0, 5) },
  // 0 = keep generated files forever
  retentionDays: { default: 0, parse: int(0, 3650) },
  // Teams. How many teams one authorised account may create (and hold), how many members a
  // team may have, how many runs of one team may be in flight at once (a team's own value,
  // set by the super admin, wins over the last two), and for how many days a team's activity
  // log is kept (0 = for ever).
  teamMaxPerUser: { default: 3, parse: int(1, 100) },
  teamMaxMembers: { default: 50, parse: int(1, 1000) },
  teamConcurrency: { default: 4, parse: int(1, 32) },
  teamActivityDays: { default: 365, parse: int(0, 3650) },
}

const cache = new Map()
const listeners = new Set()

function defaults() {
  return Object.fromEntries(Object.entries(DEFINITIONS).map(([k, d]) => [k, d.default]))
}

async function load() {
  const rows = await Setting.find({}).lean()
  cache.clear()
  for (const row of rows) {
    // Rows of keys that no longer exist (`defaultTheme`: there is one theme now) and the
    // internal ones (`storage`, `_seedVersion`) are simply not settings.
    if (!Object.hasOwn(DEFINITIONS, row.key)) continue
    const def = DEFINITIONS[row.key]
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
    // Own keys only: "constructor" and friends exist on every object.
    if (!Object.hasOwn(DEFINITIONS, key)) throw badRequest('settings.unknown_key', { key: String(key).slice(0, 40) })
    parsed[key] = DEFINITIONS[key].parse(value, key)
  }
  for (const [key, value] of Object.entries(parsed)) {
    await Setting.updateOne({ key }, { $set: { value } }, { upsert: true })
    cache.set(key, value)
  }
  for (const fn of listeners) {
    try { fn(getAll()) } catch { /* listeners must not break saves */ }
  }
  return getAll()
}

/**
 * Give a setting its first value, from the environment. Only a setting that was
 * never saved takes it: once there is a row (from here or from the settings
 * page) the stored value stands. Resolves true when the value was written.
 */
async function seed(key, value) {
  const parsed = DEFINITIONS[key].parse(value, key)
  let written = false
  try {
    const r = await Setting.updateOne({ key }, { $setOnInsert: { value: parsed } }, { upsert: true })
    written = r.upsertedCount > 0
  } catch (err) {
    // Two processes starting together: the other one wrote the row.
    if (!err || err.code !== 11000) throw err
  }
  if (written) cache.set(key, parsed)
  else await load()
  return written
}

function onChange(fn) { listeners.add(fn) }

/** Runner timing derived from settings, in milliseconds. */
function runnerSettings() {
  const s = getAll()
  return {
    concurrency: s.concurrency,
    userConcurrency: s.userConcurrency,
    submitTimeoutMs: s.submitTimeoutSec * 1000,
    pollTimeoutMs: { image: s.imageTimeoutMinutes * 60000, video: s.videoTimeoutMinutes * 60000 },
    chatTimeoutMs: s.chatTimeoutSec * 1000,
    downloadTimeoutMs: s.downloadTimeoutSec * 1000,
    retries: s.maxRetries,
  }
}

module.exports = { DEFINITIONS, defaults, load, get, getAll, update, seed, onChange, runnerSettings }
