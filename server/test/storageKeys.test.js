'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { newKey, thumbKeyFor, thumbSourceKey, isValidKey, accountPrefixes } = require('../src/storage/keys')
const { createLocalStorage } = require('../src/storage/local')

test('thumbnail keys are derived from the image key and map back to it', () => {
  const key = 'outputs/2025/01/0123456789abcdef0123456789abcdef.png'
  const thumb = thumbKeyFor(key)
  assert.equal(thumb, 'thumbs/of/outputs/2025/01/0123456789abcdef0123456789abcdef_png.webp')
  assert.ok(isValidKey(thumb))
  assert.equal(thumbSourceKey(thumb), key)

  for (const prefix of ['uploads', 'outputs', 'tools']) {
    const k = newKey(prefix, 'image/jpeg')
    assert.equal(thumbSourceKey(thumbKeyFor(k)), k)
  }
})

test('only stored still images get a thumbnail key', () => {
  assert.equal(thumbKeyFor('outputs/2025/01/aa.mp4'), null, 'video')
  assert.equal(thumbKeyFor('uploads/2025/01/aa.gif'), null, 'animated format')
  assert.equal(thumbKeyFor('thumbs/2025/01/aa.webp'), null, 'a thumbnail has no thumbnail')
  assert.equal(thumbKeyFor('thumbs/of/outputs/2025/01/aa_png.webp'), null)
  assert.equal(thumbKeyFor('../etc/passwd.png'), null)
  assert.equal(thumbKeyFor(''), null)
})

test('thumbSourceKey rejects anything that is not a derived thumbnail key', () => {
  assert.equal(thumbSourceKey('thumbs/2025/01/aa.webp'), null, 'old random-key thumbnail')
  assert.equal(thumbSourceKey('thumbs/of/outputs/2025/01/aa_mp4.webp'), null)
  assert.equal(thumbSourceKey('thumbs/of/secrets/2025/01/aa_png.webp'), null, 'unknown prefix')
  assert.equal(thumbSourceKey('thumbs/of/outputs/2025/01/aa.webp'), null, 'no extension marker')
  assert.equal(thumbSourceKey('thumbs/of/thumbs/of/outputs/2025/01/aa_png_webp.webp'), null)
  assert.equal(thumbSourceKey('outputs/2025/01/aa_png.webp'), null)
})

test('a new key carries the account it belongs to; keys from before accounts stay valid', () => {
  const alice = '65a1b2c3d4e5f60718293a4b'
  for (const prefix of ['uploads', 'outputs', 'tools']) {
    const key = newKey(prefix, 'image/png', alice)
    assert.match(key, /^[a-z]+\/[0-9a-f]{24}\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/)
    assert.ok(key.startsWith(`${prefix}/${alice}/`))
    assert.ok(isValidKey(key))
    const thumb = thumbKeyFor(key)
    assert.ok(thumb.startsWith(`thumbs/of/${prefix}/${alice}/`), 'the thumbnail sits under the same account')
    assert.equal(thumbSourceKey(thumb), key)
  }
  // Whatever is not an account id never ends up in a key.
  for (const notAnId of [undefined, '', 'local', '../../etc', 'ABCDEF0123456789abcdef01', { toString: () => 'x/y' }]) {
    assert.match(newKey('uploads', 'image/png', notAnId), /^uploads\/\d{4}\/\d{2}\/[0-9a-f]{32}\.png$/)
  }
  assert.ok(isValidKey('uploads/2025/01/0123456789abcdef0123456789abcdef.png'), 'the shape used before accounts')

  assert.deepEqual(accountPrefixes(alice), [
    `uploads/${alice}/`, `thumbs/of/uploads/${alice}/`,
    `outputs/${alice}/`, `thumbs/of/outputs/${alice}/`,
    `tools/${alice}/`, `thumbs/of/tools/${alice}/`,
  ])
  for (const bad of ['', 'local', '2025', '..', 'uploads']) assert.throws(() => accountPrefixes(bad), /not an account id/)
})

test('local storage: removing an account prefix removes that account\'s files and nothing else', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomcanvas-keys-'))
  try {
    const storage = createLocalStorage({ dir })
    const alice = '65a1b2c3d4e5f60718293a4b'
    const bob = '65a1b2c3d4e5f60718293a4c'
    const keys = {
      alice: [newKey('uploads', 'image/png', alice), newKey('uploads', 'video/mp4', alice)],
      bob: [newKey('uploads', 'image/png', bob)],
      old: ['uploads/2025/01/0123456789abcdef0123456789abcdef.png'],
    }
    for (const key of Object.values(keys).flat()) await storage.put(key, Buffer.from('x'))
    assert.equal(await storage.deletePrefix(`uploads/${alice}/`), 2)
    assert.equal(await storage.deletePrefix(`uploads/${alice}/`), 0, 'nothing left, and no error')
    for (const key of keys.alice) assert.equal(await storage.head(key), null)
    for (const key of [...keys.bob, ...keys.old]) assert.ok(await storage.head(key), key)
    for (const bad of ['', 'uploads/', '../', 'uploads/../', '/', `uploads/${alice}`, 'UPLOADS/x/']) {
      await assert.rejects(storage.deletePrefix(bad), /invalid storage prefix/, bad)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
