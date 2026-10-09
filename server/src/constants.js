'use strict'

/**
 * The first version is single-user. Every collection still carries a userId so
 * multi-user support can be added later without a data migration; for now it
 * is always this constant.
 */
const LOCAL_USER = 'local'

const RUN_STATUS = Object.freeze({
  QUEUED: 'queued',
  RUNNING: 'running',
  ARCHIVING: 'archiving',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELED: 'canceled',
})

const RUN_KINDS = Object.freeze(['image', 'video', 'chat'])

module.exports = { LOCAL_USER, RUN_STATUS, RUN_KINDS }
