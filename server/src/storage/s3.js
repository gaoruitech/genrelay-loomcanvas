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
 *
 * Every request has a deadline for the service's answer (its headers, not the
 * body that may follow): a service that accepts the connection and then says
 * nothing would otherwise hold the caller for good. The SDK's own request
 * timeout only logs a warning.
 */
const { Transform, pipeline } = require('stream')
const { isValidKey } = require('./keys')
const { backendId, describePlace } = require('./schema')

const OBJECT_CACHE_CONTROL = 'public, max-age=31536000, immutable'

/** How long the service may take to answer, in ms, per kind of request. */
const ANSWER_MS = {
  head: 8000,
  open: 15000,
  remove: 10000,
  list: 15000,
  // A buffer goes up in one request: this much, plus time for the bytes at 20 KB/s.
  write: 60000,
  // A stream goes up in parts: given up when neither the source nor the service moved for this long.
  uploadIdle: 10 * 60 * 1000,
}

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

function timedOut(ms) {
  return Object.assign(new Error(`the storage service did not answer within ${ms} ms`), { name: 'TimeoutError', code: 'ETIMEDOUT' })
}

/**
 * Everything about a configuration's addresses that needs neither the SDK nor
 * the secret: where browsers are sent, which public addresses map back to a
 * key, and which endpoint a signed address is made for.
 */
function addressing(cfg) {
  const prefix = cfg.keyPrefix || ''
  const publicBase = cfg.publicBaseUrl ? `${cfg.publicBaseUrl}/${prefix}` : ''
  return {
    id: backendId(cfg),
    driver: 's3',
    /** Where it is, for log lines: host/bucket[/prefix]. */
    label: describePlace(cfg),
    delivery: cfg.delivery === 'redirect' && publicBase ? 'redirect' : 'proxy',
    publicOrigin: cfg.publicBaseUrl ? new URL(cfg.publicBaseUrl).origin : '',
    /** The service address signed URLs point at; '' means AWS's own, which is on the internet. */
    signingEndpoint: cfg.presignEndpoint || cfg.endpoint || '',
    /** Address of the object on the public domain (custom domain, CDN, r2.dev), or ''. */
    publicUrl(key) {
      return publicBase && isValidKey(key) ? publicBase + key : ''
    },
    /** Inverse of publicUrl: the key a public address points at, or null. */
    keyFromPublicUrl(url) {
      if (!publicBase || typeof url !== 'string' || !url.startsWith(publicBase)) return null
      const key = url.slice(publicBase.length).split(/[?#]/)[0]
      return isValidKey(key) ? key : null
    },
  }
}

/**
 * @param {object} cfg       a parsed configuration (schema.js) with its secret
 * @param {object} [opts]    { maxAttempts, connectionTimeout, requestTimeout } - the
 *                           connection test wants to fail fast: `requestTimeout` is then the
 *                           deadline of every request. Normal use keeps the ones above.
 */
function createS3Backend(cfg, opts = {}) {
  const { S3Client, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, ListObjectsV2Command, Upload, getSignedUrl } = loadSdk()
  const clientFor = (endpoint) => new S3Client({
    region: cfg.region,
    endpoint: endpoint || undefined,
    forcePathStyle: !!cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // Understood by SDK 3.729 and later; earlier versions never add the checksum.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    ...(opts.maxAttempts ? { maxAttempts: opts.maxAttempts } : {}),
    requestHandler: { connectionTimeout: opts.connectionTimeout || 10000 },
  })
  const client = clientFor(cfg.endpoint)
  const Bucket = cfg.bucket
  const prefix = cfg.keyPrefix || ''
  const answerMs = (kind, asked) => asked || opts.requestTimeout || ANSWER_MS[kind]

  /**
   * Send one request and wait for the service's answer, at most `ms`. `signal`
   * lets the caller give up earlier. Once the answer is there the deadline is
   * off: a body that is still streaming is never cut by it.
   */
  async function send(command, ms, signal) {
    const ctl = new AbortController()
    const giveUp = () => ctl.abort(signal.reason)
    if (signal) {
      if (signal.aborted) throw signal.reason
      signal.addEventListener('abort', giveUp, { once: true })
    }
    const timer = setTimeout(() => ctl.abort(timedOut(ms)), ms)
    try {
      return await client.send(command, { abortSignal: ctl.signal })
    } catch (err) {
      // Whatever the SDK made of the abort, the caller gets the reason it was given.
      if (ctl.signal.aborted && ctl.signal.reason instanceof Error) throw ctl.signal.reason
      throw err
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', giveUp)
    }
  }

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
      const ms = opts.requestTimeout || ANSWER_MS.write + Math.ceil(body.length / 20)
      await send(new PutObjectCommand({ ...params, Body: body, ContentLength: body.length }), ms)
      return { key, size: body.length }
    }
    // A stream of unknown length goes up as a multipart upload. The counter
    // sits in the pipe, so a source that fails (download cut, size cap) fails
    // the upload, and the SDK then aborts it instead of leaving parts behind.
    let size = 0
    let upload = null
    let stalled = false
    let idle = null
    const moved = () => {
      clearTimeout(idle)
      idle = setTimeout(() => { stalled = true; if (upload) upload.abort().catch(() => {}) }, opts.requestTimeout || ANSWER_MS.uploadIdle)
    }
    const counted = new Transform({
      transform(chunk, _enc, done) { size += chunk.length; moved(); done(null, chunk) },
    })
    upload = new Upload({ client, params: { ...params, Body: counted } })
    upload.on('httpUploadProgress', moved)
    pipeline(body, counted, () => {})
    moved()
    try {
      await upload.done()
    } catch (err) {
      if (stalled) throw timedOut(opts.requestTimeout || ANSWER_MS.uploadIdle)
      throw err
    } finally {
      clearTimeout(idle)
    }
    return { key, size }
  }

  /** { size, etag, lastModified } or null when the object does not exist. */
  async function head(key, { timeoutMs, signal } = {}) {
    try {
      const out = await send(new HeadObjectCommand({ Bucket, Key: objectKey(key) }), answerMs('head', timeoutMs), signal)
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
  async function open(key, { range, ifNoneMatch, timeoutMs } = {}) {
    try {
      const out = await send(new GetObjectCommand({
        Bucket,
        Key: objectKey(key),
        ...(range ? { Range: range } : {}),
        ...(ifNoneMatch ? { IfNoneMatch: ifNoneMatch } : {}),
      }), answerMs('open', timeoutMs))
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

  async function remove(key, { timeoutMs } = {}) {
    await send(new DeleteObjectCommand({ Bucket, Key: objectKey(key) }), answerMs('remove', timeoutMs))
  }

  /**
   * Remove every object under a key prefix ("uploads/<account id>/"). One
   * request per object: the batch delete is not implemented alike everywhere.
   * Each request has its own deadline, so a large prefix may take long but a
   * service that stopped answering does not. Resolves how many objects went;
   * an error carries the number removed before it in `removed`.
   */
  async function removePrefix(keyPrefix, { timeoutMs } = {}) {
    if (!/^[a-z0-9]+(\/[a-z0-9]+)+\/$/.test(keyPrefix)) throw new Error('invalid storage prefix')
    let count = 0
    let token
    try {
      do {
        const page = await send(new ListObjectsV2Command({ Bucket, Prefix: prefix + keyPrefix, ContinuationToken: token }), answerMs('list', timeoutMs))
        for (const object of page.Contents || []) {
          await send(new DeleteObjectCommand({ Bucket, Key: object.Key }), answerMs('remove', timeoutMs))
          count++
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined
      } while (token)
    } catch (err) {
      throw Object.assign(err, { removed: count })
    }
    return count
  }

  /**
   * A signed GET address that works without credentials for `expiresIn`
   * seconds. It is made for the endpoint the service has from outside when one
   * is configured (`presignEndpoint`), otherwise for the endpoint itself. The
   * signature covers the host name, so the address only works under the name
   * it was made for: a reverse proxy in front of the service has to pass the
   * Host header on unchanged. Signing is done here; nothing is contacted.
   */
  let signer = null
  function presignGet(key, expiresIn) {
    if (cfg.presignEndpoint && !signer) signer = clientFor(cfg.presignEndpoint)
    return getSignedUrl(signer || client, new GetObjectCommand({ Bucket, Key: objectKey(key) }), { expiresIn })
  }

  return {
    ...addressing(cfg),
    put,
    head,
    open,
    getStream,
    getBuffer,
    delete: remove,
    deletePrefix: removePrefix,
    presignGet,
  }
}

module.exports = { createS3Backend, addressing, statusOf, isNotFound }
