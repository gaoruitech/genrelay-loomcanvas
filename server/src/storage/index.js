'use strict'

/**
 * Storage layer. The rest of the server talks to one object, getStorage():
 *
 *   put(key, buffer|stream, { contentType, sameBackendAs? }) -> { key, size, url }
 *   getStream(key) / getBuffer(key) / exists(key) / size(key) / delete(key)
 *   deleteUserFiles(userId) -> how many files of that account were removed
 *   locate(key)      -> the backend that holds the key, or null
 *   urlFor(key)      -> '/files/<key>', the one address a stored file has
 *   keyFromUrl(url)  -> key when the URL points at a stored file, else null
 *   externalUrls(key)-> addresses a third party can load without going through this app
 *
 * Behind it sit backends: the local disk, always, and any number of S3
 * configurations. Exactly one is active and receives new files. The others
 * are only read, which is what keeps files loading after storage is switched:
 * nothing records where a key was written, it is looked up - the disk first
 * (a stat costs nothing), then the active bucket, then the earlier ones - and
 * the answer is remembered, since a key is written once and never moved.
 *
 * configure() swaps the whole set at once. An upload that is under way keeps
 * the backend it started with.
 */
const { getConfig } = require('../config')
const keys = require('./keys')
const { createLocalStorage } = require('./local')

/** Remembered key -> backend id. Bounded; the oldest entries go first. */
const LOCATED_MAX = 20000
const located = new Map()

let state = null
let localBackend = null

function local() {
  const cfg = getConfig()
  if (!localBackend) localBackend = createLocalStorage({ dir: cfg.storage.localDir, publicUrl: cfg.publicUrl })
  return localBackend
}

/**
 * Replace the set of backends.
 * @param {{ active: object|null, readable?: object[] }} plan  S3 configurations
 *   (schema.js, with their secrets); `active: null` means the local disk.
 */
function configure(plan) {
  const s3 = []
  for (const cfg of [plan.active, ...(plan.readable || [])]) {
    if (!cfg) continue
    // Loaded here, not at the top: an install on the local disk never needs the SDK.
    const backend = require('./s3').createS3Backend(cfg)
    if (!s3.some((b) => b.id === backend.id)) s3.push(backend)
  }
  const active = plan.active ? s3[0] : local()
  state = { active, backends: [local(), ...s3], byId: new Map([local(), ...s3].map((b) => [b.id, b])) }
  return state
}

/** What the environment alone asks for (before, or without, a saved configuration). */
function envPlan() {
  const { storage } = getConfig()
  return { active: storage.driver === 's3' ? storage.s3 : null, readable: [] }
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
 * The backend holding `key`, or null. A backend that cannot be asked (bucket
 * unreachable, credentials revoked) does not hide a file another one has; when
 * the file turns up nowhere, its error is thrown so that "could not check" is
 * not mistaken for "does not exist".
 */
async function locate(key) {
  if (!keys.isValidKey(key)) return null
  const s = current()
  const known = s.byId.get(located.get(key))
  // What is remembered about the disk is checked again (a stat is free, and
  // files there can be removed by hand); a bucket is taken at its word.
  if (known && (known.driver !== 'local' || await known.head(key))) return known
  located.delete(key)
  let failure = null
  for (const backend of s.backends) {
    try {
      if (await backend.head(key)) {
        remember(key, backend)
        return backend
      }
    } catch (err) {
      failure = failure || err
    }
  }
  if (failure) throw failure
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

const facade = {
  /** Driver of the active backend: 'local' or 's3'. */
  get driver() { return current().active.driver },
  get active() { return current().active },

  /**
   * Store a file on the active backend, or with `sameBackendAs` on the backend
   * that holds that other key (a thumbnail stays next to its image).
   */
  async put(key, body, { contentType, sameBackendAs } = {}) {
    let backend = current().active
    if (sameBackendAs) backend = (await locate(sameBackendAs).catch(() => null)) || backend
    const saved = await backend.put(key, body, { contentType })
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
   * Remove the files of one account, on every backend that can be reached:
   * everything under its key prefixes (keys.accountPrefixes). Files from before
   * accounts carry no account in their key and are never touched by this.
   * Resolves the number of files removed; throws the first backend error after
   * trying them all.
   */
  async deleteUserFiles(userId) {
    const prefixes = keys.accountPrefixes(userId)
    let count = 0
    let failure = null
    for (const backend of current().backends) {
      for (const prefix of prefixes) {
        try { count += await backend.deletePrefix(prefix) } catch (err) { failure = failure || err }
      }
    }
    for (const key of [...located.keys()]) if (prefixes.some((p) => key.startsWith(p))) located.delete(key)
    if (failure) throw failure
    return count
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
   * Addresses under which somebody else (an upstream model) can fetch the file
   * directly, best first: the public domain when files are delivered from it,
   * then a signed address that expires. Empty for files on the local disk.
   * Signed addresses are for handing to an upstream only - never store or log them.
   */
  async externalUrls(key, { expiresIn = 3600 } = {}) {
    const backend = await locate(key).catch(() => null)
    if (!backend || backend.driver !== 's3') return []
    const out = []
    if (backend.delivery === 'redirect') out.push(backend.publicUrl(key))
    out.push(await backend.presignGet(key, expiresIn))
    return out
  },

  /** Origins browsers are sent to for files (the Content-Security-Policy lists them). */
  publicOrigins() {
    return [...new Set(current().backends.map((b) => b.publicOrigin).filter(Boolean))]
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
}

module.exports = { getStorage, configure, envPlan, resetStorage, ...keys }
