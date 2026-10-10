'use strict'

const mongoose = require('mongoose')
const { LOCAL_USER } = require('../constants')

/**
 * A configured vendor account ("服务商"): one vendor plus the user's own API
 * key, optionally another address, and the custom models added by hand.
 * The key is stored encrypted and never serialised.
 */
const providerSchema = new mongoose.Schema({
  userId: { type: String, default: LOCAL_USER, index: true },
  // Vendor id: gaorui | openai | gemini (see providers/index.js).
  type: { type: String, required: true },
  name: { type: String, required: true, maxlength: 60 },
  // Stable prefix of model ids ("<slug>:<model>"). Immutable after creation.
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9][a-z0-9-]{0,39}$/ },
  baseUrl: { type: String, default: '' },
  // AES-256-GCM ciphertext, see utils/crypto.js. select:false keeps it out of ordinary queries.
  apiKeyEnc: { type: String, default: '', select: false },
  keyTail: { type: String, default: '' },
  hasKey: { type: Boolean, default: false },
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

module.exports = mongoose.model('Provider', providerSchema)
