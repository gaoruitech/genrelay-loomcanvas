'use strict'

/**
 * Connection test for an S3 configuration: a real round trip with a small
 * object - write it, look it up, read it back and compare, load it through the
 * public address when files are delivered from there, delete it.
 *
 * The answer names what went wrong in terms an operator can act on. Where the
 * service's own code says nothing we recognise, its words are passed on.
 */
const crypto = require('crypto')
const { msg, isMessage } = require('../i18n')
const { createS3Backend, statusOf } = require('./s3')
const { endpointHost } = require('./schema')

const CONNECT_TIMEOUT_MS = 6000
const REQUEST_TIMEOUT_MS = 12000
const PUBLIC_TIMEOUT_MS = 10000

const UNREACHABLE = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'])
const WRONG_REGION = new Set(['AuthorizationHeaderMalformed', 'PermanentRedirect', 'IllegalLocationConstraintException', 'InvalidRegion'])

class ProbeError extends Error {
  constructor(code, params) {
    super(code)
    this.i18n = msg(code, params)
  }
}

function networkCode(err) {
  for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (typeof e.code === 'string' && /^(E[A-Z_]+|CERT_|DEPTH_|UNABLE_|SELF_SIGNED|ERR_TLS|ERR_SSL)/.test(e.code)) return e.code
  }
  return ''
}

/** Turn whatever the SDK threw into a message for the settings page. */
function classify(err, cfg) {
  if (err && isMessage(err.i18n)) return err.i18n
  const host = endpointHost(cfg)
  const name = String((err && (err.Code || err.name)) || '')
  const status = statusOf(err)
  const net = networkCode(err)
  const detail = String((err && err.message) || '').split('\n')[0].slice(0, 200)

  if (net === 'ENOTFOUND') {
    const asked = String(err.hostname || host)
    // With virtual-hosted addressing the bucket is part of the host name: a
    // self-hosted service without wildcard DNS then cannot be found at all.
    return !cfg.forcePathStyle && asked.startsWith(`${cfg.bucket}.`)
      ? msg('storage.err_host_bucket_not_found', { host: asked })
      : msg('storage.err_host_not_found', { host: asked })
  }
  if (net === 'EPROTO' || /^(CERT_|DEPTH_|UNABLE_|SELF_SIGNED|ERR_TLS|ERR_SSL)/.test(net)) return msg('storage.err_tls', { host, detail })
  if (UNREACHABLE.has(net) || name === 'TimeoutError' || name === 'AbortError') return msg('storage.err_unreachable', { host, detail })

  if (name === 'InvalidAccessKeyId' || status === 401) return msg('storage.err_access_key')
  if (name === 'SignatureDoesNotMatch') return msg('storage.err_signature')
  if (name === 'RequestTimeTooSkewed') return msg('storage.err_clock_skew')
  if (name === 'NoSuchBucket') return msg('storage.err_no_bucket', { bucket: cfg.bucket })
  if (WRONG_REGION.has(name) || status === 301) return msg('storage.err_region', { region: cfg.region, detail })
  // Aliyun OSS refuses path-style requests with this code.
  if (name === 'SecondLevelDomainForbidden') return msg('storage.err_path_style_refused')
  if (name === 'AccessDenied' || name === 'AllAccessDisabled' || status === 403) return msg('storage.err_access_denied', { bucket: cfg.bucket })
  // An answer that is not S3 XML: a web page, another API, a proxy's error page.
  if (/XML parse error|Deserialization error|Unexpected token/i.test(detail) || name === 'UnknownError') {
    return msg('storage.err_not_s3', { host, status: status || '-' })
  }
  return msg('storage.err_other', { code: name || net || String(status || '-'), detail })
}

async function readPublic(url, expected) {
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(PUBLIC_TIMEOUT_MS), headers: { 'Cache-Control': 'no-cache' } })
  } catch (err) {
    const cause = err && err.cause ? `${err.cause.code || err.cause.message || ''}` : ''
    throw new ProbeError('storage.err_public_unreachable', { url, detail: cause || String(err && err.message).slice(0, 120) })
  }
  if (res.status !== 200) {
    await res.body?.cancel().catch(() => {})
    throw new ProbeError('storage.err_public_status', { url, status: res.status })
  }
  const got = Buffer.from(await res.arrayBuffer())
  if (!got.equals(expected)) throw new ProbeError('storage.err_public_mismatch', { url })
}

/**
 * @param {object} cfg a parsed configuration with its secret
 * @param {object} [opts] { connectionTimeout, requestTimeout } in ms - how long the service gets to
 *   accept a connection and to answer one request. Both are hard limits: a service that accepts
 *   the connection and then says nothing fails the step it was asked for, it does not hang the test.
 * @returns {Promise<{ ok: boolean, steps: { step: string, status: 'ok'|'failed'|'skipped', ms?: number }[], error: object|null }>}
 *   `error` is a message ({ code, params }) for the first step that failed.
 */
async function probe(cfg, opts = {}) {
  const backend = createS3Backend(cfg, {
    maxAttempts: 1,
    connectionTimeout: opts.connectionTimeout || CONNECT_TIMEOUT_MS,
    requestTimeout: opts.requestTimeout || REQUEST_TIMEOUT_MS,
  })
  const key = `probe/${crypto.randomBytes(16).toString('hex')}.txt`
  const absent = `probe/${crypto.randomBytes(16).toString('hex')}.txt`
  const body = Buffer.from(`LoomCanvas storage test ${crypto.randomBytes(16).toString('hex')}\n`)
  const steps = []
  let error = null
  let written = false

  async function step(name, fn, { always = false } = {}) {
    if (error && !always) return steps.push({ step: name, status: 'skipped' })
    const started = Date.now()
    try {
      await fn()
      steps.push({ step: name, status: 'ok', ms: Date.now() - started })
    } catch (err) {
      steps.push({ step: name, status: 'failed', ms: Date.now() - started })
      error = error || classify(err, cfg)
    }
  }

  await step('put', async () => {
    await backend.put(key, body, { contentType: 'text/plain' })
    written = true
  })
  await step('head', async () => {
    const info = await backend.head(key)
    if (!info || info.size !== body.length) throw new ProbeError('storage.err_read_back')
    // An object that is not there has to be reported as "not found". A key that
    // may not list the bucket gets "forbidden" instead (AWS S3), and then a file
    // kept elsewhere cannot be told from one that could not be checked.
    try {
      await backend.head(absent)
    } catch (err) {
      if (statusOf(err) === 403) throw new ProbeError('storage.err_list_permission', { bucket: cfg.bucket })
      throw err
    }
  })
  await step('get', async () => {
    if (!(await backend.getBuffer(key)).equals(body)) throw new ProbeError('storage.err_read_back')
  })
  if (backend.delivery === 'redirect') await step('public', () => readPublic(backend.publicUrl(key), body))
  // Clean up whatever happened in between, as long as something was written.
  if (written) await step('delete', () => backend.delete(key), { always: true })
  else steps.push({ step: 'delete', status: 'skipped' })

  return { ok: !error, steps, error }
}

module.exports = { probe, classify }
