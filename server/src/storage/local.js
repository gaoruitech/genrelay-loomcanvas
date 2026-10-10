'use strict'

/**
 * Local filesystem backend. Also owns the address scheme every backend shares:
 * a stored file is /files/<key> on this site, whichever backend holds it.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { pipeline } = require('stream/promises')
const { isValidKey } = require('./keys')

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function createLocalStorage({ dir, publicUrl = '' }) {
  const root = path.resolve(dir)
  fs.mkdirSync(root, { recursive: true })
  const publicOrigin = publicUrl ? new URL(publicUrl).origin : ''

  /** Absolute path for a key, guaranteed to stay inside the storage root. */
  function pathFor(key) {
    if (!isValidKey(key)) throw new Error('invalid storage key')
    const full = path.resolve(root, key)
    if (!full.startsWith(root + path.sep)) throw new Error('invalid storage key')
    return full
  }

  async function put(key, body, _opts = {}) {
    const full = pathFor(key)
    await fs.promises.mkdir(path.dirname(full), { recursive: true })
    // Write to a temp name then rename, so a reader never sees a partial file.
    const tmp = `${full}.${crypto.randomBytes(6).toString('hex')}.tmp`
    try {
      if (Buffer.isBuffer(body)) await fs.promises.writeFile(tmp, body)
      else await pipeline(body, fs.createWriteStream(tmp))
      await fs.promises.rename(tmp, full)
    } catch (err) {
      await fs.promises.rm(tmp, { force: true }).catch(() => {})
      throw err
    }
    const { size } = await fs.promises.stat(full)
    return { key, size }
  }

  async function getStream(key) {
    const full = pathFor(key)
    await fs.promises.access(full, fs.constants.R_OK)
    return fs.createReadStream(full)
  }

  async function getBuffer(key) {
    return fs.promises.readFile(pathFor(key))
  }

  /** { size, lastModified } of a stored file, or null when there is none. */
  async function head(key) {
    try {
      const st = await fs.promises.stat(pathFor(key))
      return st.isFile() ? { size: st.size, lastModified: st.mtime } : null
    } catch {
      return null
    }
  }

  async function remove(key) {
    await fs.promises.rm(pathFor(key), { force: true })
  }

  /** Remove every file under a key prefix ("uploads/<account id>/"). Resolves how many files went. */
  async function removePrefix(prefix) {
    if (!/^[a-z0-9]+(\/[a-z0-9]+)+\/$/.test(prefix)) throw new Error('invalid storage prefix')
    const dir = path.resolve(root, prefix)
    if (!dir.startsWith(root + path.sep)) throw new Error('invalid storage prefix')
    let count = 0
    const walk = async (d) => {
      for (const entry of await fs.promises.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory()) await walk(path.join(d, entry.name))
        else count++
      }
    }
    await walk(dir)
    await fs.promises.rm(dir, { recursive: true, force: true })
    return count
  }

  /**
   * Always site-relative. The address people open the app at is not baked
   * into what canvases store, so they keep working when the host, the port or
   * PUBLIC_URL changes. Where an absolute address is needed (handing a file to
   * an upstream), services/media.js adds PUBLIC_URL at that moment.
   */
  function urlFor(key) {
    return `/files/${key}`
  }

  /**
   * Map a URL back to a key when it is one of this site's file addresses:
   * a site-relative /files/<key>, or an absolute URL on PUBLIC_URL / loopback
   * (what earlier versions stored when PUBLIC_URL was set).
   */
  function keyFromUrl(url) {
    if (typeof url !== 'string' || !url) return null
    let pathname
    if (url.startsWith('/') && !url.startsWith('//')) {
      pathname = url.split(/[?#]/)[0]
    } else {
      let u
      try { u = new URL(url) } catch { return null }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      const own = (publicOrigin && u.origin === publicOrigin) || LOOPBACK_HOSTS.has(u.hostname)
      if (!own) return null
      pathname = u.pathname
    }
    if (!pathname.startsWith('/files/')) return null
    let key
    try { key = decodeURIComponent(pathname.slice('/files/'.length)) } catch { return null }
    return isValidKey(key) ? key : null
  }

  return { id: 'local', driver: 'local', root, put, getStream, getBuffer, head, delete: remove, deletePrefix: removePrefix, urlFor, keyFromUrl, pathFor }
}

module.exports = { createLocalStorage }
