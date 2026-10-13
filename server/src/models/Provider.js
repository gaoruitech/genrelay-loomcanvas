'use strict'

const mongoose = require('mongoose')

/**
 * A configured vendor account ("服务商"): one vendor plus the user's own API
 * key, optionally another address, and the custom models added by hand.
 * The key is stored encrypted and never serialised.
 */
const providerSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  // The account that made it. `userId` is the SPACE it belongs to (an account's personal
  // space, or a team); rows from before teams have no createdBy and read as userId.
  createdBy: { type: String, default: '' },
  // Vendor id: gaorui | openai | gemini (see providers/index.js).
  type: { type: String, required: true },
  name: { type: String, required: true, maxlength: 60 },
  // Stable prefix of model ids ("<slug>:<model>"). Immutable after creation.
  // Unique per account (index below): two accounts may both have "gaorui".
  slug: { type: String, required: true, match: /^[a-z0-9][a-z0-9-]{0,39}$/ },
  baseUrl: { type: String, default: '' },
  // AES-256-GCM ciphertext, see utils/crypto.js. select:false keeps it out of ordinary queries.
  apiKeyEnc: { type: String, default: '', select: false },
  keyTail: { type: String, default: '' },
  hasKey: { type: Boolean, default: false },
  // The account that entered the current key. In a team: who to think of when that person leaves.
  keySetBy: { type: String, default: '' },
  // The account that last changed the provider (name, address, key, switch, custom models):
  // its maintainer, the person to ask about it. '' on rows from before this was kept.
  updatedBy: { type: String, default: '' },
  // The result of the last connection test of the provider as it is saved; null = never tested,
  // or the key or address changed since. The message is kept as a catalog message (see ../i18n).
  lastTest: {
    type: new mongoose.Schema({
      ok: { type: Boolean, required: true },
      at: { type: Date, required: true },
      by: { type: String, default: '' },
      error: { type: String, default: '' },
      errorCode: { type: String, default: '' },
      errorParams: { type: mongoose.Schema.Types.Mixed, default: {} },
    }, { _id: false, minimize: false }),
    default: null,
  },
  // Models outside the vendor's catalog. `id` is the upstream model name; the
  // kind is chosen by the user and never derived from the name.
  customModels: {
    type: [new mongoose.Schema({
      id: { type: String, required: true, maxlength: 120 },
      kind: { type: String, required: true, enum: ['image', 'video', 'chat'] },
      label: { type: String, default: '', maxlength: 80 },
    }, { _id: false })],
    default: [],
  },
  // Set by services/providerMigration.js once a row has the current shape.
  schemaVersion: { type: Number, default: 3 },
  enabled: { type: Boolean, default: true },
  sort: { type: Number, default: 0 },
}, { timestamps: true, minimize: false })

providerSchema.index({ userId: 1, slug: 1 }, { unique: true })

module.exports = mongoose.model('Provider', providerSchema)
