'use strict'

/**
 * /api/team-invitations - what somebody holding an invite link does with it.
 *
 *   GET  /:token          public: what the link is for and whether it still works
 *   POST /:token/accept   signed in: join the team as a member
 *
 * The token is the invitation: whoever has the link can join until it
 * expires, is used up or is revoked. It is not a way to get an account - with
 * registration closed, somebody without an account cannot use it (the preview
 * says so in `registrationOpen`).
 */
const express = require('express')
const teams = require('../services/teams')
const { ok, wrap } = require('../utils/http')
const { identify, requireAuth } = require('../middleware/auth')

const router = express.Router()

/**
 * GET /api/team-invitations/:token
 * -> { state, team: { id, name, avatar, members, maxMembers, ownerName } | null, inviterName, expiresAt, alreadyMember, registrationOpen }
 * `state`: valid | expired | used_up | revoked | team_full | team_unavailable.
 * An unknown token is 404 `invite.not_found`.
 */
router.get('/:token', wrap(async (req, res) => {
  const who = await identify(req)
  ok(res, await teams.previewInvitation(req.params.token, who ? String(who.user._id) : ''))
}))

/**
 * POST /api/team-invitations/:token/accept -> { team, already }
 * Refusals: 404 `invite.not_found`, 410 `invite.expired` | `invite.used_up` | `invite.revoked`, 409 `invite.team_full`.
 * Somebody who is in the team already gets `already: true`, and no use of the link is spent.
 */
router.post('/:token/accept', requireAuth, wrap(async (req, res) => {
  ok(res, await teams.acceptInvitation(req.user, req.params.token))
}))

module.exports = router
