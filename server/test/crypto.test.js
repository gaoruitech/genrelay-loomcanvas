'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { encrypt, decrypt, deriveKey, safeEqual, randomToken, keyTail } = require('../src/utils/crypto')

const SECRET = 'unit-test-secret-key-0123456789'

test('encrypt/decrypt round trip, including unicode and empty strings', () => {
  for (const plain of ['sk-abc123', '', '密钥 🔑 with spaces', 'x'.repeat(5000)]) {
    assert.equal(decrypt(encrypt(plain, SECRET), SECRET), plain)
  }
})

test('ciphertext does not contain the plaintext and differs on every call', () => {
  const a = encrypt('sk-very-secret-value', SECRET)
  const b = encrypt('sk-very-secret-value', SECRET)
  assert.notEqual(a, b, 'fresh IV each time')
  assert.ok(!a.includes('sk-very-secret-value'))
  assert.match(a, /^v1\.[\w-]+\.[\w-]+\.[\w-]*$/)
})

test('decrypt fails with a different secret', () => {
  const c = encrypt('sk-abc', SECRET)
  assert.throws(() => decrypt(c, 'another-secret-key-0123456789'))
})

test('decrypt fails when the ciphertext or tag was tampered with', () => {
  const [v, iv, tag, body] = encrypt('sk-abcdefgh', SECRET).split('.')
  const flip = (s) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1)
  assert.throws(() => decrypt([v, iv, tag, flip(body)].join('.'), SECRET))
  assert.throws(() => decrypt([v, iv, flip(tag), body].join('.'), SECRET))
  assert.throws(() => decrypt([v, flip(iv), tag, body].join('.'), SECRET))
  assert.throws(() => decrypt('not-a-ciphertext', SECRET))
  assert.throws(() => decrypt('', SECRET))
})

test('deriveKey: 32 bytes, stable, separated by purpose and by secret', () => {
  const a = deriveKey(SECRET, 'auth-jwt')
  assert.equal(a.length, 32)
  assert.ok(a.equals(deriveKey(SECRET, 'auth-jwt')))
  assert.ok(!a.equals(deriveKey(SECRET, 'provider-credentials')))
  assert.ok(!a.equals(deriveKey(SECRET + 'x', 'auth-jwt')))
  assert.throws(() => deriveKey('short', 'x'))
})

test('safeEqual compares by value regardless of length', () => {
  assert.equal(safeEqual('hunter2', 'hunter2'), true)
  assert.equal(safeEqual('hunter2', 'hunter3'), false)
  assert.equal(safeEqual('a', 'a much longer string'), false)
  assert.equal(safeEqual('', ''), true)
})

test('randomToken is long, url-safe and unique', () => {
  const t = randomToken()
  assert.match(t, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(t, randomToken())
})

test('keyTail shows the last four characters only for keys long enough to stay secret', () => {
  assert.equal(keyTail('sk-1234567890abcd'), 'abcd')
  assert.equal(keyTail('short'), '')
  assert.equal(keyTail(''), '')
})
