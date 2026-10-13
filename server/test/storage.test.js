'use strict'

/**
 * Storage without a network: configuration rules, where a setting comes from,
 * what happens to the secret, how keys map to addresses, how a key's backend
 * is found, and the bits of other modules that follow the storage settings.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomcanvas-storage-'))
process.env.SECRET_KEY = 'storage-test-secret-key-0123456789'
process.env.STORAGE_LOCAL_DIR = tmpDir
process.env.PUBLIC_URL = ''
for (const name of Object.keys(process.env)) if (/^(S3_|STORAGE_DRIVER$)/.test(name)) delete process.env[name]

const { resetConfig, getConfig, ConfigError } = require('../src/config')
const storage = require('../src/storage')
const { parseS3Config, backendId } = require('../src/storage/schema')
const s3 = require('../src/storage/s3')
const { classify } = require('../src/storage/probe')
const { decrypt } = require('../src/utils/crypto')
const { buildContentSecurityPolicy } = require('../src/middleware/security')
const { storedError, scrubSigned, msg } = require('../src/i18n')
const en = require('../src/i18n/en')
const Setting = require('../src/models/Setting')
const storageSettings = require('../src/services/storageSettings')

test.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

const MINIO = { preset: 'minio', endpoint: 'http://minio.internal:9000', region: 'us-east-1', bucket: 'canvas', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', forcePathStyle: true }
const KEY = 'outputs/2025/01/0123456789abcdef0123456789abcdef.png'
const code = (fn) => { try { fn(); return null } catch (err) { return err.code } }

/** Run fn with these environment variables; fn may be async. */
function withEnv(vars, fn) {
  const before = {}
  for (const [k, v] of Object.entries(vars)) { before[k] = process.env[k]; process.env[k] = v }
  resetConfig()
  const restore = () => {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    resetConfig()
  }
  let out
  try { out = fn() } catch (err) { restore(); throw err }
  if (out && typeof out.then === 'function') return out.finally(restore)
  restore()
  return out
}

/** The settings collection, in memory. */
function fakeSettings() {
  const rows = new Map()
  const original = { findOne: Setting.findOne, updateOne: Setting.updateOne }
  Setting.findOne = ({ key }) => ({ lean: async () => (rows.has(key) ? { key, value: structuredClone(rows.get(key)) } : null) })
  Setting.updateOne = async ({ key }, update) => { rows.set(key, structuredClone(update.$set.value)) }
  return { rows, restore: () => Object.assign(Setting, original) }
}

/** Backends that keep objects in a Map instead of talking to a service. */
function fakeS3() {
  const original = s3.createS3Backend
  const buckets = new Map()
  const calls = []
  s3.createS3Backend = (cfg) => {
    const real = original(cfg) // address mapping and identity stay the real ones
    const id = real.id
    if (!buckets.has(id)) buckets.set(id, new Map())
    const objects = buckets.get(id)
    return {
      ...real,
      bucket: cfg.bucket,
      async put(key, body) { calls.push(`put ${cfg.bucket}`); objects.set(key, body); return { key, size: body.length } },
      async head(key) {
        calls.push(`head ${cfg.bucket}`)
        if (cfg.bucket === 'down') throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
        return objects.has(key) ? { size: objects.get(key).length } : null
      },
      async getBuffer(key) { return objects.get(key) },
      async delete(key) { objects.delete(key) },
    }
  }
  return { buckets, calls, restore: () => { s3.createS3Backend = original } }
}

test('S3 configuration: what is accepted, what is normalised, what is refused', () => {
  const cfg = parseS3Config({ ...MINIO, endpoint: ' http://minio.internal:9000/ ', keyPrefix: '/loom/canvas/', publicBaseUrl: 'https://cdn.example.com/media/' })
  assert.equal(cfg.endpoint, 'http://minio.internal:9000')
  assert.equal(cfg.keyPrefix, 'loom/canvas/')
  assert.equal(cfg.publicBaseUrl, 'https://cdn.example.com/media')
  assert.equal(cfg.delivery, 'redirect', 'a public address means files are delivered from it unless told otherwise')
  assert.equal(cfg.acl, '', 'no ACL header unless asked for')

  const bare = parseS3Config({ bucket: 'canvas', accessKeyId: 'AKID' })
  assert.deepEqual([bare.preset, bare.endpoint, bare.region, bare.forcePathStyle, bare.delivery, bare.keyPrefix], ['custom', '', 'us-east-1', false, 'proxy', ''])
  assert.equal(parseS3Config({ ...MINIO, publicBaseUrl: 'https://cdn.example.com', delivery: 'proxy' }).delivery, 'proxy')
  assert.equal(parseS3Config({ ...MINIO, region: 'AUTO' }).region, 'auto')

  const refused = (over) => code(() => parseS3Config({ ...MINIO, ...over }))
  assert.equal(refused({ bucket: '' }), 'validation.required')
  assert.equal(refused({ bucket: 'Has_Upper' }), 'storage.bad_bucket')
  assert.equal(refused({ accessKeyId: '' }), 'validation.required')
  assert.equal(refused({ endpoint: 'ftp://minio.internal' }), 'validation.bad_url')
  assert.equal(refused({ endpoint: 'https://user:pw@minio.internal' }), 'validation.bad_url')
  assert.equal(refused({ endpoint: 'https://minio.internal/canvas' }), 'storage.endpoint_has_path')
  assert.equal(refused({ endpoint: 'https://canvas.oss-cn-hangzhou.aliyuncs.com' }), 'storage.endpoint_has_bucket')
  assert.equal(refused({ keyPrefix: '../etc' }), 'storage.bad_key_prefix')
  assert.equal(refused({ keyPrefix: 'a//b' }), 'storage.bad_key_prefix')
  assert.equal(refused({ delivery: 'redirect' }), 'storage.redirect_needs_public_url')
  assert.equal(refused({ delivery: 'cdn' }), 'validation.one_of')
  assert.equal(refused({ acl: 'public-read-write' }), 'validation.one_of')
  assert.equal(refused({ preset: 'gcs' }), 'validation.one_of')
  assert.equal(refused({ forcePathStyle: 'yes' }), 'validation.boolean')
  assert.equal(refused({ secretAccessKey: 'line\nbreak' }), 'validation.bad_format')

  // Same place = same identity, whatever the credentials and the addressing style.
  assert.equal(backendId(cfg), backendId({ ...cfg, accessKeyId: 'other', forcePathStyle: false, region: 'eu-west-1' }))
  assert.notEqual(backendId(cfg), backendId({ ...cfg, bucket: 'other' }))
  assert.notEqual(backendId(cfg), backendId({ ...cfg, keyPrefix: '' }))
})

test('environment: S3_* is validated at startup, and the removed oss driver says what to do instead', () => {
  assert.deepEqual(withEnv({}, () => [getConfig().storage.driver, getConfig().storage.s3]), ['local', null])
  const env = { STORAGE_DRIVER: 's3', S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_REGION: 'auto', S3_BUCKET: 'canvas', S3_ACCESS_KEY_ID: 'AKID', S3_SECRET_ACCESS_KEY: 'secret-secret', S3_PUBLIC_BASE_URL: 'https://pub.example.com/' }
  const cfg = withEnv(env, () => getConfig().storage.s3)
  assert.deepEqual([cfg.region, cfg.forcePathStyle, cfg.publicBaseUrl, cfg.delivery, cfg.acl], ['auto', false, 'https://pub.example.com', 'redirect', ''])
  assert.equal(withEnv({ ...env, S3_PUBLIC_BASE_URL: '' }, () => getConfig().storage.s3.delivery), 'proxy', 'a private bucket needs no public address any more')
  assert.equal(withEnv({ ...env, S3_DELIVERY: 'proxy', S3_KEY_PREFIX: 'loom', S3_FORCE_PATH_STYLE: 'true' }, () => {
    const s = getConfig().storage.s3
    return [s.delivery, s.keyPrefix, s.forcePathStyle].join()
  }), 'proxy,loom/,true')

  assert.throws(() => withEnv({ ...env, S3_SECRET_ACCESS_KEY: '' }, getConfig), (err) => err instanceof ConfigError && /S3_SECRET_ACCESS_KEY/.test(err.message))
  assert.throws(() => withEnv({ ...env, S3_ENDPOINT: 'https://canvas.oss-cn-hangzhou.aliyuncs.com' }, getConfig), ConfigError)
  assert.throws(() => withEnv({ STORAGE_DRIVER: 'oss' }, getConfig), (err) => {
    assert.ok(err instanceof ConfigError)
    assert.ok(err.message.includes(en['storage.oss_driver_removed']) && /STORAGE_DRIVER=s3/.test(err.message))
    return true
  })
  assert.throws(() => withEnv({ STORAGE_DRIVER: 'gcs' }, getConfig), ConfigError)
})

test('addresses: path-style and virtual-hosted requests, the key prefix, the public domain', async () => {
  const signed = async (over) => new URL(await s3.createS3Backend(parseS3Config({ ...MINIO, ...over })).presignGet(KEY, 600))

  const pathStyle = await signed({})
  assert.deepEqual([pathStyle.host, pathStyle.pathname], ['minio.internal:9000', `/canvas/${KEY}`])
  const virtual = await signed({ forcePathStyle: false })
  assert.deepEqual([virtual.host, virtual.pathname], ['canvas.minio.internal:9000', `/${KEY}`])

  // Aliyun OSS only accepts virtual-hosted requests; R2 takes the account endpoint and region "auto".
  const oss = await signed({ preset: 'oss', endpoint: 'https://oss-cn-hangzhou.aliyuncs.com', region: 'oss-cn-hangzhou', forcePathStyle: false })
  assert.deepEqual([oss.host, oss.pathname], ['canvas.oss-cn-hangzhou.aliyuncs.com', `/${KEY}`])
  assert.match(oss.searchParams.get('X-Amz-Credential'), /\/oss-cn-hangzhou\/s3\/aws4_request$/)
  const r2 = await signed({ preset: 'r2', endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com', region: 'auto', forcePathStyle: false })
  assert.equal(r2.host, 'canvas.0123456789abcdef.r2.cloudflarestorage.com')
  assert.match(r2.searchParams.get('X-Amz-Credential'), /\/auto\/s3\/aws4_request$/)
  const aws = await signed({ preset: 'aws', endpoint: '', region: 'eu-west-1', forcePathStyle: false })
  assert.equal(aws.host, 'canvas.s3.eu-west-1.amazonaws.com')

  const prefixed = await signed({ keyPrefix: 'loom/canvas' })
  assert.equal(prefixed.pathname, `/canvas/loom/canvas/${KEY}`)
  assert.equal(prefixed.searchParams.get('X-Amz-Expires'), '600')
  assert.ok(prefixed.searchParams.get('X-Amz-Signature'))
  assert.ok(!prefixed.toString().includes(MINIO.secretAccessKey))

  const backend = s3.createS3Backend(parseS3Config({ ...MINIO, keyPrefix: 'loom', publicBaseUrl: 'https://cdn.example.com/media' }))
  assert.equal(backend.publicUrl(KEY), `https://cdn.example.com/media/loom/${KEY}`)
  assert.equal(backend.keyFromPublicUrl(`https://cdn.example.com/media/loom/${KEY}?v=1`), KEY)
  assert.equal(backend.keyFromPublicUrl(`https://cdn.example.com/media/${KEY}`), null, 'outside the prefix')
  assert.equal(backend.keyFromPublicUrl(`https://cdn.example.com.evil.test/media/loom/${KEY}`), null)
  assert.equal(backend.keyFromPublicUrl('https://cdn.example.com/media/loom/../../etc/passwd'), null)
  assert.equal(backend.publicOrigin, 'https://cdn.example.com')
  assert.deepEqual([backend.delivery, s3.createS3Backend(parseS3Config(MINIO)).delivery], ['redirect', 'proxy'])
  // Only keys of our own shape reach the service.
  await assert.rejects(() => backend.head('../outside.png'), /invalid storage key/)
  await assert.rejects(() => backend.put('uploads/../../x.png', Buffer.from('x')), /invalid storage key/)
})

test('stored files have one address, /files/<key>, on every backend; older absolute addresses still map to their key', () => {
  const fake = fakeS3()
  try {
    storage.resetStorage()
    storage.configure({ active: parseS3Config({ ...MINIO, publicBaseUrl: 'https://cdn.example.com' }), readable: [] })
    const facade = storage.getStorage()
    assert.equal(facade.driver, 's3')
    assert.equal(facade.urlFor(KEY), `/files/${KEY}`)
    assert.equal(facade.keyFromUrl(`/files/${KEY}`), KEY)
    assert.equal(facade.keyFromUrl(`/files/${KEY}?x=1#y`), KEY)
    assert.equal(facade.keyFromUrl(`https://cdn.example.com/${KEY}`), KEY, 'what an S3 install stored before files had one address')
    assert.equal(facade.keyFromUrl(`https://elsewhere.example/${KEY}`), null)
    assert.equal(facade.keyFromUrl('/files/../../etc/passwd'), null)
    assert.equal(facade.keyFromUrl('/files/uploads/%2e%2e/%2e%2e/x.png'), null)
    assert.deepEqual(facade.publicOrigins(), ['https://cdn.example.com'])
  } finally {
    fake.restore()
    storage.resetStorage()
  }
})

test('which backend holds a key: looked up disk first, then the active bucket, then earlier ones, and remembered', async () => {
  const fake = fakeS3()
  try {
    storage.resetStorage()
    const now = parseS3Config({ ...MINIO, bucket: 'now' })
    const before = parseS3Config({ ...MINIO, bucket: 'before' })
    const facade = storage.getStorage()

    // 1. On the local disk.
    storage.configure({ active: null, readable: [] })
    const local = await facade.put('uploads/2025/01/aaaa.png', Buffer.from('local file'))
    assert.equal(local.url, '/files/uploads/2025/01/aaaa.png')
    assert.ok(fs.existsSync(path.join(tmpDir, 'uploads/2025/01/aaaa.png')))

    // 2. Switch to a bucket: new files go there and not to the disk; the old one is still found.
    storage.configure({ active: before, readable: [] })
    await facade.put('uploads/2025/01/bbbb.png', Buffer.from('first bucket'))
    assert.ok(!fs.existsSync(path.join(tmpDir, 'uploads/2025/01/bbbb.png')))
    assert.equal((await facade.locate('uploads/2025/01/aaaa.png')).driver, 'local')

    // 3. Switch to another bucket, the first one stays readable.
    storage.resetStorage() // forget what was remembered: the lookup below has to find everything again
    storage.configure({ active: now, readable: [before] })
    await facade.put('uploads/2025/01/cccc.png', Buffer.from('second bucket'))
    assert.equal((await facade.locate('uploads/2025/01/aaaa.png')).driver, 'local')
    assert.equal((await facade.locate('uploads/2025/01/bbbb.png')).bucket, 'before')
    assert.equal((await facade.locate('uploads/2025/01/cccc.png')).bucket, 'now')
    assert.equal((await facade.getBuffer('uploads/2025/01/bbbb.png')).toString(), 'first bucket')
    assert.equal(await facade.size('uploads/2025/01/aaaa.png'), 10)
    assert.equal(await facade.locate('uploads/2025/01/dddd.png'), null)
    assert.equal(await facade.exists('uploads/2025/01/dddd.png'), false)
    await assert.rejects(() => facade.getBuffer('uploads/2025/01/dddd.png'), { code: 'ENOENT' })
    assert.equal(await facade.locate('../../etc/passwd'), null)

    // Remembered: asking again costs no request.
    fake.calls.length = 0
    await facade.locate('uploads/2025/01/bbbb.png')
    await facade.getBuffer('uploads/2025/01/cccc.png')
    assert.deepEqual(fake.calls, [])

    // A thumbnail is written next to its image, not to whatever is active now.
    await facade.put('thumbs/of/uploads/2025/01/bbbb_png.webp', Buffer.from('t'), { sameBackendAs: 'uploads/2025/01/bbbb.png' })
    assert.ok(fake.buckets.get(backendId(before)).has('thumbs/of/uploads/2025/01/bbbb_png.webp'))
    await facade.put('thumbs/of/uploads/2025/01/aaaa_png.webp', Buffer.from('t'), { sameBackendAs: 'uploads/2025/01/aaaa.png' })
    assert.ok(fs.existsSync(path.join(tmpDir, 'thumbs/of/uploads/2025/01/aaaa_png.webp')))

    // 4. Back to the disk: files of both buckets still load, new ones land on the disk.
    storage.configure({ active: null, readable: [now, before] })
    assert.equal(facade.driver, 'local')
    assert.equal((await facade.getBuffer('uploads/2025/01/cccc.png')).toString(), 'second bucket')
    await facade.put('uploads/2025/01/eeee.png', Buffer.from('disk again'))
    assert.ok(fs.existsSync(path.join(tmpDir, 'uploads/2025/01/eeee.png')))

    // Deleting removes the file where it is.
    await facade.delete('uploads/2025/01/bbbb.png')
    assert.ok(!fake.buckets.get(backendId(before)).has('uploads/2025/01/bbbb.png'))
    assert.equal(await facade.exists('uploads/2025/01/bbbb.png'), false)
    await facade.delete('uploads/2025/01/aaaa.png')
    assert.ok(!fs.existsSync(path.join(tmpDir, 'uploads/2025/01/aaaa.png')))
    await facade.delete('uploads/2025/01/never.png')

    // A bucket that cannot be asked does not hide a file another backend has,
    // and "could not check" is an error (503), not "no such file". More in storageResilience.test.js.
    storage.resetStorage()
    storage.configure({ active: parseS3Config({ ...MINIO, bucket: 'down' }), readable: [now] })
    const warn = console.warn
    console.warn = () => {} // the line that says the bucket is down
    try {
      assert.equal((await facade.locate('uploads/2025/01/cccc.png')).bucket, 'now')
      assert.equal((await facade.locate('uploads/2025/01/eeee.png')).driver, 'local')
      await assert.rejects(() => facade.locate('uploads/2025/01/dddd.png'), { name: 'StorageUnavailable', status: 503, code: 'storage.unreachable' })
      assert.equal(await facade.locate('uploads/2025/01/dddd.png', { tolerant: true }), null)
    } finally {
      console.warn = warn
    }
  } finally {
    fake.restore()
    storage.resetStorage()
  }
})

test('an upload under way keeps the backend it started with when storage is switched', async () => {
  const fake = fakeS3()
  try {
    storage.resetStorage()
    const bucket = parseS3Config({ ...MINIO, bucket: 'inflight' })
    storage.configure({ active: bucket, readable: [] })
    const facade = storage.getStorage()
    const active = facade.active
    let release
    const realPut = active.put
    active.put = async (...args) => { await new Promise((resolve) => { release = resolve }); return realPut(...args) }
    const pending = facade.put('outputs/2025/01/slow.mp4', Buffer.from('video'))
    await new Promise((resolve) => setImmediate(resolve))
    storage.configure({ active: null, readable: [bucket] })
    release()
    await pending
    assert.ok(fake.buckets.get(backendId(bucket)).has('outputs/2025/01/slow.mp4'))
    assert.ok(!fs.existsSync(path.join(tmpDir, 'outputs/2025/01/slow.mp4')))
    assert.equal((await facade.getBuffer('outputs/2025/01/slow.mp4')).toString(), 'video')
  } finally {
    fake.restore()
    storage.resetStorage()
  }
})

test('precedence: saved on the settings page, else the environment, else the local disk', async () => {
  const db = fakeSettings()
  const fake = fakeS3()
  const ENV = { STORAGE_DRIVER: 's3', S3_ENDPOINT: 'http://env.internal:9000', S3_BUCKET: 'from-env', S3_ACCESS_KEY_ID: 'ENVKEY', S3_SECRET_ACCESS_KEY: 'env-secret-value-1234', S3_FORCE_PATH_STYLE: 'true' }
  const boot = async () => { storage.resetStorage(); storageSettings.reset(); return storageSettings.load() }
  try {
    // Nothing anywhere: the local disk.
    let status = await boot()
    assert.deepEqual([status.source, status.driver, status.s3, status.delivery], ['default', 'local', null, ''])

    await withEnv(ENV, async () => {
      // The environment decides until something is saved.
      status = await boot()
      assert.deepEqual([status.source, status.driver, status.s3.bucket, status.s3.endpointHost, status.delivery], ['env', 's3', 'from-env', 'env.internal:9000', 'proxy'])
      assert.deepEqual([status.s3.hasSecret, status.s3.secretTail], [true, '1234'])
      assert.ok(!JSON.stringify(status).includes('env-secret-value'))

      // Saved here: wins over the environment, at once and after a restart.
      const out = await storageSettings.save({ driver: 's3', force: true, s3: { ...MINIO, bucket: 'from-settings' } })
      assert.deepEqual([out.saved, out.status.source, out.status.driver, out.status.s3.bucket], [true, 'saved', 's3', 'from-settings'])
      assert.equal(storage.getStorage().active.bucket, 'from-settings')
      status = await boot()
      assert.deepEqual([status.source, status.s3.bucket], ['saved', 'from-settings'])
      assert.equal(storage.getStorage().active.bucket, 'from-settings')

      // The environment's bucket is still read: files written before the save stay reachable.
      fake.buckets.get(backendId(getConfig().storage.s3)).set('uploads/2025/01/envfile.png', Buffer.from('env'))
      assert.equal((await storage.getStorage().getBuffer('uploads/2025/01/envfile.png')).toString(), 'env')

      // "Back to local" is a saved choice too, and beats STORAGE_DRIVER=s3.
      status = (await storageSettings.save({ driver: 'local' })).status
      assert.deepEqual([status.source, status.driver, status.envDriver, status.s3.bucket], ['saved', 'local', 's3', 'from-settings'])
      assert.equal((await boot()).driver, 'local')
    })
  } finally {
    db.restore()
    fake.restore()
    storage.resetStorage()
    storageSettings.reset()
  }
})

test('the secret: encrypted at rest, never returned, kept when the form leaves it empty', async () => {
  const db = fakeSettings()
  const fake = fakeS3()
  const SECRET = MINIO.secretAccessKey
  try {
    storage.resetStorage()
    storageSettings.reset()
    await storageSettings.load()
    await assert.rejects(() => storageSettings.save({ driver: 's3', force: true, s3: { ...MINIO, secretAccessKey: '' } }), { code: 'validation.required' })
    await assert.rejects(() => storageSettings.save({ driver: 'gcs' }), { code: 'validation.one_of' })

    const first = await storageSettings.save({ driver: 's3', force: true, s3: MINIO })
    const stored = db.rows.get('storage')
    assert.ok(!JSON.stringify(stored).includes(SECRET), 'no plain secret in the database')
    assert.ok(stored.s3.secretEnc.startsWith('v1.'))
    assert.equal(decrypt(stored.s3.secretEnc, process.env.SECRET_KEY), SECRET)
    assert.ok(!JSON.stringify(first).includes(SECRET), 'no secret in the answer')
    assert.deepEqual([first.status.s3.hasSecret, first.status.s3.secretTail, first.status.s3.accessKeyId], [true, 'EKEY', 'AKIDEXAMPLE'])
    assert.ok(!('secretAccessKey' in first.status.s3) && !('secretEnc' in first.status.s3))
    assert.ok(!JSON.stringify(storageSettings.status()).includes(SECRET))

    // Changing another field without typing the secret keeps it.
    await storageSettings.save({ driver: 's3', force: true, s3: { ...MINIO, secretAccessKey: '', region: 'eu-west-1' } })
    assert.equal(decrypt(db.rows.get('storage').s3.secretEnc, process.env.SECRET_KEY), SECRET)
    assert.equal(db.rows.get('storage').previous.length, 0, 'same bucket, same place: nothing to remember')

    // Another bucket: the earlier one is remembered (with its own encrypted secret) and stays readable.
    const moved = await storageSettings.save({ driver: 's3', force: true, s3: { ...MINIO, bucket: 'second', secretAccessKey: 'another-secret-value-9999' } })
    const after = db.rows.get('storage')
    assert.deepEqual([after.s3.bucket, after.previous.map((p) => p.bucket)], ['second', ['canvas']])
    assert.ok(!JSON.stringify(after).includes(SECRET) && !JSON.stringify(after).includes('another-secret-value'))
    assert.deepEqual(moved.status.previous, [{ endpointHost: 'minio.internal:9000', bucket: 'canvas', keyPrefix: '' }])
    fake.buckets.get(backendId(parseS3Config(MINIO))).set(KEY, Buffer.from('old bucket'))
    assert.equal((await storage.getStorage().getBuffer(KEY)).toString(), 'old bucket')

    // SECRET_KEY changed: the secret cannot be read. The bucket stays the choice, new files are
    // refused rather than written to a place the operator did not choose, and the settings page
    // is told. More in storageResilience.test.js.
    const status = await withEnv({ SECRET_KEY: 'a-completely-different-secret-key' }, async () => {
      storage.resetStorage()
      storageSettings.reset()
      return storageSettings.load()
    })
    assert.deepEqual([status.secretUnreadable, status.writable, status.driver, status.source], [true, false, 's3', 'saved'])
  } finally {
    db.restore()
    fake.restore()
    storage.resetStorage()
    storageSettings.reset()
  }
})

test('a failing connection test blocks the save unless it is forced', async () => {
  const db = fakeSettings()
  try {
    storage.resetStorage()
    storageSettings.reset()
    await storageSettings.load()
    // Nothing listens on this port: the real probe fails at once.
    const unreachable = { ...MINIO, endpoint: 'http://127.0.0.1:9' }
    const refused = await storageSettings.save({ driver: 's3', s3: unreachable })
    assert.equal(refused.saved, false)
    assert.deepEqual([refused.test.ok, refused.test.error.code], [false, 'storage.err_unreachable'])
    assert.deepEqual(refused.test.steps.map((s) => `${s.step}:${s.status}`), ['put:failed', 'head:skipped', 'get:skipped', 'delete:skipped'])
    assert.equal(db.rows.has('storage'), false, 'nothing saved')
    assert.equal(storage.getStorage().driver, 'local', 'nothing switched')

    const forced = await storageSettings.save({ driver: 's3', force: true, s3: unreachable })
    assert.deepEqual([forced.saved, storage.getStorage().driver], [true, 's3'])
  } finally {
    db.restore()
    storage.resetStorage()
    storageSettings.reset()
  }
})

test('connection test errors name the cause', () => {
  const cfg = parseS3Config({ ...MINIO, forcePathStyle: false })
  const sdk = (name, status) => Object.assign(new Error(`${name} from the service`), { name, Code: name, $metadata: { httpStatusCode: status } })
  const net = (errCode, extra) => Object.assign(new Error(`connect ${errCode}`), { code: errCode, ...extra })
  const of = (err, over) => classify(err, { ...cfg, ...over }).code

  assert.equal(of(sdk('InvalidAccessKeyId', 403)), 'storage.err_access_key')
  assert.equal(of(sdk('SignatureDoesNotMatch', 403)), 'storage.err_signature')
  assert.equal(of(sdk('AccessDenied', 403)), 'storage.err_access_denied')
  assert.equal(of(sdk('NoSuchBucket', 404)), 'storage.err_no_bucket')
  assert.equal(of(sdk('RequestTimeTooSkewed', 403)), 'storage.err_clock_skew')
  assert.equal(of(sdk('AuthorizationHeaderMalformed', 400)), 'storage.err_region')
  assert.equal(of(sdk('PermanentRedirect', 301)), 'storage.err_region')
  assert.equal(of(sdk('SecondLevelDomainForbidden', 403)), 'storage.err_path_style_refused')
  assert.equal(of(net('ECONNREFUSED')), 'storage.err_unreachable')
  assert.equal(of(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), 'storage.err_unreachable')
  assert.equal(of(net('EPROTO')), 'storage.err_tls')
  assert.equal(of(net('DEPTH_ZERO_SELF_SIGNED_CERT')), 'storage.err_tls')
  // Virtual-hosted addressing against a host without wildcard DNS: say that path-style is the fix.
  assert.equal(of(net('ENOTFOUND', { hostname: 'canvas.minio.internal' })), 'storage.err_host_bucket_not_found')
  assert.equal(of(net('ENOTFOUND', { hostname: 'minio.internal' }), { forcePathStyle: true }), 'storage.err_host_not_found')
  assert.equal(of(Object.assign(new Error('@aws-sdk XML parse error: unexpected content.'), { $metadata: { httpStatusCode: 404 } })), 'storage.err_not_s3')
  const other = classify(sdk('SlowDown', 503), cfg)
  assert.deepEqual([other.code, other.params.code], ['storage.err_other', 'SlowDown'])
})

test('can an upstream be given a stored file by URL: a public PUBLIC_URL, or a bucket reachable from outside', async () => {
  const { newFilesReachable } = require('../src/services/media')
  const AWS = { ...MINIO, preset: 'aws', endpoint: '', region: 'eu-west-1', forcePathStyle: false }
  const ask = async (plan) => { storage.resetStorage(); if (plan) storage.configure(plan); const out = await newFilesReachable(); storage.resetStorage(); return out }
  // Local disk, no PUBLIC_URL: the default install. The canvas warns before a run that has to hand over a URL.
  assert.equal(await ask(null), false)
  assert.equal(await withEnv({ PUBLIC_URL: 'http://localhost:3000' }, () => ask(null)), false, 'an address only this machine can open does not count')
  assert.equal(await withEnv({ PUBLIC_URL: 'http://192.168.1.20:3000' }, () => ask(null)), false)
  assert.equal(await withEnv({ PUBLIC_URL: 'https://canvas.example.com' }, () => ask(null)), true)
  // New files in a bucket: its signed address is enough when the endpoint is on the internet...
  assert.equal(await ask({ active: parseS3Config(AWS) }), true)
  // ...and not when the endpoint is a private address, unless files are delivered from a public domain.
  const PRIVATE = { ...MINIO, endpoint: 'http://10.0.0.5:9000' }
  assert.equal(await ask({ active: parseS3Config(PRIVATE) }), false)
  assert.equal(await ask({ active: parseS3Config({ ...PRIVATE, publicBaseUrl: 'https://cdn.example.com', delivery: 'redirect' }) }), true)
  // A bucket that is only read from (storage was switched back to the disk) does not help new files.
  assert.equal(await ask({ active: null, readable: [parseS3Config(AWS)] }), false)
  // A container name is not an address anybody outside can open, with either addressing style
  // ("canvas.minio" is not a domain) - unless signed addresses are made for the name the service has outside.
  assert.equal(await ask({ active: parseS3Config({ ...MINIO, endpoint: 'http://minio:9000' }) }), false)
  assert.equal(await ask({ active: parseS3Config({ ...MINIO, endpoint: 'http://minio:9000', forcePathStyle: false }) }), false)
  assert.equal(await ask({ active: parseS3Config({ ...MINIO, endpoint: 'http://minio:9000', presignEndpoint: 'https://s3.example.com' }) }), true)
  assert.equal(await withEnv({ PUBLIC_URL: 'http://app:3000' }, () => ask(null)), false, 'the same rule for PUBLIC_URL')
})

test('Content-Security-Policy lists the public domains files are delivered from', () => {
  const plain = buildContentSecurityPolicy({ scriptHashes: [] })
  const csp = buildContentSecurityPolicy({ scriptHashes: [], mediaOrigins: ['https://cdn.example.com', 'http://127.0.0.1:9100', "https://x.test; script-src 'unsafe-inline'", 'javascript:alert(1)'] })
  const directive = (policy, name) => policy.split('; ').find((d) => d.startsWith(`${name} `))
  for (const name of ['img-src', 'media-src', 'connect-src']) {
    assert.ok(directive(csp, name).endsWith(' https://cdn.example.com http://127.0.0.1:9100'), name)
    assert.ok(!directive(plain, name).includes('cdn.example.com'))
  }
  assert.equal(directive(csp, 'script-src'), "script-src 'self'", 'scripts are not opened up')
  assert.ok(!csp.includes('javascript:') && !csp.includes('x.test'), 'only plain origins are copied in')
  assert.equal(csp.split('; ').length, plain.split('; ').length)
})

test('a signed address never survives into an error that is kept', () => {
  const signed = 'https://canvas.s3.eu-west-1.amazonaws.com/uploads/2025/01/a.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDEXAMPLE%2F20250101%2Feu-west-1%2Fs3%2Faws4_request&X-Amz-Date=20250101T000000Z&X-Amz-Expires=3600&X-Amz-Signature=0123abcd4567ef&X-Amz-SignedHeaders=host&x-id=GetObject'
  const kept = storedError(msg('upstream.failed_detail', { detail: `could not download ${signed} (403)` }))
  for (const text of [kept.error, JSON.stringify(kept.errorParams)]) {
    assert.ok(!text.includes('0123abcd4567ef') && !text.includes('AKIDEXAMPLE'), text)
    assert.ok(text.includes('X-Amz-Signature=***') && text.includes('/uploads/2025/01/a.png'))
  }
  assert.equal(kept.errorCode, 'upstream.failed_detail')
  const nested = scrubSigned(msg('media.read_failed', { what: msg('noun.image'), detail: msg('common.raw', { text: signed }) }))
  assert.ok(!JSON.stringify(nested).includes('0123abcd4567ef'))
  assert.deepEqual(scrubSigned(msg('run.failed')), msg('run.failed'))
})
