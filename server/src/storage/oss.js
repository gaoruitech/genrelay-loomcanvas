'use strict'

/**
 * Alibaba Cloud OSS driver. The SDK is not installed by default; it is loaded
 * only when this driver is selected:
 *   npm install ali-oss        (Docker: --build-arg EXTRA_NPM_PACKAGES=ali-oss)
 * Objects must be publicly readable through OSS_PUBLIC_BASE_URL (bucket domain
 * or CDN); this driver does not sign URLs.
 */
const { isValidKey } = require('./keys')

function createOssStorage(cfg) {
  for (const [k, env] of [
    ['bucket', 'OSS_BUCKET'],
    ['accessKeyId', 'OSS_ACCESS_KEY_ID'],
    ['accessKeySecret', 'OSS_ACCESS_KEY_SECRET'],
    ['publicBaseUrl', 'OSS_PUBLIC_BASE_URL'],
  ]) {
    if (!cfg[k]) throw new Error(`STORAGE_DRIVER=oss requires ${env}`)
  }
  if (!cfg.region && !cfg.endpoint) throw new Error('STORAGE_DRIVER=oss requires OSS_REGION or OSS_ENDPOINT')
  let OSS
  try { OSS = require('ali-oss') } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error(
        'STORAGE_DRIVER=oss needs the "ali-oss" package. Run: npm install ali-oss (in server/). ' +
        'With Docker: set EXTRA_NPM_PACKAGES=ali-oss in .env and rebuild the image (docker compose build)'
      )
    }
    throw err
  }
  const client = new OSS({
    region: cfg.region || undefined,
    endpoint: cfg.endpoint || undefined,
    bucket: cfg.bucket,
    accessKeyId: cfg.accessKeyId,
    accessKeySecret: cfg.accessKeySecret,
    secure: true,
  })
  const check = (key) => { if (!isValidKey(key)) throw new Error('invalid storage key'); return key }

  async function put(key, body, { contentType } = {}) {
    check(key)
    const options = contentType ? { headers: { 'Content-Type': contentType } } : {}
    if (Buffer.isBuffer(body)) {
      await client.put(key, body, options)
      return { key, size: body.length, url: urlFor(key) }
    }
    let size = 0
    body.on('data', (c) => { size += c.length })
    await client.putStream(key, body, options)
    return { key, size, url: urlFor(key) }
  }

  async function getStream(key) {
    const out = await client.getStream(check(key))
    return out.stream
  }

  async function getBuffer(key) {
    const out = await client.get(check(key))
    return out.content
  }

  async function exists(key) {
    try { await client.head(check(key)); return true } catch { return false }
  }

  async function remove(key) { await client.delete(check(key)) }

  function urlFor(key) { return `${cfg.publicBaseUrl}/${key}` }

  function keyFromUrl(url) {
    if (typeof url !== 'string' || !url.startsWith(cfg.publicBaseUrl + '/')) return null
    const key = url.slice(cfg.publicBaseUrl.length + 1).split(/[?#]/)[0]
    return isValidKey(key) ? key : null
  }

  return { driver: 'oss', put, getStream, getBuffer, exists, delete: remove, urlFor, keyFromUrl }
}

module.exports = { createOssStorage }
