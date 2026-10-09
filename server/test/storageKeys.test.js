'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { newKey, thumbKeyFor, thumbSourceKey, isValidKey } = require('../src/storage/keys')

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
