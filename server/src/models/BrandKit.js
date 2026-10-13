'use strict'

const mongoose = require('mongoose')

const MAX_REF_IMAGES = 5

/**
 * Brand kit: a reusable "direction" - fixed reference images, a prompt prefix and
 * negative terms - chosen per canvas (Workflow.brandKitId) and added to every
 * generation run of that canvas by the editor. `isDefault` marks the kit a new
 * canvas starts with.
 */
const brandKitSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 40 },
  // The account that made it. `userId` is the SPACE it belongs to (an account's personal
  // space, or a team); rows from before teams have no createdBy and read as userId.
  createdBy: { type: String, default: '' },
  // Media URLs only, never inline base64.
  refImages: {
    type: [String],
    default: [],
    // `message` is a catalog key; the error handler renders it with these properties.
    validate: { validator: (v) => !Array.isArray(v) || v.length <= MAX_REF_IMAGES, message: 'brandKit.ref_images_max', max: MAX_REF_IMAGES },
  },
  promptPrefix: { type: String, default: '', maxlength: 1000 },
  // Appended to the prompt as text; most image APIs have no negative-prompt parameter.
  negativePrompt: { type: String, default: '', maxlength: 500 },
  // Stored and returned by the API; the editor neither sets nor applies these two.
  defaultRatio: { type: String, default: '', maxlength: 20 },
  defaultModel: { type: String, default: '', maxlength: 200 },
  isDefault: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true })

brandKitSchema.index({ userId: 1, isDeleted: 1, updatedAt: -1 })

module.exports = mongoose.model('BrandKit', brandKitSchema)
module.exports.MAX_REF_IMAGES = MAX_REF_IMAGES
