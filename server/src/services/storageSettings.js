'use strict'

/**
 * Which storage is in use, and where that was decided.
 *
 *   saved on the settings page   (a document in `settings`, key "storage")
 *   else the environment         (STORAGE_DRIVER, S3_*)
 *   else the local disk
 *
 * The saved document keeps the S3 configuration even while the driver is set
 * back to "local", and remembers the buckets used before the current one.
 * None of them receives new files, all of them stay readable - that is what
 * keeps existing canvases intact across a switch (see storage/index.js).
 *
 * The secret access key is encrypted with SECRET_KEY before it is stored and
 * never leaves the server again: the API reports that one is set and its last
 * four characters.
 */
const Setting = require('../models/Setting')
const { getConfig } = require('../config')
const { encrypt, decrypt, keyTail } = require('../utils/crypto')
const { badRequest } = require('../utils/http')
const { isPlainObject } = require('../utils/validate')
const storage = require('../storage')
const { parseS3Config, backendId, endpointHost } = require('../storage/schema')

const SETTING_KEY = 'storage'
const MAX_PREVIOUS = 5
const PUBLIC_FIELDS = ['preset', 'endpoint', 'region', 'bucket', 'accessKeyId', 'forcePathStyle', 'keyPrefix', 'publicBaseUrl', 'delivery', 'acl']

/** The saved document's value, or null when nothing was ever saved here. */
let saved = null
/** True when the saved S3 secret cannot be decrypted (SECRET_KEY changed). */
let unreadable = false

function seal(cfg) {
  const { secretAccessKey, ...rest } = cfg
  return { ...rest, secretEnc: encrypt(secretAccessKey, getConfig().secretKey), secretTail: keyTail(secretAccessKey) }
}

/** A stored configuration with its secret in the clear, or null when it cannot be decrypted. */
function unseal(stored) {
  if (!stored) return null
  const { secretEnc, secretTail: _tail, ...rest } = stored
  try {
    return { ...rest, secretAccessKey: decrypt(secretEnc, getConfig().secretKey) }
  } catch {
    return null
  }
}

/** Work out the backends from the saved document and the environment, and switch to them. */
function apply() {
  const env = getConfig().storage
  unreadable = false
  if (!saved) return storage.configure(storage.envPlan())

  const own = unseal(saved.s3)
  const earlier = (saved.previous || []).map(unseal).filter(Boolean)
  unreadable = !!saved.s3 && !own
  if (saved.driver === 's3' && !own) {
    // Never write somewhere the operator did not choose: fall back to what the
    // environment says and say so on the settings page.
    const plan = storage.envPlan()
    return storage.configure({ active: plan.active, readable: earlier })
  }
  return storage.configure({
    active: saved.driver === 's3' ? own : null,
    readable: [saved.driver === 's3' ? null : own, ...earlier, env.s3],
  })
}

async function load() {
  const row = await Setting.findOne({ key: SETTING_KEY }).lean()
  saved = row && isPlainObject(row.value) && ['local', 's3'].includes(row.value.driver) ? row.value : null
  apply()
  return status()
}

function describe(cfg, secretTail) {
  const out = {}
  for (const f of PUBLIC_FIELDS) out[f] = cfg[f]
  return { ...out, hasSecret: true, secretTail: secretTail || '', endpointHost: endpointHost(cfg) }
}

/**
 * What the settings page shows. `source` says where the active choice comes
 * from; `s3` is the configuration the form starts from (the saved one, or the
 * environment's), without its secret.
 */
function status() {
  const env = getConfig().storage
  const active = storage.getStorage().active
  let s3 = null
  if (saved && saved.s3) s3 = describe(saved.s3, saved.s3.secretTail)
  else if (env.s3) s3 = describe(env.s3, keyTail(env.s3.secretAccessKey))
  return {
    source: saved ? 'saved' : (env.driver === 's3' ? 'env' : 'default'),
    driver: active.driver,
    delivery: active.driver === 's3' ? active.delivery : '',
    envDriver: env.driver,
    secretUnreadable: unreadable,
    s3,
    // Buckets that are no longer written to but still read.
    previous: saved ? (saved.previous || []).map((p) => ({ endpointHost: endpointHost(p), bucket: p.bucket, keyPrefix: p.keyPrefix || '' })) : [],
  }
}

/** The secret a form that left the field empty means: the one already in use. */
function knownSecret() {
  const own = saved ? unseal(saved.s3) : null
  if (own) return own.secretAccessKey
  const env = getConfig().storage.s3
  return env ? env.secretAccessKey : ''
}

/** Validate a submitted S3 configuration and fill in the stored secret when none was typed. */
function resolveS3(input) {
  const cfg = parseS3Config(input)
  if (!cfg.secretAccessKey) cfg.secretAccessKey = knownSecret()
  if (!cfg.secretAccessKey) throw badRequest('validation.required', { field: 'secretAccessKey' })
  return cfg
}

/** Run the connection test against a submitted, not yet saved, configuration. */
async function test(input) {
  return require('../storage/probe').probe(resolveS3(input))
}

/**
 * Save and switch. `{ driver: 'local' }` goes back to the local disk and keeps
 * the S3 configuration for reading. `{ driver: 's3', s3 }` needs a passing
 * connection test unless `force` is set.
 * Resolves { saved: true, status } or { saved: false, test } when the test failed.
 */
async function save(body) {
  const b = isPlainObject(body) ? body : {}
  if (b.driver !== 'local' && b.driver !== 's3') throw badRequest('validation.one_of', { field: 'driver', values: 'local / s3' })
  const before = saved || { driver: 'local', s3: null, previous: [] }
  let next
  if (b.driver === 'local') {
    // Without a saved document the environment's bucket stays readable by itself.
    next = { driver: 'local', s3: before.s3 || null, previous: before.previous || [] }
  } else {
    const cfg = resolveS3(b.s3)
    if (b.force !== true) {
      const result = await require('../storage/probe').probe(cfg)
      if (!result.ok) return { saved: false, test: result }
    }
    const id = backendId(cfg)
    const earlier = [before.s3, ...(before.previous || [])].filter((p) => p && backendId(p) !== id)
    next = { driver: 's3', s3: seal(cfg), previous: earlier.slice(0, MAX_PREVIOUS) }
  }
  await Setting.updateOne({ key: SETTING_KEY }, { $set: { value: next } }, { upsert: true })
  saved = next
  apply()
  return { saved: true, status: status() }
}

/** Test helper: forget what was loaded. */
function reset() {
  saved = null
  unreadable = false
}

module.exports = { load, status, test, save, reset, SETTING_KEY }
