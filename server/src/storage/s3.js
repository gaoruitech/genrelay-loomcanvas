'use strict'

/**
 * S3-compatible driver (AWS S3, Cloudflare R2, MinIO, ...).
 * The SDK is an optional dependency, loaded only when this driver is selected:
 *   npm install @aws-sdk/client-s3 @aws-sdk/lib-storage
 * Objects must be publicly readable through S3_PUBLIC_BASE_URL (a CDN or the
 * public bucket URL); this driver does not sign URLs.
 */
const { isValidKey } = require('./keys')

const INSTALL_HINT = 'npm install @aws-sdk/client-s3 @aws-sdk/lib-storage'

function load(name) {
  try { return require(name) } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      throw new Error(`STORAGE_DRIVER=s3 needs the "${name}" package. Run: ${INSTALL_HINT}`)
    }
    throw err
  }
}

function createS3Storage(cfg) {
  for (const [k, env] of [
    ['bucket', 'S3_BUCKET'],
    ['accessKeyId', 'S3_ACCESS_KEY_ID'],
    ['secretAccessKey', 'S3_SECRET_ACCESS_KEY'],
    ['publicBaseUrl', 'S3_PUBLIC_BASE_URL'],
  ]) {
    if (!cfg[k]) throw new Error(`STORAGE_DRIVER=s3 requires ${env}`)
  }
  const { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand } = load('@aws-sdk/client-s3')
  const client = new S3Client({
    region: cfg.region || 'auto',
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: !!cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
  const Bucket = cfg.bucket
  const check = (key) => { if (!isValidKey(key)) throw new Error('invalid storage key'); return key }

  async function put(key, body, { contentType } = {}) {
    check(key)
    if (Buffer.isBuffer(body)) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }))
      return { key, size: body.length, url: urlFor(key) }
    }
    // A stream of unknown length needs a multipart upload.
    const { Upload } = load('@aws-sdk/lib-storage')
    let size = 0
    body.on('data', (c) => { size += c.length })
    await new Upload({ client, params: { Bucket, Key: key, Body: body, ContentType: contentType } }).done()
    return { key, size, url: urlFor(key) }
  }

  async function getStream(key) {
    const out = await client.send(new GetObjectCommand({ Bucket, Key: check(key) }))
    return out.Body
  }

  async function getBuffer(key) {
    const stream = await getStream(key)
    const chunks = []
    for await (const c of stream) chunks.push(c)
    return Buffer.concat(chunks)
  }

  async function exists(key) {
    try { await client.send(new HeadObjectCommand({ Bucket, Key: check(key) })); return true } catch { return false }
  }

  async function remove(key) {
    await client.send(new DeleteObjectCommand({ Bucket, Key: check(key) }))
  }

  function urlFor(key) { return `${cfg.publicBaseUrl}/${key}` }

  function keyFromUrl(url) {
    if (typeof url !== 'string' || !url.startsWith(cfg.publicBaseUrl + '/')) return null
    const key = url.slice(cfg.publicBaseUrl.length + 1).split(/[?#]/)[0]
    return isValidKey(key) ? key : null
  }

  return { driver: 's3', put, getStream, getBuffer, exists, delete: remove, urlFor, keyFromUrl }
}

module.exports = { createS3Storage }
