'use strict'

/**
 * In-memory run store with the same contract as mongoStore. Used by the
 * runner tests; also documents exactly what the runner needs from a store.
 */
const { STATUS } = require('./core')
const { msg, storedError } = require('../i18n')

function createMemoryStore(initial = []) {
  const runs = new Map()
  let seq = 0
  const clone = (r) => (r ? structuredClone(r) : null)

  function insert(run) {
    const id = String(run.id || ++seq)
    runs.set(id, {
      id,
      userId: 'local',
      status: STATUS.QUEUED,
      progress: 0,
      params: {},
      count: 1,
      externalId: '',
      outputs: [],
      error: '',
      billingStarted: false,
      createdAt: new Date(),
      ...run,
    })
    return id
  }
  for (const r of initial) insert(r)

  return {
    insert,
    async get(id) { return clone(runs.get(String(id))) },

    /** queued -> running, atomically. Null when the run is not queued. */
    async claim(id, patch) {
      const run = runs.get(String(id))
      if (!run || run.status !== STATUS.QUEUED) return null
      Object.assign(run, patch, { startedAt: run.startedAt || patch.startedAt })
      return clone(run)
    },

    async update(id, patch) {
      const run = runs.get(String(id))
      if (!run) return null
      Object.assign(run, patch)
      return clone(run)
    },

    /** queued -> canceled, only if still queued. */
    async cancelQueued(id, patch) {
      const run = runs.get(String(id))
      if (!run || run.status !== STATUS.QUEUED) return null
      Object.assign(run, patch)
      return clone(run)
    },

    /**
     * Called once at boot. Interrupted runs that already have an upstream task
     * go back to the queue (they will resume polling); interrupted runs without
     * one fail, because nobody knows whether the upstream accepted them.
     * Returns the ids to enqueue, oldest first.
     */
    async recover() {
      for (const run of runs.values()) {
        if (run.status !== STATUS.RUNNING && run.status !== STATUS.ARCHIVING) continue
        if (run.externalId) run.status = STATUS.QUEUED
        else Object.assign(run, { status: STATUS.FAILED, ...storedError(msg('run.interrupted')), finishedAt: new Date() })
      }
      return [...runs.values()]
        .filter((r) => r.status === STATUS.QUEUED)
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((r) => r.id)
    },
  }
}

module.exports = { createMemoryStore }
