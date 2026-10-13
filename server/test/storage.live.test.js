'use strict'

/**
 * Storage against a real S3 API. Nothing here is mocked: objects are written
 * to and read from the service named by the environment.
 *
 *   TEST_S3_ENDPOINT            e.g. http://127.0.0.1:9000 (MinIO)
 *   TEST_S3_BUCKET              an existing, private bucket
 *   TEST_S3_ACCESS_KEY_ID
 *   TEST_S3_SECRET_ACCESS_KEY
 *   TEST_S3_REGION              default us-east-1
 *   TEST_S3_FORCE_PATH_STYLE    default true
 *   TEST_S3_VHOST_ENDPOINT      optional: an endpoint where <bucket>.<host> resolves,
 *                               to exercise virtual-hosted addressing
 *   TEST_S3_PUBLIC_BUCKET       optional: a bucket anyone can read ...
 *   TEST_S3_PUBLIC_BASE_URL     ... and the address it is read at, for redirect delivery
 *   TEST_MONGODB_URI            needed by the test that goes through the settings API
 *
 * Without TEST_S3_ENDPOINT every test in this file is reported as skipped.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { Readable } = require('stream')
const sharp = require('sharp')

const E = process.env
const LIVE = !!E.TEST_S3_ENDPOINT
const SKIP = LIVE ? false : 'no live S3: set TEST_S3_ENDPOINT, TEST_S3_BUCKET, TEST_S3_ACCESS_KEY_ID, TEST_S3_SECRET_ACCESS_KEY'
const SKIP_VHOST = SKIP || (E.TEST_S3_VHOST_ENDPOINT ? false : 'set TEST_S3_VHOST_ENDPOINT to test virtual-hosted addressing')
const SKIP_PUBLIC = SKIP || (E.TEST_S3_PUBLIC_BUCKET && E.TEST_S3_PUBLIC_BASE_URL ? false : 'set TEST_S3_PUBLIC_BUCKET and TEST_S3_PUBLIC_BASE_URL to test redirect delivery')
const SKIP_API = SKIP || (E.TEST_MONGODB_URI ? false : 'set TEST_MONGODB_URI to test the settings API against live S3')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomcanvas-s3-'))
process.env.SECRET_KEY = 'storage-live-secret-key-0123456789'
process.env.STORAGE_LOCAL_DIR = tmpDir
process.env.PUBLIC_URL = ''
process.env.WEB_DIST = ''
process.env.BILLING_HOOK = ''
for (const name of Object.keys(process.env)) if (/^(S3_|STORAGE_DRIVER$)/.test(name)) delete process.env[name]

const storage = require('../src/storage')
const { parseS3Config } = require('../src/storage/schema')
const { createS3Backend } = require('../src/storage/s3')
const { probe } = require('../src/storage/probe')

/** Every object of one run sits under its own prefix, so runs do not see each other. */
const RUN = `loomcanvastest/${crypto.randomBytes(4).toString('hex')}`
const base = () => ({
  preset: 'custom',
  endpoint: E.TEST_S3_ENDPOINT,
  region: E.TEST_S3_REGION || 'us-east-1',
  bucket: E.TEST_S3_BUCKET,
  accessKeyId: E.TEST_S3_ACCESS_KEY_ID,
  secretAccessKey: E.TEST_S3_SECRET_ACCESS_KEY,
  forcePathStyle: !/^(0|false|no)$/i.test(E.TEST_S3_FORCE_PATH_STYLE || 'true'),
  keyPrefix: RUN,
})
const config = (over = {}) => parseS3Config({ ...base(), ...over })
const hex = (n = 16) => crypto.randomBytes(n).toString('hex')
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

async function listen(app) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close() } }
}

/** The /files route alone: all it needs is the storage layer. */
function filesApp() {
  const app = require('express')()
  app.use('/files', require('../src/routes/files').staticRouter())
  return listen(app)
}

test.after(async () => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  if (!LIVE) return
  // Leave the buckets as they were found: remove whatever this run wrote under its prefix.
  const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3')
  const cfg = config({ keyPrefix: '' })
  const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint || undefined, forcePathStyle: cfg.forcePathStyle, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } })
  for (const Bucket of [E.TEST_S3_BUCKET, E.TEST_S3_PUBLIC_BUCKET].filter(Boolean)) {
    const listed = await client.send(new ListObjectsV2Command({ Bucket, Prefix: `${RUN}/` }))
    for (const object of listed.Contents || []) await client.send(new DeleteObjectCommand({ Bucket, Key: object.Key }))
  }
  client.destroy()
})

test('S3 backend: write, look up, read, ranges, conditional reads, delete', { skip: SKIP }, async () => {
  const backend = createS3Backend(config())
  const key = `uploads/2025/01/${hex()}.png`
  const body = crypto.randomBytes(70000)

  assert.equal(await backend.head(key), null)
  assert.equal(await backend.open(key), null)
  await assert.rejects(() => backend.getBuffer(key), { code: 'ENOENT' })

  assert.deepEqual(await backend.put(key, body, { contentType: 'image/png' }), { key, size: body.length })
  const info = await backend.head(key)
  assert.equal(info.size, body.length)
  assert.ok(info.etag && info.lastModified)
  assert.ok((await backend.getBuffer(key)).equals(body))

  const part = await backend.open(key, { range: 'bytes=100-199' })
  assert.deepEqual([part.status, part.size, part.contentRange], [206, 100, `bytes 100-199/${body.length}`])
  const chunks = []
  for await (const c of part.stream) chunks.push(c)
  assert.ok(Buffer.concat(chunks).equals(body.subarray(100, 200)))

  const tail = await backend.open(key, { range: 'bytes=-10' })
  assert.deepEqual([tail.status, tail.size], [206, 10])
  tail.stream.destroy()
  assert.equal((await backend.open(key, { ifNoneMatch: info.etag })).status, 304)
  assert.equal((await backend.open(key, { range: `bytes=${body.length + 5}-` })).status, 416)

  // The prefix is really in front of the key inside the bucket.
  const unprefixed = createS3Backend(config({ keyPrefix: '' }))
  assert.equal((await unprefixed.head(`${RUN}/${key}`)).size, body.length)
  assert.equal(await unprefixed.head(key), null)

  await backend.delete(key)
  assert.equal(await backend.head(key), null)
  await backend.delete(key) // deleting what is not there is not an error
})

test('S3 backend: a stream of unknown length goes up in parts; a stream that fails leaves nothing behind', { skip: SKIP }, async () => {
  const backend = createS3Backend(config())
  const key = `outputs/2025/01/${hex()}.mp4`
  // Larger than one part (5 MiB), so this is a real multipart upload.
  const body = crypto.randomBytes(6 * 1024 * 1024 + 12345)
  const saved = await backend.put(key, Readable.from((function * () {
    for (let at = 0; at < body.length; at += 256 * 1024) yield body.subarray(at, at + 256 * 1024)
  })()), { contentType: 'video/mp4' })
  assert.equal(saved.size, body.length)
  assert.equal((await backend.head(key)).size, body.length)
  assert.equal(sha(await backend.getBuffer(key)), sha(body))
  await backend.delete(key)

  const broken = `outputs/2025/01/${hex()}.mp4`
  await assert.rejects(() => backend.put(broken, Readable.from((async function * () {
    yield crypto.randomBytes(6 * 1024 * 1024)
    throw new Error('source cut off')
  })()), { contentType: 'video/mp4' }), /source cut off/)
  assert.equal(await backend.head(broken), null)
})

test('S3 backend: an optional ACL is accepted', { skip: SKIP }, async () => {
  const backend = createS3Backend(config({ acl: 'private' }))
  const key = `uploads/2025/01/${hex()}.png`
  await backend.put(key, Buffer.from('acl'), { contentType: 'image/png' })
  assert.equal((await backend.getBuffer(key)).toString(), 'acl')
  await backend.delete(key)
})

test('signed address: loads without credentials, only with its signature, only for this object', { skip: SKIP }, async () => {
  const backend = createS3Backend(config())
  const key = `uploads/2025/01/${hex()}.png`
  const body = crypto.randomBytes(2048)
  await backend.put(key, body, { contentType: 'image/png' })
  try {
    const url = await backend.presignGet(key, 60)
    const res = await fetch(url)
    assert.equal(res.status, 200)
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(body))
    assert.equal(res.headers.get('content-type'), 'image/png')

    const bare = url.split('?')[0]
    assert.equal((await fetch(bare)).status, 403, 'the bucket is private: no signature, no file')
    const tampered = new URL(url)
    tampered.searchParams.set('X-Amz-Signature', '0'.repeat(64))
    assert.equal((await fetch(tampered)).status, 403)
    const other = new URL(url)
    other.pathname = other.pathname.replace(/[0-9a-f]{32}\.png$/, `${hex()}.png`)
    assert.equal((await fetch(other)).status, 403, 'a signature is for one object')
  } finally {
    await backend.delete(key)
  }
})

test('virtual-hosted addressing against the live service', { skip: SKIP_VHOST }, async () => {
  const cfg = config({ endpoint: E.TEST_S3_VHOST_ENDPOINT, forcePathStyle: false })
  const backend = createS3Backend(cfg)
  const key = `uploads/2025/01/${hex()}.png`
  const signed = new URL(await backend.presignGet(key, 60))
  assert.ok(signed.hostname.startsWith(`${cfg.bucket}.`), `the bucket is in the host name: ${signed.hostname}`)
  assert.ok(!signed.pathname.startsWith(`/${cfg.bucket}/`))
  await backend.put(key, Buffer.from('virtual-hosted'), { contentType: 'image/png' })
  assert.equal((await backend.getBuffer(key)).toString(), 'virtual-hosted')
  assert.equal(await (await fetch(signed)).text(), 'virtual-hosted')
  await backend.delete(key)
  const result = await probe(cfg)
  assert.equal(result.ok, true, JSON.stringify(result.error))
})

test('connection test: passes on a good configuration and names what is wrong with a bad one', { skip: SKIP }, async () => {
  const good = await probe(config())
  assert.deepEqual([good.ok, good.error], [true, null])
  assert.deepEqual(good.steps.map((s) => `${s.step}:${s.status}`), ['put:ok', 'head:ok', 'get:ok', 'delete:ok'])

  const failure = async (over) => {
    const result = await probe(config(over))
    assert.equal(result.ok, false)
    assert.equal(result.steps[0].status, 'failed')
    return result.error.code
  }
  assert.equal(await failure({ secretAccessKey: 'definitely-not-the-secret' }), 'storage.err_signature')
  assert.equal(await failure({ accessKeyId: 'NOSUCHACCESSKEYID' }), 'storage.err_access_key')
  assert.equal(await failure({ bucket: `no-such-bucket-${hex(6)}` }), 'storage.err_no_bucket')
  assert.equal(await failure({ endpoint: 'http://127.0.0.1:9' }), 'storage.err_unreachable')
  assert.equal(await failure({ endpoint: 'http://storage.invalid:9000', forcePathStyle: false }), 'storage.err_host_bucket_not_found')
  assert.equal(await failure({ endpoint: 'http://storage.invalid:9000', forcePathStyle: true }), 'storage.err_host_not_found')

  // The test leaves nothing in the bucket.
  const again = await probe(config({ keyPrefix: `${RUN}/probe-only` }))
  assert.equal(again.ok, true)
})

test('/files/<key> from a private bucket: streamed by the app with ranges, validators and the right headers', { skip: SKIP }, async () => {
  storage.resetStorage()
  storage.configure({ active: config(), readable: [] })
  const { ingest } = require('../src/routes/files')
  const app = await filesApp()
  try {
    const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#aa3322' } }).png().toBuffer()
    const up = await ingest(png)
    assert.match(up.url, /^\/files\/uploads\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/, 'the same site-relative address as on the local disk')
    assert.match(up.thumbnailUrl, /^\/files\/thumbs\/of\/uploads\/.+_png\.webp$/)
    assert.equal(fs.existsSync(path.join(tmpDir, up.key)), false, 'not on the local disk')
    assert.equal(fs.readdirSync(tmpDir).length, 0, 'nothing on the local disk at all')
    const backend = storage.getStorage().active
    assert.equal((await backend.head(up.key)).size, png.length, 'in the bucket')

    const res = await fetch(app.url + up.url)
    assert.equal(res.status, 200)
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(png))
    assert.equal(res.headers.get('content-type'), 'image/png')
    assert.equal(res.headers.get('content-length'), String(png.length))
    assert.equal(res.headers.get('accept-ranges'), 'bytes')
    assert.match(res.headers.get('cache-control'), /max-age=31536000, immutable/)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.match(res.headers.get('content-security-policy'), /sandbox/)
    const etag = res.headers.get('etag')
    assert.ok(etag)

    const ranged = await fetch(app.url + up.url, { headers: { Range: 'bytes=10-19' } })
    assert.deepEqual([ranged.status, ranged.headers.get('content-range'), ranged.headers.get('content-length')], [206, `bytes 10-19/${png.length}`, '10'])
    assert.ok(Buffer.from(await ranged.arrayBuffer()).equals(png.subarray(10, 20)))
    assert.equal((await fetch(app.url + up.url, { headers: { Range: `bytes=${png.length + 1}-` } })).status, 416)

    const cached = await fetch(app.url + up.url, { headers: { 'If-None-Match': etag } })
    assert.deepEqual([cached.status, (await cached.arrayBuffer()).byteLength], [304, 0])

    const head = await fetch(app.url + up.url, { method: 'HEAD' })
    assert.deepEqual([head.status, head.headers.get('content-length'), head.headers.get('content-type')], [200, String(png.length), 'image/png'])

    // The eager thumbnail is in the bucket and is served; delete it and it is made again on request.
    const thumbKey = up.thumbnailUrl.slice('/files/'.length)
    assert.ok(await backend.head(thumbKey))
    const thumb = await fetch(app.url + up.thumbnailUrl)
    assert.deepEqual([thumb.status, thumb.headers.get('content-type')], [200, 'image/webp'])
    assert.equal((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width, 512)
    await storage.getStorage().delete(thumbKey)
    assert.equal(await backend.head(thumbKey), null)
    assert.equal((await fetch(app.url + up.thumbnailUrl)).status, 200)
    assert.ok(await backend.head(thumbKey), 'the lazily made thumbnail went to the bucket, next to its image')

    assert.equal((await fetch(`${app.url}/files/uploads/2025/01/${hex()}.png`)).status, 404)
    assert.equal((await fetch(`${app.url}/files/thumbs/of/uploads/2025/01/${hex()}_png.webp`)).status, 404)
    assert.equal((await fetch(`${app.url}/files/..%2f..%2fetc%2fpasswd`)).status, 404)
  } finally {
    app.close()
    storage.resetStorage()
  }
})

test('/files/<key> streams a large video in pieces: a range in the middle does not read the rest', { skip: SKIP }, async () => {
  storage.resetStorage()
  storage.configure({ active: config(), readable: [] })
  const app = await filesApp()
  try {
    const key = storage.newKey('outputs', 'video/mp4')
    const body = crypto.randomBytes(9 * 1024 * 1024)
    await storage.getStorage().put(key, Readable.from([body]), { contentType: 'video/mp4' })
    const start = 5 * 1024 * 1024
    const res = await fetch(`${app.url}/files/${key}`, { headers: { Range: `bytes=${start}-${start + 65535}` } })
    assert.deepEqual([res.status, res.headers.get('content-type'), res.headers.get('content-length')], [206, 'video/mp4', '65536'])
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(body.subarray(start, start + 65536)))

    // A player that goes away mid-file does not keep the bucket stream open.
    const aborter = new AbortController()
    const partial = await fetch(`${app.url}/files/${key}`, { signal: aborter.signal })
    const reader = partial.body.getReader()
    await reader.read()
    aborter.abort()
    const whole = await fetch(`${app.url}/files/${key}`)
    assert.equal(sha(Buffer.from(await whole.arrayBuffer())), sha(body))
    await storage.getStorage().delete(key)
  } finally {
    app.close()
    storage.resetStorage()
  }
})

test('switching storage: files written before the switch keep loading, in both directions', { skip: SKIP }, async () => {
  storage.resetStorage()
  const { ingest } = require('../src/routes/files')
  const { loadImage, openStream } = require('../src/services/media')
  const app = await filesApp()
  const facade = storage.getStorage()
  const picture = (color) => sharp({ create: { width: 900, height: 600, channels: 3, background: color } }).png().toBuffer()
  const get = async (url) => { const r = await fetch(app.url + url); return { status: r.status, body: Buffer.from(await r.arrayBuffer()) } }
  try {
    // On the local disk.
    storage.configure({ active: null, readable: [] })
    const onDisk = await picture('#112233')
    const a = await ingest(onDisk)
    assert.ok(fs.existsSync(path.join(tmpDir, a.key)))

    // Switch to the bucket.
    storage.configure({ active: config(), readable: [] })
    const inBucket = await picture('#445566')
    const b = await ingest(inBucket)
    assert.ok(!fs.existsSync(path.join(tmpDir, b.key)), 'new files do not go to the disk')
    assert.ok(await facade.active.head(b.key))
    assert.equal(await facade.active.head(a.key), null, 'old files are not moved')
    for (const [file, bytes] of [[a, onDisk], [b, inBucket]]) {
      const got = await get(file.url)
      assert.equal(got.status, 200)
      assert.ok(got.body.equals(bytes))
      assert.equal((await get(file.thumbnailUrl)).status, 200)
      // Server-side readers (canvas tools, zip export, reference images) go the same way.
      assert.ok((await loadImage(file.url)).buffer.equals(bytes))
      const opened = await openStream(file.url)
      assert.equal(opened.size, bytes.length)
      opened.stream.destroy()
    }

    // Back to the disk; the bucket is still configured, so its files still load.
    const bucket = config()
    storage.resetStorage()
    storage.configure({ active: null, readable: [bucket] })
    const c = await ingest(await picture('#778899'))
    assert.ok(fs.existsSync(path.join(tmpDir, c.key)))
    for (const file of [a, b, c]) assert.equal((await get(file.url)).status, 200)
    assert.ok((await get(b.url)).body.equals(inBucket))

    // Deleting (what the retention sweep does) removes each file from where it is.
    const s3 = createS3Backend(bucket)
    await facade.delete(b.key)
    await facade.delete(a.key)
    assert.equal(await s3.head(b.key), null)
    assert.ok(!fs.existsSync(path.join(tmpDir, a.key)))
    assert.equal((await get(b.url)).status, 404)

    // Without the bucket configured, its files are simply not found.
    storage.resetStorage()
    storage.configure({ active: null, readable: [] })
    assert.equal((await get(b.thumbnailUrl)).status, 404)
  } finally {
    app.close()
    storage.resetStorage()
  }
})

/** A reverse proxy in front of the live service. `keepHost`: pass the Host header on unchanged, as a proxy in front of S3 must. */
async function reverseProxy({ keepHost }) {
  const http = require('http')
  const target = new URL(E.TEST_S3_ENDPOINT)
  const server = http.createServer((req, res) => {
    const headers = { ...req.headers }
    if (!keepHost) headers.host = target.host
    const out = http.request({ host: target.hostname, port: target.port || 80, method: req.method, path: req.url, headers }, (answer) => {
      res.writeHead(answer.statusCode, answer.headers)
      answer.pipe(res)
    })
    out.on('error', () => { res.statusCode = 502; res.end() })
    req.pipe(out)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  /** Load a URL made for a public name by connecting to the proxy, the way DNS would send a client there. */
  const fetchThrough = (url) => new Promise((resolve, reject) => {
    const u = new URL(url)
    http.get({ host: '127.0.0.1', port, path: u.pathname + u.search, headers: { Host: u.host } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }))
    }).on('error', reject)
  })
  return { port, fetchThrough, close: () => { server.closeAllConnections(); server.close() } }
}

test('reference media for upstreams: never the address of a bucket that only this machine can reach', { skip: SKIP }, async () => {
  storage.resetStorage()
  storage.configure({ active: config(), readable: [] })
  const { ingest } = require('../src/routes/files')
  const { upstreamUrl, createMediaHelpers, isPubliclyReachable, newFilesReachable } = require('../src/services/media')
  const { setAllowedHosts } = require('../src/utils/safeFetch')
  try {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#00aa00' } }).png().toBuffer()
    const up = await ingest(png)
    assert.ok(!up.url.includes('X-Amz') && !up.thumbnailUrl.includes('X-Amz'), 'what the canvas stores is the site address')
    const helpers = createMediaHelpers()
    if (isPubliclyReachable(E.TEST_S3_ENDPOINT)) {
      // A bucket on the internet: a signed address that loads.
      const direct = await upstreamUrl(up.url)
      assert.match(direct, /X-Amz-Signature=/)
      assert.ok(Buffer.from(await (await fetch(direct)).arrayBuffer()).equals(png))
      assert.match(await helpers.toPublicUrl(up.url), /X-Amz-Expires=3600/)
    } else {
      // A bucket only this machine can reach (MinIO on 127.0.0.1): inline for images, a clear error
      // where a URL is required - also when the downloader is allowed to fetch from that host.
      for (const allowed of [[], [new URL(E.TEST_S3_ENDPOINT).hostname]]) {
        setAllowedHosts(allowed)
        assert.equal(await upstreamUrl(up.url), '')
        assert.match(await helpers.toRef(up.url), /^data:image\/png;base64,/)
        await assert.rejects(() => helpers.toPublicUrl(up.url), { code: 'media.needs_public_url' })
        assert.equal(await newFilesReachable(), false)
      }
    }
    await storage.getStorage().delete(up.key)
  } finally {
    setAllowedHosts([])
    storage.resetStorage()
  }
})

test('signed addresses for the name the service has outside: they load through a reverse proxy that keeps the Host header', { skip: SKIP }, async () => {
  const keeping = await reverseProxy({ keepHost: true })
  const rewriting = await reverseProxy({ keepHost: false })
  const { ingest } = require('../src/routes/files')
  const { upstreamUrl, newFilesReachable } = require('../src/services/media')
  try {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#aa00aa' } }).png().toBuffer()
    for (const [proxy, works] of [[keeping, true], [rewriting, false]]) {
      // The app talks to the service at its own address; signed addresses are made for a public name.
      const outside = `http://s3.example.com:${proxy.port}`
      storage.resetStorage()
      storage.configure({ active: config({ presignEndpoint: outside }), readable: [] })
      const up = await ingest(png)
      assert.equal(await newFilesReachable(), true)
      const signed = await upstreamUrl(up.url)
      assert.ok(signed.startsWith(`${outside}/`) && /X-Amz-Signature=/.test(signed), signed.split('?')[0])
      assert.ok(!signed.includes(new URL(E.TEST_S3_ENDPOINT).host), 'the address the app itself uses is not in it')
      const res = await proxy.fetchThrough(signed)
      if (works) {
        assert.equal(res.status, 200)
        assert.ok(res.body.equals(png), 'the object, through the proxy, with nothing but the signed address')
        const tampered = new URL(signed)
        tampered.searchParams.set('X-Amz-Signature', '0'.repeat(64))
        assert.equal((await proxy.fetchThrough(tampered.toString())).status, 403)
      } else {
        // The signature covers the host name: a proxy that replaces it breaks every signed address.
        assert.equal(res.status, 403)
        assert.match(res.body.toString(), /SignatureDoesNotMatch/)
      }
      await storage.getStorage().delete(up.key)
    }
  } finally {
    keeping.close()
    rewriting.close()
    storage.resetStorage()
  }
})

test('an earlier bucket that is down does not slow the live bucket down; a missing file is 503 until it is gone from the set', { skip: SKIP }, async () => {
  const { startBlackHole } = require('./support/fakeS3')
  const hole = await startBlackHole()
  const app = await filesApp()
  const { ingest } = require('../src/routes/files')
  const silent = config({ endpoint: hole.endpoint, bucket: 'gone-bucket' })
  const warn = console.warn
  console.warn = () => {}
  try {
    storage.resetStorage()
    storage.configure({ active: config(), readable: [] })
    const up = await ingest(await sharp({ create: { width: 900, height: 600, channels: 3, background: '#335577' } }).png().toBuffer())
    storage.resetStorage()
    storage.configure({ active: config(), readable: [silent] })
    for (const address of [up.url, up.thumbnailUrl]) {
      const started = Date.now()
      assert.equal((await fetch(app.url + address)).status, 200)
      assert.ok(Date.now() - started < 2000, `${address}: ${Date.now() - started} ms`)
    }
    assert.equal(hole.connections, 0)
    const missing = await fetch(`${app.url}/files/uploads/2025/01/${hex()}.png`)
    assert.deepEqual([missing.status, (await missing.json()).code, missing.headers.get('cache-control')], [503, 'storage.unreachable', 'no-store'])
    const removed = await storage.getStorage().deleteUserFiles('0123456789abcdef01234567', { waitMs: 1000 })
    assert.deepEqual([removed.failed.length, removed.pending.length], [1, 0], 'known to be down: not waited for')
    storage.configure({ active: config(), readable: [] })
    assert.equal((await fetch(`${app.url}/files/uploads/2025/01/${hex()}.png`)).status, 404)
    await storage.getStorage().delete(up.key)
    await storage.getStorage().delete(storage.thumbKeyFor(up.key))
  } finally {
    console.warn = warn
    hole.close()
    app.close()
    storage.resetStorage()
  }
})

test('redirect delivery: /files/<key> sends the browser to the public domain', { skip: SKIP_PUBLIC }, async () => {
  const cfg = config({ bucket: E.TEST_S3_PUBLIC_BUCKET, publicBaseUrl: E.TEST_S3_PUBLIC_BASE_URL, delivery: 'redirect' })
  storage.resetStorage()
  storage.configure({ active: cfg, readable: [] })
  const { ingest } = require('../src/routes/files')
  const { upstreamUrl, isPubliclyReachable } = require('../src/services/media')
  const app = await filesApp()
  try {
    const png = await sharp({ create: { width: 800, height: 800, channels: 3, background: '#3355ff' } }).png().toBuffer()
    const up = await ingest(png)
    assert.match(up.url, /^\/files\/uploads\//, 'still the site address')

    const expected = `${cfg.publicBaseUrl}/${cfg.keyPrefix}${up.key}`
    const hop = await fetch(app.url + up.url, { redirect: 'manual' })
    assert.deepEqual([hop.status, hop.headers.get('location')], [302, expected])
    assert.match(hop.headers.get('cache-control'), /max-age=300/)
    const followed = await fetch(app.url + up.url)
    assert.equal(followed.url, expected)
    assert.ok(Buffer.from(await followed.arrayBuffer()).equals(png))
    assert.equal(followed.headers.get('content-type'), 'image/png')

    const thumb = await fetch(app.url + up.thumbnailUrl, { redirect: 'manual' })
    assert.equal(thumb.status, 302)
    assert.equal((await fetch(thumb.headers.get('location'))).headers.get('content-type'), 'image/webp')

    // Upstreams get the public address, which does not expire - when it is one they can open.
    assert.equal(await upstreamUrl(up.url), isPubliclyReachable(cfg.publicBaseUrl) ? expected : '')

    // The connection test checks that the public address really serves the bucket.
    const good = await probe(cfg)
    assert.deepEqual(good.steps.map((s) => `${s.step}:${s.status}`), ['put:ok', 'head:ok', 'get:ok', 'public:ok', 'delete:ok'])
    // ... and says so when the bucket behind it is not readable by everyone.
    const privateBase = cfg.publicBaseUrl.replace(E.TEST_S3_PUBLIC_BUCKET, E.TEST_S3_BUCKET)
    if (privateBase !== cfg.publicBaseUrl) {
      const bad = await probe(config({ publicBaseUrl: privateBase, delivery: 'redirect' }))
      assert.deepEqual([bad.ok, bad.error.code, bad.error.params.status], [false, 'storage.err_public_status', 403])
      assert.deepEqual(bad.steps.map((s) => `${s.step}:${s.status}`), ['put:ok', 'head:ok', 'get:ok', 'public:failed', 'delete:ok'])
    }
    await storage.getStorage().delete(up.key)
  } finally {
    app.close()
    storage.resetStorage()
  }
})

test('settings API against live S3: test, save, switch, and everything that reads or deletes files', { skip: SKIP_API }, async () => {
  const mongoose = require('mongoose')
  const u = new URL(E.TEST_MONGODB_URI)
  u.pathname = `/loomcanvas_s3_${hex(4)}`
  await mongoose.connect(u.toString(), { serverSelectionTimeoutMS: 8000 })
  require('../src/config').resetConfig()
  storage.resetStorage()
  const storageSettings = require('../src/services/storageSettings')
  storageSettings.reset()
  await require('../src/services/settings').load()
  await storageSettings.load()
  const app = await listen(require('../src/app').createApp())

  let token = ''
  const call = async (method, pathname, body, extra = {}) => {
    const headers = token ? { Authorization: `Bearer ${token}`, ...extra } : extra
    const res = await fetch(app.url + pathname, {
      method,
      headers: body instanceof FormData || body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body instanceof FormData || body === undefined ? body : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }
  const upload = async (png) => {
    const form = new FormData()
    form.append('file', new Blob([png], { type: 'image/png' }), 'x.png')
    const r = await call('POST', '/api/files/upload', form)
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return r.body.data
  }
  const picture = (color) => sharp({ create: { width: 900, height: 700, channels: 3, background: color } }).png().toBuffer()
  const { secretAccessKey, ...form } = base()
  const s3 = { ...form, preset: 'minio' }

  try {
    // Storage is the super admin's to configure; that account is created at start-up.
    await require('../src/services/accounts').prepare({ admin: { username: 'owner', email: 'owner@example.com', password: 'correct horse' } })
    const session = (await call('POST', '/api/auth/login', { account: 'owner', password: 'correct horse' })).body.data
    token = session.token
    let status = (await call('GET', '/api/admin/storage')).body.data
    assert.deepEqual([status.source, status.driver, status.s3], ['default', 'local', null])
    const localFile = await upload(await picture('#101010'))
    assert.ok(fs.existsSync(path.join(tmpDir, localFile.key)))

    // Test with the submitted, unsaved configuration - in the reader's language.
    const passed = (await call('POST', '/api/admin/storage/test', { s3: { ...s3, secretAccessKey } }, { 'X-Locale': 'en' })).body.data
    assert.deepEqual([passed.ok, passed.message, passed.steps.length], [true, require('../src/i18n/en')['storage.test_ok'], 4])
    const failed = (await call('POST', '/api/admin/storage/test', { s3: { ...s3, secretAccessKey: 'wrong-wrong-wrong' } }, { 'X-Locale': 'en' })).body.data
    assert.deepEqual([failed.ok, failed.code, failed.message], [false, 'storage.err_signature', require('../src/i18n/en')['storage.err_signature']])
    assert.equal((await call('POST', '/api/admin/storage/test', { s3 })).body.code, 'validation.required', 'no secret typed and none stored')
    assert.equal((await call('GET', '/api/admin/storage')).body.data.driver, 'local', 'testing changes nothing')

    // Saving runs the test; a failing one is refused unless forced.
    const refused = await call('PUT', '/api/admin/storage', { driver: 's3', s3: { ...s3, secretAccessKey: 'wrong-wrong-wrong' } })
    assert.deepEqual([refused.status, refused.body.code, refused.body.data.test.code], [400, 'storage.save_needs_test', 'storage.err_signature'])
    assert.equal(await mongoose.connection.collection('settings').countDocuments({ key: 'storage' }), 0)

    const saved = await call('PUT', '/api/admin/storage', { driver: 's3', s3: { ...s3, secretAccessKey } })
    assert.equal(saved.status, 200, JSON.stringify(saved.body))
    status = saved.body.data
    assert.deepEqual([status.source, status.driver, status.delivery, status.s3.bucket, status.s3.hasSecret, status.s3.secretTail], ['saved', 's3', 'proxy', s3.bucket, true, secretAccessKey.slice(-4)])
    const row = await mongoose.connection.collection('settings').findOne({ key: 'storage' })
    assert.ok(!JSON.stringify([saved.body, row]).includes(secretAccessKey), 'the secret is neither returned nor stored in the clear')
    assert.ok(row.value.s3.secretEnc.startsWith('v1.'))
    assert.ok(!JSON.stringify((await call('GET', '/api/admin/settings')).body).includes('secretEnc'), 'not part of the ordinary settings')

    // Effective at once: the next upload is in the bucket, the earlier one still loads.
    const bucketFile = await upload(await picture('#202020'))
    assert.ok(!fs.existsSync(path.join(tmpDir, bucketFile.key)))
    const backend = createS3Backend(config())
    assert.ok(await backend.head(bucketFile.key))
    for (const file of [localFile, bucketFile]) {
      assert.equal((await fetch(app.url + file.url)).status, 200)
      assert.equal((await fetch(app.url + file.thumbnailUrl)).status, 200)
    }

    // Canvas tool (slice) reads from and writes to the bucket; "fetch" recognises our own file.
    const sliced = await call('POST', '/api/canvas/tool/slice', { imageUrl: bucketFile.url, rows: 1, cols: 2 })
    assert.equal(sliced.status, 200, JSON.stringify(sliced.body))
    const pieces = JSON.stringify(sliced.body.data).match(/\/files\/tools\/[^"]+/g) || []
    assert.ok(pieces.length >= 2)
    assert.ok(await backend.head(pieces[0].slice('/files/'.length)))
    const fetched = await call('POST', '/api/files/fetch', { url: bucketFile.url })
    assert.deepEqual([fetched.body.data.key, fetched.body.data.width], [bucketFile.key, 900])

    // Zip export of a canvas with one file on the disk and one in the bucket.
    const canvas = (await call('POST', '/api/workflow', { name: 'mixed', nodes: [
      { id: 'n1', type: 'image', position: { x: 0, y: 0 }, data: { imageUrl: localFile.url } },
      { id: 'n2', type: 'image', position: { x: 300, y: 0 }, data: { imageUrl: bucketFile.url } },
    ], edges: [] })).body.data
    const zip = await fetch(`${app.url}/api/workflow/${canvas.id || canvas._id}/download-zip`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' })
    assert.equal(zip.status, 200)
    const archive = Buffer.from(await zip.arrayBuffer()).toString('latin1')
    assert.ok(archive.includes('01-image.png') && archive.includes('02-image.png') && !archive.includes('skipped'), 'both files are in the archive')

    // Retention removes expired results from the bucket.
    const Run = require('../src/models/Run')
    const outKey = storage.newKey('outputs', 'image/png')
    await storage.getStorage().put(outKey, await picture('#303030'), { contentType: 'image/png' })
    await Run.create({ userId: session.user.id, kind: 'image', status: 'succeeded', modelId: 'x:y', providerId: new mongoose.Types.ObjectId(), upstreamModel: 'y', finishedAt: new Date(Date.now() - 3 * 86400000), outputs: [{ type: 'image', url: `/files/${outKey}`, key: outKey }] })
    await call('PUT', '/api/admin/settings', { retentionDays: 1 })
    assert.equal(await require('../src/services/retention').sweep(), 1)
    assert.equal(await backend.head(outKey), null)

    // Back to local: saved, immediate, the bucket's files still load, new files go to the disk.
    status = (await call('PUT', '/api/admin/storage', { driver: 'local' })).body.data
    assert.deepEqual([status.source, status.driver, status.s3.bucket], ['saved', 'local', s3.bucket])
    const again = await upload(await picture('#404040'))
    assert.ok(fs.existsSync(path.join(tmpDir, again.key)))
    assert.equal((await fetch(app.url + bucketFile.url)).status, 200)

    // A restart keeps the saved choice (here: reload from the database).
    await call('PUT', '/api/admin/storage', { driver: 's3', s3 }) // secret left empty: the stored one is used
    storage.resetStorage()
    storageSettings.reset()
    status = await storageSettings.load()
    assert.deepEqual([status.source, status.driver], ['saved', 's3'])
    assert.equal((await fetch(app.url + bucketFile.url)).status, 200)
    assert.equal((await fetch(app.url + localFile.url)).status, 200)
  } finally {
    app.close()
    storage.resetStorage()
    storageSettings.reset()
    await mongoose.connection.dropDatabase()
    await mongoose.disconnect()
  }
})
