'use strict'

/**
 * Run store backed by the `runs` collection. Contract: see memoryStore.js.
 * The runner addresses runs by id only and works for every account; whose run
 * it is travels with the run (`userId`), and the API routes are what check it.
 */
const Run = require('../models/Run')
const budget = require('../services/budget')
const { STATUS } = require('./core')

const FINAL = [STATUS.SUCCEEDED, STATUS.FAILED, STATUS.CANCELED]

/**
 * A team's run that just reached its end settles what it held of the team's
 * monthly limits: the real cost in place of the reserve, or its place given
 * back. Here, at the one spot every status change passes through, so no way
 * of ending a run can forget it. A failure to settle must not undo the run's
 * outcome: it is logged, and the next rebuild of the counter repairs it.
 */
async function settle(run) {
  if (!run || !run.teamId || !FINAL.includes(run.status)) return run
  try {
    await budget.finish(run)
  } catch (err) {
    console.error(`[runner] the limits of team ${run.teamId} could not be settled for run ${run._id}:`, err && err.message)
  }
  return run
}

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
      const run = await Run.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean()
      return patch && FINAL.includes(patch.status) ? settle(run) : run
    },

    async cancelQueued(id, patch) {
      return settle(await Run.findOneAndUpdate({ _id: id, status: STATUS.QUEUED }, { $set: patch }, { new: true }).lean())
    },

    async recover() {
      const interrupted = { status: { $in: [STATUS.RUNNING, STATUS.ARCHIVING] } }
      await Run.updateMany(
        { ...interrupted, externalId: { $nin: ['', null] } },
        { $set: { status: STATUS.QUEUED } }
      )
      // What is still mid-flight now has no upstream task; the runner fails those.
      const lost = await Run.find(interrupted).lean()
      const queued = await Run.find({ status: STATUS.QUEUED }).sort({ createdAt: 1 }).select('_id userId createdBy teamId').lean()
      // Queued under who started it (fair per person) and, for a team's run, under the team (its cap).
      return { queued: queued.map((r) => ({ id: String(r._id), userId: r.createdBy || r.userId || '', groupId: r.teamId || '' })), interrupted: lost }
    },
  }
}

module.exports = { createMongoStore }
