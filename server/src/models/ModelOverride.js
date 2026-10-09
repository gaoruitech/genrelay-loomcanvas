'use strict'

const mongoose = require('mongoose')
const { LOCAL_USER } = require('../constants')

const { Mixed } = mongoose.Schema.Types

/**
 * Admin adjustments layered on top of a provider's declared ModelSpec.
 * A field left undefined means "use what the provider declared".
 */
const modelOverrideSchema = new mongoose.Schema({
  userId: { type: String, default: LOCAL_USER, index: true },
  modelId: { type: String, required: true, unique: true, maxlength: 200 },
  enabled: { type: Boolean },
  label: { type: String, maxlength: 80 },
  sort: { type: Number },
  defaults: { type: Mixed },
  pricing: { type: Mixed },
}, { timestamps: true, minimize: false })

module.exports = mongoose.model('ModelOverride', modelOverrideSchema)
