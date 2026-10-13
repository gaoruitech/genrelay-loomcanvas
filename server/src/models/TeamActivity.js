'use strict'

const mongoose = require('mongoose')
const { Mixed } = mongoose.Schema.Types

/**
 * The team's activity log: management actions (members, invitations,
 * providers, limits, canvases removed or taken over, share links, the team
 * itself). Append only: no route changes or removes a row; old ones go by age
 * (`teamActivityDays`). `detail` holds only what services/activity.js lets
 * through - never a key, never a prompt.
 */
const teamActivitySchema = new mongoose.Schema({
  teamId: { type: String, required: true },
  // '' when the site's super admin acted from outside the team.
  actorId: { type: String, default: '' },
  // The actor's name when it happened, so the entry still reads right after the account is gone.
  actorName: { type: String, default: '', maxlength: 80 },
  type: { type: String, required: true, maxlength: 60 },
  category: { type: String, required: true, maxlength: 20 },
  target: {
    type: { type: String, default: '' },
    id: { type: String, default: '' },
    name: { type: String, default: '', maxlength: 120 },
  },
  detail: { type: Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
}, { minimize: false })

teamActivitySchema.index({ teamId: 1, createdAt: -1 })

module.exports = mongoose.model('TeamActivity', teamActivitySchema)
