'use strict'

const mongoose = require('mongoose')

/**
 * A signed-in browser. The token itself is never stored, only its SHA-256, so
 * a copy of the database cannot be used to sign in. Deleting the row is what
 * signing out means; expired rows are removed by MongoDB (TTL index).
 */
const sessionSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  lastSeenAt: { type: Date, default: Date.now },
  userAgent: { type: String, default: '', maxlength: 300 },
  ip: { type: String, default: '', maxlength: 64 },
  remember: { type: Boolean, default: false },
}, { timestamps: true })

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('Session', sessionSchema)
