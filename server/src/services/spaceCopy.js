'use strict'

/**
 * Copying between spaces takes the files along.
 *
 * A canvas or an asset copied from a personal space into a team (or back)
 * must not keep pointing at files under the source space's key prefix: those
 * go away with the source account or team, and the copy would be left with
 * broken pictures. So every stored file the copied document refers to is
 * duplicated under the target space's prefix and the addresses are rewritten.
 *
 * Only our own files are copied (addresses that map to a storage key). A
 * link to somewhere else stays the link it was. A file that is already under
 * the target's prefix, or one that no longer exists, is left alone.
 */
const { getStorage, newKey, mimeForKey, thumbKeyFor, thumbSourceKey, isUnavailable } = require('../storage')
const { ApiError } = require('../utils/http')

const LIMITS = { files: 300, bytes: 2 * 1024 * 1024 * 1024 }
const PREFIXES = ['uploads', 'outputs', 'tools', 'thumbs']

/**
 * A copier for one operation. `copy(value)` returns a deep copy of `value`
 * (any JSON) in which every address of a stored file is the address of that
 * file's duplicate in the target space; the same file is duplicated once.
 */
function createCopier(targetSpaceId) {
  const storage = getStorage()
  const target = String(targetSpaceId)
  const done = new Map() // source key -> new key (or the same key when left alone)
  let files = 0
  let bytes = 0

  const mineAlready = (key) => key.split('/').includes(target)

  async function duplicate(key, toKey, { optional = false } = {}) {
    let size
    try {
      size = await storage.size(key)
    } catch (err) {
      // "Could not be looked up" is not "no longer exists": the copy would be left pointing at a file of
      // the source space. Said as it is (503) - except for a thumbnail, which is made again on request.
      if (isUnavailable(err) && !optional) throw err
      return null
    }
    files += 1
    bytes += size
    if (files > LIMITS.files || bytes > LIMITS.bytes) throw new ApiError(400, 'space.copy_too_large', { max: LIMITS.files })
    const saved = await storage.put(toKey, await storage.getStream(key), { contentType: mimeForKey(key) })
    return saved.key
  }

  async function keyFor(key) {
    if (done.has(key)) return done.get(key)
    let out = key
    const sourceOfThumb = thumbSourceKey(key)
    if (sourceOfThumb) {
      // A derived thumbnail follows its image: its new key is derived from the image's new key.
      const image = await keyFor(sourceOfThumb)
      const derived = image !== sourceOfThumb ? thumbKeyFor(image) : null
      if (derived) out = (await duplicate(key, derived, { optional: true })) || derived
    } else if (!mineAlready(key) && PREFIXES.includes(key.split('/')[0])) {
      out = (await duplicate(key, newKey(key.split('/')[0], mimeForKey(key), target))) || key
    }
    done.set(key, out)
    return out
  }

  async function copy(value) {
    if (typeof value === 'string') {
      if (value.length > 2048 || !(value.startsWith('/files/') || /^https?:\/\//i.test(value))) return value
      const key = storage.keyFromUrl(value)
      if (!key) return value
      const next = await keyFor(key)
      return next === key ? value : storage.urlFor(next)
    }
    if (Array.isArray(value)) {
      const out = []
      for (const item of value) out.push(await copy(item))
      return out
    }
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const out = {}
      for (const [k, v] of Object.entries(value)) out[k] = await copy(v)
      return out
    }
    return value
  }

  return { copy, stats: () => ({ files, bytes }) }
}

module.exports = { createCopier, LIMITS }
