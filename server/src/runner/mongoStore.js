'use strict'

/** Run store backed by the `runs` collection. Contract: see memoryStore.js. */
const Run = require('../models/Run')
const { STATUS } = require('./core')

function createMongoStore() {
  return {
    async get(id) {
      return Run.findById(id).lean()
    },

    async claim(id, patch) {
      const { startedAt, ...rest } = patch
      const run = await Run.findOneAndUpdate(
        { _id: id, status: STATUS.QUEUED },
        { $set: rest },
        { new: true }
      ).lean()
      if (!run) return null
      if (!run.startedAt) {
        // Keep the first start time across re-queues.
        return Run.findByIdAndUpdate(id, { $set: { startedAt } }, { new: true }).lean()
      }
      return run
    },

    async update(id, patch) {
      return Run.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean()
    },

    async cancelQueued(id, patch) {
      return Run.findOneAndUpdate({ _id: id, status: STATUS.QUEUED }, { $set: patch }, { new: true }).lean()
    },

    async recover() {
      const interrupted = { status: { $in: [STATUS.RUNNING, STATUS.ARCHIVING] } }
      await Run.updateMany(
        { ...interrupted, externalId: { $nin: ['', null] } },
        { $set: { status: STATUS.QUEUED } }
      )
      // What is still mid-flight now has no upstream task; the runner fails those.
      const lost = await Run.find(interrupted).lean()
      const queued = await Run.find({ status: STATUS.QUEUED }).sort({ createdAt: 1 }).select('_id').lean()
      return { queued: queued.map((r) => String(r._id)), interrupted: lost }
    },
  }
}

module.exports = { createMongoStore }
