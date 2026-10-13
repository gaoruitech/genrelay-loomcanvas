'use strict'

const mongoose = require('mongoose')

/**
 * Somebody who was in a team and is not any more: what is kept of them so
 * that what they made still says whose it was. The member row itself is
 * deleted the moment they go (it is the access); this row holds only the name
 * they went by in the team, and when and how they went.
 *
 * It gives nobody access to anything, is written when a member leaves, is
 * removed or has their account deleted, replaced when the same account leaves
 * again, and goes with the team when the team is removed.
 */
const teamFormerMemberSchema = new mongoose.Schema({
  teamId: { type: String, required: true },
  userId: { type: String, required: true },
  username: { type: String, default: '', maxlength: 80 },
  displayName: { type: String, default: '', maxlength: 40 },
  role: { type: String, enum: ['admin', 'member'], default: 'member' },
  // left: went by themselves. removed: taken out by a manager. deleted: their account was deleted.
  reason: { type: String, enum: ['left', 'removed', 'deleted'], default: 'left' },
  leftAt: { type: Date, default: Date.now },
}, { timestamps: false, minimize: false })

teamFormerMemberSchema.index({ teamId: 1, userId: 1 }, { unique: true })

module.exports = mongoose.model('TeamFormerMember', teamFormerMemberSchema)
