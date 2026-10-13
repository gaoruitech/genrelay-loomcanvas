'use strict'

const mongoose = require('mongoose')

/**
 * One account's membership of one team. The row is the access: removing it
 * takes effect on the member's very next request. `role` tells admins from
 * plain members only - who the team's owner is, Team.ownerId says.
 */
const teamMemberSchema = new mongoose.Schema({
  teamId: { type: String, required: true },
  userId: { type: String, required: true, index: true },
  role: { type: String, enum: ['admin', 'member'], default: 'member' },
  // Shown instead of the username inside this team ('' = use the username).
  displayName: { type: String, default: '', maxlength: 40 },
  // This member's own monthly limits; null = the team's default for members.
  limits: {
    runs: { type: Number, default: null },
    amount: { type: Number, default: null },
  },
  invitationId: { type: String, default: '' },
  joinedAt: { type: Date, default: Date.now },
}, { timestamps: true, minimize: false })

teamMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true })

module.exports = mongoose.model('TeamMember', teamMemberSchema)
