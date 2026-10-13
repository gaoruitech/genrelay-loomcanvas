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
 * keeps existing canvases intact across a switch (see storage/index.js). The
 * bucket the S3_* variables describe is read as well, whatever the driver.
 *
 * The secret access key is encrypted with SECRET_KEY before it is stored and
 * never leaves the server again: the API reports that one is set and its last
 * four characters.
 *
 * When SECRET_KEY changed, the stored secret cannot be decrypted. The bucket
 * then stays configured and unusable: what is in it answers "unavailable", and
 * if it is the bucket in use, new files are refused until the secret is
 * entered again. They are not written somewhere else instead - a disk nobody
 * provisioned or backs up, which other instances of the app cannot see - and
 * with SECRET_KEY changed no provider key can be read either, so nothing can
 * be generated until an administrator has been there anyway.
 */
const Setting = require('../models/Setting')
const { getConfig } = require('../config')
const { encrypt, decrypt, keyTail } = require('../utils/crypto')
const { ApiError, badRequest } = require('../utils/http')
const { isPlainObject } = require('../utils/validate')
const storage = require('../storage')
const { parseS3Config, refuse, backendId, endpointHost } = require('../storage/schema')

const SETTING_KEY = 'storage'
const MAX_PREVIOUS = 5
const PUBLIC_FIELDS = ['preset', 'endpoint', 'region', 'bucket', 'accessKeyId', 'forcePathStyle', 'keyPrefix', 'publicBaseUrl', 'presignEndpoint', 'delivery', 'acl']

/** The saved document's value, or null when nothing was ever saved here. */
let saved = null
/** True when the saved S3 secret cannot be decrypted (SECRET_KEY changed). */
let unreadable = false

function seal(cfg) {
  const { secretAccessKey, ...rest } = cfg
  return { ...rest, secretEnc: encrypt(secretAccessKey, getConfig().secretKey), secretTail: keyTail(secretAccessKey) }
}

/**
 * A stored configuration with its secret in the clear. When the secret cannot
 * be decrypted the configuration comes back without one and marked
 * `secretUnreadable`: the place is still known, it just cannot be used.
 */
function unseal(stored) {
  if (!stored) return null
  const { secretEnc, secretTail: _tail, ...rest } = stored
  try {
    return { ...rest, secretAccessKey: decrypt(secretEnc, getConfig().secretKey) }
  } catch {
    return { ...rest, secretUnreadable: true }
  }
}

/** The same, or null when the secret cannot be read: for where only a usable secret will do. */
function readable(stored) {
  const cfg = unseal(stored)
  return cfg && !cfg.secretUnreadable ? cfg : null
}

/** Work out the backends from the saved document and the environment, and switch to them. */
function apply() {
  const env = getConfig().storage
  unreadable = false
  if (!saved) return storage.configure(storage.envPlan())

  const own = unseal(saved.s3)
  const earlier = (saved.previous || []).map(unseal)
  unreadable = !!own && own.secretUnreadable === true
  // What was chosen on the settings page stays the choice, readable secret or not. The bucket of the
  // environment comes last; when it is the same place as a saved one, it lends that one its secret.
  return storage.configure({
    active: saved.driver === 's3' ? own : null,
    readable: [saved.driver === 's3' ? null : own, ...earlier, env.s3],
  })
}

async function load() {
  const row = await Setting.findOne({ key: SETTING_KEY }).lean()
  saved = row && isPlainObject(row.value) && ['local', 's3'].includes(row.value.driver) ? row.value : null
  apply()
  const env = getConfig().storage
  if (env.s3Problem) {
    console.warn(`[storage] the S3_* variables are set but not used: ${env.s3Problem}. The bucket they describe is not read.`)
  }
  return status()
}

function describe(cfg, secretTail) {
  const out = {}
  for (const f of PUBLIC_FIELDS) out[f] = cfg[f] === undefined ? '' : cfg[f]
  return { ...out, forcePathStyle: !!cfg.forcePathStyle, hasSecret: true, secretTail: secretTail || '', endpointHost: endpointHost(cfg) }
}

/**
 * What the settings page shows. `source` says where the active choice comes
 * from; `s3` is the configuration the form starts from (the saved one, or the
 * environment's), without its secret.
 */
function status() {
  const env = getConfig().storage
  const facade = storage.getStorage()
  const active = facade.active
  let s3 = null
  if (saved && saved.s3) s3 = describe(saved.s3, saved.s3.secretTail)
  else if (env.s3) s3 = describe(env.s3, keyTail(env.s3.secretAccessKey))

  // Every bucket a file is looked for in, the one in use first. A place named both on the
  // settings page and in the environment is one bucket, listed under the settings page.
  const states = new Map(facade.buckets().map((b) => [b.id, b]))
  const buckets = []
  const list = (cfg, origin) => {
    if (!cfg) return
    const id = backendId(cfg)
    const known = states.get(id)
    if (!known || buckets.some((b) => b.id === id)) return
    buckets.push({
      id,
      endpointHost: endpointHost(cfg),
      bucket: cfg.bucket,
      keyPrefix: cfg.keyPrefix || '',
      // 'saved' on the settings page, or 'env' (the S3_* variables).
      origin,
      active: known.active,
      // 'ok' (not known to be down), 'unreachable' (did not answer; asked again shortly) or
      // 'secret_unreadable' (its saved secret cannot be decrypted).
      state: known.state,
      ...(known.since ? { downSince: known.since } : {}),
      // May it be dropped from the list (DELETE /api/admin/storage/buckets/:id)?
      removable: origin === 'saved' && !known.active,
    })
  }
  if (saved) for (const cfg of [saved.s3, ...(saved.previous || [])]) list(cfg, 'saved')
  list(env.s3, 'env')
  buckets.sort((a, b) => Number(b.active) - Number(a.active))

  return {
    source: saved ? 'saved' : (env.driver === 's3' ? 'env' : 'default'),
    driver: active.driver,
    delivery: active.driver === 's3' ? active.delivery : '',
    envDriver: env.driver,
    // The saved secret cannot be decrypted: it has to be entered again.
    secretUnreadable: unreadable,
    // False while new files are refused (the bucket in use is the one whose secret cannot be read).
    writable: !active.unusable,
    // How a file stored now is handed to an upstream model: 'public_base' (the bucket's public
    // domain), 'signed' (a signed address), 'app' (PUBLIC_URL + /files/...) or 'inline' (no
    // address an upstream could open: images go inline, inputs that must be a URL are refused).
    // 'unavailable' while nothing can be stored at all: that is not a way of handing files over,
    // and not a configuration to change - `upstreamReason` says what has to be put right.
    upstream: active.unusable ? 'unavailable' : require('./media').newFilesHandover(),
    upstreamReason: active.unusable || '',
    s3,
    // Buckets that are no longer written to but still read.
    previous: saved ? (saved.previous || []).map((p) => ({ endpointHost: endpointHost(p), bucket: p.bucket, keyPrefix: p.keyPrefix || '' })) : [],
    buckets,
  }
}

/** Where a secret access key is used: the service it signs for, and the key id it belongs to. */
const credentialHome = (cfg) => `${String(cfg.endpoint || '').toLowerCase()}|${cfg.accessKeyId || ''}`

/**
 * The secret a form that left the field empty means: the one already in use -
 * but only for the service and access key it was entered for. A stored secret
 * is never put to work against an endpoint, or under an access key id, that
 * the request names itself; such a request has to bring the secret along.
 */
function knownSecret(cfg) {
  const own = saved ? readable(saved.s3) : null
  const env = getConfig().storage.s3
  const candidates = [own, env].filter(Boolean)
  const match = candidates.find((c) => credentialHome(c) === credentialHome(cfg))
  if (match) return match.secretAccessKey
  // There is a stored secret, and it belongs somewhere else.
  if (candidates.length) throw refuse('storage.secret_required', 'secretAccessKey')
  return ''
}

/** Validate a submitted S3 configuration and fill in the stored secret when none was typed. */
function resolveS3(input) {
  const cfg = parseS3Config(input)
  if (!cfg.secretAccessKey) cfg.secretAccessKey = knownSecret(cfg)
  if (!cfg.secretAccessKey) throw refuse('validation.required', 'secretAccessKey')
  return cfg
}

/** Run the connection test against a submitted, not yet saved, configuration. */
async function test(input) {
  return require('../storage/probe').probe(resolveS3(input))
}

async function store(next) {
  await Setting.updateOne({ key: SETTING_KEY }, { $set: { value: next } }, { upsert: true })
  saved = next
  apply()
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
  await store(next)
  return { saved: true, status: status() }
}

/**
 * Stop reading a bucket that is no longer written to: one of the earlier
 * buckets, or the saved configuration while the local disk is in use. For a
 * bucket that is gone for good - as long as it is listed, a file that is found
 * nowhere is reported as "unavailable" rather than "missing", because it might
 * be there. Its files stop loading; nothing is deleted from the bucket.
 * The bucket in use cannot be dropped, and neither can the environment's
 * (remove the S3_* variables instead). `id` is the one in status().buckets.
 */
async function forget(id) {
  const listed = status().buckets.find((b) => b.id === id)
  if (!listed) throw new ApiError(404, 'storage.bucket_not_found')
  if (listed.active) throw badRequest('storage.bucket_in_use')
  if (!listed.removable) throw badRequest('storage.bucket_from_env')
  const own = saved.s3 && backendId(saved.s3) === id
  await store({
    driver: saved.driver,
    s3: own ? null : saved.s3,
    previous: (saved.previous || []).filter((p) => backendId(p) !== id),
  })
  return status()
}

/**
 * The status after asking every bucket whether it can be reached right now
 * (storage.probe: bounded, and a bucket heard of a moment ago is not asked
 * again). Without this a bucket's state only changes when a file request
 * happens to need it.
 */
async function probe() {
  await storage.getStorage().probe()
  return status()
}

/** Test helper: forget what was loaded. */
function reset() {
  saved = null
  unreadable = false
}

module.exports = { load, status, probe, test, save, forget, reset, SETTING_KEY }
