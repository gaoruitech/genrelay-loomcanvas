'use strict'

const mongoose = require('mongoose')
const { VISIBILITY } = require('../constants')

const limitPair = {
  // null = no limit.
  runs: { type: Number, default: null },
  amount: { type: Number, default: null },
}

/**
 * A team: a second kind of space next to every account's personal one. Its
 * id is what the per-space collections carry in `userId` for everything that
 * belongs to the team (see services/accounts.js OWNED and docs/architecture.md).
 */
const teamSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 40 },
  avatar: { type: String, default: '', maxlength: 2048 },
  // The team's owner. Exactly one per team; this field, not a member row, is what makes somebody it.
  ownerId: { type: String, required: true, index: true },
  // active: in use. suspended: closed by the super admin. dissolved: closed by its owner,
  // restorable until purgeAt, then removed for good with its data and files.
  status: { type: String, enum: ['active', 'suspended', 'dissolved'], default: 'active', index: true },
  dissolvedAt: { type: Date, default: null },
  dissolvedBy: { type: String, default: '' },
  purgeAt: { type: Date, default: null },
  // Where the team's month begins and ends (monthly limits, the usage page). An IANA name.
  timezone: { type: String, default: 'UTC', maxlength: 64 },
  settings: {
    defaultVisibility: { type: String, enum: Object.values(VISIBILITY), default: VISIBILITY.TEAM_VIEW },
    // Who may create a public share link: everybody who can edit the canvas, or managers only.
    publicShare: { type: String, enum: ['editors', 'managers'], default: 'editors' },
    // May admins see everybody's records and usage, like the owner does?
    adminsSeeAll: { type: Boolean, default: false },
    // May members copy team canvases and assets into their personal space?
    copyToPersonal: { type: Boolean, default: true },
    // With a money limit set: refuse models whose cost cannot be estimated.
    blockUnpriced: { type: Boolean, default: true },
  },
  limits: {
    // The currency the two `amount` limits are in. Cost in any other currency does not count towards them.
    currency: { type: String, default: 'CNY', maxlength: 8 },
    team: limitPair,
    memberDefault: limitPair,
  },
  // Set by the super admin; null = the site's default (settings teamMaxMembers / teamConcurrency).
  maxMembers: { type: Number, default: null },
  concurrency: { type: Number, default: null },
  createdBy: { type: String, default: '' },
}, { timestamps: true, minimize: false })

module.exports = mongoose.model('Team', teamSchema)
