'use strict'

const mongoose = require('mongoose')

/**
 * An account asking the super admin for the authorisation to create teams.
 * At most one pending request per account (the partial unique index); the
 * decided ones stay as the history the account and the super admin see.
 */
const teamRequestSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  note: { type: String, default: '', maxlength: 500 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  decidedBy: { type: String, default: '' },
  decidedAt: { type: Date, default: null },
  // Why it was rejected, when the super admin said so.
  reason: { type: String, default: '', maxlength: 500 },
}, { timestamps: true })

teamRequestSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: 'pending' } })
teamRequestSchema.index({ userId: 1, createdAt: -1 })

module.exports = mongoose.model('TeamRequest', teamRequestSchema)
