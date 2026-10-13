'use strict'

/**
 * Storage when something around it is wrong: a bucket that is only read and
 * cannot be reached, a saved secret that can no longer be decrypted, a bucket
 * whose address only works inside the deployment, a bucket that is described
 * by the environment while the local disk is in use.
 *
 * No storage service is needed. The S3 SDK talks over real sockets to three
 * stand-ins (support/fakeS3.js): an S3 API in memory, a port that refuses
 * connections, and a server that accepts them and never answers.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const express = require('express')
const sharp = require('sharp')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomcanvas-resilience-'))
process.env.SECRET_KEY = 'storage-test-secret-key-0123456789'
process.env.STORAGE_LOCAL_DIR = tmpDir
process.env.PUBLIC_URL = ''
for (const name of Object.keys(process.env)) if (/^(S3_|STORAGE_DRIVER$)/.test(name)) delete process.env[name]

const { getConfig } = require('../src/config')
const storage = require('../src/storage')
const { parseS3Config, backendId } = require('../src/storage/schema')
const s3 = require('../src/storage/s3')
const { createHealth } = require('../src/storage/health')
const { probe } = require('../src/storage/probe')
const storageSettings = require('../src/services/storageSettings')
const storageCleanup = require('../src/services/storageCleanup')
const media = require('../src/services/media')
const { isPubliclyReachable } = require('../src/utils/reachability')
const { setAllowedHosts } = require('../src/utils/safeFetch')
const { encrypt } = require('../src/utils/crypto')
const en = require('../src/i18n/en')
const zh = require('../src/i18n/zh-CN')
const { startFakeS3, refusedPort, startBlackHole } = require('./support/fakeS3')
const { withEnv, fakeSettings, capturingLog, timed } = require('./support/storageEnv')

test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

const OWNER = '0123456789abcdef01234567'
const OTHER = 'fedcba9876543210fedcba98'
const hex = () => require('crypto').randomBytes(16).toString('hex')
const key = (prefix = 'uploads', owner = '') => `${prefix}/${owner ? `${owner}/` : ''}2025/01/${hex()}.png`
const picture = (color = '#3366aa', size = 900) => sharp({ create: { width: size, height: size, channels: 3, background: color } }).png().toBuffer()
const unavailable = (code = 'storage.unreachable') => ({ name: 'StorageUnavailable', status: 503, code })
/** How long a lookup may take when a bucket that is only read does not answer: its deadline, and some slack. */
const LOOKUP_BOUND_MS = storage.LOOKUP_MS + 2500

async function listen(app) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => { server.closeAllConnections(); server.close() } }
}

/** The /files route with the language middleware in front of it, as in the app. */
function filesApp() {
  const app = express()
  app.use(require('../src/middleware/locale').locale)
  app.use('/files', require('../src/routes/files').staticRouter())
  return listen(app)
}

/** Backends that keep objects in a Map: real addresses and signatures, no service. */
function inMemoryBuckets() {
  const original = s3.createS3Backend
  const buckets = new Map()
  s3.createS3Backend = (cfg) => {
    const real = original(cfg)
    if (!buckets.has(real.id)) buckets.set(real.id, new Map())
    const objects = buckets.get(real.id)
    return {
      ...real,
      async put(k, body) { objects.set(k, body); return { key: k, size: body.length } },
      async head(k) { return objects.has(k) ? { size: objects.get(k).length } : null },
      async getBuffer(k) { return objects.get(k) },
      async delete(k) { objects.delete(k) },
    }
  }
  return { buckets, restore: () => { s3.createS3Backend = original } }
}

/* ------------------------------------------------- 1. what an upstream is given */

test('reachable from the internet: http(s), and not a name or address that only means something inside a network', () => {
  for (const url of [
    'https://canvas.example.com', 'http://canvas.example.com:8080/files/x', 'https://s3.eu-west-1.amazonaws.com',
    'https://acc.r2.cloudflarestorage.com', 'http://8.8.8.8:9000', 'https://[2606:4700:4700::1111]/',
  ]) assert.equal(isPubliclyReachable(url), true, url)
  for (const url of [
    // one label: a container or machine name
    'http://minio:9000', 'http://minio.:9000', 'https://storage', 'http://app:3000/files/x',
    // loopback, private, link-local, reserved
    'http://localhost:3000', 'http://localhost.:3000', 'http://127.0.0.1:9000', 'http://10.0.0.5:9000', 'http://172.16.3.4', 'http://192.168.1.20:3000',
    'http://169.254.169.254', 'http://100.64.0.1', 'http://0.0.0.0', 'http://[::1]:9000', 'http://[fe80::1]', 'http://[fd00::1]', 'http://[::ffff:10.0.0.1]',
    // names that never exist on the internet
    'http://nas.local', 'http://minio.internal:9000', 'http://app.localhost', 'http://minio.default.svc.cluster.local:9000', 'http://minio.storage.svc:9000',
    'http://router.lan', 'http://files.home.arpa', 'http://s3.corp', 'http://minio.test', 'http://nas.home', 'http://s3.intranet',
    // not an http(s) address at all
    'ftp://canvas.example.com', 'https://user:pw@canvas.example.com', 'file:///etc/passwd', 'not a url', '',
  ]) assert.equal(isPubliclyReachable(url), false, url)

  // What this server may download from (SSRF_ALLOW_HOSTS) says nothing about what an upstream can reach.
  setAllowedHosts(['minio', '10.0.0.5', '127.0.0.1'])
  try {
    for (const url of ['http://minio:9000', 'http://10.0.0.5:9000', 'http://127.0.0.1:9100']) assert.equal(isPubliclyReachable(url), false, url)
  } finally {
    setAllowedHosts([])
  }
})

test('a file in a bucket goes to an upstream by an address the upstream can open - never by an internal one', async () => {
  const fake = inMemoryBuckets()
  const png = await picture('#aa3322', 32)
  const helpers = media.createMediaHelpers()
  const K = key()
  const INTERNAL = { preset: 'minio', endpoint: 'http://minio:9000', region: 'us-east-1', bucket: 'canvas', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', forcePathStyle: true }

  /** Store the file in a bucket configured like this, then ask how it would reach an upstream. */
  async function handed(cfg, env = {}, { historical = false } = {}) {
    return withEnv({ PUBLIC_URL: '', ...env }, async () => {
      storage.resetStorage()
      const parsed = parseS3Config(cfg)
      storage.configure(historical ? { active: null, readable: [parsed] } : { active: parsed, readable: [] })
      fake.buckets.get(backendId(parsed)).set(K, png)
      const out = {
        url: await media.upstreamUrl(`/files/${K}`),
        ref: await helpers.toRef(`/files/${K}`),
        publicUrl: await helpers.toPublicUrl(`/files/${K}`).catch((err) => err.code),
        handover: historical ? null : media.newFilesHandover(),
        flag: historical ? null : await media.newFilesReachable(),
      }
      storage.resetStorage()
      return out
    })
  }
  const inline = (out) => {
    assert.equal(out.url, '')
    assert.match(out.ref, /^data:image\/png;base64,/, 'a model that takes inline input gets the bytes')
    assert.equal(out.publicUrl, 'media.needs_public_url', 'a model that needs a URL is refused before anything is sent')
  }

  try {
    // The compose set-up: the app reaches MinIO as "minio". No address of that kind leaves the app.
    let out = await handed(INTERNAL)
    inline(out)
    assert.deepEqual([out.handover, out.flag], ['inline', false], 'and the canvas is told so before a run')
    for (const text of [out.url, out.ref, out.publicUrl]) assert.ok(!text.includes('minio'), text.slice(0, 80))

    // Virtual-hosted addressing puts the bucket in front of the host. "canvas.minio" is still not a domain.
    out = await handed({ ...INTERNAL, forcePathStyle: false })
    inline(out)
    for (const endpoint of ['http://10.0.0.5:9000', 'http://127.0.0.1:9100', 'http://localhost:9000', 'http://minio.storage.svc:9000', 'http://[fd00::10]:9000']) {
      out = await handed({ ...INTERNAL, endpoint })
      inline(out)
      assert.equal(out.flag, false, endpoint)
    }

    // Internal endpoint, public PUBLIC_URL: through the app.
    out = await handed(INTERNAL, { PUBLIC_URL: 'https://canvas.example.com' })
    assert.equal(out.url, `https://canvas.example.com/files/${K}`)
    assert.deepEqual([out.ref, out.publicUrl, out.handover, out.flag], [out.url, out.url, 'app', true])
    // A PUBLIC_URL that is itself internal is no help.
    inline(await handed(INTERNAL, { PUBLIC_URL: 'http://app:3000' }))
    inline(await handed(INTERNAL, { PUBLIC_URL: 'http://192.168.1.20:3000' }))

    // Internal endpoint, files delivered from a public domain: that domain, before PUBLIC_URL.
    out = await handed({ ...INTERNAL, publicBaseUrl: 'https://cdn.example.com', delivery: 'redirect' }, { PUBLIC_URL: 'https://canvas.example.com' })
    assert.equal(out.url, `https://cdn.example.com/${K}`)
    assert.deepEqual([out.handover, out.flag], ['public_base', true])
    // A "public" domain that is internal as well is skipped, and PUBLIC_URL is used.
    out = await handed({ ...INTERNAL, publicBaseUrl: 'http://minio:9000/canvas', delivery: 'redirect' }, { PUBLIC_URL: 'https://canvas.example.com' })
    assert.equal(out.url, `https://canvas.example.com/files/${K}`)
    // A public base that is only kept for old addresses (delivery by the app) says nothing about the bucket being public.
    out = await handed({ ...INTERNAL, publicBaseUrl: 'https://cdn.example.com', delivery: 'proxy' })
    inline(out)

    // Internal endpoint with the name the service has from outside: signed for that name.
    out = await handed({ ...INTERNAL, presignEndpoint: 'https://s3.example.com' })
    let signed = new URL(out.url)
    assert.deepEqual([signed.host, signed.pathname], ['s3.example.com', `/canvas/${K}`])
    assert.ok(signed.searchParams.get('X-Amz-Signature') && signed.searchParams.get('X-Amz-Expires') === '3600')
    assert.deepEqual([out.handover, out.flag, out.publicUrl], ['signed', true, out.publicUrl])
    assert.ok(!out.url.includes('minio'))
    // ... and when that name is internal too, no signed address is made at all.
    out = await handed({ ...INTERNAL, endpoint: 'https://minio.example.com', presignEndpoint: 'http://proxy:9000' }, { PUBLIC_URL: 'https://canvas.example.com' })
    assert.equal(out.url, `https://canvas.example.com/files/${K}`)

    // A bucket on the internet: a signed address, no PUBLIC_URL needed.
    out = await handed({ ...INTERNAL, endpoint: 'https://minio.example.com' })
    assert.equal(new URL(out.url).host, 'minio.example.com')
    assert.deepEqual([out.handover, out.flag], ['signed', true])
    out = await handed({ ...INTERNAL, preset: 'aws', endpoint: '', region: 'eu-west-1', forcePathStyle: false })
    assert.equal(new URL(out.url).host, 'canvas.s3.eu-west-1.amazonaws.com')

    // A file in a bucket that is only read is signed with that bucket's own configuration.
    out = await handed({ ...INTERNAL, endpoint: 'https://old.example.com', bucket: 'earlier' }, {}, { historical: true })
    signed = new URL(out.url)
    assert.deepEqual([signed.host, signed.pathname], ['old.example.com', `/earlier/${K}`])
    inline(await handed({ ...INTERNAL, bucket: 'earlier' }, {}, { historical: true }))
  } finally {
    fake.restore()
    storage.resetStorage()
  }
})

test('the address signed URLs are made for is validated like the endpoint, and can come from the environment', () => {
  const base = { bucket: 'canvas', accessKeyId: 'AKID', endpoint: 'http://minio:9000' }
  const code = (over) => { try { parseS3Config({ ...base, ...over }); return null } catch (err) { return err.code } }
  assert.equal(parseS3Config(base).presignEndpoint, '')
  assert.equal(parseS3Config({ ...base, presignEndpoint: ' https://s3.example.com/ ' }).presignEndpoint, 'https://s3.example.com')
  assert.equal(code({ presignEndpoint: 'https://s3.example.com/canvas' }), 'storage.endpoint_has_path')
  assert.equal(code({ presignEndpoint: 'https://canvas.s3.example.com' }), 'storage.endpoint_has_bucket')
  assert.equal(code({ presignEndpoint: 'ftp://s3.example.com' }), 'validation.bad_url')
  assert.equal(code({ presignEndpoint: 'https://user:pw@s3.example.com' }), 'validation.bad_url')
  // Not part of where the files are: changing it is not a switch to another bucket.
  assert.equal(backendId(parseS3Config(base)), backendId(parseS3Config({ ...base, presignEndpoint: 'https://s3.example.com' })))

  const env = { STORAGE_DRIVER: 's3', S3_ENDPOINT: 'http://minio:9000', S3_BUCKET: 'canvas', S3_ACCESS_KEY_ID: 'AKID', S3_SECRET_ACCESS_KEY: 'secret-secret', S3_FORCE_PATH_STYLE: 'true' }
  assert.equal(withEnv(env, () => getConfig().storage.s3.presignEndpoint), '')
  assert.equal(withEnv({ ...env, S3_PRESIGN_ENDPOINT: 'https://s3.example.com' }, () => getConfig().storage.s3.presignEndpoint), 'https://s3.example.com')
  assert.throws(() => withEnv({ ...env, S3_PRESIGN_ENDPOINT: 'https://s3.example.com/x' }, getConfig), /S3_\* storage settings are not valid/)
})

/* ------------------------------------------------ 2. a bucket that is down */

test('a bucket that does not answer is left alone for a while, and said so once', () => {
  let now = 1000000
  const lines = []
  const health = createHealth({ now: () => now, log: { warn: (line) => lines.push(line) }, downMs: 30000 })
  const bucket = { id: 's3-aaaa', label: 'minio:9000/old' }
  const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
  const forbidden = Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })

  assert.equal(health.mayAsk(bucket), true)
  // An answer that is a refusal is an answer: the bucket is there.
  assert.equal(health.failed(bucket, forbidden), false)
  assert.equal(health.mayAsk(bucket), true)
  assert.deepEqual(lines, [])

  assert.equal(health.failed(bucket, refused), true)
  assert.equal(health.mayAsk(bucket), false, 'not asked while it is down')
  // Requests that were already under way fail too: no second line.
  health.failed(bucket, refused)
  health.failed(bucket, Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /minio:9000\/old cannot be reached \(ECONNREFUSED\)/)
  assert.deepEqual(Object.keys(health.snapshot()), ['s3-aaaa'])

  // When the time is up, one request finds out; the others still get the remembered answer.
  now += 31000
  assert.equal(health.mayAsk(bucket), true)
  assert.equal(health.mayAsk(bucket), false)
  health.failed(bucket, refused)
  assert.equal(lines.length, 2, 'still down: one more line per period')
  assert.match(lines[1], /still cannot be reached/)
  now += 31000
  assert.equal(health.mayAsk(bucket), true)
  health.ok(bucket)
  assert.match(lines[2], /can be reached again/)
  assert.equal(health.mayAsk(bucket), true)
  assert.deepEqual(health.snapshot(), {})
})

test('buckets that are only read and cannot be reached do not get in the way of files that are elsewhere', async (t) => {
  const service = await startFakeS3()
  const hole = await startBlackHole()
  const dead = await refusedPort()
  t.after(() => { service.close(); hole.close(); storage.resetStorage() })
  const active = parseS3Config(service.bucket('now'))
  const earlier = parseS3Config(service.bucket('earlier'))
  const refusing = parseS3Config({ ...service.bucket('refusing'), endpoint: `http://127.0.0.1:${dead}` })
  const silent = parseS3Config({ ...service.bucket('silent'), endpoint: hole.endpoint })
  const plan = { active, readable: [refusing, silent, earlier] }
  const facade = storage.getStorage()

  const inBucket = key()
  const onDisk = key()
  const inEarlier = key()
  storage.resetStorage()
  storage.configure({ active: null, readable: [] })
  await facade.put(onDisk, Buffer.from('on the disk'))
  storage.configure({ active: earlier, readable: [] })
  await facade.put(inEarlier, Buffer.from('in an earlier bucket'))
  storage.configure(plan)
  await facade.put(inBucket, Buffer.from('in the bucket in use'))
  storage.resetStorage() // nothing is remembered: every file has to be found again
  storage.configure(plan)

  const lines = await capturingLog(async () => {
    // Files on the disk and in the bucket in use: found without the others being asked at all.
    for (const [k, text] of [[inBucket, 'in the bucket in use'], [onDisk, 'on the disk']]) {
      const [buffer, ms] = await timed(() => facade.getBuffer(k))
      assert.equal(String(buffer), text)
      assert.ok(ms < 1500, `${text}: ${ms} ms`)
    }
    assert.equal(hole.connections, 0, 'the dead buckets were not contacted')

    // A file in a bucket that works is found although two others do not answer: bounded by the
    // short deadline, not by the SDK's own patience.
    let [found, ms] = await timed(() => facade.getBuffer(inEarlier))
    assert.equal(String(found), 'in an earlier bucket')
    assert.ok(ms < LOOKUP_BOUND_MS, `${ms} ms`)
    assert.equal(hole.connections, 1)

    // From here on the dead ones are known to be down: no waiting, no connection.
    const missing = key()
    let [err, again] = await timed(() => facade.locate(missing))
    assert.ok(again < 500, `${again} ms`)
    // Found nowhere, but two buckets that might have it could not be asked: unavailable, not missing.
    assert.equal(err.name, 'StorageUnavailable')
    assert.deepEqual([err.status, err.code], [503, 'storage.unreachable'])
    assert.equal(err.message, en['storage.unreachable'])
    assert.ok(!/127\.0\.0\.1|refusing|silent/.test(err.message), 'the message names no host and no bucket')
    await assert.rejects(() => facade.exists(missing), unavailable())
    await assert.rejects(() => facade.getBuffer(missing), unavailable())
    await assert.rejects(() => facade.delete(missing), unavailable())
    assert.equal(await facade.locate(missing, { tolerant: true }), null, 'what can be found right now: nothing')
    for (let i = 0; i < 20; i++) await facade.locate(key()).catch(() => {})
    assert.equal(hole.connections, 1, 'a dead bucket is not hammered')
    assert.deepEqual(facade.buckets().map((b) => b.state), ['ok', 'unreachable', 'unreachable', 'ok'])
    assert.ok(facade.buckets()[1].since instanceof Date)

    // Files that are where they can be read keep loading the whole time.
    assert.equal(String(await facade.getBuffer(inBucket)), 'in the bucket in use')
    ;[found, ms] = await timed(() => facade.getBuffer(key()).catch((e) => e.code))
    assert.equal(found, 'storage.unreachable')
  })
  assert.equal(lines.filter((l) => /refusing cannot be reached/.test(l)).length, 1, lines.join('\n'))
  assert.equal(lines.filter((l) => /silent cannot be reached \(ETIMEDOUT\)/.test(l)).length, 1, lines.join('\n'))
  assert.equal(lines.length, 2, 'one line per bucket that went down, nothing per request')

  // With every bucket answering, a file that is nowhere is simply not there.
  storage.configure({ active, readable: [earlier] })
  assert.equal(await facade.locate(key()), null)
  await assert.rejects(() => facade.getBuffer(key()), { code: 'ENOENT' })
})

test('/files/<key>: 404 for a file no storage has, 503 while a storage that might have it is down; thumbnails follow', async (t) => {
  const service = await startFakeS3()
  const hole = await startBlackHole()
  const app = await filesApp()
  t.after(() => { service.close(); hole.close(); app.close(); storage.resetStorage() })
  const active = parseS3Config(service.bucket('now'))
  const silent = parseS3Config({ ...service.bucket('silent'), endpoint: hole.endpoint })
  const facade = storage.getStorage()
  const { ingest } = require('../src/routes/files')
  const get = (pathname, headers) => fetch(app.url + pathname, { headers, redirect: 'manual' })

  storage.resetStorage()
  storage.configure({ active: null, readable: [] })
  const local = await ingest(await picture('#112233'))
  const oldLocal = key() // an image from before thumbnails were made on upload
  await facade.put(oldLocal, await picture('#445566'))
  storage.configure({ active, readable: [] })
  const bucket = await ingest(await picture('#778899'))
  const oldBucket = key()
  await facade.put(oldBucket, await picture('#99aabb'))
  storage.resetStorage()
  storage.configure({ active, readable: [silent] })

  await capturingLog(async () => {
    // What is on the disk and in the bucket in use is served, fast, thumbnails included.
    for (const file of [local, bucket]) {
      for (const address of [file.url, file.thumbnailUrl]) {
        const [res, ms] = await timed(() => get(address))
        assert.equal(res.status, 200, address)
        assert.ok(ms < 1500, `${address}: ${ms} ms`)
        await res.arrayBuffer()
      }
    }
    assert.match((await get(bucket.url)).headers.get('cache-control'), /immutable/)

    // A file that is nowhere: not a 404, the bucket that is down might have it.
    const [res, ms] = await timed(() => get(`/files/${key()}`, { 'X-Locale': 'en' }))
    assert.equal(res.status, 503)
    assert.ok(ms < LOOKUP_BOUND_MS, `${ms} ms`)
    assert.deepEqual(await res.json(), { result: -1, message: en['storage.unreachable'], code: 'storage.unreachable', data: null })
    assert.deepEqual([res.headers.get('cache-control'), res.headers.get('retry-after')], ['no-store', '30'])
    const second = await get(`/files/${key()}`, { 'X-Locale': 'zh-CN' })
    const body = await second.text()
    assert.equal(JSON.parse(body).message, zh['storage.unreachable'])
    assert.ok(!/127\.0\.0\.1|silent|now/.test(body.replace(zh['storage.unreachable'], '')), 'no host, no bucket')
    assert.equal(hole.connections, 1)

    // Thumbnails that do not exist yet are still made, next to their image, while that bucket is down.
    for (const [source, where] of [[oldLocal, 'disk'], [oldBucket, 'bucket']]) {
      const thumbKey = storage.thumbKeyFor(source)
      const made = await get(`/files/${thumbKey}`)
      assert.deepEqual([made.status, made.headers.get('content-type')], [200, 'image/webp'], where)
      assert.equal((await sharp(Buffer.from(await made.arrayBuffer())).metadata()).width, 512)
      assert.equal((await facade.locate(thumbKey)).driver, where === 'disk' ? 'local' : 's3')
    }
    assert.ok(fs.existsSync(path.join(tmpDir, storage.thumbKeyFor(oldLocal))))
    assert.ok(service.objects('now').has(storage.thumbKeyFor(oldBucket)))

    // The thumbnail of an image that may be in the dead bucket: 503 - not "no such image", not a
    // redirect to the image, and nothing that is kept.
    const unknown = `/files/${storage.thumbKeyFor(key())}`
    const thumb = await get(unknown)
    assert.deepEqual([thumb.status, thumb.headers.get('cache-control'), thumb.headers.get('location')], [503, 'no-store', null])
    assert.equal((await thumb.json()).code, 'storage.unreachable')

    // The same addresses once the bucket is no longer in the set: plain 404.
    storage.configure({ active, readable: [] })
    assert.equal((await get(unknown)).status, 404, 'the 503 was not remembered')
    assert.equal((await get(`/files/${key()}`)).status, 404)
    assert.equal((await get(`/files/${key()}`)).headers.get('cache-control'), null, 'a 404 carries no caching headers')
  })

  // An image whose thumbnail cannot be stored next to it still shows: the image itself, not cached.
  const readOnly = key()
  await facade.put(readOnly, await picture('#ccddee'))
  const realPut = facade.active.put
  facade.active.put = async () => { throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }) }
  try {
    const lines = await capturingLog(async () => {
      const res = await get(`/files/${storage.thumbKeyFor(readOnly)}`)
      assert.deepEqual([res.status, res.headers.get('location'), res.headers.get('cache-control')], [302, `/files/${readOnly}`, 'no-store'])
    })
    assert.match(lines.join('\n'), /could not store a file on 127\.0\.0\.1:\d+\/now: AccessDenied, HTTP 403/)
  } finally {
    facade.active.put = realPut
  }
  assert.equal((await get(`/files/${storage.thumbKeyFor(readOnly)}`)).status, 200, 'and the next request makes it')
})

test('the bucket in use going down: files on the disk still load, an upload fails with a clear 503, it recovers by itself', async (t) => {
  const service = await startFakeS3()
  const app = await filesApp()
  t.after(() => { service.close(); app.close(); storage.resetStorage() })
  const facade = storage.getStorage()
  storage.resetStorage()
  storage.configure({ active: null, readable: [] })
  const onDisk = key()
  await facade.put(onDisk, Buffer.from('on the disk'))
  storage.configure({ active: parseS3Config(service.bucket('now')), readable: [] })
  const inBucket = key()
  await facade.put(inBucket, Buffer.from('in the bucket'))

  service.down = true
  const lines = await capturingLog(async () => {
    assert.equal(String(await facade.getBuffer(onDisk)), 'on the disk')
    await assert.rejects(() => facade.put(key(), Buffer.from('new')), unavailable('storage.write_failed'))
    // The file that is known to be in the bucket: unavailable, not gone.
    assert.equal((await fetch(`${app.url}/files/${inBucket}`)).status, 503)
    assert.equal((await fetch(`${app.url}/files/${onDisk}`)).status, 200)
    assert.equal(facade.buckets()[0].state, 'unreachable')
    // An upload is always tried, and the first one that works shows the bucket is back.
    service.down = false
    const saved = await facade.put(key(), Buffer.from('new'))
    assert.equal(facade.buckets()[0].state, 'ok')
    assert.equal((await fetch(`${app.url}/files/${inBucket}`)).status, 200)
    assert.equal((await fetch(app.url + saved.url)).status, 200)
  })
  assert.equal(lines.filter((l) => /cannot be reached/.test(l)).length, 1)
  assert.equal(lines.filter((l) => /can be reached again/.test(l)).length, 1)
})

test('a source stream that breaks off fails the upload as itself, and says nothing about the bucket', async (t) => {
  const service = await startFakeS3()
  t.after(() => { service.close(); storage.resetStorage() })
  const { Readable } = require('stream')
  storage.resetStorage()
  storage.configure({ active: parseS3Config(service.bucket('now')), readable: [] })
  const facade = storage.getStorage()
  const cut = Object.assign(new Error('download cut off'), { name: 'SafeFetchError', code: 'ECONNRESET' })
  const lines = await capturingLog(async () => {
    await assert.rejects(() => facade.put(key('outputs').replace('.png', '.mp4'), Readable.from((async function * () {
      yield Buffer.alloc(1024)
      throw cut
    })())), (err) => err === cut)
  })
  assert.deepEqual(lines, [])
  assert.equal(facade.buckets()[0].state, 'ok')
})

test('the connection test does not wait for a service that never answers', async (t) => {
  const hole = await startBlackHole()
  t.after(() => hole.close())
  const cfg = parseS3Config({ preset: 'custom', endpoint: hole.endpoint, bucket: 'canvas', accessKeyId: 'AKID', secretAccessKey: 'secret-secret', forcePathStyle: true })
  const [result, ms] = await timed(() => probe(cfg, { requestTimeout: 800 }))
  assert.ok(ms < 4000, `${ms} ms`)
  assert.deepEqual([result.ok, result.error.code], [false, 'storage.err_unreachable'])
  assert.deepEqual(result.steps.map((s) => `${s.step}:${s.status}`), ['put:failed', 'head:skipped', 'get:skipped', 'delete:skipped'])
})

test('removing the files of an account does not wait for a bucket that is down, and what is left is removed later', async (t) => {
  const service = await startFakeS3()
  const second = await startFakeS3()
  const hole = await startBlackHole()
  const db = fakeSettings()
  t.after(() => { service.close(); second.close(); hole.close(); db.restore(); storage.resetStorage() })
  const active = parseS3Config(service.bucket('now'))
  const flaky = parseS3Config(second.bucket('flaky'))
  const silent = parseS3Config({ ...service.bucket('silent'), endpoint: hole.endpoint })
  const facade = storage.getStorage()
  const journal = () => (db.rows.get('storageCleanup') || { owners: [] }).owners

  // Files of the account on the disk, in the bucket in use and in an earlier bucket; another account's next to them.
  storage.resetStorage()
  storage.configure({ active: null, readable: [] })
  const mine = { disk: key('uploads', OWNER), diskThumb: null, bucket: key('outputs', OWNER), flaky: key('tools', OWNER) }
  mine.diskThumb = storage.thumbKeyFor(mine.disk)
  const theirs = { disk: key('uploads', OTHER), bucket: key('outputs', OTHER), flaky: key('uploads', OTHER) }
  for (const k of [mine.disk, mine.diskThumb, theirs.disk]) await facade.put(k, Buffer.from('x'))
  storage.configure({ active: flaky, readable: [] })
  for (const k of [mine.flaky, theirs.flaky]) await facade.put(k, Buffer.from('x'))
  storage.configure({ active, readable: [flaky, silent] })
  for (const k of [mine.bucket, theirs.bucket]) await facade.put(k, Buffer.from('x'))

  second.down = true
  const lines = await capturingLog(async () => {
    // One bucket drops every connection, another never answers. The deletion comes back anyway.
    const [out, ms] = await timed(() => storageCleanup.removeOwnerFiles(OWNER, { waitMs: 1200, timeoutMs: 2500 }))
    assert.ok(ms < 2400, `${ms} ms`)
    assert.equal(out.removed, 3, 'what could be removed is gone: two on the disk, one in the bucket in use')
    assert.match(out.error, /left in 127\.0\.0\.1:\d+\/flaky \(ECONNRESET\), tried again in the background/)
    assert.match(out.error, /still being removed from 127\.0\.0\.1:\d+\/silent/)
    assert.ok(!fs.existsSync(path.join(tmpDir, mine.disk)) && !fs.existsSync(path.join(tmpDir, mine.diskThumb)))
    assert.ok(!service.objects('now').has(mine.bucket))
    assert.ok(second.objects('flaky').has(mine.flaky), 'still in the bucket that was down')
    // Nobody else's files were touched.
    assert.ok(fs.existsSync(path.join(tmpDir, theirs.disk)) && service.objects('now').has(theirs.bucket) && second.objects('flaky').has(theirs.flaky))
    // What is owed is written down, so that it survives a restart.
    assert.equal(await storageCleanup.owed(), 1)
    assert.deepEqual([journal()[0].owner, journal()[0].backends.sort()], [OWNER, [backendId(flaky), backendId(silent)].sort()])

    // A retry that comes while the first attempt is still waiting for the silent bucket does not start a second one.
    let [again, quick] = await timed(() => storageCleanup.retry())
    assert.deepEqual([again.owners, again.removed, again.left], [1, 0, 1])
    assert.ok(quick < 500, `${quick} ms`)
    assert.equal(hole.connections, 1)
    // The first attempt gives up on the silent bucket; from then on both are known to be down,
    // and trying again costs nothing and changes nothing.
    await storageCleanup.idle()
    ;[again, quick] = await timed(() => storageCleanup.retry())
    assert.deepEqual([again.owners, again.removed, again.left], [1, 0, 1])
    assert.ok(quick < 500, `${quick} ms`)
    assert.equal(hole.connections, 1)
    assert.deepEqual(journal()[0].backends.sort(), [backendId(flaky), backendId(silent)].sort())
  })
  assert.equal(lines.filter((l) => /flaky cannot be reached/.test(l)).length, 1)
  assert.equal(lines.filter((l) => /silent cannot be reached/.test(l)).length, 1)
  assert.equal(lines.filter((l) => new RegExp(`files of ${OWNER} are left in`).test(l)).length, 1)

  // Saving something else does not send requests back to buckets that are known to be down.
  storage.configure({ active, readable: [flaky, silent] })
  assert.deepEqual(facade.buckets().map((b) => b.state), ['ok', 'unreachable', 'unreachable'])
  // The bucket is back (as after a restart, or half a minute later), and the one that never
  // answered is no longer configured: the debt is paid.
  second.down = false
  storage.resetStorage()
  storage.configure({ active, readable: [flaky] })
  await capturingLog(async () => {
    const paid = await storageCleanup.retry()
    assert.deepEqual([paid.owners, paid.removed, paid.left], [1, 1, 0])
  })
  assert.ok(!second.objects('flaky').has(mine.flaky))
  assert.ok(second.objects('flaky').has(theirs.flaky))
  assert.equal(await storageCleanup.owed(), 0)

  // Nothing wrong anywhere: everything goes at once and nothing stays in the journal.
  await facade.put(key('uploads', OWNER), Buffer.from('x'))
  const clean = await storageCleanup.removeOwnerFiles(OWNER)
  assert.deepEqual(clean, { removed: 1, error: '' })
  assert.equal(await storageCleanup.owed(), 0)

  // A bucket that stays down for a month is given up on, with a line that says what to do.
  second.down = true
  assert.equal(facade.buckets()[1].state, 'ok', 'not known to be down yet')
  await facade.put(key('uploads', OWNER), Buffer.from('x'))
  const given = await capturingLog(async () => {
    const out = await storageCleanup.removeOwnerFiles(OWNER, { waitMs: 1200 })
    assert.deepEqual([out.removed, /flaky/.test(out.error), /silent/.test(out.error)], [1, true, false])
    assert.equal(await storageCleanup.owed(), 1)
    assert.equal((await storageCleanup.retry({ now: Date.now() + 29 * 86400000 })).left, 1)
    await storageCleanup.retry({ now: Date.now() + 31 * 86400000 })
    assert.equal(await storageCleanup.owed(), 0)
  })
  assert.match(given.join('\n'), new RegExp(`giving up on the files of ${OWNER} after 30 days: still left in 127\\.0\\.0\\.1:\\d+/flaky`))
})

/* ------------------------------------- 3. a secret that cannot be decrypted */

test('SECRET_KEY changed: the bucket stays configured and unusable, says so, and nothing is written elsewhere', async (t) => {
  const service = await startFakeS3()
  const db = fakeSettings()
  const app = await filesApp()
  t.after(() => { service.close(); db.restore(); app.close(); storage.resetStorage(); storageSettings.reset() })
  const facade = storage.getStorage()
  const boot = async () => { storage.resetStorage(); storageSettings.reset(); return storageSettings.load() }
  const { secretAccessKey, ...form } = service.bucket('canvas')
  const diskFiles = () => fs.readdirSync(tmpDir, { recursive: true }).filter((f) => /\.\w+$/.test(String(f))).length

  await boot()
  const onDisk = key()
  await facade.put(onDisk, Buffer.from('on the disk'))
  // Saved through the real connection test, against the stand-in service.
  const saved = await storageSettings.save({ driver: 's3', s3: { ...form, secretAccessKey } })
  assert.deepEqual([saved.saved, saved.status.driver, saved.status.writable, saved.status.secretUnreadable], [true, 's3', true, false])
  assert.deepEqual(saved.status.buckets.map((b) => [b.bucket, b.origin, b.active, b.state, b.removable]), [['canvas', 'saved', true, 'ok', false]])
  const inBucket = key()
  await facade.put(inBucket, Buffer.from('in the bucket'))
  const before = { requests: service.requests.length, disk: diskFiles() }

  await withEnv({ SECRET_KEY: 'a-completely-different-secret-key' }, async () => {
    // The server starts.
    const status = await boot()
    assert.deepEqual([status.source, status.driver, status.secretUnreadable, status.writable], ['saved', 's3', true, false])
    assert.deepEqual(status.buckets.map((b) => [b.bucket, b.active, b.state]), [['canvas', true, 'secret_unreadable']])
    // Not "inline": that would read as a configuration to change. Nothing can be stored at all, and why is said.
    assert.deepEqual([status.s3.bucket, status.s3.hasSecret, status.upstream, status.upstreamReason], ['canvas', true, 'unavailable', 'secret_unreadable'])
    assert.equal(facade.writable, false)
    assert.ok(!JSON.stringify(status).includes(secretAccessKey))

    // New files are refused, clearly - not written to the disk in the bucket's place.
    assert.throws(() => facade.assertWritable(), unavailable('storage.secret_unreadable'))
    await assert.rejects(() => facade.put(key(), Buffer.from('new')), unavailable('storage.secret_unreadable'))
    const { ingest } = require('../src/routes/files')
    await assert.rejects(async () => ingest(await picture()), (err) => {
      assert.deepEqual([err.status, err.code, err.message], [503, 'storage.secret_unreadable', en['storage.secret_unreadable']])
      return true
    })
    assert.equal(diskFiles(), before.disk, 'nothing appeared on the disk')

    // What is in the bucket: unavailable (503), not missing. What is on the disk: served as ever.
    await assert.rejects(() => facade.getBuffer(inBucket), unavailable())
    assert.equal(String(await facade.getBuffer(onDisk)), 'on the disk')
    const res = await fetch(`${app.url}/files/${inBucket}`, { headers: { 'X-Locale': 'en' } })
    assert.deepEqual([res.status, (await res.json()).code], [503, 'storage.unreachable'])
    assert.equal((await fetch(`${app.url}/files/${onDisk}`)).status, 200)
    // No address is made with a secret that is not one.
    assert.deepEqual(await facade.externalAccess(onDisk), [])
    await assert.rejects(() => facade.externalAccess(inBucket), unavailable())
    assert.equal(await media.newFilesReachable(), false)
    assert.equal(service.requests.length, before.requests, 'nothing was sent to the service with a garbled secret')

    // The form cannot lean on the stored secret; typing it again puts everything right.
    await assert.rejects(() => storageSettings.save({ driver: 's3', s3: form }), { code: 'validation.required' })
    const fixed = await storageSettings.save({ driver: 's3', s3: { ...form, secretAccessKey } })
    assert.deepEqual([fixed.status.secretUnreadable, fixed.status.writable, fixed.status.buckets[0].state], [false, true, 'ok'])
    assert.deepEqual([fixed.status.upstream, fixed.status.upstreamReason, facade.writable], ['inline', '', true])
    assert.equal(String(await facade.getBuffer(inBucket)), 'in the bucket')
    await facade.put(key(), Buffer.from('new'))
    assert.equal(db.rows.get('storage').previous.length, 0, 'the same bucket: nothing moved to the earlier ones')
  })
})

test('SECRET_KEY changed, other set-ups: the local disk in use, the same bucket in the environment, an earlier bucket', async (t) => {
  const service = await startFakeS3()
  const db = fakeSettings()
  t.after(() => { service.close(); db.restore(); storage.resetStorage(); storageSettings.reset() })
  const facade = storage.getStorage()
  const boot = async () => { storage.resetStorage(); storageSettings.reset(); return storageSettings.load() }
  const first = service.bucket('first')
  const second = service.bucket('second')
  const OTHER_KEY = { SECRET_KEY: 'a-completely-different-secret-key' }
  const envFor = (cfg) => ({ S3_ENDPOINT: cfg.endpoint, S3_BUCKET: cfg.bucket, S3_ACCESS_KEY_ID: cfg.accessKeyId, S3_SECRET_ACCESS_KEY: cfg.secretAccessKey, S3_FORCE_PATH_STYLE: 'true' })

  await boot()
  await storageSettings.save({ driver: 's3', s3: first })
  const inFirst = key()
  await facade.put(inFirst, Buffer.from('first bucket'))
  await storageSettings.save({ driver: 's3', s3: second })
  const inSecond = key()
  await facade.put(inSecond, Buffer.from('second bucket'))

  // An earlier bucket whose secret cannot be read is not dropped silently: its files are unavailable, not missing.
  await withEnv(OTHER_KEY, async () => {
    let status = await boot()
    assert.deepEqual(status.buckets.map((b) => [b.bucket, b.active, b.state, b.removable]), [['second', true, 'secret_unreadable', false], ['first', false, 'secret_unreadable', true]])
    await assert.rejects(() => facade.getBuffer(inFirst), unavailable())

    // Back to the local disk (no secret needed for that): new files are stored again; the buckets stay unreadable.
    status = (await storageSettings.save({ driver: 'local' })).status
    assert.deepEqual([status.driver, status.writable, status.secretUnreadable], ['local', true, true])
    const onDisk = key()
    await facade.put(onDisk, Buffer.from('disk'))
    assert.ok(fs.existsSync(path.join(tmpDir, onDisk)))
    await assert.rejects(() => facade.getBuffer(inSecond), unavailable())
    await assert.rejects(() => facade.locate(key()), unavailable(), 'a file found nowhere may be in one of them')

    // A bucket nobody has the secret for any more can be taken off the list; then missing is missing again.
    await assert.rejects(() => storageSettings.forget('s3-000000000000'), { status: 404, code: 'storage.bucket_not_found' })
    status = await storageSettings.forget(status.buckets.find((b) => b.bucket === 'first').id)
    assert.deepEqual(status.buckets.map((b) => b.bucket), ['second'])
    status = await storageSettings.forget(status.buckets[0].id)
    assert.deepEqual([status.buckets, status.s3, status.secretUnreadable], [[], null, false])
    assert.equal(await facade.locate(key()), null)
    assert.equal(await facade.locate(inFirst), null, 'its files no longer load; nothing was deleted from the bucket')
    assert.ok(service.objects('first').has(inFirst))
  })

  // The bucket in use cannot be taken off the list, nor can the one the environment names.
  db.rows.clear()
  await boot()
  let status = (await storageSettings.save({ driver: 's3', s3: second })).status
  await assert.rejects(() => storageSettings.forget(status.buckets[0].id), { status: 400, code: 'storage.bucket_in_use' })
  await withEnv({ STORAGE_DRIVER: 'local', ...envFor(first) }, async () => {
    status = await boot()
    assert.deepEqual(status.buckets.map((b) => [b.bucket, b.origin, b.removable]), [['second', 'saved', false], ['first', 'env', false]])
    await assert.rejects(() => storageSettings.forget(status.buckets[1].id), { status: 400, code: 'storage.bucket_from_env' })
  })

  // The same bucket saved here and present in the environment: the environment's secret stands in.
  // New files keep going where they were meant to go; the page still asks for the secret.
  await withEnv({ ...OTHER_KEY, STORAGE_DRIVER: 's3', ...envFor(second) }, async () => {
    status = await boot()
    assert.deepEqual([status.driver, status.secretUnreadable, status.writable], ['s3', true, true])
    assert.deepEqual(status.buckets.map((b) => [b.bucket, b.origin, b.state]), [['second', 'saved', 'ok']])
    assert.equal(String(await facade.getBuffer(inSecond)), 'second bucket')
    const again = key()
    await facade.put(again, Buffer.from('x'))
    assert.ok(service.objects('second').has(again))
  })
  // A different bucket in the environment does not take its place: nothing is written where nobody chose.
  await withEnv({ ...OTHER_KEY, STORAGE_DRIVER: 's3', ...envFor(first) }, async () => {
    status = await boot()
    assert.deepEqual([status.driver, status.writable], ['s3', false])
    assert.deepEqual(status.buckets.map((b) => [b.bucket, b.active, b.state]), [['second', true, 'secret_unreadable'], ['first', false, 'ok']])
    const size = service.objects('first').size
    await assert.rejects(() => facade.put(key(), Buffer.from('x')), unavailable('storage.secret_unreadable'))
    assert.equal(service.objects('first').size, size)
    assert.equal(String(await facade.getBuffer(inFirst)), 'first bucket', 'but it is read')
  })
})

test('a provider key that cannot be decrypted is reported as such, never used and never a stack trace', () => {
  const registry = require('../src/providers')
  const doc = { type: 'openai', baseUrl: '', apiKeyEnc: encrypt('sk-test-key-1234567890', process.env.SECRET_KEY) }
  assert.equal(registry.keyUnreadable(doc), false)
  assert.equal(registry.configFor(doc).apiKey, 'sk-test-key-1234567890')
  assert.equal(registry.keyUnreadable({ type: 'openai', apiKeyEnc: '' }), false, 'no key is not an unreadable key')
  withEnv({ SECRET_KEY: 'a-completely-different-secret-key' }, () => {
    assert.equal(registry.keyUnreadable(doc), true)
    assert.throws(() => registry.configFor(doc), (err) => {
      assert.deepEqual([err.userFacing, err.i18n.code, err.message], [true, 'provider.key_undecryptable', en['provider.key_undecryptable']])
      return true
    })
  })
  assert.equal(registry.keyUnreadable({ type: 'openai', apiKeyEnc: 'not-a-ciphertext' }), true)
})

/* --------------------------- 4. the environment's bucket, whatever the driver */

test('the bucket of the S3_* variables is read whatever STORAGE_DRIVER says', async (t) => {
  const service = await startFakeS3()
  const db = fakeSettings()
  t.after(() => { service.close(); db.restore(); storage.resetStorage(); storageSettings.reset() })
  const facade = storage.getStorage()
  const boot = async () => { storage.resetStorage(); storageSettings.reset(); return storageSettings.load() }
  const cfg = service.bucket('from-env')
  const S3_ENV = { S3_ENDPOINT: cfg.endpoint, S3_BUCKET: cfg.bucket, S3_ACCESS_KEY_ID: cfg.accessKeyId, S3_SECRET_ACCESS_KEY: cfg.secretAccessKey, S3_FORCE_PATH_STYLE: 'true' }
  const heads = () => service.requests.filter((r) => r.startsWith('HEAD ')).length

  // The install as it was: files went to the bucket.
  const inBucket = key()
  await withEnv({ STORAGE_DRIVER: 's3', ...S3_ENV }, async () => {
    const status = await boot()
    assert.deepEqual([status.source, status.driver], ['env', 's3'])
    await facade.put(inBucket, Buffer.from('written while the bucket was in use'))
  })

  // The driver set to local, or not set at all: the bucket's files still load; new files go to the disk.
  for (const driver of ['local', undefined]) {
    await withEnv({ STORAGE_DRIVER: driver, ...S3_ENV }, async () => {
      assert.equal(getConfig().storage.driver, 'local')
      assert.equal(getConfig().storage.s3.bucket, 'from-env')
      const status = await boot()
      assert.deepEqual([status.source, status.driver, status.writable], ['default', 'local', true])
      assert.deepEqual(status.buckets.map((b) => [b.bucket, b.origin, b.active, b.state]), [['from-env', 'env', false, 'ok']])
      assert.equal(status.s3.bucket, 'from-env', 'and the form starts from it')
      assert.equal(String(await facade.getBuffer(inBucket)), 'written while the bucket was in use')
      const fresh = key()
      await facade.put(fresh, Buffer.from('x'))
      assert.ok(fs.existsSync(path.join(tmpDir, fresh)) && !service.objects('from-env').has(fresh))
    })
  }

  // "Local disk" chosen on the settings page: the same.
  await withEnv({ STORAGE_DRIVER: 's3', ...S3_ENV }, async () => {
    await boot()
    const status = (await storageSettings.save({ driver: 'local' })).status
    assert.deepEqual([status.source, status.driver], ['saved', 'local'])
    assert.deepEqual(status.buckets.map((b) => [b.bucket, b.origin]), [['from-env', 'env']])
    assert.equal(String(await facade.getBuffer(inBucket)), 'written while the bucket was in use')
  })

  // The same bucket saved on the settings page as well: one bucket, asked once per lookup.
  db.rows.clear()
  await withEnv({ STORAGE_DRIVER: 'local', ...S3_ENV }, async () => {
    await boot()
    await storageSettings.save({ driver: 's3', s3: cfg })
    let status = (await storageSettings.save({ driver: 'local' })).status
    assert.deepEqual(status.buckets.map((b) => [b.bucket, b.origin]), [['from-env', 'saved']])
    assert.equal(facade.buckets().length, 1)
    const asked = heads()
    assert.equal(await facade.locate(key()), null)
    assert.equal(heads() - asked, 1, 'one request, not one per place the bucket is named')
    // In use and in the environment: still one.
    status = (await storageSettings.save({ driver: 's3', s3: cfg })).status
    assert.deepEqual([facade.buckets().length, status.buckets.length, status.buckets[0].active], [1, 1, true])
  })

  // Variables that do not describe a bucket: incomplete ones are no bucket; invalid ones are said, and do not stop a
  // server that is not writing there. (With STORAGE_DRIVER=s3 they do stop it: see storage.test.js.)
  db.rows.clear()
  await withEnv({ STORAGE_DRIVER: 'local', S3_BUCKET: 'only-a-bucket' }, async () => {
    assert.deepEqual([getConfig().storage.s3, getConfig().storage.s3Problem], [null, ''])
    assert.deepEqual((await boot()).buckets, [])
  })
  await withEnv({ STORAGE_DRIVER: 'local', ...S3_ENV, S3_BUCKET: 'Not_A_Bucket_Name' }, async () => {
    assert.equal(getConfig().storage.s3, null)
    assert.match(getConfig().storage.s3Problem, /S3_\* storage settings are not valid/)
    const lines = await capturingLog(async () => { assert.deepEqual((await boot()).buckets, []) })
    assert.match(lines.join('\n'), /S3_\* variables are set but not used/)
  })
})

/* ------------------------------------- 6. what the settings page is told */

test('a refusal about a field of the storage form says which field, in the reader\'s words', () => {
  const { render } = require('../src/i18n')
  const base = { bucket: 'canvas', accessKeyId: 'AKID', endpoint: 'http://minio:9000' }
  const refusal = (over) => { try { parseS3Config({ ...base, ...over }) } catch (err) { return err } return null }
  const cases = [
    [{ endpoint: 'https://minio.internal/canvas' }, 'storage.endpoint_has_path', 'endpoint'],
    [{ presignEndpoint: 'https://s3.example.com/canvas' }, 'storage.endpoint_has_path', 'presignEndpoint'],
    [{ endpoint: 'https://canvas.oss-cn-hangzhou.aliyuncs.com' }, 'storage.endpoint_has_bucket', 'endpoint'],
    [{ presignEndpoint: 'https://canvas.s3.example.com' }, 'storage.endpoint_has_bucket', 'presignEndpoint'],
    [{ endpoint: 'ftp://minio.internal' }, 'validation.bad_url', 'endpoint'],
    [{ publicBaseUrl: 'cdn.example.com' }, 'validation.bad_url', 'publicBaseUrl'],
    [{ presignEndpoint: 'https://user:pw@s3.example.com' }, 'validation.bad_url', 'presignEndpoint'],
    [{ bucket: '' }, 'validation.required', 'bucket'],
    [{ bucket: 'Has_Upper' }, 'storage.bad_bucket', 'bucket'],
    [{ region: 'not a region' }, 'validation.bad_format', 'region'],
    [{ keyPrefix: '../etc' }, 'storage.bad_key_prefix', 'keyPrefix'],
    [{ delivery: 'redirect' }, 'storage.redirect_needs_public_url', 'publicBaseUrl'],
  ]
  for (const [over, code, field] of cases) {
    const err = refusal(over)
    assert.deepEqual([err.status, err.code, err.data], [400, code, { field }], JSON.stringify(over))
    for (const [locale, catalog] of [['en', en], ['zh-CN', zh]]) {
      const text = render(locale, err.i18n)
      // The field is named as the page names it, never by its key in the API.
      assert.ok(!/\b(endpoint|presignEndpoint|publicBaseUrl|keyPrefix|accessKeyId)\b/.test(text.replace(catalog[`storage.field.${field}`], '')), `${locale}: ${text}`)
      if (/\{field\}/.test(catalog[code])) assert.ok(text.includes(catalog[`storage.field.${field}`]), `${locale}: ${text}`)
    }
  }
  // The two endpoints share a rule; the sentence tells them apart.
  assert.match(refusal({ presignEndpoint: 'https://s3.example.com/x' }).message, /^The endpoint for signed URLs must be just the service address/)
  assert.match(refusal({ endpoint: 'https://s3.example.com/x' }).message, /^The endpoint must be just the service address/)
  assert.equal(render('zh-CN', refusal({ presignEndpoint: 'ftp://x' }).i18n), `${zh['storage.field.presignEndpoint']} 不是有效的地址`)
})

test('a secret that cannot be read does not turn "how files reach an upstream" into a configuration problem', async (t) => {
  const service = await startFakeS3()
  const db = fakeSettings()
  t.after(() => { service.close(); db.restore(); storage.resetStorage(); storageSettings.reset() })
  const boot = async () => { storage.resetStorage(); storageSettings.reset(); return storageSettings.load() }
  await boot()
  // A bucket with an internal endpoint and the name it has from outside: signed addresses are what an upstream gets.
  const saved = await storageSettings.save({ driver: 's3', s3: { ...service.bucket('canvas'), presignEndpoint: 'https://s3.example.com' } })
  assert.deepEqual([saved.status.upstream, saved.status.upstreamReason, saved.status.writable], ['signed', '', true])
  assert.equal(await media.newFilesReachable(), true)
  const asked = service.requests.length

  await withEnv({ SECRET_KEY: 'a-completely-different-secret-key' }, async () => {
    const status = await boot()
    // The page is told what is wrong (storage, not addresses)...
    assert.deepEqual([status.writable, status.upstream, status.upstreamReason], [false, 'unavailable', 'secret_unreadable'])
    // ...and what the canvas goes by still describes the configuration: this instance can hand files over by URL.
    assert.equal(await media.newFilesReachable(), true)
    assert.equal(media.newFilesHandover(), 'signed')
    // Describing is all: nothing is signed with a secret that is not one, for a new file or an existing one.
    const way = storage.getStorage().newFileAccess().find((w) => w.via === 'signed')
    await assert.rejects(async () => way.sign(), unavailable('storage.secret_unreadable'))
    assert.equal(service.requests.length, asked, 'the service was not contacted')
  })
})

test('probe: the state of every bucket is found out on request, within a bound, and a bucket heard of a moment ago is left alone', async (t) => {
  const service = await startFakeS3()
  const other = await startFakeS3()
  const hole = await startBlackHole()
  const dead = await refusedPort()
  t.after(() => { service.close(); other.close(); hole.close(); storage.resetStorage() })
  const facade = storage.getStorage()
  const active = parseS3Config(service.bucket('now'))
  const earlier = parseS3Config(other.bucket('earlier'))
  const refusing = parseS3Config({ ...service.bucket('refusing'), endpoint: `http://127.0.0.1:${dead}` })
  const silent = parseS3Config({ ...service.bucket('silent'), endpoint: hole.endpoint })
  const states = () => Object.fromEntries(facade.buckets().map((b) => [[active, earlier, refusing, silent].find((c) => backendId(c) === b.id).bucket, b.state]))
  const heads = (svc) => svc.requests.filter((r) => r.startsWith('HEAD')).length
  storage.resetStorage()
  storage.configure({ active, readable: [earlier, refusing, silent] })

  // Nothing has been asked yet: every bucket is "not known to be down".
  assert.deepEqual(states(), { now: 'ok', earlier: 'ok', refusing: 'ok', silent: 'ok' })

  const lines = await capturingLog(async () => {
    // One probe: all four are asked at once. The one that never answers does not hold the caller past the deadline.
    const [, ms] = await timed(() => facade.probe())
    assert.ok(ms <= storage.PROBE_DEADLINE_MS + 400, `${ms} ms`)
    assert.deepEqual(states(), { now: 'ok', earlier: 'ok', refusing: 'unreachable', silent: 'unreachable' })
    assert.deepEqual([heads(service), heads(other), hole.connections], [1, 1, 1])
    assert.ok(facade.buckets().find((b) => b.state === 'unreachable').since instanceof Date)

    // Asked again at once: everything was heard of a moment ago, nothing goes out, and it answers immediately.
    const [, again] = await timed(() => facade.probe())
    assert.ok(again < 200, `${again} ms`)
    assert.deepEqual([heads(service), heads(other), hole.connections], [1, 1, 1])

    // A bucket that was fine goes away: the next probe (not a file request) finds out.
    other.down = true
    await facade.probe({ maxAgeMs: 0, deadlineMs: 800 })
    assert.equal(states().earlier, 'unreachable')
    // While it is remembered as down no file request goes to it - but a probe does, which is how it is seen to be back.
    const asked = heads(other)
    await assert.rejects(() => facade.getBuffer(key()), unavailable())
    assert.equal(heads(other), asked)
    other.down = false
    await facade.probe({ maxAgeMs: 0, deadlineMs: 800 })
    assert.equal(states().earlier, 'ok')
    assert.ok(heads(other) > asked)

    // A deadline shorter than the slow bucket: the caller is let go at the deadline, the rest is already known.
    const [, short] = await timed(() => facade.probe({ maxAgeMs: 0, deadlineMs: 300 }))
    assert.ok(short < 900, `${short} ms`)
    assert.deepEqual(states(), { now: 'ok', earlier: 'ok', refusing: 'unreachable', silent: 'unreachable' })
  })
  // Said once per bucket when it goes down and once when it is back, not once per probe.
  assert.equal(lines.filter((l) => /refusing cannot be reached/.test(l)).length, 1)
  assert.equal(lines.filter((l) => /earlier cannot be reached/.test(l)).length, 1)
  assert.equal(lines.filter((l) => /earlier can be reached again/.test(l)).length, 1)

  // A bucket whose secret cannot be read is not probed: there is nothing to ask it with.
  storage.resetStorage()
  storage.configure({ active: { ...active, secretAccessKey: undefined, secretUnreadable: true }, readable: [earlier] })
  const before = heads(service)
  await facade.probe()
  assert.equal(heads(service), before)
  assert.deepEqual(facade.buckets().map((b) => b.state), ['secret_unreadable', 'ok'])
})
