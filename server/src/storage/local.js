'use strict'

/** Local filesystem driver. Files are served by the app under /files/<key>. */
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
    return { key, size, url: urlFor(key) }
  }

  async function getStream(key) {
    const full = pathFor(key)
    await fs.promises.access(full, fs.constants.R_OK)
    return fs.createReadStream(full)
  }

  async function getBuffer(key) {
    return fs.promises.readFile(pathFor(key))
  }

  async function exists(key) {
    try { await fs.promises.access(pathFor(key)); return true } catch { return false }
  }

  async function remove(key) {
    await fs.promises.rm(pathFor(key), { force: true })
  }

  function urlFor(key) {
    return `${publicUrl}/files/${key}`
  }

  /**
   * Map a URL back to a key when it points at this storage:
   * a site-relative /files/<key>, or an absolute URL on PUBLIC_URL / loopback.
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

  return { driver: 'local', root, put, getStream, getBuffer, exists, delete: remove, urlFor, keyFromUrl, pathFor }
}

module.exports = { createLocalStorage }
