'use strict'

/**
 * Before accounts existed every document was owned by this constant. Documents
 * that still carry it belong to nobody yet: the first account that registers
 * (the owner) adopts them, see services/accounts.js.
 */
const LEGACY_USER = 'local'

/** Owner of what belongs to the site rather than to an account (built-in templates). */
const SYSTEM_USER = 'system'

const ROLES = Object.freeze({ OWNER: 'owner', USER: 'user' })

const RUN_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  ARCHIVING: 'archiving',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
})

const RUN_KINDS = Object.freeze(['image', 'video', 'chat'])

module.exports = { LEGACY_USER, SYSTEM_USER, ROLES, RUN_STATUS, RUN_KINDS }
