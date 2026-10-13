'use strict'

const mongoose = require('mongoose')

const { Mixed } = mongoose.Schema.Types

/**
 * One account's adjustments layered on top of a provider's declared ModelSpec.
 * A field left undefined means "use what the provider declared".
 */
const modelOverrideSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  modelId: { type: String, required: true, maxlength: 200 },
  // The account that made it. `userId` is the SPACE it belongs to (an account's personal
  // space, or a team); rows from before teams have no createdBy and read as userId.
  createdBy: { type: String, default: '' },
  enabled: { type: Boolean },
  label: { type: String, maxlength: 80 },
  sort: { type: Number },
  defaults: { type: Mixed },
  pricing: { type: Mixed },
}, { timestamps: true, minimize: false })

// Model ids are per account, so the same id may be overridden by several accounts.
modelOverrideSchema.index({ userId: 1, modelId: 1 }, { unique: true })

module.exports = mongoose.model('ModelOverride', modelOverrideSchema)
