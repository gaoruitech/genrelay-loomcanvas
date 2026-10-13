'use strict'

const mongoose = require('mongoose')
const { ROLES } = require('../constants')

/**
 * An account. One of them is the super admin (role `owner`: site settings,
 * user management); the server creates it at start-up when there is none.
 * Every account that registers is a plain user. Either way an account sees
 * only its own canvases, files, providers and usage.
 */
const userSchema = new mongoose.Schema({
  // As typed, for display; the *Lower twins are what uniqueness and sign-in go by.
  username: { type: String, required: true, maxlength: 32 },
  usernameLower: { type: String, required: true, unique: true },
  // Required for every account that registers. Only the super admin the server
  // creates may have none (ADMIN_EMAIL is optional): it is stored as '', and the
  // unique index below then allows exactly that one account without an address.
  email: { type: String, default: '', maxlength: 254 },
  emailLower: { type: String, default: '', unique: true },
  // "scrypt$N=..,r=..,p=..$<salt>$<hash>", see utils/password.js. Never serialised.
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: Object.values(ROLES), default: ROLES.USER },
  disabled: { type: Boolean, default: false },
  lastLoginAt: { type: Date, default: null },
  // The super admin's authorisation to create teams (how many: the `teamMaxPerUser` setting).
  // Taking it back stops new teams; the ones that exist stay.
  canCreateTeams: { type: Boolean, default: false },
  // The password is one somebody else knows (generated at start-up, or a
  // temporary one from a reset). Until the holder replaces it the API serves
  // nothing but that change, see middleware/auth.js.
  mustChangePassword: { type: Boolean, default: false },
  // Owner only: 'pending' from the moment the account exists until the data of
  // the pre-account version has been handed to it, then 'done'. Written with
  // the account itself, so an interrupted hand-over is finished at the next start.
  legacyAdoption: { type: String, enum: ['', 'pending', 'done'], default: '' },
  // How the web app looks for this account, on whichever browser it signs in.
  // The allowed keys and values live in services/accounts.js (PREFS).
  prefs: {
    // Layout of the generation nodes on the canvas: 'a' result first with a
    // composer under the selected node, 'b' compact nodes with an inspector on
    // the right, 'c' everything on the node.
    nodeLayout: { type: String, enum: ['a', 'b', 'c'], default: 'a' },
    // Colour theme of the interface: 'dark' (the default), 'light', or 'system'
    // to follow the device's own light / dark setting.
    theme: { type: String, enum: ['dark', 'light', 'system'], default: 'dark' },
  },
}, { timestamps: true })

// At most one owner, however many processes start at the same moment.
userSchema.index({ role: 1 }, { unique: true, partialFilterExpression: { role: ROLES.OWNER } })

module.exports = mongoose.model('User', userSchema)
