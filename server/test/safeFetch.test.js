'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const {
  safeFetch, safeFetchStream, assertPublicUrl, isBlockedAddress, guardedLookup, setAllowedHosts, SafeFetchError,
} = require('../src/utils/safeFetch')

test('isBlockedAddress: private, loopback, link-local and special IPv4 ranges', () => {
  for (const ip of [
    '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '198.18.0.1', '192.0.2.1', '203.0.113.9',
  ]) assert.equal(isBlockedAddress(ip), true, ip)
})

test('isBlockedAddress: public IPv4 addresses pass', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '192.167.1.1', '100.63.0.1', '169.253.0.1']) {
    assert.equal(isBlockedAddress(ip), false, ip)
  }
})

test('isBlockedAddress: IPv6 loopback, ULA, link-local, mapped and embedded IPv4', () => {
  for (const ip of [
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe',
    '64:ff9b::7f00:1', '2002:7f00:1::', '2001:db8::1', '[::1]',
  ]) assert.equal(isBlockedAddress(ip), true, ip)
})

test('isBlockedAddress: public IPv6 passes, garbage is blocked', () => {
  assert.equal(isBlockedAddress('2606:4700:4700::1111'), false)
  assert.equal(isBlockedAddress('::ffff:8.8.8.8'), false)
  assert.equal(isBlockedAddress('not-an-ip'), true)
  assert.equal(isBlockedAddress(''), true)
})

test('assertPublicUrl: scheme, credentials and literal-address checks', () => {
  const blocked = (url, code) => assert.throws(() => assertPublicUrl(url), (e) => e instanceof SafeFetchError && e.code === code, url)
  blocked('file:///etc/passwd', 'EPROTO')
  blocked('ftp://example.com/a', 'EPROTO')
  blocked('gopher://example.com/', 'EPROTO')
  blocked('javascript:alert(1)', 'EPROTO')
  blocked('not a url', 'EURL')
  blocked('http://user:pass@example.com/', 'EURL')
  blocked('http://localhost/', 'EBLOCKED')
  blocked('http://LOCALHOST:8080/', 'EBLOCKED')
  blocked('http://foo.localhost/', 'EBLOCKED')
  blocked('http://127.0.0.1/', 'EBLOCKED')
  blocked('http://[::1]/', 'EBLOCKED')
  blocked('http://[::ffff:127.0.0.1]/', 'EBLOCKED')
  blocked('http://169.254.169.254/latest/meta-data/', 'EBLOCKED')
  blocked('http://10.1.2.3:8080/x', 'EBLOCKED')
  // Alternative spellings of 127.0.0.1 that URL parsing normalises.
  blocked('http://2130706433/', 'EBLOCKED')
  blocked('http://0x7f.0.0.1/', 'EBLOCKED')
  blocked('http://0177.0.0.1/', 'EBLOCKED')
  blocked('http://127.1/', 'EBLOCKED')
  assert.equal(assertPublicUrl('https://example.com/a.png').hostname, 'example.com')
  assert.equal(assertPublicUrl('http://8.8.8.8/').hostname, '8.8.8.8')
})

test('guardedLookup refuses names that resolve to a private address', async () => {
  // "localhost" resolves to loopback without touching the network.
  await assert.rejects(
    new Promise((resolve, reject) => guardedLookup('localhost', {}, (err, addr) => (err ? reject(err) : resolve(addr)))),
    (e) => e.code === 'EBLOCKED'
  )
  await assert.rejects(
    new Promise((resolve, reject) => guardedLookup('localhost', { all: true }, (err, addr) => (err ? reject(err) : resolve(addr)))),
    (e) => e.code === 'EBLOCKED'
  )
})

test('safeFetch refuses private targets before connecting', async () => {
  await assert.rejects(safeFetch('http://127.0.0.1:1/'), (e) => e.code === 'EBLOCKED')
  await assert.rejects(safeFetch('http://[::1]:1/'), (e) => e.code === 'EBLOCKED')
  await assert.rejects(safeFetch('file:///etc/hosts'), (e) => e.code === 'EPROTO')
})

/** Local server for behaviour tests. Loopback is reachable only via the allow-list. */
function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/ok') {
      res.setHeader('Content-Type', 'image/png; charset=binary')
      return res.end(Buffer.from('hello'))
    }
    if (url.pathname === '/echo-auth') return res.end(req.headers.authorization || 'none')
    if (url.pathname === '/big') {
      res.setHeader('Content-Length', 5000)
      return res.end(Buffer.alloc(5000))
    }
    if (url.pathname === '/big-chunked') {
      res.write(Buffer.alloc(3000))
      return setTimeout(() => res.end(Buffer.alloc(3000)), 10)
    }
    if (url.pathname === '/slow') return setTimeout(() => res.end('late'), 2000)
    if (url.pathname === '/slow-body') {
      res.write('start')
      return setTimeout(() => res.end('end'), 2000)
    }
    if (url.pathname === '/redirect') {
      res.statusCode = 302
      res.setHeader('Location', url.searchParams.get('to'))
      return res.end()
    }
    if (url.pathname === '/loop') {
      res.statusCode = 302
      res.setHeader('Location', '/loop')
      return res.end()
    }
    res.statusCode = 404
    res.end('nope')
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

test('safeFetch behaviour against a local server', async (t) => {
  const server = await startServer()
  const base = `http://127.0.0.1:${server.address().port}`
  setAllowedHosts(['127.0.0.1'])
  t.after(() => { setAllowedHosts([]); server.closeAllConnections(); server.close() })

  await t.test('downloads a body and reports the content type', async () => {
    const out = await safeFetch(`${base}/ok`)
    assert.equal(out.buffer.toString(), 'hello')
    assert.equal(out.contentType, 'image/png')
  })

  await t.test('non-2xx is an error', async () => {
    await assert.rejects(safeFetch(`${base}/missing`), (e) => e.code === 'EHTTP' && e.status === 404)
  })

  await t.test('size cap by declared length and by actual bytes', async () => {
    await assert.rejects(safeFetch(`${base}/big`, { maxBytes: 1000 }), (e) => e.code === 'E2BIG')
    await assert.rejects(safeFetch(`${base}/big-chunked`, { maxBytes: 4000 }), (e) => e.code === 'E2BIG')
    assert.equal((await safeFetch(`${base}/big`, { maxBytes: 5000 })).buffer.length, 5000)
  })

  await t.test('total timeout covers slow headers and a slow body', async () => {
    const t0 = Date.now()
    await assert.rejects(safeFetch(`${base}/slow`, { timeoutMs: 100 }), (e) => e.code === 'ETIMEDOUT')
    await assert.rejects(safeFetch(`${base}/slow-body`, { timeoutMs: 100 }), (e) => e.code === 'ETIMEDOUT')
    assert.ok(Date.now() - t0 < 1500)
  })

  await t.test('caller abort is honoured', async () => {
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(new Error('stop')), 50)
    await assert.rejects(safeFetch(`${base}/slow`, { signal: ctl.signal }), (e) => e.code === 'EABORTED')
  })

  await t.test('follows a same-host redirect', async () => {
    const out = await safeFetch(`${base}/redirect?to=${encodeURIComponent('/ok')}`)
    assert.equal(out.buffer.toString(), 'hello')
    assert.ok(out.url.endsWith('/ok'))
  })

  await t.test('re-validates every redirect hop: public-looking URL redirecting inward is refused', async () => {
    for (const target of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/', 'http://localhost:1/', 'http://[::1]:1/', 'file:///etc/passwd']) {
      await assert.rejects(
        safeFetch(`${base}/redirect?to=${encodeURIComponent(target)}`),
        (e) => e.code === 'EBLOCKED' || e.code === 'EPROTO',
        target
      )
    }
  })

  await t.test('redirect loops stop at the hop limit', async () => {
    await assert.rejects(safeFetch(`${base}/loop`, { maxRedirects: 3 }), (e) => e.code === 'EREDIRECT')
  })

  await t.test('caller headers are sent to the first origin only', async () => {
    const headers = { Authorization: 'Bearer secret' }
    assert.equal((await safeFetch(`${base}/echo-auth`, { headers })).buffer.toString(), 'Bearer secret')
    // "localhost" is a different origin than 127.0.0.1; allow it for this one check.
    setAllowedHosts(['127.0.0.1', 'localhost'])
    const other = `http://localhost:${server.address().port}/echo-auth`
    const out = await safeFetch(`${base}/redirect?to=${encodeURIComponent(other)}`, { headers })
    setAllowedHosts(['127.0.0.1'])
    assert.equal(out.buffer.toString(), 'none')
  })

  await t.test('stream variant delivers the body and enforces the cap', async () => {
    const ok = await safeFetchStream(`${base}/ok`)
    const chunks = []
    for await (const c of ok.stream) chunks.push(c)
    assert.equal(Buffer.concat(chunks).toString(), 'hello')

    await assert.rejects(safeFetchStream(`${base}/big`, { maxBytes: 100 }), (e) => e.code === 'E2BIG')
    const capped = await safeFetchStream(`${base}/big-chunked`, { maxBytes: 4000 })
    await assert.rejects((async () => { for await (const _ of capped.stream) { /* drain */ } })(), (e) => e.code === 'E2BIG')
  })
})
