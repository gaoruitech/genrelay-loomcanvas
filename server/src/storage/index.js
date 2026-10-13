'use strict'

/**
 * Storage layer. The rest of the server talks to one object, getStorage():
 *
 *   put(key, buffer|stream, { contentType, sameBackendAs? }) -> { key, size, url }
 *   getStream(key) / getBuffer(key) / exists(key) / size(key) / delete(key)
 *   deleteUserFiles(userId) -> what was removed of that account, and what is left where
 *   locate(key)      -> the backend that holds the key, or null
 *   urlFor(key)      -> '/files/<key>', the one address a stored file has
 *   keyFromUrl(url)  -> key when the URL points at a stored file, else null
 *   externalAccess(key) -> how a third party can load the file without going through this app
 *
 * Behind it sit backends: the local disk, always, and any number of S3
 * configurations. Exactly one is active and receives new files. The others
 * are only read, which is what keeps files loading after storage is switched:
 * nothing records where a key was written, it is looked up - the disk first
 * (a stat costs nothing), then the active bucket, then the earlier ones - and
 * the answer is remembered, since a key is written once and never moved.
 *
 * A bucket that is only read may be gone, or unreachable. That must never get
 * in the way of files that are somewhere else:
 *   - a file on the disk or in the active bucket is found before an earlier
 *     bucket is asked at all;
 *   - the earlier buckets are asked together, each with a short deadline, and
 *     one that does not answer is left alone for a while (health.js);
 *   - "could not ask" is never reported as "not there": a key that turns up
 *     nowhere is missing (null) when every backend answered, and unavailable
 *     (StorageUnavailable, HTTP 503) when one that might hold it did not.
 *
 * A configuration whose secret cannot be decrypted (SECRET_KEY changed) stays
 * in the set as a backend that refuses everything: what it holds is
 * unavailable, not missing, and nothing is written anywhere else in its place.
 *
 * configure() swaps the whole set at once. An upload that is under way keeps
 * the backend it started with.
 */
const crypto = require('crypto')
const { getConfig } = require('../config')
const { ApiError } = require('../utils/http')
const keys = require('./keys')
const { createLocalStorage } = require('./local')
const { backendId } = require('./schema')
const { createHealth } = require('./health')
const { statusOf } = require('./s3')

/** Remembered key -> backend id. Bounded; the oldest entries go first. */
const LOCATED_MAX = 20000
const located = new Map()

/** How long a bucket that is only read may take to say whether it has a key. */
const LOOKUP_MS = 3000
/** probe(): a bucket whose state was learned this recently is not asked again. */
const PROBE_FRESH_MS = 5000
/** probe(): how long the caller waits at most, however many buckets are asked and whatever they do. */
const PROBE_DEADLINE_MS = LOOKUP_MS + 1000
/** The key probe() asks for: well-formed, and never written. "No such object" is an answer, which is all that is wanted. */
const PROBE_KEY = 'uploads/2000/01/00000000000000000000000000000000.png'
/** backend id -> the probe that is under way (one at a time per bucket). */
const probing = new Map()

let state = null
let localBackend = null
const health = createHealth()
/**
 * Backend id -> a digest of the configuration it was last set up with. What is
 * known about a bucket's health is kept across configure() as long as nothing
 * about the bucket changed: saving an unrelated setting must not send every
 * request back to a bucket that is down.
 */
let fingerprints = new Map()
const fingerprint = (cfg) => crypto.createHash('sha256').update(JSON.stringify(Object.keys(cfg).sort().map((k) => [k, cfg[k]]))).digest('hex')

/**
 * Storage cannot do what was asked, for a reason that is not the request's
 * fault and may pass. HTTP 503; `code` is the catalog key:
 *   storage.unreachable        a file that may exist could not be looked up or read
 *   storage.write_failed       a file could not be stored
 *   storage.secret_unreadable  the active bucket's saved secret cannot be decrypted
 * The message names no host, bucket or key: file addresses are public. The
 * cause is in the server log.
 */
class StorageUnavailable extends ApiError {
  constructor(code, { cause, backends = [] } = {}) {
    super(503, code)
    this.name = 'StorageUnavailable'
    if (cause) this.cause = cause
    /** Labels of the backends this is about (for the log, never for the response). */
    this.backends = backends
  }
}

const isUnavailable = (err) => err instanceof StorageUnavailable

function local() {
  const cfg = getConfig()
  if (!localBackend) localBackend = createLocalStorage({ dir: cfg.storage.localDir, publicUrl: cfg.publicUrl })
  return localBackend
}

/** A storage error in a few words, for a log line: its name or code and the HTTP status, never a URL. */
function summary(err) {
  const cause = err && err.cause && !statusOf(err) ? err.cause : null
  const of = cause && (cause.code || cause.name) ? cause : err
  const name = String((of && (of.Code || of.code || of.name)) || 'error').slice(0, 60)
  const status = statusOf(err)
  return status ? `${name}, HTTP ${status}` : name
}

/** The first of `ms` and the promise; the promise's own outcome is ignored after that. */
function within(ms, promise) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error(`no answer within ${ms} ms`), { name: 'TimeoutError', code: 'ETIMEDOUT' })), ms)
    promise.then((v) => { clearTimeout(timer); resolve(v) }, (err) => { clearTimeout(timer); reject(err) })
  })
}

/**
 * A bucket as the facade uses it: every request goes past the health record.
 * While the bucket is down nothing is sent; a request that fails because the
 * bucket cannot be reached marks it down. Whatever goes wrong on the service's
 * side comes out as StorageUnavailable, so callers have one thing to check.
 */
function guard(raw, { lookupMs }) {
  const backend = { ...raw }
  const ask = async (fn, { force = false } = {}) => {
    if (!force && !health.mayAsk(backend)) throw new StorageUnavailable('storage.unreachable', { backends: [backend.label] })
    try {
      const out = await fn()
      health.ok(backend)
      return out
    } catch (err) {
      if (err && err.code === 'ENOENT') { health.ok(backend); throw err }
      if (isUnavailable(err)) throw err
      const unreachable = health.failed(backend, err)
      // Neither an answer from the service nor a failure to reach it: a bug of ours, passed on as it is.
      if (!unreachable && !statusOf(err)) throw err
      if (!unreachable) health.ok(backend)
      throw new StorageUnavailable('storage.unreachable', { cause: err, backends: [backend.label] })
    }
  }
  backend.head = (key, opts = {}) => {
    const ms = opts.timeoutMs || lookupMs
    // The backend ends the request itself at `ms`; the margin is for one that does not.
    return ask(() => (ms ? within(ms + 1000, raw.head(key, { ...opts, timeoutMs: ms })) : raw.head(key, opts)))
  }
  // Asked for on purpose (facade.probe): goes out even while the bucket is remembered as down - finding out
  // whether it is back is the point - with the short deadline, and its answer is recorded like any other.
  backend.probe = () => {
    const ms = lookupMs || LOOKUP_MS
    return ask(() => within(ms + 1000, raw.head(PROBE_KEY, { timeoutMs: ms })), { force: true })
  }
  backend.open = (key, opts) => ask(() => raw.open(key, opts))
  backend.getStream = (key) => ask(() => raw.getStream(key))
  backend.getBuffer = (key) => ask(() => raw.getBuffer(key))
  backend.delete = (key, opts) => ask(() => raw.delete(key, opts))
  // A bucket that is only read gets the short deadline per request here too: whether it is there at all is known quickly.
  backend.deletePrefix = (prefix, opts) => ask(() => raw.deletePrefix(prefix, lookupMs ? { timeoutMs: lookupMs, ...opts } : opts))
  // put is not gated: an upload is always tried, and one that works shows the bucket is back.
  return backend
}

/**
 * The backend of a configuration whose secret cannot be read. It maps
 * addresses like the real one, and refuses to store, read or sign anything.
 */
function sealed(cfg) {
  const refuse = async () => { throw new StorageUnavailable('storage.secret_unreadable', { backends: [backend.label] }) }
  const backend = {
    ...require('./s3').addressing(cfg),
    unusable: 'secret_unreadable',
    put: refuse,
    head: refuse,
    open: refuse,
    getStream: refuse,
    getBuffer: refuse,
    delete: refuse,
    deletePrefix: refuse,
    presignGet: refuse,
  }
  return backend
}

/**
 * Replace the set of backends.
 * @param {{ active: object|null, readable?: object[] }} plan  S3 configurations
 *   (schema.js) with their secrets, or with `secretUnreadable: true` instead of
 *   one; `active: null` means the local disk. A place named more than once
 *   (the same endpoint, bucket and prefix: saved on the settings page and
 *   present in the environment) is one backend, asked once.
 */
function configure(plan) {
  const s3 = []
  const used = new Map()
  const make = (cfg, lookupMs) => {
    used.set(backendId(cfg), fingerprint(cfg))
    if (cfg.secretUnreadable) return sealed(cfg)
    // Loaded here, not at the top: an install on the local disk never needs the SDK.
    return guard(require('./s3').createS3Backend(cfg), { lookupMs })
  }
  const add = (cfg, lookupMs) => {
    if (!cfg) return
    const at = s3.findIndex((b) => b.id === backendId(cfg))
    if (at < 0) return s3.push(make(cfg, lookupMs))
    // Named before with a secret that cannot be read, and now with one that can: this one is used.
    if (s3[at].unusable && !cfg.secretUnreadable) s3[at] = make(cfg, at === 0 && plan.active ? 0 : LOOKUP_MS)
  }
  // The active bucket keeps the backend's own, longer deadline: most files are there.
  add(plan.active, 0)
  for (const cfg of plan.readable || []) add(cfg, LOOKUP_MS)
  const active = plan.active ? s3[0] : local()
  // A bucket that is new, or whose configuration changed (the operator may just have fixed it), starts with a clean slate.
  for (const backend of s3) if (fingerprints.get(backend.id) !== used.get(backend.id)) health.forget(backend)
  for (const id of fingerprints.keys()) if (!used.has(id)) health.forget({ id })
  fingerprints = used
  state = { active, backends: [local(), ...s3], byId: new Map([local(), ...s3].map((b) => [b.id, b])) }
  return state
}

/**
 * What the environment alone asks for (before, or without, a saved
 * configuration). The bucket of the S3_* variables is written to with
 * STORAGE_DRIVER=s3 and still read with any other driver.
 */
function envPlan() {
  const { storage } = getConfig()
  return storage.driver === 's3' ? { active: storage.s3, readable: [] } : { active: null, readable: [storage.s3] }
}

function current() {
  return state || configure(envPlan())
}

function remember(key, backend) {
  located.delete(key)
  located.set(key, backend.id)
  if (located.size > LOCATED_MAX) located.delete(located.keys().next().value)
}

/**
 * The backend holding `key`, or null when no backend has it.
 *
 * The disk is asked first, then the active bucket: a file in either is found
 * without touching anything else. Only then the buckets that are just read
 * are asked, all at once. One that cannot be asked (down, credentials revoked,
 * secret unreadable) does not hide a file another one has. When the file
 * turns up nowhere and a backend could not be asked, that is not "no such
 * file": StorageUnavailable is thrown - unless `tolerant` is set, for callers
 * that only want to know what can be found right now.
 */
async function locate(key, { tolerant = false } = {}) {
  if (!keys.isValidKey(key)) return null
  const s = current()
  const known = s.byId.get(located.get(key))
  // What is remembered about the disk is checked again (a stat is free, and
  // files there can be removed by hand); a bucket is taken at its word.
  if (known && (known.driver !== 'local' || await known.head(key))) return known
  located.delete(key)
  const silent = []
  let failure = null
  const has = async (backend) => {
    try {
      return !!(await backend.head(key))
    } catch (err) {
      silent.push(backend.label || backend.id)
      failure = failure || err
      return false
    }
  }
  const first = s.active.driver === 'local' ? [s.active] : [s.backends[0], s.active]
  for (const backend of first) {
    if (await has(backend)) {
      remember(key, backend)
      return backend
    }
  }
  const rest = s.backends.filter((b) => !first.includes(b))
  const answers = await Promise.all(rest.map(has))
  const found = rest[answers.indexOf(true)]
  if (found) {
    remember(key, found)
    return found
  }
  if (silent.length && !tolerant) {
    // The reason given is the first one; a secret that cannot be read is said as "unreachable" too,
    // since for whoever asks for the file it is the same thing.
    throw new StorageUnavailable('storage.unreachable', { cause: failure, backends: silent })
  }
  return null
}

function notFound(key) {
  return Object.assign(new Error(`no such file: ${key}`), { code: 'ENOENT' })
}

async function holder(key) {
  const backend = await locate(key)
  if (!backend) throw notFound(key)
  return backend
}

/** One probe per bucket at a time; never rejects (the outcome is in the health record). */
function probeOne(backend) {
  let running = probing.get(backend.id)
  if (!running) {
    running = backend.probe().then(() => undefined, () => undefined).finally(() => {
      if (probing.get(backend.id) === running) probing.delete(backend.id)
    })
    probing.set(backend.id, running)
  }
  return running
}

/**
 * How a file in this backend can be loaded from outside, best first (see facade.externalAccess).
 * A bucket whose secret cannot be read hands out nothing - unless `asConfigured`, which asks what
 * its configuration provides for, not what can be done right now (nothing is ever signed for that).
 */
function accessOf(backend, key, expiresIn, { asConfigured = false } = {}) {
  if (!backend || backend.driver !== 's3' || (backend.unusable && !asConfigured)) return []
  const out = []
  if (backend.delivery === 'redirect') out.push({ via: 'public_base', url: backend.publicUrl(key) })
  out.push({ via: 'signed', endpoint: backend.signingEndpoint, sign: () => backend.presignGet(key, expiresIn) })
  return out
}

const facade = {
  /** Driver of the active backend: 'local' or 's3'. */
  get driver() { return current().active.driver },
  get active() { return current().active },

  /**
   * Refuse, before anything is spent on it, work whose result could not be
   * stored: the active bucket's secret cannot be read. Throws StorageUnavailable.
   */
  assertWritable() {
    const { active } = current()
    if (active.unusable) throw new StorageUnavailable('storage.secret_unreadable', { backends: [active.label] })
  },

  /** Can a new file be stored right now? False while assertWritable() would refuse. */
  get writable() { return !current().active.unusable },

  /**
   * Find out now which buckets can be reached, instead of waiting for a file
   * request to run into one. The settings page asks for this: its refresh
   * button, and its poll while a bucket is down.
   *
   * Every bucket whose state was not learned within the last `maxAgeMs` gets
   * one HEAD for a key that does not exist - all of them at once, each with
   * the short deadline of a lookup, and also a bucket that is remembered as
   * down (seeing it come back is the point). The answers go into the health
   * record like any other: a bucket that is back is marked so, one that
   * stopped answering is marked down.
   *
   * Resolves when every bucket has answered, and at `deadlineMs` at the
   * latest: a bucket that hangs never holds the caller longer than that, and
   * its probe finishes on its own.
   */
  async probe({ maxAgeMs = PROBE_FRESH_MS, deadlineMs = PROBE_DEADLINE_MS } = {}) {
    const due = current().backends.filter((b) => b.driver === 's3' && !b.unusable && health.age(b) >= maxAgeMs)
    if (!due.length) return
    let timer
    const deadline = new Promise((resolve) => { timer = setTimeout(resolve, deadlineMs) })
    await Promise.race([Promise.all(due.map(probeOne)), deadline])
    clearTimeout(timer)
  },

  /**
   * Store a file on the active backend, or with `sameBackendAs` on the backend
   * that holds that other key (a thumbnail stays next to its image). A failure
   * of the storage itself is StorageUnavailable (503); a source stream that
   * breaks off is thrown as it is.
   */
  async put(key, body, { contentType, sameBackendAs } = {}) {
    let backend = current().active
    if (sameBackendAs) backend = (await locate(sameBackendAs, { tolerant: true }).catch(() => null)) || backend
    let sourceFailed = false
    if (!Buffer.isBuffer(body) && body && typeof body.once === 'function') body.once('error', () => { sourceFailed = true })
    let saved
    try {
      saved = await backend.put(key, body, { contentType })
    } catch (err) {
      if (sourceFailed || isUnavailable(err)) throw err
      // A bucket that could not be reached is logged by the health record, once; anything else here.
      const unreachable = backend.driver === 's3' && health.failed(backend, err)
      if (!unreachable) console.error(`[storage] could not store a file on ${backend.label || 'the local disk'}: ${summary(err)}`)
      throw new StorageUnavailable('storage.write_failed', { cause: err, backends: [backend.label || backend.id] })
    }
    if (backend.driver === 's3') health.ok(backend)
    remember(key, backend)
    return { key, size: saved.size, url: facade.urlFor(key) }
  },

  locate,

  /** Drop what is remembered about a key, after finding out that it is no longer where it was. */
  forget(key) {
    located.delete(key)
  },

  async exists(key) {
    return !!(await locate(key))
  },

  /** Size in bytes, without reading the file. */
  async size(key) {
    const info = await (await holder(key)).head(key)
    if (!info) {
      located.delete(key)
      throw notFound(key)
    }
    return info.size
  },

  async getStream(key) {
    return (await holder(key)).getStream(key)
  },

  async getBuffer(key) {
    return (await holder(key)).getBuffer(key)
  },

  async delete(key) {
    const backend = await locate(key)
    located.delete(key)
    if (backend) await backend.delete(key)
  },

  /**
   * Remove the files of one account, on every backend: everything under its
   * key prefixes (keys.accountPrefixes). Files from before accounts carry no
   * account in their key and are never touched by this.
   *
   * The backends are worked on side by side, so one that is slow or down does
   * not hold up the others. The call itself returns after `waitMs` at the
   * latest; a backend that is still at it then goes on in the background.
   * Never throws for a backend's failure. Resolves
   *   removed   how many files went so far
   *   failed    [{ id, label, reason }] backends that could not be cleaned (unreachable, refused)
   *   pending   [{ id, label }] backends still being cleaned when the wait was over
   *   settled   a promise for the same { removed, failed } once every backend is done
   * `only` limits the work to the backends with these ids (a retry of what failed);
   * `timeoutMs` is how long a bucket gets to answer one request (its own default otherwise).
   */
  async deleteUserFiles(userId, { waitMs = 0, only = null, timeoutMs = 0 } = {}) {
    const prefixes = keys.accountPrefixes(userId)
    const jobs = current().backends.filter((b) => !only || only.includes(b.id)).map((backend) => {
      const job = { backend, removed: 0, error: null, done: false }
      job.work = (async () => {
        for (const prefix of prefixes) {
          try {
            job.removed += await backend.deletePrefix(prefix, timeoutMs ? { timeoutMs } : undefined)
          } catch (err) {
            const partial = (err && (err.removed || (err.cause && err.cause.removed))) || 0
            job.removed += partial
            job.error = job.error || err
            // A bucket that cannot be reached is not asked five more times.
            if (isUnavailable(err) && !statusOf(err.cause)) break
          }
        }
        job.done = true
      })()
      return job
    })
    for (const key of [...located.keys()]) if (prefixes.some((p) => key.startsWith(p))) located.delete(key)
    const outcome = () => ({
      removed: jobs.reduce((n, j) => n + j.removed, 0),
      failed: jobs.filter((j) => j.done && j.error).map((j) => ({ id: j.backend.id, label: j.backend.label || 'local disk', reason: isUnavailable(j.error) && j.error.cause ? summary(j.error.cause) : summary(j.error) })),
      pending: jobs.filter((j) => !j.done).map((j) => ({ id: j.backend.id, label: j.backend.label || 'local disk' })),
    })
    const all = Promise.all(jobs.map((j) => j.work))
    if (waitMs > 0) await Promise.race([all, new Promise((resolve) => { const t = setTimeout(resolve, waitMs); all.then(() => clearTimeout(t)) })])
    else await all
    return { ...outcome(), settled: all.then(outcome) }
  },

  /**
   * Always site-relative, for every backend. Canvases store this address, so
   * they survive a change of host, of PUBLIC_URL and of storage: /files/<key>
   * is answered by the app, which finds the file wherever it is.
   */
  urlFor(key) {
    return `/files/${key}`
  },

  /**
   * Map a URL back to a key: a /files/ address of this site, or an address on
   * the public domain of a bucket (what releases before 0.2 stored for S3).
   */
  keyFromUrl(url) {
    const s = current()
    const own = local().keyFromUrl(url)
    if (own) return own
    for (const backend of s.backends) {
      const key = backend.keyFromPublicUrl ? backend.keyFromPublicUrl(url) : null
      if (key) return key
    }
    return null
  },

  /**
   * Ways in which somebody else (an upstream model) can fetch the file
   * without going through this app, best first:
   *   { via: 'public_base', url }          the public domain, when files are delivered from it
   *   { via: 'signed', endpoint, sign() }  a signed address that expires. `endpoint` is the service
   *                                        address it is made for ('' = AWS's own); sign() makes it.
   * Whether an address is any use to the other side - whether it can be
   * reached from the internet - is for the caller to judge (services/media.js).
   * Empty for files on the local disk, and for a file no backend has. Throws
   * StorageUnavailable when the file may be in a backend that cannot be asked:
   * better to say so than to hand out an address that will not load.
   * Signed addresses are for handing to an upstream only - never store or log them.
   */
  async externalAccess(key, { expiresIn = 3600 } = {}) {
    return accessOf(await locate(key), key, expiresIn)
  },

  /**
   * The same for a file that would be stored now (the active backend). Nothing is looked up or signed.
   * It describes the configuration: a bucket whose secret cannot be read at the moment is described
   * as it is set up, so that "cannot be stored right now" (`writable`) is not mistaken for "this
   * instance has no address an upstream could open".
   */
  newFileAccess() {
    return accessOf(current().active, 'uploads/2000/01/00000000000000000000000000000000.png', 60, { asConfigured: true })
  },

  /** Origins browsers are sent to for files (the Content-Security-Policy lists them). */
  publicOrigins() {
    return [...new Set(current().backends.map((b) => b.publicOrigin).filter(Boolean))]
  },

  /**
   * The buckets in the set, in the order they are asked, for the settings page:
   * [{ id, active, state: 'ok' | 'unreachable' | 'secret_unreadable', since?, cause? }].
   * 'ok' means: not known to be down.
   */
  buckets() {
    const s = current()
    const down = health.snapshot()
    return s.backends.filter((b) => b.driver === 's3').map((b) => ({
      id: b.id,
      active: b === s.active,
      state: b.unusable || (down[b.id] ? 'unreachable' : 'ok'),
      ...(down[b.id] && !b.unusable ? { since: down[b.id].since, cause: down[b.id].cause } : {}),
    }))
  },
}

function getStorage() {
  return facade
}

/** Test helper: forget every backend and remembered location; the next use starts from the environment. */
function resetStorage() {
  state = null
  localBackend = null
  located.clear()
  health.reset()
  probing.clear()
  fingerprints = new Map()
}

module.exports = { getStorage, configure, envPlan, resetStorage, StorageUnavailable, isUnavailable, LOOKUP_MS, PROBE_FRESH_MS, PROBE_DEADLINE_MS, ...keys }
