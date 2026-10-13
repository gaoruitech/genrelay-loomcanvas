'use strict'

/**
 * Which buckets can currently be reached.
 *
 * A bucket that does not answer (connection refused, host not found, no reply
 * in time, TLS failure) is remembered as down for a short while. During that
 * time it is not contacted at all: a request that needs it gets its answer at
 * once instead of waiting for another timeout, and a dead bucket is not
 * hammered by every file a page happens to ask for. When the time is up, one
 * request is let through to find out; the others keep getting the remembered
 * answer until that one comes back.
 *
 * Only a bucket that cannot be reached is remembered. One that answers with a
 * refusal (credentials revoked, no permission) answers fast, and may well
 * accept the next request - AWS S3, for one, says "forbidden" about a missing
 * object to a key that may not list the bucket.
 *
 * Each change is logged once: when a bucket goes down, when it is back, and
 * again once per period for as long as it stays down.
 */
const { statusOf } = require('./s3')

/** How long a bucket that did not answer is left alone. */
const DOWN_MS = 30 * 1000

const NETWORK_CODE = /^(E[A-Z_]+|CERT_|DEPTH_|UNABLE_|SELF_SIGNED|ERR_TLS|ERR_SSL)/

/** The network-level cause of an error ('' when the service did answer, or the error is something else). */
function networkCause(err) {
  if (!err || statusOf(err)) return ''
  for (let e = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (typeof e.code === 'string' && NETWORK_CODE.test(e.code)) return e.code
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'ETIMEDOUT'
  }
  return ''
}

function createHealth({ now = () => Date.now(), log = console, downMs = DOWN_MS } = {}) {
  /** backend id -> { until, since, cause, logged } */
  const down = new Map()
  /** backend id -> when it last answered, or last failed to (ms). What probe() goes by. */
  const seen = new Map()

  return {
    downMs,

    /**
     * May this backend be contacted now? False while it is remembered as down.
     * The first caller after the period is let through, and reports back with
     * ok() or failed(). Until it does the others still get false: the period
     * starts again with the caller that was let through.
     */
    mayAsk(backend) {
      const state = down.get(backend.id)
      if (!state) return true
      if (now() < state.until) return false
      state.until = now() + downMs
      return true
    },

    isDown(backend) {
      return down.has(backend.id)
    },

    /** How long ago (ms) the backend last answered or failed to answer; Infinity when it was never asked. */
    age(backend) {
      const at = seen.get(backend.id)
      return at === undefined ? Infinity : now() - at
    },

    /** The backend answered (whatever it said). */
    ok(backend) {
      seen.set(backend.id, now())
      const state = down.get(backend.id)
      if (!state) return
      down.delete(backend.id)
      log.warn(`[storage] ${backend.label} can be reached again (it was down for ${Math.round((now() - state.since) / 1000)} s)`)
    },

    /** A request to the backend failed. Resolves true when that was a failure to reach it. */
    failed(backend, err) {
      const cause = networkCause(err)
      if (!cause) return false
      const state = down.get(backend.id)
      const at = now()
      seen.set(backend.id, at)
      if (!state) {
        down.set(backend.id, { until: at + downMs, since: at, cause, logged: at })
        log.warn(`[storage] ${backend.label} cannot be reached (${cause}). It is not asked again for ${Math.round(downMs / 1000)} s; files that may be in it answer 503 until it is back`)
      } else {
        // Still down: said once per period, not once per request (requests that
        // were already under way when it went down all end up here).
        if (at - state.logged >= downMs) {
          state.logged = at
          log.warn(`[storage] ${backend.label} still cannot be reached (${cause}), down for ${Math.round((at - state.since) / 1000)} s`)
        }
        state.until = at + downMs
        state.cause = cause
      }
      return true
    },

    /** { id: { since, cause } } of the backends that are down, for the status page. */
    snapshot() {
      return Object.fromEntries([...down].map(([id, s]) => [id, { since: new Date(s.since), cause: s.cause }]))
    },

    /** Drop what is known about one backend, without a word (its configuration changed). */
    forget(backend) {
      down.delete(backend.id)
      seen.delete(backend.id)
    },

    reset() {
      down.clear()
      seen.clear()
    },
  }
}

module.exports = { createHealth, networkCause, DOWN_MS }
