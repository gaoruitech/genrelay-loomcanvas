'use strict'

const mongoose = require('mongoose')
const { LOCAL_USER } = require('../constants')

/**
 * A configured upstream ("接入实例"): one provider type plus the user's own
 * base URL and API key. The key is stored encrypted and never serialised.
 */
const providerSchema = new mongoose.Schema({
  userId: { type: String, default: LOCAL_USER, index: true },
  type: { type: String, required: true },
  name: { type: String, required: true, maxlength: 60 },
  // Stable prefix of model ids ("<slug>:<model>"). Immutable after creation.
  slug: { type: String, required: true, unique: true, match: /^[a-z0-9][a-z0-9-]{0,39}$/ },
  baseUrl: { type: String, default: '' },
  // AES-256-GCM ciphertext, see utils/crypto.js. select:false keeps it out of ordinary queries.
  apiKeyEnc: { type: String, default: '', select: false },
  keyTail: { type: String, default: '' },
  hasKey: { type: Boolean, default: false },
  // Non-secret, type-specific fields (e.g. the model list of an OpenAI-compatible endpoint).
  options: { type: mongoose.Schema.Types.Mixed, default: {} },
  enabled: { type: Boolean, default: true },
  sort: { type: Number, default: 0 },
}, { timestamps: true, minimize: false })

module.exports = mongoose.model('Provider', providerSchema)
