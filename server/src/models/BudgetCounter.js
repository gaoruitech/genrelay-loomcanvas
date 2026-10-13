'use strict'

const mongoose = require('mongoose')

const { Mixed } = mongoose.Schema.Types

/**
 * What one team has used of its monthly limits in one month: the number every
 * new run is admitted against (services/budget.js). One document per team and
 * month, so that the team's total and the member's own count are checked and
 * raised in ONE atomic update - which is what makes a limit hold however many
 * server processes share the database.
 *
 * It is a cache of the run records, never the other way round: it is built
 * from them when it is missing and rebuilt from them when it disagrees.
 */
const budgetCounterSchema = new mongoose.Schema({
  // The team. Named `userId` like in every per-space collection; removed with the team (budget.forgetTeam).
  userId: { type: String, required: true },
  // '2026-10'
  month: { type: String, required: true },
  // The currency `micro` is in (Team.limits.currency when it was built).
  currency: { type: String, default: 'CNY' },
  // Runs that count (succeeded + queued or in flight) and their money in millionths of `currency`.
  team: {
    runs: { type: Number, default: 0 },
    micro: { type: Number, default: 0 },
  },
  // account id -> { runs, micro }
  members: { type: Mixed, default: {} },
  // Reservations whose run record is not written yet: [{ id, uid, micro, at }].
  pending: { type: [Mixed], default: [] },
  // Raised by every change; a rebuild only writes when nothing changed since it read.
  seq: { type: Number, default: 0 },
  // Raised by every rebuild; a release that started before a rebuild does not apply after it.
  epoch: { type: Number, default: 0 },
}, { timestamps: true, minimize: false })

budgetCounterSchema.index({ userId: 1, month: 1 }, { unique: true })

module.exports = mongoose.model('BudgetCounter', budgetCounterSchema)
