'use strict'

/** Unit-level checks of the hardening that needs no database. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

process.env.SECRET_KEY = 'hardening-test-secret-key-0123456789'
process.env.ACCESS_PASSWORD = 'pw'

const { resetConfig, getConfig, ConfigError } = require('../src/config')
const { loginRateLimit, clientKey, LOGIN_LIMITS } = require('../src/middleware/auth')
const { messageFromBody, redactSecrets } = require('../src/providers/http')
const { buildContentSecurityPolicy, inlineScriptHashes } = require('../src/middleware/security')
const { createLocalStorage } = require('../src/storage/local')

function attempt(ip) {
  const req = { ip }
  let error = null
  loginRateLimit(req, {}, (err) => { error = err || null })
  return { req, status: error ? error.status : 200 }
}

test('TRUST_PROXY: hop counts and proxy addresses only; "true" would let anyone forge their address', () => {
  const parse = (value) => {
    process.env.TRUST_PROXY = value
    resetConfig()
    try { return getConfig().trustProxy } finally { process.env.TRUST_PROXY = ''; resetConfig() }
  }
  assert.equal(parse(''), false)
  assert.equal(parse('0'), false)
  assert.equal(parse('1'), 1)
  assert.deepEqual(parse('loopback, 10.0.0.0/8,fd00::/8 , 172.18.0.1'), ['loopback', '10.0.0.0/8', 'fd00::/8', '172.18.0.1'])
  for (const bad of ['true', 'yes', '-1', '99', '10.0.0.0/33', 'proxy.internal', '1.5']) {
    assert.throws(() => parse(bad), ConfigError, bad)
  }
})

test('login rate limit: counted per client, where an IPv6 client is its /64', () => {
  assert.equal(clientKey('203.0.113.7'), '203.0.113.7')
  assert.equal(clientKey('::ffff:203.0.113.7'), '203.0.113.7')
  assert.equal(clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64')
  assert.equal(clientKey('2001:db8:1:2::1'), '2001:db8:1:2::/64')
  assert.equal(clientKey('2001:DB8:0001:0002::1%eth0'), '2001:db8:1:2::/64')
  assert.equal(clientKey('2001:db8::1'), '2001:db8:0:0::/64')
  assert.equal(clientKey('::1'), '0:0:0:0::/64')
  assert.equal(clientKey(undefined), 'unknown')

  for (let i = 0; i < LOGIN_LIMITS.perClient; i++) assert.equal(attempt(`2001:db8:9:9::${i + 1}`).status, 200)
  assert.equal(attempt('2001:db8:9:9:ffff:ffff:ffff:ffff').status, 429, 'another address of the same /64 is the same client')
  assert.equal(attempt('2001:db8:9:a::1').status, 200, 'a different /64 is not')

  // A successful login clears the client's count.
  for (let i = 0; i < LOGIN_LIMITS.perClient - 1; i++) attempt('198.51.100.1')
  attempt('198.51.100.1').req.loginSucceeded()
  assert.equal(attempt('198.51.100.1').status, 200)
})

test('login rate limit: a ceiling across all clients, so many addresses cannot guess without bound', () => {
  let allowed = 0
  for (let i = 0; i < LOGIN_LIMITS.global + 50; i++) {
    if (attempt(`10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`).status === 200) allowed++
  }
  assert.ok(allowed <= LOGIN_LIMITS.global, `${allowed} attempts got through`)
  assert.equal(attempt('192.0.2.200').status, 429)
})

test('upstream error text: credentials are blanked, and a hostile body cannot stall the process', () => {
  const headers = { Authorization: 'Bearer sk-live-abcdef0123456789', 'x-goog-api-key': 'AIzaSyD-0123456789abcdef', 'Content-Type': 'application/json' }
  assert.equal(redactSecrets('Incorrect API key provided: Bearer sk-live-abcdef0123456789.', headers), 'Incorrect API key provided: ***.')
  assert.equal(redactSecrets('key sk-live-abcdef0123456789 / AIzaSyD-0123456789abcdef rejected (application/json)', headers), 'key *** / *** rejected (application/json)')
  assert.equal(redactSecrets('nothing to hide', { Authorization: '' }), 'nothing to hide')

  const started = Date.now()
  const out = messageFromBody('<'.repeat(4 * 1024 * 1024))
  assert.ok(Date.now() - started < 1000, 'linear, not quadratic')
  assert.ok(out.length <= 300)
  assert.equal(messageFromBody('<html><body><h1>502 Bad Gateway</h1></body></html>'), '502 Bad Gateway')
})

test('local storage: file addresses are site-relative whatever PUBLIC_URL says, and old absolute ones still resolve', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loomcanvas-local-'))
  try {
    const storage = createLocalStorage({ dir, publicUrl: 'https://canvas.example' })
    const key = 'uploads/2025/01/0123456789abcdef0123456789abcdef.png'
    assert.equal(storage.urlFor(key), `/files/${key}`)
    for (const url of [`/files/${key}`, `https://canvas.example/files/${key}`, `http://localhost:3000/files/${key}`]) {
      assert.equal(storage.keyFromUrl(url), key, url)
    }
    assert.equal(storage.keyFromUrl(`https://elsewhere.example/files/${key}`), null)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('content security policy: inline scripts of the built page are allowed by hash only', () => {
  const html = '<html><head><script>var a = 1</script><script type="module" src="/a.js"></script><script\n>var b = 2</script></head></html>'
  const hashes = inlineScriptHashes(html)
  assert.equal(hashes.length, 2)
  assert.match(hashes[0], /^'sha256-[A-Za-z0-9+/]{43}='$/)
  const csp = buildContentSecurityPolicy({ scriptHashes: hashes })
  assert.ok(csp.includes(`script-src 'self' ${hashes.join(' ')};`))
  assert.ok(!/script-src[^;]*unsafe-inline/.test(csp))
  assert.deepEqual(inlineScriptHashes('<p>no scripts</p>'), [])
})
