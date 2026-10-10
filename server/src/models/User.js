'use strict'

const mongoose = require('mongoose')
const { ROLES } = require('../constants')

/**
 * An account. The first one registered is the owner (site settings, user
 * management); every other one is a plain user. Either way an account sees
 * only its own canvases, files, providers and usage.
 */
const userSchema = new mongoose.Schema({
  // As typed, for display; the *Lower twins are what uniqueness and sign-in go by.
  username: { type: String, required: true, maxlength: 32 },
  usernameLower: { type: String, required: true, unique: true },
  email: { type: String, required: true, maxlength: 254 },
  emailLower: { type: String, required: true, unique: true },
  // "scrypt$N=..,r=..,p=..$<salt>$<hash>", see utils/password.js. Never serialised.
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: Object.values(ROLES), default: ROLES.USER },
  disabled: { type: Boolean, default: false },
  lastLoginAt: { type: Date, default: null },
  // Owner only: 'pending' from the moment the account exists until the data of
  // the pre-account version has been handed to it, then 'done'. Written with
  // the account itself, so an interrupted hand-over is finished at the next start.
  legacyAdoption: { type: String, enum: ['', 'pending', 'done'], default: '' },
}, { timestamps: true })

// At most one owner, whatever races at the first registration.
userSchema.index({ role: 1 }, { unique: true, partialFilterExpression: { role: ROLES.OWNER } })

module.exports = mongoose.model('User', userSchema)
