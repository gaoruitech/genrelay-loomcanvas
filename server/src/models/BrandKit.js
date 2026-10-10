'use strict'

const mongoose = require('mongoose')

const MAX_REF_IMAGES = 5

/**
 * Brand kit: a reusable "direction" attached to generation nodes - fixed
 * reference images, a prompt prefix, a negative prompt and default
 * ratio/model - so every image starts from the same place.
 */
const brandKitSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 40 },
  // Media URLs only, never inline base64 (kits are referenced from many nodes).
  refImages: {
    type: [String],
    default: [],
    // `message` is a catalog key; the error handler renders it with these properties.
    validate: { validator: (v) => !Array.isArray(v) || v.length <= MAX_REF_IMAGES, message: 'brandKit.ref_images_max', max: MAX_REF_IMAGES },
  },
  promptPrefix: { type: String, default: '', maxlength: 1000 },
  // Appended to the prompt as text; most image APIs have no negative-prompt parameter.
  negativePrompt: { type: String, default: '', maxlength: 500 },
  defaultRatio: { type: String, default: '', maxlength: 20 },
  defaultModel: { type: String, default: '', maxlength: 200 },
  isDefault: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true })

brandKitSchema.index({ userId: 1, isDeleted: 1, updatedAt: -1 })

module.exports = mongoose.model('BrandKit', brandKitSchema)
module.exports.MAX_REF_IMAGES = MAX_REF_IMAGES
