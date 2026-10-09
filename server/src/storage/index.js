'use strict'

/**
 * Storage facade. Every driver implements:
 *   put(key, buffer|stream, { contentType }) -> { key, size, url }
 *   getStream(key) / getBuffer(key) / exists(key) / delete(key)
 *   size(key)        -> bytes, without reading the file (optional: local only)
 *   urlFor(key)      -> URL a browser can load
 *   keyFromUrl(url)  -> key when the URL points at this storage, else null
 */
const { getConfig } = require('../config')
const keys = require('./keys')

let instance = null

function createStorage(cfg) {
  switch (cfg.storage.driver) {
    case 's3': return require('./s3').createS3Storage(cfg.storage.s3)
    case 'oss': return require('./oss').createOssStorage(cfg.storage.oss)
    default: return require('./local').createLocalStorage({ dir: cfg.storage.localDir, publicUrl: cfg.publicUrl })
  }
}

function getStorage() {
  if (!instance) instance = createStorage(getConfig())
  return instance
}

/** Test helper. */
function setStorage(s) { instance = s }

module.exports = { getStorage, setStorage, createStorage, ...keys }
