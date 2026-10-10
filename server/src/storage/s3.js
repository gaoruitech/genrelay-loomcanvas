'use strict'

/**
 * S3 backend: AWS S3 and everything that speaks its API (Cloudflare R2,
 * Aliyun OSS, MinIO, Backblaze B2, Tencent COS ...).
 *
 * The SDK is loaded the first time an S3 backend is created, so an install
 * that only ever uses the local disk never pays for it.
 *
 * Vendor differences are options of the configuration, set once by the
 * operator (see schema.js): addressing style, region, ACL. Two things are
 * fixed here because they are right for every vendor:
 *   - checksums only when the API requires them. Recent SDK versions add a
 *     CRC32 `x-amz-checksum-*` to every upload by default, which several
 *     compatible services reject;
 *   - no ACL header unless one is configured (R2 has no object ACLs).
 */
const { Transform, pipeline } = require('stream')
const { isValidKey } = require('./keys')
const { backendId } = require('./schema')

const OBJECT_CACHE_CONTROL = 'public, max-age=31536000, immutable'

let sdk = null
function loadSdk() {
  if (!sdk) {
    sdk = {
      ...require('@aws-sdk/client-s3'),
      Upload: require('@aws-sdk/lib-storage').Upload,
      getSignedUrl: require('@aws-sdk/s3-request-presigner').getSignedUrl,
    }
  }
  return sdk
}

function statusOf(err) {
  return (err && err.$metadata && err.$metadata.httpStatusCode) || 0
}

function isNotFound(err) {
  return !!err && (statusOf(err) === 404 || err.name === 'NoSuchKey' || err.name === 'NotFound')
}

function missing(key) {
  return Object.assign(new Error(`no such object: ${key}`), { code: 'ENOENT' })
}

/**
 * @param {object} cfg       a parsed configuration (schema.js) with its secret
 * @param {object} [opts]    { maxAttempts, connectionTimeout, requestTimeout } - the
 *                           connection test wants to fail fast, normal use keeps the SDK defaults
 */
function createS3Backend(cfg, opts = {}) {
  const { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, ListObjectsV2Command, Upload, getSignedUrl } = loadSdk()
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: !!cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // Understood by SDK 3.729 and later; earlier versions never add the checksum.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(opts.maxAttempts ? { maxAttempts: opts.maxAttempts } : {}),
    requestHandler: {
      connectionTimeout: opts.connectionTimeout || 10000,
      ...(opts.requestTimeout ? { requestTimeout: opts.requestTimeout } : {}),
    },
  })
  const Bucket = cfg.bucket
  const prefix = cfg.keyPrefix || ''
  const publicBase = cfg.publicBaseUrl ? `${cfg.publicBaseUrl}/${prefix}` : ''

  /** Key inside the bucket. Only keys of our own shape ever reach the API. */
  function objectKey(key) {
    if (!isValidKey(key)) throw new Error('invalid storage key')
    return prefix + key
  }

  function writeParams(key, contentType) {
    return {
      Bucket,
      Key: objectKey(key),
      ContentType: contentType || 'application/octet-stream',
      // Keys are never reused, so whatever serves the object may cache it for good.
      CacheControl: OBJECT_CACHE_CONTROL,
      ...(cfg.acl ? { ACL: cfg.acl } : {}),
    }
  }

  async function put(key, body, { contentType } = {}) {
    const params = writeParams(key, contentType)
    if (Buffer.isBuffer(body)) {
      await client.send(new PutObjectCommand({ ...params, Body: body, ContentLength: body.length }))
      return { key, size: body.length }
    }
    // A stream of unknown length goes up as a multipart upload. The counter
    // sits in the pipe, so a source that fails (download cut, size cap) fails
    // the upload, and the SDK then aborts it instead of leaving parts behind.
    let size = 0
    const counted = new Transform({
      transform(chunk, _enc, done) { size += chunk.length; done(null, chunk) },
    })
    pipeline(body, counted, () => {})
    await new Upload({ client, params: { ...params, Body: counted } }).done()
    return { key, size }
  }

  /** { size, etag, lastModified } or null when the object does not exist. */
  async function head(key) {
    try {
      const out = await client.send(new HeadObjectCommand({ Bucket, Key: objectKey(key) }))
      return { size: Number(out.ContentLength) || 0, etag: out.ETag || '', lastModified: out.LastModified || null }
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  /**
   * Open an object for serving. `range` and `ifNoneMatch` are passed to the
   * service, which answers them itself. Resolves null when there is no such
   * object, otherwise { status: 200|206|304|416, stream?, size, contentRange, etag, lastModified }.
   */
  async function open(key, { range, ifNoneMatch } = {}) {
    try {
      const out = await client.send(new GetObjectCommand({
        Bucket,
        Key: objectKey(key),
        ...(range ? { Range: range } : {}),
        ...(ifNoneMatch ? { IfNoneMatch: ifNoneMatch } : {}),
      }))
      return {
        status: out.ContentRange ? 206 : 200,
        stream: out.Body,
        size: Number(out.ContentLength) || 0,
        contentRange: out.ContentRange || '',
        etag: out.ETag || '',
        lastModified: out.LastModified || null,
      }
    } catch (err) {
      if (statusOf(err) === 304) return { status: 304, etag: ifNoneMatch || '' }
      if (statusOf(err) === 416) return { status: 416 }
      if (isNotFound(err)) return null
      throw err
    }
  }

  async function getStream(key) {
    const out = await open(key)
    if (!out) throw missing(key)
    return out.stream
  }

  async function getBuffer(key) {
    const chunks = []
    for await (const c of await getStream(key)) chunks.push(c)
    return Buffer.concat(chunks)
  }

  async function remove(key) {
    await client.send(new DeleteObjectCommand({ Bucket, Key: objectKey(key) }))
  }

  /**
   * Remove every object under a key prefix ("uploads/<account id>/"). One
   * request per object: the batch delete is not implemented alike everywhere.
   * Resolves how many objects went.
   */
  async function removePrefix(keyPrefix) {
    if (!/^[a-z0-9]+(\/[a-z0-9]+)+\/$/.test(keyPrefix)) throw new Error('invalid storage prefix')
    let count = 0
    let token
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix + keyPrefix, ContinuationToken: token }))
      for (const object of page.Contents || []) {
        await client.send(new DeleteObjectCommand({ Bucket, Key: object.Key }))
        count++
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    return count
  }

  /** Address of the object on the public domain (custom domain, CDN, r2.dev), or ''. */
  function publicUrl(key) {
    return publicBase && isValidKey(key) ? publicBase + key : ''
  }

  /** Inverse of publicUrl: the key a public address points at, or null. */
  function keyFromPublicUrl(url) {
    if (!publicBase || typeof url !== 'string' || !url.startsWith(publicBase)) return null
    const key = url.slice(publicBase.length).split(/[?#]/)[0]
    return isValidKey(key) ? key : null
  }

  /** A signed GET address that works without credentials for `expiresIn` seconds. */
  function presignGet(key, expiresIn) {
    return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: objectKey(key) }), { expiresIn })
  }

  return {
    id: backendId(cfg),
    driver: 's3',
    delivery: cfg.delivery === 'redirect' && publicBase ? 'redirect' : 'proxy',
    publicOrigin: cfg.publicBaseUrl ? new URL(cfg.publicBaseUrl).origin : '',
    put,
    head,
    open,
    getStream,
    getBuffer,
    delete: remove,
    deletePrefix: removePrefix,
    publicUrl,
    keyFromPublicUrl,
    presignGet,
  }
}

module.exports = { createS3Backend, statusOf }
