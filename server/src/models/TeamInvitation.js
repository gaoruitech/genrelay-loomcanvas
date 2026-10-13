'use strict'

const mongoose = require('mongoose')

/**
 * An invite link. Whoever holds the link can join the team as a member until
 * it expires, is used up or is revoked. The link is found by the SHA-256 of
 * its token; the token itself is kept encrypted with SECRET_KEY so the team's
 * managers can copy the link again, and a copy of the database alone cannot
 * be used to join.
 */
const teamInvitationSchema = new mongoose.Schema({
  teamId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  tokenEnc: { type: String, default: '', select: false },
  createdBy: { type: String, required: true },
  // 0 = no limit on how many people may use it.
  maxUses: { type: Number, default: 10 },
  usedCount: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  revoked: { type: Boolean, default: false },
  revokedBy: { type: String, default: '' },
}, { timestamps: true })

module.exports = mongoose.model('TeamInvitation', teamInvitationSchema)
