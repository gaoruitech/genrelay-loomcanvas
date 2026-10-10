'use strict'

/** Unit-level checks of the hardening that needs no database. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

process.env.SECRET_KEY = 'hardening-test-secret-key-0123456789'

const { resetConfig, getConfig, ConfigError } = require('../src/config')
const { loginRateLimit, countAccountAttempt, resetRateLimits, clientKey, LOGIN_LIMITS } = require('../src/middleware/auth')
const { messageFromBody, errorCodeFromBody, redactSecrets } = require('../src/providers/http')
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

test('login rate limit: counted per client, where an IPv6 client is its /64', async () => {
  assert.equal(clientKey('203.0.113.7'), '203.0.113.7')
  assert.equal(clientKey('::ffff:203.0.113.7'), '203.0.113.7')
  assert.equal(clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64')
  assert.equal(clientKey('2001:db8:1:2::1'), '2001:db8:1:2::/64')
  assert.equal(clientKey('2001:DB8:0001:0002::1%eth0'), '2001:db8:1:2::/64')
  assert.equal(clientKey('2001:db8::1'), '2001:db8:0:0::/64')
  assert.equal(clientKey('::1'), '0:0:0:0::/64')
  assert.equal(clientKey(undefined), 'unknown')

  resetRateLimits()
  for (let i = 0; i < LOGIN_LIMITS.perClient; i++) assert.equal(attempt(`2001:db8:9:9::${i + 1}`).status, 200)
  assert.equal(attempt('2001:db8:9:9:ffff:ffff:ffff:ffff').status, 429, 'another address of the same /64 is the same client')
  assert.equal(attempt('2001:db8:9:a::1').status, 200, 'a different /64 is not')

  // A correct password forgives the caller's own wrong tries at that account - and only those:
  // signing in to one's own account does not wipe the address's guesses at other names.
  resetRateLimits()
  const ip = '198.51.100.1'
  const own = 5
  for (let i = 0; i < own; i++) { attempt(ip); await countAccountAttempt({ ip }, {}, 'me') }
  for (let i = 0; i < LOGIN_LIMITS.perClient - own - 1; i++) attempt(ip)
  assert.equal(attempt(ip).status, 200, 'the last one the address has')
  const succeeded = await countAccountAttempt({ ip }, {}, 'me')
  assert.equal(attempt(ip).status, 429)
  succeeded()
  for (let i = 0; i < own + 1; i++) assert.equal(attempt(ip).status, 200, `forgiven try ${i + 1}`)
  assert.equal(attempt(ip).status, 429, 'the guesses at other names are still counted')
  resetRateLimits()
})

test('login rate limit: wrong guesses at a name from one address stop that address, nobody else', async () => {
  resetRateLimits()
  const guess = (ip, account) => countAccountAttempt({ ip }, {}, account).then(() => 200, (err) => err.status)
  assert.ok(LOGIN_LIMITS.perAccount >= LOGIN_LIMITS.perPair * 10, 'the ceiling across addresses is far above what one address gets')
  for (let i = 0; i < LOGIN_LIMITS.perPair; i++) assert.equal(await guess('203.0.113.1', 'Victim'), 200)
  assert.equal(await guess('203.0.113.1', 'victim'), 429, 'the name is counted without regard to case')
  assert.equal(await guess('203.0.113.1', ' VICTIM '), 429)
  assert.equal(await guess('203.0.113.2', 'victim'), 200, 'the holder, anywhere else, is not locked out')
  assert.equal(await guess('203.0.113.1', 'somebody-else'), 200, 'and the address may still sign in to another account')
  resetRateLimits()
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

  // An error body passed on as a JSON string is unwrapped, to a bounded depth; other text is left alone.
  const wrapped = { code: 'fail_to_fetch_task', message: '{"error":{"code":"model_not_found","message":"no channel"}}' }
  assert.equal(messageFromBody(wrapped), 'no channel')
  assert.equal(errorCodeFromBody(wrapped), 'model_not_found')
  assert.equal(messageFromBody({ message: '{not json' }), '{not json')
  assert.equal(messageFromBody({ message: '{"unrelated":1}' }), '{"unrelated":1}')
  const nest = (n) => (n ? { message: JSON.stringify(nest(n - 1)) } : { message: 'bottom' })
  assert.equal(messageFromBody(nest(2)), 'bottom')
  assert.ok(messageFromBody(nest(4)).startsWith('{'), 'stops unwrapping after two levels')
  assert.equal(errorCodeFromBody({ error: { message: 'x' } }), '')
  assert.equal(errorCodeFromBody('text'), '')
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
