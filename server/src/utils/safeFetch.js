'use strict'

/**
 * SSRF-safe downloader. Every place where the server fetches a URL that came
 * from a user or from an upstream response goes through here.
 *
 * Guarantees:
 *  - http/https only, no credentials in the URL;
 *  - the address actually connected to is checked, not just the hostname: the
 *    check runs inside the socket's DNS lookup, so a name that resolves to a
 *    public address at validation time and to a private one at connect time
 *    (DNS rebinding) cannot slip through;
 *  - redirects are followed manually, each hop re-validated, with a hop limit;
 *  - a hard total deadline (headers + body) and a byte cap.
 */
const http = require('http')
const https = require('https')
const dns = require('dns')
const net = require('net')
const { PassThrough } = require('stream')

class SafeFetchError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'SafeFetchError'
    this.code = code
    Object.assign(this, extra)
  }
}

const blockList = new net.BlockList()
for (const [addr, prefix] of [
  ['0.0.0.0', 8],        // "this network"
  ['10.0.0.0', 8],       // private
  ['100.64.0.0', 10],    // carrier-grade NAT
  ['127.0.0.0', 8],      // loopback
  ['169.254.0.0', 16],   // link-local, cloud metadata lives here
  ['172.16.0.0', 12],    // private
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // documentation
  ['192.88.99.0', 24],   // 6to4 relay anycast
  ['192.168.0.0', 16],   // private
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // documentation
  ['203.0.113.0', 24],   // documentation
  ['224.0.0.0', 4],      // multicast
  ['240.0.0.0', 4],      // reserved + broadcast
]) blockList.addSubnet(addr, prefix, 'ipv4')
for (const [addr, prefix] of [
  ['::', 128],           // unspecified
  ['::1', 128],          // loopback
  ['64:ff9b::', 96],     // NAT64, embeds an IPv4 address
  ['64:ff9b:1::', 48],   // local-use NAT64
  ['100::', 64],         // discard
  ['2001::', 32],        // Teredo, embeds an IPv4 address
  ['2001:db8::', 32],    // documentation
  ['2002::', 16],        // 6to4, embeds an IPv4 address
  ['fc00::', 7],         // unique local
  ['fe80::', 10],        // link-local
  ['fec0::', 10],        // site-local (deprecated)
  ['ff00::', 8],         // multicast
]) blockList.addSubnet(addr, prefix, 'ipv6')

/** IPv4-mapped / IPv4-compatible IPv6 → dotted IPv4, else null. */
function embeddedIPv4(ip) {
  const lower = ip.toLowerCase()
  let m = /^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower)
  if (m) return m[1]
  m = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
  if (m) {
    const hi = parseInt(m[1], 16)
    const lo = parseInt(m[2], 16)
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  return null
}

/** True when the address must never be contacted on behalf of a user. */
function isBlockedAddress(ip) {
  const addr = String(ip || '').replace(/^\[|\]$/g, '').split('%')[0]
  const family = net.isIP(addr)
  if (family === 4) return blockList.check(addr, 'ipv4')
  if (family === 6) {
    const v4 = embeddedIPv4(addr)
    if (v4 && net.isIP(v4) === 4) return blockList.check(v4, 'ipv4')
    return blockList.check(addr, 'ipv6')
  }
  return true // not an IP address at all
}

let allowedHosts = new Set()

/** Hostnames/IPs exempt from the private-range block (operator opt-in). */
function setAllowedHosts(list) {
  allowedHosts = new Set((list || []).map((h) => String(h).trim().toLowerCase()).filter(Boolean))
}

function hostOf(u) {
  return u.hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

/**
 * Static checks on a URL: scheme, credentials, literal addresses.
 * Hostnames are checked again at connect time by guardedLookup.
 */
function assertPublicUrl(raw, { allowPrivate = false } = {}) {
  let u
  try { u = raw instanceof URL ? raw : new URL(String(raw)) } catch {
    throw new SafeFetchError('EURL', '地址无法解析')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new SafeFetchError('EPROTO', '仅支持 http/https 地址')
  }
  if (u.username || u.password) throw new SafeFetchError('EURL', '地址中不能包含账号密码')
  const host = hostOf(u)
  if (!host) throw new SafeFetchError('EURL', '地址缺少主机名')
  if (allowPrivate || allowedHosts.has(host)) return u
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new SafeFetchError('EBLOCKED', '不允许访问内网地址')
  }
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new SafeFetchError('EBLOCKED', '不允许访问内网地址')
  }
  return u
}

/** dns.lookup replacement that refuses names resolving to any blocked address. */
function guardedLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {} }
  const opts = typeof options === 'number' ? { family: options } : { ...(options || {}) }
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return callback(err)
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }]
    if (!list.length) return callback(new SafeFetchError('EDNS', '域名解析失败'))
    // One private record is enough to refuse: otherwise a name with a public
    // and a private record could be steered to the private one.
    if (list.some((a) => isBlockedAddress(a.address))) {
      return callback(new SafeFetchError('EBLOCKED', '不允许访问内网地址'))
    }
    if (opts.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308])
const DEFAULT_MAX_BYTES = 30 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 60 * 1000

function requestOnce(u, { headers, signal, allowPrivate }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http
    const exempt = allowPrivate || allowedHosts.has(hostOf(u))
    const req = lib.request(u, {
      method: 'GET',
      headers: { 'User-Agent': 'LoomCanvas/1.0', Accept: '*/*', ...headers },
      lookup: exempt ? undefined : guardedLookup,
      agent: false, // no connection reuse: every request gets a fresh, checked lookup
      signal,
    }, resolve)
    req.on('error', reject)
    req.end()
  })
}

/**
 * Open a validated response stream, following redirects.
 * Resolves { res, url, done } - call done() when finished with the body.
 */
async function open(raw, opts = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRedirects = 5,
    headers = {},
    signal: outerSignal,
    allowPrivate = false,
  } = opts

  const timeoutCtl = new AbortController()
  const timer = setTimeout(() => timeoutCtl.abort(new SafeFetchError('ETIMEDOUT', '下载超时')), timeoutMs)
  const signal = outerSignal ? AbortSignal.any([outerSignal, timeoutCtl.signal]) : timeoutCtl.signal
  const done = () => clearTimeout(timer)

  const translate = (err) => {
    if (err instanceof SafeFetchError) return err
    if (timeoutCtl.signal.aborted) return timeoutCtl.signal.reason
    if (outerSignal && outerSignal.aborted) {
      const e = new SafeFetchError('EABORTED', '下载已取消')
      e.cause = outerSignal.reason
      return e
    }
    return new SafeFetchError(err.code || 'ENETWORK', `下载失败：${err.message}`, { cause: err })
  }

  try {
    let u = assertPublicUrl(raw, { allowPrivate })
    const origin = u.origin
    let sendHeaders = headers
    for (let hop = 0; ; hop++) {
      const res = await requestOnce(u, { headers: sendHeaders, signal, allowPrivate })
      if (REDIRECT_CODES.has(res.statusCode)) {
        res.resume()
        const loc = res.headers.location
        if (!loc) throw new SafeFetchError('EREDIRECT', '重定向缺少目标地址')
        if (hop >= maxRedirects) throw new SafeFetchError('EREDIRECT', '重定向次数过多')
        u = assertPublicUrl(new URL(loc, u), { allowPrivate })
        // Caller-supplied headers (possibly credentials) stay with the first origin.
        if (u.origin !== origin) sendHeaders = {}
        continue
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        throw new SafeFetchError('EHTTP', `下载失败：HTTP ${res.statusCode}`, { status: res.statusCode })
      }
      return { res, url: u.toString(), done, translate, signal }
    }
  } catch (err) {
    done()
    throw translate(err)
  }
}

function declaredLength(res) {
  const n = Number(res.headers['content-length'])
  return Number.isFinite(n) && n >= 0 ? n : null
}

function contentTypeOf(res) {
  return String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
}

/** Download into memory. Resolves { buffer, contentType, url }. */
async function safeFetch(raw, opts = {}) {
  const maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES
  const { res, url, done, translate } = await open(raw, opts)
  try {
    const len = declaredLength(res)
    if (len !== null && len > maxBytes) throw new SafeFetchError('E2BIG', '文件超过大小上限')
    const chunks = []
    let total = 0
    for await (const chunk of res) {
      total += chunk.length
      if (total > maxBytes) throw new SafeFetchError('E2BIG', '文件超过大小上限')
      chunks.push(chunk)
    }
    return { buffer: Buffer.concat(chunks, total), contentType: contentTypeOf(res), url }
  } catch (err) {
    res.destroy()
    throw translate(err)
  } finally {
    done()
  }
}

/**
 * Download as a stream (for large results such as videos).
 * Resolves { stream, contentType, contentLength, url }. The stream errors with
 * a SafeFetchError when the cap or the deadline is hit.
 */
async function safeFetchStream(raw, opts = {}) {
  const maxBytes = opts.maxBytes || DEFAULT_MAX_BYTES
  const { res, url, done, translate, signal } = await open(raw, opts)
  const len = declaredLength(res)
  if (len !== null && len > maxBytes) {
    res.destroy()
    done()
    throw new SafeFetchError('E2BIG', '文件超过大小上限')
  }
  const out = new PassThrough()
  let total = 0
  const fail = (err) => { res.destroy(); done(); out.destroy(translate(err)) }
  const onAbort = () => fail(new Error('aborted'))
  signal.addEventListener('abort', onAbort, { once: true })
  res.on('data', (chunk) => {
    total += chunk.length
    if (total > maxBytes) return fail(new SafeFetchError('E2BIG', '文件超过大小上限'))
    if (!out.write(chunk)) { res.pause(); out.once('drain', () => res.resume()) }
  })
  res.on('end', () => { signal.removeEventListener('abort', onAbort); done(); out.end() })
  res.on('error', fail)
  out.on('close', () => { signal.removeEventListener('abort', onAbort); done(); if (!res.destroyed) res.destroy() })
  return { stream: out, contentType: contentTypeOf(res), contentLength: len, url }
}

module.exports = {
  safeFetch,
  safeFetchStream,
  assertPublicUrl,
  isBlockedAddress,
  guardedLookup,
  setAllowedHosts,
  SafeFetchError,
  DEFAULT_MAX_BYTES,
}
