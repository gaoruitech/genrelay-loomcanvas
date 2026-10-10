'use strict'

/**
 * HTTP client for talking to upstream model APIs.
 *
 * The base URL here is configured by the operator (not by canvas users), so
 * it is deliberately NOT run through the SSRF guard: pointing a provider at a
 * model server on the local network is a legitimate setup.
 *
 * Failures become ProviderError with a catalog message safe to show to the user and
 * two flags the runner relies on:
 *   transient       - worth retrying a status query
 *   safeToResubmit  - the upstream certainly did not accept the request, so
 *                     even a task submission may be repeated
 */
const axios = require('axios')
const { LocalizedError } = require('../i18n')

class ProviderError extends LocalizedError {
  /** @param {string|object} key catalog key or message; text from the upstream goes in params */
  constructor(key, params = {}, extra = {}) {
    super(key, params)
    this.name = 'ProviderError'
    this.transient = false
    this.safeToResubmit = false
    Object.assign(this, extra)
  }
}

// The connection was never established: nothing reached the upstream.
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'])
// Might have been processed: fine to re-poll, not fine to re-submit.
const AMBIGUOUS = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'ERR_NETWORK', 'ERR_BAD_RESPONSE'])

const MAX_RESPONSE_BYTES = 80 * 1024 * 1024

/** Pull a human-readable message out of the usual error body shapes. */
function messageFromBody(body) {
  if (!body) return ''
  // Cut first: this is text from another server, and it can be megabytes of "<".
  if (typeof body === 'string') return body.slice(0, 4000).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (typeof body !== 'object') return ''
  const e = body.error
  const candidates = [
    e && typeof e === 'object' ? e.message : e,
    body.message,
    body.msg,
    body.detail,
    body.fail_reason,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 300)
  }
  return ''
}

const SECRET_HEADERS = new Set(['authorization', 'x-goog-api-key', 'x-api-key', 'api-key'])

/**
 * Some upstreams repeat the key they were sent in their error message. That
 * text is shown to the user and stored with the run, so the credentials of
 * this request are blanked out of it first.
 */
function redactSecrets(text, headers) {
  let out = String(text || '')
  for (const [name, value] of Object.entries(headers || {})) {
    if (!SECRET_HEADERS.has(name.toLowerCase()) || typeof value !== 'string') continue
    const bare = value.replace(/^Bearer\s+/i, '')
    for (const secret of [value, bare]) {
      if (secret.length >= 6) out = out.split(secret).join('***')
    }
  }
  return out
}

/**
 * @param {object} opts { method, url, headers, data, params, signal, timeoutMs }
 * @returns {Promise<any>} parsed response body
 */
async function request({ method = 'GET', url, headers = {}, data, params, signal, timeoutMs = 60000 }) {
  let res
  try {
    res = await axios({
      method,
      url,
      headers,
      data,
      params,
      signal,
      timeout: timeoutMs,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      validateStatus: () => true,
      // Do not follow redirects: the Authorization header must not travel to another host.
      maxRedirects: 0,
    })
  } catch (err) {
    if (signal && signal.aborted) throw signal.reason
    const code = err.code || ''
    if (NOT_SENT.has(code)) {
      throw new ProviderError('upstream.unreachable', { code }, { transient: true, safeToResubmit: true, code })
    }
    if (AMBIGUOUS.has(code)) {
      throw new ProviderError('upstream.interrupted', { code }, { transient: true, code })
    }
    // Not `cause: err`: an axios error carries the request, Authorization header included.
    throw new ProviderError('upstream.request_failed', {}, { code, cause: new Error(String(err.message || code)) })
  }

  if (res.status >= 200 && res.status < 300) return res.data

  const detail = redactSecrets(messageFromBody(res.data), headers)
  const status = res.status
  if (status === 401 || status === 403) {
    throw new ProviderError(detail ? 'upstream.auth_rejected_detail' : 'upstream.auth_rejected', { status, detail }, { status })
  }
  throw new ProviderError(detail ? 'upstream.http_error_detail' : 'upstream.http_error', { status, detail }, {
    status,
    transient: [408, 429, 500, 502, 503, 504].includes(status),
    // 429/503 are explicit "not now" answers; the request was not processed.
    safeToResubmit: status === 429 || status === 503,
  })
}

function trimBase(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '')
}

/** Base for OpenAI-style paths: accepts "https://host" and "https://host/v1". */
function openaiBase(baseUrl) {
  const base = trimBase(baseUrl)
  return /\/v\d+$/.test(base) ? base : `${base}/v1`
}

module.exports = { request, ProviderError, messageFromBody, redactSecrets, trimBase, openaiBase }
