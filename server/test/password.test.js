'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { hashPassword, verifyPassword, temporaryPassword, PARAMS } = require('../src/utils/password')

test('passwords: scrypt with a salt per hash, parameters stored with it, constant-time verification', async () => {
  const hash = await hashPassword('correct horse battery staple')
  assert.match(hash, /^scrypt\$N=\d+,r=\d+,p=\d+\$[\w-]{22}\$[\w-]{43}$/)
  assert.ok(hash.startsWith(`scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$`))
  assert.ok(!hash.includes('correct horse'))
  assert.notEqual(hash, await hashPassword('correct horse battery staple'), 'a fresh salt every time')
  assert.equal(await verifyPassword('correct horse battery staple', hash), true)
  assert.equal(await verifyPassword('correct horse battery stapl', hash), false)
  assert.equal(await verifyPassword('', hash), false)
  for (const notAString of [undefined, null, 7, {}, ['correct horse battery staple']]) assert.equal(await verifyPassword(notAString, hash), false)
  await assert.rejects(hashPassword(''))
})

test('passwords: a hash made with other parameters still verifies; a malformed or oversized one never does', async () => {
  const crypto = require('crypto')
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync('older', salt, 32, { N: 16384, r: 8, p: 1 })
  const older = `scrypt$N=16384,r=8,p=1$${salt.toString('base64url')}$${key.toString('base64url')}`
  assert.equal(await verifyPassword('older', older), true)
  assert.equal(await verifyPassword('other', older), false)
  const [, , s, h] = older.split('$')
  for (const bad of ['', 'plain', `bcrypt$x$${s}$${h}`, `scrypt$N=3,r=8,p=1$${s}$${h}`, `scrypt$N=1073741824,r=8,p=1$${s}$${h}`, `scrypt$N=16384,r=999,p=1$${s}$${h}`, `scrypt$N=16384,r=8,p=1$$${h}`, `scrypt$N=16384,r=8,p=1$${s}$`]) {
    assert.equal(await verifyPassword('older', bad), false, bad)
  }
})

test('temporary passwords: sixteen unambiguous characters, different every time', () => {
  const seen = new Set(Array.from({ length: 50 }, () => temporaryPassword()))
  assert.equal(seen.size, 50)
  for (const p of seen) assert.match(p, /^[A-HJ-NP-Za-km-z2-9]{16}$/)
})
